"""Desktop-owned resolver and one-shot outbound pull for remote control requests."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import threading
from typing import Callable

from scripts.prospecting import store
from scripts.prospecting.campaigner.cli import CampaignerService
from scripts.prospecting.campaigner.release import ReleaseContext, release_due
from scripts.prospecting.campaigner.requests import CampaignerRequests
from scripts.prospecting.control_protocol import (
    CONTROL_REF, LEASE_ID, OPERATIONS, REQUEST_ID, WORKER_ID, ControlRequest,
    ControlResult, encode_result, parse_request, parse_result,
)

CLAIM_SECONDS = 300
MAX_TRANSPORT_BYTES = 4096
MAX_DUE = 100
_HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,62}[A-Za-z0-9])?\Z")
_USER = re.compile(r"[a-z_][a-z0-9_-]{0,31}\Z")
_REMOTE_ENTRYPOINT = re.compile(r"/[A-Za-z0-9._/-]{1,220}/control_spool\.py\Z")


class ControlError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> None:
    raise ControlError(code)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        _fail("aware_now_required")
    return value.astimezone(timezone.utc).replace(microsecond=0)


def _stamp(value: datetime) -> str:
    return _utc(value).isoformat().replace("+00:00", "Z")


def _trusted_known_hosts(path: Path) -> bool:
    absolute = Path(os.path.abspath(path))
    current = Path(absolute.anchor)
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    for component in absolute.parts[1:]:
        current /= component
        try:
            info = current.lstat()
        except OSError:
            return False
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & reparse:
            return False
    return stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 1024 * 1024


def create_disabled_grant(
    connection: sqlite3.Connection, *, control_ref: str, campaign_id: str,
    operation: str, expires_at: datetime, now: datetime,
) -> None:
    """Create an inert local capability; activation is always a separate action."""
    if type(control_ref) is not str or CONTROL_REF.fullmatch(control_ref) is None:
        _fail("control_ref_invalid")
    if type(operation) is not str or operation not in {"status", "queue_due"}:
        _fail("operation_not_allowed")
    current, expiry = _utc(now), _utc(expires_at)
    if expiry <= current or expiry - current > timedelta(hours=24):
        _fail("grant_lifetime_invalid")
    campaign = connection.execute(
        "SELECT policy_hash,approval_tier,status FROM campaign WHERE campaign_id=?",
        (campaign_id,),
    ).fetchone()
    if campaign is None:
        _fail("campaign_missing")
    if campaign[1] != "T0" or campaign[2] != "active":
        _fail("campaign_ineligible")
    connection.execute(
        "INSERT INTO remote_control_grant VALUES(?,?,?,?,?,?,?,?)",
        (control_ref, campaign_id, campaign[0], operation, "T0", "disabled", _stamp(expiry), _stamp(current)),
    )


def set_grant_state(connection: sqlite3.Connection, control_ref: str, state: str) -> None:
    """Explicit local grant transition; revoked grants cannot be re-enabled."""
    if type(control_ref) is not str or CONTROL_REF.fullmatch(control_ref) is None:
        _fail("control_ref_invalid")
    if type(state) is not str or state not in {"active", "paused", "revoked"}:
        _fail("grant_state_invalid")
    row = connection.execute(
        "SELECT state,campaign_id,policy_hash,approval_tier FROM remote_control_grant WHERE control_ref=?",
        (control_ref,),
    ).fetchone()
    if row is None:
        _fail("grant_missing")
    if row[0] == "revoked" and state != "revoked":
        _fail("grant_revoked")
    if state == "active":
        campaign = connection.execute(
            "SELECT policy_hash,approval_tier,status FROM campaign WHERE campaign_id=?", (row[1],)
        ).fetchone()
        if campaign is None or tuple(campaign) != (row[2], row[3], "active"):
            _fail("grant_binding_mismatch")
    connection.execute("UPDATE remote_control_grant SET state=? WHERE control_ref=?", (state, control_ref))


def _expected_request(policy_hash: str, payload: dict[str, object]) -> tuple[str, str]:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(f"gmail_draft:{policy_hash}:{encoded}".encode()).hexdigest()
    return f"req_{digest[:16]}", encoded


class _JoinedConnection:
    """Delegate SQLite operations while leaving commit/rollback to the outer owner."""
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def execute(self, *args, **kwargs):
        return self.connection.execute(*args, **kwargs)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False


@dataclass
class DesktopControl:
    connection: sqlite3.Connection
    worker_id: str
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)

    def __post_init__(self) -> None:
        if type(self.worker_id) is not str or WORKER_ID.fullmatch(self.worker_id) is None:
            _fail("worker_id_invalid")

    def _result(self, request: ControlRequest, state: str, code: str, counts: dict[str, int]) -> ControlResult:
        return ControlResult(1, request.request_id, request.digest, state, code, counts)

    def _stored(self, request: ControlRequest, current: datetime) -> ControlResult | None:
        row = self.connection.execute(
            "SELECT request_hash,control_ref,operation,state,lease_until,result_json "
            "FROM remote_control_receipt WHERE request_id=?", (request.request_id,),
        ).fetchone()
        if row is None:
            return None
        if tuple(row[:3]) != (request.digest, request.control_ref, request.operation):
            _fail("request_conflict")
        if row[3] in {"succeeded", "failed"}:
            return parse_result(row[5].encode())
        if datetime.fromisoformat(row[4].replace("Z", "+00:00")) > current:
            _fail("request_in_progress")
        self.connection.execute(
            "UPDATE remote_control_receipt SET lease_until=? WHERE request_id=? AND state='claimed'",
            (_stamp(current + timedelta(seconds=CLAIM_SECONDS)), request.request_id),
        )
        return None

    def _grant(self, request: ControlRequest, current: datetime):
        grant = self.connection.execute(
            "SELECT campaign_id,policy_hash,operation,approval_tier,state,expires_at "
            "FROM remote_control_grant WHERE control_ref=?", (request.control_ref,),
        ).fetchone()
        if grant is None:
            return None, "grant_missing"
        if grant[4] != "active":
            return grant, "grant_inactive"
        if datetime.fromisoformat(grant[5].replace("Z", "+00:00")) <= current:
            return grant, "grant_expired"
        campaign = self.connection.execute(
            "SELECT policy_hash,approval_tier,status FROM campaign WHERE campaign_id=?", (grant[0],)
        ).fetchone()
        if grant[2] != request.operation or grant[3] != "T0" or campaign is None or tuple(campaign[:2]) != (grant[1], "T0"):
            return grant, "grant_binding_mismatch"
        if campaign[2] != "active":
            return grant, "campaign_inactive"
        return grant, None

    def _status(self, campaign_id: str) -> dict[str, int]:
        service = CampaignerService(
            self.connection, inbound_source=lambda: (),
            release=lambda _delivery_id: (_fail("operation_not_allowed")),
            campaign_id=campaign_id,
        )
        return service.status()

    def _queue_due(self, campaign_id: str, policy_hash: str, current: datetime) -> dict[str, int]:
        malformed = self.connection.execute(
            "SELECT 1 FROM delivery WHERE campaign_id=? AND state='reserved' "
            "AND julianday(scheduled_at) IS NULL LIMIT 1", (campaign_id,),
        ).fetchone()
        if malformed is not None:
            _fail("queue_conflict")
        rows = self.connection.execute(
            "SELECT d.delivery_id,r.revision_id,d.contact_id,d.mailbox_id,d.scheduled_at "
            "FROM delivery d JOIN revision r ON r.hash=d.revision_hash "
            "WHERE d.campaign_id=? AND d.state='reserved' "
            "AND julianday(d.scheduled_at)<=julianday(?) "
            "ORDER BY julianday(d.scheduled_at),d.delivery_id LIMIT ?",
            (campaign_id, current.isoformat(), MAX_DUE + 1),
        ).fetchall()
        due = []
        for row in rows:
            try:
                scheduled = datetime.fromisoformat(row[4])
            except (TypeError, ValueError):
                _fail("queue_conflict")
            if scheduled.tzinfo is None or scheduled.utcoffset() is None:
                _fail("queue_conflict")
            if scheduled.astimezone(timezone.utc) <= current:
                due.append(row)
        if len(due) > MAX_DUE:
            _fail("queue_conflict")
        counts = {"considered": 0, "queued": 0, "already_queued": 0}
        joined = _JoinedConnection(self.connection)
        requests = CampaignerRequests(joined, policy_hash, current.isoformat())
        for delivery_id, revision_id, contact_id, mailbox_id, _scheduled_at in due:
            counts["considered"] += 1
            try:
                released = release_due(ReleaseContext(joined, requests), delivery_id)
            except sqlite3.IntegrityError:
                payload = {"revision_id": revision_id, "contact_id": contact_id, "mailbox_id": mailbox_id}
                expected_id, encoded = _expected_request(policy_hash, payload)
                existing = self.connection.execute(
                    "SELECT caller,operation,payload,policy_hash FROM exec_request WHERE request_id=?",
                    (expected_id,),
                ).fetchone()
                if existing is None or tuple(existing) != (
                    "prospecting-campaigner", "gmail_draft", encoded, policy_hash,
                ):
                    _fail("queue_conflict")
                counts["already_queued"] += 1
            else:
                if released.state != "queued":
                    _fail("queue_conflict")
                counts["queued"] += 1
        counts["reserved"] = self.connection.execute(
            "SELECT count(*) FROM delivery WHERE campaign_id=? AND state='reserved'", (campaign_id,)
        ).fetchone()[0]
        return counts

    def execute(self, data: bytes) -> ControlResult:
        current = _utc(self.now())
        request = parse_request(data)
        if self.connection.in_transaction:
            _fail("caller_transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            stored = self._stored(request, current)
            if stored is not None:
                self.connection.commit()
                return stored
            parse_request(data, now=current)
            grant, failure = self._grant(request, current)
            row = self.connection.execute(
                "SELECT 1 FROM remote_control_receipt WHERE request_id=?", (request.request_id,)
            ).fetchone()
            if row is None:
                self.connection.execute(
                    "INSERT INTO remote_control_receipt VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (request.request_id, request.digest, request.control_ref,
                     None if grant is None else request.control_ref, request.operation,
                     "claimed", _stamp(current + timedelta(seconds=CLAIM_SECONDS)), None,
                     _stamp(current), None),
                )
            if failure is not None:
                result = self._result(request, "failed", failure, {})
            else:
                counts = (
                    self._status(grant[0]) if request.operation == "status"
                    else self._queue_due(grant[0], grant[1], current)
                )
                result = self._result(request, "succeeded", "status" if request.operation == "status" else "queued", counts)
            encoded = encode_result(result).decode()
            updated = self.connection.execute(
                "UPDATE remote_control_receipt SET state=?,result_json=?,finished_at=? "
                "WHERE request_id=? AND state='claimed'",
                (result.state, encoded, _stamp(current), request.request_id),
            ).rowcount
            if updated != 1:
                _fail("request_conflict")
            self.connection.commit()
            return result
        except BaseException:
            self.connection.rollback()
            raise


@dataclass(frozen=True)
class GrantView:
    control_ref: str
    campaign_id: str
    operation: str
    state: str
    expires_at: str


@dataclass(frozen=True)
class ReceiptView:
    request_id: str
    control_ref: str
    operation: str
    state: str
    code: str | None
    counts: dict[str, int]
    created_at: str
    finished_at: str | None


def read_grant(connection: sqlite3.Connection, control_ref: str) -> GrantView | None:
    if type(control_ref) is not str or CONTROL_REF.fullmatch(control_ref) is None:
        _fail("control_ref_invalid")
    row = connection.execute(
        "SELECT control_ref,campaign_id,operation,state,expires_at "
        "FROM remote_control_grant WHERE control_ref=?", (control_ref,),
    ).fetchone()
    return None if row is None else GrantView(*row)


def read_receipt(connection: sqlite3.Connection, request_id: str) -> ReceiptView | None:
    if type(request_id) is not str or REQUEST_ID.fullmatch(request_id) is None:
        _fail("request_id_invalid")
    row = connection.execute(
        "SELECT request_id,request_hash,control_ref,operation,state,result_json,created_at,finished_at "
        "FROM remote_control_receipt WHERE request_id=?", (request_id,),
    ).fetchone()
    if row is None:
        return None
    result = parse_result(row[5].encode()) if row[5] is not None else None
    if result is not None and (result.request_id, result.request_hash) != (row[0], row[1]):
        _fail("receipt_binding_invalid")
    return ReceiptView(
        row[0], row[2], row[3], row[4], None if result is None else result.code,
        {} if result is None else dict(result.counts), row[6], row[7],
    )


@dataclass(frozen=True)
class SshPullTransport:
    host: str
    user: str
    lease_id: str
    owner_id: str
    known_hosts: Path
    allowed_hosts: frozenset[str]
    remote_entrypoint: str
    launch: Callable = subprocess.Popen

    def __post_init__(self) -> None:
        if (
            type(self.host) is not str or _HOST.fullmatch(self.host) is None
            or type(self.user) is not str or _USER.fullmatch(self.user) is None
            or type(self.allowed_hosts) is not frozenset
            or not self.allowed_hosts
            or any(type(item) is not str or _HOST.fullmatch(item) is None for item in self.allowed_hosts)
            or self.host not in self.allowed_hosts
            or type(self.lease_id) is not str or LEASE_ID.fullmatch(self.lease_id) is None
            or type(self.owner_id) is not str or WORKER_ID.fullmatch(self.owner_id) is None
            or type(self.remote_entrypoint) is not str
            or _REMOTE_ENTRYPOINT.fullmatch(self.remote_entrypoint) is None
            or ".." in self.remote_entrypoint.split("/")
            or self.lease_id not in self.remote_entrypoint.split("/")
        ):
            _fail("transport_config_invalid")
        if not _trusted_known_hosts(self.known_hosts):
            _fail("known_hosts_missing")

    def _call(
        self, command: str, *, extra_args: tuple[str, ...] = (),
        data: bytes | None = None,
    ) -> bytes:
        if data is not None and len(data) > MAX_TRANSPORT_BYTES:
            _fail("transport_failed")
        argv = [
            "ssh", "-o", "StrictHostKeyChecking=yes", "-o",
            f"UserKnownHostsFile={self.known_hosts}", "--", f"{self.user}@{self.host}",
            "python3", "-B", self.remote_entrypoint, command,
            "--lease", self.lease_id, "--owner", self.owner_id,
            *extra_args,
        ]
        try:
            process = self.launch(
                argv, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False,
            )
        except OSError:
            _fail("transport_failed")
        assert process.stdout is not None and process.stderr is not None
        chunks: list[bytes] = []
        total = 0
        overflow = False
        stream_failed = False
        lock = threading.Lock()

        def read(stream) -> None:
            nonlocal total, overflow, stream_failed
            try:
                while True:
                    chunk = stream.read(1024)
                    if not chunk:
                        return
                    with lock:
                        total += len(chunk)
                        if total > MAX_TRANSPORT_BYTES:
                            overflow = True
                            process.kill()
                            return
                        if stream is process.stdout:
                            chunks.append(chunk)
            except (OSError, ValueError):
                stream_failed = True

        readers = [threading.Thread(target=read, args=(stream,), daemon=True) for stream in (process.stdout, process.stderr)]
        for reader in readers:
            reader.start()
        writer = None
        write_failed = False
        if data is not None:
            assert process.stdin is not None

            def write() -> None:
                nonlocal write_failed
                try:
                    process.stdin.write(data)
                    process.stdin.close()
                except (BrokenPipeError, OSError, ValueError):
                    write_failed = True

            writer = threading.Thread(target=write, daemon=True)
            writer.start()
        try:
            return_code = process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
            _fail("transport_failed")
        finally:
            for reader in readers:
                reader.join(timeout=5)
            if writer is not None:
                writer.join(timeout=5)
            for stream in (process.stdout, process.stderr):
                try:
                    stream.close()
                except OSError:
                    stream_failed = True
        threads_alive = any(reader.is_alive() for reader in readers) or (
            writer is not None and writer.is_alive()
        )
        if threads_alive:
            process.kill()
            if process.stdin is not None:
                try:
                    process.stdin.close()
                except OSError:
                    pass
        if (
            return_code != 0 or overflow or stream_failed or write_failed
            or threads_alive
        ):
            _fail("transport_failed")
        return b"".join(chunks)

    def claim_next(
        self, *, request_id: str | None = None, control_ref: str | None = None,
        operation: str | None = None,
    ) -> bytes | None:
        selector = (request_id, control_ref, operation)
        if any(item is not None for item in selector) and (
            any(item is None for item in selector)
            or type(request_id) is not str
            or REQUEST_ID.fullmatch(request_id) is None
            or type(control_ref) is not str
            or CONTROL_REF.fullmatch(control_ref) is None
            or type(operation) is not str
            or operation not in OPERATIONS
        ):
            _fail("claim_selector_invalid")
        extra_args = () if request_id is None else (
            "--request-id", request_id,
            "--control-ref", control_ref,
            "--operation", operation,
        )
        data = self._call("claim-next", extra_args=extra_args)
        return None if data == b'{"state":"empty"}' else data

    def complete(self, result: ControlResult) -> None:
        response = self._call("complete", data=encode_result(result))
        if response.strip() != b'{"state":"complete"}':
            _fail("transport_failed")


def run_once(
    control: DesktopControl, transport: SshPullTransport, *,
    request_id: str | None = None, control_ref: str | None = None,
    operation: str | None = None,
) -> bool:
    selector = (request_id, control_ref, operation)
    if any(item is not None for item in selector) and any(
        item is None for item in selector
    ):
        _fail("claim_selector_invalid")
    if any(item is not None for item in selector):
        data = transport.claim_next(
            request_id=request_id, control_ref=control_ref, operation=operation,
        )
    else:
        data = transport.claim_next()
    if data is None:
        return False
    request = parse_request(data)
    if request_id is not None and (
        request.request_id, request.control_ref, request.operation
    ) != selector:
        _fail("claim_selector_mismatch")
    result = control.execute(data)
    transport.complete(result)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--lease", required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--known-hosts", required=True, type=Path)
    parser.add_argument("--remote-entrypoint", required=True)
    args = parser.parse_args(argv)
    configured_host = os.environ.get("KB_PROSPECTING_CONTROL_HOST")
    configured_user = os.environ.get("KB_PROSPECTING_CONTROL_USER")
    if configured_host != args.host or configured_user != args.user:
        _fail("transport_config_invalid")
    connection = store.open_store()
    transport = SshPullTransport(
        args.host, args.user, args.lease, args.owner, args.known_hosts,
        frozenset({configured_host}), args.remote_entrypoint,
    )
    run_once(DesktopControl(connection, args.owner), transport)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        raise SystemExit(2)

"""Ephemeral SQLite spool for PII-free, desktop-pulled control requests.

The runtime directory must be local and owned by the VM job. Link checks are
fail-closed; callers must still prevent hostile filesystem races outside this
owned root.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys

try:
    from scripts.prospecting.control_protocol import (
        CONTROL_REF, LEASE_ID, OPERATIONS, REQUEST_ID, WORKER_ID, encode_request, encode_result,
        parse_request, parse_result,
    )
except ModuleNotFoundError:  # Direct execution from a reviewed ephemeral source bundle.
    from control_protocol import (
        CONTROL_REF, LEASE_ID, OPERATIONS, REQUEST_ID, WORKER_ID, encode_request, encode_result,
        parse_request, parse_result,
    )

MAX_ITEMS = 64
MAX_LEASE = timedelta(hours=24)
MAX_SPOOL_FILE_BYTES = 4 * 1024 * 1024
_REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
_FILES = frozenset({"spool.sqlite", "spool.sqlite-wal", "spool.sqlite-shm"})


class SpoolError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> None:
    raise SpoolError(code)


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        _fail("timestamp_invalid")
    return value.astimezone(timezone.utc).replace(microsecond=0)


def _utc_text(value: datetime) -> str:
    return _aware(value).isoformat().replace("+00:00", "Z")


def _utc(value: object) -> datetime:
    if type(value) is not str or not value.endswith("Z"):
        _fail("spool_metadata_invalid")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        _fail("spool_metadata_invalid")
    if parsed.tzinfo != timezone.utc or parsed.microsecond or _utc_text(parsed) != value:
        _fail("spool_metadata_invalid")
    return parsed


def _unsafe(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & _REPARSE)


def _check_tree(path: Path, *, missing_leaf: bool = False) -> bool:
    absolute = Path(os.path.abspath(path))
    current = Path(absolute.anchor)
    parts = absolute.parts[1:]
    for index, component in enumerate(parts):
        current /= component
        try:
            info = current.lstat()
        except FileNotFoundError:
            if missing_leaf and index == len(parts) - 1:
                return False
            _fail("spool_root_invalid")
        if _unsafe(info) or not stat.S_ISDIR(info.st_mode):
            _fail("spool_root_unsafe")
    return True


def _regular(path: Path, *, missing_ok: bool = False) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        if missing_ok:
            return False
        _fail("spool_file_missing")
    if (
        _unsafe(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
        or info.st_size > MAX_SPOOL_FILE_BYTES
    ):
        _fail("spool_file_unsafe")
    return True


def _read_regular(path: Path, limit: int = 4096) -> bytes:
    _regular(path)
    try:
        with path.open("rb") as source:
            opened = os.fstat(source.fileno())
            data = source.read(limit + 1)
        if _unsafe(opened) or not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or len(data) > limit:
            _fail("spool_file_unsafe")
        return data
    except OSError:
        _fail("spool_file_access")


class ControlSpool:
    def __init__(self, base: Path, lease_id: str):
        if type(lease_id) is not str or LEASE_ID.fullmatch(lease_id) is None:
            _fail("lease_id_invalid")
        self.base = Path(os.path.abspath(base))
        self.lease_id = lease_id
        self.root = self.base / lease_id
        self.database = self.root / "spool.sqlite"

    def _validate_root(self, *, database_missing_ok: bool = False) -> None:
        _check_tree(self.root)
        try:
            entries = list(self.root.iterdir())
        except OSError:
            _fail("spool_root_invalid")
        for entry in entries:
            if entry.name not in _FILES:
                _fail("spool_entry_unexpected")
            _regular(entry)
        if not database_missing_ok and not _regular(self.database, missing_ok=True):
            _fail("spool_file_missing")

    def _connect(self) -> sqlite3.Connection:
        self._validate_root()
        connection = sqlite3.connect(self.database, timeout=5.0, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA trusted_schema=OFF")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    def _lease(self, connection: sqlite3.Connection) -> datetime:
        rows = connection.execute("SELECT lease_id,expires_at,state FROM lease").fetchall()
        if (
            len(rows) != 1 or rows[0]["lease_id"] != self.lease_id
            or rows[0]["state"] != "active"
        ):
            _fail("spool_metadata_invalid")
        return _utc(rows[0]["expires_at"])

    def initialize(self, expires_at: datetime, *, now: datetime) -> None:
        current, expiry = _aware(now), _aware(expires_at)
        if expiry <= current or expiry - current > MAX_LEASE:
            _fail("lease_lifetime_invalid")
        if not _check_tree(self.base, missing_leaf=True):
            self.base.mkdir(mode=0o700)
        _check_tree(self.base)
        try:
            self.root.mkdir(mode=0o700)
        except FileExistsError:
            pass
        self._validate_root(database_missing_ok=True)
        if self.database.exists():
            connection = self._connect()
            try:
                rows = connection.execute("SELECT lease_id,expires_at,state FROM lease").fetchall()
                if len(rows) != 1 or tuple(rows[0]) != (self.lease_id, _utc_text(expiry), "active"):
                    _fail("lease_conflict")
            except sqlite3.DatabaseError:
                _fail("spool_metadata_invalid")
            finally:
                connection.close()
            return
        connection = sqlite3.connect(self.database, timeout=5.0, isolation_level=None)
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(
                "BEGIN IMMEDIATE;"
                "CREATE TABLE lease(lease_id TEXT PRIMARY KEY,expires_at TEXT NOT NULL,"
                "state TEXT NOT NULL CHECK(state IN ('active','cleaning')));"
                "CREATE TABLE request(request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,"
                "request_json TEXT NOT NULL,not_before TEXT NOT NULL,expires_at TEXT NOT NULL,"
                "state TEXT NOT NULL CHECK(state IN ('pending','claimed','complete')),"
                "owner_id TEXT,claim_until TEXT,result_json TEXT);"
            )
            connection.execute("INSERT INTO lease VALUES(?,?,'active')", (self.lease_id, _utc_text(expiry)))
            connection.commit()
        except BaseException:
            connection.rollback()
            connection.close()
            self.database.unlink(missing_ok=True)
            raise
        finally:
            connection.close()
        os.chmod(self.database, 0o600)
        self._validate_root()

    def enqueue(self, data: bytes) -> str:
        request = parse_request(data)
        canonical = encode_request(request).decode()
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if _utc(request.expires_at) > self._lease(connection):
                _fail("request_outlives_lease")
            row = connection.execute(
                "SELECT request_hash,request_json FROM request WHERE request_id=?", (request.request_id,),
            ).fetchone()
            if row is not None:
                if tuple(row) != (request.digest, canonical):
                    _fail("request_conflict")
                connection.commit()
                return request.request_id
            count = connection.execute("SELECT count(*) FROM request").fetchone()[0]
            if count >= MAX_ITEMS:
                _fail("spool_capacity")
            connection.execute(
                "INSERT INTO request VALUES(?,?,?,?,?,'pending',NULL,NULL,NULL)",
                (request.request_id, request.digest, canonical, request.not_before, request.expires_at),
            )
            connection.commit()
            return request.request_id
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()
            self._validate_root()

    def claim_next(
        self,
        owner_id: str,
        *,
        now: datetime,
        lease_seconds: int = 300,
        request_id: str | None = None,
        control_ref: str | None = None,
        operation: str | None = None,
    ) -> bytes | None:
        if type(owner_id) is not str or WORKER_ID.fullmatch(owner_id) is None:
            _fail("worker_id_invalid")
        if type(lease_seconds) is not int or not 1 <= lease_seconds <= 300:
            _fail("claim_lifetime_invalid")
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
        current = _aware(now)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if current >= self._lease(connection):
                _fail("lease_expired")
            if request_id is None:
                connection.execute(
                    "UPDATE request SET state='pending',owner_id=NULL,claim_until=NULL "
                    "WHERE state='claimed' AND claim_until<=?", (_utc_text(current),),
                )
                row = connection.execute(
                    "SELECT request_id,request_json FROM request "
                    "WHERE state='pending' AND not_before<=? "
                    "ORDER BY (expires_at<=?) ASC,request_id LIMIT 1",
                    (_utc_text(current), _utc_text(current)),
                ).fetchone()
            else:
                selected = connection.execute(
                    "SELECT request_id,request_json FROM request WHERE request_id=?",
                    (request_id,),
                ).fetchone()
                if selected is None:
                    connection.commit()
                    return None
                parsed = parse_request(selected["request_json"].encode())
                if (parsed.control_ref, parsed.operation) != (control_ref, operation):
                    _fail("claim_selector_mismatch")
                connection.execute(
                    "UPDATE request SET state='pending',owner_id=NULL,claim_until=NULL "
                    "WHERE request_id=? AND state='claimed' AND claim_until<=?",
                    (request_id, _utc_text(current)),
                )
                row = connection.execute(
                    "SELECT request_id,request_json FROM request "
                    "WHERE request_id=? AND state='pending' AND not_before<=?",
                    (request_id, _utc_text(current)),
                ).fetchone()
            if row is None:
                connection.commit()
                return None
            updated = connection.execute(
                "UPDATE request SET state='claimed',owner_id=?,claim_until=? "
                "WHERE request_id=? AND state='pending'",
                (owner_id, _utc_text(current + timedelta(seconds=lease_seconds)), row["request_id"]),
            ).rowcount
            if updated != 1:
                _fail("claim_conflict")
            connection.commit()
            return row["request_json"].encode()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()
            self._validate_root()

    def complete(self, owner_id: str, data: bytes, *, now: datetime) -> None:
        if type(owner_id) is not str or WORKER_ID.fullmatch(owner_id) is None:
            _fail("worker_id_invalid")
        current = _aware(now)
        result = parse_result(data)
        canonical = encode_result(result).decode()
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if current >= self._lease(connection):
                _fail("lease_expired")
            row = connection.execute(
                "SELECT request_hash,state,owner_id,claim_until,result_json "
                "FROM request WHERE request_id=?",
                (result.request_id,),
            ).fetchone()
            if row is None or row["request_hash"] != result.request_hash:
                _fail("result_binding_mismatch")
            if row["state"] == "complete":
                if row["result_json"] != canonical:
                    _fail("result_conflict")
                connection.commit()
                return
            if row["state"] != "claimed" or row["owner_id"] != owner_id:
                _fail("claim_owner_mismatch")
            if row["claim_until"] is None or _utc(row["claim_until"]) <= current:
                _fail("claim_expired")
            connection.execute(
                "UPDATE request SET state='complete',result_json=?,claim_until=NULL WHERE request_id=?",
                (canonical, result.request_id),
            )
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()
            self._validate_root()

    def result(self, request_id: str) -> bytes | None:
        if type(request_id) is not str or REQUEST_ID.fullmatch(request_id) is None:
            _fail("request_id_invalid")
        connection = self._connect()
        try:
            self._lease(connection)
            row = connection.execute(
                "SELECT result_json FROM request WHERE request_id=? AND state='complete'", (request_id,),
            ).fetchone()
            return None if row is None else row[0].encode()
        finally:
            connection.close()
            self._validate_root()

    def cleanup_expired(self, *, now: datetime) -> int:
        current = _aware(now)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute("SELECT lease_id,expires_at,state FROM lease").fetchall()
            if len(rows) != 1 or rows[0]["lease_id"] != self.lease_id:
                _fail("spool_metadata_invalid")
            row = rows[0]
            if current < _utc(row["expires_at"]):
                connection.commit()
                return 0
            if row["state"] == "active":
                connection.execute("UPDATE lease SET state='cleaning'")
            elif row["state"] != "cleaning":
                _fail("spool_metadata_invalid")
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()
        self._validate_root()
        removed = 0
        for name in _FILES:
            path = self.root / name
            if path.exists():
                _regular(path)
                path.unlink()
                removed += 1
        self.root.rmdir()
        return removed


def _default_base(lease_id: str) -> Path:
    """Derive storage inside the reviewed, lease-named ephemeral source bundle."""
    bundle = Path(os.path.abspath(__file__)).parent
    if lease_id not in bundle.parts:
        _fail("runtime_root_missing")
    return bundle / "runtime"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("init", "enqueue", "claim-next", "complete", "result", "cleanup"))
    parser.add_argument("--lease", required=True)
    parser.add_argument("--expires-at")
    parser.add_argument("--request-file", type=Path)
    parser.add_argument("--request-id")
    parser.add_argument("--control-ref")
    parser.add_argument("--operation")
    parser.add_argument("--owner")
    args = parser.parse_args(argv)
    spool = ControlSpool(_default_base(args.lease), args.lease)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    if args.command == "init":
        if args.expires_at is None:
            _fail("expires_at_required")
        spool.initialize(_utc(args.expires_at), now=now)
        print('{"state":"initialized"}')
    elif args.command == "enqueue":
        if args.request_file is None:
            _fail("request_file_required")
        print(json.dumps({"request_id": spool.enqueue(_read_regular(args.request_file))}, separators=(",", ":")))
    elif args.command == "claim-next":
        data = spool.claim_next(
            args.owner, now=now, request_id=args.request_id,
            control_ref=args.control_ref, operation=args.operation,
        )
        sys.stdout.buffer.write(data or b'{"state":"empty"}')
    elif args.command == "complete":
        spool.complete(args.owner, sys.stdin.buffer.read(4097), now=now)
        print('{"state":"complete"}')
    elif args.command == "result":
        data = spool.result(args.request_id)
        sys.stdout.buffer.write(data or b'{"state":"missing"}')
    else:
        print(json.dumps({"removed": spool.cleanup_expired(now=now)}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (SpoolError, ValueError, sqlite3.DatabaseError):
        print('{"state":"failed","code":"spool_failed"}')
        raise SystemExit(2)

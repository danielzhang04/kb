"""Private, durable capture acquisition seam for one saved P15 run.

This service stores, validates and leases operator capture work.  It supports
exactly two packet kinds: listing the visible results of one search, and opening
one HTTPS page to capture its visible text.  A single supported Chrome client
later executes packets; this service never browses, never creates a browser,
never runs scripts or shells, and never downloads credentials.

A capture is evidence only.  It never qualifies, approves, ranks, drafts or
sends anything, and it confers no downstream authority.

Boundary notes:

* ``ALLOWLIST_VERSION`` names the operator capture *format* recorded on each
  snapshot row.  It is not a host allowlist and confers no host authority.  The
  single supported browser broker remains responsible for enforcing that every
  packet is executed as a real, visible tab operation.
* Physical snapshot files are named with a fresh random identifier per submit
  attempt, so an interrupted submit can never wedge a later retry of the same
  still-open lease.  A crash between copy and commit therefore leaves an orphan
  file: this service deletes only files it created in the current call, never
  unknown orphans, and callers must not assume zero orphans after a crash.
  Orphan reclamation is deferred to a later bounded store-maintenance task.
* URL validation is purely syntactic and performs no DNS or network lookup.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import ipaddress
import json
from pathlib import Path
import re
import secrets
import sqlite3
from types import MappingProxyType
from typing import Callable, Mapping
from urllib.parse import SplitResult, urlsplit, urlunsplit
import uuid

from scripts.prospecting.pipeline_service import PipelineError, PipelineService
from scripts.prospecting.source_capture import (
    SourceCaptureError,
    cleanup_owned,
    copy_owned,
    read_capture,
    read_owned,
)


MAX_TASKS_PER_SESSION = 32
MAX_LEASE_SECONDS = 300
MIN_LEASE_SECONDS = 5
MAX_ATTEMPTS_PER_TASK = 3
MAX_CAPTURE_BYTES = 2 * 1024 * 1024
MAX_QUERY_BYTES = 512
MAX_URL_BYTES = 2048
CAPTURE_RETENTION_DAYS = 30
SEARCH_KIND = "search_visible_results"
OPEN_KIND = "open_https_capture_visible_text"
CAPTURE_KINDS = frozenset({SEARCH_KIND, OPEN_KIND})
CAPTURE_ERRORS = frozenset({
    "tab_closed", "navigation_failed", "challenge", "no_result", "relay_unavailable",
})
ACQUISITION_VERSION = "capture-acquisition-v1"
SNAPSHOT_NAMESPACE = "capture-acquisition"
ALLOWLIST_VERSION = "operator-public-capture-v1"
_ACQUISITION_MANIFEST = {
    "version": ACQUISITION_VERSION,
    "task_cap": MAX_TASKS_PER_SESSION,
    "max_lease_seconds": MAX_LEASE_SECONDS,
    "max_attempts": MAX_ATTEMPTS_PER_TASK,
    "capture_bytes": MAX_CAPTURE_BYTES,
    "kinds": sorted(CAPTURE_KINDS),
    "errors": sorted(CAPTURE_ERRORS),
    "authority": "stores-validates-leases-only",
}
ACQUISITION_HASH = sha256(json.dumps(
    _ACQUISITION_MANIFEST, sort_keys=True, separators=(",", ":"),
).encode()).hexdigest()
_RUN_ID = re.compile(r"prun_[0-9a-f]{32}\Z")
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_DNS_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")
_TLD_LABEL = re.compile(r"[a-z]{2,63}\Z")
_SQLITE_BUSY_CODES = frozenset({5, 6})  # SQLITE_BUSY, SQLITE_LOCKED


class CaptureError(ValueError):
    """Stable-code refusal at the private capture acquisition boundary."""


@dataclass(frozen=True, repr=False)
class CaptureSessionRequest:
    request_id: str
    run_id: str
    expected_intake_hash: str
    acquisition_skill_hash: str
    task_cap: int = MAX_TASKS_PER_SESSION


@dataclass(frozen=True, repr=False)
class CaptureTaskRequest:
    request_id: str
    session_id: str
    task_kind: str
    query: str | None = None
    url: str | None = None


@dataclass(frozen=True, repr=False)
class CaptureClaimRequest:
    session_id: str
    lease_seconds: int = MAX_LEASE_SECONDS


@dataclass(frozen=True, repr=False)
class CaptureSubmitRequest:
    task_id: str
    lease_token: str
    body_ref: str
    source_url: str
    retrieved_at: str


@dataclass(frozen=True, repr=False)
class CaptureFinishRequest:
    task_id: str
    lease_token: str
    error_code: str


@dataclass(frozen=True)
class CaptureSessionResult:
    session_id: str
    session_hash: str
    run_id: str
    intake_hash: str
    state: str
    counts: Mapping[str, int]
    replayed: bool = False


@dataclass(frozen=True)
class CaptureTaskResult:
    task_id: str
    session_id: str
    ordinal: int
    task_kind: str
    state: str
    replayed: bool = False


@dataclass(frozen=True, repr=False)
class CaptureLease:
    """Carries the private packet to the single supported local client."""

    task_id: str
    attempt_id: str
    attempt_no: int
    lease_token: str
    lease_epoch: int
    task_kind: str
    expires_at: str
    packet: Mapping[str, str] = field(repr=False, default_factory=dict)


@dataclass(frozen=True)
class CaptureReceipt:
    receipt_id: str
    task_id: str
    attempt_id: str
    snapshot_id: str
    content_sha256: str
    retrieved_at: str
    byte_count: int
    state: str


@dataclass(frozen=True)
class CaptureTaskStatus:
    task_id: str
    ordinal: int
    task_kind: str
    state: str
    attempt_count: int
    last_error_code: str | None


@dataclass(frozen=True)
class CaptureProgress:
    session_id: str
    session_hash: str
    run_id: str
    intake_hash: str
    state: str
    counts: Mapping[str, int]
    tasks: tuple[CaptureTaskStatus, ...]


def _canonical(value: object) -> str:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError, UnicodeError):
        raise CaptureError("invalid_request") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value).encode("utf-8")).hexdigest()


def _store_error(error: sqlite3.Error) -> CaptureError:
    """Map one store failure onto a fixed code, never leaking driver text."""
    code = getattr(error, "sqlite_errorcode", None)
    if type(code) is int and code & 0xFF in _SQLITE_BUSY_CODES:
        return CaptureError("store_busy")
    return CaptureError("store_state_invalid")


def _text(value: object, code: str, *, maximum: int, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    if (
        type(value) is not str or not value.strip() or value != value.strip()
        or _CONTROL.search(value)
    ):
        raise CaptureError(code)
    try:
        if len(value.encode("utf-8")) > maximum:
            raise CaptureError(code)
    except UnicodeError:
        raise CaptureError(code) from None
    return value


def _uuid(value: object) -> str:
    if type(value) is not str:
        raise CaptureError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError):
        raise CaptureError("invalid_request_id") from None
    if str(parsed) != value:
        raise CaptureError("invalid_request_id")
    return value


def _sha(value: object, code: str) -> str:
    if type(value) is not str or _SHA.fullmatch(value) is None:
        raise CaptureError(code)
    return value


def _timestamp(value: object, code: str) -> datetime:
    if type(value) is not str:
        raise CaptureError(code)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.astimezone(timezone.utc)
    except ValueError:
        raise CaptureError(code) from None


def _bounded_int(value: object, code: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise CaptureError(code)
    return value


def _url(value: object, code: str) -> str:
    raw = _text(value, code, maximum=MAX_URL_BYTES)
    assert raw is not None
    try:
        parsed = urlsplit(raw)
        hostname = (parsed.hostname or "").casefold().rstrip(".")
        try:
            hostname.encode("ascii")
        except UnicodeError:
            raise ValueError
        labels = hostname.split(".")
        if (
            parsed.scheme.casefold() != "https" or not hostname or "." not in hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.port not in (None, 443) or len(hostname) > 253
            or any(_DNS_LABEL.fullmatch(label) is None for label in labels)
            or _TLD_LABEL.fullmatch(labels[-1]) is None
            or "\\" in raw
        ):
            raise ValueError
        try:
            ipaddress.ip_address(hostname)
        except ValueError:
            pass
        else:
            raise ValueError
        return urlunsplit(SplitResult("https", hostname, parsed.path or "/", parsed.query, ""))
    except (TypeError, ValueError, UnicodeError):
        raise CaptureError(code) from None


def _json_object(value: object, code: str) -> dict[str, object]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        raise CaptureError(code) from None
    if not isinstance(decoded, dict):
        raise CaptureError(code)
    return decoded


def _json_array(value: object, code: str) -> tuple[str, ...]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        raise CaptureError(code) from None
    if not isinstance(decoded, list) or any(type(item) is not str for item in decoded):
        raise CaptureError(code)
    return tuple(decoded)


def _id(prefix: str, request_id: str, suffix: str) -> str:
    return prefix + uuid.uuid5(
        uuid.NAMESPACE_URL, f"kb:prospecting:capture:{request_id}:{suffix}",
    ).hex


def _validated_packet(
    kind: object, packet_json: object, packet_hash: object,
) -> dict[str, object]:
    """Re-validate one stored packet's exact typed fields, kind, url and digest."""
    packet = _json_object(packet_json, "store_state_invalid")
    if (
        type(kind) is not str or kind not in CAPTURE_KINDS
        or set(packet) != {"kind", "query", "url"} or packet["kind"] != kind
    ):
        raise CaptureError("store_state_invalid")
    if kind == SEARCH_KIND:
        if packet["url"] is not None:
            raise CaptureError("store_state_invalid")
        _text(packet["query"], "store_state_invalid", maximum=MAX_QUERY_BYTES)
    else:
        if packet["query"] is not None:
            raise CaptureError("store_state_invalid")
        if _url(packet["url"], "store_state_invalid") != packet["url"]:
            raise CaptureError("store_state_invalid")
    if _digest(packet) != _sha(packet_hash, "store_state_invalid"):
        raise CaptureError("store_state_invalid")
    return packet


def _lease_token() -> str:
    """Unguessable lease secret, never derived from ids, epochs or timestamps."""
    return "lse_" + secrets.token_hex(32)


def _snapshot_root(connection: sqlite3.Connection) -> Path:
    database = next(
        (str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"),
        "",
    )
    if not database:
        raise CaptureError("snapshot_store_required")
    return Path(database).parent / "snapshots"


def _read_capture(root: Path, body_ref: object) -> tuple[str, bytes]:
    try:
        captured = read_capture(root, body_ref, maximum=MAX_CAPTURE_BYTES)
        return captured.body_ref, captured.contents
    except SourceCaptureError as error:
        code = str(error)
        raise CaptureError(
            "invalid_body_ref" if code == "invalid_ref" else
            "source_too_large" if code == "too_large" else "source_changed"
        ) from None


def _session_hash(row: Mapping[str, object]) -> str:
    return _digest({
        "session_id": str(row["session_id"]), "run_id": str(row["run_id"]),
        "intake_id": str(row["intake_id"]), "intake_hash": str(row["intake_hash"]),
        "campaign_policy_hash": str(row["campaign_policy_hash"]),
        "as_of_date": str(row["as_of_date"]),
        "acquisition_skill_hash": str(row["acquisition_skill_hash"]),
        "acquisition_hash": str(row["acquisition_hash"]),
        "task_cap": int(row["task_cap"]),
        "max_lease_seconds": int(row["max_lease_seconds"]),
        "max_attempts": int(row["max_attempts"]),
    })


def _prepare_session(request: object) -> tuple[CaptureSessionRequest, str]:
    if not isinstance(request, CaptureSessionRequest):
        raise CaptureError("invalid_request")
    request_id = _uuid(request.request_id)
    if type(request.run_id) is not str or _RUN_ID.fullmatch(request.run_id) is None:
        raise CaptureError("invalid_run_id")
    intake_hash = _sha(request.expected_intake_hash, "invalid_intake_hash")
    skill_hash = _sha(request.acquisition_skill_hash, "invalid_skill_hash")
    cap = _bounded_int(request.task_cap, "invalid_task_cap", 1, MAX_TASKS_PER_SESSION)
    normalized = CaptureSessionRequest(request_id, request.run_id, intake_hash, skill_hash, cap)
    request_hash = _digest({
        "operation": "start_capture_session", "request_id": request_id,
        "run_id": request.run_id, "expected_intake_hash": intake_hash,
        "acquisition_skill_hash": skill_hash, "task_cap": cap,
        "acquisition_hash": ACQUISITION_HASH,
    })
    return normalized, request_hash


def _prepare_task(request: object) -> tuple[str, str, str, dict[str, object], str]:
    if not isinstance(request, CaptureTaskRequest):
        raise CaptureError("invalid_request")
    request_id = _uuid(request.request_id)
    session_id = _text(request.session_id, "invalid_session", maximum=80)
    kind = request.task_kind
    if type(kind) is not str or kind not in CAPTURE_KINDS:
        raise CaptureError("invalid_task_kind")
    if kind == SEARCH_KIND:
        if request.url is not None:
            raise CaptureError("invalid_packet")
        query = _text(request.query, "invalid_packet", maximum=MAX_QUERY_BYTES)
        packet: dict[str, object] = {"kind": kind, "query": query, "url": None}
    else:
        if request.query is not None:
            raise CaptureError("invalid_packet")
        packet = {"kind": kind, "query": None, "url": _url(request.url, "invalid_url")}
    request_hash = _digest({
        "operation": "enqueue_capture_task", "request_id": request_id,
        "session_id": session_id, "packet": packet,
        "acquisition_hash": ACQUISITION_HASH,
    })
    assert session_id is not None
    return request_id, session_id, kind, packet, request_hash


class CaptureService:
    """Durable, lease-fenced acquisition of operator captures for one P15 run."""

    def __init__(
        self, connection: sqlite3.Connection, *, now: Callable[[], str] | None = None,
    ) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.now = now or (
            lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        )

    def _context(self, run_id: str, expected_hash: str | None = None) -> sqlite3.Row:
        try:
            validated = PipelineService(self.connection, now=self.now).get_projection(run_id)
        except PipelineError as error:
            raise CaptureError(
                "run_missing" if str(error) == "run_missing" else "store_state_invalid"
            ) from None
        row = self.connection.execute(
            """SELECT run.run_id,run.state,run.pending_fields_json,
                      intake.intake_id,intake.campaign_id,intake.intake_hash,
                      intake.campaign_policy_hash,intake.as_of_date,
                      campaign.policy_hash AS current_policy_hash
                 FROM prospecting_pipeline_run AS run
                 JOIN prospecting_pipeline_intake AS intake ON intake.intake_id=run.intake_id
                 JOIN campaign ON campaign.campaign_id=run.campaign_id
                WHERE run.run_id=?""", (run_id,),
        ).fetchone()
        if row is None:
            raise CaptureError("run_missing")
        if (
            validated.intake_id != str(row["intake_id"])
            or validated.intake_hash != str(row["intake_hash"])
            or validated.campaign_policy_hash != str(row["campaign_policy_hash"])
        ):
            raise CaptureError("store_state_invalid")
        latest = self.connection.execute(
            """SELECT intake_id FROM prospecting_pipeline_intake
                WHERE campaign_id=? ORDER BY intake_revision DESC LIMIT 1""",
            (row["campaign_id"],),
        ).fetchone()
        if latest is None or str(latest[0]) != str(row["intake_id"]):
            raise CaptureError("intake_stale")
        if expected_hash is not None and str(row["intake_hash"]) != expected_hash:
            raise CaptureError("intake_stale")
        if str(row["state"]) == "input_pending" or _json_array(
            row["pending_fields_json"], "store_state_invalid",
        ):
            raise CaptureError("input_pending")
        if str(row["campaign_policy_hash"]) != str(row["current_policy_hash"]):
            raise CaptureError("pipeline_context_stale")
        return row

    def _session(self, session_id: object) -> sqlite3.Row:
        identifier = _text(session_id, "invalid_session", maximum=80)
        row = self.connection.execute(
            "SELECT * FROM prospecting_capture_session WHERE session_id=?", (identifier,),
        ).fetchone()
        if row is None:
            raise CaptureError("session_missing")
        context = self._context(str(row["run_id"]), str(row["intake_hash"]))
        if (
            str(row["intake_id"]) != str(context["intake_id"])
            or str(row["campaign_policy_hash"]) != str(context["campaign_policy_hash"])
            or str(row["as_of_date"]) != str(context["as_of_date"])
            or str(row["acquisition_hash"]) != ACQUISITION_HASH
            or str(row["acquisition_version"]) != ACQUISITION_VERSION
            or _session_hash(row) != str(row["session_hash"])
        ):
            raise CaptureError("pipeline_context_stale")
        return row

    def _counts(self, session_id: str) -> Mapping[str, int]:
        rows = self.connection.execute(
            "SELECT state,count(*) FROM prospecting_capture_task WHERE session_id=? GROUP BY state",
            (session_id,),
        ).fetchall()
        tally = {str(row[0]): int(row[1]) for row in rows}
        return MappingProxyType({
            "tasks": sum(tally.values()),
            "queued": tally.get("queued", 0),
            "leased": tally.get("leased", 0),
            "captured": tally.get("captured", 0),
            "failed": tally.get("failed", 0),
        })

    def _session_result(self, row: sqlite3.Row, replayed: bool) -> CaptureSessionResult:
        return CaptureSessionResult(
            str(row["session_id"]), str(row["session_hash"]), str(row["run_id"]),
            str(row["intake_hash"]), str(row["state"]),
            self._counts(str(row["session_id"])), replayed,
        )

    def _begin(self) -> None:
        """Open the service transaction, never disturbing a caller-owned one."""
        try:
            if self.connection.in_transaction:
                raise CaptureError("transaction_active")
            self.connection.execute("BEGIN IMMEDIATE")
        except sqlite3.Error as error:
            raise _store_error(error) from None

    def _rollback(self) -> None:
        try:
            self.connection.rollback()
        except sqlite3.Error as error:
            raise _store_error(error) from None

    @staticmethod
    def _rethrow(error: BaseException) -> None:
        if isinstance(error, CaptureError):
            raise error
        if isinstance(error, SourceCaptureError):
            raise CaptureError("source_changed") from None
        if isinstance(error, sqlite3.Error):
            raise _store_error(error) from None
        if isinstance(error, OSError):
            raise CaptureError("snapshot_store_unavailable") from None

    def start_session(self, request: CaptureSessionRequest) -> CaptureSessionResult:
        normalized, request_hash = _prepare_session(request)
        self._begin()
        try:
            context = self._context(normalized.run_id, normalized.expected_intake_hash)
            replay = self.connection.execute(
                "SELECT session_id,request_hash FROM prospecting_capture_session WHERE request_id=?",
                (normalized.request_id,),
            ).fetchone()
            if replay is not None:
                if str(replay["request_hash"]) != request_hash:
                    raise CaptureError("request_conflict")
                row = self._session(str(replay["session_id"]))
                result = self._session_result(row, True)
                self.connection.commit()
                return result
            session_id = _id("pcs_", normalized.request_id, "session")
            stamp = _timestamp(self.now(), "store_state_invalid").isoformat()
            values = {
                "session_id": session_id, "run_id": normalized.run_id,
                "intake_id": str(context["intake_id"]),
                "intake_hash": str(context["intake_hash"]),
                "campaign_policy_hash": str(context["campaign_policy_hash"]),
                "as_of_date": str(context["as_of_date"]),
                "acquisition_skill_hash": normalized.acquisition_skill_hash,
                "acquisition_hash": ACQUISITION_HASH,
                "task_cap": normalized.task_cap,
                "max_lease_seconds": MAX_LEASE_SECONDS,
                "max_attempts": MAX_ATTEMPTS_PER_TASK,
            }
            self.connection.execute(
                """INSERT INTO prospecting_capture_session(
                       session_id,request_id,request_hash,session_hash,run_id,intake_id,
                       intake_hash,campaign_policy_hash,as_of_date,acquisition_skill_hash,
                       acquisition_version,acquisition_hash,task_cap,max_lease_seconds,
                       max_attempts,state,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'accepting_capture_tasks',?)""",
                (session_id, normalized.request_id, request_hash, _session_hash(values),
                 normalized.run_id, values["intake_id"], values["intake_hash"],
                 values["campaign_policy_hash"], values["as_of_date"],
                 normalized.acquisition_skill_hash, ACQUISITION_VERSION, ACQUISITION_HASH,
                 normalized.task_cap, MAX_LEASE_SECONDS, MAX_ATTEMPTS_PER_TASK, stamp),
            )
            row = self._session(session_id)
            result = self._session_result(row, False)
            self.connection.commit()
            return result
        except BaseException as error:
            self._rollback()
            self._rethrow(error)
            raise

    def enqueue_task(self, request: CaptureTaskRequest) -> CaptureTaskResult:
        request_id, session_id, kind, packet, request_hash = _prepare_task(request)
        self._begin()
        try:
            session = self._session(session_id)
            replay = self.connection.execute(
                "SELECT * FROM prospecting_capture_task WHERE request_id=?", (request_id,),
            ).fetchone()
            if replay is not None:
                if str(replay["request_hash"]) != request_hash:
                    raise CaptureError("request_conflict")
                result = CaptureTaskResult(
                    str(replay["task_id"]), str(replay["session_id"]), int(replay["ordinal"]),
                    str(replay["task_kind"]), str(replay["state"]), True,
                )
                self.connection.commit()
                return result
            ordinal = int(self.connection.execute(
                "SELECT count(*) FROM prospecting_capture_task WHERE session_id=?", (session_id,),
            ).fetchone()[0])
            if ordinal >= int(session["task_cap"]):
                raise CaptureError("task_cap_reached")
            packet_hash = _digest(packet)
            if self.connection.execute(
                "SELECT 1 FROM prospecting_capture_task WHERE session_id=? AND packet_hash=?",
                (session_id, packet_hash),
            ).fetchone() is not None:
                raise CaptureError("duplicate_packet")
            stamp = _timestamp(self.now(), "store_state_invalid").isoformat()
            task_id = _id("pct_", request_id, "task")
            self.connection.execute(
                """INSERT INTO prospecting_capture_task(
                       task_id,session_id,ordinal,request_id,request_hash,task_kind,
                       packet_json,packet_hash,state,attempt_count,lease_epoch,
                       lease_token,lease_expires_at,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,'queued',0,0,NULL,NULL,?,?)""",
                (task_id, session_id, ordinal, request_id, request_hash, kind,
                 _canonical(packet), packet_hash, stamp, stamp),
            )
            result = CaptureTaskResult(task_id, session_id, ordinal, kind, "queued", False)
            self.connection.commit()
            return result
        except BaseException as error:
            self._rollback()
            self._rethrow(error)
            raise

    def claim_task(self, request: CaptureClaimRequest) -> CaptureLease | None:
        if not isinstance(request, CaptureClaimRequest):
            raise CaptureError("invalid_request")
        seconds = _bounded_int(
            request.lease_seconds, "invalid_lease_seconds", MIN_LEASE_SECONDS, MAX_LEASE_SECONDS,
        )
        self._begin()
        try:
            session = self._session(request.session_id)
            session_id = str(session["session_id"])
            stamp_dt = _timestamp(self.now(), "store_state_invalid")
            stamp = stamp_dt.isoformat()
            expires = (stamp_dt + timedelta(seconds=seconds)).isoformat()
            rows = self.connection.execute(
                """SELECT * FROM prospecting_capture_task
                    WHERE session_id=? AND state IN ('queued','leased') ORDER BY ordinal""",
                (session_id,),
            ).fetchall()
            lease: CaptureLease | None = None
            for row in rows:
                task_id = str(row["task_id"])
                state = str(row["state"])
                if state == "leased":
                    if _timestamp(row["lease_expires_at"], "store_state_invalid") > stamp_dt:
                        continue
                    self.connection.execute(
                        """UPDATE prospecting_capture_attempt
                              SET state='reclaimed',finished_at=?
                            WHERE task_id=? AND state='open'""", (stamp, task_id),
                    )
                attempts = int(row["attempt_count"])
                if attempts >= int(session["max_attempts"]):
                    self.connection.execute(
                        """UPDATE prospecting_capture_task
                              SET state='failed',lease_token=NULL,lease_expires_at=NULL,updated_at=?
                            WHERE task_id=?""", (stamp, task_id),
                    )
                    continue
                epoch = int(row["lease_epoch"]) + 1
                packet = _validated_packet(
                    str(row["task_kind"]), row["packet_json"], row["packet_hash"],
                )
                token = _lease_token()
                attempt_id = _id("pca_", task_id, f"attempt:{epoch}")
                changed = self.connection.execute(
                    """UPDATE prospecting_capture_task
                          SET state='leased',attempt_count=?,lease_epoch=?,lease_token=?,
                              lease_expires_at=?,updated_at=?
                        WHERE task_id=? AND state=? AND attempt_count=? AND lease_epoch=?""",
                    (attempts + 1, epoch, token, expires, stamp, task_id, state,
                     attempts, int(row["lease_epoch"])),
                ).rowcount
                if changed != 1:
                    raise CaptureError("store_state_invalid")
                self.connection.execute(
                    """INSERT INTO prospecting_capture_attempt(
                           attempt_id,task_id,attempt_no,lease_token,lease_epoch,claimed_at,
                           lease_expires_at,state,error_code,finished_at)
                       VALUES(?,?,?,?,?,?,?,'open',NULL,NULL)""",
                    (attempt_id, task_id, attempts + 1, token, epoch, stamp, expires),
                )
                lease = CaptureLease(
                    task_id, attempt_id, attempts + 1, token, epoch,
                    str(row["task_kind"]), expires,
                    MappingProxyType({
                        key: str(value) for key, value in packet.items() if value is not None
                    }),
                )
                break
            self.connection.commit()
            return lease
        except BaseException as error:
            self._rollback()
            self._rethrow(error)
            raise

    def _leased(self, task_id: object, lease_token: object, stamp_dt: datetime) -> tuple[sqlite3.Row, sqlite3.Row, sqlite3.Row]:
        identifier = _text(task_id, "invalid_request", maximum=80)
        token = _text(lease_token, "invalid_lease", maximum=80)
        task = self.connection.execute(
            "SELECT * FROM prospecting_capture_task WHERE task_id=?", (identifier,),
        ).fetchone()
        if task is None:
            raise CaptureError("task_missing")
        session = self._session(str(task["session_id"]))
        attempt = self.connection.execute(
            "SELECT * FROM prospecting_capture_attempt WHERE task_id=? AND lease_token=?",
            (identifier, token),
        ).fetchone()
        if attempt is None or str(task["state"]) != "leased" or str(task["lease_token"]) != token:
            raise CaptureError("lease_lost")
        if str(attempt["state"]) != "open" or int(attempt["lease_epoch"]) != int(task["lease_epoch"]):
            raise CaptureError("lease_lost")
        if _timestamp(attempt["lease_expires_at"], "store_state_invalid") <= stamp_dt:
            raise CaptureError("lease_expired")
        return session, task, attempt

    def _committed_receipt(self, task_id: object, lease_token: object) -> sqlite3.Row | None:
        """Return the immutable receipt already committed for this task, if any."""
        identifier = _text(task_id, "invalid_request", maximum=80)
        token = _text(lease_token, "invalid_lease", maximum=80)
        row = self.connection.execute(
            """SELECT r.*,a.lease_token AS attempt_token,a.state AS attempt_state,
                      t.session_id,t.state AS task_state,t.task_kind,t.packet_json,
                      t.packet_hash AS task_packet_hash,s.source_url AS snapshot_url,
                      s.content_sha256 AS snapshot_sha
                 FROM prospecting_capture_receipt AS r
                 JOIN prospecting_capture_attempt AS a ON a.attempt_id=r.attempt_id
                 JOIN prospecting_capture_task AS t ON t.task_id=r.task_id
                 JOIN source_snapshot AS s ON s.snapshot_id=r.snapshot_id
                WHERE r.task_id=?""", (identifier,),
        ).fetchone()
        if row is None:
            return None
        self._session(str(row["session_id"]))
        if str(row["attempt_token"]) != token:
            raise CaptureError("lease_lost")
        if (
            str(row["attempt_state"]) != "succeeded" or str(row["task_state"]) != "captured"
            or str(row["snapshot_url"]) != str(row["source_url"])
            or str(row["snapshot_sha"]) != str(row["content_sha256"])
        ):
            raise CaptureError("store_state_invalid")
        _validated_packet(str(row["task_kind"]), row["packet_json"], row["task_packet_hash"])
        return row

    def _replay_receipt(
        self, row: sqlite3.Row, request: CaptureSubmitRequest, source_url: str,
        retrieved: str,
    ) -> CaptureReceipt:
        """Return the existing receipt only for a byte-identical resubmission."""
        expected = _digest({
            "receipt_id": str(row["receipt_id"]), "task_id": str(row["task_id"]),
            "attempt_id": str(row["attempt_id"]), "snapshot_id": str(row["snapshot_id"]),
            "source_url": str(row["source_url"]), "content_sha256": str(row["content_sha256"]),
            "retrieved_at": str(row["retrieved_at"]), "byte_count": int(row["byte_count"]),
            "packet_hash": str(row["task_packet_hash"]),
        })
        if expected != str(row["receipt_hash"]):
            raise CaptureError("store_state_invalid")
        _ref, contents = _read_capture(_snapshot_root(self.connection), request.body_ref)
        if (
            source_url != str(row["source_url"]) or retrieved != str(row["retrieved_at"])
            or sha256(contents).hexdigest() != str(row["content_sha256"])
            or len(contents) != int(row["byte_count"])
        ):
            raise CaptureError("receipt_conflict")
        return CaptureReceipt(
            str(row["receipt_id"]), str(row["task_id"]), str(row["attempt_id"]),
            str(row["snapshot_id"]), str(row["content_sha256"]), str(row["retrieved_at"]),
            int(row["byte_count"]), "captured",
        )

    def submit_capture(self, request: CaptureSubmitRequest) -> CaptureReceipt:
        if not isinstance(request, CaptureSubmitRequest):
            raise CaptureError("invalid_request")
        source_url = _url(request.source_url, "invalid_source_url")
        self._begin()
        created: list[tuple[Path, tuple[int, int]]] = []
        try:
            stamp_dt = _timestamp(self.now(), "store_state_invalid")
            stamp = stamp_dt.isoformat()
            retrieved_dt = _timestamp(request.retrieved_at, "invalid_time")
            if retrieved_dt > stamp_dt:
                raise CaptureError("invalid_time")
            retrieved = retrieved_dt.isoformat()
            replay = self._committed_receipt(request.task_id, request.lease_token)
            if replay is not None:
                receipt = self._replay_receipt(replay, request, source_url, retrieved)
                self._verify_capture(request.task_id)
                self.connection.commit()
                return receipt
            _session, task, attempt = self._leased(request.task_id, request.lease_token, stamp_dt)
            if retrieved_dt < _timestamp(attempt["claimed_at"], "store_state_invalid"):
                raise CaptureError("source_stale")
            packet = _validated_packet(
                str(task["task_kind"]), task["packet_json"], task["packet_hash"],
            )
            if str(task["task_kind"]) == OPEN_KIND and packet["url"] != source_url:
                raise CaptureError("source_url_mismatch")
            task_id = str(task["task_id"])
            attempt_id = str(attempt["attempt_id"])
            root = _snapshot_root(self.connection)
            _ref, contents = _read_capture(root, request.body_ref)
            try:
                contents.decode("utf-8", errors="strict")
            except UnicodeError:
                raise CaptureError("invalid_capture") from None
            snapshot_id = "snap_" + uuid.uuid4().hex
            expires = (retrieved_dt + timedelta(days=CAPTURE_RETENTION_DAYS)).isoformat()
            digest = sha256(contents).hexdigest()
            root.mkdir(parents=True, exist_ok=True)
            try:
                owned_ref = copy_owned(
                    root, namespace=SNAPSHOT_NAMESPACE, snapshot_id=snapshot_id,
                    contents=contents, maximum=MAX_CAPTURE_BYTES, created=created,
                )
            except SourceCaptureError:
                raise CaptureError("source_changed") from None
            self.connection.execute(
                """INSERT INTO source_snapshot(
                       snapshot_id,entity_id,source_url,source_domain,retrieved_at,content_type,
                       content_sha256,allowlist_version,body_ref,expires_at,retention_delete_at)
                   VALUES(?,?,?,?,?,'text/plain',?,?,?,?,?)""",
                (snapshot_id, task_id, source_url, urlsplit(source_url).hostname, retrieved,
                 digest, ALLOWLIST_VERSION, owned_ref, expires, expires),
            )
            receipt_id = _id("pcr_", task_id, f"receipt:{int(attempt['lease_epoch'])}")
            receipt_hash = _digest({
                "receipt_id": receipt_id, "task_id": task_id, "attempt_id": attempt_id,
                "snapshot_id": snapshot_id, "source_url": source_url,
                "content_sha256": digest, "retrieved_at": retrieved,
                "byte_count": len(contents), "packet_hash": str(task["packet_hash"]),
            })
            self.connection.execute(
                """INSERT INTO prospecting_capture_receipt(
                       receipt_id,task_id,attempt_id,snapshot_id,source_url,content_sha256,
                       retrieved_at,byte_count,receipt_hash,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (receipt_id, task_id, attempt_id, snapshot_id, source_url, digest,
                 retrieved, len(contents), receipt_hash, stamp),
            )
            self.connection.execute(
                """UPDATE prospecting_capture_attempt SET state='succeeded',finished_at=?
                    WHERE attempt_id=? AND state='open'""", (stamp, attempt_id),
            )
            changed = self.connection.execute(
                """UPDATE prospecting_capture_task
                      SET state='captured',lease_token=NULL,lease_expires_at=NULL,updated_at=?
                    WHERE task_id=? AND state='leased' AND lease_token=?""",
                (stamp, task_id, str(request.lease_token)),
            ).rowcount
            if changed != 1:
                raise CaptureError("lease_lost")
            receipt = CaptureReceipt(
                receipt_id, task_id, attempt_id, snapshot_id, digest, retrieved,
                len(contents), "captured",
            )
            self.connection.commit()
            return receipt
        except BaseException as error:
            self._rollback()
            try:
                cleanup_owned(created)
            except OSError:
                raise CaptureError("capture_cleanup_failed") from None
            self._rethrow(error)
            raise

    def finish_attempt(self, request: CaptureFinishRequest) -> CaptureTaskStatus:
        if not isinstance(request, CaptureFinishRequest):
            raise CaptureError("invalid_request")
        code = request.error_code
        if type(code) is not str or code not in CAPTURE_ERRORS:
            raise CaptureError("invalid_error_code")
        self._begin()
        try:
            stamp_dt = _timestamp(self.now(), "store_state_invalid")
            stamp = stamp_dt.isoformat()
            session, task, attempt = self._leased(request.task_id, request.lease_token, stamp_dt)
            task_id = str(task["task_id"])
            self.connection.execute(
                """UPDATE prospecting_capture_attempt
                      SET state='failed',error_code=?,finished_at=?
                    WHERE attempt_id=? AND state='open'""",
                (code, stamp, str(attempt["attempt_id"])),
            )
            exhausted = int(task["attempt_count"]) >= int(session["max_attempts"])
            changed = self.connection.execute(
                """UPDATE prospecting_capture_task
                      SET state=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
                    WHERE task_id=? AND state='leased' AND lease_token=?""",
                ("failed" if exhausted else "queued", stamp, task_id, str(request.lease_token)),
            ).rowcount
            if changed != 1:
                raise CaptureError("lease_lost")
            status = CaptureTaskStatus(
                task_id, int(task["ordinal"]), str(task["task_kind"]),
                "failed" if exhausted else "queued", int(task["attempt_count"]), code,
            )
            self.connection.commit()
            return status
        except BaseException as error:
            self._rollback()
            self._rethrow(error)
            raise

    def verify_capture(self, task_id: object) -> CaptureReceipt:
        try:
            return self._verify_capture(task_id)
        except BaseException as error:
            self._rethrow(error)
            raise

    def _verify_capture(self, task_id: object) -> CaptureReceipt:
        identifier = _text(task_id, "invalid_request", maximum=80)
        row = self.connection.execute(
            """SELECT r.*,s.body_ref,s.source_url AS snapshot_url,s.retrieved_at AS snapshot_at,
                      s.content_sha256 AS snapshot_sha,s.allowlist_version,s.content_type,
                      s.expires_at,s.retention_delete_at,
                      t.session_id,t.packet_hash,t.task_kind,t.packet_json,
                      t.state AS task_state
                 FROM prospecting_capture_receipt AS r
                 JOIN source_snapshot AS s ON s.snapshot_id=r.snapshot_id
                 JOIN prospecting_capture_task AS t ON t.task_id=r.task_id
                WHERE r.task_id=?""", (identifier,),
        ).fetchone()
        if row is None:
            raise CaptureError("capture_missing")
        self._session(str(row["session_id"]))
        packet = _validated_packet(
            str(row["task_kind"]), row["packet_json"], row["packet_hash"],
        )
        expected = _digest({
            "receipt_id": str(row["receipt_id"]), "task_id": str(row["task_id"]),
            "attempt_id": str(row["attempt_id"]), "snapshot_id": str(row["snapshot_id"]),
            "source_url": str(row["source_url"]), "content_sha256": str(row["content_sha256"]),
            "retrieved_at": str(row["retrieved_at"]), "byte_count": int(row["byte_count"]),
            "packet_hash": str(row["packet_hash"]),
        })
        if (
            expected != str(row["receipt_hash"])
            or str(row["snapshot_url"]) != str(row["source_url"])
            or str(row["snapshot_at"]) != str(row["retrieved_at"])
            or str(row["snapshot_sha"]) != str(row["content_sha256"])
            or str(row["allowlist_version"]) != ALLOWLIST_VERSION
            or str(row["content_type"]) != "text/plain"
            or str(row["task_state"]) != "captured"
            or str(row["retention_delete_at"]) != str(row["expires_at"])
            or (
                str(row["task_kind"]) == OPEN_KIND
                and packet["url"] != str(row["source_url"])
            )
        ):
            raise CaptureError("store_state_invalid")
        if _timestamp(self.now(), "store_state_invalid") >= _timestamp(
            row["expires_at"], "store_state_invalid",
        ):
            raise CaptureError("capture_expired")
        try:
            stored = read_owned(
                _snapshot_root(self.connection), str(row["body_ref"]), maximum=MAX_CAPTURE_BYTES,
            )
        except SourceCaptureError:
            raise CaptureError("source_changed") from None
        if (
            sha256(stored.contents).hexdigest() != str(row["content_sha256"])
            or len(stored.contents) != int(row["byte_count"])
        ):
            raise CaptureError("source_changed")
        return CaptureReceipt(
            str(row["receipt_id"]), str(row["task_id"]), str(row["attempt_id"]),
            str(row["snapshot_id"]), str(row["content_sha256"]), str(row["retrieved_at"]),
            int(row["byte_count"]), "captured",
        )

    def get_progress(self, session_id: object) -> CaptureProgress:
        try:
            return self._progress(session_id)
        except BaseException as error:
            self._rethrow(error)
            raise

    def _progress(self, session_id: object) -> CaptureProgress:
        session = self._session(session_id)
        identifier = str(session["session_id"])
        rows = self.connection.execute(
            "SELECT * FROM prospecting_capture_task WHERE session_id=? ORDER BY ordinal",
            (identifier,),
        ).fetchall()
        statuses: list[CaptureTaskStatus] = []
        for expected_ordinal, row in enumerate(rows):
            if int(row["ordinal"]) != expected_ordinal:
                raise CaptureError("store_state_invalid")
            last = self.connection.execute(
                """SELECT error_code FROM prospecting_capture_attempt
                    WHERE task_id=? ORDER BY attempt_no DESC LIMIT 1""",
                (str(row["task_id"]),),
            ).fetchone()
            statuses.append(CaptureTaskStatus(
                str(row["task_id"]), int(row["ordinal"]), str(row["task_kind"]),
                str(row["state"]), int(row["attempt_count"]),
                None if last is None or last[0] is None else str(last[0]),
            ))
        return CaptureProgress(
            identifier, str(session["session_hash"]), str(session["run_id"]),
            str(session["intake_hash"]), str(session["state"]),
            self._counts(identifier), tuple(statuses),
        )


__all__ = [
    "ACQUISITION_HASH", "ACQUISITION_VERSION", "CAPTURE_ERRORS", "CAPTURE_KINDS",
    "CaptureClaimRequest", "CaptureError", "CaptureFinishRequest", "CaptureLease",
    "CaptureProgress", "CaptureReceipt", "CaptureService", "CaptureSessionRequest",
    "CaptureSessionResult", "CaptureSubmitRequest", "CaptureTaskRequest",
    "CaptureTaskResult", "CaptureTaskStatus", "MAX_ATTEMPTS_PER_TASK",
    "MAX_LEASE_SECONDS", "MAX_TASKS_PER_SESSION", "OPEN_KIND", "SEARCH_KIND",
]

"""Strict, PII-free envelopes for temporary desktop-pulled control jobs."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from typing import Mapping

try:
    from scripts.prospecting.pii_guard import assert_vm_safe
except ModuleNotFoundError:  # Direct execution from a reviewed ephemeral source bundle.
    from pii_guard import assert_vm_safe

VERSION = 1
MAX_ENVELOPE_BYTES = 4096
MAX_REQUEST_LIFETIME = timedelta(hours=24)
MAX_COUNT = 1_000_000
REQUEST_ID = re.compile(r"ctlreq_[0-9a-f]{32}\Z")
CONTROL_REF = re.compile(r"ctl_[0-9a-f]{32}\Z")
WORKER_ID = re.compile(r"desk_[0-9a-f]{32}\Z")
LEASE_ID = re.compile(r"lease_[0-9a-f]{32}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
OPERATIONS = frozenset({"status", "queue_due"})
RESULT_CODES = frozenset({
    "status", "queued", "grant_missing", "grant_inactive", "grant_expired",
    "grant_binding_mismatch", "campaign_inactive", "request_conflict",
    "request_in_progress", "queue_conflict", "control_failed",
})
COUNT_KEYS = frozenset({
    "due", "paused", "replied", "considered", "queued", "already_queued", "reserved",
})


class ControlProtocolError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> None:
    raise ControlProtocolError(code)


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            _fail("json_duplicate_key")
        value[key] = item
    return value


def _decode(data: bytes) -> object:
    if type(data) is not bytes or not data or len(data) > MAX_ENVELOPE_BYTES:
        _fail("envelope_size")
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=_pairs)
    except ControlProtocolError:
        raise
    except (UnicodeError, json.JSONDecodeError):
        _fail("envelope_invalid")


def _utc(value: object) -> datetime:
    if type(value) is not str or not value.endswith("Z"):
        _fail("timestamp_invalid")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        _fail("timestamp_invalid")
    canonical = parsed.isoformat(timespec="seconds").replace("+00:00", "Z")
    if parsed.tzinfo != timezone.utc or parsed.microsecond or canonical != value:
        _fail("timestamp_invalid")
    return parsed


@dataclass(frozen=True)
class ControlRequest:
    version: int
    request_id: str
    control_ref: str
    operation: str
    not_before: str
    expires_at: str

    @property
    def digest(self) -> str:
        return hashlib.sha256(encode_request(self)).hexdigest()


@dataclass(frozen=True)
class ControlResult:
    version: int
    request_id: str
    request_hash: str
    state: str
    code: str
    counts: Mapping[str, int]


def encode_request(request: ControlRequest) -> bytes:
    data = json.dumps(asdict(request), sort_keys=True, separators=(",", ":")).encode("utf-8")
    parse_request(data)
    return data


def parse_request(data: bytes, *, now: datetime | None = None) -> ControlRequest:
    value = _decode(data)
    fields = {"version", "request_id", "control_ref", "operation", "not_before", "expires_at"}
    if type(value) is not dict or set(value) != fields:
        _fail("request_schema")
    if type(value["version"]) is not int or value["version"] != VERSION:
        _fail("request_schema")
    if type(value["request_id"]) is not str or REQUEST_ID.fullmatch(value["request_id"]) is None:
        _fail("request_schema")
    if type(value["control_ref"]) is not str or CONTROL_REF.fullmatch(value["control_ref"]) is None:
        _fail("request_schema")
    if type(value["operation"]) is not str or value["operation"] not in OPERATIONS:
        _fail("request_schema")
    start, end = _utc(value["not_before"]), _utc(value["expires_at"])
    if end <= start or end - start > MAX_REQUEST_LIFETIME:
        _fail("request_lifetime")
    if now is not None:
        if now.tzinfo is None or now.utcoffset() is None:
            _fail("timestamp_invalid")
        current = now.astimezone(timezone.utc)
        if current < start:
            _fail("request_not_ready")
        if current >= end:
            _fail("request_expired")
    request = ControlRequest(**value)
    assert_vm_safe({"kind": "process_arguments", "fields": asdict(request)}, "process_arguments")
    return request


def encode_result(result: ControlResult) -> bytes:
    value = {**asdict(result), "counts": dict(result.counts)}
    assert_vm_safe({"kind": "process_results", "fields": value}, "process_results")
    data = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    parse_result(data)
    return data


def parse_result(data: bytes) -> ControlResult:
    value = _decode(data)
    fields = {"version", "request_id", "request_hash", "state", "code", "counts"}
    if type(value) is not dict or set(value) != fields:
        _fail("result_schema")
    if type(value["version"]) is not int or value["version"] != VERSION:
        _fail("result_schema")
    if type(value["request_id"]) is not str or REQUEST_ID.fullmatch(value["request_id"]) is None:
        _fail("result_schema")
    if type(value["request_hash"]) is not str or DIGEST.fullmatch(value["request_hash"]) is None:
        _fail("result_schema")
    if (
        type(value["state"]) is not str or value["state"] not in {"succeeded", "failed"}
        or type(value["code"]) is not str or value["code"] not in RESULT_CODES
    ):
        _fail("result_schema")
    counts = value["counts"]
    if type(counts) is not dict or not set(counts).issubset(COUNT_KEYS):
        _fail("result_schema")
    if any(type(number) is not int or number < 0 or number > MAX_COUNT for number in counts.values()):
        _fail("result_schema")
    result = ControlResult(**value)
    assert_vm_safe({"kind": "process_results", "fields": value}, "process_results")
    return result

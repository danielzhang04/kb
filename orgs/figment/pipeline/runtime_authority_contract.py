"""Pure, bounded models of UNTRUSTED authority claims; never an authorization API.

Inputs are raw JSON bytes. No clock, storage, verifier or execution integration exists.
Canonical byte results are data, not verified objects or capabilities.
"""
from datetime import datetime
import hashlib
import json
import re

MAX_CONTRACT = 65536
MAX_TRACE = 1048576
MAX_EVENTS = 256
MAX_INTEGER = 2**53 - 1  # Serialization bound only, NOT a spend policy.
LAUNCH = "tensor-video-runtime-smoke"
RESULT = "tensor-video-runtime-compatibility-result"
COMMON = frozenset("schema purpose creator recipe_profile stage fixture card_id owner risk_tier action target not_before expires_at".split())
LAUNCH_DIGESTS = frozenset("manifest_sha256 scope_sha256 input_authority_sha256 controller_build_sha256 capture_policy_sha256".split())
RESULT_DIGESTS = frozenset("launch_payload_sha256 sealed_evidence_sha256 scope_sha256 controller_build_sha256 capture_policy_sha256 limitations_sha256".split())
TRANSITIONS = {
    "absent": frozenset({"reserved"}),
    "reserved": frozenset({"dispatch-intent", "abandoned"}),
    "dispatch-intent": frozenset({"acquired", "uncertain", "failed-terminal"}),
    "acquired": frozenset({"terminal"}),
    "uncertain": frozenset({"acquired", "terminal"}),
    "terminal": frozenset({"sealed"}),
    "sealed": frozenset({"result-linked"}),
    "abandoned": frozenset(), "failed-terminal": frozenset(), "result-linked": frozenset(),
}
UNCHECKED = (
    "authentication", "protected-ref-freshness-and-revocation", "durable-consumption-and-concurrency",
    "budget-enforcement", "capture-authenticity-and-completeness", "execution-success",
    "termination", "result-authorization",
)


class _Invalid(ValueError):
    pass


def _require(condition, code):
    if not condition:
        raise _Invalid(code)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _report(errors=(), **details):
    return dict(schema="figment/runtime-authority-analysis@1", structurally_consistent=not errors,
                authority_status="unavailable", runtime_admitted=False, production_ready=False,
                dispatch_permitted=False, errors=list(errors)[:32], unchecked=list(UNCHECKED), **details)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "duplicate-json-key")
        result[key] = value
    return result


def _bad_constant(_):
    raise _Invalid("nonfinite-json")


def _decode(raw, cap):
    _require(type(raw) is bytes, "raw-bytes-required")
    _require(len(raw) <= cap, "input-byte-limit")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=_bad_constant)
    except (ValueError, UnicodeError, RecursionError) as error:
        if isinstance(error, _Invalid):
            raise
        raise _Invalid("invalid-json") from None
    stack = [(value, 0)]
    count = 0
    while stack:
        item, depth = stack.pop()
        count += 1
        _require(depth <= 16 and count <= 10000, "json-complexity-limit")
        if type(item) is dict:
            stack.extend((key, depth + 1) for key in item)
            stack.extend((child, depth + 1) for child in item.values())
        elif type(item) is list:
            stack.extend((child, depth + 1) for child in item)
        elif type(item) is str:
            _require(len(item) <= 1024 and not any(0xD800 <= ord(c) <= 0xDFFF for c in item), "json-text-limit")
        elif type(item) is float:
            raise _Invalid("float-not-supported")
        elif type(item) is int:
            _require(abs(item) <= MAX_INTEGER, "integer-serialization-limit")
    return value


def _keys(value, expected):
    _require(type(value) is dict and set(value) == set(expected), "closed-object-keys")


def _id(value):
    _require(type(value) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value) is not None, "invalid-id")


def _digest(value):
    _require(type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None, "invalid-digest")


def _time(value):
    _require(type(value) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", value) is not None, "invalid-time")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise _Invalid("invalid-time") from None


def _positive(value):
    _require(type(value) is int and 0 < value <= MAX_INTEGER, "invalid-positive-integer")


def _contract(raw):
    value = _decode(raw, MAX_CONTRACT)
    _require(type(value) is dict, "contract-object-required")
    purpose = value.get("purpose")
    _require(purpose in (LAUNCH, RESULT), "invalid-purpose")
    launch = purpose == LAUNCH
    digests = LAUNCH_DIGESTS if launch else RESULT_DIGESTS
    extra = {"bounds", "attempt_policy"} if launch else {"invocation_id", "decision"}
    _keys(value, COMMON | digests | extra)
    suffix = "smoke" if launch else "result"
    _require(value["schema"] == f"figment/runtime-{suffix}-authority-contract@1", "invalid-schema")
    for key, expected in (("recipe_profile", "tensor"), ("stage", "video"), ("risk_tier", "T2"),
                          ("action", "figment-runtime-smoke" if launch else "figment-runtime-result")):
        _require(value[key] == expected, "invalid-contract-discriminator")
    _require(value["fixture"] is False, "nonfixture-required")
    for key in ("creator", "card_id", "owner"):
        _id(value[key])
    for key in digests | {"target"}:
        _digest(value[key])
    _require(value["target"] == value["manifest_sha256" if launch else "sealed_evidence_sha256"], "target-binding")
    _require(_time(value["not_before"]) < _time(value["expires_at"]), "invalid-window")
    if launch:
        bounds = value["bounds"]
        _keys(bounds, "job_count max_placement_attempts max_usd_micros max_minutes arc_cap_usd_micros arc_start arc_snapshot_sha256".split())
        for key in ("job_count", "max_placement_attempts", "max_usd_micros", "max_minutes", "arc_cap_usd_micros"):
            _positive(bounds[key])
        _require(bounds["job_count"] == bounds["max_placement_attempts"] == 1, "single-job-placement-required")
        _time(bounds["arc_start"] + "T00:00:00Z" if type(bounds["arc_start"]) is str else None)
        _digest(bounds["arc_snapshot_sha256"])
        policy = value["attempt_policy"]
        _keys(policy, {"max_invocations", "retries"})
        _positive(policy["max_invocations"])
        _require(policy["max_invocations"] == 1 and policy["retries"] == "new-approval-required", "invalid-attempt-policy")
    else:
        _id(value["invocation_id"])
        _require(value["decision"] == "accept-compatibility", "invalid-decision")
    canonical = _canonical(value)
    _require(len(canonical) + len(b"```json\n\n```") <= MAX_CONTRACT, "canonical-byte-limit")
    return value, canonical


def _payload(value, canonical):
    work_order = b"```json\n" + canonical + b"\n```"
    return b"action:" + _canonical(value["action"]) + b"\ntarget:" + _canonical(value["target"]) + b"\nwork-order:\n" + work_order


def parse_contract(value):
    """Return canonical immutable bytes or a bounded non-authoritative error report."""
    try:
        return _contract(value)[1]
    except _Invalid as error:
        return _report((str(error),))


def compare_bindings(contract, envelope_claim, scope_claim, now_utc):
    """Compare untrusted raw-byte claims using a supplied inert test time."""
    try:
        value, canonical = _contract(contract)
        envelope = _decode(envelope_claim, MAX_CONTRACT)
        _keys(envelope, "card_id action target owner risk_tier payload_sha256".split())
        for key in ("card_id", "owner"):
            _id(envelope[key])
        for key in ("action", "risk_tier"):
            _require(type(envelope[key]) is str, "invalid-envelope-type")
        _digest(envelope["target"])
        _digest(envelope["payload_sha256"])
        scope = _decode(scope_claim, MAX_CONTRACT)
        fields = LAUNCH_DIGESTS if value["purpose"] == LAUNCH else RESULT_DIGESTS | {"invocation_id"}
        _keys(scope, fields | {"purpose"})
        _require(scope["purpose"] == value["purpose"], "scope-purpose-mismatch")
        for key in fields:
            (_id if key == "invocation_id" else _digest)(scope[key])
        now = _time(now_utc)
        errors = ["envelope-" + key + "-mismatch" for key in sorted(envelope) if key != "payload_sha256" and envelope[key] != value[key]]
        errors.extend("scope-" + key + "-mismatch" for key in sorted(fields) if scope[key] != value[key])
        payload = _sha(_payload(value, canonical))
        if envelope["payload_sha256"] != payload:
            errors.append("payload-sha256-mismatch")
        if not _time(value["not_before"]) <= now < _time(value["expires_at"]):
            errors.append("outside-contract-window")
        return _report(errors, contract_sha256=_sha(canonical), payload_sha256=payload)
    except _Invalid as error:
        return _report((str(error),))


def analyze_attempt_trace(contract, events):
    """Check declared topology only; opaque evidence proves no operational fact."""
    try:
        value, canonical = _contract(contract)
        _require(value["purpose"] == LAUNCH, "launch-contract-required")
        trace = _decode(events, MAX_TRACE)
        _require(type(trace) is list and 0 < len(trace) <= MAX_EVENTS, "trace-record-limit")
        state, previous, invocation, last_time = "absent", None, None, None
        seen = {}
        replays = 0
        for event in trace:
            _keys(event, "schema event_id revision previous_event_sha256 approval_payload_sha256 invocation_id contract_sha256 scope_sha256 from_state to_state occurred_at evidence_sha256".split())
            _require(event["schema"] == "figment/runtime-attempt-event-claim@1", "invalid-event-schema")
            _id(event["event_id"])
            _id(event["invocation_id"])
            _require(type(event["revision"]) is int and 0 <= event["revision"] < MAX_EVENTS, "invalid-revision")
            for key in ("approval_payload_sha256", "contract_sha256", "scope_sha256"):
                _digest(event[key])
            for key in ("previous_event_sha256", "evidence_sha256"):
                if event[key] is not None:
                    _digest(event[key])
            when = _time(event["occurred_at"])
            encoded = _canonical(event)
            if event["event_id"] in seen:
                _require(seen[event["event_id"]] == encoded, "event-id-conflict")
                replays += 1
                continue
            _require(event["revision"] == len(seen), "revision-gap-or-fork")
            _require(event["previous_event_sha256"] == previous, "previous-event-mismatch")
            _require(event["approval_payload_sha256"] == _sha(_payload(value, canonical)) and event["contract_sha256"] == _sha(canonical) and event["scope_sha256"] == value["scope_sha256"], "event-contract-binding")
            _require(invocation is None or invocation == event["invocation_id"], "invocation-mismatch")
            _require(type(event["from_state"]) is str and type(event["to_state"]) is str, "invalid-state-type")
            _require(event["from_state"] == state and event["to_state"] in TRANSITIONS[state], "invalid-transition")
            _require((event["evidence_sha256"] is None) == (state == "absent"), "invalid-evidence-nullability")
            _require(last_time is None or when >= last_time, "clock-rollback")
            if event["to_state"] in ("reserved", "dispatch-intent"):
                _require(_time(value["not_before"]) <= when < _time(value["expires_at"]), "dispatch-window")
            seen[event["event_id"]] = encoded
            state, previous, invocation, last_time = event["to_state"], _sha(encoded), event["invocation_id"], when
        return _report(state=state, unique_events=len(seen), exact_replays=replays, last_event_sha256=previous)
    except _Invalid as error:
        return _report((str(error),))

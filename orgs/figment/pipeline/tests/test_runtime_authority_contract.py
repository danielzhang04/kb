"""Synthetic contract models: these tests never verify or consume an approval."""
import builtins
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys

import pytest

MODULE = Path(__file__).parents[1] / "runtime_authority_contract.py"
spec = importlib.util.spec_from_file_location("authority_model_under_test", MODULE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def raw(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def launch():
    result = dict(schema="figment/runtime-smoke-authority-contract@1", purpose=m.LAUNCH,
                  creator="creator-003", recipe_profile="tensor", stage="video", fixture=False,
                  card_id="synthetic-001", owner="codex-worker", risk_tier="T2",
                  action="figment-runtime-smoke", target="a" * 64,
                  not_before="2026-10-06T00:00:00Z", expires_at="2026-10-06T01:00:00Z",
                  bounds=dict(job_count=1, max_placement_attempts=1, max_usd_micros=2000000,
                              max_minutes=10, arc_cap_usd_micros=75000000,
                              arc_start="2026-09-29", arc_snapshot_sha256="b" * 64),
                  attempt_policy=dict(max_invocations=1, retries="new-approval-required"))
    result.update({key: "a" * 64 for key in m.LAUNCH_DIGESTS})
    return result


def result_contract():
    value = {key: child for key, child in launch().items() if key in m.COMMON}
    value.update(schema="figment/runtime-result-authority-contract@1", purpose=m.RESULT,
                 action="figment-runtime-result", invocation_id="invocation-1", decision="accept-compatibility")
    value.update({key: "a" * 64 for key in m.RESULT_DIGESTS})
    return value


def payload(value):
    # Independent literal fleet I3 encoding, additionally checked against real primitive below.
    return ('action:' + json.dumps(value['action']) + '\ntarget:' + json.dumps(value['target']) +
            '\nwork-order:\n```json\n' + raw(value).decode() + '\n```').encode()


def claims(value):
    envelope = {key: value[key] for key in ("card_id", "action", "target", "owner", "risk_tier")}
    envelope["payload_sha256"] = sha(payload(value))
    fields = m.LAUNCH_DIGESTS if value["purpose"] == m.LAUNCH else m.RESULT_DIGESTS | {"invocation_id"}
    scope = {key: value[key] for key in fields | {"purpose"}}
    return envelope, scope


def trace(states, value=None, start=None):
    value = value or launch()
    events = copy.deepcopy(start or [])
    before = events[-1]["to_state"] if events else "absent"
    for after in states:
        events.append(dict(schema="figment/runtime-attempt-event-claim@1", event_id=f"event-{len(events)}",
                           revision=len(events), previous_event_sha256=sha(raw(events[-1])) if events else None,
                           approval_payload_sha256=sha(payload(value)), invocation_id="invocation-1",
                           contract_sha256=sha(raw(value)), scope_sha256=value["scope_sha256"],
                           from_state=before, to_state=after, occurred_at="2026-10-06T00:00:00Z",
                           evidence_sha256="e" * 64 if events else None))
        before = after
    return events


def invariant(report, consistent=None):
    assert report["schema"] == "figment/runtime-authority-analysis@1"
    assert report["authority_status"] == "unavailable"
    assert all(report[key] is False for key in ("runtime_admitted", "production_ready", "dispatch_permitted"))
    assert len(report["errors"]) <= 32
    assert "termination" in report["unchecked"] and "result-authorization" in report["unchecked"]
    if consistent is not None:
        assert report["structurally_consistent"] is consistent, report


@pytest.mark.parametrize("factory", [launch, result_contract])
def test_canonical_and_binding(factory):
    value = factory()
    source = json.dumps(value, indent=2).encode()
    assert m.parse_contract(source) == raw(value)
    envelope, scope = claims(value)
    invariant(m.compare_bindings(source, raw(envelope), raw(scope), value["not_before"]), True)
    for when in ("2026-10-05T23:59:59Z", value["expires_at"]):
        invariant(m.compare_bindings(source, raw(envelope), raw(scope), when), False)


@pytest.mark.parametrize("field", sorted(m.COMMON | m.LAUNCH_DIGESTS | {"bounds", "attempt_policy"}))
def test_missing_contract_fields(field):
    value = launch()
    del value[field]
    invariant(m.parse_contract(raw(value)), False)


@pytest.mark.parametrize("key,value", [
    ("verified", True), ("runtime_admitted", True), ("verifier", "success"), ("private_key", "x"),
    ("ref", "HEAD"), ("purpose", m.RESULT), ("fixture", 0), ("stage", "gen"),
    ("target", "b" * 64), ("creator", "../path"), ("owner", "x" * 129),
    ("not_before", "2026-10-06T00:00:00+00:00"), ("expires_at", "2026-10-06T00:00:00Z"),
    ("scope_sha256", "A" * 64), ("schema", []), ("purpose", {}), ("owner", "\ud800"),
])
def test_bad_contract_fields(key, value):
    contract = launch()
    contract[key] = value
    invariant(m.parse_contract(raw(contract)), False)


@pytest.mark.parametrize("number", [True, False, 0, -1, 1.5, 2**53, "2", None])
def test_budget_claim_type_and_serialization_bound(number):
    value = launch()
    value["bounds"]["max_usd_micros"] = number
    invariant(m.parse_contract(raw(value)), False)


def test_budget_values_are_not_policy_enforcement():
    value = launch()
    value["bounds"].update(max_usd_micros=2**53-1, arc_cap_usd_micros=1)
    assert type(m.parse_contract(raw(value))) is bytes


@pytest.mark.parametrize("source", [b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}', b'{"x":1e1000}', b'\xff', b'[' * 2000, b'"' + b'x' * 1025 + b'"', b'[]' + b' ' * 65535, {}, [], "{}", None], ids=["duplicate", "nan", "inf", "overflow", "utf8", "depth", "text", "bytes", "dict", "list", "str", "none"])
def test_raw_bounds_and_errors(source):
    invariant(m.parse_contract(source), False)


def test_byte_limit_inclusive_and_complexity():
    canonical = raw(launch())
    assert type(m.parse_contract(canonical + b' ' * (65536-len(canonical)))) is bytes
    invariant(m.parse_contract(canonical + b' ' * (65537-len(canonical))), False)
    for value in ([0] * 10001, [[[[[[[[[[[[[[[[[0]]]]]]]]]]]]]]]]]):
        invariant(m.parse_contract(raw(value)), False)


@pytest.mark.parametrize("factory", [launch, result_contract])
def test_every_scope_and_envelope_binding(factory):
    value = factory()
    envelope, scope = claims(value)
    for key in envelope:
        mutated = dict(envelope, **{key: "b" * 64 if key in ("target", "payload_sha256") else "different"})
        invariant(m.compare_bindings(raw(value), raw(mutated), raw(scope), value["not_before"]), False)
    for key in scope:
        mutated = dict(scope, **{key: "b" * 64 if key.endswith("sha256") else "different"})
        invariant(m.compare_bindings(raw(value), raw(envelope), raw(mutated), value["not_before"]), False)
    for container in (envelope, scope):
        container["verified"] = True
        invariant(m.compare_bindings(raw(value), raw(envelope), raw(scope), value["not_before"]), False)
        del container["verified"]


@pytest.mark.parametrize("replacement", [True, ["figment-runtime-smoke"], {"action": "figment-runtime-smoke"}, None])
def test_envelope_type_collisions(replacement):
    value = launch()
    envelope, scope = claims(value)
    for field in ("action", "target"):
        wrong = dict(envelope, **{field: replacement})
        invariant(m.compare_bindings(raw(value), raw(wrong), raw(scope), value["not_before"]), False)


def test_real_i3_primitive_parity_without_verification(monkeypatch):
    import approvals
    import cards
    def forbidden(*args, **kwargs):
        raise AssertionError("verifier must not run")
    monkeypatch.setattr(approvals, "verify_signed_approval", forbidden)
    monkeypatch.setattr(approvals, "verify_telegram_approval", forbidden)
    for value in (launch(), result_contract()):
        envelope, scope = claims(value)
        for newline in ("\n", "\r\n"):
            body = ("Intro\n## Work order\n\n```json\n" + raw(value).decode() +
                    "\n```\n\n## Evidence\nignored\n## Work order\nlater").replace("\n", newline)
            card = cards.Card(meta=envelope, body=body)
            actual = approvals.approval_payload(card).encode()
            assert actual == payload(value)
            envelope["payload_sha256"] = sha(actual)
            invariant(m.compare_bindings(raw(value), raw(envelope), raw(scope), value["not_before"]), True)
    # Primitive is injective over action/target types, including non-ASCII strings.
    bodies = ["```json\n" + json.dumps({"note": "## Work order\n```\n\u00e9"}) + "\n```"]
    for body in bodies:
        outputs = [approvals.approval_payload(cards.Card(meta={"action": x, "target": x}, body="## Work order\n" + body)) for x in ("a,b", ["a", "b"], True, "\u00e9")]
        assert len(set(outputs)) == 4


PREFIXES = {
    "absent": [], "reserved": ["reserved"], "dispatch-intent": ["reserved", "dispatch-intent"],
    "acquired": ["reserved", "dispatch-intent", "acquired"],
    "uncertain": ["reserved", "dispatch-intent", "uncertain"],
    "terminal": ["reserved", "dispatch-intent", "acquired", "terminal"],
    "sealed": ["reserved", "dispatch-intent", "acquired", "terminal", "sealed"],
    "result-linked": ["reserved", "dispatch-intent", "acquired", "terminal", "sealed", "result-linked"],
    "abandoned": ["reserved", "abandoned"], "failed-terminal": ["reserved", "dispatch-intent", "failed-terminal"],
}
EXPECTED_EDGES = {("absent", "reserved"), ("reserved", "dispatch-intent"), ("reserved", "abandoned"),
                  ("dispatch-intent", "acquired"), ("dispatch-intent", "uncertain"), ("dispatch-intent", "failed-terminal"),
                  ("acquired", "terminal"), ("uncertain", "acquired"), ("uncertain", "terminal"),
                  ("terminal", "sealed"), ("sealed", "result-linked")}


@pytest.mark.parametrize("before", PREFIXES)
@pytest.mark.parametrize("after", PREFIXES)
def test_transition_crossproduct(before, after):
    events = trace(PREFIXES[before] + [after])
    invariant(m.analyze_attempt_trace(raw(launch()), raw(events)), (before, after) in EXPECTED_EDGES)


def test_crash_prefixes_and_replay_never_create_capability():
    events = trace(PREFIXES["result-linked"])
    for count in range(1, len(events)+1):
        prefix = events[:count]
        report = m.analyze_attempt_trace(raw(launch()), raw(prefix + prefix + [prefix[0]]))
        invariant(report, True)
        assert report["unique_events"] == count and report["exact_replays"] == count + 1
        assert report["state"] == prefix[-1]["to_state"]


@pytest.mark.parametrize("field,value", [("revision", 8), ("revision", True), ("previous_event_sha256", "b"*64),
    ("approval_payload_sha256", "b"*64), ("contract_sha256", "b"*64), ("scope_sha256", "b"*64),
    ("invocation_id", "different"), ("from_state", "uncertain"), ("to_state", "reserved"),
    ("evidence_sha256", None), ("occurred_at", "2026-10-05T23:59:59Z"), ("event_id", "event-0"),
    ("schema", "wrong"), ("verified", True)])
def test_event_mutation(field, value):
    events = trace(["reserved", "dispatch-intent"])
    events[-1][field] = value
    invariant(m.analyze_attempt_trace(raw(launch()), raw(events)), False)


def test_temporal_boundaries_cleanup_and_opaque_evidence():
    value = launch()
    events = trace(PREFIXES["result-linked"])
    # Cleanup/result linking may follow expiry; this proves neither cleanup nor result approval.
    for event in events[2:]:
        event["occurred_at"] = value["expires_at"]
    for index in range(1, len(events)):
        events[index]["previous_event_sha256"] = sha(raw(events[index-1]))
    invariant(m.analyze_attempt_trace(raw(value), raw(events)), True)
    for index in (0, 1):
        wrong = copy.deepcopy(events[:index+1])
        wrong[index]["occurred_at"] = value["expires_at"]
        invariant(m.analyze_attempt_trace(raw(value), raw(wrong)), False)
    wrong = copy.deepcopy(events)
    wrong[-1]["occurred_at"] = value["not_before"]
    invariant(m.analyze_attempt_trace(raw(value), raw(wrong)), False)


def test_fork_and_replay_conflict():
    events = trace(["reserved"])
    alternate = dict(events[0], event_id="competitor", invocation_id="different")
    invariant(m.analyze_attempt_trace(raw(launch()), raw([alternate])), True)
    invariant(m.analyze_attempt_trace(raw(launch()), raw(events + [alternate])), False)
    changed = dict(events[0], evidence_sha256="c"*64)
    invariant(m.analyze_attempt_trace(raw(launch()), raw(events + [changed])), False)


def test_trace_size_bounds_and_result_refusal():
    event = trace(["reserved"])[0]
    invariant(m.analyze_attempt_trace(raw(launch()), raw([event]*256)), True)
    invariant(m.analyze_attempt_trace(raw(launch()), raw([event]*257)), False)
    content = raw([event])
    invariant(m.analyze_attempt_trace(raw(launch()), content + b' ' * (1048576-len(content))), True)
    invariant(m.analyze_attempt_trace(raw(launch()), content + b' ' * (1048577-len(content))), False)
    invariant(m.analyze_attempt_trace(raw(result_contract()), raw([event])), False)
    for empty in (b'[]', b'{}', b'null'):
        invariant(m.analyze_attempt_trace(raw(launch()), empty), False)


def test_import_and_apis_have_no_io_or_verifier_seam(monkeypatch):
    source = MODULE.read_text(encoding="ascii")
    code = compile(source, str(MODULE), "exec")
    value = launch()
    envelope, scope = claims(value)
    inputs = (raw(value), raw(envelope), raw(scope), raw(trace(["reserved"])))
    original_import = builtins.__import__
    def forbidden(*args, **kwargs):
        raise AssertionError("forbidden IO")
    def limited_import(name, *args, **kwargs):
        assert name in {"datetime", "hashlib", "json", "re"}, name
        return original_import(name, *args, **kwargs)
    with monkeypatch.context() as guarded:
        guarded.setattr(builtins, "open", forbidden)
        guarded.setattr(Path, "open", forbidden)
        guarded.setattr(socket, "socket", forbidden)
        guarded.setattr(subprocess, "Popen", forbidden)
        guarded.setattr(builtins, "__import__", limited_import)
        namespace = {}
        exec(code, namespace)
        assert type(namespace["parse_contract"](inputs[0])) is bytes
        invariant(namespace["compare_bindings"](*inputs[:3], value["not_before"]), True)
        invariant(namespace["analyze_attempt_trace"](inputs[0], inputs[3]), True)
        invariant(namespace["parse_contract"](b'{"verified":true}'), False)


@pytest.mark.parametrize("stamp", ["2026-02-29T00:00:00Z", "2026-10-06T24:00:00Z", "2026-10-06T00:00:60Z", "2026-10-06T00:00:00.0Z", "2026-10-06T00:00:00z", "0000-01-01T00:00:00Z"])
def test_invalid_calendar_and_noncanonical_times(stamp):
    value = launch()
    value["not_before"] = stamp
    invariant(m.parse_contract(raw(value)), False)


def test_event_replay_every_field_mutation():
    original = trace(["reserved"])[0]
    for key in original:
        changed = dict(original)
        if key == "revision":
            changed[key] = 1
        elif key in ("previous_event_sha256", "evidence_sha256") or key.endswith("sha256"):
            changed[key] = "b" * 64
        elif key == "occurred_at":
            changed[key] = "2026-10-06T00:00:01Z"
        else:
            changed[key] = "different"
        invariant(m.analyze_attempt_trace(raw(launch()), raw([original, changed])), False)

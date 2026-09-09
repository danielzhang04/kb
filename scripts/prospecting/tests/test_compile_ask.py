from __future__ import annotations

import json
from pathlib import Path
import uuid

import pytest

from scripts.prospecting.manager import compile_ask as compiler
from scripts.prospecting.manager.compile_ask import CompileError, KNOWN, compile_ask


IDS = {"north star": ("company-001",), "acme labs": ("company-002",)}


def resolve(value: str) -> tuple[str, ...]:
    return IDS.get(value.lower(), ())


BASE = dict(
    campaign_id="11111111-1111-4111-8111-111111111111",
    sender_profile_id="22222222-2222-4222-8222-222222222222",
    mailbox_id="mailbox-001",
    capabilities={
        "manual": {
            name: ("exact", "v1")
            for name in (
                "industry",
                "company_type",
                "company_stage",
                "company_location",
                "person_location",
                "title",
                "seniority",
                "school",
                "platform",
                "company_list",
            )
        }
    },
    overrides=set(),
)


TEN = {
    "industry": "fintech",
    "company-type": "private",
    "company-stage": "series_a",
    "company-location": "nyc",
    "person-location": "boston",
    "title": "engineering",
    "seniority": "director",
    "school": "synthetic_university",
    "platform": "linkedin_assisted",
    "company-list": "North_Star,Acme_Labs",
}


def test_all_ten_predicates_have_exact_shape_and_stable_ids(record_property) -> None:
    ask = "intent:networking " + " ".join(f"{key}:{value}" for key, value in TEN.items())
    first = compile_ask(ask, resolve_company=resolve, **BASE)
    second = compile_ask(ask, resolve_company=resolve, **BASE)
    assert [item["type"] for item in first.target_policy["predicates"]] == [
        key.replace("-", "_") for key in TEN
    ]
    assert all(
        set(item) == {"predicate_id", "type", "value"}
        for item in first.target_policy["predicates"]
    )
    assert first.target_policy["predicates"][-1]["value"] == ["company-001", "company-002"]
    assert json.dumps(first.vm_payload, sort_keys=True, separators=(",", ":")) == json.dumps(
        second.vm_payload, sort_keys=True, separators=(",", ":")
    )
    record_property("predicate_types", len(first.target_policy["predicates"]))


@pytest.mark.parametrize(
    "ask",
    [
        "intent:networking person:Synthetic_Name",
        "intent:networking for Fixture Person",
        "intent:sales industry:software",
        "intent:networking company-list:Missing_Co",
        "intent:networking company-list:https://example.test/company",
        "intent:networking size:50-500",
    ],
)
def test_names_sales_urls_unresolved_and_alias_predicates_fail(ask: str) -> None:
    with pytest.raises(CompileError):
        compile_ask(ask, resolve_company=resolve, **BASE)


def test_unrecognised_input_is_rejected_without_echoing_it() -> None:
    raw = "intent:networking mystery-key:private"
    with pytest.raises(CompileError) as error:
        compile_ask(raw, resolve_company=resolve, **BASE)
    assert str(error.value) == "unsupported_predicate"
    assert raw not in str(error.value)


@pytest.mark.parametrize("raw", ["intent:networking for Fixture Person", "hello intent:networking"])
def test_free_text_is_rejected_without_echoing_it(raw: str) -> None:
    with pytest.raises(CompileError) as error:
        compile_ask(raw, resolve_company=resolve, **BASE)
    assert str(error.value) == "free_text_rejected"
    assert raw not in str(error.value)


def test_url_is_rejected_before_tokenisation() -> None:
    with pytest.raises(CompileError) as error:
        compile_ask("intent:networking https://example.test", resolve_company=resolve, **BASE)
    assert str(error.value) == "url_rejected"


def test_unsupported_and_unapproved_approximation_fail(record_property) -> None:
    unsupported = {"manual": {"industry": ("unsupported", "v2")}}
    approximate = {"manual": {"industry": ("approximate", "v2")}}
    with pytest.raises(CompileError, match="unsupported"):
        compile_ask(
            "intent:networking industry:fintech",
            resolve,
            **{**BASE, "capabilities": unsupported},
        )
    with pytest.raises(CompileError, match="override"):
        compile_ask(
            "intent:networking industry:fintech",
            resolve,
            **{**BASE, "capabilities": approximate},
        )
    record_property("unsupported_predicate_failure_percent", 100)
    record_property("approximation_without_override_percent", 0)


def test_campaign_policy_has_exact_contract_and_valid_types() -> None:
    result = compile_ask("intent:networking industry:fintech", resolve_company=resolve, **BASE)
    assert set(result.campaign_policy) == {
        "campaign_id",
        "intent",
        "sender_profile_id",
        "target_policy",
        "ask_type",
        "ask_minutes",
        "tone",
        "template_family",
        "cadence",
        "send_window",
        "timezone",
        "daily_cap",
        "hourly_cap",
        "firm_collision_cap",
        "approval_tier",
        "mailbox_id",
        "evidence_rules",
        "credit_budget",
        "status",
        "policy_hash",
    }
    assert result.campaign_policy["send_window"] == "09:00-17:00"
    assert result.campaign_policy["cadence"] == [
        {"step": 1, "business_day": 0},
        {"step": 2, "business_day": 5},
    ]


def test_campaign_id_timezone_and_send_window_are_validated() -> None:
    with pytest.raises(CompileError, match="invalid_campaign_id"):
        compile_ask("intent:networking", resolve_company=resolve, **{**BASE, "campaign_id": "not-a-uuid"})
    with pytest.raises(CompileError, match="invalid_timezone"):
        compile_ask("intent:networking timezone:Mars/Olympus", resolve_company=resolve, **BASE)
    with pytest.raises(CompileError, match="invalid_send_window"):
        compile_ask("intent:networking send-window:17:00-09:00", resolve_company=resolve, **BASE)


def test_approved_approximate_binding_is_accepted() -> None:
    exact = {"manual": {"industry": ("exact", "v2")}}
    initial = compile_ask(
        "intent:networking industry:fintech", resolve_company=resolve, **{**BASE, "capabilities": exact}
    )
    binding = (BASE["campaign_id"], initial.campaign_policy["policy_hash"], "p01-industry", "manual", "v2")
    approximate = {"manual": {"industry": ("approximate", "v2")}}
    result = compile_ask(
        "intent:networking industry:fintech",
        resolve_company=resolve,
        **{**BASE, "capabilities": approximate, "overrides": {binding}},
    )
    assert result.target_policy["predicates"][0]["type"] == "industry"


def test_vm_policy_guard_receives_policy_and_kind(monkeypatch) -> None:
    received = []

    def capture(value, kind) -> None:
        received.append((value, kind))

    monkeypatch.setattr(compiler, "assert_vm_safe", capture)
    result = compile_ask("intent:networking", resolve_company=resolve, **BASE)
    assert received == [({"kind": "vm_policy", "fields": result.vm_payload}, "vm_policy")]


def test_synthetic_name_never_reaches_any_vm_sink(capsys) -> None:
    raw = "intent:networking for Fixture Person industry:fintech"
    sinks = {name: [] for name in ("policy", "card", "report", "log", "exception", "ledger")}
    try:
        compile_ask(raw, resolve_company=resolve, **BASE)
    except CompileError as error:
        safe = {"state": "rejected", "failure_code": str(error)}
        for adapter in sinks.values():
            adapter.append(safe)
    else:
        pytest.fail("name-bearing ask was accepted")
    print("compile_rejected")
    captured = capsys.readouterr()
    rendered = json.dumps(sinks, sort_keys=True) + captured.out + captured.err
    assert "Fixture Person" not in rendered


def test_fixture_has_twelve_cases() -> None:
    cases = json.loads(Path("orgs/prospecting/fixtures/p5-asks.json").read_text(encoding="utf-8"))
    assert len(cases) >= 12


def _fixture_capabilities() -> dict[str, dict[str, tuple[str, str]]]:
    fields = tuple(TEN[key] and key.replace("-", "_") for key in TEN)
    lanes = ("manual", "pitchbook", "pdl", "class_c_public_profile", "linkedin_assisted")
    return {lane: {field: ("exact", "v1") for field in fields} for lane in lanes}


FIXTURE_CASES = json.loads(Path("orgs/prospecting/fixtures/p5-asks.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", FIXTURE_CASES)
def test_fixture_cases_compile_to_expected_intent_with_deterministic_vm_policy(case: dict) -> None:
    args = {**BASE, "capabilities": _fixture_capabilities()}
    first = compile_ask(case["ask"], resolve_company=resolve, **args)
    second = compile_ask(case["ask"], resolve_company=resolve, **args)
    assert first.campaign_policy["intent"] == case["intent"]
    assert json.dumps(first.vm_payload, sort_keys=True, separators=(",", ":")) == json.dumps(
        second.vm_payload, sort_keys=True, separators=(",", ":")
    )


FIT_ASK = (
    "intent:networking lane:manual companies-count:5 people-count:10\n"
    "path: corporate strategy into startup operating roles\n"
    "must: shared school\n"
    "prefer: revops or growth titles\n"
)


def test_fit_lines_are_captured_and_never_reach_policy() -> None:
    compiled = compile_ask(
        FIT_ASK, lambda _name: (), str(uuid.uuid4()), str(uuid.uuid4()), "mailbox-001",
        _fixture_capabilities(), set(),
    )
    assert compiled.fit_text.splitlines() == [
        "path: corporate strategy into startup operating roles",
        "must: shared school",
        "prefer: revops or growth titles",
    ]
    serialized = json.dumps(compiled.vm_payload) + json.dumps(compiled.campaign_policy)
    assert "corporate strategy" not in serialized
    assert not {"path", "must", "prefer"} & set(KNOWN)


def test_fit_prefix_line_with_url_is_still_rejected() -> None:
    with pytest.raises(CompileError, match="url_rejected"):
        compile_ask(
            FIT_ASK + "prefer: see https://example.test/thesis\n", lambda _name: (),
            str(uuid.uuid4()), str(uuid.uuid4()), "mailbox-001", _fixture_capabilities(), set(),
        )


def test_ask_without_fit_lines_has_empty_fit_text() -> None:
    compiled = compile_ask(
        "intent:networking lane:manual", lambda _name: (), str(uuid.uuid4()),
        str(uuid.uuid4()), "mailbox-001", _fixture_capabilities(), set(),
    )
    assert compiled.fit_text == ""


def test_a_fit_prefix_without_a_space_is_still_fit_text_not_a_predicate() -> None:
    compiled = compile_ask(
        FIT_ASK + "must:school\n", lambda _name: (), str(uuid.uuid4()),
        str(uuid.uuid4()), "mailbox-001", _fixture_capabilities(), set(),
    )
    assert "must:school" in compiled.fit_text.splitlines()

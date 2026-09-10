import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest

import scripts.prospecting.store as store_module
from scripts.prospecting.store import (
    ExecRequest,
    LaneCapability,
    Predicate,
    PredicateOverride,
    TargetPolicy,
    approval_scope_hash,
    compile_target_policy,
    decide_eligibility,
    get_eligibility_decision,
    insert_eligibility_decision,
    insert_exec_request,
    insert_predicate_override,
    open_store,
    select_lanes,
    validate_exec_request,
    validate_target_policy,
)


@pytest.fixture(autouse=True)
def isolate_existing_contract_tests_from_editorial_pipeline(monkeypatch) -> None:
    """These unit tests exercise request contracts, not P16 receipt validity."""
    monkeypatch.setattr(store_module, "_require_revision_ready", lambda *_args: None)


def _policy(*predicates: Predicate) -> TargetPolicy:
    return TargetPolicy(tuple(predicates), 2, 4, (), ("manual",), "score-v1")


def _request(operation: str, approval_id: str | None = None) -> ExecRequest:
    payloads = {
        "fetch_snapshot": {"entity_id": "per_1111111111111111", "snapshot_id": "obs_1111111111111111"},
        "finder_page": {"finder_run_id": "camp_1111111111111111", "lane": "manual"},
        "vendor_lookup": {"campaign_id": "camp_1111111111111111", "person_id": "per_1111111111111111", "provider": "hunter"},
        "gmail_draft": {"revision_id": "rev_1111111111111111", "contact_id": "cp_1111111111111111", "mailbox_id": "pol_1111111111111111"},
        "gmail_send": {"delivery_id": "req_1111111111111111"},
        "gmail_label": {"gmail_thread_id": "req_1111111111111111", "label_code": "sent"},
        "gmail_thread_refresh": {"gmail_thread_id": "req_1111111111111111"},
    }
    caller = "prospecting-list-builder" if operation in {
        "fetch_snapshot", "finder_page", "vendor_lookup"
    } else "prospecting-campaigner"
    return ExecRequest("req_1111111111111111", caller, operation, payloads[operation], "a" * 64,
                       approval_id, "2026-09-03T00:00:00Z", "queued", None)


def _seed_approval_graph(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-1", "Synthetic Sender", None, "testing", "testing", "proof", "[]"),
    )
    campaign_values = (
        "campaign-1", "networking", "sender-1", '{"predicates":[]}',
        "informational_call", 15, "direct", "networking-v1", "[]", "09:00-17:00",
        "America/New_York", 25, 6, 2, "T1", "mailbox-1", "{}", 0, "approved", "a" * 64,
    )
    connection.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        campaign_values,
    )
    connection.execute(
        "INSERT INTO company VALUES(?,?,?,?,?,?,?,?,?)",
        ("company-1", "Example Test", "https://example.test", None, None, None, None,
         "manual", "example.test"),
    )
    connection.execute(
        "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
        ("person-1", "Casey", "Casey Example", None, None, None, "manual", "casey"),
    )
    connection.execute(
        """INSERT INTO contact_point(
           contact_id,person_id,employer_company_id,email,provider,adapter_version,state,confidence
           ) VALUES(?,?,?,?,?,?,?,?)""",
        ("contact-1", "person-1", "company-1", "casey" + chr(64) + "example.test", "manual", "v1",
         "valid", 1.0),
    )
    connection.execute(
        """INSERT INTO revision(
          revision_id,person_id,campaign_id,step,subject,body,angle,generation_mode,purpose,ask,
          evidence_ids,recipient_relevance_points,sender_proof_points,template_id,template_version,
          prompt_version,model_version,qa,hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("revision-1", "person-1", "campaign-1", 0, "Synthetic subject", "Synthetic body",
         "why_them", "bespoke", None, "Synthetic ask?", "[]", "[]", "[]", "networking",
         1, "p1", "m1", '{"qa_score":100}', "b" * 64),
    )
    connection.execute(
        "INSERT INTO reply_template VALUES(?,?,?,?)",
        ("template-1", 1, "c" * 64, "2026-09-03T00:00:00Z"),
    )


def _seed_delivery(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
        ("enrollment-1", "campaign-1", "person-1", 0, None, "approved", None, None, None),
    )
    connection.execute(
        "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("req_1111111111111111", "campaign-1", "enrollment-1", 0, "b" * 64,
         "contact-1", "mailbox-1", "1" * 64, None, None, "message-1", None, None,
         None, "reserved"),
    )


def _insert_approval(
    connection: sqlite3.Connection,
    approval_id: str = "apr_1111111111111111",
    *,
    content_kind: str = "revision",
    permitted_action: str = "send_revision",
    revision_hash: str = "b" * 64,
) -> None:
    fields = {
        "assertion_ref": "assertion-1", "campaign_id": "campaign-1",
        "policy_hash": "a" * 64, "content_kind": content_kind, "revision_hash": revision_hash,
        "contact_id": "contact-1", "mailbox_id": "mailbox-1", "approver": "human:daniel",
        "approved_at": "2026-09-03T00:00:00Z", "expires_at": "2099-01-01T00:00:00Z",
        "tier": "T1", "send_window": '{"start":"2026-09-03T00:00:00Z","end":"2026-09-04T00:00:00Z"}',
        "nonce": "nonce-" + approval_id, "permitted_action": permitted_action,
    }
    connection.execute(
        "INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (approval_id, fields["assertion_ref"], fields["campaign_id"], fields["policy_hash"],
         fields["content_kind"], fields["revision_hash"], fields["contact_id"],
         fields["mailbox_id"], fields["approver"], fields["approved_at"], fields["expires_at"],
         fields["tier"], fields["send_window"], fields["nonce"], fields["permitted_action"],
         None, approval_scope_hash(fields), None),
    )


@pytest.mark.parametrize("predicate_type", (
    "industry", "company_type", "company_stage", "company_location", "person_location",
    "title", "seniority", "school", "platform", "company_list",
))
def test_20_target_policy_accepts_typed_vocabulary(predicate_type: str) -> None:
    value = ("cmp_1111111111111111",) if predicate_type == "company_list" else "typed_code"
    policy = _policy(Predicate("typed_predicate", predicate_type, value))
    validate_target_policy(policy)
    assert policy.predicates[0].value == value


def test_21_target_policy_rejects_duplicate_ids() -> None:
    policy = _policy(Predicate("same", "title", "associate"),
                     Predicate("same", "seniority", "director"))
    with pytest.raises(ValueError, match="predicate_id must be unique"):
        validate_target_policy(policy)
    for unsafe in (
        "two words", "path/value", "back\\slash", "semi;colon", "pipe|value",
        "amp&value", "cash$value", "less<value", "more>value", "tick`value",
        "https://example.test", "name" + chr(64) + "example.test", "code1234567",
    ):
        with pytest.raises(ValueError, match="normalized codes"):
            validate_target_policy(_policy(Predicate("typed", "title", unsafe)))


def test_22_company_list_rejects_names_and_urls() -> None:
    for unsafe in (
        ("Example Test",), ("https://example.test",), "cmp_1111111111111111",
        ("cmp_1111111111111111;drop",), ("cmp_123456789012345",),
    ):
        with pytest.raises(ValueError, match="opaque company IDs"):
            validate_target_policy(_policy(Predicate("companies", "company_list", unsafe)))


def test_23_desktop_compiler_resolves_ordered_opaque_company_ids() -> None:
    local = {
        "predicates": [{"predicate_id": "companies", "type": "company_list",
                        "value": ["Second Example", "Example Test"]}],
        "requested_companies": 2, "requested_people": 4, "extra_fields": [],
        "lane_plan": ["manual"], "scorer_version": "score-v1",
    }
    ids = {
        "Example Test": "cmp_1111111111111111",
        "Second Example": "cmp_2222222222222222",
        "Ambiguous Example": None,
    }
    compiled = compile_target_policy(local, ids.get)
    assert compiled.predicates[0].value == (
        "cmp_2222222222222222", "cmp_1111111111111111"
    )
    validate_target_policy(compiled)
    local["predicates"][0]["value"] = ["Missing Example"]
    with pytest.raises(ValueError, match="unresolved or ambiguous"):
        compile_target_policy(local, ids.get)
    local["predicates"][0]["value"] = ["Ambiguous Example"]
    with pytest.raises(ValueError, match="unresolved or ambiguous"):
        compile_target_policy(local, ids.get)


def test_24_unsupported_lane_fails_closed() -> None:
    policy = _policy(Predicate("school-1", "school", "school-code-1"))
    capabilities = {"manual": {"school": LaneCapability("unsupported", "no_school", "v1")}}
    with pytest.raises(ValueError, match="unsupported predicate"):
        select_lanes(policy, capabilities, set(), "campaign-1", "a" * 64)


def test_25_approximate_lane_requires_bound_override(tmp_path: Path) -> None:
    policy = _policy(Predicate("location-1", "person_location", "nyc"))
    capabilities = {"manual": {"person_location": LaneCapability("approximate", "metro", "v1")}}
    with pytest.raises(ValueError, match="human override"):
        select_lanes(policy, capabilities, set(), "campaign-1", "a" * 64)
    override = PredicateOverride(
        "pol_1111111111111111", "campaign-1", "a" * 64, "location-1", "manual", "v1",
        "human:daniel", "2026-09-03T00:00:00Z",
    )
    assert select_lanes(
        policy, capabilities, {override}, "campaign-1", "a" * 64
    ) == ("manual",)
    connection = open_store(tmp_path / "override.sqlite")
    _seed_approval_graph(connection)
    insert_predicate_override(connection, override)
    assert tuple(connection.execute(
        "SELECT action,actor FROM audit WHERE entity_id=?", (override.override_id,)
    ).fetchone()) == ("predicate_override", "human:daniel")


def test_26_eligibility_preserves_and_persists_all_outcomes(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "eligibility.sqlite")
    _seed_approval_graph(connection)
    connection.execute(
        "INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
        ("score-v1", "v1", "{}", "f" * 64, "2026-09-03T00:00:00Z", "2026-09-03T00:00:00Z"),
    )
    override = PredicateOverride(
        "pol_1111111111111111", "campaign-1", "a" * 64, "location-1", "manual", "v1",
        "human:daniel", "2026-09-03T00:00:00Z",
    )
    insert_predicate_override(connection, override)
    cases = (
        ("dec-ineligible", ("title-1", "school-1"), ("location-1",), None, "ineligible"),
        ("dec-needs", (), ("location-1",), None, "needs_override"),
        ("dec-arbitrary", (), ("location-1",), "pol_2222222222222222", "needs_override"),
        ("dec-overridden", (), ("location-1",), override.override_id, "eligible"),
        ("dec-eligible", (), (), None, "eligible"),
    )
    for decision_id, failed, approximate, override_id, outcome in cases:
        decision = decide_eligibility(
            decision_id, "campaign-1", "person-1", "rules-v1", "score-v1",
            failed, approximate, "2026-09-03T00:00:00Z", override_id, connection,
            policy_hash="a" * 64, lane="manual", capability_version="v1",
        )
        assert decision.outcome == outcome
        insert_eligibility_decision(connection, decision)
        assert get_eligibility_decision(connection, decision_id) == decision


def test_27_non_send_operations_forbid_approval() -> None:
    for operation in ("fetch_snapshot", "finder_page", "vendor_lookup", "gmail_draft",
                      "gmail_label", "gmail_thread_refresh"):
        with pytest.raises(ValueError, match="approval_id must be null"):
            validate_exec_request(_request(operation, "apr_1111111111111111"), "T1")
    malformed = (
        ("finder_page", "lane", "manual now"),
        ("finder_page", "lane", "manual;drop"),
        ("vendor_lookup", "provider", "curl"),
        ("gmail_label", "label_code", "Outreach/Sent"),
        ("vendor_lookup", "person_id", "per_123456789012345g"),
        ("vendor_lookup", "campaign_id", "per_1111111111111111"),
        ("gmail_draft", "revision_id", "rev_1111111111111111@token"),
        ("gmail_thread_refresh", "gmail_thread_id", "https://example.test"),
        ("fetch_snapshot", "entity_id", "per_1111111111111111\\x"),
        ("gmail_send", "delivery_id", "req_1111111111111111$cmd"),
    )
    for operation, field, unsafe in malformed:
        request = _request(operation, "apr_1111111111111111" if operation == "gmail_send" else None)
        with pytest.raises(ValueError):
            validate_exec_request(replace(request, payload={**request.payload, field: unsafe}), "T1")


@pytest.mark.parametrize(
    "revision_id",
    ("rev_1111111111111111", "123e4567-e89b-42d3-a456-426614174000"),
)
def test_27a_gmail_draft_accepts_revision_owner_and_legacy_ids(
    revision_id: str,
) -> None:
    request = _request("gmail_draft")
    validate_exec_request(
        replace(request, payload={**request.payload, "revision_id": revision_id}), "T0"
    )


@pytest.mark.parametrize(
    "revision_id",
    (
        "123e4567-e89b-12d3-a456-426614174000",
        "123E4567-E89B-42D3-A456-426614174000",
        "{123e4567-e89b-42d3-a456-426614174000}",
        "123e4567e89b42d3a456426614174000",
        "123e4567-e89b-42d3-7456-426614174000",
    ),
)
def test_27b_gmail_draft_rejects_noncanonical_or_non_v4_revision_uuids(
    revision_id: str,
) -> None:
    request = _request("gmail_draft")
    with pytest.raises(ValueError, match="^revision_id must be a typed opaque ID$"):
        validate_exec_request(
            replace(request, payload={**request.payload, "revision_id": revision_id}),
            "T0",
        )


def test_28_enabled_send_requires_complete_bound_approval(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="approval_id is required"):
        validate_exec_request(_request("gmail_send"), "T1")
    connection = open_store(tmp_path / "send-approval.sqlite")
    _seed_approval_graph(connection)
    _seed_delivery(connection)
    _insert_approval(connection)
    request = _request("gmail_send", "apr_1111111111111111")
    validate_exec_request(request, "T1", connection, "2026-09-03T12:00:00Z")
    with pytest.raises(ValueError, match="approval_policy_hash_mismatch"):
        validate_exec_request(replace(request, policy_hash="d" * 64), "T1", connection, "2026-09-03T12:00:00Z")
    with pytest.raises(ValueError, match="tier_not_enabled"):
        validate_exec_request(request, "T2", connection, "2026-09-03T12:00:00Z")
    mutations = (
        ("approver", "agent:worker"), ("expires_at", "2026-09-02T00:00:00Z"),
        ("consumed_at", "2026-09-03T01:00:00Z"), ("invalidation_reason", "revoked"),
        ("nonce", ""), ("scope_hash", "0" * 64),
    )
    for column, unsafe in mutations:
        original = connection.execute(
            f"SELECT {column} FROM approval WHERE approval_id=?", (request.approval_id,)
        ).fetchone()[0]
        connection.execute(
            f"UPDATE approval SET {column}=? WHERE approval_id=?", (unsafe, request.approval_id)
        )
        with pytest.raises(ValueError, match="approval"):
            validate_exec_request(request, "T1", connection, "2026-09-03T12:00:00Z")
        connection.execute(
            f"UPDATE approval SET {column}=? WHERE approval_id=?", (original, request.approval_id)
        )
    with pytest.raises(ValueError, match="approval"):
        validate_exec_request(
            replace(request, approval_id="apr_9999999999999999"), "T1", connection,
            "2026-09-03T12:00:00Z",
        )
    _insert_approval(
        connection, "apr_2222222222222222", content_kind="reply_template",
        permitted_action="send_preapproved_reply_template", revision_hash="c" * 64,
    )
    with pytest.raises(ValueError, match="approval_content_kind_mismatch"):
        validate_exec_request(
            replace(request, approval_id="apr_2222222222222222"), "T1", connection,
            "2026-09-03T12:00:00Z",
        )
    connection.execute("PRAGMA ignore_check_constraints = ON")
    connection.execute(
        "UPDATE approval SET permitted_action=? WHERE approval_id=?",
        ("send_preapproved_reply_template", request.approval_id),
    )
    connection.execute("PRAGMA ignore_check_constraints = OFF")
    with pytest.raises(ValueError, match="approval_permitted_action_mismatch"):
        validate_exec_request(request, "T1", connection, "2026-09-03T12:00:00Z")


def test_29_send_tiers_are_explicitly_allowlisted(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "send-tiers.sqlite")
    _seed_approval_graph(connection)
    _seed_delivery(connection)
    _insert_approval(connection)
    request = _request("gmail_send", "apr_1111111111111111")
    insert_exec_request(connection, request, "T1", "2026-09-03T12:00:00Z")
    for tier, request_id in (
        ("T0", "req_0000000000000000"),
        ("T2", "req_2222222222222222"),
        ("T3", "req_3333333333333333"),
    ):
        with pytest.raises(ValueError, match="tier_not_enabled"):
            insert_exec_request(
                connection, replace(request, request_id=request_id), tier,
                "2026-09-03T12:00:00Z",
            )


def test_30_insert_exec_request_uses_trusted_now_for_expiry(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "contracts.sqlite")
    _seed_approval_graph(connection)
    _seed_delivery(connection)
    _insert_approval(connection)
    request = _request("gmail_send", "apr_1111111111111111")
    # Expiry inside the send window but before the trusted now: the injected clock, never the wall clock, decides.
    connection.execute(
        "UPDATE approval SET expires_at=? WHERE approval_id=?",
        ("2026-09-03T06:00:00Z", "apr_1111111111111111"),
    )
    connection.commit()
    with pytest.raises(ValueError, match="approval_expired"):
        insert_exec_request(connection, request, "T1", "2026-09-03T12:00:00Z")


def test_31_insert_exec_request_leaves_approval_unconsumed_and_round_trips_json(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "contracts-insert.sqlite")
    _seed_approval_graph(connection)
    _seed_delivery(connection)
    _insert_approval(connection)
    request = _request("gmail_send", "apr_1111111111111111")
    insert_exec_request(connection, request, "T1", "2026-09-03T12:00:00Z")
    assert connection.execute(
        "SELECT consumed_at FROM approval WHERE approval_id=?", (request.approval_id,)
    ).fetchone()[0] is None
    assert connection.execute(
        "SELECT payload FROM exec_request WHERE request_id=?", (request.request_id,)
    ).fetchone()[0] == '{"delivery_id":"req_1111111111111111"}'
    insert_exec_request(
        connection, replace(request, request_id="req_2222222222222222"), "T1",
        "2026-09-03T12:00:00Z",
    )


def test_32_target_policy_rejects_untyped_metadata() -> None:
    base = _policy(Predicate("typed", "title", "associate"))
    mutations = (
        replace(base, predicates=(Predicate("two words", "title", "associate"),)),
        replace(base, extra_fields=("person note",)),
        replace(base, lane_plan=("manual;drop",)),
        replace(base, scorer_version="https://example.test"),
    )
    for policy in mutations:
        with pytest.raises(ValueError):
            validate_target_policy(policy)


def test_33_eligibility_override_revalidates_every_binding(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "override-bindings.sqlite")
    _seed_approval_graph(connection)
    connection.execute(
        "INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
        ("score-v1", "v1", "{}", "f" * 64, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    override = PredicateOverride(
        "pol_1111111111111111", "campaign-1", "a" * 64, "location-1", "manual", "v1",
        "human:daniel", "2026-09-03T00:00:00Z",
    )
    insert_predicate_override(connection, override)
    binding = {"policy_hash": "a" * 64, "lane": "manual", "capability_version": "v1"}
    for changed in (
        {"campaign_id": "campaign-mismatch"}, {"policy_hash": "b" * 64},
        {"predicate": "other"}, {"lane": "pdl"}, {"capability_version": "v2"},
    ):
        decision = decide_eligibility(
            "decision-" + next(iter(changed)), changed.get("campaign_id", "campaign-1"),
            "person-1", "rules-v1", "score-v1", (),
            (changed.get("predicate", "location-1"),), "2026-09-03T00:00:00Z",
            override.override_id, connection,
            policy_hash=changed.get("policy_hash", binding["policy_hash"]),
            lane=changed.get("lane", binding["lane"]),
            capability_version=changed.get("capability_version", binding["capability_version"]),
        )
        assert decision.outcome == "needs_override"
        assert decision.override_id is None
        assert decision.policy_hash is None
        assert decision.lane is None
        assert decision.capability_version is None
        if "campaign_id" not in changed:
            insert_eligibility_decision(connection, decision)
            assert get_eligibility_decision(connection, decision.decision_id) == decision
    valid = decide_eligibility(
        "decision-race", "campaign-1", "person-1", "rules-v1", "score-v1", (),
        ("location-1",), "2026-09-03T00:00:00Z", override.override_id, connection,
        policy_hash="a" * 64, lane="manual", capability_version="v1",
    )
    assert valid.outcome == "eligible"
    missing_override = replace(
        valid,
        decision_id="decision-missing-override",
        override_id=None,
        policy_hash=None,
        lane=None,
        capability_version=None,
    )
    with pytest.raises(sqlite3.IntegrityError, match="eligibility override binding mismatch"):
        insert_eligibility_decision(connection, missing_override)
    connection.execute(
        "UPDATE predicate_override SET capability_version='v2' WHERE override_id=?",
        (override.override_id,),
    )
    with pytest.raises(ValueError, match="binding mismatch"):
        insert_eligibility_decision(connection, valid)


def test_34_exec_request_requires_queued_state_without_reason(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "request-state.sqlite")
    for request in (
        replace(_request("finder_page"), state="succeeded"),
        replace(_request("finder_page"), reason="caller supplied"),
    ):
        with pytest.raises(ValueError, match="queued without a reason"):
            insert_exec_request(connection, request, "T0")


def test_35_predicate_override_and_audit_are_one_transaction(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "override-transaction.sqlite")
    _seed_approval_graph(connection)
    connection.execute(
        """CREATE TRIGGER reject_override_audit BEFORE INSERT ON audit
           WHEN NEW.action='predicate_override'
           BEGIN SELECT RAISE(ABORT, 'synthetic audit rejection'); END"""
    )
    override = PredicateOverride(
        "pol_1111111111111111", "campaign-1", "a" * 64, "location-1", "manual", "v1",
        "human:daniel", "2026-09-03T00:00:00Z",
    )
    with pytest.raises(sqlite3.IntegrityError, match="synthetic audit rejection"):
        insert_predicate_override(connection, override)
    assert connection.execute("SELECT count(*) FROM predicate_override").fetchone()[0] == 0

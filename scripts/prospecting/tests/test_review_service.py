"""Synthetic desktop-local checks for the P10 review service."""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
from types import MappingProxyType
import uuid

import pytest

from scripts.prospecting.affinity.templates_v2 import DraftError, DraftSummary, draft_campaign
from scripts.prospecting.personalizer.qa import QaPolicy, QaResult, SlotBinding
from scripts.prospecting.personalizer.revision import RevisionInput, build_revision
from scripts.prospecting.review_service import (
    CandidateRevision,
    EditDraftRequest,
    EditorialRequest,
    FeedbackRequest,
    ReviewError,
    ReviewService,
)
from scripts.prospecting.review_qa import (
    ReviewQaUnavailable,
    load_revision_qa_context,
    record_revision_qa_context,
)
from scripts.prospecting.store import approval_scope_hash, open_store


NOW = "2026-09-09T12:00:00Z"
ASK = "Would you have 15 minutes for an informational conversation?"
POINT = "Built Example Product"
REVIEW_FIXTURE = json.loads(
    (Path(__file__).parents[3] / "orgs" / "prospecting" / "fixtures" / "review-synthetic.json")
    .read_text(encoding="utf-8")
)["review_service"]


def request_id(index: int) -> str:
    return str(uuid.UUID(int=index))


def insert_campaign(connection: sqlite3.Connection, campaign_id: str, sender: str, mailbox: str) -> None:
    connection.execute(
        "INSERT OR IGNORE INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        (sender, "Example Sender", "Example School", "Example focus", "Example background",
         "Example proof", "[]"),
    )
    connection.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
               template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
               firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (campaign_id, "networking", sender, json.dumps({"minimum_confidence": 0.7}),
         "informational_call", 15, "warm", "networking", '["D0","D6"]',
         '{"weekdays":[1,2,3,4,5]}', "America/New_York", 20, 4, 2, "T3",
         mailbox, "{}", 0, "draft", ("a" if campaign_id.endswith("a") else "b") * 64),
    )


def insert_person(connection: sqlite3.Connection, person_id: str, suffix: str) -> None:
    company_id = "cmp_" + suffix * 16
    observation_id = "obs_" + suffix * 16
    connection.execute(
        "INSERT OR IGNORE INTO company VALUES(?,?,?,?,?,?,?,?,?)",
        (company_id, f"Example {suffix.upper()} LLC", "https://company.example.test", None,
         "Synthetic company", "software", "Example", "manual", "company-" + suffix),
    )
    connection.execute(
        "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
        (person_id, "Synthetic", f"Synthetic Person {suffix.upper()}",
         "https://profile.example.test/" + suffix, "Example", "Synthetic fixture", "manual", "person-" + suffix),
    )
    connection.execute(
        "INSERT INTO source_snapshot VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (observation_id, person_id, "https://source.example.test/" + suffix, "example.test", NOW,
         "text/html", suffix * 64, "fixture-v1", "local-ref", "2099-01-01T00:00:00Z", "2099-02-01T00:00:00Z"),
    )
    connection.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("source_" + suffix, "employment", person_id, "title", '"Example Lead"', "fixture", NOW,
         NOW, 1.0, observation_id),
    )
    connection.execute(
        "INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)",
        ("emp_" + suffix, person_id, company_id, "Example Lead", "2026-01-01", None,
         "source_" + suffix, 1.0),
    )


def insert_revision(connection: sqlite3.Connection, campaign_id: str, person_id: str, evidence_id: str):
    revision = build_revision(connection, RevisionInput(
        person_id, campaign_id, 0, "Example subject",
        f"Hello. {POINT}. {ASK}", "why_them", "bespoke", None, ASK,
        (evidence_id,), (POINT,), (), "networking", 1, "fixture-prompt", "fixture-model",
        QaResult(True, 100, {"fixture": True}, ()),
    ))
    record_revision_qa_context(
        connection, revision.revision_id,
        {"why_them": SlotBinding(POINT, "evidence", evidence_id),
         "ask": SlotBinding(ASK, "policy", "policy.ask")},
        QaPolicy("networking", 0, "informational_call", 1, 120, 0.7),
        inherited_from_revision_id=None, created_at=NOW,
    )
    return revision


@pytest.fixture
def database(tmp_path: Path) -> tuple[Path, sqlite3.Connection, dict[str, str]]:
    path = tmp_path / "review.sqlite"
    connection = open_store(path)
    insert_campaign(connection, "campaign-a", "sender-a", "mailbox-a")
    insert_campaign(connection, "campaign-b", "sender-b", "mailbox-b")
    for suffix in "abcde":
        insert_person(connection, "person-" + suffix, suffix)
    connection.execute("INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
                       ("score-version", "v1", "{}", "c" * 64, NOW, NOW))
    for index, person_id in enumerate(("person-a", "person-b", "person-c", "person-d", "person-e")):
        connection.execute("INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)",
                           ("score-" + person_id, "campaign-a", person_id, "score-version",
                            90 - index, "{}", NOW))
    connection.executemany(
        """INSERT INTO eligibility_decision(
               decision_id,campaign_id,person_id,rule_version,fit_score_version_id,outcome,
               failed_predicate_ids,approximate_predicate_ids,decided_at
           ) VALUES(?,?,?,?,?,?,?,?,?)""",
        [
            ("decision-a", "campaign-a", "person-a", "v1", "score-version", "eligible", "[]", "[]", NOW),
            ("decision-b", "campaign-a", "person-b", "v1", "score-version", "eligible", "[]", "[]", NOW),
            ("decision-c", "campaign-a", "person-c", "v1", "score-version", "eligible", "[]", "[]", NOW),
            ("decision-e-old", "campaign-a", "person-e", "v1", "score-version", "eligible", "[]", "[]", "2026-09-08T12:00:00Z"),
            ("decision-e-new", "campaign-a", "person-e", "v1", "score-version", "ineligible", '["blocked"]', "[]", NOW),
            ("decision-other", "campaign-b", "person-a", "v1", "score-version", "ineligible", '["other"]', "[]", "2099-01-01T00:00:00Z"),
        ],
    )
    connection.execute("INSERT INTO fill_person VALUES(?,?,?,?,?)",
                       ("campaign-a", "person-a", "cmp_" + "a" * 16, 0, NOW))
    connection.executemany(
        """INSERT INTO contact_point(
               contact_id,person_id,employer_company_id,email,provider,adapter_version,
               retrieved_at,verified_at,state,confidence,bounce_history
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        [
            ("contact-a", "person-a", "cmp_" + "a" * 16, REVIEW_FIXTURE["contact_a"], "manual", "fixture", NOW, NOW, "valid", 1.0, 0),
            ("contact-b-old", "person-b", "cmp_" + "b" * 16, REVIEW_FIXTURE["contact_b_old"], "manual", "fixture", "2026-09-07T12:00:00Z", "2026-09-07T12:00:00Z", "valid", 1.0, 0),
            ("contact-b-new", "person-b", "cmp_" + "b" * 16, REVIEW_FIXTURE["contact_b_new"], "manual", "fixture", NOW, NOW, "invalid", 1.0, 0),
            ("contact-c", "person-c", "cmp_" + "c" * 16, REVIEW_FIXTURE["contact_c"], "manual", "fixture", NOW, NOW, "valid", 1.0, 0),
        ],
    )
    for person_id, suffix in (("person-a", "a"), ("person-b", "b")):
        connection.execute(
            "INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?)",
            ("evidence-" + suffix, person_id, POINT + " for synthetic teams",
             "https://source.example.test/" + suffix, NOW, NOW, "Synthetic excerpt", 1.0,
             "2099-01-01T00:00:00Z", 1),
        )
    revision_a = insert_revision(connection, "campaign-a", "person-a", "evidence-a")
    revision_b = insert_revision(connection, "campaign-b", "person-b", "evidence-b")
    connection.commit()
    return path, connection, {"a": revision_a.revision_id, "a_hash": revision_a.revision_hash,
                              "b": revision_b.revision_id, "b_hash": revision_b.revision_hash}


def insert_approval(
    connection: sqlite3.Connection,
    revision_hash_value: str,
    *,
    approval_id: str = "approval-a",
    scope_hash_value: str | None = None,
) -> None:
    fields = {
        "assertion_ref": "fixture",
        "campaign_id": "campaign-a",
        "policy_hash": "a" * 64,
        "content_kind": "revision",
        "revision_hash": revision_hash_value,
        "contact_id": "contact-a",
        "mailbox_id": "mailbox-a",
        "approver": "human:fixture",
        "approved_at": "2026-09-08T12:00:00Z",
        "expires_at": "2026-09-10T12:00:00Z",
        "tier": "T3",
        "send_window": json.dumps({
            "start": "2026-09-08T12:00:00Z", "end": "2026-09-10T12:00:00Z"
        }, sort_keys=True, separators=(",", ":")),
        "nonce": "nonce-a",
        "permitted_action": "send_revision",
    }
    connection.execute(
        """INSERT INTO approval(
               approval_id,assertion_ref,campaign_id,policy_hash,content_kind,revision_hash,
               contact_id,mailbox_id,approver,approved_at,expires_at,tier,send_window,nonce,
               permitted_action,scope_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (approval_id, *(fields[key] for key in fields),
         scope_hash_value or approval_scope_hash(fields)),
    )


def test_people_projection_is_campaign_scoped_and_uses_latest_owner_state(database) -> None:
    _path, connection, _ids = database
    connection.execute(
        """INSERT INTO contact_point(
               contact_id,person_id,employer_company_id,email,provider,adapter_version,
               retrieved_at,verified_at,state,confidence,bounce_history
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        ("contact-e", "person-e", "cmp_" + "e" * 16, REVIEW_FIXTURE["contact_e"], "manual",
         "fixture", NOW, NOW, "valid", 1.0, 0),
    )
    people = {item.person_id: item for item in ReviewService(connection, now=lambda: NOW).list_people("campaign-a")}
    assert people["person-a"].state == "selected"
    assert people["person-b"].state == "qualified"
    assert people["person-b"].contact_state == "invalid"
    assert people["person-c"].state == "contactable"
    assert people["person-d"].state == "discovered"
    assert people["person-e"].eligibility_state == "ineligible"
    assert people["person-e"].state == "discovered"
    assert set(people) == {"person-a", "person-b", "person-c", "person-d", "person-e"}
    assert ReviewService(connection).get_person("campaign-b", "person-a").eligibility_state == "ineligible"
    with pytest.raises(ReviewError, match="person_missing"):
        ReviewService(connection).get_person("campaign-b", "person-c")


def test_campaign_and_draft_projections_do_not_mix_campaigns(database) -> None:
    _path, connection, ids = database
    service = ReviewService(connection, now=lambda: NOW)
    campaigns = {item.campaign_id: item for item in service.list_campaigns()}
    assert set(campaigns) == {"campaign-a", "campaign-b"}
    assert campaigns["campaign-a"].people_count == 5
    assert campaigns["campaign-b"].people_count == 2
    assert [item.revision_id for item in service.list_drafts("campaign-a")] == [ids["a"]]
    evidence = service.get_draft("campaign-a", ids["a"]).evidence
    assert [(item.evidence_id, item.claim, item.url, item.observed_at) for item in evidence] == [
        ("evidence-a", POINT + " for synthetic teams", "https://source.example.test/a", NOW)
    ]
    assert [item.revision_id for item in service.list_drafts("campaign-b")] == [ids["b"]]
    with pytest.raises(ReviewError, match="draft_missing"):
        service.get_draft("campaign-b", ids["a"])

    connection.execute(
        "UPDATE evidence SET observed_at=NULL WHERE evidence_id='evidence-a'"
    )
    assert service.get_draft("campaign-a", ids["a"]).evidence[0].observed_at is None


@pytest.mark.parametrize("evidence_ids", ['["evidence-b"]', '["bad id"]'])
def test_draft_evidence_refuses_cross_person_or_malformed_ids(database, evidence_ids: str) -> None:
    _path, connection, ids = database
    connection.execute(
        """INSERT INTO revision(
               revision_id,person_id,campaign_id,step,subject,body,angle,generation_mode,
               purpose,ask,evidence_ids,recipient_relevance_points,sender_proof_points,
               template_id,template_version,prompt_version,model_version,qa,hash)
           SELECT 'revision-corrupt',person_id,campaign_id,step,subject,body,angle,
                  generation_mode,purpose,ask,?,recipient_relevance_points,
                  sender_proof_points,template_id,template_version,prompt_version,
                  model_version,qa,?
             FROM revision WHERE revision_id=?""",
        (evidence_ids, "f" * 64, ids["a"]),
    )
    with pytest.raises(ReviewError, match="^store_state_invalid$"):
        ReviewService(connection).get_draft("campaign-a", "revision-corrupt")


def test_valid_human_edit_uses_real_qa_owner_and_does_not_inherit_authority(database) -> None:
    _path, connection, ids = database
    service = ReviewService(connection, now=lambda: NOW)
    service.set_editorial_ready(EditorialRequest(request_id(1), "campaign-a", ids["a"], True))
    insert_approval(connection, ids["a_hash"])
    connection.commit()
    assert service.get_draft("campaign-a", ids["a"]).approval_state == "approved"
    result = service.edit_draft(EditDraftRequest(
        request_id(2), "campaign-a", ids["a"], "Revised synthetic subject",
        f"Hello. {POINT}. This edit remains based on the same synthetic evidence. {ASK}",
    ))
    assert result.state == "revision_created"
    assert result.revision_id != ids["a"]
    lineage = connection.execute(
        "SELECT parent_revision_id FROM review_revision_lineage WHERE child_revision_id=?",
        (result.revision_id,),
    ).fetchone()
    assert lineage[0] == ids["a"]
    current = service.get_draft("campaign-a", result.revision_id)
    assert current.subject == "Revised synthetic subject"
    assert current.editorial_state == "review_required"
    assert current.approval_state == "missing"
    inherited = load_revision_qa_context(connection, result.revision_id)
    assert inherited.inherited_from_revision_id == ids["a"]

    service.set_editorial_ready(EditorialRequest(
        request_id(19), "campaign-a", result.revision_id, True
    ))
    second = service.edit_draft(EditDraftRequest(
        request_id(20), "campaign-a", result.revision_id, "Second synthetic subject",
        f"Hello. {POINT}. This second edit keeps the same synthetic evidence. {ASK}",
    ))
    assert second.state == "revision_created"
    second_context = load_revision_qa_context(connection, second.revision_id)
    assert second_context.inherited_from_revision_id == result.revision_id
    final = service.get_draft("campaign-a", second.revision_id)
    assert final.editorial_state == "review_required"
    assert (final.approval_state, final.approval_id) == ("missing", None)


def test_pending_candidate_masks_valid_parent_approval(database) -> None:
    _path, connection, ids = database
    insert_approval(connection, ids["a_hash"])
    service = ReviewService(connection, now=lambda: NOW)
    assert service.get_draft("campaign-a", ids["a"]).approval_state == "approved"
    pending = service.edit_draft(EditDraftRequest(
        request_id(18), "campaign-a", ids["a"], "Saved candidate", "Saved candidate body"
    ))
    draft = service.get_draft("campaign-a", ids["a"])
    assert draft.candidate_id == pending.candidate_id
    assert (draft.approval_state, draft.approval_id) == ("missing", None)
    assert draft.candidate_history[0].is_current_parent


@pytest.mark.parametrize("bad_scope,contact_state", [(True, "valid"), (False, "invalid")])
def test_approval_projection_rejects_invalid_scope_or_contact(
    database, bad_scope: bool, contact_state: str
) -> None:
    _path, connection, ids = database
    insert_approval(
        connection, ids["a_hash"], scope_hash_value="d" * 64 if bad_scope else None
    )
    connection.execute("UPDATE contact_point SET state=? WHERE contact_id='contact-a'", (contact_state,))
    assert ReviewService(connection, now=lambda: NOW).get_draft(
        "campaign-a", ids["a"]
    ).approval_state == "missing"


def test_default_edit_persists_pending_candidate_and_replays_after_restart(database) -> None:
    path, connection, ids = database
    legacy = build_revision(connection, RevisionInput(
        "person-a", "campaign-a", 0, "Legacy head",
        f"Hello. {POINT}. Legacy source without stored bindings. {ASK}",
        "why_them", "bespoke", None, ASK, ("evidence-a",), (POINT,), (),
        "networking", 1, "legacy-prompt", "legacy-model",
        QaResult(True, 100, {"legacy": True}, ()),
    ))
    connection.commit()
    service = ReviewService(connection, now=lambda: NOW)
    request = EditDraftRequest(
        request_id(3), "campaign-a", legacy.revision_id,
        "Pending subject", "Pending synthetic body"
    )
    before = connection.execute(
        "SELECT count(*) FROM revision WHERE campaign_id='campaign-a'"
    ).fetchone()[0]
    first = service.edit_draft(request)
    assert first.state == "pending_qa"
    assert connection.execute(
        "SELECT count(*) FROM revision WHERE campaign_id='campaign-a'"
    ).fetchone()[0] == before
    connection.close()
    reopened = open_store(path)
    retry = ReviewService(reopened, now=lambda: NOW).edit_draft(request)
    assert retry.replayed and retry.candidate_id == first.candidate_id
    assert ReviewService(reopened).get_draft(
        "campaign-a", legacy.revision_id
    ).candidate_body == "Pending synthetic body"
    with pytest.raises(ReviewError, match="request_conflict"):
        ReviewService(reopened).edit_draft(EditDraftRequest(
            request.request_id, "campaign-a", legacy.revision_id, "Different", "Different body"
        ))
    with pytest.raises(ReviewError, match="candidate_conflict"):
        ReviewService(reopened).edit_draft(EditDraftRequest(
            request_id(4), "campaign-a", legacy.revision_id, "Another", "Another body"
        ))
    replacement = ReviewService(reopened).edit_draft(EditDraftRequest(
        request_id(4), "campaign-a", legacy.revision_id,
        "Another", "Another body", first.candidate_id
    ))
    assert replacement.state == "pending_qa" and replacement.candidate_id != first.candidate_id
    assert reopened.execute("SELECT count(*) FROM review_candidate").fetchone()[0] == 2


def test_equal_hash_legacy_child_is_refused_without_context_backfill(database) -> None:
    _path, connection, ids = database
    legacy = build_revision(connection, RevisionInput(
        "person-a", "campaign-a", 0, "Collision target",
        f"Hello. {POINT}. Collision target copy. {ASK}", "why_them", "bespoke", None,
        ASK, ("evidence-a",), (POINT,), (), "networking", 1, "fixture-prompt",
        "fixture-model", QaResult(True, 100, {"legacy": True}, ()),
    ))
    current = build_revision(connection, RevisionInput(
        "person-a", "campaign-a", 0, "Current source",
        f"Hello. {POINT}. Current source copy. {ASK}", "why_them", "bespoke", None,
        ASK, ("evidence-a",), (POINT,), (), "networking", 1, "fixture-prompt",
        "fixture-model", QaResult(True, 100, {"current": True}, ()),
    ))
    record_revision_qa_context(
        connection, current.revision_id,
        {"why_them": SlotBinding(POINT, "evidence", "evidence-a"),
         "ask": SlotBinding(ASK, "policy", "policy.ask")},
        QaPolicy("networking", 0, "informational_call", 1, 120, 0.7),
        inherited_from_revision_id=None, created_at=NOW,
    )
    result = ReviewService(connection, now=lambda: NOW).edit_draft(EditDraftRequest(
        request_id(21), "campaign-a", current.revision_id, "Collision target",
        f"Hello. {POINT}. Collision target copy. {ASK}",
    ))
    assert result.state == "qa_failed" and result.failure_codes == ("revision_duplicate",)
    with pytest.raises(ReviewQaUnavailable, match="^qa_context_missing$"):
        load_revision_qa_context(connection, legacy.revision_id)


def test_failed_authentic_qa_preserves_candidate_with_fixed_failure_codes(database) -> None:
    _path, connection, ids = database
    service = ReviewService(connection, now=lambda: NOW)
    result = service.edit_draft(EditDraftRequest(
        request_id(5), "campaign-a", ids["a"], "Bad synthetic subject", "This omits evidence and the ask."
    ))
    assert result.state == "qa_failed"
    assert "slot_value_missing" in result.failure_codes
    assert connection.execute("SELECT count(*) FROM review_candidate").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM review_revision_lineage").fetchone()[0] == 0


def test_feedback_records_one_pending_attempt_without_revision_or_network(database) -> None:
    _path, connection, ids = database
    service = ReviewService(connection, now=lambda: NOW)
    before = connection.execute("SELECT count(*) FROM revision").fetchone()[0]
    request = FeedbackRequest(request_id(6), "campaign-a", ids["a"], "tone", ("warmer",), "Use a warmer opening.")
    first = service.request_feedback(request)
    second = service.request_feedback(request)
    assert first.state == "pending" and second.replayed
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == before
    assert connection.execute("SELECT attempt_state FROM draft_feedback").fetchone()[0] == "pending"
    with pytest.raises(ReviewError, match="feedback_already_requested"):
        service.request_feedback(FeedbackRequest(request_id(7), "campaign-a", ids["a"], "tone"))


def test_expected_revision_and_campaign_scope_are_enforced_before_mutation(database) -> None:
    _path, connection, ids = database
    service = ReviewService(connection, now=lambda: NOW)
    with pytest.raises(ReviewError, match="draft_missing"):
        service.edit_draft(EditDraftRequest(request_id(8), "campaign-a", ids["b"], "No", "No body"))
    created = service.edit_draft(EditDraftRequest(
        request_id(9), "campaign-a", ids["a"], "Current synthetic subject",
        f"Hello. {POINT}. This remains a synthetic edit. {ASK}",
    ))
    with pytest.raises(ReviewError, match="revision_conflict"):
        service.set_editorial_ready(EditorialRequest(request_id(10), "campaign-a", ids["a"], True))
    assert created.state == "revision_created"
    assert connection.execute("SELECT count(*) FROM draft_editorial_event").fetchone()[0] == 0


def test_external_canonical_revision_change_blocks_pending_candidate_replacement(database) -> None:
    _path, connection, ids = database
    service = ReviewService(connection, now=lambda: NOW)
    pending = service.edit_draft(EditDraftRequest(
        request_id(16), "campaign-a", ids["a"], "Pending", "Pending synthetic body"
    ))
    external = build_revision(connection, RevisionInput(
        "person-a", "campaign-a", 0, "External canonical",
        f"Hello. {POINT}. External owner revision. {ASK}", "why_them", "bespoke", None,
        ASK, ("evidence-a",), (POINT,), (), "networking", 1, "fixture-prompt",
        "external-owner", QaResult(True, 100, {"fixture": True}, ()),
    ))
    connection.commit()
    with pytest.raises(ReviewError, match="revision_conflict"):
        service.edit_draft(EditDraftRequest(
            request_id(17), "campaign-a", ids["a"], "Replacement", "Replacement body",
            pending.candidate_id,
        ))
    draft = service.get_draft("campaign-a", external.revision_id)
    assert draft.subject == "External canonical"
    assert draft.candidate_id is None
    assert len(draft.candidate_history) == 1
    saved = draft.candidate_history[0]
    assert saved.candidate_id == pending.candidate_id
    assert saved.subject == "Pending" and saved.body == "Pending synthetic body"
    assert saved.parent_revision_id == ids["a"] and not saved.is_current_parent


def test_schedule_and_activity_are_read_only_and_campaign_scoped(database) -> None:
    _path, connection, ids = database
    connection.execute("INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
                       ("enrollment-a", "campaign-a", "person-a", 0, NOW, "scheduled", None, None, None))
    connection.execute("INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
                       ("enrollment-b", "campaign-b", "person-b", 0, NOW, "scheduled", None, None, None))
    for suffix, campaign, enrollment, digest, contact, mailbox in (
        ("a", "campaign-a", "enrollment-a", ids["a_hash"], "contact-a", "mailbox-a"),
        ("b", "campaign-b", "enrollment-b", ids["b_hash"], "contact-b-old", "mailbox-b"),
    ):
        connection.execute(
            "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("delivery-" + suffix, campaign, enrollment, 0, digest, contact, mailbox,
             suffix * 64, None, None, REVIEW_FIXTURE["delivery_message_ids"][suffix], NOW, None, None, "reserved"),
        )
        connection.execute("INSERT INTO audit(event_id,actor,action,entity_type,entity_id,at,reason) VALUES(?,?,?,?,?,?,?)",
                           ("audit-" + suffix, "human:fixture", "inspect", "campaign", campaign, NOW, "fixture"))
    connection.commit()
    service = ReviewService(connection, now=lambda: NOW)
    schedule = service.list_schedule("campaign-a")
    assert [item.delivery_id for item in schedule] == ["delivery-a"]
    assert schedule[0].cadence == ("D0", "D6")
    activity = service.list_activity("campaign-a")
    assert [item.event_id for item in activity] == ["audit-a"]
    assert connection.execute("SELECT count(*) FROM delivery").fetchone()[0] == 2


def test_schedule_does_not_project_revision_from_another_person_or_step(database) -> None:
    _path, connection, ids = database
    connection.execute(
        "INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
        ("enrollment-a", "campaign-a", "person-a", 0, NOW, "scheduled", None, None, None),
    )
    connection.execute(
        "INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("evidence-c", "person-c", POINT, "https://source.example.test/c", NOW, NOW,
         "Synthetic excerpt", 1.0, "2099-01-01T00:00:00Z", 1),
    )
    other_person = insert_revision(connection, "campaign-a", "person-c", "evidence-c")
    connection.execute(
        "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("delivery-mismatched", "campaign-a", "enrollment-a", 0,
         other_person.revision_hash, "contact-a", "mailbox-a", "c" * 64,
         None, None, REVIEW_FIXTURE["mismatched_message_id"], NOW, None, None, "reserved"),
    )
    assert ReviewService(connection, now=lambda: NOW).list_schedule("campaign-a") == ()


@pytest.mark.parametrize(
    "call,code",
    [
        (lambda service, ids: service.edit_draft(EditDraftRequest("not-a-uuid", "campaign-a", ids["a"], "S", "B")), "invalid_request_id"),
        (lambda service, ids: service.edit_draft(EditDraftRequest(request_id(11), "campaign-a", ids["a"], "line\nbreak", "B")), "invalid_subject"),
        (lambda service, ids: service.request_feedback(FeedbackRequest(request_id(12), "campaign-a", ids["a"], "unknown")), "invalid_disposition"),
        (lambda service, ids: service.set_editorial_ready(EditorialRequest(request_id(13), "campaign-a", ids["a"], 1)), "invalid_ready"),
    ],
)
def test_invalid_inputs_fail_with_fixed_codes_and_no_writes(database, call, code) -> None:
    _path, connection, ids = database
    service = ReviewService(connection, now=lambda: NOW)
    with pytest.raises(ReviewError, match=f"^{code}$"):
        call(service, ids)
    assert connection.execute("SELECT count(*) FROM review_request").fetchone()[0] == 0


def test_mailbox_choices_are_saved_only_and_empty_store_is_explicit(tmp_path: Path, database) -> None:
    _path, connection, _ids = database
    assert ReviewService(connection).list_mailboxes() == ("mailbox-a", "mailbox-b")
    empty = open_store(tmp_path / "empty.sqlite")
    assert ReviewService(empty).list_mailboxes() == ()


def test_prepare_drafts_delegates_fixed_step_and_returns_bounded_aggregate(database) -> None:
    _path, connection, _ids = database
    calls: list[tuple[str, int]] = []

    def prepare(campaign_id: str, step: int) -> DraftSummary:
        calls.append((campaign_id, step))
        return DraftSummary(3, 1, 1, 1, 2, MappingProxyType({"qa_failed": 1}))

    result = ReviewService(connection, prepare_adapter=prepare).prepare_drafts("campaign-a")
    assert calls == [("campaign-a", 0)]
    assert result.campaign_id == "campaign-a" and result.step == 0
    assert (result.candidates, result.revisions_created, result.out_of_band,
            result.qa_failed, result.slots_clamped) == (3, 1, 1, 1, 2)
    assert result.failure_codes == (("qa_failed", 1),)


@pytest.mark.parametrize(
    "service,campaign,step,code",
    [
        (lambda connection: ReviewService(connection), "campaign-a", 0, "prepare_unavailable"),
        (lambda connection: ReviewService(connection, prepare_adapter=lambda *_: None),
         "campaign-a", 0, "prepare_failed"),
        (lambda connection: ReviewService(connection, prepare_adapter=lambda *_: None),
         "campaign-a", True, "invalid_prepare_step"),
        (lambda connection: ReviewService(connection, prepare_adapter=lambda *_: None),
         "campaign-a", 1, "prepare_step_unsupported"),
        (lambda connection: ReviewService(connection, prepare_adapter=lambda *_: None),
         "campaign-missing", 0, "campaign_missing"),
    ],
)
def test_prepare_drafts_refuses_unavailable_invalid_or_unscoped_calls(
    database, service, campaign: str, step: int, code: str
) -> None:
    _path, connection, _ids = database
    with pytest.raises(ReviewError, match=f"^{code}$"):
        service(connection).prepare_drafts(campaign, step)


@pytest.mark.parametrize("code", [
    "sender_anchors_missing", "sender_profile_invalid", "approved_fit_spec_missing",
    "approved_fit_spec_invalid", "campaign_not_draft", "copy_profile_missing",
    "copy_profile_invalid", "intent_unsupported", "ask_type_unsupported",
    "ask_minutes_unsupported",
])
def test_prepare_drafts_preserves_only_closed_domain_blockers(database, code: str) -> None:
    _path, connection, _ids = database

    def blocked(*_args):
        raise DraftError(code)

    with pytest.raises(ReviewError, match=f"^{code}$"):
        ReviewService(connection, prepare_adapter=blocked).prepare_drafts("campaign-a")


def test_prepare_drafts_masks_arbitrary_dependency_error(database) -> None:
    _path, connection, _ids = database

    def unsafe(*_args):
        raise DraftError("unsafe raw detail")

    with pytest.raises(ReviewError, match="^prepare_failed$"):
        ReviewService(connection, prepare_adapter=unsafe).prepare_drafts("campaign-a")


def test_prepare_drafts_runs_actual_p8_owner_with_persisted_qa_context(
    tmp_path: Path, monkeypatch
) -> None:
    from scripts.prospecting.tests.test_affinity_templates_v2 import (
        NOW as P8_NOW,
        _draft_ready_fixture,
    )

    connection, _person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    service = ReviewService(
        connection,
        prepare_adapter=lambda selected_campaign, step: draft_campaign(
            connection, selected_campaign, step, anchors=object(), now=P8_NOW
        ),
    )
    result = service.prepare_drafts(campaign_id)
    assert (result.candidates, result.revisions_created, result.qa_failed) == (1, 1, 0)
    assert result.failure_codes == ()
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 1


def test_p10_rows_are_immutable_and_schema_rejects_cross_campaign_parent(database) -> None:
    _path, connection, ids = database
    result = ReviewService(connection, now=lambda: NOW).edit_draft(EditDraftRequest(
        request_id(14), "campaign-a", ids["a"], "Immutable", "Immutable synthetic body"
    ))
    with pytest.raises(sqlite3.IntegrityError, match="review_candidate_immutable"):
        connection.execute("UPDATE review_candidate SET subject='changed' WHERE candidate_id=?",
                           (result.candidate_id,))
    with pytest.raises(sqlite3.IntegrityError, match="review_candidate_scope"):
        connection.execute(
            """INSERT INTO review_candidate(
                   candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
                   subject,body,qa_state,qa_json,created_at
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            ("candidate-cross", request_id(15), "campaign-b", "person-a", 0, ids["a"],
             "Synthetic", "Synthetic", "pending_qa", None, NOW),
        )

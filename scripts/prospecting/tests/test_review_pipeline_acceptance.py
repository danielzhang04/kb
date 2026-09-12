"""One synthetic acceptance path from campaign creation through a T0 Gmail draft.

There is no sanctioned T0-to-T1 campaign transition. This test therefore ends at
the product's supported draft boundary; the separate T1 fixtures do not establish
same-record send authority for a campaign created by CampaignService.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import uuid

import pytest

import scripts.prospecting.cli as cli_module
import scripts.prospecting.campaigner.schedule as schedule_module
import scripts.prospecting.executor_campaigner as executor_campaigner_module
from scripts.prospecting.affinity.fitspec import (
    approve_fit_spec,
    store_proposed,
)
from scripts.prospecting.affinity.score import Affinity
from scripts.prospecting.affinity.templates_v2 import draft_campaign
from scripts.prospecting.campaigner.fake_gmail import ArrivalPoint, FakeGmail
from scripts.prospecting.campaigner.schedule import EnrollmentInput, enroll_revision
from scripts.prospecting.cli import apply_override
from scripts.prospecting.executor import Executor
from scripts.prospecting.executor_campaigner import build_live_service
from scripts.prospecting.manager.campaigns import CampaignService
from scripts.prospecting.p2_store import compile_target_policy
from scripts.prospecting.review_service import (
    EditDraftRequest,
    EditorialRequest,
    FeedbackRequest,
    ReviewError,
    ReviewService,
)
from scripts.prospecting.scorer import (
    ensure_fit_score_v1,
    score_person,
    write_eligibility,
)
from scripts.prospecting.store import approval_scope_hash
from scripts.prospecting.tests.test_affinity_evidence_bridge import _scored_person


CAMPAIGN_ID = "camp_0000000000000001"
PERSON_ID = "per_0000000000000001"
COMPANY_ID = "cmp_0000000000000001"
CONTACT_ID = "cp_0000000000000001"
PROFILE_ID = "22222222-2222-4222-8222-222222222222"
MAILBOX_ID = "pol_0000000000000001"
NOW = datetime(2099, 12, 10, 15, tzinfo=UTC)
REVIEW_FIXTURE = json.loads(
    (Path(__file__).parents[3] / "orgs" / "prospecting" / "fixtures" / "review-synthetic.json")
    .read_text(encoding="utf-8")
)["review_pipeline"]


def _request_id(index: int) -> str:
    return str(uuid.UUID(int=index))


def _insert_revision_approval(
    connection,
    revision_hash: str,
    *,
    approval_id: str,
    nonce: str,
    approved_at: datetime,
    expires_at: datetime,
) -> None:
    window = json.dumps(
        {"start": approved_at.isoformat(), "end": expires_at.isoformat()},
        sort_keys=True,
        separators=(",", ":"),
    )
    values = {
        "assertion_ref": "synthetic-review-acceptance",
        "campaign_id": CAMPAIGN_ID,
        "policy_hash": connection.execute(
            "SELECT policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ID,)
        ).fetchone()[0],
        "content_kind": "revision",
        "revision_hash": revision_hash,
        "contact_id": CONTACT_ID,
        "mailbox_id": MAILBOX_ID,
        "approver": "human:fixture",
        "approved_at": approved_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "tier": "T0",
        "send_window": window,
        "nonce": nonce,
        "permitted_action": "send_revision",
    }
    connection.execute(
        """INSERT INTO approval(
               approval_id,assertion_ref,campaign_id,policy_hash,content_kind,
               revision_hash,contact_id,mailbox_id,approver,approved_at,expires_at,
               tier,send_window,nonce,permitted_action,scope_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (approval_id, *(values[key] for key in values), approval_scope_hash(values)),
    )


def _activate_with_synthetic_human_approval(connection, monkeypatch) -> None:
    policy_hash = connection.execute(
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (CAMPAIGN_ID,)
    ).fetchone()[0]
    approved_at = datetime(2026, 1, 1, tzinfo=UTC).isoformat()
    expires_at = datetime(2100, 1, 1, tzinfo=UTC).isoformat()
    values = {
        "assertion_ref": "synthetic-campaign-activation",
        "campaign_id": CAMPAIGN_ID,
        "policy_hash": policy_hash,
        "content_kind": "campaign_policy",
        "revision_hash": None,
        "contact_id": None,
        "mailbox_id": None,
        "approver": "human:fixture",
        "approved_at": approved_at,
        "expires_at": expires_at,
        "tier": "T0",
        "send_window": "{}",
        "nonce": "synthetic-campaign-activation",
        "permitted_action": "activate_campaign",
    }
    connection.execute(
        """INSERT INTO approval(
               approval_id,assertion_ref,campaign_id,policy_hash,content_kind,
               revision_hash,contact_id,mailbox_id,approver,approved_at,expires_at,
               tier,send_window,nonce,permitted_action,scope_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            "apr_0000000000000004",
            *(values[key] for key in values),
            approval_scope_hash(values),
        ),
    )
    monkeypatch.setattr(cli_module, "_human_actor", lambda: "human:fixture")
    apply_override(
        connection, "status", CAMPAIGN_ID, NOW.isoformat(), status="approved"
    )
    apply_override(
        connection, "status", CAMPAIGN_ID, NOW.isoformat(), status="active"
    )


def _drain(executor: Executor) -> None:
    while executor.process_one():
        pass


def test_reviewed_t0_campaign_creates_one_draft_and_reply_stops_followup(
    tmp_path: Path, monkeypatch,
) -> None:
    # This legacy acceptance fixture exercises campaign/reply mechanics and has
    # no P15/P16 run. Genuine P16 consumer success and races are covered by the
    # focused review, approval, schedule, and campaigner-release tests.
    monkeypatch.setattr(schedule_module, "_require_revision_ready", lambda *_args: None)
    monkeypatch.setattr(executor_campaigner_module, "_revision_ready", lambda *_args: True)
    # Reuse the checked-in P8 evidence fixture, replacing only its raw campaign
    # row so the same record starts at the real CampaignService boundary.
    connection, person_id, fixture_campaign, affinity = _scored_person(
        tmp_path, monkeypatch
    )
    assert (person_id, fixture_campaign) == (PERSON_ID, CAMPAIGN_ID)
    connection.execute(
        "DELETE FROM person_affinity WHERE person_id=? AND campaign_id=?",
        (PERSON_ID, CAMPAIGN_ID),
    )
    connection.execute("DELETE FROM campaign WHERE campaign_id=?", (CAMPAIGN_ID,))
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        (
            PROFILE_ID,
            "Synthetic Sender",
            None,
            "I study synthetic operating decisions.",
            "Synthetic background",
            "I built a verified synthetic operating project.",
            "[]",
        ),
    )
    session = CampaignService(
        connection,
        campaign_id_factory=lambda: CAMPAIGN_ID,
        now=lambda: NOW.isoformat(),
    ).create(
        request_id=_request_id(1),
        brief_text=(
            "intent:networking lane:manual people-count:1 "
            "send-window:00:00-23:59 timezone:UTC"
        ),
        sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID,
        require_first_draft_compatible=True,
    )
    assert session.created and session.campaign_id == CAMPAIGN_ID
    assert tuple(connection.execute(
        "SELECT approval_tier,status FROM campaign WHERE campaign_id=?",
        (CAMPAIGN_ID,),
    ).fetchone()) == ("T0", "draft")

    fit_fixture = (
        Path(__file__).parents[3]
        / "orgs/prospecting/fixtures/affinity/fit-specs.json"
    )
    fit_spec = json.loads(fit_fixture.read_text(encoding="utf-8"))["minimal"]
    fit_hash = store_proposed(connection, CAMPAIGN_ID, fit_spec, NOW.isoformat())
    approve_fit_spec(
        connection, CAMPAIGN_ID, fit_hash, "human:fixture", NOW.isoformat()
    )
    current_affinity = Affinity(
        PERSON_ID, CAMPAIGN_ID, affinity.score, affinity.signals, fit_hash
    )
    connection.execute(
        "INSERT INTO person_affinity VALUES(?,?,?,?,?,?)",
        (
            PERSON_ID,
            CAMPAIGN_ID,
            current_affinity.score,
            json.dumps(
                [signal.__dict__ for signal in current_affinity.signals],
                sort_keys=True,
                separators=(",", ":"),
            ),
            NOW.isoformat(),
            fit_hash,
        ),
    )
    connection.execute(
        "INSERT INTO fill_firm VALUES(?,?,?,?,?,?,?)",
        (CAMPAIGN_ID, COMPANY_ID, 1, 1, "met", None, NOW.isoformat()),
    )
    connection.execute(
        "INSERT INTO fill_person VALUES(?,?,?,?,?)",
        (CAMPAIGN_ID, PERSON_ID, COMPANY_ID, 0, NOW.isoformat()),
    )
    connection.execute(
        "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (
            CONTACT_ID,
            PERSON_ID,
            COMPANY_ID,
            REVIEW_FIXTURE["contact_email"],
            "manual",
            "fixture",
            NOW.isoformat(),
            NOW.isoformat(),
            "valid",
            1.0,
            0,
        ),
    )
    score_version = ensure_fit_score_v1(connection, NOW.isoformat())
    score_person(connection, CAMPAIGN_ID, PERSON_ID, {}, NOW.isoformat())
    target_policy = compile_target_policy(
        session.target_policy, lambda value: value
    )
    decision = write_eligibility(
        connection,
        CAMPAIGN_ID,
        PERSON_ID,
        target_policy,
        score_version,
        NOW.isoformat(),
    )
    assert decision.outcome == "eligible"

    first_summary = draft_campaign(
        connection, CAMPAIGN_ID, 0, anchors=object(), now=NOW
    )
    assert (
        first_summary.candidates,
        first_summary.revisions_created,
        first_summary.qa_failed,
    ) == (1, 1, 0)
    parent = connection.execute(
        "SELECT revision_id,hash,subject,body FROM revision WHERE campaign_id=? AND step=0",
        (CAMPAIGN_ID,),
    ).fetchone()
    _insert_revision_approval(
        connection,
        parent["hash"],
        approval_id="apr_0000000000000001",
        nonce="synthetic-parent-review",
        approved_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
    )
    review = ReviewService(connection, now=lambda: NOW.isoformat())
    assert review.get_draft(CAMPAIGN_ID, parent["revision_id"]).approval_state == "approved"

    edited = review.edit_draft(
        EditDraftRequest(
            _request_id(2),
            CAMPAIGN_ID,
            parent["revision_id"],
            parent["subject"] + " (edited)",
            parent["body"],
        )
    )
    assert edited.state == "revision_created"
    revised = review.get_draft(CAMPAIGN_ID, edited.revision_id)
    assert revised.approval_state == "missing"
    assert revised.editorial_state == "review_required"
    assert connection.execute(
        "SELECT parent_revision_id FROM review_revision_lineage WHERE child_revision_id=?",
        (edited.revision_id,),
    ).fetchone()[0] == parent["revision_id"]

    feedback = review.request_feedback(
        FeedbackRequest(
            _request_id(3),
            CAMPAIGN_ID,
            edited.revision_id,
            "tone",
            ("warmer",),
            "Keep the grounded synthetic phrasing.",
        )
    )
    assert feedback.state == "pending"
    with pytest.raises(ReviewError, match="^editorial_receipts_missing$"):
        review.set_editorial_ready(
            EditorialRequest(_request_id(4), CAMPAIGN_ID, edited.revision_id, True)
        )
    _insert_revision_approval(
        connection,
        revised.revision_hash,
        approval_id="apr_0000000000000002",
        nonce="synthetic-expired-review",
        approved_at=NOW - timedelta(days=2),
        expires_at=NOW - timedelta(minutes=1),
    )
    assert review.get_draft(CAMPAIGN_ID, edited.revision_id).approval_state == "expired"
    assert connection.execute(
        "SELECT count(*) FROM exec_request WHERE operation='gmail_send'"
    ).fetchone()[0] == 0
    _insert_revision_approval(
        connection,
        revised.revision_hash,
        approval_id="apr_0000000000000003",
        nonce="synthetic-current-review",
        approved_at=NOW - timedelta(minutes=1),
        expires_at=NOW + timedelta(days=1),
    )
    reviewed = review.get_draft(CAMPAIGN_ID, edited.revision_id)
    assert (reviewed.editorial_state, reviewed.approval_state) == ("review_required", "approved")
    assert reviewed.editorial_gate_code == "editorial_receipts_missing"

    follow_summary = draft_campaign(
        connection, CAMPAIGN_ID, 1, anchors=object(), now=NOW
    )
    assert (
        follow_summary.candidates,
        follow_summary.revisions_created,
        follow_summary.qa_failed,
    ) == (1, 1, 0)
    followup = connection.execute(
        "SELECT revision_id,hash FROM revision WHERE campaign_id=? AND step=1",
        (CAMPAIGN_ID,),
    ).fetchone()
    _activate_with_synthetic_human_approval(connection, monkeypatch)

    due_at = NOW
    enroll_revision(
        connection,
        EnrollmentInput(
            "enrollment-synthetic",
            "req_0000000000000001",
            CAMPAIGN_ID,
            PERSON_ID,
            CONTACT_ID,
            revised.revision_hash,
            MAILBOX_ID,
            0,
            due_at,
            "synthetic-a",
        ),
        step_revisions={0: revised.revision_hash, 1: followup["hash"]},
    )
    deliveries = connection.execute(
        "SELECT delivery_id,step,revision_hash,scheduled_at FROM delivery ORDER BY step"
    ).fetchall()
    assert [(row["step"], row["revision_hash"]) for row in deliveries] == [
        (0, revised.revision_hash),
        (1, followup["hash"]),
    ]
    assert len(deliveries) == 2

    gmail = FakeGmail()
    executor = Executor(connection)
    service = build_live_service(
        connection, executor=executor, backend=gmail, now=lambda: NOW.isoformat()
    )
    first_delivery = deliveries[0]["delivery_id"]
    assert service.release(first_delivery).state == "queued"
    _drain(executor)
    first_row = connection.execute(
        "SELECT state,gmail_thread_id,gmail_message_id FROM delivery WHERE delivery_id=?",
        (first_delivery,),
    ).fetchone()
    assert first_row["state"] == "attempted"
    thread = gmail.thread_get(first_row["gmail_thread_id"])
    assert len([message for message in thread.messages if message.draft]) == 1

    draft_requests = connection.execute(
        "SELECT count(*) FROM exec_request WHERE operation='gmail_draft'"
    ).fetchone()[0]
    assert service.release(first_delivery).state == "attempted"
    assert not executor.process_one()
    assert connection.execute(
        "SELECT count(*) FROM exec_request WHERE operation='gmail_draft'"
    ).fetchone()[0] == draft_requests

    gmail.queue_inbound(
        ArrivalPoint.BEFORE_REFRESH,
        first_row["gmail_thread_id"],
        thread.subject,
        {
            "From": REVIEW_FIXTURE["reply_email"],
            "In-Reply-To": thread.messages[-1].rfc_message_id,
        },
        "Thanks",
    )
    gmail.arrive(ArrivalPoint.BEFORE_REFRESH)
    assert service.scan() == {"processed": 1, "stopped": 1, "blocked": 0}
    _drain(executor)
    assert tuple(connection.execute(
        "SELECT status,stop_reason FROM enrollment WHERE enrollment_id='enrollment-synthetic'"
    ).fetchone()) == ("stopped", "human_reply")

    follow_delivery = deliveries[1]["delivery_id"]
    follow_time = datetime.fromisoformat(deliveries[1]["scheduled_at"])
    follow_executor = Executor(connection)
    follow_service = build_live_service(
        connection,
        executor=follow_executor,
        backend=gmail,
        now=lambda: follow_time.isoformat(),
    )
    assert follow_service.release(follow_delivery).state == "queued"
    _drain(follow_executor)
    assert connection.execute(
        "SELECT state FROM delivery WHERE delivery_id=?", (follow_delivery,)
    ).fetchone()[0] == "cancelled"
    assert follow_service.release(follow_delivery).state == "cancelled"
    assert not follow_executor.process_one()

    final_thread = gmail.thread_get(first_row["gmail_thread_id"])
    assert len([message for message in final_thread.messages if message.draft]) == 1
    assert connection.execute(
        "SELECT count(*) FROM exec_request WHERE operation='gmail_send'"
    ).fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM delivery").fetchone()[0] == 2

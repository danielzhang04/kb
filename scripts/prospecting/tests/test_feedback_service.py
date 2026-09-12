"""Synthetic checks for append-only manual feedback fulfillment."""

from __future__ import annotations

from pathlib import Path
import sqlite3

import pytest

from scripts.prospecting.feedback_service import (
    FeedbackError,
    FeedbackService,
    FulfillFeedbackRequest,
)
from scripts.prospecting.review_service import EditDraftRequest, FeedbackRequest, ReviewService
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_review_service import (
    ASK,
    NOW,
    POINT,
    insert_campaign,
    insert_person,
    insert_revision,
    request_id,
)


def _database(path: Path):
    connection = open_store(path)
    for suffix in "ab":
        campaign_id = f"campaign-{suffix}"
        person_id = f"person-{suffix}"
        insert_campaign(connection, campaign_id, f"sender-{suffix}", f"mailbox-{suffix}")
        insert_person(connection, person_id, suffix)
        connection.execute(
            "INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?)",
            (f"evidence-{suffix}", person_id, POINT, f"https://source.example.test/{suffix}",
             NOW, NOW, "Synthetic excerpt", 1.0, "2099-01-01T00:00:00Z", 1),
        )
    revision_a = insert_revision(connection, "campaign-a", "person-a", "evidence-a")
    revision_b = insert_revision(connection, "campaign-b", "person-b", "evidence-b")
    connection.commit()
    return connection, revision_a.revision_id, revision_b.revision_id


def _feedback_and_child(connection: sqlite3.Connection, revision_id: str, *, offset: int = 0):
    review = ReviewService(connection, now=lambda: NOW)
    feedback = review.request_feedback(FeedbackRequest(
        request_id(100 + offset), "campaign-a", revision_id, "tone", ("warmer",),
        "Use a warmer opening.",
    ))
    edit = review.edit_draft(EditDraftRequest(
        request_id(101 + offset), "campaign-a", revision_id, "Revised synthetic subject",
        f"Hello. {POINT}. This human edit keeps the same synthetic evidence. {ASK}",
    ))
    assert edit.state == "revision_created"
    return feedback, edit


def test_feedback_is_manual_until_authentic_child_then_fulfills_once_after_restart(tmp_path: Path) -> None:
    path = tmp_path / "feedback.sqlite"
    connection, original, _other = _database(path)
    review = ReviewService(connection, now=lambda: NOW)
    feedback = review.request_feedback(FeedbackRequest(
        request_id(1), "campaign-a", original, "tone", ("warmer",), "Use a warmer opening.",
    ))
    service = FeedbackService(connection, now=lambda: NOW)
    pending = service.list_feedback("campaign-a")
    assert len(pending) == 1
    assert pending[0].feedback_id == feedback.feedback_id
    assert pending[0].state == "pending_human_edit"
    assert pending[0].automated_rewrite_state == "unavailable"
    assert pending[0].original_subject == "Example subject"
    assert pending[0].feedback_text == "Use a warmer opening."
    with pytest.raises(FeedbackError, match="^feedback_revision_unavailable$"):
        service.fulfill(FulfillFeedbackRequest(
            request_id(2), "campaign-a", feedback.feedback_id, original,
        ))
    assert connection.execute("SELECT count(*) FROM draft_feedback_outcome").fetchone()[0] == 0

    edit = review.edit_draft(EditDraftRequest(
        request_id(3), "campaign-a", original, "Revised synthetic subject",
        f"Hello. {POINT}. This human edit keeps the same synthetic evidence. {ASK}",
    ))
    assert edit.state == "revision_created"
    ready = service.list_feedback("campaign-a")[0]
    assert ready.state == "ready_to_record"
    assert ready.eligible_revision_id == edit.revision_id
    request = FulfillFeedbackRequest(
        request_id(4), "campaign-a", feedback.feedback_id, edit.revision_id,
    )
    first = service.fulfill(request)
    assert first.state == "fulfilled" and not first.replayed
    connection.close()

    reopened = open_store(path)
    retry = FeedbackService(reopened, now=lambda: NOW).fulfill(request)
    assert retry.replayed and retry.outcome_id == first.outcome_id
    fulfilled = FeedbackService(reopened).list_feedback("campaign-a")[0]
    assert fulfilled.state == "fulfilled" and fulfilled.eligible_revision_id == edit.revision_id
    with pytest.raises(FeedbackError, match="^request_conflict$"):
        FeedbackService(reopened).fulfill(FulfillFeedbackRequest(
            request.request_id, "campaign-a", feedback.feedback_id, original,
        ))
    with pytest.raises(FeedbackError, match="^feedback_already_fulfilled$"):
        FeedbackService(reopened).fulfill(FulfillFeedbackRequest(
            request_id(5), "campaign-a", feedback.feedback_id, edit.revision_id,
        ))
    assert reopened.execute("SELECT count(*) FROM draft_feedback_outcome").fetchone()[0] == 1
    assert reopened.execute("SELECT count(*) FROM approval").fetchone()[0] == 0
    assert reopened.execute("SELECT count(*) FROM delivery").fetchone()[0] == 0


def test_superseded_child_and_cross_campaign_revision_cannot_fulfill(tmp_path: Path) -> None:
    connection, original, other = _database(tmp_path / "feedback.sqlite")
    feedback, child = _feedback_and_child(connection, original, offset=10)
    newer = ReviewService(connection, now=lambda: NOW).edit_draft(EditDraftRequest(
        request_id(112), "campaign-a", child.revision_id, "Newest synthetic subject",
        f"Hello. {POINT}. This newer human edit keeps the same synthetic evidence. {ASK}",
    ))
    assert newer.state == "revision_created"
    service = FeedbackService(connection, now=lambda: NOW)
    assert service.list_feedback("campaign-a")[0].state == "revision_superseded"
    with pytest.raises(FeedbackError, match="^feedback_revision_conflict$"):
        service.fulfill(FulfillFeedbackRequest(
            request_id(113), "campaign-a", feedback.feedback_id, child.revision_id,
        ))
    with pytest.raises(FeedbackError, match="^feedback_revision_conflict$"):
        service.fulfill(FulfillFeedbackRequest(
            request_id(114), "campaign-a", feedback.feedback_id, other,
        ))
    assert connection.execute("SELECT count(*) FROM draft_feedback_outcome").fetchone()[0] == 0


def test_schema_rejects_tampered_scope_and_outcomes_are_immutable(tmp_path: Path) -> None:
    connection, original, other = _database(tmp_path / "feedback.sqlite")
    feedback, child = _feedback_and_child(connection, original, offset=20)
    lineage = connection.execute(
        "SELECT request_id FROM review_revision_lineage WHERE child_revision_id=?", (child.revision_id,),
    ).fetchone()
    with pytest.raises(sqlite3.IntegrityError, match="draft_feedback_outcome_scope"):
        connection.execute(
            """INSERT INTO draft_feedback_outcome VALUES(
                   'outcome-tampered',?,? ,?,?,?, ?,?,?, 'fulfilled',?)""",
            (request_id(122), "f" * 64, feedback.feedback_id, "campaign-a", "person-a",
             original, other, lineage["request_id"], NOW),
        )
    result = FeedbackService(connection, now=lambda: NOW).fulfill(FulfillFeedbackRequest(
        request_id(123), "campaign-a", feedback.feedback_id, child.revision_id,
    ))
    with pytest.raises(sqlite3.IntegrityError, match="draft_feedback_outcome_immutable"):
        connection.execute(
            "UPDATE draft_feedback_outcome SET state='fulfilled' WHERE outcome_id=?", (result.outcome_id,),
        )
    with pytest.raises(sqlite3.IntegrityError, match="draft_feedback_outcome_immutable"):
        connection.execute("DELETE FROM draft_feedback_outcome WHERE outcome_id=?", (result.outcome_id,))

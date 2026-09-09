"""Desktop-local projection and manual fulfillment for immutable draft feedback."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import re
import sqlite3
import uuid


_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
_SAFE_TAG = re.compile(r"[a-z][a-z0-9_-]{0,31}\Z")


class FeedbackError(ValueError):
    """A fixed-code refusal safe for the loopback review UI."""


@dataclass(frozen=True)
class FeedbackView:
    feedback_id: str
    campaign_id: str
    person_id: str
    full_name: str
    original_revision_id: str
    original_subject: str
    original_body: str
    disposition: str
    tags: tuple[str, ...]
    feedback_text: str | None
    requested_at: str
    state: str
    automated_rewrite_state: str
    eligible_revision_id: str | None
    eligible_subject: str | None
    eligible_body: str | None
    fulfilled_at: str | None


@dataclass(frozen=True)
class FulfillFeedbackRequest:
    request_id: str
    campaign_id: str
    feedback_id: str
    expected_child_revision_id: str


@dataclass(frozen=True)
class FulfillFeedbackResult:
    request_id: str
    outcome_id: str
    feedback_id: str
    child_revision_id: str
    state: str
    replayed: bool


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_id(value: object, code: str) -> str:
    if type(value) is not str or _SAFE_ID.fullmatch(value) is None:
        raise FeedbackError(code)
    return value


def _request_id(value: object) -> str:
    if type(value) is not str:
        raise FeedbackError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError):
        raise FeedbackError("invalid_request_id") from None
    if str(parsed) != value:
        raise FeedbackError("invalid_request_id")
    return value


def _digest(value: dict[str, str]) -> str:
    canonical = json.dumps(
        {"operation": "fulfill_feedback", **value}, sort_keys=True,
        separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _outcome_id(request_id: str) -> str:
    return "feedback_outcome_" + uuid.uuid5(
        uuid.NAMESPACE_URL, f"kb:feedback:outcome:{request_id}",
    ).hex


class FeedbackService:
    """Read feedback and record which authentic human edit fulfilled it."""

    def __init__(self, connection: sqlite3.Connection, *, now=utc_now) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.now = now

    def _campaign(self, campaign_id: object) -> str:
        campaign_id = _safe_id(campaign_id, "invalid_campaign_id")
        if self.connection.execute(
            "SELECT 1 FROM campaign WHERE campaign_id=?", (campaign_id,),
        ).fetchone() is None:
            raise FeedbackError("campaign_missing")
        return campaign_id

    @staticmethod
    def _tags(value: object) -> tuple[str, ...]:
        try:
            parsed = json.loads(str(value))
        except (TypeError, json.JSONDecodeError):
            raise FeedbackError("store_state_invalid") from None
        if (
            not isinstance(parsed, list) or len(parsed) > 8
            or any(type(tag) is not str or _SAFE_TAG.fullmatch(tag) is None for tag in parsed)
            or len(set(parsed)) != len(parsed)
        ):
            raise FeedbackError("store_state_invalid")
        return tuple(parsed)

    def _feedback(self, campaign_id: str, feedback_id: str) -> sqlite3.Row:
        row = self.connection.execute(
            """SELECT feedback.*,person.full_name,revision.subject,revision.body,revision.step
                 FROM draft_feedback AS feedback
                 JOIN person ON person.person_id=feedback.person_id
                 JOIN revision ON revision.revision_id=feedback.revision_id
                WHERE feedback.campaign_id=? AND feedback.feedback_id=?""",
            (campaign_id, feedback_id),
        ).fetchone()
        if row is None:
            raise FeedbackError("feedback_missing")
        return row

    def _children(self, feedback: sqlite3.Row) -> tuple[sqlite3.Row, ...]:
        rows = self.connection.execute(
            """SELECT child.revision_id,child.subject,child.body,child.rowid AS revision_rowid,
                      lineage.request_id AS edit_request_id
                 FROM review_revision_lineage AS lineage
                 JOIN review_candidate AS candidate ON candidate.candidate_id=lineage.candidate_id
                 JOIN review_request AS request ON request.request_id=lineage.request_id
                 JOIN revision AS child ON child.revision_id=lineage.child_revision_id
                 JOIN revision_qa_context AS qa_context ON qa_context.revision_id=child.revision_id
                WHERE lineage.parent_revision_id=? AND lineage.campaign_id=? AND lineage.person_id=?
                  AND lineage.step=? AND candidate.request_id=lineage.request_id
                  AND candidate.parent_revision_id=lineage.parent_revision_id
                  AND candidate.campaign_id=lineage.campaign_id
                  AND candidate.person_id=lineage.person_id AND candidate.step=lineage.step
                  AND candidate.qa_state='revision_created'
                  AND json_extract(candidate.qa_json,'$.passed')=1
                  AND request.operation='edit' AND request.result_state='revision_created'
                  AND request.campaign_id=lineage.campaign_id AND request.person_id=lineage.person_id
                  AND request.expected_revision_id=lineage.parent_revision_id
                  AND request.result_id=candidate.candidate_id
                  AND child.campaign_id=lineage.campaign_id AND child.person_id=lineage.person_id
                  AND child.step=lineage.step
                  AND child.subject=candidate.subject AND child.body=candidate.body
                  AND json_extract(child.qa,'$.passed')=1
                  AND qa_context.inherited_from_revision_id=lineage.parent_revision_id
                ORDER BY child.rowid,child.revision_id""",
            (feedback["revision_id"], feedback["campaign_id"], feedback["person_id"], feedback["step"]),
        ).fetchall()
        if len(rows) > 1:
            raise FeedbackError("store_state_invalid")
        return tuple(rows)

    def _current_revision_id(self, feedback: sqlite3.Row) -> str:
        row = self.connection.execute(
            """SELECT revision_id FROM revision
                WHERE campaign_id=? AND person_id=? AND step=?
                ORDER BY rowid DESC,revision_id DESC LIMIT 1""",
            (feedback["campaign_id"], feedback["person_id"], feedback["step"]),
        ).fetchone()
        if row is None:
            raise FeedbackError("store_state_invalid")
        return str(row["revision_id"])

    def list_feedback(self, campaign_id: str) -> tuple[FeedbackView, ...]:
        campaign_id = self._campaign(campaign_id)
        rows = self.connection.execute(
            "SELECT feedback_id FROM draft_feedback WHERE campaign_id=? ORDER BY created_at,feedback_id",
            (campaign_id,),
        ).fetchall()
        result = []
        for item in rows:
            feedback = self._feedback(campaign_id, str(item["feedback_id"]))
            outcome = self.connection.execute(
                "SELECT * FROM draft_feedback_outcome WHERE feedback_id=?", (feedback["feedback_id"],),
            ).fetchone()
            child = None
            fulfilled_at = None
            if outcome is not None:
                child = self.connection.execute(
                    "SELECT revision_id,subject,body FROM revision WHERE revision_id=?",
                    (outcome["child_revision_id"],),
                ).fetchone()
                if child is None:
                    raise FeedbackError("store_state_invalid")
                state, fulfilled_at = "fulfilled", str(outcome["created_at"])
            else:
                children = self._children(feedback)
                child = children[0] if children else None
                state = (
                    "pending_human_edit" if child is None else
                    "ready_to_record" if child["revision_id"] == self._current_revision_id(feedback)
                    else "revision_superseded"
                )
            result.append(FeedbackView(
                feedback_id=str(feedback["feedback_id"]), campaign_id=campaign_id,
                person_id=str(feedback["person_id"]), full_name=str(feedback["full_name"]),
                original_revision_id=str(feedback["revision_id"]),
                original_subject=str(feedback["subject"]), original_body=str(feedback["body"]),
                disposition=str(feedback["disposition"]), tags=self._tags(feedback["tags_json"]),
                feedback_text=None if feedback["feedback_text"] is None else str(feedback["feedback_text"]),
                requested_at=str(feedback["created_at"]), state=state,
                automated_rewrite_state="unavailable",
                eligible_revision_id=None if child is None else str(child["revision_id"]),
                eligible_subject=None if child is None else str(child["subject"]),
                eligible_body=None if child is None else str(child["body"]),
                fulfilled_at=fulfilled_at,
            ))
        return tuple(result)

    def fulfill(self, request: FulfillFeedbackRequest) -> FulfillFeedbackResult:
        if not isinstance(request, FulfillFeedbackRequest):
            raise FeedbackError("invalid_fulfillment_request")
        request_id = _request_id(request.request_id)
        campaign_id = _safe_id(request.campaign_id, "invalid_campaign_id")
        feedback_id = _safe_id(request.feedback_id, "invalid_feedback_id")
        child_id = _safe_id(request.expected_child_revision_id, "invalid_revision_id")
        request_hash = _digest({
            "campaign_id": campaign_id, "feedback_id": feedback_id,
            "expected_child_revision_id": child_id,
        })
        if self.connection.in_transaction:
            raise FeedbackError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            replay = self.connection.execute(
                "SELECT * FROM draft_feedback_outcome WHERE request_id=?", (request_id,),
            ).fetchone()
            if replay is not None:
                if replay["request_hash"] != request_hash:
                    raise FeedbackError("request_conflict")
                result = FulfillFeedbackResult(
                    request_id, str(replay["outcome_id"]), str(replay["feedback_id"]),
                    str(replay["child_revision_id"]), "fulfilled", True,
                )
                self.connection.commit()
                return result
            self._campaign(campaign_id)
            feedback = self._feedback(campaign_id, feedback_id)
            prior = self.connection.execute(
                "SELECT request_id FROM draft_feedback_outcome WHERE feedback_id=?", (feedback_id,),
            ).fetchone()
            if prior is not None:
                raise FeedbackError("feedback_already_fulfilled")
            children = self._children(feedback)
            if not children:
                raise FeedbackError("feedback_revision_unavailable")
            child = children[0]
            if child["revision_id"] != child_id or self._current_revision_id(feedback) != child_id:
                raise FeedbackError("feedback_revision_conflict")
            outcome_id = _outcome_id(request_id)
            self.connection.execute(
                """INSERT INTO draft_feedback_outcome(
                       outcome_id,request_id,request_hash,feedback_id,campaign_id,person_id,
                       original_revision_id,child_revision_id,edit_request_id,state,created_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,'fulfilled',?)""",
                (outcome_id, request_id, request_hash, feedback_id, campaign_id,
                 feedback["person_id"], feedback["revision_id"], child_id,
                 child["edit_request_id"], self.now()),
            )
            self.connection.commit()
            return FulfillFeedbackResult(
                request_id, outcome_id, feedback_id, child_id, "fulfilled", False,
            )
        except BaseException:
            self.connection.rollback()
            raise

"""Synthetic checks for immutable local revision QA context."""

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

import pytest

from scripts.prospecting.personalizer.evidence import EvidenceRecord
from scripts.prospecting.personalizer.qa import QaPolicy, SlotBinding, validate_revision
from scripts.prospecting.personalizer.revision import RevisionInput, build_revision
from scripts.prospecting.review_qa import (
    RevisionQaContextError,
    ReviewQaUnavailable,
    StoredReviewQa,
    load_revision_qa_context,
    propagate_revision_qa_context,
    record_revision_qa_context,
)
from scripts.prospecting.store import open_store


NOW = datetime(2026, 9, 9, 12, tzinfo=timezone.utc)
STAMP = NOW.isoformat()
ASK = "Would you have 15 minutes for an informational conversation?"
WHY = "Your move into operations at Example Robotics is relevant to how I am thinking about operating careers."
BODY = f"""Hi Avery,

{WHY} I am exploring how strong teams make this work effective in practice. I have experience evaluating businesses and working on operating problems. I would value your perspective on the choices that shaped your path and what you would focus on when learning the field today. {ASK}

Example Sender"""


@dataclass(frozen=True)
class Candidate:
    campaign_id: str
    person_id: str
    parent_revision_id: str
    step: int
    subject: str
    body: str
    ask: str


def context_bindings() -> dict[str, SlotBinding]:
    return {
        "first_name": SlotBinding("Avery", "evidence", "evidence-a"),
        "company": SlotBinding("Example Robotics", "evidence", "evidence-a"),
        "why_them": SlotBinding(WHY, "evidence", "evidence-a"),
        "sender_proof": SlotBinding(
            "I have experience evaluating businesses and working on operating problems.",
            "sender", "sender.sender_operating_proof",
        ),
        "ask": SlotBinding(ASK, "policy", "policy.ask"),
        "signature": SlotBinding("Example Sender", "sender", "sender.sender_name"),
    }


def context_policy() -> QaPolicy:
    return QaPolicy("networking", 0, "informational_call", 60, 120, 0.8)


@pytest.fixture
def stored(tmp_path: Path):
    path = tmp_path / "qa-context.sqlite"
    connection = open_store(path)
    connection.execute("INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
                       ("sender-a", "Example Sender", None, "Example focus", "Example background",
                        "Example proof", "[]"))
    connection.execute(
        "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
        ("person-a", "Avery", "Avery Example", None, "Example", "Synthetic", "manual", "person-a"),
    )
    connection.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
               template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
               firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("campaign-a", "networking", "sender-a", "{}", "informational_call", 15, "warm",
         "networking", "[]", "{}", "UTC", 20, 4, 2, "T3", "mailbox-a", "{}", 0,
         "draft", "a" * 64),
    )
    connection.execute(
        "INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("evidence-a", "person-a", "Avery moved into operations at Example Robotics",
         "https://source.example.test/a", "2026-09-01", "2026-09-01T00:00:00Z",
         "Synthetic evidence", 0.95, "2099-01-01T00:00:00Z", 1),
    )
    evidence = EvidenceRecord(
        "evidence-a", "person-a", "Avery moved into operations at Example Robotics",
        "https://source.example.test/a", "2026-09-01", "2026-09-01T00:00:00Z",
        "Synthetic evidence", 0.95, "2099-01-01T00:00:00Z", True,
    )
    qa = validate_revision(
        "A question about Example Robotics", BODY, ASK, context_bindings(),
        (evidence,), context_policy(), "person-a", "campaign-a", NOW,
    )
    assert qa.passed
    revision = build_revision(connection, RevisionInput(
        "person-a", "campaign-a", 0, "A question about Example Robotics", BODY,
        "why_them", "bespoke", None, ASK, ("evidence-a",), (WHY,),
        ("I have experience evaluating businesses and working on operating problems.",),
        "networking", 1, "fixture-prompt", "fixture-model", qa,
    ))
    record_revision_qa_context(
        connection, revision.revision_id, context_bindings(), context_policy(),
        inherited_from_revision_id=None, created_at=STAMP,
    )
    connection.commit()
    return path, connection, revision


def candidate(revision_id: str, *, body: str = BODY, subject: str = "A question about Example Robotics") -> Candidate:
    return Candidate("campaign-a", "person-a", revision_id, 0, subject, body, ASK)


def test_context_round_trips_canonically_after_restart(stored) -> None:
    path, connection, revision = stored
    first = load_revision_qa_context(connection, revision.revision_id)
    connection.close()
    reopened = open_store(path)
    second = load_revision_qa_context(reopened, revision.revision_id)
    assert second.context_sha256 == first.context_sha256
    assert dict(second.bindings) == context_bindings()
    assert second.policy == context_policy()


def test_stored_adapter_reruns_actual_validate_revision(stored) -> None:
    _path, connection, revision = stored
    adapter = StoredReviewQa(connection, now=lambda: NOW)
    changed = candidate(revision.revision_id, body=BODY.replace("I am exploring", "I am carefully exploring"))
    decision = adapter(changed)
    assert decision.qa.passed
    assert decision.coverage == "stored_bindings_only"
    missing_bound_value = candidate(revision.revision_id, body=BODY.replace(WHY, "A different unsupported statement."))
    assert "slot_value_missing" in adapter(missing_bound_value).qa.failure_codes


def test_context_propagates_to_child_and_supports_second_recheck(stored) -> None:
    _path, connection, parent = stored
    adapter = StoredReviewQa(connection, now=lambda: NOW)
    first = candidate(parent.revision_id, body=BODY.replace("effective", "useful"))
    decision = adapter(first)
    assert decision.qa.passed
    child = build_revision(connection, RevisionInput(
        "person-a", "campaign-a", 0, first.subject, first.body, "why_them", "bespoke", None,
        ASK, ("evidence-a",), (WHY,),
        ("I have experience evaluating businesses and working on operating problems.",),
        "networking", 1, "fixture-prompt", "fixture-model", decision.qa,
    ))
    inherited = propagate_revision_qa_context(
        connection, decision, child.revision_id, parent.revision_id,
        created_at="2026-09-09T12:01:00+00:00",
    )
    assert inherited.inherited_from_revision_id == parent.revision_id
    assert inherited.context_sha256 == decision.context.context_sha256
    second = adapter(candidate(child.revision_id, body=first.body.replace("useful", "practical")))
    assert second.qa.passed and second.context.revision_id == child.revision_id


def test_legacy_revision_without_context_is_typed_pending_boundary(stored) -> None:
    _path, connection, parent = stored
    checked = StoredReviewQa(connection, now=lambda: NOW)(
        candidate(parent.revision_id, subject="Legacy")
    )
    legacy = build_revision(connection, RevisionInput(
        "person-a", "campaign-a", 0, "Legacy", BODY, "why_them", "bespoke", None,
        ASK, ("evidence-a",), (WHY,), (), "networking", 1, "legacy", "legacy",
        checked.qa,
    ))
    with pytest.raises(ReviewQaUnavailable, match="^qa_context_missing$"):
        StoredReviewQa(connection, now=lambda: NOW)(candidate(legacy.revision_id, subject="Legacy"))


def test_context_is_idempotent_but_conflicting_metadata_is_refused(stored) -> None:
    _path, connection, revision = stored
    same = record_revision_qa_context(
        connection, revision.revision_id, context_bindings(), context_policy(),
        inherited_from_revision_id=None, created_at="2026-09-10T00:00:00+00:00",
    )
    assert same.created_at == STAMP
    with pytest.raises(RevisionQaContextError, match="context_conflict"):
        record_revision_qa_context(
            connection, revision.revision_id, context_bindings(),
            replace(context_policy(), maximum_words=121),
            inherited_from_revision_id=None, created_at=STAMP,
        )


def test_context_rows_are_immutable(stored) -> None:
    _path, connection, revision = stored
    with pytest.raises(sqlite3.IntegrityError, match="revision_qa_context_immutable"):
        connection.execute(
            "UPDATE revision_qa_context SET created_at=? WHERE revision_id=?",
            ("2026-09-10T00:00:00+00:00", revision.revision_id),
        )


def test_context_rejects_missing_or_cross_person_evidence(stored) -> None:
    _path, connection, revision = stored
    changed = context_bindings()
    changed["why_them"] = SlotBinding(WHY, "evidence", "missing-evidence")
    with pytest.raises(RevisionQaContextError, match="context_evidence_mismatch"):
        record_revision_qa_context(
            connection, revision.revision_id, changed, context_policy(),
            inherited_from_revision_id=None, created_at=STAMP,
        )

from dataclasses import replace
from pathlib import Path
import sqlite3
import threading

import pytest

from scripts.prospecting.personalizer.qa import QaResult
from scripts.prospecting.personalizer.revision import (
    RevisionError,
    RevisionInput,
    build_revision,
    revision_hash,
)
from scripts.prospecting.store import open_store


def database(tmp_path: Path) -> sqlite3.Connection:
    connection = open_store(tmp_path / "p1.sqlite")
    connection.row_factory = sqlite3.Row
    connection.execute(
        """INSERT INTO person(person_id,first_name,full_name,linkedin_url,location,one_line_blurb,source_lane,dedupe_key)
           VALUES(?,?,?,?,?,?,?,?)""",
        ("person-1", "Synthetic", "Synthetic Person", None, "Example", "Synthetic fixture", "manual", "synthetic-person"),
    )
    connection.execute(
        """INSERT INTO sender_profile(
             sender_profile_id,sender_name,sender_school,sender_focus,sender_background,
             sender_operating_proof,approved_metrics
           ) VALUES(?,?,?,?,?,?,?)""",
        ("sender-1", "Example Sender", "Example School", "Example focus", "Example background", "Example proof", "[]"),
    )
    connection.execute(
        """INSERT INTO campaign(
             campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
             template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
             firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,
             status,policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            "campaign-1", "networking", "sender-1", "{}", "informational_call", 15,
            "direct", "networking", "[]", "{}", "UTC", 25, 6, 2, "T3",
            "mailbox-1", "{}", 0, "draft", "a" * 64,
        ),
    )
    connection.commit()
    return connection


def value(**changes: object) -> RevisionInput:
    values: dict[str, object] = {
        "person_id": "person-1", "campaign_id": "campaign-1", "step": 0,
        "subject": "Subject", "body": "Body bytes", "angle": "why_them",
        "generation_mode": "bespoke", "purpose": None,
        "ask": "Would you have 15 minutes for an informational conversation?",
        "evidence_ids": ("ev-1",), "recipient_relevance_points": ("specific role move",),
        "sender_proof_points": (), "template_id": "networking", "template_version": 1,
        "prompt_version": "p3-v1", "model_version": "fixture-v1",
        "qa": QaResult(True, 100, {"content": True}, ()),
    }
    values.update(changes)
    return RevisionInput(**values)


def test_hash_is_stable_for_identical_input() -> None:
    assert revision_hash(value()) == revision_hash(value())


@pytest.mark.parametrize(
    ("field", "changed"),
    [
        ("subject", "Changed subject"), ("body", "Changed body"),
        ("template_version", 2), ("evidence_ids", ("ev-2",)),
        ("prompt_version", "p3-v2"), ("model_version", "fixture-v2"),
        ("person_id", "person-2"), ("campaign_id", "campaign-2"), ("step", 2),
        ("ask", "Would you have 20 minutes for an informational conversation?"),
        ("angle", "signal_led"),
        ("generation_mode", "template_with_purpose"), ("purpose", "follow up"),
        ("recipient_relevance_points", ("different relevance",)),
        ("sender_proof_points", ("different proof",)), ("template_id", "curiosity"),
    ],
)
def test_hash_changes_for_bound_field(field: str, changed: object) -> None:
    assert revision_hash(value()) != revision_hash(replace(value(), **{field: changed}))


def test_build_inserts_passing_revision(tmp_path: Path) -> None:
    record = build_revision(database(tmp_path), value())
    assert len(record.revision_hash) == 64


def test_build_is_idempotent(tmp_path: Path) -> None:
    connection = database(tmp_path)
    first = build_revision(connection, value())
    second = build_revision(connection, value())
    assert first == second
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 1


def test_failing_qa_cannot_be_inserted(tmp_path: Path) -> None:
    failed = QaResult(False, 80, {"content": False}, ("word_count",))
    with pytest.raises(RevisionError, match="qa_failed"):
        build_revision(database(tmp_path), value(qa=failed))


def test_template_with_purpose_requires_purpose(tmp_path: Path) -> None:
    with pytest.raises(RevisionError, match="purpose_required"):
        build_revision(database(tmp_path), value(generation_mode="template_with_purpose"))


def test_bespoke_rejects_purpose(tmp_path: Path) -> None:
    with pytest.raises(RevisionError, match="purpose_forbidden"):
        build_revision(database(tmp_path), value(purpose="extra"))


def test_unknown_generation_mode_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(RevisionError, match="generation_mode"):
        build_revision(database(tmp_path), value(generation_mode="other"))


@pytest.mark.parametrize("step", [-1, 3])
def test_revision_step_outside_contract_is_rejected(tmp_path: Path, step: int) -> None:
    with pytest.raises(RevisionError, match="step"):
        build_revision(database(tmp_path), value(step=step))


def test_evidence_order_is_hash_significant() -> None:
    assert revision_hash(value(evidence_ids=("ev-1", "ev-2"))) != revision_hash(value(evidence_ids=("ev-2", "ev-1")))


def test_stored_qa_is_canonical_json(tmp_path: Path) -> None:
    connection = database(tmp_path)
    build_revision(connection, value())
    assert connection.execute("SELECT qa FROM revision").fetchone()[0] == '{"checks":{"content":true},"failure_codes":[],"passed":true,"qa_score":100,"self_critique":""}'


def test_revision_persists_after_reopen(tmp_path: Path) -> None:
    path = tmp_path / "p1.sqlite"
    connection = database(tmp_path)
    expected = build_revision(connection, value())
    connection.commit()
    connection.close()
    reopened = open_store(path)
    assert reopened.execute("SELECT hash FROM revision").fetchone()[0] == expected.revision_hash


def test_competing_connections_concurrently_converge_on_one_hash(tmp_path: Path) -> None:
    path = tmp_path / "p1.sqlite"
    setup_connection = database(tmp_path)
    setup_connection.close()
    barrier = threading.Barrier(2)
    results: list[RevisionRecord] = []
    errors: list[BaseException] = []

    def build_concurrently() -> None:
        connection = open_store(path)
        try:
            barrier.wait()
            results.append(build_revision(connection, value()))
            connection.commit()
        except BaseException as error:
            errors.append(error)
        finally:
            connection.close()

    threads = [threading.Thread(target=build_concurrently) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors
    assert len(results) == 2
    assert {result.revision_hash for result in results} == {revision_hash(value())}
    assert sum(result.created for result in results) == 1
    connection = open_store(path)
    try:
        assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 1
    finally:
        connection.close()

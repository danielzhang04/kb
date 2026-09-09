"""P6 regression guards for the exercised executor and campaigner paths."""

from __future__ import annotations

import json
from datetime import timezone

from scripts.prospecting.approval.followups_t1 import is_p6_send_shape
from scripts.prospecting.approval.release_t1 import attach_t1_send, queue_due_t1
from scripts.prospecting.campaigner.release import ReleaseResult
from scripts.prospecting.executor import Executor
from scripts.prospecting.executor_campaigner import build_live_service
from scripts.prospecting.tests.p6_support import SendFakeGmail, migrated_t1_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_end_to_end_live_guard")


def test_higher_tier_paths_are_inert(tmp_path) -> None:
    for tier_index, tier in enumerate(("T2", "T3"), start=2):
        assert is_p6_send_shape(tier, 0, "revision", "send_revision") is False
        fixture = migrated_t1_store(tmp_path / f"{tier.lower()}.sqlite", tier=tier)
        db, gmail = fixture.connection, SendFakeGmail()
        request_id = f"req_{tier_index:016x}"
        # Deliberately bypass the insertion validator.  The executor must still refuse it.
        db.execute(
            "INSERT INTO exec_request VALUES(?,?,?,?,?,?,?,?,?,?)",
            (request_id, "prospecting-campaigner", "gmail_send",
             json.dumps({"delivery_id": fixture.d0_delivery_id}), "a" * 64,
             "apr_0000000000000001", fixture.now.isoformat(), None, "queued", None),
        )
        executor = Executor(db)
        attach_t1_send(executor, gmail)
        assert executor.process_one() is True
        assert db.execute("SELECT count(*) FROM delivery WHERE state='claimed'").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM t1_delivery_guard").fetchone()[0] == 0
        assert gmail.send_count == 0
        state, reason = db.execute(
            "SELECT state,reason FROM exec_request WHERE request_id=?", (request_id,)
        ).fetchone()
        assert (state, reason) == ("rejected", "validation_or_hook_rejected")
    assert is_p6_send_shape("T1", 0, "revision", "send_revision") is True


def test_t1_d0_send_and_followup_draft_are_idempotent(tmp_path, monkeypatch) -> None:
    fixture = migrated_t1_store(tmp_path / "live-flow.sqlite")
    db, gmail = fixture.connection, SendFakeGmail()
    executor = Executor(db)
    monkeypatch.setattr("scripts.prospecting.executor_campaigner.ZoneInfo", lambda _name: timezone.utc)
    service = build_live_service(
        db, executor=executor, backend=gmail, now=lambda: fixture.now.isoformat(),
    )
    attach_t1_send(executor, gmail)
    campaigner_release = service.release

    def release(delivery_id: str) -> ReleaseResult:
        step = db.execute("SELECT step FROM delivery WHERE delivery_id=?", (delivery_id,)).fetchone()[0]
        if step == 0:
            assert len(queue_due_t1(db, fixture.now)) == 1
            result = ReleaseResult("sent")
        else:
            result = campaigner_release(delivery_id)
        while executor.process_one():
            pass
        return result

    service.release = release
    first = service.sweep()
    assert tuple(db.execute(
        "SELECT state,reason FROM exec_request WHERE operation='gmail_draft'"
    ).fetchone()) == ("succeeded", "drafted")
    second = service.sweep()

    assert first["considered"] == 2
    assert second["considered"] == 0
    assert gmail.send_count == 1
    followup = db.execute(
        "SELECT state,gmail_thread_id FROM delivery WHERE delivery_id=?", (fixture.followup_delivery_id,)
    ).fetchone()
    assert followup[0] == "attempted"
    assert sum(message.draft for message in gmail.thread_get(followup[1]).messages) == 1
    assert db.execute(
        "SELECT count(*) FROM exec_request WHERE operation='gmail_send' AND state='succeeded'"
    ).fetchone()[0] == 1


def test_t1_google_warning_in_global_mailbox_stops_send(tmp_path) -> None:
    fixture = migrated_t1_store(tmp_path / "global-warning.sqlite")
    db, gmail = fixture.connection, SendFakeGmail()
    gmail.inject_inbox_message(
        "Google warning", {"From": SYNTHETIC["warning_email"]}, "Automatic notice"
    )
    executor = Executor(db)
    attach_t1_send(executor, gmail)

    assert len(queue_due_t1(db, fixture.now)) == 1
    assert executor.process_one() is True
    assert gmail.send_count == 0
    assert db.execute(
        "SELECT reason FROM t1_breaker WHERE scope='global' AND cleared_at IS NULL"
    ).fetchone()[0] == "google_warning"
    assert tuple(db.execute(
        "SELECT state,reason FROM exec_request WHERE operation='gmail_send'"
    ).fetchone()) == ("rejected", "breaker_open")

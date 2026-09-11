from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import sqlite3
import uuid

import pytest

from scripts.prospecting import research_capture_service
from scripts.prospecting.research_capture_service import (
    MAX_TASKS_PER_SESSION,
    OPEN_KIND,
    SEARCH_KIND,
    CaptureClaimRequest,
    CaptureError,
    CaptureFinishRequest,
    CaptureService,
    CaptureSessionRequest,
    CaptureSubmitRequest,
    CaptureTaskRequest,
)
from scripts.prospecting.pipeline_service import (
    PipelineService,
    PipelineStartRequest,
    ScopeSpec,
)
from scripts.prospecting.store import open_store


STAMP = "2026-09-10T12:00:00Z"
LATER = "2026-09-10T12:10:00Z"
CAMPAIGN_ID = "camp_aaaabbbbccccdddd"
POLICY_HASH = "a" * 64
SKILL_HASH = "c" * 64
PAGE = "Nimbus Systems announced series_b on 2025-05-01."


class _Clock:
    def __init__(self, value: str = STAMP) -> None:
        self.value = value

    def __call__(self) -> str:
        return self.value


def _seed(connection: sqlite3.Connection):
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-synthetic", "Synthetic Sender", None, "software", "operations", "tools", "{}"),
    )
    connection.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
               template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
               firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,
               status,policy_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (CAMPAIGN_ID, "networking", "sender-synthetic", "{}", "informational_call", 15,
         "warm", "networking-v1", "[]", "09:00-17:00", "America/New_York", 25, 6,
         2, "T0", "mailbox-synthetic", "{}", 0, "draft", POLICY_HASH),
    )
    return PipelineService(connection, now=lambda: STAMP).start_or_resume(PipelineStartRequest(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", CAMPAIGN_ID, "2026-09-09",
        "series_a", "series_c", 3, "latest_known", ScopeSpec("any"), ScopeSpec("any"),
        2, 2, ("operations",), "Synthetic capture acquisition", "Coffee chat",
    ))


def _session_request(started, *, request_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cap=MAX_TASKS_PER_SESSION):
    return CaptureSessionRequest(request_id, started.run_id, started.intake_hash, SKILL_HASH, cap)


def _open_task(session_id, *, request_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc", url="https://nimbus.test/funding"):
    return CaptureTaskRequest(request_id, session_id, OPEN_KIND, None, url)


def _search_task(session_id, *, request_id="dddddddd-dddd-4ddd-8ddd-dddddddddddd", query="Nimbus Systems funding"):
    return CaptureTaskRequest(request_id, session_id, SEARCH_KIND, query, None)


def _incoming(root: Path, name: str, text: str = PAGE) -> str:
    folder = root / "snapshots" / "incoming"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(text, encoding="utf-8")
    return f"incoming/{name}"


def test_start_enqueue_claim_submit_preserves_exact_bytes_without_qualification(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    assert session.state == "accepting_capture_tasks"
    task = service.enqueue_task(_open_task(session.session_id))
    assert (task.ordinal, task.state) == (0, "queued")
    lease = service.claim_task(CaptureClaimRequest(session.session_id, 300))
    assert lease is not None and lease.task_kind == OPEN_KIND
    assert lease.packet["url"] == "https://nimbus.test/funding"
    receipt = service.submit_capture(CaptureSubmitRequest(
        lease.task_id, lease.lease_token, _incoming(tmp_path, "capture-one.txt"),
        "https://nimbus.test/funding", STAMP,
    ))
    assert receipt.state == "captured" and receipt.byte_count == len(PAGE.encode())
    stored = connection.execute(
        "SELECT body_ref,allowlist_version FROM source_snapshot WHERE snapshot_id=?",
        (receipt.snapshot_id,),
    ).fetchone()
    assert stored["allowlist_version"] == "operator-public-capture-v1"
    assert (tmp_path / "snapshots" / stored["body_ref"]).read_bytes() == PAGE.encode()
    assert service.verify_capture(lease.task_id).content_sha256 == receipt.content_sha256
    progress = service.get_progress(session.session_id)
    assert progress.counts["captured"] == 1 and progress.counts["queued"] == 0
    for table in ("company", "person", "employment", "approval", "prospecting_funding_batch"):
        assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    connection.close()


def test_safe_projection_never_exposes_private_packet_values(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    service.enqueue_task(_search_task(session.session_id))
    service.enqueue_task(_open_task(session.session_id))
    rendered = repr(service.get_progress(session.session_id))
    assert "Nimbus Systems funding" not in rendered and "nimbus.test" not in rendered
    lease = service.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert lease is not None and "Nimbus Systems funding" not in repr(lease)
    connection.close()


def test_exact_replay_and_different_hash_conflict(tmp_path: Path) -> None:
    database = tmp_path / "store.sqlite"
    connection = open_store(database)
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    request = _session_request(started)
    first = service.start_session(request)
    task_request = _open_task(first.session_id)
    first_task = service.enqueue_task(task_request)
    connection.close()

    reopened = open_store(database)
    resumed = CaptureService(reopened, now=_Clock())
    replay = resumed.start_session(request)
    assert replay.replayed is True and replay.session_hash == first.session_hash
    replay_task = resumed.enqueue_task(task_request)
    assert replay_task.replayed is True and replay_task.task_id == first_task.task_id
    with pytest.raises(CaptureError, match="^request_conflict$"):
        resumed.start_session(replace(request, task_cap=4))
    with pytest.raises(CaptureError, match="^request_conflict$"):
        resumed.enqueue_task(replace(task_request, url="https://other.test/funding"))
    with pytest.raises(CaptureError, match="^duplicate_packet$"):
        resumed.enqueue_task(replace(task_request, request_id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"))
    assert reopened.execute("SELECT count(*) FROM prospecting_capture_task").fetchone()[0] == 1
    reopened.close()


def test_expired_lease_is_reclaimed_and_old_token_submit_is_refused(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    clock = _Clock()
    service = CaptureService(connection, now=clock)
    session = service.start_session(_session_request(started))
    service.enqueue_task(_open_task(session.session_id))
    first = service.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert first is not None
    assert service.claim_task(CaptureClaimRequest(session.session_id, 60)) is None
    clock.value = LATER
    second = service.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert second is not None
    assert second.lease_token != first.lease_token and second.lease_epoch == first.lease_epoch + 1
    body_ref = _incoming(tmp_path, "capture-race.txt")
    with pytest.raises(CaptureError, match="^lease_lost$"):
        service.submit_capture(CaptureSubmitRequest(
            first.task_id, first.lease_token, body_ref, "https://nimbus.test/funding", LATER,
        ))
    assert connection.execute("SELECT count(*) FROM prospecting_capture_receipt").fetchone()[0] == 0
    receipt = service.submit_capture(CaptureSubmitRequest(
        second.task_id, second.lease_token, body_ref, "https://nimbus.test/funding", LATER,
    ))
    assert receipt.state == "captured"
    reclaimed = connection.execute(
        "SELECT state FROM prospecting_capture_attempt WHERE lease_token=?", (first.lease_token,),
    ).fetchone()[0]
    assert reclaimed == "reclaimed"
    connection.close()


def test_fixed_capture_error_resumes_on_a_fresh_connection(tmp_path: Path) -> None:
    database = tmp_path / "store.sqlite"
    connection = open_store(database)
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    service.enqueue_task(_open_task(session.session_id))
    lease = service.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert lease is not None
    with pytest.raises(CaptureError, match="^invalid_error_code$"):
        service.finish_attempt(CaptureFinishRequest(lease.task_id, lease.lease_token, "other"))
    status = service.finish_attempt(CaptureFinishRequest(
        lease.task_id, lease.lease_token, "challenge",
    ))
    assert (status.state, status.last_error_code) == ("queued", "challenge")
    connection.close()

    reopened = open_store(database)
    resumed = CaptureService(reopened, now=_Clock())
    again = resumed.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert again is not None and again.attempt_no == 2
    resumed.finish_attempt(CaptureFinishRequest(again.task_id, again.lease_token, "tab_closed"))
    third = resumed.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert third is not None and third.attempt_no == 3
    resumed.finish_attempt(CaptureFinishRequest(third.task_id, third.lease_token, "no_result"))
    progress = resumed.get_progress(session.session_id)
    assert progress.counts["failed"] == 1
    assert resumed.claim_task(CaptureClaimRequest(session.session_id, 60)) is None
    reopened.close()


def test_hard_task_cap_and_lease_bounds_are_enforced(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started, cap=2))
    service.enqueue_task(_search_task(session.session_id, query="alpha funding"))
    service.enqueue_task(_search_task(
        session.session_id, request_id="11111111-1111-4111-8111-111111111111", query="bravo funding",
    ))
    with pytest.raises(CaptureError, match="^task_cap_reached$"):
        service.enqueue_task(_search_task(
            session.session_id, request_id="22222222-2222-4222-8222-222222222222",
            query="charlie funding",
        ))
    with pytest.raises(CaptureError, match="^invalid_lease_seconds$"):
        service.claim_task(CaptureClaimRequest(session.session_id, 3600))
    with pytest.raises(CaptureError, match="^invalid_task_cap$"):
        service.start_session(CaptureSessionRequest(
            "33333333-3333-4333-8333-333333333333", started.run_id, started.intake_hash,
            SKILL_HASH, MAX_TASKS_PER_SESSION + 1,
        ))
    connection.close()


@pytest.mark.parametrize(
    ("kind", "query", "url", "code"),
    (
        (OPEN_KIND, None, "http://nimbus.test/funding", "invalid_url"),
        (OPEN_KIND, None, "https://nimbus.test\\other/", "invalid_url"),
        (OPEN_KIND, "extra", "https://nimbus.test/funding", "invalid_packet"),
        (SEARCH_KIND, None, None, "invalid_packet"),
        ("run_arbitrary_script", "x", None, "invalid_task_kind"),
    ),
)
def test_unsupported_packets_are_refused(tmp_path: Path, kind, query, url, code) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    with pytest.raises(CaptureError, match=f"^{code}$"):
        service.enqueue_task(CaptureTaskRequest(
            "44444444-4444-4444-8444-444444444444", session.session_id, kind, query, url,
        ))
    assert connection.execute("SELECT count(*) FROM prospecting_capture_task").fetchone()[0] == 0
    connection.close()


def test_unsafe_capture_paths_and_mismatched_url_are_refused(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    service.enqueue_task(_open_task(session.session_id))
    lease = service.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert lease is not None
    with pytest.raises(CaptureError, match="^invalid_body_ref$"):
        service.submit_capture(CaptureSubmitRequest(
            lease.task_id, lease.lease_token, "../outside.txt",
            "https://nimbus.test/funding", STAMP,
        ))
    body_ref = _incoming(tmp_path, "capture-mismatch.txt")
    with pytest.raises(CaptureError, match="^source_url_mismatch$"):
        service.submit_capture(CaptureSubmitRequest(
            lease.task_id, lease.lease_token, body_ref, "https://other.test/funding", STAMP,
        ))
    with pytest.raises(CaptureError, match="^invalid_time$"):
        service.submit_capture(CaptureSubmitRequest(
            lease.task_id, lease.lease_token, body_ref,
            "https://nimbus.test/funding", "2026-09-11T12:00:00Z",
        ))
    assert connection.execute("SELECT count(*) FROM source_snapshot").fetchone()[0] == 0
    connection.close()


def test_stale_intake_refuses_every_mutation(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    with pytest.raises(CaptureError, match="^intake_stale$"):
        service.start_session(CaptureSessionRequest(
            "55555555-5555-4555-8555-555555555555", started.run_id, "b" * 64, SKILL_HASH,
        ))
    connection.execute(
        "UPDATE campaign SET policy_hash=? WHERE campaign_id=?", ("d" * 64, CAMPAIGN_ID),
    )
    with pytest.raises(CaptureError, match="^store_state_invalid$"):
        service.enqueue_task(_open_task(session.session_id))
    with pytest.raises(CaptureError, match="^store_state_invalid$"):
        service.claim_task(CaptureClaimRequest(session.session_id, 60))
    connection.close()


def test_submit_failure_rolls_back_rows_and_owned_capture_files(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    service.enqueue_task(_open_task(session.session_id))
    lease = service.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert lease is not None
    connection.execute(
        """CREATE TEMP TRIGGER reject_capture_receipt
             BEFORE INSERT ON prospecting_capture_receipt
             BEGIN SELECT RAISE(ABORT,'synthetic_abort'); END""",
    )
    with pytest.raises(CaptureError, match="^store_state_invalid$"):
        service.submit_capture(CaptureSubmitRequest(
            lease.task_id, lease.lease_token, _incoming(tmp_path, "capture-rollback.txt"),
            "https://nimbus.test/funding", STAMP,
        ))
    assert connection.in_transaction is False
    for table in ("prospecting_capture_receipt", "source_snapshot"):
        assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    owned = tmp_path / "snapshots" / "capture-acquisition"
    assert not owned.exists() or not tuple(owned.iterdir())
    assert connection.execute(
        "SELECT state FROM prospecting_capture_task WHERE task_id=?", (lease.task_id,),
    ).fetchone()[0] == "leased"
    connection.close()


def test_tampered_stored_capture_fails_closed(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    service.enqueue_task(_open_task(session.session_id))
    lease = service.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert lease is not None
    receipt = service.submit_capture(CaptureSubmitRequest(
        lease.task_id, lease.lease_token, _incoming(tmp_path, "capture-tamper.txt"),
        "https://nimbus.test/funding", STAMP,
    ))
    body_ref = connection.execute(
        "SELECT body_ref FROM source_snapshot WHERE snapshot_id=?", (receipt.snapshot_id,),
    ).fetchone()[0]
    (tmp_path / "snapshots" / body_ref).write_text("changed", encoding="utf-8")
    with pytest.raises(CaptureError, match="^source_changed$"):
        service.verify_capture(lease.task_id)
    connection.close()


def _leased_service(tmp_path: Path, clock: _Clock | None = None):
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=clock or _Clock())
    session = service.start_session(_session_request(started))
    service.enqueue_task(_open_task(session.session_id))
    lease = service.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert lease is not None
    return connection, service, session, lease


def test_write_lock_contention_reports_fixed_store_busy_code(tmp_path: Path) -> None:
    database = tmp_path / "store.sqlite"
    connection = open_store(database)
    started = _seed(connection)
    connection.commit()
    service = CaptureService(connection, now=_Clock())
    connection.execute("PRAGMA busy_timeout=0")
    blocker = sqlite3.connect(database)
    blocker.execute("PRAGMA busy_timeout=0")
    blocker.execute("BEGIN IMMEDIATE")
    blocker.execute("CREATE TABLE blocking_writer(v TEXT)")
    with pytest.raises(CaptureError, match="^store_busy$"):
        service.start_session(_session_request(started))
    assert connection.in_transaction is False
    blocker.rollback()
    blocker.close()
    connection.close()


def test_caller_owned_transaction_is_refused_and_never_rolled_back(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    connection.execute("CREATE TEMP TABLE caller_scratch(v TEXT)")
    connection.commit()
    connection.execute("BEGIN")
    connection.execute("INSERT INTO caller_scratch VALUES('caller-write')")
    with pytest.raises(CaptureError, match="^transaction_active$"):
        service.enqueue_task(_open_task(session.session_id))
    with pytest.raises(CaptureError, match="^transaction_active$"):
        service.submit_capture(CaptureSubmitRequest(
            "pct_unknown", "lse_unknown", "../outside.txt",
            "https://nimbus.test/funding", STAMP,
        ))
    assert connection.in_transaction is True
    assert connection.execute("SELECT count(*) FROM caller_scratch").fetchone()[0] == 1
    connection.commit()
    connection.close()


def test_submit_validates_lease_before_touching_the_incoming_file(tmp_path: Path) -> None:
    connection, service, _session, lease = _leased_service(tmp_path)
    with pytest.raises(CaptureError, match="^lease_lost$"):
        service.submit_capture(CaptureSubmitRequest(
            lease.task_id, "lse_" + "0" * 64, "../outside.txt",
            "https://nimbus.test/funding", STAMP,
        ))
    with pytest.raises(CaptureError, match="^task_missing$"):
        service.submit_capture(CaptureSubmitRequest(
            "pct_" + "0" * 32, lease.lease_token, "../outside.txt",
            "https://nimbus.test/funding", STAMP,
        ))
    connection.close()


def test_lease_tokens_are_random_secrets_not_derived_values(tmp_path: Path) -> None:
    first_connection, _first, _fs, first = _leased_service(tmp_path / "one")
    second_connection, _second, _ss, second = _leased_service(tmp_path / "two")
    derived = "lse_" + uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"kb:prospecting:capture:lease:{first.task_id}:{first.lease_epoch}",
    ).hex
    assert first.task_id == second.task_id
    assert first.lease_token != second.lease_token
    assert first.lease_token != derived and second.lease_token != derived
    assert len(first.lease_token) == len("lse_") + 64
    first_connection.close()
    second_connection.close()


def test_retry_after_simulated_crash_orphan_succeeds_without_deleting_it(tmp_path: Path) -> None:
    connection, service, _session, lease = _leased_service(tmp_path)
    owned = tmp_path / "snapshots" / "capture-acquisition"
    owned.mkdir(parents=True, exist_ok=True)
    stale = "snap_" + uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"kb:prospecting:capture:{lease.task_id}:snapshot:{lease.lease_epoch}",
    ).hex
    (owned / f"{stale}.body").write_bytes(b"partial")
    (owned / f".{stale}.tmp").write_bytes(b"partial")
    receipt = service.submit_capture(CaptureSubmitRequest(
        lease.task_id, lease.lease_token, _incoming(tmp_path, "capture-crash.txt"),
        "https://nimbus.test/funding", STAMP,
    ))
    assert receipt.state == "captured" and receipt.snapshot_id != stale
    assert (owned / f"{stale}.body").read_bytes() == b"partial"
    assert (owned / f".{stale}.tmp").exists()
    assert service.verify_capture(lease.task_id).content_sha256 == receipt.content_sha256
    connection.close()


def test_committed_replay_returns_receipt_and_refuses_changed_payload(tmp_path: Path) -> None:
    connection, service, _session, lease = _leased_service(tmp_path)
    body_ref = _incoming(tmp_path, "capture-replay.txt")
    request = CaptureSubmitRequest(
        lease.task_id, lease.lease_token, body_ref, "https://nimbus.test/funding", STAMP,
    )
    receipt = service.submit_capture(request)
    again = service.submit_capture(request)
    assert (again.receipt_id, again.snapshot_id) == (receipt.receipt_id, receipt.snapshot_id)
    changed = _incoming(tmp_path, "capture-replay-changed.txt", "different visible text")
    with pytest.raises(CaptureError, match="^receipt_conflict$"):
        service.submit_capture(replace(request, body_ref=changed))
    for table in ("prospecting_capture_receipt", "source_snapshot"):
        assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 1
    connection.close()


def test_expired_capture_is_refused_before_reuse(tmp_path: Path) -> None:
    clock = _Clock()
    connection, service, _session, lease = _leased_service(tmp_path, clock)
    service.submit_capture(CaptureSubmitRequest(
        lease.task_id, lease.lease_token, _incoming(tmp_path, "capture-expiry.txt"),
        "https://nimbus.test/funding", STAMP,
    ))
    assert service.verify_capture(lease.task_id).state == "captured"
    clock.value = "2026-10-15T12:00:00Z"
    with pytest.raises(CaptureError, match="^capture_expired$"):
        service.verify_capture(lease.task_id)
    connection.close()


@pytest.mark.parametrize(
    "url",
    (
        "https://127.0.0.1/funding",
        "https://127.1/funding",
        "https://0177.0.0.1/funding",
        "https://0x7f.0x0.0x0.0x1/funding",
        "https://2130706433/funding",
    ),
)
def test_loopback_literal_urls_are_refused_without_dns(tmp_path: Path, url: str) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    with pytest.raises(CaptureError, match="^invalid_url$"):
        service.enqueue_task(CaptureTaskRequest(
            "66666666-6666-4666-8666-666666666666", session.session_id, OPEN_KIND, None, url,
        ))
    assert connection.execute("SELECT count(*) FROM prospecting_capture_task").fetchone()[0] == 0
    connection.close()


def test_tampered_stored_packet_fails_closed_at_claim(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = CaptureService(connection, now=_Clock())
    session = service.start_session(_session_request(started))
    service.enqueue_task(_open_task(session.session_id))
    connection.execute("DROP TRIGGER prospecting_capture_task_immutable_binding")
    connection.execute(
        "UPDATE prospecting_capture_task SET packet_json=? WHERE session_id=?",
        (
            '{"kind":"open_https_capture_visible_text","query":null,'
            '"url":"https://attacker.test/funding"}',
            session.session_id,
        ),
    )
    connection.commit()
    with pytest.raises(CaptureError, match="^store_state_invalid$"):
        service.claim_task(CaptureClaimRequest(session.session_id, 60))
    connection.close()


def test_cleanup_failure_is_surfaced_with_a_fixed_code(tmp_path: Path, monkeypatch) -> None:
    connection, service, _session, lease = _leased_service(tmp_path)
    connection.execute(
        """CREATE TEMP TRIGGER reject_capture_receipt_cleanup
             BEFORE INSERT ON prospecting_capture_receipt
             BEGIN SELECT RAISE(ABORT,'synthetic_abort'); END""",
    )

    def _refuse(created) -> None:
        raise OSError("cleanup refused")

    monkeypatch.setattr(research_capture_service, "cleanup_owned", _refuse)
    with pytest.raises(CaptureError, match="^capture_cleanup_failed$"):
        service.submit_capture(CaptureSubmitRequest(
            lease.task_id, lease.lease_token, _incoming(tmp_path, "capture-cleanup.txt"),
            "https://nimbus.test/funding", STAMP,
        ))
    assert connection.in_transaction is False
    for table in ("prospecting_capture_receipt", "source_snapshot"):
        assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    connection.close()


def test_committed_replay_refuses_tampered_owned_snapshot(tmp_path: Path) -> None:
    connection, service, _session, lease = _leased_service(tmp_path)
    body_ref = _incoming(tmp_path, "capture-replay-tamper.txt")
    request = CaptureSubmitRequest(
        lease.task_id, lease.lease_token, body_ref, "https://nimbus.test/funding", STAMP,
    )
    receipt = service.submit_capture(request)
    stored = connection.execute(
        "SELECT body_ref FROM source_snapshot WHERE snapshot_id=?", (receipt.snapshot_id,),
    ).fetchone()[0]
    (tmp_path / "snapshots" / stored).write_text("tampered", encoding="utf-8")
    with pytest.raises(CaptureError, match="^source_changed$"):
        service.submit_capture(request)
    connection.close()


def test_committed_replay_refuses_after_capture_expired(tmp_path: Path) -> None:
    clock = _Clock()
    connection, service, _session, lease = _leased_service(tmp_path, clock)
    body_ref = _incoming(tmp_path, "capture-replay-expiry.txt")
    request = CaptureSubmitRequest(
        lease.task_id, lease.lease_token, body_ref, "https://nimbus.test/funding", STAMP,
    )
    service.submit_capture(request)
    clock.value = "2026-10-15T12:00:00Z"
    with pytest.raises(CaptureError, match="^capture_expired$"):
        service.submit_capture(request)
    connection.close()

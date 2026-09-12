"""Integration tests for the private P23 capture acquisition CLI.

These tests drive the real ``research_capture_cli.main`` against a real store
built by the genuine P15 seed fixture.  The only substitution is a thin
subclass of the actual ``CaptureService`` that injects a deterministic clock;
no controller, lease, packet, decision or capture outcome is faked.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import sqlite3

import pytest

import scripts.prospecting.research_capture_cli as research_capture_cli
import scripts.prospecting.pipeline_cli as pipeline_cli
from scripts.prospecting.pipeline_cli import MAX_JSON_DEPTH
from scripts.prospecting.research_capture_cli import MAX_CAPTURE_INPUT_BYTES
from scripts.prospecting.research_capture_service import (
    MAX_LEASE_SECONDS,
    OPEN_KIND,
    SEARCH_KIND,
    CaptureService,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_research_capture_service import (
    LATER,
    SKILL_HASH,
    STAMP,
    _Clock,
    _seed,
)


URL = "https://capture.test/funding"
OTHER_URL = "https://other-capture.test/funding"
NUMERIC_URL = "https://2130706433.test/funding"
LITERAL_URL = "https://127.0.0.1/funding"
QUERY = "Nimbus Systems capture query"
PAGE = "Nimbus Systems visible page text captured by the operator."
EARLIER = "2026-09-10T11:00:00Z"
SESSION_REQUEST = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1"
OPEN_REQUEST = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1"
SEARCH_REQUEST = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1"
ALT_REQUEST = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1"
ALT_REQUEST_TWO = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1"
SESSION_FIELDS = {
    "session_id", "session_hash", "run_id", "intake_hash", "state", "counts",
    "replayed",
}
TASK_FIELDS = {"task_id", "session_id", "ordinal", "task_kind", "state", "replayed"}
CLAIM_FIELDS = {
    "task_id", "attempt_id", "attempt_no", "lease_epoch", "task_kind",
    "expires_at", "packet_ref", "claimed", "state",
}
RECEIPT_FIELDS = {
    "receipt_id", "task_id", "attempt_id", "snapshot_id", "content_sha256",
    "retrieved_at", "byte_count", "state",
}
STATUS_FIELDS = {
    "task_id", "ordinal", "task_kind", "state", "attempt_count", "last_error_code",
}
PROGRESS_FIELDS = {
    "session_id", "session_hash", "run_id", "intake_hash", "state", "counts", "tasks",
}
PACKET_FIELDS = {
    "task_id", "attempt_id", "attempt_no", "lease_token", "lease_epoch",
    "task_kind", "expires_at", "query", "url",
}
EVIDENCE_TABLES = (
    "company", "person", "employment", "approval", "prospecting_funding_batch",
)


def _prepare(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Build an approved private store holding one saved P15 intake."""
    root = tmp_path / "local" / "kb-prospecting"
    snapshots = root / "snapshots"
    snapshots.mkdir(parents=True)
    store = root / "store.sqlite"
    connection = open_store(store)
    started = _seed(connection)
    connection.close()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    return store, snapshots, started


def _clocked(monkeypatch: pytest.MonkeyPatch, clock: _Clock) -> _Clock:
    """Bind the real CaptureService to one deterministic clock."""

    class _ClockedCaptureService(CaptureService):
        def __init__(self, connection, *, now=None) -> None:
            super().__init__(connection, now=now or clock)

    monkeypatch.setattr(research_capture_cli, "CaptureService", _ClockedCaptureService)
    return clock


def _synthetic_checkout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Point ``_approved_store``'s repo-root discovery at a disposable, real
    checkout under ``tmp_path``, so an ambient ``_private`` root can never
    make ``tmp_path / "outside.sqlite"`` spuriously approved."""
    synthetic_repo = tmp_path / "synthetic-checkout"
    (synthetic_repo / "scripts" / "prospecting").mkdir(parents=True)
    (synthetic_repo / ".git").mkdir()
    (synthetic_repo / "_private").mkdir()
    monkeypatch.setattr(
        pipeline_cli, "__file__",
        str(synthetic_repo / "scripts" / "prospecting" / "pipeline_cli.py"),
    )


def _forbid_open_store(*_args, **_kwargs):
    raise AssertionError("open_store must not be called for a refused store")


def _write(folder: Path, value: object, name: str) -> Path:
    path = folder / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def _write_raw(folder: Path, raw: bytes, name: str) -> Path:
    path = folder / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path


def _incoming(snapshots: Path, name: str, text: str = PAGE) -> str:
    folder = snapshots / "incoming"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(text, encoding="utf-8")
    return f"incoming/{name}"


def _session_payload(started, *, request_id: str = SESSION_REQUEST, task_cap: int = 4):
    return {
        "request_id": request_id,
        "run_id": started.run_id,
        "expected_intake_hash": started.intake_hash,
        "acquisition_skill_hash": SKILL_HASH,
        "task_cap": task_cap,
    }


def _open_payload(session_id: str, *, request_id: str = OPEN_REQUEST, url: str = URL):
    return {
        "request_id": request_id, "session_id": session_id,
        "task_kind": OPEN_KIND, "query": None, "url": url,
    }


def _search_payload(session_id: str, *, request_id: str = SEARCH_REQUEST, query: str = QUERY):
    return {
        "request_id": request_id, "session_id": session_id,
        "task_kind": SEARCH_KIND, "query": query, "url": None,
    }


def _submit_payload(task_id: str, token: str, body_ref: str, retrieved_at: str):
    return {
        "task_id": task_id, "lease_token": token, "body_ref": body_ref,
        "source_url": URL, "retrieved_at": retrieved_at,
    }


def _submit_packet_payload(
    packet_ref: str, body_ref: str, *, retrieved_at: str = STAMP,
    source_url: str = URL,
):
    return {
        "packet_ref": packet_ref, "body_ref": body_ref,
        "source_url": source_url, "retrieved_at": retrieved_at,
    }


def _expiry(stamp: str, seconds: int) -> str:
    return (
        datetime.fromisoformat(stamp.replace("Z", "+00:00")) + timedelta(seconds=seconds)
    ).isoformat()


def _assert_private_absent(text: str, *extra: str) -> None:
    for value in (QUERY, URL, OTHER_URL, "capture.test", PAGE, *extra):
        assert value not in text


def _cli(store: Path, option: str, value: object, capsys):
    code = research_capture_cli.main(["--store", str(store), option, str(value)])
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def _ok(store: Path, option: str, value: object, capsys) -> dict:
    code, out, err = _cli(store, option, value, capsys)
    assert (code, err) == (0, "")
    _assert_private_absent(out)
    return json.loads(out)


def _refused(store: Path, option: str, value: object, capsys) -> str:
    code, out, err = _cli(store, option, value, capsys)
    assert (code, out) == (2, "")
    assert err.startswith("capture_cli_error:") and err.count("\n") == 1
    assert err.endswith("\n")
    _assert_private_absent(err)
    text = str(value)
    if text:
        assert text not in err
    return err.removeprefix("capture_cli_error:").strip()


def _count(connection: sqlite3.Connection, table: str) -> int:
    return int(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0])


def _assert_no_capture_rows(store: Path) -> None:
    connection = open_store(store)
    try:
        for table in (
            "prospecting_capture_session", "prospecting_capture_task",
            "prospecting_capture_attempt", "prospecting_capture_receipt",
            "source_snapshot",
        ):
            assert _count(connection, table) == 0
    finally:
        connection.close()


def test_saved_intake_flow_keeps_query_url_and_lease_token_in_the_packet_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())

    session = _ok(store, "--session-start", _write(
        snapshots, _session_payload(started), "capture/session.json",
    ), capsys)
    assert set(session) == SESSION_FIELDS
    assert session["run_id"] == started.run_id
    assert session["intake_hash"] == started.intake_hash
    assert session["state"] == "accepting_capture_tasks"
    assert session["replayed"] is False

    opened = _ok(store, "--enqueue", _write(
        snapshots, _open_payload(session["session_id"]), "capture/open.json",
    ), capsys)
    searched = _ok(store, "--enqueue", _write(
        snapshots, _search_payload(session["session_id"]), "capture/search.json",
    ), capsys)
    assert set(opened) == set(searched) == TASK_FIELDS
    assert (opened["ordinal"], opened["task_kind"], opened["state"]) == (0, OPEN_KIND, "queued")
    assert (searched["ordinal"], searched["task_kind"]) == (1, SEARCH_KIND)

    claim = _ok(store, "--claim", session["session_id"], capsys)
    assert set(claim) == CLAIM_FIELDS
    assert claim["claimed"] is True and claim["state"] == "leased"
    assert claim["task_id"] == opened["task_id"]
    assert (claim["attempt_no"], claim["lease_epoch"]) == (1, 1)
    assert claim["task_kind"] == OPEN_KIND
    assert claim["expires_at"] == _expiry(STAMP, MAX_LEASE_SECONDS)
    assert claim["packet_ref"].startswith("capture-packets/pkt_")

    packet = json.loads((snapshots / claim["packet_ref"]).read_text(encoding="utf-8"))
    assert set(packet) == PACKET_FIELDS
    assert packet["url"] == URL and packet["query"] is None
    assert packet["task_id"] == claim["task_id"]
    assert packet["attempt_id"] == claim["attempt_id"]
    assert packet["attempt_no"] == claim["attempt_no"]
    assert packet["lease_epoch"] == claim["lease_epoch"]
    assert packet["expires_at"] == claim["expires_at"]
    token = packet["lease_token"]
    assert token.startswith("lse_") and len(token) == len("lse_") + 64

    receipt = _ok(store, "--submit", _write(
        snapshots,
        _submit_payload(claim["task_id"], token, _incoming(snapshots, "page.txt"), STAMP),
        "capture/submit.json",
    ), capsys)
    assert set(receipt) == RECEIPT_FIELDS
    assert receipt["state"] == "captured"
    assert receipt["byte_count"] == len(PAGE.encode("utf-8"))
    assert receipt["retrieved_at"].startswith("2026-09-10T12:00:00")

    verified = _ok(store, "--verify", claim["task_id"], capsys)
    assert verified == receipt

    progress = _ok(store, "--progress", session["session_id"], capsys)
    assert set(progress) == PROGRESS_FIELDS
    assert progress["run_id"] == started.run_id
    assert progress["counts"]["captured"] == 1
    assert progress["counts"]["queued"] == 1
    assert progress["counts"]["tasks"] == 2
    assert [set(status) for status in progress["tasks"]] == [STATUS_FIELDS, STATUS_FIELDS]
    assert progress["tasks"][0]["state"] == "captured"
    assert progress["tasks"][0]["attempt_count"] == 1
    assert progress["tasks"][1]["state"] == "queued"
    assert progress["tasks"][1]["last_error_code"] is None

    public = "".join(json.dumps(value, sort_keys=True) for value in (
        session, opened, searched, claim, receipt, verified, progress,
    ))
    _assert_private_absent(public, token)

    connection = open_store(store)
    try:
        stored = connection.execute(
            "SELECT body_ref FROM source_snapshot WHERE snapshot_id=?",
            (receipt["snapshot_id"],),
        ).fetchone()[0]
        assert (snapshots / str(stored)).read_bytes() == PAGE.encode("utf-8")
        for table in EVIDENCE_TABLES:
            assert _count(connection, table) == 0
    finally:
        connection.close()


def test_exact_session_and_enqueue_replay_add_no_rows_and_conflicts_are_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())

    session_source = _write(snapshots, _session_payload(started), "capture/session.json")
    first = _ok(store, "--session-start", session_source, capsys)
    replayed = _ok(store, "--session-start", session_source, capsys)
    assert replayed == {**first, "replayed": True}

    open_source = _write(
        snapshots, _open_payload(first["session_id"]), "capture/open.json",
    )
    task = _ok(store, "--enqueue", open_source, capsys)
    task_replay = _ok(store, "--enqueue", open_source, capsys)
    assert task_replay == {**task, "replayed": True}

    changed_cap = _write(
        snapshots, _session_payload(started, task_cap=2), "capture/session-cap.json",
    )
    assert _refused(store, "--session-start", changed_cap, capsys) == "request_conflict"
    changed_url = _write(
        snapshots, _open_payload(first["session_id"], url=OTHER_URL),
        "capture/open-changed.json",
    )
    assert _refused(store, "--enqueue", changed_url, capsys) == "request_conflict"
    same_packet = _write(
        snapshots, _open_payload(first["session_id"], request_id=ALT_REQUEST),
        "capture/open-duplicate.json",
    )
    assert _refused(store, "--enqueue", same_packet, capsys) == "duplicate_packet"

    connection = open_store(store)
    try:
        assert _count(connection, "prospecting_capture_session") == 1
        assert _count(connection, "prospecting_capture_task") == 1
        assert _count(connection, "prospecting_capture_attempt") == 0
    finally:
        connection.close()


@pytest.mark.parametrize(
    ("name", "raw", "code"),
    (
        (
            "duplicate",
            b'{"request_id":"b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",'
            b'"request_id":"c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1"}',
            "capture_input_duplicate_key",
        ),
        ("unknown", json.dumps({"query": QUERY}).encode(), "capture_input_schema_invalid"),
        ("malformed", b'{"url":"https://capture.test/funding"', "capture_input_json_invalid"),
        (
            "deep",
            b"[" * (MAX_JSON_DEPTH + 1) + json.dumps(QUERY).encode()
            + b"]" * (MAX_JSON_DEPTH + 1),
            "capture_input_json_too_deep",
        ),
        (
            "oversized",
            b'{"query":"' + b"x" * MAX_CAPTURE_INPUT_BYTES,
            "capture_input_too_large",
        ),
    ),
)
def test_private_capture_inputs_are_refused_with_sanitized_codes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
    name: str, raw: bytes, code: str,
) -> None:
    store, snapshots, _started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    source = _write_raw(snapshots, raw, f"capture/{name}.json")
    assert _refused(store, "--session-start", source, capsys) == code
    _assert_no_capture_rows(store)


def test_linked_or_outside_inputs_are_refused_before_any_capture_row(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    payload = _session_payload(started)

    outside = _write(tmp_path, payload, "outside-session.json")
    assert _refused(
        store, "--session-start", outside, capsys,
    ) == "capture_input_snapshot_required"

    target = _write(snapshots, payload, "capture/session.json")
    link = snapshots / "capture" / "link.json"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("file symlinks unavailable")
    assert _refused(store, "--session-start", link, capsys) == "capture_input_invalid"

    hard = snapshots / "capture" / "hard.json"
    try:
        os.link(target, hard)
    except OSError:
        pytest.skip("hardlinks unavailable")
    assert _refused(store, "--session-start", hard, capsys) == "capture_input_invalid"
    _assert_no_capture_rows(store)


def test_capture_recorded_outside_the_injected_clock_window_is_refused_without_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    session = _ok(store, "--session-start", _write(
        snapshots, _session_payload(started), "capture/session.json",
    ), capsys)
    _ok(store, "--enqueue", _write(
        snapshots, _open_payload(session["session_id"]), "capture/open.json",
    ), capsys)
    claim = _ok(store, "--claim", session["session_id"], capsys)
    token = json.loads(
        (snapshots / claim["packet_ref"]).read_text(encoding="utf-8"),
    )["lease_token"]
    body_ref = _incoming(snapshots, "page-clock.txt")

    future = _write(
        snapshots, _submit_payload(claim["task_id"], token, body_ref, LATER),
        "capture/submit-future.json",
    )
    assert _refused(store, "--submit", future, capsys) == "invalid_time"
    stale = _write(
        snapshots, _submit_payload(claim["task_id"], token, body_ref, EARLIER),
        "capture/submit-stale.json",
    )
    assert _refused(store, "--submit", stale, capsys) == "source_stale"

    connection = open_store(store)
    try:
        assert _count(connection, "prospecting_capture_receipt") == 0
        assert _count(connection, "source_snapshot") == 0
        assert connection.execute(
            "SELECT state FROM prospecting_capture_task WHERE task_id=?",
            (claim["task_id"],),
        ).fetchone()[0] == "leased"
    finally:
        connection.close()

    accepted = _ok(store, "--submit", _write(
        snapshots, _submit_payload(claim["task_id"], token, body_ref, STAMP),
        "capture/submit-now.json",
    ), capsys)
    assert accepted["state"] == "captured"


def test_claim_refuses_before_any_lease_when_the_snapshots_root_is_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """A missing/rejected snapshots root must be caught before any commit.

    ``_claim_output`` resolves and validates the private ``snapshots/`` root
    strictly before calling ``service.claim_task``.  A store whose root is
    unavailable must therefore leave the task exactly as it was (``queued``,
    zero attempts) across any number of repeated claim calls: nothing is ever
    burned by a directory outage, and once the directory is repaired the very
    next claim gets the task's first real attempt.
    """
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    session = _ok(store, "--session-start", _write(
        snapshots, _session_payload(started), "capture/session.json",
    ), capsys)
    task = _ok(store, "--enqueue", _write(
        snapshots, _open_payload(session["session_id"]), "capture/open.json",
    ), capsys)

    away = store.parent / "snapshots-away"
    snapshots.rename(away)
    # Repeated calls against the missing root must each refuse pre-claim,
    # never committing a lease and never consuming an attempt.
    assert _refused(store, "--claim", session["session_id"], capsys) == "packet_export_failed"
    assert _refused(store, "--claim", session["session_id"], capsys) == "packet_export_failed"
    away.rename(snapshots)

    connection = open_store(store)
    try:
        row = connection.execute(
            """SELECT state,attempt_count,lease_epoch,lease_token
                 FROM prospecting_capture_task WHERE task_id=?""", (task["task_id"],),
        ).fetchone()
        assert (str(row[0]), int(row[1]), int(row[2]), row[3]) == ("queued", 0, 0, None)
        assert _count(connection, "prospecting_capture_attempt") == 0
        assert _count(connection, "prospecting_capture_receipt") == 0
    finally:
        connection.close()

    # Once the directory is repaired the task claims cleanly as attempt one,
    # not attempt two: no attempt was ever silently burned by the outage.
    claimed = _ok(store, "--claim", session["session_id"], capsys)
    assert claimed["claimed"] is True
    assert claimed["task_id"] == task["task_id"]
    assert (claimed["attempt_no"], claimed["lease_epoch"]) == (1, 1)
    assert claimed["expires_at"] == _expiry(STAMP, MAX_LEASE_SECONDS)
    packet = json.loads((snapshots / claimed["packet_ref"]).read_text(encoding="utf-8"))
    assert packet["url"] == URL and packet["lease_epoch"] == 1


def test_claim_packet_export_failure_keeps_the_committed_lease_until_expiry_reclaim(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """A genuine post-commit export failure must never touch the SQL lease.

    Here the ``snapshots/`` root itself is a real, valid directory (so the
    hoisted pre-claim validation passes and ``service.claim_task`` runs its
    real SQL lease commit).  The failure is injected only inside the private
    packet export step, strictly after the commit, by occupying the
    ``capture-packets`` child path with a plain file so the export's own
    ``mkdir`` is refused.  This is a bounded, real-filesystem injection of a
    known child export failure; it never fakes or skips the SQL lease.
    """
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    clock = _clocked(monkeypatch, _Clock())
    session = _ok(store, "--session-start", _write(
        snapshots, _session_payload(started), "capture/session.json",
    ), capsys)
    task = _ok(store, "--enqueue", _write(
        snapshots, _open_payload(session["session_id"]), "capture/open.json",
    ), capsys)

    blocker = snapshots / "capture-packets"
    blocker.write_bytes(b"")
    assert _refused(store, "--claim", session["session_id"], capsys) == "packet_export_failed"
    blocker.unlink()
    assert not (snapshots / "capture-packets").exists()

    connection = open_store(store)
    try:
        row = connection.execute(
            """SELECT state,attempt_count,lease_epoch FROM prospecting_capture_task
                WHERE task_id=?""", (task["task_id"],),
        ).fetchone()
        assert (str(row[0]), int(row[1]), int(row[2])) == ("leased", 1, 1)
        assert connection.execute(
            "SELECT count(*) FROM prospecting_capture_attempt WHERE state='open'",
        ).fetchone()[0] == 1
        assert _count(connection, "prospecting_capture_receipt") == 0
    finally:
        connection.close()

    blocked = _ok(store, "--claim", session["session_id"], capsys)
    assert blocked == {
        "session_id": session["session_id"], "claimed": False,
        "state": "no_capture_task_available",
    }

    clock.value = LATER
    reclaimed = _ok(store, "--claim", session["session_id"], capsys)
    assert reclaimed["claimed"] is True
    assert reclaimed["task_id"] == task["task_id"]
    assert (reclaimed["attempt_no"], reclaimed["lease_epoch"]) == (2, 2)
    assert reclaimed["expires_at"] == _expiry(LATER, MAX_LEASE_SECONDS)
    packet = json.loads((snapshots / reclaimed["packet_ref"]).read_text(encoding="utf-8"))
    assert packet["url"] == URL and packet["lease_epoch"] == 2

    connection = open_store(store)
    try:
        states = [
            str(value[0]) for value in connection.execute(
                """SELECT state FROM prospecting_capture_attempt
                    WHERE task_id=? ORDER BY attempt_no""", (task["task_id"],),
            ).fetchall()
        ]
        assert states == ["reclaimed", "open"]
        assert _count(connection, "prospecting_capture_receipt") == 0
    finally:
        connection.close()


def test_tampered_stored_packet_is_refused_at_claim_without_creating_a_lease(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    session = _ok(store, "--session-start", _write(
        snapshots, _session_payload(started), "capture/session.json",
    ), capsys)
    task = _ok(store, "--enqueue", _write(
        snapshots, _open_payload(session["session_id"]), "capture/open.json",
    ), capsys)

    connection = open_store(store)
    connection.execute("DROP TRIGGER prospecting_capture_task_immutable_binding")
    connection.execute(
        "UPDATE prospecting_capture_task SET packet_json=? WHERE task_id=?",
        (
            json.dumps({
                "kind": OPEN_KIND, "query": None, "url": URL,
                "script": "download and execute",
            }),
            task["task_id"],
        ),
    )
    connection.commit()
    connection.close()

    assert _refused(store, "--claim", session["session_id"], capsys) == "store_state_invalid"
    assert not (snapshots / "capture-packets").exists()

    connection = open_store(store)
    try:
        row = connection.execute(
            """SELECT state,attempt_count,lease_epoch,lease_token
                 FROM prospecting_capture_task WHERE task_id=?""", (task["task_id"],),
        ).fetchone()
        assert (str(row[0]), int(row[1]), int(row[2]), row[3]) == ("queued", 0, 0, None)
        for table in (
            "prospecting_capture_attempt", "prospecting_capture_receipt", "source_snapshot",
            *EVIDENCE_TABLES,
        ):
            assert _count(connection, table) == 0
    finally:
        connection.close()


def test_numeric_dns_label_is_accepted_but_ip_literal_host_is_refused_privately(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    session = _ok(store, "--session-start", _write(
        snapshots, _session_payload(started), "capture/session.json",
    ), capsys)

    accepted = _ok(store, "--enqueue", _write(
        snapshots, _open_payload(session["session_id"], url=NUMERIC_URL),
        "capture/numeric.json",
    ), capsys)
    assert (accepted["task_kind"], accepted["state"]) == (OPEN_KIND, "queued")
    assert NUMERIC_URL not in json.dumps(accepted)

    code, out, err = _cli(store, "--enqueue", _write(
        snapshots, _open_payload(session["session_id"], request_id=ALT_REQUEST_TWO, url=LITERAL_URL),
        "capture/literal.json",
    ), capsys)
    assert (code, out) == (2, "")
    assert err == "capture_cli_error:invalid_url\n"

    connection = open_store(store)
    try:
        assert _count(connection, "prospecting_capture_task") == 1
    finally:
        connection.close()


def test_store_selection_is_bounded_and_each_invocation_releases_the_store(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    session = _ok(store, "--session-start", _write(
        snapshots, _session_payload(started), "capture/session.json",
    ), capsys)

    missing = store.parent / "missing.sqlite"
    assert _refused(missing, "--progress", session["session_id"], capsys) == "store_invalid"
    assert not missing.exists()

    wrong_suffix = store.parent / "store.db"
    wrong_suffix.write_bytes(b"")
    assert _refused(
        wrong_suffix, "--progress", session["session_id"], capsys,
    ) == "store_invalid"

    _synthetic_checkout(tmp_path, monkeypatch)
    outside = tmp_path / "outside.sqlite"
    outside.write_bytes(b"")
    with monkeypatch.context() as isolated:
        isolated.setattr(research_capture_cli, "open_store", _forbid_open_store)
        assert _refused(
            outside, "--progress", session["session_id"], capsys,
        ) == "store_private_root_required"
    assert outside.read_bytes() == b""

    assert _refused(store, "--progress", "pcs_" + "0" * 32, capsys) == "session_missing"
    assert _refused(store, "--verify", "pct_" + "0" * 32, capsys) == "capture_missing"

    blocker = sqlite3.connect(store)
    try:
        blocker.execute("PRAGMA busy_timeout=0")
        blocker.execute("BEGIN IMMEDIATE")
        blocker.execute("CREATE TABLE released_probe(v TEXT)")
        blocker.rollback()
    finally:
        blocker.close()


def test_invalid_arguments_never_echo_the_private_argument(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, _snapshots, _started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())

    for argv in (
        ["--store", str(store), f"--unknown={QUERY}"],
        ["--store", str(store), "--claim", "pcs_x", "--progress", "pcs_x"],
        ["--store", str(store)],
    ):
        code = research_capture_cli.main(argv)
        captured = capsys.readouterr()
        assert (code, captured.out) == (2, "")
        assert captured.err == "capture_cli_error:invalid_arguments\n"
        _assert_private_absent(captured.err)
    _assert_no_capture_rows(store)


def _claimed(store: Path, snapshots: Path, started, capsys, *, prefix: str = "packet"):
    """Drive the real session/enqueue/claim path and return its outputs."""
    session = _ok(store, "--session-start", _write(
        snapshots, _session_payload(started), f"capture/{prefix}-session.json",
    ), capsys)
    _ok(store, "--enqueue", _write(
        snapshots, _open_payload(session["session_id"]), f"capture/{prefix}-open.json",
    ), capsys)
    return session, _ok(store, "--claim", session["session_id"], capsys)


def _task_row(store: Path, task_id: str):
    connection = open_store(store)
    try:
        row = connection.execute(
            """SELECT state,attempt_count,lease_epoch FROM prospecting_capture_task
                WHERE task_id=?""", (task_id,),
        ).fetchone()
        return (
            str(row[0]), int(row[1]), int(row[2]),
            _count(connection, "prospecting_capture_receipt"),
            _count(connection, "source_snapshot"),
        )
    finally:
        connection.close()


def test_submit_packet_uses_the_real_claim_packet_and_replays_like_submit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """The packet written by a genuine claim drives one real service submit."""
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    _session, claim = _claimed(store, snapshots, started, capsys)
    source = _write(snapshots, _submit_packet_payload(
        claim["packet_ref"], _incoming(snapshots, "packet-page.txt"),
    ), "capture/submit-packet.json")

    receipt = _ok(store, "--submit-packet", source, capsys)
    assert set(receipt) == RECEIPT_FIELDS
    assert receipt["task_id"] == claim["task_id"]
    assert receipt["attempt_id"] == claim["attempt_id"]
    assert receipt["state"] == "captured"
    assert receipt["byte_count"] == len(PAGE.encode("utf-8"))

    # Replay is exactly the current service's replay, not a CLI shortcut.
    assert _ok(store, "--submit-packet", source, capsys) == receipt
    assert _ok(store, "--verify", claim["task_id"], capsys) == receipt

    token = json.loads(
        (snapshots / claim["packet_ref"]).read_text(encoding="utf-8"),
    )["lease_token"]
    _assert_private_absent(json.dumps(receipt, sort_keys=True), token)

    connection = open_store(store)
    try:
        assert _count(connection, "prospecting_capture_receipt") == 1
        assert _count(connection, "source_snapshot") == 1
        for table in EVIDENCE_TABLES:
            assert _count(connection, table) == 0
    finally:
        connection.close()


def test_submit_packet_is_refused_once_the_lease_expires_or_is_reclaimed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """A stale packet never revives a lease the service no longer honours."""
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    clock = _clocked(monkeypatch, _Clock())
    session, claim = _claimed(store, snapshots, started, capsys)
    source = _write(snapshots, _submit_packet_payload(
        claim["packet_ref"], _incoming(snapshots, "packet-expired.txt"),
    ), "capture/submit-packet-expired.json")

    clock.value = LATER
    assert _refused(store, "--submit-packet", source, capsys) == "lease_expired"

    reclaimed = _ok(store, "--claim", session["session_id"], capsys)
    assert reclaimed["task_id"] == claim["task_id"]
    assert reclaimed["packet_ref"] != claim["packet_ref"]
    assert (reclaimed["attempt_no"], reclaimed["lease_epoch"]) == (2, 2)
    assert _refused(store, "--submit-packet", source, capsys) == "lease_lost"

    assert _task_row(store, claim["task_id"]) == ("leased", 2, 2, 0, 0)


@pytest.mark.parametrize(
    ("name", "raw", "code"),
    (
        ("truncated", b'{"task_id":"pct_x"', "capture_packet_json_invalid"),
        (
            "duplicate",
            b'{"task_id":"pct_a","task_id":"pct_b"}',
            "capture_packet_duplicate_key",
        ),
        (
            "deep",
            b"[" * (MAX_JSON_DEPTH + 1) + b"1" + b"]" * (MAX_JSON_DEPTH + 1),
            "capture_packet_json_too_deep",
        ),
        ("array", b"[]", "capture_packet_schema_invalid"),
    ),
)
def test_tampered_packet_bytes_are_refused_before_any_receipt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
    name: str, raw: bytes, code: str,
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    _session, claim = _claimed(store, snapshots, started, capsys)
    (snapshots / claim["packet_ref"]).write_bytes(raw)
    source = _write(snapshots, _submit_packet_payload(
        claim["packet_ref"], _incoming(snapshots, f"packet-{name}.txt"),
    ), f"capture/submit-{name}.json")

    assert _refused(store, "--submit-packet", source, capsys) == code
    assert _task_row(store, claim["task_id"]) == ("leased", 1, 1, 0, 0)


def test_tampered_packet_envelope_and_identifiers_are_refused_without_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """Envelope shape is checked here; identity stays the service's judgement."""
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    _session, claim = _claimed(store, snapshots, started, capsys)
    packet_path = snapshots / claim["packet_ref"]
    original = json.loads(packet_path.read_text(encoding="utf-8"))
    source = _write(snapshots, _submit_packet_payload(
        claim["packet_ref"], _incoming(snapshots, "packet-envelope.txt"),
    ), "capture/submit-envelope.json")

    for mutation in (
        {**original, "extra": "x"},
        {key: value for key, value in original.items() if key != "url"},
        {**original, "attempt_no": "1"},
        {**original, "lease_epoch": True},
        {**original, "task_kind": "download_and_run"},
        {**original, "query": QUERY},
        {**original, "lease_token": ""},
    ):
        packet_path.write_text(json.dumps(mutation), encoding="utf-8")
        assert _refused(
            store, "--submit-packet", source, capsys,
        ) == "capture_packet_schema_invalid"

    packet_path.write_text(
        json.dumps({**original, "lease_token": "lse_" + "0" * 64}), encoding="utf-8",
    )
    assert _refused(store, "--submit-packet", source, capsys) == "lease_lost"
    packet_path.write_text(
        json.dumps({**original, "task_id": "pct_" + "0" * 32}), encoding="utf-8",
    )
    assert _refused(store, "--submit-packet", source, capsys) == "task_missing"

    assert _task_row(store, claim["task_id"]) == ("leased", 1, 1, 0, 0)


def test_packet_refs_outside_this_store_own_packets_are_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    _session, claim = _claimed(store, snapshots, started, capsys)
    body_ref = _incoming(snapshots, "packet-refs.txt")
    name = Path(claim["packet_ref"]).name

    for index, ref in enumerate((
        "../" + claim["packet_ref"],
        "capture-packets/../capture-packets/" + name,
        "capture-packets/../../outside.body",
        "/" + claim["packet_ref"],
        str(snapshots / claim["packet_ref"]),
        "incoming/" + name,
        name,
        "capture-packets/pkt_" + "z" * 32 + ".body",
        "capture-packets/" + name.removesuffix(".body"),
        claim["packet_ref"].upper(),
    )):
        source = _write(
            snapshots, _submit_packet_payload(ref, body_ref), f"capture/ref-{index}.json",
        )
        assert _refused(
            store, "--submit-packet", source, capsys,
        ) == "capture_packet_ref_invalid"

    # A well-shaped but absent reference is a plain read refusal.
    absent = "capture-packets/pkt_" + "0" * 32 + ".body"
    source = _write(
        snapshots, _submit_packet_payload(absent, body_ref), "capture/ref-absent.json",
    )
    assert _refused(store, "--submit-packet", source, capsys) == "capture_packet_invalid"

    # A packet that exists only in another store's snapshots is unreachable.
    foreign_ref = "capture-packets/pkt_" + "1" * 32 + ".body"
    foreign = store.parent.parent / "other-store" / "snapshots"
    (foreign / "capture-packets").mkdir(parents=True)
    (foreign / foreign_ref).write_text(
        (snapshots / claim["packet_ref"]).read_text(encoding="utf-8"), encoding="utf-8",
    )
    source = _write(
        snapshots, _submit_packet_payload(foreign_ref, body_ref), "capture/ref-cross.json",
    )
    assert _refused(store, "--submit-packet", source, capsys) == "capture_packet_invalid"

    assert _task_row(store, claim["task_id"]) == ("leased", 1, 1, 0, 0)


def test_linked_packet_files_are_refused_without_reading_their_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    _session, claim = _claimed(store, snapshots, started, capsys)
    body_ref = _incoming(snapshots, "packet-link.txt")
    target = snapshots / claim["packet_ref"]

    link_ref = "capture-packets/pkt_" + "2" * 32 + ".body"
    try:
        (snapshots / link_ref).symlink_to(target)
    except OSError:
        pytest.skip("file symlinks unavailable")
    source = _write(
        snapshots, _submit_packet_payload(link_ref, body_ref), "capture/link-packet.json",
    )
    assert _refused(store, "--submit-packet", source, capsys) == "capture_packet_invalid"

    hard_ref = "capture-packets/pkt_" + "3" * 32 + ".body"
    try:
        os.link(target, snapshots / hard_ref)
    except OSError:
        pytest.skip("hardlinks unavailable")
    source = _write(
        snapshots, _submit_packet_payload(hard_ref, body_ref), "capture/hard-packet.json",
    )
    assert _refused(store, "--submit-packet", source, capsys) == "capture_packet_invalid"

    assert _task_row(store, claim["task_id"]) == ("leased", 1, 1, 0, 0)


def test_submit_packet_validates_caller_input_before_opening_the_store(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    """Input and packet checks precede ``open_store`` and burn no attempt."""
    store, snapshots, started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())
    _session, claim = _claimed(store, snapshots, started, capsys)
    body_ref = _incoming(snapshots, "packet-before-open.txt")
    payload = _submit_packet_payload(claim["packet_ref"], body_ref)

    def forbidden_open_store(*_args, **_kwargs):
        raise AssertionError("open_store called for packet body_ref refusal")

    packet_body_refs = (
        claim["packet_ref"],
        "./" + claim["packet_ref"],
        claim["packet_ref"].replace("capture-packets", "CAPTURE-PACKETS", 1),
        claim["packet_ref"].replace("/", "\\", 1),
    )
    with monkeypatch.context() as isolated:
        isolated.setattr(research_capture_cli, "open_store", forbidden_open_store)
        for index, packet_body_ref in enumerate(packet_body_refs):
            malformed = _write(
                snapshots,
                _submit_packet_payload(claim["packet_ref"], packet_body_ref),
                f"capture/submit-packet-body-{index}.json",
            )
            assert _refused(
                store, "--submit-packet", malformed, capsys,
            ) == "capture_packet_body_ref_invalid"
    assert _task_row(store, claim["task_id"]) == ("leased", 1, 1, 0, 0)

    outside = _write(tmp_path, payload, "outside-submit-packet.json")
    assert _refused(
        store, "--submit-packet", outside, capsys,
    ) == "capture_input_snapshot_required"

    inside = _write(snapshots, payload, "capture/submit-before-open.json")
    missing_store = store.parent / "missing.sqlite"
    assert _refused(missing_store, "--submit-packet", inside, capsys) == "store_invalid"
    assert not missing_store.exists()

    unknown = _write(
        snapshots, {**payload, "task_id": "pct_x"}, "capture/submit-unknown.json",
    )
    assert _refused(
        store, "--submit-packet", unknown, capsys,
    ) == "capture_input_schema_invalid"

    missing_field = _write(
        snapshots, {key: value for key, value in payload.items() if key != "source_url"},
        "capture/submit-missing-field.json",
    )
    assert _refused(
        store, "--submit-packet", missing_field, capsys,
    ) == "capture_input_schema_invalid"

    assert _task_row(store, claim["task_id"]) == ("leased", 1, 1, 0, 0)
    receipt = _ok(store, "--submit-packet", inside, capsys)
    assert receipt["state"] == "captured"


def test_submit_and_submit_packet_are_mutually_exclusive_and_echo_no_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store, _snapshots, _started = _prepare(tmp_path, monkeypatch)
    _clocked(monkeypatch, _Clock())

    for argv in (
        ["--store", str(store), "--submit", "a.json", "--submit-packet", "b.json"],
        ["--store", str(store), "--submit-packet", "b.json", "--claim", "pcs_x"],
        ["--store", str(store), "--submit-packet"],
        ["--store", str(store), f"--submit-packet-extra={QUERY}"],
    ):
        code = research_capture_cli.main(argv)
        captured = capsys.readouterr()
        assert (code, captured.out) == (2, "")
        assert captured.err == "capture_cli_error:invalid_arguments\n"
        _assert_private_absent(captured.err)
    _assert_no_capture_rows(store)

from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import datetime as dt
from pathlib import Path

import cards
import dispatch
import ledger
import pytest
import schedule_store

REPO_ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = json.loads((REPO_ROOT / "dashboard" / "shared" / "schedule-socket-v1.json").read_text(encoding="utf-8"))


def _example(operation: str) -> dict:
    return next(item for item in PROTOCOL["examples"] if item["operation"] == operation)


def _cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "schedule_store.py"), *args],
        cwd=REPO_ROOT, text=True, capture_output=True, timeout=15,
    )


def test_command_contract_is_asserted_on_every_platform(tmp_path):
    help_result = _cli("--help")
    assert help_result.returncode == 0
    assert "snapshot" in help_result.stdout
    assert "claim" in help_result.stdout
    assert "advance" in help_result.stdout
    assert "complete" in help_result.stdout
    assert schedule_store.PROTOCOL_VERSION == 1
    assert schedule_store.MAX_RESPONSE_BYTES <= 1024 * 1024
    assert schedule_store.DEFAULT_TIMEOUT_SECONDS <= 10
    assert not hasattr(schedule_store, "http_url")
    assert PROTOCOL["operations"] == ["snapshot", "claim", "advance", "complete"]
    assert [item["operation"] for item in PROTOCOL["examples"]] == PROTOCOL["operations"]


def test_python_client_emits_every_shared_protocol_request_exactly(monkeypatch):
    seen = []

    def round_trip(_socket_path, payload, _timeout):
        seen.append(payload)
        return _example(payload["operation"])["response"]

    monkeypatch.setattr(schedule_store, "_round_trip", round_trip)
    schedule_store.snapshot("fixture.sock")
    claim_request = _example("claim")["request"]
    schedule_store.claim(
        "fixture.sock", schedule_id=claim_request["scheduleId"],
        scheduled_for=claim_request["scheduledFor"], next_at=claim_request["nextAt"],
        expected_version=claim_request["expectedVersion"],
        idempotency_key=claim_request["idempotencyKey"],
    )
    advance_request = _example("advance")["request"]
    schedule_store.advance(
        "fixture.sock", schedule_id=advance_request["scheduleId"],
        scheduled_for=advance_request["scheduledFor"], next_at=advance_request["nextAt"],
        phase=advance_request["phase"], idempotency_key=advance_request["idempotencyKey"],
    )
    complete_request = _example("complete")["request"]
    schedule_store.complete(
        "fixture.sock", schedule_id=complete_request["scheduleId"],
        scheduled_for=complete_request["scheduledFor"], run_ref=complete_request["runRef"],
        last_outcome=complete_request["lastOutcome"], next_at=complete_request["nextAt"],
        idempotency_key=complete_request["idempotencyKey"],
    )
    assert seen == [item["request"] for item in PROTOCOL["examples"]]


def test_cli_failure_is_nonzero_with_empty_stdout_and_bounded_stderr(tmp_path):
    result = _cli("--socket", str(tmp_path / "missing.sock"), "--timeout", "0.01", "snapshot")
    assert result.returncode != 0
    assert result.stdout == ""
    assert 0 < len(result.stderr.encode("utf-8")) <= 512
    assert "schedule-socket-unavailable" in result.stderr


def test_native_linux_actual_unix_service_and_client_interoperate(tmp_path, monkeypatch):
    if sys.platform != "linux":
        monkeypatch.delattr(socket, "AF_UNIX", raising=False)
        with pytest.raises(schedule_store.ScheduleStoreError) as error:
            schedule_store.snapshot(tmp_path / "unsupported.sock", timeout=0.01)
        assert error.value.code == "schedule-socket-unavailable"
        return
    socket_path = tmp_path / "schedule.sock"
    process = subprocess.Popen(
        ["node", str(REPO_ROOT / "dashboard" / "server" / "schedules" / "socketRoutes.ts"),
         "--fixture-socket", str(socket_path)],
        cwd=REPO_ROOT / "dashboard", text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        for _ in range(100):
            if socket_path.exists():
                break
            if process.poll() is not None:
                stdout, stderr = process.communicate()
                raise AssertionError(f"fixture Unix service exited: {stdout}\n{stderr}")
            time.sleep(0.05)
        result = _cli("--socket", str(socket_path), "snapshot")
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout) == _example("snapshot")["response"]["snapshot"]
    finally:
        process.terminate()
        process.wait(timeout=10)


def test_socket_outage_fails_closed_and_restart_reconnects(tmp_path):
    missing = tmp_path / "missing.sock"
    with pytest.raises(schedule_store.ScheduleStoreError) as error:
        schedule_store.snapshot(missing, timeout=0.05)
    assert error.value.code == "schedule-socket-unavailable"

    if not hasattr(socket, "AF_UNIX"):
        assert sys.platform == "win32"
        return

    path = tmp_path / "restarted.sock"
    for revision in (4, 5):
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(str(path))
        server.listen(1)
        try:
            import threading

            def serve_once():
                connection, _ = server.accept()
                with connection:
                    request = json.loads(connection.makefile("rb").readline())
                    assert request == {"operation": "snapshot", "version": 1}
                    connection.sendall((json.dumps({"ok": True, "version": 1, "operation": "snapshot", "snapshot": {"collectionRevision": revision, "schedules": []}}, separators=(",", ":")) + "\n").encode())

            thread = threading.Thread(target=serve_once)
            thread.start()
            assert schedule_store.snapshot(path) == {"collectionRevision": revision, "schedules": []}
            thread.join(timeout=5)
        finally:
            server.close()
            path.unlink(missing_ok=True)


def _claim_receipt(schedule_id: str, scheduled_for: str, phase: str = "claimed") -> dict:
    receipt = cards.schedule_occurrence_claim(
        schedule_id=schedule_id,
        scheduled_for=scheduled_for,
        owner={"type": "agent", "id": "hygiene", "sourcePath": "agents/hygiene.md"},
        mirror_path="HEARTBEAT.md",
        dispatched_at="2026-08-21T12:15:01-04:00",
    )
    receipt["phase"] = phase
    return receipt


def test_schedule_claim_bytes_are_owned_by_cards_render():
    receipt = _claim_receipt("a" * 64, "2026-08-21T12:15:00-04:00")
    card = cards.Card(meta=receipt["card"]["meta"], body=receipt["card"]["body"])
    assert receipt["cardBytesSha256"] == hashlib.sha256(cards.render(card)).hexdigest()
    assert card.meta["execution-controller"] == "dashboard"
    assert card.meta["scheduled_for"] == "2026-08-21T12:15:00-04:00"


class ClaimClient:
    def __init__(self, receipt: dict, fail_after: str | None = None):
        self.receipt = receipt
        self.fail_after = fail_after
        self.failed = False

    def claim(self, **_kwargs):
        return json.loads(json.dumps(self.receipt))

    def advance(self, *, phase: str, **_kwargs):
        if self.fail_after == phase and not self.failed:
            self.failed = True
            raise schedule_store.ScheduleStoreError("schedule-socket-unavailable", "crash boundary")
        self.receipt["phase"] = phase
        return json.loads(json.dumps(self.receipt))


def test_dispatch_passes_claim_next_at_and_expected_version(tmp_path):
    schedule_id = "a" * 64
    scheduled_for = "2026-08-21T12:15:00-04:00"

    class RecordingClient(ClaimClient):
        def __init__(self):
            super().__init__(_claim_receipt(schedule_id, scheduled_for))
            self.claim_kwargs = None

        def snapshot(self):
            return {"collectionRevision": 7, "schedules": [{
                "id": schedule_id, "armed": True, "version": 3,
                "cadence": {"source": "*/15 * * * *", "words": "Every 15 minutes"},
            }]}

        def claim(self, *, next_at, expected_version, **kwargs):
            self.claim_kwargs = {"next_at": next_at, "expected_version": expected_version, **kwargs}
            return super().claim(**kwargs)

    client = RecordingClient()
    dispatch.dispatch_stored_schedules(
        tmp_path, client, "dispatcher-cloud",
        now=dt.datetime.fromisoformat("2026-08-21T12:16:00-04:00"),
    )
    assert client.claim_kwargs["next_at"] == "2026-08-21T12:30:00-04:00"
    assert client.claim_kwargs["expected_version"] == 3


def test_later_same_window_tick_skips_an_occurrence_already_covered_by_next_at(tmp_path):
    schedule_id = "a" * 64

    class CoveredClient:
        def __init__(self):
            self.claimed = False

        def snapshot(self):
            return {"collectionRevision": 8, "schedules": [{
                "id": schedule_id, "armed": True, "version": 4,
                "cadence": {"source": "*/15 * * * *", "words": "Every 15 minutes"},
                "nextAt": "2026-08-21T12:30:00-04:00", "lastOutcome": "failed",
            }]}

        def claim(self, **_kwargs):
            self.claimed = True
            raise AssertionError("covered occurrence must not be claimed")

    client = CoveredClient()
    assert dispatch.dispatch_stored_schedules(
        tmp_path, client, "dispatcher-cloud",
        now=dt.datetime.fromisoformat("2026-08-21T12:16:00-04:00"),
    ) == []
    assert client.claimed is False

class RealClaimClient:
    def __init__(self, socket_path: Path, crash_boundary: str):
        self.socket_path = socket_path
        self.crash_boundary = crash_boundary
        self.failed = False

    def claim(self, **kwargs):
        return schedule_store.claim(self.socket_path, **kwargs)

    def advance(self, *, phase: str, **kwargs):
        if ((self.crash_boundary == "after-card-save" and phase == "card-saved")
                or (self.crash_boundary == "after-ledger-append" and phase == "ledger-appended")) and not self.failed:
            self.failed = True
            raise schedule_store.ScheduleStoreError("schedule-socket-unavailable", "crash boundary")
        return schedule_store.advance(self.socket_path, phase=phase, **kwargs)


@pytest.mark.parametrize("crash_boundary", [
    "before-card-save", "after-card-save", "before-ledger-append", "after-ledger-append",
])
def test_all_claim_crash_boundaries_replay_once_through_real_socket(
        tmp_path, monkeypatch, crash_boundary):
    request = _example("claim")["request"]
    if sys.platform != "linux":
        with pytest.raises(schedule_store.ScheduleStoreError) as error:
            schedule_store.claim(
                tmp_path / "unsupported.sock", schedule_id=request["scheduleId"],
                scheduled_for=request["scheduledFor"], next_at=request["nextAt"],
                expected_version=request["expectedVersion"], idempotency_key=request["idempotencyKey"],
                timeout=0.01,
            )
        assert error.value.code == "schedule-socket-unavailable"
        assert not (tmp_path / "queue").exists()
        return

    socket_path = tmp_path / "schedule.sock"
    process = subprocess.Popen(
        ["node", str(REPO_ROOT / "dashboard" / "server" / "schedules" / "socketRoutes.ts"),
         "--fixture-socket", str(socket_path)],
        cwd=REPO_ROOT / "dashboard", text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        for _ in range(100):
            if socket_path.exists():
                break
            if process.poll() is not None:
                stdout, stderr = process.communicate()
                raise AssertionError(f"fixture Unix service exited: {stdout}\n{stderr}")
            time.sleep(0.05)

        class DayOne(dt.date):
            @classmethod
            def today(cls):
                return cls(2026, 8, 21)

        class DayTwo(dt.date):
            @classmethod
            def today(cls):
                return cls(2026, 8, 22)

        monkeypatch.setattr(ledger.datetime, "date", DayOne)
        client = RealClaimClient(socket_path, crash_boundary)
        original_save = cards.save
        original_append = ledger.append

        def save_once(*args, **kwargs):
            if crash_boundary == "before-card-save" and not client.failed:
                client.failed = True
                raise OSError("before card save")
            return original_save(*args, **kwargs)

        def append_once(*args, **kwargs):
            if crash_boundary == "before-ledger-append" and not client.failed:
                client.failed = True
                raise OSError("before ledger append")
            return original_append(*args, **kwargs)

        monkeypatch.setattr(cards, "save", save_once)
        monkeypatch.setattr(ledger, "append", append_once)
        with pytest.raises((OSError, schedule_store.ScheduleStoreError)):
            dispatch.dispatch_claimed_occurrence(
                tmp_path, client, schedule_id=request["scheduleId"],
                scheduled_for=request["scheduledFor"], next_at=request["nextAt"],
                expected_version=request["expectedVersion"], agent_id="dispatcher-cloud",
            )
        assert client.failed

        monkeypatch.setattr(ledger.datetime, "date", DayTwo)
        result = dispatch.dispatch_claimed_occurrence(
            tmp_path, client, schedule_id=request["scheduleId"],
            scheduled_for=request["scheduledFor"], next_at=request["nextAt"],
            expected_version=request["expectedVersion"], agent_id="dispatcher-cloud",
        )
        assert result["phase"] == "ledger-appended"
        card_path = tmp_path / "queue" / "inbox" / f"{result['card_id']}.md"
        assert hashlib.sha256(card_path.read_bytes()).hexdigest() == result["card_bytes_sha256"]
        rows = (ledger.read_day(tmp_path, "dispatch", "2026-08-21")
                + ledger.read_day(tmp_path, "dispatch", "2026-08-22"))
        matches = [row for row in rows
                   if row.get("schedule_id") == request["scheduleId"]
                   and row.get("scheduled_for") == request["scheduledFor"]]
        assert len(matches) == 1
    finally:
        process.terminate()
        process.wait(timeout=10)


def test_changed_card_bytes_are_refused_on_replay(tmp_path):
    schedule_id = "a" * 64
    scheduled_for = "2026-08-21T12:15:00-04:00"
    receipt = _claim_receipt(schedule_id, scheduled_for)
    client = ClaimClient(receipt)
    first = dispatch.dispatch_claimed_occurrence(tmp_path, client, schedule_id=schedule_id,
                                                 scheduled_for=scheduled_for,
                                                 next_at="2026-08-21T12:30:00-04:00",
                                                 expected_version=3,
                                                 agent_id="dispatcher-cloud")
    card_path = tmp_path / "queue" / "inbox" / f"{first['card_id']}.md"
    card_path.write_text(card_path.read_text(encoding="utf-8") + "changed\n", encoding="utf-8")
    client.receipt["phase"] = "claimed"
    with pytest.raises(dispatch.ScheduleDispatchError, match="schedule-card-bytes-conflict"):
        dispatch.dispatch_claimed_occurrence(tmp_path, client, schedule_id=schedule_id,
                                             scheduled_for=scheduled_for,
                                             next_at="2026-08-21T12:30:00-04:00",
                                             expected_version=3,
                                             agent_id="dispatcher-cloud")

"""Offline contract tests for the bounded, one-shot pod recovery journal."""

from __future__ import annotations

import json
import importlib.util
import logging
import subprocess
import sys
import threading
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


POD = Path(__file__).resolve().parents[1] / "pod"


def _load_runner():
    spec = importlib.util.spec_from_file_location(
        "figment_recovery_test_runner", POD / "runpod_run.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


rr = _load_runner()
recovery = rr.pod_recovery


NAME = "figment-bakeoff-20260908-120000-a1b2c3"
CREATED = datetime.now(timezone.utc).replace(microsecond=0)
GO_UTC = "2026-09-08 05:56:53.472 +0000 UTC"


def _pod(pod_id: str = "pod-owned", *, name: str = NAME) -> dict[str, str]:
    return {
        "id": pod_id,
        "name": name,
        "lastStartedAt": CREATED.isoformat().replace("+00:00", "Z"),
        "lastStatusChange": CREATED.isoformat().replace("+00:00", "Z"),
    }


def _intent(
        tmp_path: Path, *, pod_id: str | None = None,
        created_utc: datetime = CREATED) -> Path:
    manifest = tmp_path / "manifest.yaml"
    manifest.write_text("image: pinned\n", encoding="utf-8")
    journal = recovery.create_intent(
        receipt_path=tmp_path / "run.json",
        manifest_path=manifest,
        manifest_digest=recovery.manifest_sha256(manifest),
        pod_name=NAME,
        max_minutes=20.0,
        max_usd=0.30,
        created_utc=created_utc,
    )
    if pod_id is not None:
        recovery.record_acquired(journal, pod_id, _pod(pod_id))
    return journal


class _API:
    def __init__(self, *, pod: dict[str, str] | None = None, pods: list[dict[str, str]] | None = None):
        self.pod = pod
        self.pods = list(pods or [])
        self.deleted: list[str] = []
        self.listed = 0

    def get_pod(self, pod_id: str):
        if self.pod and self.pod["id"] == pod_id:
            return dict(self.pod)
        return None

    def list_pods(self):
        self.listed += 1
        return [dict(pod) for pod in self.pods]

    def delete_pod(self, pod_id: str):
        self.deleted.append(pod_id)
        if self.pod and self.pod["id"] == pod_id:
            self.pod = None
        self.pods = [pod for pod in self.pods if pod["id"] != pod_id]


def _logger() -> logging.Logger:
    return logging.getLogger(f"pod-recovery-test-{id(object())}")


def _dry_manifest() -> dict[str, object]:
    return {
        "gpu": {"type": "NVIDIA GeForce RTX 4090", "count": 1, "cloud": "SECURE"},
        "image": "runpod/pytorch:test",
        "price_usd_per_hour": 0.50,
        "volume_mount_path": "/workspace",
        "comfyui": {
            "root": "/workspace/ComfyUI", "git_ref": "v0.20.1", "port": 8188,
            "start_command": "python main.py",
        },
        "workflow": {
            "1": {"class_type": "KSampler", "inputs": {"seed": 1, "positive": ["2", 0]}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "test"}},
            "3": {"class_type": "SaveImage", "inputs": {"filename_prefix": "test"}},
        },
        "jobs": [{
            "seed": 42, "output_name": "dry", 
            "substitutions": [{"node_id": "2", "field": "text", "value": "test"}],
        }],
    }


def test_recovery_dry_run_never_writes_explicit_real_ledger(tmp_path):
    manifest = _dry_manifest()
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    configured_ledger = tmp_path / "configured-ledger"

    result = rr.run_harness(
        manifest, manifest_path, tmp_path / "out", max_usd=None, max_minutes=1.0,
        dry_run=True, api=rr.DryRunAPI(0.50), logger=_logger(),
        sleep=lambda _seconds: None, ledger_dir=configured_ledger,
    )

    assert result["termination_verified"] is True
    assert not configured_ledger.exists()
    assert (tmp_path / "out" / "dry-run-ledger").is_dir()


def _run_dry(manifest: dict[str, object], manifest_path: Path, out: Path, api):
    return rr.run_harness(
        manifest, manifest_path, out, max_usd=None, max_minutes=1.0,
        dry_run=True, api=api, logger=_logger(), sleep=lambda _seconds: None,
    )


@pytest.mark.parametrize("existing", ["unresolved", "malformed", "receipt"])
def test_recovery_runner_refuses_reused_run_directory_before_create(tmp_path, existing):
    manifest = _dry_manifest()
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    out = tmp_path / "out"
    out.mkdir()
    if existing == "unresolved":
        recovery.create_intent(
            receipt_path=out / "run.json", manifest_path=manifest_path,
            manifest_digest=recovery.manifest_sha256(manifest_path), pod_name=NAME,
            max_minutes=20.0, max_usd=0.30, created_utc=CREATED,
        )
    elif existing == "malformed":
        (out / f"recovery-{NAME}.json").write_text("not json", encoding="utf-8")
    else:
        (out / "run.json").write_text("{}\n", encoding="utf-8")

    class NoPostAPI:
        def __init__(self):
            self.creates = 0

        def create_pod(self, _payload):
            self.creates += 1
            raise AssertionError("a reused output directory must fail before POST")

    api = NoPostAPI()
    with pytest.raises(rr.HarnessError, match="fresh run directory"):
        _run_dry(manifest, manifest_path, out, api)
    assert api.creates == 0


def test_recovery_runner_concurrent_distinct_attempts_allow_one_create(tmp_path, monkeypatch):
    manifest = _dry_manifest()
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    out = tmp_path / "out"
    monkeypatch.setattr(rr, "shutdown_signals", lambda _cancel: nullcontext())
    entered_create = threading.Event()
    release_create = threading.Event()

    class BlockingDryAPI(rr.DryRunAPI):
        def __init__(self):
            super().__init__(0.50)
            self.creates = 0

        def create_pod(self, payload):
            self.creates += 1
            entered_create.set()
            assert release_create.wait(2)
            return super().create_pod(payload)

    api = BlockingDryAPI()
    outcomes: list[object] = []

    def run_attempt() -> None:
        try:
            outcomes.append(_run_dry(manifest, manifest_path, out, api))
        except BaseException as exc:
            outcomes.append(exc)

    first = threading.Thread(target=run_attempt)
    first.start()
    assert entered_create.wait(2)
    second = threading.Thread(target=run_attempt)
    second.start()
    second.join(timeout=2)
    release_create.set()
    first.join(timeout=5)

    assert api.creates == 1
    assert sum(isinstance(item, rr.HarnessError) for item in outcomes) == 1
    assert sum(isinstance(item, dict) for item in outcomes) == 1, outcomes
    journals = list(out.glob("recovery-*.json"))
    assert len(journals) == 1
    assert recovery.load_journal(journals[0])["state"] == "terminated"


def test_recovery_avoided_placement_is_terminal_before_next_create(tmp_path):
    manifest = _dry_manifest()
    manifest["avoid_machine_hosts"] = ["avoid-this-host"]
    manifest["max_placement_attempts"] = 2
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    class PlacementAPI:
        def __init__(self):
            self.current = None
            self.creates = 0

        def create_pod(self, payload):
            self.creates += 1
            self.current = {
                "id": f"pod-{self.creates}", "name": payload["name"],
                "desiredStatus": "RUNNING", "ports": ["8188/http"],
                "adjustedCostPerHr": 0.50,
                "machine": {"podHostId": "avoid-this-host" if self.creates == 1 else "good-host"},
            }
            return dict(self.current)

        def get_pod(self, pod_id):
            if self.current and self.current["id"] == pod_id:
                return dict(self.current)
            return None

        def list_pods(self):
            return [dict(self.current)] if self.current else []

        def delete_pod(self, pod_id):
            if self.current and self.current["id"] == pod_id:
                self.current = None

    api = PlacementAPI()
    result = _run_dry(manifest, manifest_path, tmp_path / "out", api)

    assert result["termination_verified"] is True
    assert api.creates == 2
    journals = sorted((tmp_path / "out").glob("recovery-*.json"))
    assert len(journals) == 2
    states = [recovery.load_journal(path)["state"] for path in journals]
    statuses = [recovery.load_journal(path)["recovery_status"] for path in journals]
    assert states == ["terminated", "terminated"]
    assert "avoided-placement-terminated" in statuses
    assert "run-finished" in statuses


def test_recovery_intent_precedes_create_and_callback_persists_id(tmp_path):
    journal = _intent(tmp_path)

    class CreateAPI(_API):
        def create_pod(self, payload):
            before = recovery.load_journal(journal)
            assert before["state"] == "intent"
            assert before["pod_name"] == payload["name"]
            self.pod = _pod()
            self.pod["lastStartedAt"] = GO_UTC
            return dict(self.pod)

    api = CreateAPI()
    lease = rr.PodLease(
        api, {"name": NAME}, _logger(),
        on_acquired=lambda pod_id, pod: recovery.record_acquired(journal, pod_id, pod),
        sleep=lambda _seconds: None,
    )
    with lease:
        assert recovery.load_journal(journal)["pod_id"] == "pod-owned"
    acquired = recovery.load_journal(journal)
    assert acquired["state"] == "acquired"
    assert acquired["provider_last_started_utc"] == "2026-09-08T05:56:53+00:00"


def test_recovery_acquisition_persists_id_when_optional_timestamp_is_invalid(tmp_path):
    journal = _intent(tmp_path)
    pod = _pod()
    pod["lastStartedAt"] = "2026-09-08 05:56:53 UTC"

    acquired = recovery.record_acquired(journal, "pod-owned", pod)

    assert acquired["pod_id"] == "pod-owned"
    assert "provider_last_started_utc" not in acquired
    assert recovery.load_journal(journal)["state"] == "acquired"


def test_recovery_acquisition_without_provider_id_preserves_intent(tmp_path):
    journal = _intent(tmp_path)

    with pytest.raises(recovery.RecoveryError, match="unsafe pod id"):
        recovery.record_acquired(journal, "", _pod())

    preserved = recovery.load_journal(journal)
    assert preserved["state"] == "intent"
    assert preserved["pod_id"] is None


def test_recovery_callback_write_failure_retains_in_memory_id_for_teardown(tmp_path):
    journal = _intent(tmp_path)

    class CreateAPI(_API):
        def create_pod(self, _payload):
            self.pod = _pod()
            return dict(self.pod)

    api = CreateAPI()
    lease = rr.PodLease(
        api, {"name": NAME}, _logger(), sleep=lambda _seconds: None,
        on_acquired=lambda _pod_id, _pod: (_ for _ in ()).throw(OSError("journal disk full")),
    )

    with pytest.raises(rr.HarnessError, match="journal disk full"):
        lease.__enter__()

    assert api.deleted == ["pod-owned"]
    assert lease.snapshot()[2] is True
    assert recovery.load_journal(journal)["state"] == "intent"


def test_recovery_create_timeout_scans_exact_name_but_refuses_without_recorded_id(tmp_path):
    journal = _intent(tmp_path)  # no ID: POST timed out after provider creation
    api = _API(pods=[_pod()])

    with pytest.raises(recovery.RecoveryError, match="no recorded pod id"):
        recovery.reconcile(journal, api, _logger(), rr.PodLease, sleep=lambda _seconds: None)

    assert api.listed == 1
    assert api.deleted == []
    assert recovery.load_journal(journal)["state"] == "uncertain"


def test_recovery_treats_delete_404_style_absence_as_verified(tmp_path):
    journal = _intent(tmp_path, pod_id="pod-owned")
    api = _API(pod=_pod())

    result = recovery.reconcile(journal, api, _logger(), rr.PodLease, sleep=lambda _seconds: None)

    assert api.deleted == ["pod-owned"]
    assert result["recovery_status"] == "terminated"
    assert result["absence_verified"] is True


def test_recovery_accepts_runpod_go_utc_timestamp_for_owned_pod(tmp_path):
    journal = _intent(
        tmp_path,
        pod_id="pod-owned",
        created_utc=datetime(2026, 9, 8, 5, 56, 52, tzinfo=timezone.utc),
    )
    pod = _pod()
    pod["lastStartedAt"] = GO_UTC
    api = _API(pod=pod)

    result = recovery.reconcile(journal, api, _logger(), rr.PodLease, sleep=lambda _seconds: None)

    assert api.deleted == ["pod-owned"]
    assert result["absence_verified"] is True


@pytest.mark.parametrize("timestamp", [
    "2026-09-08 05:56:53 UTC",
    "2026-09-08 05:56:53.472 +0000 EDT",
    "2026-09-08 05:56:53.472 +0100 UTC",
])
def test_recovery_refuses_delete_for_invalid_or_ambiguous_provider_timestamp(tmp_path, timestamp):
    journal = _intent(tmp_path, pod_id="pod-owned")
    pod = _pod()
    pod["lastStartedAt"] = timestamp
    api = _API(pod=pod)

    with pytest.raises(recovery.RecoveryError, match="cannot verify ownership"):
        recovery.reconcile(journal, api, _logger(), rr.PodLease, sleep=lambda _seconds: None)

    assert api.deleted == []
    assert recovery.load_journal(journal)["state"] == "uncertain"


def test_recovery_refuses_foreign_id_before_delete(tmp_path):
    journal = _intent(tmp_path, pod_id="pod-owned")

    class ForeignReplyAPI(_API):
        def get_pod(self, _pod_id: str):
            return _pod("pod-foreign")

    api = ForeignReplyAPI()

    with pytest.raises(recovery.RecoveryError, match="id does not match"):
        recovery.reconcile(journal, api, _logger(), rr.PodLease, sleep=lambda _seconds: None)

    assert api.deleted == []
    assert recovery.load_journal(journal)["absence_verified"] is False


def test_recovery_refuses_ambiguous_same_name_before_delete(tmp_path):
    journal = _intent(tmp_path)
    api = _API(pods=[_pod("pod-one"), _pod("pod-two")])

    with pytest.raises(recovery.RecoveryError, match="ambiguous"):
        recovery.reconcile(journal, api, _logger(), rr.PodLease, sleep=lambda _seconds: None)

    assert api.deleted == []
    assert recovery.load_journal(journal)["state"] == "uncertain"


def test_recovery_refuses_missing_documented_last_started_at_before_delete(tmp_path):
    journal = _intent(tmp_path, pod_id="pod-owned")
    pod = _pod()
    pod.pop("lastStartedAt")
    api = _API(pod=pod)

    with pytest.raises(recovery.RecoveryError, match="no last start time"):
        recovery.reconcile(journal, api, _logger(), rr.PodLease, sleep=lambda _seconds: None)

    assert api.deleted == []


def test_recovery_refuses_pod_restarted_after_attempt_duration(tmp_path):
    journal = _intent(tmp_path, pod_id="pod-owned")
    pod = _pod()
    pod["lastStartedAt"] = (CREATED + timedelta(minutes=21)).isoformat().replace("+00:00", "Z")
    api = _API(pod=pod)

    with pytest.raises(recovery.RecoveryError, match="stale or outside"):
        recovery.reconcile(journal, api, _logger(), rr.PodLease, sleep=lambda _seconds: None)

    assert api.deleted == []


@pytest.mark.parametrize("state", ["intent", "acquired", "uncertain", "terminated"])
def test_recovery_existing_journal_in_every_state_is_never_overwritten(tmp_path, state):
    journal = _intent(tmp_path)
    if state == "acquired":
        recovery.record_acquired(journal, "pod-owned", _pod())
    elif state == "uncertain":
        recovery.record_terminal(
            journal, absence_verified=False, status="uncertain", error_code="test-uncertain",
        )
    elif state == "terminated":
        recovery.record_terminal(journal, absence_verified=True, status="terminated")
    prior = journal.read_bytes()
    manifest = tmp_path / "manifest.yaml"

    with pytest.raises(recovery.RecoveryError, match="already exists"):
        recovery.create_intent(
            receipt_path=tmp_path / "run.json",
            manifest_path=manifest,
            manifest_digest=recovery.manifest_sha256(manifest),
            pod_name=NAME,
            max_minutes=20.0,
            max_usd=0.30,
            created_utc=CREATED,
        )

    assert journal.read_bytes() == prior


def test_recovery_concurrent_intent_creation_has_one_winner_and_no_overwrite(tmp_path):
    manifest = tmp_path / "manifest.yaml"
    manifest.write_text("image: pinned\n", encoding="utf-8")
    barrier = threading.Barrier(2)
    outcomes: list[object] = []

    def create() -> None:
        barrier.wait()
        try:
            outcomes.append(recovery.create_intent(
                receipt_path=tmp_path / "run.json",
                manifest_path=manifest,
                manifest_digest=recovery.manifest_sha256(manifest),
                pod_name=NAME,
                max_minutes=20.0,
                max_usd=0.30,
                created_utc=CREATED,
            ))
        except BaseException as exc:
            outcomes.append(exc)

    workers = [threading.Thread(target=create), threading.Thread(target=create)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()

    assert sum(isinstance(item, Path) for item in outcomes) == 1
    assert sum(isinstance(item, recovery.RecoveryError) for item in outcomes) == 1
    journal = next(item for item in outcomes if isinstance(item, Path))
    assert recovery.load_journal(journal)["state"] == "intent"


def test_recovery_journal_never_persists_remote_exception_text(tmp_path):
    sentinel = "AMBIENT_SECRET_MUST_NEVER_REACH_JOURNAL"
    journal = _intent(tmp_path, pod_id="pod-owned")

    class DeleteFailsAPI(_API):
        def delete_pod(self, _pod_id: str):
            raise RuntimeError(sentinel)

    with pytest.raises(rr.PodStillRunning):
        recovery.reconcile(
            journal, DeleteFailsAPI(pod=_pod()), _logger(), rr.PodLease,
            sleep=lambda _seconds: None,
        )

    text = journal.read_text(encoding="utf-8")
    assert sentinel not in text
    assert json.loads(text)["recovery_error_code"] == "termination-unverified"


def test_recovery_runner_loads_from_fresh_figment_train_importlib_process():
    train_path = Path(__file__).resolve().parents[1] / "figment_train.py"
    script = (
        "import importlib.util, sys\n"
        f"path = {str(train_path)!r}\n"
        "spec = importlib.util.spec_from_file_location('fresh_figment_train', path)\n"
        "module = importlib.util.module_from_spec(spec)\n"
        "sys.modules[spec.name] = module\n"
        "spec.loader.exec_module(module)\n"
        "runner = module._pod_runner_module()\n"
        "assert hasattr(runner, 'pod_recovery')\n"
    )
    completed = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, check=False,
    )
    assert completed.returncode == 0, completed.stderr


def test_recovery_atomic_interrupted_write_keeps_prior_journal(tmp_path, monkeypatch):
    journal = _intent(tmp_path)
    prior = journal.read_text(encoding="utf-8")

    def interrupted(_source, _target):
        raise OSError("simulated power loss before replace")

    monkeypatch.setattr(recovery.os, "replace", interrupted)
    with pytest.raises(OSError, match="power loss"):
        recovery.atomic_write_json(journal, {"not": "a journal"})

    assert journal.read_text(encoding="utf-8") == prior
    assert json.loads(prior)["state"] == "intent"


def _windows_replace_error(code: int) -> OSError:
    error = OSError("simulated Windows file sharing violation")
    error.winerror = code
    return error


def test_recovery_atomic_write_retries_one_windows_sharing_violation(tmp_path, monkeypatch):
    journal = _intent(tmp_path)
    original_replace = recovery.os.replace
    attempts: list[int] = []
    sleeps: list[float] = []

    def transient(source, target):
        attempts.append(1)
        if len(attempts) == 1:
            raise _windows_replace_error(32)
        return original_replace(source, target)

    monkeypatch.setattr(recovery.os, "replace", transient)
    monkeypatch.setattr(recovery.time, "sleep", sleeps.append)
    recovery.atomic_write_json(journal, {"replacement": "works"})

    assert len(attempts) == 2
    assert sleeps == [0.01]
    assert json.loads(journal.read_text(encoding="utf-8")) == {"replacement": "works"}


def test_recovery_atomic_write_persistent_windows_lock_fails_closed(tmp_path, monkeypatch):
    journal = _intent(tmp_path)
    prior = journal.read_bytes()
    attempts: list[int] = []

    def permanently_locked(_source, _target):
        attempts.append(1)
        raise _windows_replace_error(33)

    monkeypatch.setattr(recovery.os, "replace", permanently_locked)
    monkeypatch.setattr(recovery.time, "sleep", lambda _seconds: None)
    with pytest.raises(OSError, match="sharing violation"):
        recovery.atomic_write_json(journal, {"replacement": "must not land"})

    assert len(attempts) == recovery.ATOMIC_REPLACE_ATTEMPTS
    assert journal.read_bytes() == prior

from __future__ import annotations

import io
import json
import logging
import os
import signal
import subprocess
import threading
import time
import traceback
from contextlib import contextmanager
from pathlib import Path

import pytest

import sys

POD_DIR = Path(__file__).resolve().parents[1]
# Restricted workers may not access the user-wide temp directory. Pytest reads this lazily
# when tmp_path is first requested, so keep its scratch tree inside this test's own scope.
os.environ.setdefault("PYTEST_DEBUG_TEMPROOT", str(POD_DIR))
sys.path.insert(0, str(POD_DIR))

import runpod_run as rr  # noqa: E402


class StubResponse:
    def __init__(self, status_code, data=None):
        self.status_code = status_code
        self._data = data
        self.content = b"" if data is None else json.dumps(data).encode()

    def json(self):
        return self._data


class StubSession:
    def __init__(self, responses, key="test-key"):
        self.responses = list(responses)
        self.headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if not self.responses:
            raise AssertionError(f"unexpected request: {method} {url}")
        response = self.responses.pop(0)
        return response(method, url, kwargs) if callable(response) else response

    def close(self):
        pass


class FakeRemote:
    def __init__(self, *_args):
        self.bootstrapped = False

    def bootstrap(self, script, _timeout):
        assert "set -e" not in script
        assert "STEP %s rc=%s" in script
        assert "https://github.com/comfyanonymous/ComfyUI" in script
        assert rr.COMFYUI_TAG in script
        assert script.index("python-present") < script.index("comfy-install")
        assert script.index("comfy-install") < script.index("model-1") if "model-1" in script else True
        self.bootstrapped = True

    def copy(self, _remote_path, local_path, _timeout):
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(b"not-empty")


class FakeComfy:
    def __init__(self, _url=""):
        self.workflow = None

    def submit(self, workflow):
        self.workflow = workflow
        return "prompt-1"

    def wait_outputs(self, prompt_id, _timeout, watchdog):
        assert prompt_id == "prompt-1"
        watchdog.check()
        return [{"filename": "remote.png", "subfolder": "", "type": "output"}]


class BoomComfy(FakeComfy):
    exception = RuntimeError("mid-job failure")

    def submit(self, _workflow):
        raise self.exception


class FakeAPI:
    def __init__(self, alive=True):
        self.alive = alive
        self.deletes = 0
        self.lock = threading.Lock()

    def create_pod(self, payload):
        self.alive = True
        return ready_pod(payload["name"])

    def get_pod(self, _pod_id):
        with self.lock:
            return ready_pod() if self.alive else None

    def list_pods(self):
        return [ready_pod()] if self.alive else []

    def delete_pod(self, _pod_id):
        with self.lock:
            self.deletes += 1
            self.alive = False


def ready_pod(name="figment-test"):
    return {
        "id": "pod-123",
        "name": name,
        "desiredStatus": "RUNNING",
        "publicIp": "127.0.0.1",
        "portMappings": {"22": 2222},
        "adjustedCostPerHr": 0.50,
    }


def manifest():
    return {
        "gpu": {"type": "NVIDIA GeForce RTX 4090", "count": 1, "cloud": "SECURE"},
        "image": "runpod/pytorch:test",
        "price_usd_per_hour": 0.50,
        "workflow": {
            "1": {"class_type": "KSampler", "inputs": {"seed": 1, "positive": ["2", 0]}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "old"}},
            "3": {"class_type": "SaveImage", "inputs": {"filename_prefix": "old"}},
        },
        "jobs": [{
            "seed": 42,
            "output_name": "job-one",
            "substitutions": [{"node_id": "2", "field": "text", "value": "new"}],
        }],
    }


def logger_and_stream(redactor=None):
    stream = io.StringIO()
    logger = logging.Logger(f"test-{id(stream)}", logging.INFO)
    handler = logging.StreamHandler(stream)
    if redactor:
        handler.addFilter(redactor)
    logger.addHandler(handler)
    return logger, stream


def run_with(api, tmp_path, comfy=FakeComfy, **kwargs):
    logger, stream = logger_and_stream(kwargs.pop("redactor", None))
    ledger_dir = kwargs.pop("ledger_dir", tmp_path / "ledger")
    result = rr.run_harness(
        manifest(),
        tmp_path / "m.yaml",
        tmp_path / "out",
        max_usd=1.0,
        max_minutes=1.0,
        dry_run=False,
        api=api,
        logger=logger,
        remote_factory=FakeRemote,
        comfy_factory=comfy,
        tunnel_factory=lambda *_args: rr.no_tunnel(),
        sleep=lambda _seconds: None,
        ledger_dir=ledger_dir,
        **kwargs,
    )
    return result, stream.getvalue()


def test_happy_path_uses_mocked_http_and_verifies_download(tmp_path):
    session = StubSession([
        StubResponse(201, ready_pod()),
        StubResponse(200, ready_pod()),
        StubResponse(204),
        StubResponse(404),
    ])
    result, _logs = run_with(rr.RunPodAPI(session), tmp_path)

    assert result["termination_verified"] is True
    assert (tmp_path / "out" / "job-one.png").stat().st_size == len(b"not-empty")
    qa = json.loads((tmp_path / "out" / "manifest.json").read_text())
    assert qa["images"][0]["review_status"] == "unreviewed"
    assert [call[0] for call in session.calls] == ["POST", "GET", "DELETE", "GET"]


def test_exception_mid_job_terminates_and_verifies(tmp_path):
    api = FakeAPI()
    with pytest.raises(RuntimeError, match="mid-job failure"):
        run_with(api, tmp_path, comfy=BoomComfy)
    assert api.deletes == 1
    record = json.loads((tmp_path / "out" / "run.json").read_text())
    assert record["termination_verified"] is True


def test_keyboard_interrupt_terminates(tmp_path):
    class InterruptComfy(BoomComfy):
        exception = KeyboardInterrupt()

    api = FakeAPI()
    with pytest.raises(KeyboardInterrupt):
        run_with(api, tmp_path, comfy=InterruptComfy)
    assert api.deletes == 1
    assert json.loads((tmp_path / "out" / "run.json").read_text())["termination_verified"]


def test_terminate_verify_retries_then_loud_failure():
    class ImmortalAPI(FakeAPI):
        def delete_pod(self, _pod_id):
            self.deletes += 1

    api = ImmortalAPI()
    logger, stream = logger_and_stream()
    lease = rr.PodLease(api, None, logger, pod_id="immortal", sleep=lambda _n: None)

    with pytest.raises(rr.PodStillRunning, match="POD STILL RUNNING immortal"):
        lease.close()
    assert api.deletes == 5
    assert "POD STILL RUNNING immortal" in stream.getvalue()


def test_preflight_refuses_over_max_usd():
    with pytest.raises(rr.HarnessError, match="preflight refused"):
        rr.estimate_cost(manifest(), max_minutes=60, max_usd=0.49)


def test_manifest_basename_resolves_beside_script(monkeypatch, tmp_path):
    named = POD_DIR / "manifest.example.yaml"
    monkeypatch.chdir(tmp_path)
    assert rr.resolve_manifest_path(Path("manifest.example.yaml")) == named


def test_watchdog_fires_at_max_minutes_and_terminates(tmp_path):
    class SlowRemote(FakeRemote):
        def bootstrap(self, _script, _timeout):
            time.sleep(1.05)

    api = FakeAPI()
    logger, _stream = logger_and_stream()
    with pytest.raises(rr.RunCancelled, match="maximum runtime"):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1.0, max_minutes=0.0002, dry_run=False, api=api, logger=logger,
            remote_factory=SlowRemote, comfy_factory=FakeComfy,
            tunnel_factory=lambda *_args: rr.no_tunnel(),
            ledger_dir=tmp_path / "ledger",
        )
    assert api.deletes >= 1


def test_cost_row_uses_existing_ledger_format(tmp_path):
    path = rr.append_cost_row(tmp_path, "NVIDIA RTX A4000", "runpod-bakeoff:pod", 0.125)
    assert path.read_text().splitlines() == [
        "model\tstep\tusd",
        "NVIDIA RTX A4000\trunpod-bakeoff:pod\t0.125000",
    ]


def test_api_key_never_appears_in_logs_or_written_files(tmp_path):
    secret = "super-secret-runpod-key"
    session = StubSession([], key=secret)
    redactor = rr.ApiKeyRedactionFilter(session)
    logger, stream = logger_and_stream(redactor)

    class SecretComfy(BoomComfy):
        exception = rr.HarnessError(f"remote reflected {secret}")

    with pytest.raises(rr.HarnessError):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1.0, max_minutes=1.0, dry_run=False, api=FakeAPI(), logger=logger,
            redactor=redactor, remote_factory=FakeRemote, comfy_factory=SecretComfy,
            tunnel_factory=lambda *_args: rr.no_tunnel(),
            sleep=lambda _n: None, ledger_dir=tmp_path / "ledger",
        )
    all_written = "".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in tmp_path.rglob("*") if path.is_file()
    )
    assert secret not in stream.getvalue()
    assert secret not in all_written
    assert "[REDACTED]" in all_written


def test_dry_run_executes_whole_flow_without_network(tmp_path, monkeypatch):
    manifest_path = tmp_path / "manifest.example.yaml"
    manifest_path.write_text(json.dumps(manifest()), encoding="utf-8")

    def network_forbidden(*_args, **_kwargs):
        raise AssertionError("dry-run attempted network access")

    monkeypatch.setattr(rr, "build_authenticated_session", network_forbidden)
    out = tmp_path / "dry"
    assert rr.main([
        "run", "--manifest", str(manifest_path), "--dry-run", "--out", str(out),
        "--max-minutes", "0.1", "--max-usd", "1",
    ]) == 0
    assert (out / "run.json").is_file()
    assert (out / "job-one.png").stat().st_size > 0
    assert json.loads((out / "run.json").read_text())["termination_verified"] is True


def test_noise_seed_only_workflow_receives_job_seed():
    workflow = {
        "1": {"class_type": "RandomNoise", "inputs": {"noise_seed": 1}},
        "2": {"class_type": "SaveImage", "inputs": {"filename_prefix": "old"}},
    }

    applied = rr.apply_job(workflow, {"seed": 42, "output_name": "noise-only"})

    assert applied["1"]["inputs"] == {"noise_seed": 42}


def test_workflow_without_configured_seed_field_fails_validation(tmp_path):
    no_seed_manifest = manifest()
    no_seed_manifest["workflow"]["1"]["inputs"].pop("seed")

    with pytest.raises(rr.HarnessError, match="seed, noise_seed"):
        rr.require_manifest(no_seed_manifest, tmp_path / "manifest.yaml")


def test_explicit_seed_substitution_overrides_automatic_seed():
    workflow = {
        "1": {"class_type": "KSampler", "inputs": {"seed": 1}},
        "2": {"class_type": "SaveImage", "inputs": {"filename_prefix": "old"}},
    }
    job = {
        "seed": 42,
        "output_name": "override-seed",
        "substitutions": [{"node_id": "1", "field": "seed", "value": 99}],
    }

    applied = rr.apply_job(workflow, job)

    assert applied["1"]["inputs"]["seed"] == 99


def test_flux_manifests_dry_run_without_node_99(tmp_path):
    bakeoff_dir = POD_DIR.parent / "bakeoff"

    for manifest_name in ("arm-b-klein4b.yaml", "smoke.yaml"):
        manifest_path = bakeoff_dir / manifest_name
        assert "99" not in json.loads(manifest_path.read_text(encoding="utf-8"))["workflow"]
        assert rr.main([
            "run", "--manifest", str(manifest_path), "--dry-run",
            "--out", str(tmp_path / manifest_path.stem),
        ]) == 0


def test_scp_uses_uppercase_port_flag(tmp_path, monkeypatch):
    captured = {}

    def fake_run(command, **_kwargs):
        captured["command"] = command
        return type("Completed", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(rr.subprocess, "run", fake_run)
    remote = rr.RemoteExecutor("example", 12345, tmp_path / "known", logging.getLogger("scp"))
    remote.copy("/workspace/ComfyUI/output/a.png", tmp_path / "a.png", 10)
    assert "-P" in captured["command"]
    assert "-p" not in captured["command"]


def test_A1_create_timeout_after_create_still_terminates(tmp_path):
    class TimeoutAfterCreate(FakeAPI):
        def __init__(self):
            super().__init__(False)
            self.name = ""
            self.list_calls = 0

        def create_pod(self, payload):
            self.alive = True
            self.name = payload["name"]
            raise TimeoutError("POST timed out after the pod was created")

        def list_pods(self):
            self.list_calls += 1
            return [ready_pod(self.name)] if self.alive else []

    api = TimeoutAfterCreate()
    with pytest.raises(rr.HarnessError, match="pod creation failed"):
        run_with(api, tmp_path / "timeout")
    assert api.list_calls >= 2
    assert api.deletes == 1
    record = json.loads((tmp_path / "timeout" / "out" / "run.json").read_text())
    assert record["pod_id"] == "pod-123"
    assert record["termination_verified"] is True

    class NoIdThenListError(TimeoutAfterCreate):
        def create_pod(self, payload):
            self.alive = True
            self.name = payload["name"]
            return {"name": self.name}

        def list_pods(self):
            self.list_calls += 1
            if self.list_calls == 1:
                raise ConnectionError("first list failed")
            return [ready_pod(self.name)] if self.alive else []

    api = NoIdThenListError()
    with pytest.raises(rr.HarnessError, match="pod creation failed"):
        run_with(api, tmp_path / "no-id")
    assert api.list_calls >= 3
    assert api.deletes == 1
    record = json.loads((tmp_path / "no-id" / "out" / "run.json").read_text())
    assert record["pod_id"] == "pod-123"
    assert record["termination_verified"] is True


def test_A2_main_keyboard_interrupt_never_claims_unverified_teardown(monkeypatch, capsys):
    class ImmortalAPI(FakeAPI):
        def delete_pod(self, _pod_id):
            self.deletes += 1

    def interrupt_sleep(_seconds):
        raise KeyboardInterrupt()

    lease = rr.PodLease(
        ImmortalAPI(), None, logging.getLogger("A2"), pod_id="pod-live",
        sleep=interrupt_sleep,
    )

    def interrupted_command(_args):
        try:
            lease.close()
        except BaseException as exc:
            raise rr.attach_lease_status(exc, lease)

    monkeypatch.setattr(rr, "command_run", interrupted_command)
    code = rr.main(["run", "--manifest", "unused", "--out", "unused", "--dry-run"])
    stderr = capsys.readouterr().err
    assert code == 130
    assert "verified" not in stderr.lower()
    assert "POD STILL RUNNING pod-live — run: terminate --pod-id pod-live" in stderr


def test_A3_atexit_failure_reaches_stderr_directly(monkeypatch, capsys):
    lease = rr.PodLease(FakeAPI(), None, logging.getLogger("A3"), pod_id="pod-atexit")

    def fail_close():
        raise KeyboardInterrupt()

    monkeypatch.setattr(lease, "close", fail_close)
    lease._close_at_exit()
    assert "POD STILL RUNNING pod-atexit" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("ready_price", "max_usd", "message"),
    [(4.89, 0.10, "hourly price exceeds"), (0.0, 10.0, "non-positive hourly price")],
)
def test_A4_ready_price_is_required_and_never_falls_back(
        tmp_path, ready_price, max_usd, message):
    class PriceAPI(FakeAPI):
        def __init__(self):
            super().__init__(False)
            self.name = ""

        def create_pod(self, payload):
            self.alive = True
            self.name = payload["name"]
            pod = ready_pod(self.name)
            pod.pop("adjustedCostPerHr")
            return pod

        def get_pod(self, _pod_id):
            if not self.alive:
                return None
            pod = ready_pod(self.name)
            pod["adjustedCostPerHr"] = ready_price
            return pod

    low_manifest = manifest()
    low_manifest["price_usd_per_hour"] = 0.01
    api = PriceAPI()
    logger, _stream = logger_and_stream()
    with pytest.raises(rr.HarnessError, match=message):
        rr.run_harness(
            low_manifest, tmp_path / "m.yaml", tmp_path / "out",
            max_usd=max_usd, max_minutes=60, dry_run=False, api=api, logger=logger,
            remote_factory=FakeRemote, comfy_factory=FakeComfy,
            tunnel_factory=lambda *_args: rr.no_tunnel(), sleep=lambda _seconds: None,
            ledger_dir=tmp_path / "ledger",
        )
    assert api.deletes == 1
    assert json.loads((tmp_path / "out" / "run.json").read_text())["termination_verified"]


def test_A5_live_run_requires_max_usd_and_manifest_cannot_raise_minutes(
        tmp_path, monkeypatch, capsys):
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest()), encoding="utf-8")

    def credentials_must_not_be_touched():
        raise AssertionError("credential setup ran before --max-usd validation")

    monkeypatch.setattr(rr, "build_authenticated_session", credentials_must_not_be_touched)
    code = rr.main(["run", "--manifest", str(manifest_path), "--out", str(tmp_path / "out")])
    assert code == 1
    assert "--max-usd is required" in capsys.readouterr().err
    raised_manifest = manifest()
    raised_manifest["max_minutes"] = 240
    assert rr.effective_max_minutes(None, raised_manifest) == rr.DEFAULT_MAX_MINUTES
    assert rr.effective_max_minutes(120, raised_manifest) == rr.DEFAULT_MAX_MINUTES
    raised_manifest["max_minutes"] = 20
    assert rr.effective_max_minutes(40, raised_manifest) == 20


def test_A5_daily_budget_is_summed_and_refused_before_create(tmp_path):
    budget = tmp_path / "budget.yaml"
    budget.write_text("daily_usd_limit: 5.00\n", encoding="utf-8")
    daily_ledgers = tmp_path / "daily-ledgers"
    daily_ledgers.mkdir()
    today = time.strftime("%Y-%m-%d", time.gmtime())
    (daily_ledgers / f"prior-{today}.tsv").write_text(
        "model\tstep\tusd\nprior\twork\t4.800000\n", encoding="utf-8"
    )

    class NeverCreateAPI(FakeAPI):
        def __init__(self):
            super().__init__(False)
            self.creates = 0

        def create_pod(self, payload):
            self.creates += 1
            return super().create_pod(payload)

    api = NeverCreateAPI()
    logger, _stream = logger_and_stream()
    with pytest.raises(rr.HarnessError, match="daily budget refused"):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=60, dry_run=False, api=api, logger=logger,
            ledger_dir=tmp_path / "run-ledger", budget_path=budget,
            daily_ledger_dir=daily_ledgers,
        )
    assert api.creates == 0


def test_A6_create_elapsed_time_is_subtracted_from_watchdog(tmp_path, monkeypatch):
    configured = []

    class SlowCreateAPI(FakeAPI):
        def create_pod(self, payload):
            time.sleep(0.05)
            return super().create_pod(payload)

    class CapturingWatchdog:
        def __init__(self, seconds, lease, cancel, logger):
            configured.append(seconds)
            self.lease = lease
            self.cancel = cancel
            self.logger = logger
            self.error = None
            self.fired = threading.Event()

        def start(self):
            pass

        def check(self):
            pass

        def stop(self, _timeout=None):
            pass

    monkeypatch.setattr(rr, "Watchdog", CapturingWatchdog)
    logger, _stream = logger_and_stream()
    rr.run_harness(
        manifest(), tmp_path / "m.yaml", tmp_path / "out",
        max_usd=1, max_minutes=0.05, dry_run=False, api=SlowCreateAPI(), logger=logger,
        remote_factory=FakeRemote, comfy_factory=FakeComfy,
        tunnel_factory=lambda *_args: rr.no_tunnel(), sleep=lambda _seconds: None,
        ledger_dir=tmp_path / "ledger",
    )
    assert len(configured) == 1
    assert 1.0 < configured[0] < 3.0


def test_A7_finally_waits_for_watchdog_slow_teardown_before_run_json(tmp_path):
    class SlowDeleteAPI(FakeAPI):
        def delete_pod(self, pod_id):
            time.sleep(0.15)
            super().delete_pod(pod_id)

    class BudgetOverrunRemote(FakeRemote):
        def bootstrap(self, _script, _timeout):
            time.sleep(1.02)

    api = SlowDeleteAPI()
    logger, _stream = logger_and_stream()
    with pytest.raises(rr.RunCancelled, match="maximum runtime"):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=0.0002, dry_run=False, api=api, logger=logger,
            remote_factory=BudgetOverrunRemote, comfy_factory=FakeComfy,
            tunnel_factory=lambda *_args: rr.no_tunnel(), ledger_dir=tmp_path / "ledger",
        )
    record = json.loads((tmp_path / "out" / "run.json").read_text())
    assert record["termination_verified"] is True
    assert api.deletes >= 1


def test_A8_sigterm_during_teardown_backoff_does_not_skip_attempts():
    class ImmortalAPI(FakeAPI):
        def delete_pod(self, _pod_id):
            self.deletes += 1

    sleeps = 0

    def interrupted_backoff(_seconds):
        nonlocal sleeps
        sleeps += 1
        signal.raise_signal(signal.SIGTERM)

    api = ImmortalAPI()
    lease = rr.PodLease(
        api, None, logging.getLogger("A8"), pod_id="immortal", sleep=interrupted_backoff
    )
    with pytest.raises(rr.PodStillRunning):
        lease.close()
    assert api.deletes == 5
    assert sleeps == 4


def test_B1_main_and_excepthook_redact_requests_style_exception(
        monkeypatch, capsys):
    secret = "request-secret-key"

    class ExplodingSession(StubSession):
        def request(self, _method, _url, **_kwargs):
            raise RuntimeError(f"request headers Authorization=Bearer {secret}")

    session = ExplodingSession([], key=secret)
    redactor = rr.ApiKeyRedactionFilter(session)
    monkeypatch.setattr(rr, "build_authenticated_session", lambda: (session, redactor))
    assert rr.main(["status"]) == 1
    stderr = capsys.readouterr().err
    assert secret not in stderr
    assert "[REDACTED]" in stderr

    try:
        raise RuntimeError(f"traceback carried {secret}")
    except RuntimeError as exc:
        formatted = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        assert secret not in redactor.redact(formatted)
        rr.redacting_excepthook(type(exc), exc, exc.__traceback__)
    assert secret not in capsys.readouterr().err
    rr.set_active_redactor(None)


def test_B2_all_ssh_scp_and_tunnel_children_drop_api_key(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNPOD_API_KEY", "never-in-child")
    child_kwargs = []

    def fake_run(_command, **kwargs):
        child_kwargs.append(kwargs)
        return type("Completed", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    class ExitedProcess:
        stderr = io.StringIO("")

        def poll(self):
            return 1

    def fake_popen(_command, **kwargs):
        child_kwargs.append(kwargs)
        return ExitedProcess()

    monkeypatch.setattr(rr.subprocess, "run", fake_run)
    monkeypatch.setattr(rr.subprocess, "Popen", fake_popen)
    remote = rr.RemoteExecutor("example", 2222, tmp_path / "known", logging.getLogger("B2"))
    remote.bootstrap("true", 1)
    remote.copy("/workspace/a.png", tmp_path / "a.png", 1)
    with pytest.raises(rr.HarnessError, match="exited before"):
        rr.SSHTunnel(remote, 8188, logging.getLogger("B2-tunnel")).__enter__()
    assert len(child_kwargs) == 3
    assert all("RUNPOD_API_KEY" not in kwargs["env"] for kwargs in child_kwargs)


def test_C2_incomplete_comfy_history_keeps_polling(monkeypatch):
    responses = [
        StubResponse(200, {"prompt": {"status": {"completed": False}, "outputs": {}}}),
        StubResponse(200, {
            "prompt": {
                "status": {"completed": True, "status_str": "success"},
                "outputs": {"9": {"images": [{"filename": "done.png"}]}},
            }
        }),
    ]

    class HistorySession:
        def __init__(self):
            self.calls = 0

        def get(self, _url, **_kwargs):
            response = responses[self.calls]
            self.calls += 1
            return response

    class QuietWatchdog:
        def check(self):
            pass

    session = HistorySession()
    monkeypatch.setattr(rr.time, "sleep", lambda _seconds: None)
    outputs = rr.ComfyClient("http://comfy", session=session).wait_outputs(
        "prompt", 10, QuietWatchdog()
    )
    assert session.calls == 2
    assert outputs[0]["filename"] == "done.png"


@pytest.mark.parametrize("failure_path", ["early-exit", "timeout"])
def test_C3_tunnel_enter_failure_always_kills_child(
        tmp_path, monkeypatch, failure_path):
    class FakeProcess:
        def __init__(self):
            self.alive = failure_path == "timeout"
            self.terminated = False
            self.killed = False
            self.stderr = io.StringIO("")

        def poll(self):
            return None if self.alive else 23

        def terminate(self):
            self.terminated = True
            self.alive = False

        def wait(self, timeout=None):
            return self.poll()

        def kill(self):
            self.killed = True
            self.alive = False

    process = FakeProcess()
    monkeypatch.setattr(rr.subprocess, "Popen", lambda *_args, **_kwargs: process)
    if failure_path == "timeout":
        ticks = iter([0.0, 0.0, 31.0])
        monkeypatch.setattr(rr.time, "monotonic", lambda: next(ticks))
        monkeypatch.setattr(rr.time, "sleep", lambda _seconds: None)
        monkeypatch.setattr(
            rr.socket, "create_connection",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("not ready")),
        )
    remote = rr.RemoteExecutor("example", 2222, tmp_path / "known", logging.getLogger("C3"))
    with pytest.raises(rr.HarnessError):
        rr.SSHTunnel(remote, 8188, logging.getLogger("C3-tunnel")).__enter__()
    assert process.poll() is not None
    if failure_path == "timeout":
        assert process.terminated


def test_C4_job_expected_four_images_rejects_two(tmp_path):
    class TwoImageComfy(FakeComfy):
        def wait_outputs(self, _prompt_id, _timeout, watchdog):
            watchdog.check()
            return [
                {"filename": "one.png", "subfolder": "", "type": "output"},
                {"filename": "two.png", "subfolder": "", "type": "output"},
            ]

    four_image_manifest = manifest()
    four_image_manifest["jobs"][0]["expected_images"] = 4
    api = FakeAPI()
    logger, _stream = logger_and_stream()
    with pytest.raises(rr.HarnessError, match="expected 4, received 2"):
        rr.run_harness(
            four_image_manifest, tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=1, dry_run=False, api=api, logger=logger,
            remote_factory=FakeRemote, comfy_factory=TwoImageComfy,
            tunnel_factory=lambda *_args: rr.no_tunnel(), sleep=lambda _seconds: None,
            ledger_dir=tmp_path / "ledger",
        )
    assert api.deletes == 1


def test_C6_ledger_is_provisional_at_create_then_updated_at_teardown(tmp_path):
    ledger_dir = tmp_path / "ledger"

    class InspectingAPI(FakeAPI):
        provisional = ""

        def delete_pod(self, pod_id):
            self.provisional = next(ledger_dir.glob("*.tsv")).read_text(encoding="utf-8")
            super().delete_pod(pod_id)

    api = InspectingAPI()
    result, _logs = run_with(api, tmp_path, ledger_dir=ledger_dir)
    assert "runpod:rtx-4090\tpod-create pod-123\t0.008333" in api.provisional
    final_lines = next(ledger_dir.glob("*.tsv")).read_text(encoding="utf-8").splitlines()
    assert final_lines[0] == "model\tstep\tusd"
    assert len(final_lines) == 2
    assert final_lines[1].startswith("runpod:rtx-4090\tpod-create pod-123\t")
    assert float(final_lines[1].split("\t")[2]) == pytest.approx(result["estimated_actual_usd"])


def test_C7_trailing_bare_dash_is_harness_error():
    with pytest.raises(rr.HarnessError, match="trailing bare"):
        rr.parse_simple_yaml("jobs:\n  -\n")


def test_SSH_flag_symmetry_ssh_lowercase_scp_uppercase(tmp_path, monkeypatch):
    commands = []

    def fake_run(command, **_kwargs):
        commands.append(command)
        return type("Completed", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(rr.subprocess, "run", fake_run)
    remote = rr.RemoteExecutor("example", 12345, tmp_path / "known", logging.getLogger("flags"))
    remote.bootstrap("true", 1)
    remote.copy("/workspace/a.png", tmp_path / "a.png", 1)
    ssh_command, scp_command = commands
    assert ssh_command[0] == "ssh"
    assert "-p" in ssh_command and "-P" not in ssh_command
    assert scp_command[0] == "scp"
    assert "-P" in scp_command and "-p" not in scp_command

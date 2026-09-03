from __future__ import annotations

import io
import base64
import copy
import itertools
import json
import logging
import os
import signal
import shutil
import subprocess
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import pytest

import sys

POD_DIR = Path(__file__).resolve().parents[1]
BAKEOFF_DIR = POD_DIR.parent / "bakeoff"
CALIBRATE_RUNS_DIR = POD_DIR.parent / "calibrate" / "runs"
# Restricted workers may not access the user-wide temp directory. Pytest reads this lazily
# when tmp_path is first requested, so keep its scratch tree inside this test's own scope.
os.environ.setdefault("PYTEST_DEBUG_TEMPROOT", str(POD_DIR))
sys.path.insert(0, str(POD_DIR))

import runpod_run as rr  # noqa: E402


def test_P1h_create_payload_embeds_bootstrap_in_start_command_without_api_key(monkeypatch):
    secret = "ambient-runpod-key-must-not-enter-payload"
    monkeypatch.setenv("RUNPOD_API_KEY", secret)

    payload = rr.create_payload(manifest())
    serialized = json.dumps(payload)

    assert payload["ports"] == ["8188/http"]
    assert payload["dockerEntrypoint"] == ["bash", "-lc"]
    assert "FIGMENT_BOOTSTRAP_B64" in payload["env"]
    script = base64.b64decode(payload["env"]["FIGMENT_BOOTSTRAP_B64"]).decode()
    assert "--listen 0.0.0.0 --port 8188" in script
    assert "--output-directory /workspace/output" in script
    assert "/workspace/output/_bootstrap.log" in script
    assert "/workspace/output/_bootstrap.failed" in script
    assert secret not in serialized


def test_P1h_wait_ready_requires_proxy_system_stats_200_and_logs_bootstrap_tail():
    class OnePodAPI:
        def get_pod(self, _pod_id):
            return ready_pod()

    class Proxy:
        def __init__(self):
            self.statuses = iter([502, 200])

        def health_status(self):
            return next(self.statuses)

        def fetch_artifact(self, filename):
            if filename == "_bootstrap.failed":
                return 404, ""
            return 200, "STEP model-1 rc=0\nSTEP comfy-start rc=0\n"

    class QuietWatchdog:
        def check(self):
            pass

    logger, stream = logger_and_stream()
    ready = rr.wait_ready(
        OnePodAPI(), "pod-123", 1, QuietWatchdog(), logger, Proxy(),
        sleep=lambda _seconds: None, bootstrap_log_every_polls=1,
    )

    assert ready == ready_pod()
    logs = stream.getvalue()
    assert "proxyStatus=502" in logs
    assert "proxyStatus=200" in logs
    assert "bootstrap log tail: STEP model-1 rc=0" in logs


class StubResponse:
    def __init__(self, status_code, data=None):
        self.status_code = status_code
        self._data = data
        if data is None:
            self.content = b""
        elif isinstance(data, bytes):
            self.content = data
        elif isinstance(data, str):
            self.content = data.encode()
        else:
            self.content = json.dumps(data).encode()

    def json(self):
        return self._data

    def iter_content(self, chunk_size=8192):
        for offset in range(0, len(self.content), chunk_size):
            yield self.content[offset:offset + chunk_size]


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

    def health_status(self):
        return 200

    def fetch_artifact(self, _filename):
        return 404, ""

    def download_output(self, image, local_path, _timeout):
        assert rr.view_params(image)["type"] == "output"
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(b"not-empty")

    def close(self):
        pass


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
        "ports": ["8188/http"],
        "adjustedCostPerHr": 0.50,
    }


def manifest():
    return {
        "gpu": {"type": "NVIDIA GeForce RTX 4090", "count": 1, "cloud": "SECURE"},
        "image": "runpod/pytorch:test",
        "price_usd_per_hour": 0.50,
        "volume_mount_path": "/workspace",
        "comfyui": {
            "root": "/workspace/ComfyUI",
            "git_ref": "v0.20.1",
            "port": 8188,
            "start_command": "python main.py",
        },
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
        comfy_factory=comfy,
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


def test_wait_ready_logs_pod_state_and_proxy_status_each_poll():
    class OnePodAPI:
        def get_pod(self, _pod_id):
            return ready_pod()

    class QuietWatchdog:
        def check(self):
            pass

    logger, stream = logger_and_stream()
    ready = rr.wait_ready(
        OnePodAPI(), "pod-123", 1, QuietWatchdog(), logger, FakeComfy(),
        sleep=lambda _seconds: None,
    )

    assert ready == ready_pod()
    logs = stream.getvalue()
    assert "readiness poll elapsed=" in logs
    assert "desiredStatus=RUNNING" in logs
    assert "lastStatusChange=" in logs
    assert "proxyStatus=200" in logs
    assert "readiness matched desiredStatus=RUNNING" in logs


def test_wait_ready_timeout_logs_last_full_state_and_names_stuck_state(monkeypatch):
    stuck = {
        "id": "pod-123",
        "desiredStatus": "RUNNING",
        "currentStatus": "PULLING_IMAGE",
        "publicIp": "127.0.0.1",
        "portMappings": {},
        "lastStatusChange": "Pulling container image",
        "env": {"HF_TOKEN": "do-not-persist"},
    }

    class StuckAPI:
        def get_pod(self, _pod_id):
            return stuck

    class QuietWatchdog:
        def check(self):
            pass

    ticks = iter([0.0, 0.0, 0.5, 2.0])
    monkeypatch.setattr(rr.time, "monotonic", lambda: next(ticks))
    logger, stream = logger_and_stream()
    with pytest.raises(rr.ReadinessTimeout, match="image pull in progress") as caught:
        rr.wait_ready(
            StuckAPI(), "pod-123", 1, QuietWatchdog(), logger,
            type("NotReadyProxy", (), {
                "health_status": lambda self: 502,
                "fetch_artifact": lambda self, _name: (404, ""),
            })(),
            sleep=lambda _seconds: None,
        )

    assert caught.value.last_pod_state["desiredStatus"] == "RUNNING"
    assert caught.value.last_pod_state["env"] == {"HF_TOKEN": "[REDACTED]"}
    logs = stream.getvalue()
    assert "readiness poll elapsed=0.5s" in logs
    assert '"currentStatus": "PULLING_IMAGE"' in logs
    assert "do-not-persist" not in logs


def test_readiness_timeout_persists_last_pod_state_in_run_json(tmp_path, monkeypatch):
    stuck = {
        "id": "pod-123",
        "desiredStatus": "RUNNING",
        "publicIp": "127.0.0.1",
        "portMappings": {},
        "lastStatusChange": "Rented by User",
        "env": {"PRIVATE_TOKEN": "do-not-persist"},
    }

    def timeout(*_args, **_kwargs):
        raise rr.ReadinessTimeout(
            "pod readiness timed out: stuck in desiredStatus=RUNNING with no port mapping",
            stuck,
        )

    monkeypatch.setattr(rr, "wait_ready", timeout)
    api = FakeAPI()
    with pytest.raises(rr.ReadinessTimeout, match="no port mapping"):
        run_with(api, tmp_path)

    record = json.loads((tmp_path / "out" / "run.json").read_text())
    assert record["last_pod_state"]["desiredStatus"] == "RUNNING"
    assert record["last_pod_state"]["env"] == {"PRIVATE_TOKEN": "[REDACTED]"}
    assert "do-not-persist" not in (tmp_path / "out" / "run.json").read_text()
    assert record["termination_verified"] is True


def test_bootstrap_failed_marker_names_reason_and_terminates(tmp_path):
    class FailedBootstrapProxy(FakeComfy):
        def health_status(self):
            return 503

        def fetch_artifact(self, filename):
            if filename == "_bootstrap.failed":
                return 200, "model-2 failed with rc=22\n"
            return 200, "STEP model-2 rc=22\n"

    api = FakeAPI()
    with pytest.raises(rr.HarnessError, match="model-2 failed with rc=22"):
        run_with(api, tmp_path, comfy=FailedBootstrapProxy)

    assert api.deletes == 1
    record = json.loads((tmp_path / "out" / "run.json").read_text())
    assert record["termination_verified"] is True


def test_P1k_bootstrap_failure_logs_tail_persists_ten_lines_and_uses_ceiling_rate(
        tmp_path, monkeypatch):
    class FailedBootstrapProxy(FakeComfy):
        def health_status(self):
            return 503

        def fetch_artifact(self, filename):
            if filename == "_bootstrap.failed":
                return 200, "comfy-install failed with rc=128\n"
            return 200, "\n".join(f"bootstrap line {index}" for index in range(45))

    # The first reading starts the billing clock; the later readings enter and exit readiness.
    ticks = itertools.chain([1000.0], itertools.repeat(1024.0))
    monkeypatch.setattr(rr.time, "monotonic", lambda: next(ticks))
    api = FakeAPI()
    logger, stream = logger_and_stream()
    ledger_dir = tmp_path / "ledger"
    with pytest.raises(rr.BootstrapFailed, match="comfy-install failed with rc=128"):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1.0, max_minutes=1.0, dry_run=False, api=api, logger=logger,
            comfy_factory=FailedBootstrapProxy, sleep=lambda _seconds: None,
            ledger_dir=ledger_dir,
        )

    record = json.loads((tmp_path / "out" / "run.json").read_text(encoding="utf-8"))
    assert record["bootstrap_log_tail"] == [f"bootstrap line {index}" for index in range(35, 45)]
    assert record["estimated_actual_usd"] == pytest.approx(24 * 0.50 / 3600, abs=1e-6)
    assert record["estimated_actual_usd_basis"] == "ceiling-rate estimate"
    assert "bootstrap log tail: bootstrap line 5" in stream.getvalue()
    assert api.deletes == 1
    ledger_value = float(next(ledger_dir.glob("*.tsv")).read_text().splitlines()[1].split("\t")[2])
    assert ledger_value == pytest.approx(24 * 0.50 / 3600, abs=1e-6)


def test_P1k_bootstrap_retry_helper_retries_then_succeeds_and_fails():
    script = rr.bootstrap_script(manifest())
    retry = next(line for line in script.splitlines() if line.startswith("retry_required()"))
    bash = shutil.which("bash")
    git_bash = Path("C:/Program Files/Git/bin/bash.exe")
    if os.name == "nt" and git_bash.is_file():
        bash = str(git_bash)
    assert bash is not None
    prelude = "\n".join([
        "BOOTSTRAP_LOG=/dev/null",
        'log_line() { echo "$1"; }',
        'fatal() { return "$2"; }',
        'sleep() { :; }',
        retry,
    ])
    succeeded = subprocess.run(
        [bash, "-c", prelude + "\ntries=0; run() { tries=$((tries + 1)); [ \"$tries\" -ge 2 ]; }; retry_required demo run; echo tries=$tries"],
        capture_output=True, text=True, check=False,
    )
    assert succeeded.returncode == 0
    assert "STEP demo attempt=1 rc=1" in succeeded.stdout
    assert "STEP demo attempt=2 rc=0" in succeeded.stdout
    assert "tries=2" in succeeded.stdout

    failed = subprocess.run(
        [bash, "-c", prelude + "\ntries=0; run() { tries=$((tries + 1)); return 17; }; retry_required demo run; echo rc=$? tries=$tries"],
        capture_output=True, text=True, check=False,
    )
    assert failed.returncode == 0
    assert "STEP demo attempt=3 rc=17" in failed.stdout
    assert "rc=17 tries=3" in failed.stdout


def test_P1k_network_wait_precedes_all_bootstrap_network_steps():
    configured = manifest()
    configured["models"] = [{
        "repo_id": "org/model",
        "filename": "model.safetensors",
        "destination_dir": "/workspace/ComfyUI/models/checkpoints",
    }]
    script = rr.bootstrap_script(configured)
    assert "getent hosts github.com" in script
    assert "getent hosts huggingface.co" in script
    assert script.index("wait_for_network\n") < script.index("retry_required comfy-install")
    assert "retry_required model-1" in script
    assert "retrying in ${backoff}s" in script


def test_P1m_gpu_and_import_preflight_precede_model_downloads():
    configured = manifest()
    configured["models"] = [{
        "repo_id": "org/model",
        "filename": "model.safetensors",
        "destination_dir": "/workspace/ComfyUI/models/checkpoints",
    }]

    script = rr.bootstrap_script(configured)
    gpu_index = script.index("run_required gpu-present")
    torch_index = script.index("run_required torch-cuda")
    install_index = script.index("retry_required comfy-install")
    import_index = script.index("run_required comfy-import-smoke")
    model_index = script.index("retry_required model-1")

    assert "nvidia-smi -L" in script
    assert "torch.cuda.is_available()" in script
    assert gpu_index < torch_index < install_index < import_index < model_index
    assert "retry_required gpu-present" not in script
    assert "retry_required torch-cuda" not in script
    assert "timeout 120 python -c" in script


def test_P1m_extra_args_are_appended_and_transport_flags_remain_owned(tmp_path):
    configured = manifest()
    configured["comfyui"]["extra_args"] = "--disable-smart-memory --preview-method auto"
    script = rr.bootstrap_script(configured)

    assert "python main.py --disable-smart-memory --preview-method auto --listen 0.0.0.0" in script
    configured["comfyui"]["extra_args"] = "--port 9999"
    with pytest.raises(rr.HarnessError, match="extra_args must omit --listen, --port"):
        rr.require_manifest(configured, tmp_path / "manifest.yaml")


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


def test_manifest_readiness_budget_requires_five_minute_teardown_margin(tmp_path):
    too_short = manifest()
    too_short["readiness_timeout_seconds"] = 1200
    too_short["max_minutes"] = 24.99
    with pytest.raises(rr.HarnessError, match="readiness.*5 minute"):
        rr.require_manifest(too_short, tmp_path / "manifest.yaml")

    valid = manifest()
    valid["readiness_timeout_seconds"] = 1200
    valid["max_minutes"] = 25
    rr.require_manifest(valid, tmp_path / "manifest.yaml")
    with pytest.raises(rr.HarnessError, match="effective max_minutes.*5 minute"):
        rr.enforce_effective_readiness_budget(valid, 24.99)


def test_manifest_readiness_timeout_defaults_to_900_seconds():
    assert rr.manifest_readiness_timeout_seconds(manifest()) == 900


def test_manifest_basename_resolves_beside_script(monkeypatch, tmp_path):
    named = POD_DIR / "manifest.example.yaml"
    monkeypatch.chdir(tmp_path)
    assert rr.resolve_manifest_path(Path("manifest.example.yaml")) == named


def test_watchdog_fires_at_max_minutes_and_terminates(tmp_path):
    class SlowComfy(FakeComfy):
        def health_status(self):
            time.sleep(1.05)
            return 502

    api = FakeAPI()
    logger, _stream = logger_and_stream()
    with pytest.raises(rr.RunCancelled, match="maximum runtime"):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1.0, max_minutes=0.0002, dry_run=False, api=api, logger=logger,
            comfy_factory=SlowComfy,
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
            redactor=redactor, comfy_factory=SecretComfy,
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


def test_probe_is_read_only_and_prints_shape_not_values(monkeypatch, capsys):
    secret_value = "must-not-be-printed"
    session = StubSession([StubResponse(200, [{
        "id": secret_value,
        "desiredStatus": "RUNNING",
        "currentStatus": "PENDING",
        "publicIp": "203.0.113.8",
        "portMappings": {"22": 12345},
        "runtime": {"status": "STARTING", "ports": []},
    }])])
    redactor = rr.ApiKeyRedactionFilter(session)
    monkeypatch.setattr(rr, "build_authenticated_session", lambda: (session, redactor))

    assert rr.main(["probe"]) == 0

    output = capsys.readouterr().out
    assert secret_value not in output
    assert "203.0.113.8" not in output
    assert '"desiredStatus": "RUNNING"' in output
    assert '"currentStatus": "PENDING"' in output
    assert '"status": "STARTING"' in output
    assert [call[0] for call in session.calls] == ["GET"]
    assert session.calls[0][1].endswith("/pods?includeMachine=true")


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
    for manifest_name in ("arm-b-klein4b.yaml", "smoke.yaml"):
        manifest_path = BAKEOFF_DIR / manifest_name
        assert "99" not in json.loads(manifest_path.read_text(encoding="utf-8"))["workflow"]
        assert rr.main([
            "run", "--manifest", str(manifest_path), "--dry-run",
            "--out", str(tmp_path / manifest_path.stem),
        ]) == 0


def test_proxy_url_and_payload_expose_only_comfy_http():
    assert rr.pod_proxy_url("pod-123") == "https://pod-123-8188.proxy.runpod.net"
    assert rr.create_payload(manifest())["ports"] == ["8188/http"]


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


def test_P1j_timeout_logs_create_error_and_uses_uncertain_banner(tmp_path, monkeypatch):
    monkeypatch.setattr(rr.atexit, "register", lambda _callback: None)
    monkeypatch.setattr(rr.atexit, "unregister", lambda _callback: None)

    class InvisibleCreate:
        def create_pod(self, _payload):
            raise TimeoutError("POST timed out")

        def list_pods(self):
            return []

        def delete_pod(self, _pod_id):
            raise AssertionError("no pod id should be invented")

        def get_pod(self, _pod_id):
            raise AssertionError("no pod id should be invented")

    logger, stream = logger_and_stream()
    with pytest.raises(rr.PodStillRunning, match="create returned uncertain") as caught:
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=1, dry_run=False, api=InvisibleCreate(), logger=logger,
            comfy_factory=FakeComfy, sleep=lambda _seconds: None,
            ledger_dir=tmp_path / "ledger",
        )

    assert "TimeoutError: POST timed out" in stream.getvalue()
    assert "a pod may exist" in str(caught.value)
    record = json.loads((tmp_path / "out" / "run.json").read_text())
    assert record["create_error"] == "TimeoutError: POST timed out"
    assert not (tmp_path / "ledger").exists()


def test_P1j_http_429_logs_redacted_body_and_no_visible_pod_banner(tmp_path, monkeypatch):
    monkeypatch.setattr(rr.atexit, "register", lambda _callback: None)
    monkeypatch.setattr(rr.atexit, "unregister", lambda _callback: None)
    key = "create-response-secret"
    session = StubSession(
        [StubResponse(429, {"error": f"rate limited: {key}"})]
        + [StubResponse(200, []) for _ in range(10)],
        key=key,
    )
    redactor = rr.ApiKeyRedactionFilter(session)
    logger, stream = logger_and_stream(redactor)

    with pytest.raises(rr.PodStillRunning, match="no pod with this name is visible") as caught:
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=1, dry_run=False, api=rr.RunPodAPI(session), logger=logger,
            redactor=redactor, comfy_factory=FakeComfy, sleep=lambda _seconds: None,
            ledger_dir=tmp_path / "ledger",
        )

    logs = stream.getvalue()
    record_text = (tmp_path / "out" / "run.json").read_text()
    assert "CreateCallError" in logs
    assert "HTTP 429" in logs
    assert "rate limited" in logs
    assert "most likely never created" in str(caught.value)
    assert key not in logs + record_text
    assert "[REDACTED]" in logs + record_text
    assert not (tmp_path / "ledger").exists()


def test_P1j_definite_create_refusal_scans_once_without_ledger(tmp_path):
    session = StubSession([
        StubResponse(400, {"error": "no GPU available"}),
        StubResponse(200, []),
    ])
    logger, _stream = logger_and_stream()

    with pytest.raises(rr.CreateFailed, match="CREATE FAILED: CreateCallError"):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=1, dry_run=False, api=rr.RunPodAPI(session), logger=logger,
            comfy_factory=FakeComfy, sleep=lambda _seconds: None,
            ledger_dir=tmp_path / "ledger",
        )

    assert [call[0] for call in session.calls] == ["POST", "GET"]
    assert not (tmp_path / "ledger").exists()


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
            comfy_factory=FakeComfy, sleep=lambda _seconds: None,
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
            ledger_dir=daily_ledgers, budget_path=budget,
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
        comfy_factory=FakeComfy, sleep=lambda _seconds: None,
        ledger_dir=tmp_path / "ledger",
    )
    assert len(configured) == 1
    assert 1.0 < configured[0] < 3.0


def test_A7_finally_waits_for_watchdog_slow_teardown_before_run_json(tmp_path):
    class SlowDeleteAPI(FakeAPI):
        def delete_pod(self, pod_id):
            time.sleep(0.15)
            super().delete_pod(pod_id)

    class BudgetOverrunComfy(FakeComfy):
        def health_status(self):
            time.sleep(1.02)
            return 502

    api = SlowDeleteAPI()
    logger, _stream = logger_and_stream()
    with pytest.raises(rr.RunCancelled, match="maximum runtime"):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=0.0002, dry_run=False, api=api, logger=logger,
            comfy_factory=BudgetOverrunComfy, ledger_dir=tmp_path / "ledger",
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
    assert 'File "' in stderr

    try:
        raise RuntimeError(f"traceback carried {secret}")
    except RuntimeError as exc:
        formatted = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        assert secret not in redactor.redact(formatted)
        rr.redacting_excepthook(type(exc), exc, exc.__traceback__)
    hook_stderr = capsys.readouterr().err
    assert secret not in hook_stderr
    assert "[REDACTED]" in hook_stderr
    assert 'File "' in hook_stderr
    rr.set_active_redactor(None)


def test_B2_public_proxy_client_refuses_an_authorization_header():
    with pytest.raises(rr.HarnessError, match="must not carry Authorization"):
        rr.ComfyClient("https://pod-8188.proxy.runpod.net", session=StubSession([]))


def test_C2_incomplete_comfy_history_keeps_polling(monkeypatch):
    responses = [
        StubResponse(200, {"prompt": {"status": {"completed": False}, "outputs": {}}}),
        StubResponse(200, {
            "prompt": {
                "status": {"completed": True, "status_str": "success"},
                "outputs": {"9": {"images": [{"filename": "done.png", "type": "output"}]}},
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


def test_C3_job_submit_poll_and_streaming_download_use_proxy_http(tmp_path):
    class ProxySession:
        headers = {}

        def __init__(self):
            self.calls = []

        def post(self, url, **kwargs):
            self.calls.append(("POST", url, kwargs))
            return StubResponse(200, {"prompt_id": "prompt-7"})

        def get(self, url, **kwargs):
            self.calls.append(("GET", url, kwargs))
            if "/history/" in url:
                return StubResponse(200, {
                    "prompt-7": {
                        "status": {"completed": True, "status_str": "success"},
                        "outputs": {"9": {"images": [{
                            "filename": "final.png", "subfolder": "batch", "type": "output",
                        }]}},
                    }
                })
            assert url.endswith("/view")
            assert kwargs["params"] == {
                "filename": "final.png", "subfolder": "batch", "type": "output",
            }
            assert kwargs["stream"] is True
            return StubResponse(200, b"streamed-image")

        def close(self):
            pass

    class QuietWatchdog:
        def check(self):
            pass

    session = ProxySession()
    comfy = rr.ComfyClient("https://pod-123-8188.proxy.runpod.net", session=session)
    prompt_id = comfy.submit({"1": {"class_type": "Test", "inputs": {}}})
    images = comfy.wait_outputs(prompt_id, 10, QuietWatchdog())
    paths = rr.download_job_outputs(
        comfy, images, tmp_path, "job", timeout=10, expected_images=1,
    )

    assert paths[0].read_bytes() == b"streamed-image"
    assert [call[0] for call in session.calls] == ["POST", "GET", "GET"]


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
            comfy_factory=TwoImageComfy, sleep=lambda _seconds: None,
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


def test_P1i_training_template_bare_seed_fields_parse_as_yaml_strings():
    parsed = rr.parse_simple_yaml("seed_fields: [seed, noise_seed]\n")
    assert parsed == {"seed_fields": ["seed", "noise_seed"]}


def test_P1i_upload_files_block_accepts_mapping_fields_after_nested_list():
    parsed = rr.parse_simple_yaml(
        "uploads:\n"
        "  - files:\n"
        "      - dataset/*.png\n"
        "      - dataset/*.txt\n"
        "    subfolder: persona-a\n"
        "    type: input\n"
        "    overwrite: false\n"
    )
    assert parsed["uploads"] == [{
        "files": ["dataset/*.png", "dataset/*.txt"],
        "subfolder": "persona-a",
        "type": "input",
        "overwrite": False,
    }]


def test_proxy_url_rejects_unsafe_pod_ids():
    with pytest.raises(rr.HarnessError, match="unsafe pod id"):
        rr.pod_proxy_url("pod.example/escape")


@pytest.mark.parametrize(
    "manifest_name",
    ["arm-a-zimage.yaml", "arm-b-klein4b.yaml", "smoke.yaml"],
)
def test_N0_real_bakeoff_bootstrap_owns_comfyui_and_fails_fast(manifest_name):
    manifest_path = BAKEOFF_DIR / manifest_name
    real_manifest = rr.load_manifest(manifest_path)
    rr.require_manifest(real_manifest, manifest_path)

    script = rr.bootstrap_script(real_manifest)
    lines = script.splitlines()
    assert "git -C /workspace/ComfyUI fetch --depth 1 origin v0.20.1" in script
    assert "git clone --branch v0.20.1 --depth 1" in script
    assert "https://github.com/comfyanonymous/ComfyUI /workspace/ComfyUI" in script
    assert "elif [ -e /workspace ]; then" not in script
    assert script.index("comfy-install") < script.index("model-1")

    model_steps = [index for index, line in enumerate(lines) if line.startswith("retry_required model-")]
    assert len(model_steps) == len(real_manifest["models"])
    assert 'fatal "$label failed after $attempt attempts with rc=$rc" "$rc"' in script
    assert "--listen 0.0.0.0 --port 8188" in script
    assert "--output-directory /workspace/output" in script
    assert 'sleep 60' in script


def test_N0_manifest_requires_git_ref_and_nested_comfy_root(tmp_path):
    missing_ref = manifest()
    missing_ref["comfyui"].pop("git_ref")
    with pytest.raises(rr.HarnessError, match="comfyui.git_ref is required"):
        rr.require_manifest(missing_ref, tmp_path / "manifest.yaml")

    mount_as_root = manifest()
    mount_as_root["comfyui"]["root"] = "/workspace"
    with pytest.raises(rr.HarnessError, match="subdirectory of volume_mount_path"):
        rr.require_manifest(mount_as_root, tmp_path / "manifest.yaml")


@pytest.mark.parametrize(
    "unsafe_root", ["/workspace/ComfyUI/..", "/other/ComfyUI", "relative/ComfyUI"],
)
def test_N0_comfy_root_cannot_escape_or_alias_volume_mount(tmp_path, unsafe_root):
    configured = manifest()
    configured["comfyui"]["root"] = unsafe_root
    with pytest.raises(rr.HarnessError, match="subdirectory of volume_mount_path"):
        rr.require_manifest(configured, tmp_path / "manifest.yaml")


@pytest.mark.parametrize("replace_root", [False, True])
def test_N0_non_git_comfy_root_replacement_requires_opt_in(replace_root):
    configured = manifest()
    configured["comfyui"]["replace_non_git_root"] = replace_root

    script = rr.bootstrap_script(configured)

    assert ("rm -rf /workspace/ComfyUI" in script) is replace_root


def test_N1_empty_name_scans_never_verify_uncertain_create(monkeypatch, capsys):
    monkeypatch.setattr(rr.atexit, "register", lambda _callback: None)
    monkeypatch.setattr(rr.atexit, "unregister", lambda _callback: None)

    class InvisibleCreatedPod:
        def create_pod(self, _payload):
            raise TimeoutError("POST timed out after create")

        def list_pods(self):
            return []

        def delete_pod(self, _pod_id):
            raise AssertionError("no pod id should be invented")

        def get_pod(self, _pod_id):
            raise AssertionError("no pod id should be invented")

    def uncertain_command(_args):
        lease = rr.PodLease(
            InvisibleCreatedPod(), {"name": "figment-bakeoff-invisible"},
            logging.getLogger("N1"), sleep=lambda _seconds: None, attempts=2,
        )
        with lease:
            pass

    monkeypatch.setattr(rr, "command_run", uncertain_command)
    code = rr.main(["run", "--manifest", "unused", "--out", "unused", "--dry-run"])
    stderr = capsys.readouterr().err
    assert code == 1
    assert "termination verified" not in stderr.lower()
    assert "create returned uncertain" in stderr
    assert "a pod may exist" in stderr
    assert "verify with `status`" in stderr


def test_N2_final_ledger_failure_cannot_displace_pod_still_running(
        tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(rr.atexit, "register", lambda _callback: None)
    monkeypatch.setattr(rr.atexit, "unregister", lambda _callback: None)
    ledger_dir = tmp_path / "ledger"

    class ImmortalForeignLedger(FakeAPI):
        def delete_pod(self, _pod_id):
            self.deletes += 1
            ledger = next(ledger_dir.glob("*.tsv"))
            ledger.write_text("foreign\theader\nvalue\tvalue\n", encoding="utf-8")

    api = ImmortalForeignLedger()

    def immortal_command(_args):
        run_with(api, tmp_path, ledger_dir=ledger_dir)
        return 0

    monkeypatch.setattr(rr, "command_run", immortal_command)
    code = rr.main(["run", "--manifest", "unused", "--out", "unused", "--dry-run"])
    stderr = capsys.readouterr().err
    assert code == 1
    assert api.deletes == rr.TERMINATE_ATTEMPTS
    assert "POD STILL RUNNING pod-123" in stderr
    assert "terminate --pod-id pod-123" in stderr


def test_N3_daily_budget_sums_mixed_usd_headers_and_skips_headerless(tmp_path):
    budget = tmp_path / "budget.yaml"
    budget.write_text("daily_usd_limit: 5.00\n", encoding="utf-8")
    ledgers = tmp_path / "ledgers"
    ledgers.mkdir()
    today = time.strftime("%Y-%m-%d", time.gmtime())
    (ledgers / f"model-{today}.tsv").write_text(
        "model\tstep\tusd\na\tb\t1.250000\n", encoding="utf-8"
    )
    (ledgers / f"note-{today}.tsv").write_text(
        "note\tusd\nprior work\t0.500000\n", encoding="utf-8"
    )
    (ledgers / f"headerless-{today}.tsv").write_text(
        "unlabelled work\t0.750000\n", encoding="utf-8"
    )
    logger, stream = logger_and_stream()

    daily_limit, spent = rr.daily_budget_state(
        budget_path=budget, ledger_dir=ledgers, logger=logger,
    )

    assert daily_limit == 5.0
    assert spent == pytest.approx(1.75)
    assert "skipping cost ledger without usd column" in stream.getvalue()


def test_N3_ledger_dir_precedence_and_ops_fallback(tmp_path, monkeypatch):
    cli_dir = tmp_path / "cli"
    env_dir = tmp_path / "env"
    ops_dir = tmp_path / "ops"
    ops_dir.mkdir()
    monkeypatch.setattr(rr, "OPS_LEDGER_DIR", ops_dir)
    monkeypatch.setenv("KB_LEDGER_DIR", str(env_dir))
    assert rr.configured_ledger_dir(cli_dir) == cli_dir
    assert rr.configured_ledger_dir() == env_dir
    monkeypatch.delenv("KB_LEDGER_DIR")
    assert rr.configured_ledger_dir() == ops_dir
    monkeypatch.setattr(rr, "OPS_LEDGER_DIR", tmp_path / "missing-ops")
    assert rr.configured_ledger_dir() == rr.repo_ledger_dir()


def test_N6_partial_signal_mask_install_restores_first_handler(monkeypatch):
    original = {signal.SIGINT: object(), signal.SIGTERM: object()}
    installed = []

    monkeypatch.setattr(rr.signal, "getsignal", lambda signum: original[signum])

    def install(signum, handler):
        installed.append((signum, handler))
        if signum == signal.SIGTERM and handler is not original[signal.SIGTERM]:
            raise RuntimeError("SIGTERM install failed")

    monkeypatch.setattr(rr.signal, "signal", install)
    with pytest.raises(RuntimeError, match="SIGTERM install failed"):
        with rr.teardown_signal_mask(logging.getLogger("N6")):
            pass
    assert (signal.SIGINT, original[signal.SIGINT]) in installed


def test_N7_concurrent_ledger_upserts_both_land(tmp_path):
    barrier = threading.Barrier(3)
    errors = []

    def upsert(step):
        barrier.wait()
        try:
            rr.upsert_cost_row(tmp_path, "runpod:rtx-4090", step, 0.1)
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=upsert, args=(f"pod-create pod-{index}",)) for index in range(2)]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join(timeout=5)

    assert not errors
    assert all(not thread.is_alive() for thread in threads)
    rows = next(tmp_path.glob("*.tsv")).read_text(encoding="utf-8").splitlines()
    assert len(rows) == 3
    assert any("pod-create pod-0" in row for row in rows)
    assert any("pod-create pod-1" in row for row in rows)
    assert not list(tmp_path.glob("*.tmp"))


@pytest.mark.parametrize(
    ("created_at", "expected_count"),
    [
        (datetime(2026, 1, 1, tzinfo=timezone.utc), 0),
        (datetime(2026, 1, 3, tzinfo=timezone.utc), 1),
        (None, 1),
    ],
)
def test_N8_name_recovery_rejects_pods_older_than_this_run(created_at, expected_count):
    pod = ready_pod("same-name")
    if created_at is not None:
        pod["createdAt"] = created_at.isoformat().replace("+00:00", "Z")

    class MatchingAPI:
        def list_pods(self):
            return [pod]

    logger, stream = logger_and_stream()
    lease = rr.PodLease(
        MatchingAPI(), {"name": "same-name"}, logger,
        started_utc=datetime(2026, 1, 2, tzinfo=timezone.utc),
    )
    assert len(lease._named_matches()) == expected_count
    if created_at is None:
        assert "has no creation timestamp" in stream.getvalue()


def test_N9_wait_outputs_counts_only_output_images(monkeypatch):
    history = {
        "prompt": {
            "status": {"completed": True, "status_str": "success"},
            "outputs": {"9": {"images": [
                {"filename": "preview.png", "type": "temp"},
                {"filename": "final.png", "type": "output"},
            ]}},
        }
    }

    class HistorySession:
        def get(self, _url, **_kwargs):
            return StubResponse(200, history)

    class QuietWatchdog:
        def check(self):
            pass

    outputs = rr.ComfyClient("http://comfy", session=HistorySession()).wait_outputs(
        "prompt", 10, QuietWatchdog()
    )
    assert outputs == [{"filename": "final.png", "subfolder": "", "type": "output"}]


def test_C5_comfy_start_failure_short_circuits_before_health():
    lines = rr.bootstrap_script(manifest()).splitlines()
    start_index = next(index for index, line in enumerate(lines) if line.startswith("run_required comfy-start"))
    health_index = next(index for index, line in enumerate(lines) if line.startswith("run_required comfy-health"))
    assert start_index < health_index
    assert 'fatal "$label failed with rc=$rc" "$rc"' in "\n".join(lines[:start_index])


def test_B3_proxy_download_failure_does_not_reflect_response_body(tmp_path):
    secret = "reflected-secret-value"

    class FailedProxySession:
        headers = {}

        def get(self, _url, **_kwargs):
            return StubResponse(502, f"server reflected {secret}")

    comfy = rr.ComfyClient("https://pod-8188.proxy.runpod.net", FailedProxySession())
    with pytest.raises(rr.HarnessError, match="GET /view returned HTTP 502") as caught:
        comfy.download_output(
            {"filename": "a.png", "subfolder": "", "type": "output"},
            tmp_path / "a.png", 1,
        )
    assert secret not in str(caught.value)


def p1i_training_manifest(tmp_path):
    configured = manifest()
    data = tmp_path / "dataset"
    rendered = tmp_path / "rendered"
    data.mkdir()
    rendered.mkdir()
    (data / "002.png").write_bytes(b"png-2")
    (data / "001.png").write_bytes(b"png-1")
    (data / "002.txt").write_text("caption two", encoding="utf-8")
    (data / "001.txt").write_text("caption one", encoding="utf-8")
    (rendered / "dataset.toml").write_text("dataset", encoding="utf-8")
    (rendered / "training.toml").write_text("training", encoding="utf-8")
    (data / "_dataset.ready").write_bytes(b"ready")
    (tmp_path / "start-training.sh.template").write_text(
        "#!/bin/sh\nprintf '%s %s\\n' '{{trigger}}' '{{diffusion_pipe_git_ref}}'\n",
        encoding="utf-8",
    )
    configured["uploads"] = [
        {
            "files": ["dataset/*.png", "dataset/*.txt", "rendered/*.toml"],
            "subfolder": "persona-a",
            "type": "input",
            "overwrite": False,
        },
        {
            "files": ["dataset/_dataset.ready"],
            "subfolder": "persona-a",
            "type": "input",
            "overwrite": False,
        },
    ]
    configured["training"] = {
        "trigger": "persona-a",
        "git_ref": "v1.2.3",
        "failed_marker": "/workspace/output/_training.failed",
        "complete_marker": "/workspace/output/_training.complete",
        "start_script_path": "/workspace/start-training.sh",
        "start_script_file": "start-training.sh.template",
    }
    configured["comfyui"]["start_command"] = "bash /workspace/start-training.sh"
    configured["artifacts"] = [{
        "remote": "persona-a.safetensors",
        "type": "output",
        "local": "persona-a.safetensors",
        "wait_for": "_training.complete",
    }]
    return configured, tmp_path / "manifest.yaml"


def test_P1i_upload_expansion_is_stable_marker_last_and_script_precedes_start(tmp_path):
    configured, manifest_path = p1i_training_manifest(tmp_path)

    rr.require_manifest(configured, manifest_path)
    uploads = rr.expand_manifest_uploads(configured, manifest_path)
    _script_path, rendered = rr.rendered_training_start_script(configured, manifest_path)
    script = rr.bootstrap_script(configured, manifest_path)

    assert [item.local_path.name for item in uploads] == [
        "001.png", "002.png", "001.txt", "002.txt",
        "dataset.toml", "training.toml", "_dataset.ready",
    ]
    assert uploads[-1].remote_name == "_dataset.ready"
    assert "persona-a" in rendered and "v1.2.3" in rendered
    assert "chmod 0700 /workspace/start-training.sh" in script
    assert script.index("training-start-script") < script.index("comfy-start")


@pytest.mark.parametrize("uploads", [None, {}, [], ["not-an-object"]])
def test_P1i_manifest_rejects_malformed_upload_lists(tmp_path, uploads):
    configured = manifest()
    configured["uploads"] = uploads
    with pytest.raises(rr.HarnessError, match="uploads"):
        rr.require_manifest(configured, tmp_path / "manifest.yaml")


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda m: m["uploads"][0].update(subfolder="../escape"), "subfolder"),
        (lambda m: m["uploads"][0].update(type="output"), "type=input"),
        (lambda m: m["uploads"][0].update(files=["missing/*.png"]), "matched no files"),
        (lambda m: m["uploads"][0].update(files=["dataset"]), "directories"),
        (lambda m: m["uploads"][0].update(files=["dataset/001.png", "dataset/001.png"]), "duplicate"),
        (lambda m: m["uploads"].reverse(), "_dataset.ready.*last"),
    ],
)
def test_P1i_manifest_rejects_unsafe_or_ambiguous_uploads(tmp_path, mutation, message):
    configured, manifest_path = p1i_training_manifest(tmp_path)
    mutation(configured)
    with pytest.raises(rr.HarnessError, match=message):
        rr.require_manifest(configured, manifest_path)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("start_script_file", "../start.sh"),
        ("start_script_file", "bad\x00name"),
        ("start_script_path", "/workspace/../start.sh"),
        ("start_script_path", "relative/start.sh"),
    ],
)
def test_P1i_manifest_rejects_unsafe_training_script_paths(tmp_path, field, value):
    configured, manifest_path = p1i_training_manifest(tmp_path)
    configured["training"][field] = value
    with pytest.raises(rr.HarnessError, match="start_script"):
        rr.require_manifest(configured, manifest_path)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("remote", "persona-a.exe", "unsupported artifact suffix"),
        ("local", "../persona-a.safetensors", "artifact local"),
        ("remote", "../persona-a.safetensors", "artifact remote"),
        ("type", "input", "type=output"),
        ("wait_for", "../_training.complete", "wait_for"),
    ],
)
def test_P1i_manifest_rejects_unsafe_artifacts(tmp_path, field, value, message):
    configured, manifest_path = p1i_training_manifest(tmp_path)
    configured["artifacts"][0][field] = value
    with pytest.raises(rr.HarnessError, match=message):
        rr.require_manifest(configured, manifest_path)


def test_P1i_proxy_upload_sends_exact_multipart_without_authorization(tmp_path):
    payload = b"exact png bytes\x00\xff"
    local = tmp_path / "frame.png"
    local.write_bytes(payload)

    class UploadSession:
        headers = {}

        def post(self, url, **kwargs):
            assert url == "https://pod-8188.proxy.runpod.net/upload/image"
            assert "Authorization" not in self.headers
            assert kwargs["data"] == {
                "subfolder": "persona-a", "type": "input", "overwrite": "false",
            }
            filename, handle = kwargs["files"]["image"][:2]
            assert filename == "frame.png"
            assert handle.read() == payload
            return StubResponse(200, {
                "name": "frame.png", "subfolder": "persona-a", "type": "input",
            })

    result = rr.ComfyClient(
        "https://pod-8188.proxy.runpod.net", UploadSession(),
    ).upload_file(local, "persona-a", overwrite=False)
    assert result == {"name": "frame.png", "subfolder": "persona-a", "type": "input"}


@pytest.mark.parametrize(
    "response",
    [
        StubResponse(502, "reflected local path C:/private/data.png"),
        StubResponse(200, {"name": "wrong.png", "subfolder": "persona-a", "type": "input"}),
        StubResponse(200, "not-json"),
    ],
)
def test_P1i_proxy_upload_http_json_and_response_mismatches_fail_closed(tmp_path, response):
    local = tmp_path / "frame.png"
    local.write_bytes(b"pixels")

    class UploadSession:
        headers = {}

        def post(self, _url, **_kwargs):
            return response

    with pytest.raises(rr.HarnessError, match="upload/image") as caught:
        rr.ComfyClient("https://proxy", UploadSession()).upload_file(
            local, "persona-a", overwrite=True,
        )
    assert "C:/private" not in str(caught.value)


def test_P1i_training_flow_orders_readiness_uploads_marker_wait_and_artifact(tmp_path):
    configured, manifest_path = p1i_training_manifest(tmp_path)
    events = []

    class TrainingComfy(FakeComfy):
        def health_status(self):
            events.append("ready")
            return 200

        def upload_file(self, local_path, subfolder, overwrite):
            events.append(f"upload:{local_path.name}")
            return {"name": local_path.name, "subfolder": subfolder, "type": "input"}

        def wait_for_marker(self, marker, failed_marker, _timeout, watchdog):
            watchdog.check()
            events.append(f"wait:{marker}:{failed_marker}")

        def download_artifact(self, remote, local_path, _timeout):
            events.append(f"artifact:{remote}")
            local_path.write_bytes(b"lora weights")

        def submit(self, _workflow):
            raise AssertionError("compatibility jobs must not be submitted")

    api = FakeAPI()
    logger, _stream = logger_and_stream()
    result = rr.run_harness(
        configured, manifest_path, tmp_path / "out", max_usd=1, max_minutes=1,
        dry_run=False, api=api, logger=logger, comfy_factory=TrainingComfy,
        sleep=lambda _seconds: None, ledger_dir=tmp_path / "ledger",
    )

    upload_events = [event for event in events if event.startswith("upload:")]
    assert upload_events[-1] == "upload:_dataset.ready"
    assert events.index("ready") < events.index("upload:001.png")
    assert events.index("upload:_dataset.ready") < next(
        index for index, event in enumerate(events) if event.startswith("wait:")
    )
    assert next(index for index, event in enumerate(events) if event.startswith("wait:")) < events.index(
        "artifact:persona-a.safetensors"
    )
    assert result["jobs"] == []
    assert result["uploads"][-1]["name"] == "_dataset.ready"
    assert result["artifacts"][0]["bytes"] == len(b"lora weights")
    assert api.deletes == 1 and api.alive is False


@pytest.mark.parametrize(
    ("stage", "message"),
    [
        ("upload", "upload failed"),
        ("failed-marker", "training failed"),
        ("marker-timeout", "timed out"),
        ("download", "artifact missing"),
    ],
)
def test_P1i_new_stage_failures_still_terminate_and_verify(tmp_path, stage, message):
    configured, manifest_path = p1i_training_manifest(tmp_path)

    class FailingTrainingComfy(FakeComfy):
        def upload_file(self, local_path, subfolder, overwrite):
            if stage == "upload":
                raise rr.HarnessError("upload failed")
            return {"name": local_path.name, "subfolder": subfolder, "type": "input"}

        def wait_for_marker(self, _marker, _failed_marker, _timeout, _watchdog):
            if stage == "failed-marker":
                raise rr.HarnessError("training failed marker appeared")
            if stage == "marker-timeout":
                raise rr.HarnessError("artifact marker timed out")

        def download_artifact(self, _remote, local_path, _timeout):
            if stage == "download":
                raise rr.HarnessError("artifact missing")
            local_path.write_bytes(b"weights")

    api = FakeAPI()
    logger, _stream = logger_and_stream()
    with pytest.raises(rr.HarnessError, match=message) as caught:
        rr.run_harness(
            configured, manifest_path, tmp_path / "out", max_usd=1, max_minutes=1,
            dry_run=False, api=api, logger=logger, comfy_factory=FailingTrainingComfy,
            sleep=lambda _seconds: None, ledger_dir=tmp_path / "ledger",
        )
    assert api.deletes == 1 and api.alive is False
    assert getattr(caught.value, "termination_verified") is True


def test_P1i_marker_polling_is_delayed_and_failed_marker_wins(monkeypatch):
    class MarkerSession:
        headers = {}

        def __init__(self, statuses):
            self.statuses = iter(statuses)
            self.calls = []

        def get(self, url, **kwargs):
            self.calls.append((url, kwargs))
            return StubResponse(next(self.statuses))

    class QuietWatchdog:
        def check(self):
            pass

    session = MarkerSession([404, 404, 404, 200])
    monkeypatch.setattr(rr.time, "sleep", lambda _seconds: None)
    rr.ComfyClient("https://proxy", session).wait_for_marker(
        "_training.complete", "_training.failed", 10, QuietWatchdog(),
    )
    assert [call[1]["params"]["filename"] for call in session.calls] == [
        "_training.failed", "_training.complete",
        "_training.failed", "_training.complete",
    ]

    failed = MarkerSession([200, 200])
    with pytest.raises(rr.HarnessError, match="training failed"):
        rr.ComfyClient("https://proxy", failed).wait_for_marker(
            "_training.complete", "_training.failed", 10, QuietWatchdog(),
        )
    assert len(failed.calls) == 1

    timeout = MarkerSession([404, 404])
    clock = iter([0.0, 0.0, 2.0])
    monkeypatch.setattr(rr.time, "monotonic", lambda: next(clock))
    with pytest.raises(rr.HarnessError, match="timed out"):
        rr.ComfyClient("https://proxy", timeout).wait_for_marker(
            "_training.complete", "_training.failed", 1, QuietWatchdog(),
        )


def test_P1i_artifact_download_is_atomic_positive_and_rejects_zero(tmp_path):
    class DownloadSession:
        headers = {}

        def __init__(self, body, status=200):
            self.body = body
            self.status = status

        def get(self, _url, **kwargs):
            assert kwargs["params"] == {"filename": "persona-a.safetensors", "type": "output"}
            assert kwargs["stream"] is True
            return StubResponse(self.status, self.body)

    local = tmp_path / "persona-a.safetensors"
    rr.ComfyClient("https://proxy", DownloadSession(b"weights")).download_artifact(
        "persona-a.safetensors", local, 10,
    )
    assert local.read_bytes() == b"weights"
    assert not local.with_suffix(".safetensors.partial").exists()

    local.unlink()
    with pytest.raises(rr.HarnessError, match="positive byte count"):
        rr.ComfyClient("https://proxy", DownloadSession(b"")).download_artifact(
            "persona-a.safetensors", local, 10,
        )
    assert not local.exists()
    assert not local.with_suffix(".safetensors.partial").exists()

    with pytest.raises(rr.HarnessError, match="GET /view returned HTTP 404"):
        rr.ComfyClient("https://proxy", DownloadSession(b"missing", 404)).download_artifact(
            "persona-a.safetensors", local, 10,
        )


def test_P1i_existing_image_job_path_is_preserved_without_new_blocks(tmp_path):
    api = FakeAPI()
    result, _logs = run_with(api, tmp_path)
    assert len(result["jobs"]) == 1
    assert result.get("uploads", []) == []
    assert result.get("artifacts", []) == []
    assert (tmp_path / "out" / "job-one.png").is_file()
    assert api.deletes == 1 and api.alive is False


class PlacementAPI:
    def __init__(self, hosts):
        self.hosts = list(hosts)
        self.pods = {}
        self.creates = []
        self.deletes = []
        self.provisional_snapshots = []
        self.ledger_dir = None

    def create_pod(self, payload):
        pod_id = f"pod-{len(self.creates) + 1}"
        pod = ready_pod(payload["name"])
        pod.update({
            "id": pod_id,
            "machine": {
                "podHostId": self.hosts[len(self.creates)],
                "id": f"machine-{len(self.creates) + 1}",
            },
        })
        self.creates.append(pod_id)
        self.pods[pod_id] = pod
        return dict(pod)

    def get_pod(self, pod_id):
        pod = self.pods.get(pod_id)
        return copy.deepcopy(pod) if pod else None

    def list_pods(self):
        return [copy.deepcopy(pod) for pod in self.pods.values()]

    def delete_pod(self, pod_id):
        if self.ledger_dir is not None:
            ledger = next(self.ledger_dir.glob("*.tsv"))
            self.provisional_snapshots.append(ledger.read_text(encoding="utf-8"))
        self.deletes.append(pod_id)
        self.pods.pop(pod_id, None)


def test_P1l_avoided_host_is_verified_then_recreated_with_two_ledger_rows(tmp_path):
    configured = manifest()
    configured["avoid_machine_hosts"] = ["bad-host"]
    ledger_dir = tmp_path / "ledger"
    api = PlacementAPI(["bad-host", "good-host"])
    api.ledger_dir = ledger_dir
    logger, stream = logger_and_stream()

    result = rr.run_harness(
        configured, tmp_path / "m.yaml", tmp_path / "out",
        max_usd=1, max_minutes=1, dry_run=False, api=api, logger=logger,
        comfy_factory=FakeComfy, sleep=lambda _seconds: None, ledger_dir=ledger_dir,
    )

    assert api.creates == ["pod-1", "pod-2"]
    assert api.deletes == ["pod-1", "pod-2"]
    assert api.pods == {}
    assert "AVOIDED HOST bad-host" in stream.getvalue()
    assert "attempt 1/4" in stream.getvalue()
    assert "pod-create pod-1" in api.provisional_snapshots[0]
    assert "pod-create pod-2" in api.provisional_snapshots[1]
    rows = next(ledger_dir.glob("*.tsv")).read_text(encoding="utf-8").splitlines()
    assert len(rows) == 3
    assert any("pod-create pod-1" in row for row in rows)
    assert any("pod-create pod-2" in row for row in rows)
    assert result["placement_attempts"][0]["avoided"] is True
    assert result["placement_attempts"][0]["termination_verified"] is True
    assert result["termination_verified"] is True


def test_P1l_all_placement_attempts_avoided_fails_closed(tmp_path):
    configured = manifest()
    configured["avoid_machine_hosts"] = ["bad-host"]
    api = PlacementAPI(["bad-host"] * 4)

    with pytest.raises(rr.HarnessError, match="all 4 placement attempts landed on avoided"):
        rr.run_harness(
            configured, tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=1, dry_run=False, api=api,
            logger=logger_and_stream()[0], comfy_factory=FakeComfy,
            sleep=lambda _seconds: None, ledger_dir=tmp_path / "ledger",
        )

    assert api.creates == ["pod-1", "pod-2", "pod-3", "pod-4"]
    assert api.deletes == api.creates
    assert api.pods == {}
    record = json.loads((tmp_path / "out" / "run.json").read_text(encoding="utf-8"))
    assert record["termination_verified"] is True
    assert all(item["termination_verified"] for item in record["placement_attempts"])


def test_P1l_network_bootstrap_failure_learns_host_and_entries_expire(
        tmp_path, monkeypatch):
    class FailedBootstrapProxy(FakeComfy):
        def health_status(self):
            return 503

        def fetch_artifact(self, filename):
            if filename == "_bootstrap.failed":
                return 200, "comfy-install failed after 3 attempts with rc=128\n"
            return 200, "fatal: could not read Username for 'https://github.com'\n"

    local_appdata = tmp_path / "local-appdata"
    monkeypatch.setenv("LOCALAPPDATA", str(local_appdata))
    api = PlacementAPI(["learn-me"])
    started = datetime(2026, 9, 2, 20, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(rr, "utc_now", lambda: started)

    with pytest.raises(rr.BootstrapFailed):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=1, dry_run=False, api=api,
            logger=logger_and_stream()[0], comfy_factory=FailedBootstrapProxy,
            sleep=lambda _seconds: None, ledger_dir=tmp_path / "ledger",
        )

    run_file = tmp_path / "out" / "_harness" / "bad_hosts.json"
    session_file = local_appdata / "kb-figment-pod" / "bad_hosts.json"
    for path in (run_file, session_file):
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["hosts"][0]["host"] == "learn-me"
        assert "rc=128" in data["hosts"][0]["reason"]
        assert rr.load_recent_bad_hosts(path, now=started) == {"learn-me"}
        assert rr.load_recent_bad_hosts(
            path, now=datetime(2026, 9, 3, 20, 0, 1, tzinfo=timezone.utc),
        ) == set()


@pytest.mark.parametrize(
    "failed_step",
    ["gpu-present failed with rc=1", "torch-cuda failed with rc=3",
     "comfy-import-smoke failed with rc=1", "comfy-health failed with rc=1"],
)
def test_P1m_host_class_bootstrap_failure_learns_host(tmp_path, monkeypatch, failed_step):
    class FailedBootstrapProxy(FakeComfy):
        def health_status(self):
            return 503

        def fetch_artifact(self, filename):
            if filename == "_bootstrap.failed":
                return 200, failed_step + "\n"
            return 200, "STEP " + failed_step + "\n"

    local_appdata = tmp_path / "local-appdata"
    monkeypatch.setenv("LOCALAPPDATA", str(local_appdata))
    api = PlacementAPI(["host-class-failure"])

    with pytest.raises(rr.BootstrapFailed, match=failed_step):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1, max_minutes=1, dry_run=False, api=api,
            logger=logger_and_stream()[0], comfy_factory=FailedBootstrapProxy,
            sleep=lambda _seconds: None, ledger_dir=tmp_path / "ledger",
        )

    for path in (
            tmp_path / "out" / "_harness" / "bad_hosts.json",
            local_appdata / "kb-figment-pod" / "bad_hosts.json"):
        entry = json.loads(path.read_text(encoding="utf-8"))["hosts"][0]
        assert entry["host"] == "host-class-failure"
        assert failed_step in entry["reason"]


def test_P1l_recent_session_hosts_are_merged_into_manifest_avoidance(tmp_path, monkeypatch):
    local_appdata = tmp_path / "local-appdata"
    monkeypatch.setenv("LOCALAPPDATA", str(local_appdata))
    session_file = local_appdata / "kb-figment-pod" / "bad_hosts.json"
    rr.record_bad_machine_host(
        session_file, "learned-host", "comfy-install rc=128",
        now=datetime.now(timezone.utc),
    )
    configured = manifest()
    configured["max_placement_attempts"] = 2
    api = PlacementAPI(["learned-host", "good-host"])

    result = rr.run_harness(
        configured, tmp_path / "m.yaml", tmp_path / "out",
        max_usd=1, max_minutes=1, dry_run=False, api=api,
        logger=logger_and_stream()[0], comfy_factory=FakeComfy,
        sleep=lambda _seconds: None, ledger_dir=tmp_path / "ledger",
    )

    assert api.creates == ["pod-1", "pod-2"]
    assert result["placement_attempts"][0]["machine_host"] == "learned-host"
    assert result["placement_attempts"][0]["avoided"] is True


def test_P1l_bootstrap_tarball_follows_git_retries_and_honours_overrides():
    configured = manifest()
    configured["comfyui"].update({
        "source_url": "https://example.test/ComfyUI.git",
        "tarball_url": "https://example.test/ComfyUI-v0.20.1.tar.gz",
    })

    script = rr.bootstrap_script(configured)

    assert "git clone --branch v0.20.1 --depth 1 https://example.test/ComfyUI.git" in script
    assert "retry_optional comfy-git" in script
    assert "curl -fL --retry 3 https://example.test/ComfyUI-v0.20.1.tar.gz" in script
    assert "COMFY_TARBALL_MARKER=/workspace/ComfyUI/.figment-tarball-v0.20.1" in script
    assert 'if [ -f "$COMFY_TARBALL_MARKER" ]' in script
    assert 'rm -rf "$COMFY_ROOT/.git"' in script
    assert 'touch "$COMFY_TARBALL_MARKER"' in script
    assert 'log_line "COMFY source=git"' in script
    assert 'log_line "COMFY source=tarball"' in script
    assert script.index("retry_optional comfy-git") < script.index("curl -fL --retry 3")
    assert script.index("curl -fL --retry 3") < script.index('touch "$COMFY_TARBALL_MARKER"')
    assert script.index('if [ -f "$COMFY_TARBALL_MARKER" ]') < script.index("retry_optional comfy-git")


def test_P1l_grid_01_dry_run_carries_failed_machine_host(tmp_path):
    manifest_path = CALIBRATE_RUNS_DIR / "grid-01-zimage.yaml"
    configured = rr.load_manifest(manifest_path)

    assert configured["avoid_machine_hosts"] == ["qvf79yutw3t2"]
    assert rr.main([
        "run", "--manifest", str(manifest_path), "--dry-run",
        "--out", str(tmp_path / "grid-01"),
    ]) == 0

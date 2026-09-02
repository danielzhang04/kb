from __future__ import annotations

import io
import json
import logging
import os
import threading
import time
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


class FakeRemote:
    def __init__(self, *_args):
        self.bootstrapped = False

    def bootstrap(self, script, _timeout):
        assert "set -e" not in script
        assert "STEP %s rc=%s" in script
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
        ledger_dir=tmp_path / "ledger",
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
            time.sleep(0.05)

    api = FakeAPI()
    logger, _stream = logger_and_stream()
    with pytest.raises(rr.RunCancelled, match="maximum runtime"):
        rr.run_harness(
            manifest(), tmp_path / "m.yaml", tmp_path / "out",
            max_usd=1.0, max_minutes=0.0002, dry_run=False, api=api, logger=logger,
            remote_factory=SlowRemote, comfy_factory=FakeComfy,
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

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from io import BytesIO
from pathlib import Path

import pytest

MODULE = Path(__file__).resolve().parents[1] / "codex_judge_backend.py"
spec = importlib.util.spec_from_file_location("figment_codex_judge_backend_test", MODULE)
assert spec and spec.loader
backend = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = backend
spec.loader.exec_module(backend)

GOOD = {
    "same_person": 75, "apparent_age_reference": 24, "apparent_age_candidate": 25,
    "skin_realism": 60, "gloss": 30, "artifacts": 10, "notes": "diagnostic only",
}


class _Sink(BytesIO):
    def close(self) -> None:  # retain written bytes for the assertion
        self.closed_by_backend = True


class FakeProcess:
    def __init__(self, argv, **kwargs):
        self.argv, self.kwargs = argv, kwargs
        self.stdin = _Sink()
        self.stdout = BytesIO(b"bounded stdout")
        self.stderr = BytesIO(b"bounded stderr")
        self.returncode = kwargs.pop("fake_returncode", 0)
        self._output = Path(argv[argv.index("--output-last-message") + 1])
        writer = kwargs.pop("fake_writer", None)
        if writer is not None:
            writer(self._output)

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self.returncode = -9


def _png(path: Path) -> None:
    from PIL import Image
    Image.new("RGB", (2, 2), color=(1, 2, 3)).save(path, format="PNG")


def _request(tmp_path: Path) -> backend.CodexJudgeRequest:
    candidate, reference = tmp_path / "candidate.png", tmp_path / "reference.png"
    _png(candidate); _png(reference)
    return backend.CodexJudgeRequest(
        candidate=candidate, references=[reference], prompt="Compare the attached reference then candidate. Return JSON only.",
        prompt_version="codex-v1", requested_model="gpt-5.6-terra", work_root=tmp_path / "fresh-work", timeout_seconds=2,
        executable=tmp_path / "codex.exe",
    )


def _fake_popen(payload=GOOD, returncode=0, capture=None):
    def launch(argv, **kwargs):
        def write(out: Path) -> None:
            if payload is not None:
                out.write_text(json.dumps(payload), encoding="utf-8")
        process = FakeProcess(argv, **kwargs, fake_returncode=returncode, fake_writer=write)
        if capture is not None:
            capture["process"] = process
        return process
    return launch


@pytest.fixture(autouse=True)
def fake_native_codex(monkeypatch, tmp_path):
    native = tmp_path / "codex.exe"
    native.write_bytes(b"native-test-binary")
    monkeypatch.setattr(backend, "resolve_native_codex", lambda executable=None: native)


def test_success_attaches_explicit_images_stdin_and_sanitized_provenance(tmp_path):
    request = _request(tmp_path); captured = {}
    result = backend.run_codex_judge(request, popen=_fake_popen(capture=captured))
    assert result["payload"] == {key: float(value) if key != "notes" else value for key, value in GOOD.items()}
    assert result["unavailable"] is None
    assert result["provenance"]["responding_model"] is None
    assert result["provenance"]["responding_model_status"] == "unreported"
    assert result["provenance"]["cache_key"] and result["provenance"]["image_count"] == 2
    argv = captured["process"].argv
    assert argv[:9] == [str(tmp_path / "codex.exe"), "exec", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only", "--skip-git-repo-check", "-c", 'model_reasoning_effort="low"']
    assert argv[9:15] == ["-c", "project_doc_max_bytes=0", "-c", "features.shell_tool=false", "-c", 'web_search="disabled"']
    assert argv.count("--image") == 2 and "--output-schema" in argv and "--output-last-message" in argv
    protocol = result["provenance"]["argv"]
    assert protocol[8:14] == ["-c", "project_doc_max_bytes=0", "-c", "features.shell_tool=false", "-c", 'web_search="disabled"']
    assert captured["process"].stdin.getvalue() == request.prompt.encode("utf-8")
    assert not request.work_root.exists(), "the private work root must be removed after every call"


@pytest.mark.parametrize("payload", [
    {**GOOD, "same_person": True},
    {**GOOD, "gloss": float("inf")},
    {**GOOD, "extra": 1},
    {key: value for key, value in GOOD.items() if key != "notes"},
])
def test_schema_or_type_failure_is_diagnostic_unavailable(tmp_path, payload):
    result = backend.run_codex_judge(_request(tmp_path), popen=_fake_popen(payload))
    assert result["payload"] is None
    assert result["unavailable"] == "codex response does not satisfy the fixed judge payload schema"


def test_nonzero_missing_and_oversized_outputs_fail_closed(tmp_path):
    assert backend.run_codex_judge(_request(tmp_path), popen=_fake_popen(returncode=7))["unavailable"] == "codex CLI exited nonzero"
    assert backend.run_codex_judge(_request(tmp_path), popen=_fake_popen(None))["unavailable"] == "codex response is missing, unsafe, or exceeds the fixed bound"
    def giant(out: Path) -> None: out.write_bytes(b"x" * (backend.MAX_RESPONSE_BYTES + 1))
    def launch(argv, **kwargs): return FakeProcess(argv, **kwargs, fake_writer=giant)
    assert backend.run_codex_judge(_request(tmp_path), popen=launch)["unavailable"] == "codex response is missing, unsafe, or exceeds the fixed bound"


def test_request_type_timeout_and_cache_version_binding_fail_closed(tmp_path):
    request = _request(tmp_path)
    request = backend.CodexJudgeRequest(**{**request.__dict__, "timeout_seconds": True})
    assert backend.run_codex_judge(request, popen=_fake_popen())["unavailable"] == "local validation failed: CodexJudgeError"
    request = backend.CodexJudgeRequest(**{**request.__dict__, "timeout_seconds": float("nan")})
    assert backend.run_codex_judge(request, popen=_fake_popen())["unavailable"] == "local validation failed: CodexJudgeError"
    request = _request(tmp_path)
    malformed = backend.CodexJudgeRequest(**{**request.__dict__, "prompt": 7})
    assert backend.run_codex_judge(malformed, popen=_fake_popen())["unavailable"] == "local validation failed: CodexJudgeError"
    malformed = backend.CodexJudgeRequest(**{**request.__dict__, "requested_model": 7})
    assert backend.run_codex_judge(malformed, popen=_fake_popen())["unavailable"] == "local validation failed: CodexJudgeError"
    malformed = backend.CodexJudgeRequest(**{**request.__dict__, "references": "not-a-list"})
    assert backend.run_codex_judge(malformed, popen=_fake_popen())["unavailable"] == "local validation failed: CodexJudgeError"
    first = backend.run_codex_judge(request, popen=_fake_popen())
    versioned = backend.CodexJudgeRequest(**{**request.__dict__, "prompt_version": "codex-v2", "work_root": tmp_path / "fresh-v2"})
    second = backend.run_codex_judge(versioned, popen=_fake_popen())
    assert first["provenance"]["cache_key"] != second["provenance"]["cache_key"]


def test_existing_work_root_and_cleanup_failure_are_unavailable(tmp_path, monkeypatch):
    request = _request(tmp_path); request.work_root.mkdir()
    assert backend.run_codex_judge(request, popen=_fake_popen())["unavailable"] == "local validation failed: CodexJudgeError"
    request.work_root.rmdir()
    request = _request(tmp_path)
    monkeypatch.setattr(backend.shutil, "rmtree", lambda _path: (_ for _ in ()).throw(OSError("locked")))
    assert backend.run_codex_judge(request, popen=_fake_popen())["unavailable"] == "fresh work-root cleanup failed"


def test_quick_exit_stream_overflow_is_checked_after_reader_drain(tmp_path):
    class OverflowProcess:
        def __init__(self, argv, **kwargs):
            self.stdin = _Sink()
            self.stdout = BytesIO(b"x" * (backend.MAX_STDOUT_BYTES + 1))
            self.stderr = BytesIO()
            self.returncode = 0
        def poll(self): return self.returncode
        def wait(self, timeout=None): return self.returncode
        def kill(self): self.returncode = -9
    root = tmp_path / "overflow-root"; root.mkdir()
    _code, _out, _err, terminal = backend._run_bounded(
        ["fake"], b"", cwd=root, timeout=1.0, popen=lambda argv, **kwargs: OverflowProcess(argv, **kwargs))
    assert terminal == "cli stream exceeded fixed output bounds"


@pytest.mark.skipif(os.name != "nt", reason="Windows owned-job behaviour")
def test_timeout_with_nonreading_child_is_bounded(tmp_path):
    helper = tmp_path / "nonreader.py"
    helper.write_text("import time; time.sleep(60)\n", encoding="utf-8")
    root = tmp_path / "timeout-root"; root.mkdir()
    started = time.monotonic()
    _code, _out, _err, terminal = backend._run_bounded(
        [sys.executable, str(helper)], b"x" * backend.MAX_PROMPT_BYTES, cwd=root, timeout=0.15)
    assert terminal == "codex process exceeded timeout and its owned process tree was terminated"
    assert time.monotonic() - started < 5


@pytest.mark.skipif(os.name != "nt", reason="Windows owned-job behaviour")
def test_job_assign_failure_terminates_blocked_supervisor(tmp_path, monkeypatch):
    seen = []
    original_terminate = backend._terminate_owned_tree
    def capture_terminate(process, job):
        seen.append(process)
        original_terminate(process, job)
    class FailingAssign:
        assigned = False
        def __init__(self): pass
        def assign(self, _process): raise backend.CodexJudgeError("test assignment failure")
        def close(self): pass
    monkeypatch.setattr(backend, "_terminate_owned_tree", capture_terminate)
    monkeypatch.setattr(backend, "_WindowsJob", FailingAssign)
    root = tmp_path / "assign-root"; root.mkdir()
    with pytest.raises(backend.CodexJudgeError, match="assignment failure"):
        backend._run_bounded([sys.executable, "-c", "pass"], b"", cwd=root, timeout=1.0)
    assert len(seen) == 1 and seen[0].poll() is not None


@pytest.mark.skipif(os.name != "nt", reason="Windows taskkill /T is the owned-process-tree implementation")
def test_wrapper_exit_terminates_owned_child_tree(tmp_path):
    child_file = tmp_path / "child-pid.txt"
    helper = tmp_path / "wrapper.py"
    helper.write_text(
        "import subprocess,sys,time\n"
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])\n"
        f"open(r'{child_file}','w').write(str(child.pid))\n"
        "raise SystemExit(0)\n", encoding="utf-8")
    root = tmp_path / "owned"
    root.mkdir()
    returncode, _out, _err, terminal = backend._run_bounded(
        [sys.executable, str(helper)], b"", cwd=root, timeout=1.0)
    assert terminal is None and returncode == 0 and child_file.is_file()
    child_pid = int(child_file.read_text(encoding="utf-8"))
    time.sleep(0.1)
    with pytest.raises(OSError):
        os.kill(child_pid, 0)

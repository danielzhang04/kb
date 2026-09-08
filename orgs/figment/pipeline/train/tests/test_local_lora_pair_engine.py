from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import time
from pathlib import Path

import pytest


HERE = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_file_location("pair_engine_test", HERE / "local_lora_pair_engine.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


engine = load()


class EngineError(RuntimeError):
    pass


def safe(path: Path, root: Path, _label: str) -> Path:
    assert path.is_relative_to(root)
    assert path.exists()
    return path


def reparse(_path: Path) -> bool:
    return False


def file_hash(path: Path, maximum: int | None, allow_empty: bool = False):
    data = path.read_bytes()
    if maximum is not None and len(data) > maximum:
        raise EngineError("too large")
    return hashlib.sha256(data).hexdigest(), len(data)


def test_pumper_reports_late_reader_error(tmp_path):
    class BrokenStream:
        def read(self, _size):
            raise OSError("reader failed")

    log = tmp_path / "stderr.log"
    log.open("xb").close()
    pumper = engine.Pumper(BrokenStream(), log, maximum=16, error=EngineError)
    pumper.start()
    with pytest.raises(EngineError, match="incomplete"):
        pumper.finish()
    assert isinstance(pumper.error, OSError)


def test_inventory_and_copy_preserve_closed_bounds(tmp_path):
    output = tmp_path / "output"
    loras = output / "loras"
    loras.mkdir(parents=True)
    png = output / "row.png"
    png.write_bytes(b"png")
    engine.runtime_output_bound(output, None, maximum_entries=2, maximum_png=8, root=tmp_path, safe_existing=safe, reparse=reparse, error=EngineError)
    (output / "extra.txt").write_text("x")
    with pytest.raises(EngineError, match="unsafe file"):
        engine.runtime_output_bound(output, None, maximum_entries=3, maximum_png=8, root=tmp_path, safe_existing=safe, reparse=reparse, error=EngineError)

    source = tmp_path / "source.safetensors"
    payload = b"1234"
    source.write_bytes(payload)
    target = loras / "adapter.safetensors"
    engine.copy_stream(source, target, hashlib.sha256(payload).hexdigest(), maximum=4, source_root=tmp_path, safe_existing=safe, reparse=reparse, file_hash=file_hash, error=EngineError)
    assert target.read_bytes() == payload
    oversized = tmp_path / "oversized.safetensors"
    oversized.write_bytes(b"12345")
    with pytest.raises(EngineError, match="boundary is unsafe"):
        engine.copy_stream(oversized, loras / "too-large.safetensors", hashlib.sha256(b"12345").hexdigest(), maximum=4, source_root=tmp_path, safe_existing=safe, reparse=reparse, file_hash=file_hash, error=EngineError)


# --- end-to-end fakes: realistic process / helper / observer, no real Comfy, GPU, or API ---


class Stream:
    def __init__(self, close_error=None):
        self.done = False
        self.closed = False
        self.close_error = close_error

    def read(self, _count):
        if self.done:
            return b""
        self.done = True
        return b"journal"

    def close(self):
        if self.close_error is not None:
            raise self.close_error
        self.closed = True


class Process:
    def __init__(self):
        self.pid = 77
        self.stderr = Stream()
        self.terminated = False

    def terminate(self):
        self.terminated = True

    def wait(self, timeout=None):
        return 0


class Identity:
    def __init__(self, pid):
        self.pid = pid

    def __repr__(self):
        return f"Identity({self.pid})"


class Helper:
    PORT = 8190
    COMFY_PYTHON = Path("python")
    COMFY_ROOT = Path.cwd()

    def __init__(self):
        self.posts = 0
        self.wait_calls = []
        self.teardown_calls = []
        self.child = Identity(78)

    def _port_available(self):
        pass

    def _isolated_environment(self, _root):
        return {}

    def _process_identity(self, pid):
        return Identity(pid)

    def _wait_for_owned_listener(self, wrapper, deadline, tracked=None, on_discovery=None):
        # Mirrors the immutable helper: mutate the supplied dict first, then notify, on every iteration.
        self.wait_calls.append((wrapper, deadline, tracked, on_discovery))
        tracked = {} if tracked is None else tracked
        for _ in range(2):
            tracked[self.child.pid] = self.child
            if on_discovery is not None:
                on_discovery(tracked)
        return tracked

    def _loopback_opener(self):
        return object()

    def _require_owned_listener(self, _wrapper, tracked):
        return tracked

    def _local_json(self, _opener, method, endpoint, payload=None):
        if method == "POST":
            self.posts += 1
            return {"prompt_id": f"prompt{self.posts}"}
        return {"history": endpoint}

    def _completed_output(self, _history, prompt_id, output):
        content = prompt_id.encode()
        (output / f"{prompt_id}.png").write_bytes(content)
        return {"filename": f"{prompt_id}.png", "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}

    def _teardown(self, wrapper, tracked, process):
        self.teardown_calls.append((wrapper, dict(tracked), process))
        return {"verified_stopped": True}


class Observer:
    """Read-only fake: records every call, never sees a process, raises when `breach` says so."""

    def __init__(self, breach=None, finish_error=None, record_value=None):
        self.breach, self.finish_error, self.record_value = breach, finish_error, record_value
        self.started_with = None
        self.updates = []
        self.checks = 0
        self.finished = False

    def start(self, wrapper):
        assert not hasattr(wrapper, "terminate") and not hasattr(wrapper, "stderr"), "observer must never receive the Popen"
        self.started_with = wrapper

    def update_owned(self, owned):
        assert isinstance(owned, dict)
        self.updates.append(owned)
        owned["injected"] = "copy-only"

    def check(self):
        self.checks += 1
        if self.breach is not None and self.breach(self):
            raise EngineError("resource breach: sampler exceeded reserve")

    def finish(self):
        self.finished = True
        if self.finish_error is not None:
            raise self.finish_error

    def record(self):
        if isinstance(self.record_value, BaseException):
            raise self.record_value
        return {"samples": len(self.updates), "checks": self.checks} if self.record_value is None else self.record_value


def evidence():
    return {"stage": "base", "checkpoint": None, "rows": [{"id": "base-seed-1", "seed": 1, "graph": {"seed": 1}}, {"id": "base-seed-2", "seed": 2, "graph": {"seed": 2}}]}


FIXED_COMMAND_TAIL = ["--disable-api-nodes", "--disable-all-custom-nodes", "--disable-auto-launch"]
DEFAULT_RECEIPT_KEYS = {"schema", "status", "not_promotable", "stage", "inputs", "rows", "lora_application", "teardown", "stderr_sha256", "deadline_seconds"}


def run(tmp_path, monkeypatch, helper=None, process=None, **extension):
    helper = Helper() if helper is None else helper
    process = Process() if process is None else process
    launches = []
    monkeypatch.setattr(engine.subprocess, "Popen", lambda command, **kwargs: launches.append((command, kwargs)) or process)
    (tmp_path / "studio").mkdir(exist_ok=True)
    root = tmp_path / "run"

    def call():
        return engine.execute_pair(evidence(), helper, root=root, main_private=tmp_path, studio_private=tmp_path / "studio", source=None, verify_staged=lambda _p: {}, verify_before_success=lambda: None, receipt_inputs=lambda e: {"stage": e["stage"]}, sha=lambda raw: hashlib.sha256(raw).hexdigest(), safe_existing=safe, reparse=reparse, file_hash=file_hash, error=EngineError, pumper_factory=lambda stream, path: engine.Pumper(stream, path, maximum=64, error=EngineError), schema="test-pair-v1", maximum_lora=16, maximum_stderr=64, maximum_png=64, maximum_output_entries=4, deadline_seconds=5.0, **extension)

    return call, helper, process, launches, root


def test_default_command_receipt_and_wait_arity_unchanged(tmp_path, monkeypatch):
    call, helper, process, launches, root = run(tmp_path, monkeypatch)
    result = call()
    (command, kwargs), = launches
    assert command == ["python", "-X", "utf8", "main.py", "--listen", "127.0.0.1", "--port", "8190", "--output-directory", str(root / "output"), "--temp-directory", str(root / "temp"), "--user-directory", str(root / "user"), *FIXED_COMMAND_TAIL]
    assert kwargs["shell"] is False and kwargs["stderr"] is engine.subprocess.PIPE
    wrapper, deadline, tracked, on_discovery = helper.wait_calls[0]
    assert wrapper.pid == 77 and on_discovery is None and tracked == {77: wrapper, 78: helper.child}
    assert set(result) == DEFAULT_RECEIPT_KEYS and "resource_observer" not in result
    assert result == json.loads((root / "receipt.json").read_text())
    assert [row["prompt_id"] for row in result["rows"]] == ["prompt1", "prompt2"] and helper.posts == 2
    assert helper.teardown_calls[0][1] == {77: wrapper, 78: helper.child} and helper.teardown_calls[0][2] is process
    assert result["lora_application"] == {"header_unet_keys": 0, "comfy_missing_lora_key_warnings": 0}
    assert process.stderr.closed is True and result["stderr_sha256"] == hashlib.sha256(b"journal").hexdigest()


def test_stderr_closed_on_failure_and_close_error_is_failure(tmp_path, monkeypatch):
    observer = Observer(breach=lambda me: any(78 in u for u in me.updates))
    call, helper, process, launches, root = run(tmp_path, monkeypatch, observer=observer)
    with pytest.raises(EngineError, match="resource breach"):
        call()
    assert process.stderr.closed is True and (root / "failure.json").exists()

    second = tmp_path / "second"
    second.mkdir()
    broken = Process()
    broken.stderr = Stream(close_error=OSError("pipe close failed"))
    call, helper, process, launches, root = run(second, monkeypatch, process=broken)
    with pytest.raises(OSError, match="pipe close failed"):
        call()
    failure = json.loads((root / "failure.json").read_text())
    assert failure["failure_class"] == "OSError" and helper.posts == 2 and not (root / "receipt.json").exists()


def test_observer_check_after_finish_catches_late_breach(tmp_path, monkeypatch):
    observer = Observer(breach=lambda me: me.finished)
    call, helper, process, launches, root = run(tmp_path, monkeypatch, observer=observer)
    with pytest.raises(EngineError, match="resource breach"):
        call()
    assert helper.posts == 2 and len(helper.teardown_calls) == 1 and not (root / "receipt.json").exists()
    assert json.loads((root / "failure.json").read_text())["failure_message"].startswith("resource breach")


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_deadline_expiry_during_environment_prevents_popen(tmp_path, monkeypatch):
    clock = Clock()
    monkeypatch.setattr(engine.time, "monotonic", clock)
    helper = Helper()

    def env(_root):
        clock.now += 10.0
        return {}

    helper._isolated_environment = env
    call, helper, process, launches, root = run(tmp_path, monkeypatch, helper=helper)
    with pytest.raises(EngineError, match="before launch"):
        call()
    assert launches == [] and helper.posts == 0 and helper.teardown_calls == []
    assert json.loads((root / "failure.json").read_text())["status"] == "failed"


def test_deadline_expiry_during_require_owned_listener_prevents_post(tmp_path, monkeypatch):
    clock = Clock()
    monkeypatch.setattr(engine.time, "monotonic", clock)
    helper = Helper()

    def require(_wrapper, tracked):
        clock.now += 10.0
        return tracked

    helper._require_owned_listener = require
    call, helper, process, launches, root = run(tmp_path, monkeypatch, helper=helper)
    with pytest.raises(EngineError, match="before dispatch"):
        call()
    assert len(launches) == 1 and helper.posts == 0 and len(helper.teardown_calls) == 1
    assert json.loads((root / "failure.json").read_text())["rows"] == []


def test_post_return_past_row_deadline_fails_without_extending_deadline(tmp_path, monkeypatch):
    clock = Clock()
    monkeypatch.setattr(engine.time, "monotonic", clock)
    helper = Helper()
    original = helper._local_json

    def slow_post(opener, method, endpoint, payload=None):
        if method == "POST":
            clock.now += 1.0
        return original(opener, method, endpoint, payload)

    helper._local_json = slow_post
    call, helper, process, launches, root = run(tmp_path, monkeypatch, helper=helper, row_seconds=0.5)
    with pytest.raises(EngineError, match="dispatch exceeded its row deadline"):
        call()
    assert helper.posts == 1 and json.loads((root / "failure.json").read_text())["rows"] == []


def test_final_stderr_hash_failure_records_failure_json(tmp_path, monkeypatch):
    def hasher(path, maximum, allow_empty=False):
        if path.name == "stderr.log":
            raise OSError("hash failed")
        return file_hash(path, maximum, allow_empty=allow_empty)

    call, helper, process, launches, root = run(tmp_path, monkeypatch)
    monkeypatch.setattr(engine.subprocess, "Popen", lambda command, **kwargs: process)
    (tmp_path / "studio").mkdir(exist_ok=True)
    with pytest.raises(OSError, match="hash failed"):
        engine.execute_pair(evidence(), helper, root=root, main_private=tmp_path, studio_private=tmp_path / "studio", source=None, verify_staged=lambda _p: {}, verify_before_success=lambda: None, receipt_inputs=lambda e: {"stage": e["stage"]}, sha=lambda raw: hashlib.sha256(raw).hexdigest(), safe_existing=safe, reparse=reparse, file_hash=hasher, error=EngineError, pumper_factory=lambda stream, path: engine.Pumper(stream, path, maximum=64, error=EngineError), schema="test-pair-v1", maximum_lora=16, maximum_stderr=64, maximum_png=64, maximum_output_entries=4, deadline_seconds=5.0)
    failure = json.loads((root / "failure.json").read_text())
    assert failure["failure_class"] == "OSError" and len(failure["rows"]) == 2 and not (root / "receipt.json").exists()


def test_observer_summary_requires_finite_dict_and_byte_bound():
    class Rec:
        def __init__(self, value):
            self.value = value

        def record(self):
            return self.value

    assert engine.observer_summary(Rec({"a": 1}), True) == ({"a": 1}, None)
    summary, err = engine.observer_summary(Rec({"a": math.nan}), True)
    assert isinstance(err, ValueError) and summary["status"] == "unavailable"
    summary, err = engine.observer_summary(Rec(["not", "dict"]), True)
    assert isinstance(err, TypeError)
    assert engine.MAX_OBSERVER_RECORD == 8 * 1024 * 1024
    summary, err = engine.observer_summary(Rec({"b": "é" * (engine.MAX_OBSERVER_RECORD // 2)}), True)
    assert isinstance(err, ValueError)  # bound is on encoded bytes, not characters


def test_extension_arguments_prepare_decoder_and_observer_are_wired(tmp_path, monkeypatch):
    order = []
    observer = Observer()

    def prepare(root):
        assert (root / "output" / "loras").is_dir() and order == []
        (root / "models").mkdir()
        order.append("prepare")

    def decode(history, prompt_id, output):
        assert history == {"history": f"/history/{prompt_id}"}
        order.append(f"decode-{prompt_id}")
        content = f"custom-{prompt_id}".encode()
        (output / f"{prompt_id}.png").write_bytes(content)
        return {"filename": f"{prompt_id}.png", "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}

    call, helper, process, launches, root = run(tmp_path, monkeypatch, extra_arguments=("--models-directory", "m", "--reserve-vram", "2.5"), prepare_root=prepare, completed_output=decode, observer=observer, readiness_seconds=1.0, row_seconds=2.0)
    monkeypatch.setattr(engine.subprocess, "Popen", lambda command, **kwargs: order.append("launch") or launches.append((command, kwargs)) or process)
    started = time.monotonic()
    result = call()
    assert order == ["prepare", "launch", "decode-prompt1", "decode-prompt2"]
    assert launches[0][0][-7:] == [*FIXED_COMMAND_TAIL, "--models-directory", "m", "--reserve-vram", "2.5"]
    wrapper, readiness_deadline, tracked, on_discovery = helper.wait_calls[0]
    assert on_discovery is not None and readiness_deadline <= started + 1.0 + 0.5
    assert observer.started_with is wrapper and observer.updates and all(u[77] is wrapper for u in observer.updates)
    assert "injected" not in helper.teardown_calls[0][1] and helper.teardown_calls[0][1] == {77: wrapper, 78: helper.child}
    assert observer.finished is True and result["resource_observer"] == {"samples": len(observer.updates), "checks": observer.checks}
    assert set(result) == DEFAULT_RECEIPT_KEYS | {"resource_observer"} and result == json.loads((root / "receipt.json").read_text())
    assert (root / "models").is_dir() and result["rows"][0]["output"]["bytes"] == len(b"custom-prompt1")


@pytest.mark.parametrize("extension", [
    {"extra_arguments": ("--foo", "x")},
    {"extra_arguments": ("--port", "1")},
    {"extra_arguments": ("--input-directory",)},
    {"extra_arguments": ("--input-directory", "--models-directory")},
    {"extra_arguments": ("--input-directory", "")},
    {"extra_arguments": ("--input-directory", "a", "--input-directory", "b")},
    {"extra_arguments": ("--input-directory=a",)},
    {"extra_arguments": ["--input-directory", "a"]},
    {"readiness_seconds": True},
    {"readiness_seconds": 0},
    {"row_seconds": -1.0},
    {"row_seconds": math.inf},
    {"row_seconds": math.nan},
    {"row_seconds": "5"},
    {"prepare_root": "not-callable"},
])
def test_unsafe_extension_inputs_rejected_before_root_and_launch(tmp_path, monkeypatch, extension):
    call, helper, process, launches, root = run(tmp_path, monkeypatch, **extension)
    with pytest.raises(EngineError):
        call()
    assert not root.exists() and launches == [] and helper.posts == 0


def test_prepare_root_failure_records_failure_without_launch(tmp_path, monkeypatch):
    def prepare(_root):
        raise EngineError("staging refused")

    call, helper, process, launches, root = run(tmp_path, monkeypatch, prepare_root=prepare, observer=Observer())
    with pytest.raises(EngineError, match="staging refused"):
        call()
    failure = json.loads((root / "failure.json").read_text())
    assert launches == [] and helper.posts == 0 and helper.teardown_calls == []
    assert failure["failure_class"] == "EngineError" and failure["resource_observer"] == {"status": "unavailable", "reason": "not-started"}
    assert not (root / "receipt.json").exists()


def test_observer_breach_during_readiness_retains_discovered_child_for_teardown(tmp_path, monkeypatch):
    observer = Observer(breach=lambda me: any(78 in u for u in me.updates))
    call, helper, process, launches, root = run(tmp_path, monkeypatch, observer=observer)
    with pytest.raises(EngineError, match="resource breach"):
        call()
    assert helper.posts == 0 and observer.finished is True
    (wrapper, tracked, seen_process), = helper.teardown_calls
    assert seen_process is process and set(tracked) == {77, 78} and tracked[78] is helper.child
    failure = json.loads((root / "failure.json").read_text())
    assert failure["rows"] == [] and failure["resource_observer"]["samples"] >= 1 and failure["teardown"] == {"verified_stopped": True}


def test_observer_breach_after_first_row_prevents_second_dispatch(tmp_path, monkeypatch):
    root_holder = {}
    observer = Observer(breach=lambda _me: (root_holder["root"] / "output" / "prompt1.png").exists())
    call, helper, process, launches, root = run(tmp_path, monkeypatch, observer=observer)
    root_holder["root"] = root
    with pytest.raises(EngineError, match="resource breach"):
        call()
    assert helper.posts == 1 and (root / "output" / "prompt1.png").exists()
    failure = json.loads((root / "failure.json").read_text())
    assert failure["status"] == "failed" and failure["rows"] == [] and failure["failure_message"].startswith("resource breach")
    assert failure["resource_observer"]["checks"] == observer.checks and failure["stderr_complete"] is True
    assert len(helper.teardown_calls) == 1


def test_late_output_past_row_deadline_fails_even_when_png_returned(tmp_path, monkeypatch):
    helper = Helper()
    original = helper._completed_output

    def slow(history, prompt_id, output):
        time.sleep(0.15)
        return original(history, prompt_id, output)

    helper._completed_output = slow
    call, helper, process, launches, root = run(tmp_path, monkeypatch, helper=helper, row_seconds=0.05)
    with pytest.raises(EngineError, match="row deadline"):
        call()
    assert helper.posts == 1 and (root / "output" / "prompt1.png").exists()
    failure = json.loads((root / "failure.json").read_text())
    assert failure["rows"] == [] and "resource_observer" not in failure and len(helper.teardown_calls) == 1


def test_observer_finish_error_fails_run_after_successful_rows(tmp_path, monkeypatch):
    observer = Observer(finish_error=EngineError("observer thread did not stop"))
    call, helper, process, launches, root = run(tmp_path, monkeypatch, observer=observer)
    with pytest.raises(EngineError, match="did not stop"):
        call()
    assert helper.posts == 2 and len(helper.teardown_calls) == 1 and not (root / "receipt.json").exists()
    failure = json.loads((root / "failure.json").read_text())
    assert failure["failure_class"] == "EngineError" and len(failure["rows"]) == 2 and failure["resource_observer"]["samples"] >= 1


def test_observer_record_error_never_becomes_success(tmp_path, monkeypatch):
    observer = Observer(record_value=RuntimeError("summary unavailable"))
    call, helper, process, launches, root = run(tmp_path, monkeypatch, observer=observer)
    with pytest.raises(RuntimeError, match="summary unavailable"):
        call()
    failure = json.loads((root / "failure.json").read_text())
    assert failure["resource_observer"] == {"status": "unavailable", "error_class": "RuntimeError"} and not (root / "receipt.json").exists()

    oversized = Observer(record_value={"blob": "x" * (engine.MAX_OBSERVER_RECORD + 1)})
    second = tmp_path / "second"
    second.mkdir()
    call, helper, process, launches, root = run(second, monkeypatch, observer=oversized)
    with pytest.raises(ValueError, match="exceeds its bound"):
        call()
    assert json.loads((root / "failure.json").read_text())["resource_observer"] == {"status": "unavailable", "error_class": "ValueError"}

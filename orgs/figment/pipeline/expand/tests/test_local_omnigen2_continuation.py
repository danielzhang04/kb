"""Continuation wrapper tests: pure state machine via injected deps; no GPU, PowerShell, or weights."""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import threading
import types
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PATH = HERE.parent / "local_omnigen2_continuation.py"


def _import() -> types.ModuleType:
    name = "figment_test_continuation"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c = _import()


class FakeResourceError(RuntimeError):
    pass


class Harness:
    """Scripted deps. floors: list of bools consumed per sample (True = pass)."""

    def __init__(self, floors, *, healthy=True, admission_present=False, execute=None, guard_fail_at=None, evidence_fail=False):
        self.floors = list(floors)
        self.healthy = healthy if isinstance(healthy, list) else [healthy] * 10_000
        self.present = admission_present
        self.clock = 0.0
        self.journal: list[dict] = []
        self.emitted: list[str] = []
        self.written: list[bytes] = []
        self.executions = 0
        self.guard_calls = 0
        self.guard_fail_at = guard_fail_at
        self.evidence_fail = evidence_fail
        self.evidence_calls = 0
        self._execute = execute or self._receipt

    @staticmethod
    def _receipt():
        return {"schema": "figment/local-omnigen2-runtime@1", "status": "complete", "not_promotable": True, "rows": [{"seed": 481516234, "output": {"sha256": "a" * 64, "dimensions": [768, 768]}}, {"seed": 90210, "output": {"sha256": "b" * 64, "dimensions": [768, 768]}}], "teardown": {"verified_stopped": True}}

    def guard(self):
        self.guard_calls += 1
        if self.guard_fail_at is not None and self.guard_calls >= self.guard_fail_at:
            raise c.ContinuationError("owner ceased")

    def sample(self):
        return {"available_ram_bytes": 1}

    def preflight(self, sample, disk):
        if not self.floors:
            raise FakeResourceError("script exhausted")
        if self.floors.pop(0):
            return {"ok": True}
        raise FakeResourceError("below floor")

    def heartbeat(self):
        return {"healthy": self.healthy.pop(0)}

    def build_evidence(self):
        self.evidence_calls += 1
        if self.evidence_fail:
            raise ValueError("model hash mismatch")
        return {"schema": "figment/local-omnigen2-evidence@1", "code": {"orgs/figment/pipeline/expand/local_omnigen2_runtime.py": {"sha256": c.RUNTIME_SHA256}}}

    def make_admission(self, evidence):
        return {"id": "adm", "evidence": evidence}

    def write_admission(self, data, review):
        if self.present:
            raise FileExistsError("admission exists")
        self.written.append(data)
        self.present = True

    def execute(self):
        self.executions += 1
        receipt = self._execute()
        import json
        return receipt, json.dumps(receipt, sort_keys=True, allow_nan=False).encode()

    def deps(self):
        import json
        return c.Deps(monotonic=lambda: self.clock, sleep=self._sleep, guard=self.guard, sample=self.sample, disk_free=lambda: 10**12, preflight=self.preflight, resource_error=FakeResourceError, heartbeat=self.heartbeat, admission_present=lambda: self.present, build_evidence=self.build_evidence, make_admission=self.make_admission, canonical=lambda v: json.dumps(v, sort_keys=True).encode(), write_admission=self.write_admission, execute=self.execute, journal=self.journal.append, emit=self.emitted.append)

    def _sleep(self, seconds):
        self.clock += seconds

    def run(self, **limits):
        return c.Wrapper(self.deps(), c.Limits(**limits)).run()


def test_default_cli_is_static_and_pinned(capsys):
    assert c.main([]) == 0
    out = capsys.readouterr().out
    assert '"executing": false' in out and c.RUNTIME_SHA256 in out


def test_no_gpu_before_three_stable_floors_then_exactly_one_execute():
    h = Harness([True, False, True, True, True] + [True] * 3)
    result = h.run()
    assert result["status"] == c.STATUS_GENERATED
    assert h.executions == 1 and len(h.written) == 1 and h.evidence_calls == 1
    assert result["qualitative_review_pending"] is True and result["quality_accepted"] is False and result["not_promotable"] is True
    assert len(result["receipt_canonical_sha256"]) == 64 and len(result["receipt_raw_sha256"]) == 64
    assert [r["seed"] for r in result["rows"]] == list(c.SEEDS)
    # raw sample journaled before floors, including failing ones
    assert sum(1 for r in h.journal if r.get("phase") == "wait") == 5
    assert any(r["preflight"].get("ok") is False for r in h.journal if r.get("phase") == "wait")


def test_unhealthy_keepawake_does_not_count_as_ready():
    h = Harness([True] * 6 + [True] * 3, healthy=[False, False, False, True, True, True] + [True] * 3)
    result = h.run()
    assert result["status"] == c.STATUS_GENERATED and result["samples"] == 6


def test_keepawake_heartbeats_even_below_floor():
    h = Harness([False, False, False, True, True, True] + [True] * 3)
    result = h.run()
    assert result["status"] == c.STATUS_GENERATED
    heartbeat_rows = [r for r in h.journal if r.get("phase") == "heartbeat"]
    assert len(heartbeat_rows) == 6


def test_max_samples_ends_wait_without_admission():
    h = Harness([False] * 50)
    result = h.run(max_samples=5)
    assert result["status"] == c.STATUS_NOT_ADMITTED and result["samples"] == 5
    assert h.executions == 0 and h.evidence_calls == 0 and not h.written


def test_wait_deadline_is_monotonic_and_terminal():
    h = Harness([False] * 50)
    result = h.run(wait_seconds=150.0, interval_seconds=60.0)
    assert result["status"] == c.STATUS_NOT_ADMITTED and result["samples"] == 3 and h.executions == 0


def test_deadline_is_not_reset_after_slow_evidence():
    h = Harness([True] * 20)
    original = h.build_evidence
    def slow_evidence():
        value = original()
        h.clock += 10.0
        return value
    h.build_evidence = slow_evidence
    result = h.run(wait_seconds=5.0, interval_seconds=1.0)
    assert result["status"] == c.STATUS_FAILED and "after evidence" in result["errors"][0]["message"]
    assert h.executions == 0 and not h.written


def test_floor_falls_after_evidence_returns_to_waiting_and_caps_attempts():
    # three ready passes, then floor fails during preparation, x3
    script = ([True] * 3 + [False]) * 3
    h = Harness(script)
    result = h.run()
    assert result["status"] == c.STATUS_NOT_ADMITTED
    assert h.evidence_calls == 3 and len(result["attempts"]) == 3 and not h.written and h.executions == 0


def test_evidence_failure_is_terminal_not_waiting():
    h = Harness([True] * 10, evidence_fail=True)
    result = h.run()
    assert result["status"] == c.STATUS_FAILED and result["errors"][0]["class"] == "ValueError"
    assert h.executions == 0 and h.evidence_calls == 1


def test_existing_admission_refused():
    h = Harness([True] * 10, admission_present=True)
    result = h.run()
    assert result["status"] == c.STATUS_FAILED and "already exists" in result["errors"][0]["message"]
    assert h.executions == 0


def test_owner_or_stop_failure_before_sample_is_terminal():
    h = Harness([True] * 10, guard_fail_at=2)
    result = h.run()
    assert result["status"] == c.STATUS_FAILED and "owner ceased" in result["errors"][0]["message"]
    assert h.executions == 0 and result["samples"] == 2


def test_runtime_failure_is_terminal_without_second_attempt():
    def boom():
        raise RuntimeError("engine failed")
    h = Harness([True] * 20, execute=boom)
    result = h.run()
    assert result["status"] == c.STATUS_FAILED and result["execution_attempted"] is True and result["admitted"] is True
    assert h.executions == 1 and result["executions"] == 1


@pytest.mark.parametrize("receipt", [
    {"rows": [{"seed": 481516234, "output": {"sha256": "a" * 64}}], "teardown": {"verified_stopped": True}},
    {"rows": [{"seed": 481516234, "output": {"sha256": "a" * 64}}, {"seed": 90210, "output": {"sha256": "b" * 64}}], "teardown": {"verified_stopped": False}},
    {"rows": [{"seed": 481516234, "output": {"sha256": "zz"}}, {"seed": 90210, "output": {"sha256": "b" * 64}}], "teardown": {"verified_stopped": True}},
    "not a dict",
])
def test_success_requires_real_shaped_receipt(receipt):
    h = Harness([True] * 20, execute=lambda: receipt)
    result = h.run()
    assert result["status"] == c.STATUS_FAILED and h.executions == 1


def test_receipt_requires_complete_runtime_status_and_768_dimensions():
    receipt = Harness._receipt()
    receipt["status"] = "generated"
    h = Harness([True] * 20, execute=lambda: receipt)
    assert h.run()["status"] == c.STATUS_FAILED
    receipt = Harness._receipt()
    receipt["rows"][0]["output"]["dimensions"] = [1024, 1024]
    h = Harness([True] * 20, execute=lambda: receipt)
    assert h.run()["status"] == c.STATUS_FAILED


def test_guarded_sampler_routes_failure_to_resource_error():
    class G:
        def __init__(self, fail):
            self.fail = fail
        def owner_stop(self):
            if self.fail:
                raise c.ContinuationError("STOP present")
    seen = []
    sampler = c.GuardedSampler(lambda owned: seen.append(owned) or {"ok": 1}, G(False), FakeResourceError)
    assert sampler({}) == {"ok": 1} and seen == [{}]
    with pytest.raises(FakeResourceError):
        c.GuardedSampler(lambda owned: {"ok": 1}, G(True), FakeResourceError)({})
    with pytest.raises(FakeResourceError):
        c.GuardedSampler(lambda owned: {"ok": 1}, G(False), FakeResourceError, lambda: RuntimeError("heartbeat failed"))({})


def test_execution_heartbeat_failure_is_observable_and_stops_cleanly():
    called = threading.Event()
    worker = c.ExecutionHeartbeat(lambda _cancel: called.set() or {"healthy": False, "lease_healthy": True}, lambda: None, unarmed_grace_seconds=0.0)
    worker.start()
    assert called.wait(1.0)
    worker.close()
    assert isinstance(worker.failure, c.ContinuationError)


def test_execution_heartbeat_runs_full_guard_and_surfaces_source_or_activation_failure():
    called = threading.Event()
    def changed_guard():
        called.set()
        raise c.ContinuationError("wrapper source changed since activation")
    worker = c.ExecutionHeartbeat(lambda _cancel: {"healthy": True, "lease_healthy": True}, changed_guard)
    worker.start()
    assert called.wait(1.0)
    worker.close()
    assert "wrapper source changed" in str(worker.failure)


def _activation(**over):
    doc = {"schema": c.ACTIVATION_SCHEMA, "owner": {"pid": 4242, "creation_filetime": 133000000000000000, "parent_pid": None}, "source_sha256": "s" * 64, "keepawake_cli_sha256": "c" * 64, "keepawake_module_sha256": "m" * 64, "authorized_by": "codex-worker", "not_promotable": True}
    doc.update(over)
    return doc


def test_activation_accepts_exact_document():
    owner = c.validate_activation(_activation(), owner_pid=4242, source_sha256="s" * 64, cli_sha256="c" * 64, module_sha256="m" * 64)
    assert owner == {"pid": 4242, "creation_filetime": 133000000000000000}


def test_activation_owner_need_not_be_the_wrapper_pid():
    owner = c.validate_activation(_activation(), owner_pid=4242, source_sha256="s" * 64, cli_sha256="c" * 64, module_sha256="m" * 64)
    assert owner["pid"] != __import__("os").getpid()


@pytest.mark.parametrize("doc,kw", [
    ({**_activation(), "extra": 1}, {}),
    (_activation(owner={"pid": True, "creation_filetime": 1, "parent_pid": None}), {}),
    (_activation(owner={"pid": 4242, "creation_filetime": 1, "parent_pid": 7}), {}),
    (_activation(owner={"pid": 4242, "creation_filetime": 0, "parent_pid": None}), {}),
    (_activation(not_promotable=False), {}),
    (_activation(authorized_by="someone"), {}),
    (_activation(), {"owner_pid": 1}),
    (_activation(), {"source_sha256": "x" * 64}),
    (_activation(), {"cli_sha256": "x" * 64}),
    (_activation(), {"module_sha256": "x" * 64}),
    ([], {}),
])
def test_activation_malformed_fails_closed(doc, kw):
    args = {"owner_pid": 4242, "source_sha256": "s" * 64, "cli_sha256": "c" * 64, "module_sha256": "m" * 64, **kw}
    with pytest.raises(c.ContinuationError):
        c.validate_activation(doc, **args)


def test_parse_status_requires_armed_alive_supervisor_and_exact_root_lease():
    good = b"armed: True\nsupervisor: pid=12 alive=True\nleases: 1\n  codex-figment-async-20260908 mode=pid-only pid=4242 alive=True heartbeat=2026-09-08T00:00:00Z\n"
    assert c.parse_status(good, 4242)
    assert not c.parse_status(good, 999)
    assert not c.parse_status(b"armed: True\nsupervisor: pid=12 alive=True\nleases: 0\n", 4242)
    assert not c.parse_status(good.replace(b"pid-only", b"idle-expiry"), 4242)
    assert not c.parse_status(good.replace(b"alive=True heartbeat", b"alive=False heartbeat"), 4242)
    assert not c.parse_status(good.replace(b"armed: True", b"armed: False"), 4242)
    assert not c.parse_status(good.replace(b"supervisor: pid=12 alive=True", b"supervisor: none"), 4242)
    assert not c.parse_status(b"x" * (c.MAX_PS_OUTPUT_BYTES + 1), 4242)


def test_heartbeat_timeout_or_cancel_never_launches_a_second_powershell(monkeypatch, tmp_path):
    class Admission:
        def safe(self, *_args):
            return tmp_path
    launches = []
    class TimedOut:
        def __init__(self):
            self.killed = False
        def poll(self):
            return 0 if self.killed else None
        def kill(self):
            self.killed = True
        def wait(self, timeout):
            raise subprocess.TimeoutExpired("powershell", timeout)
    def popen(*_args, **_kwargs):
        launches.append(1)
        return TimedOut()
    clock = iter((0.0, 11.0))
    monkeypatch.setattr(c, "_hash", lambda *_args: "pinned")
    heartbeat = c.Heartbeat(Admission(), "pinned", "pinned", 4242, popen=popen, temp_dir=tmp_path, monotonic=lambda: next(clock))
    with pytest.raises(c.ContinuationError, match="owned-child-cleanup-unproven") as exc:
        heartbeat()
    assert "owned-popen-pid=" in str(exc.value)
    assert launches == [1]
    cancelled = threading.Event()
    cancelled.set()
    assert heartbeat(cancelled)["cancelled"] is True
    assert launches == [1]


def test_execution_heartbeat_cancel_with_stubborn_owned_child_remains_failure(monkeypatch, tmp_path):
    class Admission:
        def safe(self, *_args):
            return tmp_path
    started = threading.Event()
    class Stubborn:
        pid = 77
        def poll(self):
            started.set()
            return None
        def wait(self, timeout):
            raise subprocess.TimeoutExpired("powershell", timeout)
        def kill(self):
            raise OSError("cannot terminate")
    monkeypatch.setattr(c, "_hash", lambda *_args: "pinned")
    heartbeat = c.Heartbeat(Admission(), "pinned", "pinned", 4242, popen=lambda *_args, **_kwargs: Stubborn(), temp_dir=tmp_path)
    worker = c.ExecutionHeartbeat(heartbeat, lambda: None)
    worker.start()
    assert started.wait(1.0)
    worker.close()
    assert isinstance(worker.failure, c.ContinuationError)
    assert "owned-child-cleanup-unproven owned-popen-pid=77 kill-error" in str(worker.failure)


def test_heartbeat_uses_only_fixed_powershell_path(monkeypatch, tmp_path):
    class Admission:
        def safe(self, *_args):
            return tmp_path
    class Done:
        returncode = 0
        def poll(self):
            return 0
    captured = {}
    def popen(*_args, **kwargs):
        captured.update(kwargs["env"])
        return Done()
    monkeypatch.setattr(c, "_hash", lambda *_args: "pinned")
    heartbeat = c.Heartbeat(Admission(), "pinned", "pinned", 4242, popen=popen, temp_dir=tmp_path)
    assert heartbeat._ps("-Status")[0] == 0
    assert captured["PATH"] == str(c.POWERSHELL.parent)


def test_journal_is_bounded(tmp_path):
    j = c.Journal(tmp_path / "j.jsonl", maximum=200)
    with pytest.raises(c.ContinuationError):
        for _ in range(50):
            j({"k": "v" * 40})
    assert (tmp_path / "j.jsonl").stat().st_size <= 200


def test_duplicate_outer_root_refused(tmp_path, monkeypatch):
    root = tmp_path / "outer"
    root.mkdir()
    monkeypatch.setattr(c, "OUTER_ROOT", root)
    assert c.apply()["status"] == c.STATUS_FAILED


def test_production_constants_are_pinned():
    assert c.WAIT_SECONDS == 50400.0 and c.MAX_SAMPLES == 840 and c.INTERVAL_SECONDS == 60.0 and c.MAX_PREPARATION_ATTEMPTS == 3
    assert c.SOURCE_PATH == c.STUDIO / "orgs/figment/pipeline/expand/local_omnigen2_continuation.py"
    assert c.OUTER_ROOT.parent == c.MAIN_PRIVATE and c.ACTIVATION_PATH.parents[1] == c.STUDIO_PRIVATE

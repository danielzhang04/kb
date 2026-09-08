import json
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[5]))

from orgs.figment.pipeline.expand import local_omnigen2_resources as res  # noqa: E402

GIB = res.GIB


@dataclass(frozen=True)
class Identity:
    pid: int
    creation_filetime: int
    parent_pid: int | None = None


def good(**overrides):
    sample = {
        "available_ram_bytes": 20 * GIB,
        "commit_headroom_bytes": 40 * GIB,
        "owned_private_bytes": 2 * GIB,
        "gpu_used_mib": 1000,
        "gpu_free_mib": 9000,
        "page_reads_per_sec": None,
        "page_reads_unavailable_reason": "counter-not-integrated",
    }
    sample.update(overrides)
    return sample


class SequenceSampler:
    def __init__(self, samples):
        self.samples = list(samples)
        self.calls = []

    def __call__(self, owned):
        self.calls.append(dict(owned))
        item = self.samples.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


def drive(samples, **kwargs):
    observer = res.ResourceObserver(SequenceSampler(samples), **kwargs)
    observer.update_owned({1: Identity(1, 5)})
    results = [observer.observe_once() for _ in samples]
    return observer, results


# ----- threshold sequences ----------------------------------------------------

def test_ram_breach_requires_two_consecutive_and_equality_is_not_breach():
    low = good(available_ram_bytes=3 * GIB - 1)
    observer, results = drive([low, good(available_ram_bytes=3 * GIB), low, low])
    assert results == [True, True, True, False]
    breach = observer.record()["breach"]
    assert breach["metric"] == "available_ram_bytes" and breach["sample_index"] == 4
    with pytest.raises(res.ResourceError):
        observer.check()


def test_commit_and_owned_breach_after_two():
    observer, results = drive([good(commit_headroom_bytes=16 * GIB - 1)] * 2)
    assert results == [True, False]
    assert observer.record()["breach"]["metric"] == "commit_headroom_bytes"
    observer, results = drive([good(owned_private_bytes=24 * GIB), good(owned_private_bytes=24 * GIB + 1),
                               good(owned_private_bytes=24 * GIB + 1)])
    assert results == [True, True, False]
    assert observer.record()["breach"]["metric"] == "owned_private_bytes"


def test_gpu_breach_requires_three_and_counters_are_independent():
    hot = good(gpu_used_mib=7501, available_ram_bytes=1 * GIB)
    observer = res.ResourceObserver(SequenceSampler([hot, good(gpu_used_mib=7501), hot, hot]))
    assert observer.observe_once() is True
    assert observer.counters() == {"available_ram_bytes": 1, "commit_headroom_bytes": 0,
                                   "owned_private_bytes": 0, "gpu_used_mib": 1}
    assert observer.observe_once() is True
    assert observer.counters()["available_ram_bytes"] == 0 and observer.counters()["gpu_used_mib"] == 2
    assert observer.observe_once() is False
    breach = observer.record()["breach"]
    assert breach["metric"] == "gpu_used_mib" and breach["consecutive"] == 3
    # no polling after the recorded breach: the sampler is not called again
    assert observer.observe_once() is False
    assert observer._sampler.samples == [hot]
    assert observer.record()["sample_count"] == 3


def test_first_breach_only_is_recorded():
    both = good(available_ram_bytes=0, commit_headroom_bytes=0)
    observer, _ = drive([both, both])
    assert observer.record()["breach"]["metric"] == "available_ram_bytes"
    assert observer.record()["error"]["kind"] == "breach"


# ----- sampler failures ---------------------------------------------------------

def test_sampler_exception_is_terminal_and_text_is_not_copied():
    observer, results = drive([RuntimeError("C:/secret/path"), good()])
    assert results == [False, False]
    record = observer.record()
    assert record["error"]["kind"] == "sampler-failure" and "secret" not in str(record)
    with pytest.raises(res.ResourceError):
        observer.check()


@pytest.mark.parametrize("bad", [
    good(available_ram_bytes=-1), good(gpu_used_mib=1.5), good(gpu_free_mib=True),
    good(commit_headroom_bytes=float("nan")), good(page_reads_per_sec=float("inf")),
    good(page_reads_per_sec=None, page_reads_unavailable_reason=None), good(extra=1), {}, None, "x",
])
def test_invalid_sample_is_terminal(bad):
    observer, results = drive([bad])
    assert results == [False]
    assert observer.record()["error"]["kind"] == "invalid-sample"


def test_good_sample_with_numeric_page_reads_is_valid():
    valid = res.validate_sample(good(page_reads_per_sec=12.5, page_reads_unavailable_reason=None))
    assert valid["page_reads_per_sec"] == 12.5


def test_sample_cap_is_terminal():
    observer, results = drive([good()] * 3, maximum_samples=2)
    assert results == [True, True, False]
    assert observer.record()["error"]["kind"] == "sample-cap"
    assert observer.record()["sample_count"] == 2


# ----- record immutability / telemetry --------------------------------------------

def test_record_is_deep_copy_and_tracks_extrema():
    observer, _ = drive([good(gpu_used_mib=10), good(gpu_used_mib=20)])
    record = observer.record()
    record["maxima"]["gpu_used_mib"] = 999
    record["last_sample"]["gpu_used_mib"] = 999
    fresh = observer.record()
    assert fresh["maxima"]["gpu_used_mib"] == 20 and fresh["minima"]["gpu_used_mib"] == 10
    assert fresh["last_sample"]["gpu_used_mib"] == 20
    assert fresh["min_gap_seconds"] is not None and fresh["max_duration_seconds"] >= 0


def test_slow_sampler_overrun_is_visible():
    def slow(owned):
        time.sleep(0.03)
        return good()
    observer = res.ResourceObserver(slow, interval_seconds=0.01)
    assert observer.observe_once() is True
    record = observer.record()
    assert record["overrun_count"] == 1 and record["last_duration_seconds"] >= 0.02


def test_update_owned_copies_and_sampler_receives_copy():
    sampler = SequenceSampler([good()])
    observer = res.ResourceObserver(sampler)
    owned = {7: Identity(7, 1)}
    observer.update_owned(owned)
    owned[8] = Identity(8, 2)
    observer.observe_once()
    assert sampler.calls == [{7: Identity(7, 1)}]


# ----- thread lifecycle -----------------------------------------------------------

def test_thread_lifecycle_start_once_finish_joins():
    seen = threading.Event()

    def sampler(owned):
        seen.set()
        return good()
    observer = res.ResourceObserver(sampler, interval_seconds=0.01)
    observer.start(Identity(42, 9, 1))
    with pytest.raises(res.ResourceError):
        observer.start(Identity(42, 9, 1))
    assert seen.wait(2.0)
    observer.check()
    record = observer.finish()
    assert record["state"] == "stopped" and record["sample_count"] >= 1
    assert record["finished_monotonic"] >= record["started_monotonic"]
    assert not observer._thread.is_alive()
    observer.check()


def test_thread_breach_surfaces_via_check_and_stops_polling():
    sampler = SequenceSampler([good(available_ram_bytes=0)] * 2 + [good()] * 50)
    observer = res.ResourceObserver(sampler, interval_seconds=0.005)
    observer.start(Identity(1, 1))
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline and observer.record()["error"] is None:
        time.sleep(0.005)
    observer._thread.join(2.0)
    assert not observer._thread.is_alive()
    assert len(sampler.calls) == 2 and sampler.calls[0] == {1: Identity(1, 1)}
    with pytest.raises(res.ResourceError):
        observer.check()
    with pytest.raises(res.ResourceError, match="breached"):
        observer.finish()
    assert observer.record()["state"] == "failed" and observer.record()["error"]["kind"] == "breach"


def test_finish_reports_stuck_thread(monkeypatch):
    monkeypatch.setattr(res, "FINISH_JOIN_SECONDS", 0.05)
    release = threading.Event()

    def blocking(owned):
        release.wait(5.0)
        return good()
    observer = res.ResourceObserver(blocking, interval_seconds=0.01)
    observer.start(Identity(3, 3))
    time.sleep(0.05)
    with pytest.raises(res.ResourceError, match="did not stop"):
        observer.finish()
    record = observer.record()
    assert record["error"]["kind"] == "thread-stuck" and record["state"] == "failed"
    release.set()
    observer._thread.join(2.0)
    with pytest.raises(res.ResourceError):
        observer.finish()  # a failed monitor never becomes a stopped one


def test_finish_without_samples_is_failure():
    observer = res.ResourceObserver(lambda owned: good(), interval_seconds=0.01)
    with pytest.raises(res.ResourceError, match="without any sample"):
        observer.finish()
    record = observer.record()
    assert record["error"]["kind"] == "no-samples" and record["state"] == "failed" and record["finished_monotonic"] is not None


def test_late_breach_during_finish_raises_and_keeps_record():
    gate = threading.Event()

    def sampler(owned):
        if gate.is_set():
            return good(available_ram_bytes=0)
        return good()
    observer = res.ResourceObserver(sampler, interval_seconds=0.002)
    observer.start(Identity(5, 5))
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline and observer.record()["sample_count"] < 2:
        time.sleep(0.002)
    observer.check()
    gate.set()
    while time.monotonic() < deadline and observer.record()["error"] is None:
        time.sleep(0.002)
    with pytest.raises(res.ResourceError, match="breached"):
        observer.finish()
    record = observer.record()
    assert record["breach"]["metric"] == "available_ram_bytes" and record["state"] == "failed"
    assert len(record["samples"]) == record["sample_count"] >= 3


def test_numeric_overflow_sample_is_terminal_without_killing_thread():
    huge = 10 ** 400
    assert res._is_finite_number(huge) is False
    observer, results = drive([good(page_reads_per_sec=huge, page_reads_unavailable_reason=None)])
    assert results == [False] and observer.record()["error"]["kind"] == "invalid-sample"
    sampler = SequenceSampler([good(gpu_used_mib=2 ** 40)] + [good()] * 5)
    observer = res.ResourceObserver(sampler, interval_seconds=0.002)
    observer.start(Identity(6, 6))
    observer._thread.join(2.0)
    assert not observer._thread.is_alive() and len(sampler.calls) == 1
    with pytest.raises(res.ResourceError):
        observer.finish()
    assert observer.record()["error"]["kind"] == "invalid-sample"


def test_keyboard_interrupt_in_sampler_is_recorded_and_reraised():
    observer, _ = drive([good()])
    observer._sampler = SequenceSampler([KeyboardInterrupt()])
    with pytest.raises(KeyboardInterrupt):
        observer.observe_once()
    assert observer.record()["error"]["kind"] == "sampler-interrupted"


@pytest.mark.parametrize("bad", [
    good(available_ram_bytes=2 ** 64), good(gpu_free_mib=2 ** 32), good(page_reads_per_sec=float(2 ** 64) * 2, page_reads_unavailable_reason=None),
    good(page_reads_unavailable_reason="r" * 129), good(page_reads_per_sec=1.0, page_reads_unavailable_reason="both-set"),
])
def test_bounded_sample_shape_rejected(bad):
    with pytest.raises(res.ResourceError):
        res.validate_sample(bad)
    assert res.validate_sample(good(gpu_free_mib=2 ** 32 - 1, available_ram_bytes=2 ** 64 - 1))["gpu_free_mib"] == 2 ** 32 - 1


@pytest.mark.parametrize("maximum", [0, 6101, True, 1.0, "5"])
def test_maximum_samples_must_be_bounded_int(maximum):
    with pytest.raises(res.ResourceError):
        res.ResourceObserver(lambda owned: good(), maximum_samples=maximum)


def test_full_6100_sample_series_is_retained_and_bounded(monkeypatch):
    clock = {"now": 0.0}

    def monotonic():
        clock["now"] += 0.25
        return clock["now"]
    monkeypatch.setattr(res.time, "monotonic", monotonic)
    observer = res.ResourceObserver(lambda owned: good(gpu_used_mib=4321), maximum_samples=6100)
    for _ in range(6100):
        assert observer.observe_once() is True
    assert observer.observe_once() is False  # cap stays a terminal failure
    record = observer.record()
    assert record["error"]["kind"] == "sample-cap" and record["sample_count"] == 6100 and len(record["samples"]) == 6100
    first, second = record["samples"][0], record["samples"][1]
    assert first["gap_seconds"] is None and second["gap_seconds"] == pytest.approx(0.5) and first["duration_seconds"] == pytest.approx(0.25)
    assert all(a["timestamp"] < b["timestamp"] for a, b in zip(record["samples"], record["samples"][1:]))
    assert second["values"] == good(gpu_used_mib=4321) and record["last_sample"] == good(gpu_used_mib=4321)
    encoded = json.dumps(record, sort_keys=True, allow_nan=False).encode("utf-8")
    assert len(encoded) < 8 * 1024 * 1024
    record["samples"][0]["values"]["gpu_used_mib"] = 1
    record["samples"].clear()
    fresh = observer.record()
    assert len(fresh["samples"]) == 6100 and fresh["samples"][0]["values"]["gpu_used_mib"] == 4321


def test_start_rejects_non_identity_and_observer_has_no_termination_surface():
    observer = res.ResourceObserver(lambda owned: good())
    with pytest.raises(res.ResourceError):
        observer.start(object())
    with pytest.raises(res.ResourceError):
        observer.start(subprocess.Popen.__class__)
    names = " ".join(dir(observer)).lower()
    assert "terminate" not in names and "kill" not in names and "popen" not in names


# ----- preflight --------------------------------------------------------------------

def test_preflight_passes_at_floors_and_result_has_no_paths():
    result = res.preflight(good(available_ram_bytes=12 * GIB, commit_headroom_bytes=32 * GIB, gpu_free_mib=7500),
                           20 * GIB)
    assert result["ok"] is True
    leaves = [v for v in result.values() if not isinstance(v, dict)] + list(result["floors"].values())
    assert all(isinstance(v, (int, bool)) for v in leaves)  # no strings, hence no paths


@pytest.mark.parametrize("sample, disk", [
    (good(available_ram_bytes=12 * GIB - 1), 20 * GIB),
    (good(commit_headroom_bytes=32 * GIB - 1), 20 * GIB),
    (good(gpu_free_mib=7499), 20 * GIB),
    (good(), 20 * GIB - 1),
    (good(), True),
    (good(gpu_used_mib="1"), 20 * GIB),
])
def test_preflight_floors(sample, disk):
    with pytest.raises(res.ResourceError):
        res.preflight(sample, disk)


# ----- GPU query --------------------------------------------------------------------

class FakeHelper:
    def __init__(self, identities=None, handle_identity=None, absent=()):
        self.identities = identities or {}
        self.handle_identity = handle_identity or {}
        self.absent = set(absent)
        self.opened = []
        self.closed = []

    def _kernel32(self):
        helper = self

        class K:
            def OpenProcess(self, access, inherit, pid):
                assert access == res.PROCESS_QUERY_LIMITED_INFORMATION and inherit is False
                helper.opened.append(pid)
                return 0 if pid in helper.absent or pid not in helper.handle_identity else 1000 + pid

            def CloseHandle(self, handle):
                helper.closed.append(handle)
                return 1
        return K()

    def _identity_from_handle(self, handle, pid, parent_pid):
        assert handle == 1000 + pid
        return self.handle_identity[pid]

    def _process_identity(self, pid, parent_pid=None):
        return None if pid in self.absent else self.identities.get(pid, Identity(pid, 0))


class FakeCompleted:
    def __init__(self, stdout=b"", returncode=0):
        self.stdout = stdout
        self.returncode = returncode


def make_sampler(runner, helper=None):
    return res.WindowsSampler(helper or FakeHelper(), runner=runner)


def test_gpu_query_uses_fixed_command_and_never_real_subprocess(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("real subprocess.run called"))
    monkeypatch.setenv("PATH", "C:/unwanted")
    monkeypatch.setenv("PROGRAMFILES", "C:/Program Files")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-leak")
    captured = {}

    def runner(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return FakeCompleted(b"1234, 5678\n")
    assert make_sampler(runner).gpu_memory_mib() == (1234, 5678)
    assert captured["args"] == [res.NVIDIA_SMI_PATH, *res.NVIDIA_SMI_ARGS]
    kwargs = captured["kwargs"]
    assert kwargs["shell"] is False and kwargs["timeout"] == 2.0 and kwargs["stdin"] is subprocess.DEVNULL
    assert kwargs["creationflags"] == res.CREATE_NO_WINDOW and "capture_output" not in kwargs
    assert kwargs["stdout"] is subprocess.PIPE and kwargs["stderr"] is subprocess.DEVNULL
    assert set(kwargs["env"]) <= {"SYSTEMROOT", "WINDIR", "PROGRAMFILES"} and "PROGRAMFILES" in kwargs["env"]
    assert "PATH" not in kwargs["env"] and "ANTHROPIC_API_KEY" not in kwargs["env"]


@pytest.mark.parametrize("stdout", [
    b"", b"1, 2\n3, 4\n", b"1\n", b"1, 2, 3\n", b"-1, 2\n", b"1.5, 2\n", b"[N/A], 2\n", "1, 2", None,
    b"1, " + b"9" * 1030,
])
def test_gpu_query_malformed_output_fails(stdout):
    with pytest.raises(res.ResourceError):
        make_sampler(lambda *a, **k: FakeCompleted(stdout)).gpu_memory_mib()


def test_gpu_query_nonzero_timeout_and_missing_binary_fail():
    with pytest.raises(res.ResourceError):
        make_sampler(lambda *a, **k: FakeCompleted(b"1, 2\n", returncode=3)).gpu_memory_mib()

    def timeout(*a, **k):
        raise subprocess.TimeoutExpired(cmd="x", timeout=2)
    with pytest.raises(res.ResourceError, match="timed out"):
        make_sampler(timeout).gpu_memory_mib()

    def missing(*a, **k):
        raise FileNotFoundError("C:/hidden")
    with pytest.raises(res.ResourceError) as info:
        make_sampler(missing).gpu_memory_mib()
    assert "hidden" not in str(info.value)


# ----- WinAPI owned-process path with fake helper ------------------------------------

def test_owned_private_bytes_verifies_identity_then_reads_and_closes(monkeypatch):
    live = Identity(10, 111, 1)
    helper = FakeHelper(handle_identity={10: live})
    sampler = make_sampler(lambda *a, **k: FakeCompleted(b"1, 2\n"), helper)
    reads = []
    monkeypatch.setattr(sampler, "private_bytes_from_handle", lambda handle: reads.append(handle) or 5 * GIB)
    assert sampler.owned_private_bytes({10: live}) == 5 * GIB
    assert reads == [1010] and helper.closed == [1010] and helper.opened == [10]


def test_owned_identity_mismatch_fails_closed_and_closes_handle(monkeypatch):
    supplied = Identity(10, 111, 1)
    helper = FakeHelper(handle_identity={10: Identity(10, 222, 1)})
    sampler = make_sampler(lambda *a, **k: FakeCompleted(b"1, 2\n"), helper)
    monkeypatch.setattr(sampler, "private_bytes_from_handle", lambda handle: pytest.fail("read before verify"))
    with pytest.raises(res.ResourceError, match="mismatch"):
        sampler.owned_private_bytes({10: supplied})
    assert helper.closed == [1010]


def test_owned_exited_or_absent_is_skipped_but_inaccessible_fails(monkeypatch):
    exited = Identity(11, 1, 1)
    helper = FakeHelper(handle_identity={11: None}, absent={12})
    sampler = make_sampler(lambda *a, **k: FakeCompleted(b"1, 2\n"), helper)
    monkeypatch.setattr(sampler, "private_bytes_from_handle", lambda handle: pytest.fail("read on exited"))
    assert sampler.owned_private_bytes({11: exited, 12: Identity(12, 1)}) == 0
    assert helper.closed == [1011]
    denied = FakeHelper(identities={13: Identity(13, 1)})
    with pytest.raises(res.ResourceError, match="inaccessible"):
        make_sampler(lambda *a, **k: FakeCompleted(b"1, 2\n"), denied).owned_private_bytes({13: Identity(13, 1)})


def test_owned_mapping_must_match_pid_keys():
    sampler = make_sampler(lambda *a, **k: FakeCompleted(b"1, 2\n"))
    with pytest.raises(res.ResourceError):
        sampler.owned_private_bytes({10: Identity(11, 1)})


def test_sampler_call_assembles_sample_without_real_system_calls(monkeypatch):
    helper = FakeHelper()
    sampler = make_sampler(lambda *a, **k: FakeCompleted(b"100, 200\n"), helper)
    monkeypatch.setattr(sampler, "available_ram_bytes", lambda: 30 * GIB)
    monkeypatch.setattr(sampler, "commit_headroom_bytes", lambda: 50 * GIB)
    monkeypatch.setattr(sampler, "_dlls", lambda: pytest.fail("real DLL load"))
    sample = sampler({})
    assert res.validate_sample(sample) == good(available_ram_bytes=30 * GIB, commit_headroom_bytes=50 * GIB,
                                               owned_private_bytes=0, gpu_used_mib=100, gpu_free_mib=200)


def test_helper_interface_is_required():
    with pytest.raises(res.ResourceError):
        res.WindowsSampler(object())

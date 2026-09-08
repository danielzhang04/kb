"""Read-only Windows resource sampler and bounded observer for the local OmniGen2 runtime.

Design constraints (binding):
- No side effects at import; no CLI; stdlib only.
- The sampler never discovers, owns, or terminates processes. It receives a copied
  dict of already-owned process identities from the engine and only reads memory
  counters through QUERY_LIMITED_INFORMATION handles whose identity is re-verified
  on the same handle before any read.
- The observer never accepts a Popen handle and has no termination path. Its only
  outward signal is ``check()`` raising ``ResourceError`` on the main thread.
- Diagnostics are fixed strings; exception text from the environment is never copied.

Primary references (verified by root; do not browse):
- https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information
- https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex
- https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getprocessmemoryinfo
- https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex
"""
from __future__ import annotations

import copy
import ctypes
import math
import os
import subprocess
import threading
import time
from typing import Any, Callable, Mapping

GIB = 1024 ** 3
MIB = 1024 ** 2

# Observer breach thresholds (hardware-independent, hardcoded). Equality is not a breach.
RAM_FLOOR_BYTES = 3 * GIB
COMMIT_FLOOR_BYTES = 16 * GIB
OWNED_PRIVATE_CEILING_BYTES = 24 * GIB
GPU_USED_CEILING_MIB = 7500
BREACH_RULES: tuple[tuple[str, str, int, int], ...] = (
    # (sample key, direction, threshold, consecutive samples required)
    ("available_ram_bytes", "below", RAM_FLOOR_BYTES, 2),
    ("commit_headroom_bytes", "below", COMMIT_FLOOR_BYTES, 2),
    ("owned_private_bytes", "above", OWNED_PRIVATE_CEILING_BYTES, 2),
    ("gpu_used_mib", "above", GPU_USED_CEILING_MIB, 3),
)

# Preflight floors.
PREFLIGHT_RAM_BYTES = 12 * GIB
PREFLIGHT_COMMIT_BYTES = 32 * GIB
PREFLIGHT_GPU_FREE_MIB = 7500
PREFLIGHT_DISK_BYTES = 20 * GIB

FINISH_JOIN_SECONDS = 5.0
NVIDIA_SMI_PATH = "C:/Windows/System32/nvidia-smi.exe"
NVIDIA_SMI_ARGS = ("--id=0", "--query-gpu=memory.used,memory.free", "--format=csv,noheader,nounits")
NVIDIA_SMI_TIMEOUT_SECONDS = 2.0
NVIDIA_SMI_MAX_OUTPUT_BYTES = 1024
PAGE_READS_UNAVAILABLE_REASON = "counter-not-integrated"

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
CREATE_NO_WINDOW = 0x08000000

INT_KEYS = ("available_ram_bytes", "commit_headroom_bytes", "owned_private_bytes",
            "gpu_used_mib", "gpu_free_mib")
SAMPLE_KEYS = frozenset(INT_KEYS + ("page_reads_per_sec", "page_reads_unavailable_reason"))
MAX_SAMPLES = 6100
MAX_UINT64 = 2 ** 64 - 1
MAX_UINT32 = 2 ** 32 - 1
INT_BOUNDS = {key: (MAX_UINT32 if key.startswith("gpu_") else MAX_UINT64) for key in INT_KEYS}
MAX_PAGE_READS = float(MAX_UINT64)
MAX_REASON_CHARS = 128


class ResourceError(RuntimeError):
    """Raised with a fixed, environment-free message."""


def _is_finite_number(value: Any) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except (OverflowError, ValueError, TypeError):
        return False


def validate_sample(sample: Any) -> dict[str, Any]:
    """Return a validated copy of a sampler result or raise ResourceError."""
    if not isinstance(sample, Mapping) or set(sample.keys()) != SAMPLE_KEYS:
        raise ResourceError("sampler returned a malformed sample")
    out: dict[str, Any] = {}
    for key in INT_KEYS:
        value = sample[key]
        if not (isinstance(value, int) and not isinstance(value, bool)) or value < 0 or value > INT_BOUNDS[key]:
            raise ResourceError("sampler returned a malformed sample")
        out[key] = int(value)
    reads = sample["page_reads_per_sec"]
    if reads is not None and (not _is_finite_number(reads) or reads < 0 or reads > MAX_PAGE_READS):
        raise ResourceError("sampler returned a malformed sample")
    reason = sample["page_reads_unavailable_reason"]
    if reason is not None and (not isinstance(reason, str) or len(reason) > MAX_REASON_CHARS):
        raise ResourceError("sampler returned a malformed sample")
    if (reads is None) == (not reason):
        raise ResourceError("sampler returned a malformed sample")
    out["page_reads_per_sec"] = reads
    out["page_reads_unavailable_reason"] = reason
    return out


def preflight(sample: Mapping[str, Any], disk_free_bytes: Any) -> dict[str, Any]:
    """Pure floor check before launch. Raises ResourceError on any shortfall."""
    valid = validate_sample(sample)
    if not (isinstance(disk_free_bytes, int) and not isinstance(disk_free_bytes, bool)) or disk_free_bytes < 0:
        raise ResourceError("preflight disk free bytes malformed")
    if valid["available_ram_bytes"] < PREFLIGHT_RAM_BYTES:
        raise ResourceError("preflight failed: available RAM below floor")
    if valid["commit_headroom_bytes"] < PREFLIGHT_COMMIT_BYTES:
        raise ResourceError("preflight failed: commit headroom below floor")
    if valid["gpu_free_mib"] < PREFLIGHT_GPU_FREE_MIB:
        raise ResourceError("preflight failed: free GPU memory below floor")
    if disk_free_bytes < PREFLIGHT_DISK_BYTES:
        raise ResourceError("preflight failed: free disk below floor")
    return {
        "ok": True,
        "available_ram_bytes": valid["available_ram_bytes"],
        "commit_headroom_bytes": valid["commit_headroom_bytes"],
        "gpu_free_mib": valid["gpu_free_mib"],
        "disk_free_bytes": disk_free_bytes,
        "floors": {
            "available_ram_bytes": PREFLIGHT_RAM_BYTES,
            "commit_headroom_bytes": PREFLIGHT_COMMIT_BYTES,
            "gpu_free_mib": PREFLIGHT_GPU_FREE_MIB,
            "disk_free_bytes": PREFLIGHT_DISK_BYTES,
        },
    }


class ResourceObserver:
    """Bounded background sampler. Signals only via check(); owns no processes."""

    def __init__(self, sampler: Callable[[dict[Any, Any]], Mapping[str, Any]], *,
                 interval_seconds: float = 1.0, maximum_samples: int = 6100) -> None:
        if not callable(sampler):
            raise ResourceError("observer requires a callable sampler")
        if not _is_finite_number(interval_seconds) or interval_seconds <= 0:
            raise ResourceError("observer interval must be a positive finite number")
        if not isinstance(maximum_samples, int) or isinstance(maximum_samples, bool) or not 1 <= maximum_samples <= MAX_SAMPLES:
            raise ResourceError("observer maximum samples must be an integer within the fixed bound")
        self._sampler = sampler
        self._interval = float(interval_seconds)
        self._maximum_samples = maximum_samples
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._owned: dict[Any, Any] = {}
        self._counters = {rule[0]: 0 for rule in BREACH_RULES}
        self._record: dict[str, Any] = {
            "state": "idle",
            "interval_seconds": self._interval,
            "maximum_samples": maximum_samples,
            "sample_count": 0,
            "started_monotonic": None,
            "finished_monotonic": None,
            "last_timestamp": None,
            "last_duration_seconds": None,
            "max_duration_seconds": None,
            "min_gap_seconds": None,
            "max_gap_seconds": None,
            "overrun_count": 0,
            "last_sample": None,
            "samples": [],
            "maxima": {},
            "minima": {},
            "breach": None,
            "error": None,
        }

    # ----- engine-facing API -------------------------------------------------
    def start(self, wrapper: Any) -> None:
        pid = getattr(wrapper, "pid", None)
        if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
            raise ResourceError("observer start requires a wrapper identity with a pid")
        with self._lock:
            if self._thread is not None:
                raise ResourceError("observer already started")
            self._owned = {pid: wrapper}
            self._record["state"] = "running"
            self._record["started_monotonic"] = time.monotonic()
            self._thread = threading.Thread(target=self._run, name="omnigen2-resource-observer", daemon=True)
            self._thread.start()

    def update_owned(self, owned: Mapping[Any, Any]) -> None:
        if not isinstance(owned, Mapping):
            raise ResourceError("owned identities must be a mapping")
        snapshot = dict(owned)
        with self._lock:
            self._owned = snapshot

    def check(self) -> None:
        """Main-thread only. Raises ResourceError if any failure was recorded."""
        with self._lock:
            error = self._record["error"]
        if error is not None:
            raise ResourceError(error["message"])

    def finish(self) -> dict[str, Any]:
        """Stop and join; record the actual final state; raise on any stored failure."""
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(FINISH_JOIN_SECONDS)
        with self._lock:
            self._record["finished_monotonic"] = time.monotonic()
            if thread is not None and thread.is_alive():
                self._set_error_locked("thread-stuck", "observer thread did not stop within the join limit")
            elif self._record["error"] is None and self._record["sample_count"] == 0:
                self._set_error_locked("no-samples", "observer finished without any sample")
            elif self._record["error"] is None:
                self._record["state"] = "stopped"
        self.check()
        return self.record()

    def record(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._record)

    # ----- synchronous core (also used by tests) ----------------------------
    def observe_once(self) -> bool:
        """Take and evaluate one sample. Returns True if observation may continue."""
        with self._lock:
            if self._record["error"] is not None:
                return False
            if self._record["sample_count"] >= self._maximum_samples:
                self._set_error_locked("sample-cap", "observer reached the maximum sample count")
                return False
            owned = dict(self._owned)
        started = time.monotonic()
        try:
            raw = self._sampler(owned)  # lock deliberately not held: may block
        except (KeyboardInterrupt, SystemExit):
            with self._lock:
                self._set_error_locked("sampler-interrupted", "sampler was interrupted while reading resources")
            raise
        except Exception:
            with self._lock:
                self._set_error_locked("sampler-failure", "sampler raised while reading resources")
            return False
        ended = time.monotonic()
        try:
            sample = validate_sample(raw)
        except ResourceError as exc:
            with self._lock:
                self._set_error_locked("invalid-sample", str(exc))
            return False
        except Exception:
            with self._lock:
                self._set_error_locked("invalid-sample", "sampler returned a malformed sample")
            return False
        with self._lock:
            try:
                self._ingest_locked(sample, started, ended)
            except Exception:
                self._set_error_locked("observer-internal", "observer failed while recording a sample")
            return self._record["error"] is None

    def _ingest_locked(self, sample: dict[str, Any], started: float, ended: float) -> None:
        rec = self._record
        duration = ended - started
        previous = rec["last_timestamp"]
        gap = None
        if previous is not None:
            gap = started - previous
            rec["min_gap_seconds"] = gap if rec["min_gap_seconds"] is None else min(rec["min_gap_seconds"], gap)
            rec["max_gap_seconds"] = gap if rec["max_gap_seconds"] is None else max(rec["max_gap_seconds"], gap)
        rec["last_timestamp"] = started
        rec["last_duration_seconds"] = duration
        rec["max_duration_seconds"] = duration if rec["max_duration_seconds"] is None else max(
            rec["max_duration_seconds"], duration)
        if duration > self._interval:
            rec["overrun_count"] += 1
        rec["sample_count"] += 1
        rec["last_sample"] = dict(sample)
        rec["samples"].append({"timestamp": started, "duration_seconds": duration, "gap_seconds": gap, "values": dict(sample)})
        for key in INT_KEYS:
            value = sample[key]
            rec["maxima"][key] = value if key not in rec["maxima"] else max(rec["maxima"][key], value)
            rec["minima"][key] = value if key not in rec["minima"] else min(rec["minima"][key], value)
        for key, direction, threshold, needed in BREACH_RULES:
            value = sample[key]
            bad = value < threshold if direction == "below" else value > threshold
            self._counters[key] = self._counters[key] + 1 if bad else 0
            if self._counters[key] >= needed and rec["breach"] is None:
                rec["breach"] = {
                    "metric": key,
                    "direction": direction,
                    "value": value,
                    "threshold": threshold,
                    "consecutive": self._counters[key],
                    "sample_index": rec["sample_count"],
                    "timestamp": started,
                }
                self._set_error_locked("breach", "resource threshold breached: " + key)

    def _set_error_locked(self, kind: str, message: str) -> None:
        if self._record["error"] is None:
            self._record["error"] = {"kind": kind, "message": message}
        self._record["state"] = "failed"

    def counters(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counters)

    # ----- thread loop -------------------------------------------------------
    def _run(self) -> None:
        try:
            next_due = time.monotonic()
            while not self._stop.is_set():
                if not self.observe_once():
                    return
                next_due += self._interval
                now = time.monotonic()
                wait = next_due - now
                if wait <= 0:
                    next_due = now  # explicit overrun: resample immediately, keep true gaps in record
                    continue
                if self._stop.wait(wait):
                    return
        except BaseException:
            with self._lock:
                self._set_error_locked("observer-internal", "observer thread failed unexpectedly")


# ----- Windows structures ------------------------------------------------------
if os.name == "nt":  # pragma: no cover - structure layout only
    from ctypes import wintypes as _wt

    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [("dwLength", _wt.DWORD), ("dwMemoryLoad", _wt.DWORD),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    class PERFORMANCE_INFORMATION(ctypes.Structure):
        _fields_ = [("cb", _wt.DWORD), ("CommitTotal", ctypes.c_size_t), ("CommitLimit", ctypes.c_size_t),
                    ("CommitPeak", ctypes.c_size_t), ("PhysicalTotal", ctypes.c_size_t),
                    ("PhysicalAvailable", ctypes.c_size_t), ("SystemCache", ctypes.c_size_t),
                    ("KernelTotal", ctypes.c_size_t), ("KernelPaged", ctypes.c_size_t),
                    ("KernelNonpaged", ctypes.c_size_t), ("PageSize", ctypes.c_size_t),
                    ("HandleCount", _wt.DWORD), ("ProcessCount", _wt.DWORD), ("ThreadCount", _wt.DWORD)]

    class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
        _fields_ = [("cb", _wt.DWORD), ("PageFaultCount", _wt.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
                    ("PrivateUsage", ctypes.c_size_t)]


def _allowlisted_env() -> dict[str, str]:
    # PROGRAMFILES is required for NVML initialisation (root-verified); PATH does not help and is excluded.
    return {key: os.environ[key] for key in ("SYSTEMROOT", "WINDIR", "PROGRAMFILES") if key in os.environ}


def parse_nvidia_smi_output(stdout: Any) -> tuple[int, int]:
    """Parse ``memory.used, memory.free`` for exactly one device; fail closed otherwise."""
    if not isinstance(stdout, (bytes, bytearray)) or len(stdout) > NVIDIA_SMI_MAX_OUTPUT_BYTES:
        raise ResourceError("gpu query output malformed")
    lines = [line for line in bytes(stdout).splitlines() if line.strip()]
    if len(lines) != 1:
        raise ResourceError("gpu query output malformed")
    fields = [field.strip() for field in lines[0].split(b",")]
    if len(fields) != 2 or not all(field.isdigit() for field in fields):
        raise ResourceError("gpu query output malformed")
    return int(fields[0]), int(fields[1])


class WindowsSampler:
    """Reads system RAM, commit headroom, owned private commit and GPU memory. Read-only."""

    def __init__(self, helper: Any, *, runner: Callable[..., Any] = subprocess.run) -> None:
        for name in ("_kernel32", "_identity_from_handle", "_process_identity"):
            if not callable(getattr(helper, name, None)):
                raise ResourceError("sampler helper is missing a required interface")
        self._helper = helper
        self._runner = runner
        self._sys_kernel32: Any = None
        self._psapi: Any = None

    def __call__(self, owned: Mapping[Any, Any]) -> dict[str, Any]:
        if not isinstance(owned, Mapping):
            raise ResourceError("sampler requires an owned identity mapping")
        used, free = self.gpu_memory_mib()
        return {
            "available_ram_bytes": self.available_ram_bytes(),
            "commit_headroom_bytes": self.commit_headroom_bytes(),
            "owned_private_bytes": self.owned_private_bytes(owned),
            "gpu_used_mib": used,
            "gpu_free_mib": free,
            "page_reads_per_sec": None,
            "page_reads_unavailable_reason": PAGE_READS_UNAVAILABLE_REASON,
        }

    # ----- lazy DLLs ---------------------------------------------------------
    def _dlls(self) -> tuple[Any, Any]:
        if os.name != "nt":
            raise ResourceError("windows sampler requires Windows")
        if self._sys_kernel32 is None:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(MEMORYSTATUSEX)]
            kernel32.GlobalMemoryStatusEx.restype = _wt.BOOL
            psapi = ctypes.WinDLL("psapi", use_last_error=True)
            psapi.GetPerformanceInfo.argtypes = [ctypes.POINTER(PERFORMANCE_INFORMATION), _wt.DWORD]
            psapi.GetPerformanceInfo.restype = _wt.BOOL
            psapi.GetProcessMemoryInfo.argtypes = [_wt.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX), _wt.DWORD]
            psapi.GetProcessMemoryInfo.restype = _wt.BOOL
            self._sys_kernel32, self._psapi = kernel32, psapi
        return self._sys_kernel32, self._psapi

    # ----- system counters ---------------------------------------------------
    def available_ram_bytes(self) -> int:
        kernel32, _ = self._dlls()
        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if not kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            raise ResourceError("cannot read system memory status")
        return int(status.ullAvailPhys)

    def commit_headroom_bytes(self) -> int:
        _, psapi = self._dlls()
        info = PERFORMANCE_INFORMATION()
        info.cb = ctypes.sizeof(PERFORMANCE_INFORMATION)
        if not psapi.GetPerformanceInfo(ctypes.byref(info), info.cb):
            raise ResourceError("cannot read system performance information")
        limit, total, page = int(info.CommitLimit), int(info.CommitTotal), int(info.PageSize)
        if page <= 0 or limit < total:
            raise ResourceError("system performance information inconsistent")
        return (limit - total) * page

    def private_bytes_from_handle(self, handle: Any) -> int:
        _, psapi = self._dlls()
        counters = PROCESS_MEMORY_COUNTERS_EX()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
        if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            raise ResourceError("cannot read owned process memory counters")
        return int(counters.PrivateUsage)

    # ----- owned processes ---------------------------------------------------
    def owned_private_bytes(self, owned: Mapping[Any, Any]) -> int:
        kernel32 = self._helper._kernel32()
        total = 0
        for pid, identity in dict(owned).items():
            if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0 or getattr(identity, "pid", None) != pid:
                raise ResourceError("owned identity mapping malformed")
            parent_pid = getattr(identity, "parent_pid", None)
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                if self._helper._process_identity(pid, parent_pid) is None:
                    continue  # confirmed absent
                raise ResourceError("owned process inaccessible")
            try:
                current = self._helper._identity_from_handle(handle, pid, parent_pid)
                if current is None:
                    continue  # exited
                if current != identity:
                    raise ResourceError("owned process identity mismatch")
                total += self.private_bytes_from_handle(handle)
            finally:
                kernel32.CloseHandle(handle)
        return total

    # ----- GPU ---------------------------------------------------------------
    def gpu_memory_mib(self) -> tuple[int, int]:
        try:
            completed = self._runner(
                [NVIDIA_SMI_PATH, *NVIDIA_SMI_ARGS],
                shell=False, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=NVIDIA_SMI_TIMEOUT_SECONDS,
                stdin=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW, env=_allowlisted_env(),
            )
        except subprocess.TimeoutExpired:
            raise ResourceError("gpu query timed out") from None
        except OSError:
            raise ResourceError("gpu query could not start") from None
        if getattr(completed, "returncode", None) != 0:
            raise ResourceError("gpu query failed")
        return parse_nvidia_smi_output(getattr(completed, "stdout", None))

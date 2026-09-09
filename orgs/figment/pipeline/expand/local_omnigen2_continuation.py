"""Delayed single-execution wrapper for the reviewed fixed local OmniGen2 reference run.

One invocation: wait (stdlib only, no GPU, no model reads) until the pinned resource
floors hold for three consecutive healthy samples, prepare the fixed admission at most
three times, then execute the reviewed runtime Controller once in this process. Never
retries generation, never lowers a floor, never touches provider or Claude APIs.
Default CLI prints a static description without I/O; only ``--apply`` runs.
"""
from __future__ import annotations

import argparse
import dataclasses
import datetime as _dt
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import types
from pathlib import Path
from typing import Any, Callable

SCHEMA = "figment/local-omnigen2-continuation@1"
ACTIVATION_SCHEMA = "figment/local-omnigen2-continuation-activation@1"
AUTHORIZED_BY = "codex-worker"
LEASE_LABEL = "codex-figment-async-20260908"

MAIN = Path("C:/Users/danie/kb")
MAIN_PRIVATE = MAIN / "_private"
STUDIO = MAIN_PRIVATE / "codex-worktrees/figment-studio-20260908"
STUDIO_PRIVATE = STUDIO / "_private"
OUTER_ROOT = MAIN_PRIVATE / "figment-omnigen-overnight-continuation-20260909-v1"
ACTIVATION_PATH = STUDIO_PRIVATE / "figment-omnigen-overnight-activation-20260909-v1" / "activation.json"
SOURCE_REL = "orgs/figment/pipeline/expand/local_omnigen2_continuation.py"
SOURCE_PATH = STUDIO / SOURCE_REL
STOP_PATH = MAIN / "STOP"
KEEPAWAKE_CLI = MAIN / "scripts/keep_awake.ps1"
KEEPAWAKE_MODULE = MAIN / "scripts/KeepAwake/KeepAwake.psm1"
POWERSHELL = Path("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")

RUNTIME_SHA256 = "9ed5aa16aeecb86edecf390f57166bbe0447f1c2e35c121a4e68157f62569300"
RESOURCES_SHA256 = "5036d75702d1f943a1757306bbd61f022949b4fcdac4d039acc198d1bd21c6e9"
HELPER_SHA256 = "2997ba3185aabfb146b13f38d18c854615a7190064d30f14037570398bea7bac"
ADMISSION_SHA256 = "313b5b1269f738035f0ba9e979f9d748a0aecf02b48863fab90ed3110e7e7e51"
SEEDS = (481516234, 90210)

WAIT_SECONDS = 50400.0
MAX_SAMPLES = 840
INTERVAL_SECONDS = 60.0
MAX_PREPARATION_ATTEMPTS = 3
READY_PASSES = 3
HEARTBEAT_MIN_INTERVAL_SECONDS = 60.0
STATUS_PRINT_SECONDS = 3600.0
MAX_ACTIVATION_BYTES = 16 * 1024
MAX_CODE_BYTES = 512 * 1024
MAX_PS_OUTPUT_BYTES = 8192
PS_TIMEOUT_SECONDS = 10.0
PS_KILL_WAIT_SECONDS = 10.0
PS_POLL_SECONDS = 0.25
HEARTBEAT_JOIN_SECONDS = PS_TIMEOUT_SECONDS + PS_KILL_WAIT_SECONDS + PS_TIMEOUT_SECONDS + 1.0
EXECUTION_UNARMED_GRACE_SECONDS = 90.0
MAX_JOURNAL_BYTES = 2 * 1024 * 1024
ENV_ALLOWLIST = ("SYSTEMROOT", "WINDIR", "PROGRAMFILES", "LOCALAPPDATA", "APPDATA", "USERPROFILE")
CREATE_NO_WINDOW = 0x08000000
ACTIVATION_KEYS = frozenset({"schema", "owner", "source_sha256", "keepawake_cli_sha256", "keepawake_module_sha256", "authorized_by", "not_promotable"})
OWNER_KEYS = frozenset({"pid", "creation_filetime", "parent_pid"})

STATUS_GENERATED = "generated-awaiting-review"
STATUS_NOT_ADMITTED = "wait-window-ended-not-admitted"
STATUS_FAILED = "failed"
TOLERATED_GPU_QUERY_TIMEOUT = "gpu query timed out"


class ContinuationError(RuntimeError):
    """Terminal wrapper failure (never a resource wait)."""


def _utc() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


# ------------------------------------------------------------------ pure parts
def _status_fields(stdout: bytes, owner_pid: int) -> tuple[bool, bool, bool]:
    """Read only the fixed own-lease status line and global supervisor state."""
    if not isinstance(stdout, (bytes, bytearray)) or len(stdout) > MAX_PS_OUTPUT_BYTES:
        return False, False, False
    armed = supervisor = own_lease = False
    lease_prefix = f"{LEASE_LABEL} mode=pid-only pid={owner_pid} alive=True heartbeat="
    for raw in bytes(stdout).splitlines():
        line = raw.decode("utf-8", errors="replace").strip()
        if line == "armed: True":
            armed = True
        elif line.startswith("supervisor: pid=") and " alive=True" in line:
            supervisor = True
        elif line.startswith(lease_prefix) and len(line) > len(lease_prefix):
            own_lease = True
    return armed, supervisor, own_lease


def parse_status(stdout: bytes, owner_pid: int) -> bool:
    """True only for an armed alive supervisor and this root owner's live pid-only lease."""
    armed, supervisor, own_lease = _status_fields(stdout, owner_pid)
    return armed and supervisor and own_lease


def validate_activation(document: Any, *, owner_pid: int | None, source_sha256: str, cli_sha256: str, module_sha256: str) -> dict[str, Any]:
    if not isinstance(document, dict) or set(document) != ACTIVATION_KEYS:
        raise ContinuationError("activation keys are not the closed set")
    if document["schema"] != ACTIVATION_SCHEMA or document["authorized_by"] != AUTHORIZED_BY or document["not_promotable"] is not True:
        raise ContinuationError("activation schema/authorization/promotability mismatch")
    owner = document["owner"]
    if not isinstance(owner, dict) or set(owner) != OWNER_KEYS or owner["parent_pid"] is not None:
        raise ContinuationError("activation owner has an unexpected shape")
    if not _positive_int(owner["pid"]) or not _positive_int(owner["creation_filetime"]):
        raise ContinuationError("activation owner identity must be positive integers")
    if owner_pid is not None and owner["pid"] != owner_pid:
        raise ContinuationError("activation owner pid is not the authorized root owner")
    for key, actual in (("source_sha256", source_sha256), ("keepawake_cli_sha256", cli_sha256), ("keepawake_module_sha256", module_sha256)):
        if document[key] != actual:
            raise ContinuationError(f"activation {key} does not match the current file")
    return {"pid": owner["pid"], "creation_filetime": owner["creation_filetime"]}


def verify_receipt(receipt: Any, *, raw_receipt: bytes) -> dict[str, Any]:
    """Machine check the returned receipt and its exact on-disk JSON artifact."""
    if not isinstance(receipt, dict):
        raise ContinuationError("receipt is not an object")
    if receipt.get("schema") != "figment/local-omnigen2-runtime@1" or receipt.get("status") != "complete":
        raise ContinuationError("receipt is not the completed OmniGen2 runtime receipt")
    if receipt.get("not_promotable") is not True:
        raise ContinuationError("receipt is promotable")
    if not isinstance(raw_receipt, bytes) or not raw_receipt:
        raise ContinuationError("receipt artifact bytes are missing")
    rows = receipt.get("rows")
    if not isinstance(rows, list) or [r.get("seed") if isinstance(r, dict) else None for r in rows] != list(SEEDS):
        raise ContinuationError("receipt rows are not exactly the fixed two seeds")
    outputs = []
    for row in rows:
        output = row.get("output")
        sha = output.get("sha256") if isinstance(output, dict) else None
        if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
            raise ContinuationError("receipt row lacks a hex output hash")
        if output.get("dimensions") != [768, 768]:
            raise ContinuationError("receipt row has unexpected output dimensions")
        outputs.append({"seed": row["seed"], "sha256": sha, "dimensions": [768, 768]})
    teardown = receipt.get("teardown")
    if not isinstance(teardown, dict) or teardown.get("verified_stopped") is not True:
        raise ContinuationError("receipt teardown is not verified stopped")
    canon = json.dumps(receipt, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return {"receipt_canonical_sha256": hashlib.sha256(canon).hexdigest(), "receipt_raw_sha256": hashlib.sha256(raw_receipt).hexdigest(), "rows": outputs, "teardown_verified": True}


# ------------------------------------------------------------------ dependencies
@dataclasses.dataclass
class Deps:
    """Everything with side effects, injectable for tests."""
    monotonic: Callable[[], float]
    sleep: Callable[[float], None]
    guard: Callable[[], None]                 # owner + STOP + source pins; raises ContinuationError
    sample: Callable[[], dict[str, Any]]      # raw sampler result
    disk_free: Callable[[], int]
    preflight: Callable[[dict[str, Any], int], dict[str, Any]]
    resource_error: type[BaseException]
    heartbeat: Callable[[], dict[str, Any]]   # {"healthy": bool, ...}; raises ContinuationError on pin failure
    admission_present: Callable[[], bool]     # admission root or run root exists
    build_evidence: Callable[[], Any]
    make_admission: Callable[[Any], Any]
    canonical: Callable[[Any], bytes]
    write_admission: Callable[[bytes, dict[str, Any]], None]
    execute: Callable[[], tuple[Any, bytes]]  # runs Controller once, returns receipt and raw receipt.json
    journal: Callable[[dict[str, Any]], None]
    emit: Callable[[str], None]


@dataclasses.dataclass
class Limits:
    wait_seconds: float = WAIT_SECONDS
    max_samples: int = MAX_SAMPLES
    interval_seconds: float = INTERVAL_SECONDS
    max_preparation_attempts: int = MAX_PREPARATION_ATTEMPTS
    ready_passes: int = READY_PASSES
    status_print_seconds: float = STATUS_PRINT_SECONDS


class Wrapper:
    def __init__(self, deps: Deps, limits: Limits | None = None) -> None:
        self.d, self.l = deps, limits or Limits()
        self.ready = 0
        self.samples = 0
        self.attempts: list[dict[str, Any]] = []
        self.executions = 0
        self.resource_timeout_count = 0
        self._tolerated_timeout = False
        self._last_print = None
        self._last_state = None

    def _print(self, state: str, force: bool = False) -> None:
        now = self.d.monotonic()
        if force or state != self._last_state or self._last_print is None or now - self._last_print >= self.l.status_print_seconds:
            self.d.emit(json.dumps({"schema": SCHEMA, "state": state, "samples": self.samples, "ready": self.ready, "attempts": len(self.attempts), "utc": _utc()}, sort_keys=True))
            self._last_print, self._last_state = now, state

    def _deadline(self, deadline: float, where: str) -> None:
        if self.d.monotonic() >= deadline:
            raise ContinuationError(f"wait deadline passed {where}")

    def _floor(self, phase: str) -> bool:
        """One guarded sample; journal raw before floors. True = floors pass; False = wait."""
        self.d.guard()
        self._tolerated_timeout = False
        record = {"utc": _utc(), "monotonic": self.d.monotonic(), "phase": phase}
        try:
            sample = self.d.sample()
            disk = self.d.disk_free()
            record["sample"] = sample
            record["disk_free_bytes"] = disk
        except BaseException as exc:
            record["sample_error"] = {"class": type(exc).__name__, "message": str(exc)[:256]}
            record["outcome"] = "sampler-error"
            self.d.journal(record)
            if phase == "wait" and isinstance(exc, self.d.resource_error) and str(exc) == TOLERATED_GPU_QUERY_TIMEOUT and self.resource_timeout_count == 0:
                self._tolerated_timeout = True
                return False
            raise
        try:
            record["preflight"] = self.d.preflight(sample, disk)
            record["outcome"] = "floor-pass"
            return True
        except self.d.resource_error as exc:
            record["preflight"] = {"ok": False, "reason": str(exc)[:256]}
            record["outcome"] = "below-floor"
            return False
        except BaseException as exc:
            record["preflight_error"] = {"class": type(exc).__name__, "message": str(exc)[:256]}
            record["outcome"] = "preflight-error"
            raise
        finally:
            self.d.journal(record)

    def wait(self, deadline: float) -> bool:
        """Wait phase. True when ready_passes consecutive healthy floors are recorded."""
        while self.samples < self.l.max_samples and self.d.monotonic() < deadline:
            self.samples += 1
            ok = self._floor("wait")
            if self._tolerated_timeout:
                self.resource_timeout_count += 1
                self.ready = 0
                self.d.journal({"utc": _utc(), "monotonic": self.d.monotonic(), "phase": "tolerated-gpu-query-timeout", "outcome": "tolerated", "timeout_count": self.resource_timeout_count})
            beat = self.d.heartbeat()
            healthy = beat.get("healthy") is True
            self.d.journal({"utc": _utc(), "monotonic": self.d.monotonic(), "phase": "heartbeat", "result": beat, "outcome": "healthy" if healthy else "unhealthy"})
            self.ready = self.ready + 1 if (ok and healthy) else 0
            if self.ready >= self.l.ready_passes:
                self._print("ready", force=True)
                return True
            self._print("waiting" if ok else "below-floor")
            remaining = deadline - self.d.monotonic()
            if remaining <= 0 or self.samples >= self.l.max_samples:
                break
            self.d.sleep(min(self.l.interval_seconds, remaining))
        return False

    def prepare(self, deadline: float) -> dict[str, Any] | None:
        """One admission attempt. Returns the record written when admitted, None when floors fell."""
        self.d.guard()
        self._deadline(deadline, "before preparation")
        if self.d.admission_present():
            raise ContinuationError("fixed admission or run root already exists; refusing to replace or resume")
        evidence = self.d.build_evidence()
        self._deadline(deadline, "after evidence")
        for i in range(self.l.ready_passes):
            self._deadline(deadline, "before post-evidence floor sample")
            if not self._floor("preparation"):
                return None
            self._deadline(deadline, "after post-evidence floor sample")
            if i < self.l.ready_passes - 1:
                remaining = deadline - self.d.monotonic()
                if remaining <= 0:
                    self._deadline(deadline, "during post-evidence interval")
                self.d.sleep(min(1.0, remaining))
        self.d.guard()
        self._deadline(deadline, "before admission write")
        if self.d.admission_present():
            raise ContinuationError("fixed admission or run root appeared during preparation")
        admission = self.d.make_admission(evidence)
        data = self.d.canonical(admission) + b"\n"
        review = {"admission_id": admission["id"], "admission_raw_sha256": hashlib.sha256(data).hexdigest(), "admission_canonical_sha256": hashlib.sha256(self.d.canonical(admission)).hexdigest(), "runtime_sha256": admission["evidence"]["code"]["orgs/figment/pipeline/expand/local_omnigen2_runtime.py"]["sha256"], "samples": self.samples, "attempts": len(self.attempts) + 1}
        if review["runtime_sha256"] != RUNTIME_SHA256:
            raise ContinuationError("fresh evidence runtime hash differs from the reviewed pin")
        self._deadline(deadline, "immediately before admission write")
        self.d.write_admission(data, review)
        return review

    def run(self) -> dict[str, Any]:
        started = self.d.monotonic()
        deadline = started + self.l.wait_seconds
        result: dict[str, Any] = {"schema": SCHEMA, "status": STATUS_FAILED, "admitted": False, "execution_attempted": False, "quality_accepted": False, "qualitative_review_pending": False, "not_promotable": True, "errors": []}
        try:
            while len(self.attempts) < self.l.max_preparation_attempts:
                if not self.wait(deadline):
                    result["status"] = STATUS_NOT_ADMITTED
                    break
                review = self.prepare(deadline)
                if review is None:
                    self.attempts.append({"utc": _utc(), "outcome": "floor-fell-during-preparation"})
                    self.ready = 0
                    self._print("preparation-reset", force=True)
                    if len(self.attempts) >= self.l.max_preparation_attempts:
                        result["status"] = STATUS_NOT_ADMITTED
                    continue
                self.attempts.append({"utc": _utc(), "outcome": "admitted", "review": review})
                result["admitted"] = True
                result["admission"] = review
                self._print("executing", force=True)
                self._deadline(deadline, "immediately before execution")
                self.d.guard()
                self.executions += 1
                result["execution_attempted"] = True
                receipt, raw_receipt = self.d.execute()
                verified = verify_receipt(receipt, raw_receipt=raw_receipt)
                result.update(verified)
                result["status"] = STATUS_GENERATED
                result["qualitative_review_pending"] = True
                break
            else:
                result["status"] = STATUS_NOT_ADMITTED
        except BaseException as exc:  # terminal: recorded, never retried
            result["status"] = STATUS_FAILED
            result["errors"].append({"class": type(exc).__name__, "message": str(exc)[:512]})
        result["samples"] = self.samples
        result["attempts"] = self.attempts
        result["executions"] = self.executions
        result["resource_timeout_count"] = self.resource_timeout_count
        result["elapsed_seconds"] = self.d.monotonic() - started
        result["utc"] = _utc()
        self._print(result["status"], force=True)
        return result


# ------------------------------------------------------------------ production wiring
class Journal:
    def __init__(self, path: Path, maximum: int = MAX_JOURNAL_BYTES) -> None:
        self.path, self.maximum, self.written, self.truncated = path, maximum, 0, False

    def __call__(self, record: dict[str, Any]) -> None:
        line = json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8") + b"\n"
        if self.written + len(line) > self.maximum:
            self.truncated = True
            raise ContinuationError("journal capacity reached; refusing to lose evidence")
        with self.path.open("ab") as f:
            f.write(line)
        self.written += len(line)


def _hash(path: Path, admission: types.ModuleType, maximum: int = MAX_CODE_BYTES) -> str:
    return admission.hash_file(path, maximum)[0]


def _read_checked_source(path: Path, expected_sha: str) -> bytes:
    """Bounded, stable read before any pinned helper module is available."""
    try:
        before = os.lstat(path)
    except OSError as exc:
        raise ContinuationError("cannot stat runtime source") from exc
    if not stat.S_ISREG(before.st_mode) or before.st_size <= 0 or before.st_size > MAX_CODE_BYTES:
        raise ContinuationError("runtime source has an unsafe shape")
    identity = (before.st_size, before.st_mtime_ns, before.st_ino, before.st_dev)
    chunks: list[bytes] = []
    digest = hashlib.sha256()
    seen = 0
    try:
        with path.open("rb", buffering=0) as handle:
            opened = os.fstat(handle.fileno())
            if not stat.S_ISREG(opened.st_mode) or (opened.st_size, opened.st_mtime_ns, opened.st_ino, opened.st_dev) != identity:
                raise ContinuationError("runtime source changed while opening")
            while seen < before.st_size:
                block = handle.read(min(1024 * 1024, before.st_size - seen))
                if not block:
                    raise ContinuationError("runtime source short read")
                seen += len(block)
                digest.update(block)
                chunks.append(block)
            if handle.read(1):
                raise ContinuationError("runtime source grew while read")
            opened = os.fstat(handle.fileno())
    except OSError as exc:
        raise ContinuationError("cannot read runtime source") from exc
    try:
        after = os.lstat(path)
    except OSError as exc:
        raise ContinuationError("cannot restat runtime source") from exc
    if (opened.st_size, opened.st_mtime_ns, opened.st_ino, opened.st_dev) != identity or (after.st_size, after.st_mtime_ns, after.st_ino, after.st_dev) != identity:
        raise ContinuationError("runtime source changed while read")
    if digest.hexdigest() != expected_sha:
        raise ContinuationError("runtime source does not match the reviewed pin")
    return b"".join(chunks)


def _load_runtime() -> types.ModuleType:
    path = STUDIO / "orgs/figment/pipeline/expand/local_omnigen2_runtime.py"
    raw = _read_checked_source(path, RUNTIME_SHA256)
    module = types.ModuleType("figment_continuation_runtime")
    module.__file__ = str(path)
    sys.modules[module.__name__] = module
    exec(compile(raw, str(path), "exec", dont_inherit=True), module.__dict__)  # noqa: S102 - hash-checked above
    if module.ADMISSION_SHA256 != ADMISSION_SHA256:
        raise ContinuationError("runtime admission pin differs from the reviewed pin")
    return module


class Guard:
    """Owner identity + STOP + pinned source hashes, checked before every sample and run step."""

    def __init__(self, helper: Any, admission: types.ModuleType, owner: dict[str, int], activation_sha256: str, source_sha256: str, cli_sha256: str, module_sha256: str) -> None:
        self.helper, self.admission, self.owner = helper, admission, owner
        self.activation_sha256 = activation_sha256
        self.source_sha256, self.cli_sha256, self.module_sha256 = source_sha256, cli_sha256, module_sha256
        self.pins = {STUDIO / "orgs/figment/pipeline/expand/local_omnigen2_runtime.py": RUNTIME_SHA256, STUDIO / "orgs/figment/pipeline/expand/local_omnigen2_resources.py": RESOURCES_SHA256, STUDIO / "orgs/figment/pipeline/expand/local_comfy_input.py": HELPER_SHA256, STUDIO / "orgs/figment/pipeline/expand/local_omnigen2_admission.py": ADMISSION_SHA256}

    def owner_stop(self) -> None:
        if STOP_PATH.exists():
            raise ContinuationError("MAIN/STOP present; fleet frozen")
        identity = self.helper._process_identity(self.owner["pid"], None)
        if identity is None or identity.pid != self.owner["pid"] or identity.creation_filetime != self.owner["creation_filetime"]:
            raise ContinuationError("owner process identity does not match the activation")

    def _activation_current(self) -> None:
        path = self.admission.safe(ACTIVATION_PATH, STUDIO_PRIVATE, "activation")
        data, _, _ = self.admission._read_bounded(path, MAX_ACTIVATION_BYTES)
        document = self.admission._strict_loads(data, "activation")
        validate_activation(document, owner_pid=self.owner["pid"], source_sha256=self.source_sha256, cli_sha256=self.cli_sha256, module_sha256=self.module_sha256)
        if hashlib.sha256(self.admission.canonical(document)).hexdigest() != self.activation_sha256:
            raise ContinuationError("activation changed since initial validation")

    def __call__(self) -> None:
        self.owner_stop()
        if _hash(SOURCE_PATH, self.admission) != self.source_sha256:
            raise ContinuationError("wrapper source changed since activation")
        self._activation_current()
        for path, expected in self.pins.items():
            if _hash(path, self.admission) != expected:
                raise ContinuationError(f"pinned source changed: {path.name}")


class Heartbeat:
    def __init__(self, admission: types.ModuleType, cli_sha: str, module_sha: str, owner_pid: int, popen: Callable[..., Any] = subprocess.Popen, temp_dir: Path = OUTER_ROOT, monotonic: Callable[[], float] = time.monotonic) -> None:
        self.admission, self.cli_sha, self.module_sha, self.owner_pid = admission, cli_sha, module_sha, owner_pid
        self.popen, self.temp_dir, self.monotonic = popen, temp_dir, monotonic

    def _ps(self, *args: str, cancel: threading.Event | None = None) -> tuple[int, bytes]:
        env = {k: os.environ[k] for k in ENV_ALLOWLIST if k in os.environ}
        env["PATH"] = str(POWERSHELL.parent)
        self.admission.safe(self.temp_dir, MAIN_PRIVATE, "heartbeat temporary root")
        if cancel is not None and cancel.is_set():
            return -1, b"cancelled-before-launch"
        try:
            with tempfile.TemporaryFile(mode="w+b", dir=self.temp_dir) as stdout, tempfile.TemporaryFile(mode="w+b", dir=self.temp_dir) as stderr:
                proc = self.popen([str(POWERSHELL), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(KEEPAWAKE_CLI), *args], env=env, stdout=stdout, stderr=stderr, creationflags=CREATE_NO_WINDOW)
                deadline = self.monotonic() + PS_TIMEOUT_SECONDS
                while proc.poll() is None:
                    if cancel is not None and cancel.is_set():
                        reason = b"cancelled"
                        break
                    if self.monotonic() >= deadline:
                        reason = b"timeout"
                        break
                    try:
                        proc.wait(timeout=min(PS_POLL_SECONDS, max(0.001, deadline - self.monotonic())))
                    except subprocess.TimeoutExpired:
                        continue
                else:
                    reason = b""
                if reason:
                    owned = f"owned-popen-pid={getattr(proc, 'pid', '<unknown>')}".encode("ascii", errors="replace")
                    try:
                        proc.kill()  # owned Popen child only
                    except OSError:
                        return -1, b"owned-child-cleanup-unproven " + owned + b" kill-error"
                    try:
                        proc.wait(timeout=PS_KILL_WAIT_SECONDS)
                    except subprocess.TimeoutExpired:
                        return -1, b"owned-child-cleanup-unproven " + owned
                    if proc.poll() is None:
                        return -1, b"owned-child-cleanup-unproven " + owned
                    return -1, reason + b"-owned-child-exited " + owned
                stdout.seek(0, os.SEEK_END)
                stderr.seek(0, os.SEEK_END)
                if stdout.tell() > MAX_PS_OUTPUT_BYTES or stderr.tell() > MAX_PS_OUTPUT_BYTES:
                    return -1, b"oversize-output"
                stdout.seek(0)
                return int(proc.returncode), stdout.read()
        except subprocess.TimeoutExpired:
            return -1, b"timeout"
        except OSError:
            return -1, b"process-error"

    def __call__(self, cancel: threading.Event | None = None) -> dict[str, Any]:
        if _hash(KEEPAWAKE_CLI, self.admission) != self.cli_sha or _hash(KEEPAWAKE_MODULE, self.admission) != self.module_sha:
            raise ContinuationError("keep-awake CLI or module changed since activation")
        code, heartbeat_detail = self._ps("-Heartbeat", "-Label", LEASE_LABEL, cancel=cancel)
        if code != 0:
            if cancel is not None and cancel.is_set() and not heartbeat_detail.startswith(b"owned-child-cleanup-unproven"):
                return {"healthy": False, "lease_healthy": False, "cancelled": True, "heartbeat_exit": code, "heartbeat_detail": heartbeat_detail.decode("utf-8", errors="replace")[:256], "status_exit": None}
            raise ContinuationError(f"keep-awake heartbeat command failed: {heartbeat_detail.decode('utf-8', errors='replace')[:256]}")
        if cancel is not None and cancel.is_set():
            return {"healthy": False, "lease_healthy": False, "cancelled": True, "heartbeat_exit": code, "heartbeat_detail": heartbeat_detail.decode("utf-8", errors="replace")[:256], "status_exit": None}
        status_code, out = self._ps("-Status", cancel=cancel)
        if status_code != 0:
            if cancel is not None and cancel.is_set() and not out.startswith(b"owned-child-cleanup-unproven"):
                return {"healthy": False, "lease_healthy": False, "cancelled": True, "heartbeat_exit": code, "status_exit": status_code}
            raise ContinuationError(f"keep-awake status command failed: {out.decode('utf-8', errors='replace')[:256]}")
        armed, supervisor, own_lease = _status_fields(out, self.owner_pid)
        if not own_lease:
            raise ContinuationError("root keep-awake pid-only lease is missing or invalid")
        return {"healthy": armed and supervisor, "lease_healthy": True, "armed": armed, "supervisor_alive": supervisor, "heartbeat_exit": code, "status_exit": status_code, "status_excerpt": out[:512].decode("utf-8", errors="replace")}


class ExecutionHeartbeat:
    """One bounded keep-awake worker; its failure is observed by the engine sampler."""

    def __init__(self, heartbeat: Callable[[threading.Event], dict[str, Any]], guard: Callable[[], None], interval: float = HEARTBEAT_MIN_INTERVAL_SECONDS, monotonic: Callable[[], float] = time.monotonic, unarmed_grace_seconds: float = EXECUTION_UNARMED_GRACE_SECONDS) -> None:
        self.heartbeat, self.guard, self.interval, self.monotonic = heartbeat, guard, interval, monotonic
        self.unarmed_grace_seconds = unarmed_grace_seconds
        self.stop_event = threading.Event()
        self.failure: BaseException | None = None
        self.last: dict[str, Any] | None = None
        self.thread = threading.Thread(target=self._run, name="figment-keepawake", daemon=True)

    def _run(self) -> None:
        unarmed_since: float | None = None
        while not self.stop_event.is_set():
            try:
                self.guard()
                result = self.heartbeat(self.stop_event)
                self.last = result
                if self.stop_event.is_set() or result.get("cancelled") is True:
                    return
                if result.get("lease_healthy") is not True:
                    raise ContinuationError("keep-awake lease is unhealthy during execution")
                if result.get("healthy") is True:
                    unarmed_since = None
                else:
                    now = self.monotonic()
                    if unarmed_since is None:
                        unarmed_since = now
                    if now - unarmed_since >= self.unarmed_grace_seconds:
                        raise ContinuationError("keep-awake global state did not recover during execution")
            except BaseException as exc:
                self.failure = exc
                return
            delay = self.interval
            if unarmed_since is not None:
                delay = min(delay, max(0.0, self.unarmed_grace_seconds - (self.monotonic() - unarmed_since)))
            self.stop_event.wait(delay)

    def start(self) -> None:
        self.thread.start()

    def close(self) -> None:
        self.stop_event.set()
        self.thread.join(HEARTBEAT_JOIN_SECONDS)
        if self.thread.is_alive():
            raise ContinuationError("keep-awake worker did not stop within bounded join")


class GuardedSampler:
    """Wraps Controller.sampler: cheap owner/STOP check, then delegate. Raises ResourceError so the engine tears down."""

    def __init__(self, inner: Callable[..., Any], guard: Guard, resource_error: type[BaseException], heartbeat_failure: Callable[[], BaseException | None] | None = None) -> None:
        self.inner, self.guard, self.resource_error, self.heartbeat_failure = inner, guard, resource_error, heartbeat_failure

    def __call__(self, owned: Any) -> Any:
        try:
            self.guard.owner_stop()
            if self.heartbeat_failure is not None:
                failure = self.heartbeat_failure()
                if failure is not None:
                    raise ContinuationError(f"keep-awake worker failed: {str(failure)[:256]}")
        except ContinuationError as exc:
            raise self.resource_error(f"continuation guard: {exc}") from exc
        return self.inner(owned)


def _read_activation(admission: types.ModuleType) -> dict[str, Any]:
    if STOP_PATH.exists():
        raise ContinuationError("MAIN/STOP present before activation")
    path = admission.safe(ACTIVATION_PATH, STUDIO_PRIVATE, "activation")
    data, _, _ = admission._read_bounded(path, MAX_ACTIVATION_BYTES)
    return admission._strict_loads(data, "activation")


def apply() -> dict[str, Any]:
    journal: Journal | None = None
    result: dict[str, Any]
    try:
        if Path(__file__).resolve() != SOURCE_PATH:
            raise ContinuationError("wrapper is not running from the fixed studio source path")
        runtime = _load_runtime()
        admission = runtime._load_admission()
        resources = runtime._load_checked(runtime.RESOURCES_REL, RESOURCES_SHA256)
        helper = runtime._load_checked(runtime.HELPER_REL, HELPER_SHA256)
        admission.safe(OUTER_ROOT, MAIN_PRIVATE, "continuation outer root")
        OUTER_ROOT.mkdir(exist_ok=False)
        journal = Journal(OUTER_ROOT / "journal.jsonl")
        source_sha = _hash(SOURCE_PATH, admission)
        cli_sha, module_sha = _hash(KEEPAWAKE_CLI, admission), _hash(KEEPAWAKE_MODULE, admission)
        document = _read_activation(admission)
        owner = validate_activation(document, owner_pid=None, source_sha256=source_sha, cli_sha256=cli_sha, module_sha256=module_sha)
        activation_sha = hashlib.sha256(admission.canonical(document)).hexdigest()
        guard = Guard(helper, admission, owner, activation_sha, source_sha, cli_sha, module_sha)
        guard()
        sampler = resources.WindowsSampler(helper)

        def write_admission(data: bytes, review: dict[str, Any]) -> None:
            admission.safe(admission.ADMISSION_PATH.parent, admission.STUDIO_PRIVATE, "admission root")
            admission.ADMISSION_PATH.parent.mkdir(parents=True, exist_ok=False)
            with admission.ADMISSION_PATH.open("xb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            full = {"schema": SCHEMA, "authorized_by": AUTHORIZED_BY, "activation_sha256": activation_sha, "wrapper_source_sha256": source_sha, "owner": owner, "keepawake_cli_sha256": cli_sha, "keepawake_module_sha256": module_sha, "conditional_root_authorization": "root-reviewed wrapper; admission written only after fresh evidence and three fresh floor passes", "not_promotable": True, **review}
            (admission.ADMISSION_PATH.parent / "root-review.json").write_text(json.dumps(full, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")

        def execute() -> tuple[Any, bytes]:
            guard()
            admitted = admission.validate_admission()
            code = admitted["evidence"]["code"]
            engine = runtime._load_checked(runtime.ENGINE_REL, code[runtime.ENGINE_REL]["sha256"])
            controller = runtime.Controller(admission, engine, resources, helper, admitted)
            heartbeat = Heartbeat(admission, cli_sha, module_sha, owner["pid"])
            guard()
            initial_lease = heartbeat()
            if initial_lease.get("lease_healthy") is not True:
                raise resources.ResourceError("continuation keep-awake lease is not valid before execution")
            keepalive = ExecutionHeartbeat(heartbeat, guard)
            controller.sampler = GuardedSampler(controller.sampler, guard, resources.ResourceError, lambda: keepalive.failure)
            keepalive.start()
            try:
                receipt = controller.run()
            finally:
                keepalive.close()
            guard()
            if keepalive.failure is not None:
                raise resources.ResourceError(f"continuation keep-awake failure: {str(keepalive.failure)[:256]}")
            receipt_path = admission.safe(admission.RUN_ROOT / "receipt.json", MAIN_PRIVATE, "runtime receipt")
            raw_receipt, _, _ = admission._read_bounded(receipt_path, admission.MAX_RECEIPT_BYTES)
            disk_receipt = admission._strict_loads(raw_receipt, "runtime receipt")
            if admission.canonical(disk_receipt) != admission.canonical(receipt):
                raise ContinuationError("receipt artifact does not match the returned controller receipt")
            return receipt, raw_receipt

        deps = Deps(monotonic=time.monotonic, sleep=time.sleep, guard=guard, sample=lambda: sampler({}), disk_free=lambda: shutil.disk_usage(MAIN_PRIVATE).free, preflight=resources.preflight, resource_error=resources.ResourceError, heartbeat=Heartbeat(admission, cli_sha, module_sha, owner["pid"]), admission_present=lambda: admission.RUN_ROOT.exists() or admission.ADMISSION_PATH.parent.exists(), build_evidence=admission.build_evidence, make_admission=admission.make_admission, canonical=admission.canonical, write_admission=write_admission, execute=execute, journal=journal, emit=print)
        result = Wrapper(deps).run()
        result["activation_sha256"] = activation_sha
    except BaseException as exc:
        result = {"schema": SCHEMA, "status": STATUS_FAILED, "execution_attempted": False, "not_promotable": True, "resource_timeout_count": 0, "errors": [{"class": type(exc).__name__, "message": str(exc)[:512]}], "utc": _utc()}
    if journal is not None:
        (OUTER_ROOT / "result.json").write_text(json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="delayed single-execution wrapper for the fixed local OmniGen2 reference run")
    parser.add_argument("--apply", action="store_true", help="wait for pinned floors, admit once, execute once")
    args = parser.parse_args(argv)
    if not args.apply:
        print(json.dumps({"schema": SCHEMA, "executing": False, "wait_seconds": WAIT_SECONDS, "max_samples": MAX_SAMPLES, "interval_seconds": INTERVAL_SECONDS, "max_preparation_attempts": MAX_PREPARATION_ATTEMPTS, "runtime_sha256": RUNTIME_SHA256, "outer_root": str(OUTER_ROOT), "activation": str(ACTIVATION_PATH)}, sort_keys=True))
        return 0
    result = apply()
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0 if result["status"] == STATUS_GENERATED else 1


if __name__ == "__main__":
    sys.exit(main())

"""Shared, policy-driven containment for local LoRA fit launchers.

This module intentionally knows nothing about a plan schema, a trainer recipe, or
whether an output is a probe or a quality diagnostic.  Callers must provide every
runtime limit and every permitted artifact through :class:`RunPolicy`.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable


class FitRuntimeError(ValueError):
    pass


@dataclass(frozen=True)
class ArtifactPolicy:
    name: str
    ss_steps: int


@dataclass(frozen=True)
class RunPolicy:
    output_prefix: str
    marker_namespace: str
    wall_seconds: int
    stream_bytes: int
    log_files: int
    checkpoint_bytes: int
    checkpoint_total_bytes: int
    artifacts: tuple[ArtifactPolicy, ...]

    def __post_init__(self) -> None:
        if (
            not self.output_prefix or not self.marker_namespace or self.wall_seconds <= 0
            or self.stream_bytes <= 1 or self.log_files < 2 or self.checkpoint_bytes < 10
            or self.checkpoint_total_bytes < self.checkpoint_bytes or not self.artifacts
        ):
            raise FitRuntimeError("run policy must declare positive closed limits")
        names = [artifact.name for artifact in self.artifacts]
        if len(names) != len(set(names)) or any(not artifact.name or artifact.ss_steps < 1 for artifact in self.artifacts):
            raise FitRuntimeError("run policy artifact allowlist is invalid")


@dataclass
class RuntimeResult:
    failure: str | None
    exit_code: int | None
    teardown: dict[str, Any]
    log_truncated: bool
    log_summary: dict[str, Any] | None


DTYPES = {
    "BOOL": 1, "U8": 1, "I8": 1, "U16": 2, "I16": 2,
    "U32": 4, "I32": 4, "U64": 8, "I64": 8, "F16": 2,
    "BF16": 2, "F32": 4, "F64": 8, "F8_E4M3FN": 1, "F8_E5M2": 1,
}
MAX_HEADER_BYTES = 1024 * 1024


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_reparse(path: Path) -> bool:
    try:
        record = path.lstat()
        return (
            stat.S_ISLNK(record.st_mode)
            or bool(getattr(record, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
            or bool(getattr(os.path, "isjunction", lambda _: False)(path))
        )
    except OSError as exc:
        raise FitRuntimeError("cannot inspect path") from exc


def safe(path: Path, root: Path, label: str) -> Path:
    path, root = Path(path).absolute(), Path(root).absolute()
    try:
        relative = path.relative_to(root)
    except ValueError as exc:
        raise FitRuntimeError(f"{label} escapes its fixed root") from exc
    if not root.is_dir() or is_reparse(root):
        raise FitRuntimeError(f"{label} root is unsafe")
    current = root
    for component in relative.parts:
        current /= component
        if not current.exists() or is_reparse(current):
            raise FitRuntimeError(f"{label} is missing or reparse-backed")
    try:
        resolved = current.resolve(strict=True)
        resolved.relative_to(root.resolve(strict=True))
    except (OSError, ValueError) as exc:
        raise FitRuntimeError(f"{label} resolves outside its fixed root") from exc
    return resolved


def bounded(path: Path, maximum: int, label: str, *, empty: bool = False) -> bytes:
    try:
        initial = path.lstat()
        if is_reparse(path) or not stat.S_ISREG(initial.st_mode):
            raise FitRuntimeError(f"{label} is not regular")
        before = path.stat()
        if before.st_size > maximum or (before.st_size < 1 and not empty):
            raise FitRuntimeError(f"{label} exceeds its byte bound")
        with path.open("rb") as handle:
            data = handle.read(maximum + 1)
        after = path.stat()
    except OSError as exc:
        raise FitRuntimeError(f"cannot read {label}") from exc
    if (
        len(data) != before.st_size or len(data) > maximum
        or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns
    ):
        raise FitRuntimeError(f"{label} changed while read")
    return data


def json_object(path: Path, maximum: int, label: str) -> tuple[dict[str, Any], bytes]:
    data = bounded(path, maximum, label)
    try:
        value = json.loads(data.decode())
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FitRuntimeError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise FitRuntimeError(f"{label} must be object")
    return value, data


def frozen(value: dict[str, Any], label: str, hex_pattern: Any) -> None:
    copy = dict(value)
    actual = copy.pop("frozen_sha256", None)
    expected = sha(json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode())
    if not isinstance(actual, str) or not hex_pattern.fullmatch(actual) or actual != expected:
        raise FitRuntimeError(f"{label} frozen hash is invalid")


def exclusive(path: Path, data: bytes) -> None:
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as exc:
        raise FitRuntimeError(f"cannot exclusively write {path.name}") from exc


def copy_checked(source: Path, target: Path, expected_sha: str, maximum: int, label: str) -> None:
    data = bounded(source, maximum, label)
    if sha(data) != expected_sha:
        raise FitRuntimeError(f"{label} changed")
    exclusive(target, data)
    if bounded(target, maximum, label) != data:
        raise FitRuntimeError(f"staged {label} changed")


def entries(directory: Path, maximum: int, label: str) -> list[os.DirEntry[str]]:
    result: list[os.DirEntry[str]] = []
    try:
        with os.scandir(directory) as scan:
            for entry in scan:
                if len(result) >= maximum:
                    raise FitRuntimeError(f"{label} entry bound")
                result.append(entry)
    except OSError as exc:
        raise FitRuntimeError(f"{label} unavailable") from exc
    return result


def _log_summary(root: Path, policy: RunPolicy) -> dict[str, Any]:
    found: list[dict[str, Any]] = []
    total = 0

    def walk(directory: Path, relative: Path, depth: int) -> None:
        nonlocal total
        if depth > 4:
            raise FitRuntimeError("log depth bound")
        for entry in entries(directory, policy.log_files, "log"):
            path = Path(entry.path)
            item = relative / entry.name
            if is_reparse(path):
                raise FitRuntimeError("log reparse")
            if entry.is_dir(follow_symlinks=False):
                walk(path, item, depth + 1)
            elif entry.is_file(follow_symlinks=False):
                data = bounded(path, policy.stream_bytes, "log", empty=True)
                total += len(data)
                found.append({"path": item.as_posix(), "bytes": len(data), "sha256": sha(data)})
                if len(found) > policy.log_files or total > policy.stream_bytes:
                    raise FitRuntimeError("log aggregate bound")
            else:
                raise FitRuntimeError("unsupported log member")

    walk(root, Path(), 0)
    if not {"stdout.log", "stderr.log"} <= {item["path"] for item in found}:
        raise FitRuntimeError("stream logs missing")
    return {"files": sorted(found, key=lambda item: item["path"]), "total_bytes": total}


def runtime_logs_within(root: Path, policy: RunPolicy) -> bool:
    pending = [root]
    count = total = 0
    while pending:
        directory = pending.pop()
        try:
            with os.scandir(directory) as scan:
                for entry in scan:
                    path = Path(entry.path)
                    count += 1
                    if count > policy.log_files or is_reparse(path):
                        return False
                    if entry.is_dir(follow_symlinks=False):
                        pending.append(path)
                    elif entry.is_file(follow_symlinks=False):
                        total += path.stat().st_size
                        if total > policy.stream_bytes:
                            return False
                    else:
                        return False
        except OSError:
            return False
    return True


def runtime_output_within(root: Path, policy: RunPolicy) -> bool:
    try:
        output = entries(root, len(policy.artifacts), "runtime output")
    except FitRuntimeError:
        return False
    permitted = {artifact.name for artifact in policy.artifacts}
    total = 0
    for entry in output:
        path = Path(entry.path)
        try:
            if entry.name not in permitted or not entry.is_file(follow_symlinks=False) or is_reparse(path):
                return False
            size = path.stat().st_size
            total += size
            if size > policy.checkpoint_bytes or total > policy.checkpoint_total_bytes:
                return False
        except OSError:
            return False
    return True


def _safetensors_header(path: Path, maximum: int) -> tuple[dict[str, Any], os.stat_result, int]:
    try:
        initial = path.lstat()
        if is_reparse(path) or not stat.S_ISREG(initial.st_mode):
            raise FitRuntimeError("checkpoint is not regular")
        before = path.stat()
        if not 10 <= before.st_size <= maximum:
            raise FitRuntimeError("final checkpoint bound")
        with path.open("rb") as handle:
            prefix = handle.read(8)
            if len(prefix) != 8:
                raise FitRuntimeError("safetensors header missing")
            header_bytes = int.from_bytes(prefix, "little")
            if header_bytes < 2 or header_bytes > MAX_HEADER_BYTES or header_bytes > before.st_size - 8:
                raise FitRuntimeError("safetensors header bound")
            header = handle.read(header_bytes)
    except OSError as exc:
        raise FitRuntimeError("cannot read final checkpoint") from exc
    try:
        value = json.loads(header.decode())
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FitRuntimeError("malformed safetensors header") from exc
    if not isinstance(value, dict):
        raise FitRuntimeError("malformed safetensors header")
    return value, before, header_bytes


def checkpoint(path: Path, expected_steps: int, maximum: int) -> dict[str, Any]:
    value, before, header_bytes = _safetensors_header(path, maximum)
    metadata = value.get("__metadata__")
    if not isinstance(metadata, dict) or str(metadata.get("ss_steps")) != str(expected_steps):
        raise FitRuntimeError("checkpoint lacks expected LoRA ss_steps")
    data_bytes = before.st_size - 8 - header_bytes
    ranges: list[tuple[int, int]] = []
    tensors = 0
    for name, tensor in value.items():
        if name == "__metadata__":
            continue
        offsets = tensor.get("data_offsets") if isinstance(tensor, dict) else None
        if (
            not isinstance(tensor, dict) or tensor.get("dtype") not in DTYPES
            or not isinstance(tensor.get("shape"), list)
            or not all(isinstance(dimension, int) and dimension >= 0 for dimension in tensor["shape"])
            or not isinstance(offsets, list) or len(offsets) != 2
            or not all(isinstance(offset, int) and offset >= 0 for offset in offsets)
            or offsets[0] > offsets[1] or offsets[1] > data_bytes
        ):
            raise FitRuntimeError("invalid safetensors tensor")
        elements = 1
        for dimension in tensor["shape"]:
            elements *= dimension
        if offsets[1] - offsets[0] != elements * DTYPES[tensor["dtype"]]:
            raise FitRuntimeError("safetensors tensor byte size disagrees with shape")
        ranges.append((offsets[0], offsets[1]))
        tensors += 1
    if not tensors:
        raise FitRuntimeError("no safetensors tensors")
    cursor = 0
    for start, end in sorted(ranges):
        if start != cursor:
            raise FitRuntimeError("safetensors tensor ranges are not contiguous")
        cursor = end
    if cursor != data_bytes:
        raise FitRuntimeError("safetensors tensor ranges do not cover data")
    digest = hashlib.sha256()
    seen = 0
    try:
        with path.open("rb") as handle:
            while block := handle.read(1024 * 1024):
                seen += len(block)
                if seen > maximum:
                    raise FitRuntimeError("final checkpoint bound")
                digest.update(block)
        after = path.stat()
    except OSError as exc:
        raise FitRuntimeError("cannot hash final checkpoint") from exc
    if seen != before.st_size or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
        raise FitRuntimeError("checkpoint changed")
    return {"path": path.name, "bytes": seen, "sha256": digest.hexdigest(), "ss_steps": expected_steps}


def checkpoints(root: Path, policy: RunPolicy) -> list[dict[str, Any]]:
    found = entries(root, len(policy.artifacts), "fit output")
    expected = {artifact.name: artifact for artifact in policy.artifacts}
    if len(found) != len(expected) or {entry.name for entry in found} != set(expected):
        raise FitRuntimeError("fit output artifact inventory is not exact")
    total = 0
    records = []
    for name in sorted(expected):
        entry = next(entry for entry in found if entry.name == name)
        path = Path(entry.path)
        if not entry.is_file(follow_symlinks=False) or is_reparse(path):
            raise FitRuntimeError("fit output is not a regular checkpoint")
        record = checkpoint(path, expected[name].ss_steps, policy.checkpoint_bytes)
        total += record["bytes"]
        if total > policy.checkpoint_total_bytes:
            raise FitRuntimeError("checkpoint aggregate bound")
        records.append(record)
    return records


def pump(stream: Any, path: Path, limit: int, state: dict[str, Any]) -> None:
    try:
        captured = 0
        with path.open("xb") as handle:
            while block := stream.read(65536):
                room = max(0, limit - captured)
                handle.write(block[:room])
                captured += min(room, len(block))
                state["truncated"] = state["truncated"] or len(block) > room
    except Exception as exc:
        state["reader_error"] = type(exc).__name__
    finally:
        try:
            stream.close()
        except Exception:
            state["reader_error"] = state.get("reader_error", "close")


def environment(root: Path, device: int) -> dict[str, str]:
    env = {key: os.environ[key] for key in ("SYSTEMROOT", "WINDIR", "COMSPEC", "PATH") if key in os.environ}
    home, temporary, cache = root / "home", root / "temp", root / "cache"
    for path in (home, temporary, cache, cache / "hf", cache / "torch", cache / "inductor", cache / "xdg", root / "appdata", root / "localappdata"):
        path.mkdir(exist_ok=True)
    env.update({
        "CUDA_VISIBLE_DEVICES": str(device), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        "DIFFUSERS_OFFLINE": "1", "PIP_NO_INDEX": "1", "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1", "HOME": str(home), "USERPROFILE": str(home),
        "APPDATA": str(root / "appdata"), "LOCALAPPDATA": str(root / "localappdata"),
        "TEMP": str(temporary), "TMP": str(temporary), "HF_HOME": str(cache / "hf"),
        "TRANSFORMERS_CACHE": str(cache / "hf"), "TORCH_HOME": str(cache / "torch"),
        "TORCHINDUCTOR_CACHE_DIR": str(cache / "inductor"), "XDG_CACHE_HOME": str(cache / "xdg"),
        "NO_PROXY": "*", "HTTP_PROXY": "", "HTTPS_PROXY": "",
    })
    return env


def run_owned(
    command: list[str], *, cwd: Path, environment_map: dict[str, str], root: Path,
    logs: Path, output: Path, policy: RunPolicy, ownership: Any,
    popen: Callable[..., Any] = subprocess.Popen, thread_factory: Callable[..., Any],
    deadline_seconds: int | None = None,
    monotonic: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep,
) -> RuntimeResult:
    """Run one direct wrapper and fail closed around its verified owned descendants."""
    if deadline_seconds is not None and deadline_seconds < 0:
        raise FitRuntimeError("runtime deadline cannot be negative")
    deadline = policy.wall_seconds if deadline_seconds is None else deadline_seconds
    started = monotonic()
    process = wrapper = None
    tracked: dict[Any, Any] = {}
    teardown: dict[str, Any] = {"verified_stopped": False}
    state: dict[str, Any] = {"truncated": False}
    threads: list[Any] = []
    started_threads: list[Any] = []
    failure: str | None = None
    exit_code: int | None = None
    try:
        process = popen(
            command, cwd=str(cwd), shell=False, env=environment_map, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        wrapper = ownership._process_identity(process.pid)
        if wrapper is None:
            raise FitRuntimeError("wrapper identity unavailable")
        tracked = {wrapper.pid: wrapper}
        threads = [
            thread_factory(target=pump, args=(process.stdout, logs / "stdout.log", policy.stream_bytes // 2, state), daemon=True),
            thread_factory(target=pump, args=(process.stderr, logs / "stderr.log", policy.stream_bytes // 2, state), daemon=True),
        ]
        for thread in threads:
            thread.start()
            started_threads.append(thread)
        while process.poll() is None and monotonic() - started < deadline and not state["truncated"] and not state.get("reader_error"):
            if not runtime_logs_within(logs, policy) or not runtime_output_within(output, policy):
                state["truncated"] = True
                break
            try:
                tracked = ownership._discover_owned_processes(wrapper, tracked)
            except Exception:
                if process.poll() is None:
                    raise
                break
            sleep(0.1)
        exit_code = process.poll()
        failure = "log-reader-failed" if state.get("reader_error") else "log-bound" if state["truncated"] else "deadline" if exit_code is None else "nonzero" if exit_code else None
    except Exception:
        failure = failure or "spawn-or-ownership-failed"
    finally:
        if process is not None and wrapper is None:
            try:
                process.terminate()
                process.wait(timeout=20)
                teardown = {"verified_stopped": False, "held_wrapper_only": True, "identity_unavailable": True, "unresolved_descendants": True}
            except Exception as exc:
                teardown = {"verified_stopped": False, "held_wrapper_only": True, "identity_unavailable": True, "unresolved_cleanup": type(exc).__name__}
        elif wrapper is not None:
            try:
                teardown = ownership._teardown(wrapper, tracked, process)
            except Exception as exc:
                teardown = {"verified_stopped": False, "error_class": type(exc).__name__}
        if process is not None:
            try:
                exit_code = process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                failure = failure or "wrapper-wait-timeout"
    for thread in started_threads:
        try:
            thread.join(5)
            if thread.is_alive():
                state["reader_error"] = "join-timeout"
        except Exception as exc:
            state["reader_error"] = type(exc).__name__
    if state["truncated"]:
        failure = failure or "log-bound"
    if state.get("reader_error"):
        failure = failure or "log-reader-failed"
    if not teardown.get("verified_stopped"):
        failure = failure or "teardown-unverified"
    try:
        summary = _log_summary(logs, policy)
    except FitRuntimeError:
        summary = None
        failure = failure or "logs-invalid"
    return RuntimeResult(failure, exit_code, teardown, bool(state["truncated"]), summary)

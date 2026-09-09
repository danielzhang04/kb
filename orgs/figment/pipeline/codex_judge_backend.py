"""Standalone, diagnostic-only Codex vision judge backend.

This module intentionally has no dependency on the active Figment judge or gate.  It
attaches already validated images to ``codex exec`` and returns a payload or an
unavailable record; it never returns a gate pass or writes a cache.
"""
from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

PROTOCOL_VERSION = "codex-vision-backend-v1"
RESULT_SCHEMA = "figment/codex-judge-diagnostic@1"
MAX_IMAGE_COUNT = 8
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PROMPT_BYTES = 16 * 1024
MAX_RESPONSE_BYTES = 32 * 1024
MAX_STDOUT_BYTES = 256 * 1024
MAX_STDERR_BYTES = 64 * 1024
MAX_NOTES_CHARS = 1200
MODEL_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
# Explicit per-call config: do not read project instructions or enable shell/web tools.
HARDENED_CONFIG: tuple[str, ...] = (
    "project_doc_max_bytes=0",
    "features.shell_tool=false",
    'web_search="disabled"',
)

PAYLOAD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "same_person", "apparent_age_reference", "apparent_age_candidate",
        "skin_realism", "gloss", "artifacts", "notes",
    ],
    "properties": {
        "same_person": {"type": "number", "minimum": 0, "maximum": 100},
        "apparent_age_reference": {"type": "number", "minimum": 0, "maximum": 120},
        "apparent_age_candidate": {"type": "number", "minimum": 0, "maximum": 120},
        "skin_realism": {"type": "number", "minimum": 0, "maximum": 100},
        "gloss": {"type": "number", "minimum": 0, "maximum": 100},
        "artifacts": {"type": "number", "minimum": 0, "maximum": 100},
        "notes": {"type": "string", "maxLength": MAX_NOTES_CHARS},
    },
}


@dataclass(frozen=True)
class CodexJudgeRequest:
    candidate: Path
    references: Sequence[Path]
    prompt: str
    prompt_version: str
    requested_model: str
    work_root: Path
    timeout_seconds: float
    executable: Path | None = None


class CodexJudgeError(RuntimeError):
    """Bad local request or unavailable diagnostic runner."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_reparse(path: Path) -> bool:
    try:
        info = path.lstat()
    except OSError:
        return True
    attributes = getattr(info, "st_file_attributes", 0)
    return stat.S_ISLNK(info.st_mode) or bool(attributes & 0x400)


def _require_direct_ancestors(path: Path, *, label: str) -> None:
    """Reject every lexical ancestor junction/symlink before resolving the path."""
    cursor = path.absolute()
    while True:
        if _is_reparse(cursor):
            raise CodexJudgeError(f"{label} path contains a reparse point")
        if cursor.parent == cursor:
            return
        cursor = cursor.parent


def _require_regular(path: Path, *, limit: int) -> tuple[Path, int, str]:
    _require_direct_ancestors(path, label="image")
    resolved = path.resolve(strict=True)
    _require_direct_ancestors(resolved, label="image")
    if not resolved.is_absolute():
        raise CodexJudgeError("image path is not a direct regular file")
    info = resolved.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size < 1 or info.st_size > limit:
        raise CodexJudgeError("image size or file type is outside the fixed bounds")
    return resolved, info.st_size, _sha256_file(resolved)


def _require_fresh_work_root(path: Path) -> Path:
    root = path.absolute()
    if root.exists():
        raise CodexJudgeError("work root must be a fresh child of a direct directory")
    _require_direct_ancestors(root.parent, label="work root")
    root.mkdir(mode=0o700)
    if _is_reparse(root):
        raise CodexJudgeError("work root became a reparse point")
    return root.resolve(strict=True)


def resolve_native_codex(executable: Path | None = None) -> Path:
    """Resolve only the native ``codex.exe`` binary; never use .cmd/.ps1 wrappers."""
    candidate = executable
    if candidate is None:
        found = shutil.which("codex.exe")
        if found is None:
            raise CodexJudgeError("native codex.exe is not on PATH")
        candidate = Path(found)
    supplied = Path(candidate)
    _require_direct_ancestors(supplied, label="executable")
    resolved = supplied.resolve(strict=True)
    _require_direct_ancestors(resolved, label="executable")
    if resolved.name.casefold() != "codex.exe":
        raise CodexJudgeError("executable must resolve to a direct native codex.exe")
    if not resolved.is_file():
        raise CodexJudgeError("native codex executable is not a file")
    return resolved


def _clean_env() -> dict[str, str]:
    allowed = (
        "APPDATA", "CODEX_HOME", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "HOME",
        "LOCALAPPDATA", "PATH", "PATHEXT", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
    )
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def _build_argv(executable: Path, request: CodexJudgeRequest, schema_path: Path, output_path: Path) -> list[str]:
    images = [*request.references, request.candidate]
    argv = [str(executable), "exec", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only", "--skip-git-repo-check",
            "-c", 'model_reasoning_effort="low"']
    for setting in HARDENED_CONFIG:
        argv.extend(["-c", setting])
    argv.extend(["--model", request.requested_model])
    for image in images:
        argv.extend(["--image", str(image)])
    argv.extend(["--output-schema", str(schema_path), "--output-last-message", str(output_path), "-"])
    return argv


def _safe_argv_protocol(request: CodexJudgeRequest) -> list[str]:
    argv = ["exec", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only", "--skip-git-repo-check",
            "-c", 'model_reasoning_effort="low"']
    for setting in HARDENED_CONFIG:
        argv.extend(["-c", setting])
    return [*argv, "--model", request.requested_model,
            *(item for pair in (("--image", f"<reference-{index}>") for index, _ in enumerate(request.references, 1)) for item in pair),
            "--image", "<candidate>", "--output-schema", "<schema>", "--output-last-message", "<result>", "-"]


def _read_bounded(stream: Any, limit: int, sink: list[bytes], overflow: threading.Event) -> None:
    try:
        while True:
            chunk = stream.read(8192)
            if not chunk:
                break
            remaining = limit - sum(len(part) for part in sink)
            if remaining <= 0:
                overflow.set()
                continue
            sink.append(chunk[:remaining])
            if len(chunk) > remaining:
                overflow.set()
    finally:
        try:
            stream.close()
        except OSError:
            pass


class _LARGE_INTEGER(ctypes.Structure):
    _fields_ = [("QuadPart", ctypes.c_longlong)]


class _JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", _LARGE_INTEGER), ("PerJobUserTimeLimit", _LARGE_INTEGER),
        ("LimitFlags", ctypes.c_uint32), ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_uint32),
        ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_uint32), ("SchedulingClass", ctypes.c_uint32),
    ]


class _IO_COUNTERS(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class _JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", _JOBOBJECT_BASIC_LIMIT_INFORMATION), ("IoInfo", _IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]


class _WindowsJob:
    """Kill every process assigned to this private job when the handle closes."""
    KILL_ON_CLOSE = 0x00002000
    EXTENDED_LIMIT_INFORMATION = 9

    def __init__(self) -> None:
        if os.name != "nt":
            raise CodexJudgeError("Windows job requested on a non-Windows host")
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        handle, boolean, dword = ctypes.c_void_p, ctypes.c_int, ctypes.c_uint32
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
        self.kernel.CreateJobObjectW.restype = handle
        self.kernel.SetInformationJobObject.argtypes = [handle, dword, ctypes.c_void_p, dword]
        self.kernel.SetInformationJobObject.restype = boolean
        self.kernel.AssignProcessToJobObject.argtypes = [handle, handle]
        self.kernel.AssignProcessToJobObject.restype = boolean
        self.kernel.CloseHandle.argtypes = [handle]
        self.kernel.CloseHandle.restype = boolean
        self.handle = self.kernel.CreateJobObjectW(None, None)
        self.assigned = False
        if not self.handle:
            raise CodexJudgeError("could not create owned Windows job")
        info = _JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = self.KILL_ON_CLOSE
        if not self.kernel.SetInformationJobObject(self.handle, self.EXTENDED_LIMIT_INFORMATION, ctypes.byref(info), ctypes.sizeof(info)):
            self.close()
            raise CodexJudgeError("could not set KILL_ON_JOB_CLOSE")

    def assign(self, process: subprocess.Popen[bytes]) -> None:
        process_handle = ctypes.c_void_p(int(process._handle))  # type: ignore[attr-defined]
        if not self.kernel.AssignProcessToJobObject(self.handle, process_handle):
            self.close()
            raise CodexJudgeError("could not assign private supervisor to Windows job")
        self.assigned = True

    def close(self) -> None:
        if getattr(self, "handle", None):
            self.kernel.CloseHandle(self.handle)
            self.handle = None


_SUPERVISOR = r'''import base64,json,subprocess,sys
packet=json.loads(sys.stdin.buffer.read().decode("utf-8"))
child=subprocess.Popen(packet["argv"], cwd=packet["cwd"], env=packet["env"], stdin=subprocess.PIPE, stdout=sys.stdout.buffer, stderr=sys.stderr.buffer)
try:
    assert child.stdin is not None
    child.stdin.write(base64.b64decode(packet["prompt_b64"]))
    child.stdin.close()
    raise SystemExit(child.wait())
except BaseException:
    child.kill()
    child.wait()
    raise
'''


def _terminate_owned_tree(process: subprocess.Popen[bytes], job: _WindowsJob | None) -> None:
    if job is not None and getattr(job, "assigned", False):
        job.close()
    elif process.poll() is not None:
        return
    elif os.name == "nt":
        system_root = os.environ.get("SYSTEMROOT", r"C:\Windows")
        try:
            subprocess.run([str(Path(system_root) / "System32" / "taskkill.exe"), "/PID", str(process.pid), "/T", "/F"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False)
        except OSError:
            process.kill()
    else:
        process.kill()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def _write_stdin(process: subprocess.Popen[bytes], data: bytes, complete: threading.Event) -> None:
    try:
        assert process.stdin is not None
        process.stdin.write(data)
        process.stdin.close()
    except (BrokenPipeError, OSError):
        pass
    finally:
        complete.set()


def _run_bounded(argv: list[str], prompt: bytes, *, cwd: Path, timeout: float, popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen) -> tuple[int | None, bytes, bytes, str | None]:
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0
    env = _clean_env()
    job: _WindowsJob | None = None
    supervised = os.name == "nt" and popen is subprocess.Popen
    if supervised:
        process = None
        try:
            process = popen([sys.executable, "-c", _SUPERVISOR], cwd=str(cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, creationflags=flags)
            job = _WindowsJob()
            job.assign(process)
        except Exception:
            if process is not None:
                _terminate_owned_tree(process, job)
            raise
        packet = json.dumps({"argv": argv, "cwd": str(cwd), "env": env, "prompt_b64": base64.b64encode(prompt).decode("ascii")}).encode("utf-8")
    else:
        process = popen(argv, cwd=str(cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, creationflags=flags)
        packet = prompt
    stdout: list[bytes] = []
    stderr: list[bytes] = []
    overflow = threading.Event()
    readers = [threading.Thread(target=_read_bounded, args=(process.stdout, MAX_STDOUT_BYTES, stdout, overflow), daemon=True), threading.Thread(target=_read_bounded, args=(process.stderr, MAX_STDERR_BYTES, stderr, overflow), daemon=True)]
    for reader in readers:
        reader.start()
    written = threading.Event()
    writer = threading.Thread(target=_write_stdin, args=(process, packet, written), daemon=True)
    writer.start()
    deadline = time.monotonic() + timeout
    status: str | None = None
    while process.poll() is None:
        if overflow.is_set():
            status = "cli stream exceeded fixed output bounds"
            _terminate_owned_tree(process, job)
            job = None
            break
        if time.monotonic() >= deadline:
            status = "codex process exceeded timeout and its owned process tree was terminated"
            _terminate_owned_tree(process, job)
            job = None
            break
        time.sleep(0.01)
    if overflow.is_set() and status is None:
        status = "cli stream exceeded fixed output bounds"
    if job is not None:
        # A supervisor that exits while a child survives is not a successful call.
        # Closing the job also releases inherited stdout/stderr handles before joins.
        job.close()
        job = None
    writer.join(timeout=5)
    if not written.is_set() and status is None:
        status = "stdin writer did not complete before process exit"
    for reader in readers:
        reader.join(timeout=5)
    if overflow.is_set():
        status = status or "cli stream exceeded fixed output bounds"
    if any(reader.is_alive() for reader in readers):
        status = status or "cli stream reader did not close"
    if job is not None:
        job.close()
    return process.returncode, b"".join(stdout), b"".join(stderr), status


def _stage_image(source: Path, destination: Path, *, expected_size: int, expected_sha: str) -> Path:
    digest = hashlib.sha256()
    with source.open("rb") as reader, destination.open("xb") as writer:
        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
            digest.update(chunk)
            writer.write(chunk)
    if destination.stat().st_size != expected_size or digest.hexdigest() != expected_sha or _sha256_file(source) != expected_sha:
        raise CodexJudgeError("source image changed during staging")
    try:
        from PIL import Image
        with Image.open(destination) as image:
            image.verify()
    except Exception as exc:
        raise CodexJudgeError("image cannot be decoded for explicit attachment") from exc
    return destination


def _validate_payload(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or set(value) != set(PAYLOAD_SCHEMA["required"]):
        return None
    payload: dict[str, Any] = {}
    for name in ("same_person", "skin_realism", "gloss", "artifacts"):
        value_at = value.get(name)
        if isinstance(value_at, bool) or not isinstance(value_at, (int, float)) or not math.isfinite(value_at) or not 0 <= value_at <= 100:
            return None
        payload[name] = float(value_at)
    for name in ("apparent_age_reference", "apparent_age_candidate"):
        value_at = value.get(name)
        if isinstance(value_at, bool) or not isinstance(value_at, (int, float)) or not math.isfinite(value_at) or not 0 <= value_at <= 120:
            return None
        payload[name] = float(value_at)
    notes = value.get("notes")
    if not isinstance(notes, str) or len(notes) > MAX_NOTES_CHARS:
        return None
    payload["notes"] = notes
    return payload


def _cleanup_work_root(root: Path) -> None:
    last: OSError | None = None
    for _ in range(10):
        try:
            shutil.rmtree(root)
            return
        except OSError as exc:
            last = exc
            time.sleep(0.1)
    raise CodexJudgeError("fresh work-root cleanup failed") from last


def _result(provenance: dict[str, Any], *, payload: dict[str, Any] | None = None,
            unavailable: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"schema": RESULT_SCHEMA, "backend": "codex-exec", "provenance": provenance,
                              "payload": payload, "unavailable": unavailable}
    return result


def run_codex_judge(request: CodexJudgeRequest, *,
                    popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen) -> dict[str, Any]:
    """Execute one diagnostic Codex judge request, returning payload or unavailable.

    The caller owns eventual gate integration. This function neither caches nor decides a
    pass/fail outcome. Its fresh work root is removed on every exit; a removal failure
    overrides an otherwise successful payload with an unavailable result.
    """
    started = time.monotonic()
    base: dict[str, Any] = {"protocol": PROTOCOL_VERSION, "requested_model": None,
                            "responding_model": None, "responding_model_status": "unreported",
                            "prompt_version": None, "prompt_sha256": None, "schema_sha256": None,
                            "cache_key": None, "argv": [], "duration_s": None, "executable": None,
                            "exec_version": None, "image_count": 0, "images": []}
    root: Path | None = None
    result: dict[str, Any]
    try:
        if (not isinstance(request, CodexJudgeRequest)
                or not isinstance(request.prompt, str)
                or not isinstance(request.prompt_version, str)
                or not isinstance(request.requested_model, str)
                or not isinstance(request.candidate, (str, os.PathLike))
                or not isinstance(request.work_root, (str, os.PathLike))
                or (request.executable is not None and not isinstance(request.executable, (str, os.PathLike)))
                or isinstance(request.references, (str, bytes))
                or not isinstance(request.references, Sequence)
                or not all(isinstance(image, (str, os.PathLike)) for image in request.references)):
            raise CodexJudgeError("request fields have invalid types")
        base.update({"requested_model": request.requested_model, "prompt_version": request.prompt_version,
                     "prompt_sha256": hashlib.sha256(request.prompt.encode("utf-8")).hexdigest(),
                     "schema_sha256": hashlib.sha256(json.dumps(PAYLOAD_SCHEMA, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest(),
                     "argv": _safe_argv_protocol(request)})
        if not request.prompt.strip() or len(request.prompt.encode("utf-8")) > MAX_PROMPT_BYTES:
            raise CodexJudgeError("prompt is empty or exceeds the fixed bound")
        if not isinstance(request.prompt_version, str) or not request.prompt_version or len(request.prompt_version) > 64:
            raise CodexJudgeError("prompt version is invalid")
        if not MODEL_RE.fullmatch(request.requested_model) or isinstance(request.timeout_seconds, bool) or not isinstance(request.timeout_seconds, (int, float)) or not math.isfinite(request.timeout_seconds) or request.timeout_seconds <= 0 or request.timeout_seconds > 600:
            raise CodexJudgeError("model or timeout is invalid")
        if not request.references or len(request.references) + 1 > MAX_IMAGE_COUNT:
            raise CodexJudgeError("reference image count is outside the fixed bounds")
        checked = [_require_regular(Path(image), limit=MAX_IMAGE_BYTES) for image in [*request.references, request.candidate]]
        base["image_count"] = len(checked)
        base["images"] = [{"role": "reference" if index < len(request.references) else "candidate", "sha256": digest, "bytes": size}
                          for index, (_path, size, digest) in enumerate(checked)]
        base["cache_key"] = hashlib.sha256(json.dumps({"protocol": PROTOCOL_VERSION, "model": request.requested_model,
            "schema": base["schema_sha256"], "prompt": base["prompt_sha256"], "prompt_version": request.prompt_version, "images": [item[2] for item in checked]}, sort_keys=True).encode("utf-8")).hexdigest()
        executable = resolve_native_codex(request.executable)
        base["executable"] = {"name": executable.name, "sha256": _sha256_file(executable)}
        root = _require_fresh_work_root(Path(request.work_root))
        schema_path, output_path = root / "response.schema.json", root / "response.json"
        schema_path.write_text(json.dumps(PAYLOAD_SCHEMA, sort_keys=True), encoding="utf-8")
        staged_paths = []
        for index, (source, size, digest) in enumerate(checked):
            role = "reference" if index < len(request.references) else "candidate"
            staged_paths.append(_stage_image(source, root / f"{role}-{index + 1:02d}{source.suffix.lower()}", expected_size=size, expected_sha=digest))
        safe_request = CodexJudgeRequest(candidate=staged_paths[-1], references=staged_paths[:-1], prompt=request.prompt,
                                         prompt_version=request.prompt_version, requested_model=request.requested_model,
                                         work_root=root, timeout_seconds=float(request.timeout_seconds), executable=executable)
        returncode, _stdout, _stderr, terminal = _run_bounded(_build_argv(executable, safe_request, schema_path, output_path),
                                                                request.prompt.encode("utf-8"), cwd=root,
                                                                timeout=float(request.timeout_seconds), popen=popen)
        base["duration_s"] = round(time.monotonic() - started, 6)
        if terminal is not None:
            result = _result(base, unavailable=terminal)
        elif returncode != 0:
            result = _result(base, unavailable="codex CLI exited nonzero")
        elif not output_path.exists() or _is_reparse(output_path) or output_path.stat().st_size > MAX_RESPONSE_BYTES:
            result = _result(base, unavailable="codex response is missing, unsafe, or exceeds the fixed bound")
        else:
            try:
                payload = _validate_payload(json.loads(output_path.read_text(encoding="utf-8")))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                payload = None
            result = _result(base, payload=payload) if payload is not None else _result(
                base, unavailable="codex response does not satisfy the fixed judge payload schema")
    except (CodexJudgeError, OSError, ValueError) as exc:
        base["duration_s"] = round(time.monotonic() - started, 6)
        result = _result(base, unavailable=f"local validation failed: {type(exc).__name__}")
    finally:
        if root is not None:
            try:
                _cleanup_work_root(root)
            except (CodexJudgeError, OSError):
                base["duration_s"] = round(time.monotonic() - started, 6)
                result = _result(base, unavailable="fresh work-root cleanup failed")
    return result

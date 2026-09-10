"""Synthetic-only private structured-turn executor for Codex CLI capability tests.

This module deliberately has no live-provider entrypoint.  It accepts one frozen
synthetic envelope and talks only to a code-owned loopback fixture provider.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import ctypes
from ctypes import wintypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
from threading import Event, Thread
from types import MappingProxyType
from typing import Callable, Mapping

from jsonschema import SchemaError, ValidationError
from jsonschema.validators import validator_for

from scripts.prospecting.manager.bridge import _require_plain_directory_tree
from scripts.prospecting.store import resolve_store_path


INPUT_CANARY = "PRIVATE_RUNTIME_INPUT_CANARY_4D82B3A1"
OUTPUT_CANARY = "PRIVATE_RUNTIME_OUTPUT_CANARY_6CA92F10"
ERROR_CANARY = "PRIVATE_RUNTIME_ERROR_CANARY_18F2D74B"

SYNTHETIC_INPUT = json.dumps(
    {"kind": "synthetic_private_runtime_probe", "canary": INPUT_CANARY},
    sort_keys=True,
    separators=(",", ":"),
).encode()
SYNTHETIC_SCHEMA = json.dumps(
    {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": ["result", "canary_seen", "output_canary"],
        "properties": {
            "result": {"const": "synthetic_ok"},
            "canary_seen": {"const": True},
            "output_canary": {"const": OUTPUT_CANARY},
        },
    },
    sort_keys=True,
    separators=(",", ":"),
).encode()
SYNTHETIC_SKILL = b"Synthetic probe only. Return JSON matching the supplied schema."

_SCENARIOS = frozenset(
    {
        "success",
        "provider_error_canary",
        "request_user_input_call",
        "malformed_output",
        "oversized_output",
        "schema_mismatch",
        "stall",
    }
)
_ID = re.compile(r"[a-z][a-z0-9-]{1,63}")
_SHA = re.compile(r"[0-9a-f]{64}")
_MAX_INPUT = 65_536
_MAX_SCHEMA = 32_768
_MAX_SKILL = 32_768
_MAX_OUTPUT_CAP = 65_536
# Room for the current 1 MiB P16 stage input plus its skill and JSON envelope.
_MAX_PINNED_STDIN = 1_310_720
_MODEL = "synthetic-model"
_PROVIDER = "loopback"
_ALLOWED_TOOL = "request_user_input"
_CLI_RELATIVE = Path(
    "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/"
    "vendor/x86_64-pc-windows-msvc/bin/codex.exe"
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            while chunk := source.read(1_048_576):
                digest.update(chunk)
    except OSError:
        raise PrivateRuntimeError("codex_unavailable") from None
    return digest.hexdigest()


@dataclass(frozen=True)
class SkillBinding:
    name: str
    version: str
    content_sha256: str
    manifest_sha256: str


@dataclass(frozen=True)
class TurnBinding:
    job_id: str
    attempt_id: str
    attempt_token: str
    run_id: str
    stage: str
    workflow_id: str
    workflow_version: str
    workflow_hash: str
    input_sha256: str
    schema_sha256: str
    skill: SkillBinding
    runtime_config_sha256: str


@dataclass(frozen=True)
class SyntheticTurnRequest:
    binding: TurnBinding
    input_json: bytes = field(repr=False)
    output_schema_json: bytes = field(repr=False)
    skill_bytes: bytes = field(repr=False)
    deadline_seconds: int = 20
    max_output_bytes: int = 65_536
    scenario: str = "success"


@dataclass(frozen=True)
class RuntimeIdentity:
    executable_sha256: str
    cli_version: str
    model: str
    provider: str


@dataclass(frozen=True)
class PrivateTurnResult:
    binding: TurnBinding
    status: str
    code: str
    output: bytes | None = field(default=None, repr=False)
    output_sha256: str | None = None
    runtime_identity: RuntimeIdentity | None = None
    elapsed_ms: int = 0
    cleanup_state: str = "not_started"
    declared_tools: tuple[str, ...] = ()
    sink_canary_paths: Mapping[str, tuple[str, ...]] = field(
        default_factory=lambda: MappingProxyType({})
    )


class PrivateRuntimeError(ValueError):
    """Fixed-code request/configuration rejection with no sensitive rendering."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _runtime_config(port: int) -> tuple[str, ...]:
    return (
        'model_provider="loopback"',
        'model_providers.loopback.name="Synthetic loopback"',
        f'model_providers.loopback.base_url="http://127.0.0.1:{port}/v1"',
        'model_providers.loopback.wire_api="responses"',
        "model_providers.loopback.requires_openai_auth=false",
        "model_providers.loopback.request_max_retries=0",
        "model_providers.loopback.stream_max_retries=0",
        "model_context_window=8192",
        'web_search="disabled"',
        "tools.web_search=false",
        "features.shell_tool=false",
        "features.unified_exec=false",
        "features.apps=false",
        "features.skill_mcp_dependency_install=false",
        "features.code_mode.enabled=false",
        "features.multi_agent=false",
        "features.default_mode_request_user_input=false",
        "features.request_permissions_tool=false",
        "features.collaboration_modes=false",
        "features.view_image=false",
        "features.skill_search=false",
        "features.plugins=false",
        "features.skip_host_skill_discovery=true",
        "features.browser_use=false",
        "features.computer_use=false",
        "features.image_generation=false",
        "features.tool_suggest=false",
        "features.hooks=false",
        "features.goals=false",
        "features.sleep_tool=false",
        "features.auth_elicitation=false",
        "features.tool_call_mcp_elicitation=false",
        "apps._default.enabled=false",
        "memories.generate_memories=false",
        "feedback.enabled=false",
        'otel.exporter="none"',
        'otel.trace_exporter="none"',
        'otel.metrics_exporter="none"',
        "otel.log_user_prompt=false",
        "check_for_update_on_startup=false",
        'cli_auth_credentials_store="ephemeral"',
        "project_doc_max_bytes=0",
        'shell_environment_policy.inherit="none"',
        "hide_agent_reasoning=true",
        "notify=[]",
    )


def _config_identity() -> str:
    # The port is deliberately normalized because it is an ephemeral transport detail.
    return _sha("\n".join(_runtime_config(0)).encode())


def build_synthetic_request(
    *,
    job_id: str,
    attempt_id: str,
    attempt_token: str,
    run_id: str,
    workflow_id: str,
    workflow_version: str,
    workflow_hash: str,
    scenario: str = "success",
    deadline_seconds: int = 20,
    max_output_bytes: int = 65_536,
) -> SyntheticTurnRequest:
    """Build the only accepted envelope; callers cannot supply arbitrary content."""
    skill = SkillBinding(
        name="synthetic-private-runtime",
        version="v1",
        content_sha256=_sha(SYNTHETIC_SKILL),
        manifest_sha256=_sha(b"synthetic-private-runtime:v1"),
    )
    binding = TurnBinding(
        job_id=job_id,
        attempt_id=attempt_id,
        attempt_token=attempt_token,
        run_id=run_id,
        stage="synthetic-private-runtime",
        workflow_id=workflow_id,
        workflow_version=workflow_version,
        workflow_hash=workflow_hash,
        input_sha256=_sha(SYNTHETIC_INPUT),
        schema_sha256=_sha(SYNTHETIC_SCHEMA),
        skill=skill,
        runtime_config_sha256=_config_identity(),
    )
    request = SyntheticTurnRequest(
        binding=binding,
        input_json=SYNTHETIC_INPUT,
        output_schema_json=SYNTHETIC_SCHEMA,
        skill_bytes=SYNTHETIC_SKILL,
        deadline_seconds=deadline_seconds,
        max_output_bytes=max_output_bytes,
        scenario=scenario,
    )
    _validate_request(request)
    return request


def _valid_id(value: object) -> bool:
    return isinstance(value, str) and _ID.fullmatch(value) is not None


def _valid_sha(value: object) -> bool:
    return isinstance(value, str) and _SHA.fullmatch(value) is not None


def _validate_request(request: SyntheticTurnRequest) -> None:
    if not isinstance(request, SyntheticTurnRequest):
        raise PrivateRuntimeError("invalid_request")
    binding = request.binding
    if not isinstance(binding, TurnBinding) or not isinstance(binding.skill, SkillBinding):
        raise PrivateRuntimeError("invalid_binding")
    if not all(
        _valid_id(value)
        for value in (
            binding.job_id,
            binding.attempt_id,
            binding.attempt_token,
            binding.run_id,
            binding.stage,
            binding.workflow_id,
            binding.workflow_version,
            binding.skill.name,
            binding.skill.version,
        )
    ):
        raise PrivateRuntimeError("invalid_binding")
    if not all(
        _valid_sha(value)
        for value in (
            binding.workflow_hash,
            binding.input_sha256,
            binding.schema_sha256,
            binding.skill.content_sha256,
            binding.skill.manifest_sha256,
            binding.runtime_config_sha256,
        )
    ):
        raise PrivateRuntimeError("invalid_binding")
    if not isinstance(request.scenario, str) or request.scenario not in _SCENARIOS:
        raise PrivateRuntimeError("invalid_scenario")
    if type(request.deadline_seconds) is not int or not 1 <= request.deadline_seconds <= 120:
        raise PrivateRuntimeError("invalid_deadline")
    if type(request.max_output_bytes) is not int or not 1 <= request.max_output_bytes <= _MAX_OUTPUT_CAP:
        raise PrivateRuntimeError("invalid_output_limit")
    if (
        not isinstance(request.input_json, bytes)
        or len(request.input_json) > _MAX_INPUT
        or request.input_json != SYNTHETIC_INPUT
        or binding.input_sha256 != _sha(request.input_json)
    ):
        raise PrivateRuntimeError("synthetic_input_required")
    if (
        not isinstance(request.output_schema_json, bytes)
        or len(request.output_schema_json) > _MAX_SCHEMA
        or request.output_schema_json != SYNTHETIC_SCHEMA
        or binding.schema_sha256 != _sha(request.output_schema_json)
    ):
        raise PrivateRuntimeError("synthetic_schema_required")
    if (
        not isinstance(request.skill_bytes, bytes)
        or len(request.skill_bytes) > _MAX_SKILL
        or request.skill_bytes != SYNTHETIC_SKILL
        or binding.skill.content_sha256 != _sha(request.skill_bytes)
    ):
        raise PrivateRuntimeError("synthetic_skill_required")
    if binding.runtime_config_sha256 != _config_identity():
        raise PrivateRuntimeError("runtime_config_mismatch")
    try:
        schema = json.loads(request.output_schema_json)
        validator_for(schema).check_schema(schema)
    except (UnicodeDecodeError, json.JSONDecodeError, SchemaError):
        raise PrivateRuntimeError("invalid_schema") from None


def _is_link_or_reparse(path: Path) -> bool:
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & 0x400
    )


def _desktop_root(environ: Mapping[str, str]) -> Path:
    local = environ.get("LOCALAPPDATA")
    if not local:
        raise PrivateRuntimeError("desktop_context_missing")
    desktop = (Path(local) / "kb-prospecting").resolve()
    store = resolve_store_path(environ).resolve()
    if store != desktop and desktop not in store.parents:
        raise PrivateRuntimeError("private_root_invalid")
    return desktop


def _prepare_attempt(request: SyntheticTurnRequest, environ: Mapping[str, str]) -> tuple[Path, Path]:
    desktop = _desktop_root(environ)
    root = desktop / "snapshots" / "private-runtime"
    attempt: Path | None = None
    created = False
    try:
        desktop.mkdir(parents=True, exist_ok=True)
        _require_plain_directory_tree(desktop)
        root.mkdir(parents=True, exist_ok=True)
        _require_plain_directory_tree(root)
        attempt = root / request.binding.attempt_id
        attempt.mkdir(mode=0o700)
        created = True
        _require_plain_directory_tree(attempt)
        if attempt.parent.resolve() != root.resolve() or _is_link_or_reparse(attempt):
            raise OSError
        runtime_home = attempt / "runtime-home"
        runtime_home.mkdir(mode=0o700)
        _require_plain_directory_tree(runtime_home)
    except FileExistsError:
        raise PrivateRuntimeError("attempt_exists") from None
    except (OSError, ValueError):
        if created and attempt is not None:
            _cleanup_attempt(attempt, root)
        raise PrivateRuntimeError("attempt_directory_invalid") from None
    return attempt, runtime_home


def _codex_executable(environ: Mapping[str, str]) -> Path:
    appdata = environ.get("APPDATA")
    if not appdata:
        raise PrivateRuntimeError("codex_unavailable")
    executable = (Path(appdata) / _CLI_RELATIVE).resolve()
    try:
        if not executable.is_file() or _is_link_or_reparse(executable):
            raise OSError
    except OSError:
        raise PrivateRuntimeError("codex_unavailable") from None
    return executable


def _cli_version(executable: Path) -> str:
    try:
        completed = subprocess.run(
            [str(executable), "--version"],
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            shell=False,
        )
        value = completed.stdout.decode("ascii", "strict").strip()
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise PrivateRuntimeError("codex_unavailable") from None
    if not re.fullmatch(r"codex-cli [0-9]+\.[0-9]+\.[0-9]+", value):
        raise PrivateRuntimeError("codex_unavailable")
    return value


def _response_object(status: str, output: list[dict[str, object]]) -> dict[str, object]:
    return {
        "id": "resp_synthetic_runtime",
        "object": "response",
        "created_at": 1788998400,
        "status": status,
        "error": None,
        "incomplete_details": None,
        "instructions": None,
        "max_output_tokens": None,
        "model": _MODEL,
        "output": output,
        "parallel_tool_calls": False,
        "previous_response_id": None,
        "reasoning": {"effort": "low", "summary": None},
        "store": False,
        "temperature": None,
        "text": {"format": {"type": "text"}, "verbosity": "low"},
        "tool_choice": "auto",
        "tools": [],
        "top_p": None,
        "truncation": "disabled",
        "usage": (
            {
                "input_tokens": 4,
                "input_tokens_details": {"cached_tokens": 0},
                "output_tokens": 8,
                "output_tokens_details": {"reasoning_tokens": 0},
                "total_tokens": 12,
            }
            if status == "completed"
            else None
        ),
        "user": None,
        "metadata": {},
    }


def _message(text: str) -> dict[str, object]:
    return {
        "id": "msg_synthetic_runtime",
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }


def _sse(events: list[dict[str, object]]) -> bytes:
    return "".join(
        f"event: {item['type']}\ndata: {json.dumps(item, separators=(',', ':'))}\n\n"
        for item in events
    ).encode()


class _FixtureServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, scenario: str):
        self.scenario = scenario
        self.request_seen = Event()
        self.tool_response_emitted = Event()
        self.unexpected_tool_declaration = Event()
        self.declared_tools: tuple[str, ...] = ()
        super().__init__(("127.0.0.1", 0), _FixtureHandler)


class _FixtureHandler(BaseHTTPRequestHandler):
    server_version = "SyntheticLoopback/1"
    sys_version = ""

    def log_message(self, format: str, *args: object) -> None:
        return

    def do_GET(self) -> None:
        self.send_response(404)
        self.end_headers()

    def do_POST(self) -> None:
        server: _FixtureServer = self.server  # type: ignore[assignment]
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 0 or length > 1_048_576:
            self.send_response(413)
            self.end_headers()
            return
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            body = {}
        tools = body.get("tools") if isinstance(body, dict) else None
        rows = tools if isinstance(tools, list) else []
        names = tuple(
            sorted(
                str(item.get("name"))
                for item in rows
                if isinstance(item, dict) and item.get("name")
            )
        )
        server.declared_tools = names
        allowed_shape = (
            isinstance(tools, list)
            and (
                not rows
                or (
                    len(rows) == 1
                    and isinstance(rows[0], dict)
                    and rows[0].get("type") == "function"
                    and rows[0].get("name") == _ALLOWED_TOOL
                )
            )
        )
        if not allowed_shape:
            server.unexpected_tool_declaration.set()
        server.request_seen.set()
        scenario = server.scenario
        if scenario == "stall":
            time.sleep(30)
            return
        if scenario == "provider_error_canary":
            payload = json.dumps({"error": ERROR_CANARY}, separators=(",", ":")).encode()
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if scenario == "request_user_input_call":
            item = {
                "id": "call_synthetic_runtime",
                "call_id": "call_synthetic_runtime",
                "type": "function_call",
                "name": _ALLOWED_TOOL,
                "arguments": json.dumps(
                    {
                        "questions": [
                            {
                                "header": "Synthetic",
                                "id": "synthetic",
                                "question": "Synthetic fixture only?",
                                "options": [
                                    {
                                        "label": "Yes",
                                        "description": "Synthetic fixture response.",
                                    }
                                ],
                            }
                        ]
                    },
                    separators=(",", ":"),
                ),
                "status": "completed",
            }
            events = [
                {
                    "type": "response.created",
                    "sequence_number": 0,
                    "response": _response_object("in_progress", []),
                },
                {
                    "type": "response.output_item.done",
                    "sequence_number": 1,
                    "output_index": 0,
                    "item": item,
                },
                {
                    "type": "response.completed",
                    "sequence_number": 2,
                    "response": _response_object("completed", [item]),
                },
            ]
            server.tool_response_emitted.set()
        else:
            if scenario == "malformed_output":
                text = "{malformed"
            elif scenario == "oversized_output":
                text = json.dumps({"blob": "x" * 131_072}, separators=(",", ":"))
            elif scenario == "schema_mismatch":
                text = json.dumps(
                    {
                        "result": "wrong",
                        "canary_seen": True,
                        "output_canary": OUTPUT_CANARY,
                    },
                    separators=(",", ":"),
                )
            else:
                text = json.dumps(
                    {
                        "result": "synthetic_ok",
                        "canary_seen": True,
                        "output_canary": OUTPUT_CANARY,
                    },
                    separators=(",", ":"),
                )
            message = _message(text)
            events = [
                {
                    "type": "response.created",
                    "sequence_number": 0,
                    "response": _response_object("in_progress", []),
                },
                {
                    "type": "response.output_item.done",
                    "sequence_number": 1,
                    "output_index": 0,
                    "item": message,
                },
                {
                    "type": "response.completed",
                    "sequence_number": 2,
                    "response": _response_object("completed", [message]),
                },
            ]
        payload = _sse(events)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass


class _RunningFixture:
    def __init__(self, scenario: str):
        self.server = _FixtureServer(scenario)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> _FixtureServer:
        self.thread.start()
        return self.server

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


@dataclass(frozen=True)
class _ProcessOutcome:
    exit_code: int
    timed_out: bool
    cancelled: bool


def _run_owned_windows_process(
    argv: tuple[str, ...],
    *,
    cwd: Path,
    environ: Mapping[str, str],
    stdin_path: Path,
    stdin_sha256: str,
    deadline_seconds: float,
    cancel: Event | None = None,
    _assign_process: Callable[[object, object, int], bool] | None = None,
) -> _ProcessOutcome:
    """Start suspended, assign to a kill-on-close Job Object, then resume."""
    if os.name != "nt":
        raise PrivateRuntimeError("windows_job_unavailable")

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle_t = wintypes.HANDLE
    invalid_handle = ctypes.c_void_p(-1).value

    class SECURITY_ATTRIBUTES(ctypes.Structure):
        _fields_ = [
            ("nLength", wintypes.DWORD),
            ("lpSecurityDescriptor", wintypes.LPVOID),
            ("bInheritHandle", wintypes.BOOL),
        ]

    class STARTUPINFOW(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("lpReserved", wintypes.LPWSTR),
            ("lpDesktop", wintypes.LPWSTR),
            ("lpTitle", wintypes.LPWSTR),
            ("dwX", wintypes.DWORD),
            ("dwY", wintypes.DWORD),
            ("dwXSize", wintypes.DWORD),
            ("dwYSize", wintypes.DWORD),
            ("dwXCountChars", wintypes.DWORD),
            ("dwYCountChars", wintypes.DWORD),
            ("dwFillAttribute", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("wShowWindow", wintypes.WORD),
            ("cbReserved2", wintypes.WORD),
            ("lpReserved2", ctypes.POINTER(ctypes.c_ubyte)),
            ("hStdInput", handle_t),
            ("hStdOutput", handle_t),
            ("hStdError", handle_t),
        ]

    class PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("hProcess", handle_t),
            ("hThread", handle_t),
            ("dwProcessId", wintypes.DWORD),
            ("dwThreadId", wintypes.DWORD),
        ]

    class BY_HANDLE_FILE_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("dwFileAttributes", wintypes.DWORD),
            ("ftCreationTime", wintypes.FILETIME),
            ("ftLastAccessTime", wintypes.FILETIME),
            ("ftLastWriteTime", wintypes.FILETIME),
            ("dwVolumeSerialNumber", wintypes.DWORD),
            ("nFileSizeHigh", wintypes.DWORD),
            ("nFileSizeLow", wintypes.DWORD),
            ("nNumberOfLinks", wintypes.DWORD),
            ("nFileIndexHigh", wintypes.DWORD),
            ("nFileIndexLow", wintypes.DWORD),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
        )]

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    kernel32.CreateJobObjectW.restype = handle_t
    kernel32.SetInformationJobObject.argtypes = [
        handle_t, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD,
    ]
    kernel32.SetInformationJobObject.restype = wintypes.BOOL
    kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
        ctypes.POINTER(SECURITY_ATTRIBUTES), wintypes.DWORD, wintypes.DWORD, handle_t,
    ]
    kernel32.CreateFileW.restype = handle_t
    kernel32.CreateProcessW.argtypes = [
        wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.LPVOID, wintypes.LPVOID,
        wintypes.BOOL, wintypes.DWORD, wintypes.LPVOID, wintypes.LPCWSTR,
        ctypes.POINTER(STARTUPINFOW), ctypes.POINTER(PROCESS_INFORMATION),
    ]
    kernel32.CreateProcessW.restype = wintypes.BOOL
    kernel32.AssignProcessToJobObject.argtypes = [handle_t, handle_t]
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel32.ResumeThread.argtypes = [handle_t]
    kernel32.ResumeThread.restype = wintypes.DWORD
    kernel32.ReadFile.argtypes = [
        handle_t, wintypes.LPVOID, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID,
    ]
    kernel32.ReadFile.restype = wintypes.BOOL
    kernel32.SetFilePointerEx.argtypes = [
        handle_t, ctypes.c_longlong, wintypes.LPVOID, wintypes.DWORD,
    ]
    kernel32.SetFilePointerEx.restype = wintypes.BOOL
    kernel32.GetFileInformationByHandle.argtypes = [
        handle_t, ctypes.POINTER(BY_HANDLE_FILE_INFORMATION),
    ]
    kernel32.GetFileInformationByHandle.restype = wintypes.BOOL
    kernel32.GetFileType.argtypes = [handle_t]
    kernel32.GetFileType.restype = wintypes.DWORD
    kernel32.WaitForSingleObject.argtypes = [handle_t, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.TerminateJobObject.argtypes = [handle_t, wintypes.UINT]
    kernel32.TerminateJobObject.restype = wintypes.BOOL
    kernel32.TerminateProcess.argtypes = [handle_t, wintypes.UINT]
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.GetExitCodeProcess.argtypes = [handle_t, ctypes.POINTER(wintypes.DWORD)]
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [handle_t]
    kernel32.CloseHandle.restype = wintypes.BOOL

    def require(ok: object, code: str) -> None:
        if not ok:
            raise PrivateRuntimeError(code)

    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        raise PrivateRuntimeError("windows_job_unavailable")
    handles: list[object] = [job]
    process_info = PROCESS_INFORMATION()
    try:
        limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
        require(
            kernel32.SetInformationJobObject(
                job, 9, ctypes.byref(limits), ctypes.sizeof(limits)
            ),
            "windows_job_unavailable",
        )
        security = SECURITY_ATTRIBUTES(
            ctypes.sizeof(SECURITY_ATTRIBUTES), None, True
        )
        if (
            not isinstance(stdin_path, Path)
            or not stdin_path.is_absolute()
            or stdin_path != Path(os.path.abspath(stdin_path))
            or stdin_path.parent != cwd
            or not _valid_sha(stdin_sha256)
        ):
            raise PrivateRuntimeError("stdin_path_invalid")
        try:
            _require_plain_directory_tree(stdin_path.parent)
            if _is_link_or_reparse(stdin_path):
                raise OSError
        except OSError:
            raise PrivateRuntimeError("stdin_path_invalid") from None
        deadline = time.monotonic() + deadline_seconds
        stdin_read = kernel32.CreateFileW(
            str(stdin_path), 0x80000000, 0x00000001,
            ctypes.byref(security), 3, 0x00200000, None,
        )
        if (
            not stdin_read
            or ctypes.cast(stdin_read, ctypes.c_void_p).value == invalid_handle
        ):
            raise PrivateRuntimeError("stdin_open_failed")
        handles.append(stdin_read)
        file_info = BY_HANDLE_FILE_INFORMATION()
        require(
            kernel32.GetFileInformationByHandle(
                stdin_read, ctypes.byref(file_info),
            ),
            "stdin_open_failed",
        )
        stdin_size = (
            int(file_info.nFileSizeHigh) << 32
        ) | int(file_info.nFileSizeLow)
        if (
            kernel32.GetFileType(stdin_read) != 1
            or file_info.dwFileAttributes & (0x00000400 | 0x00000010)
            or file_info.nNumberOfLinks != 1
            or not 0 < stdin_size <= _MAX_PINNED_STDIN
        ):
            raise PrivateRuntimeError("stdin_path_invalid")
        try:
            _require_plain_directory_tree(stdin_path.parent)
        except OSError:
            raise PrivateRuntimeError("stdin_path_invalid") from None
        digest = hashlib.sha256()
        total = 0
        input_buffer = (ctypes.c_ubyte * 65_536)()
        try:
            while True:
                read = wintypes.DWORD()
                require(
                    kernel32.ReadFile(
                        stdin_read, input_buffer, len(input_buffer),
                        ctypes.byref(read), None,
                    ),
                    "stdin_read_failed",
                )
                if not read.value:
                    break
                total += int(read.value)
                if total > _MAX_PINNED_STDIN:
                    raise PrivateRuntimeError("stdin_path_invalid")
                digest.update(bytes(input_buffer[: read.value]))
                ctypes.memset(input_buffer, 0, len(input_buffer))
        finally:
            ctypes.memset(input_buffer, 0, len(input_buffer))
        if total != stdin_size or digest.hexdigest() != stdin_sha256:
            raise PrivateRuntimeError("stdin_hash_mismatch")
        require(
            kernel32.SetFilePointerEx(stdin_read, 0, None, 0),
            "stdin_read_failed",
        )
        if time.monotonic() >= deadline:
            raise PrivateRuntimeError("timeout")
        nul = kernel32.CreateFileW(
            "NUL", 0x40000000, 0x00000003, ctypes.byref(security), 3, 0, None
        )
        if not nul or ctypes.cast(nul, ctypes.c_void_p).value == invalid_handle:
            raise PrivateRuntimeError("process_start_failed")
        handles.append(nul)
        startup = STARTUPINFOW()
        startup.cb = ctypes.sizeof(startup)
        startup.dwFlags = 0x00000100  # STARTF_USESTDHANDLES
        startup.hStdInput = stdin_read
        startup.hStdOutput = nul
        startup.hStdError = nul
        command = ctypes.create_unicode_buffer(subprocess.list2cmdline(argv))
        environment_text = "\0".join(
            f"{key}={value}" for key, value in sorted(environ.items(), key=lambda x: x[0].upper())
        ) + "\0\0"
        environment_block = ctypes.create_unicode_buffer(environment_text)
        flags = 0x00000004 | 0x00000200 | 0x08000000 | 0x00000400
        require(
            kernel32.CreateProcessW(
                None, command, None, None, True, flags,
                environment_block, str(cwd), ctypes.byref(startup),
                ctypes.byref(process_info),
            ),
            "process_start_failed",
        )
        handles.extend([process_info.hProcess, process_info.hThread])
        assigned = (
            _assign_process(job, process_info.hProcess, int(process_info.dwProcessId))
            if _assign_process is not None
            else bool(kernel32.AssignProcessToJobObject(job, process_info.hProcess))
        )
        if not assigned:
            # The child is still suspended and not owned by the Job Object. Kill and
            # reap it explicitly before closing handles; closing hProcess is not enough.
            kernel32.TerminateProcess(process_info.hProcess, 0xED)
            kernel32.WaitForSingleObject(process_info.hProcess, 2000)
            raise PrivateRuntimeError("job_assignment_failed")
        if kernel32.ResumeThread(process_info.hThread) == 0xFFFFFFFF:
            raise PrivateRuntimeError("process_start_failed")
        kernel32.CloseHandle(stdin_read)
        handles.remove(stdin_read)
        timed_out = cancelled = False
        while True:
            wait = kernel32.WaitForSingleObject(process_info.hProcess, 25)
            if wait == 0:
                break
            if wait != 258:
                raise PrivateRuntimeError("process_wait_failed")
            if cancel is not None and cancel.is_set():
                cancelled = True
                require(kernel32.TerminateJobObject(job, 0xEE), "process_termination_failed")
                require(kernel32.WaitForSingleObject(process_info.hProcess, 2000) == 0, "process_termination_failed")
                break
            if time.monotonic() >= deadline:
                timed_out = True
                require(kernel32.TerminateJobObject(job, 0xEF), "process_termination_failed")
                require(kernel32.WaitForSingleObject(process_info.hProcess, 2000) == 0, "process_termination_failed")
                break
        exit_code = wintypes.DWORD()
        require(
            kernel32.GetExitCodeProcess(process_info.hProcess, ctypes.byref(exit_code)),
            "process_wait_failed",
        )
        return _ProcessOutcome(int(exit_code.value), timed_out, cancelled)
    finally:
        # Closing the configured job is a final fail-safe for every descendant.
        for handle in reversed(handles):
            if handle:
                kernel32.CloseHandle(handle)


def _write_exclusive(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, 0o600)
        with os.fdopen(descriptor, "wb") as target:
            target.write(data)
        info = path.lstat()
        if _is_link_or_reparse(path) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise OSError
    except FileExistsError:
        raise PrivateRuntimeError("attempt_path_conflict") from None
    except OSError:
        path.unlink(missing_ok=True)
        raise PrivateRuntimeError("attempt_write_failed") from None


def _delete_owned_stdin(path: Path, attempt: Path) -> None:
    try:
        if path.parent != attempt or not path.is_absolute():
            raise OSError
        info = path.lstat()
        if (
            _is_link_or_reparse(path)
            or not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
        ):
            raise OSError
        path.unlink()
        if path.exists():
            raise OSError
    except OSError:
        raise PrivateRuntimeError("stdin_cleanup_failed") from None


def _process_environment(runtime_home: Path, environ: Mapping[str, str]) -> dict[str, str]:
    value = {
        key: environ[key]
        for key in ("SYSTEMROOT", "WINDIR", "COMSPEC")
        if key in environ
    }
    temp = runtime_home / "tmp"
    appdata = runtime_home / "appdata"
    localappdata = runtime_home / "localappdata"
    for directory in (temp, appdata, localappdata):
        directory.mkdir(mode=0o700)
        _require_plain_directory_tree(directory)
    value.update(
        {
            "CODEX_HOME": str(runtime_home),
            "USERPROFILE": str(runtime_home),
            "APPDATA": str(appdata),
            "LOCALAPPDATA": str(localappdata),
            "TEMP": str(temp),
            "TMP": str(temp),
            "NO_COLOR": "1",
        }
    )
    return value


def _command(
    executable: Path,
    *,
    attempt: Path,
    schema_path: Path,
    output_path: Path,
    port: int,
) -> tuple[str, ...]:
    argv = [
        str(executable),
        "--ask-for-approval",
        "never",
        "--strict-config",
        "exec",
        "--model",
        _MODEL,
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--cd",
        str(attempt),
        "--output-schema",
        str(schema_path),
        "--output-last-message",
        str(output_path),
    ]
    for item in _runtime_config(port):
        argv.extend(("--config", item))
    argv.append("-")
    return tuple(argv)


def _stdin_envelope(request: SyntheticTurnRequest) -> bytes:
    binding = request.binding
    value = {
        "synthetic_only": True,
        "binding": {
            "job_id": binding.job_id,
            "attempt_id": binding.attempt_id,
            "attempt_token": binding.attempt_token,
            "run_id": binding.run_id,
            "stage": binding.stage,
            "workflow_id": binding.workflow_id,
            "workflow_version": binding.workflow_version,
            "workflow_hash": binding.workflow_hash,
            "input_sha256": binding.input_sha256,
            "schema_sha256": binding.schema_sha256,
            "skill": {
                "name": binding.skill.name,
                "version": binding.skill.version,
                "content_sha256": binding.skill.content_sha256,
                "manifest_sha256": binding.skill.manifest_sha256,
            },
            "runtime_config_sha256": binding.runtime_config_sha256,
        },
        "skill": request.skill_bytes.decode("utf-8", "strict"),
        "input": json.loads(request.input_json),
    }
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    ).encode()


def _scan_runtime_canaries(runtime_home: Path) -> Mapping[str, tuple[str, ...]]:
    needles = {
        "input": INPUT_CANARY.encode(),
        "output": OUTPUT_CANARY.encode(),
        "error": ERROR_CANARY.encode(),
    }
    found: dict[str, list[str]] = {key: [] for key in needles}
    try:
        _require_plain_directory_tree(runtime_home)
        for path in sorted(runtime_home.rglob("*")):
            info = path.lstat()
            if _is_link_or_reparse(path):
                raise OSError
            if not stat.S_ISREG(info.st_mode):
                continue
            relative = path.relative_to(runtime_home).as_posix()
            overlap = max(len(value) for value in needles.values()) - 1
            tail = b""
            with path.open("rb") as source:
                opened = os.fstat(source.fileno())
                if opened.st_dev != info.st_dev or opened.st_ino != info.st_ino:
                    raise OSError
                while True:
                    chunk = source.read(65_536)
                    if not chunk:
                        break
                    data = tail + chunk
                    for key, needle in needles.items():
                        if needle in data and relative not in found[key]:
                            found[key].append(relative)
                    tail = data[-overlap:]
    except (OSError, ValueError):
        raise PrivateRuntimeError("sink_scan_failed") from None
    return MappingProxyType({key: tuple(value) for key, value in found.items()})


def _read_and_validate_output(
    path: Path, request: SyntheticTurnRequest
) -> tuple[str, bytes | None]:
    try:
        info = path.lstat()
        if _is_link_or_reparse(path) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            return "output_path_invalid", None
        if info.st_size > request.max_output_bytes:
            return "output_too_large", None
        data = path.read_bytes()
    except FileNotFoundError:
        return "output_missing", None
    except OSError:
        return "output_read_failed", None
    try:
        value = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "output_invalid_json", None
    try:
        schema = json.loads(request.output_schema_json)
        validator_for(schema)(schema).validate(value)
    except ValidationError:
        return "output_schema_mismatch", None
    return "ok", data


def _cleanup_attempt(attempt: Path, root: Path) -> str:
    try:
        if attempt.parent.resolve() != root.resolve():
            raise OSError
        _require_plain_directory_tree(root)
        _require_plain_directory_tree(attempt)
        if _is_link_or_reparse(attempt):
            raise OSError
        shutil.rmtree(attempt)
        return "deleted"
    except (OSError, ValueError):
        return "failed"


def execute_synthetic_turn(
    request: SyntheticTurnRequest,
    *,
    environ: Mapping[str, str] | None = None,
) -> PrivateTurnResult:
    """Execute one frozen synthetic turn and return metadata plus validated output."""
    _validate_request(request)
    selected_env = dict(os.environ if environ is None else environ)
    executable = _codex_executable(selected_env)
    identity = RuntimeIdentity(
        executable_sha256=_sha_file(executable),
        cli_version=_cli_version(executable),
        model=_MODEL,
        provider=_PROVIDER,
    )
    attempt, runtime_home = _prepare_attempt(request, selected_env)
    root = attempt.parent
    schema_path = attempt / "output-schema.json"
    output_path = attempt / "last-message.json"
    stdin_path = attempt / "stdin.json"
    started = time.monotonic()
    status = "failed"
    code = "runtime_failed"
    output: bytes | None = None
    output_sha: str | None = None
    declared_tools: tuple[str, ...] = ()
    sinks: Mapping[str, tuple[str, ...]] = MappingProxyType({})
    cleanup_state = "not_started"
    try:
        _write_exclusive(schema_path, request.output_schema_json)
        stdin_bytes = _stdin_envelope(request)
        if len(stdin_bytes) > _MAX_PINNED_STDIN:
            raise PrivateRuntimeError("stdin_path_invalid")
        _write_exclusive(stdin_path, stdin_bytes)
        child_env = _process_environment(runtime_home, selected_env)
        with _RunningFixture(request.scenario) as server:
            cancel = Event()

            def observe_fixture() -> None:
                while not cancel.is_set():
                    if server.tool_response_emitted.is_set() or server.unexpected_tool_declaration.is_set():
                        cancel.set()
                        return
                    time.sleep(0.01)

            observer = Thread(
                target=observe_fixture,
                daemon=True,
                name="private-runtime-tool-observer",
            )
            observer.start()
            process_error: BaseException | None = None
            try:
                outcome = _run_owned_windows_process(
                    _command(
                        executable,
                        attempt=attempt,
                        schema_path=schema_path,
                        output_path=output_path,
                        port=int(server.server_address[1]),
                    ),
                    cwd=attempt,
                    environ=child_env,
                    stdin_path=stdin_path,
                    stdin_sha256=_sha(stdin_bytes),
                    deadline_seconds=request.deadline_seconds,
                    cancel=cancel,
                )
                declared_tools = server.declared_tools
                unexpected = server.unexpected_tool_declaration.is_set()
                tool_emitted = server.tool_response_emitted.is_set()
            except BaseException as error:
                process_error = error
            finally:
                cancel.set()
                observer.join(timeout=1)
                try:
                    _delete_owned_stdin(stdin_path, attempt)
                except PrivateRuntimeError:
                    if process_error is None:
                        raise
            if process_error is not None:
                raise process_error
        sinks = _scan_runtime_canaries(runtime_home)
        if any(sinks.values()):
            code = "prohibited_content_logged"
        elif unexpected:
            code = "unexpected_tool_declaration"
        elif tool_emitted:
            code = "tool_call_rejected"
        elif outcome.timed_out:
            code = "timeout"
        else:
            validation_code, validated = _read_and_validate_output(output_path, request)
            if validation_code != "ok":
                code = validation_code
            elif outcome.exit_code != 0:
                code = "runtime_failed"
            else:
                status = "succeeded"
                code = "ok"
                output = validated
                output_sha = _sha(validated or b"")
    except PrivateRuntimeError as error:
        code = error.code
    finally:
        cleanup_state = _cleanup_attempt(attempt, root)
        if cleanup_state != "deleted":
            status = "failed"
            code = "cleanup_failed"
            output = None
            output_sha = None
    return PrivateTurnResult(
        binding=request.binding,
        status=status,
        code=code,
        output=output,
        output_sha256=output_sha,
        runtime_identity=identity,
        elapsed_ms=round((time.monotonic() - started) * 1000),
        cleanup_state=cleanup_state,
        declared_tools=declared_tools,
        sink_canary_paths=sinks,
    )

"""Fail-closed native Codex adapters for the persisted P16 review stages.

The public stage path is deliberately disabled until an exact real-provider
synthetic canary has been reviewed and its bundle hash is pinned in source.
Persistent JSON is diagnostic evidence only; runtime authority is an in-memory
capability created by a successful canary in the same controller process.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
from threading import Event, Lock
import time
from types import MappingProxyType
from typing import Callable, Iterator, Mapping
from urllib.parse import urlsplit
import uuid

from jsonschema import SchemaError, ValidationError
from jsonschema.validators import validator_for

from scripts.prospecting.pipeline_stage_service import (
    MAX_STAGE_INPUT_BYTES,
    MAX_STAGE_OUTPUT_BYTES,
    PipelineStageError,
    StageAdapter,
    StageBinding,
    StageJob,
    StageResult,
)
from scripts.prospecting.personalizer import private_runtime as runtime


REQUESTED_MODEL = "gpt-6-astra"
REQUESTED_REASONING = "low"
HUMANIZER_VERSION = "2.8.2"
HUMANIZER_SHA256 = "5e9456ab8b4f5d4a60e9affe4125490d2132ef4158d3551803511e2f0a7d1d16"
ACCEPTED_RUNTIME_BUNDLE_SHA256: str | None = None
_DEADLINE_SECONDS = 90
_PRIME_MODEL_CONTEXT_WINDOW = 114_000
_EVENT_TOTAL_BYTES = 2 * 1024 * 1024
_EVENT_LINE_BYTES = 256 * 1024
_STATE_FILE_CAP = 16 * 1024 * 1024
_STATE_TOTAL_CAP = 64 * 1024 * 1024
_STATE_FILE_COUNT = 128
_ID = re.compile(r"[a-z][a-z0-9-]{1,127}\Z")
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_CAPABILITY_SENTINEL = object()
_AMBIENT_ENV_KEYS = (
    "SYSTEMROOT", "WINDIR", "COMSPEC", "CODEX_HOME", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA", "HOME", "HOMEDRIVE", "HOMEPATH",
)


class PrivateStageRuntimeError(ValueError):
    """A fixed-code refusal with no prompt, source, path, or provider detail."""

    def __init__(self, code: str, *, cleanup_code: str | None = None):
        self.code = code
        self.cleanup_code = cleanup_code
        super().__init__(code)


@dataclass(frozen=True)
class PreflightResult:
    status: str
    code: str
    bundle_sha256: str
    executable_sha256: str | None
    cli_version: str | None
    requested_model: str
    responding_model_verified: bool
    event_policy_sha256: str
    elapsed_ms: int
    cleanup_state: str


@dataclass(frozen=True, repr=False)
class _Capability:
    sentinel: object = field(repr=False)
    root: Path
    state: Path
    executable: Path
    executable_sha256: str
    cli_version: str
    bundle_sha256: str
    environ: Mapping[str, str] = field(repr=False)
    lock: Lock = field(repr=False)
    invalidated: Event = field(repr=False)


def _canonical(value: object) -> bytes:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise PrivateStageRuntimeError("runtime_manifest_invalid") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value)).hexdigest()


def _strict_json(value: bytes) -> object:
    def unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = item
        return result

    def invalid_constant(_value: str) -> object:
        raise ValueError("non-finite number")

    def finite_float(value: str) -> float:
        parsed = float(value)
        if not math.isfinite(parsed):
            raise ValueError("non-finite number")
        return parsed

    return json.loads(
        value, object_pairs_hook=unique_pairs, parse_constant=invalid_constant,
        parse_float=finite_float,
    )


def _schema_bytes(value: Mapping[str, object]) -> bytes:
    encoded = _canonical(value)
    try:
        schema = json.loads(encoded)
        validator_for(schema).check_schema(schema)
    except (UnicodeDecodeError, json.JSONDecodeError, SchemaError):
        raise PrivateStageRuntimeError("runtime_schema_invalid") from None
    return encoded


_STRING = {"type": "string", "minLength": 1, "maxLength": 65_536}
_SHORT_STRING = {"type": "string", "minLength": 1, "maxLength": 8_192}
_LIST = {
    "type": "array", "maxItems": 32,
    "items": {"type": "string", "minLength": 1, "maxLength": 2_048},
}
_SCHEMAS = MappingProxyType({
    "humanizer": _schema_bytes({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object", "additionalProperties": False,
        "required": ["draft", "audit", "final_subject", "final_body"],
        "properties": {
            "draft": _STRING, "audit": _STRING,
            "final_subject": {"type": "string", "minLength": 1, "maxLength": 998},
            "final_body": _STRING,
        },
    }),
    "post_humanization_factcheck": _schema_bytes({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object", "additionalProperties": False,
        "required": ["decision", "bindings", "uncertainty", "shortfalls"],
        "properties": {
            "decision": {"enum": ["pass", "fail"]},
            "bindings": {
                "type": "array", "maxItems": 32,
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["slot", "value", "source_kind", "source_ref"],
                    "properties": {
                        "slot": {"type": "string", "minLength": 1, "maxLength": 64},
                        "value": _STRING,
                        "source_kind": {"enum": ["evidence", "sender", "policy"]},
                        "source_ref": {"type": "string", "minLength": 1, "maxLength": 256},
                    },
                },
            },
            "uncertainty": _LIST, "shortfalls": _LIST,
        },
    }),
    "independent_critic": _schema_bytes({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object", "additionalProperties": False,
        "required": ["decision", "reasons", "repair_instructions"],
        "properties": {
            "decision": {"enum": ["pass", "repair"]},
            "reasons": _LIST,
            "repair_instructions": {"type": "string", "maxLength": 8_192},
        },
    }),
})

_PROMPTS = MappingProxyType({
    "humanizer": (
        "Apply the supplied Humanizer skill to the saved draft. Preserve every "
        "verified fact, source-bound claim, sender fact, ask, and uncertainty. Do not "
        "invent credentials, metrics, familiarity, or outcomes. Return the draft rewrite, "
        "a concise still-AI audit, and the final subject/body using only the output schema."
    ),
    "post_humanization_factcheck": (
        "Independently check the candidate against the supplied evidence and approved "
        "context. Bind each factual slot to an exact supplied source. Report uncertainty "
        "and shortfalls honestly. Return fail when support is missing or contradictory. "
        "Do not infer a human attestation or readiness decision."
    ),
    "independent_critic": (
        "Review the candidate and completed fact-check as an independent critic. The "
        "producer audit is intentionally unavailable. Return pass only when the copy is "
        "specific, accurate, natural, and appropriately scoped; otherwise return bounded "
        "repair instructions. Do not claim human approval."
    ),
})


def _humanizer_bytes() -> bytes:
    path = Path(__file__).resolve().parents[3] / ".agents" / "skills" / "humanizer" / "SKILL.md"
    try:
        value = path.read_bytes()
    except OSError:
        raise PrivateStageRuntimeError("humanizer_skill_unavailable") from None
    if len(value) != 34_527 or sha256(value).hexdigest() != HUMANIZER_SHA256:
        raise PrivateStageRuntimeError("humanizer_skill_mismatch")
    return value


def _skill(stage: str) -> tuple[str, str, bytes, str]:
    if stage == "humanizer":
        value = _humanizer_bytes()
        return "humanizer", HUMANIZER_VERSION, value, sha256(value).hexdigest()
    value = _PROMPTS[stage].encode("utf-8")
    name = "prospecting-post-factchecker" if stage == "post_humanization_factcheck" else "prospecting-independent-critic"
    return name, "v1", value, sha256(value).hexdigest()


def _fixed_config() -> tuple[str, ...]:
    return tuple(
        value for value in runtime._runtime_config(0)
        if not value.startswith((
            "model_provider=", "model_providers.loopback.", "model_context_window=",
            "cli_auth_credentials_store=",
        ))
    )


def _event_policy_hash() -> str:
    return _digest({
        "version": 1,
        "allowed_events": ["thread.started", "turn.started", "item.started", "item.updated", "item.completed", "turn.completed"],
        "allowed_items": ["agent_message", "reasoning"],
        "line_bytes": _EVENT_LINE_BYTES, "total_bytes": _EVENT_TOTAL_BYTES,
    })


def _bundle_manifest(executable_hash: str, cli_version: str) -> dict[str, object]:
    return {
        "version": 1, "runtime": "codex-cli-private", "runtime_hash": executable_hash,
        "cli_version": cli_version, "requested_model": REQUESTED_MODEL,
        "requested_reasoning": REQUESTED_REASONING,
        "responding_model_verified": False,
        "command_policy": {
            "approval": "never", "ephemeral": True, "ignore_user_config": True,
            "ignore_rules": True, "sandbox": "read-only", "json_events": True,
            "history": "none", "ambient_provider": "openai",
            "ambient_auth": "existing-chatgpt", "prime_provider": "code-owned-loopback",
            "benign_clarification": "declared-but-event-rejected",
            "ambient_model_context": "provider-metadata",
            "prime_model_context_window": _PRIME_MODEL_CONTEXT_WINDOW,
            "config": list(_fixed_config()),
        },
        "limits": {
            "deadline_seconds": _DEADLINE_SECONDS,
            "stage_input_bytes": MAX_STAGE_INPUT_BYTES,
            "pinned_stdin_bytes": runtime._MAX_PINNED_STDIN,
            "stage_output_bytes": MAX_STAGE_OUTPUT_BYTES,
            "state_file_bytes": _STATE_FILE_CAP,
            "state_total_bytes": _STATE_TOTAL_CAP,
            "state_file_count": _STATE_FILE_COUNT,
        },
        "event_policy_hash": _event_policy_hash(),
        "schemas": {stage: sha256(value).hexdigest() for stage, value in _SCHEMAS.items()},
        "prompts": {
            stage: sha256(value.encode("utf-8")).hexdigest()
            for stage, value in _PROMPTS.items()
        },
        "skills": {stage: {"name": _skill(stage)[0], "version": _skill(stage)[1], "sha256": _skill(stage)[3]} for stage in _SCHEMAS},
    }


class _EventObserver:
    def __init__(self) -> None:
        self.buffer = bytearray()
        self.completed = False
        self.agent_message = False

    def __call__(self, chunk: bytes) -> None:
        if type(chunk) is not bytes:
            raise runtime.PrivateRuntimeError("event_stream_invalid")
        self.buffer.extend(chunk)
        if len(self.buffer) > _EVENT_LINE_BYTES and b"\n" not in self.buffer:
            raise runtime.PrivateRuntimeError("event_line_too_large")
        while b"\n" in self.buffer:
            line, _, remainder = self.buffer.partition(b"\n")
            self.buffer[:] = remainder
            self._line(bytes(line))

    def _line(self, line: bytes) -> None:
        if not line or len(line) > _EVENT_LINE_BYTES:
            raise runtime.PrivateRuntimeError("event_stream_invalid")
        try:
            value = _strict_json(line)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError):
            raise runtime.PrivateRuntimeError("event_stream_invalid") from None
        if type(value) is not dict or type(value.get("type")) is not str:
            raise runtime.PrivateRuntimeError("event_stream_invalid")
        event = value["type"]
        if event in {"error", "turn.failed"}:
            raise runtime.PrivateRuntimeError("provider_unavailable")
        if event not in {
            "thread.started", "turn.started", "item.started", "item.updated",
            "item.completed", "turn.completed",
        }:
            raise runtime.PrivateRuntimeError("event_stream_invalid")
        if event.startswith("item."):
            item = value.get("item")
            if type(item) is not dict:
                raise runtime.PrivateRuntimeError("event_stream_invalid")
            if item.get("type") == "error":
                raise runtime.PrivateRuntimeError("provider_unavailable")
            if item.get("type") not in {"agent_message", "reasoning"}:
                raise runtime.PrivateRuntimeError("tool_event_rejected")
            self.agent_message |= item.get("type") == "agent_message"
        self.completed |= event == "turn.completed"

    def finish(self) -> None:
        if self.buffer:
            self._line(bytes(self.buffer))
            self.buffer.clear()
        if not self.completed or not self.agent_message:
            raise runtime.PrivateRuntimeError("event_stream_incomplete")


def _validate_capability(value: object) -> _Capability:
    if (
        not isinstance(value, _Capability)
        or value.sentinel is not _CAPABILITY_SENTINEL
        or value.invalidated.is_set()
    ):
        raise PrivateStageRuntimeError("runtime_capability_invalid")
    return value


def _attempt_environment(root: Path, selected: Mapping[str, str], *, ambient_auth: bool) -> dict[str, str]:
    allowed = ("SYSTEMROOT", "WINDIR", "COMSPEC")
    if ambient_auth:
        allowed += ("CODEX_HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "HOMEDRIVE", "HOMEPATH")
    value = {key: selected[key] for key in allowed if key in selected}
    if not ambient_auth:
        home = root / "empty-home"
        home.mkdir(mode=0o700)
        for name in ("appdata", "localappdata"):
            (home / name).mkdir(mode=0o700)
        value.update({
            "CODEX_HOME": str(home), "USERPROFILE": str(home),
            "APPDATA": str(home / "appdata"), "LOCALAPPDATA": str(home / "localappdata"),
        })
    for key, name in (("TEMP", "tmp"), ("TMP", "tmp")):
        directory = root / name
        directory.mkdir(mode=0o700, exist_ok=True)
        value[key] = str(directory)
    value["NO_COLOR"] = "1"
    return value


def _selected_environment(source: Mapping[str, str]) -> dict[str, str]:
    return {key: source[key] for key in _AMBIENT_ENV_KEYS if key in source}


def _toml_path(path: Path) -> str:
    return json.dumps(str(path))


def _command(
    executable: Path, attempt: Path, state: Path, schema: Path, output: Path,
    *, port: int | None,
) -> tuple[str, ...]:
    model = REQUESTED_MODEL
    argv = [
        str(executable), "--ask-for-approval", "never", "--strict-config", "exec",
        "--model", model, "--ephemeral", "--ignore-user-config", "--ignore-rules",
        "--skip-git-repo-check", "--sandbox", "read-only", "--cd", str(attempt),
        "--output-schema", str(schema), "--output-last-message", str(output), "--json",
    ]
    config = list(runtime._runtime_config(port or 0) if port is not None else (
        'model_provider="openai"', 'forced_login_method="chatgpt"',
        f'model_reasoning_effort="{REQUESTED_REASONING}"', *_fixed_config(),
    ))
    config.extend((
        f"sqlite_home={_toml_path(state)}", f"log_dir={_toml_path(attempt / 'logs')}",
        'history.persistence="none"', "suppress_unstable_features_warning=true",
    ))
    if port is not None:
        config.append(f"model_context_window={_PRIME_MODEL_CONTEXT_WINDOW}")
    for item in config:
        argv.extend(("--config", item))
    argv.append("-")
    return tuple(argv)


def _prepare_root(store: Path) -> tuple[Path, Path]:
    if not isinstance(store, Path) or not store.is_absolute() or store.suffix.casefold() != ".sqlite":
        raise PrivateStageRuntimeError("private_store_invalid")
    try:
        info = store.lstat()
        runtime._require_plain_directory_tree(store.parent)
        if (
            runtime._is_link_or_reparse(store)
            or not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
        ):
            raise OSError
    except (OSError, ValueError):
        raise PrivateStageRuntimeError("private_store_invalid") from None
    parent = store.parent / "snapshots" / "private-stage-runtime"
    try:
        parent.mkdir(parents=True, exist_ok=True)
        runtime._require_plain_directory_tree(parent)
        root = parent / ("controller-" + uuid.uuid4().hex)
        root.mkdir(mode=0o700)
        runtime._require_plain_directory_tree(root)
        return parent, root
    except (OSError, ValueError):
        raise PrivateStageRuntimeError("runtime_root_invalid") from None


def _write(path: Path, value: bytes) -> None:
    runtime._write_exclusive(path, value)


def _delete(path: Path, attempt: Path) -> None:
    runtime._delete_owned_stdin(path, attempt)


def _normalized_error(error: BaseException) -> BaseException:
    if isinstance(error, runtime.PrivateRuntimeError):
        return PrivateStageRuntimeError(error.code)
    if isinstance(error, OSError):
        return PrivateStageRuntimeError("runtime_io_failed")
    return error


def _finish_with_cleanup(
    primary: BaseException | None, *, cleanup_ok: bool,
) -> None:
    if not cleanup_ok:
        if primary is None:
            raise PrivateStageRuntimeError("runtime_cleanup_failed")
        if isinstance(primary, PrivateStageRuntimeError):
            primary.cleanup_code = "runtime_cleanup_failed"
        else:
            setattr(primary, "cleanup_code", "runtime_cleanup_failed")
    if primary is not None:
        raise primary


def _read_bounded_regular(path: Path, maximum: int) -> bytes:
    descriptor: int | None = None
    try:
        before = path.lstat()
        if (
            runtime._is_link_or_reparse(path)
            or not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size > maximum
        ):
            raise OSError
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOINHERIT", 0)
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)
        ):
            raise OSError
        chunks: list[bytes] = []
        remaining = maximum + 1
        while remaining:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        after = path.lstat()
        final = os.fstat(descriptor)
        if (
            len(data) > maximum
            or runtime._is_link_or_reparse(path)
            or (after.st_dev, after.st_ino) != (opened.st_dev, opened.st_ino)
            or after.st_nlink != 1
            or (final.st_dev, final.st_ino, final.st_size)
            != (opened.st_dev, opened.st_ino, opened.st_size)
            or final.st_nlink != 1
        ):
            raise OSError
        return data
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _validate_output(path: Path, schema_bytes: bytes) -> dict[str, object]:
    try:
        data = _read_bounded_regular(path, MAX_STAGE_OUTPUT_BYTES)
        value = _strict_json(data)
        if type(value) is not dict:
            raise ValueError
        schema = _strict_json(schema_bytes)
        validator_for(schema)(schema).validate(value)
        return value
    except PrivateStageRuntimeError:
        raise
    except (
        OSError, UnicodeError, json.JSONDecodeError, ValidationError,
        ValueError, TypeError, RecursionError,
    ):
        raise PrivateStageRuntimeError("stage_output_invalid") from None


def _scan_owned(root: Path, needles: tuple[bytes, ...]) -> None:
    total = count = 0
    try:
        runtime._require_plain_directory_tree(root)
        for path in sorted(root.rglob("*")):
            info = path.lstat()
            if runtime._is_link_or_reparse(path):
                raise OSError
            if not stat.S_ISREG(info.st_mode):
                continue
            count += 1
            total += info.st_size
            if count > _STATE_FILE_COUNT or info.st_size > _STATE_FILE_CAP or total > _STATE_TOTAL_CAP:
                raise PrivateStageRuntimeError("sink_scan_incomplete")
            data = _read_bounded_regular(path, _STATE_FILE_CAP)
            if any(needle and needle in data for needle in needles):
                raise PrivateStageRuntimeError("prohibited_content_logged")
    except PrivateStageRuntimeError:
        raise
    except (OSError, ValueError):
        raise PrivateStageRuntimeError("sink_scan_incomplete") from None


def _distinctive_private_values(*values: object) -> tuple[bytes, ...]:
    """Return bounded exact text fragments useful for owned-sink canary checks."""
    stack = list(values)
    result: set[bytes] = set()
    total = 0
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            stack.extend(value.values())
        elif isinstance(value, (list, tuple)):
            stack.extend(value)
        elif type(value) is str:
            try:
                encoded = value.encode("utf-8")
            except UnicodeError:
                raise PrivateStageRuntimeError("stage_content_invalid") from None
            if len(encoded) < 16 or encoded in result:
                continue
            total += len(encoded)
            if total > MAX_STAGE_INPUT_BYTES + MAX_STAGE_OUTPUT_BYTES:
                raise PrivateStageRuntimeError("stage_content_invalid")
            result.add(encoded)
    return tuple(sorted(result, key=lambda item: (-len(item), item)))


def _prime_cache(
    root: Path, state: Path, executable: Path, selected: Mapping[str, str],
) -> None:
    attempt = root / "prime"
    schema = attempt / "schema.json"
    output = attempt / "output.json"
    stdin = attempt / "stdin.json"
    request = runtime.build_synthetic_request(
        job_id="job-prime", attempt_id="attempt-prime", attempt_token="token-prime",
        run_id="run-prime", workflow_id="workflow-prime", workflow_version="v1",
        workflow_hash="a" * 64,
    )
    envelope = runtime._stdin_envelope(request)
    observer = _EventObserver()
    primary: BaseException | None = None
    try:
        attempt.mkdir(mode=0o700)
        for name in ("logs", "tmp"):
            (attempt / name).mkdir(mode=0o700)
        _write(schema, runtime.SYNTHETIC_SCHEMA)
        _write(stdin, envelope)
        with runtime._RunningFixture("success") as server:
            outcome = runtime._run_owned_windows_process(
                _command(
                    executable, attempt, state, schema, output,
                    port=int(server.server_address[1]),
                ),
                cwd=attempt, environ=_attempt_environment(root, selected, ambient_auth=False),
                stdin_path=stdin, stdin_sha256=sha256(envelope).hexdigest(),
                deadline_seconds=30, stdout_observer=observer,
                stdout_limit_bytes=_EVENT_TOTAL_BYTES,
            )
        if outcome.timed_out:
            raise PrivateStageRuntimeError("cache_prime_timeout")
        if outcome.cancelled or outcome.exit_code != 0:
            raise PrivateStageRuntimeError("cache_prime_failed")
        observer.finish()
        if (
            not server.request_seen.is_set()
            or server.tools_field_state not in {"omitted", "allowed"}
            or server.declared_tools not in ((), (runtime._ALLOWED_TOOL,))
        ):
            raise PrivateStageRuntimeError("tool_configuration_invalid")
        expected = {
            "result": "synthetic_ok", "canary_seen": True,
            "output_canary": runtime.OUTPUT_CANARY,
        }
        if _validate_output(output, runtime.SYNTHETIC_SCHEMA) != expected:
            raise PrivateStageRuntimeError("cache_prime_failed")
        for path in (stdin, schema, output):
            _delete(path, attempt)
        _scan_owned(root, tuple(value.encode() for value in (
            runtime.INPUT_CANARY, runtime.OUTPUT_CANARY, runtime.ERROR_CANARY,
        )))
        files = [path for path in state.rglob("*") if path.is_file()]
        if not files:
            raise PrivateStageRuntimeError("cache_prime_missing")
    except BaseException as error:
        primary = _normalized_error(error)
    cleanup_ok = not attempt.exists() or runtime._cleanup_attempt(attempt, root) == "deleted"
    empty_home = root / "empty-home"
    if empty_home.exists():
        cleanup_ok &= runtime._cleanup_attempt(empty_home, root) == "deleted"
    _finish_with_cleanup(primary, cleanup_ok=cleanup_ok)


def _preflight_envelope(bundle_hash: str) -> bytes:
    return _canonical({
        "synthetic_only": True,
        "task": "Return the exact schema object and do not call any tool.",
        "bundle_sha256": bundle_hash,
        "canary": runtime.INPUT_CANARY,
        "required_output": {
            "result": "synthetic_ok", "canary_seen": True,
            "output_canary": runtime.OUTPUT_CANARY,
        },
    })


def _run_live_canary(capability: _Capability) -> None:
    attempt = capability.root / "preflight"
    schema, output, stdin = (attempt / "schema.json", attempt / "output.json", attempt / "stdin.json")
    envelope = _preflight_envelope(capability.bundle_sha256)
    observer = _EventObserver()
    primary: BaseException | None = None
    try:
        attempt.mkdir(mode=0o700)
        for name in ("logs", "tmp"):
            (attempt / name).mkdir(mode=0o700)
        _write(schema, runtime.SYNTHETIC_SCHEMA)
        _write(stdin, envelope)
        outcome = runtime._run_owned_windows_process(
            _command(capability.executable, attempt, capability.state, schema, output, port=None),
            cwd=attempt, environ=_attempt_environment(attempt, capability.environ, ambient_auth=True),
            stdin_path=stdin, stdin_sha256=sha256(envelope).hexdigest(),
            deadline_seconds=_DEADLINE_SECONDS, stdout_observer=observer,
            stdout_limit_bytes=_EVENT_TOTAL_BYTES,
        )
        if outcome.timed_out:
            raise PrivateStageRuntimeError("runtime_timeout")
        if outcome.cancelled or outcome.exit_code != 0:
            raise PrivateStageRuntimeError("provider_unavailable")
        observer.finish()
        expected = {
            "result": "synthetic_ok", "canary_seen": True,
            "output_canary": runtime.OUTPUT_CANARY,
        }
        if _validate_output(output, runtime.SYNTHETIC_SCHEMA) != expected:
            raise PrivateStageRuntimeError("preflight_output_invalid")
        for path in (stdin, schema, output):
            _delete(path, attempt)
        _scan_owned(capability.root, tuple(value.encode() for value in (
            runtime.INPUT_CANARY, runtime.OUTPUT_CANARY, runtime.ERROR_CANARY,
        )))
    except BaseException as error:
        primary = _normalized_error(error)
    cleanup_ok = not attempt.exists() or runtime._cleanup_attempt(
        attempt, capability.root,
    ) == "deleted"
    _finish_with_cleanup(primary, cleanup_ok=cleanup_ok)


def _bootstrap(store: Path, selected: Mapping[str, str]) -> tuple[Path, _Capability]:
    parent, root = _prepare_root(store)
    try:
        executable = runtime._codex_executable(selected)
        executable_hash = runtime._sha_file(executable)
        cli_version = runtime._cli_version(executable)
        bundle_hash = _digest(_bundle_manifest(executable_hash, cli_version))
        state = root / "state"
        state.mkdir(mode=0o700)
        _prime_cache(root, state, executable, selected)
        capability = _Capability(
            _CAPABILITY_SENTINEL, root, state, executable, executable_hash,
            cli_version, bundle_hash,
            MappingProxyType(_selected_environment(selected)), Lock(), Event(),
        )
        _run_live_canary(capability)
        return parent, capability
    except BaseException as error:
        primary = _normalized_error(error)
        cleanup_ok = not root.exists() or runtime._cleanup_attempt(root, parent) == "deleted"
        _finish_with_cleanup(primary, cleanup_ok=cleanup_ok)
        raise AssertionError("unreachable")


def run_diagnostic_preflight(
    private_store_path: Path,
) -> PreflightResult:
    """Run synthetic evidence only; this result never authorizes another process."""
    started = time.monotonic()
    selected = _selected_environment(os.environ)
    parent: Path | None = None
    capability: _Capability | None = None
    status, code, cleanup = "failed", "preflight_failed", "not_started"
    executable_hash = cli_version = None
    bundle_hash = _digest({"unavailable": True})
    bootstrap_started = False
    try:
        executable = runtime._codex_executable(selected)
        executable_hash = runtime._sha_file(executable)
        cli_version = runtime._cli_version(executable)
        bundle_hash = _digest(_bundle_manifest(executable_hash, cli_version))
        bootstrap_started = True
        parent, capability = _bootstrap(private_store_path, selected)
        executable_hash, cli_version = capability.executable_sha256, capability.cli_version
        bundle_hash = capability.bundle_sha256
        status, code = "succeeded", "ok"
    except PrivateStageRuntimeError as error:
        code = error.code
        if bootstrap_started:
            cleanup = "failed" if error.cleanup_code or code == "runtime_cleanup_failed" else "deleted"
    except runtime.PrivateRuntimeError as error:
        code = error.code
    finally:
        if capability is not None and parent is not None:
            cleanup = runtime._cleanup_attempt(capability.root, parent)
            if cleanup != "deleted":
                status, code = "failed", "runtime_cleanup_failed"
    return PreflightResult(
        status, code, bundle_hash, executable_hash, cli_version, REQUESTED_MODEL,
        False, _event_policy_hash(), round((time.monotonic() - started) * 1000), cleanup,
    )


def _stage_envelope(job: StageJob) -> bytes:
    if not isinstance(job, StageJob) or job.stage not in _SCHEMAS:
        raise PrivateStageRuntimeError("stage_job_invalid")
    if (
        not _ID.fullmatch(job.item_id) or not _ID.fullmatch(job.attempt_id)
        or not _ID.fullmatch(job.worker_job_id) or type(job.cycle) is not int or job.cycle < 0
        or not _SHA.fullmatch(job.input_hash) or type(job.input_json) is not bytes
        or len(job.input_json) > MAX_STAGE_INPUT_BYTES
        or sha256(job.input_json).hexdigest() != job.input_hash
    ):
        raise PrivateStageRuntimeError("stage_job_invalid")
    try:
        stage_input = _strict_json(job.input_json)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError):
        raise PrivateStageRuntimeError("stage_job_invalid") from None
    if type(stage_input) is not dict:
        raise PrivateStageRuntimeError("stage_job_invalid")
    skill_name, skill_version, skill_bytes, skill_hash = _skill(job.stage)
    value = {
        "binding": {
            "item_id": job.item_id, "attempt_id": job.attempt_id,
            "worker_job_id": job.worker_job_id, "stage": job.stage,
            "cycle": job.cycle, "input_sha256": job.input_hash,
            "schema_sha256": sha256(_SCHEMAS[job.stage]).hexdigest(),
            "skill_name": skill_name, "skill_version": skill_version,
            "skill_sha256": skill_hash,
        },
        "instructions": _PROMPTS[job.stage],
        "skill": skill_bytes.decode("utf-8"),
        "input": stage_input,
    }
    encoded = _canonical(value)
    if len(encoded) > runtime._MAX_PINNED_STDIN:
        raise PrivateStageRuntimeError("stage_input_too_large")
    return encoded


def _execute_stage(capability: _Capability, job: StageJob) -> StageResult:
    capability = _validate_capability(capability)
    envelope = _stage_envelope(job)
    attempt = capability.root / job.attempt_id
    observer = _EventObserver()
    primary: BaseException | None = None
    result: StageResult | None = None
    with capability.lock:
        try:
            capability = _validate_capability(capability)
            if runtime._sha_file(capability.executable) != capability.executable_sha256:
                raise PrivateStageRuntimeError("runtime_bundle_changed")
            attempt.mkdir(mode=0o700)
            for name in ("logs", "tmp"):
                (attempt / name).mkdir(mode=0o700)
            schema, output, stdin = (
                attempt / "schema.json", attempt / "output.json", attempt / "stdin.json",
            )
            _write(schema, _SCHEMAS[job.stage])
            _write(stdin, envelope)
            outcome = runtime._run_owned_windows_process(
                _command(
                    capability.executable, attempt, capability.state, schema, output, port=None,
                ),
                cwd=attempt, environ=_attempt_environment(attempt, capability.environ, ambient_auth=True),
                stdin_path=stdin, stdin_sha256=sha256(envelope).hexdigest(),
                deadline_seconds=_DEADLINE_SECONDS, stdout_observer=observer,
                stdout_limit_bytes=_EVENT_TOTAL_BYTES,
            )
            if outcome.timed_out:
                raise PrivateStageRuntimeError("runtime_timeout")
            if outcome.cancelled or outcome.exit_code != 0:
                raise PrivateStageRuntimeError("provider_unavailable")
            observer.finish()
            payload = _validate_output(output, _SCHEMAS[job.stage])
            raw_output = _read_bounded_regular(output, MAX_STAGE_OUTPUT_BYTES)
            output_bytes = _canonical(payload)
            for path in (stdin, schema, output):
                _delete(path, attempt)
            input_value = _strict_json(job.input_json)
            needles = (
                envelope, job.input_json, raw_output, output_bytes,
                *_distinctive_private_values(input_value, payload),
            )
            _scan_owned(capability.root, needles)
            result = StageResult(payload)
        except BaseException as error:
            capability.invalidated.set()
            primary = _normalized_error(error)
        cleanup_ok = not attempt.exists() or runtime._cleanup_attempt(
            attempt, capability.root,
        ) == "deleted"
        if not cleanup_ok:
            capability.invalidated.set()
        _finish_with_cleanup(primary, cleanup_ok=cleanup_ok)
    if result is None:
        raise PrivateStageRuntimeError("stage_runtime_failed")
    return result


@dataclass(frozen=True)
class _NativeStageAdapter:
    binding: StageBinding
    capability: _Capability = field(repr=False)

    def execute(self, job: StageJob) -> StageResult:
        try:
            return _execute_stage(self.capability, job)
        except PrivateStageRuntimeError as error:
            mapping = {
                "runtime_timeout": "stage_runtime_timeout",
                "tool_event_rejected": "stage_runtime_tool_rejected",
                "stage_output_invalid": "stage_runtime_output_invalid",
                "stage_output_too_large": "stage_runtime_output_invalid",
                "runtime_cleanup_failed": "stage_runtime_cleanup_failed",
            }
            translated = PipelineStageError(mapping.get(error.code, "stage_runtime_failed"))
            if error.cleanup_code is not None:
                setattr(translated, "cleanup_code", "stage_runtime_cleanup_failed")
            raise translated from None


def _adapters(capability: _Capability) -> Mapping[str, StageAdapter]:
    capability = _validate_capability(capability)
    values: dict[str, StageAdapter] = {}
    manifest = _bundle_manifest(capability.executable_sha256, capability.cli_version)
    for stage, schema in _SCHEMAS.items():
        skill_name, skill_version, _bytes, skill_hash = _skill(stage)
        stage_manifest = {
            "bundle": manifest, "stage": stage, "prompt": _PROMPTS[stage],
            "schema_sha256": sha256(schema).hexdigest(),
        }
        identity = sha256(_canonical(stage_manifest)).hexdigest()
        binding = StageBinding(
            f"private-{stage}-{identity[:16]}", "codex-cli-private",
            capability.cli_version, capability.executable_sha256,
            sha256(schema).hexdigest(), skill_name, skill_version, skill_hash,
            sha256(_canonical(stage_manifest)).hexdigest(),
        )
        values[stage] = _NativeStageAdapter(binding, capability)
    return MappingProxyType(values)


@contextmanager
def prepare_stage_adapters(
    private_store_path: Path,
) -> Iterator[Mapping[str, StageAdapter]]:
    """Yield adapters only after a same-process reviewed-bundle synthetic canary."""
    if ACCEPTED_RUNTIME_BUNDLE_SHA256 is None:
        raise PrivateStageRuntimeError("live_runtime_not_accepted")
    selected = _selected_environment(os.environ)
    try:
        executable = runtime._codex_executable(selected)
        current = _digest(_bundle_manifest(runtime._sha_file(executable), runtime._cli_version(executable)))
    except runtime.PrivateRuntimeError as error:
        raise PrivateStageRuntimeError(error.code) from None
    if current != ACCEPTED_RUNTIME_BUNDLE_SHA256:
        raise PrivateStageRuntimeError("live_runtime_not_accepted")
    parent, capability = _bootstrap(private_store_path, selected)
    primary: BaseException | None = None
    try:
        if capability.bundle_sha256 != current:
            raise PrivateStageRuntimeError("runtime_bundle_changed")
        yield _adapters(capability)
    except BaseException as error:
        primary = _normalized_error(error)
    capability.invalidated.set()
    cleanup_ok = runtime._cleanup_attempt(capability.root, parent) == "deleted"
    if not cleanup_ok:
        capability.invalidated.set()
    _finish_with_cleanup(primary, cleanup_ok=cleanup_ok)


__all__ = [
    "ACCEPTED_RUNTIME_BUNDLE_SHA256", "PreflightResult", "PrivateStageRuntimeError",
    "prepare_stage_adapters", "run_diagnostic_preflight",
]

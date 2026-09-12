from __future__ import annotations

from dataclasses import replace
import ctypes
from ctypes import wintypes
import hashlib
import http.client
import json
import os
from pathlib import Path
import sys
import threading
import time

import pytest

from jsonschema.validators import validator_for

from scripts.prospecting.personalizer import private_runtime as runtime


CLI = Path(os.environ.get("APPDATA", "")) / runtime._CLI_RELATIVE
REQUIRES_CODEX = pytest.mark.skipif(
    os.name != "nt" or not CLI.is_file(), reason="installed Windows Codex CLI required"
)


def _environment(tmp_path: Path) -> dict[str, str]:
    environ = {
        key: os.environ[key]
        for key in ("SYSTEMROOT", "WINDIR", "COMSPEC", "APPDATA")
        if key in os.environ
    }
    # Keep the fake desktop root short enough for bundled CLI skill paths on Windows.
    case = hashlib.sha256(str(tmp_path).encode()).hexdigest()[:12]
    local = Path("C:/Users/danie/kb/_private/prospecting-runtime-tests-20260909") / case
    environ["LOCALAPPDATA"] = str(local)
    environ["KB_PROSPECTING_STORE"] = str(local / "kb-prospecting" / "store.sqlite")
    return environ


def _request(attempt: str = "attempt-one", **changes: object) -> runtime.SyntheticTurnRequest:
    values: dict[str, object] = {
        "job_id": "job-one",
        "attempt_id": attempt,
        "attempt_token": "token-one",
        "run_id": "run-one",
        "workflow_id": "workflow-one",
        "workflow_version": "version-one",
        "workflow_hash": "a" * 64,
    }
    values.update(changes)
    return runtime.build_synthetic_request(**values)  # type: ignore[arg-type]


def _pinned_input(
    directory: Path, name: str, data: bytes = b"{}",
) -> tuple[Path, str]:
    path = directory / name
    path.write_bytes(data)
    return path, runtime._sha(data)


def test_synthetic_schema_properties_declare_explicit_types_for_strict_providers() -> None:
    schema = json.loads(runtime.SYNTHETIC_SCHEMA)
    properties = schema["properties"]

    assert properties["result"]["type"] == "string"
    assert properties["canary_seen"]["type"] == "boolean"
    assert properties["output_canary"]["type"] == "string"
    validator_for(schema).check_schema(schema)


def test_builder_rejects_non_synthetic_bytes_without_rendering_them() -> None:
    request = _request()
    secret = b"NON_SYNTHETIC_PRIVATE_TEXT_91C7"
    tampered = replace(
        request,
        input_json=secret,
        binding=replace(request.binding, input_sha256=runtime._sha(secret)),
    )

    with pytest.raises(runtime.PrivateRuntimeError) as caught:
        runtime.execute_synthetic_turn(tampered, environ={})

    assert caught.value.code == "synthetic_input_required"
    assert secret.decode() not in repr(tampered)
    assert secret.decode() not in str(caught.value)


def test_raw_request_and_result_bytes_are_not_in_repr() -> None:
    request = _request()
    result = runtime.PrivateTurnResult(
        binding=request.binding,
        status="succeeded",
        code="ok",
        output=runtime.OUTPUT_CANARY.encode(),
    )

    assert runtime.INPUT_CANARY not in repr(request)
    assert runtime.OUTPUT_CANARY not in repr(result)


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"binding": "missing-skill"}, "invalid_binding"),
        ({"deadline_seconds": True}, "invalid_deadline"),
        ({"max_output_bytes": False}, "invalid_output_limit"),
    ],
)
def test_malformed_dto_returns_fixed_code(change: dict[str, object], expected: str) -> None:
    request = _request()
    if change.get("binding") == "missing-skill":
        request = replace(request, binding=replace(request.binding, skill=None))  # type: ignore[arg-type]
    else:
        request = replace(request, **change)

    with pytest.raises(runtime.PrivateRuntimeError) as caught:
        runtime._validate_request(request)

    assert caught.value.code == expected


def test_store_outside_desktop_root_is_rejected(tmp_path: Path) -> None:
    environ = _environment(tmp_path)
    environ["KB_PROSPECTING_STORE"] = str(tmp_path / "outside.sqlite")

    with pytest.raises(runtime.PrivateRuntimeError) as caught:
        runtime._prepare_attempt(_request(), environ)

    assert caught.value.code == "private_root_invalid"


def test_existing_attempt_is_not_overwritten_or_deleted(tmp_path: Path) -> None:
    environ = _environment(tmp_path)
    attempt = (
        Path(environ["LOCALAPPDATA"])
        / "kb-prospecting"
        / "snapshots"
        / "private-runtime"
        / "attempt-one"
    )
    attempt.mkdir(parents=True)
    marker = attempt / "owner.txt"
    marker.write_text("other attempt", encoding="utf-8")

    with pytest.raises(runtime.PrivateRuntimeError) as caught:
        runtime._prepare_attempt(_request(), environ)

    assert caught.value.code == "attempt_exists"
    assert marker.read_text(encoding="utf-8") == "other attempt"


@pytest.mark.parametrize(
    "tools",
    [
        [{"type": "web_search"}],
        [{"type": "web_search", "name": "request_user_input"}],
        [
            {"type": "function", "name": "request_user_input"},
            {"type": "function", "name": "request_user_input"},
        ],
    ],
)
def test_fixture_rejects_malformed_or_side_effect_tool_declarations(
    tools: list[dict[str, str]],
) -> None:
    with runtime._RunningFixture("success") as server:
        connection = http.client.HTTPConnection(
            "127.0.0.1", int(server.server_address[1]), timeout=2
        )
        body = json.dumps({"tools": tools}).encode()
        connection.request(
            "POST", "/v1/responses", body=body,
            headers={"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        response.read()
        connection.close()

    assert response.status == 200
    assert server.unexpected_tool_declaration.is_set()


@REQUIRES_CODEX
def test_real_cli_success_is_structured_private_and_cleaned(tmp_path: Path) -> None:
    request = _request()
    environ = _environment(tmp_path)

    result = runtime.execute_synthetic_turn(request, environ=environ)

    assert result.status == "succeeded"
    assert result.code == "ok"
    assert json.loads(result.output or b"") == {
        "result": "synthetic_ok",
        "canary_seen": True,
        "output_canary": runtime.OUTPUT_CANARY,
    }
    assert result.output_sha256 == runtime._sha(result.output or b"")
    assert result.cleanup_state == "deleted"
    assert result.declared_tools in ((), ("request_user_input",))
    assert not any(result.sink_canary_paths.values())
    assert not (
        Path(environ["LOCALAPPDATA"])
        / "kb-prospecting/snapshots/private-runtime/attempt-one"
    ).exists()


@REQUIRES_CODEX
def test_error_canary_is_checked_across_cli_sinks_and_not_rendered(tmp_path: Path) -> None:
    request = _request(scenario="provider_error_canary")

    result = runtime.execute_synthetic_turn(request, environ=_environment(tmp_path))

    assert result.status == "failed"
    assert result.code == "output_missing"
    assert not any(result.sink_canary_paths.values())
    assert runtime.ERROR_CANARY not in repr(result)
    assert result.cleanup_state == "deleted"


@REQUIRES_CODEX
def test_emitted_benign_clarification_call_fails_without_waiting(tmp_path: Path) -> None:
    request = _request(
        scenario="request_user_input_call", deadline_seconds=10
    )

    result = runtime.execute_synthetic_turn(request, environ=_environment(tmp_path))

    assert result.status == "failed"
    assert result.code == "tool_call_rejected"
    assert result.elapsed_ms < 10_000
    assert result.declared_tools == ("request_user_input",)
    assert result.cleanup_state == "deleted"


@REQUIRES_CODEX
@pytest.mark.parametrize(
    ("scenario", "limit", "expected"),
    [
        ("malformed_output", 65_536, "output_invalid_json"),
        ("oversized_output", 1_024, "output_too_large"),
        ("schema_mismatch", 65_536, "output_schema_mismatch"),
    ],
)
def test_output_failures_have_fixed_codes(
    tmp_path: Path, scenario: str, limit: int, expected: str
) -> None:
    request = _request(scenario=scenario, max_output_bytes=limit)

    result = runtime.execute_synthetic_turn(request, environ=_environment(tmp_path))

    assert result.status == "failed"
    assert result.code == expected
    assert result.output is None
    assert result.cleanup_state == "deleted"


@REQUIRES_CODEX
def test_timeout_then_fresh_attempt_recovers(tmp_path: Path) -> None:
    environ = _environment(tmp_path)
    timed_out = runtime.execute_synthetic_turn(
        _request(attempt="attempt-timeout", scenario="stall", deadline_seconds=1),
        environ=environ,
    )
    recovered = runtime.execute_synthetic_turn(
        _request(attempt="attempt-recovery"), environ=environ
    )

    assert (timed_out.status, timed_out.code, timed_out.cleanup_state) == (
        "failed",
        "timeout",
        "deleted",
    )
    assert (recovered.status, recovered.code, recovered.cleanup_state) == (
        "succeeded",
        "ok",
        "deleted",
    )


def _process_is_active(pid: int) -> bool:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    handle = kernel32.OpenProcess(0x1000, False, pid)
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
    finally:
        kernel32.CloseHandle(handle)


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object required")
def test_maximum_pinned_input_is_read_directly_and_hash_matches(tmp_path: Path) -> None:
    payload = b"S" * runtime._MAX_PINNED_STDIN
    stdin_path, stdin_sha256 = _pinned_input(
        tmp_path, "maximum-input.json", payload,
    )
    observed = tmp_path / "observed.sha256"
    script = (
        "import hashlib,pathlib,sys;"
        f"pathlib.Path({str(observed)!r}).write_text("
        "hashlib.sha256(sys.stdin.buffer.read()).hexdigest())"
    )

    outcome = runtime._run_owned_windows_process(
        (sys.executable, "-c", script), cwd=tmp_path, environ=dict(os.environ),
        stdin_path=stdin_path, stdin_sha256=stdin_sha256, deadline_seconds=5,
    )

    assert outcome.exit_code == 0 and not outcome.timed_out
    assert observed.read_text() == stdin_sha256


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object required")
def test_pinned_input_rejects_hash_nested_path_and_hardlink_before_spawn(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "spawned.txt"
    script = f"from pathlib import Path;Path({str(marker)!r}).write_text('spawned')"
    stdin_path, stdin_sha256 = _pinned_input(tmp_path, "protected-input.json")

    with pytest.raises(runtime.PrivateRuntimeError, match="^stdin_hash_mismatch$"):
        runtime._run_owned_windows_process(
            (sys.executable, "-c", script), cwd=tmp_path, environ=dict(os.environ),
            stdin_path=stdin_path, stdin_sha256="0" * 64, deadline_seconds=5,
        )
    nested = tmp_path / "nested"
    nested.mkdir()
    nested_path, nested_sha256 = _pinned_input(nested, "nested-input.json")
    with pytest.raises(runtime.PrivateRuntimeError, match="^stdin_path_invalid$"):
        runtime._run_owned_windows_process(
            (sys.executable, "-c", script), cwd=tmp_path, environ=dict(os.environ),
            stdin_path=nested_path, stdin_sha256=nested_sha256, deadline_seconds=5,
        )
    hardlink = tmp_path / "protected-hardlink.json"
    os.link(stdin_path, hardlink)
    with pytest.raises(runtime.PrivateRuntimeError, match="^stdin_path_invalid$"):
        runtime._run_owned_windows_process(
            (sys.executable, "-c", script), cwd=tmp_path, environ=dict(os.environ),
            stdin_path=stdin_path, stdin_sha256=stdin_sha256, deadline_seconds=5,
        )

    assert not marker.exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object required")
def test_job_object_kills_descendant_and_runner_recovers(tmp_path: Path) -> None:
    child_pid = tmp_path / "child.pid"
    script = (
        "import pathlib,subprocess,sys,time;"
        "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);"
        f"pathlib.Path({str(child_pid)!r}).write_text(str(p.pid));"
        "time.sleep(60)"
    )
    environ = dict(os.environ)
    stdin_path, stdin_sha256 = _pinned_input(
        tmp_path, "unread-maximum-input.json", b"S" * runtime._MAX_PINNED_STDIN,
    )

    outcome = runtime._run_owned_windows_process(
        (sys.executable, "-c", script),
        cwd=tmp_path,
        environ=environ,
        stdin_path=stdin_path,
        stdin_sha256=stdin_sha256,
        deadline_seconds=1,
    )

    assert outcome.timed_out is True
    assert child_pid.exists()
    pid = int(child_pid.read_text())
    limit = time.monotonic() + 2
    while _process_is_active(pid) and time.monotonic() < limit:
        time.sleep(0.05)
    assert not _process_is_active(pid)

    marker = tmp_path / "recovered.txt"
    recovery_input, recovery_sha256 = _pinned_input(
        tmp_path, "recovery-input.json",
    )
    recovered = runtime._run_owned_windows_process(
        (sys.executable, "-c", f"from pathlib import Path;Path({str(marker)!r}).write_text('ok')"),
        cwd=tmp_path,
        environ=environ,
        stdin_path=recovery_input,
        stdin_sha256=recovery_sha256,
        deadline_seconds=5,
    )
    assert recovered.exit_code == 0
    assert recovered.timed_out is False
    assert marker.read_text() == "ok"


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object required")
def test_assignment_failure_terminates_suspended_process(tmp_path: Path) -> None:
    captured: dict[str, int] = {}
    stdin_path, stdin_sha256 = _pinned_input(tmp_path, "assignment-input.json")

    def reject_assignment(job: object, process: object, pid: int) -> bool:
        captured["pid"] = pid
        return False

    with pytest.raises(runtime.PrivateRuntimeError) as caught:
        runtime._run_owned_windows_process(
            (sys.executable, "-c", "import time;time.sleep(60)"),
            cwd=tmp_path,
            environ=dict(os.environ),
            stdin_path=stdin_path,
            stdin_sha256=stdin_sha256,
            deadline_seconds=5,
            _assign_process=reject_assignment,
        )

    assert caught.value.code == "job_assignment_failed"
    assert captured["pid"] > 0
    assert not _process_is_active(captured["pid"])
    stdin_path.write_bytes(b"handle closed")


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object required")
def test_spawn_failure_closes_pinned_input_and_fresh_run_recovers(tmp_path: Path) -> None:
    stdin_path, stdin_sha256 = _pinned_input(tmp_path, "spawn-input.json")

    with pytest.raises(runtime.PrivateRuntimeError, match="^process_start_failed$"):
        runtime._run_owned_windows_process(
            (str(tmp_path / "missing.exe"),), cwd=tmp_path,
            environ=dict(os.environ), stdin_path=stdin_path,
            stdin_sha256=stdin_sha256, deadline_seconds=5,
        )

    stdin_path.write_bytes(b"fresh input")
    fresh_sha256 = runtime._sha(b"fresh input")
    outcome = runtime._run_owned_windows_process(
        (sys.executable, "-c", "import sys;sys.stdin.buffer.read()"),
        cwd=tmp_path, environ=dict(os.environ), stdin_path=stdin_path,
        stdin_sha256=fresh_sha256, deadline_seconds=5,
    )
    assert outcome.exit_code == 0 and not outcome.timed_out


def test_owned_stdin_deletion_failure_is_fixed_code_and_attempt_is_cleaned(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_executable = tmp_path / "codex.exe"
    fake_executable.write_bytes(b"synthetic executable")
    monkeypatch.setattr(runtime, "_codex_executable", lambda environ: fake_executable)
    monkeypatch.setattr(runtime, "_sha_file", lambda path: "b" * 64)
    monkeypatch.setattr(runtime, "_cli_version", lambda path: "codex-cli synthetic")
    monkeypatch.setattr(
        runtime, "_run_owned_windows_process",
        lambda *args, **kwargs: runtime._ProcessOutcome(0, False, False),
    )

    def fail_delete(path: Path, attempt: Path) -> None:
        raise runtime.PrivateRuntimeError("stdin_cleanup_failed")

    monkeypatch.setattr(runtime, "_delete_owned_stdin", fail_delete)
    environ = _environment(tmp_path)

    result = runtime.execute_synthetic_turn(_request(), environ=environ)

    assert (result.status, result.code, result.cleanup_state) == (
        "failed", "stdin_cleanup_failed", "deleted",
    )
    assert not (
        Path(environ["LOCALAPPDATA"])
        / "kb-prospecting/snapshots/private-runtime/attempt-one"
    ).exists()


def test_orchestration_error_stops_observer_and_cleans_attempt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_executable = tmp_path / "codex.exe"
    fake_executable.write_bytes(b"synthetic executable")
    monkeypatch.setattr(runtime, "_codex_executable", lambda environ: fake_executable)
    monkeypatch.setattr(runtime, "_sha_file", lambda path: "b" * 64)
    monkeypatch.setattr(runtime, "_cli_version", lambda path: "codex-cli 0.153.4")

    def fail_process(*args: object, **kwargs: object) -> runtime._ProcessOutcome:
        raise runtime.PrivateRuntimeError("process_start_failed")

    monkeypatch.setattr(runtime, "_run_owned_windows_process", fail_process)

    result = runtime.execute_synthetic_turn(_request(), environ=_environment(tmp_path))

    assert (result.status, result.code, result.cleanup_state) == (
        "failed",
        "process_start_failed",
        "deleted",
    )
    assert not any(
        thread.name == "private-runtime-tool-observer" and thread.is_alive()
        for thread in threading.enumerate()
    )


def test_owned_process_streams_stdout_only_to_bounded_memory_observer(tmp_path: Path) -> None:
    stdin_path, stdin_sha256 = _pinned_input(tmp_path, "observer-input.json")
    chunks: list[bytes] = []
    outcome = runtime._run_owned_windows_process(
        (
            sys.executable, "-c",
            "import sys;sys.stdout.write('{\"type\":\"turn.completed\"}\\n');"
            "sys.stdout.flush();sys.stderr.write('discarded synthetic stderr')",
        ),
        cwd=tmp_path, environ=dict(os.environ), stdin_path=stdin_path,
        stdin_sha256=stdin_sha256, deadline_seconds=5,
        stdout_observer=chunks.append, stdout_limit_bytes=1024,
    )
    assert outcome.exit_code == 0 and not outcome.timed_out
    assert b'"type":"turn.completed"' in b"".join(chunks)


def test_owned_process_stdout_overflow_is_fixed_and_bounded(tmp_path: Path) -> None:
    stdin_path, stdin_sha256 = _pinned_input(tmp_path, "overflow-input.json")
    with pytest.raises(runtime.PrivateRuntimeError, match="^stdout_too_large$"):
        runtime._run_owned_windows_process(
            (sys.executable, "-c", "import sys;sys.stdout.write('x'*4096);sys.stdout.flush()"),
            cwd=tmp_path, environ=dict(os.environ), stdin_path=stdin_path,
            stdin_sha256=stdin_sha256, deadline_seconds=5,
            stdout_observer=lambda _chunk: None, stdout_limit_bytes=128,
        )


def test_owned_process_observer_rejection_terminates_without_waiting(tmp_path: Path) -> None:
    stdin_path, stdin_sha256 = _pinned_input(tmp_path, "reject-input.json")

    def reject(_chunk: bytes) -> None:
        raise runtime.PrivateRuntimeError("tool_event_rejected")

    started = time.monotonic()
    with pytest.raises(runtime.PrivateRuntimeError, match="^tool_event_rejected$"):
        runtime._run_owned_windows_process(
            (
                sys.executable, "-c",
                "import sys,time;sys.stdout.write('{\"type\":\"item.started\"}\\n');"
                "sys.stdout.flush();time.sleep(30)",
            ),
            cwd=tmp_path, environ=dict(os.environ), stdin_path=stdin_path,
            stdin_sha256=stdin_sha256, deadline_seconds=10,
            stdout_observer=reject, stdout_limit_bytes=1024,
        )
    assert time.monotonic() - started < 5
    assert not any(
        thread.name == "private-runtime-stdout-observer" and thread.is_alive()
        for thread in threading.enumerate()
    )

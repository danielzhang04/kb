from __future__ import annotations

from dataclasses import replace
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
from threading import Event, Lock
from types import MappingProxyType

import pytest
from jsonschema.validators import validator_for

from scripts.prospecting.pipeline_stage_service import (
    PipelineStageError,
    PipelineStageService,
    StageJob,
    StageResult,
)
from scripts.prospecting.personalizer import private_runtime as runtime
from scripts.prospecting.personalizer import private_stage_adapter as adapter
from scripts.prospecting.tests.test_pipeline_stage_service import ASK, NOW, POINT, _seed


CLI = Path(os.environ.get("APPDATA", "")) / runtime._CLI_RELATIVE
REQUIRES_CODEX = pytest.mark.skipif(
    os.name != "nt" or not CLI.is_file(), reason="installed Windows Codex CLI required",
)


def _capability(tmp_path: Path) -> adapter._Capability:
    return adapter._Capability(
        adapter._CAPABILITY_SENTINEL, tmp_path, tmp_path / "state", Path("codex.exe"),
        "a" * 64, "0.synthetic", "b" * 64, MappingProxyType({}), Lock(),
        Event(),
    )


def _executable_capability(tmp_path: Path) -> adapter._Capability:
    executable = tmp_path / "codex.exe"
    executable.write_bytes(b"synthetic executable")
    state = tmp_path / "state"
    state.mkdir(exist_ok=True)
    return adapter._Capability(
        adapter._CAPABILITY_SENTINEL, tmp_path, state, executable,
        hashlib.sha256(executable.read_bytes()).hexdigest(), "0.synthetic", "b" * 64,
        MappingProxyType({}), Lock(), Event(),
    )


def test_exact_three_schemas_and_full_humanizer_are_bound() -> None:
    assert set(adapter._SCHEMAS) == {
        "humanizer", "post_humanization_factcheck", "independent_critic",
    }
    skill = adapter._humanizer_bytes()
    assert len(skill) == 34_527
    assert hashlib.sha256(skill).hexdigest() == adapter.HUMANIZER_SHA256
    for schema_bytes in adapter._SCHEMAS.values():
        schema = json.loads(schema_bytes)
        validator_for(schema).check_schema(schema)
        assert schema["additionalProperties"] is False


def test_every_stage_wrapper_prompt_changes_the_reviewed_bundle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = adapter._digest(adapter._bundle_manifest("a" * 64, "0.synthetic"))
    changed = dict(adapter._PROMPTS)
    changed["humanizer"] += " Synthetic wrapper revision."
    monkeypatch.setattr(adapter, "_PROMPTS", MappingProxyType(changed))
    after = adapter._digest(adapter._bundle_manifest("a" * 64, "0.synthetic"))
    assert before != after
    assert "draft rewrite" in changed["humanizer"]


def test_full_humanizer_and_maximum_stage_input_are_not_clipped() -> None:
    filler = "x" * (1024 * 1024 - 64)
    input_json = json.dumps({"synthetic": filler}, separators=(",", ":")).encode()
    job = StageJob(
        "item-synthetic", "attempt-synthetic", "worker-synthetic", "humanizer", 0,
        hashlib.sha256(input_json).hexdigest(), input_json,
    )
    envelope = adapter._stage_envelope(job)
    decoded = json.loads(envelope)
    assert decoded["input"]["synthetic"] == filler
    assert decoded["skill"].encode() == adapter._humanizer_bytes()
    assert len(envelope) <= runtime._MAX_PINNED_STDIN


def test_event_observer_allows_only_lifecycle_and_non_tool_items() -> None:
    observer = adapter._EventObserver()
    rows = (
        {"type": "thread.started"}, {"type": "turn.started"},
        {"type": "item.completed", "item": {"type": "reasoning"}},
        {"type": "item.completed", "item": {"type": "agent_message"}},
        {"type": "turn.completed"},
    )
    raw = b"".join(json.dumps(row).encode() + b"\n" for row in rows)
    observer(raw[:17])
    observer(raw[17:])
    observer.finish()
    for item_type in ("command_execution", "mcp_tool_call", "web_search", "request_user_input"):
        rejected = adapter._EventObserver()
        with pytest.raises(runtime.PrivateRuntimeError, match="^tool_event_rejected$"):
            rejected(json.dumps({"type": "item.started", "item": {"type": item_type}}).encode() + b"\n")
    provider_error = adapter._EventObserver()
    with pytest.raises(runtime.PrivateRuntimeError, match="^provider_unavailable$"):
        provider_error(b'{"type":"item.completed","item":{"type":"error"}}\n')
    unknown = adapter._EventObserver()
    with pytest.raises(runtime.PrivateRuntimeError, match="^event_stream_invalid$"):
        unknown(b'{"type":"future.event"}\n')
    for malformed in (
        b'{"type":"turn.completed","type":"turn.completed"}\n',
        b'{"type":"turn.completed","sequence":NaN}\n',
        b'{"type":"turn.completed","sequence":1e999}\n',
    ):
        strict = adapter._EventObserver()
        with pytest.raises(runtime.PrivateRuntimeError, match="^event_stream_invalid$"):
            strict(malformed)


@REQUIRES_CODEX
def test_cache_is_primed_before_live_canary_from_empty_invented_home(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = (tmp_path / "store.sqlite").resolve()
    store.touch()
    observed: list[bool] = []

    def synthetic_canary(capability: adapter._Capability) -> None:
        observed.append(any(path.is_file() for path in capability.state.rglob("*")))
        assert not (capability.root / "empty-home").exists()
        assert not (capability.root / "prime").exists()

    monkeypatch.setattr(adapter, "_run_live_canary", synthetic_canary)
    selected = dict(os.environ)
    selected["SYNTHETIC_SECRET"] = "must-not-be-retained"
    parent, capability = adapter._bootstrap(store, selected)
    assert observed == [True]
    assert "SYNTHETIC_SECRET" not in capability.environ
    assert runtime._cleanup_attempt(capability.root, parent) == "deleted"


def test_public_stage_path_is_source_disabled_before_bootstrap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = False

    def forbidden(*_args: object, **_kwargs: object):
        nonlocal called
        called = True
        raise AssertionError

    monkeypatch.setattr(adapter, "_bootstrap", forbidden)
    monkeypatch.setattr(runtime, "_codex_executable", forbidden)
    with pytest.raises(adapter.PrivateStageRuntimeError, match="^live_runtime_not_accepted$"):
        with adapter.prepare_stage_adapters((tmp_path / "store.sqlite").resolve()):
            pass
    assert called is False


def test_prepared_capability_is_invalidated_when_controller_context_closes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    executable = tmp_path / "codex.exe"
    executable.write_bytes(b"synthetic executable")
    executable_hash = hashlib.sha256(executable.read_bytes()).hexdigest()
    cli_version = "0.synthetic"
    bundle = adapter._digest(adapter._bundle_manifest(executable_hash, cli_version))
    capability = replace(
        _capability(tmp_path), executable=executable,
        executable_sha256=executable_hash, cli_version=cli_version,
        bundle_sha256=bundle,
    )
    monkeypatch.setattr(adapter, "ACCEPTED_RUNTIME_BUNDLE_SHA256", bundle)
    monkeypatch.setattr(runtime, "_codex_executable", lambda _selected: executable)
    monkeypatch.setattr(runtime, "_sha_file", lambda _path: executable_hash)
    monkeypatch.setattr(runtime, "_cli_version", lambda _path: cli_version)
    monkeypatch.setattr(adapter, "_bootstrap", lambda _store, _selected: (tmp_path, capability))
    monkeypatch.setattr(runtime, "_cleanup_attempt", lambda _root, _parent: "deleted")
    with adapter.prepare_stage_adapters((tmp_path / "store.sqlite").resolve()) as values:
        assert set(values) == set(adapter._SCHEMAS)
        assert not capability.invalidated.is_set()
    assert capability.invalidated.is_set()


def test_adapter_bindings_drive_actual_p16_lifecycle_without_forged_receipts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, revision = _seed(tmp_path)
    capability = _capability(tmp_path)
    payloads = {
        "humanizer": {
            "draft": f"Hello there. {POINT}. {ASK}",
            "audit": "Synthetic audit.", "final_subject": "A natural example subject",
            "final_body": f"Hello there. {POINT}. {ASK}",
        },
        "post_humanization_factcheck": {
            "decision": "pass", "bindings": [
                {"slot": "why_them", "value": POINT, "source_kind": "evidence", "source_ref": "evidence-a"},
                {"slot": "ask", "value": ASK, "source_kind": "policy", "source_ref": "policy.ask"},
            ], "uncertainty": [], "shortfalls": [],
        },
        "independent_critic": {"decision": "pass", "reasons": [], "repair_instructions": ""},
    }
    calls: list[tuple[str, str]] = []

    def execute(_capability: object, job: StageJob) -> StageResult:
        calls.append((job.stage, job.worker_job_id))
        return StageResult(payloads[job.stage])

    monkeypatch.setattr(adapter, "_execute_stage", execute)
    service = PipelineStageService(
        connection, adapters=adapter._adapters(capability),
        now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "adapter-start")
    for request in ("adapter-human", "adapter-fact", "adapter-critic"):
        item = service.run_next(item.item_id, request)
    assert item.state == "human_review"
    assert [stage for stage, _job in calls] == [
        "humanizer", "post_humanization_factcheck", "independent_critic",
    ]
    assert len({job for _stage, job in calls}) == 3
    attempts = connection.execute(
        "SELECT runtime_id,runtime_hash,schema_hash,skill_content_hash FROM prospecting_stage_attempt",
    ).fetchall()
    assert len(attempts) == 3 and all(row["runtime_id"] == "codex-cli-private" for row in attempts)
    connection.close()


def test_stage_envelope_rejects_non_object_input_and_invalid_capability(tmp_path: Path) -> None:
    for raw in (
        b"[]", b'{"value":1,"value":2}', b'{"value":NaN}', b'{"value":1e999}',
    ):
        job = StageJob(
            "item-synthetic", "attempt-synthetic", "worker-synthetic", "humanizer", 0,
            hashlib.sha256(raw).hexdigest(), raw,
        )
        with pytest.raises(adapter.PrivateStageRuntimeError, match="^stage_job_invalid$"):
            adapter._stage_envelope(job)
    capability = _capability(tmp_path)
    capability.invalidated.set()
    with pytest.raises(adapter.PrivateStageRuntimeError, match="^runtime_capability_invalid$"):
        adapter._adapters(capability)


def test_failed_stage_execution_invalidates_capability_and_cleans_attempt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    capability = _executable_capability(tmp_path)
    raw = b"{}"
    job = StageJob(
        "item-synthetic", "attempt-synthetic", "worker-synthetic", "humanizer", 0,
        hashlib.sha256(raw).hexdigest(), raw,
    )

    def fail(*_args: object, **_kwargs: object) -> object:
        raise runtime.PrivateRuntimeError("provider_unavailable")

    monkeypatch.setattr(runtime, "_run_owned_windows_process", fail)
    with pytest.raises(adapter.PrivateStageRuntimeError, match="^provider_unavailable$"):
        adapter._execute_stage(capability, job)
    assert capability.invalidated.is_set()
    assert not (tmp_path / "attempt-synthetic").exists()


def test_cleanup_failure_is_separate_evidence_and_never_replaces_primary() -> None:
    primary = adapter.PrivateStageRuntimeError("provider_unavailable")
    with pytest.raises(adapter.PrivateStageRuntimeError, match="^provider_unavailable$") as caught:
        adapter._finish_with_cleanup(primary, cleanup_ok=False)
    assert caught.value.code == "provider_unavailable"
    assert caught.value.cleanup_code == "runtime_cleanup_failed"


def test_adapter_keeps_primary_code_when_cleanup_also_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    capability = _capability(tmp_path)
    stage_adapter = adapter._NativeStageAdapter(
        adapter._adapters(capability)["humanizer"].binding, capability,
    )
    primary = adapter.PrivateStageRuntimeError(
        "provider_unavailable", cleanup_code="runtime_cleanup_failed",
    )
    def fail(*_args: object) -> StageResult:
        raise primary

    monkeypatch.setattr(adapter, "_execute_stage", fail)
    with pytest.raises(PipelineStageError, match="^stage_runtime_failed$") as caught:
        stage_adapter.execute(object())  # type: ignore[arg-type]
    assert getattr(caught.value, "cleanup_code") == "stage_runtime_cleanup_failed"


def test_output_decoder_rejects_duplicate_and_nonfinite_json(tmp_path: Path) -> None:
    output = tmp_path / "output.json"
    for raw in (
        b'{"draft":"a","draft":"b","audit":"a","final_subject":"s","final_body":"b"}',
        b'{"draft":"a","audit":NaN,"final_subject":"s","final_body":"b"}',
        b'{"draft":"a","audit":1e999,"final_subject":"s","final_body":"b"}',
    ):
        output.write_bytes(raw)
        with pytest.raises(adapter.PrivateStageRuntimeError, match="^stage_output_invalid$"):
            adapter._validate_output(output, adapter._SCHEMAS["humanizer"])


def test_no_event_timeout_keeps_process_status_for_canary_and_stage(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    capability = _executable_capability(tmp_path)
    monkeypatch.setattr(
        runtime, "_run_owned_windows_process",
        lambda *_args, **_kwargs: runtime._ProcessOutcome(0, True, False),
    )
    with pytest.raises(adapter.PrivateStageRuntimeError, match="^runtime_timeout$"):
        adapter._run_live_canary(capability)
    raw = b"{}"
    job = StageJob(
        "item-synthetic", "attempt-synthetic", "worker-synthetic", "humanizer", 0,
        hashlib.sha256(raw).hexdigest(), raw,
    )
    with pytest.raises(adapter.PrivateStageRuntimeError, match="^runtime_timeout$"):
        adapter._execute_stage(capability, job)
    assert capability.invalidated.is_set()


def test_stage_sink_scan_detects_standalone_final_body_fragment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    capability = _executable_capability(tmp_path)
    raw = b'{"synthetic_context":"A distinctive saved input sentence."}'
    job = StageJob(
        "item-synthetic", "attempt-synthetic", "worker-synthetic", "humanizer", 0,
        hashlib.sha256(raw).hexdigest(), raw,
    )
    final_body = "A distinctive final body fragment for the sink check."
    payload = {
        "draft": "A synthetic draft rewrite.", "audit": "No synthetic issues remain.",
        "final_subject": "A synthetic subject", "final_body": final_body,
    }

    def complete(*_args: object, **kwargs: object) -> runtime._ProcessOutcome:
        output = tmp_path / "attempt-synthetic" / "output.json"
        output.write_bytes(json.dumps(payload, separators=(",", ":")).encode())
        observer = kwargs["stdout_observer"]
        observer(b'{"type":"thread.started"}\n{"type":"turn.started"}\n')
        observer(b'{"type":"item.completed","item":{"type":"agent_message"}}\n')
        observer(b'{"type":"turn.completed"}\n')
        (capability.state / "synthetic-leak.bin").write_bytes(final_body.encode())
        return runtime._ProcessOutcome(0, False, False)

    monkeypatch.setattr(runtime, "_run_owned_windows_process", complete)
    with pytest.raises(adapter.PrivateStageRuntimeError, match="^prohibited_content_logged$"):
        adapter._execute_stage(capability, job)
    assert capability.invalidated.is_set()

from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import json
from pathlib import Path
from threading import Event, Lock
from types import MappingProxyType, SimpleNamespace

import pytest

from scripts.prospecting import qualification_stage_cli as cli
from scripts.prospecting.pipeline_stage_service import PipelineStageError, StageJob, StageResult
from scripts.prospecting.personalizer import private_stage_adapter as runtime_adapter
from scripts.prospecting.qualification_service import (
    QualificationError,
    QualificationService,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_qualification_service import (
    _qualification_request,
    _ready_store,
    _supported_payload,
)


ITEM = "pqit_" + "a" * 32
REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def _paths(monkeypatch, store: Path) -> None:
    marker = SimpleNamespace()
    monkeypatch.setattr(cli, "_approved_store", lambda _path: (store, marker))
    monkeypatch.setattr(
        cli, "_safe_existing_file",
        lambda path, _code, expected=None: (path, marker),
    )


def _capability(root: Path) -> runtime_adapter._Capability:
    bundle = runtime_adapter._digest(
        runtime_adapter._bundle_manifest("a" * 64, "0.synthetic"),
    )
    return runtime_adapter._Capability(
        runtime_adapter._CAPABILITY_SENTINEL, root, root / "runtime-state",
        Path("codex.exe"), "a" * 64, "0.synthetic", bundle,
        MappingProxyType({}), Lock(), Event(),
    )


def test_source_gate_refuses_before_private_store_open(monkeypatch, tmp_path, capsys) -> None:
    store = tmp_path / "store.sqlite"
    _paths(monkeypatch, store)
    opened = False

    @contextmanager
    def refused(_store):
        raise runtime_adapter.PrivateStageRuntimeError("live_runtime_not_accepted")
        yield {}

    def open_forbidden(_store):
        nonlocal opened
        opened = True
        raise AssertionError

    monkeypatch.setattr(cli, "prepare_stage_adapters", refused)
    monkeypatch.setattr(cli, "open_store", open_forbidden)
    assert cli.main([
        "--store", str(store), "--item-id", ITEM, "--request-id", REQUEST,
    ]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "qualification_stage_cli_error:live_runtime_not_accepted\n"
    assert opened is False


def test_cli_runs_one_real_p19_step_and_emits_metadata_only(
    monkeypatch, tmp_path, capsys,
) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)
    service = QualificationService(connection)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    store = Path(connection.execute("PRAGMA database_list").fetchone()[2])
    connection.close()
    _paths(monkeypatch, store)
    stage_adapter = runtime_adapter._adapters(_capability(tmp_path))["qualification_factcheck"]

    def execute(_capability: object, job: StageJob, asset: object) -> StageResult:
        decoded = json.loads(runtime_adapter._stage_envelope(job, asset))
        return StageResult(_supported_payload(decoded["input"]))

    @contextmanager
    def prepared(_store):
        yield {"qualification_factcheck": stage_adapter}

    monkeypatch.setattr(runtime_adapter, "_execute_stage", execute)
    monkeypatch.setattr(cli, "prepare_stage_adapters", prepared)
    assert cli.main([
        "--store", str(store), "--item-id", item_id, "--request-id", REQUEST,
    ]) == 0
    captured = capsys.readouterr()
    assert captured.err == ""
    output = json.loads(captured.out)
    assert output == {
        "item_id": item_id,
        "state": "machine_reviewed",
        "candidate_count": 1,
        "context_codes": [],
        "company_outcome": "source_supported",
        "person_counts": {
            "contradicted": 0, "current_role_supported": 1, "unknown": 0,
        },
    }
    assert "Synthetic" not in captured.out and "source_url" not in captured.out
    persisted = open_store(store)
    try:
        attempt = persisted.execute(
            "SELECT * FROM prospecting_qualification_attempt WHERE item_id=?", (item_id,),
        ).fetchone()
        artifact = persisted.execute(
            "SELECT * FROM prospecting_qualification_artifact WHERE item_id=?", (item_id,),
        ).fetchone()
        assert attempt["state"] == "succeeded"
        assert artifact["skill_name"] == "prospecting-qualification-factcheck"
        assert artifact["schema_hash"] == sha256(
            runtime_adapter._SCHEMAS["qualification_factcheck"],
        ).hexdigest()
    finally:
        persisted.close()


def test_cli_preserves_whitelisted_cleanup_evidence_after_controller_normalizes_error(
    monkeypatch, tmp_path, capsys,
) -> None:
    store = tmp_path / "store.sqlite"
    _paths(monkeypatch, store)
    stage_adapter = runtime_adapter._adapters(_capability(tmp_path))["qualification_factcheck"]
    raw = b"{}"
    job = StageJob(
        ITEM, "pqat_" + "b" * 32, "pqwj_" + "c" * 32,
        "qualification_factcheck", 0, sha256(raw).hexdigest(), raw,
    )

    def cleanup_failed(*_args: object) -> StageResult:
        raise runtime_adapter.PrivateStageRuntimeError("runtime_cleanup_failed")

    monkeypatch.setattr(runtime_adapter, "_execute_stage", cleanup_failed)
    with pytest.raises(PipelineStageError, match="^stage_runtime_cleanup_failed$"):
        stage_adapter.execute(job)

    @contextmanager
    def prepared(_store):
        yield {"qualification_factcheck": stage_adapter}

    class Service:
        def __init__(self, _connection, *, adapters):
            assert adapters == {"qualification_factcheck": stage_adapter}

        def run_next(self, _item_id, _request_id):
            raise QualificationError("qualification_adapter_failed")

    monkeypatch.setattr(cli, "prepare_stage_adapters", prepared)
    monkeypatch.setattr(cli, "open_store", lambda _store: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(cli, "QualificationService", Service)
    assert cli.main([
        "--store", str(store), "--item-id", ITEM, "--request-id", REQUEST,
    ]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == (
        "qualification_stage_cli_error:qualification_adapter_failed\n"
        "qualification_stage_cli_cleanup:stage_runtime_cleanup_failed\n"
    )


def test_cli_preserves_context_cleanup_evidence_on_the_primary_error(
    monkeypatch, tmp_path, capsys,
) -> None:
    store = tmp_path / "store.sqlite"
    _paths(monkeypatch, store)
    stage_adapter = object()

    @contextmanager
    def prepared(_store):
        yield {"qualification_factcheck": stage_adapter}

    class Service:
        def __init__(self, _connection, *, adapters):
            assert adapters == {"qualification_factcheck": stage_adapter}

        def run_next(self, _item_id, _request_id):
            error = QualificationError("qualification_context_stale")
            setattr(error, "cleanup_code", "runtime_cleanup_failed")
            raise error

    monkeypatch.setattr(cli, "prepare_stage_adapters", prepared)
    monkeypatch.setattr(cli, "open_store", lambda _store: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(cli, "QualificationService", Service)
    assert cli.main([
        "--store", str(store), "--item-id", ITEM, "--request-id", REQUEST,
    ]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == (
        "qualification_stage_cli_error:qualification_context_stale\n"
        "qualification_stage_cli_cleanup:runtime_cleanup_failed\n"
    )


def test_cli_rejects_noncanonical_ids_without_opening_the_store(
    monkeypatch, tmp_path, capsys,
) -> None:
    store = tmp_path / "store.sqlite"
    opened = False

    def forbidden(_path):
        nonlocal opened
        opened = True
        raise AssertionError

    monkeypatch.setattr(cli, "_approved_store", forbidden)
    for item, request, code in (
        ("item-" + "a" * 32, REQUEST, "invalid_item_id"),
        (ITEM, "not-a-uuid", "invalid_request_id"),
    ):
        assert cli.main([
            "--store", str(store), "--item-id", item, "--request-id", request,
        ]) == 2
        assert capsys.readouterr().err == f"qualification_stage_cli_error:{code}\n"
    assert opened is False

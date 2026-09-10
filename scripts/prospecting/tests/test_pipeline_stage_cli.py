from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

from scripts.prospecting import pipeline_stage_cli as cli
from scripts.prospecting.personalizer.private_stage_adapter import (
    PreflightResult,
    PrivateStageRuntimeError,
)


STORE = Path("C:/synthetic/private/store.sqlite")
ITEM = "item-" + "a" * 32
REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def _paths(monkeypatch) -> None:
    marker = SimpleNamespace()
    monkeypatch.setattr(cli, "_approved_store", lambda _path: (STORE, marker))
    monkeypatch.setattr(cli, "_safe_existing_file", lambda path, _code, expected=None: (path, marker))


def test_diagnostic_preflight_is_metadata_only_and_never_authorizes_later_process(
    monkeypatch, capsys,
) -> None:
    _paths(monkeypatch)
    monkeypatch.setattr(cli, "run_diagnostic_preflight", lambda _store: PreflightResult(
        "succeeded", "ok", "a" * 64, "b" * 64, "0.synthetic", "gpt-6-astra",
        False, "c" * 64, 25, "deleted",
    ))
    assert cli.main(["--store", str(STORE), "--preflight"]) == 0
    captured = capsys.readouterr()
    assert captured.err == ""
    assert '"authorizes_later_process":false' in captured.out
    assert '"responding_model_verified":false' in captured.out
    assert "synthetic/private" not in captured.out


def test_stage_mode_requires_same_process_capability_before_store_open(
    monkeypatch, capsys,
) -> None:
    _paths(monkeypatch)
    opened = False

    @contextmanager
    def refused(_store):
        raise PrivateStageRuntimeError("live_runtime_not_accepted")
        yield {}

    def open_forbidden(_store):
        nonlocal opened
        opened = True
        raise AssertionError

    monkeypatch.setattr(cli, "prepare_stage_adapters", refused)
    monkeypatch.setattr(cli, "open_store", open_forbidden)
    assert cli.main([
        "--store", str(STORE), "--item-id", ITEM, "--request-id", REQUEST,
    ]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "pipeline_stage_cli_error:live_runtime_not_accepted\n"
    assert opened is False


def test_cli_reports_cleanup_evidence_separately_from_primary_error(
    monkeypatch, capsys,
) -> None:
    _paths(monkeypatch)

    @contextmanager
    def refused(_store):
        raise PrivateStageRuntimeError(
            "provider_unavailable", cleanup_code="runtime_cleanup_failed",
        )
        yield {}

    monkeypatch.setattr(cli, "prepare_stage_adapters", refused)
    assert cli.main([
        "--store", str(STORE), "--item-id", ITEM, "--request-id", REQUEST,
    ]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == (
        "pipeline_stage_cli_error:provider_unavailable\n"
        "pipeline_stage_cli_cleanup:runtime_cleanup_failed\n"
    )


def test_stage_mode_runs_exactly_one_existing_controller_step_and_emits_safe_metadata(
    monkeypatch, capsys,
) -> None:
    _paths(monkeypatch)
    connection = SimpleNamespace(close=lambda: None)
    calls = []

    @contextmanager
    def prepared(_store):
        yield {"humanizer": object()}

    class Service:
        def __init__(self, supplied_connection, *, adapters):
            assert supplied_connection is connection
            assert set(adapters) == {"humanizer"}

        def run_next(self, item_id, request_id):
            calls.append((item_id, request_id))
            return SimpleNamespace(
                item_id=item_id, state="awaiting_post_factcheck_adapter",
                next_stage="post_humanization_factcheck", repair_cycle=0,
            )

    monkeypatch.setattr(cli, "prepare_stage_adapters", prepared)
    monkeypatch.setattr(cli, "open_store", lambda _store: connection)
    monkeypatch.setattr(cli, "PipelineStageService", Service)
    assert cli.main([
        "--store", str(STORE), "--item-id", ITEM, "--request-id", REQUEST,
    ]) == 0
    captured = capsys.readouterr()
    assert captured.err == ""
    assert calls == [(ITEM, REQUEST)]
    assert captured.out == (
        '{"item_id":"' + ITEM + '","next_stage":"post_humanization_factcheck",'
        '"repair_cycle":0,"state":"awaiting_post_factcheck_adapter"}\n'
    )


def test_cli_rejects_partial_or_noncanonical_stage_arguments(monkeypatch, capsys) -> None:
    _paths(monkeypatch)
    assert cli.main(["--store", str(STORE), "--item-id", ITEM]) == 2
    assert capsys.readouterr().err == "pipeline_stage_cli_error:invalid_request_id\n"
    assert cli.main([
        "--store", str(STORE), "--item-id", ITEM, "--request-id", "not-a-uuid",
    ]) == 2
    assert capsys.readouterr().err == "pipeline_stage_cli_error:invalid_request_id\n"

"""Synthetic checks for file-mediated fit-spec compilation."""

from __future__ import annotations

import shutil
import json
from pathlib import Path

import pytest

from scripts.prospecting.affinity.ask_compile import compile_fit_spec, read_response
from scripts.prospecting.affinity.fitspec import FitSpecError
from scripts.prospecting.operator import cli as operator_cli
from scripts.prospecting.store import open_store, resolve_store_path


ANCHORS = Path(__file__).resolve().parents[3] / "orgs" / "prospecting" / "fixtures" / "affinity" / "sender-anchors-synthetic.json"
NOW = "2099-01-02T03:04:05Z"


def _draft_campaign(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[object, str]:
    store_path = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store_path))
    shutil.copyfile(ANCHORS, tmp_path / "sender-anchors.json")
    connection = open_store(store_path)
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual", sender_profile_path=None,
        name=None, lanes=("manual",),
    )
    return connection, campaign_id


def _ask_file(tmp_path: Path) -> Path:
    path = tmp_path / "desktop-ask.txt"
    path.write_text("path: corporate strategy", encoding="utf-8")
    return path


def _write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "fit-response.json"
    path.write_text(text, encoding="utf-8")
    return path


def test_prompt_is_written_beside_the_store_never_in_a_subdirectory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    connection, campaign_id = _draft_campaign(tmp_path, monkeypatch)
    outcome = compile_fit_spec(connection, campaign_id, _ask_file(tmp_path), None, NOW)
    assert outcome.state == "awaiting_model"
    assert outcome.job_path is not None
    assert outcome.job_path.parent == resolve_store_path().parent
    assert outcome.job_path.name == f"fit-job-{campaign_id}.txt"
    assert outcome.job_path.read_text(encoding="utf-8").count("corporate strategy") == 1
    assert "corporate strategy" not in capsys.readouterr().out


def test_a_response_with_prose_around_the_object_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(FitSpecError, match="fit_spec_schema"):
        read_response(_write(tmp_path, 'Here is the spec:\n{"version": 1}'))


def test_camp_id_is_resolved_to_a_uuid_before_compile_ask(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection, campaign_id = _draft_campaign(tmp_path, monkeypatch)
    assert campaign_id.startswith("camp_")
    outcome = compile_fit_spec(connection, campaign_id, _ask_file(tmp_path), None, NOW)
    assert outcome.state == "awaiting_model"


def test_compile_locks_only_the_campaign_with_executed_work(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection, executed_campaign = _draft_campaign(tmp_path, monkeypatch)
    _connection, fresh_campaign = _draft_campaign(tmp_path, monkeypatch)
    policy_hash = connection.execute(
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (executed_campaign,)
    ).fetchone()[0]
    connection.execute(
        """INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,approval_id,
           created_at,claimed_at,state,reason) VALUES(?,?,?,?,?,?,?,?,?,?)""",
        ("req_compile_lock", "test", "fetch_snapshot", json.dumps({"campaign_id": executed_campaign}),
         policy_hash, None, NOW, None, "queued", None),
    )

    assert compile_fit_spec(connection, fresh_campaign, _ask_file(tmp_path), None, NOW).state == "awaiting_model"
    with pytest.raises(FitSpecError, match="fit_spec_locked"):
        compile_fit_spec(connection, executed_campaign, _ask_file(tmp_path), None, NOW)

"""CLI contract tests for the P8 affinity commands."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.prospecting.affinity import cli
from scripts.prospecting.operator import cli as operator_cli
from scripts.prospecting.store import open_store


def _campaign(tmp_path: Path, monkeypatch) -> tuple[object, str]:
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "store.sqlite"))
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual", sender_profile_path=None,
        name=None, lanes=("manual",),
    )
    return connection, campaign_id


def test_list_fit_reports_bands_and_codes_only(tmp_path: Path, monkeypatch, capsys) -> None:
    connection, campaign_id = _campaign(tmp_path, monkeypatch)
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ("per_0000000000000001", "Sample", "Sample Person", "manual", "sample-person"),
    )
    connection.execute(
        "INSERT INTO person_affinity VALUES(?,?,?,?,?,?)",
        ("per_0000000000000001", campaign_id, 75, '[{"code":"shared_school"}]',
         "2099-01-02T03:04:05Z", "a" * 64),
    )
    assert cli.main(["list", "--fit", "--campaign", campaign_id]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert set(payload) == {
        "campaign", "band_0_24", "band_25_49", "band_50_74", "band_75_100", "unscored",
        "reason_shared_school", "reason_shared_prior_employer", "reason_path_match",
        "reason_own_writing", "reason_board_or_portfolio", "reason_firm_thesis",
        "reason_role_family_match", "reason_level_match",
    }
    assert payload["band_75_100"] == payload["reason_shared_school"] == 1


def test_an_ask_file_outside_the_desktop_root_is_refused(tmp_path: Path, monkeypatch) -> None:
    _connection, campaign_id = _campaign(tmp_path, monkeypatch)
    assert cli.main(["ask", "compile", "--campaign", campaign_id,
                     "--ask-file", str(tmp_path / "elsewhere" / "ask.txt")]) == 1


def test_an_unknown_value_error_prints_a_pii_checked_stable_code(tmp_path: Path, monkeypatch, capsys) -> None:
    _connection, campaign_id = _campaign(tmp_path, monkeypatch)
    monkeypatch.setattr(cli, "load_anchors", lambda _path: object())

    def boom(*_args, **_kwargs):
        raise ValueError("sample failure text")

    monkeypatch.setattr(cli, "score_campaign", boom)
    assert cli.main(["score", "--campaign", campaign_id]) == 1
    assert json.loads(capsys.readouterr().out) == {
        "error": "affinity_refused", "reason": "value_error", "code": "sample failure text",
    }


def test_invalid_arguments_never_echo_the_supplied_value(capsys) -> None:
    assert cli.main(["score", "--campaign", "not-an-opaque-id"]) == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload == {"error": "affinity_refused", "reason": "invalid_arguments"}


def test_linkedin_pages_directory_outside_the_store_parent_is_refused(tmp_path: Path, monkeypatch, capsys) -> None:
    _connection, campaign_id = _campaign(tmp_path, monkeypatch)
    outside = tmp_path.parent / "linkedin-pages"
    outside.mkdir(exist_ok=True)

    assert cli.main([
        "research", "run", "--campaign", campaign_id, "--linkedin-pages-dir", str(outside),
    ]) == 1
    assert json.loads(capsys.readouterr().out) == {
        "error": "affinity_refused", "reason": "invalid_arguments",
    }


def test_mutability_is_scoped_to_the_campaign_with_executed_requests(tmp_path: Path, monkeypatch) -> None:
    connection, executed_campaign = _campaign(tmp_path, monkeypatch)
    _connection, fresh_campaign = _campaign(tmp_path, monkeypatch)
    policy_hash = connection.execute(
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (executed_campaign,)
    ).fetchone()[0]
    connection.execute(
        """INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,approval_id,
           created_at,claimed_at,state,reason) VALUES(?,?,?,?,?,?,?,?,?,?)""",
        ("req_affinity_lock", "test", "fetch_snapshot", json.dumps({"campaign_id": executed_campaign}),
         policy_hash, None, "2099-01-02T03:04:05Z", None, "queued", None),
    )

    cli._require_mutable(connection, fresh_campaign)
    with pytest.raises(ValueError, match="fit_spec_locked"):
        cli._require_mutable(connection, executed_campaign)

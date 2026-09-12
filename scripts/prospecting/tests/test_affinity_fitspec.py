"""Synthetic checks for fit-spec validation and approval."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest

from scripts.prospecting.affinity.fitspec import (
    COPY_PROFILE_DEFAULT, DEFAULT_CADENCE, FitSpecError, approve_fit_spec,
    canonical_bytes, fit_spec_hash, store_proposed, validate_fit_spec,
)
from scripts.prospecting.affinity import fitspec
from scripts.prospecting.operator import cli as operator_cli
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.store import open_store


FIXTURE = Path(__file__).resolve().parents[3] / "orgs" / "prospecting" / "fixtures" / "affinity" / "fit-specs.json"
NOW = "2099-01-02T03:04:05Z"
_TARGET_POLICY_KEYS = {"predicates", "requested_companies", "requested_people", "extra_fields", "lane_plan", "scorer_version", "enabled", "lanes", "domain_allowlist"}


@pytest.fixture
def minimal() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["minimal"]


def _draft_campaign(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[object, str]:
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "store.sqlite"))
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual", sender_profile_path=None,
        name=None, lanes=("manual",),
    )
    return connection, campaign_id


def _queue_any_exec_request(connection: object, campaign_id: str) -> None:
    policy_hash = connection.execute(  # type: ignore[attr-defined]
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()[0]
    connection.execute(  # type: ignore[attr-defined]
        """INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,approval_id,
           created_at,claimed_at,state,reason) VALUES(?,?,?,?,?,?,?,?,?,?)""",
        ("req_task4_lock", "test", "fetch_snapshot", json.dumps({"campaign_id": campaign_id}), policy_hash, None, NOW, None, "queued", None),
    )


def test_hash_is_stable_under_key_order_and_whitespace(minimal: dict[str, object]) -> None:
    a = minimal
    b = json.loads(json.dumps(a, sort_keys=False, indent=4))
    assert fit_spec_hash(a) == fit_spec_hash(b) == hashlib.sha256(canonical_bytes(a)).hexdigest()


def test_path_kinds_outside_the_closed_vocabulary_are_rejected(minimal: dict[str, object]) -> None:
    spec = deepcopy(minimal)
    spec["paths"][0]["kinds"] = ["bank", "fintech"]
    with pytest.raises(FitSpecError, match="unknown_kind"):
        validate_fit_spec(spec)


def test_approve_merges_only_two_keys_and_leaves_policy_hash_identical(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, minimal: dict[str, object]
) -> None:
    connection, campaign_id = _draft_campaign(tmp_path, monkeypatch)
    before = connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()[0]
    fit_hash = store_proposed(connection, campaign_id, minimal, NOW)
    result = approve_fit_spec(connection, campaign_id, fit_hash, "human:operator", NOW)
    policy = json.loads(connection.execute("SELECT policy_json FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()[0])
    assert set(policy) - _TARGET_POLICY_KEYS == {"fit_spec_hash", "copy_profile"}
    assert policy["fit_spec_hash"] == fit_hash
    assert policy["copy_profile"] == COPY_PROFILE_DEFAULT
    assert "label" not in json.dumps(policy) and "title_tokens" not in json.dumps(policy)
    assert result.policy_hash_after == result.policy_hash_before == before
    assert_vm_safe({"kind": "vm_policy", "fields": policy}, "vm_policy")
    assert json.loads(connection.execute("SELECT cadence FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()[0]) == DEFAULT_CADENCE


def test_approve_refuses_once_an_exec_request_exists(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, minimal: dict[str, object]
) -> None:
    connection, campaign_id = _draft_campaign(tmp_path, monkeypatch)
    fit_hash = store_proposed(connection, campaign_id, minimal, NOW)
    _queue_any_exec_request(connection, campaign_id)
    with pytest.raises(FitSpecError, match="fit_spec_locked"):
        approve_fit_spec(connection, campaign_id, fit_hash, "human:operator", NOW)


def test_approval_locks_only_the_campaign_with_executed_work(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, minimal: dict[str, object]
) -> None:
    connection, executed_campaign = _draft_campaign(tmp_path, monkeypatch)
    _connection, fresh_campaign = _draft_campaign(tmp_path, monkeypatch)
    assert connection.execute(
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (executed_campaign,)
    ).fetchone()[0] == connection.execute(
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (fresh_campaign,)
    ).fetchone()[0]
    executed_hash = store_proposed(connection, executed_campaign, minimal, NOW)
    fresh_hash = store_proposed(connection, fresh_campaign, minimal, NOW)
    _queue_any_exec_request(connection, executed_campaign)

    assert approve_fit_spec(connection, fresh_campaign, fresh_hash, "human:operator", NOW).fit_spec_hash == fresh_hash
    with pytest.raises(FitSpecError, match="fit_spec_locked"):
        approve_fit_spec(connection, executed_campaign, executed_hash, "human:operator", NOW)


def test_approval_refuses_a_non_draft_campaign(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, minimal: dict[str, object]
) -> None:
    connection, campaign_id = _draft_campaign(tmp_path, monkeypatch)
    fit_hash = store_proposed(connection, campaign_id, minimal, NOW)
    connection.execute("UPDATE campaign SET status='paused' WHERE campaign_id=?", (campaign_id,))
    with pytest.raises(FitSpecError, match="fit_spec_locked"):
        approve_fit_spec(connection, campaign_id, fit_hash, "human:operator", NOW)


def test_approve_refuses_a_recomputed_policy_hash(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, minimal) -> None:
    connection, campaign_id = _draft_campaign(tmp_path, monkeypatch)
    fit_hash = store_proposed(connection, campaign_id, minimal, NOW)
    before = connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()[0]
    monkeypatch.setattr(fitspec, "compile_target_policy", lambda *_args: type("Policy", (), {"policy_hash": "f" * 64})())
    with pytest.raises(FitSpecError, match="policy_hash_changed"):
        approve_fit_spec(connection, campaign_id, fit_hash, "human:operator", NOW)
    assert connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()[0] == before

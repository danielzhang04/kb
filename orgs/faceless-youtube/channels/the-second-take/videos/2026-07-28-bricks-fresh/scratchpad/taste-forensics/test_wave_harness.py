"""$0 tests for the W6 parallel generation harness; provider calls are always stubbed."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

import pytest


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import wave_coordinator as coordinator  # noqa: E402
import wave_worker as worker  # noqa: E402


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(name: str, *, chain: str | None = None, role: str | None = None, dependencies=None) -> dict:
    raw = {"name": name, "stage_role": role, "seed": [], "seed_roles": [], "parent_depth": 0}
    return {"items": [raw], "metadata": {name: {"chain_id": chain or name, "dependencies": dependencies or []}}}


def test_partition_keeps_delta_chain_and_names_disjoint(tmp_path: Path) -> None:
    payload = {"items": [
        {"name": "L01", "stage_role": "base", "seed": [], "seed_roles": []},
        {"name": "L02", "stage_role": "delta", "seed": [], "seed_roles": []},
        {"name": "L03", "seed": [], "seed_roles": []},
    ], "metadata": {"L01": {"chain_id": "office/a"}, "L02": {"chain_id": "office/a"}, "L03": {"chain_id": "hotel/b"}}}
    records = coordinator.normalized_records(payload, str(tmp_path / "kit"), str(tmp_path / "video"))
    partitions = coordinator.partition_records(records, 2)
    owners = {item["name"]: index for index, part in enumerate(partitions) for item in part}
    assert owners["L01"] == owners["L02"]
    assert len(owners) == 3
    assert len({item["staging_slot"] for part in partitions for item in part}) == 3


def test_partition_refuses_unstamped_dependency(tmp_path: Path) -> None:
    payload = record("L01", dependencies=[{"name": "fig-x", "verified": True, "stamped": False, "sha256": "a" * 64}])
    records = coordinator.normalized_records(payload, str(tmp_path / "kit"), str(tmp_path / "video"))
    with pytest.raises(ValueError, match="verified\\+stamped"):
        coordinator.partition_records(records, 2)


def test_partition_refuses_duplicate_output_name(tmp_path: Path) -> None:
    payload = [{"name": "L01", "seed": [], "seed_roles": []}, {"name": "L01", "seed": [], "seed_roles": []}]
    with pytest.raises(ValueError, match="globally unique"):
        coordinator.normalized_records(payload, str(tmp_path / "kit"), str(tmp_path / "video"))


def test_result_schema_round_trip() -> None:
    result = {"schema": worker.RESULT_SCHEMA, "run_id": "r", "wave_id": "W01", "worker_id": "w01",
              "status": "complete", "worktree": "C:/wt", "input_spec": {"path": "x", "sha256": "a" * 64},
              "review_store_sha256": "b" * 64, "started_at": "2026-08-13T00:00:00Z",
              "finished_at": "2026-08-13T00:00:01Z", "budget": {"rate_usd": 0.0, "hard_cap_usd": 0.0,
              "max_provider_attempts": 0, "provider_calls": 0, "billable_outputs": 0, "estimated_spend_usd": 0.0},
              "items": [{"item_ordinal": 1, "shot_id": "L01", "card_id": None, "output_name": "L01",
              "staging_slot": "s", "promotion_slot": "p", "chain_id": "c", "dependency_depth": 0,
              "references": [], "attempts": [], "final_status": "OK", "staged_sha256": None,
              "suspected_mechanism_layer": None, "deviation_flags": []}], "genlog_segment": "g.jsonl",
              "worker_deviation_flags": []}
    assert worker.validate_result(json.loads(json.dumps(result))) == result


def test_merge_genlogs_is_worker_ordered_and_idempotent(tmp_path: Path) -> None:
    first = tmp_path / "r.W01.w01.genlog.jsonl"
    second = tmp_path / "r.W01.w02.genlog.jsonl"
    first.write_text(json.dumps({"run_id": "r", "wave_id": "W01", "output_name": "L02", "attempt_no": 1, "worker_id": "w01"}) + "\n", encoding="utf-8")
    second.write_text(json.dumps({"run_id": "r", "wave_id": "W01", "output_name": "L01", "attempt_no": 1, "worker_id": "w02"}) + "\n", encoding="utf-8")
    merged = tmp_path / "tranche-genlog.md"
    assert coordinator.merge_genlogs([second, first], merged, "r", "W01") is True
    first_merge = merged.read_text(encoding="utf-8")
    assert first_merge.index('"worker_id": "w01"') < first_merge.index('"worker_id": "w02"')
    assert coordinator.merge_genlogs([first, second], merged, "r", "W01") is False
    assert merged.read_text(encoding="utf-8") == first_merge


def dispatch_for(tmp_path: Path, worker_id: str, output_name: str, billing_path: Path) -> Path:
    review = tmp_path / "review.json"
    if not review.exists():
        review.write_text("{}\n", encoding="utf-8")
    spec = tmp_path / f"{worker_id}.spec.json"
    spec.write_text(json.dumps([{ "name": output_name }]) + "\n", encoding="utf-8")
    lease = tmp_path / "lease.json"
    if not lease.exists():
        lease.write_text(json.dumps({"remaining": 2, "claimed": 0}) + "\n", encoding="utf-8")
    dispatch = {"schema": worker.DISPATCH_SCHEMA, "run_id": "r", "wave_id": "W01", "worker_id": worker_id,
                "worktree": str(tmp_path), "org_dir": str(tmp_path), "kit_rel": "kit", "forge_path": "unused",
                "wave_ordinal": 1, "worker_spec": {"path": str(spec), "sha256": digest(spec)},
                "review_store_path": str(review), "review_store_sha256": digest(review),
                "assignments": [{"item_ordinal": 1, "partition_ordinal": 1, "shot_id": output_name, "card_id": None,
                "output_name": output_name, "staging_slot": str(tmp_path / f"{output_name}.png"),
                "promotion_slot": str(tmp_path / "promoted" / f"{output_name}.png"), "chain_id": output_name,
                "dependency_depth": 0, "references": []}], "item_spec_dir": str(tmp_path),
                "result_path": str(tmp_path / f"{worker_id}.result.json"), "genlog_path": str(tmp_path / f"{worker_id}.jsonl"),
                "attempt_lease_path": str(lease), "billing_halt_path": str(billing_path),
                "limits": {"stall_seconds": 240, "rate_usd": 0.0, "hard_cap_usd": 0.0, "max_provider_attempts": 2}}
    path = tmp_path / f"{worker_id}.dispatch.json"
    path.write_text(json.dumps(dispatch) + "\n", encoding="utf-8")
    return path


def test_billing_halt_signal_propagates_to_other_worker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    billing_path = tmp_path / "r.W01.billing-halt.json"
    first = dispatch_for(tmp_path, "w01", "L01", billing_path)
    second = dispatch_for(tmp_path, "w02", "L02", billing_path)
    monkeypatch.setattr(worker, "invoke_forge", lambda *_: ("429", 0.01, 429, "429 RESOURCE_EXHAUSTED free-tier limit: 0"))
    first_result = worker.run_worker(first)
    second_result = worker.run_worker(second)
    assert first_result["items"][0]["final_status"] == "HALT-BILLING"
    assert billing_path.exists()
    assert second_result["status"] == "halted"
    assert second_result["items"] == []


def test_claim_attempt_retries_delete_pending_permission_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    lease = tmp_path / "lease.json"
    lease.write_text(json.dumps({"remaining": 1, "claimed": 0}) + "\n", encoding="utf-8")
    original_open = Path.open
    attempts = 0

    def delete_pending_open(path: Path, *args, **kwargs):
        nonlocal attempts
        if path.name == "lease.json.lock" and attempts == 0:
            attempts += 1
            raise PermissionError("delete pending")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", delete_pending_open)
    assert worker.claim_attempt({"attempt_lease_path": str(lease)}) is True
    assert attempts == 1
    assert json.loads(lease.read_text(encoding="utf-8")) == {"remaining": 0, "claimed": 1}


def test_merge_results_refuses_missing_dispatched_worker(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="missing dispatched worker results: w01"):
        coordinator.merge_results([], tmp_path / "merged.json", "r", "W01", expected_worker_ids=["w01"])


def test_worker_halts_before_provider_call_when_lease_is_exhausted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    billing_path = tmp_path / "r.W01.billing-halt.json"
    dispatch = dispatch_for(tmp_path, "w01", "L01", billing_path)
    lease = tmp_path / "lease.json"
    lease.write_text(json.dumps({"remaining": 0, "claimed": 2}) + "\n", encoding="utf-8")
    monkeypatch.setattr(worker, "invoke_forge", lambda *_: pytest.fail("provider call after HALT-BUDGET"))
    result = worker.run_worker(dispatch)
    assert result["status"] == "halted"
    assert result["items"][0]["final_status"] == "HALT-BUDGET"
    assert result["budget"]["provider_calls"] == 0

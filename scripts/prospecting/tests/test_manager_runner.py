from pathlib import Path
import json

import pytest

from scripts.prospecting.manager.runner import ManagerRunner
from scripts.prospecting.manager.workflows import load_workflow


def runner(tmp_path, turn, inspect=lambda stage, result: {"decision": "pass", "grade": 95}):
    return ManagerRunner(
        load_workflow(Path("workflows/outreach-run.md")), tmp_path / "outbox", turn, inspect
    )


def ok(stage, attempt, job=None):
    return {
        "stage_id": stage.id,
        "state": "complete",
        "ids": [f"{stage.id}-1"],
        "counts": {"processed": 20},
        "hashes": ["a" * 64],
        "failure_codes": {},
        "attempt": attempt,
    }


ARGS = ("run-1", "policy-1", "b" * 64, ("campaign-1",), ("c" * 64,), {"requested": 20})


def test_happy_path_writes_chain_cards_and_counts_only_report(tmp_path: Path, record_property) -> None:
    report = runner(tmp_path, ok).run(*ARGS)
    assert report.state == "complete" and report.cards == 5 and report.retries == 0
    assert len(list((tmp_path / "outbox").glob("*.md"))) == 5
    record_property("inspector_grade", 95)


def test_predecessor_values_and_successful_retry_card_propagate(tmp_path: Path) -> None:
    seen = []

    def turn(stage, attempt, job):
        seen.append((stage.id, attempt, job.depends_on, job.input_ids, job.input_hashes))
        return ok(stage, attempt, job)

    decisions = iter((
        {"decision": "retry", "grade": 70},
        {"decision": "pass", "grade": 95},
        {"decision": "pass", "grade": 95},
    ))
    report = runner(tmp_path, turn, lambda stage, result: next(decisions)).run(*ARGS)
    assert report.state == "complete" and report.retries == 1
    personalized = next(item for item in seen if item[0] == "personalize")
    assert personalized[2] == ("run-1-inspect-list-a2",)
    assert "list-1" in personalized[3] and "a" * 64 in personalized[4]


def test_failed_stage_retries_once_then_parks(tmp_path: Path) -> None:
    def fail(stage, attempt, job):
        return {**ok(stage, attempt, job), "state": "failed", "failure_codes": {"fixture_failure": 1}}

    report = runner(tmp_path, fail).run("run-2", *ARGS[1:])
    assert report.state == "parked" and report.retries == 1 and report.escalations == 1


def test_pii_result_is_rejected_and_parked(tmp_path: Path, monkeypatch) -> None:
    def reject_result(value, sink):
        if "stage_id" in value["fields"]:
            raise ValueError("synthetic-guard-rejection")

    monkeypatch.setattr("scripts.prospecting.manager.runner.assert_vm_safe", reject_result)
    report = runner(tmp_path, ok).run("run-3", *ARGS[1:])
    checkpoint = json.loads((tmp_path / "outbox/run-3-checkpoint.json").read_text())
    assert report.state == "parked"
    assert checkpoint["failure_code"] == "pii_result"
    assert not (tmp_path / "outbox/run-3-report.json").exists()


def test_missing_result_parks(tmp_path: Path) -> None:
    assert runner(tmp_path, lambda stage, attempt, job: None).run("run-4", *ARGS[1:]).state == "parked"


def test_result_requires_all_seven_keys_and_nested_types(tmp_path: Path) -> None:
    for key in ("stage_id", "state", "ids", "counts", "hashes", "failure_codes", "attempt"):
        def missing(stage, attempt, job, key=key):
            value = ok(stage, attempt, job)
            del value[key]
            return value

        assert runner(tmp_path / missing.__name__ / key, missing).run(
            "run-missing-" + key.replace("_", "-"), *ARGS[1:]
        ).state == "parked"


@pytest.mark.parametrize(
    "field,value",
    (
        ("ids", "not-a-list"),
        ("ids", ["bad id"]),
        ("counts", {"processed": -1}),
        ("counts", {"processed": "20"}),
        ("hashes", ["a" * 63]),
        ("failure_codes", {"unknown_code": 1}),
        ("attempt", "1"),
        ("attempt", 3),
    ),
)
def test_malformed_nested_results_park_as_invalid_result(
    tmp_path: Path, field: str, value: object
) -> None:
    def malformed(stage, attempt, job):
        return {**ok(stage, attempt, job), field: value}

    report = runner(tmp_path, malformed).run("run-nested", *ARGS[1:])
    checkpoint = json.loads((tmp_path / "outbox/run-nested-checkpoint.json").read_text())
    assert report.state == "parked"
    assert checkpoint["failure_code"] == "invalid_result"


@pytest.mark.parametrize("run_id", (r"..\..", r"C:\x", "/x", "a:b", "a" * 65), ids=["dotdot-backslash", "drive-letter", "root-slash", "colon", "overlong"])
def test_invalid_run_ids_are_rejected_before_outbox_paths(tmp_path: Path, run_id: str) -> None:
    with pytest.raises(ValueError, match="^invalid_run_id$"):
        runner(tmp_path, ok).run(run_id, *ARGS[1:])
    assert not (tmp_path / "outbox").exists()


def test_grade_89_and_second_inspector_failure_block(tmp_path: Path) -> None:
    low = runner(tmp_path / "low", ok, lambda stage, result: {"decision": "pass", "grade": 89}).run(
        "run-low", *ARGS[1:]
    )
    assert low.state == "parked"
    answers = iter(({"decision": "retry", "grade": 70}, {"decision": "park", "grade": 95}))
    second = runner(tmp_path / "second", ok, lambda stage, result: next(answers)).run(
        "run-second", *ARGS[1:]
    )
    assert second.state == "parked" and second.retries == 1


def test_checkpoint_resume_and_completed_rerun_are_idempotent(tmp_path: Path) -> None:
    calls = []

    def turn(stage, attempt, job):
        calls.append(stage.id)
        return ok(stage, attempt, job)

    first = runner(tmp_path, turn).run(*ARGS)
    before = sorted(p.read_bytes() for p in (tmp_path / "outbox").glob("*"))
    second = runner(tmp_path, turn).run(*ARGS)
    after = sorted(p.read_bytes() for p in (tmp_path / "outbox").glob("*"))
    assert first == second and calls == ["list", "personalize", "enroll"] and before == after


def test_recorded_fixture_has_exact_seven_key_results(tmp_path: Path) -> None:
    values = json.loads(
        Path("orgs/prospecting/fixtures/p5-agent-results.json").read_text(encoding="utf-8")
    )
    checker = runner(tmp_path, ok)
    assert {"happy", "retry_then_success", "repeated_failure", "pii_attacks"} <= set(values)
    for group, results in values.items():
        for result in results.values():
            assert set(result) == {
                "stage_id", "state", "ids", "counts", "hashes", "failure_codes", "attempt"
            }
            if group == "pii_attacks":
                with __import__("pytest").raises(Exception):
                    checker._valid(result, result["stage_id"])
            else:
                assert checker._valid(result, result["stage_id"]) == result
    assert len(values["pii_attacks"]) == 7

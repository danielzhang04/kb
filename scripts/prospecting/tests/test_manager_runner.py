from dataclasses import replace
from pathlib import Path
import json

import pytest

from scripts.prospecting.manager.bindings import (
    DESKTOP_FAILURE_CODES,
    stage_execution_key,
)
from scripts.prospecting.manager.runner import ManagerRunner
from scripts.prospecting.manager.workflows import load_workflow


WORKFLOW = load_workflow(Path("workflows/outreach-run.md"))


def inspected(stage, result, job, attempt, *, decision="pass", grade=95):
    del result
    return {
        "decision": decision,
        "grade": grade,
        "execution_key": stage_execution_key(WORKFLOW, job, stage, attempt),
        "command_digest": "d" * 64,
    }


def runner(tmp_path, turn, inspect=inspected):
    return ManagerRunner(
        WORKFLOW, tmp_path / "outbox", turn, inspect
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
        "execution_key": stage_execution_key(WORKFLOW, job, stage, attempt),
        "command_digest": "e" * 64,
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
    def inspect(stage, result, job, attempt):
        return {
            **next(decisions),
            "execution_key": stage_execution_key(WORKFLOW, job, stage, attempt),
            "command_digest": "d" * 64,
        }

    report = runner(tmp_path, turn, inspect).run(*ARGS)
    assert report.state == "complete" and report.retries == 1
    personalized = next(item for item in seen if item[0] == "personalize")
    assert personalized[2] == ("run-1-inspect-list-a2",)
    assert "list-1" in personalized[3] and "a" * 64 in personalized[4]
    assert runner(tmp_path, pytest.fail).run(*ARGS) == report


def test_failed_stage_retries_once_then_parks(tmp_path: Path) -> None:
    def fail(stage, attempt, job):
        return {**ok(stage, attempt, job), "state": "failed", "failure_codes": {"fixture_failure": 1}}

    report = runner(tmp_path, fail).run("run-2", *ARGS[1:])
    assert report.state == "parked" and report.retries == 1 and report.escalations == 1


@pytest.mark.parametrize(
    "failure_code",
    sorted(DESKTOP_FAILURE_CODES - {"adapter_recovery_required"}),
)
def test_production_adapter_failures_reach_the_single_retry(
    tmp_path: Path, failure_code: str
) -> None:
    calls: list[tuple[str, int]] = []

    def fail_once(stage, attempt, job):
        calls.append((stage.id, attempt))
        value = ok(stage, attempt, job)
        if stage.id == "list" and attempt == 1:
            return {
                **value,
                "state": "failed",
                "failure_codes": {failure_code: 1},
            }
        return value

    report = runner(tmp_path, fail_once).run("run-adapter", *ARGS[1:])

    assert report.state == "complete" and report.retries == 1
    assert calls[:2] == [("list", 1), ("list", 2)]


def test_unknown_desktop_outcome_parks_without_replay(tmp_path: Path) -> None:
    calls: list[int] = []

    def unknown(stage, attempt, job):
        calls.append(attempt)
        return {
            **ok(stage, attempt, job),
            "state": "failed",
            "failure_codes": {"adapter_recovery_required": 1},
        }

    report = runner(tmp_path, unknown).run("run-recovery", *ARGS[1:])
    checkpoint = json.loads(
        (tmp_path / "outbox/run-recovery-checkpoint.json").read_text()
    )

    assert report.state == "parked" and report.retries == 0
    assert calls == [1]
    assert checkpoint["reason"] == "desktop_recovery_required"


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
    for key in (
        "stage_id", "state", "ids", "counts", "hashes", "failure_codes",
        "attempt", "execution_key", "command_digest",
    ):
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
        ("execution_key", "f" * 64),
        ("command_digest", "f" * 63),
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
    def low_inspect(stage, result, job, attempt):
        return inspected(stage, result, job, attempt, grade=89)

    low = runner(tmp_path / "low", ok, low_inspect).run(
        "run-low", *ARGS[1:]
    )
    assert low.state == "parked"
    answers = iter(({"decision": "retry", "grade": 70}, {"decision": "park", "grade": 95}))

    def second_inspect(stage, result, job, attempt):
        return {
            **next(answers),
            "execution_key": stage_execution_key(WORKFLOW, job, stage, attempt),
            "command_digest": "d" * 64,
        }

    second = runner(tmp_path / "second", ok, second_inspect).run(
        "run-second", *ARGS[1:]
    )
    assert second.state == "parked" and second.retries == 1


def test_t2_grade_94_does_not_pass_inspection(tmp_path: Path) -> None:
    def low_inspect(stage, result, job, attempt):
        return inspected(stage, result, job, attempt, grade=94)

    assert runner(tmp_path, ok, low_inspect).run(
        "run-t2-low", *ARGS[1:]
    ).state == "parked"


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


class SimulatedManagerCrash(BaseException):
    pass


def test_resume_reuses_an_issued_first_attempt_without_counting_another_card(
    tmp_path: Path,
) -> None:
    with pytest.raises(SimulatedManagerCrash):
        runner(
            tmp_path,
            lambda _stage, _attempt, _job: (_ for _ in ()).throw(
                SimulatedManagerCrash()
            ),
        ).run("run-issued", *ARGS[1:])

    resumed_calls: list[tuple[str, int]] = []

    def resumed(stage, attempt, job):
        resumed_calls.append((stage.id, attempt))
        return ok(stage, attempt, job)

    report = runner(tmp_path, resumed).run("run-issued", *ARGS[1:])

    assert report.state == "complete" and report.cards == 5
    assert resumed_calls[0] == ("list", 1)
    assert len(list((tmp_path / "outbox").glob("run-issued-*-a*.md"))) == 5


def test_resume_after_retry_issuance_does_not_repeat_attempt_one(
    tmp_path: Path,
) -> None:
    def interrupted(stage, attempt, job):
        if stage.id == "list" and attempt == 1:
            return {
                **ok(stage, attempt, job),
                "state": "failed",
                "failure_codes": {"adapter_failed": 1},
            }
        raise SimulatedManagerCrash()

    with pytest.raises(SimulatedManagerCrash):
        runner(tmp_path, interrupted).run("run-retry-resume", *ARGS[1:])

    resumed_calls: list[tuple[str, int]] = []

    def resumed(stage, attempt, job):
        resumed_calls.append((stage.id, attempt))
        return ok(stage, attempt, job)

    report = runner(tmp_path, resumed).run("run-retry-resume", *ARGS[1:])

    assert report.state == "complete" and report.retries == 1
    assert resumed_calls[0] == ("list", 2)
    assert ("list", 1) not in resumed_calls


def test_resume_after_inspection_rework_issuance_preserves_attempts(
    tmp_path: Path,
) -> None:
    first_inspections: list[tuple[str, int]] = []

    def interrupted_turn(stage, attempt, job):
        if stage.id == "list" and attempt == 2:
            raise SimulatedManagerCrash()
        return ok(stage, attempt, job)

    def retry_inspection(stage, result, job, attempt):
        first_inspections.append((stage.id, attempt))
        return inspected(stage, result, job, attempt, decision="retry", grade=70)

    with pytest.raises(SimulatedManagerCrash):
        runner(tmp_path, interrupted_turn, retry_inspection).run(
            "run-inspect-resume", *ARGS[1:]
        )

    resumed_turns: list[tuple[str, int]] = []
    resumed_inspections: list[tuple[str, int]] = []

    def resumed_turn(stage, attempt, job):
        resumed_turns.append((stage.id, attempt))
        return ok(stage, attempt, job)

    def resumed_inspection(stage, result, job, attempt):
        resumed_inspections.append((stage.id, attempt))
        if stage.id == "inspect-list":
            assert attempt == 2
        return inspected(stage, result, job, attempt)

    report = runner(tmp_path, resumed_turn, resumed_inspection).run(
        "run-inspect-resume", *ARGS[1:]
    )

    assert report.state == "complete" and report.retries == 1
    assert first_inspections == [("inspect-list", 1)]
    assert resumed_turns[0] == ("list", 2)
    assert resumed_inspections[0] == ("inspect-list", 2)


def test_resume_after_reinspection_issuance_does_not_repeat_rework(
    tmp_path: Path,
) -> None:
    def retry_then_interrupt(stage, result, job, attempt):
        if stage.id == "inspect-list" and attempt == 1:
            return inspected(stage, result, job, attempt, decision="retry", grade=70)
        if stage.id == "inspect-list":
            raise SimulatedManagerCrash()
        return inspected(stage, result, job, attempt)

    with pytest.raises(SimulatedManagerCrash):
        runner(tmp_path, ok, retry_then_interrupt).run(
            "run-reinspect-resume", *ARGS[1:]
        )

    resumed_turns: list[tuple[str, int]] = []
    resumed_inspections: list[tuple[str, int]] = []

    def resumed_turn(stage, attempt, job):
        resumed_turns.append((stage.id, attempt))
        return ok(stage, attempt, job)

    def resumed_inspection(stage, result, job, attempt):
        resumed_inspections.append((stage.id, attempt))
        return inspected(stage, result, job, attempt)

    report = runner(tmp_path, resumed_turn, resumed_inspection).run(
        "run-reinspect-resume", *ARGS[1:]
    )

    assert report.state == "complete" and report.retries == 1
    assert ("list", 2) not in resumed_turns
    assert resumed_inspections[0] == ("inspect-list", 2)


@pytest.mark.parametrize(
    "mutation",
    ("early_terminal", "counter", "grade", "command", "dependency_gap"),
)
def test_checkpoint_restore_rejects_inconsistent_saved_state(
    tmp_path: Path, mutation: str
) -> None:
    scope = tmp_path / mutation
    runner(scope, ok).run(*ARGS)
    path = scope / "outbox/run-1-checkpoint.json"
    state = json.loads(path.read_text())
    if mutation == "early_terminal":
        state["completed"] = {}
        state["counts"] = {}
    elif mutation == "counter":
        state["cards"] += 1
    elif mutation == "grade":
        state["completed"]["inspect-list"]["inspection"]["grade"] = 94
    elif mutation == "command":
        state["completed"]["list"]["result"]["command_digest"] = "f" * 64
    else:
        del state["completed"]["inspect-list"]
    path.write_text(json.dumps(state), encoding="utf-8")

    with pytest.raises(ValueError, match="^checkpoint_invalid$"):
        runner(scope, ok).run(*ARGS)


def test_same_run_lock_refuses_a_concurrent_manager(tmp_path: Path) -> None:
    first = runner(tmp_path, ok)
    second = runner(tmp_path, ok)

    with first._run_lock("run-locked"):
        with pytest.raises(ValueError, match="^run_in_progress$"):
            second.run("run-locked", *ARGS[1:])


@pytest.mark.parametrize(
    "replacement",
    (
        ("policy-2", ARGS[2], ARGS[3], ARGS[4], ARGS[5]),
        (ARGS[1], "f" * 64, ARGS[3], ARGS[4], ARGS[5]),
        (ARGS[1], ARGS[2], ("campaign-2",), ARGS[4], ARGS[5]),
        (ARGS[1], ARGS[2], ARGS[3], ("f" * 64,), ARGS[5]),
        (ARGS[1], ARGS[2], ARGS[3], ARGS[4], {"requested": 21}),
    ),
)
def test_terminal_resume_rejects_changed_run_binding(
    tmp_path: Path, replacement: tuple[object, ...]
) -> None:
    runner(tmp_path, ok).run(*ARGS)
    with pytest.raises(ValueError, match="^run_binding_conflict$"):
        runner(tmp_path, ok).run(ARGS[0], *replacement)


def test_terminal_resume_rejects_changed_workflow_and_legacy_checkpoint(
    tmp_path: Path,
) -> None:
    runner(tmp_path / "changed", ok).run(*ARGS)
    changed = replace(WORKFLOW, version=WORKFLOW.version + 1)
    with pytest.raises(ValueError, match="^run_binding_conflict$"):
        ManagerRunner(changed, tmp_path / "changed/outbox", ok, inspected).run(*ARGS)

    legacy = tmp_path / "legacy/outbox"
    legacy.mkdir(parents=True)
    (legacy / "run-1-checkpoint.json").write_text(
        json.dumps({"state": "complete", "cards": 0, "retries": 0,
                    "escalations": 0, "counts": {}}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="^run_binding_conflict$"):
        runner(tmp_path / "legacy", ok).run(*ARGS)


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
            bound = {
                **result,
                "execution_key": "e" * 64,
                "command_digest": "d" * 64,
            }
            if group == "pii_attacks":
                with __import__("pytest").raises(Exception):
                    checker._valid(bound, result["stage_id"], result["attempt"], "e" * 64)
            else:
                assert checker._valid(
                    bound, result["stage_id"], result["attempt"], "e" * 64
                ) == bound
    assert len(values["pii_attacks"]) == 7

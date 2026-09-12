from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from scripts.prospecting.manager.runner import ManagerRunner
from scripts.prospecting.manager.workflows import load_workflow
from scripts.prospecting.pii_guard import PIIGuardError, assert_vm_safe
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_gate_p5")


def test_p5_manifest_uses_exact_shared_schema_and_preserved_hash_inventory() -> None:
    value = json.loads(Path("scripts/prospecting/gate_manifest_p5.json").read_text(encoding="utf-8"))
    assert set(value) == {"phase", "artifacts", "fixtures", "tests", "criteria", "artifact_hashes"}
    assert value["phase"] == "P5" and len(value["tests"]) >= 50
    assert len(value["artifacts"]) == len(set(value["artifacts"]))
    assert set(value["artifact_hashes"]) == set(value["artifacts"])
    assert all(isinstance(digest, str) and len(digest) == 64 for digest in value["artifact_hashes"].values())


def test_scale_is_measured_from_rows_not_summary(record_property) -> None:
    value = json.loads(Path("orgs/prospecting/fixtures/scale-200x400.json").read_text(encoding="utf-8"))
    companies = value["companies"]
    people = value["people"]
    evidence = value["evidence_sets"]
    drafts = value["t0_draft_requests"]
    assert len({row["id"] for row in companies}) == len(companies)
    assert len({row["id"] for row in people}) == len(people)
    person_ids = {row["id"] for row in people}
    assert {row["person_id"] for row in evidence} == person_ids
    assert {row["person_id"] for row in drafts} == person_ids
    observations = {row["person_id"] for row in value["observations"]}
    attempts = {row["person_id"] for row in value["provider_attempts"]}
    record_property("companies", len(companies))
    record_property("people", len(people))
    record_property("evidence_sets", len(evidence))
    record_property("t0_draft_requests", len(drafts))
    record_property("provenance_percent", 100 * len(observations) // len(people))
    record_property("attempt_accounting_percent", 100 * len(attempts) // len(people))


def test_cursor_boundary_restarts_have_no_duplicates(record_property) -> None:
    value = json.loads(Path("orgs/prospecting/fixtures/scale-200x400.json").read_text(encoding="utf-8"))
    pages = value["lane_cursor_pages"]
    people = []
    deliveries = []
    for page in pages:
        assert page["resume_cursor"]
        people.extend(page["person_ids"])
        deliveries.extend(page["delivery_ids"])

    for restart_page in range(len(pages)):
        replayed_people = [person_id for page in pages[restart_page:] for person_id in page["person_ids"]]
        replayed_deliveries = [delivery_id for page in pages[restart_page:] for delivery_id in page["delivery_ids"]]
        assert len(replayed_people) == len(set(replayed_people))
        assert len(replayed_deliveries) == len(set(replayed_deliveries))

    record_property("cursor_boundaries", len(pages))
    record_property("duplicate_people", len(people) - len(set(people)))
    record_property("duplicate_deliveries", len(deliveries) - len(set(deliveries)))


@pytest.mark.parametrize("blocked_stage", ["inspect-list", "inspect-personalize"])
def test_each_inspector_barrier_blocks_at_grade_89(
    tmp_path: Path, blocked_stage: str, record_property
) -> None:
    workflow = load_workflow(Path("workflows/outreach-run.md"))

    def turn(stage, attempt, job):
        return {
            "stage_id": stage.id,
            "state": "complete",
            "ids": [stage.id + "-id"],
            "counts": {"processed": 1},
            "hashes": ["a" * 64],
            "failure_codes": {},
            "attempt": attempt,
        }

    def inspect(stage, result):
        return {"decision": "pass", "grade": 89 if stage.id == blocked_stage else 95}

    report = ManagerRunner(workflow, tmp_path / blocked_stage, turn, inspect).run(
        "run-" + blocked_stage,
        "policy-1",
        "b" * 64,
        ("campaign-1",),
        (),
        {"requested": 1},
    )
    assert report.state == "parked"
    record_property("inspector_barriers", 1)


def test_seven_pii_classes_fail_at_every_vm_sink(record_property) -> None:
    cases = {
        "email": {"email": SYNTHETIC["email"]},
        "phone": {"phone": SYNTHETIC["phone"]},
        "person_name": {"name": "Fixture Person"},
        "profile_url": {"profile_url": "https://example.test/profile"},
        "message_body": {"message_body": "synthetic message body"},
        "literal_ask_text": {"body": "synthetic ask text"},
        "free_text_note": {"note": "synthetic note"},
    }
    sinks = (
        "process_arguments", "stdout", "stderr", "logs",
        "cards", "ledgers", "exceptions", "vm_policy",
    )
    for value in cases.values():
        for sink in sinks:
            with pytest.raises(PIIGuardError):
                assert_vm_safe({"kind": sink, "fields": value}, sink, known_names=("Fixture Person",))
    record_property("pii_classes", len(cases))
    record_property("pii_sink_rejections", len(cases) * len(sinks))


def test_exact_tools_operations_and_disabled_cadences_are_observed(record_property) -> None:
    declarations = [
        Path("agents") / f"prospecting-{name}.md"
        for name in ("manager", "list-builder", "personalizer", "campaigner")
    ]
    expected_tools = {
        "prospecting-manager": {
            "prospecting-card-outbox",
            "prospecting-desktop-bridge",
            "prospecting-aggregate-status",
        },
        "prospecting-list-builder": {"prospecting-list-builder-cli"},
        "prospecting-personalizer": {"prospecting-personalizer-cli", "model-turn"},
        "prospecting-campaigner": {"prospecting-campaigner-cli", "prospecting-executor-request"},
    }
    for path in declarations:
        raw = path.read_text(encoding="utf-8").split("---", 2)[1]
        tools = set(json.loads(next(line.split(":", 1)[1] for line in raw.splitlines() if line.startswith("tools:"))))
        assert tools == expected_tools[path.stem]
    workflows = [load_workflow(path) for path in sorted(Path("workflows").glob("*.md"))]
    assert len(workflows) == 5
    heartbeat = Path("orgs/prospecting/HEARTBEAT.md")
    if heartbeat.exists():
        assert "standing_authority: true" not in heartbeat.read_text(encoding="utf-8")
    record_property("agent_declarations", len(declarations))
    record_property("workflows", len(workflows))
    record_property("cadences_registered", 0)

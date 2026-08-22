import json
from pathlib import Path
import pytest
from deploy import control_plane_schema

FIXTURES = Path(__file__).parent / "fixtures/control-plane"


@pytest.fixture
def four_version_breaking_upgrade_registry():
    root = Path(__file__).parents[1]
    registry = json.loads((root / "schemas/control-plane-migrations.json").read_text(encoding="utf-8"))
    version_four = dict(registry["versions"][-1])
    version_four["version"] = 4
    registry["versions"].append(version_four)
    registry["migrations"].append(
        {"from": 3, "to": 4, "breaking": False, "down": "present"},
    )
    return registry

def test_generated_empty_document_is_schema_v3():
    value = json.loads(control_plane_schema.EMPTY_CONTROL_PLANE)
    assert value["version"] == control_plane_schema.CONTROL_PLANE_SCHEMA_VERSION == 3
    assert value["documentRevision"] == 0
    assert value["scheduleCollectionRevision"] == 0
    assert {k for k, v in value.items() if isinstance(v, list)} == set(
        control_plane_schema.CONTROL_PLANE_COLLECTIONS
    )

def test_activation_journal_phases_are_generated_for_python_consumers():
    assert len(control_plane_schema.ACTIVATION_JOURNAL_PHASES) == 16
    assert control_plane_schema.ACTIVATION_JOURNAL_PHASES[0] == "authorized"
    assert control_plane_schema.ACTIVATION_JOURNAL_PHASES[-1] == "recovery-required"

@pytest.mark.parametrize(
    ("name", "accepted"),
    [("v1-supported.json", True), ("v1-sparse-legacy.json", True), ("v2-empty.json", True),
     ("future-v3.json", False), ("malformed.json", False)],
)
def test_cross_language_schema_fixtures(name, accepted):
    value = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    if accepted:
        assert control_plane_schema.assert_control_plane_schema(value)["version"] in {1, 2, 3}
    else:
        with pytest.raises(ValueError):
            control_plane_schema.assert_control_plane_schema(value)

def test_generated_modules_are_byte_current(tmp_path):
    from scripts.generate_control_plane_schema import generate
    root = Path(__file__).parents[1]
    ts_out, py_out = tmp_path / "schema.ts", tmp_path / "schema.py"
    generate(root / "schemas/control-plane-migrations.json", ts_out, py_out)
    assert ts_out.read_bytes() == (root / "dashboard/server/control/generated/controlPlaneSchema.ts").read_bytes()
    assert py_out.read_bytes() == (root / "deploy/control_plane_schema.py").read_bytes()


def test_state_migration_aggregates_every_up_edge_on_upgrade_path(four_version_breaking_upgrade_registry):
    from scripts.generate_control_plane_schema import derived_values, py_source, ts_source

    _version, current, rollback, migration = derived_values(four_version_breaking_upgrade_registry)
    assert (current, rollback, migration) == (4, 3, "breaking")
    assert 'export const STATE_MIGRATION = "breaking" as const;' in ts_source(four_version_breaking_upgrade_registry)
    assert "STATE_MIGRATION = 'breaking'" in py_source(four_version_breaking_upgrade_registry)


def test_python_v3_down_carrier_restores_schedule_and_quarantined_run_identity():
    value = json.loads(control_plane_schema.EMPTY_CONTROL_PLANE)
    identity = {
        "owner": {"type": "agent", "id": "grader", "sourcePath": "agents/grader.md"},
        "executionHost": "vm", "terminalOutcome": "failed",
        "completedAt": "2026-08-21T00:00:00.000Z", "archivedFrom": None,
    }
    value["runs"] = [{"runRef": "run-live", **identity}]
    value["quarantine"] = [{"run": {"runRef": "run-old", **identity}}]
    value["scheduleCollectionRevision"] = 7
    value["schedules"] = [{"id": "daily"}]
    original = json.loads(json.dumps(value))
    down = control_plane_schema.down_migrate_v3_to_v2(value)
    assert down["version"] == 2
    assert "owner" not in down["runs"][0]
    assert "schedules" not in down
    assert down["events"][-1]["summary"].startswith("kb.control-plane-v3-down-carrier/v1:")
    assert control_plane_schema.restore_v3_down_carrier(down) == original

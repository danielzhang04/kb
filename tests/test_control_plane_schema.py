import json
from pathlib import Path
import pytest
from deploy import control_plane_schema

FIXTURES = Path(__file__).parent / "fixtures/control-plane"


@pytest.fixture
def three_version_breaking_upgrade_registry():
    root = Path(__file__).parents[1]
    registry = json.loads((root / "schemas/control-plane-migrations.json").read_text(encoding="utf-8"))
    version_three = dict(registry["versions"][-1])
    version_three["version"] = 3
    registry["versions"].append(version_three)
    registry["migrations"] = [
        {"from": 1, "to": 2, "breaking": True, "down": "absent"},
        {"from": 2, "to": 3, "breaking": False, "down": "present"},
    ]
    return registry

def test_generated_empty_document_is_schema_v2():
    value = json.loads(control_plane_schema.EMPTY_CONTROL_PLANE)
    assert value["version"] == control_plane_schema.CONTROL_PLANE_SCHEMA_VERSION == 2
    assert value["documentRevision"] == 0
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
        assert control_plane_schema.assert_control_plane_schema(value)["version"] in {1, 2}
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


def test_state_migration_aggregates_every_up_edge_on_upgrade_path(three_version_breaking_upgrade_registry):
    from scripts.generate_control_plane_schema import derived_values, py_source, ts_source

    _version, current, rollback, migration = derived_values(three_version_breaking_upgrade_registry)
    assert (current, rollback, migration) == (3, 2, "breaking")
    assert 'export const STATE_MIGRATION = "breaking" as const;' in ts_source(three_version_breaking_upgrade_registry)
    assert "STATE_MIGRATION = 'breaking'" in py_source(three_version_breaking_upgrade_registry)

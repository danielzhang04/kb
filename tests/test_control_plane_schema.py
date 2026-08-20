import json
from pathlib import Path
import pytest
from deploy import control_plane_schema

FIXTURES = Path(__file__).parent / "fixtures/control-plane"

def test_generated_empty_document_is_schema_v2():
    value = json.loads(control_plane_schema.EMPTY_CONTROL_PLANE)
    assert value["version"] == control_plane_schema.CONTROL_PLANE_SCHEMA_VERSION == 2
    assert value["documentRevision"] == 0
    assert {k for k, v in value.items() if isinstance(v, list)} == set(
        control_plane_schema.CONTROL_PLANE_COLLECTIONS
    )

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

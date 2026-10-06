"""Canonical nonimported tensor fixture feasibility; observer remains unsupported."""
import importlib.util
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("tensor_observer_fixture_setup", HERE / "tensor_observer_fixture.py")
fixture = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = fixture
spec.loader.exec_module(fixture)
restore_module_aliases = fixture.restore_module_aliases


def test_real_tensor_writers_build_nonimported_mixed_fixture(tmp_path_factory, restore_module_aliases):
    result = fixture.build_tensor_fixture(tmp_path_factory.mktemp("tg"))
    assert result.gen_plan["fixture"] is True
    assert result.report["gen_framings"] == ["full", "close-up"]
    assert result.report["guard_attempts"] == []
    accepted = result.ft._read_json(result.train / "grade/tester/accepted-checkpoint.json")
    assert accepted.get("origin") != "imported"
    assert result.report["scorer_seams"] == {"score": 2, "gate": 2}
    assert accepted["checkpoint"]["path"].endswith("creator-003_000000750.safetensors")
    assert "imported_training_config" not in result.ft._read_json(result.train / "plan.json")
    staged = result.gen / "train/runs/accepted-checkpoint/creator-003_000000750.safetensors"
    assert fixture.sha(staged) == fixture.sha(Path(accepted["checkpoint"]["path"]))
    for run in result.gen_plan["stages"]["gen"]["runs"]:
        manifest = result.ft._read_json(result.gen / run["manifest"])
        assert len(manifest["uploads"]) == 1
        assert all(name.endswith('.safetensors') for name in manifest["uploads"][0]["files"])
    destination = os.environ.get("FIGMENT_FIXTURE_EVIDENCE")
    if destination:
        Path(destination).write_text(json.dumps(result.report, indent=2) + "\n", encoding="ascii")

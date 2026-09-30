"""Phase 1 (spec 2026-09-29 §10): creator-003's tensor passport -- plan, dry-run,
board groups, pick -> identity, age-hold log."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
PERSONAS = ROOT / "orgs" / "figment" / "personas"
POD_RUNNER = PIPELINE / "pod" / "runpod_run.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def command():
    return load_module("figment_train_test_module_passport", PIPELINE / "figment_train.py")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _pre_passport_persona(personas_root: Path) -> Path:
    """The committed creator-003 persona with its spec paths rebound to local files so
    it validates under tmp_path (same technique as test_anchor_stage._synthetic_persona)."""
    source = load_json(PERSONAS / "creator-003" / "persona.yaml")
    target = personas_root / "creator-003"
    target.mkdir(parents=True)
    for name, text in (("identity.md", "fixture identity\n"), ("register.md", "fixture register\n")):
        (target / name).write_text(text, encoding="utf-8")
    source["identity"]["spec"] = {"path": "identity.md",
        "sha256": hashlib.sha256((target / "identity.md").read_bytes()).hexdigest()}
    source["register"]["spec"] = {"path": "register.md", "section": "fixture",
        "sha256": hashlib.sha256((target / "register.md").read_bytes()).hexdigest()}
    (target / "persona.yaml").write_text(json.dumps(source, indent=2) + "\n", encoding="utf-8")
    shutil.copy2(PERSONAS / "creator-003" / "training.yaml", target / "training.yaml")
    return target


def _plan(command, tmp_path, personas_root=PERSONAS, stage="anchor", name="plan"):
    return command.build_plan("creator-003", stage, tmp_path / name, personas_root=personas_root,
                              skip_pin_verify=True, ledger_dir=tmp_path / "ledger")


def test_creator003_plans_only_the_tensor_passport(command, tmp_path, monkeypatch):
    monkeypatch.delenv("KB_ARC_CAP_USD", raising=False)
    plan = _plan(command, tmp_path, stage="all")
    assert list(plan["stages"]) == ["anchor"]
    run, = plan["stages"]["anchor"]["runs"]
    assert Path(run["manifest"]).name == "creator-003-tensor-passport.yaml"
    manifest = load_json(tmp_path / "plan" / run["manifest"])
    assert [job["seed"] for job in manifest["jobs"]] == list(range(148, 160))
    assert manifest["jobs"][0]["output_name"] == "c003-passport-p01"
    assert manifest["diagnostic_non_commercial"] is True
    assert manifest["workflow"] == "../workflows/tensor_passport_m03_api.json"
    assert (tmp_path / "plan" / "expand" / "workflows" / "tensor_passport_m03_api.json").is_file()
    prompt = manifest["jobs"][0]["substitutions"][0]["value"]
    assert "long, straight platinum blonde hair" in prompt and "bright light blue-grey eyes" in prompt
    argv = run["argv"]
    assert argv[argv.index("--max-usd") + 1] == "2.00"
    assert argv[argv.index("--max-minutes") + 1] == "92"
    assert argv[argv.index("--arc-cap-usd") + 1] == "75.00"
    assert plan["assets"]["anchors"] == []


def test_tensor_passport_manifest_dry_runs(command, tmp_path):
    plan = _plan(command, tmp_path)
    manifest = tmp_path / "plan" / plan["stages"]["anchor"]["runs"][0]["manifest"]
    result = subprocess.run([sys.executable, str(POD_RUNNER), "run", "--manifest", str(manifest),
                             "--out", str(tmp_path / "dry"), "--dry-run"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "PICKLE MODEL LOADED (diagnostic)" in result.stderr


def test_pre_passport_persona_refuses_every_other_stage(command, tmp_path):
    personas = tmp_path / "personas"
    persona_dir = _pre_passport_persona(personas)
    with pytest.raises(command.FigmentTrainError, match="no identity reference yet"):
        _plan(command, tmp_path, personas, stage="dataset")
    training = load_json(persona_dir / "training.yaml")
    training["training"]["recipe_profile"] = "clean"
    (persona_dir / "training.yaml").write_text(json.dumps(training), encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="no identity reference yet"):
        _plan(command, tmp_path, personas, name="clean")


def test_plan_runs_the_parity_preflight(command, tmp_path, monkeypatch):
    tampered = tmp_path / "tampered.json"
    workflow = load_json(command.TENSOR_PASSPORT_WORKFLOW_PATH)
    workflow["30"]["inputs"]["denoise"] = 0.4
    tampered.write_text(json.dumps(workflow), encoding="utf-8")
    monkeypatch.setattr(command, "TENSOR_PASSPORT_WORKFLOW_PATH", tampered)
    with pytest.raises(command.FigmentTrainError, match="tensor parity failed"):
        _plan(command, tmp_path)

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


def test_board_shows_every_group_expanded_with_counts(command, tmp_path):
    images = [{"image_id": f"c003-passport-p{i:02d}", "path": str(tmp_path / f"{i}.png")} for i in range(1, 5)]
    rows = [{"image_id": images[0]["image_id"], "pass": True, "group": "passed", "reasons": []},
            {"image_id": images[1]["image_id"], "pass": False, "group": "age", "reasons": ["judge age 19 is under the age floor 20"]},
            {"image_id": images[2]["image_id"], "pass": False, "group": "unscorable", "reasons": ["unavailable: face_px (no face detected)"]},
            {"image_id": images[3]["image_id"], "pass": False, "group": "failed", "reasons": ["face_px 500 is below the required floor 600"]}]
    board = command._grading_html("creator-003", "anchor", [], images, None, {"rows": rows})
    assert "<details" not in board
    for title in ("Cells passing the gate (1)", "held for age", "held unscorable", "failed gate"):
        assert title in board
    assert re.search(r"held for age[^<]*\(1\)</h2>", board)
    assert "judge age 19 is under the age floor 20" in board
    for image in images:
        assert image["image_id"] in board
    orphan = {"image_id": "c003-passport-p05", "path": str(tmp_path / "5.png")}
    board = command._grading_html("creator-003", "anchor", [], [*images, orphan], None, {"rows": rows})
    failed_section = board[board.index('<section class="gate-failed">'):]
    assert orphan["image_id"] in failed_section
    assert "gate did not run for this cell" in failed_section
    assert re.search(r"failed gate[^<]*\(2\)</h2>", board)


def test_passport_board_shows_both_ages_and_the_floor_on_every_cell(command, tmp_path):
    images = [{"image_id": f"c003-passport-p{i:02d}", "path": str(tmp_path / f"{i}.png")} for i in (1, 2)]
    judge = {"same_person": None, "apparent_age_reference": None, "apparent_age_candidate": 24,
             "age_delta": None, "skin_realism": 60, "gloss": 20, "artifacts": 10, "notes": "ok",
             "unavailable": {}}
    rows = [{"image_id": images[0]["image_id"], "pass": True, "group": "passed", "reasons": [],
             "age_value": 26.4, "judge": judge},
            {"image_id": images[1]["image_id"], "pass": False, "group": "age", "age_value": None,
             "reasons": ["unavailable: vit age"], "judge": {**judge, "apparent_age_candidate": 19}}]
    board = command._grading_html("creator-003", "anchor", [], images, None,
                                  {"rows": rows, "thresholds": {"age_floor_years": 20}})
    passed = board[board.index(images[0]["image_id"]):board.index('<section class="gate-age">')]
    held = board[board.index('<section class="gate-age">'):board.index('<section class="gate-unscorable">')]
    assert "vit age 26.4 · judge age 24 · floor 20" in passed
    assert "vit age n/a · judge age 19 · floor 20" in held
    assert "judge: age 24 · skin 60" in passed
    assert "same n/a" not in board and "(Δ" not in board


@pytest.mark.parametrize(("stage", "profile", "expected"), [
    ("anchor", "tensor", True), ("anchor", "clean", False), ("tester", "tensor", False),
])
def test_build_grade_gates_only_the_tensor_passport_reference_free(command, tmp_path, monkeypatch, stage, profile, expected):
    plan = {"training": {"recipe_profile": profile}, "assets": {"anchors": []}}
    monkeypatch.setattr(command, "_load_plan", lambda creator, path: (plan, tmp_path))
    monkeypatch.setattr(command, "_grading_images", lambda plan, root, stage: [])
    monkeypatch.setattr(command, "_score_cells_module", lambda: type("S", (), {"score": staticmethod(lambda *a: None)}))
    captured = {}

    class Stop(Exception):
        pass

    def fake_gate(plan, anchors, images, grade_dir, **kwargs):
        captured.update(kwargs)
        raise Stop

    monkeypatch.setattr(command, "_run_identity_gate", fake_gate)
    with pytest.raises(Stop):
        command.build_grade("creator-003", stage, tmp_path / "plan.json", skip_judge=True)
    assert captured["reference_free"] is expected

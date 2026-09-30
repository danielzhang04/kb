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
    # 91 min x $1.30/h = $1.9717, cent-ceiled to 1.98 -- inside the $2.00 passport ceiling.
    assert argv[argv.index("--max-usd") + 1] == "1.98"
    assert argv[argv.index("--max-minutes") + 1] == "91"
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


def _axes() -> dict:
    return {"identity": "pass", "realism": "pass", "hands": "pass", "lighting": "pass",
            "adult_read": "pass", "garment_integrity": "pass",
            "real_person_resemblance": "clear",
            "gate_override": "fixture: synthetic 8x8 image; release after operator review"}


def _fake_stage_outputs(out: Path, plan: dict, stage: str) -> None:
    for run in plan["stages"][stage]["runs"]:
        manifest = load_json(out / run["manifest"])
        (out / run["out"]).mkdir(parents=True, exist_ok=True)
        for job in manifest["jobs"]:
            Image.new("RGB", (8, 8)).save(out / run["out"] / f"{job['output_name']}.png")


def _gate_for(images, groups):
    rows = []
    for index, image in enumerate(images):
        group = groups.get(index, "passed")
        rows.append({"image_id": image["image_id"], "pass": group == "passed", "group": group,
                     "reasons": [] if group == "passed" else [f"fixture {group}"],
                     "age_value": 18.0 if group == "age" else 27.0,
                     "judge": {"apparent_age_candidate": 19 if group == "age" else 26},
                     "stage1": None, "stage2": None})
    return {"schema": "figment/gate@1", "own_anchor": None, "thresholds": {"age_floor_years": 20},
            "judge_thresholds": {}, "judge_skipped": False, "outage": None, "rows": rows,
            "summary": {"total": len(rows), "passed": 0, "failed": 0}}


def test_pick_creates_the_identity_and_logs_age_hold_rulings(command, tmp_path, monkeypatch):
    personas = tmp_path / "personas"
    persona_dir = _pre_passport_persona(personas)
    out = tmp_path / "plan"
    plan = _plan(command, tmp_path, personas)
    _fake_stage_outputs(out, plan, "anchor")
    monkeypatch.setattr(command, "_run_identity_gate",
                        lambda plan, anchors, images, grade_dir, **_kw:
                        _gate_for(images, {0: "age", 1: "age", 2: "unscorable"}))
    grade = command.build_grade("creator-003", "anchor", out / "plan.json")
    assert re.search(r"held for age[^<]*\(2\)</h2>", Path(grade["page"]).read_text("utf-8"))
    template = load_json(Path(grade["rulings_template"]))
    assert len(template["rulings"]) == 12
    assert [row.get("age_ruling", "absent") for row in template["rulings"][:4]] == [None, None, "absent", "absent"]
    for index, row in enumerate(template["rulings"]):
        row.update(_axes(), decision="keep" if index == 1 else "cull",
                   why="the pick" if index == 1 else "not picked")
    # Final review F2: the age call is the operator's own, independent of the pick --
    # cell 0 is judged adult (released) yet not picked.
    template["rulings"][0]["age_ruling"] = "release"
    template["rulings"][1]["age_ruling"] = "release"
    template.update(decided_by="operator-fixture", decided_at="2026-09-30T00:00:00Z")
    filled = out / "filled.json"
    filled.write_text(json.dumps(template), "utf-8")

    command.apply_rulings("creator-003", "anchor", out / "plan.json", filled)

    persona = load_json(persona_dir / "persona.yaml")
    assert persona["identity"]["references"] == ["anchors/passport.png"]
    assert (persona_dir / "anchors" / "passport.png").is_file()
    assert persona["identity"]["look"]["hair"] == "long, straight platinum blonde hair"
    assert load_json(persona_dir / "training.yaml")["training"]["recipe_profile"] == "tensor"
    holds = [json.loads(line) for line in
             (persona_dir / "calibration" / "age-holds.jsonl").read_text("utf-8").splitlines()]
    assert [(h["image_id"], h["ruling"]) for h in holds] == [
        (template["rulings"][0]["image_id"], "release"), (template["rulings"][1]["image_id"], "release")]
    assert (holds[1]["vit_age"], holds[1]["judge_age"], holds[1]["age_floor_years"]) == (18.0, 19, 20)
    assert holds[1]["decided_by"] == "operator-fixture" and len(holds[1]["image_sha256"]) == 64
    with pytest.raises(command.FigmentTrainError, match="already has its passport"):
        _plan(command, tmp_path, personas, name="again")


def _graded_passport(command, tmp_path, monkeypatch, keeps, age_rulings=None):
    """Plan + fake outputs + grade creator-003 (cells 0,1 held for age, 2 unscorable);
    return (persona_dir, plan_path, filled_rulings_path) with `keeps` kept, the rest culled.
    `age_rulings` maps held cell index -> age_ruling (default: both held cells "cull";
    a None value leaves the key out)."""
    personas = tmp_path / "personas"
    persona_dir = _pre_passport_persona(personas)
    out = tmp_path / "plan"
    plan = _plan(command, tmp_path, personas)
    _fake_stage_outputs(out, plan, "anchor")
    monkeypatch.setattr(command, "_run_identity_gate",
                        lambda plan, anchors, images, grade_dir, **_kw:
                        _gate_for(images, {0: "age", 1: "age", 2: "unscorable"}))
    grade = command.build_grade("creator-003", "anchor", out / "plan.json")
    template = load_json(Path(grade["rulings_template"]))
    for index, row in enumerate(template["rulings"]):
        row.update(_axes(), decision="keep" if index in keeps else "cull", why=f"ruling {index}")
    for index, age_ruling in ({0: "cull", 1: "cull"} if age_rulings is None else age_rulings).items():
        if age_ruling is not None:
            template["rulings"][index]["age_ruling"] = age_ruling
    template.update(decided_by="operator-fixture", decided_at="2026-09-30T00:00:00Z")
    filled = out / "filled.json"
    filled.write_text(json.dumps(template), "utf-8")
    return persona_dir, out / "plan.json", filled


def _holds(persona_dir: Path) -> list[tuple[str, str]]:
    path = persona_dir / "calibration" / "age-holds.jsonl"
    if not path.is_file():
        return []
    return [(row["image_id"], row["ruling"]) for row in
            map(json.loads, path.read_text("utf-8").splitlines())]


def test_two_keeps_are_refused_before_any_identity_or_log_write(command, tmp_path, monkeypatch):
    persona_dir, plan_path, filled = _graded_passport(command, tmp_path, monkeypatch, {0, 1})
    with pytest.raises(command.FigmentTrainError, match="keep exactly one candidate"):
        command.apply_rulings("creator-003", "anchor", plan_path, filled)
    assert not (persona_dir / "anchors" / "passport.png").exists()
    assert _holds(persona_dir) == []
    assert load_json(persona_dir / "persona.yaml")["identity"]["references"] == []


def test_all_cull_writes_no_identity_but_logs_the_age_hold_culls(command, tmp_path, monkeypatch):
    persona_dir, plan_path, filled = _graded_passport(command, tmp_path, monkeypatch, set())
    result = command.apply_rulings("creator-003", "anchor", plan_path, filled)
    assert "rejection_lineage" in result
    assert not (persona_dir / "anchors" / "passport.png").exists()
    assert load_json(persona_dir / "persona.yaml")["identity"]["references"] == []
    assert _holds(persona_dir) == [("c003-passport-p01", "cull"), ("c003-passport-p02", "cull")]


def test_keeping_a_passed_cell_logs_the_held_cells_age_rulings_not_their_pick(command, tmp_path, monkeypatch):
    persona_dir, plan_path, filled = _graded_passport(command, tmp_path, monkeypatch, {3},
                                                      age_rulings={0: "release", 1: "cull"})
    command.apply_rulings("creator-003", "anchor", plan_path, filled)
    assert load_json(persona_dir / "persona.yaml")["identity"]["references"] == ["anchors/passport.png"]
    assert _holds(persona_dir) == [("c003-passport-p01", "release"), ("c003-passport-p02", "cull")]


@pytest.mark.parametrize("value", [None, "keep", ""])
def test_a_held_cell_without_an_age_ruling_is_refused_before_any_write(command, tmp_path, monkeypatch, value):
    persona_dir, plan_path, filled = _graded_passport(command, tmp_path, monkeypatch, {3},
                                                      age_rulings={0: "cull", 1: value})
    with pytest.raises(command.FigmentTrainError,
                       match="held-for-age cell c003-passport-p02 has no age_ruling"):
        command.apply_rulings("creator-003", "anchor", plan_path, filled)
    assert not (persona_dir / "anchors" / "passport.png").exists()
    assert _holds(persona_dir) == []
    assert load_json(persona_dir / "persona.yaml")["identity"]["references"] == []
    assert not (plan_path.parent / "grade" / "anchor" / "rulings.json").exists()


def test_a_retry_after_a_failed_rulings_write_never_duplicates_hold_rows(command, tmp_path, monkeypatch):
    persona_dir, plan_path, filled = _graded_passport(command, tmp_path, monkeypatch, set())
    real_write = command._write_json

    def failing_write(path, document):
        if Path(path).name == "rulings.json":
            raise OSError("fixture: rulings.json write failed")
        return real_write(path, document)

    monkeypatch.setattr(command, "_write_json", failing_write)
    with pytest.raises(OSError, match="rulings.json write failed"):
        command.apply_rulings("creator-003", "anchor", plan_path, filled)
    assert _holds(persona_dir) == [("c003-passport-p01", "cull"), ("c003-passport-p02", "cull")]
    monkeypatch.setattr(command, "_write_json", real_write)
    command.apply_rulings("creator-003", "anchor", plan_path, filled)
    assert _holds(persona_dir) == [("c003-passport-p01", "cull"), ("c003-passport-p02", "cull")]


def test_hold_rows_are_built_before_any_identity_write(command, tmp_path, monkeypatch):
    persona_dir, plan_path, filled = _graded_passport(command, tmp_path, monkeypatch, {1})
    real_sha256 = command._sha256

    def failing_sha256(path, **kwargs):
        if Path(path).name == "c003-passport-p01.png":
            raise OSError("fixture: held image unreadable")
        return real_sha256(path, **kwargs)

    monkeypatch.setattr(command, "_sha256", failing_sha256)
    with pytest.raises(OSError, match="held image unreadable"):
        command.apply_rulings("creator-003", "anchor", plan_path, filled)
    assert not (persona_dir / "anchors" / "passport.png").exists()
    assert load_json(persona_dir / "persona.yaml")["identity"]["references"] == []

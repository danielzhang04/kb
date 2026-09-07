"""Contract tests for the generation stage (module 09 -> Track-2 Phase D: Tasks D1-D2)
and the cheap re-detail mode (r25 ranked cause #2).

Shared test helpers (`command`, `_synthetic_persona`, `_promoted_persona`,
`_set_training`, `load_json`, `_rc0`) come from `pipeline/tests/test_anchor_stage.py`,
loaded via importlib the same way `expand/tests/test_tensor_dataset.py` reuses them --
there is no package ``__init__.py`` anywhere in this test tree.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
POD_RUNNER = PIPELINE / "pod" / "runpod_run.py"
GEN_WORKFLOW = PIPELINE / "train" / "workflows" / "krea2_gen_api.json"
DETAIL_WORKFLOW = PIPELINE / "train" / "workflows" / "krea2_detail_only_api.json"
PINS_PATH = PIPELINE / "train" / "tensor-pins.yaml"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def command():
    return load_module("figment_train_test_module_gen", PIPELINE / "figment_train.py")


anchor_stage_test = load_module(
    "figment_gen_test_anchor_stage", PIPELINE / "tests" / "test_anchor_stage.py",
)
_synthetic_persona = anchor_stage_test._synthetic_persona
_promoted_persona = anchor_stage_test._promoted_persona
_set_training = anchor_stage_test._set_training
load_json = anchor_stage_test.load_json


BANNED = (
    "UltralyticsDetectorProvider", "SAMLoader", '.pt"', ".pth",
    "creator-001", "creator001krea2", "pawg", "gravedigga", "Impact-Subpack",
)


def _banned_free(blob: str) -> None:
    for banned in BANNED:
        assert banned not in blob, banned


# ---------------------------------------------------------------------------
# Task D1: pin the licence-clean face-mask path
# ---------------------------------------------------------------------------


def test_gen_pins_have_no_subpack_and_no_pickle():
    pins = json.loads(PINS_PATH.read_text("utf-8"))
    gen = pins["pins"]["gen"]
    blob = json.dumps(gen).lower()
    assert "impact-subpack" not in blob and "ultralytics" not in blob
    for m in gen["models"]:
        assert m["filename"].endswith((".safetensors", ".onnx")), m
        assert len(m["revision"]) == 40 and len(m["sha256"]) == 64, m
    face = next(
        m for m in gen["models"] if m["filename"].endswith("mediapipe_face_fp32.safetensors")
    )
    assert face["repo_id"] == "Comfy-Org/mediapipe"
    assert face["destination_dir"] == "/workspace/ComfyUI/models/detection"
    assert pins["pod_classes"]["l40s"]["stages"]["gen"]["comfyui"]["git_ref"] == "v0.34.0"
    for key in ("gen", "detail", "style_loras"):
        assert key in pins["pins"], key


def test_pins_document_has_no_pickle_or_subpack_anywhere():
    """Whole-document guard (the outer task's "no ultralytics/SAM/.pt anywhere in
    pins" requirement) -- not just the gen profile."""
    blob = PINS_PATH.read_text("utf-8")
    assert "Impact-Subpack" not in blob
    assert "ultralytics" not in blob.lower()
    assert '.pt"' not in blob and ".pth" not in blob


# ---------------------------------------------------------------------------
# Task D2: the generation workflow, the gen stage, and the detail-only mode
# ---------------------------------------------------------------------------


def test_gen_workflow_matches_module_09_and_has_a_pickle_free_detailer():
    g = json.loads(GEN_WORKFLOW.read_text(encoding="utf-8"))
    b = g["8"]["inputs"]
    assert (b["steps"], b["cfg"], b["sampler_name"], b["scheduler"], b["denoise"]) == (
        4, 1.0, "res_2s", "beta", 1.0,
    )
    assert g["15"]["inputs"]["denoise"] == 0.35 and g["13"]["inputs"]["scale_by"] == 0.25
    assert g["4"]["inputs"]["strength_model"] == 1.0
    assert g["30"]["class_type"] == "LoadMediaPipeFaceLandmarker"
    assert g["35"]["class_type"] == "MediaPipeFaceLandmarker"
    assert g["36"]["class_type"] == "MediaPipeFaceMask"
    assert g["36"]["inputs"]["regions"] == {"regions": "all"}
    assert g["32"]["class_type"] == "MaskToSEGS"
    assert set(g["32"]["inputs"]) == {
        "mask", "combined", "crop_factor", "bbox_fill", "drop_size", "contour_fill",
    }
    d = g["33"]["inputs"]
    assert g["33"]["class_type"] == "DetailerForEach"
    assert (d["guide_size"], d["steps"], d["cfg"], d["sampler_name"], d["scheduler"],
            d["denoise"], d["feather"], d["cycle"]) == (
        512, 4, 1.0, "euler", "normal", 0.15, 5, 1,
    )
    assert g["40"]["class_type"] == "LoraLoaderModelOnly"
    _banned_free(json.dumps(g))


def test_detail_only_workflow_has_no_upscale_no_style_slot_and_no_pickle():
    g = json.loads(DETAIL_WORKFLOW.read_text(encoding="utf-8"))
    assert g["1"]["class_type"] == "LoadImage"
    assert g["15"]["class_type"] == "DetailerForEach"
    for class_type in ("ImageUpscaleWithModel", "LoraLoaderModelOnly", "UpscaleModelLoader"):
        assert all(node.get("class_type") != class_type for node in g.values())
    _banned_free(json.dumps(g))


def test_gen_stage_requires_a_chosen_checkpoint_and_uploads_only_that_file(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    with pytest.raises(command.FigmentTrainError, match="chosen checkpoint"):
        command.build_plan(
            "creator-002", "gen", tmp_path / "a", personas_root=personas,
            skip_pin_verify=True,
        )
    _set_training(personas / "creator-002", chosen_checkpoint_step=1500)
    out = tmp_path / "b"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
    )
    run = plan["stages"]["gen"]["runs"][0]
    m = load_json(out / run["manifest"])
    assert Path(run["manifest"]).name == "creator-002-tensor-gen.yaml"
    assert m["workflow"] == "../workflows/krea2_gen_api.json"
    assert m["uploads"][0]["files"] == [
        "out/creator-002-tensor-train/creator002krea2_000001500.safetensors"
    ]
    assert m["uploads"][0]["chunk_bytes"] == 16777216
    assert m["jobs"][0]["wait_for"] == "_loras.assembled"
    assert len(m["jobs"]) == 12
    assert all(j["expected_images"] == 3 for j in m["jobs"])
    r = subprocess.run(
        [sys.executable, str(POD_RUNNER), "run", "--manifest", str(out / run["manifest"]),
         "--out", str(tmp_path / "dry"), "--dry-run"],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr


def test_unknown_stage_raises_instead_of_falling_through(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    with pytest.raises(command.FigmentTrainError, match="unknown stage"):
        command.build_plan(
            "creator-002", "nonsense", tmp_path / "c", personas_root=personas,
            skip_pin_verify=True,
        )


def test_build_plan_excludes_gen_from_stage_all(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _set_training(personas / "creator-002", chosen_checkpoint_step=1500)
    out = tmp_path / "all"
    plan = command.build_plan(
        "creator-002", "all", out, personas_root=personas, skip_pin_verify=True,
    )
    assert "gen" not in plan["stages"]


def test_grade_apply_rulings_and_gate_accept_gen(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _set_training(personas / "creator-002", chosen_checkpoint_step=1500)
    out = tmp_path / "g"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
    )
    anchor_stage_test._fake_stage_outputs(out, plan, "gen")
    grade = command.build_grade("creator-002", "gen", out / "plan.json", skip_judge=True)
    assert Path(grade["page"]).is_file()
    assert Path(grade["gate"]).is_file()

    template = load_json(Path(grade["rulings_template"]))
    for row in template["rulings"]:
        row.update(anchor_stage_test._axes(), decision="keep")
    filled = out / "filled.json"
    filled.write_text(json.dumps(template), "utf-8")
    applied = command.apply_rulings("creator-002", "gen", out / "plan.json", filled)
    assert Path(applied["rulings"]).is_file()

    document = command.command_gate("creator-002", "gen", out / "plan.json")
    assert document["rows"]


# ---------------------------------------------------------------------------
# Style LoRA: null vs set (outer-task-required test)
# ---------------------------------------------------------------------------


def test_style_lora_null_drops_node_40_and_set_wires_it_in_with_configured_strength(
    command, tmp_path,
):
    pins = json.loads(PINS_PATH.read_text("utf-8"))

    off = command._gen_workflow({"style_lora": None}, pins)
    assert "40" not in off
    assert off["8"]["inputs"]["model"] == ["4", 0]
    assert off["15"]["inputs"]["model"] == ["4", 0]
    assert off["33"]["inputs"]["model"] == ["4", 0]
    # LoraLoaderModelOnly never touches CLIP -- node 5's/33's clip stay off node 4
    # regardless of the style-lora switch.
    assert off["5"]["inputs"]["clip"] == ["4", 1]

    on = command._gen_workflow(
        {"style_lora": "inline-skin", "style_lora_strength": 0.42}, pins,
    )
    assert on["40"]["inputs"]["strength_model"] == 0.42
    assert on["8"]["inputs"]["model"] == ["40", 0]
    assert on["15"]["inputs"]["model"] == ["40", 0]
    assert on["33"]["inputs"]["model"] == ["40", 0]

    with pytest.raises(command.FigmentTrainError, match="unknown training.style_lora"):
        command._gen_workflow({"style_lora": "not-a-real-key"}, pins)


def test_gen_manifest_bakes_style_lora_filename_and_pins_its_model(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _set_training(
        personas / "creator-002", chosen_checkpoint_step=1500,
        style_lora="gokay-realism", style_lora_strength=0.7,
    )
    out = tmp_path / "s"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
    )
    run = plan["stages"]["gen"]["runs"][0]
    m = load_json(out / run["manifest"])
    style_names = [
        model["filename"] for model in m["models"]
        if model["repo_id"] == "gokaygokay/Krea-2-Realism-LoRA"
    ]
    assert style_names == ["krea2_realism_lora.safetensors"]
    style_subs = [
        sub for sub in m["jobs"][0]["substitutions"] if sub["node_id"] == "40"
    ]
    assert style_subs and style_subs[0]["value"] == "krea2_realism_lora.safetensors"


# ---------------------------------------------------------------------------
# The detail-only mode (r25 cause #2): --detail-images, job count, dry-run
# ---------------------------------------------------------------------------


def test_detail_manifest_job_count_and_dry_run(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _set_training(personas / "creator-002", chosen_checkpoint_step=1500)

    source_dir = tmp_path / "existing-cells"
    source_dir.mkdir()
    for name in ("cell-01.png", "cell-02.png", "cell-03.png"):
        (source_dir / name).write_bytes(b"not a real png, just a fixture file")

    out = tmp_path / "detail"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
        detail_images=str(source_dir / "*.png"),
    )
    runs = plan["stages"]["gen"]["runs"]
    assert [Path(r["manifest"]).name for r in runs] == [
        "creator-002-tensor-gen.yaml", "creator-002-tensor-detail.yaml",
    ]
    detail = load_json(out / runs[1]["manifest"])
    assert detail["workflow"] == "../workflows/krea2_detail_only_api.json"
    assert len(detail["jobs"]) == 6  # 3 images x (denoise 0.15, denoise 0.27)
    denoises = sorted({
        sub["value"] for job in detail["jobs"] for sub in job["substitutions"]
        if sub["node_id"] == "15" and sub["field"] == "denoise"
    })
    assert denoises == [0.15, 0.27]

    for run in runs:
        r = subprocess.run(
            [sys.executable, str(POD_RUNNER), "run", "--manifest", str(out / run["manifest"]),
             "--out", str(tmp_path / "dry" / Path(run["manifest"]).stem), "--dry-run"],
            capture_output=True, text=True,
        )
        assert r.returncode == 0, r.stderr


def test_detail_images_requires_gen_stage(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    with pytest.raises(command.FigmentTrainError, match="only meaningful"):
        command.build_plan(
            "creator-002", "tester", tmp_path / "x", personas_root=personas,
            skip_pin_verify=True, detail_images="*.png",
        )


def test_detail_images_glob_matching_nothing_raises(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _set_training(personas / "creator-002", chosen_checkpoint_step=1500)
    with pytest.raises(command.FigmentTrainError, match="matched no files"):
        command.build_plan(
            "creator-002", "gen", tmp_path / "y", personas_root=personas,
            skip_pin_verify=True, detail_images=str(tmp_path / "nope-*.png"),
        )

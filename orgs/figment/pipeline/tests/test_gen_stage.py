"""Contract tests for the generation stage (module 09 -> Track-2 Phase D: Tasks D1-D2)
and the cheap re-detail mode (r25 ranked cause #2).

Shared test helpers (`command`, `_synthetic_persona`, `_promoted_persona`,
`_set_training`, `load_json`, `_rc0`) come from `pipeline/tests/test_anchor_stage.py`,
loaded via importlib the same way `expand/tests/test_tensor_dataset.py` reuses them --
there is no package ``__init__.py`` anywhere in this test tree.
"""
from __future__ import annotations

import importlib.util
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
POD_RUNNER = PIPELINE / "pod" / "runpod_run.py"
VIDEO_REVIEW = PIPELINE / "video" / "video_review.py"
GEN_WORKFLOW = PIPELINE / "train" / "workflows" / "krea2_gen_api.json"
DETAIL_WORKFLOW = PIPELINE / "train" / "workflows" / "krea2_detail_only_api.json"
PINS_PATH = PIPELINE / "train" / "tensor-pins.yaml"
REAL_PERSONAS = PIPELINE.parent / "personas"


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
video = load_module("figment_gen_test_video_manifest", PIPELINE / "video" / "video_manifest.py")
video_assembly = load_module("figment_gen_test_video_assembly", PIPELINE / "video" / "frame_assemble.py")
video_review = load_module("figment_gen_test_video_review", PIPELINE / "video" / "video_review.py")
pod_runner = load_module("figment_gen_test_pod_runner", POD_RUNNER)
train_first_test = load_module(
    "figment_gen_test_train_first", PIPELINE / "tests" / "test_figment_train.py",
)


BANNED = (
    "UltralyticsDetectorProvider", "SAMLoader", '.pt"', ".pth",
    "creator-001", "creator001krea2", "pawg", "gravedigga", "Impact-Subpack",
)


def _banned_free(blob: str) -> None:
    for banned in BANNED:
        assert banned not in blob, banned


def _prepare_accepted_checkpoint(
    command, personas: Path, out_root: Path, *, before_apply=None,
    dry_run_stage=None, **training_fields,
):
    """Build a real tester approval chain for gen planning.

    The gen stage consumes a promoted checkpoint, so tests create the same local
    evidence an operator would: a completed train receipt, tester grade, human ruling,
    and accepted-checkpoint record.  The pod itself remains a fixture and is never run.
    """
    persona_dir = personas / "creator-002"
    _set_training(
        persona_dir, chosen_checkpoint_step=None, chosen_checkpoint_sha256=None,
        chosen_checkpoint_approval=None, save_every=250, **training_fields,
    )
    source = out_root / "source-lineage"
    # M2: this fixture's own ledger is whatever `build_plan` falls back to by default
    # (often the live shared OPS ledger on this machine) -- this helper is about
    # manifest/receipt plumbing, not budget behaviour, so it always accepts.
    plan = command.build_plan(
        "creator-002", "all", source, personas_root=personas, skip_pin_verify=True,
        accept_budget=True,
    )
    train_run = plan["stages"]["train"]["runs"][0]
    train_manifest = load_json(source / train_run["manifest"])
    step = 1500
    filename = f"creator002krea2_{step:09d}.safetensors"
    assert filename in [item["local"] for item in train_manifest["artifacts"]]
    train_out = source / train_run["out"]
    train_out.mkdir(parents=True, exist_ok=True)
    checkpoint = train_out / filename
    receipt_artifacts = []
    for index, artifact in enumerate(train_manifest["artifacts"]):
        artifact_path = train_out / artifact["local"]
        artifact_path.write_bytes(f"fixture checkpoint bytes {index:02d}".encode("utf-8"))
        receipt_artifacts.append({
            "remote": artifact["remote"], "bytes": artifact_path.stat().st_size,
        })
    (train_out / "run.json").write_text(json.dumps({
        "error": None,
        "dry_run": dry_run_stage == "train",
        "termination_verified": True,
        "artifacts": receipt_artifacts,
    }), encoding="utf-8")

    tester_run = plan["stages"]["tester"]["runs"][0]
    tester_manifest = load_json(source / tester_run["manifest"])
    candidate_job = next(
        job for job in tester_manifest["jobs"]
        if any(item.get("field") == "lora_name" and item.get("value") == filename
               for item in job.get("substitutions", []))
    )
    anchor_stage_test._fake_stage_outputs(source, plan, "tester")
    tester_out = source / tester_run["out"]
    (tester_out / "run.json").write_text(json.dumps({
        "error": None,
        "dry_run": dry_run_stage == "tester",
        "termination_verified": True,
        "jobs": [{
            "output_name": job["output_name"],
            "files": [{"bytes": 10} for _ in range(job.get("expected_images", 1))],
        } for job in tester_manifest["jobs"]],
    }), encoding="utf-8")
    checkpoint_inputs = command._tester_checkpoint_inputs(plan, source, tester_run)
    (source / "stage.json").write_text(json.dumps({
        "schema": "figment/train-stage@1",
        "creator": "creator-002",
        "plan_sha256": command._sha256(source / "plan.json"),
        "status": "complete:tester",
        "runs": {
            train_run["manifest"]: {"status": "complete"},
            tester_run["manifest"]: {
                "status": "complete", "checkpoint_inputs": checkpoint_inputs,
            },
        },
        "completed_stages": ["train", "tester"],
    }), encoding="utf-8")
    grade = command.build_grade(
        "creator-002", "tester", source / "plan.json", skip_judge=True,
    )
    template = load_json(Path(grade["rulings_template"]))
    for job in template["rulings"]:
        keep = job["image_id"] == candidate_job["output_name"]
        job.update(anchor_stage_test._axes(), decision="keep" if keep else "cull")
        if keep:
            job["gate_override"] = "fixture: no real face in this synthetic 8x8 image"
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-08T00:00:00Z"})
    rulings = source / "tester-rulings.json"
    rulings.write_text(json.dumps(template), encoding="utf-8")
    if before_apply is not None:
        before_apply(checkpoint)
    command.apply_rulings(
        "creator-002", "tester", source / "plan.json", rulings,
        checkpoint_step=step,
    )
    assert (source / "grade" / "tester" / "accepted-checkpoint.json").is_file()
    return step


def test_gen_consumer_revalidates_current_selected_checkpoint_authority_before_harness(
    command, tmp_path, monkeypatch,
):
    """A compiled gen plan retains staged bytes, but never retains stale authority."""
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path)
    out = tmp_path / "approved-gen-consumer"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
    )
    plan_path = out / "plan.json"
    approval = Path(plan["training"]["chosen_checkpoint_approval"])
    approval_lineage = approval.with_name("approval-lineage.json")
    accepted = load_json(approval)
    source_plan = Path(accepted["source_plan"])
    checkpoint = Path(accepted["checkpoint"]["path"])
    persona_path = personas / "creator-002" / "persona.yaml"
    manifest = load_json(out / plan["stages"]["gen"]["runs"][0]["manifest"])
    staged = (out / plan["stages"]["gen"]["runs"][0]["manifest"]).parent / next(
        value for upload in manifest["uploads"] for value in upload["files"]
        if value.endswith(".safetensors")
    )
    launched = []

    class _RC1:
        returncode = 1

    monkeypatch.setattr(
        command.subprocess, "run", lambda argv, cwd=None: launched.append(argv) or _RC1(),
    )

    def rejects_before_harness(path: Path, mutate, message: str):
        original = path.read_bytes()
        try:
            mutate(path)
            with pytest.raises(command.FigmentTrainError, match=message):
                command.run_planned_stage("creator-002", "gen", plan_path)
            assert launched == []
            assert not (out / "stage.json").exists()
        finally:
            path.write_bytes(original)

    rejects_before_harness(approval, lambda path: path.unlink(), "cannot read JSON document")
    rejects_before_harness(approval, lambda path: path.write_bytes(path.read_bytes() + b" "),
                           "selected checkpoint approval provenance changed")
    rejects_before_harness(approval_lineage, lambda path: path.unlink(), "tester approval lineage")
    rejects_before_harness(approval_lineage, lambda path: path.write_bytes(path.read_bytes() + b" "),
                           "tester approval lineage changed")
    rejects_before_harness(persona_path,
                           lambda path: _set_training(path.parent, chosen_checkpoint_step=3000),
                           "current persona changed")
    rejects_before_harness(persona_path, lambda path: path.write_bytes(path.read_bytes() + b" "),
                           "current persona changed")
    rejects_before_harness(source_plan, lambda path: path.write_bytes(path.read_bytes() + b" "),
                           "chosen checkpoint source plan changed")
    rejects_before_harness(checkpoint, lambda path: path.write_bytes(path.read_bytes() + b"x"),
                           "checkpoint")
    rejects_before_harness(staged, lambda path: path.write_bytes(path.read_bytes() + b"x"),
                           "staged gen checkpoint changed")

    def drop_gen_authority(path: Path):
        legacy = load_json(path)
        del legacy["gen_authority"]
        path.write_text(json.dumps(legacy), "utf-8")

    rejects_before_harness(plan_path, drop_gen_authority, "no captured selected-checkpoint provenance")

    with pytest.raises(command.FigmentTrainError, match="harness stopped"):
        command.run_planned_stage("creator-002", "gen", plan_path)
    assert len(launched) == 1


@pytest.mark.parametrize(
    ("mutation", "message"),
    (("selection", "current persona changed"), ("source-plan", "source evidence cannot be read")),
)
def test_gen_consumer_revalidates_authority_between_base_and_detail_launches(
    command, tmp_path, monkeypatch, mutation, message,
):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path)
    detail = tmp_path / "detail.png"
    Image.new("RGB", (8, 8), (30, 40, 50)).save(detail)
    out = tmp_path / "approved-gen-two-run"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas,
        detail_images=str(detail), skip_pin_verify=True,
    )
    assert len(plan["stages"]["gen"]["runs"]) == 2
    source_plan = Path(load_json(Path(plan["training"]["chosen_checkpoint_approval"]))["source_plan"])
    launched = []

    class _RC0:
        returncode = 0

    def fake_harness(argv, cwd=None):
        launched.append(argv)
        if len(launched) == 1:
            if mutation == "selection":
                _set_training(personas / "creator-002", chosen_checkpoint_step=3000)
            else:
                source_plan.unlink()
        return _RC0()

    monkeypatch.setattr(command.subprocess, "run", fake_harness)
    monkeypatch.setattr(command, "verify_run_record", lambda *args: None)
    with pytest.raises(command.FigmentTrainError, match=message):
        command.run_planned_stage("creator-002", "gen", out / "plan.json")
    assert len(launched) == 1
    state = load_json(out / "stage.json")
    runs = plan["stages"]["gen"]["runs"]
    assert state["status"] == "stopped:gen"
    assert state["runs"][runs[0]["manifest"]]["status"] == "complete"
    assert runs[1]["manifest"] not in state["runs"]


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
    with pytest.raises(command.FigmentTrainError, match="provenance"):
        command.build_plan(
            "creator-002", "gen", tmp_path / "manual", personas_root=personas,
            skip_pin_verify=True,
        )
    _prepare_accepted_checkpoint(command, personas, tmp_path)
    out = tmp_path / "b"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
    )
    run = plan["stages"]["gen"]["runs"][0]
    m = load_json(out / run["manifest"])
    assert Path(run["manifest"]).name == "creator-002-tensor-gen.yaml"
    assert m["workflow"] == "../workflows/krea2_gen_api.json"
    assert m["uploads"][0]["files"] == [
        "accepted-checkpoint/creator002krea2_000001500.safetensors"
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


def test_train_first_tester_selection_stages_current_checkpoint_in_fresh_gen_plan(command, tmp_path, monkeypatch):
    """Exercise the real config-bound train-first -> fresh-gen lineage join.

    The fixture writes only local receipt/image evidence; selection, persistence,
    external-source validation, and checkpoint staging all use production helpers.
    """
    personas = tmp_path / "personas"
    _synthetic_persona(personas)
    dataset = train_first_test._prebuilt_dataset_dir(
        tmp_path / "accepted-20", command=command,
    )
    train_first_root = tmp_path / "train-first"
    plan = command.build_train_first_plan(
        "creator-002", dataset, train_first_root,
        personas_root=personas, skip_pin_verify=True,
    )
    train_run = plan["stages"]["train"]["runs"][0]
    train_manifest = load_json(train_first_root / train_run["manifest"])
    train_out = train_first_root / train_run["out"]
    train_out.mkdir(parents=True)
    artifacts = []
    for index, row in enumerate(train_manifest["artifacts"]):
        artifact = train_out / row["local"]
        artifact.write_bytes(f"train-first checkpoint {index}".encode("utf-8"))
        artifacts.append({"remote": row["remote"], "bytes": artifact.stat().st_size})
    (train_out / "run.json").write_text(json.dumps({
        "error": None, "dry_run": False, "termination_verified": True,
        "artifacts": artifacts,
    }), encoding="utf-8")

    tester_run = plan["stages"]["tester"]["runs"][0]
    tester_manifest = load_json(train_first_root / tester_run["manifest"])
    chosen_step = plan["training"]["save_every"]
    filename = f"creator002krea2_{chosen_step:09d}.safetensors"
    candidate = next(
        job for job in tester_manifest["jobs"]
        if any(item.get("field") == "lora_name" and item.get("value") == filename
               for item in job.get("substitutions", []))
    )
    anchor_stage_test._fake_stage_outputs(train_first_root, plan, "tester")
    tester_out = train_first_root / tester_run["out"]
    (tester_out / "run.json").write_text(json.dumps({
        "error": None, "dry_run": False, "termination_verified": True,
        "jobs": [{"output_name": job["output_name"], "files": [{"bytes": 10}]}
                 for job in tester_manifest["jobs"]],
    }), encoding="utf-8")
    checkpoint_inputs = command._tester_checkpoint_inputs(plan, train_first_root, tester_run)
    (train_first_root / "stage.json").write_text(json.dumps({
        "schema": "figment/train-stage@1", "creator": "creator-002",
        "plan_sha256": command._sha256(train_first_root / "plan.json"),
        "status": "complete:tester", "completed_stages": ["train", "tester"],
        "runs": {train_run["manifest"]: {"status": "complete"},
                 tester_run["manifest"]: {"status": "complete", "checkpoint_inputs": checkpoint_inputs}},
    }), encoding="utf-8")
    gate_module = command._identity_gate_module()
    monkeypatch.setattr(
        gate_module, "score_cells_for_stage", train_first_test._fake_score_cells_for_stage,
    )
    grade = command.build_grade("creator-002", "tester", train_first_root / "plan.json", skip_judge=True)
    rulings = load_json(Path(grade["rulings_template"]))
    for row in rulings["rulings"]:
        row.update(anchor_stage_test._axes(), decision="keep" if row["image_id"] == candidate["output_name"] else "cull")
        if row["image_id"] == candidate["output_name"]:
            row["gate_override"] = "fixture: no real face in synthetic image"
    rulings.update({"decided_by": "operator-fixture", "decided_at": "2026-09-09T00:00:00Z"})
    rulings_path = train_first_root / "tester-rulings.json"
    rulings_path.write_text(json.dumps(rulings), encoding="utf-8")
    selected = command.apply_rulings(
        "creator-002", "tester", train_first_root / "plan.json", rulings_path,
        checkpoint_step=chosen_step,
    )

    gen_root = tmp_path / "fresh-gen"
    gen_plan = command.build_plan(
        "creator-002", "gen", gen_root, personas_root=personas, skip_pin_verify=True,
    )
    staged = gen_root / "train" / "runs" / "accepted-checkpoint" / filename
    source_checkpoint = train_out / filename
    accepted = load_json(Path(selected["accepted_checkpoint"]))
    assert accepted["source_plan"] == str((train_first_root / "plan.json").resolve())
    assert accepted["source_plan"] != str((gen_root / "plan.json").resolve())
    assert staged.is_file()
    assert hashlib.sha256(staged.read_bytes()).hexdigest() == hashlib.sha256(source_checkpoint.read_bytes()).hexdigest()
    assert gen_plan["training"]["chosen_checkpoint_sha256"] == hashlib.sha256(source_checkpoint.read_bytes()).hexdigest()
    gen_manifest = load_json(gen_root / gen_plan["stages"]["gen"]["runs"][0]["manifest"])
    assert gen_manifest["uploads"][0]["files"] == [f"accepted-checkpoint/{filename}"]


def test_gen_prompt_is_trigger_prefixed_for_every_persona_not_only_dop(command, tmp_path):
    """r24/r25 evidence: a LoRA identity is only ever invoked by naming its trigger word
    in the prompt text -- the train-first tester prompt carried none and rendered the
    base model's generic woman even though the LoRA loaded cleanly. Every gen-stage row
    (node 5's positive CLIPTextEncode) must open with "<trigger> <dop_class>, " ahead of
    the persona's own look/scene clause, for every persona (this fixture's `dop_enabled`
    sits at its default False, and `dop_class` is explicitly forced to "woman" to match
    both real personas' training.yaml)."""
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path, dop_class="woman")
    out = tmp_path / "gen-trigger"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
    )
    run = plan["stages"]["gen"]["runs"][0]
    m = load_json(out / run["manifest"])
    text_subs = [
        sub for sub in m["jobs"][0]["substitutions"]
        if sub["node_id"] == "5" and sub["field"] == "text"
    ]
    assert len(text_subs) == 1
    text = text_subs[0]["value"]
    assert text.startswith("creator002krea2 woman, ")
    assert not text.startswith("Photograph of")


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
    out = tmp_path / "all"
    # M2: stage-membership check, not a budget check -- default ledger falls back to
    # the live shared OPS ledger on this machine.
    plan = command.build_plan(
        "creator-002", "all", out, personas_root=personas, skip_pin_verify=True,
        accept_budget=True,
    )
    assert "gen" not in plan["stages"]


def test_grade_apply_rulings_and_gate_accept_gen(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path)
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
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-08T00:00:00Z"})
    filled = out / "filled.json"
    filled.write_text(json.dumps(template), "utf-8")
    applied = command.apply_rulings("creator-002", "gen", out / "plan.json", filled)
    assert Path(applied["rulings"]).is_file()

    document = command.command_gate("creator-002", "gen", out / "plan.json")
    assert document["rows"]


# ---------------------------------------------------------------------------
# F2: `detail` as its own STAGES entry -- always follows gen's own kept outputs
# ---------------------------------------------------------------------------


def test_build_plan_excludes_detail_and_video_from_stage_all(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    out = tmp_path / "all"
    # M2: stage-membership check, not a budget check -- see the note above.
    plan = command.build_plan(
        "creator-002", "all", out, personas_root=personas, skip_pin_verify=True,
        accept_budget=True,
    )
    assert "detail" not in plan["stages"]
    assert "video" not in plan["stages"]


def test_approved_gen_plan_requires_stage_detail(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    with pytest.raises(command.FigmentTrainError, match="--approved-gen-plan is only meaningful"):
        command.build_plan(
            "creator-002", "gen", tmp_path / "c", personas_root=personas,
            skip_pin_verify=True, approved_gen_plan=tmp_path / "nope",
        )


def test_detail_stage_requires_approved_gen_plan(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path)
    with pytest.raises(command.FigmentTrainError, match="detail requires --approved-gen-plan"):
        command.build_plan(
            "creator-002", "detail", tmp_path / "d", personas_root=personas,
            skip_pin_verify=True,
        )


def _approve_all_gen_images(command, creator_id: str, gen_out: Path) -> dict:
    grade = command.build_grade(creator_id, "gen", gen_out / "plan.json", skip_judge=True)
    template = load_json(Path(grade["rulings_template"]))
    for row in template["rulings"]:
        row.update(anchor_stage_test._axes(), decision="keep")
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:00:00Z"})
    filled = gen_out / "gen-filled.json"
    filled.write_text(json.dumps(template), "utf-8")
    return command.apply_rulings(creator_id, "gen", gen_out / "plan.json", filled)


def test_detail_stage_always_follows_gens_own_kept_outputs(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path)
    gen_out = tmp_path / "g"
    gen_plan = command.build_plan(
        "creator-002", "gen", gen_out, personas_root=personas, skip_pin_verify=True,
    )
    anchor_stage_test._fake_stage_outputs(gen_out, gen_plan, "gen")
    _approve_all_gen_images(command, "creator-002", gen_out)
    approved_count = len(load_json(gen_out / "grade" / "gen" / "approved-list.json")["images"])
    assert approved_count > 0

    detail_out = tmp_path / "d"
    detail_plan = command.build_plan(
        "creator-002", "detail", detail_out, personas_root=personas, skip_pin_verify=True,
        approved_gen_plan=gen_out,
    )
    assert "detail" in detail_plan["stages"]
    assert detail_plan["detail_source"]["approved_gen_plan"] == str(gen_out.resolve())
    assert len(detail_plan["detail_source"]["images"]) == approved_count

    run = detail_plan["stages"]["detail"]["runs"][0]
    manifest = load_json(detail_out / run["manifest"])
    model_files = [m["filename"] for m in manifest["models"]]
    assert any("mediapipe" in f.lower() for f in model_files)
    for f in model_files:
        assert not f.endswith(".pt") and not f.endswith(".pth")
    _banned_free(json.dumps(manifest))
    # Two denoise-variant jobs (0.15/0.27) per kept gen image -- "paired base/detail
    # rows" (AUDIT-2026-09-15.md F2's own test spec).
    assert len(manifest["jobs"]) == approved_count * 2

    anchor_stage_test._fake_stage_outputs(detail_out, detail_plan, "detail")
    detail_grade = command.build_grade(
        "creator-002", "detail", detail_out / "plan.json", skip_judge=True,
    )
    gate = load_json(Path(detail_grade["gate"]))
    assert gate["schema"] == "figment/gate@1"
    assert len(gate["rows"]) == approved_count * 2

    template = load_json(Path(detail_grade["rulings_template"]))
    for row in template["rulings"]:
        row.update(anchor_stage_test._axes(), decision="keep")
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:05:00Z"})
    filled = detail_out / "detail-filled.json"
    filled.write_text(json.dumps(template), "utf-8")
    applied = command.apply_rulings("creator-002", "detail", detail_out / "plan.json", filled)
    assert Path(applied["approved_list"]).is_file()


def test_detail_stage_rejects_stale_gen_source(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path)
    gen_out = tmp_path / "g"
    gen_plan = command.build_plan(
        "creator-002", "gen", gen_out, personas_root=personas, skip_pin_verify=True,
    )
    anchor_stage_test._fake_stage_outputs(gen_out, gen_plan, "gen")
    _approve_all_gen_images(command, "creator-002", gen_out)

    detail_out = tmp_path / "d"
    detail_plan = command.build_plan(
        "creator-002", "detail", detail_out, personas_root=personas, skip_pin_verify=True,
        approved_gen_plan=gen_out,
    )
    # Mutate the source gen image bytes after the detail plan was compiled -- the next
    # launch boundary must refuse rather than re-detail stale pixels.
    approved = load_json(gen_out / "grade" / "gen" / "approved-list.json")
    real_path = Path(next(
        row["path"] for row in approved["images"]
        if row["image_id"] == detail_plan["detail_source"]["images"][0]["image_id"]
    ))
    real_path.write_bytes(b"mutated pixels")
    # `validate_approved_gen_still` (reused verbatim, not duplicated) catches this at
    # the gen approval-lineage layer before detail's own sha comparison would even run
    # -- still fail-closed, just a step earlier in the same chain.
    with pytest.raises(command.FigmentTrainError, match="stale"):
        command._install_stage_config("detail", detail_plan, detail_out)


def test_real_approved_gen_lineage_compiles_nonpromotable_video_and_rejects_stale_evidence(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path)
    out = tmp_path / "approved-gen-video"
    plan = command.build_plan("creator-002", "gen", out, personas_root=personas, skip_pin_verify=True)
    anchor_stage_test._fake_stage_outputs(out, plan, "gen")
    grade = command.build_grade("creator-002", "gen", out / "plan.json", skip_judge=True)
    rulings = load_json(Path(grade["rulings_template"]))
    for row in rulings["rulings"]: row.update(anchor_stage_test._axes(), decision="keep")
    rulings.update({"decided_by": "operator-fixture", "decided_at": "2026-09-09T00:00:00Z"})
    filled = out / "gen-rulings.json"; filled.write_text(json.dumps(rulings), "utf-8")
    command.apply_rulings("creator-002", "gen", out / "plan.json", filled)
    image_id = load_json(out / "grade" / "gen" / "approved-list.json")["images"][0]["image_id"]
    authority = command.validate_approved_gen_still("creator-002", out / "plan.json", image_id)
    persona = out / "video-persona.json"
    persona.write_text(json.dumps({"id": "creator-002", "identity": {"look": {"age_stage": "an adult woman", "clothing": "a fully opaque shirt and jeans"}}}), "utf-8")
    image_relative = Path(authority["path"]).relative_to(out)
    manifest = video.build_manifest(root=out, persona_path=Path(persona.name), approved_gen_plan=Path("plan.json"), approved_gen_image_id=image_id, action="walk slowly toward the camera", out=image_relative.parent / "video-manifest.json", seed=77)
    assert manifest["not_promotable"] is True
    assert manifest["provenance"]["first_frame"]["approved_gen"]["image_id"] == image_id
    assert manifest["provenance"]["first_frame"]["frame"]["sha256"] == authority["sha256"]
    manifest_path = out / image_relative.parent / "video-manifest.json"
    uploads = pod_runner.expand_manifest_uploads(manifest, manifest_path)
    assert len(uploads) == 1
    assert uploads[0].local_path == Path(authority["path"]).resolve()
    source_persona = (command.ROOT / plan["assets"]["persona_dir"] / "persona.yaml").resolve()
    candidate_relative = Path(authority["path"]).relative_to(tmp_path).parent / "review-candidate.json"
    candidate = video.write_manifest(
        root=tmp_path,
        persona_path=source_persona.relative_to(tmp_path),
        approved_gen_plan=(out / "plan.json").relative_to(tmp_path),
        approved_gen_image_id=image_id,
        action="walk slowly toward the camera",
        out=candidate_relative,
        seed=77,
        mode=video.CANDIDATE_MODE,
    )
    candidate_path = tmp_path / candidate_relative
    candidate_uploads = pod_runner.expand_manifest_uploads(candidate, candidate_path)
    assert len(candidate_uploads) == 1
    assert candidate_uploads[0].local_path == Path(authority["path"]).resolve()
    job = candidate["jobs"][0]
    applied = pod_runner.apply_job(
        candidate["workflow"], job, pod_runner.manifest_seed_fields(candidate),
    )
    assert applied["9"]["inputs"]["filename_prefix"] == job["output_name"] == candidate["candidate_id"]
    assert job["output_name"].startswith(video.CANDIDATE_PREFIX)
    applied_sha = hashlib.sha256(json.dumps(applied, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()
    assert candidate["provenance"]["workflow"]["candidate_job_sha256"] == applied_sha
    dry = tmp_path / "candidate-dry-run"
    dry_run = subprocess.run(
        [sys.executable, str(POD_RUNNER), "run", "--manifest", str(candidate_path),
         "--out", str(dry), "--dry-run"], capture_output=True, text=True, timeout=30,
    )
    assert dry_run.returncode == 0, dry_run.stderr
    dry_receipt = load_json(dry / "run.json")
    assert dry_receipt["dry_run"] is True and dry_receipt["termination_verified"] is True
    assert len(dry_receipt["jobs"][0]["files"]) == 81

    executed = json.loads(json.dumps(applied))
    executed["56"]["inputs"]["is_changed"] = [authority["sha256"]]
    prompt = json.dumps(executed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    run_dir = tmp_path / "candidate-native-run"; run_dir.mkdir()
    files = []
    for index in range(1, 82):
        frame = run_dir / f"{job['output_name']}_{index:02d}.png"
        metadata = PngImagePlugin.PngInfo(); metadata.add_text("prompt", prompt)
        Image.new("RGB", (1280, 704), (index % 255, 70, 90)).save(frame, pnginfo=metadata)
        files.append({"path": frame.name, "bytes": frame.stat().st_size})
    run_path = run_dir / "run.json"
    run_path.write_text(json.dumps({
        "schema": "figment/runpod-run@1", "dry_run": False,
        "pod_id": "synthetic-real-lineage-fixture", "termination_verified": True,
        "placement_attempts": [{"termination_verified": True}],
        "jobs": [{"job": 1, "output_name": job["output_name"], "seed": job["seed"], "files": files}],
    }), "utf-8")
    video_assembly.assemble_frames(
        root=tmp_path, manifest_path=candidate_relative,
        run_receipt_path=run_path.relative_to(tmp_path), output_dir=Path("candidate-native-assembly"),
    )
    video_assembly.frames.extract_frames(
        root=tmp_path, video_path=Path("candidate-native-assembly/candidate.mp4"),
        output_dir=Path("candidate-native-samples"),
    )
    prepared = subprocess.run(
        [sys.executable, str(VIDEO_REVIEW), "prepare", "--root", str(tmp_path),
         "--candidate-manifest", str(candidate_relative),
         "--run-receipt", str(run_path.relative_to(tmp_path)),
         "--assembly-receipt", "candidate-native-assembly/frame-assembly.json",
         "--extraction-receipt", "candidate-native-samples/frame-extraction.json"],
        capture_output=True, text=True, timeout=90,
    )
    assert prepared.returncode == 0, prepared.stderr
    review_dir = video_review._review_directory(candidate_path, candidate["candidate_id"])
    evaluation = load_json(review_dir / "evaluation-inputs.json")
    assert evaluation["schema"] == video_review.SCHEMA
    assert evaluation["candidate_id"] == candidate["candidate_id"]
    assert evaluation["subject"]["workflow"]["png_prompt_graphs_verified"] == 81
    plan_path = out / "plan.json"; original = plan_path.read_text("utf-8"); plan_path.write_text(original + " ", "utf-8")
    with pytest.raises(video.VideoManifestError, match="approved gen lineage is invalid"):
        video.build_manifest(
            root=tmp_path,
            persona_path=source_persona.relative_to(tmp_path),
            approved_gen_plan=plan_path.relative_to(tmp_path),
            approved_gen_image_id=image_id,
            action="walk slowly toward the camera",
            out=Path(authority["path"]).relative_to(tmp_path).parent / "stale-candidate.json",
            mode=video.CANDIDATE_MODE,
        )
    with pytest.raises(command.FigmentTrainError, match="stale"):
        command.validate_approved_gen_still("creator-002", plan_path, image_id)


def test_nested_diagnostic_frame_expands_from_manifest_directory(tmp_path):
    nested = tmp_path / "nested"; nested.mkdir()
    persona = tmp_path / "persona.json"
    persona.write_text(json.dumps({"id": "creator-002", "identity": {"look": {"age_stage": "an adult woman", "clothing": "a fully opaque shirt and jeans"}}}), "utf-8")
    frame = nested / "frame.png"; frame.write_bytes(b"nested clothed adult diagnostic frame")
    receipt = nested / "first-frame.json"
    receipt.write_text(json.dumps({"schema": video.FRAME_SCHEMA, "creator": "creator-002", "first_frame": {"path": "nested/frame.png", "bytes": frame.stat().st_size, "sha256": hashlib.sha256(frame.read_bytes()).hexdigest()}}), "utf-8")
    manifest_path = nested / "video-manifest.json"
    manifest = video.build_manifest(root=tmp_path, persona_path=Path(persona.name), first_frame_receipt=Path("nested/first-frame.json"), action="walk slowly toward the camera", out=Path("nested/video-manifest.json"), seed=77)

    uploads = pod_runner.expand_manifest_uploads(manifest, manifest_path)
    assert manifest["uploads"][0]["files"] == [frame.name]
    assert len(uploads) == 1
    assert uploads[0].local_path == frame.resolve()


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
    _prepare_accepted_checkpoint(
        command, personas, tmp_path,
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


def test_creator001_plus_style_lora_flag_wires_node_40_creator001_alone_does_not_f3(command):
    """F3/M3: `personas/creator-001-skin` (a persona fork differing ONLY by
    `style_lora`/`style_lora_strength`) is deleted -- a style LoRA is a gen-PLAN
    argument (`_resolve_gen_style_lora`, the `plan --stage gen --style-lora
    --style-lora-strength` flags), never a persona fork that forces a second,
    un-comparable ~$36 train just to A/B one field. creator-001's own real persona is
    untouched and still plans with no style LoRA at all when the flag is absent."""
    pins = json.loads(PINS_PATH.read_text("utf-8"))

    base_persona, base_training, base_pins = command._load_inputs(
        "creator-001", REAL_PERSONAS,
    )
    assert base_training.get("style_lora") is None

    # creator-001 + the flag: `_resolve_gen_style_lora` is the exact function
    # `build_plan` calls before any manifest is built.
    overridden = command._resolve_gen_style_lora(
        base_training, base_pins, style_lora="inline-skin", style_lora_strength=0.8,
    )
    assert overridden["style_lora"] == "inline-skin"
    assert overridden["style_lora_strength"] == 0.8
    # The override never mutates the persona's own loaded training dict.
    assert base_training.get("style_lora") is None

    skin_workflow = command._gen_workflow(overridden, base_pins)
    assert "40" in skin_workflow
    assert skin_workflow["40"]["inputs"]["strength_model"] == 0.8

    gen_training = {**overridden, "chosen_checkpoint_step": overridden["steps"]}
    gen_manifest = command._gen_manifest(base_persona, gen_training, base_pins)
    style_pin = pins["pins"]["style_loras"]["inline-skin"]["model"]
    assert style_pin in gen_manifest["models"]
    style_subs = [
        sub for sub in gen_manifest["jobs"][0]["substitutions"] if sub["node_id"] == "40"
    ]
    assert style_subs and style_subs[0]["value"] == style_pin["filename"]

    # creator-001 ALONE, no flag: `_resolve_gen_style_lora` is a no-op, node 40 absent.
    unchanged = command._resolve_gen_style_lora(
        base_training, base_pins, style_lora=None, style_lora_strength=None,
    )
    assert unchanged is base_training
    base_workflow = command._gen_workflow(unchanged, base_pins)
    assert "40" not in base_workflow
    assert base_workflow["8"]["inputs"]["model"] == ["4", 0]


def test_resolve_gen_style_lora_validates_key_and_strength(command):
    pins = json.loads(PINS_PATH.read_text("utf-8"))
    training = {"style_lora": None, "style_lora_strength": 0.8}

    with pytest.raises(command.FigmentTrainError, match="requires --style-lora"):
        command._resolve_gen_style_lora(
            training, pins, style_lora=None, style_lora_strength=0.5,
        )
    with pytest.raises(command.FigmentTrainError, match="unknown --style-lora key"):
        command._resolve_gen_style_lora(
            training, pins, style_lora="not-a-real-key", style_lora_strength=None,
        )
    with pytest.raises(command.FigmentTrainError, match="--style-lora-strength must be"):
        command._resolve_gen_style_lora(
            training, pins, style_lora="inline-skin", style_lora_strength=1.51,
        )
    with pytest.raises(command.FigmentTrainError, match="--style-lora-strength must be"):
        command._resolve_gen_style_lora(
            training, pins, style_lora="inline-skin", style_lora_strength=0,
        )
    # Omitted strength falls back to the persona's own style_lora_strength default.
    resolved = command._resolve_gen_style_lora(
        training, pins, style_lora="gokay-realism", style_lora_strength=None,
    )
    assert resolved["style_lora_strength"] == 0.8


def test_resolve_gen_style_lora_validates_a_persona_default_not_only_the_flag(command):
    """MINOR 10 (REVIEW): `training.yaml`'s OWN `style_lora`/`style_lora_strength`
    (a persona default, no `--style-lora` flag at all) must pass the SAME pins-key and
    <=1.5-strength validation the flag path already enforces -- previously an unknown
    persona-declared key or an out-of-range persona strength reached `_gen_workflow`/
    `_gen_manifest` unvalidated."""
    pins = json.loads(PINS_PATH.read_text("utf-8"))

    with pytest.raises(command.FigmentTrainError, match="unknown training.style_lora key"):
        command._resolve_gen_style_lora(
            {"style_lora": "not-a-real-key", "style_lora_strength": 0.8}, pins,
            style_lora=None, style_lora_strength=None,
        )
    with pytest.raises(command.FigmentTrainError, match="training.style_lora_strength must be"):
        command._resolve_gen_style_lora(
            {"style_lora": "inline-skin", "style_lora_strength": 15}, pins,
            style_lora=None, style_lora_strength=None,
        )
    with pytest.raises(command.FigmentTrainError, match="training.style_lora_strength must be"):
        command._resolve_gen_style_lora(
            {"style_lora": "inline-skin", "style_lora_strength": 0}, pins,
            style_lora=None, style_lora_strength=None,
        )
    # A valid persona default still resolves exactly as the flag path would.
    resolved = command._resolve_gen_style_lora(
        {"style_lora": "inline-skin", "style_lora_strength": 0.8}, pins,
        style_lora=None, style_lora_strength=None,
    )
    assert resolved["style_lora"] == "inline-skin" and resolved["style_lora_strength"] == 0.8


def test_build_plan_style_lora_flag_refused_off_stage_gen(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    with pytest.raises(command.FigmentTrainError, match="only meaningful for --stage gen"):
        command.build_plan(
            "creator-002", "dataset", tmp_path / "d", personas_root=personas,
            skip_pin_verify=True, style_lora="inline-skin",
        )


def test_build_plan_gen_with_style_lora_flag_records_and_wires_it(command, tmp_path):
    """M3 end-to-end: the plan-time flag (not a persona field) wires node 40 and is
    recorded on the gen stage's own plan.json entry, distinguishable from a persona
    default."""
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path)
    out = tmp_path / "flagged-gen"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
        style_lora="gokay-realism", style_lora_strength=0.42,
    )
    assert plan["training"]["style_lora"] == "gokay-realism"
    assert plan["training"]["style_lora_strength"] == 0.42
    assert plan["stages"]["gen"]["style_lora"] == {
        "key": "gokay-realism", "strength": 0.42, "source": "flag",
    }
    run = plan["stages"]["gen"]["runs"][0]
    manifest = load_json(out / run["manifest"])
    style_subs = [
        sub for sub in manifest["jobs"][0]["substitutions"] if sub["node_id"] == "40"
    ]
    assert style_subs and style_subs[0]["value"] == "krea2_realism_lora.safetensors"

    # The persona's own persona.yaml training block is never mutated by the flag.
    persona_training = load_json(personas / "creator-002" / "persona.yaml")["training"]
    assert persona_training.get("style_lora") is None


def test_verify_pins_preflight_includes_style_loras_for_gen_and_detail_when_set(
    command, monkeypatch,
):
    """m8: STAGE_PIN_PROFILES itself never lists "style_loras" (it is opt-in per
    persona/plan, unlike every other fixed stage profile) -- `_verify_pins_preflight`
    adds it for `gen`/`detail` only when `training["style_lora"]` names one."""
    calls = []

    class FakeVerifyPins:
        class VerifyPinsError(Exception):
            pass

        @staticmethod
        def verify_pins(pins, *, stages):
            calls.append(list(stages))
            return {}

    monkeypatch.setattr(command, "_verify_pins_module", lambda: FakeVerifyPins)
    pins = {}

    command._verify_pins_preflight(pins, ["gen"], {"style_lora": None})
    assert "style_loras" not in calls[-1]

    command._verify_pins_preflight(pins, ["gen"], {"style_lora": "inline-skin"})
    assert "style_loras" in calls[-1]

    command._verify_pins_preflight(pins, ["detail"], {"style_lora": "gokay-realism"})
    assert "style_loras" in calls[-1]

    command._verify_pins_preflight(pins, ["dataset"], {"style_lora": "inline-skin"})
    assert "style_loras" not in calls[-1], "style_loras is only meaningful for gen/detail"


# ---------------------------------------------------------------------------
# The detail-only mode (r25 cause #2): --detail-images, job count, dry-run
# ---------------------------------------------------------------------------


def test_detail_manifest_job_count_and_dry_run(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path)

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


def test_detail_only_prompt_is_trigger_prefixed(command, tmp_path):
    """Same fix as the gen-stage rows: the detail-only workflow's node 5 CLIPTextEncode
    (previously left at its static default with no trigger at all) must also open with
    "<trigger> <dop_class>, " ahead of the workflow's own default descriptive text."""
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002", steps=3000)
    _prepare_accepted_checkpoint(command, personas, tmp_path, dop_class="woman")

    source_dir = tmp_path / "existing-cells"
    source_dir.mkdir()
    (source_dir / "cell-01.png").write_bytes(b"not a real png, just a fixture file")

    out = tmp_path / "detail-trigger"
    command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
        detail_images=str(source_dir / "*.png"),
    )
    detail_workflow = load_json(out / "train" / "workflows" / "krea2_detail_only_api.json")
    text = detail_workflow["5"]["inputs"]["text"]
    assert text.startswith("creator002krea2 woman, ")
    assert not text.startswith("Photograph of an adult woman,")


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
    _prepare_accepted_checkpoint(command, personas, tmp_path)
    with pytest.raises(command.FigmentTrainError, match="matched no files"):
        command.build_plan(
            "creator-002", "gen", tmp_path / "y", personas_root=personas,
            skip_pin_verify=True, detail_images=str(tmp_path / "nope-*.png"),
        )

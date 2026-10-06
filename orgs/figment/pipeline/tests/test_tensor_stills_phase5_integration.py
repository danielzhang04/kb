"""Canonical offline module09 chain; fixture media never proves model execution.

Shared driver activation follows the phase4 checkpoint. These fixtures deliberately
use existing passport/tester approval writers rather than fabricating their output.
"""
import hashlib
import importlib.util
import json
import sys
import subprocess
from pathlib import Path

import pytest
from PIL import Image

HERE = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


edit_tests = load("stills_registered_fixture", HERE / "tests/test_tensor_edit_integration.py")
ft = edit_tests.ft
passport = edit_tests.passport


def write(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document), encoding="utf-8")


def bind(path):
    return {"path": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


@pytest.fixture
def selected_checkpoint(tmp_path, monkeypatch):
    registered = edit_tests.registered.__wrapped__(tmp_path, monkeypatch)
    personas, persona_dir, source, _, request = registered
    training_path = persona_dir / "training.yaml"
    training = ft._read_json(training_path)
    text = "One adult person wearing a plain grey jacket in daylight."
    training["training"]["tensor_tester_prompt"] = {"text": text,
        "sha256": hashlib.sha256(text.encode()).hexdigest(), "decided_by": "fixture",
        "decided_at": "2026-10-05T12:00:00Z", "fixture": True}
    write(training_path, training)
    ladder = tmp_path / "ladder"
    ladder.mkdir()
    for step in range(250, 3001, 250):
        filename = ft._checkpoint_name("creator-003", step) if step != 3000 else "creator-003.safetensors"
        (ladder / filename).write_bytes(f"synthetic offline checkpoint {step}\n".encode().ljust(ft.IMPORTED_CHECKPOINT_MIN_BYTES, b"0"))
    tester = tmp_path / "tester"
    plan = ft.build_plan("creator-003", "tester", tester, personas_root=personas,
        skip_pin_verify=True, import_checkpoints=ladder, ledger_dir=tmp_path / "ledger")
    plan["fixture"] = True
    write(tester / "plan.json", plan)
    passport._fake_stage_outputs(tester, plan, "tester")
    run, = plan["stages"]["tester"]["runs"]
    manifest = ft._read_json(tester / run["manifest"])
    write(tester / run["out"] / "run.json", {"error": None, "dry_run": False,
        "termination_verified": True, "fixture": True,
        "jobs": [{"output_name": job["output_name"], "files": [{"bytes": 10}]} for job in manifest["jobs"]]})
    write(tester / "stage.json", {"schema": "figment/train-stage@1", "creator": "creator-003",
        "plan_sha256": ft._sha256(tester / "plan.json"), "status": "complete:tester",
        "completed_stages": ["tester"], "runs": {run["manifest"]: {"status": "complete",
            "checkpoint_inputs": ft._tester_checkpoint_inputs(plan, tester, run)}}})
    grade = ft.build_grade("creator-003", "tester", tester / "plan.json", skip_judge=True)
    rulings = ft._read_json(Path(grade["rulings_template"]))
    rulings.update(decided_by="fixture", decided_at="2026-10-05T12:00:00Z")
    chosen = next(job["output_name"] for job in manifest["jobs"] if any(
        sub.get("value") == "creator-003_000000750.safetensors" for sub in job["substitutions"]))
    for row in rulings["rulings"]:
        row.update(passport._axes(), decision="keep" if row["image_id"] == chosen else "cull", why="synthetic pipeline fixture")
    filled = tester / "filled.json"
    write(filled, rulings)
    ft.apply_rulings("creator-003", "tester", tester / "plan.json", filled, checkpoint_step=750)
    # Migration boundary: both real historical authorities predate optional face.
    before_persona, before_training, _ = ft._load_inputs("creator-003", personas)
    before_persona["_persona_path"] = str(persona_dir / "persona.yaml")
    before = ft._validated_accepted_checkpoint(before_persona, before_training)
    document = ft._read_json(persona_dir / "persona.yaml")
    document["identity"]["look"]["face"] = "an oval adult face"
    write(persona_dir / "persona.yaml", document)
    after_persona, after_training, _ = ft._load_inputs("creator-003", personas)
    after_persona["_persona_path"] = str(persona_dir / "persona.yaml")
    assert ft._validated_accepted_checkpoint(after_persona, after_training) == before
    ft._validate_registered_passport("creator-003", after_persona, request["identity"]["source_plan"], request["identity"]["image_id"])
    return {"personas": personas, "persona_dir": persona_dir, "passport_plan": source,
            "passport_selection": {k: request["identity"][k] for k in ("source_plan", "image_id")},
            "tester": tester, "ledger": tmp_path / "ledger"}


@pytest.fixture
def scene_request(selected_checkpoint, tmp_path):
    context = selected_checkpoint
    root = tmp_path / "scene-evidence"
    root.mkdir()
    intake = ft._tensor_stills_module().prompt_intake
    adapter = ft._canonical_intake_adapter("creator-003", context["personas"])
    binding = intake.canonical_passport_binding(creator="creator-003", selection=context["passport_selection"], passport_adapter=adapter)
    request = {"schema": "figment/tensor-stills-request@1", "creator": "creator-003", "fixture": True,
               "passport": context["passport_selection"], "scenes": []}
    for index, framing in ((0, "full"), (3, "close-up"), (7, "full")):
        image = root / f"scene{index}.png"
        Image.new("RGB", (64, 96), "navy").save(image)
        raw = {key: "" for key in intake.SECTIONS}
        raw.update(shot_subject="one adult person", age_appearance={key: "" for key in intake.DESCRIPTORS},
                   clothing="A plain grey jacket.", environment=f"An ordinary garden number {index}.")
        draft = intake.extract_fixture_draft(root, photo_path=image.name, creator="creator-003", passport=binding,
            aspects=["clothing", "environment"], framing=framing, runner=intake.FixtureRunner(json.dumps(raw)), passport_adapter=adapter)
        approval = intake.approve_fixture_prompt(root, draft, decided_by="fixture:reviewer", decided_at="2026-10-05T12:00:00Z",
            acknowledged_notes=draft["review_notes"], passport_adapter=adapter)
        draft_path, approval_path = root / f"draft{index}.json", root / f"approval{index}.json"
        write(draft_path, draft)
        write(approval_path, approval)
        request["scenes"].append({"scene_index": index, "draft": bind(draft_path), "approval": bind(approval_path)})
    path = root / "request.json"
    write(path, request)
    return {**context, "request": path, "evidence_root": root}


def gen_plan(context, tmp_path):
    root = tmp_path / "stills-plan"
    plan = ft.build_plan("creator-003", "gen", root, personas_root=context["personas"],
        stills_request=context["request"], skip_pin_verify=True, ledger_dir=context["ledger"], accept_budget=True)
    return root, plan


def test_canonical_migration_and_grouped_plan(scene_request, tmp_path):
    root, plan = gen_plan(scene_request, tmp_path)
    assert plan["fixture"] is True and len(plan["stages"]["gen"]["runs"]) == 2
    for run in plan["stages"]["gen"]["runs"]:
        manifest = ft._read_json(root / run["manifest"])
        assert all(value.endswith(".safetensors") for upload in manifest["uploads"] for value in upload["files"])
        assert "scene-evidence" not in json.dumps(manifest)
    ft._validate_gen_source_inputs(plan, root)
    with pytest.raises(ft.FigmentTrainError, match="dry-run only"):
        ft._install_stage_config("gen", plan, root)


def fake_saved_outputs(root, plan):
    ledger = Path(plan["ledger_dir"])
    ledger.mkdir(exist_ok=True)
    lines = ["model\tstep\tusd"]
    for index, run in enumerate(plan["stages"]["gen"]["runs"]):
        manifest_path = root / run["manifest"]
        manifest = ft._read_json(manifest_path)
        graph = ft._read_json(manifest_path.parent / manifest["workflow"])
        output = root / run["out"]
        output.mkdir(parents=True, exist_ok=True)
        jobs = []
        for job in manifest["jobs"]:
            prompt_id = "fixture-" + job["output_name"]
            files = []
            for spec in job["output_contract"]["outputs"]:
                image = output / (job["output_name"] + "--" + spec["role"] + ".png")
                Image.new("RGB", (80, 96), {"base": "grey", "upscaled": "navy", "enhanced": "green"}[spec["role"]]).save(image)
                files.append({"path": image.name, "bytes": image.stat().st_size, "sha256": ft._sha256(image),
                    "role": spec["role"], "node_id": spec["node_id"], "media_type": "image/png", "prompt_id": prompt_id,
                    "remote": {"filename": image.name, "subfolder": "", "type": "output"}})
            effective = ft._pod_runner_module().apply_job(graph, job, tuple(manifest["seed_fields"]))
            jobs.append({"output_name": job["output_name"], "prompt_id": prompt_id, "files": list(reversed(files)),
                         "effective_workflow_sha256": ft._lineage_module().canonical_sha256(effective)})
        pod = f"fixture-stills-{index}"
        write(output / "run.json", {"error": None, "dry_run": False, "fixture": True,
            "termination_verified": True, "ledger_day": "2026-10-05", "pod_id": pod,
            "estimated_actual_usd": 0, "jobs": jobs})
        lines.append(f"{ft._pod_runner_module().gpu_model_label(manifest['gpu']['type'])}\tpod-create {pod}\t0.000000")
    (ledger / "figment-2026-10-05.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_cli_dryrun_all_roles_rulings_and_approved_gen_to_edit(scene_request, tmp_path, monkeypatch):
    root = tmp_path / "cli-stills"
    result = subprocess.run([sys.executable, str(HERE / "figment_train.py"), "plan", "--creator", "creator-003",
        "--stage", "gen", "--stills-request", str(scene_request["request"]), "--personas-root", str(scene_request["personas"]),
        "--out", str(root), "--ledger-dir", str(scene_request["ledger"]), "--skip-pin-verify", "--accept-budget"],
        cwd=tmp_path, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    plan = ft._read_json(root / "plan.json")
    assert ft.command_pipeline("creator-003", plan_path=root / "plan.json", dry_run=True)["status"] == "dry-run:gen"
    for index, run in enumerate(plan["stages"]["gen"]["runs"]):
        dry = subprocess.run([sys.executable, str(ft.POD_RUNNER), "run", "--manifest", str(root / run["manifest"]),
            "--out", str(root / f"dryrun-{index}"), "--dry-run"], capture_output=True, text=True)
        assert dry.returncode == 0, dry.stdout + dry.stderr
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: pytest.fail("unexpected live dispatch"))
    fake_saved_outputs(root, plan)
    monkeypatch.setattr(ft, "_run_identity_gate", lambda plan, anchors, images, *a, **k:
                        passport._gate_for(images, {1: "age", 2: "unscorable", 3: "failed"}))
    grade = ft.build_grade("creator-003", "gen", root / "plan.json", skip_judge=True)
    state = ft._stage_state(root / "stage.json", "creator-003", root / "plan.json")
    state["completed_stages"] = ["gen"]
    write(root / "stage.json", state)
    assert ft.command_pipeline("creator-003", plan_path=root / "plan.json", dry_run=True)["status"] == "GATE gen"
    rows = ft._read_json(root / "grade/gen/grading-manifest.json")["images"]
    assert len(rows) == 8 and len({r["image_id"] for r in rows}) == 8
    assert {r["role"] for r in rows} == {"base", "upscaled", "enhanced"}
    page = Path(grade["page"]).read_text(encoding="utf-8")
    assert "Canonical fixture intake" in page and "close-up / enhanced" in page
    assert "FIXTURE ONLY — testing evidence; not production approval or model-quality proof." in page
    assert all(label in page for label in ("held for age", "held unscorable", "failed gate"))
    rulings = ft._read_json(Path(grade["rulings_template"]))
    rulings.update(decided_by="fixture", decided_at="2026-10-05T12:00:00Z")
    for index, row in enumerate(rulings["rulings"]):
        row.update(passport._axes(), decision="keep" if index in (0, 4, 7) else "cull", why="synthetic fixture")
        if "age_ruling" in row: row["age_ruling"] = "release"
    filled = root / "filled.json"
    write(filled, rulings)
    ft.apply_rulings("creator-003", "gen", root / "plan.json", filled)
    age_log = scene_request["persona_dir"] / "calibration/age-holds.jsonl"
    first_log = age_log.read_bytes()
    assert len(first_log.splitlines()) == 1
    ft.apply_rulings("creator-003", "gen", root / "plan.json", filled)
    assert age_log.read_bytes() == first_log
    frozen_artifacts = {p: p.read_bytes() for p in (age_log, root / "grade/gen/approval-lineage.json",
                                                  root / "grade/gen/approved-list.json", root / "grade/gen/rulings.json")}
    for mode in ("missing-age", "changed-decision"):
        altered = json.loads(json.dumps(rulings))
        if mode == "missing-age": altered["rulings"][1].pop("age_ruling")
        else: altered["rulings"][0]["decision"] = "cull"
        bad = root / (mode + ".json")
        write(bad, altered)
        with pytest.raises(ft.FigmentTrainError):
            ft.apply_rulings("creator-003", "gen", root / "plan.json", bad)
        assert all(p.read_bytes() == data for p, data in frozen_artifacts.items())
    chosen = rows[0]["image_id"]  # Explicitly kept BASE variant is legitimate authority.
    approved = ft.validate_approved_gen_still("creator-003", root / "plan.json", chosen)
    assert approved["path"].endswith("--base.png")
    assert ft.command_pipeline("creator-003", plan_path=root / "plan.json", dry_run=True)["status"] == "complete:gen"
    text = "Preserve the clothed base scene and use the approved identity image."
    edit_request = {"schema": "figment/tensor-edit-request@1", "creator": "creator-003", "fixture": True,
        "job_type": "still-touch-up", "base": {"path": approved["path"], "sha256": approved["sha256"]},
        "identity": {"kind": "approved-gen", "source_plan": str(root / "plan.json"), "image_id": rows[7]["image_id"]},
        "prompt": {"text": text, "sha256": hashlib.sha256(text.encode()).hexdigest(),
                   "decided_by": "fixture", "decided_at": "2026-10-05T12:00:00Z"}}
    edit_path = root / "edit-request.json"
    write(edit_path, edit_request)
    ft.build_plan("creator-003", "edit", tmp_path / "edit", personas_root=scene_request["personas"],
        edit_request=edit_path, skip_pin_verify=True, ledger_dir=scene_request["ledger"], accept_budget=True)
    persona_path = scene_request["persona_dir"] / "persona.yaml"
    original = ft._read_json(persona_path)
    changed = json.loads(json.dumps(original))
    changed["identity"]["look"]["face"] = "new adult face words"
    write(persona_path, changed)
    with pytest.raises(ft.FigmentTrainError):
        ft.validate_approved_gen_still("creator-003", root / "plan.json", chosen)
    write(persona_path, original)


@pytest.mark.parametrize("mutation", ["jpeg", "duplicate-role", "graph", "face", "photo", "checkpoint", "coherent-prompt"])
def test_saved_scene_and_output_mutation_refused(scene_request, tmp_path, mutation):
    root, plan = gen_plan(scene_request, tmp_path)
    fake_saved_outputs(root, plan)
    run = plan["stages"]["gen"]["runs"][0]
    receipt_path = root / run["out"] / "run.json"
    receipt = ft._read_json(receipt_path)
    if mutation == "jpeg":
        record = receipt["jobs"][0]["files"][0]
        image = root / run["out"] / record["path"]
        Image.new("RGB", (80, 96), "green").save(image, format="JPEG")
        record.update(bytes=image.stat().st_size, sha256=ft._sha256(image))
        write(receipt_path, receipt)
    elif mutation == "duplicate-role":
        receipt["jobs"][0]["files"][1] = dict(receipt["jobs"][0]["files"][0])
        write(receipt_path, receipt)
    elif mutation == "graph":
        receipt["jobs"][0]["effective_workflow_sha256"] = "0" * 64
        write(receipt_path, receipt)
    elif mutation == "face":
        path = scene_request["persona_dir"] / "persona.yaml"
        doc = ft._read_json(path)
        doc["identity"]["look"]["face"] = "changed adult face"
        write(path, doc)
    elif mutation == "photo":
        Image.new("RGB", (64, 96), "red").save(scene_request["evidence_root"] / "scene0.png")
    elif mutation == "checkpoint":
        path = root / "train/runs/accepted-checkpoint/creator-003_000000750.safetensors"
        path.write_bytes(path.read_bytes() + b"tamper")
    else:
        path = root / run["manifest"]
        doc = ft._read_json(path)
        doc["jobs"][0]["substitutions"][0]["value"] = "A substituted scene."
        write(path, doc)
        run["sha256"] = ft._sha256(path)
        write(root / "plan.json", plan)
    with pytest.raises((ft.FigmentTrainError, ValueError)):
        ft.build_grade("creator-003", "gen", root / "plan.json", skip_judge=True)


def replacement_draft(context):
    intake = ft._tensor_stills_module().prompt_intake
    adapter = ft._canonical_intake_adapter("creator-003", context["personas"])
    old = ft._read_json(context["evidence_root"] / "draft0.json")
    raw = old["raw"]
    raw["environment"] = "A different approved-looking garden scene."
    return intake.extract_fixture_draft(context["evidence_root"], photo_path=old["photo"]["path"], creator="creator-003",
        passport=old["passport"], aspects=old["aspects"], framing=old["framing"],
        runner=intake.FixtureRunner(json.dumps(raw)), passport_adapter=adapter)


def test_preview_refuses_self_consistent_draft_swap_after_frozen_validation(scene_request, tmp_path, monkeypatch):
    original = ft._validate_tensor_stills_inputs
    replacement = replacement_draft(scene_request)
    calls = []
    def swap(plan, root, **kwargs):
        result = original(plan, root, **kwargs)
        calls.append(1)
        if len(calls) == 1:
            write(scene_request["evidence_root"] / "draft0.json", replacement)
        return result
    monkeypatch.setattr(ft, "_validate_tensor_stills_inputs", swap)
    with pytest.raises(ft.FigmentTrainError, match="preview draft changed"):
        gen_plan(scene_request, tmp_path)
    assert not (tmp_path / "stills-plan/intake/scene-0.html").exists()


def test_coherent_new_draft_approval_request_cannot_replace_frozen_scene(scene_request, tmp_path):
    root, plan = gen_plan(scene_request, tmp_path)
    intake = ft._tensor_stills_module().prompt_intake
    draft = replacement_draft(scene_request)
    approval = intake.approve_fixture_prompt(scene_request["evidence_root"], draft, decided_by="fixture:reviewer",
        decided_at="2026-10-05T13:00:00Z", acknowledged_notes=draft["review_notes"],
        passport_adapter=ft._canonical_intake_adapter("creator-003", scene_request["personas"]))
    write(scene_request["evidence_root"] / "draft0.json", draft)
    write(scene_request["evidence_root"] / "approval0.json", approval)
    request = ft._read_json(scene_request["request"])
    request["scenes"][0]["draft"] = bind(scene_request["evidence_root"] / "draft0.json")
    request["scenes"][0]["approval"] = bind(scene_request["evidence_root"] / "approval0.json")
    write(scene_request["request"], request)
    with pytest.raises(ft.FigmentTrainError, match="source inputs"):
        ft._validate_gen_source_inputs(plan, root)

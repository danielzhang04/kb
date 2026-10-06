"""Real edit planner/grade/approval chain over labelled synthetic image fixtures."""
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ft = load("edit_core_test", HERE / "figment_train.py")
passport = load("edit_passport_helpers", HERE / "tests/test_tensor_passport.py")


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def pinned(path):
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


@pytest.fixture
def registered(tmp_path, monkeypatch):
    personas = tmp_path / "personas"
    persona_dir = passport._pre_passport_persona(personas)
    monkeypatch.setattr(ft._score_cells_module(), "score", lambda *a, **k: None)
    monkeypatch.setattr(ft, "_run_identity_gate", lambda plan, anchors, images, *a, **k:
        passport._gate_for(images, {}))
    monkeypatch.setattr(ft._verify_pins_module(), "head_etag",
                        lambda *a, **k: pytest.fail("fixture attempted network"))
    source = tmp_path / "original-passport"
    plan = ft.build_plan("creator-003", "anchor", source, personas_root=personas,
                         skip_pin_verify=True, ledger_dir=tmp_path / "ledger")
    plan["fixture"] = True
    write(source / "plan.json", plan)
    passport._fake_stage_outputs(source, plan, "anchor")
    first_run = plan["stages"]["anchor"]["runs"][0]
    first_job = ft._read_json(source / first_run["manifest"])["jobs"][0]
    labelled = Image.new("RGB", (96,128), "grey")
    ImageDraw.Draw(labelled).text((8,8), "IDENTITY", fill="black")
    labelled.save(source / first_run["out"] / (first_job["output_name"] + ".png"))
    grade = ft.build_grade("creator-003", "anchor", source / "plan.json", skip_judge=True)
    rulings = ft._read_json(Path(grade["rulings_template"]))
    rulings.update(decided_by="fixture", decided_at="2026-10-05T00:00:00Z")
    for index, row in enumerate(rulings["rulings"]):
        row.update(passport._axes(), decision="keep" if index == 0 else "cull", why="synthetic fixture")
    ruling_path = source / "fixture-rulings.json"
    write(ruling_path, rulings)
    ft.apply_rulings("creator-003", "anchor", source / "plan.json", ruling_path)
    base = tmp_path / "BASE.png"
    image = Image.new("RGB", (96, 128), "navy")
    ImageDraw.Draw(image).text((8,8), "BASE", fill="white")
    image.save(base)
    text = "Keep image1 scene and clothed body; use image2 facial identity."
    request = {"schema": "figment/tensor-edit-request@1", "creator": "creator-003",
        "fixture": True, "job_type": "still-touch-up", "base": pinned(base),
        "identity": {"kind": "passport", "source_plan": str(source / "plan.json"),
                     "image_id": rulings["rulings"][0]["image_id"]},
        "prompt": {"text":text,"sha256":hashlib.sha256(text.encode()).hexdigest(),
                   "decided_by":"fixture","decided_at":"2026-10-05T00:00:00Z"}}
    path = tmp_path / "edit-request.json"
    write(path, request)
    return personas, persona_dir, source, path, request


def edit_plan(registered, tmp_path):
    personas, _, _, request, _ = registered
    root = tmp_path / "edit-plan"
    plan = ft.build_plan("creator-003", "edit", root, personas_root=personas,
                         edit_request=request, skip_pin_verify=True, ledger_dir=tmp_path / "ledger")
    return root, plan


@pytest.mark.parametrize("job_type", ["still-touch-up", "start-frame-head-swap"])
def test_standalone_passport_edit_plan_dry_run_grade_apply_and_receipt(registered, tmp_path, monkeypatch, job_type):
    if job_type == "start-frame-head-swap":
        document = registered[4]
        clip = tmp_path / "driving-fixture.mp4"
        clip.write_bytes(b"synthetic fixture clip; no extracted-motion proof")
        record = {**pinned(clip), "bytes": clip.stat().st_size}
        receipt = tmp_path / "frame-extraction.json"
        write(receipt, {"schema":"figment/video-frame-extraction@1", "video_before":record,"video_after":record,
            "frames":[{**document["base"],"bytes":Path(document["base"]["path"]).stat().st_size,"index":0,"label":"first"}]})
        document["job_type"] = job_type
        document["frame_source"] = {"clip":pinned(clip),"extraction_receipt":pinned(receipt),"frame_index":0}
        write(registered[3], document)
    root, plan = edit_plan(registered, tmp_path)
    assert list(plan["stages"]) == ["edit"] and not plan["configs"]
    assert "tensor_body" not in plan["training"] and "tensor_tester_prompt" not in plan["training"]
    run, = plan["stages"]["edit"]["runs"]
    manifest_path = root / run["manifest"]
    result = ft.subprocess.run([sys.executable, str(ft.POD_RUNNER), "run", "--manifest", str(manifest_path),
        "--out", str(root / "dry-run"), "--dry-run"], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    monkeypatch.setattr(ft.subprocess, "run", lambda *a, **k: pytest.fail("fixture launched process"))
    with pytest.raises(ft.FigmentTrainError, match="dry-run only"):
        ft.run_planned_stage("creator-003", "edit", root / "plan.json")
    passport._fake_stage_outputs(root, plan, "edit")
    grade = ft.build_grade("creator-003", "edit", root / "plan.json", skip_judge=True)
    preview = (root / "grade/edit/edit-inputs.html").read_text("utf-8")
    assert "BASE / image1 / node76" in preview and "IDENTITY / image2 / node169" in preview
    assert plan["edit_inputs"]["prompt"]["text"] in preview
    ruling = ft._read_json(Path(grade["rulings_template"]))
    ruling.update(decided_by="fixture", decided_at="2026-10-05T00:00:00Z")
    for row in ruling["rulings"]:
        row.update(passport._axes(), decision="keep", why="synthetic plumbing proof only")
    filled = root / "filled.json"
    write(filled, ruling)
    ft.apply_rulings("creator-003", "edit", root / "plan.json", filled)
    ft.apply_rulings("creator-003", "edit", root / "plan.json", filled)
    accepted = ft.validate_approved_edit_still("creator-003", root / "plan.json", ruling["rulings"][0]["image_id"])
    assert accepted["fixture"] is True
    with pytest.raises(ft.FigmentTrainError, match="driving-clip"):
        ft.validate_approved_edit_still("creator-003", root / "plan.json", ruling["rulings"][0]["image_id"],
                                      driving_clip_sha256="a"*64)
    delivered = ft._build_deliverable("creator-003", root, root/"gen", root/"detail", root/"video")
    assert delivered["fixture"] and delivered["images"][0]["job_type"] == job_type
    state = ft._stage_state(root / "stage.json", "creator-003", root / "plan.json")
    state["completed_stages"] = ["edit"]
    write(root / "stage.json", state)
    complete = ft.command_pipeline("creator-003", plan_path=root / "plan.json")
    assert complete["status"] == "complete:edit" and "video" not in complete["message"]
    if job_type == "start-frame-head-swap":
        accepted = ft.validate_approved_edit_still("creator-003", root/"plan.json", ruling["rulings"][0]["image_id"],
            driving_clip_sha256=plan["edit_inputs"]["frame_source"]["clip"]["sha256"])
        assert accepted["fixture"]


@pytest.mark.parametrize("target", ["base", "identity", "request", "original-ruling", "staged-base", "workflow"])
@pytest.mark.parametrize("boundary", ["launch", "grade", "review"])
def test_edit_inputs_revalidated_before_every_authority_boundary(registered, tmp_path, target, boundary):
    root, plan = edit_plan(registered, tmp_path)
    if target in ("base", "identity"):
        changed = Path(plan["edit_inputs"][target]["path"])
    elif target == "request":
        changed = registered[3]
    elif target == "original-ruling":
        changed = registered[2] / "grade/anchor/rulings.json"
    elif target == "staged-base":
        changed = root / plan["assets"]["edit_images"]["base"]
    else:
        changed = root / "train/workflows/tensor_edit_m07_api.json"
    changed.write_bytes(changed.read_bytes() + b" ")
    with pytest.raises(ft.FigmentTrainError):
        if boundary == "launch":
            ft._install_stage_config("edit", plan, root)
        elif boundary == "grade":
            ft.build_grade("creator-003", "edit", root / "plan.json", skip_judge=True)
        else:
            ft._current_review_subject(plan, root, "edit", {"images": []})


def test_historical_passport_survives_training_and_current_threshold_drift(registered, tmp_path, monkeypatch):
    personas, persona_dir, source, request, _ = registered
    training = ft._read_json(persona_dir / "training.yaml")
    training["training"]["tensor_tester_prompt"] = {"text":"new scene","sha256":hashlib.sha256(b"new scene").hexdigest(),
        "decided_by":"fixture","decided_at":"2026-10-05T00:00:00Z","fixture":True}
    write(persona_dir / "training.yaml", training)
    # New thresholds govern new grading. Original registration keeps its frozen threshold evidence.
    original = ft._lineage_module().review_subject
    def changed_threshold(*args, **kwargs):
        value = original(*args, **kwargs)
        value["thresholds"] = {"name":"gate.yaml","bytes":123,"sha256":"a"*64}
        return value
    monkeypatch.setattr(ft._lineage_module(), "review_subject", changed_threshold)
    root, plan = edit_plan(registered, tmp_path)
    assert plan["edit_inputs"]["identity_authority"]["schema"] == "figment/registered-passport-authority@1"


def test_bad_request_writes_no_plan_artifacts(registered, tmp_path):
    personas, _, _, request, document = registered
    document["prompt"]["text"] += " unapproved mutation"
    write(request, document)
    root = tmp_path / "refused"
    with pytest.raises(ft.FigmentTrainError, match="approved hash"):
        ft.build_plan("creator-003", "edit", root, personas_root=personas, edit_request=request, skip_pin_verify=True)
    assert not root.exists()


def test_profile_sequences_preserve_clean_and_standalone_edit(registered, tmp_path):
    assert ft.TENSOR_STAGES == ("anchor","dataset","smoke","train","tester","gen","edit","video")
    assert "edit" not in ft.CLEAN_STAGES and "detail" not in ft.TENSOR_STAGES
    root, plan = edit_plan(registered, tmp_path)
    result = ft.command_pipeline("creator-003", plan_path=root/"plan.json", dry_run=True)
    assert "edit" in result["status"]


def test_accepted_edit_refuses_plan_swap_between_approval_and_input_resolution(registered, tmp_path, monkeypatch):
    test_standalone_passport_edit_plan_dry_run_grade_apply_and_receipt(registered, tmp_path, monkeypatch, "still-touch-up")
    root = tmp_path / "edit-plan"
    image_id = ft._read_json(root/"grade/edit/approved-list.json")["images"][0]["image_id"]
    original = ft._validate_approved_still
    def swapped(*args, **kwargs):
        value = original(*args, **kwargs)
        if args[3] == "edit":
            plan = ft._read_json(root/"plan.json")
            plan["edit_inputs"]["job_type"] = "start-frame-head-swap"
            write(root/"plan.json", plan)
        return value
    monkeypatch.setattr(ft, "_validate_approved_still", swapped)
    with pytest.raises(ft.FigmentTrainError, match="changed while validating"):
        ft.validate_approved_edit_still("creator-003", root/"plan.json", image_id)


def test_accepted_standalone_edit_ignores_unused_dataset_inputs_but_binds_pod_settings(registered, tmp_path, monkeypatch):
    test_standalone_passport_edit_plan_dry_run_grade_apply_and_receipt(registered,tmp_path,monkeypatch,"still-touch-up")
    root=tmp_path/"edit-plan"
    image_id=ft._read_json(root/"grade/edit/approved-list.json")["images"][0]["image_id"]
    path=registered[1]/"training.yaml"
    training=ft._read_json(path)
    training["training"]["tensor_body"]={"fixture":True,"description":"unconsumed fixture body"}
    training["training"]["tensor_tester_prompt"]={"fixture":True,"text":"unconsumed scene"}
    write(path,training)
    assert ft.validate_approved_edit_still("creator-003",root/"plan.json",image_id)["fixture"]
    training["training"]["price_ceiling_usd_per_hour"]=1.99
    write(path,training)
    with pytest.raises(ft.FigmentTrainError,match="pod settings"):
        ft.validate_approved_edit_still("creator-003",root/"plan.json",image_id)


@pytest.mark.parametrize("group", ["passed", "age", "unscorable", "failed"])
def test_edit_groups_and_age_hold_require_explicit_ruling(registered, tmp_path, monkeypatch, group):
    root, plan = edit_plan(registered, tmp_path)
    passport._fake_stage_outputs(root, plan, "edit")
    monkeypatch.setattr(ft, "_run_identity_gate", lambda plan, anchors, images, *a, **k:
        passport._gate_for(images, {0:group}))
    grade = ft.build_grade("creator-003", "edit", root/"plan.json", skip_judge=True)
    gate = ft._read_json(Path(grade["gate"]))
    assert gate["rows"][0]["group"] == group
    ruling = ft._read_json(Path(grade["rulings_template"]))
    ruling.update(decided_by="fixture",decided_at="2026-10-05T00:00:00Z")
    for row in ruling["rulings"]:
        row.update(passport._axes(), decision="cull", why="synthetic gate exercise")
    filled=root/"cull.json"
    write(filled,ruling)
    if group == "age":
        with pytest.raises(ft.FigmentTrainError,match="age_ruling"):
            ft.apply_rulings("creator-003","edit",root/"plan.json",filled)
        ruling["rulings"][0]["age_ruling"]="cull"
        write(filled,ruling)
    ft.apply_rulings("creator-003","edit",root/"plan.json",filled)
    ft.apply_rulings("creator-003","edit",root/"plan.json",filled)
    assert not (root/"grade/edit/approved-list.json").exists()


@pytest.mark.parametrize("swap", [False, True])
def test_approved_gen_adapter_positive_and_metadata_snapshot_swap(registered,tmp_path,monkeypatch,swap):
    # Existing test_approved_gen_still covers the validator itself; this isolates its
    # returned authority -> edit adapter, including the metadata reread race.
    _, persona_dir, _, request_path, request = registered
    source=tmp_path/"approved-gen-plan.json"
    approval=tmp_path/"gen-approval.json"
    listing=tmp_path/"gen-list.json"
    for path in (source,approval,listing):
        write(path,{"fixture":True})
    identity=persona_dir/"anchors/passport.png"
    proof={"image_id":"gen-fixture","path":str(identity),"bytes":identity.stat().st_size,
        "sha256":ft._sha256(identity),"source_plan":pinned(source),
        "approval_lineage":pinned(approval),"approved_list":pinned(listing)}
    calls=[]
    def validated(*args):
        calls.append(args)
        if swap:
            write(source,{"fixture":False})
        return copy.deepcopy(proof)
    monkeypatch.setattr(ft,"validate_approved_gen_still",validated)
    request["identity"]={"kind":"approved-gen","source_plan":str(source),"image_id":"gen-fixture"}
    write(request_path,request)
    persona=ft._read_json(persona_dir/"persona.yaml")
    persona["_persona_path"]=str(persona_dir/"persona.yaml")
    if swap:
        with pytest.raises(ft.FigmentTrainError,match="gen authority changed"):
            ft._resolve_edit_request("creator-003",persona,request_path)
    else:
        result=ft._resolve_edit_request("creator-003",persona,request_path)
        assert result["identity_authority"]["fixture"] is True and len(calls)==2


def test_simultaneous_registered_and_staged_identity_mutation_cannot_redefine_passport(registered,tmp_path):
    root,plan=edit_plan(registered,tmp_path)
    paths={Path(plan["edit_inputs"]["identity"]["path"]),
           root/plan["assets"]["edit_images"]["identity"],root/plan["assets"]["anchors"][0]}
    for path in paths:
        Image.new("RGB",(96,128),"red").save(path)
    with pytest.raises(ft.FigmentTrainError):
        ft.build_grade("creator-003","edit",root/"plan.json",skip_judge=True)


def test_unscorable_age_overlap_requires_age_ruling_and_logs_once(registered,tmp_path,monkeypatch):
    root,plan=edit_plan(registered,tmp_path)
    passport._fake_stage_outputs(root,plan,"edit")
    def overlapping(plan,anchors,images,*args,**kwargs):
        gate=passport._gate_for(images,{0:"unscorable"})
        gate["rows"][0].update(age_hold=True,age_value=18.0)
        return gate
    monkeypatch.setattr(ft,"_run_identity_gate",overlapping)
    grade=ft.build_grade("creator-003","edit",root/"plan.json",skip_judge=True)
    ruling=ft._read_json(Path(grade["rulings_template"]))
    ruling.update(decided_by="fixture",decided_at="2026-10-05T00:00:00Z")
    ruling["rulings"][0].update(passport._axes(),decision="cull",why="fixture")
    filled=root/"overlap-ruling.json"
    write(filled,ruling)
    with pytest.raises(ft.FigmentTrainError,match="age_ruling"):
        ft.apply_rulings("creator-003","edit",root/"plan.json",filled)
    ruling["rulings"][0]["age_ruling"]="cull"
    write(filled,ruling)
    for _ in range(2):
        ft.apply_rulings("creator-003","edit",root/"plan.json",filled)
    logged=(registered[1]/"calibration/age-holds.jsonl").read_text().splitlines()
    assert len(logged)==1

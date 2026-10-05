"""Tensor phase-2 integration boundaries; all generated media are synthetic fixtures."""
import copy
import hashlib
import importlib.util
import json
import sys
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

ft = load("phase2_core", HERE / "figment_train.py")
tc = ft._training_config_module()

def approved_text(text):
    return {"text": text, "sha256": hashlib.sha256(text.encode()).hexdigest(),
            "decided_by": "fixture", "decided_at": "2026-10-05T00:00:00Z", "fixture": True}

@pytest.fixture
def inputs(tmp_path):
    for name in ("passport.png", "body.png"):
        Image.new("RGB", (64, 64), "grey").save(tmp_path / name)
    body = tmp_path / "body.png"
    description = "an ordinary adult build in a grey outfit"
    training = tc.validate_training({"recipe_profile": "tensor", "tensor_body": {
        "path": str(body), "sha256": ft._sha256(body), "description": description,
        "description_sha256": hashlib.sha256(description.encode()).hexdigest(),
        "faceless": True, "clothed": True, "fixture": True,
        "decided_by": "fixture", "decided_at": "2026-10-05T00:00:00Z"},
        "tensor_tester_prompt": approved_text("An adult woman in a grey outfit, photographed indoors.")}, "creator-003")
    persona = {"id": "creator-003", "_persona_path": str(tmp_path / "persona.yaml"),
        "training": training, "identity": {"references": [str(tmp_path / "passport.png")],
        "look": {"hair": "long blonde hair", "eyes": "grey eyes"}}}
    return persona, training, ft._read_json(ft.PINS_PATH)

@pytest.mark.parametrize("key,value", [("steps",2000),("save_every",500),("dop_enabled",True),
    ("dataset_replicates",2),("dataset_source","klein-multiref"),("caption_mode","single_word")])
def test_tensor_rejects_recipe_override(key, value):
    with pytest.raises(tc.TrainingConfigError, match=key):
        tc.validate_training({"recipe_profile":"tensor",key:value}, "creator-003")

def test_tensor_identity_is_artifact_name_not_textual_trigger():
    tensor = tc.validate_training({}, "creator-003")
    clean = tc.validate_training({"recipe_profile":"clean","dop_enabled":True}, "creator-002")
    assert tensor["artifact_name"] == "creator-003"
    assert tensor["trigger"] is None
    assert tc.validate_training({"trigger": None}, "creator-003")["trigger"] is None
    assert ft._compose_triggered_prompt(tensor, "scene") == "scene"
    assert ft._compose_triggered_prompt(clean, "scene").startswith("creator002krea2")
    assert "artifact_name" not in clean
    config = ft._render_training_config(ft._artifact_name(tensor),3000,250)
    assert config["config"]["name"] == "creator-003"
    process = config["config"]["process"][0]
    assert "trigger_word" not in process
    assert process["train"]["diff_output_preservation"] is False
    assert ft._render_module().check_module_11(config) == []

def test_tensor_stage_inputs_are_independent(inputs):
    persona, training, pins = inputs
    no_prompt = {k:v for k,v in training.items() if k != "tensor_tester_prompt"}
    assert ft._tensor_body_input(persona,no_prompt)[0].name == "body.png"
    no_body = {k:v for k,v in training.items() if k != "tensor_body"}
    assert ft._tester_workflow(persona,no_body)["408"]["inputs"]["text"]
    with pytest.raises(ft.FigmentTrainError, match="approved scene"):
        ft._tensor_approved_prompt(no_prompt)
    training["tensor_body"]["description"] += " changed"
    with pytest.raises(ft.FigmentTrainError, match="body reference"):
        ft._tensor_body_input(persona,training)

def test_tensor_dataset_exact_fanout_and_parity(inputs):
    persona, training, pins = inputs
    prompts, workflow = ft._tensor_dataset_assets(persona,training,pins)
    manifest = ft._tensor_dataset_manifest(persona,training,pins,prompts,workflow)
    assert len(manifest["jobs"]) == 30
    outputs = [j["substitutions"][0]["value"][0] for j in manifest["jobs"]]
    assert outputs.count("791") == outputs.count("776") == 15
    assert all(j["expected_images"] == 1 for j in manifest["jobs"])
    assert "952" not in workflow
    assert ft._tensor_parity_module().check_dataset(workflow,manifest,persona["identity"]["look"],training["tensor_body"]["description"]) == []

def test_tensor_tester_ladder_and_parity(inputs):
    persona, training, pins = inputs
    manifest = ft._tester_manifest(persona,training,pins)
    names = [j["substitutions"][0]["value"] for j in manifest["jobs"]]
    assert len(names) == len(set(names)) == 12
    assert names[0] == "creator-003_000000250.safetensors"
    assert names[-1] == "creator-003.safetensors"
    assert ft._tensor_parity_module().check_tester(manifest["workflow"],manifest,prompt=ft._tensor_approved_prompt(training)) == []

def test_tensor_caption_formats_raw_body(inputs,tmp_path):
    persona, training, pins = inputs
    builder = ft._build_set_module()
    source = tmp_path / "images"
    source.mkdir()
    Image.new("RGB",(64,64),"grey").save(source / "cell.png")
    builder.build_training_set(approved_cells=None,source_dir=source,caption_mode="qwen3vl",
        out_dir=tmp_path/"set", trigger="creator-003",recipe_profile="tensor",
        job_runner=lambda job:["A clothed adult woman."])
    assert (tmp_path/"set/01.txt").read_text().strip() == "A clothed adult woman."

def test_caption_pending_never_dispatches_and_is_resumable(inputs,tmp_path,monkeypatch):
    persona,training,pins=inputs
    root=tmp_path/"plan"
    image=Path(persona["identity"]["references"][0])
    def fake_plan(creator,stem,images,plan_root,**kwargs):
        manifest=plan_root/"train/runs/caption.json"
        manifest.parent.mkdir(parents=True,exist_ok=True)
        manifest.write_text("{}")
        dest=manifest.parent/"_uploads"/creator/images[0].name
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(images[0].read_bytes())
        return {"manifest":"train/runs/caption.json","sha256":ft._sha256(manifest),"out":"caption-out"}
    monkeypatch.setattr(ft,"plan_qwen3vl_caption",fake_plan)
    monkeypatch.setattr(ft.subprocess,"run",lambda *a,**k:pytest.fail("hidden dispatch"))
    runner=ft._tensor_caption_job_runner("creator-003",training,root,tmp_path/"ledger")
    for _ in range(2):
        with pytest.raises(ft.FigmentTrainError,match="no pod launched"):
            runner({"images":[str(image)]})
    assert (root/"train/caption-plan.json").is_file()
    image.write_bytes(b"changed")
    with pytest.raises(ft.FigmentTrainError,match="inputs changed"):
        runner({"images":[str(image)]})

def test_unscorable_age_hold_still_requires_explicit_ruling(tmp_path):
    image=tmp_path/"image.png"
    image.write_bytes(b"fixture")
    plan={"creator":"creator-003"}
    gate={"rows":[{"image_id":"x","group":"unscorable","age_hold":True}]}
    normalized={"rulings":[{"image_id":"x","decision":"keep"}],"decided_by":"fixture","decided_at":"now"}
    with pytest.raises(ft.FigmentTrainError,match="age_ruling"):
        ft._age_hold_rows(plan,"dataset",normalized,gate,[{"image_id":"x","path":str(image)}])

def test_complete_fixture_dataset_and_tester_plan(inputs,tmp_path,monkeypatch):
    persona,training,pins=inputs
    persona_dir = tmp_path / "creator-003"
    persona_dir.mkdir()
    persona["_persona_path"] = str(persona_dir / "persona.yaml")
    Path(persona["_persona_path"]).write_text(json.dumps(persona))
    monkeypatch.setattr(ft,"_load_inputs",lambda *a:(persona,training,pins))
    monkeypatch.setattr(ft._identity_gate_module(),"load_thresholds",lambda p:{})
    monkeypatch.setattr(ft,"_budget_preflight",lambda *a,**k:{"fixture":True,"table":"fixture budget"})
    out=tmp_path/"dataset-plan"
    plan=ft.build_plan("creator-003","dataset",out,personas_root=tmp_path,skip_pin_verify=True,ledger_dir=tmp_path/"ledger")
    runs=plan["stages"]["dataset"]["runs"]
    assert [len(ft._read_json(out/run["manifest"])["jobs"]) for run in runs]==[10,10,10]
    assert all(run["workflow_sha256"] for run in runs)
    assert "dataset_fullbody_workflow" not in plan["assets"]
    assert (out/plan["assets"]["tensor_body"]).is_file()
    tester=ft.build_plan("creator-003","tester",tmp_path/"tester-plan",personas_root=tmp_path,skip_pin_verify=True,ledger_dir=tmp_path/"ledger")
    assert len(tester["stages"]["tester"]["runs"])==1
    for root, value in ((out,plan),(tmp_path/"tester-plan",tester)):
        for stage_data in value["stages"].values():
            for planned in stage_data["runs"]:
                result=ft.subprocess.run([sys.executable,str(ft.POD_RUNNER),"run",
                    "--manifest",str(root/planned["manifest"]),"--out",str(root/"dry-run"/Path(planned["manifest"]).stem),
                    "--dry-run"],capture_output=True,text=True,cwd=HERE.parents[2])
                assert result.returncode==0,result.stdout+result.stderr


def test_real_caption_planning_does_not_call_network(inputs,tmp_path,monkeypatch):
    persona,training,_=inputs
    verifier=ft._verify_pins_module()
    monkeypatch.setattr(verifier,"head_etag",lambda *a,**k:pytest.fail("offline planner contacted network"))
    monkeypatch.setattr(ft.subprocess,"run",lambda *a,**k:pytest.fail("hidden process dispatch"))
    image=Path(persona["identity"]["references"][0])
    runner=ft._tensor_caption_job_runner("creator-003",training,tmp_path/"caption-plan",tmp_path/"ledger")
    with pytest.raises(ft.FigmentTrainError,match="no pod launched"):
        runner({"images":[str(image)]})

def test_apply_dataset_rulings_plans_then_resumes_captions(inputs,tmp_path,monkeypatch):
    helpers=load("phase2_fixture_helpers",HERE/"tests/test_figment_train.py")
    personas=tmp_path/"personas"
    path=helpers._synthetic_persona(personas,creator_id="creator-003",anchor_names=("passport.png",),exemplars=[])
    document=json.loads(path.read_text())
    training=copy.deepcopy(inputs[1])
    training.pop("artifact_name")
    training["trigger"]=None
    document["training"]=training
    path.write_text(json.dumps(document))
    out=tmp_path/"plan"
    ledger=tmp_path/"ledger"
    ledger.mkdir()
    monkeypatch.setattr(ft,"_budget_preflight",lambda *a,**k:{"table":"fixture budget"})
    monkeypatch.setattr(ft._verify_pins_module(),"head_etag",lambda *a,**k:pytest.fail("offline network"))
    plan=ft.build_plan("creator-003","dataset",out,personas_root=personas,skip_pin_verify=True,ledger_dir=ledger)
    for run in plan["stages"]["dataset"]["runs"]:
        target=out/run["out"]
        target.mkdir(parents=True)
        for job in ft._read_json(out/run["manifest"])["jobs"]:
            Image.new("RGB",(64,64),"grey").save(target/(job["output_name"]+".png"))
    monkeypatch.setattr(ft._score_cells_module(),"score",lambda *a,**k:None)
    monkeypatch.setattr(ft,"_run_identity_gate",lambda plan,anchors,images,*a,**k:{"schema":"figment/gate@1","rows":[
        {"image_id":row["image_id"],"pass":True,"group":"passed","reasons":[]} for row in images]})
    grade=ft.build_grade("creator-003","dataset",out/"plan.json",skip_judge=True)
    ruling=ft._read_json(Path(grade["rulings_template"]))
    ruling.update(decided_by="fixture",decided_at="2026-10-05T00:00:00Z")
    for row in ruling["rulings"]:
        row.update(decision="keep",identity="pass",realism="pass",hands="pass",lighting="pass",
            adult_read="pass",garment_integrity="pass",real_person_resemblance="clear")
    filled=out/"filled.json"
    filled.write_text(json.dumps(ruling))
    monkeypatch.setattr(ft.subprocess,"run",lambda *a,**k:pytest.fail("apply_rulings launched a process"))
    with pytest.raises(ft.FigmentTrainError,match="no pod launched"):
        ft.apply_rulings("creator-003","dataset",out/"plan.json",filled)
    assert not (out/"grade/dataset/approval-lineage.json").exists()
    assert not (out/"train/runs/creator-003-tensor-dataset/_dataset.ready").exists()
    caption_plan=ft._read_json(out/"train/caption-plan.json")
    run=caption_plan["run"]
    run_out=out/run["out"]
    run_out.mkdir(parents=True)
    captions={row["name"]:"A clothed adult woman." for row in caption_plan["images"]}
    (run_out/"captions.json").write_text(json.dumps(captions))
    receipt={"error":None,"dry_run":False,"pod_id":"fixture-caption","ledger_day":"2026-10-05",
        "termination_verified":True,"estimated_actual_usd":0.01,
        "placement_attempts":[{"pod_id":"fixture-caption","estimated_actual_usd":0.01,"termination_verified":True}],
        "artifacts":[{"remote":"captions.json","bytes":(run_out/"captions.json").stat().st_size}]}
    (run_out/"run.json").write_text(json.dumps(receipt))
    manifest=ft._read_json(out/run["manifest"])
    model=ft._pod_runner_module().gpu_model_label(manifest["gpu"]["type"])
    (ledger/"figment-2026-10-05.tsv").write_text(f"model\tstep\tusd\n{model}\tpod-create fixture-caption\t0.010000\n")
    result=ft.apply_rulings("creator-003","dataset",out/"plan.json",filled)
    assert Path(result["approved_list"]).is_file()
    dataset=out/"train/runs/creator-003-tensor-dataset"
    assert (dataset/"_dataset.ready").is_file()
    assert all(p.read_text().strip()=="A clothed adult woman." for p in dataset.glob("*.txt"))


def test_tensor_rejects_explicit_text_trigger():
    with pytest.raises(tc.TrainingConfigError,match="no textual trigger"):
        tc.validate_training({"trigger":"creator003krea2"},"creator-003")


def test_tensor_board_displays_traits_and_overlapping_age_reason(tmp_path):
    row={"image_id":"x","path":str(tmp_path/"x.png")}
    gate={"rows":[{"image_id":"x","group":"unscorable","age_hold":True,
        "age_reasons":["missing <age>"],"reasons":["no face"],"judge":{
            "traits":{"lips":80,"brows":75,"skin_pattern":None,"hair":90,"jaw":85},
            "apparent_age_candidate":None}}],"thresholds":{"age_floor_years":20}}
    board=ft._grading_html("creator-003","dataset",[],[row],None,gate)
    for text in ("lips 80","brows 75","skin_pattern n/a","hair 90","jaw 85",
                 "Age ruling required: missing &lt;age&gt;","judge age n/a","floor 20"):
        assert text in board


def test_caption_failed_receipt_requires_explicit_bounded_replan(inputs,tmp_path,monkeypatch):
    helpers=load("phase2_caption_failure_helpers",HERE/"tests/test_figment_train.py")
    persona,training,_=inputs
    root=tmp_path/"plan"
    image=Path(persona["identity"]["references"][0])
    monkeypatch.setattr(ft.subprocess,"run",lambda *a,**k:pytest.fail("hidden dispatch"))
    monkeypatch.setattr(ft,"_git_head_sha",lambda:"fixture-commit")
    job={"images":[str(image)]}
    runner=ft._tensor_caption_job_runner("creator-003",training,root,tmp_path/"ledger")
    with pytest.raises(ft.FigmentTrainError,match="no pod launched"):
        runner(job)
    planned=ft._read_json(root/"train/caption-plan.json")["run"]
    run_out=root/planned["out"]
    helpers._write_verified_teardown_job_failure_caption_run(run_out)
    with pytest.raises(ft.FigmentTrainError):
        runner(job)
    retry=ft._tensor_caption_job_runner("creator-003",training,root,tmp_path/"ledger",
                                      retry_after_fix_reason="fixture dependency fixed")
    with pytest.raises(ft.FigmentTrainError,match="no pod launched"):
        retry(job)
    assert run_out.with_name(run_out.name+".failed-1").is_dir()
    assert not run_out.exists()
    helpers._write_verified_teardown_job_failure_caption_run(run_out)
    broken=ft._read_json(run_out/"run.json")
    broken["termination_verified"]=False
    (run_out/"run.json").write_text(json.dumps(broken))
    with pytest.raises(ft.FigmentTrainError,match="teardown|termination"):
        retry(job)


def test_unjudged_tensor_board_shows_unavailable_traits(tmp_path):
    board=ft._grading_html("creator-003","dataset",[],[{"image_id":"x","path":str(tmp_path/"x.png")}],None,
        {"rows":[{"image_id":"x","group":"unscorable","age_hold":True,"judge":None}]})
    assert "lips n/a" in board and "jaw n/a" in board


@pytest.fixture
def bound_tensor_plan(inputs, tmp_path, monkeypatch):
    helpers = load("phase2_bound_helpers", HERE / "tests/test_figment_train.py")
    personas = tmp_path / "personas"
    path = helpers._synthetic_persona(personas, creator_id="creator-003", anchor_names=("passport.png",), exemplars=[])
    document = json.loads(path.read_text(encoding="utf-8"))
    training = copy.deepcopy(inputs[1])
    training.pop("artifact_name")
    training["trigger"] = None
    for key in ("tensor_body", "tensor_tester_prompt"):
        training[key]["fixture"] = False  # simulated approved metadata; no run is dispatched
    document["training"] = training
    path.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setattr(ft, "_budget_preflight", lambda *a, **k: {"table": "fixture budget"})
    out = tmp_path / "bound-plan"
    plan = ft.build_plan("creator-003", "dataset", out, personas_root=personas,
                         skip_pin_verify=True, ledger_dir=tmp_path / "ledger")
    return plan, out, path, personas


@pytest.mark.parametrize("target", ["source", "staged"])
@pytest.mark.parametrize("boundary", ["launch", "grade", "review"])
def test_tensor_passport_mutation_fails_before_launch_grade_or_review(bound_tensor_plan, target, boundary, monkeypatch):
    plan, out, _, _ = bound_tensor_plan
    binding = plan["assets"]["tensor_passport"]
    ft._validate_tensor_passport_inputs(plan, out)
    path = ft._resolve_config_path(binding["source"]) if target == "source" else out / binding["staged"]
    Image.new("RGB", (64, 64), "red").save(path)
    monkeypatch.setattr(ft.subprocess, "run", lambda *a, **k: pytest.fail("unexpected process"))
    monkeypatch.setattr(ft, "_run_identity_gate", lambda *a, **k: pytest.fail("changed passport reached scoring"))
    with pytest.raises(ft.FigmentTrainError, match="passport.*changed"):
        if boundary == "launch":
            ft._install_stage_config("dataset", plan, out)
        elif boundary == "grade":
            ft.build_grade("creator-003", "dataset", out / "plan.json", skip_judge=True)
        else:
            ft._current_review_subject(plan, out, "dataset", {"images": []})


def test_tensor_passport_both_copies_changed_cannot_redefine_baseline(bound_tensor_plan):
    plan, out, _, _ = bound_tensor_plan
    binding = plan["assets"]["tensor_passport"]
    for path in (ft._resolve_config_path(binding["source"]), out / binding["staged"]):
        Image.new("RGB", (64, 64), "red").save(path)
    with pytest.raises(ft.FigmentTrainError, match="passport.*changed"):
        ft._validate_tensor_passport_inputs(plan, out)


def test_tensor_passport_selection_path_is_bound_even_with_same_bytes(bound_tensor_plan):
    plan, out, persona_path, _ = bound_tensor_plan
    document = json.loads(persona_path.read_text(encoding="utf-8"))
    other = persona_path.parent / "anchors/other.png"
    other.write_bytes(ft._resolve_config_path(plan["assets"]["tensor_passport"]["source"]).read_bytes())
    document["identity"]["references"] = ["anchors/other.png"]
    persona_path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ft.FigmentTrainError, match="passport.*selection changed"):
        ft._validate_tensor_passport_inputs(plan, out)


def test_tensor_body_passport_collision_is_case_insensitive(inputs, tmp_path):
    persona, training, pins = inputs
    body = tmp_path / "other/PASSPORT.PNG"
    body.parent.mkdir()
    Image.new("RGB", (64, 64), "red").save(body)
    training["tensor_body"].update(path=str(body), sha256=ft._sha256(body))
    with pytest.raises(ft.FigmentTrainError, match="basenames must differ"):
        ft._tensor_dataset_assets(persona, training, pins)


def test_tensor_train_first_tester_ignores_only_plan_metadata_and_still_checks_inputs(bound_tensor_plan, tmp_path):
    _, _, persona_path, personas = bound_tensor_plan
    dataset = tmp_path / "prebuilt"
    dataset.mkdir()
    rows = []
    source = persona_path.parent / "anchors/passport.png"
    for i in range(1, 21):
        image = dataset / f"{i:02d}.png"
        image.write_bytes(source.read_bytes())
        caption = dataset / f"{i:02d}.txt"
        caption.write_text("An adult woman in an opaque outfit.\n", encoding="utf-8")
        rows.append({"image": image.name, "caption_file": caption.name, "sha256": ft._sha256(image)})
    (dataset / "dataset_manifest.json").write_text(json.dumps({"count": 20, "caption_mode": "provided", "files": rows}), encoding="utf-8")
    (dataset / "_dataset.ready").write_text("", encoding="utf-8")
    ft.accept_train_first_dataset("creator-003", dataset, decided_by="operator-fixture", decided_at="2026-10-05T00:00:00Z")
    root = tmp_path / "train-first"
    plan = ft.build_train_first_plan("creator-003", dataset, root, personas_root=personas,
                                    skip_pin_verify=True, ledger_dir=tmp_path / "ledger")
    assert plan["training"]["dataset_dir"] == str(dataset.resolve())
    ft._install_stage_config("tester", plan, root)
    document = json.loads(persona_path.read_text(encoding="utf-8"))
    document["training"]["tensor_tester_prompt"] = {**approved_text("Changed approved fixture scene."), "fixture": False}
    persona_path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ft.FigmentTrainError, match="tester inputs changed"):
        ft._install_stage_config("tester", plan, root)


def test_tensor_imported_training_uses_its_own_training_authority(inputs, tmp_path):
    _, training, _ = inputs
    original = copy.deepcopy(training)
    raw = copy.deepcopy(original)
    raw.pop("artifact_name")
    raw["trigger"] = None
    config = tmp_path / "imported-training.json"
    config.write_text(json.dumps({"training": raw}), encoding="utf-8")
    plan = {"creator": "creator-003", "training": original,
            "imported_training_config": {"path": str(config), "sha256": ft._sha256(config)}}
    current = copy.deepcopy(original)
    current.pop("tensor_body")  # current body does not retroactively change imported training
    ft._validate_tensor_training_inputs(plan, current, "tester")
    raw["tensor_body"]["description"] += " altered"
    config.write_text(json.dumps({"training": raw}), encoding="utf-8")
    with pytest.raises(ft.FigmentTrainError, match="imported training inputs changed"):
        ft._validate_tensor_training_inputs(plan, current, "tester")

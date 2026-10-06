"""Real copied-tree tensor writers over labelled synthetic execution/scorer evidence.

No authority validator is mocked. This is fixture setup, never runtime proof.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
from types import SimpleNamespace

import pytest
from PIL import Image

PIPELINE = Path(__file__).resolve().parents[1]
CREATOR = "creator-003"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


producer = load("tensor_observer_clean_fixture_helpers", PIPELINE / "tests/test_gen_source_read_producers.py")
restore_module_aliases = producer.restore_module_aliases
EXTRA_PIPELINE = (
    "tensor_parity.py", "tensor_stills_parity.py", "tensor_stills.py", "prompt_intake.py", "tensor_edit.py",
    "video/frame_extract.py", "expand/workflows/tensor_passport_m03_api.json",
    "expand/workflows/tensor_dataset_m10_api.json", "train/workflows/tensor_tester_m11_api.json",
    "train/workflows/tensor_stills_m09_api.json",
)
PACKAGE_FILES = (
    "modules.json", "03_generating_your_character/10sorlabs_image_generator.json",
    "04_generating_a_dataset/10sorlabs_dataset_generator.json",
    "10_dataset_generator_v2/10sorlabs_dataset_generator_v2.json",
    "10_dataset_generator_v2/dataset_generator_model_installer.bat",
    "11_lora_training_krea/10sorlabs_dataset_tester.json",
    "09_krea2_image/10sorlabs_krea2_image.json", "09_krea2_image/krea2_model_installer.bat",
)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def copy_inputs(figment):
    pipeline = figment / "pipeline"
    hashes = {"pipeline/" + key: value for key, value in producer._copy_pipeline_slice(pipeline).items()}
    for relative in EXTRA_PIPELINE:
        source, target = PIPELINE / relative, pipeline / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        hashes["pipeline/" + relative] = sha(target)
    for relative in PACKAGE_FILES:
        source = PIPELINE.parent / "research/10sorlabs-package" / relative
        target = figment / "research/10sorlabs-package" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        hashes["research/10sorlabs-package/" + relative] = sha(target)
    assert hashes["research/10sorlabs-package/09_krea2_image/10sorlabs_krea2_image.json"] == "44d6200d36ae7ea73194451fa6dcf9f6af33767062b43865984e571a9d0b7eb6"
    assert hashes["research/10sorlabs-package/09_krea2_image/krea2_model_installer.bat"] == "4e47ee8dcd45bb011abd1640e5295fe04d0d97a0900f301aa0ca24d327af0cfc"
    return hashes


def persona(figment):
    home = figment / "personas" / CREATOR
    home.mkdir(parents=True)
    source = json.loads((PIPELINE.parent / "personas" / CREATOR / "persona.yaml").read_text(encoding="utf-8"))
    source["identity"].update(references=[], history=[], look={**producer._synthetic_look(), "face": "an oval adult face"})
    source["body_target"]["exemplars"] = []
    identity, register = home / "identity.md", figment / "pipeline/look-spec.md"
    identity.write_bytes(b"Synthetic adult clothed identity fixture.\n")
    register.write_bytes(b"Synthetic opaque grey cotton wardrobe fixture.\n")
    source["identity"]["spec"] = {"path": "identity.md", "sha256": sha(identity)}
    source["register"]["spec"] = {"path": "../../pipeline/look-spec.md", "sha256": sha(register), "section": "fixture"}
    write(home / "persona.yaml", source)
    body = home / "body.png"
    Image.new("RGB", (64, 96), "grey").save(body)
    text = "A faceless clothed adult torso wearing an opaque grey cotton jacket."
    prompt = "One adult person wearing an opaque grey jacket in daylight."
    approval = dict(decided_by="fixture:setup", decided_at="2026-10-06T00:00:00Z", fixture=True)
    training = json.loads((PIPELINE.parent / "personas" / CREATOR / "training.yaml").read_text(encoding="utf-8"))
    training["training"].update(tensor_body={"path": "body.png", "sha256": sha(body), "description": text,
        "description_sha256": hashlib.sha256(text.encode()).hexdigest(), "faceless": True, "clothed": True, **approval},
        tensor_tester_prompt={"text": prompt, "sha256": hashlib.sha256(prompt.encode()).hexdigest(), **approval})
    write(home / "training.yaml", training)
    return home


def fixture_gate(images):
    rows = [{"image_id": row["image_id"], "pass": False, "group": "failed",
             "reasons": ["synthetic fixture; no quality assessment"], "age_value": 27.0,
             "judge": {"apparent_age_candidate": 27}, "stage1": None, "stage2": None} for row in images]
    return {"schema": "figment/gate@1", "own_anchor": None, "thresholds": {"age_floor_years": 20},
            "judge_thresholds": {}, "judge_skipped": True, "outage": "synthetic fixture gate",
            "rows": rows, "summary": {"total": len(rows), "passed": 0, "failed": len(rows)}}


def rule(ft, root, stage, chosen, *, checkpoint_step=None):
    grade = ft.build_grade(CREATOR, stage, root / "plan.json", skip_judge=True)
    template = ft._read_json(Path(grade["rulings_template"]))
    template.update(decided_by="fixture:synthetic-setup", decided_at="2026-10-06T00:00:00Z")
    for row in template["rulings"]:
        keep = row["image_id"] == chosen
        row.update(producer._axes("fixture: synthetic pixels and mocked failed gate; plumbing only" if keep else None),
                   decision="keep" if keep else "cull", why="synthetic fixture selection")
        if "age_ruling" in row: row["age_ruling"] = "release"
    path = root / "fixture-rulings.json"
    write(path, template)
    kwargs = {} if checkpoint_step is None else {"checkpoint_step": checkpoint_step}
    ft.apply_rulings(CREATOR, stage, root / "plan.json", path, **kwargs)
    return grade


def build_tensor_fixture(tmp):
    root = tmp / "r"
    figment = root / "orgs/figment"
    pipeline = figment / "pipeline"
    ledger = tmp / "l"
    ledger.mkdir(parents=True)
    (root / "governance").mkdir(parents=True)
    (root / "governance/budget.yaml").write_text("daily_usd_limit: 10.00\n", encoding="ascii")
    before = copy_inputs(figment)
    home = persona(figment)
    before["pipeline/look-spec.md"] = sha(pipeline / "look-spec.md")
    ft = load("_figment_tensor_observer_fixture_driver", pipeline / "figment_train.py")
    assert ft.ROOT == root and ft.HERE == pipeline
    calls = {"score": 0, "gate": 0}
    passport, train, evidence, gen = (figment / name for name in ("o", "t", "e", "g"))
    with producer._OfflineGuard() as guard, pytest.MonkeyPatch.context() as patch:
        def score(*args, **kwargs): calls["score"] += 1
        def gate(plan, anchors, images, *args, **kwargs):
            calls["gate"] += 1
            return fixture_gate(images)
        patch.setattr(ft._score_cells_module(), "score", score)
        patch.setattr(ft, "_run_identity_gate", gate)
        plan = ft.build_plan(CREATOR, "anchor", passport, personas_root=home.parent,
                             skip_pin_verify=True, ledger_dir=ledger, accept_budget=True)
        plan["fixture"] = True
        write(passport / "plan.json", plan)
        producer._fake_stage_outputs(passport, plan, "anchor")
        first_run = plan["stages"]["anchor"]["runs"][0]
        first_job = ft._read_json(passport / first_run["manifest"])["jobs"][0]
        selected_image = first_job["output_name"]
        rule(ft, passport, "anchor", selected_image)
        selection = {"source_plan": str(passport / "plan.json"), "image_id": selected_image}

        plan = ft.build_plan(CREATOR, "all", train, personas_root=home.parent,
                             skip_pin_verify=True, ledger_dir=ledger, accept_budget=True)
        plan["fixture"] = True
        write(train / "plan.json", plan)
        assert "anchor" not in plan["stages"] and "imported_training_config" not in plan
        assert plan["training"]["steps"] == 3000 and plan["training"]["save_every"] == 250
        artifact_name = ft._artifact_name(plan["training"])
        assert artifact_name == CREATOR and plan["training"]["trigger"] is None
        train_run, = plan["stages"]["train"]["runs"]
        train_manifest = ft._read_json(train / train_run["manifest"])
        artifacts = train_manifest["artifacts"]
        assert len(artifacts) == 12
        train_out = train / train_run["out"]
        train_out.mkdir(parents=True, exist_ok=True)
        for index, artifact in enumerate(artifacts):
            (train_out / artifact["local"]).write_bytes(f"synthetic fixture checkpoint {index}".encode())
        write(train_out / "run.json", {"error": None, "dry_run": False, "fixture": True, "termination_verified": True,
            "artifacts": [{"remote": a["remote"], "bytes": (train_out / a["local"]).stat().st_size} for a in artifacts]})
        tester_run, = plan["stages"]["tester"]["runs"]
        tester_manifest = ft._read_json(train / tester_run["manifest"])
        assert len(tester_manifest["jobs"]) == 12
        checkpoint_name = ft._checkpoint_name(artifact_name, 750)
        chosen = next(job["output_name"] for job in tester_manifest["jobs"]
                      if any(s.get("field") == "lora_name" and s.get("value") == checkpoint_name for s in job["substitutions"]))
        producer._fake_stage_outputs(train, plan, "tester")
        tester_out = train / tester_run["out"]
        write(tester_out / "run.json", {"error": None, "dry_run": False, "fixture": True, "termination_verified": True,
            "jobs": [{"output_name": j["output_name"], "files": [{"bytes": 10}]} for j in tester_manifest["jobs"]]})
        inputs = ft._tester_checkpoint_inputs(plan, train, tester_run)
        write(train / "stage.json", {"schema": "figment/train-stage@1", "creator": CREATOR,
            "plan_sha256": sha(train / "plan.json"), "status": "complete:tester", "completed_stages": ["train", "tester"],
            "runs": {train_run["manifest"]: {"status": "complete"},
                     tester_run["manifest"]: {"status": "complete", "checkpoint_inputs": inputs}}})
        rule(ft, train, "tester", chosen, checkpoint_step=750)
        current, training, _ = ft._load_inputs(CREATOR, home.parent)
        current["_persona_path"] = str(home / "persona.yaml")
        accepted = ft._validated_accepted_checkpoint(current, training)
        assert accepted["candidate"]["path"].endswith(checkpoint_name)
        assert accepted["step"] == 750
        passport_authority = ft._validate_registered_passport(CREATOR, current, selection["source_plan"], selected_image)
        intake = ft._tensor_stills_module().prompt_intake
        adapter = ft._canonical_intake_adapter(CREATOR, home.parent)
        binding = intake.canonical_passport_binding(creator=CREATOR, selection=selection, passport_adapter=adapter)
        evidence.mkdir()
        request = {"schema": "figment/tensor-stills-request@1", "creator": CREATOR, "fixture": True, "passport": selection, "scenes": []}
        for index, framing in ((0, "full"), (3, "close-up")):
            photo = evidence / f"scene{index}.png"
            Image.new("RGB", (64, 96), "navy").save(photo)
            response = {key: "" for key in intake.SECTIONS}
            response.update(shot_subject="one adult person", age_appearance={key: "" for key in intake.DESCRIPTORS},
                clothing="A plain opaque grey jacket.", environment="An ordinary garden.")
            draft = intake.extract_fixture_draft(evidence, photo_path=photo.name, creator=CREATOR, passport=binding,
                aspects=["clothing", "environment"], framing=framing, runner=intake.FixtureRunner(json.dumps(response)), passport_adapter=adapter)
            approval = intake.approve_fixture_prompt(evidence, draft, decided_by="fixture:reviewer", decided_at="2026-10-06T00:00:00Z",
                acknowledged_notes=draft["review_notes"], passport_adapter=adapter)
            row = {"scene_index": index}
            for kind, document in (("draft", draft), ("approval", approval)):
                path = evidence / f"{kind}{index}.json"
                write(path, document)
                row[kind] = {"path": path.name, "sha256": sha(path)}
            request["scenes"].append(row)
        write(evidence / "request.json", request)
        gen_plan = ft.build_plan(CREATOR, "gen", gen, personas_root=home.parent, stills_request=evidence / "request.json",
                                skip_pin_verify=True, ledger_dir=ledger, accept_budget=True)
        ft._validate_gen_source_inputs(gen_plan, gen)
    assert guard.attempts == []
    assert calls["gate"] == 2 and calls["score"] == 2
    after = {name: sha(figment / name) for name in before}
    assert before == after
    return SimpleNamespace(root=root, figment=figment, home=home, pipeline=pipeline, passport=passport, train=train,
        evidence=evidence, gen=gen, ft=ft, gen_plan=gen_plan, accepted=accepted,
        report={"fixture": True, "runtime_proof": False, "guard_attempts": guard.attempts, "scorer_seams": calls,
                "copied_file_sha256": before, "passport_authority_sha256": passport_authority["authority_sha256"],
                "source_plan_sha256": sha(train / "plan.json"), "gen_plan_sha256": sha(gen / "plan.json"),
                "source_stages": list(plan["stages"]), "checkpoint_artifact": checkpoint_name, "scene_indices": [0, 3],
                "gen_framings": [run["framing"] for run in gen_plan["stages"]["gen"]["runs"]]})

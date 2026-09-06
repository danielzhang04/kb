"""Contract tests for the anchor stage (module 03 -> Track-2 Phase A: Tasks A1-A3).

Shared test helpers used across this file and (via importlib, same convention as the
rest of this test tree -- there is no package ``__init__.py``) any future anchor-stage
test module:

- ``command`` fixture and ``_synthetic_persona`` come from
  ``pipeline/tests/test_figment_train.py:32-43,93-137``.
- ``_axes()`` returns the seven-axis "everything passes" ruling fragment.
- ``_fake_stage_outputs(out, plan, stage)`` writes one 8x8 PNG per job at
  ``<out>/<run.out>/<output_name>.png``.
- ``_promoted_persona(...)`` is ``_synthetic_persona`` plus
  ``identity["history"] = ["anchors/old.png"]``.
- ``_set_training(persona_dir, **fields)`` merges fields into ``training.yaml``.
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
PERSONAS = ROOT / "orgs" / "figment" / "personas"
POD_RUNNER = PIPELINE / "pod" / "runpod_run.py"
WORKFLOW = PIPELINE / "expand" / "workflows" / "zimage_passport_api.json"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def command():
    return load_module("figment_train_test_module_anchor", PIPELINE / "figment_train.py")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _synthetic_look(**overrides) -> dict:
    """A persona look deliberately DIFFERENT from creator-001's own words (persona rule:
    "would this run unchanged for creator-002 from her persona.yaml?" -- proven only if the
    fixture's identity.look isn't creator-001's by coincidence). Matches
    test_figment_train.py's own `_synthetic_look` (duplicated, not imported -- same
    no-`__init__.py` convention noted in this file's module docstring)."""
    look = {
        "age_stage": (
            "a woman in her early twenties, about twenty-two, an adult woman's face with a "
            "set jawline, an adult woman's proportions and an adult woman's frame, her hands "
            "and neck reading the same age as her face"
        ),
        "hair": "honey-blonde hair swept over one shoulder",
        "eyes": "light hazel eyes",
        "skin": "warm-tan skin with visible pores and texture",
        "brows": "her own full dark brows brushed up and not drawn in",
        "makeup": (
            "a thin brown line drawn close to the upper lash with one coat of mascara, "
            "lip balm over her natural lip colour"
        ),
        "build": "slim with an ordinary adult figure",
        "clothing": "wearing a fitted grey crew-neck t-shirt and dark jeans, both fully opaque and intact",
    }
    look.update(overrides)
    return look


def _synthetic_persona(
    personas_root: Path,
    *,
    creator_id: str = "creator-002",
    anchor_names: tuple = ("a01.jpg", "a02.jpg", "a03.jpg"),
    exemplars: list = ("a02", "a03"),
    look: dict | None = None,
) -> Path:
    import hashlib

    source = load_json(PERSONAS / "creator-001" / "persona.yaml")
    target = personas_root / creator_id
    anchors = target / "anchors"
    anchors.mkdir(parents=True)
    for name in anchor_names:
        (anchors / name).write_bytes(("image-" + name).encode())

    identity_spec = target / "identity.md"
    register_spec = target / "register.md"
    identity_spec.write_text("synthetic identity fixture\n", encoding="utf-8")
    register_spec.write_text("synthetic register fixture\n", encoding="utf-8")

    source["id"] = creator_id
    source["identity"]["references"] = [f"anchors/{name}" for name in anchor_names]
    source["identity"]["look"] = look or _synthetic_look()
    source["identity"].pop("history", None)
    source["identity"]["spec"] = {
        "path": "identity.md",
        "sha256": hashlib.sha256(identity_spec.read_bytes()).hexdigest(),
    }
    source["body_target"]["exemplars"] = list(exemplars)
    source["register"]["spec"] = {
        "path": "register.md",
        "sha256": hashlib.sha256(register_spec.read_bytes()).hexdigest(),
        "section": "fixture",
    }
    source["training"] = {
        "trigger": None,
        "base_arch": "krea2",
        "steps": 600,
        "save_every": 200,
        "caption_mode": "provided",
        "pod_class": "l40s",
        "price_ceiling_usd_per_hour": 1.30,
    }
    path = target / "persona.yaml"
    path.write_text(json.dumps(source, indent=2) + "\n", encoding="utf-8")
    return path


def _axes() -> dict:
    return {
        "identity": "pass",
        "realism": "pass",
        "hands": "pass",
        "lighting": "pass",
        "adult_read": "pass",
        "garment_integrity": "pass",
        "real_person_resemblance": "clear",
    }


class _RC0:
    returncode = 0


def _rc0():
    return _RC0()


def _fake_stage_outputs(out: Path, plan: dict, stage: str) -> None:
    from PIL import Image

    for run in plan["stages"][stage]["runs"]:
        manifest = load_json(out / run["manifest"])
        run_out = out / run["out"]
        run_out.mkdir(parents=True, exist_ok=True)
        for job in manifest["jobs"]:
            Image.new("RGB", (8, 8)).save(run_out / f"{job['output_name']}.png")


def _promoted_persona(
    personas_root: Path,
    *,
    creator_id: str = "creator-002",
    **kwargs,
) -> Path:
    path = _synthetic_persona(personas_root, creator_id=creator_id, **kwargs)
    persona = load_json(path)
    persona["identity"]["history"] = ["anchors/old.png"]
    path.write_text(json.dumps(persona, indent=2) + "\n", encoding="utf-8")
    return path


def _set_training(persona_dir: Path, **fields) -> None:
    persona_path = persona_dir / "persona.yaml"
    persona = load_json(persona_path)
    persona.setdefault("training", {}).update(fields)
    persona_path.write_text(json.dumps(persona, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Task A1: port module 03 and its prompt template
# ---------------------------------------------------------------------------


def test_passport_workflow_matches_module_03_settings():
    g = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    s = g["47"]["inputs"]
    assert g["47"]["class_type"] == "ClownsharKSampler_Beta"
    assert (s["eta"], s["sampler_name"], s["scheduler"], s["steps"], s["cfg"],
            s["denoise"]) == (0.45, "exponential/res_8s", "simple", 8, 1.0, 0.95)
    assert (g["11"]["inputs"]["width"], g["11"]["inputs"]["height"]) == (1536, 2048)
    assert g["1"]["inputs"]["unet_name"] == "z_image_turbo_bf16.safetensors"
    assert g["103"]["inputs"]["strength_model"] == 0.66
    text = WORKFLOW.read_text(encoding="utf-8")
    for banned in ('.pt"', ".pth", "FaceDetailer", "UltralyticsDetectorProvider",
                   "SAMLoader", "zit_upscaler", "gravedigga", "creator-001", "g01"):
        assert banned not in text, banned


def test_anchor_prompts_are_persona_derived_and_carry_the_camera_clause(command, tmp_path):
    # NOTE (deviation from the plan's literal Step-1 text): the plan assigns
    # `personas = _synthetic_persona(tmp_path, creator_id=...)` and then passes that
    # same `personas` value straight to `_load_inputs` as `personas_root`. But
    # `_synthetic_persona` (test_figment_train.py:93-137, reused unchanged) returns the
    # *persona.yaml file path* (`personas_root / creator_id / "persona.yaml"`), not the
    # personas_root directory -- passing it on as `personas_root` would make
    # `_load_inputs` look for `<that file>/creator-002/persona.yaml`, a FileNotFoundError
    # every other test in this tree avoids by keeping `personas_root` as the directory
    # and discarding (or separately capturing) `_synthetic_persona`'s return value. `tmp_path`
    # itself is the personas_root `_synthetic_persona(tmp_path, ...)` was given, so it is
    # what actually gets passed to `_load_inputs` here.
    _synthetic_persona(tmp_path, creator_id="creator-002")
    persona = command._load_inputs("creator-002", tmp_path)[0]
    p = command._generalized_anchor_prompts(persona)
    assert p["persona"] == "creator-002"
    assert "24mm" in p["camera_clause"] and "zero film grain" not in p["camera_clause"]
    assert (len(p["passport"]["rows"]), len(p["edit"]["rows"])) == (12, 6)
    assert all(p["camera_clause"] in row for row in p["passport"]["rows"])
    for banned in ("creator-001", "g01", "g02", "g07", "youthful"):
        assert banned not in json.dumps(p), banned


def test_passport_rows_carry_a_framing_prefix_so_the_face_clears_the_min_face_px_floor(
    command, tmp_path,
):
    """Review HIGH-4: full-scene passport rows with no distance instruction put the face
    far under identity.floor.min_face_px at 1536x2048 (identity-spec.md's "Rule for
    expansion"; recorded as D21). Every row must open with the framing clause."""
    _synthetic_persona(tmp_path, creator_id="creator-002")
    persona = command._load_inputs("creator-002", tmp_path)[0]
    p = command._generalized_anchor_prompts(persona)
    prefix = (
        "Close head-and-shoulders portrait framing, face centred and filling the upper "
        "half of the frame,"
    )
    for row in p["passport"]["rows"]:
        assert "framing" in row
        assert row.startswith(prefix)


def test_anchor_prompts_derive_from_persona_look_not_a_shared_template_face(
    command, tmp_path,
):
    """Review HIGH-2: the identity clause must come from persona.identity.look, not a
    face/body description hardcoded in anchor-prompts.yaml. Two personas with different
    look words must render different prompts, each carrying only its own words."""
    _synthetic_persona(tmp_path / "a", creator_id="creator-002")
    look_b = _synthetic_look(
        hair="copper-red hair cropped to the chin", eyes="grey-blue eyes",
        clothing="wearing a fitted white crew-neck t-shirt and dark jeans, both fully opaque and intact",
    )
    _synthetic_persona(tmp_path / "b", creator_id="creator-003", look=look_b)
    persona_a = command._load_inputs("creator-002", tmp_path / "a")[0]
    persona_b = command._load_inputs("creator-003", tmp_path / "b")[0]
    prompts_a = command._generalized_anchor_prompts(persona_a)
    prompts_b = command._generalized_anchor_prompts(persona_b)

    assert "honey-blonde" in prompts_a["passport"]["identity"]
    assert "light hazel eyes" in prompts_a["passport"]["identity"]
    assert "honey-blonde" in prompts_a["edit"]["identity"]

    assert "copper-red" in prompts_b["passport"]["identity"]
    assert "grey-blue eyes" in prompts_b["passport"]["identity"]
    assert "copper-red" in prompts_b["edit"]["identity"]

    assert "copper-red" not in prompts_a["passport"]["identity"]
    assert "honey-blonde" not in prompts_b["passport"]["identity"]
    for identity in (prompts_a["passport"]["identity"], prompts_b["passport"]["identity"]):
        assert "jet-black hair" not in identity
        assert "dark brown eyes" not in identity


# ---------------------------------------------------------------------------
# Task A2: pin and plan the anchor stage
# ---------------------------------------------------------------------------


def test_anchor_pins_and_manifests(command, tmp_path):
    pins = json.loads((PIPELINE / "train" / "tensor-pins.yaml").read_text("utf-8"))
    stage = pins["pod_classes"]["l40s"]["stages"]["anchor"]
    # Review MED-7: job_timeout_seconds raised 180 -> 480 (untested single-shot 8-stage RES
    # sampler at 3.1MP, no anchor smoke); max_minutes recomputed via the same formula as
    # every other stage: readiness/60 + job_timeout*jobs/60 + 5 = 1800/60 + 480*12/60 + 5 = 131.
    assert (stage["max_minutes"], stage["job_timeout_seconds"]) == (131, 480)
    for key in ("anchor", "anchor_edit"):
        for m in pins["pins"][key]["models"]:
            assert m["filename"].endswith(".safetensors") and "gravedigga" not in m["repo_id"]
            assert len(m["revision"]) == 40 and len(m["sha256"]) == 64, m
    personas = tmp_path / "personas"
    _synthetic_persona(personas, creator_id="creator-002")
    out = tmp_path / "plan"
    plan = command.build_plan("creator-002", "anchor", out, personas_root=personas, skip_pin_verify=True)
    runs = plan["stages"]["anchor"]["runs"]
    assert [Path(r["manifest"]).name for r in runs] == [
        "creator-002-anchor-passport.yaml", "creator-002-anchor-edit.yaml"]
    passport = load_json(out / runs[0]["manifest"])
    assert [j["seed"] for j in passport["jobs"]] == list(range(148, 160))
    assert passport["max_placement_attempts"] == 1
    assert passport["jobs"][0]["output_name"] == "c002-anchor-p01"
    assert len(load_json(out / runs[1]["manifest"])["jobs"]) == 6
    for run in runs:
        # NOTE (deviation from the plan's literal Step-2 text): the plan's example adds
        # `--max-minutes 1`. `effective_max_minutes` takes min(DEFAULT_MAX_MINUTES, that
        # CLI value, the manifest's own max_minutes) = 1, and
        # `enforce_effective_readiness_budget` then fails closed because 1 minute cannot
        # cover this manifest's own 71/95-minute readiness+job budget -- the same
        # preflight check that keeps a hand-edited --max-minutes from silently
        # underrunning a live pod. Every other dry-run call in this test tree
        # (test_figment_train.py's `test_creator00{2,3}_..._every_manifest_dry_runs`)
        # omits --max-minutes entirely for exactly this reason; matched here.
        r = subprocess.run([sys.executable, str(POD_RUNNER), "run", "--manifest",
            str(out / run["manifest"]), "--out", str(tmp_path / Path(run["manifest"]).stem),
            "--dry-run"], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr


def test_build_plan_verifies_pins_by_default_and_can_be_skipped(command, tmp_path, monkeypatch):
    """Review HIGH-1 / LOW-15: nothing previously caught a wrong sha256 pin before a pod
    burned its full cost ceiling in readiness. `plan` must run `verify_pins` for the
    profile(s) the requested stage actually uses, fail closed on a mismatch, and be
    skippable via `skip_pin_verify` for offline/test use."""
    personas = tmp_path / "personas"
    _synthetic_persona(personas, creator_id="creator-002")
    verify_pins = command._verify_pins_module()

    def _wrong_digest(url, **kwargs):
        return 302, {"x-linked-etag": '"' + "0" * 64 + '"'}

    monkeypatch.setattr(verify_pins, "head_etag", _wrong_digest)
    with pytest.raises(command.FigmentTrainError, match="pin verification failed"):
        command.build_plan("creator-002", "anchor", tmp_path / "a", personas_root=personas)
    # The failing stub is still installed -- skip_pin_verify must bypass it entirely.
    command.build_plan(
        "creator-002", "anchor", tmp_path / "b", personas_root=personas,
        skip_pin_verify=True,
    )

    def _matching_digest(url, **kwargs):
        pins = json.loads((PIPELINE / "train" / "tensor-pins.yaml").read_text("utf-8"))
        for stage in ("anchor", "anchor_edit"):
            for model in pins["pins"][stage]["models"]:
                if url == verify_pins._pin_url(model):
                    return 302, {
                        "x-linked-etag": f'"{model["sha256"]}"',
                        "x-repo-commit": model["revision"],
                    }
        raise AssertionError(f"unexpected pin URL: {url}")

    monkeypatch.setattr(verify_pins, "head_etag", _matching_digest)
    command.build_plan("creator-002", "anchor", tmp_path / "c", personas_root=personas)


def test_every_rendered_anchor_job_prompt_states_clothing_is_opaque(command, tmp_path):
    """Review HIGH-3: not one of the 18 rendered prompts stated clothing. Every passport
    and edit job's substituted prompt text must carry the fixed 'fully opaque and intact'
    clause (from persona.identity.look.clothing)."""
    personas = tmp_path / "personas"
    _synthetic_persona(personas, creator_id="creator-002")
    out = tmp_path / "plan"
    plan = command.build_plan("creator-002", "anchor", out, personas_root=personas, skip_pin_verify=True)
    passport = load_json(out / plan["stages"]["anchor"]["runs"][0]["manifest"])
    edit = load_json(out / plan["stages"]["anchor"]["runs"][1]["manifest"])
    passport_texts = [
        substitution["value"]
        for job in passport["jobs"]
        for substitution in job["substitutions"] if substitution["field"] == "text"
    ]
    assert len(passport_texts) == 12
    assert all("fully opaque and intact" in text for text in passport_texts)
    edit_texts = [
        substitution["value"]
        for job in edit["jobs"]
        for substitution in job["substitutions"] if substitution["field"] == "prompt"
    ]
    assert len(edit_texts) == 6
    assert all("fully opaque and intact" in text for text in edit_texts)


def test_edit_manifest_node_800_carries_the_same_identity_register_as_node_174(
    command, tmp_path,
):
    """Review MED-6: node 800 (a second CLIPTextEncode later in the inherited dataset
    graph, resampled at denoise 0.23) must not keep the dataset template's own makeup
    register while node 174 carries the anchor's persona-derived clause -- both must agree
    per job."""
    personas = tmp_path / "personas"
    _synthetic_persona(personas, creator_id="creator-002")
    out = tmp_path / "plan"
    plan = command.build_plan("creator-002", "anchor", out, personas_root=personas, skip_pin_verify=True)
    edit = load_json(out / plan["stages"]["anchor"]["runs"][1]["manifest"])
    persona = command._load_inputs("creator-002", personas)[0]
    identity = command._generalized_anchor_prompts(persona)["edit"]["identity"]
    for job in edit["jobs"]:
        by_node = {s["node_id"]: s for s in job["substitutions"]}
        assert by_node["800"]["field"] == "text"
        assert by_node["800"]["value"] == identity
        assert by_node["800"]["value"] != by_node["174"]["value"]  # 174 also carries the row


# ---------------------------------------------------------------------------
# Task A3: grade, promote, and lock the anchor against re-runs
# ---------------------------------------------------------------------------


def test_apply_anchor_rulings_promotes_exactly_one_pick(command, tmp_path):
    personas = tmp_path / "personas"
    _synthetic_persona(personas, creator_id="creator-002")
    out = tmp_path / "plan"
    plan = command.build_plan("creator-002", "anchor", out, personas_root=personas, skip_pin_verify=True)
    # Review MED-8: persona_dir must be repo-relative (against ROOT), never an absolute
    # machine path -- even though this fixture's persona lives entirely outside ROOT
    # (under tmp_path), proving apply_rulings' `ROOT / persona_dir` resolution round-trips
    # correctly via Path.relative_to(..., walk_up=True).
    assert not Path(plan["assets"]["persona_dir"]).is_absolute()
    _fake_stage_outputs(out, plan, "anchor")
    grade = command.build_grade("creator-002", "anchor", out / "plan.json")
    template = load_json(Path(grade["rulings_template"]))
    for i, row in enumerate(template["rulings"]):
        row.update(_axes(), decision="keep" if i == 3 else "cull", why="fixture")
    filled = out / "filled.json"
    filled.write_text(json.dumps(template), "utf-8")
    command.apply_rulings("creator-002", "anchor", out / "plan.json", filled)
    chosen = load_json(out / "grade" / "anchor" / "chosen-anchor.json")
    assert chosen["image_id"] == template["rulings"][3]["image_id"]
    persona = load_json(personas / "creator-002" / "persona.yaml")
    assert persona["identity"]["references"] == [f"anchors/{chosen['image_id']}.png"]
    assert persona["identity"]["history"]
    assert (personas / "creator-002" / "anchors" / f"{chosen['image_id']}.png").is_file()


def test_apply_anchor_rulings_refuses_two_keeps(command, tmp_path):
    personas = tmp_path / "personas"
    _synthetic_persona(personas, creator_id="creator-002")
    out = tmp_path / "plan"
    plan = command.build_plan("creator-002", "anchor", out, personas_root=personas, skip_pin_verify=True)
    _fake_stage_outputs(out, plan, "anchor")
    grade = command.build_grade("creator-002", "anchor", out / "plan.json")
    template = load_json(Path(grade["rulings_template"]))
    for i, row in enumerate(template["rulings"]):
        row.update(_axes(), decision="keep" if i in (3, 4) else "cull", why="fixture")
    filled = out / "filled.json"
    filled.write_text(json.dumps(template), "utf-8")
    with pytest.raises(command.FigmentTrainError, match="exactly one"):
        command.apply_rulings("creator-002", "anchor", out / "plan.json", filled)


def test_a_promoted_anchor_can_never_be_replanned(command, tmp_path):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002")
    with pytest.raises(command.FigmentTrainError, match="already has a promoted anchor"):
        command.build_plan("creator-002", "anchor", tmp_path / "a", personas_root=personas, skip_pin_verify=True)
    plan = command.build_plan("creator-002", "all", tmp_path / "b", personas_root=personas, skip_pin_verify=True)
    assert "anchor" not in plan["stages"]


def test_run_stage_all_skips_completed_and_already_graded_stages(command, tmp_path, monkeypatch):
    personas = tmp_path / "personas"
    _promoted_persona(personas, creator_id="creator-002")
    out = tmp_path / "b"
    command.build_plan("creator-002", "all", out, personas_root=personas, skip_pin_verify=True)
    (out / "stage.json").write_text(json.dumps({
        "schema": "figment/train-stage@1", "creator": "creator-002",
        "plan_sha256": command._sha256(out / "plan.json"), "status": "complete:dataset",
        "runs": {}, "completed_stages": ["dataset"]}), "utf-8")
    (out / "grade" / "tester").mkdir(parents=True)
    (out / "grade" / "tester" / "rulings.json").write_text("{}", "utf-8")
    launched = []
    monkeypatch.setattr(command.subprocess, "run",
                        lambda argv, cwd=None: launched.append(argv) or _rc0())
    with pytest.raises(command.FigmentTrainError):     # stops at the smoke/train config gate
        command.run_planned_stage("creator-002", "all", out / "plan.json")
    joined = [" ".join(a) for a in launched]
    assert not any("dataset" in a for a in joined)
    assert not any("tester" in a for a in joined)

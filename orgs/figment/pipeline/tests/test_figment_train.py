"""Contract tests for the persona-driven Track-1 command (brief T1-G)."""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
PERSONAS = ROOT / "orgs" / "figment" / "personas"
MODULE_PATH = PIPELINE / "figment_train.py"
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
    return load_module("figment_train_test_module", MODULE_PATH)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def plan_path(out: Path, run: dict) -> Path:
    return out / run["manifest"]


def canonical_json(path: Path) -> bytes:
    """Compare bytes after the documented canonical-format-only delta."""
    return json.dumps(
        load_json(path), ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    ).encode()


def test_creator001_every_planned_stage_dry_runs_clean_and_pins_verify(
    command, tmp_path, monkeypatch,
):
    """Task E1: the hand-written manifests this test used to byte-compare `build_plan`'s
    output against are retired -- figment_train.py is the only producer now. In their
    place, this proves creator-001's REAL, checked-in persona.yaml/training.yaml plans
    every reachable stage clean end to end: each manifest dry-runs green through the pod
    harness, the plan's own bookkeeping (sha256/ceiling_usd/argv) is internally
    consistent, and `verify_pins` (the exact preflight `plan` runs live, normally
    skipped in tests via `skip_pin_verify`) accepts every pin against a monkeypatched
    `head_etag` -- proving the preflight wiring is sound without a live network call.
    """
    verify_pins_module = command._verify_pins_module()
    pins = command._read_json(command.PINS_PATH)
    known_by_url = {}
    for entry in pins["pins"].values():
        for model in verify_pins_module._stage_models(entry):
            known_by_url[verify_pins_module._pin_url(model)] = model

    def _fake_head_etag(url, *, timeout=30.0):
        model = known_by_url[url]
        return 200, {"x-repo-commit": model["revision"], "x-linked-etag": model["sha256"]}

    monkeypatch.setattr(verify_pins_module, "head_etag", _fake_head_etag)

    out = tmp_path / "creator001-plan"
    # skip_pin_verify defaults to False: this run genuinely exercises the preflight.
    plan = command.build_plan("creator-001", "all", out, personas_root=PERSONAS)

    for stage, stage_data in plan["stages"].items():
        for index, run in enumerate(stage_data["runs"]):
            generated = plan_path(out, run)
            assert run["sha256"] == hashlib.sha256(generated.read_bytes()).hexdigest()
            assert run["ceiling_usd"] == command.manifest_ceiling(load_json(generated))
            assert "--max-usd" in run["argv"]
            assert run["cli"] == subprocess.list2cmdline(run["argv"])
            result = subprocess.run(
                [
                    sys.executable, str(POD_RUNNER), "run",
                    "--manifest", str(generated),
                    "--out", str(tmp_path / "dry-runs" / stage / str(index)),
                    "--dry-run",
                ],
                cwd=ROOT, text=True, capture_output=True,
            )
            assert result.returncode == 0, result.stdout + result.stderr

    assert load_json(out / "expand" / "workflows" / "tensor_dataset_v2_api.json") == load_json(
        PIPELINE / "expand" / "workflows" / "tensor_dataset_v2_api.json"
    )


def test_pins_are_the_single_source_for_every_generated_manifest(command, tmp_path):
    out = tmp_path / "pins-plan"
    plan = command.build_plan("creator-001", "all", out, personas_root=PERSONAS, skip_pin_verify=True)
    pins = load_json(PIPELINE / "train" / "tensor-pins.yaml")
    for stage, profile in (("dataset", "dataset"), ("smoke", "train"),
                           ("train", "train"), ("tester", "tester")):
        for run in plan["stages"][stage]["runs"]:
            manifest = load_json(plan_path(out, run))
            assert manifest["models"] == pins["pins"][profile]["models"]
            assert manifest["custom_nodes"] == pins["pins"][profile]["custom_nodes"]


def _synthetic_look(**overrides) -> dict:
    """A persona look deliberately DIFFERENT from creator-001's own words (persona rule:
    "would this run unchanged for creator-002 from her persona.yaml?" -- proven only if the
    fixture's identity.look isn't creator-001's by coincidence)."""
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


def test_generalized_prompts_note_derives_from_actual_reference_names_not_g01_g07(
    command, tmp_path, monkeypatch,
):
    """The dataset-prompts note must reflect the real anchor filenames it names.

    Regression for the reviewer's fragility finding: the old code found and replaced the
    literal template substrings "anchors/g01.jpg"/"anchors/g07.jpg" — a silent no-op for any
    template text that does not happen to say exactly that. This uses a template that names
    different (fictional) anchor files to prove the note is built from the persona's actual
    reference filenames, not by string-matching creator-001's old anchor names.
    """
    custom_template = {
        "persona": None,
        "structure": {
            "prepend_is_the_hand_typed_description": (
                "The lesson's own rule: face.identity matches anchors/whatever-face.png; "
                "body.identity matches anchors/whatever-body.png."
            ),
        },
    }
    prompts_path = tmp_path / "tensor-dataset-prompts.yaml"
    prompts_path.write_text(json.dumps(custom_template), encoding="utf-8")
    monkeypatch.setattr(command, "PROMPTS_PATH", prompts_path)

    persona = {
        "id": "creator-002",
        "identity": {"references": ["anchors/a01.jpg", "anchors/a02.jpg", "anchors/a03.jpg"]},
        "body_target": {"exemplars": ["a02", "a03"]},
    }
    prompts = command._generalized_prompts(persona)
    note = prompts["structure"]["prepend_is_the_hand_typed_description"]
    assert "anchors/a01.jpg" in note
    assert "anchors/a03.jpg" in note
    assert "whatever-face" not in note
    assert "whatever-body" not in note


def test_generalized_prompts_raises_on_stale_post_promotion_exemplars(command):
    """Review MED-9: post-anchor-promotion, identity.references collapses to the one
    picked anchor while body_target.exemplars still names the retired g-set -- silently
    falling through to references[-1] happened to work only by coincidence (there is only
    one reference left). It must now fail closed instead of staying silent."""
    persona = {
        "id": "creator-002",
        "identity": {"references": ["anchors/c002-anchor-p04.png"]},
        "body_target": {"exemplars": ["g02", "g07"]},
    }
    with pytest.raises(command.FigmentTrainError, match="stale post-anchor-promotion"):
        command._generalized_prompts(persona)


def test_creator003_two_anchor_persona_plans_clean_and_every_manifest_dry_runs(
    command, tmp_path,
):
    """Lock in the minimal-anchor-count behavior: exactly 2 references, 1 exemplar."""
    personas_root = tmp_path / "personas"
    _synthetic_persona(
        personas_root,
        creator_id="creator-003",
        anchor_names=("a01.jpg", "a02.jpg"),
        exemplars=["a02"],
    )
    out = tmp_path / "creator003-plan"
    plan = command.build_plan("creator-003", "all", out, personas_root=personas_root, skip_pin_verify=True)

    assert plan["training"]["trigger"] == "creator003krea2"
    dataset_manifest = load_json(plan_path(out, plan["stages"]["dataset"]["runs"][0]))
    assert len(dataset_manifest["uploads"][0]["files"]) == 2

    tester = load_json(plan_path(out, plan["stages"]["tester"]["runs"][0]))
    assert len(tester["jobs"]) == 3, "still one tester job (branch) per checkpoint"

    all_runs = [run for stage in plan["stages"].values() for run in stage["runs"]]
    # 2 anchor (passport + edit) + 4 dataset manifests (3 shards + fullbody, Track-2 B1)
    # + smoke + train + tester (figment Track-2 A2: STAGES gained "anchor", so
    # --stage all now plans it first).
    assert len(all_runs) == 9
    for index, run in enumerate(all_runs):
        result = subprocess.run(
            [
                sys.executable, str(POD_RUNNER), "run",
                "--manifest", str(plan_path(out, run)),
                "--out", str(tmp_path / "dry-runs" / str(index)),
                "--dry-run",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        assert result.returncode == 0, result.stdout + result.stderr


def test_creator002_is_data_only_token_clean_and_every_manifest_dry_runs(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "creator002-plan"
    plan = command.build_plan("creator-002", "all", out, personas_root=personas_root, skip_pin_verify=True)

    assert plan["training"]["trigger"] == "creator002krea2"
    train_manifest = load_json(plan_path(out, plan["stages"]["train"]["runs"][0]))
    assert train_manifest["training"]["checkpoint_steps"] == "000000200 000000400"
    assert train_manifest["training"]["final_step"] == "000000600"
    tester = load_json(plan_path(out, plan["stages"]["tester"]["runs"][0]))
    assert len(tester["jobs"]) == 3
    assert tester["jobs"][-1]["substitutions"][0]["value"] == "creator002krea2.safetensors"

    for path in out.rglob("*"):
        if path.is_file():
            payload = path.read_bytes().lower()
            assert b"creator-001" not in payload, path
            assert b"creator001" not in payload, path
            assert b"g01" not in payload, path
            assert b"g07" not in payload, path

    all_runs = [run for stage in plan["stages"].values() for run in stage["runs"]]
    # 2 anchor (passport + edit) + 4 dataset manifests (3 shards + fullbody, Track-2 B1)
    # + smoke + train + tester (figment Track-2 A2: STAGES gained "anchor", so
    # --stage all now plans it first).
    assert len(all_runs) == 9
    for index, run in enumerate(all_runs):
        result = subprocess.run(
            [
                sys.executable, str(POD_RUNNER), "run",
                "--manifest", str(plan_path(out, run)),
                "--out", str(tmp_path / "dry-runs" / str(index)),
                "--dry-run",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        assert result.returncode == 0, result.stdout + result.stderr


def _fake_run(out: Path, *, usd: float = 0.25) -> tuple[dict, Path]:
    out.mkdir(parents=True)
    (out / "_training.log").write_text("state dict loaded cleanly\n", encoding="utf-8")
    run = {
        "error": None,
        "pod_id": "pod-fixture",
        "gpu": {"type": "NVIDIA L40S", "count": 1, "cloud": "SECURE"},
        "termination_verified": True,
        "estimated_actual_usd": usd,
        "ledger_day": "2026-09-04",
        "artifacts": [
            {"remote": "model.safetensors", "bytes": 12},
            {"remote": "_training.log", "bytes": 25},
        ],
        "placement_attempts": [{
            "pod_id": "pod-fixture",
            "estimated_actual_usd": usd,
            "termination_verified": True,
        }],
    }
    path = out / "run.json"
    path.write_text(json.dumps(run), encoding="utf-8")
    manifest = {
        "gpu": run["gpu"],
        "artifacts": [
            {"remote": "model.safetensors"},
            {"remote": "_training.log"},
        ],
    }
    return manifest, path


def test_run_verifier_checks_artifacts_termination_ledger_and_training_log(command, tmp_path):
    manifest, run_path = _fake_run(tmp_path / "run")
    ledger = tmp_path / "cost-ledger"
    ledger.mkdir()
    (ledger / "figment-2026-09-04.tsv").write_text(
        "model\tstep\tusd\nrunpod:l40s\tpod-create pod-fixture\t0.250000\n",
        encoding="utf-8",
    )
    verified = command.verify_run_record("smoke", manifest, run_path.parent, ledger)
    assert verified["pod_id"] == "pod-fixture"


@pytest.mark.parametrize("defect", ["termination", "artifact", "ledger", "log"])
def test_run_verifier_stops_on_each_recorded_defect(command, tmp_path, defect):
    manifest, run_path = _fake_run(tmp_path / defect)
    data = load_json(run_path)
    ledger = tmp_path / "cost-ledger"
    ledger.mkdir()
    ledger_text = "model\tstep\tusd\nrunpod:l40s\tpod-create pod-fixture\t0.250000\n"
    if defect == "termination":
        data["termination_verified"] = False
    elif defect == "artifact":
        data["artifacts"][0]["bytes"] = 0
    elif defect == "ledger":
        ledger_text = "model\tstep\tusd\nrunpod:l40s\tpod-create pod-fixture\t0.200000\n"
    else:
        (run_path.parent / "_training.log").write_text(
            "missing_keys: ['layer.weight']\n", encoding="utf-8"
        )
    run_path.write_text(json.dumps(data), encoding="utf-8")
    (ledger / "figment-2026-09-04.tsv").write_text(ledger_text, encoding="utf-8")
    with pytest.raises(command.FigmentTrainError):
        command.verify_run_record("smoke", manifest, run_path.parent, ledger)


def test_run_refuses_to_resume_a_stage_stuck_running(command, tmp_path, monkeypatch):
    out = tmp_path / "resume-plan"
    plan = command.build_plan("creator-001", "dataset", out, personas_root=PERSONAS, skip_pin_verify=True)
    plan_file = out / "plan.json"
    key = plan["stages"]["dataset"]["runs"][0]["manifest"]
    state_path = out / "stage.json"
    state_path.write_text(json.dumps({
        "schema": "figment/train-stage@1",
        "creator": "creator-001",
        "plan_sha256": hashlib.sha256(plan_file.read_bytes()).hexdigest(),
        "status": "running:dataset",
        "runs": {key: {"status": "running", "started_utc": "2026-09-04T00:00:00+00:00"}},
        "completed_stages": [],
    }), encoding="utf-8")

    def _no_launch(*args, **kwargs):
        raise AssertionError("must not launch a subprocess for a run stuck running")
    monkeypatch.setattr(command.subprocess, "run", _no_launch)

    with pytest.raises(command.FigmentTrainError) as excinfo:
        command.run_planned_stage("creator-001", "dataset", plan_file)
    message = str(excinfo.value)
    assert "runpod_run.py" in message
    assert "status" in message and "probe" in message


def test_ledger_model_dispatches_through_the_pod_harness_function_not_a_copy(
    command, tmp_path, monkeypatch,
):
    """_verify_ledger must call the harness's own gpu_model_label, not a hand copy.

    Proof: monkeypatching the pod module's gpu_model_label changes figment_train's
    ledger-agreement result. A private reimplementation would be unaffected by this.
    """
    assert not hasattr(command, "_ledger_model"), (
        "local gpu-label reimplementation should be deleted in favor of importing "
        "pod/runpod_run.py's gpu_model_label"
    )
    manifest, run_path = _fake_run(tmp_path / "ledger-dispatch")
    ledger = tmp_path / "cost-ledger"
    ledger.mkdir()
    (ledger / "figment-2026-09-04.tsv").write_text(
        "model\tstep\tusd\nrunpod:sentinel-model\tpod-create pod-fixture\t0.250000\n",
        encoding="utf-8",
    )
    pod_module = command._pod_runner_module()
    monkeypatch.setattr(pod_module, "gpu_model_label", lambda gpu_type: "runpod:sentinel-model")

    verified = command.verify_run_record("smoke", manifest, run_path.parent, ledger)
    assert verified["pod_id"] == "pod-fixture"


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def test_dataset_grading_template_round_trip_builds_only_kept_training_images(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "grade-plan"
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)

    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)

    grade = command.build_grade("creator-002", "dataset", plan_file)
    template = load_json(Path(grade["rulings_template"]))
    assert len(template["rulings"]) == 30
    assert "<img" in Path(grade["page"]).read_text(encoding="utf-8")
    assert "full-resolution" in Path(grade["page"]).read_text(encoding="utf-8")

    for index, ruling in enumerate(template["rulings"]):
        ruling.update({
            "decision": "cull" if index == 0 else "keep",
            "identity": "pass",
            "realism": "pass",
            "hands": "pass",
            "lighting": "pass",
            "adult_read": "pass",
            "garment_integrity": "pass",
            "real_person_resemblance": "clear",
            "why": "fixture ruling",
            # This fixture's anchors/cells are fabricated bytes with no real face, so
            # the fail-closed identity/age/realism gate always fails them -- this test
            # is about the dataset-build round-trip, not the gate, hence the override.
            "gate_override": "fixture: no real face in this synthetic image",
        })
    filled = Path(grade["rulings_template"]).with_name("filled.json")
    filled.write_text(json.dumps(template, indent=2) + "\n", encoding="utf-8")

    result = command.apply_rulings("creator-002", "dataset", plan_file, filled)
    approved = load_json(Path(result["approved_list"]))
    review = load_json(Path(result["review_manifest"]))
    dataset = load_json(out / "train" / "runs" / "creator-002-tensor-dataset" / "dataset_manifest.json")
    assert len(approved["images"]) == 29
    assert dataset["count"] == 29
    assert sum(row["review_status"] == "verified" for row in review["images"]) == 30
    assert not any(row["safety_failed"] for row in review["images"])
    assert (out / "train" / "runs" / "creator-002-tensor-dataset" / "training.json").is_file()


def test_apply_rulings_fails_closed_when_a_kept_cell_fails_safety(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "unsafe-plan"
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)
    grade = command.build_grade("creator-002", "dataset", plan_file)
    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
            # Fabricated bytes, no real face -- always fails the identity/age/realism
            # gate; this test is specifically about the SEPARATE safety-axis check.
            "gate_override": "fixture: no real face in this synthetic image",
        })
    template["rulings"][0]["adult_read"] = "ambiguous"
    filled = Path(grade["rulings_template"]).with_name("unsafe.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="safety"):
        command.apply_rulings("creator-002", "dataset", plan_file, filled)


# ---------------------------------------------------------------------------
# identity_gate wiring: build_grade writes gate.json + a PASS/FAIL board, apply_rulings
# refuses a bare keep on a failed-gate cell, `gate` CLI prints the table.
# ---------------------------------------------------------------------------


def _build_fake_dataset_grade(command, tmp_path, *, out_name: str):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / out_name
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)
    grade = command.build_grade("creator-002", "dataset", plan_file)
    return plan_file, grade


def test_build_grade_writes_gate_json_and_a_pass_fail_board(command, tmp_path):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-json-plan")
    assert "gate" in grade
    gate_document = load_json(Path(grade["gate"]))
    assert gate_document["schema"] == "figment/gate@1"
    assert len(gate_document["rows"]) == 30
    for field in ("identity_own", "age_delta", "gloss", "niqe", "pass"):
        assert field in gate_document["rows"][0]
    # This fixture's images/anchors are fabricated bytes with no real face -- every
    # cell must fail the gate, never silently pass.
    assert gate_document["summary"]["passed"] == 0
    assert gate_document["summary"]["failed"] == 30

    page_text = Path(grade["page"]).read_text(encoding="utf-8")
    assert "failed gate (30)" in page_text
    assert "Cells passing the gate (0)" in page_text


def test_apply_rulings_refuses_a_keep_on_a_failed_gate_cell_without_override(command, tmp_path):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-refuse-plan")
    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
        })
    filled = Path(grade["rulings_template"]).with_name("no-override.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="gate"):
        command.apply_rulings("creator-002", "dataset", plan_file, filled)


def test_apply_rulings_allows_a_keep_on_a_failed_gate_cell_with_override(command, tmp_path):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-override-plan")
    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
            "gate_override": "operator manually confirmed identity from the full-res original",
        })
    filled = Path(grade["rulings_template"]).with_name("override.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    result = command.apply_rulings("creator-002", "dataset", plan_file, filled)
    approved = load_json(Path(result["approved_list"]))
    assert len(approved["images"]) == 30


def test_gate_cli_prints_a_pass_fail_table(command, tmp_path, capsys):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-cli-plan")
    exit_code = command.main(["gate", "--creator", "creator-002", "--stage", "dataset", "--plan", str(plan_file)])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "image_id" in out
    assert "FAIL" in out
    assert "0/30 passed" in out


def test_gate_cli_errors_when_grade_has_not_run(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "no-grade-plan"
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    with pytest.raises(command.FigmentTrainError, match="run `figment_train.py grade`"):
        command.command_gate("creator-002", "dataset", plan_file)


# ---------------------------------------------------------------------------
# vlm_judge.py wiring: build_grade runs stage 2 ONLY for cells that clear stage 1,
# --skip-judge omits it entirely, the board shows the judge's numbers + notes.
# ---------------------------------------------------------------------------

_FAKE_STAGE1_PASS_ROW = {
    "identity_own": 0.95, "identity_max": 0.95, "identity_mean": 0.95,
    "identity_per_anchor": {}, "face_px": 900,
    "age_value": 22.0, "age_anchor": 22.0, "age_delta": 0.0,
    "niqe": 1.0, "laplacian_variance": 300.0, "gloss": 0.001,
    "unavailable": {},
}


def _fake_score_cells_for_stage(images, anchors, *, own_anchor, models=None):
    """Every cell reads as a clean stage-1 pass (a real face, well within the identity
    and face-size floors) -- used so tests can exercise stage 2 wiring without loading
    real FaceNet/MTCNN weights."""
    return [dict(_FAKE_STAGE1_PASS_ROW, image_id=item["image_id"]) for item in images]


def _fake_judge_row(image_id: str, **overrides) -> dict:
    row = {
        "image_id": image_id, "same_person": 58, "apparent_age_reference": 23,
        "apparent_age_candidate": 30, "age_delta": 7, "skin_realism": 55, "gloss": 40,
        "artifacts": 5, "notes": "kind of close, older, glossy", "model": "sonnet",
        "duration_s": 0.01, "cost_usd": 0.0012, "cache_hit": False, "unavailable": {},
    }
    row.update(overrides)
    return row


def test_build_grade_runs_the_judge_only_for_cells_that_pass_stage1(command, tmp_path, monkeypatch):
    plan_file, grade, gate_module, judge_calls = _build_grade_with_fake_stage1_and_judge(
        command, tmp_path, monkeypatch, out_name="judge-wiring-plan",
        judge_row_factory=lambda image_id: _fake_judge_row(image_id),
    )
    gate_document = load_json(Path(grade["gate"]))
    assert judge_calls["n"] == 1  # one BATCH call for every stage-1-passing cell
    assert gate_document["judge_skipped"] is False
    row = gate_document["rows"][0]
    assert row["judge"]["same_person"] == 58
    assert row["judge"]["notes"] == "kind of close, older, glossy"
    assert row["stage1"]["pass"] is True
    # gate.yaml's placeholder judge.same_person_min (80) is not cleared by 58 -- stage 2
    # must fail this cell even though stage 1 passed.
    assert row["stage2"]["pass"] is False
    assert row["pass"] is False
    assert any("same_person" in reason for reason in row["reasons"])

    page_text = Path(grade["page"]).read_text(encoding="utf-8")
    assert "same 58" in page_text
    assert "kind of close, older, glossy" in page_text


def test_build_grade_passes_a_cell_whose_judge_verdict_clears_every_threshold(
    command, tmp_path, monkeypatch,
):
    plan_file, grade, gate_module, judge_calls = _build_grade_with_fake_stage1_and_judge(
        command, tmp_path, monkeypatch, out_name="judge-pass-plan",
        judge_row_factory=lambda image_id: _fake_judge_row(
            image_id, same_person=97, age_delta=1, skin_realism=92, gloss=3, artifacts=2,
            notes="clean match",
        ),
    )
    gate_document = load_json(Path(grade["gate"]))
    assert gate_document["summary"]["passed"] == gate_document["summary"]["total"]
    row = gate_document["rows"][0]
    assert row["pass"] is True
    assert row["stage2"]["pass"] is True
    assert "same 97" in Path(grade["page"]).read_text(encoding="utf-8")


def test_build_grade_skip_judge_never_loads_the_judge_module(command, tmp_path, monkeypatch):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "skip-judge-plan"
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)

    gate_module = command._identity_gate_module()
    monkeypatch.setattr(gate_module, "score_cells_for_stage", _fake_score_cells_for_stage)

    def boom():
        raise AssertionError("must never load the judge module under --skip-judge")

    monkeypatch.setattr(gate_module, "_vlm_judge_module", boom)

    grade = command.build_grade("creator-002", "dataset", plan_file, skip_judge=True)
    gate_document = load_json(Path(grade["gate"]))
    assert gate_document["judge_skipped"] is True
    # stage 1 passes (the fake score module says so) but stage 2 was never attempted --
    # must still fail closed, never a silent pass.
    assert gate_document["rows"][0]["judge"] is None
    assert gate_document["rows"][0]["stage1"]["pass"] is True
    assert gate_document["rows"][0]["pass"] is False
    assert gate_document["rows"][0]["reasons"] == ["unavailable: judge"]
    assert gate_document["summary"]["passed"] == 0


def test_run_identity_gate_delegates_to_identity_gate_run_two_stage_gate(command, tmp_path, monkeypatch):
    """The refactor's contract (identity_gate.py's plan-independent `run` CLI and this
    module's own `build_grade` must share ONE gate composition, never duplicate it):
    `_run_identity_gate` is now a thin wrapper around
    `identity_gate.run_two_stage_gate`. Proof: calling that shared function directly
    on the exact same plan-derived anchors/images/persona/grade_dir `build_grade` used
    produces the byte-identical `figment/gate@1` document `build_grade` itself wrote."""
    plan_file, grade, gate_module, judge_calls = _build_grade_with_fake_stage1_and_judge(
        command, tmp_path, monkeypatch, out_name="delegates-plan",
        judge_row_factory=lambda image_id: _fake_judge_row(image_id),
    )
    gate_document = load_json(Path(grade["gate"]))

    plan, root = command._load_plan("creator-002", plan_file)
    anchors = [(root / value).resolve() for value in plan["assets"]["anchors"]]
    images = command._grading_images(plan, root, "dataset")
    grade_dir = root / "grade" / "dataset"
    persona = command._load_persona_document_for_gate(plan)

    direct_document = gate_module.run_two_stage_gate(
        lambda: persona, anchors, images, grade_dir, skip_judge=False,
    )
    assert direct_document == gate_document


def _build_grade_with_fake_stage1_and_judge(
    command, tmp_path, monkeypatch, *, out_name: str, judge_row_factory,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / out_name
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)

    gate_module = command._identity_gate_module()
    monkeypatch.setattr(gate_module, "score_cells_for_stage", _fake_score_cells_for_stage)

    real_vlm_judge = gate_module._vlm_judge_module()
    judge_calls = {"n": 0}

    class FakeJudgeModule:
        judge_gate = staticmethod(real_vlm_judge.judge_gate)

        @staticmethod
        def judge_images_for_stage(images, references, *, cache_dir=None, **kwargs):
            judge_calls["n"] += 1
            return [judge_row_factory(item["image_id"]) for item in images]

    monkeypatch.setattr(gate_module, "_vlm_judge_module", lambda: FakeJudgeModule())

    grade = command.build_grade("creator-002", "dataset", plan_file)
    return plan_file, grade, gate_module, judge_calls


# ---------------------------------------------------------------------------
# Path-A train-first (r24 method 4 + r21 DOP + r25 causes #4/#5): a curated
# selection of EXISTING evidence (select_training_cells.py + build_training_set.py
# --mode provided) trains the LoRA directly, bypassing the module-10 dataset stage's
# fresh generate-then-grade loop. `build_train_first_plan` is deliberately NOT part
# of the STAGES/build_plan/run_planned_stage state machine -- it reuses the same
# manifest-emission helpers (_train_manifest, _tester_manifest, _pod_base,
# _planned_run) but never touches anchor/dataset/apply_rulings at all.
# ---------------------------------------------------------------------------


def _prebuilt_dataset_dir(path: Path, *, count: int = 2) -> Path:
    """A dataset directory shaped exactly like build_training_set.py's output
    contract -- NN.png/.txt pairs, dataset_manifest.json, _dataset.ready written
    last -- WITHOUT training.json, since build_train_first_plan renders and writes
    that itself (mirroring _install_stage_config's own division of labor)."""
    path.mkdir(parents=True, exist_ok=True)
    files = []
    for index in range(1, count + 1):
        stem = f"{index:02d}"
        (path / f"{stem}.png").write_bytes(PNG_1X1)
        (path / f"{stem}.txt").write_text("creator001krea2 woman\n", encoding="utf-8")
        files.append({"image": f"{stem}.png", "caption_file": f"{stem}.txt", "sha256": "x"})
    (path / "dataset_manifest.json").write_text(
        json.dumps({"count": count, "caption_mode": "provided", "files": files}), encoding="utf-8",
    )
    (path / "_dataset.ready").write_text("", encoding="utf-8")
    return path


def test_build_train_first_plan_emits_train_and_tester_manifests_that_dry_run(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)  # steps=600, save_every=200 -> ladder [200, 400] + final
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset")
    out = tmp_path / "train-first-plan"

    plan = command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )

    assert plan["schema"] == "figment/train-plan@1"
    assert plan["variant"] == "train-first"
    assert plan["assets"]["anchors"]
    for relative in plan["assets"]["anchors"]:
        assert (out / relative).is_file()
    train_path = out / "train" / "runs" / "creator-002-tensor-train-first.yaml"
    tester_path = out / "train" / "runs" / "creator-002-tensor-tester-first.yaml"
    assert train_path.is_file() and tester_path.is_file()

    train_manifest = load_json(train_path)
    dataset_dirname = "creator-002-tensor-dataset-train-first"
    assert train_manifest["uploads"][0]["files"] == [
        f"{dataset_dirname}/*.png", f"{dataset_dirname}/*.txt",
        f"{dataset_dirname}/training.json",
    ]
    assert len(train_manifest["artifacts"]) == 3  # 2 intermediates + final, per steps/save_every

    tester_manifest = load_json(tester_path)
    assert tester_manifest["uploads"][0]["files"] == [
        "out/creator-002-tensor-train-first/*.safetensors",
    ]
    assert len(tester_manifest["jobs"]) == 3

    copied_dataset_dir = out / "train" / "runs" / dataset_dirname
    assert (copied_dataset_dir / "01.png").is_file()
    assert (copied_dataset_dir / "02.png").is_file()
    assert (copied_dataset_dir / "_dataset.ready").is_file()
    rendered = load_json(copied_dataset_dir / "training.json")
    train_section = rendered["config"]["process"][0]["train"]
    assert train_section["steps"] == 600
    assert train_section["diff_output_preservation"] is False
    assert "trigger_word" not in rendered["config"]["process"][0]

    pod_module = command._pod_runner_module()
    for run in (plan["stages"]["train"]["runs"][0], plan["stages"]["tester"]["runs"][0]):
        manifest_path = out / run["manifest"]
        result = subprocess.run(
            run["argv"] + ["--dry-run"], cwd=ROOT, capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr
        pod_module.require_manifest(load_json(manifest_path), manifest_path, allow_missing_uploads=True)


def test_build_train_first_plan_honors_dop_from_the_persona_training_config(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    persona_path = _synthetic_persona(personas_root)
    persona_document = load_json(persona_path)
    persona_document["training"]["dop_enabled"] = True
    persona_document["training"]["dop_multiplier"] = 2.0
    persona_document["training"]["dop_class"] = "woman"
    persona_path.write_text(json.dumps(persona_document, indent=2), encoding="utf-8")
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset")
    out = tmp_path / "train-first-dop"

    command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )

    rendered = load_json(
        out / "train" / "runs" / "creator-002-tensor-dataset-train-first" / "training.json",
    )
    process = rendered["config"]["process"][0]
    assert process["train"]["diff_output_preservation"] is True
    assert process["train"]["diff_output_preservation_multiplier"] == pytest.approx(2.0)
    assert process["train"]["diff_output_preservation_class"] == "woman"
    assert process["trigger_word"] == "creator002krea2"


def test_build_train_first_plan_requires_the_dataset_ready_marker(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    dataset_dir = tmp_path / "not-ready"
    dataset_dir.mkdir()
    (dataset_dir / "01.png").write_bytes(PNG_1X1)

    with pytest.raises(command.FigmentTrainError, match="not ready"):
        command.build_train_first_plan(
            "creator-002", dataset_dir, tmp_path / "out",
            personas_root=personas_root, skip_pin_verify=True,
        )


def test_train_first_cli_subcommand_is_registered_and_parses(command):
    """`main()`'s CLI layer has no way to redirect PERSONAS_ROOT (same as every other
    subcommand -- `plan`'s own CLI is untested against a synthetic persona for the
    identical reason), so this only proves the subcommand exists and its argparse
    wiring is correct; `build_train_first_plan` itself is covered directly above."""
    parser = command.build_parser()
    args = parser.parse_args([
        "train-first", "--creator", "creator-002", "--dataset-dir", "d", "--out", "o",
        "--skip-pin-verify",
    ])
    assert args.command == "train-first"
    assert args.creator == "creator-002"
    assert args.dataset_dir == Path("d")
    assert args.out == Path("o")
    assert args.skip_pin_verify is True


def test_build_train_first_plan_refuses_to_overwrite_an_existing_plan(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset")
    out = tmp_path / "train-first-plan"
    command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )
    with pytest.raises(command.FigmentTrainError, match="refusing to overwrite"):
        command.build_train_first_plan(
            "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
        )


# ---------------------------------------------------------------------------
# Defect fix: train-first is now a first-class VARIANT of the one plan.json schema
# (`figment/train-plan@1`, `variant: "train-first"`) instead of a separately-schemad
# `train_first_plan.json` `run --plan` rejected -- the split the operator wanted gone
# ("slim infra, one pipeline"). These three tests prove `run`/`grade` work UNCHANGED
# against a train-first plan, and that its schema is the normal one plus documented
# extras only.
# ---------------------------------------------------------------------------


def test_build_train_first_plan_shares_the_normal_plan_schema_plus_documented_extras(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset")

    normal_plan = command.build_plan(
        "creator-002", "all", tmp_path / "normal-plan",
        personas_root=personas_root, skip_pin_verify=True,
    )
    train_first_plan = command.build_train_first_plan(
        "creator-002", dataset_dir, tmp_path / "train-first-plan",
        personas_root=personas_root, skip_pin_verify=True,
    )

    assert train_first_plan["schema"] == normal_plan["schema"] == "figment/train-plan@1"
    # "variant" is the ONLY top-level key a train-first plan carries that a normal one
    # doesn't -- everything else (assets, configs, ledger_dir, ...) is the same shape.
    assert set(train_first_plan) - set(normal_plan) == {"variant"}
    assert train_first_plan["variant"] == "train-first"
    assert set(normal_plan) - set(train_first_plan) == set()

    assert set(train_first_plan["stages"]) == {"train", "tester"}
    for stage in ("train", "tester"):
        normal_run = normal_plan["stages"][stage]["runs"][0]
        train_first_run = train_first_plan["stages"][stage]["runs"][0]
        assert set(train_first_run) == set(normal_run), f"runs[] shape differs for {stage!r}"

    # The training block: the persona's own dop_*/steps/save_every are unchanged, plus
    # this variant's one extra fact, which already-built dataset directory it trained
    # from.
    for key in ("dop_enabled", "dop_multiplier", "dop_class", "steps", "save_every"):
        assert train_first_plan["training"][key] == normal_plan["training"][key]
    assert Path(train_first_plan["training"]["dataset_dir"]) == dataset_dir.resolve()
    assert "dataset_dir" not in normal_plan["training"]

    assert train_first_plan["assets"]["anchors"]
    assert train_first_plan["assets"]["persona_dir"] == normal_plan["assets"]["persona_dir"]


def test_train_first_plan_run_stage_all_executes_train_then_tester_in_order(
    command, tmp_path, monkeypatch,
):
    """`run --stage all --plan <train-first plan.json>` must work completely unchanged
    from a normal plan -- same `run_planned_stage`, same `_install_stage_config` skip
    for this variant, same `verify_run_record`/ledger-agreement contract. A fake
    harness runner stands in for the real pod/runpod_run.py subprocess (never launched
    here) and records the order the two stages actually ran in."""
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)  # steps=600, save_every=200 -> 2 checkpoints + final
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset")
    out = tmp_path / "train-first-run"

    ledger_dir = tmp_path / "ledger"
    ledger_dir.mkdir()
    ledger_path = ledger_dir / "figment-2026-09-04.tsv"
    ledger_path.write_text("model\tstep\tusd\n", encoding="utf-8")
    monkeypatch.setattr(command, "LEDGER_DIR", ledger_dir)

    plan = command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )
    assert plan["ledger_dir"] == str(ledger_dir)

    pod_module = command._pod_runner_module()
    order: list[str] = []

    def _fake_harness_run(argv, cwd=None):
        manifest_path = Path(argv[argv.index("--manifest") + 1])
        run_out = Path(argv[argv.index("--out") + 1])
        manifest = load_json(manifest_path)
        order.append(manifest_path.stem)
        run_out.mkdir(parents=True, exist_ok=True)
        pod_id = f"pod-{manifest_path.stem}"
        model = pod_module.gpu_model_label(manifest["gpu"]["type"])
        run_doc = {
            "error": None,
            "pod_id": pod_id,
            "gpu": manifest["gpu"],
            "termination_verified": True,
            "estimated_actual_usd": 0.25,
            "ledger_day": "2026-09-04",
            "placement_attempts": [{
                "pod_id": pod_id, "estimated_actual_usd": 0.25, "termination_verified": True,
            }],
        }
        expected_artifacts = manifest.get("artifacts") or []
        if expected_artifacts:
            run_doc["artifacts"] = [
                {"remote": row["remote"], "bytes": 12} for row in expected_artifacts
            ]
        else:
            run_doc["jobs"] = [
                {
                    "output_name": job["output_name"],
                    "files": [{"bytes": 12} for _ in range(job.get("expected_images", 1))],
                }
                for job in manifest.get("jobs") or []
            ]
        (run_out / "run.json").write_text(json.dumps(run_doc), encoding="utf-8")
        with ledger_path.open("a", encoding="utf-8") as handle:
            handle.write(f"{model}\tpod-create {pod_id}\t0.250000\n")
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(command.subprocess, "run", _fake_harness_run)

    state = command.run_planned_stage("creator-002", "all", out / "plan.json")

    assert order == ["creator-002-tensor-train-first", "creator-002-tensor-tester-first"]
    assert state["status"] == "complete"
    assert state["completed_stages"] == ["train", "tester"]


def test_train_first_plan_grade_stage_tester_works(command, tmp_path):
    """`grade --stage tester` (`build_grade`) must also work unchanged against a
    train-first plan -- proof that `plan["assets"]["anchors"]` is populated with real,
    `out`-relative anchor files the same way a normal plan's is."""
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset")
    out = tmp_path / "train-first-grade"

    plan = command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )
    tester_run = plan["stages"]["tester"]["runs"][0]
    manifest = load_json(out / tester_run["manifest"])
    run_out = out / tester_run["out"]
    run_out.mkdir(parents=True)
    for job in manifest["jobs"]:
        (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)

    grade = command.build_grade("creator-002", "tester", out / "plan.json", skip_judge=True)

    template = load_json(Path(grade["rulings_template"]))
    assert len(template["rulings"]) == len(manifest["jobs"]) == 3
    page_text = Path(grade["page"]).read_text(encoding="utf-8")
    assert "<img" in page_text
    assert "full-resolution" in page_text


# ---------------------------------------------------------------------------
# Defect fix: the train stage's wall-clock budget (job_timeout_seconds/max_minutes/
# ceiling_usd) used to be a static pod-class pin regardless of training.steps and
# training.dop_enabled -- a DOP run's real ~9s/step cost could blow through a fixed 3h
# job_timeout / 270min ceiling mid-training. It must now derive from steps + dop_enabled,
# never dropping below the tensor-pins.yaml floor.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "steps, save_every, dop_enabled, expected_job_timeout_seconds, expected_max_minutes",
    [
        # 2000 steps, no DOP: candidate (2000*2.5+900)*1.35=7965 < the 10800s pin floor,
        # so both job_timeout_seconds and max_minutes stay exactly at the pod-class pin.
        (2000, 500, False, 10800, 270),
        # 1250 steps, DOP (creator-001's real, live training.yaml config): candidate
        # (1250*9.0+900)*1.35=16402.5 -> ceil 16403, above the floor; max_minutes follows
        # from minimum_runtime_minutes on that raised job_timeout (5 artifacts: 4
        # intermediates + final).
        (1250, 250, True, 16403, 351),
        # 1000 steps, DOP: (1000*9.0+900)*1.35=13365, above the floor; 4 artifacts.
        (1000, 250, True, 13365, 297),
        # 3000 steps, no DOP: (3000*2.5+900)*1.35=11340, ABOVE the 10800s job_timeout
        # floor, but minimum_runtime_minutes for that job_timeout (6 artifacts) still
        # comes out under the 270min max_minutes floor -- the two floors are independent
        # per the spec formula, and max_minutes must never drop below its own pin.
        (3000, 500, False, 11340, 270),
    ],
)
def test_train_manifest_budget_derives_from_steps_and_dop(
    command, steps, save_every, dop_enabled,
    expected_job_timeout_seconds, expected_max_minutes,
):
    pins = command._read_json(command.PINS_PATH)
    floor = pins["pod_classes"]["l40s"]["stages"]["train"]
    persona = {"id": "creator-999"}
    training = {
        "trigger": "creator999krea2", "caption_mode": "provided", "pod_class": "l40s",
        "steps": steps, "save_every": save_every, "dop_enabled": dop_enabled,
    }

    manifest = command._train_manifest(persona, training, pins, smoke=False)

    assert manifest["job_timeout_seconds"] == expected_job_timeout_seconds
    assert manifest["max_minutes"] == expected_max_minutes
    # Floors: the pod-class pin is never exceeded downward.
    assert manifest["job_timeout_seconds"] >= floor["job_timeout_seconds"]
    assert manifest["max_minutes"] >= floor["max_minutes"]
    # readiness and per-artifact download allowance are untouched by this defect fix.
    assert manifest["readiness_timeout_seconds"] == floor["readiness_timeout_seconds"] == 3600
    assert manifest["artifact_download_seconds"] == floor["artifact_download_seconds"] == 180

    budget = manifest["_budget"]
    assert budget["per_step_s"] == (9.0 if dop_enabled else 2.5)
    assert budget["steps"] == steps
    assert budget["job_timeout_seconds"] == expected_job_timeout_seconds
    assert budget["max_minutes"] == expected_max_minutes
    assert budget["ceiling_usd"] == command.manifest_ceiling(
        {"price_usd_per_hour": manifest["price_usd_per_hour"], "max_minutes": expected_max_minutes},
    )


def test_train_manifest_budget_never_applies_to_the_smoke_stage(command):
    """The smoke stage always trains steps=100/save_every=50 regardless of the
    persona's real training.steps -- its job_timeout_seconds/max_minutes must stay the
    static pod-class pin, untouched by this defect fix."""
    pins = command._read_json(command.PINS_PATH)
    floor = pins["pod_classes"]["l40s"]["stages"]["smoke"]
    persona = {"id": "creator-999"}
    training = {
        "trigger": "creator999krea2", "caption_mode": "provided", "pod_class": "l40s",
        "steps": 3000, "save_every": 250, "dop_enabled": True,
    }

    manifest = command._train_manifest(persona, training, pins, smoke=True)

    assert manifest["job_timeout_seconds"] == floor["job_timeout_seconds"]
    assert manifest["max_minutes"] == floor["max_minutes"]
    assert "_budget" not in manifest


def test_build_plan_train_run_entry_carries_budget_and_dry_runs_clean_under_dop(
    command, tmp_path,
):
    """End to end through `build_plan`: a DOP persona's `train` run entry in plan.json
    carries the derived `budget`, its manifest's job_timeout_seconds/max_minutes agree
    with it, and the manifest dry-runs clean through the real pod harness (proving
    `require_manifest`'s own max_minutes >= minimum_runtime_minutes check is satisfied,
    not just that the numbers look right in isolation)."""
    personas_root = tmp_path / "personas"
    persona_path = _synthetic_persona(personas_root, creator_id="creator-002")
    persona_document = load_json(persona_path)
    persona_document["training"]["dop_enabled"] = True
    persona_document["training"]["steps"] = 1250
    persona_document["training"]["save_every"] = 250
    persona_path.write_text(json.dumps(persona_document, indent=2), encoding="utf-8")
    out = tmp_path / "dop-train-plan"

    plan = command.build_plan(
        "creator-002", "train", out, personas_root=personas_root, skip_pin_verify=True,
    )

    run = plan["stages"]["train"]["runs"][0]
    manifest = load_json(out / run["manifest"])
    assert run["budget"] == {
        "per_step_s": 9.0, "steps": 1250,
        "job_timeout_seconds": 16403, "max_minutes": 351, "ceiling_usd": "7.61",
    }
    assert manifest["job_timeout_seconds"] == run["budget"]["job_timeout_seconds"]
    assert manifest["max_minutes"] == run["budget"]["max_minutes"]
    assert run["ceiling_usd"] == run["budget"]["ceiling_usd"]
    assert "--max-minutes" in run["argv"]
    assert run["argv"][run["argv"].index("--max-minutes") + 1] == "351"

    result = subprocess.run(run["argv"] + ["--dry-run"], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_build_train_first_plan_train_run_entry_carries_budget(command, tmp_path):
    """The train-first entry point shares `_train_manifest`/`_planned_run` with the
    normal plan, so its `train` run entry must carry the same derived `budget` shape."""
    personas_root = tmp_path / "personas"
    persona_path = _synthetic_persona(personas_root)
    persona_document = load_json(persona_path)
    persona_document["training"]["dop_enabled"] = True
    persona_document["training"]["steps"] = 1000
    persona_document["training"]["save_every"] = 250
    persona_path.write_text(json.dumps(persona_document, indent=2), encoding="utf-8")
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset")
    out = tmp_path / "train-first-budget"

    plan = command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )

    run = plan["stages"]["train"]["runs"][0]
    assert run["budget"] == {
        "per_step_s": 9.0, "steps": 1000,
        "job_timeout_seconds": 13365, "max_minutes": 297, "ceiling_usd": "6.44",
    }
    manifest = load_json(out / run["manifest"])
    assert manifest["job_timeout_seconds"] == 13365
    assert manifest["max_minutes"] == 297
    # tester never carries a budget -- only the train stage's job_timeout_seconds scales
    # with training.steps/dop_enabled.
    assert "budget" not in plan["stages"]["tester"]["runs"][0]


def test_print_train_budget_prints_the_derived_numbers(command, capsys):
    result = {
        "stages": {
            "train": {"runs": [{"budget": {
                "per_step_s": 9.0, "steps": 1250,
                "job_timeout_seconds": 16403, "max_minutes": 351, "ceiling_usd": "7.61",
            }}]},
        },
    }

    command._print_train_budget(result)

    out = capsys.readouterr().out
    assert "steps=1250" in out
    assert "per_step_s=9.0" in out
    assert "job_timeout_seconds=16403" in out
    assert "max_minutes=351" in out
    assert "ceiling_usd=$7.61" in out


def test_print_train_budget_is_silent_when_the_stage_was_not_planned(command, capsys):
    command._print_train_budget({"stages": {"dataset": {"runs": []}}})
    assert capsys.readouterr().out == ""

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

CURRENT_MANIFESTS = {
    # Track-2 Task B1 removed "dataset" from this table: the framing split (D24/D25),
    # the skin-texture clause, and the dropped Impact-Subpack pin all changed what the
    # generator produces for the dataset stage, so it no longer byte-reproduces the
    # hand-written shard-01/02/03 files below (which also predate the fourth "fullbody"
    # manifest). Task E1 replaces this whole reproduction test with a six-stage
    # residue+dry-run check once the hand-written manifests are retired; until then,
    # dataset-stage coverage lives in expand/tests/test_tensor_dataset.py and this file's
    # own creator-002/003 dry-run tests below.
    "smoke": [PIPELINE / "train" / "runs" / "creator-001-tensor-train-smoke.yaml"],
    "train": [PIPELINE / "train" / "runs" / "creator-001-tensor-train.yaml"],
    "tester": [PIPELINE / "train" / "runs" / "creator-001-tensor-tester.yaml"],
}


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


def test_creator001_plan_reproduces_current_manifest_documents_exactly(command, tmp_path):
    out = tmp_path / "creator001-plan"
    plan = command.build_plan("creator-001", "all", out, personas_root=PERSONAS, skip_pin_verify=True)

    for stage, expected_paths in CURRENT_MANIFESTS.items():
        runs = plan["stages"][stage]["runs"]
        assert len(runs) == len(expected_paths)
        for run, expected in zip(runs, expected_paths):
            generated = plan_path(out, run)
            assert canonical_json(generated) == canonical_json(expected)
            assert run["sha256"] == hashlib.sha256(generated.read_bytes()).hexdigest()
            assert run["ceiling_usd"] == command.manifest_ceiling(load_json(generated))
            assert "--max-usd" in run["argv"]
            assert run["cli"] == subprocess.list2cmdline(run["argv"])

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

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
    "dataset": [
        PIPELINE / "expand" / "runs" / f"creator-001-tensor-dataset-shard-{n:02d}.yaml"
        for n in range(1, 4)
    ],
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
    plan = command.build_plan("creator-001", "all", out, personas_root=PERSONAS)

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
    plan = command.build_plan("creator-001", "all", out, personas_root=PERSONAS)
    pins = load_json(PIPELINE / "train" / "tensor-pins.yaml")
    for stage, profile in (("dataset", "dataset"), ("smoke", "train"),
                           ("train", "train"), ("tester", "tester")):
        for run in plan["stages"][stage]["runs"]:
            manifest = load_json(plan_path(out, run))
            assert manifest["models"] == pins["pins"][profile]["models"]
            assert manifest["custom_nodes"] == pins["pins"][profile]["custom_nodes"]


def _synthetic_persona(
    personas_root: Path,
    *,
    creator_id: str = "creator-002",
    anchor_names: tuple = ("a01.jpg", "a02.jpg", "a03.jpg"),
    exemplars: list = ("a02", "a03"),
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
    plan = command.build_plan("creator-003", "all", out, personas_root=personas_root)

    assert plan["training"]["trigger"] == "creator003krea2"
    dataset_manifest = load_json(plan_path(out, plan["stages"]["dataset"]["runs"][0]))
    assert len(dataset_manifest["uploads"][0]["files"]) == 2

    tester = load_json(plan_path(out, plan["stages"]["tester"]["runs"][0]))
    assert len(tester["jobs"]) == 3, "still one tester job (branch) per checkpoint"

    all_runs = [run for stage in plan["stages"].values() for run in stage["runs"]]
    assert len(all_runs) == 6
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
    plan = command.build_plan("creator-002", "all", out, personas_root=personas_root)

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
    assert len(all_runs) == 6
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
    plan = command.build_plan("creator-001", "dataset", out, personas_root=PERSONAS)
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
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root)
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
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root)
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
        })
    template["rulings"][0]["adult_read"] = "ambiguous"
    filled = Path(grade["rulings_template"]).with_name("unsafe.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="safety"):
        command.apply_rulings("creator-002", "dataset", plan_file, filled)

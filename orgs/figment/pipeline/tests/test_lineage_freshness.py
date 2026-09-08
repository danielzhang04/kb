"""Focused freshness tests for Figment review lineage."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


PIPELINE = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


helpers = load_module(
    "figment_freshness_anchor_helpers", PIPELINE / "tests" / "test_anchor_stage.py",
)
train_helpers = load_module(
    "figment_freshness_train_helpers", PIPELINE / "tests" / "test_figment_train.py",
)
gen_helpers = load_module(
    "figment_freshness_gen_helpers", PIPELINE / "tests" / "test_gen_stage.py",
)


@pytest.fixture(scope="module")
def command():
    return load_module("figment_freshness_driver", PIPELINE / "figment_train.py")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def prepared_tester(command, tmp_path: Path, monkeypatch, *, isolated_gate: bool = False):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=600)
    root = tmp_path / "tester"
    plan = command.build_plan(
        "creator-002", "tester", root, personas_root=personas, skip_pin_verify=True,
    )
    helpers._fake_stage_outputs(root, plan, "tester")
    if isolated_gate:
        fake_here = tmp_path / "pipeline-config"
        fake_here.mkdir()
        (fake_here / "gate.yaml").write_bytes((PIPELINE / "gate.yaml").read_bytes())
        monkeypatch.setattr(command, "HERE", fake_here)
    grade = command.build_grade("creator-002", "tester", root / "plan.json", skip_judge=True)
    template = read_json(Path(grade["rulings_template"]))
    template.update(decided_by="operator", decided_at="2026-09-08T12:00:00Z")
    for index, row in enumerate(template["rulings"]):
        row.update(helpers._axes(), decision="keep" if index == 0 else "cull")
    rulings = tmp_path / "filled.json"
    rulings.write_text(json.dumps(template), encoding="utf-8")
    return personas, root, grade, rulings


@pytest.mark.parametrize("mutation", ["image", "training", "threshold"])
def test_apply_rejects_changed_image_config_or_threshold(
    command, tmp_path, monkeypatch, mutation,
):
    personas, root, grade, rulings = prepared_tester(
        command, tmp_path, monkeypatch, isolated_gate=mutation == "threshold",
    )
    if mutation == "image":
        image = Path(read_json(Path(grade["grading_manifest"]))["images"][0]["path"])
        image.write_bytes(b"different image bytes")
    elif mutation == "training":
        helpers._set_training(personas / "creator-002", dop_multiplier=2.0)
    else:
        (command.HERE / "gate.yaml").write_text("changed thresholds\n", encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="stale"):
        command.apply_rulings("creator-002", "tester", root / "plan.json", rulings)


def test_old_rulings_cannot_be_replayed_after_regrade_with_same_image_ids(
    command, tmp_path, monkeypatch,
):
    _, root, grade, old_rulings = prepared_tester(command, tmp_path, monkeypatch)
    image = Path(read_json(Path(grade["grading_manifest"]))["images"][0]["path"])
    image.write_bytes(b"replacement bytes under the same image id")
    command.build_grade("creator-002", "tester", root / "plan.json", skip_judge=True)
    with pytest.raises(command.FigmentTrainError, match="different evaluation subject"):
        command.apply_rulings("creator-002", "tester", root / "plan.json", old_rulings)


def test_train_first_rejects_a_forged_ready_marker(command, tmp_path):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=600)
    dataset = tmp_path / "forged"
    dataset.mkdir()
    (dataset / "_dataset.ready").write_text("", encoding="utf-8")
    (dataset / "dataset_manifest.json").write_text(
        json.dumps({"count": 1, "caption_mode": "provided", "files": []}),
        encoding="utf-8",
    )
    with pytest.raises(command.FigmentTrainError, match="no operator provenance"):
        command.build_train_first_plan(
            "creator-002", dataset, tmp_path / "out",
            personas_root=personas, skip_pin_verify=True,
        )


def test_train_first_rejects_caption_changed_after_operator_acceptance(command, tmp_path):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=600)
    dataset = train_helpers._prebuilt_dataset_dir(
        tmp_path / "accepted", command=command,
    )
    (dataset / "01.txt").write_text("replacement caption\n", encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="stale"):
        command.build_train_first_plan(
            "creator-002", dataset, tmp_path / "out",
            personas_root=personas, skip_pin_verify=True,
        )


def test_train_first_stages_only_the_approved_dataset_inventory(command, tmp_path):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=600)
    dataset = train_helpers._prebuilt_dataset_dir(
        tmp_path / "accepted", command=command,
    )
    outside = tmp_path / "outside-secret.txt"
    outside.write_text("must never be staged\n", encoding="utf-8")
    side_file = dataset / "unlisted-secret.txt"
    try:
        side_file.symlink_to(outside)
    except OSError:
        side_file.write_text(outside.read_text(encoding="utf-8"), encoding="utf-8")

    out = tmp_path / "train-first"
    command.build_train_first_plan(
        "creator-002", dataset, out, personas_root=personas, skip_pin_verify=True,
    )
    staged = out / "train" / "runs" / "creator-002-tensor-dataset-train-first"
    assert not (staged / side_file.name).exists()


def test_train_first_rejects_an_unlisted_file_inserted_after_planning(
    command, tmp_path, monkeypatch,
):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=600)
    dataset = train_helpers._prebuilt_dataset_dir(
        tmp_path / "accepted", command=command,
    )
    out = tmp_path / "train-first"
    command.build_train_first_plan(
        "creator-002", dataset, out, personas_root=personas, skip_pin_verify=True,
    )
    staged = out / "train" / "runs" / "creator-002-tensor-dataset-train-first"
    (staged / "inserted-after-plan.txt").write_text("unapproved\n", encoding="utf-8")
    monkeypatch.setattr(
        command.subprocess, "run",
        lambda *args, **kwargs: pytest.fail("unapproved dataset bytes must not reach the harness"),
    )
    with pytest.raises(command.FigmentTrainError, match="unexpected or missing entries"):
        command.run_planned_stage("creator-002", "train", out / "plan.json")


def test_all_pauses_at_anchor_and_repeat_never_launches_duplicate_work(
    command, tmp_path, monkeypatch,
):
    personas = tmp_path / "personas"
    helpers._synthetic_persona(personas, steps=600)
    ledger_dir = tmp_path / "ledger"
    ledger_dir.mkdir()
    ledger = ledger_dir / "figment-2026-09-08.tsv"
    ledger.write_text("model\tstep\tusd\n", encoding="utf-8")
    monkeypatch.setattr(command, "LEDGER_DIR", ledger_dir)
    root = tmp_path / "all"
    plan = command.build_plan(
        "creator-002", "all", root, personas_root=personas, skip_pin_verify=True,
    )
    calls = []

    def fake_harness(argv, cwd=None):
        manifest_path = Path(argv[argv.index("--manifest") + 1])
        run_out = Path(argv[argv.index("--out") + 1])
        manifest = read_json(manifest_path)
        calls.append(manifest_path.name)
        run_out.mkdir(parents=True, exist_ok=True)
        pod_id = f"pod-{len(calls)}"
        (run_out / "run.json").write_text(json.dumps({
            "error": None, "pod_id": pod_id, "ledger_day": "2026-09-08",
            "termination_verified": True, "estimated_actual_usd": 0.01,
            "placement_attempts": [{
                "pod_id": pod_id, "estimated_actual_usd": 0.01,
                "termination_verified": True,
            }],
            "jobs": [{
                "output_name": job["output_name"],
                "files": [{"bytes": 10} for _ in range(job.get("expected_images", 1))],
            } for job in manifest["jobs"]],
        }), encoding="utf-8")
        model = command._pod_runner_module().gpu_model_label(manifest["gpu"]["type"])
        with ledger.open("a", encoding="utf-8") as handle:
            handle.write(f"{model}\tpod-create {pod_id}\t0.010000\n")
        return type("Result", (), {"returncode": 0})()

    monkeypatch.setattr(command.subprocess, "run", fake_harness)
    with pytest.raises(command.FigmentTrainError, match="anchor stage completed"):
        command.run_planned_stage("creator-002", "all", root / "plan.json")
    assert len(calls) == 2

    with pytest.raises(command.FigmentTrainError, match="no current operator approval"):
        command.run_planned_stage("creator-002", "all", root / "plan.json")
    assert len(calls) == 2

    helpers._fake_stage_outputs(root, plan, "anchor")
    grade = command.build_grade("creator-002", "anchor", root / "plan.json", skip_judge=True)
    template = read_json(Path(grade["rulings_template"]))
    template.update(decided_by="operator", decided_at="2026-09-08T13:00:00Z")
    for index, row in enumerate(template["rulings"]):
        row.update(helpers._axes(), decision="keep" if index == 0 else "cull")
    rulings = tmp_path / "anchor-rulings.json"
    rulings.write_text(json.dumps(template), encoding="utf-8")
    command.apply_rulings("creator-002", "anchor", root / "plan.json", rulings)

    with pytest.raises(command.FigmentTrainError, match="create a fresh plan"):
        command.run_planned_stage("creator-002", "all", root / "plan.json")
    assert len(calls) == 2


def test_unproduced_step_and_changed_checkpoint_bytes_are_rejected(command, tmp_path):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=3000)
    gen_helpers._prepare_accepted_checkpoint(command, personas, tmp_path)
    source = tmp_path / "source-lineage"
    plan = read_json(source / "plan.json")
    with pytest.raises(command.FigmentTrainError, match="was not produced"):
        command.apply_rulings(
            "creator-002", "tester", source / "plan.json",
            source / "tester-rulings.json", checkpoint_step=123,
        )

    accepted_path = source / "grade" / "tester" / "accepted-checkpoint.json"
    accepted = read_json(accepted_path)
    checkpoint = Path(accepted["checkpoint"]["path"])
    original = checkpoint.read_bytes()
    checkpoint.write_bytes(b"x" * len(original))
    with pytest.raises(
        command.FigmentTrainError,
        match="provenance changed|no longer matches the bytes recorded",
    ):
        command.build_plan(
            "creator-002", "gen", tmp_path / "gen",
            personas_root=personas, skip_pin_verify=True,
        )


def test_promotion_rejects_checkpoint_replaced_after_tester_render(
    command, tmp_path,
):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=3000)

    def replace_with_same_length(checkpoint: Path) -> None:
        checkpoint.write_bytes(b"x" * checkpoint.stat().st_size)

    with pytest.raises(command.FigmentTrainError, match="recorded for the completed tester run"):
        gen_helpers._prepare_accepted_checkpoint(
            command, personas, tmp_path, before_apply=replace_with_same_length,
        )


@pytest.mark.parametrize("dry_run_stage", ["train", "tester"])
def test_dry_run_receipts_never_authorize_checkpoint_promotion(
    command, tmp_path, dry_run_stage,
):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=3000)
    with pytest.raises(command.FigmentTrainError, match="dry_run|lacks a real successful"):
        gen_helpers._prepare_accepted_checkpoint(
            command, personas, tmp_path, dry_run_stage=dry_run_stage,
        )


@pytest.mark.parametrize(
    ("receipt_stage", "bad_value"),
    [("train", None), ("tester", "false")],
)
def test_malformed_dry_run_evidence_never_authorizes_checkpoint_promotion(
    command, tmp_path, receipt_stage, bad_value,
):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=3000)

    def corrupt_receipt(checkpoint: Path) -> None:
        source = tmp_path / "source-lineage"
        plan = read_json(source / "plan.json")
        if receipt_stage == "train":
            receipt_path = checkpoint.parent / "run.json"
        else:
            tester_run = plan["stages"]["tester"]["runs"][0]
            receipt_path = source / tester_run["out"] / "run.json"
        receipt = read_json(receipt_path)
        if bad_value is None:
            receipt.pop("dry_run")
        else:
            receipt["dry_run"] = bad_value
        receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

    with pytest.raises(command.FigmentTrainError, match="dry_run|lacks a real successful"):
        gen_helpers._prepare_accepted_checkpoint(
            command, personas, tmp_path, before_apply=corrupt_receipt,
        )


def test_gen_rehashes_staged_checkpoint_immediately_before_launch(
    command, tmp_path, monkeypatch,
):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=3000)
    gen_helpers._prepare_accepted_checkpoint(command, personas, tmp_path)
    out = tmp_path / "gen-plan"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas, skip_pin_verify=True,
    )
    manifest = read_json(out / plan["stages"]["gen"]["runs"][0]["manifest"])
    staged = out / "train" / "runs" / manifest["uploads"][0]["files"][0]
    original = staged.read_bytes()
    staged.write_bytes(b"x" * len(original))
    monkeypatch.setattr(
        command.subprocess, "run",
        lambda *args, **kwargs: pytest.fail("tampered checkpoint must not reach the harness"),
    )
    with pytest.raises(command.FigmentTrainError, match="staged gen checkpoint changed"):
        command.run_planned_stage("creator-002", "gen", out / "plan.json")


def test_train_first_rechecks_rendered_training_config_before_launch(
    command, tmp_path, monkeypatch,
):
    personas = tmp_path / "personas"
    helpers._promoted_persona(personas, steps=600)
    dataset = train_helpers._prebuilt_dataset_dir(
        tmp_path / "accepted", command=command,
    )
    out = tmp_path / "train-first"
    command.build_train_first_plan(
        "creator-002", dataset, out, personas_root=personas, skip_pin_verify=True,
    )
    config = out / "train" / "runs" / "creator-002-tensor-dataset-train-first" / "training.json"
    document = read_json(config)
    document["config"]["process"][0]["train"]["lr"] = 9.9
    config.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setattr(
        command.subprocess, "run",
        lambda *args, **kwargs: pytest.fail("tampered training config must not reach the harness"),
    )
    with pytest.raises(command.FigmentTrainError, match="training.json changed"):
        command.run_planned_stage("creator-002", "train", out / "plan.json")

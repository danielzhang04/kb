"""Focused offline tests for the separate experimental training executor."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from PIL import Image


TRAIN = Path(__file__).resolve().parents[1]
PIPELINE = TRAIN.parent


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


experimental = load_module("figment_execute_compiler", TRAIN / "experimental_train.py")
executor = load_module("figment_execute_executor", TRAIN / "experimental_execute.py")
curate = load_module("figment_execute_curate", TRAIN / "curate_single_seed.py")
lineage = load_module("figment_execute_lineage", PIPELINE / "lineage.py")
production = load_module("figment_execute_production", PIPELINE / "figment_train.py")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_real_recipe_plan(tmp_path: Path) -> tuple[dict, Path, Path]:
    """Use real train pins/recipe with synthetic first-generation fixture images."""
    anchor = production.PERSONAS_ROOT / "creator-001" / "anchors" / "g01.jpg"
    assert anchor.is_file()
    source = tmp_path / "sources"; source.mkdir()
    entries = [{
        "id": "seed-g01", "kind": "seed", "split": "train",
        "caption": "creator001krea2 woman, reference portrait",
        "variation": {"role": "source-seed"},
    }]
    for number in range(1, 20):
        image_path = source / f"variation-{number}.png"
        Image.new("RGB", (24, 16), (number, number + 20, number + 40)).save(image_path)
        provenance = source / f"variation-{number}.provenance.json"
        provenance.write_text(json.dumps({
            "schema": "figment/generated-input-experiment@1", "creator": "creator-001",
            "source": {"reference": "anchors/g01.jpg", "sha256": digest(anchor),
                       "role": "sole original reference; no prior generated candidate supplied"},
            "output": {"file": image_path.name, "sha256": digest(image_path)},
            "review": {"status": "reviewed", "training_eligible": True},
        }), encoding="utf-8")
        entries.append({
            "id": f"variation-{number}", "kind": "derivative", "split": "train",
            "image": image_path.name, "provenance": provenance.name,
            "caption": f"creator001krea2 woman, opaque-clothed fixture variation {number}",
            "variation": {"coverage": f"fixture-{number}"},
        })
    request = tmp_path / "request.json"
    request.write_text(json.dumps({
        "schema": curate.REQUEST_SCHEMA, "creator": "creator-001", "trigger": "creator001krea2",
        "canonical_seed": {"path": "anchors/g01.jpg", "sha256": digest(anchor)}, "entries": entries,
    }), encoding="utf-8")
    dataset = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, dataset, personas_root=production.PERSONAS_ROOT)
    subject = lineage.dataset_subject(dataset)
    curation = json.loads((dataset / "dataset_curation.json").read_text(encoding="utf-8"))
    rows = []
    for curation_row, file_row in zip(curation["entries"], subject["files"], strict=True):
        rows.append({
            "id": curation_row["id"],
            "image": {"name": file_row["image"]["name"], "sha256": file_row["image"]["sha256"]},
            "caption": {"name": file_row["caption"]["name"], "sha256": file_row["caption"]["sha256"]},
            "source": {"logical_path": curation_row["source"]["logical_path"], "sha256": curation_row["source"]["sha256"]},
            "evidence_assertion": True, "state": "observed",
            "adult_presentation": "observed-unambiguous-adult", "clothing": "observed-opaque-intact",
            "real_person_likeness": "no-observed-concern", "resemblance": "observed-unresolved",
            "image_defects": "no-observed-blocking-defect", "caption_accuracy": "observed-caption-matches-image",
        })
    review = tmp_path / "review.json"
    review.write_text(json.dumps({
        "schema": experimental.REVIEW_SCHEMA, "creator": "creator-001",
        "purpose": experimental.PURPOSE, "not_promotable": True,
        "reviewer": {"kind": "agent", "id": "fixture-reviewer"},
        "dataset_subject_sha256": lineage.canonical_sha256(subject), "rows": rows,
    }), encoding="utf-8")
    private = tmp_path / "private"; private.mkdir()
    plans = private / executor.PLAN_ROOT_NAME; plans.mkdir()
    plan = experimental.build_experimental_training_plan(
        "creator-001", dataset, review, Path(executor.PLAN_ROOT_NAME) / "fixture", personas_root=production.PERSONAS_ROOT,
        private_root=private, train_module=production,
    )
    return plan, private / executor.PLAN_ROOT_NAME / "fixture" / "experimental-plan.json", private


def test_default_prepare_stages_only_train_media_and_never_writes_production_records(tmp_path):
    _plan, plan_path, private = make_real_recipe_plan(tmp_path)
    persona_before = digest(production.PERSONAS_ROOT / "creator-001" / "persona.yaml")

    result = executor.execute_experimental_plan(plan_path, Path("prepared"), private_root=private, train_module=production)

    assert result["status"] == "prepared" and result["not_promotable"] is True
    output = private / "prepared"
    receipt = json.loads((output / "experimental-execution.json").read_text(encoding="utf-8"))
    inventory = receipt["staged_train_inventory"]
    assert len(inventory) == 20
    assert [row["index"] for row in inventory] == list(range(1, 21))
    assert all((output / "dataset" / row["image"]["name"]).is_file() for row in inventory)
    assert not list(output.rglob("dataset-approval.json"))
    assert not list(output.rglob("accepted-checkpoint.json"))
    assert digest(production.PERSONAS_ROOT / "creator-001" / "persona.yaml") == persona_before
    manifest = json.loads((output / "runpod-manifest.json").read_text(encoding="utf-8"))
    assert manifest["not_promotable"] is True
    assert manifest["uploads"][-1]["files"] == ["dataset/_dataset.ready"]
    assert all(path.startswith("dataset/") for group in manifest["uploads"] for path in group["files"])


def test_actual_recipe_and_harness_dry_run_accept_generated_manifest(tmp_path):
    _plan, plan_path, private = make_real_recipe_plan(tmp_path)

    result = executor.execute_experimental_plan(plan_path, Path("dryrun"), private_root=private, dry_run=True, train_module=production)

    assert result["status"] == "dry-run-complete"
    receipt = json.loads((private / "dryrun" / "experimental-execution.json").read_text(encoding="utf-8"))
    assert receipt["status"] == "dry-run-complete"
    assert receipt["not_promotable"] is True


def _isolated_accounting(tmp_path: Path, monkeypatch) -> None:
    ledger = tmp_path / "ops-ledger"; ledger.mkdir()
    (ledger / "figment-2026-09-08.tsv").write_text("model\tstep\tusd\nfixture\tprepare\t1.000000\n", encoding="utf-8")
    budget = tmp_path / "budget.yaml"; budget.write_text("daily_usd_limit: 10.00\n", encoding="utf-8")
    monkeypatch.setattr(executor, "OPS_LEDGER_DIR", ledger)
    monkeypatch.setattr(executor, "DAILY_BUDGET_PATH", budget)


def _write_admission(plan_path: Path, plan: dict, manifest: dict, output: Path) -> None:
    root = plan_path.parents[2] / executor.ADMISSION_ROOT_NAME
    root.mkdir()
    manifest_raw = (output / "runpod-manifest.json").read_bytes()
    launcher_raw = (output / "start-training-aitoolkit.sh.template").read_bytes()
    config_raw = (output / "dataset" / "training.json").read_bytes()
    inventory_raw = (output / "staging-inventory.json").read_bytes()
    accounting = executor._accounting_context(executor._runner_module())
    (root / f"{plan['frozen_sha256']}.json").write_text(json.dumps({
        "schema": executor.ADMISSION_SCHEMA, "admission_id": "fixture-admission",
        "plan_sha256": plan["frozen_sha256"],
        "max_usd": production.manifest_ceiling(manifest), "max_minutes": manifest["max_minutes"],
        **accounting,
        "manifest_sha256": hashlib.sha256(manifest_raw).hexdigest(),
        "launcher_sha256": hashlib.sha256(launcher_raw).hexdigest(),
        "training_config_sha256": hashlib.sha256(config_raw).hexdigest(),
        "staging_inventory_sha256": hashlib.sha256(inventory_raw).hexdigest(),
    }), encoding="utf-8")


def test_live_mode_requires_fixed_admission_and_dispatch_marker_blocks_cross_output_retry(tmp_path, monkeypatch):
    _isolated_accounting(tmp_path, monkeypatch)
    plan, plan_path, private = make_real_recipe_plan(tmp_path)
    executor.execute_experimental_plan(plan_path, Path("admission-input"), private_root=private, train_module=production)
    output = private / "admission-input"
    manifest = json.loads((output / "runpod-manifest.json").read_text(encoding="utf-8"))
    _write_admission(plan_path, plan, manifest, output)
    calls: list[dict] = []

    def fake_runner(**kwargs):
        calls.append(kwargs)
        out = kwargs["out_dir"]; out.mkdir(parents=True)
        artifacts = []
        for item in kwargs["manifest"]["artifacts"]:
            target = out / item["local"]
            target.write_bytes(b"fixture diagnostic artifact")
            artifacts.append({
                "remote": item["remote"], "path": item["local"], "type": "output",
                "wait_for": item["wait_for"], "bytes": target.stat().st_size,
            })
        run = {
            "schema": "figment/runpod-run@1", "dry_run": False, "termination_verified": True,
            "pod_id": "fixture-pod", "placement_attempts": [{"pod_id": "fixture-pod", "termination_verified": True}],
            "artifacts": artifacts,
        }
        (out / "run.json").write_text(json.dumps(run), encoding="utf-8")
        return {
            "schema": "figment/runpod-run@1", "dry_run": False, "termination_verified": True,
            "pod_id": "fixture-pod", "placement_attempts": [{"pod_id": "fixture-pod", "termination_verified": True}],
            "artifacts": artifacts,
        }

    result = executor.execute_experimental_plan(plan_path, Path("live-one"), private_root=private, execute=True, train_module=production, runner=fake_runner)
    assert result["status"] == "harness-complete" and len(calls) == 1
    admission_path = private / executor.ADMISSION_ROOT_NAME / f"{plan['frozen_sha256']}.json"
    admission_path.write_text(json.dumps(json.loads(admission_path.read_text(encoding="utf-8")), indent=2), encoding="utf-8")
    with pytest.raises(executor.ExperimentalExecuteError, match="dispatch marker"):
        executor.execute_experimental_plan(plan_path, Path("live-two"), private_root=private, execute=True, train_module=production, runner=fake_runner)
    assert len(calls) == 1
    assert list((private / "experimental-train-dispatch").glob("*.json"))


def test_live_mode_refuses_admission_with_different_ledger_context_before_marker_or_runner(tmp_path, monkeypatch):
    _isolated_accounting(tmp_path, monkeypatch)
    plan, plan_path, private = make_real_recipe_plan(tmp_path)
    executor.execute_experimental_plan(plan_path, Path("admission-input"), private_root=private, train_module=production)
    output = private / "admission-input"
    manifest = json.loads((output / "runpod-manifest.json").read_text(encoding="utf-8"))
    _write_admission(plan_path, plan, manifest, output)
    (tmp_path / "ops-ledger" / "figment-2026-09-08.tsv").write_text(
        "model\tstep\tusd\nfixture\tprepare\t1.000000\nfixture\tchanged\t0.100000\n", encoding="utf-8",
    )

    with pytest.raises(executor.ExperimentalExecuteError, match="does not exactly bind"):
        executor.execute_experimental_plan(plan_path, Path("bad-admission"), private_root=private, execute=True, train_module=production)
    assert not (private / "experimental-train-dispatch").exists()


def test_staged_mutation_before_harness_refuses_without_runner(tmp_path, monkeypatch):
    _plan, plan_path, private = make_real_recipe_plan(tmp_path)
    original = executor._verify_staged
    called = False

    def mutate_then_verify(target, inventory, **kwargs):
        Image.new("RGB", (24, 16), (200, 1, 2)).save(target / "dataset" / inventory[0]["image"]["name"])
        return original(target, inventory, **kwargs)

    def runner(**_kwargs):
        nonlocal called
        called = True
        raise AssertionError("must not call harness")

    monkeypatch.setattr(executor, "_verify_staged", mutate_then_verify)
    with pytest.raises(executor.ExperimentalExecuteError, match="frozen inventory"):
        executor.execute_experimental_plan(plan_path, Path("staged-mutation"), private_root=private, dry_run=True, train_module=production, runner=runner)
    assert called is False


@pytest.mark.parametrize("extra_name", ["unreviewed.png", "unreviewed.txt"])
def test_staged_extra_media_refuses_before_harness(tmp_path, monkeypatch, extra_name):
    _plan, plan_path, private = make_real_recipe_plan(tmp_path)
    original = executor._verify_staged
    called = False

    def add_extra_then_verify(target, inventory, **kwargs):
        extra = target / "dataset" / extra_name
        if extra.suffix == ".png":
            Image.new("RGB", (24, 16), (200, 1, 2)).save(extra)
        else:
            extra.write_text("creator001krea2 unreviewed", encoding="utf-8")
        return original(target, inventory, **kwargs)

    def runner(**_kwargs):
        nonlocal called
        called = True
        raise AssertionError("must not call harness")

    monkeypatch.setattr(executor, "_verify_staged", add_extra_then_verify)
    with pytest.raises(executor.ExperimentalExecuteError, match="unreviewed file"):
        executor.execute_experimental_plan(
            plan_path, Path(f"extra-{extra_name}"), private_root=private,
            dry_run=True, train_module=production, runner=runner,
        )
    assert called is False


def test_live_failure_preserves_dispatch_marker_and_unknown_provider_state(tmp_path, monkeypatch):
    _isolated_accounting(tmp_path, monkeypatch)
    plan, plan_path, private = make_real_recipe_plan(tmp_path)
    executor.execute_experimental_plan(plan_path, Path("admission-input"), private_root=private, train_module=production)
    output = private / "admission-input"
    manifest = json.loads((output / "runpod-manifest.json").read_text(encoding="utf-8"))
    _write_admission(plan_path, plan, manifest, output)

    def failing_runner(**_kwargs):
        raise RuntimeError("fixture ambiguous harness failure")

    with pytest.raises(RuntimeError, match="ambiguous"):
        executor.execute_experimental_plan(plan_path, Path("failed-live"), private_root=private, execute=True, train_module=production, runner=failing_runner)
    receipt = json.loads((private / "failed-live" / "experimental-execution.json").read_text(encoding="utf-8"))
    assert receipt["status"] == "failed"
    assert receipt["detail"]["harness_invoked"] is True
    assert receipt["detail"]["provider_call_status"] == "unknown"
    assert list((private / "experimental-train-dispatch").glob("*.json"))


def test_live_result_with_metadata_but_missing_download_refuses(tmp_path, monkeypatch):
    _isolated_accounting(tmp_path, monkeypatch)
    plan, plan_path, private = make_real_recipe_plan(tmp_path)
    executor.execute_experimental_plan(plan_path, Path("admission-input"), private_root=private, train_module=production)
    output = private / "admission-input"
    manifest = json.loads((output / "runpod-manifest.json").read_text(encoding="utf-8"))
    _write_admission(plan_path, plan, manifest, output)

    def misleading_runner(**kwargs):
        out = kwargs["out_dir"]; out.mkdir(parents=True)
        artifacts = [{
            "remote": item["remote"], "path": item["local"], "type": "output",
            "wait_for": item["wait_for"], "bytes": 99,
        } for item in kwargs["manifest"]["artifacts"]]
        record = {
            "schema": "figment/runpod-run@1", "dry_run": False, "termination_verified": True,
            "pod_id": "fixture-pod", "placement_attempts": [{"pod_id": "fixture-pod", "termination_verified": True}],
            "artifacts": artifacts,
        }
        (out / "run.json").write_text(json.dumps(record), encoding="utf-8")
        return record

    with pytest.raises(executor.ExperimentalExecuteError, match="regular file"):
        executor.execute_experimental_plan(plan_path, Path("missing-artifact"), private_root=private, execute=True, train_module=production, runner=misleading_runner)


def test_runner_receipt_refuses_extra_or_malformed_artifact_entry(tmp_path):
    _plan, plan_path, private = make_real_recipe_plan(tmp_path)
    executor.execute_experimental_plan(plan_path, Path("receipt-input"), private_root=private, train_module=production)
    output = private / "receipt-input"
    manifest = json.loads((output / "runpod-manifest.json").read_text(encoding="utf-8"))
    harness = output / "harness"; harness.mkdir()
    artifacts = []
    for item in manifest["artifacts"]:
        target = harness / item["local"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"fixture diagnostic artifact")
        artifacts.append({
            "remote": item["remote"], "path": item["local"], "type": "output",
            "wait_for": item["wait_for"], "bytes": target.stat().st_size,
        })
    run = {
        "schema": "figment/runpod-run@1", "dry_run": False, "termination_verified": True,
        "pod_id": "fixture-pod", "placement_attempts": [{"pod_id": "fixture-pod", "termination_verified": True}],
        "artifacts": [*artifacts, {}],
    }
    (harness / "run.json").write_text(json.dumps(run), encoding="utf-8")
    with pytest.raises(executor.ExperimentalExecuteError, match="artifact list"):
        executor._verify_live_artifacts(output, {**run, "artifacts": artifacts}, manifest)


def test_rejects_legacy_plan_without_raw_snapshot_before_staging_or_runner(tmp_path):
    plan, plan_path, private = make_real_recipe_plan(tmp_path)
    legacy = json.loads(plan_path.read_text(encoding="utf-8"))
    legacy["frozen_inputs"].pop("review_snapshot")
    legacy["frozen_sha256"] = hashlib.sha256(experimental._canonical(legacy)).hexdigest()
    plan_path.write_text(json.dumps(legacy), encoding="utf-8")
    called = False

    def runner(**_kwargs):
        nonlocal called
        called = True
        raise AssertionError("must not run")

    with pytest.raises(executor.ExperimentalExecuteError, match="review snapshot"):
        executor.execute_experimental_plan(plan_path, Path("legacy"), private_root=private, dry_run=True, train_module=production, runner=runner)
    assert called is False and not (private / "legacy").exists()


def test_refuses_mutated_retained_image_before_runner(tmp_path):
    _plan, plan_path, private = make_real_recipe_plan(tmp_path)
    value = json.loads(plan_path.read_text(encoding="utf-8"))
    dataset = Path(value["inputs"]["dataset_locator"])
    first = json.loads((dataset / "dataset_manifest.json").read_text(encoding="utf-8"))["files"][0]["image"]
    Image.new("RGB", (24, 16), (250, 1, 2)).save(dataset / first)
    with pytest.raises(executor.ExperimentalExecuteError, match="revalidation"):
        executor.execute_experimental_plan(plan_path, Path("mutated"), private_root=private, dry_run=True, train_module=production)
    assert not (private / "mutated").exists()

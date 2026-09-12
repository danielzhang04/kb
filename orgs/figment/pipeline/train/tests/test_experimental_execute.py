"""Focused offline tests for the separate experimental training executor."""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
import textwrap
import traceback
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


def make_real_recipe_plan(
    tmp_path: Path, *, cropped: bool = False, training_seed: int | None = None,
) -> tuple[dict, Path, Path]:
    """Use real train pins/recipe with synthetic first-generation fixture images.

    ``cropped=True`` switches variation-1 to a version 2 request row with an actual
    crop transform (nonuniform proper subrectangle of the 24x16 fixture image) and
    emits matching version 2 review rows (crop row binds its real image hash and
    transform; every other row binds a null transform). Legacy callers that omit
    both keyword arguments get byte-identical behavior to the prior fixture.
    """
    anchor = production.PERSONAS_ROOT / "creator-001" / "anchors" / "g01.jpg"
    assert anchor.is_file()
    source = tmp_path / "sources"; source.mkdir()
    entries = [{
        "id": "seed-g01", "kind": "seed", "split": "train",
        "caption": "creator001krea2 woman, reference portrait",
        "variation": {"role": "source-seed"},
    }]
    crop_box = [2, 1, 20, 15]
    for number in range(1, 20):
        image_path = source / f"variation-{number}.png"
        fixture_image = Image.new("RGB", (24, 16), (number, number + 20, number + 40))
        if cropped and number == 1:
            # The crop parent must be nonuniform so cropped vs. uncropped bytes actually differ.
            for x in range(24):
                for y in range(16):
                    fixture_image.putpixel((x, y), ((number + x) % 256, (number + y + 3) % 256, (number + x + y) % 256))
        fixture_image.save(image_path)
        provenance = source / f"variation-{number}.provenance.json"
        provenance.write_text(json.dumps({
            "schema": "figment/generated-input-experiment@1", "creator": "creator-001",
            "source": {"reference": "anchors/g01.jpg", "sha256": digest(anchor),
                       "role": "sole original reference; no prior generated candidate supplied"},
            "output": {"file": image_path.name, "sha256": digest(image_path)},
            "review": {"status": "reviewed", "training_eligible": True},
        }), encoding="utf-8")
        entry = {
            "id": f"variation-{number}", "kind": "derivative", "split": "train",
            "image": image_path.name, "provenance": provenance.name,
            "caption": f"creator001krea2 woman, opaque-clothed fixture variation {number}",
            "variation": {"coverage": f"fixture-{number}"},
        }
        if cropped and number == 1:
            entry["transform"] = {"op": "crop", "box": crop_box}
        entries.append(entry)
    request = tmp_path / "request.json"
    request.write_text(json.dumps({
        "schema": "figment/single-seed-curation-request@2" if cropped else curate.REQUEST_SCHEMA,
        "creator": "creator-001", "trigger": "creator001krea2",
        "canonical_seed": {"path": "anchors/g01.jpg", "sha256": digest(anchor)}, "entries": entries,
    }), encoding="utf-8")
    dataset = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, dataset, personas_root=production.PERSONAS_ROOT)
    subject = lineage.dataset_subject(dataset)
    curation = json.loads((dataset / "dataset_curation.json").read_text(encoding="utf-8"))
    rows = []
    for curation_row, file_row in zip(curation["entries"], subject["files"], strict=True):
        row = {
            "id": curation_row["id"],
            "image": {"name": file_row["image"]["name"], "sha256": file_row["image"]["sha256"]},
            "caption": {"name": file_row["caption"]["name"], "sha256": file_row["caption"]["sha256"]},
            "source": {"logical_path": curation_row["source"]["logical_path"], "sha256": curation_row["source"]["sha256"]},
            "evidence_assertion": True, "state": "observed",
            "adult_presentation": "observed-unambiguous-adult", "clothing": "observed-opaque-intact",
            "real_person_likeness": "no-observed-concern", "resemblance": "observed-unresolved",
            "image_defects": "no-observed-blocking-defect", "caption_accuracy": "observed-caption-matches-image",
        }
        if cropped:
            row["transform"] = curation_row.get("transform")
        rows.append(row)
    review = tmp_path / "review.json"
    review_schema = experimental.REVIEW_SCHEMA_V2 if cropped else experimental.REVIEW_SCHEMA
    review.write_text(json.dumps({
        "schema": review_schema, "creator": "creator-001",
        "purpose": experimental.PURPOSE, "not_promotable": True,
        "reviewer": {"kind": "agent", "id": "fixture-reviewer"},
        "dataset_subject_sha256": lineage.canonical_sha256(subject), "rows": rows,
    }), encoding="utf-8")
    private = tmp_path / "private"; private.mkdir()
    plans = private / executor.PLAN_ROOT_NAME; plans.mkdir()
    plan = experimental.build_experimental_training_plan(
        "creator-001", dataset, review, Path(executor.PLAN_ROOT_NAME) / "fixture", personas_root=production.PERSONAS_ROOT,
        private_root=private, train_module=production,
        **({} if training_seed is None else {"training_seed": training_seed}),
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


def _crop_row_image_name(plan: dict, *, row_id: str = "variation-1") -> str:
    curation_entries = plan["frozen_inputs"]["curation"]["entries"]
    subject_files = plan["frozen_inputs"]["dataset_subject"]["files"]
    index = next(i for i, entry in enumerate(curation_entries) if entry["id"] == row_id)
    return subject_files[index]["image"]["name"]


@pytest.mark.parametrize("mode", ["prepare", "dry_run"])
def test_v2_crop_and_explicit_seed_stage_actual_crop_bytes_and_render_config_seed(tmp_path, mode):
    plan, plan_path, private = make_real_recipe_plan(tmp_path, cropped=True, training_seed=20260911)
    dataset = Path(json.loads(plan_path.read_text(encoding="utf-8"))["inputs"]["dataset_locator"])
    cropped_name = _crop_row_image_name(plan)
    parent_bytes = (tmp_path / "sources" / "variation-1.png").read_bytes()
    expected_crop = Image.open(dataset / cropped_name).tobytes()
    persona_path = production.PERSONAS_ROOT / "creator-001" / "persona.yaml"
    persona_before = digest(persona_path)

    result = executor.execute_experimental_plan(
        plan_path, Path(f"crop-and-seed-{mode}"), private_root=private,
        dry_run=(mode == "dry_run"), train_module=production,
    )

    assert result["status"] == ("dry-run-complete" if mode == "dry_run" else "prepared")
    output = private / f"crop-and-seed-{mode}"
    staged_path = output / "dataset" / cropped_name
    staged_bytes = Image.open(staged_path).tobytes()
    assert staged_bytes == expected_crop
    assert staged_bytes != Image.open(tmp_path / "sources" / "variation-1.png").tobytes()
    assert staged_path.read_bytes() != parent_bytes

    receipt = json.loads((output / "experimental-execution.json").read_text(encoding="utf-8"))
    inventory = receipt["staged_train_inventory"]
    assert len(inventory) == 20
    dataset_files = list((output / "dataset").iterdir())
    assert len(dataset_files) == 42
    assert {path.name for path in dataset_files} - {row["image"]["name"] for row in inventory} - {row["caption"]["name"] for row in inventory} == {"training.json", "_dataset.ready"}
    assert not list(output.rglob("dataset-approval.json"))
    assert not list(output.rglob("accepted-checkpoint.json"))

    config = json.loads((output / "dataset" / "training.json").read_text(encoding="utf-8"))
    assert config["config"]["process"][0]["training_seed"] == 20260911
    config_hash = hashlib.sha256((output / "dataset" / "training.json").read_bytes()).hexdigest()
    inventory_doc = json.loads((output / "staging-inventory.json").read_text(encoding="utf-8"))
    assert inventory_doc["training_config_sha256"] == config_hash
    manifest = json.loads((output / "runpod-manifest.json").read_text(encoding="utf-8"))
    assert manifest["experimental_training_config_sha256"] == config_hash
    assert receipt["manifest_sha256"] == hashlib.sha256((output / "runpod-manifest.json").read_bytes()).hexdigest()
    assert digest(persona_path) == persona_before


def test_crop_mutation_after_plan_compilation_refuses_before_runner_or_dispatch(tmp_path):
    plan, plan_path, private = make_real_recipe_plan(tmp_path, cropped=True, training_seed=20260911)
    dataset = Path(json.loads(plan_path.read_text(encoding="utf-8"))["inputs"]["dataset_locator"])
    cropped_name = _crop_row_image_name(plan)
    Image.new("RGB", (18, 14), (250, 5, 5)).save(dataset / cropped_name)

    def runner(**_kwargs):
        raise AssertionError("must not call harness")

    with pytest.raises(executor.ExperimentalExecuteError, match="revalidation refused"):
        executor.execute_experimental_plan(
            plan_path, Path("crop-mutated"), private_root=private, execute=True,
            train_module=production, runner=runner,
        )
    assert not (private / "crop-mutated").exists()
    assert not (private / executor.ADMISSION_ROOT_NAME).exists()
    assert not (private / "experimental-train-dispatch").exists()


def test_source_mutation_after_revalidation_refuses_at_copy_before_runner(tmp_path, monkeypatch):
    plan, plan_path, private = make_real_recipe_plan(tmp_path, cropped=True, training_seed=20260911)
    dataset = Path(json.loads(plan_path.read_text(encoding="utf-8"))["inputs"]["dataset_locator"])
    cropped_name = _crop_row_image_name(plan)

    real_experimental = executor._experimental_module()
    real_revalidate = real_experimental.revalidate_experimental_plan
    state = {"calls": 0}

    class Wrapped:
        def __getattr__(self, item):
            return getattr(real_experimental, item)

        def revalidate_experimental_plan(self, plan_arg, **kwargs):
            context = real_revalidate(plan_arg, **kwargs)
            state["calls"] += 1
            if state["calls"] == 1:
                # Mutate only after the real revalidation has already passed once,
                # so the failure below must come from the staging copy hash check.
                Image.new("RGB", (18, 14), (7, 8, 9)).save(dataset / cropped_name)
            return context

    wrapped = Wrapped()
    monkeypatch.setattr(executor, "_experimental_module", lambda: wrapped)

    def runner(**_kwargs):
        raise AssertionError("must not call harness")

    with pytest.raises(executor.ExperimentalExecuteError, match="hash no longer matches"):
        executor.execute_experimental_plan(
            plan_path, Path("copy-check"), private_root=private, dry_run=True,
            train_module=production, runner=runner,
        )
    assert not (private / "copy-check").exists()


class _AuthSession:
    def __init__(self, fixture):
        self.fixture = fixture
        self.close_calls = 0
        self.request_calls = 0

    def request(self, *_args, **_kwargs):
        self.request_calls += 1
        raise AssertionError("default-auth regression fixture must not call a provider")

    def close(self):
        self.close_calls += 1
        self.fixture.events.append("close")
        if self.fixture.close_error is not None:
            raise self.fixture.close_error


class _AuthRedactor:
    def redact(self, value):
        return str(value).replace("secondary-secret", "[redacted]")


class _AuthLogger:
    def __init__(self, fixture):
        self.fixture = fixture
        self.messages: list[tuple[str, tuple[object, ...]]] = []

    def __getattr__(self, name):
        def log(*args, **_kwargs):
            self.messages.append((name, args))
            self.fixture.events.append(f"logger:{name}")
        return log


class _AuthAPI:
    def __init__(self, fixture, session):
        self.fixture = fixture
        self.session = session
        self.fixture.events.append("api")
        if self.fixture.api_error is not None:
            raise self.fixture.api_error


class _AuthRunnerModule:
    """Offline harness surface used by default-runner authentication regressions."""

    def __init__(self, fixture):
        self.fixture = fixture
        self.sessions: list[_AuthSession] = []
        self.harness_calls: list[dict] = []
        self.logger: _AuthLogger | None = None
        self.hook_calls: list[tuple[type[BaseException], BaseException]] = []

        def redacting_hook(exc_type, exc, _traceback):
            self.hook_calls.append((exc_type, exc))
            self.fixture.events.append("terminal-redaction-called")
        self.hook = redacting_hook

    @property
    def redacting_excepthook(self):
        self.fixture.events.append("terminal-redaction")
        if self.fixture.hook_missing:
            raise self.fixture.hook_error or AttributeError("redacting_excepthook")
        if self.fixture.hook_error is not None:
            raise self.fixture.hook_error
        return self.hook

    def build_authenticated_session(self):
        self.fixture.events.append("factory")
        if self.fixture.factory_error is not None:
            raise self.fixture.factory_error
        session = _AuthSession(self.fixture)
        self.sessions.append(session)
        return session, self.fixture.redactor

    def RunPodAPI(self, session):
        return _AuthAPI(self.fixture, session)

    def build_logger(self, redactor):
        self.fixture.events.append("logger")
        if self.fixture.logger_error is not None:
            raise self.fixture.logger_error
        assert redactor is self.fixture.redactor
        self.logger = _AuthLogger(self.fixture)
        return self.logger

    def run_harness(self, manifest, manifest_path, out_dir, **kwargs):
        self.fixture.events.append("harness")
        self.harness_calls.append({
            "manifest": manifest, "manifest_path": manifest_path, "out_dir": out_dir, **kwargs,
        })
        if self.fixture.harness_error is not None:
            try:
                raise self.fixture.harness_error
            except BaseException:
                self.fixture.primary_traceback = self.fixture.harness_error.__traceback__
                raise
        if kwargs["dry_run"]:
            return {
                "schema": "figment/runpod-run@1", "dry_run": True,
                "termination_verified": True, "artifacts": [],
            }

        out_dir.mkdir(parents=True, exist_ok=True)
        artifacts = []
        for item in manifest["artifacts"]:
            target = out_dir / item["local"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"offline auth regression artifact")
            artifacts.append({
                "remote": item["remote"], "path": item["local"], "type": "output",
                "wait_for": item["wait_for"], "bytes": target.stat().st_size,
            })
        result = {
            "schema": "figment/runpod-run@1", "dry_run": False,
            "termination_verified": True, "pod_id": "fixture-pod",
            "placement_attempts": [{"pod_id": "fixture-pod", "termination_verified": True}],
            "artifacts": artifacts,
        }
        (out_dir / "run.json").write_text(json.dumps(result), encoding="utf-8")
        return self.fixture.result if self.fixture.result is not None else result


class _AuthFixture:
    def __init__(self):
        self.events: list[str] = []
        self.receipts: list[dict] = []
        self.markers: list[Path] = []
        self.redactor = _AuthRedactor()
        self.factory_error: BaseException | None = None
        self.api_error: BaseException | None = None
        self.logger_error: BaseException | None = None
        self.harness_error: BaseException | None = None
        self.close_error: BaseException | None = None
        self.hook_error: BaseException | None = None
        self.hook_missing = False
        self.result: dict | None = None
        self.verify_error: BaseException | None = None
        self.receipt_errors: dict[str, BaseException] = {}
        self.primary_traceback = None
        self.runner = _AuthRunnerModule(self)


def _default_auth_case(tmp_path: Path, monkeypatch):
    """Prepare only synthetic inputs; live accounting, marker, and receipt are faked."""
    plan, plan_path, private = make_real_recipe_plan(tmp_path)
    fixture = _AuthFixture()
    fixture.original_excepthook = sys.excepthook
    monkeypatch.setattr(sys, "excepthook", fixture.original_excepthook)
    accounting = {
        "ledger_dir": "fixture-ledger", "daily_budget_path": "fixture-budget",
        "arc_cap_usd": 50.0, "arc_ledger_glob": "fixture-arc-*.tsv",
        "ledger_snapshot_sha256": "a" * 64, "arc_usd_before": 0.0,
    }

    def admission(_private, *, plan_hash, manifest, train, manifest_sha256,
                  launcher_sha256, training_config_sha256, staging_inventory_sha256):
        fixture.events.append("admission")
        assert plan_hash == plan["frozen_sha256"]
        assert manifest_sha256 and launcher_sha256 and training_config_sha256 and staging_inventory_sha256
        assert train is production and manifest["not_promotable"] is True
        return ({"admission_id": "fixture-auth-admission"}, "b" * 64, "c" * 64, accounting)

    def marker(marker_private, plan_hash, admission_hash, admission_value):
        fixture.events.append("marker")
        assert marker_private == private and plan_hash == plan["frozen_sha256"]
        assert admission_hash == "b" * 64 and admission_value["admission_id"] == "fixture-auth-admission"
        path = private / "fixture-auth-markers" / "dispatch.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text("fixture marker", encoding="utf-8")
        fixture.markers.append(path)
        return path

    def receipt(_target, *, status, plan_hash, manifest_hash, inventory, mode, detail):
        fixture.events.append(f"receipt:{status}")
        assert plan_hash == plan["frozen_sha256"] and manifest_hash and inventory
        fixture.receipts.append({"status": status, "mode": mode, "detail": copy.deepcopy(detail)})
        if status in fixture.receipt_errors:
            raise fixture.receipt_errors[status]

    def verify(_target, result, manifest):
        fixture.events.append("verify")
        assert manifest["not_promotable"] is True
        if fixture.verify_error is not None:
            raise fixture.verify_error
        assert result["dry_run"] is False
        return {"fixture-artifact.safetensors": "d" * 64}

    monkeypatch.setattr(executor, "_runner_module", lambda: fixture.runner)
    monkeypatch.setattr(executor, "_admission", admission)
    monkeypatch.setattr(executor, "_dispatch_marker", marker)
    monkeypatch.setattr(executor, "_receipt", receipt)
    monkeypatch.setattr(executor, "_verify_live_artifacts", verify)
    return plan_path, private, fixture


def _run_default_auth(plan_path: Path, private: Path):
    return executor.execute_experimental_plan(
        plan_path, Path("default-auth-live"), private_root=private, execute=True,
        train_module=production,
    )


def _assert_no_provider_calls(fixture: _AuthFixture):
    assert all(session.request_calls == 0 for session in fixture.runner.sessions)


@pytest.mark.parametrize("mode", ["prepare", "dry-run", "injected-live"])
def test_nondefault_modes_never_prepare_default_auth(tmp_path, monkeypatch, mode):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    factory_error = AssertionError("default authentication must not be touched")
    fixture.factory_error = factory_error

    if mode == "prepare":
        result = executor.execute_experimental_plan(plan_path, Path("prepare"), private_root=private, train_module=production)
        assert result["status"] == "prepared"
    elif mode == "dry-run":
        result = executor.execute_experimental_plan(plan_path, Path("dry"), private_root=private, dry_run=True, train_module=production)
        assert result["status"] == "dry-run-complete"
        assert len(fixture.runner.harness_calls) == 1
    else:
        result = executor.execute_experimental_plan(
            plan_path, Path("injected"), private_root=private, execute=True, train_module=production,
            runner=fixture.runner.run_harness,
        )
        assert result["status"] == "harness-complete"
        assert len(fixture.runner.harness_calls) == 1

    assert "factory" not in fixture.events
    assert fixture.runner.sessions == []
    assert sys.excepthook is fixture.original_excepthook
    _assert_no_provider_calls(fixture)


def test_default_live_auth_passes_exact_dependencies_and_closes_before_success_receipt(tmp_path, monkeypatch):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)

    result = _run_default_auth(plan_path, private)

    assert result["status"] == "harness-complete"
    assert fixture.events.index("admission") < fixture.events.index("factory")
    assert fixture.events.index("terminal-redaction") < fixture.events.index("api")
    assert fixture.events.index("terminal-redaction") < fixture.events.index("logger") < fixture.events.index("marker")
    assert fixture.events.index("close") < fixture.events.index("receipt:harness-complete")
    assert len(fixture.runner.sessions) == 1 and fixture.runner.sessions[0].close_calls == 1
    assert len(fixture.runner.harness_calls) == 1
    call = fixture.runner.harness_calls[0]
    assert call["api"].session is fixture.runner.sessions[0]
    assert call["logger"] is fixture.runner.logger and call["redactor"] is fixture.redactor
    assert [receipt["status"] for receipt in fixture.receipts].count("harness-complete") == 1
    assert fixture.markers and all(path.exists() for path in fixture.markers)
    assert sys.excepthook is fixture.runner.hook
    _assert_no_provider_calls(fixture)


def test_default_auth_factory_failure_is_preownership_without_marker_or_close(tmp_path, monkeypatch):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    factory_error = RuntimeError("factory-primary")
    fixture.factory_error = factory_error

    with pytest.raises(RuntimeError) as raised:
        _run_default_auth(plan_path, private)

    assert raised.value is factory_error
    assert fixture.markers == [] and fixture.runner.sessions == [] and fixture.runner.harness_calls == []
    assert "close" not in fixture.events
    _assert_no_provider_calls(fixture)


@pytest.mark.parametrize("field", ["api_error", "logger_error"])
def test_default_auth_setup_failure_preserves_primary_and_closes_once_before_marker(tmp_path, monkeypatch, field):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    primary = RuntimeError(f"{field}-primary")
    setattr(fixture, field, primary)

    with pytest.raises(RuntimeError) as raised:
        _run_default_auth(plan_path, private)

    assert raised.value is primary
    assert len(fixture.runner.sessions) == 1 and fixture.runner.sessions[0].close_calls == 1
    assert fixture.markers == [] and fixture.runner.harness_calls == []
    _assert_no_provider_calls(fixture)


@pytest.mark.parametrize("failure", ["missing", "throwing"])
def test_default_auth_terminal_redaction_setup_failure_closes_once_before_marker(tmp_path, monkeypatch, failure):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    primary = AttributeError("redacting_excepthook") if failure == "missing" else RuntimeError("hook-primary")
    if failure == "missing":
        fixture.hook_missing = True
    fixture.hook_error = primary

    with pytest.raises(type(primary)) as raised:
        _run_default_auth(plan_path, private)

    assert raised.value is primary
    assert len(fixture.runner.sessions) == 1 and fixture.runner.sessions[0].close_calls == 1
    assert fixture.markers == [] and fixture.runner.harness_calls == []
    failed = next(receipt for receipt in fixture.receipts if receipt["status"] == "failed")
    assert failed["detail"]["error_class"] == "terminal-redaction"
    assert sys.excepthook is fixture.original_excepthook
    _assert_no_provider_calls(fixture)


@pytest.mark.parametrize("failure", ["marker", "dispatched-receipt"])
def test_default_auth_marker_and_dispatched_receipt_failures_close_without_provider_call(tmp_path, monkeypatch, failure):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    primary = RuntimeError(f"{failure}-primary")
    if failure == "marker":
        def broken_marker(*_args, **_kwargs):
            fixture.events.append("marker")
            raise primary
        monkeypatch.setattr(executor, "_dispatch_marker", broken_marker)
    else:
        fixture.receipt_errors["dispatched"] = primary

    with pytest.raises(RuntimeError) as raised:
        _run_default_auth(plan_path, private)
    assert raised.value is primary
    assert fixture.runner.sessions[0].close_calls == 1 and fixture.runner.harness_calls == []
    if failure == "marker":
        assert fixture.markers == []
    else:
        assert fixture.markers and all(path.exists() for path in fixture.markers)
    _assert_no_provider_calls(fixture)


def test_default_auth_harness_baseexception_keeps_marker_and_closes_once(tmp_path, monkeypatch):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    primary = KeyboardInterrupt("harness-primary")
    fixture.harness_error = primary

    with pytest.raises(KeyboardInterrupt) as raised:
        _run_default_auth(plan_path, private)

    assert raised.value is primary
    assert fixture.runner.sessions[0].close_calls == 1
    assert fixture.markers and all(path.exists() for path in fixture.markers)
    assert [item["status"] for item in fixture.receipts].count("failed") == 1
    _assert_no_provider_calls(fixture)


def test_default_auth_invalid_result_refuses_before_artifact_verification(tmp_path, monkeypatch):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    fixture.result = {"schema": "figment/not-a-run@1", "dry_run": False}
    verifier_calls = []

    def verifier_must_not_run(*_args, **_kwargs):
        verifier_calls.append(True)
        raise AssertionError("invalid harness result reached artifact verification")

    monkeypatch.setattr(executor, "_verify_live_artifacts", verifier_must_not_run)

    with pytest.raises(executor.ExperimentalExecuteError) as raised:
        _run_default_auth(plan_path, private)

    assert isinstance(raised.value, executor.ExperimentalExecuteError)
    assert verifier_calls == []
    assert fixture.runner.sessions[0].close_calls == 1
    assert fixture.markers and all(path.exists() for path in fixture.markers)
    assert [item["status"] for item in fixture.receipts].count("failed") == 1
    _assert_no_provider_calls(fixture)


def test_default_auth_artifact_failure_closes_and_keeps_marker(tmp_path, monkeypatch):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    primary = executor.ExperimentalExecuteError("artifact-primary")
    fixture.verify_error = primary

    with pytest.raises(executor.ExperimentalExecuteError) as raised:
        _run_default_auth(plan_path, private)

    assert raised.value is primary
    assert fixture.runner.sessions[0].close_calls == 1
    assert fixture.markers and all(path.exists() for path in fixture.markers)
    assert [item["status"] for item in fixture.receipts].count("failed") == 1
    _assert_no_provider_calls(fixture)


def test_default_auth_final_receipt_failure_happens_after_close(tmp_path, monkeypatch):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    final_error = RuntimeError("final-receipt-primary")
    fixture.receipt_errors["harness-complete"] = final_error

    with pytest.raises(RuntimeError) as raised:
        _run_default_auth(plan_path, private)

    assert raised.value is final_error
    assert fixture.runner.sessions[0].close_calls == 1
    assert fixture.events.index("close") < fixture.events.index("receipt:harness-complete")
    assert fixture.markers and all(path.exists() for path in fixture.markers)
    _assert_no_provider_calls(fixture)


def _traceback_contains(head, expected) -> bool:
    while head is not None:
        if head is expected:
            return True
        head = head.tb_next
    return False


@pytest.mark.parametrize("secondary", ["failed-receipt", "close"])
def test_default_auth_primary_failure_survives_secondary_failure_without_secret_text(tmp_path, monkeypatch, secondary):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    primary = RuntimeError("primary-error")
    fixture.harness_error = primary
    secondary_error = RuntimeError("secondary-secret")
    if secondary == "failed-receipt":
        fixture.receipt_errors["failed"] = secondary_error
    else:
        fixture.close_error = secondary_error

    with pytest.raises(RuntimeError) as raised:
        _run_default_auth(plan_path, private)

    assert raised.value is primary
    assert fixture.runner.sessions[0].close_calls == 1
    assert _traceback_contains(raised.value.__traceback__, fixture.primary_traceback)
    assert not _traceback_contains(raised.value.__traceback__, secondary_error.__traceback__)
    traceback_text = "".join(traceback.format_tb(raised.value.__traceback__))
    assert "run_harness" in traceback_text
    assert "secondary-secret" not in "".join(
        str(value) for receipt in fixture.receipts for value in receipt.values()
    )
    assert "secondary-secret" not in " ".join(
        str(message) for message in (fixture.runner.logger.messages if fixture.runner.logger else [])
    )
    assert all("secondary-secret" not in note for note in getattr(primary, "__notes__", []))
    assert fixture.markers and all(path.exists() for path in fixture.markers)
    _assert_no_provider_calls(fixture)


def test_default_auth_close_only_failure_refuses_success_receipt(tmp_path, monkeypatch):
    plan_path, private, fixture = _default_auth_case(tmp_path, monkeypatch)
    fixture.close_error = RuntimeError("secondary-secret")

    with pytest.raises(executor.ExperimentalExecuteError) as raised:
        _run_default_auth(plan_path, private)

    assert "secondary-secret" not in str(raised.value)
    assert fixture.runner.sessions[0].close_calls == 1
    statuses = [item["status"] for item in fixture.receipts]
    assert "harness-complete" not in statuses and "failed" in statuses
    cleanup = next(item for item in fixture.receipts if item["status"] == "failed")
    assert cleanup["detail"]["error_class"] == "session-cleanup"
    assert fixture.markers and all(path.exists() for path in fixture.markers)
    _assert_no_provider_calls(fixture)


def test_default_auth_terminal_hook_redacts_an_uncaught_chained_harness_failure_in_main(tmp_path):
    """Exercise the real default branch through ``main`` in an isolated interpreter."""
    _plan, plan_path, private = make_real_recipe_plan(tmp_path)
    script = textwrap.dedent("""
        import importlib.util
        import sys
        import traceback
        from pathlib import Path

        executor_path, plan_path, private_path = map(Path, sys.argv[1:4])
        spec = importlib.util.spec_from_file_location("terminal_executor", executor_path)
        executor = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(executor)
        token = "fake-token-only"

        class Session:
            def close(self):
                return None

        class Redactor:
            def redact(self, value):
                return str(value).replace(token, "[redacted]")

        redactor = Redactor()

        def terminal_hook(exc_type, exc, tb):
            sys.stderr.write("TERMINAL_REDACTOR_HOOK\\n")
            sys.stderr.write(redactor.redact("".join(traceback.format_exception(exc_type, exc, tb))))

        class Runner:
            redacting_excepthook = staticmethod(terminal_hook)

            @staticmethod
            def build_authenticated_session():
                return Session(), redactor

            @staticmethod
            def RunPodAPI(_session):
                return object()

            @staticmethod
            def build_logger(_redactor):
                return object()

            @staticmethod
            def run_harness(*_args, **_kwargs):
                try:
                    raise RuntimeError("chained cause " + token)
                except RuntimeError as cause:
                    raise RuntimeError("primary terminal failure " + token) from cause

        def admission(_private, *, plan_hash, manifest, train, manifest_sha256,
                      launcher_sha256, training_config_sha256, staging_inventory_sha256):
            return ({"admission_id": "terminal-fixture"}, "b" * 64, "c" * 64, {
                "ledger_dir": "fixture-ledger", "daily_budget_path": "fixture-budget",
                "arc_cap_usd": 50.0, "arc_ledger_glob": "fixture-arc-*.tsv",
                "ledger_snapshot_sha256": "a" * 64, "arc_usd_before": 0.0,
            })

        def marker(private, _plan_hash, _admission_hash, _admission):
            path = private / "terminal-marker" / "dispatch.json"
            path.parent.mkdir(exist_ok=True)
            path.write_text("fixture", encoding="utf-8")
            return path

        def receipt(_target, **_kwargs):
            return None

        executor._runner_module = lambda: Runner
        executor._admission = admission
        executor._dispatch_marker = marker
        executor._receipt = receipt
        real_execute = executor.execute_experimental_plan

        def execute_from_main(plan, output, *, dry_run=False, execute=False):
            return real_execute(
                plan, output, private_root=private_path, dry_run=dry_run, execute=execute,
            )

        executor.execute_experimental_plan = execute_from_main
        executor.main(["--plan", str(plan_path), "--out", "terminal-output", "--execute"])
    """)

    completed = subprocess.run(
        [sys.executable, "-c", script, str(executor.__file__), str(plan_path), str(private)],
        capture_output=True, text=True, check=False, timeout=60,
    )

    assert completed.returncode != 0
    assert completed.stderr.count("TERMINAL_REDACTOR_HOOK") == 1
    assert "fake-token-only" not in completed.stderr
    assert "primary terminal failure" in completed.stderr
    assert "chained cause" in completed.stderr

"""Focused offline tests for the non-promotable experimental training compiler."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import base64
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


experimental = load_module("figment_experimental_train", TRAIN / "experimental_train.py")
curate = load_module("figment_experimental_train_curate", TRAIN / "curate_single_seed.py")
lineage = load_module("figment_experimental_train_lineage", PIPELINE / "lineage.py")
production = load_module("figment_experimental_train_production", PIPELINE / "figment_train.py")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def image(path: Path, color: tuple[int, int, int]) -> None:
    Image.new("RGB", (24, 16), color).save(path)


CROP_BOX = [2, 1, 20, 15]


def make_dataset(tmp_path: Path, *, count: int = 20, crops: dict[int, list[int]] | None = None) -> tuple[Path, Path]:
    """`crops` maps derivative numbers to boxes and switches to the `@2` request."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    personas = tmp_path / "personas"
    anchor = personas / "creator-001" / "anchors" / "g01.jpg"
    anchor.parent.mkdir(parents=True)
    image(anchor, (20, 30, 40))
    sources = tmp_path / "sources"
    sources.mkdir()
    entries = [{
        "id": "seed-g01", "kind": "seed", "split": "train",
        "caption": "creator001krea2 woman, reference portrait",
        "variation": {"role": "source-seed"},
    }]
    for number in range(1, count):
        candidate = sources / f"variation-{number}.png"
        image(candidate, (number, number + 20, number + 40))
        provenance = sources / f"variation-{number}.provenance.json"
        provenance.write_text(json.dumps({
            "schema": "figment/generated-input-experiment@1",
            "creator": "creator-001",
            "source": {
                "reference": "anchors/g01.jpg", "sha256": sha(anchor),
                "role": "sole original reference; no prior generated candidate supplied",
            },
            "output": {"file": candidate.name, "sha256": sha(candidate)},
            "review": {"status": "reviewed", "training_eligible": True},
        }), encoding="utf-8")
        entries.append({
            "id": f"variation-{number}", "kind": "derivative", "split": "train",
            "image": candidate.name, "provenance": provenance.name,
            "caption": f"creator001krea2 woman, opaque-clothed variation {number}",
            "variation": {"coverage": f"variation-{number}"},
        })
        if crops and number in crops:
            entries[-1]["transform"] = {"op": "crop", "box": crops[number]}
    request = tmp_path / "request.json"
    request.write_text(json.dumps({
        "schema": "figment/single-seed-curation-request@2" if crops else curate.REQUEST_SCHEMA,
        "creator": "creator-001", "trigger": "creator001krea2",
        "canonical_seed": {"path": "anchors/g01.jpg", "sha256": sha(anchor)},
        "entries": entries,
    }), encoding="utf-8")
    dataset = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, dataset, personas_root=personas)
    return dataset, personas


def make_review(dataset: Path, path: Path, *, state: str = "observed", adult: str = "observed-unambiguous-adult",
                schema: str | None = None) -> Path:
    """Review generation follows the curation record unless `schema` forces a mixed pair."""
    subject = lineage.dataset_subject(dataset)
    curation = json.loads((dataset / "dataset_curation.json").read_text(encoding="utf-8"))
    schema = schema or experimental.REVIEW_SCHEMA_FOR_CURATION[curation["schema"]]
    rows = []
    for entry, data in zip(curation["entries"], subject["files"], strict=True):
        source = entry["source"]
        rows.append({
            "id": entry["id"],
            "image": {"name": data["image"]["name"], "sha256": data["image"]["sha256"]},
            "caption": {"name": data["caption"]["name"], "sha256": data["caption"]["sha256"]},
            "source": {"logical_path": source["logical_path"], "sha256": source["sha256"]},
            "evidence_assertion": True,
            "state": state,
            "adult_presentation": adult,
            "clothing": "observed-opaque-intact",
            "real_person_likeness": "no-observed-concern",
            "resemblance": "observed-unresolved",
            "image_defects": "no-observed-blocking-defect",
            "caption_accuracy": "observed-caption-matches-image",
        })
        if schema == experimental.REVIEW_SCHEMA_V2:
            rows[-1]["transform"] = entry.get("transform")
    path.write_text(json.dumps({
        "schema": schema,
        "creator": "creator-001",
        "purpose": experimental.PURPOSE,
        "not_promotable": True,
        "reviewer": {"kind": "agent", "id": "dataset-reviewer"},
        "dataset_subject_sha256": lineage.canonical_sha256(subject),
        "rows": rows,
    }), encoding="utf-8")
    return path


class Recipe:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        self.PINS_PATH = root / "pins.json"
        self.PINS_PATH.write_text("{}", encoding="utf-8")
        self.AI_TEMPLATE_PATH = root / "training.template"
        self.AI_TEMPLATE_PATH.write_text("offline fixture template\n", encoding="utf-8")
        persona = root / "personas" / "creator-001" / "persona.yaml"
        persona.parent.mkdir(parents=True, exist_ok=True)
        persona.write_text("id: creator-001\n", encoding="utf-8")

    @staticmethod
    def _load_inputs(creator: str, _personas: Path):
        return {"id": creator}, {"trigger": "creator001krea2", "steps": 1250, "save_every": 250,
                                "dop_enabled": False, "dop_multiplier": 1.0, "dop_class": "person"}, {}

    @staticmethod
    def _render_training_config(*_args, training_seed=None, **_kwargs):
        config = {"dataset": {"path": "/workspace/ComfyUI/input/creator001krea2"}}
        if training_seed is not None:  # mirrors the real renderer's only seeded key
            config["config"] = {"process": [{"training_seed": training_seed}]}
        return config


def build(tmp_path: Path, dataset: Path, personas: Path, review: Path, *, out: str = "plan", **kwargs):
    private = tmp_path / "private"
    private.mkdir(exist_ok=True)
    return experimental.build_experimental_training_plan(
        "creator-001", dataset, review, Path(out), personas_root=personas,
        private_root=private, train_module=Recipe(tmp_path), **kwargs,
    ), private


def rehashed(plan: dict, mutate) -> dict:
    value = json.loads(json.dumps(plan))
    mutate(value)
    value["frozen_sha256"] = hashlib.sha256(experimental._canonical(value)).hexdigest()
    return value


def test_builds_private_frozen_nonpromotable_plan_and_production_loader_rejects(tmp_path):
    dataset, personas = make_dataset(tmp_path)
    review = make_review(dataset, tmp_path / "review.json")
    plan, private = build(tmp_path, dataset, personas, review)
    path = private / "plan" / "experimental-plan.json"

    assert json.loads(path.read_text(encoding="utf-8")) == plan
    assert plan["schema"] == experimental.SCHEMA
    assert plan["not_promotable"] is True
    assert plan["execution"] == {"provider_start_allowed": False, "checkpoint_acceptance_allowed": False, "qa_stamp_allowed": False}
    assert plan["inputs"]["train_row_count"] == 20
    assert plan["inputs"]["review_sha256"] == sha(review)
    assert plan["inputs"]["revalidate_before_execution"] is True
    assert plan["frozen_inputs"]["review"]["schema"] == experimental.REVIEW_SCHEMA
    snapshot = plan["frozen_inputs"]["review_snapshot"]
    assert snapshot["sha256"] == sha(review)
    assert base64.b64decode(snapshot["base64"], validate=True) == review.read_bytes()
    assert plan["frozen_inputs"]["dataset_subject"]["curation"]["canonical_seed"]["path"] == "anchors/g01.jpg"
    assert plan["frozen_sha256"] == hashlib.sha256(experimental._canonical(plan)).hexdigest()
    with pytest.raises(production.FigmentTrainError, match="unsupported schema"):
        production._load_plan("creator-001", path)


def test_exact_review_snapshot_revalidates_and_legacy_plan_remains_planning_only(tmp_path):
    dataset, personas = make_dataset(tmp_path)
    review = make_review(dataset, tmp_path / "review.json")
    plan, _private = build(tmp_path, dataset, personas, review)
    context = experimental.revalidate_experimental_plan(
        plan, personas_root=personas, train_module=Recipe(tmp_path),
    )
    assert context["review_raw"] == review.read_bytes()

    legacy = json.loads(json.dumps(plan))
    legacy["frozen_inputs"].pop("review_snapshot")
    legacy["frozen_sha256"] = hashlib.sha256(experimental._canonical(legacy)).hexdigest()
    with pytest.raises(experimental.ExperimentalTrainError, match="exact review snapshot"):
        experimental.revalidate_experimental_plan(
            legacy, personas_root=personas, train_module=Recipe(tmp_path),
        )

    malformed = json.loads(json.dumps(plan))
    malformed["frozen_inputs"]["review_snapshot"]["base64"] = "AAAA"
    malformed["frozen_sha256"] = hashlib.sha256(experimental._canonical(malformed)).hexdigest()
    with pytest.raises(experimental.ExperimentalTrainError, match="snapshot"):
        experimental.revalidate_experimental_plan(
            malformed, personas_root=personas, train_module=Recipe(tmp_path),
        )

    disagreeing = json.loads(json.dumps(plan))
    disagreeing["frozen_inputs"]["review"]["creator"] = "other"
    disagreeing["frozen_sha256"] = hashlib.sha256(experimental._canonical(disagreeing)).hexdigest()
    with pytest.raises(experimental.ExperimentalTrainError, match="disagrees with parsed"):
        experimental.revalidate_experimental_plan(
            disagreeing, personas_root=personas, train_module=Recipe(tmp_path),
        )


@pytest.mark.parametrize("state,adult,message", [
    ("excluded", "observed-unambiguous-adult", "excluded or unavailable"),
    ("unavailable", "observed-unambiguous-adult", "excluded or unavailable"),
    ("observed", "observed-ambiguous-adult", "unsafe adult-presentation"),
])
def test_refuses_excluded_unavailable_or_unsafe_agent_observations(tmp_path, state, adult, message):
    dataset, personas = make_dataset(tmp_path)
    review = make_review(dataset, tmp_path / "review.json", state=state, adult=adult)
    with pytest.raises(experimental.ExperimentalTrainError, match=message):
        build(tmp_path, dataset, personas, review)


def test_refuses_stale_review_and_unbound_current_caption(tmp_path):
    dataset, personas = make_dataset(tmp_path)
    review = make_review(dataset, tmp_path / "review.json")
    value = json.loads(review.read_text(encoding="utf-8"))
    value["dataset_subject_sha256"] = "0" * 64
    review.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(experimental.ExperimentalTrainError, match="stale"):
        build(tmp_path, dataset, personas, review)

    review = make_review(dataset, tmp_path / "review-2.json")
    value = json.loads(review.read_text(encoding="utf-8"))
    value["rows"][0]["caption"]["sha256"] = "0" * 64
    review.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(experimental.ExperimentalTrainError, match="image and caption"):
        build(tmp_path, dataset, personas, review)


def test_refuses_less_than_g01_plus_nineteen_and_missing_curation(tmp_path):
    dataset, personas = make_dataset(tmp_path, count=19)
    review = make_review(dataset, tmp_path / "review.json")
    with pytest.raises(experimental.ExperimentalTrainError, match="g01 plus 19"):
        build(tmp_path, dataset, personas, review)

    dataset, personas = make_dataset(tmp_path / "second")
    (dataset / "dataset_curation.json").unlink()
    review = tmp_path / "second" / "review.json"
    review.write_text("{}", encoding="utf-8")
    with pytest.raises(experimental.ExperimentalTrainError, match="single-seed curation"):
        build(tmp_path / "second", dataset, personas, review)


def test_refuses_creator_seed_and_recipe_trigger_mismatch(tmp_path):
    dataset, personas = make_dataset(tmp_path)
    review = make_review(dataset, tmp_path / "review.json")
    with pytest.raises(experimental.ExperimentalTrainError, match="creator-001"):
        experimental.build_experimental_training_plan("creator-002", dataset, review, Path("plan"),
                                                       personas_root=personas, private_root=tmp_path,
                                                       train_module=Recipe(tmp_path))

    anchor = personas / "creator-001" / "anchors" / "g01.jpg"
    image(anchor, (200, 100, 50))
    with pytest.raises(experimental.ExperimentalTrainError, match="current creator g01"):
        build(tmp_path, dataset, personas, review)

    dataset, personas = make_dataset(tmp_path / "trigger")
    review = make_review(dataset, tmp_path / "trigger" / "review.json")

    class WrongTriggerRecipe(Recipe):
        @staticmethod
        def _load_inputs(creator: str, _personas: Path):
            return {"id": creator}, {"trigger": "differenttrigger", "steps": 1250, "save_every": 250,
                                    "dop_enabled": False, "dop_multiplier": 1.0, "dop_class": "person"}, {}

    with pytest.raises(experimental.ExperimentalTrainError, match="trigger"):
        experimental.build_experimental_training_plan("creator-001", dataset, review, Path("plan"),
                                                       personas_root=personas, private_root=tmp_path / "trigger",
                                                       train_module=WrongTriggerRecipe(tmp_path / "trigger"))


def test_refuses_curation_record_mutated_after_lineage_validation(tmp_path, monkeypatch):
    dataset, personas = make_dataset(tmp_path)
    review = make_review(dataset, tmp_path / "review.json")
    real_loader = experimental._lineage_module

    class MutatingLineage:
        def __init__(self):
            self.real = real_loader()

        def dataset_subject(self, path):
            subject = self.real.dataset_subject(path)
            record_path = Path(path) / "dataset_curation.json"
            value = json.loads(record_path.read_text(encoding="utf-8"))
            value["trigger"] = "mutated-after-lineage"
            record_path.write_text(json.dumps(value), encoding="utf-8")
            return subject

        def canonical_sha256(self, value):
            return self.real.canonical_sha256(value)

    monkeypatch.setattr(experimental, "_lineage_module", MutatingLineage)
    with pytest.raises(experimental.ExperimentalTrainError, match="changed after lineage"):
        build(tmp_path, dataset, personas, review)


def test_v2_crop_review_builds_seeded_plan_that_revalidates_and_refuses_seed_tamper(tmp_path):
    dataset, personas = make_dataset(tmp_path, crops={3: CROP_BOX})
    review = make_review(dataset, tmp_path / "review.json")
    plan, _private = build(tmp_path, dataset, personas, review, training_seed=7)

    curation = plan["frozen_inputs"]["curation"]
    crop = next(row for row in curation["entries"] if row["id"] == "variation-3")
    reviewed = {row["id"]: row for row in plan["frozen_inputs"]["review"]["rows"]}
    assert curation["schema"] == "figment/single-seed-dataset@2"
    assert plan["frozen_inputs"]["review"]["schema"] == experimental.REVIEW_SCHEMA_V2
    assert crop["transform"] == {"op": "crop", "box": CROP_BOX, "parent_size": [24, 16], "output_size": [18, 14]}
    assert reviewed["variation-3"]["transform"] == crop["transform"]
    assert reviewed["seed-g01"]["transform"] is None and reviewed["variation-4"]["transform"] is None
    # Observations bind the materialized crop bytes, never the parent snapshot.
    assert reviewed["variation-3"]["image"]["sha256"] != crop["source"]["sha256"]
    assert plan["training_recipe"]["training_seed"] == 7
    assert plan["training_recipe"]["rendered_training_config"]["config"]["process"][0]["training_seed"] == 7
    context = experimental.revalidate_experimental_plan(plan, personas_root=personas, train_module=Recipe(tmp_path))
    assert context["recipe"] == plan["training_recipe"]

    def process(value):
        return value["training_recipe"]["rendered_training_config"]["config"]["process"][0]

    for mutate, message in [
        (lambda value: value["training_recipe"].update(training_seed=8), "changed after compilation"),
        (lambda value: process(value).update(training_seed=8), "changed after compilation"),
        (lambda value: value["training_recipe"].pop("training_seed"), "changed after compilation"),
        (lambda value: value["training_recipe"].update(training_seed=None), "changed after compilation"),
        (lambda value: value["training_recipe"].update(training_seed=True), "training seed"),
        # Frozen-record int/float/bool mutations that stay == under plain dict equality;
        # only exact-JSON comparison catches them while recomputed inputs stay unchanged.
        (lambda value: process(value).update(training_seed=7.0), "changed after compilation"),
        (lambda value: value["frozen_inputs"]["curation"]["entries"][3]["transform"].update(
            box=[CROP_BOX[0], True, CROP_BOX[2], CROP_BOX[3]]), "changed after compilation"),
        (lambda value: value["frozen_inputs"]["dataset_subject"].update(count=20.0), "changed after compilation"),
    ]:
        with pytest.raises(experimental.ExperimentalTrainError, match=message):
            experimental.revalidate_experimental_plan(
                rehashed(plan, mutate), personas_root=personas, train_module=Recipe(tmp_path),
            )


def test_refuses_mixed_generations_and_v2_review_rows_that_do_not_bind_the_crop(tmp_path):
    legacy, personas = make_dataset(tmp_path / "v1")
    review = make_review(legacy, tmp_path / "v1" / "review.json", schema=experimental.REVIEW_SCHEMA_V2)
    with pytest.raises(experimental.ExperimentalTrainError, match="generation"):
        build(tmp_path / "v1", legacy, personas, review)

    dataset, personas = make_dataset(tmp_path / "v2", crops={3: CROP_BOX})
    review = make_review(dataset, tmp_path / "v2" / "review.json", schema=experimental.REVIEW_SCHEMA)
    with pytest.raises(experimental.ExperimentalTrainError, match="generation"):
        build(tmp_path / "v2", dataset, personas, review)

    base = json.loads(make_review(dataset, tmp_path / "v2" / "base.json").read_text(encoding="utf-8"))
    crop = next(row for row in base["rows"] if row["id"] == "variation-3")
    transform, missing = crop["transform"], object()
    for index, (row_id, key, replacement, message) in enumerate([
        ("variation-3", "transform", None, "curation transform"),
        ("variation-3", "transform", {**transform, "box": [3, 1, 20, 15]}, "curation transform"),
        ("variation-3", "transform", {**transform, "box": [2, True, 20, 15]}, "curation transform"),
        ("variation-3", "transform", {"op": "crop", "box": transform["box"]}, "curation transform"),
        ("variation-4", "transform", transform, "curation transform"),
        ("variation-3", "transform", missing, "unexpected fields"),
        ("variation-3", "image", {**crop["image"], "sha256": crop["source"]["sha256"]}, "image and caption"),
    ]):
        value = json.loads(json.dumps(base))
        row = next(row for row in value["rows"] if row["id"] == row_id)
        if replacement is missing:
            del row[key]
        else:
            row[key] = replacement
        path = tmp_path / "v2" / f"review-{index}.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        with pytest.raises(experimental.ExperimentalTrainError, match=message):
            build(tmp_path / "v2", dataset, personas, path)


def test_training_seed_is_optional_exact_uint32_and_absent_when_undeclared(tmp_path):
    dataset, personas = make_dataset(tmp_path)
    review = make_review(dataset, tmp_path / "review.json")
    legacy, _private = build(tmp_path, dataset, personas, review)
    assert "training_seed" not in legacy["training_recipe"]
    assert "config" not in legacy["training_recipe"]["rendered_training_config"]  # no seed kwarg reached the renderer
    for seed in (0, 2**32 - 1):
        plan, _private = build(tmp_path, dataset, personas, review, out=f"seed-{seed}", training_seed=seed)
        assert plan["training_recipe"]["training_seed"] == seed
        experimental.revalidate_experimental_plan(plan, personas_root=personas, train_module=Recipe(tmp_path))
    for seed in (-1, 2**32, True, False, 7.0, "7"):
        with pytest.raises(experimental.ExperimentalTrainError, match="training seed"):
            build(tmp_path, dataset, personas, review, out="refused", training_seed=seed)

    required = ["--creator", "creator-001", "--dataset-dir", "d", "--review", "r", "--out", "o"]
    assert experimental.build_parser().parse_args(required).training_seed is None
    assert experimental.build_parser().parse_args([*required, "--training-seed", "7"]).training_seed == 7


def test_real_creator_recipe_loads_and_renders_offline():
    persona, training, pins = production._load_inputs("creator-001", production.PERSONAS_ROOT)
    config = production._render_training_config(
        training["trigger"], training["steps"], training["save_every"],
        dop_enabled=training["dop_enabled"], dop_multiplier=training["dop_multiplier"], dop_class=training["dop_class"],
    )
    assert persona["id"] == "creator-001"
    assert isinstance(pins, dict) and training["trigger"]
    assert config["config"]["process"][0]["datasets"][0]["folder_path"] == "/workspace/ComfyUI/input/" + training["trigger"]


def test_refuses_non_private_or_reused_output(tmp_path):
    dataset, personas = make_dataset(tmp_path)
    review = make_review(dataset, tmp_path / "review.json")
    private = tmp_path / "private"; private.mkdir()
    with pytest.raises(experimental.ExperimentalTrainError, match="relative"):
        experimental.build_experimental_training_plan("creator-001", dataset, review, tmp_path / "absolute",
                                                       personas_root=personas, private_root=private,
                                                       train_module=Recipe(tmp_path))
    build(tmp_path, dataset, personas, review)
    with pytest.raises(experimental.ExperimentalTrainError, match="fresh"):
        experimental.build_experimental_training_plan("creator-001", dataset, review, Path("plan"),
                                                       personas_root=personas, private_root=private,
                                                       train_module=Recipe(tmp_path / "second-recipe"))

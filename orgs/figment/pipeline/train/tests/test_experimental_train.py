"""Focused offline tests for the non-promotable experimental training compiler."""
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


experimental = load_module("figment_experimental_train", TRAIN / "experimental_train.py")
curate = load_module("figment_experimental_train_curate", TRAIN / "curate_single_seed.py")
lineage = load_module("figment_experimental_train_lineage", PIPELINE / "lineage.py")
production = load_module("figment_experimental_train_production", PIPELINE / "figment_train.py")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def image(path: Path, color: tuple[int, int, int]) -> None:
    Image.new("RGB", (24, 16), color).save(path)


def make_dataset(tmp_path: Path, *, count: int = 20) -> tuple[Path, Path]:
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
    request = tmp_path / "request.json"
    request.write_text(json.dumps({
        "schema": curate.REQUEST_SCHEMA,
        "creator": "creator-001", "trigger": "creator001krea2",
        "canonical_seed": {"path": "anchors/g01.jpg", "sha256": sha(anchor)},
        "entries": entries,
    }), encoding="utf-8")
    dataset = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, dataset, personas_root=personas)
    return dataset, personas


def make_review(dataset: Path, path: Path, *, state: str = "observed", adult: str = "observed-unambiguous-adult") -> Path:
    subject = lineage.dataset_subject(dataset)
    curation = json.loads((dataset / "dataset_curation.json").read_text(encoding="utf-8"))
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
    path.write_text(json.dumps({
        "schema": experimental.REVIEW_SCHEMA,
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
    def _render_training_config(*_args, **_kwargs):
        return {"dataset": {"path": "/workspace/ComfyUI/input/creator001krea2"}}


def build(tmp_path: Path, dataset: Path, personas: Path, review: Path):
    private = tmp_path / "private"
    private.mkdir(exist_ok=True)
    return experimental.build_experimental_training_plan(
        "creator-001", dataset, review, Path("plan"), personas_root=personas,
        private_root=private, train_module=Recipe(tmp_path),
    ), private


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
    assert plan["frozen_inputs"]["dataset_subject"]["curation"]["canonical_seed"]["path"] == "anchors/g01.jpg"
    assert plan["frozen_sha256"] == hashlib.sha256(experimental._canonical(plan)).hexdigest()
    with pytest.raises(production.FigmentTrainError, match="unsupported schema"):
        production._load_plan("creator-001", path)


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

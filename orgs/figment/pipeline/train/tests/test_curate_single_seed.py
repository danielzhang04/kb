"""Focused tests for immutable, first-generation single-seed curation."""
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


curate = load_module("figment_single_seed_curation", TRAIN / "curate_single_seed.py")
lineage = load_module("figment_single_seed_lineage", PIPELINE / "lineage.py")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def image(path: Path, color: tuple[int, int, int]) -> None:
    Image.new("RGB", (12, 8), color).save(path)


def request_root(tmp_path: Path, *, eligible: bool = True) -> tuple[Path, Path, Path, Path]:
    personas = tmp_path / "personas"
    anchor = personas / "creator-001" / "anchors" / "g01.jpg"
    anchor.parent.mkdir(parents=True)
    image(anchor, (20, 30, 40))
    root = tmp_path / "curation"
    sources = root / "sources"
    sources.mkdir(parents=True)
    derivative = sources / "tee-turn.png"
    image(derivative, (100, 110, 120))
    provenance = sources / "tee-turn.provenance.json"
    provenance.write_text(json.dumps({
        "schema": "figment/generated-input-experiment@1",
        "creator": "creator-001",
        "source": {
            "reference": "anchors/g01.jpg", "sha256": sha(anchor),
            "role": "sole original reference; no prior generated candidate supplied",
        },
        "output": {"file": derivative.name, "sha256": sha(derivative)},
        "review": {"status": "reviewed", "training_eligible": eligible},
    }), encoding="utf-8")
    request = root / "request.json"
    request.write_text(json.dumps({
        "schema": curate.REQUEST_SCHEMA,
        "creator": "creator-001",
        "trigger": "creator001krea2",
        "canonical_seed": {"path": "anchors/g01.jpg", "sha256": sha(anchor)},
        "entries": [
            {
                "id": "seed-g01", "kind": "seed", "split": "train",
                "caption": "creator001krea2 woman, reference portrait",
                "variation": {"role": "source seed"},
            },
            {
                "id": "tee-turn", "kind": "derivative", "split": "train",
                "image": derivative.name, "provenance": provenance.name,
                "caption": "creator001krea2 woman, charcoal tee, slight head turn",
                "variation": {"wardrobe": "charcoal tee", "pose": "slight head turn"},
            },
        ],
    }), encoding="utf-8")
    return personas, root, request, derivative


def add_eligible_train_derivatives(request: Path, anchor: Path, *, through: int) -> None:
    """Expand the valid fixture to the existing twenty-cell acceptance threshold."""
    value = json.loads(request.read_text(encoding="utf-8"))
    sources = request.parent / "sources"
    for number in range(2, through + 1):
        name = f"variation-{number}.png"
        candidate = sources / name
        image(candidate, (number, number + 10, number + 20))
        provenance_name = f"variation-{number}.provenance.json"
        (sources / provenance_name).write_text(json.dumps({
            "schema": "figment/generated-input-experiment@1",
            "creator": "creator-001",
            "source": {
                "reference": "anchors/g01.jpg", "sha256": sha(anchor),
                "role": "sole original reference; no prior generated candidate supplied",
            },
            "output": {"file": name, "sha256": sha(candidate)},
            "review": {"status": "reviewed", "training_eligible": True},
        }), encoding="utf-8")
        value["entries"].append({
            "id": f"variation-{number}", "kind": "derivative", "split": "train",
            "image": name, "provenance": provenance_name,
            "caption": f"creator001krea2 woman, clothed variation {number}",
            "variation": {"pose": f"variation {number}"},
        })
    request.write_text(json.dumps(value), encoding="utf-8")


def test_materializes_unapproved_dataset_with_immutable_curation_evidence(tmp_path):
    personas, root, request, derivative = request_root(tmp_path)
    out = tmp_path / "dataset"

    record = curate.curate_single_seed_dataset(request, out, personas_root=personas)

    assert record["schema"] == curate.DATASET_SCHEMA
    assert record["evaluation_scope"] == curate.EVALUATION_SCOPE
    assert (out / "_dataset.ready").is_file()
    assert not (out / "dataset-approval.json").exists()
    assert (out / "curation-request.json").is_file()
    assert (out / "curation-seed-g01.source").is_file()
    snapshot = out / "curation-tee-turn.source"
    assert snapshot.is_file() and sha(snapshot) == sha(derivative)
    subject = lineage.dataset_subject(out)
    assert subject["count"] == 2
    assert subject["curation"]["canonical_seed"]["path"] == "anchors/g01.jpg"
    assert subject["curation"]["evaluation_scope"] == curate.EVALUATION_SCOPE

    # The materialized snapshot is the evidence bound to later approval. Changing
    # the original staging file afterwards cannot silently rewrite that evidence.
    derivative.write_bytes(b"changed after materialization")
    assert lineage.dataset_subject(out)["curation"]["record"]["name"] == "dataset_curation.json"
    snapshot.write_bytes(b"retained evidence was tampered")
    with pytest.raises(lineage.LineageError, match="snapshot hash mismatch"):
        lineage.dataset_subject(out)


def test_builder_consumes_retained_snapshot_when_staging_changes_after_copy(tmp_path, monkeypatch):
    personas, _, request, derivative = request_root(tmp_path)
    real_loader = curate._load_builder

    def changing_loader():
        builder = real_loader()
        build = builder.build_training_set

        def build_after_staging_mutation(**kwargs):
            image(derivative, (250, 1, 1))
            return build(**kwargs)

        builder.build_training_set = build_after_staging_mutation
        return builder

    monkeypatch.setattr(curate, "_load_builder", changing_loader)
    out = tmp_path / "dataset"
    record = curate.curate_single_seed_dataset(request, out, personas_root=personas)

    # g01 is 01 and the derivative is 02. Its trainer image still matches the
    # snapshot captured before the staged file was overwritten.
    with Image.open(out / "02.png") as materialized:
        assert materialized.getpixel((0, 0)) == (100, 110, 120)
    mapped = record["entries"][1]["materialization"]
    assert mapped == {"index": 2, "image": "02.png", "caption_file": "02.txt"}
    assert lineage.dataset_subject(out)["count"] == 2


def test_refuses_publication_when_source_changes_before_its_snapshot_copy(tmp_path, monkeypatch):
    personas, _, request, derivative = request_root(tmp_path)
    original_copy = curate._copy_snapshot

    def copy_after_source_mutation(source, destination, *, maximum=None):
        if source == derivative:
            image(derivative, (250, 1, 1))
        return original_copy(source, destination, maximum=maximum)

    monkeypatch.setattr(curate, "_copy_snapshot", copy_after_source_mutation)
    out = tmp_path / "dataset"
    with pytest.raises(curate.CurationError, match="failed lineage verification"):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)
    assert not out.exists()


def test_refuses_publication_when_parsed_request_changes_before_snapshot_copy(tmp_path, monkeypatch):
    personas, _, request, _ = request_root(tmp_path)
    original_copy = curate._copy_snapshot

    def copy_after_request_mutation(source, destination, *, maximum=None):
        if source == request:
            replacement = json.loads(request.read_text(encoding="utf-8"))
            replacement["note"] = "valid but different retained request"
            request.write_text(json.dumps(replacement), encoding="utf-8")
        return original_copy(source, destination, maximum=maximum)

    monkeypatch.setattr(curate, "_copy_snapshot", copy_after_request_mutation)
    out = tmp_path / "dataset"
    with pytest.raises(curate.CurationError, match="request changed before"):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)
    assert not out.exists()


def test_refuses_current_style_ineligible_derivative_without_creating_output(tmp_path):
    personas, _, request, _ = request_root(tmp_path, eligible=False)
    out = tmp_path / "dataset"

    with pytest.raises(curate.CurationError, match="not explicitly training-eligible"):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)

    assert not out.exists()


def test_refuses_uppercase_rejected_status_even_when_eligible(tmp_path):
    personas, _, request, _ = request_root(tmp_path)
    value = json.loads(request.read_text(encoding="utf-8"))
    provenance_path = request.parent / "sources" / value["entries"][1]["provenance"]
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["review"]["status"] = "REJECTED-by-visual-review"
    provenance_path.write_text(json.dumps(provenance), encoding="utf-8")

    with pytest.raises(curate.CurationError, match="rejected derivative"):
        curate.curate_single_seed_dataset(request, tmp_path / "dataset", personas_root=personas)


def test_refuses_caption_whitespace_that_builder_would_normalize(tmp_path):
    personas, _, request, _ = request_root(tmp_path)
    value = json.loads(request.read_text(encoding="utf-8"))
    value["entries"][1]["caption"] += " "
    request.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(curate.CurationError, match="bounded single line"):
        curate.curate_single_seed_dataset(request, tmp_path / "dataset", personas_root=personas)


def test_maximum_320_byte_caption_survives_windows_crlf_lineage_check(tmp_path):
    personas, _, request, _ = request_root(tmp_path)
    value = json.loads(request.read_text(encoding="utf-8"))
    prefix = "creator001krea2 "
    value["entries"][1]["caption"] = prefix + "x" * (320 - len(prefix))
    assert len(value["entries"][1]["caption"].encode("utf-8")) == 320
    request.write_text(json.dumps(value), encoding="utf-8")
    out = tmp_path / "dataset"

    curate.curate_single_seed_dataset(request, out, personas_root=personas)

    assert (out / "02.txt").stat().st_size in (321, 322)
    assert lineage.dataset_subject(out)["count"] == 2


@pytest.mark.parametrize("mutation, message", [
    ("other-anchor", "canonical g01"),
    ("chained", "first-generation"),
    ("escape", "plain staged filename"),
])
def test_refuses_mixed_chained_or_escaping_derivative_inputs(tmp_path, mutation, message):
    personas, _, request, _ = request_root(tmp_path)
    value = json.loads(request.read_text(encoding="utf-8"))
    derivative = value["entries"][1]
    provenance_path = request.parent / "sources" / derivative["provenance"]
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    if mutation == "other-anchor":
        provenance["source"]["reference"] = "anchors/g02.jpg"
    elif mutation == "chained":
        provenance["source"]["role"] = "a generated candidate was an input"
    else:
        derivative["image"] = "../outside.png"
    provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
    request.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(curate.CurationError, match=message):
        curate.curate_single_seed_dataset(request, tmp_path / "dataset", personas_root=personas)


def test_refuses_same_derivative_hash_across_train_and_eval(tmp_path):
    personas, _, request, derivative_path = request_root(tmp_path)
    value = json.loads(request.read_text(encoding="utf-8"))
    duplicate = request.parent / "sources" / "eval-copy.png"
    duplicate.write_bytes(derivative_path.read_bytes())
    provenance = request.parent / "sources" / "eval-copy.provenance.json"
    source = json.loads((request.parent / "sources" / "tee-turn.provenance.json").read_text(encoding="utf-8"))
    source["output"] = {"file": duplicate.name, "sha256": sha(duplicate)}
    provenance.write_text(json.dumps(source), encoding="utf-8")
    value["entries"].append({
        "id": "eval-copy", "kind": "derivative", "split": "eval",
        "image": duplicate.name, "provenance": provenance.name,
        "caption": "creator001krea2 woman, charcoal tee, evaluation turn",
        "variation": {"pose": "evaluation turn"},
    })
    request.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(curate.CurationError, match="both train and eval"):
        curate.curate_single_seed_dataset(request, tmp_path / "dataset", personas_root=personas)


def test_refuses_compressed_pixel_bomb_before_builder_decodes_it(tmp_path):
    personas, _, request, derivative = request_root(tmp_path)
    # A 1-bit PNG stays small on disk but its header exceeds the 16M-pixel cap.
    Image.new("1", (4097, 4097)).save(derivative)
    value = json.loads(request.read_text(encoding="utf-8"))
    provenance_path = request.parent / "sources" / value["entries"][1]["provenance"]
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["output"]["sha256"] = sha(derivative)
    provenance_path.write_text(json.dumps(provenance), encoding="utf-8")

    with pytest.raises(curate.CurationError, match="decoded dimension or pixel"):
        curate.curate_single_seed_dataset(request, tmp_path / "dataset", personas_root=personas)


def test_refuses_aggregate_source_or_materialized_output_overflow(tmp_path, monkeypatch):
    personas, _, request, derivative = request_root(tmp_path)
    seed = personas / "creator-001" / "anchors" / "g01.jpg"
    provenance = request.parent / "sources" / "tee-turn.provenance.json"
    monkeypatch.setattr(curate, "MAX_TOTAL_SOURCE_BYTES", seed.stat().st_size + derivative.stat().st_size + provenance.stat().st_size - 1)
    with pytest.raises(curate.CurationError, match="aggregate byte"):
        curate.curate_single_seed_dataset(request, tmp_path / "source-overflow", personas_root=personas)

    monkeypatch.setattr(curate, "MAX_TOTAL_SOURCE_BYTES", 128 * 1024 * 1024)
    monkeypatch.setattr(curate, "MAX_TOTAL_OUTPUT_BYTES", 1)
    with pytest.raises(curate.CurationError, match="materialized training images exceed"):
        curate.curate_single_seed_dataset(request, tmp_path / "output-overflow", personas_root=personas)
    assert not (tmp_path / "output-overflow").exists()


def test_rejects_reparse_staging_root_before_opening_files(tmp_path, monkeypatch):
    personas, root, request, _ = request_root(tmp_path)
    original = curate._is_reparse
    monkeypatch.setattr(curate, "_is_reparse", lambda path: path == root / "sources" or original(path))

    with pytest.raises(curate.CurationError, match="non-reparse"):
        curate.curate_single_seed_dataset(request, tmp_path / "dataset", personas_root=personas)


def test_lineage_rejects_curation_record_with_cross_split_duplicate_hash(tmp_path):
    personas, _, request, derivative = request_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    duplicate = json.loads(json.dumps(record["entries"][1]))
    duplicate["id"] = "eval-copy"
    duplicate["split"] = "eval"
    old_source = out / duplicate["source"]["snapshot"]
    new_source = out / "curation-eval-copy.source"
    new_source.write_bytes(old_source.read_bytes())
    duplicate["source"]["snapshot"] = new_source.name
    old_provenance = out / duplicate["provenance"]["snapshot"]
    new_provenance = out / "curation-eval-copy.provenance.json"
    new_provenance.write_bytes(old_provenance.read_bytes())
    duplicate["provenance"]["snapshot"] = new_provenance.name
    record["snapshot_inventory"].extend([
        {"name": new_source.name, "bytes": new_source.stat().st_size, "sha256": sha(new_source)},
        {"name": new_provenance.name, "bytes": new_provenance.stat().st_size, "sha256": sha(new_provenance)},
    ])
    record["entries"].append(duplicate)
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="across train and eval"):
        lineage.dataset_subject(out)


def test_lineage_revalidates_caption_variation_and_first_generation_provenance(tmp_path):
    personas, _, request, _ = request_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    record["entries"][1]["caption"] = "not-trigger-prefixed"
    record_path.write_text(json.dumps(record), encoding="utf-8")
    with pytest.raises(lineage.LineageError, match="trigger-prefixed"):
        lineage.dataset_subject(out)

    record["entries"][1]["caption"] = "creator001krea2 woman, charcoal tee, slight head turn"
    record_path.write_text(json.dumps(record), encoding="utf-8")
    record["entries"][1]["caption"] = "creator001krea2 woman, a different claimed caption"
    record_path.write_text(json.dumps(record), encoding="utf-8")
    with pytest.raises(lineage.LineageError, match="does not bind train entry order"):
        lineage.dataset_subject(out)

    record["entries"][1]["caption"] = "creator001krea2 woman, charcoal tee, slight head turn"
    provenance_path = out / "curation-tee-turn.provenance.json"
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["source"]["role"] = "a prior generated candidate was an input"
    provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
    changed = sha(provenance_path)
    record["entries"][1]["provenance"]["sha256"] = changed
    for row in record["snapshot_inventory"]:
        if row["name"] == provenance_path.name:
            row["sha256"] = changed
            row["bytes"] = provenance_path.stat().st_size
    record_path.write_text(json.dumps(record), encoding="utf-8")
    with pytest.raises(lineage.LineageError, match="eligible first-generation"):
        lineage.dataset_subject(out)


def test_lineage_rejects_uppercase_rejected_snapshot_status(tmp_path):
    personas, _, request, _ = request_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    provenance_path = out / "curation-tee-turn.provenance.json"
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["review"]["status"] = "REJECTED"
    provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
    changed = sha(provenance_path)
    record["entries"][1]["provenance"]["sha256"] = changed
    for row in record["snapshot_inventory"]:
        if row["name"] == provenance_path.name:
            row["sha256"] = changed
            row["bytes"] = provenance_path.stat().st_size
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="eligible first-generation"):
        lineage.dataset_subject(out)


def test_lineage_rejects_noncanonical_hashes_and_unlisted_retained_files(tmp_path):
    personas, _, request, _ = request_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    record["canonical_seed"]["sha256"] = record["canonical_seed"]["sha256"].upper()
    record_path.write_text(json.dumps(record), encoding="utf-8")
    with pytest.raises(lineage.LineageError, match="canonical g01"):
        lineage.dataset_subject(out)

    record["canonical_seed"]["sha256"] = record["canonical_seed"]["sha256"].lower()
    record_path.write_text(json.dumps(record), encoding="utf-8")
    (out / "curation-unlisted.source").write_bytes((out / "curation-seed-g01.source").read_bytes())
    with pytest.raises(lineage.LineageError, match="unlisted or unused"):
        lineage.dataset_subject(out)


def test_explicit_existing_acceptance_stages_curation_evidence_with_dataset(tmp_path):
    personas, _, request, _ = request_root(tmp_path)
    anchor = personas / "creator-001" / "anchors" / "g01.jpg"
    add_eligible_train_derivatives(request, anchor, through=19)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    assert lineage.dataset_subject(out)["count"] == 20

    driver = load_module("figment_single_seed_train_driver", PIPELINE / "figment_train.py")
    approval = driver.accept_train_first_dataset(
        "creator-001", out, decided_by="operator", decided_at="2026-09-08T00:00:00Z",
    )
    assert "curation" in approval["subject"]
    plan_root = tmp_path / "train-first"
    driver.build_train_first_plan(
        "creator-001", out, plan_root,
        personas_root=PIPELINE.parent / "personas", skip_pin_verify=True,
    )
    staged = plan_root / "train" / "runs" / "creator-001-tensor-dataset-train-first"
    assert (staged / "dataset_curation.json").is_file()
    assert (staged / "curation-request.json").is_file()
    assert (staged / "curation-variation-19.provenance.json").is_file()


# ---------------------------------------------------------------------------
# Adversarial coverage for version 2 declared crop curation.
# ---------------------------------------------------------------------------

CROP_BOX = [2, 1, 9, 6]  # left, top, right, bottom on a 12x8 nonuniform parent


def _nonuniform_image(path: Path, size: tuple[int, int] = (12, 8)) -> None:
    width, height = size
    img = Image.new("RGB", size)
    pixels = img.load()
    for y in range(height):
        for x in range(width):
            pixels[x, y] = (x * 17 % 256, y * 29 % 256, (x + 3 * y) % 256)
    img.save(path)


def _v2_root(tmp_path: Path, *, transform=CROP_BOX, image_size=(12, 8)):
    """A fresh personas+curation root with one derivative entry declaring a v2 crop."""
    personas = tmp_path / "personas"
    anchor = personas / "creator-001" / "anchors" / "g01.jpg"
    anchor.parent.mkdir(parents=True)
    image(anchor, (20, 30, 40))
    root = tmp_path / "curation"
    sources = root / "sources"
    sources.mkdir(parents=True)
    derivative = sources / "tee-turn.png"
    _nonuniform_image(derivative, image_size)
    provenance = sources / "tee-turn.provenance.json"
    provenance.write_text(json.dumps({
        "schema": "figment/generated-input-experiment@1",
        "creator": "creator-001",
        "source": {
            "reference": "anchors/g01.jpg", "sha256": sha(anchor),
            "role": "sole original reference; no prior generated candidate supplied",
        },
        # Provenance hash must be refreshed for the nonuniform pixels before the
        # real producer is called, or staging validation fails before curation runs.
        "output": {"file": derivative.name, "sha256": sha(derivative)},
        "review": {"status": "reviewed", "training_eligible": True},
    }), encoding="utf-8")
    derivative_entry: dict = {
        "id": "tee-turn", "kind": "derivative", "split": "train",
        "image": derivative.name, "provenance": provenance.name,
        "caption": "creator001krea2 woman, charcoal tee, slight head turn",
        "variation": {"wardrobe": "charcoal tee", "pose": "slight head turn"},
    }
    if transform is not None:
        derivative_entry["transform"] = {"op": "crop", "box": list(transform)}
    request = root / "request.json"
    request.write_text(json.dumps({
        "schema": curate.REQUEST_SCHEMA_V2,
        "creator": "creator-001",
        "trigger": "creator001krea2",
        "canonical_seed": {"path": "anchors/g01.jpg", "sha256": sha(anchor)},
        "entries": [
            {
                "id": "seed-g01", "kind": "seed", "split": "train",
                "caption": "creator001krea2 woman, reference portrait",
                "variation": {"role": "source seed"},
            },
            derivative_entry,
        ],
    }), encoding="utf-8")
    return personas, root, request, derivative


def test_v2_crop_produces_declared_pixels_and_retains_full_parent(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"

    record = curate.curate_single_seed_dataset(request, out, personas_root=personas)

    assert record["schema"] == curate.DATASET_SCHEMA_V2
    assert record["entries"][1]["transform"] == {
        "op": "crop", "box": CROP_BOX, "parent_size": [12, 8], "output_size": [7, 5],
    }
    # The retained snapshot stays the full uncropped parent; only the numbered
    # trainer image is the declared crop.
    with Image.open(out / "curation-tee-turn.source") as retained:
        assert retained.size == (12, 8)
    with Image.open(derivative) as full, Image.open(out / "02.png") as trainer:
        expected = full.convert("RGB").crop(tuple(CROP_BOX))
        assert trainer.size == (7, 5)
        assert trainer.tobytes() == expected.tobytes()
    subject = lineage.dataset_subject(out)
    assert subject["count"] == 2


def test_lineage_rejects_shifted_crop_box_against_unchanged_pixels(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    # Shift the declared box by one pixel without touching the materialized PNG:
    # the box is only metadata, so this must be caught by decoding, not hashing.
    record["entries"][1]["transform"]["box"] = [3, 1, 10, 6]
    record["entries"][1]["transform"]["output_size"] = [7, 5]
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="not the retained parent plus declared transform"):
        lineage.dataset_subject(out)


def test_lineage_rejects_full_parent_substituted_for_declared_crop(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    trainer_path = out / "02.png"
    with Image.open(derivative) as full:
        full.convert("RGB").save(trainer_path, format="PNG")
    # Update the manifest hash so the run reaches pixel validation instead of
    # failing on the earlier, cheaper hash-mismatch check.
    manifest_path = out / "dataset_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for row in manifest["files"]:
        if row["image"] == "02.png":
            row["sha256"] = sha(trainer_path)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="not the retained parent plus declared transform"):
        lineage.dataset_subject(out)


@pytest.mark.parametrize("mutation, message", [
    ("missing-key", "crop transform is malformed"),
    ("extra-key", "crop transform is malformed"),
    ("bad-op", "crop transform is malformed"),
    ("out-of-bounds", "positive proper subrectangle"),
    ("inverted", "positive proper subrectangle"),
    ("full-frame", "not the full parent frame"),
    ("boolean-box", "box must be four integers"),
])
def test_curation_refuses_malformed_or_full_frame_crop_declarations(tmp_path, mutation, message):
    personas, root, request, _ = _v2_root(tmp_path, transform=None)
    value = json.loads(request.read_text(encoding="utf-8"))
    entry = value["entries"][1]
    if mutation == "missing-key":
        entry["transform"] = {"op": "crop"}
    elif mutation == "extra-key":
        entry["transform"] = {"op": "crop", "box": CROP_BOX, "note": "unexpected"}
    elif mutation == "bad-op":
        entry["transform"] = {"op": "rotate", "box": CROP_BOX}
    elif mutation == "out-of-bounds":
        entry["transform"] = {"op": "crop", "box": [2, 1, 13, 6]}
    elif mutation == "inverted":
        entry["transform"] = {"op": "crop", "box": [9, 1, 2, 6]}
    elif mutation == "full-frame":
        entry["transform"] = {"op": "crop", "box": [0, 0, 12, 8]}
    else:
        entry["transform"] = {"op": "crop", "box": [2, 1, 9, True]}
    request.write_text(json.dumps(value), encoding="utf-8")
    out = tmp_path / "dataset"

    with pytest.raises(curate.CurationError, match=message):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)
    assert not out.exists()


def test_curation_refuses_transform_on_seed_or_eval_rows(tmp_path):
    personas, root, request, _ = _v2_root(tmp_path, transform=None)
    value = json.loads(request.read_text(encoding="utf-8"))
    value["entries"][0]["transform"] = {"op": "crop", "box": CROP_BOX}
    request.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(curate.CurationError, match="transform is allowed only on derivative train rows"):
        curate.curate_single_seed_dataset(request, tmp_path / "seed-crop", personas_root=personas)
    assert not (tmp_path / "seed-crop").exists()

    # The seed transform from the first case must not leak into the eval case,
    # or this would still be exercising the seed-row gate, not the eval-row one.
    value = json.loads(request.read_text(encoding="utf-8"))
    del value["entries"][0]["transform"]
    value["entries"][1]["split"] = "eval"
    value["entries"][1]["transform"] = {"op": "crop", "box": CROP_BOX}
    request.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(curate.CurationError, match="transform is allowed only on derivative train rows"):
        curate.curate_single_seed_dataset(request, tmp_path / "eval-crop", personas_root=personas)
    assert not (tmp_path / "eval-crop").exists()


def test_curation_refuses_transform_declared_under_v1_request_schema(tmp_path):
    personas, root, request, _ = _v2_root(tmp_path, transform=CROP_BOX)
    value = json.loads(request.read_text(encoding="utf-8"))
    value["schema"] = curate.REQUEST_SCHEMA
    request.write_text(json.dumps(value), encoding="utf-8")
    out = tmp_path / "dataset"

    with pytest.raises(curate.CurationError, match="an @1 curation request cannot declare a transform"):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)
    assert not out.exists()


def test_lineage_refuses_injected_v1_transform_on_an_otherwise_valid_v1_record(tmp_path):
    personas, _, request, _ = request_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    assert record["schema"] == curate.DATASET_SCHEMA
    record["entries"][1]["transform"] = {
        "op": "crop", "box": CROP_BOX, "parent_size": [12, 8], "output_size": [7, 5],
    }
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="@1 curation rows must not carry a transform"):
        lineage.dataset_subject(out)


def _v2_duplicate_row(out: Path, original: dict, *, suffix: str, split: str) -> tuple[dict, Path, Path]:
    duplicate = json.loads(json.dumps(original))
    duplicate["id"] = f"tee-turn-{suffix}"
    duplicate["split"] = split
    duplicate.pop("materialization", None)
    new_source = out / f"curation-tee-turn-{suffix}.source"
    new_source.write_bytes((out / original["source"]["snapshot"]).read_bytes())
    duplicate["source"]["snapshot"] = new_source.name
    new_provenance = out / f"curation-tee-turn-{suffix}.provenance.json"
    new_provenance.write_bytes((out / original["provenance"]["snapshot"]).read_bytes())
    duplicate["provenance"]["snapshot"] = new_provenance.name
    return duplicate, new_source, new_provenance


def test_lineage_refuses_v2_parent_reused_within_train(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    original = record["entries"][1]
    # Same parent bytes, new retained-snapshot filename, still declared train.
    duplicate, new_source, new_provenance = _v2_duplicate_row(out, original, suffix="again", split="train")
    record["snapshot_inventory"].extend([
        {"name": new_source.name, "bytes": new_source.stat().st_size, "sha256": sha(new_source)},
        {"name": new_provenance.name, "bytes": new_provenance.stat().st_size, "sha256": sha(new_provenance)},
    ])
    record["entries"].append(duplicate)
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="repeats a parent source hash"):
        lineage.dataset_subject(out)


def test_lineage_refuses_v2_parent_reused_across_train_and_eval(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    original = record["entries"][1]
    # An eval row never carries a transform; the same parent bytes reused in
    # eval must hit the cross-split leak gate before any transform check.
    duplicate, new_source, new_provenance = _v2_duplicate_row(out, original, suffix="eval", split="eval")
    duplicate.pop("transform", None)
    record["snapshot_inventory"].extend([
        {"name": new_source.name, "bytes": new_source.stat().st_size, "sha256": sha(new_source)},
        {"name": new_provenance.name, "bytes": new_provenance.stat().st_size, "sha256": sha(new_provenance)},
    ])
    record["entries"].append(duplicate)
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="across train and eval"):
        lineage.dataset_subject(out)


def test_curation_refuses_crop_on_a_rotated_exif_parent(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path, transform=None)
    img = Image.new("RGB", (12, 8))
    exif = img.getexif()
    exif[0x0112] = 6
    img.save(derivative, exif=exif)
    value = json.loads(request.read_text(encoding="utf-8"))
    provenance_path = root / "sources" / value["entries"][1]["provenance"]
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["output"]["sha256"] = sha(derivative)
    provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
    value["entries"][1]["transform"] = {"op": "crop", "box": CROP_BOX}
    request.write_text(json.dumps(value), encoding="utf-8")
    out = tmp_path / "dataset"

    with pytest.raises(curate.CurationError, match="non-identity EXIF orientation"):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)
    assert not out.exists()


def test_producer_refusal_leaves_no_published_dataset_directory(tmp_path):
    personas, root, request, _ = _v2_root(tmp_path)
    value = json.loads(request.read_text(encoding="utf-8"))
    value["entries"][1]["transform"] = {"op": "crop", "box": [0, 0, 12, 8]}
    request.write_text(json.dumps(value), encoding="utf-8")
    out = tmp_path / "dataset"

    with pytest.raises(curate.CurationError, match="not the full parent frame"):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)

    assert not out.exists()
    assert list(out.parent.glob("single-seed-curation-*")) == []
    assert list(out.parent.glob("single-seed-crops-*")) == []


def test_curation_refuses_boolean_box_component_disguised_as_valid_integer(tmp_path):
    personas, root, request, _ = _v2_root(tmp_path, transform=None)
    value = json.loads(request.read_text(encoding="utf-8"))
    # True == 1 under Python's loose numeric equality, so a naive comparison
    # could accept this as a valid subrectangle; isinstance must reject it.
    value["entries"][1]["transform"] = {"op": "crop", "box": [2, True, 9, 6]}
    request.write_text(json.dumps(value), encoding="utf-8")
    out = tmp_path / "dataset"

    with pytest.raises(curate.CurationError, match="box must be four integers"):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)
    assert not out.exists()


def test_lineage_refuses_shifted_request_transform_after_hashes_refreshed(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    request_snapshot = out / "curation-request.json"
    stored = json.loads(request_snapshot.read_text(encoding="utf-8"))
    # Only the retained request's declared box moves; the record's own
    # transform and the trainer pixels are left exactly as produced.
    stored["entries"][1]["transform"]["box"] = [3, 1, 10, 6]
    request_snapshot.write_text(json.dumps(stored), encoding="utf-8")
    refreshed = sha(request_snapshot)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    record["request"]["sha256"] = refreshed
    for row in record["snapshot_inventory"]:
        if row["name"] == "curation-request.json":
            row["sha256"] = refreshed
            row["bytes"] = request_snapshot.stat().st_size
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="request transform is malformed or differs"):
        lineage.dataset_subject(out)


def test_lineage_refuses_boolean_smuggled_into_retained_request_box(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    request_snapshot = out / "curation-request.json"
    stored = json.loads(request_snapshot.read_text(encoding="utf-8"))
    # True == 1 under loose numeric equality; the request transform check
    # must reject a bool standing in for a box coordinate.
    stored["entries"][1]["transform"]["box"][1] = True
    request_snapshot.write_text(json.dumps(stored), encoding="utf-8")
    refreshed = sha(request_snapshot)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    record["request"]["sha256"] = refreshed
    for row in record["snapshot_inventory"]:
        if row["name"] == "curation-request.json":
            row["sha256"] = refreshed
            row["bytes"] = request_snapshot.stat().st_size
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="request transform is malformed or differs"):
        lineage.dataset_subject(out)


def test_lineage_refuses_record_schema_v2_bound_to_retained_v1_request(tmp_path):
    personas, _, request, _ = request_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    assert record["schema"] == curate.DATASET_SCHEMA
    # The retained request is still schema @1 and declares no transform; only
    # the record is bumped to @2. The shared validator must refuse this even
    # though every individual hash below still matches its own bytes.
    record["schema"] = curate.DATASET_SCHEMA_V2
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="@2 request does not match"):
        lineage.dataset_subject(out)


def test_lineage_refuses_record_only_crop_addition_even_with_consistent_pixels(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path, transform=None)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    assert record["schema"] == curate.DATASET_SCHEMA_V2
    parent_path = out / record["entries"][1]["source"]["snapshot"]
    with Image.open(parent_path) as parent:
        cropped = parent.convert("RGB").crop(tuple(CROP_BOX))
    trainer_path = out / record["entries"][1]["materialization"]["image"]
    cropped.save(trainer_path, format="PNG")
    manifest_path = out / "dataset_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for row in manifest["files"]:
        if row["image"] == trainer_path.name:
            row["sha256"] = sha(trainer_path)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    # The retained request never declared a crop for this row; adding one only
    # in the record, even with a correctly rendered and hash-consistent output,
    # must not be accepted as evidence of a reviewed transform.
    record["entries"][1]["transform"] = {
        "op": "crop", "box": CROP_BOX, "parent_size": [12, 8], "output_size": [7, 5],
    }
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="disagree on transform presence"):
        lineage.dataset_subject(out)


def test_lineage_refuses_record_only_crop_removal_with_full_parent_output(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    trainer_path = out / record["entries"][1]["materialization"]["image"]
    parent_path = out / record["entries"][1]["source"]["snapshot"]
    with Image.open(parent_path) as parent:
        parent.convert("RGB").save(trainer_path, format="PNG")
    manifest_path = out / "dataset_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for row in manifest["files"]:
        if row["image"] == trainer_path.name:
            row["sha256"] = sha(trainer_path)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    # The retained request still declares the crop; removing it only from the
    # record while shipping the full uncropped parent as output must not pass.
    del record["entries"][1]["transform"]
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="disagree on transform presence"):
        lineage.dataset_subject(out)


def _tiff_disguised_as_png(path: Path, size: tuple[int, int] = (12, 8)) -> None:
    if path.exists():
        with Image.open(path) as existing:
            pixels = existing.convert("RGB")
    else:
        pixels = Image.new("RGB", size, (5, 6, 7))
    pixels.save(path, format="TIFF")


def test_producer_refuses_disguised_tiff_content_named_png(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path, transform=None)
    _tiff_disguised_as_png(derivative)
    value = json.loads(request.read_text(encoding="utf-8"))
    provenance_path = root / "sources" / value["entries"][1]["provenance"]
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["output"]["sha256"] = sha(derivative)
    provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
    out = tmp_path / "dataset"

    # A .png-named file whose actual container is TIFF must be refused by
    # format, not silently decoded because Pillow can still open it.
    with pytest.raises(curate.CurationError, match="cannot inspect derivative"):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)
    assert not out.exists()


def test_lineage_refuses_disguised_tiff_after_hashes_rebind_before_pixel_checks(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    snapshot_path = out / "curation-tee-turn.source"
    _tiff_disguised_as_png(snapshot_path, size=(12, 8))
    changed = sha(snapshot_path)
    provenance_snapshot_name = "curation-tee-turn.provenance.json"
    provenance_path = out / provenance_snapshot_name
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["output"]["sha256"] = changed
    provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
    provenance_hash = sha(provenance_path)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    record["entries"][1]["source"]["sha256"] = changed
    record["entries"][1]["source"]["snapshot_sha256"] = changed
    record["entries"][1]["source"]["bytes"] = snapshot_path.stat().st_size
    record["entries"][1]["provenance"]["sha256"] = provenance_hash
    for row in record["snapshot_inventory"]:
        if row["name"] == snapshot_path.name:
            row["sha256"] = changed
            row["bytes"] = snapshot_path.stat().st_size
        elif row["name"] == provenance_snapshot_name:
            row["sha256"] = provenance_hash
            row["bytes"] = provenance_path.stat().st_size
    record_path.write_text(json.dumps(record), encoding="utf-8")

    # Every hash above is now self-consistent; only the pixel container is
    # wrong, so format decoding must be the gate that trips, not a hash gate.
    with pytest.raises(lineage.LineageError, match="cannot inspect single-seed retained image"):
        lineage.dataset_subject(out)


def test_v2_producer_refuses_unknown_row_key(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path, transform=None)
    value = json.loads(request.read_text(encoding="utf-8"))
    value["entries"][1]["unexpected"] = "nope"
    request.write_text(json.dumps(value), encoding="utf-8")
    out = tmp_path / "dataset"

    with pytest.raises(curate.CurationError, match="unknown key"):
        curate.curate_single_seed_dataset(request, out, personas_root=personas)
    assert not out.exists()


def test_lineage_refuses_unknown_key_in_retained_v2_request_row(tmp_path):
    personas, root, request, derivative = _v2_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)
    request_snapshot = out / "curation-request.json"
    stored = json.loads(request_snapshot.read_text(encoding="utf-8"))
    stored["entries"][1]["unexpected"] = "nope"
    request_snapshot.write_text(json.dumps(stored), encoding="utf-8")
    refreshed = sha(request_snapshot)
    record_path = out / "dataset_curation.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    record["request"]["sha256"] = refreshed
    for row in record["snapshot_inventory"]:
        if row["name"] == "curation-request.json":
            row["sha256"] = refreshed
            row["bytes"] = request_snapshot.stat().st_size
    record_path.write_text(json.dumps(record), encoding="utf-8")

    with pytest.raises(lineage.LineageError, match="unknown key"):
        lineage.dataset_subject(out)


def test_producer_refuses_actual_pillow_decompression_bomb(tmp_path, monkeypatch):
    personas, _, request, derivative = request_root(tmp_path)
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 10)

    with pytest.raises(curate.CurationError, match="cannot inspect"):
        curate.curate_single_seed_dataset(request, tmp_path / "dataset", personas_root=personas)
    assert not (tmp_path / "dataset").exists()


def test_lineage_refuses_actual_pillow_decompression_bomb_on_retained_image(tmp_path, monkeypatch):
    personas, _, request, derivative = request_root(tmp_path)
    out = tmp_path / "dataset"
    curate.curate_single_seed_dataset(request, out, personas_root=personas)

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 10)
    with pytest.raises(lineage.LineageError, match="cannot inspect single-seed retained image"):
        lineage.dataset_subject(out)

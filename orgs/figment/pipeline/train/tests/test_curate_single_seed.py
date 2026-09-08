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

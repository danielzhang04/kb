import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

import pytest
from PIL import Image


TRAIN = Path(__file__).resolve().parents[1]
PIPELINE = TRAIN.parent
POD = PIPELINE / "pod"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


builder = load_module("build_identity_set", TRAIN / "build_identity_set.py")
checker = load_module("identity_check", TRAIN / "identity_check.py")
qa_stamp = load_module("figment_qa_stamp", PIPELINE / "qa_stamp.py")
runner = load_module("figment_pod_runpod_run", POD / "runpod_run.py")


def test_training_templates_expose_required_render_slots():
    for name in (
        "diffusion-pipe-zimage.toml.template",
        "diffusion-pipe-klein4b.toml.template",
    ):
        text = (TRAIN / name).read_text(encoding="utf-8")
        assert "{{trigger}}" in text
        assert "{{dataset_dir}}" in text
        assert "{{output_dir}}" in text
        assert "type = 'lora'" in text
        assert "rank = 32" in text


def test_identity_manifests_are_sharded_balanced_and_write_variable_only_captions(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "replacements": {"blue-black": "natural jet-black with a cool sheen"},
        "prompt_clauses": ["Keep the adult face fresh and naturally textured"],
    }), encoding="utf-8")
    captions = tmp_path / "captions"
    out = tmp_path / "identity.yaml"
    assert builder.main([
        "--arm", str(PIPELINE / "bakeoff" / "arm-b-klein4b.yaml"),
        "--candidate", "c01",
        "--lever-table", str(settings),
        "--trigger", "figmentc01",
        "--out", str(out),
        "--caption-dir", str(captions),
    ]) == 0

    assert not out.exists()
    manifests = [
        json.loads((tmp_path / f"identity-shard-{index:02d}.yaml").read_text(encoding="utf-8"))
        for index in range(1, 5)
    ]
    assert [len(manifest["jobs"]) for manifest in manifests] == [10, 10, 10, 10]
    jobs = [job for manifest in manifests for job in manifest["jobs"]]
    assert len(jobs) == 40
    for index, manifest in enumerate(manifests, start=1):
        assert manifest["job_timeout_seconds"] == 240
        assert manifest["readiness_timeout_seconds"] == 900
        assert manifest["max_minutes"] == 60
        assert manifest["identity_set"]["shard"] == {
            "index": index,
            "count": 4,
            "cell_names": [job["output_name"] for job in manifest["jobs"]],
        }
        runner.require_manifest(manifest, PIPELINE / "bakeoff" / "arm-b-klein4b.yaml")
    assert Counter(job["identity_cell"]["angle"] for job in jobs) == {
        name: 8 for name in builder.ANGLES
    }
    assert Counter(job["identity_cell"]["lighting"] for job in jobs) == {
        name: 10 for name in builder.LIGHTING
    }
    assert Counter(job["identity_cell"]["distance"] for job in jobs) == {
        name: 20 for name in builder.DISTANCES
    }
    sidecars = sorted(captions.glob("*.txt"))
    assert len(sidecars) == 40
    for sidecar in sidecars:
        text = sidecar.read_text(encoding="utf-8")
        assert text.startswith("figmentc01, ")
        assert "face" not in text.lower()
        assert "skin" not in text.lower()


def test_identity_builder_writes_one_unsuffixed_manifest_for_ten_jobs(tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"replacements": {}, "prompt_clauses": []}), encoding="utf-8")
    monkeypatch.setattr(builder, "ANGLES", {"front": builder.ANGLES["front"]})
    monkeypatch.setattr(builder, "LIGHTING", {
        f"light-{index}": f"light {index}" for index in range(5)
    })
    out = tmp_path / "identity.yaml"
    captions = tmp_path / "captions"

    assert builder.main([
        "--arm", str(PIPELINE / "bakeoff" / "arm-b-klein4b.yaml"),
        "--candidate", "c01",
        "--lever-table", str(settings),
        "--trigger", "figmentc01",
        "--out", str(out),
        "--caption-dir", str(captions),
    ]) == 0

    assert out.is_file()
    assert list(tmp_path.glob("identity-shard-*.yaml")) == []
    manifest = json.loads(out.read_text(encoding="utf-8"))
    assert len(manifest["jobs"]) == 10
    assert "shard" not in manifest["identity_set"]
    runner.require_manifest(manifest, PIPELINE / "bakeoff" / "arm-b-klein4b.yaml")
    assert len(list(captions.glob("*.txt"))) == 10


def test_identity_check_uses_robust_thresholds_and_qa_compatible_rulings(tmp_path):
    anchor = tmp_path / "anchor.png"
    images = tmp_path / "images"
    out = tmp_path / "report"
    images.mkdir()
    Image.new("RGB", (4, 4), "white").save(anchor)
    names = ["good-a", "good-b", "good-c", "outlier"]
    for name in names:
        Image.new("RGB", (4, 4), "white").save(images / f"{name}.png")
    face = {
        "anchor": [1.0, 0.0],
        "good-a": [1.0, 0.01],
        "good-b": [1.0, -0.01],
        "good-c": [0.99, 0.02],
        "outlier": [0.0, 1.0],
    }
    dino = {
        "good-a": [1.0, 0.0],
        "good-b": [0.99, 0.01],
        "good-c": [0.98, -0.01],
        "outlier": [-1.0, 0.0],
    }
    report = checker.evaluate(
        anchor,
        images,
        out,
        lambda path: face[path.stem],
        lambda path: dino[path.stem],
    )
    assert report["summary"] == {"total": 4, "passed": 3, "failed": 1}
    rulings = json.loads((out / "rulings.json").read_text(encoding="utf-8"))
    # qa_stamp.py now requires all three safety axes (P1 step 1.5) on every ruling —
    # identity_check.py's own auto-generated rulings only ever carry the "identity"
    # quality axis, so a good-state safety verdict is added here to keep this test's
    # purpose (identity_check's rulings are qa_stamp-shape-compatible) intact without
    # exercising the separate fail-closed-on-missing-safety-axis behavior, which
    # test_qa_stamp.py covers directly.
    for ruling in rulings:
        ruling["adult_read"] = "pass"
        ruling["garment_integrity"] = "pass"
        ruling["real_person_resemblance"] = "clear"
    manifest = {"images": [
        {"image_id": name, "review_status": "unreviewed", "parked_reasons": []}
        for name in names
    ]}
    verified, parked, unreviewed = qa_stamp.stamp(manifest, rulings)
    assert (verified, parked, unreviewed) == (3, 1, 0)


def test_identity_check_fails_closed_when_face_embedding_is_missing(tmp_path):
    anchor = tmp_path / "anchor.png"
    images = tmp_path / "images"
    images.mkdir()
    Image.new("RGB", (4, 4), "white").save(anchor)
    for name in ("one", "two", "three"):
        Image.new("RGB", (4, 4), "white").save(images / f"{name}.png")

    def face(path):
        if path.stem == "two":
            raise RuntimeError("no face")
        return [1.0, 0.0]

    report = checker.evaluate(
        anchor, images, tmp_path / "out", face, lambda _path: [1.0, 0.0]
    )
    assert report["summary"]["failed"] == 3
    assert report["thresholds"]["face_cosine"] is None


# ---------------------------------------------------------------------------
# P1 step 1.4 — raw-only scoring
# ---------------------------------------------------------------------------


def test_raw_only_mode_writes_observations_only_never_a_verdict(tmp_path):
    anchor = tmp_path / "anchor.png"
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    out = tmp_path / "out"
    Image.new("RGB", (4, 4), "white").save(anchor)
    names = ["good-a", "good-b", "no-face"]
    for name in names:
        Image.new("RGB", (4, 4), "white").save(images_dir / f"{name}.png")

    face = {"anchor": [1.0, 0.0], "good-a": [1.0, 0.01], "good-b": [0.99, 0.02]}

    def face_embedder(path):
        if path.stem == "no-face":
            raise RuntimeError("no face detected")
        return face[path.stem]

    out_report = checker.evaluate(
        anchor, images_dir, out, face_embedder, lambda _path: [1.0, 0.0], raw_only=True
    )
    assert out_report["mode"] == "raw-only"
    assert not (out / "rulings.json").exists()
    assert (out / "identity_report.json").exists()
    assert set(out_report["images"][0]) >= {"image_id", "face_detected", "metrics"}
    assert "pass" not in json.dumps(out_report).lower()

    by_id = {row["image_id"]: row for row in out_report["images"]}
    assert by_id["good-a"]["face_detected"] is True
    assert isinstance(by_id["good-a"]["face_cosine"], float)
    assert set(by_id["good-a"]["metrics"]) == {
        "laplacian_variance", "clipped_highlight_fraction", "local_luminance_variance",
        "unavailable_reason",
    }
    assert by_id["no-face"]["face_detected"] is False
    assert by_id["no-face"]["metrics"]["unavailable_reason"] is not None
    assert by_id["no-face"]["metrics"]["laplacian_variance"] is None
    assert by_id["no-face"]["unavailable_reason"] is not None


def synthetic_face_crop(*, sharp: bool, highlight_fraction: float, size: int = 64):
    """A small deterministic numpy fixture — a checkerboard (sharp=True, exercises the
    Laplacian-variance arithmetic on real high-frequency content) vs. a flat field
    (sharp=False, the "blurred" comparison case) of the same shape. Not a real photo —
    the point is to exercise compute_raw_metrics' arithmetic, not face detection."""
    import numpy as np

    if sharp:
        yy, xx = np.mgrid[0:size, 0:size]
        base = (((yy // 8) + (xx // 8)) % 2).astype(np.float64) * 200.0 + 20.0
    else:
        base = np.full((size, size), 120.0)

    n_highlight = int(size * size * highlight_fraction)
    flat = base.reshape(-1).copy()
    flat[:n_highlight] = 255.0
    base = flat.reshape(size, size)

    rgb = np.stack([base, base, base], axis=-1)
    return rgb.astype(np.uint8)


def test_raw_metrics_are_real_numbers_on_a_synthetic_face_crop():
    crop = synthetic_face_crop(sharp=True, highlight_fraction=0.10)
    metrics = checker.compute_raw_metrics(crop)
    assert metrics["unavailable_reason"] is None
    assert isinstance(metrics["laplacian_variance"], float) and metrics["laplacian_variance"] > 0
    assert 0.0 <= metrics["clipped_highlight_fraction"] <= 1.0
    assert isinstance(metrics["local_luminance_variance"], float) and metrics["local_luminance_variance"] >= 0

    blurred = synthetic_face_crop(sharp=False, highlight_fraction=0.10)
    assert checker.compute_raw_metrics(blurred)["laplacian_variance"] < metrics["laplacian_variance"]


def test_compute_raw_metrics_fails_closed_on_a_degenerate_crop():
    import numpy as np

    tiny = np.zeros((2, 2, 3), dtype=np.uint8)
    metrics = checker.compute_raw_metrics(tiny)
    assert metrics["unavailable_reason"] is not None
    assert metrics["laplacian_variance"] is None
    assert metrics["clipped_highlight_fraction"] is None
    assert metrics["local_luminance_variance"] is None


# ---------------------------------------------------------------------------
# P2R review finding 1 — raw-only `--out` ending in .json writes that FILE
# ---------------------------------------------------------------------------


def test_raw_only_out_ending_in_json_writes_that_file_not_a_directory(tmp_path):
    anchor = tmp_path / "anchor.png"
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    Image.new("RGB", (4, 4), "white").save(anchor)
    Image.new("RGB", (4, 4), "white").save(images_dir / "good-a.png")

    out = tmp_path / "batches" / "expansion-02" / "scores.json"  # parent dir absent
    report = checker.evaluate(
        anchor, images_dir, out, lambda _p: [1.0, 0.0], lambda _p: [1.0, 0.0], raw_only=True
    )
    assert out.is_file()
    assert not out.is_dir()
    on_disk = json.loads(out.read_text(encoding="utf-8"))
    assert on_disk == report
    assert on_disk["mode"] == "raw-only"


def test_raw_only_out_without_json_suffix_keeps_legacy_directory_behavior(tmp_path):
    anchor = tmp_path / "anchor.png"
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    Image.new("RGB", (4, 4), "white").save(anchor)
    Image.new("RGB", (4, 4), "white").save(images_dir / "good-a.png")

    out = tmp_path / "scores-out"  # no .json suffix -> directory, as before
    checker.evaluate(
        anchor, images_dir, out, lambda _p: [1.0, 0.0], lambda _p: [1.0, 0.0], raw_only=True
    )
    assert out.is_dir()
    assert (out / "identity_report.json").is_file()


# ---------------------------------------------------------------------------
# P2R review finding 2 — join-key resolution (harness image_id -> allocation cell_id)
# ---------------------------------------------------------------------------


def test_resolve_cell_id_matches_by_suffix_and_fails_closed_on_ambiguity():
    cell_ids = ["exp02-s001", "exp02-s002", "exp02-r001"]
    assert checker._resolve_cell_id("c001-exp02-s001", cell_ids) == "exp02-s001"
    assert checker._resolve_cell_id("exp02-s002", cell_ids) == "exp02-s002"  # exact match
    assert checker._resolve_cell_id("nope", cell_ids) is None
    # Ambiguous: two known cell_ids both match "a-b-cell1" as a "-<cell_id>" suffix
    # ("b-cell1" and "cell1") and neither is an exact match -> unresolved, never guessed.
    assert checker._resolve_cell_id("a-b-cell1", ["cell1", "b-cell1"]) is None


def test_raw_only_rows_carry_cell_id_resolved_from_the_batch_cell_list(tmp_path):
    anchor = tmp_path / "anchor.png"
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    Image.new("RGB", (4, 4), "white").save(anchor)
    # Harness on-disk naming: "c001-<cell_id>" (build_expansion_set.py's output_name).
    for cell_id in ("exp02-s001", "exp02-s002"):
        Image.new("RGB", (4, 4), "white").save(images_dir / f"c001-{cell_id}.png")

    out = tmp_path / "out"
    report = checker.evaluate(
        anchor, images_dir, out, lambda _p: [1.0, 0.0], lambda _p: [1.0, 0.0],
        raw_only=True, cell_ids=["exp02-s001", "exp02-s002"],
    )
    by_image_id = {row["image_id"]: row for row in report["images"]}
    assert by_image_id["c001-exp02-s001"]["cell_id"] == "exp02-s001"
    assert by_image_id["c001-exp02-s002"]["cell_id"] == "exp02-s002"


def test_raw_only_rows_have_null_cell_id_when_no_batch_context_is_given(tmp_path):
    anchor = tmp_path / "anchor.png"
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    Image.new("RGB", (4, 4), "white").save(anchor)
    Image.new("RGB", (4, 4), "white").save(images_dir / "c001-exp02-s001.png")

    report = checker.evaluate(
        anchor, images_dir, tmp_path / "out", lambda _p: [1.0, 0.0], lambda _p: [1.0, 0.0],
        raw_only=True,
    )
    assert report["images"][0]["cell_id"] is None


def test_load_batch_cell_ids_reads_the_batch_cells_list(tmp_path):
    batch_path = tmp_path / "batch.json"
    batch_path.write_text(json.dumps({
        "cells": [
            {"cell_id": "exp02-s001"},
            {"cell_id": "exp02-s002"},
            {"not_a_cell_id": "ignored"},
        ]
    }), encoding="utf-8")
    assert checker._load_batch_cell_ids(batch_path) == ["exp02-s001", "exp02-s002"]


def test_load_batch_cell_ids_is_never_fatal_on_a_malformed_document(tmp_path):
    batch_path = tmp_path / "batch.json"
    batch_path.write_text("not json", encoding="utf-8")
    assert checker._load_batch_cell_ids(batch_path) == []
    missing = tmp_path / "does-not-exist.json"
    assert checker._load_batch_cell_ids(missing) == []


def test_resolve_scoring_inputs_rejects_mixed_or_missing_modes():
    parser = checker.build_parser()

    both = parser.parse_args([
        "--anchor", "a.png", "--images", "imgs", "--persona", "p.yaml", "--batch", "b.json",
        "--out", "out",
    ])
    with pytest.raises(checker.IdentityCheckError, match="mutually exclusive"):
        checker.resolve_scoring_inputs(both)

    neither = parser.parse_args(["--out", "out"])
    with pytest.raises(checker.IdentityCheckError, match="provide either"):
        checker.resolve_scoring_inputs(neither)

    incomplete_legacy = parser.parse_args(["--anchor", "a.png", "--out", "out"])
    with pytest.raises(checker.IdentityCheckError, match="must be given together"):
        checker.resolve_scoring_inputs(incomplete_legacy)

    incomplete_persona = parser.parse_args(["--persona", "p.yaml", "--out", "out"])
    with pytest.raises(checker.IdentityCheckError, match="must be given together"):
        checker.resolve_scoring_inputs(incomplete_persona)


# ---------------------------------------------------------------------------
# expansion-03 design §6 risk 2 / risk 6 — score every image against EVERY
# persona reference (not only references[0]), record anchor_cosine_max and
# anchor_cosine_own, and a zero-cost calibrate-anchors CLI for the anchors
# themselves (docs/superpowers/specs/2026-09-03-figment-expansion-03-design.md).
# ---------------------------------------------------------------------------


def test_raw_only_scores_against_every_reference_and_records_max_and_own(tmp_path):
    anchor = tmp_path / "g01.png"
    ref2 = tmp_path / "g02.png"
    ref3 = tmp_path / "g07.png"
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    out = tmp_path / "out"
    for ref in (anchor, ref2, ref3):
        Image.new("RGB", (4, 4), "white").save(ref)
    Image.new("RGB", (4, 4), "white").save(images_dir / "c001-exp03-g01-t01.png")

    face_vectors = {
        "g01": [1.0, 0.0],
        "g02": [0.6, 0.8],
        "g07": [0.0, 1.0],
        "c001-exp03-g01-t01": [0.8, 0.6],
    }

    def face_embedder(path):
        return face_vectors[path.stem]

    report = checker.evaluate(
        anchor, images_dir, out, face_embedder, lambda _p: [1.0, 0.0],
        raw_only=True,
        references=[anchor, ref2, ref3],
        cell_ids=["exp03-g01-t01"],
        cell_anchors={"exp03-g01-t01": "g01"},
    )
    row = report["images"][0]
    assert row["cell_id"] == "exp03-g01-t01"
    assert set(row["anchor_cosines"]) == {"g01", "g02", "g07"}
    assert row["anchor_cosines"]["g02"] == pytest.approx(0.96)
    assert row["anchor_cosine_max"] == pytest.approx(0.96)
    assert row["anchor_cosine_max"] == max(row["anchor_cosines"].values())
    assert row["own_anchor"] == "g01"
    assert row["anchor_cosine_own"] == row["anchor_cosines"]["g01"]
    assert row["anchor_cosine_own"] == pytest.approx(0.8)
    assert row["anchor_cosine"] == row["anchor_cosine_max"]
    # backward compat: the legacy face_cosine field still tracks the primary
    # (first / references[0]) anchor, exactly as it did before this defect fix.
    assert row["face_cosine"] == row["anchor_cosines"]["g01"]


def test_raw_only_records_null_own_anchor_when_batch_has_no_anchor_metadata(tmp_path):
    """Mirrors expansion-02's own batch.json: cells carry no anchor/source_anchor
    metadata field, so own-anchor resolution must fall back to null rather than
    guessing — the max is still reported."""
    anchor = tmp_path / "g01.png"
    ref2 = tmp_path / "g02.png"
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    Image.new("RGB", (4, 4), "white").save(anchor)
    Image.new("RGB", (4, 4), "white").save(ref2)
    Image.new("RGB", (4, 4), "white").save(images_dir / "c001-exp02-s001.png")

    face_vectors = {"g01": [1.0, 0.0], "g02": [0.0, 1.0], "c001-exp02-s001": [1.0, 0.0]}

    def face_embedder(path):
        return face_vectors[path.stem]

    report = checker.evaluate(
        anchor, images_dir, tmp_path / "out", face_embedder, lambda _p: [1.0, 0.0],
        raw_only=True, references=[anchor, ref2],
        cell_ids=["exp02-s001"], cell_anchors={"exp02-s001": None},
    )
    row = report["images"][0]
    assert row["own_anchor"] is None
    assert row["anchor_cosine_own"] is None
    assert row["anchor_cosine_max"] == pytest.approx(1.0)
    assert row["anchor_cosine"] == pytest.approx(1.0)


def test_raw_only_without_references_keeps_legacy_single_anchor_shape(tmp_path):
    """No `references`/`cell_anchors` given at all (every pre-existing caller) —
    the new fields still appear (max == the sole anchor's cosine, own always
    null since there is no batch context) but nothing about the legacy fields
    changes."""
    anchor = tmp_path / "anchor.png"
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    Image.new("RGB", (4, 4), "white").save(anchor)
    Image.new("RGB", (4, 4), "white").save(images_dir / "good-a.png")

    report = checker.evaluate(
        anchor, images_dir, tmp_path / "out",
        lambda _p: [1.0, 0.0], lambda _p: [1.0, 0.0], raw_only=True,
    )
    row = report["images"][0]
    assert row["face_cosine"] == pytest.approx(1.0)
    assert row["anchor_cosine_max"] == pytest.approx(1.0)
    assert row["anchor_cosine"] == pytest.approx(1.0)
    assert row["own_anchor"] is None
    assert row["anchor_cosine_own"] is None


def test_load_batch_cell_anchors_reads_anchor_or_source_anchor_field(tmp_path):
    batch_path = tmp_path / "batch.json"
    batch_path.write_text(json.dumps({
        "cells": [
            {"cell_id": "exp03-g01-t01", "anchor": "g01"},
            {"cell_id": "exp03-g02-t01", "source_anchor": "g02"},
            {"cell_id": "exp02-s001"},
        ]
    }), encoding="utf-8")
    assert checker._load_batch_cell_anchors(batch_path) == {
        "exp03-g01-t01": "g01",
        "exp03-g02-t01": "g02",
        "exp02-s001": None,
    }


def test_load_batch_cell_anchors_is_never_fatal_on_a_malformed_document(tmp_path):
    batch_path = tmp_path / "batch.json"
    batch_path.write_text("not json", encoding="utf-8")
    assert checker._load_batch_cell_anchors(batch_path) == {}
    missing = tmp_path / "does-not-exist.json"
    assert checker._load_batch_cell_anchors(missing) == {}


def test_calibrate_anchors_parser_requires_persona():
    parser = checker.build_calibrate_parser()
    args = parser.parse_args(["--persona", "persona.yaml"])
    assert args.persona == Path("persona.yaml")


def test_calibrate_anchors_computes_pairwise_cosines_and_writes_persona_calibration(tmp_path):
    import hashlib

    persona_dir = tmp_path / "personas" / "creator-001"
    persona_dir.mkdir(parents=True)
    (persona_dir / "anchors").mkdir()
    for name in ("g01.jpg", "g02.jpg", "g07.jpg"):
        (persona_dir / "anchors" / name).write_bytes(b"\xff\xd8\xff")
    identity_spec_bytes = b"x\n"
    (persona_dir / "identity-spec.md").write_bytes(identity_spec_bytes)
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    look_spec_bytes = b"x\n"
    (pipeline_dir / "look-spec-v2.md").write_bytes(look_spec_bytes)

    persona_data = json.loads(PIPELINE.parent.joinpath(
        "personas", "creator-001", "persona.yaml"
    ).read_text(encoding="utf-8"))
    # The real creator-001 persona.yaml may itself already carry a calibration
    # block (calibrate-anchors has actually been run against it) — normalize the
    # fixture baseline so this test's own before/after comparisons stay
    # deterministic regardless of that live file's current calibration state.
    persona_data["identity"].pop("calibration", None)
    persona_data["identity"]["spec"]["sha256"] = hashlib.sha256(identity_spec_bytes).hexdigest()
    persona_data["register"]["spec"]["sha256"] = hashlib.sha256(look_spec_bytes).hexdigest()
    persona_path = persona_dir / "persona.yaml"
    # Pretty-printed, matching creator-001's real on-disk persona.yaml convention
    # (_write_calibration_block splices text in place rather than re-serializing
    # the whole document, so it needs real line structure to attach to).
    persona_path.write_text(json.dumps(persona_data, indent=2), encoding="utf-8")

    vectors = {"g01": [1.0, 0.0], "g02": [0.6, 0.8], "g07": [0.0, 1.0]}

    def face_embedder(path):
        return vectors[path.stem]

    calibration = checker.calibrate_anchors(persona_path, face_embedder)

    assert calibration["anchor_pairwise"] == {
        "g01:g02": pytest.approx(0.6),
        "g01:g07": pytest.approx(0.0),
        "g02:g07": pytest.approx(0.8),
    }
    assert calibration["anchor_cosine_floor_suggested"] == pytest.approx(0.0 - 0.05)

    on_disk = json.loads(persona_path.read_text(encoding="utf-8"))
    assert on_disk["identity"]["calibration"] == calibration
    on_disk_identity_minus_calibration = dict(on_disk["identity"])
    del on_disk_identity_minus_calibration["calibration"]
    assert on_disk_identity_minus_calibration == persona_data["identity"]
    assert on_disk["grammar"] == persona_data["grammar"]
    assert on_disk["register"] == persona_data["register"]


def test_calibrate_anchors_rerun_replaces_existing_calibration_idempotently(tmp_path):
    """A second calibrate-anchors run must replace identity.calibration in place —
    never append a duplicate "calibration" key, and never drift the JSON's
    indentation (a naive re-splice can accidentally double an indent level on
    replace, since json.dumps' own per-line indent must not be added twice)."""
    import hashlib

    persona_dir = tmp_path / "personas" / "creator-001"
    persona_dir.mkdir(parents=True)
    (persona_dir / "anchors").mkdir()
    for name in ("g01.jpg", "g02.jpg", "g07.jpg"):
        (persona_dir / "anchors" / name).write_bytes(b"\xff\xd8\xff")
    identity_spec_bytes = b"x\n"
    (persona_dir / "identity-spec.md").write_bytes(identity_spec_bytes)
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    look_spec_bytes = b"x\n"
    (pipeline_dir / "look-spec-v2.md").write_bytes(look_spec_bytes)

    persona_data = json.loads(PIPELINE.parent.joinpath(
        "personas", "creator-001", "persona.yaml"
    ).read_text(encoding="utf-8"))
    # Normalize the fixture baseline the same way as the test above — the real
    # persona.yaml may already carry a calibration block from a prior real run.
    persona_data["identity"].pop("calibration", None)
    persona_data["identity"]["spec"]["sha256"] = hashlib.sha256(identity_spec_bytes).hexdigest()
    persona_data["register"]["spec"]["sha256"] = hashlib.sha256(look_spec_bytes).hexdigest()
    persona_path = persona_dir / "persona.yaml"
    persona_path.write_text(json.dumps(persona_data, indent=2), encoding="utf-8")

    vectors_first = {"g01": [1.0, 0.0], "g02": [0.6, 0.8], "g07": [0.0, 1.0]}
    vectors_second = {"g01": [1.0, 0.0], "g02": [0.0, 1.0], "g07": [-1.0, 0.0]}

    checker.calibrate_anchors(persona_path, lambda path: vectors_first[path.stem])
    text_after_first = persona_path.read_text(encoding="utf-8")
    assert text_after_first.count('"calibration"') == 1

    second = checker.calibrate_anchors(persona_path, lambda path: vectors_second[path.stem])
    text_after_second = persona_path.read_text(encoding="utf-8")

    # exactly one "calibration" key — the first run's was replaced, not duplicated
    assert text_after_second.count('"calibration"') == 1
    on_disk = json.loads(text_after_second)
    assert on_disk["identity"]["calibration"] == second
    assert second["anchor_pairwise"] == {
        "g01:g02": pytest.approx(0.0),
        "g01:g07": pytest.approx(-1.0),
        "g02:g07": pytest.approx(0.0),
    }
    # every other field survived both writes untouched
    on_disk_identity_minus_calibration = dict(on_disk["identity"])
    del on_disk_identity_minus_calibration["calibration"]
    assert on_disk_identity_minus_calibration == persona_data["identity"]

    # indentation is consistent with a fresh (first-run) write — no doubled
    # indent level from the replace path re-adding json.dumps' own per-line indent.
    persona_path.write_text(json.dumps(persona_data, indent=2), encoding="utf-8")
    checker.calibrate_anchors(persona_path, lambda path: vectors_second[path.stem])
    text_fresh = persona_path.read_text(encoding="utf-8")
    assert text_fresh == text_after_second


def test_calibrate_anchors_requires_at_least_two_references(tmp_path):
    import hashlib

    persona_dir = tmp_path / "personas" / "creator-001"
    persona_dir.mkdir(parents=True)
    (persona_dir / "anchors").mkdir()
    (persona_dir / "anchors" / "g01.jpg").write_bytes(b"\xff\xd8\xff")
    identity_spec_bytes = b"x\n"
    (persona_dir / "identity-spec.md").write_bytes(identity_spec_bytes)
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    look_spec_bytes = b"x\n"
    (pipeline_dir / "look-spec-v2.md").write_bytes(look_spec_bytes)

    persona_data = json.loads(PIPELINE.parent.joinpath(
        "personas", "creator-001", "persona.yaml"
    ).read_text(encoding="utf-8"))
    persona_data["identity"]["references"] = ["anchors/g01.jpg"]
    persona_data["identity"]["spec"]["sha256"] = hashlib.sha256(identity_spec_bytes).hexdigest()
    persona_data["register"]["spec"]["sha256"] = hashlib.sha256(look_spec_bytes).hexdigest()
    persona_path = persona_dir / "persona.yaml"
    persona_path.write_text(json.dumps(persona_data), encoding="utf-8")

    with pytest.raises(checker.IdentityCheckError, match="at least two"):
        checker.calibrate_anchors(persona_path, lambda path: [1.0, 0.0])


def test_resolve_scoring_inputs_persona_batch_mode_resolves_paths(tmp_path):
    import hashlib

    persona_dir = tmp_path / "personas" / "creator-001"
    persona_dir.mkdir(parents=True)
    (persona_dir / "anchors").mkdir()
    anchor_file = persona_dir / "anchors" / "g01.jpg"
    for name in ("g01.jpg", "g02.jpg", "g07.jpg"):
        (persona_dir / "anchors" / name).write_bytes(b"\xff\xd8\xff")
    identity_spec_bytes = b"x\n"
    (persona_dir / "identity-spec.md").write_bytes(identity_spec_bytes)
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    look_spec_bytes = b"x\n"
    (pipeline_dir / "look-spec-v2.md").write_bytes(look_spec_bytes)

    persona_data = json.loads(PIPELINE.parent.joinpath(
        "personas", "creator-001", "persona.yaml"
    ).read_text(encoding="utf-8"))
    # persona.py now validates these against the live file digest (P2R finding 4) —
    # so the fixture's declared hashes must match the fixture files actually staged
    # above, not an arbitrary placeholder.
    persona_data["identity"]["spec"]["sha256"] = hashlib.sha256(identity_spec_bytes).hexdigest()
    persona_data["register"]["spec"]["sha256"] = hashlib.sha256(look_spec_bytes).hexdigest()
    (persona_dir / "persona.yaml").write_text(json.dumps(persona_data), encoding="utf-8")

    batch_dir = tmp_path / "batches" / "expansion-02"
    batch_dir.mkdir(parents=True)
    (batch_dir / "batch.json").write_text(json.dumps({"stage": "building"}), encoding="utf-8")

    parser = checker.build_parser()
    args = parser.parse_args([
        "--persona", str(persona_dir / "persona.yaml"),
        "--batch", str(batch_dir / "batch.json"),
        "--out", str(tmp_path / "out"),
    ])
    anchor, image_dir = checker.resolve_scoring_inputs(args)
    assert anchor == anchor_file.resolve()
    assert image_dir == (batch_dir / "images").resolve()


def test_resolve_cell_id_strips_mechanism_suffix():
    from identity_check import _resolve_cell_id
    ids = ["exp03-g01-t01", "exp03-g01-t02"]
    assert _resolve_cell_id("c001-exp03-g01-t01-mechA", ids) == "exp03-g01-t01"
    assert _resolve_cell_id("c001-exp03-g01-t02", ids) == "exp03-g01-t02"
    assert _resolve_cell_id("c001-exp03-g01-t09-mechA", ids) is None

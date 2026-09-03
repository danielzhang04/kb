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


def test_resolve_scoring_inputs_persona_batch_mode_resolves_paths(tmp_path):
    persona_dir = tmp_path / "personas" / "creator-001"
    persona_dir.mkdir(parents=True)
    (persona_dir / "anchors").mkdir()
    anchor_file = persona_dir / "anchors" / "g01.jpg"
    for name in ("g01.jpg", "g02.jpg", "g07.jpg"):
        (persona_dir / "anchors" / name).write_bytes(b"\xff\xd8\xff")
    (persona_dir / "identity-spec.md").write_text("x\n", encoding="utf-8")
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir()
    (pipeline_dir / "look-spec-v2.md").write_text("x\n", encoding="utf-8")

    persona_data = json.loads(PIPELINE.parent.joinpath(
        "personas", "creator-001", "persona.yaml"
    ).read_text(encoding="utf-8"))
    persona_data["identity"]["spec"]["sha256"] = "0" * 64
    persona_data["register"]["spec"]["sha256"] = "0" * 64
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

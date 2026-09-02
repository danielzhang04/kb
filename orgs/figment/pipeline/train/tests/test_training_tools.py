import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image


TRAIN = Path(__file__).resolve().parents[1]
PIPELINE = TRAIN.parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


builder = load_module("build_identity_set", TRAIN / "build_identity_set.py")
checker = load_module("identity_check", TRAIN / "identity_check.py")
qa_stamp = load_module("figment_qa_stamp", PIPELINE / "qa_stamp.py")


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


def test_identity_manifest_is_balanced_and_writes_variable_only_captions(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "replacements": {"blue-black": "natural jet-black with a cool sheen"},
        "prompt_clauses": ["Keep the adult face fresh and naturally textured"],
    }), encoding="utf-8")
    captions = tmp_path / "captions"
    manifest = builder.build_identity_manifest(
        PIPELINE / "bakeoff" / "arm-b-klein4b.yaml",
        "c01",
        settings,
        "figmentc01",
        captions,
    )
    assert len(manifest["jobs"]) == 40
    assert Counter(job["identity_cell"]["angle"] for job in manifest["jobs"]) == {
        name: 8 for name in builder.ANGLES
    }
    assert Counter(job["identity_cell"]["lighting"] for job in manifest["jobs"]) == {
        name: 10 for name in builder.LIGHTING
    }
    assert Counter(job["identity_cell"]["distance"] for job in manifest["jobs"]) == {
        name: 20 for name in builder.DISTANCES
    }
    sidecars = sorted(captions.glob("*.txt"))
    assert len(sidecars) == 40
    for sidecar in sidecars:
        text = sidecar.read_text(encoding="utf-8")
        assert text.startswith("figmentc01, ")
        assert "face" not in text.lower()
        assert "skin" not in text.lower()


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

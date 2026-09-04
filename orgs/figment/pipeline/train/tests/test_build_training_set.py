"""Tests for `train/build_training_set.py` (brief T1-FC finding 9): the missing
dataset-to-training bridge. Reuses the repo's ad-hoc `load_module` file loader,
same pattern as `test_tensor_track.py`/`test_training_tools.py`.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest
from PIL import Image

TRAIN = Path(__file__).resolve().parents[1]
PIPELINE = TRAIN.parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


bts = load_module("figment_train_build_training_set", TRAIN / "build_training_set.py")


def _make_image(path: Path, color=(10, 20, 30)):
    Image.new("RGB", (8, 8), color).save(path)


# ---------------------------------------------------------------------------
# mode: provided
# ---------------------------------------------------------------------------


def test_provided_mode_builds_png_and_caption_pairs_and_manifest(tmp_path):
    src_dir = tmp_path / "graded"
    src_dir.mkdir()
    _make_image(src_dir / "a.jpg", (200, 0, 0))
    _make_image(src_dir / "b.png", (0, 200, 0))
    cells = [
        {"image": "graded/a.jpg", "caption": "a woman, front view"},
        {"image": "graded/b.png", "caption": "a woman, side view"},
    ]
    cells_path = tmp_path / "approved.json"
    cells_path.write_text(json.dumps(cells), encoding="utf-8")
    out_dir = tmp_path / "out"

    manifest = bts.build_training_set(
        approved_cells=cells_path, source_dir=None, caption_mode="provided", out_dir=out_dir,
    )

    assert manifest["count"] == 2
    assert manifest["caption_mode"] == "provided"
    assert (out_dir / "01.png").is_file()
    assert (out_dir / "02.png").is_file()
    assert (out_dir / "01.txt").read_text(encoding="utf-8") == "a woman, front view\n"
    assert (out_dir / "02.txt").read_text(encoding="utf-8") == "a woman, side view\n"
    # every output is a real PNG, even the jpg source
    with Image.open(out_dir / "01.png") as image:
        assert image.format == "PNG"
    # manifest is NOT named training.json — that name is reserved for the
    # ai-toolkit config render_aitoolkit_config.py writes into this same dir.
    assert (out_dir / "dataset_manifest.json").is_file()
    assert not (out_dir / "training.json").exists()


def test_provided_mode_manifest_sha256_matches_written_png(tmp_path):
    src_dir = tmp_path / "graded"
    src_dir.mkdir()
    _make_image(src_dir / "a.png")
    cells_path = tmp_path / "approved.json"
    cells_path.write_text(
        json.dumps([{"image": "graded/a.png", "caption": "a woman"}]), encoding="utf-8",
    )
    out_dir = tmp_path / "out"
    manifest = bts.build_training_set(
        approved_cells=cells_path, source_dir=None, caption_mode="provided", out_dir=out_dir,
    )
    import hashlib
    on_disk = hashlib.sha256((out_dir / "01.png").read_bytes()).hexdigest()
    assert manifest["files"] == [{"image": "01.png", "caption_file": "01.txt", "sha256": on_disk}]


def test_dataset_ready_marker_is_written_last(tmp_path):
    src_dir = tmp_path / "graded"
    src_dir.mkdir()
    _make_image(src_dir / "a.png")
    cells_path = tmp_path / "approved.json"
    cells_path.write_text(
        json.dumps([{"image": "graded/a.png", "caption": "a woman"}]), encoding="utf-8",
    )
    out_dir = tmp_path / "out"
    bts.build_training_set(
        approved_cells=cells_path, source_dir=None, caption_mode="provided", out_dir=out_dir,
    )
    ready = out_dir / "_dataset.ready"
    assert ready.is_file()
    assert ready.read_text(encoding="utf-8") == ""
    others = [p for p in out_dir.iterdir() if p.name != "_dataset.ready"]
    assert others, "expected image/caption/manifest files alongside the marker"
    assert ready.stat().st_mtime_ns >= max(p.stat().st_mtime_ns for p in others)


def test_provided_mode_requires_non_empty_image_and_caption_fields(tmp_path):
    cells_path = tmp_path / "approved.json"
    cells_path.write_text(json.dumps([{"image": "", "caption": "x"}]), encoding="utf-8")
    with pytest.raises(bts.DatasetBuildError):
        bts.build_training_set(
            approved_cells=cells_path, source_dir=None, caption_mode="provided",
            out_dir=tmp_path / "out",
        )


def test_provided_mode_rejects_a_missing_image_file(tmp_path):
    cells_path = tmp_path / "approved.json"
    cells_path.write_text(
        json.dumps([{"image": "nope.png", "caption": "a woman"}]), encoding="utf-8",
    )
    with pytest.raises(bts.DatasetBuildError, match="not found"):
        bts.build_training_set(
            approved_cells=cells_path, source_dir=None, caption_mode="provided",
            out_dir=tmp_path / "out",
        )


def test_provided_mode_rejects_malformed_json(tmp_path):
    cells_path = tmp_path / "approved.json"
    cells_path.write_text("not json", encoding="utf-8")
    with pytest.raises(bts.DatasetBuildError):
        bts.build_training_set(
            approved_cells=cells_path, source_dir=None, caption_mode="provided",
            out_dir=tmp_path / "out",
        )


def test_provided_mode_forbids_a_source_dir_too(tmp_path):
    cells_path = tmp_path / "approved.json"
    cells_path.write_text(json.dumps([{"image": "a.png", "caption": "x"}]), encoding="utf-8")
    with pytest.raises(bts.DatasetBuildError):
        bts.build_training_set(
            approved_cells=cells_path, source_dir=tmp_path, caption_mode="provided",
            out_dir=tmp_path / "out",
        )


# ---------------------------------------------------------------------------
# mode: class
# ---------------------------------------------------------------------------


def test_class_mode_captions_every_image_the_single_word(tmp_path):
    src_dir = tmp_path / "graded"
    src_dir.mkdir()
    _make_image(src_dir / "b.png", (0, 0, 200))
    _make_image(src_dir / "a.jpg", (200, 200, 0))
    out_dir = tmp_path / "out"

    manifest = bts.build_training_set(
        approved_cells=None, source_dir=src_dir, caption_mode="class", out_dir=out_dir,
    )

    assert manifest["count"] == 2
    assert manifest["caption_mode"] == "class"
    # sorted by source filename: a.jpg before b.png
    assert (out_dir / "01.txt").read_text(encoding="utf-8") == "woman\n"
    assert (out_dir / "02.txt").read_text(encoding="utf-8") == "woman\n"
    assert (out_dir / "_dataset.ready").is_file()


def test_class_mode_requires_a_source_dir_only(tmp_path):
    with pytest.raises(bts.DatasetBuildError):
        bts.build_training_set(
            approved_cells=None, source_dir=None, caption_mode="class",
            out_dir=tmp_path / "out",
        )


def test_class_mode_rejects_an_empty_directory(tmp_path):
    src_dir = tmp_path / "graded"
    src_dir.mkdir()
    with pytest.raises(bts.DatasetBuildError):
        bts.build_training_set(
            approved_cells=None, source_dir=src_dir, caption_mode="class",
            out_dir=tmp_path / "out",
        )


# ---------------------------------------------------------------------------
# mode: qwen3vl (documented hook, not implemented)
# ---------------------------------------------------------------------------


def test_qwen3vl_mode_is_a_documented_hook_not_implemented(tmp_path):
    src_dir = tmp_path / "graded"
    src_dir.mkdir()
    _make_image(src_dir / "a.png")
    out_dir = tmp_path / "out"
    with pytest.raises(bts.DatasetBuildError, match="not implemented"):
        bts.build_training_set(
            approved_cells=None, source_dir=src_dir, caption_mode="qwen3vl", out_dir=out_dir,
        )
    assert not out_dir.exists(), "must not write any partial output before failing"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def test_cli_defaults_mode_from_which_input_flag_is_given(tmp_path, capsys):
    src_dir = tmp_path / "graded"
    src_dir.mkdir()
    _make_image(src_dir / "a.png")
    out_dir = tmp_path / "out"
    rc = bts.main(["--source-dir", str(src_dir), "--out", str(out_dir)])
    assert rc == 0
    assert (out_dir / "dataset_manifest.json").is_file()
    out = json.loads((out_dir / "dataset_manifest.json").read_text(encoding="utf-8"))
    assert out["caption_mode"] == "class"


def test_cli_requires_one_input_flag(capsys):
    rc = bts.main(["--out", "unused"])
    assert rc == 2
    assert "required" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# the train manifest's uploads glob points at this directory
# ---------------------------------------------------------------------------


def test_train_manifest_uploads_glob_points_at_the_dataset_build_output_dir():
    manifest = json.loads(
        (TRAIN / "runs" / "creator-001-tensor-train.yaml").read_text(encoding="utf-8")
    )
    dataset_files = manifest["uploads"][0]["files"]
    assert all(f.startswith("creator-001-tensor-dataset/") for f in dataset_files)
    ready_files = manifest["uploads"][1]["files"]
    assert ready_files == ["creator-001-tensor-dataset/_dataset.ready"]

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


def _training_json_config(
    dataset_dir: str,
    output_dir: str = "/workspace/train-output",
    base_model_path: str = "/workspace/models/krea2/krea2_raw_bf16.safetensors",
) -> dict:
    """Minimal shape `validate_rendered_pod_paths` needs, matching what
    `render_aitoolkit_config.py` actually writes into `training.json`."""
    return {
        "config": {
            "process": [{
                "training_folder": output_dir,
                "datasets": [{"folder_path": dataset_dir}],
                "model": {"name_or_path": base_model_path},
            }],
        },
    }


def test_existing_bad_training_json_blocks_the_ready_marker(tmp_path):
    src_dir = tmp_path / "graded"
    src_dir.mkdir()
    _make_image(src_dir / "a.png")
    cells_path = tmp_path / "approved.json"
    cells_path.write_text(
        json.dumps([{"image": "graded/a.png", "caption": "a woman"}]), encoding="utf-8",
    )
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    bad_config = _training_json_config(
        dataset_dir="C:/Program Files/Git/workspace/ComfyUI/input/creator001krea2",
    )
    (out_dir / "training.json").write_text(json.dumps(bad_config), encoding="utf-8")

    with pytest.raises(bts.DatasetBuildError, match="bad pod path"):
        bts.build_training_set(
            approved_cells=cells_path, source_dir=None, caption_mode="provided", out_dir=out_dir,
        )

    assert not (out_dir / "_dataset.ready").is_file()
    # The images/captions/manifest were still written before the guard fires —
    # only the ready marker (the upload-readiness signal) is withheld.
    assert (out_dir / "01.png").is_file()


def test_existing_good_training_json_does_not_block_the_ready_marker(tmp_path):
    src_dir = tmp_path / "graded"
    src_dir.mkdir()
    _make_image(src_dir / "a.png")
    cells_path = tmp_path / "approved.json"
    cells_path.write_text(
        json.dumps([{"image": "graded/a.png", "caption": "a woman"}]), encoding="utf-8",
    )
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    good_config = _training_json_config(
        dataset_dir="/workspace/ComfyUI/input/creator001krea2",
    )
    (out_dir / "training.json").write_text(json.dumps(good_config), encoding="utf-8")

    manifest = bts.build_training_set(
        approved_cells=cells_path, source_dir=None, caption_mode="provided", out_dir=out_dir,
    )

    assert manifest["count"] == 1
    assert (out_dir / "_dataset.ready").is_file()


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
# mode: class, --images-from (finding 9: tonight's multi-run-dir class captions)
# ---------------------------------------------------------------------------


def test_images_from_combines_multiple_dirs_in_argument_order(tmp_path):
    smoke_dir = tmp_path / "smoke"
    shard01_dir = tmp_path / "shard-01"
    shard02_dir = tmp_path / "shard-02"
    for d in (smoke_dir, shard01_dir, shard02_dir):
        d.mkdir()
    _make_image(smoke_dir / "c001-tensor-smoke-f01.png", (10, 10, 10))
    _make_image(shard01_dir / "c001-tds-f02.png", (20, 20, 20))
    _make_image(shard01_dir / "c001-tds-f01.png", (30, 30, 30))
    _make_image(shard02_dir / "c001-tds-f11.png", (40, 40, 40))
    out_dir = tmp_path / "out"

    manifest = bts.build_training_set(
        approved_cells=None, source_dir=None, caption_mode="class", out_dir=out_dir,
        images_from=[smoke_dir, shard01_dir, shard02_dir],
    )

    assert manifest["count"] == 4
    assert manifest["caption_mode"] == "class"
    # argument order across dirs, sorted by filename within each dir:
    # smoke (1 file), then shard-01 sorted (f01 before f02), then shard-02.
    assert [entry["image"] for entry in manifest["files"]] == ["01.png", "02.png", "03.png", "04.png"]
    for entry in manifest["files"]:
        assert (out_dir / entry["caption_file"]).read_text(encoding="utf-8") == "woman\n"


def test_images_from_applies_exclude_by_filename_and_by_stem(tmp_path):
    shard_dir = tmp_path / "shard-01"
    shard_dir.mkdir()
    _make_image(shard_dir / "c001-tds-f01.png")
    _make_image(shard_dir / "c001-tds-f02.png")
    _make_image(shard_dir / "c001-tds-f03.png")
    out_dir = tmp_path / "out"

    manifest = bts.build_training_set(
        approved_cells=None, source_dir=None, caption_mode="class", out_dir=out_dir,
        images_from=[shard_dir],
        # one excluded by full filename, one excluded by bare stem
        exclude=["c001-tds-f01.png", "c001-tds-f02"],
    )

    assert manifest["count"] == 1
    on_disk_sources = {Path(e["image"]).name for e in manifest["files"]}
    assert on_disk_sources == {"01.png"}


def test_images_from_rejects_a_missing_directory(tmp_path):
    with pytest.raises(bts.DatasetBuildError):
        bts.build_training_set(
            approved_cells=None, source_dir=None, caption_mode="class",
            out_dir=tmp_path / "out", images_from=[tmp_path / "nope"],
        )


def test_images_from_rejects_empty_result_after_exclude(tmp_path):
    shard_dir = tmp_path / "shard-01"
    shard_dir.mkdir()
    _make_image(shard_dir / "c001-tds-f01.png")
    with pytest.raises(bts.DatasetBuildError):
        bts.build_training_set(
            approved_cells=None, source_dir=None, caption_mode="class",
            out_dir=tmp_path / "out", images_from=[shard_dir],
            exclude=["c001-tds-f01.png"],
        )


def test_images_from_and_source_dir_together_is_rejected(tmp_path):
    shard_dir = tmp_path / "shard-01"
    shard_dir.mkdir()
    _make_image(shard_dir / "a.png")
    with pytest.raises(bts.DatasetBuildError):
        bts.build_training_set(
            approved_cells=None, source_dir=shard_dir, caption_mode="class",
            out_dir=tmp_path / "out", images_from=[shard_dir],
        )


def test_exclude_requires_images_from(tmp_path):
    shard_dir = tmp_path / "shard-01"
    shard_dir.mkdir()
    _make_image(shard_dir / "a.png")
    with pytest.raises(bts.DatasetBuildError):
        bts.build_training_set(
            approved_cells=None, source_dir=shard_dir, caption_mode="class",
            out_dir=tmp_path / "out", exclude=["a.png"],
        )


def test_cli_images_from_multiple_dirs_with_exclude(tmp_path):
    shard01 = tmp_path / "shard-01"
    shard02 = tmp_path / "shard-02"
    shard01.mkdir()
    shard02.mkdir()
    _make_image(shard01 / "c001-tds-f01.png")
    _make_image(shard01 / "c001-tds-f02.png")
    _make_image(shard02 / "c001-tds-f11.png")
    out_dir = tmp_path / "out"

    rc = bts.main([
        "--images-from", str(shard01), str(shard02),
        "--exclude", "c001-tds-f02.png",
        "--out", str(out_dir),
    ])
    assert rc == 0
    on_disk = json.loads((out_dir / "dataset_manifest.json").read_text(encoding="utf-8"))
    assert on_disk["count"] == 2
    assert on_disk["caption_mode"] == "class"


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

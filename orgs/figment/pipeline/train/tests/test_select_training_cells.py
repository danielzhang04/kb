"""Tests for `train/select_training_cells.py` -- the Path-A "train-first" cell
selector (r24 method 4 + r21 DOP + r25 causes #4/#5): pick only the cells an
operator-run judge already rated closest to the persona's own anchors, from
EVERY existing evidence set, instead of a fresh uncurated dataset shard.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

TRAIN = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sc = load_module("figment_select_training_cells", TRAIN / "select_training_cells.py")


def _write_png(path: Path, content: bytes = b"PNGDATA") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def _write_real_png(path: Path) -> None:
    """A real 1x1 PNG -- needed only where `build_training_set.py` re-encodes the file
    through Pillow (the CLI's `--dataset-out` path); everywhere else a bare marker file
    is enough since this module never opens image bytes itself."""
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (1, 1)).save(path, format="PNG")


# ---------------------------------------------------------------------------
# anchor_cells
# ---------------------------------------------------------------------------


def test_anchor_cells_reads_every_anchor_image_sorted(tmp_path):
    anchors_dir = tmp_path / "anchors"
    for name in ("g07.jpg", "g01.jpg", "g02.jpg"):
        _write_png(anchors_dir / name)
    rows = sc.anchor_cells(anchors_dir)
    assert [row["image_id"] for row in rows] == ["g01", "g02", "g07"]
    assert all(row["source_set"] == "anchors" for row in rows)
    assert all(row["same_person"] is None for row in rows)


def test_anchor_cells_paths_are_absolute_even_given_a_relative_directory(tmp_path, monkeypatch):
    """Regression: a relative --anchors-dir must not leak into selection.json/
    approved-cells.json as a relative path -- build_training_set.py resolves
    approved-cells.json's own "image" entries relative to ITS location, not this
    script's cwd, so a relative path recorded here resolves to the wrong file once
    read back from a different working directory (real creator-001 run: cwd
    `pipeline/train`, approved-cells.json under `train/runs/`, one directory
    deeper -- a relative anchors path silently pointed one level too shallow)."""
    monkeypatch.chdir(tmp_path)
    anchors_dir = tmp_path / "sub" / "anchors"
    _write_png(anchors_dir / "g01.jpg")
    rows = sc.anchor_cells(Path("sub/anchors"))
    assert Path(rows[0]["path"]).is_absolute()
    assert rows[0]["path"] == str(anchors_dir / "g01.jpg")


def test_anchor_cells_rejects_an_empty_directory(tmp_path):
    anchors_dir = tmp_path / "anchors"
    anchors_dir.mkdir()
    with pytest.raises(sc.SelectionError, match="no anchor images"):
        sc.anchor_cells(anchors_dir)


# ---------------------------------------------------------------------------
# load_calibration_candidates
# ---------------------------------------------------------------------------


def _calibration_document(sets: dict) -> dict:
    return {"schema": "figment/judge-calibration@1", "creator": "creator-001", "sets": sets}


def _row(image_id, same_person, age_delta, artifacts, **extra):
    return {"image_id": image_id, "same_person": same_person, "age_delta": age_delta,
            "artifacts": artifacts, **extra}


def test_load_calibration_candidates_resolves_paths_and_carries_scores(tmp_path):
    track1 = tmp_path / "track1"
    _write_png(track1 / "01.png")
    _write_png(track1 / "02.png")
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "anchors": {"rows": [_row("g01", 88, 0, 20)]},
        "track1-dataset": {"rows": [
            _row("01", 85, 1, 20),
            _row("02", 40, 1, 20),
        ]},
    })), encoding="utf-8")

    candidates, skipped = sc.load_calibration_candidates(
        calibration_path, {"track1-dataset": track1},
    )

    assert skipped == []
    assert len(candidates) == 2
    by_id = {c["image_id"]: c for c in candidates}
    assert by_id["01"]["source_set"] == "track1-dataset"
    assert by_id["01"]["path"] == str(track1 / "01.png")
    assert by_id["01"]["same_person"] == 85


def test_load_calibration_candidates_never_reads_the_anchors_set_from_calibration(tmp_path):
    """Real anchors come from `anchor_cells` (the persona's own reference files), never
    from the calibration document's self-consistency 'anchors' rows -- even if a caller
    supplied an image_dir named 'anchors' by mistake."""
    anchors_alias = tmp_path / "anchors-alias"
    _write_png(anchors_alias / "g01.jpg")
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "anchors": {"rows": [_row("g01", 88, 0, 20)]},
    })), encoding="utf-8")

    candidates, _skipped = sc.load_calibration_candidates(
        calibration_path, {"anchors": anchors_alias},
    )
    assert candidates == []


def test_load_calibration_candidates_never_includes_passport_candidates_even_with_a_directory(
        tmp_path):
    passport = tmp_path / "passport"
    _write_png(passport / "c001-anchor-p01.png")
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "passport-candidates": {"rows": [_row("c001-anchor-p01", 95, 0, 5)]},
    })), encoding="utf-8")

    candidates, _skipped = sc.load_calibration_candidates(
        calibration_path, {"passport-candidates": passport},
    )
    assert candidates == []


def test_load_calibration_candidates_skips_a_set_with_no_supplied_image_dir(tmp_path):
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "qwen-anchor-edits": {"rows": [_row("c001-anchor-e01", 85, 1, 20)]},
    })), encoding="utf-8")

    candidates, skipped = sc.load_calibration_candidates(calibration_path, {})
    assert candidates == []
    assert skipped == [{"name": "qwen-anchor-edits", "reason": "no image directory supplied"}]


def test_load_calibration_candidates_paths_are_absolute_even_given_a_relative_image_dir(
        tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    track1 = tmp_path / "sub" / "track1"
    _write_png(track1 / "01.png")
    calibration_path = Path("judge-calibration.json")
    calibration_path.write_text(json.dumps(_calibration_document({
        "track1-dataset": {"rows": [_row("01", 85, 1, 20)]},
    })), encoding="utf-8")

    candidates, _skipped = sc.load_calibration_candidates(
        calibration_path, {"track1-dataset": Path("sub/track1")},
    )
    assert Path(candidates[0]["path"]).is_absolute()
    assert candidates[0]["path"] == str(track1 / "01.png")


def test_load_calibration_candidates_skips_a_row_whose_image_file_is_missing(tmp_path):
    track1 = tmp_path / "track1"
    track1.mkdir()
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "track1-dataset": {"rows": [_row("01", 85, 1, 20)]},
    })), encoding="utf-8")

    candidates, skipped = sc.load_calibration_candidates(
        calibration_path, {"track1-dataset": track1},
    )
    assert candidates == []
    assert skipped == [{"name": "track1-dataset", "image_id": "01",
                         "reason": "image file not found"}]


# ---------------------------------------------------------------------------
# load_gate_candidates -- figment/gate@1 rows nest scores under "judge"
# ---------------------------------------------------------------------------


def _gate_document(rows: list[dict]) -> dict:
    return {"schema": "figment/gate@1", "rows": rows}


def _gate_row(image_id, same_person, age_delta, artifacts):
    return {
        "image_id": image_id,
        "pass": same_person >= 70,
        "judge": {"image_id": image_id, "same_person": same_person, "age_delta": age_delta,
                  "artifacts": artifacts},
    }


def test_load_gate_candidates_reads_nested_judge_scores(tmp_path):
    images_dir = tmp_path / "bakeoff-m1"
    _write_png(images_dir / "c001-bo-a-01-close-front-flatwhite.png")
    gate_path = tmp_path / "gate.json"
    gate_path.write_text(json.dumps(_gate_document([
        _gate_row("c001-bo-a-01-close-front-flatwhite", 82, 0, 15),
    ])), encoding="utf-8")

    candidates, skipped = sc.load_gate_candidates(gate_path, "bakeoff-m1", images_dir)

    assert skipped == []
    assert len(candidates) == 1
    row = candidates[0]
    assert row["source_set"] == "bakeoff-m1"
    assert row["same_person"] == 82
    assert row["age_delta"] == 0
    assert row["artifacts"] == 15
    assert row["path"] == str(images_dir / "c001-bo-a-01-close-front-flatwhite.png")


def test_load_gate_candidates_skips_a_row_missing_its_image(tmp_path):
    images_dir = tmp_path / "bakeoff-m1"
    images_dir.mkdir()
    gate_path = tmp_path / "gate.json"
    gate_path.write_text(json.dumps(_gate_document([
        _gate_row("c001-bo-a-99-missing", 82, 0, 15),
    ])), encoding="utf-8")

    candidates, skipped = sc.load_gate_candidates(gate_path, "bakeoff-m1", images_dir)
    assert candidates == []
    assert skipped == [{"name": "bakeoff-m1", "image_id": "c001-bo-a-99-missing",
                         "reason": "image file not found"}]


# ---------------------------------------------------------------------------
# select_cells -- thresholds, ordering, cap
# ---------------------------------------------------------------------------


def _candidate(image_id, source_set, same_person, age_delta, artifacts):
    return {"image_id": image_id, "source_set": source_set, "path": f"/x/{image_id}.png",
            "same_person": same_person, "age_delta": age_delta, "artifacts": artifacts}


def test_select_cells_applies_all_three_thresholds():
    candidates = [
        _candidate("keep", "s", 85, 1, 20),
        _candidate("low-same-person", "s", 79.9, 1, 20),
        _candidate("high-age-delta", "s", 85, 2.1, 20),
        _candidate("high-artifacts", "s", 85, 1, 40.1),
        _candidate("boundary", "s", 80, 2, 40),
    ]
    selected = sc.select_cells(candidates)
    ids = {c["image_id"] for c in selected}
    assert ids == {"keep", "boundary"}


def test_select_cells_uses_absolute_age_delta():
    candidates = [_candidate("negative", "s", 90, -1.5, 10)]
    selected = sc.select_cells(candidates)
    assert [c["image_id"] for c in selected] == ["negative"]


def test_select_cells_caps_per_set_keeping_the_best_first():
    candidates = [
        _candidate("mid", "s", 85, 1, 20),
        _candidate("best", "s", 95, 0, 5),
        _candidate("worst-that-still-passes", "s", 80, 2, 39),
    ]
    selected = sc.select_cells(candidates, cap_per_set=2)
    assert [c["image_id"] for c in selected] == ["best", "mid"]


def test_select_cells_orders_deterministically_across_sets():
    candidates = [
        _candidate("z1", "zzz", 90, 0, 10),
        _candidate("a1", "aaa", 90, 0, 10),
    ]
    selected = sc.select_cells(candidates)
    assert [c["source_set"] for c in selected] == ["aaa", "zzz"]


def test_select_cells_custom_thresholds_are_cli_overridable():
    candidates = [_candidate("only", "s", 60, 3, 50)]
    assert sc.select_cells(candidates) == []
    selected = sc.select_cells(
        candidates, same_person_min=50, age_delta_max=5, artifacts_max=60,
    )
    assert [c["image_id"] for c in selected] == ["only"]


# ---------------------------------------------------------------------------
# build_selection -- the never-passport-candidates invariant cannot be overridden
# ---------------------------------------------------------------------------


def test_build_selection_puts_anchors_first_then_selected_cells(tmp_path):
    anchors_dir = tmp_path / "anchors"
    _write_png(anchors_dir / "g01.jpg")
    track1 = tmp_path / "track1"
    _write_png(track1 / "01.png")
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "track1-dataset": {"rows": [_row("01", 90, 0, 10)]},
    })), encoding="utf-8")

    selection = sc.build_selection(
        anchors_dir=anchors_dir, calibration_path=calibration_path,
        image_dirs={"track1-dataset": track1},
    )
    assert [row["image_id"] for row in selection["anchors"]] == ["g01"]
    assert [row["image_id"] for row in selection["cells"]] == ["01"]
    assert selection["counts_by_set"] == {"anchors": 1, "track1-dataset": 1}
    assert selection["total_images"] == 2


def test_build_selection_never_includes_passport_candidates_even_if_caller_tries_to_unexclude(
        tmp_path):
    anchors_dir = tmp_path / "anchors"
    _write_png(anchors_dir / "g01.jpg")
    passport = tmp_path / "passport"
    _write_png(passport / "c001-anchor-p01.png")
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "passport-candidates": {"rows": [_row("c001-anchor-p01", 95, 0, 5)]},
    })), encoding="utf-8")

    selection = sc.build_selection(
        anchors_dir=anchors_dir, calibration_path=calibration_path,
        image_dirs={"passport-candidates": passport},
        exclude_sets=(),  # attempting to un-exclude must not work
    )
    assert selection["cells"] == []
    assert "passport-candidates" in selection["excluded_sets"]


def test_build_selection_combines_calibration_and_gate_sources_and_records_skips(tmp_path):
    anchors_dir = tmp_path / "anchors"
    _write_png(anchors_dir / "g01.jpg")
    track1 = tmp_path / "track1"
    _write_png(track1 / "01.png")
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "track1-dataset": {"rows": [_row("01", 90, 0, 10)]},
        "qwen-anchor-edits": {"rows": [_row("c001-anchor-e01", 85, 1, 20)]},
    })), encoding="utf-8")
    bakeoff = tmp_path / "bakeoff-m1"
    _write_png(bakeoff / "c001-bo-a-01.png")
    gate_path = tmp_path / "gate.json"
    gate_path.write_text(json.dumps(_gate_document([_gate_row("c001-bo-a-01", 88, 0, 5)])),
                          encoding="utf-8")

    selection = sc.build_selection(
        anchors_dir=anchors_dir, calibration_path=calibration_path,
        image_dirs={"track1-dataset": track1},
        gate_sources=[("bakeoff-m1", gate_path, bakeoff)],
    )
    ids = {row["image_id"] for row in selection["cells"]}
    assert ids == {"01", "c001-bo-a-01"}
    assert selection["skipped"] == [
        {"name": "qwen-anchor-edits", "reason": "no image directory supplied"},
    ]


# ---------------------------------------------------------------------------
# to_approved_cells -- trigger + class caption, build_training_set --mode provided shape
# ---------------------------------------------------------------------------


def test_to_approved_cells_captions_every_row_with_trigger_and_class(tmp_path):
    anchors_dir = tmp_path / "anchors"
    _write_png(anchors_dir / "g01.jpg")
    track1 = tmp_path / "track1"
    _write_png(track1 / "01.png")
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "track1-dataset": {"rows": [_row("01", 90, 0, 10)]},
    })), encoding="utf-8")
    selection = sc.build_selection(
        anchors_dir=anchors_dir, calibration_path=calibration_path,
        image_dirs={"track1-dataset": track1},
    )

    approved = sc.to_approved_cells(selection, trigger="creator001krea2", caption_word="woman")

    assert len(approved) == 2
    assert all(cell["caption"] == "creator001krea2 woman" for cell in approved)
    assert {Path(cell["image"]).name for cell in approved} == {"g01.jpg", "01.png"}


# ---------------------------------------------------------------------------
# CLI end-to-end
# ---------------------------------------------------------------------------


def test_cli_writes_selection_json_approved_cells_and_materializes_the_dataset(tmp_path):
    anchors_dir = tmp_path / "anchors"
    _write_real_png(anchors_dir / "g01.jpg")
    track1 = tmp_path / "track1"
    _write_real_png(track1 / "01.png")
    _write_real_png(track1 / "02.png")
    calibration_path = tmp_path / "judge-calibration.json"
    calibration_path.write_text(json.dumps(_calibration_document({
        "track1-dataset": {"rows": [
            _row("01", 90, 0, 10),
            _row("02", 40, 1, 10),  # fails same_person_min, must not appear
        ]},
    })), encoding="utf-8")
    out = tmp_path / "selection.json"
    approved_out = tmp_path / "approved-cells.json"
    dataset_out = tmp_path / "dataset"

    exit_code = sc.main([
        "--anchors-dir", str(anchors_dir),
        "--calibration", str(calibration_path),
        "--image-dir", f"track1-dataset={track1}",
        "--trigger", "creator001krea2",
        "--out", str(out),
        "--approved-cells-out", str(approved_out),
        "--dataset-out", str(dataset_out),
    ])

    assert exit_code == 0
    selection = json.loads(out.read_text(encoding="utf-8"))
    assert {row["image_id"] for row in selection["cells"]} == {"01"}
    approved = json.loads(approved_out.read_text(encoding="utf-8"))
    assert len(approved) == 2
    assert (dataset_out / "_dataset.ready").is_file()
    assert (dataset_out / "dataset_manifest.json").is_file()
    captions = sorted(p.read_text(encoding="utf-8").strip() for p in dataset_out.glob("*.txt"))
    assert captions == ["creator001krea2 woman", "creator001krea2 woman"]


def test_cli_rejects_a_cap_per_set_that_is_not_a_positive_integer(tmp_path):
    anchors_dir = tmp_path / "anchors"
    _write_png(anchors_dir / "g01.jpg")
    with pytest.raises(SystemExit):
        sc.main([
            "--anchors-dir", str(anchors_dir),
            "--trigger", "creator001krea2",
            "--out", str(tmp_path / "selection.json"),
            "--cap-per-set", "0",
        ])

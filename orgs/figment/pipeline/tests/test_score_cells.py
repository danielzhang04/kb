"""Contract tests for the advisory grading-board scorer (Track-2 Task B3).

`score()` must never keep or cull a cell -- see TENSOR-REPLICATION.md's "Grading
protocol". These tests exercise the module directly, not through `figment_train.py`'s
`build_grade` wiring (which wraps the whole call in try/except so a scorer outage never
blocks a gate).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def scorer():
    # Module-scoped so the lazily-constructed FaceNetEmbedder/age-classifier singletons
    # inside score_cells.py are built once for this whole test file, not once per test.
    return load_module("figment_test_score_cells", PIPELINE / "score_cells.py")


def _png(directory: Path, name: str) -> Path:
    from PIL import Image

    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    Image.new("RGB", (8, 8), color=(120, 90, 90)).save(path)
    return path


def test_advisory_scores_annotate_and_never_gate(scorer, tmp_path):
    doc = scorer.score(
        images=[{"image_id": "c002-tds-f01", "path": str(_png(tmp_path, "a.png"))}],
        anchors=[_png(tmp_path, "anchor.png")],
        out=tmp_path,
    )
    row = doc["rows"][0]
    assert set(row) == {
        "image_id", "anchor_cosine", "age_delta_years", "laplacian_variance",
        "clipped_highlight_fraction", "local_luminance_variance", "unavailable_reason",
    }
    assert "decision" not in json.dumps(row) and "cull" not in json.dumps(row)
    assert (tmp_path / "advisory.json").is_file()
    on_disk = json.loads((tmp_path / "advisory.json").read_text("utf-8"))
    assert on_disk == doc


def test_scorer_failure_is_recorded_not_raised(scorer, tmp_path):
    doc = scorer.score(
        images=[{"image_id": "x", "path": str(tmp_path / "missing.png")}],
        anchors=[],
        out=tmp_path,
    )
    assert doc["rows"][0]["anchor_cosine"] is None
    assert doc["rows"][0]["unavailable_reason"]


def test_scorer_never_raises_on_a_batch_of_unreadable_anchors_and_images(scorer, tmp_path):
    """Advisory outputs degrade to None fields rather than raising, even when neither the
    anchor set nor any cell contains a real, detectable face -- the common case for tiny
    synthetic fixture images elsewhere in this test suite."""
    garbage_anchor = tmp_path / "anchor.png"
    garbage_anchor.write_bytes(b"not a real image")
    doc = scorer.score(
        images=[{"image_id": "c002-tds-b01", "path": str(_png(tmp_path, "b.png"))}],
        anchors=[garbage_anchor],
        out=tmp_path,
    )
    row = doc["rows"][0]
    assert row["image_id"] == "c002-tds-b01"
    assert row["anchor_cosine"] is None

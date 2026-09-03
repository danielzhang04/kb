import importlib.util
import json
import random
import sys
from pathlib import Path

from PIL import Image

PIPELINE = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


board_mod = load_module("figment_pipeline_build_grading_board_under_test", PIPELINE / "build_grading_board.py")
load_manifest = board_mod.load_manifest
build = board_mod.build
ALL_SEVEN_AXES = board_mod.ALL_SEVEN_AXES


def _blind_manifest(tmp_path, count=5):
    pool_dir = tmp_path / "pool"
    pool_dir.mkdir()
    images = []
    for n in range(1, count + 1):
        image_id = f"img_{n:04d}"
        Image.new("RGB", (6, 6), (n * 20, n * 20, n * 20)).save(pool_dir / f"{image_id}.png")
        images.append({
            "image_id": image_id,
            "path": f"{image_id}.png",
            "review_status": "unreviewed",
            "parked_reasons": [],
        })
    manifest_path = pool_dir / "manifest.json"
    manifest_path.write_text(json.dumps({"images": images}), encoding="utf-8")
    return manifest_path


def test_board_renders_the_fixed_seven_axis_rubric_and_stays_blind(tmp_path):
    blind_manifest = _blind_manifest(tmp_path)
    images = load_manifest(blind_manifest)
    random.Random(20260903).shuffle(images)  # mirrors main()'s own blind-mode shuffle
    page_html, _total_bytes = build(
        images, "creator-001 expansion-02 — GATE A", "5 image(s)",
        blind=True, max_w=1600, quality=85, budget_mb=20.0,
    )
    assert all(axis in page_html for axis in ALL_SEVEN_AXES)
    assert "source_path" not in page_html and "expansion-02=" not in page_html
    assert "img_0001" in page_html


def test_all_seven_axes_constant_is_exactly_quality_plus_safety():
    assert ALL_SEVEN_AXES == board_mod.QUALITY_AXES + board_mod.SAFETY_AXES
    assert len(ALL_SEVEN_AXES) == 7


def test_rubric_legend_is_unconditional_even_when_not_blind(tmp_path):
    manifest_path = _blind_manifest(tmp_path, count=1)
    images = load_manifest(manifest_path)
    page_html, _ = build(
        images, "not blind", "1 image(s)", blind=False, max_w=1600, quality=85, budget_mb=20.0,
    )
    assert all(axis in page_html for axis in ALL_SEVEN_AXES)

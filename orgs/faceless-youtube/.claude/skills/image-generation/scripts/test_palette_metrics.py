import runpy
from pathlib import Path

import pytest
from PIL import Image

import build_review_artifact as review
import palette_metrics


def test_palette_metrics_owned_module_is_used_by_report_and_board(tmp_path):
    frame = tmp_path / "orange-cyan.png"
    image = Image.new("RGB", (160, 90), (230, 120, 25))
    image.paste((20, 190, 200), (80, 0, 160, 90))
    image.save(frame)
    measured = palette_metrics.metrics(frame)
    for key in ("warm", "cool", "orange_chroma", "cool_pair_chroma",
                "complementary_pair_chroma"):
        assert isinstance(measured[key], float)
    assert measured["complementary_pair_chroma"] == pytest.approx(
        measured["orange_chroma"] + measured["cool_pair_chroma"])
    report = Path(__file__).resolve().parents[4] / "channels" / "the-second-take" / "videos" / \
        "2026-07-28-bricks-fresh" / "scratchpad" / "taste-audit" / "vd_palette_metrics.py"
    namespace = runpy.run_path(str(report))
    assert namespace["metrics"] is palette_metrics.metrics
    assert review.palette_metrics is palette_metrics.metrics

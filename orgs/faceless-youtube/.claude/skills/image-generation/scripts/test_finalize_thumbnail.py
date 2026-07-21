#!/usr/bin/env python3
"""Tests for finalize_thumbnail — network-free, tmp-dir fixtures, PIL-made candidates.

Strategy: build candidate PNGs of various sizes/ratios in a tmp dir, run the CLI (and the
pure `compute_crop_box` helper directly), and assert the publishable `assets/thumbnail.png`
lands at exactly 1280x720 with the correct center-crop, or that a too-narrow source is
refused with exit 1.

Run:  py -3 -m pytest test_finalize_thumbnail.py -q
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import finalize_thumbnail as ft  # noqa: E402

SCRIPT = str(Path(__file__).resolve().parent / "finalize_thumbnail.py")


def _solid(w, h, color=(80, 120, 160)):
    return Image.new("RGB", (w, h), color)


def _banded(w, h, band):
    """A candidate with a distinct-colour top/bottom band and a solid-blue center band,
    so a center-crop can be verified by pixel colour rather than just output size."""
    im = Image.new("RGB", (w, h), (0, 0, 255))  # blue center
    px = im.load()
    for y in range(band):
        for x in range(w):
            px[x, y] = (255, 0, 0)  # red top band
    for y in range(h - band, h):
        for x in range(w):
            px[x, y] = (0, 255, 0)  # green bottom band
    return im


# ---------------------------------------------------------------------------
# compute_crop_box — pure helper
# ---------------------------------------------------------------------------
def test_compute_crop_box_exact_16x9_is_uncropped():
    assert ft.compute_crop_box(1920, 1080) == (0, 0, 1920, 1080)


def test_compute_crop_box_4x3_crops_height_centered():
    box = ft.compute_crop_box(1600, 1200)
    x0, y0, x1, y1 = box
    assert (x0, x1) == (0, 1600)  # full width kept
    assert (x1 - x0) == 1600
    assert (y1 - y0) == 900  # 1600 * 9/16
    assert y0 == pytest.approx(150, abs=1)  # centered: (1200-900)/2


# ---------------------------------------------------------------------------
# CLI / integration
# ---------------------------------------------------------------------------
def test_1920x1080_downscales_to_1280x720(tmp_path):
    candidate = tmp_path / "candidate.png"
    _solid(1920, 1080).save(candidate)
    video_dir = tmp_path / "video"

    out_path = ft.finalize_thumbnail(str(candidate), str(video_dir))

    assert out_path == str(video_dir / "assets" / "thumbnail.png")
    with Image.open(out_path) as out:
        assert out.size == (1280, 720)


def test_1600x1200_center_crops_to_16x9_then_resizes(tmp_path):
    # top 150px red, bottom 150px green, middle (150..1050) solid blue.
    # correct center crop for 16:9 out of 1600x1200 keeps rows [150, 1050) -> all blue.
    candidate = tmp_path / "candidate.png"
    _banded(1600, 1200, band=150).save(candidate)
    video_dir = tmp_path / "video"

    out_path = ft.finalize_thumbnail(str(candidate), str(video_dir))

    with Image.open(out_path) as out:
        assert out.size == (1280, 720)
        # every sampled row (including near the very top/bottom of the output) is blue —
        # the red/green bands were excluded by the crop, not merely down-weighted by resize.
        for y in (0, 5, 360, 714, 719):
            for x in (0, 640, 1279):
                assert out.getpixel((x, y)) == (0, 0, 255), (x, y, out.getpixel((x, y)))


def test_narrow_source_refuses_upscale_via_cli(tmp_path):
    candidate = tmp_path / "candidate.png"
    _solid(320, 180).save(candidate)
    video_dir = tmp_path / "video"

    result = subprocess.run(
        [sys.executable, SCRIPT, str(candidate), str(video_dir)],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1
    assert "refusing to upscale" in result.stderr.lower()
    assert not (video_dir / "assets" / "thumbnail.png").exists()


def test_narrow_source_raises_via_function(tmp_path):
    candidate = tmp_path / "candidate.png"
    _solid(320, 180).save(candidate)
    video_dir = tmp_path / "video"

    with pytest.raises(ValueError, match="refusing to upscale"):
        ft.finalize_thumbnail(str(candidate), str(video_dir))


def test_rerun_is_byte_stable(tmp_path):
    candidate = tmp_path / "candidate.png"
    _banded(1600, 1200, band=150).save(candidate)
    video_dir = tmp_path / "video"

    out_path = ft.finalize_thumbnail(str(candidate), str(video_dir))
    first_bytes = Path(out_path).read_bytes()

    out_path_2 = ft.finalize_thumbnail(str(candidate), str(video_dir))
    second_bytes = Path(out_path_2).read_bytes()

    assert out_path == out_path_2  # idempotent overwrite, same location
    assert first_bytes == second_bytes


def main():
    raise SystemExit(pytest.main([__file__, "-q"]))


if __name__ == "__main__":
    main()

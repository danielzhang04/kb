#!/usr/bin/env python3
"""Tests for build_board — network-free, tmp-dir fixtures, tiny PIL-made PNGs.

Strategy: build one small video folder (2 shots + 1 library ref) where shot S1 is
`verified` with a real PNG and shot S2 is `parked` with NO PNG, then assert the board:
exists, is a single self-contained file (no external http refs), carries both shots in
shots.json story order, shows the parked badge + its reasons, shows the cast section +
ref, and renders a visible MISSING placeholder for the pngless shot. Plus unit tests on
`review_badge` (the tri-state that mirrors render.py::_entry_review_reason).

Run:  py -3 -m pytest test_build_board.py -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_board as bb  # noqa: E402


# ---------------------------------------------------------------------------
# fixture builders
# ---------------------------------------------------------------------------
def _write(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_text(json.dumps(data), encoding="utf-8")


def _png(path: Path, size=(64, 40), color=(180, 90, 40)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path, "PNG")


@pytest.fixture
def video_dir(tmp_path: Path) -> Path:
    vd = tmp_path / "2026-07-04-poyais"
    # S1 → verified (legacy booleans) with a real PNG; S2 → parked, no PNG.
    _write(vd / "shots.json", {
        "video_slug": "2026-07-04-poyais",
        "long_form": {"shots": [
            {"id": "S1", "beat": "hook", "duration_s": 4,
             "vo_ref": "In 1822", "vo_text": "In 1822 a few hundred people sold everything",
             "on_screen_text": "1822", "shot_class": "establishing", "source": "ai-gen"},
            {"id": "S2", "beat": "turn", "duration_s": 5,
             "vo_ref": "the map", "vo_text": "and sailed toward a country that did not exist",
             "on_screen_text": "", "shot_class": "reveal", "source": "ai-gen"},
        ]},
    })
    _write(vd / "shots.motion.json", {"shots": [
        {"id": "S1", "background": {"mode": "plate", "plate": "scenes/S1.png"}, "layers": []},
        {"id": "S2", "background": {"mode": "delta-chain", "plate": "plates/S2.png"},
         "layers": [{"id": "ship", "source": "cutout", "animation": {"type": "path"}}]},
    ]})
    _write(vd / "assets/scenes/manifest.json", {"shots": [
        {"shot_id": "S1", "file": "assets/scenes/S1.png",
         "verified": {"scene": True, "rig": True}, "flagged": False},
        {"shot_id": "S2", "review_status": "parked",
         "parked_reasons": ["face drift on the prince", "extra fingers"], "flagged": True},
    ]})
    _write(vd / "assets/library/manifest.json", {"assets": [
        {"name": "macgregor", "file": "assets/library/macgregor.png",
         "kind": "character", "notes": "the confidence man at the centre"},
    ]})
    _png(vd / "assets/scenes/S1.png")
    _png(vd / "assets/library/macgregor.png")
    # NB: no assets/scenes/S2.png on purpose → MISSING placeholder path.
    return vd


def _build(video_dir: Path) -> str:
    out = video_dir / "assets" / "board.html"
    bb.main([str(video_dir)])
    assert out.exists(), "default output board.html was not written"
    return out.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# board-level tests
# ---------------------------------------------------------------------------
def test_output_exists_default_path(video_dir):
    html = _build(video_dir)
    assert html.strip(), "board is empty"


def test_title_is_slug(video_dir):
    html = _build(video_dir)
    assert "2026-07-04-poyais" in html


def test_single_file_no_external_refs(video_dir):
    html = _build(video_dir)
    assert 'src="http' not in html
    assert "src='http" not in html
    assert 'href="http' not in html
    assert "href='http" not in html


def test_both_shots_present_in_story_order(video_dir):
    html = _build(video_dir)
    assert 'data-shot-id="S1"' in html
    assert 'data-shot-id="S2"' in html
    assert html.index('data-shot-id="S1"') < html.index('data-shot-id="S2"'), \
        "shots not rendered in shots.json story order"


def test_verified_badge_for_s1(video_dir):
    html = _build(video_dir)
    seg = html[html.index('data-shot-id="S1"'):html.index('data-shot-id="S2"')]
    assert "verified" in seg.lower()


def test_parked_badge_and_reasons(video_dir):
    html = _build(video_dir)
    seg = html[html.index('data-shot-id="S2"'):]
    assert "parked" in seg.lower()
    assert "face drift on the prince" in seg
    assert "extra fingers" in seg


def test_missing_png_renders_placeholder(video_dir):
    html = _build(video_dir)
    seg = html[html.index('data-shot-id="S2"'):]
    assert "MISSING" in seg


def test_scene_image_embedded_as_data_uri(video_dir):
    html = _build(video_dir)
    assert "data:image/jpeg;base64," in html  # downscaled JPEG shot still


def test_cast_section_and_ref(video_dir):
    html = _build(video_dir)
    assert 'id="cast-props"' in html
    assert "macgregor" in html
    assert "the confidence man at the centre" in html


def test_custom_output_path(video_dir, tmp_path):
    out = tmp_path / "custom.html"
    bb.main([str(video_dir), "-o", str(out)])
    assert out.exists()
    assert 'data-shot-id="S1"' in out.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# review_badge unit tests — mirror render.py::_entry_review_reason
# ---------------------------------------------------------------------------
def test_badge_review_status_verified():
    status, reasons = bb.review_badge({"review_status": "verified"})
    assert status == "verified" and reasons == []


def test_badge_review_status_parked_with_reasons():
    status, reasons = bb.review_badge(
        {"review_status": "parked", "parked_reasons": ["a", "b"]})
    assert status == "parked" and reasons == ["a", "b"]


def test_badge_review_status_parked_no_reasons():
    status, reasons = bb.review_badge({"review_status": "parked"})
    assert status == "parked" and reasons == ["no reasons recorded"]


def test_badge_review_status_unreviewed():
    status, reasons = bb.review_badge({"review_status": "unreviewed"})
    assert status == "unreviewed"


def test_badge_legacy_booleans_verified():
    status, reasons = bb.review_badge({"verified": {"scene": True, "rig": True}})
    assert status == "verified"


def test_badge_legacy_booleans_gate():
    status, _ = bb.review_badge({"verified": {"scene": True, "rig": False}})
    assert status == "unreviewed"


def test_badge_no_entry_is_unreviewed():
    status, _ = bb.review_badge(None)
    assert status == "unreviewed"

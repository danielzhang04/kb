#!/usr/bin/env python3
"""Tests for compliance_check — network-free, tmp-dir fixtures, tiny PIL-made thumbnail.

Strategy: build one fully-passing video folder, assert PASS + exit 0, then flip exactly
one thing per test and assert that check (and only the gate) goes FAIL / exit 1. A final
test proves a provenance over-reliance pattern WARNs but keeps the exit code 0.

Run:  py -3 -m pytest test_compliance_check.py -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import compliance_check as cc  # noqa: E402


# ---------------------------------------------------------------------------
# fixture builders — a video folder where EVERY mechanical check passes.
# ---------------------------------------------------------------------------
def _write(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_text(json.dumps(data), encoding="utf-8")


def _good_render_manifest():
    return {
        "generated_by": "render-builder",
        "pieces": [
            {
                "piece": "long-form",
                "state": "rendered",
                "rendered_seconds": 600.0,
                "vo_seconds": 600.0,
                "audio": {
                    "ok": True,
                    "measured": {
                        "lufs": "-14.65",
                        "splice_continuity": {"gaps": 50, "fail": 0, "warn": 0},
                    },
                },
            }
        ],
    }


def _good_metadata():
    return {
        "defaults": {"privacy_status": "private", "contains_synthetic_media": True},
        "long_form": {
            "title_primary": "A Perfectly Legal Title Under One Hundred Characters",
            "description": "A clean description.\n\nSources:\nCFPB press release 2016.",
            "tags": ["one", "two", "three"],
            "category_id": "27",
            "chapters": [
                {"time": "00:00", "label": "Intro"},
                {"time": "01:10", "label": "Middle"},
                {"time": "05:24", "label": "End"},
            ],
        },
    }


def _good_scenes_manifest():
    # mix of the new review_status form and the legacy verified.scene/rig form, all shippable.
    return {
        "shots": [
            {"shot_id": "L01", "review_status": "verified"},
            {"shot_id": "L02", "verified": {"scene": True, "rig": True}},
        ]
    }


def _good_library_manifest():
    return {"assets": [{"name": "kovacevich", "kind": "character", "source": "generated"}]}


def _good_audio_plan():
    return {"cues": [{"kind": "music", "mood": "underscore"}]}


SCRIPT = "The bank did a thing [F-01]. Then another thing [F-02]. And a third [F-03].\n"
RESEARCH = (
    "## Fact ledger\n"
    "- **[F-01]** first fact. — *Src:* [S1]\n"
    "- **[F-02]** second fact. — *Src:* [S2]\n"
    "- **[F-03]** third fact. — *Src:* [S3]\n"
)


@pytest.fixture
def video_dir(tmp_path):
    v = tmp_path / "2026-07-19-fixture"
    _write(v / "assets" / "render.manifest.json", _good_render_manifest())
    _write(v / "metadata.json", _good_metadata())
    _write(v / "assets" / "scenes" / "manifest.json", _good_scenes_manifest())
    _write(v / "assets" / "library" / "manifest.json", _good_library_manifest())
    _write(v / "audio-plan.json", _good_audio_plan())
    _write(v / "script.md", SCRIPT)
    _write(v / "research.md", RESEARCH)
    (v / "assets").mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (1280, 720), "black").save(v / "assets" / "thumbnail.png")
    return v


def _load_meta(v):
    return json.loads((v / "metadata.json").read_text(encoding="utf-8"))


def _save_meta(v, meta):
    (v / "metadata.json").write_text(json.dumps(meta), encoding="utf-8")


# ---------------------------------------------------------------------------
# the all-green baseline
# ---------------------------------------------------------------------------
def test_all_pass_exit_zero(video_dir):
    text, code = cc.build_report(video_dir)
    assert code == 0
    assert "**Verdict: PASS**" in text
    assert "FAIL —" not in text
    assert "## Mechanical checks" in text
    assert "## Provenance (warn-level)" in text


def test_main_writes_report_file(video_dir):
    code = cc.main([str(video_dir)])
    assert code == 0
    assert (video_dir / "compliance-report.md").exists()


# ---------------------------------------------------------------------------
# one flip per mechanical check -> FAIL + exit 1
# ---------------------------------------------------------------------------
def test_render_manifest_not_rendered_fails(video_dir):
    m = json.loads((video_dir / "assets" / "render.manifest.json").read_text())
    m["pieces"][0]["state"] = "rendering"
    (video_dir / "assets" / "render.manifest.json").write_text(json.dumps(m))
    ok, _ = cc.check_render_manifest(video_dir)
    assert ok is False
    assert cc.build_report(video_dir)[1] == 1


def test_render_manifest_splice_fail_fails(video_dir):
    m = json.loads((video_dir / "assets" / "render.manifest.json").read_text())
    m["pieces"][0]["audio"]["measured"]["splice_continuity"]["fail"] = 2
    (video_dir / "assets" / "render.manifest.json").write_text(json.dumps(m))
    ok, detail = cc.check_render_manifest(video_dir)
    assert ok is False and "splice" in detail


def test_metadata_title_too_long_fails(video_dir):
    meta = _load_meta(video_dir)
    meta["long_form"]["title_primary"] = "X" * 101
    _save_meta(video_dir, meta)
    ok, detail = cc.check_metadata(video_dir)
    assert ok is False and "title" in detail
    assert cc.build_report(video_dir)[1] == 1


def test_metadata_chapters_non_monotonic_fails(video_dir):
    meta = _load_meta(video_dir)
    meta["long_form"]["chapters"] = [
        {"time": "01:00", "label": "a"},
        {"time": "00:30", "label": "b"},
    ]
    _save_meta(video_dir, meta)
    ok, detail = cc.check_metadata(video_dir)
    assert ok is False and "monotonic" in detail


def test_metadata_chapter_past_duration_fails(video_dir):
    meta = _load_meta(video_dir)
    meta["long_form"]["chapters"] = [{"time": "00:00", "label": "a"}, {"time": "20:00", "label": "b"}]
    _save_meta(video_dir, meta)
    ok, detail = cc.check_metadata(video_dir, duration_s=600.0)
    assert ok is False and "duration" in detail


def test_privacy_not_private_fails(video_dir):
    meta = _load_meta(video_dir)
    meta["defaults"]["privacy_status"] = "public"
    _save_meta(video_dir, meta)
    ok, detail = cc.check_privacy(video_dir)
    assert ok is False and "private" in detail
    assert cc.build_report(video_dir)[1] == 1


def test_synthetic_media_flag_missing_fails(video_dir):
    meta = _load_meta(video_dir)
    meta["defaults"]["contains_synthetic_media"] = False
    _save_meta(video_dir, meta)
    ok, detail = cc.check_privacy(video_dir)
    assert ok is False and "synthetic" in detail


def test_licensing_uncredited_asset_fails(video_dir):
    # add a licensed asset whose credit string is NOT in the description -> FAIL
    lib = json.loads((video_dir / "assets" / "library" / "manifest.json").read_text())
    lib["assets"].append({"name": "stock-clip-7", "license": "CC-BY 4.0 by Jane Roe"})
    (video_dir / "assets" / "library" / "manifest.json").write_text(json.dumps(lib))
    ok, detail = cc.check_licensing(video_dir)
    assert ok is False and "stock-clip-7" in detail
    assert cc.build_report(video_dir)[1] == 1


def test_licensing_credited_asset_passes(video_dir):
    lib = json.loads((video_dir / "assets" / "library" / "manifest.json").read_text())
    lib["assets"].append({"name": "stock-clip-7", "license": "CC-BY 4.0 by Jane Roe"})
    (video_dir / "assets" / "library" / "manifest.json").write_text(json.dumps(lib))
    meta = _load_meta(video_dir)
    meta["long_form"]["description"] += "\nMusic: CC-BY 4.0 by Jane Roe"
    _save_meta(video_dir, meta)
    ok, _ = cc.check_licensing(video_dir)
    assert ok is True


def test_licensing_credit_block_all_matched_passes(video_dir):
    # a Credits block whose every entry matches a licensed asset -> PASS, no orphans.
    lib = json.loads((video_dir / "assets" / "library" / "manifest.json").read_text())
    lib["assets"].append({"name": "stock-clip-7", "license": "CC-BY 4.0 by Jane Roe"})
    (video_dir / "assets" / "library" / "manifest.json").write_text(json.dumps(lib))
    meta = _load_meta(video_dir)
    meta["long_form"]["description"] += "\n\nCredits:\nCC-BY 4.0 by Jane Roe\n"
    _save_meta(video_dir, meta)
    ok, detail = cc.check_licensing(video_dir)
    assert ok is True


def test_licensing_orphan_credit_fails(video_dir):
    # a Credits block entry with no backing licensed asset -> FAIL naming the orphan line.
    lib = json.loads((video_dir / "assets" / "library" / "manifest.json").read_text())
    lib["assets"].append({"name": "stock-clip-7", "license": "CC-BY 4.0 by Jane Roe"})
    (video_dir / "assets" / "library" / "manifest.json").write_text(json.dumps(lib))
    meta = _load_meta(video_dir)
    meta["long_form"]["description"] += (
        "\n\nCredits:\nCC-BY 4.0 by Jane Roe\nPhoto by Someone Else\n"
    )
    _save_meta(video_dir, meta)
    ok, detail = cc.check_licensing(video_dir)
    assert ok is False
    assert "Photo by Someone Else" in detail
    assert cc.build_report(video_dir)[1] == 1


def test_licensing_no_credit_block_no_licensed_assets_passes(video_dir):
    # existing behavior intact: nothing licensed, no Credits block -> vacuously PASS.
    ok, detail = cc.check_licensing(video_dir)
    assert ok is True
    assert "no licensed assets" in detail


def test_thumbnail_wrong_size_fails(video_dir):
    Image.new("RGB", (1920, 1080), "black").save(video_dir / "assets" / "thumbnail.png")
    ok, detail = cc.check_thumbnail(video_dir)
    assert ok is False and "1280x720" in detail
    assert cc.build_report(video_dir)[1] == 1


def test_thumbnail_missing_fails(video_dir):
    (video_dir / "assets" / "thumbnail.png").unlink()
    ok, detail = cc.check_thumbnail(video_dir)
    assert ok is False and "missing" in detail


def test_scene_review_parked_fails(video_dir):
    m = _good_scenes_manifest()
    m["shots"].append({"shot_id": "L03", "review_status": "parked",
                       "parked_reasons": ["rig LOW"]})
    (video_dir / "assets" / "scenes" / "manifest.json").write_text(json.dumps(m))
    ok, detail = cc.check_scene_review(video_dir)
    assert ok is False and "L03" in detail and "parked" in detail
    assert cc.build_report(video_dir)[1] == 1


def test_scene_review_legacy_unverified_fails(video_dir):
    m = {"shots": [{"shot_id": "L09", "verified": {"scene": False, "rig": True}}]}
    (video_dir / "assets" / "scenes" / "manifest.json").write_text(json.dumps(m))
    ok, detail = cc.check_scene_review(video_dir)
    assert ok is False and "L09" in detail


# ---------------------------------------------------------------------------
# provenance is warn-level only — never flips the exit code
# ---------------------------------------------------------------------------
def test_provenance_overreliance_warns_but_exit_stays_zero(video_dir):
    # 6 consecutive [F-07] cites inside a short window -> single-source over-reliance WARN.
    spam = " ".join(f"word{i} [F-07]" for i in range(6))
    ledger = "- **[F-07]** the one fact everything leans on. — *Src:* [S1]\n"
    _write(video_dir / "script.md", spam + "\n")
    _write(video_dir / "research.md", ledger)
    warns = cc.provenance_warnings(video_dir)
    assert any("F-07" in w and "over-reliance" in w for w in warns)
    text, code = cc.build_report(video_dir)
    assert code == 0  # provenance NEVER affects the exit code
    assert "WARN — F-07" in text


def test_provenance_orphan_citation_warns(video_dir):
    _write(video_dir / "script.md", "A claim [F-99] with no ledger entry.\n")
    warns = cc.provenance_warnings(video_dir)
    assert any("F-99" in w for w in warns)
    assert cc.build_report(video_dir)[1] == 0

#!/usr/bin/env python3
"""Tests for publish-queue — network-free, tmp-dir fixtures, stdlib only (unittest).

Two engines under test:
  * publish_preflight.py  — the idempotency + readiness gate (exit 0 go / 1 not-ready / 2 published).
  * write_publish_record.py — writes the exact publish-record.json schema, streamed sha256, no overwrite.

Strategy: build one publish-ready video folder where preflight returns GO, then flip exactly one
condition per test. For the writer, prove the exact schema (incl. a correct sha256 of a fixture mp4 of
arbitrary bytes), that uploaded_at is the caller-supplied timestamp (never ambient), and that a second
write refuses (exit 2) rather than overwrite.

Run:  py -3 -m unittest test_publish_queue -v      (from this scripts/ dir)
"""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish_preflight as pf  # noqa: E402
import write_publish_record as wr  # noqa: E402


GOOD_REPORT = """# Compliance report — the-slug

**Verdict: PASS** (6/6 mechanical checks passed)

This is a Gate-3 report for a human reviewer.

## Mechanical checks

PASS — render manifest: every piece rendered, audio ok, LUFS -14.6.
PASS — metadata limits + chapters: within limits.
PASS — privacy + AI disclosure: private + contains_synthetic_media.
PASS — licensing / credits: no orphans.
PASS — thumbnail 1280x720: ok.
PASS — scene-review invariant: all shippable.

## Provenance (warn-level)

No provenance warnings.
"""

METADATA = {
    "schema": "faceless-youtube/metadata@1",
    "channel": "the-second-take",
    "defaults": {"privacy_status": "private", "contains_synthetic_media": True},
    "long_form": {
        "title_primary": "A Title Under One Hundred Characters",
        "description": "A clean description.\n\nSources:\nCFPB 2016.",
        "tags": ["one", "two", "three"],
    },
}

FIXTURE_MP4_BYTES = b"\x00\x00\x00\x18ftypmp42not-a-real-video-just-some-bytes\xff\xfe"


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, (bytes, bytearray)):
        path.write_bytes(data)
    elif isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_text(json.dumps(data), encoding="utf-8")


def _ready_video(tmp: Path) -> Path:
    """A publish-ready folder: PASS report, final.mp4, metadata, no record."""
    vdir = tmp / "videos" / "2026-slug"
    _write(vdir / "compliance-report.md", GOOD_REPORT)
    _write(vdir / "assets" / "final.mp4", FIXTURE_MP4_BYTES)
    _write(vdir / "metadata.json", METADATA)
    return vdir


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_go_on_ready_folder(self):
        vdir = _ready_video(self.tmp)
        code, msg = pf.preflight(vdir)
        self.assertEqual(code, 0, msg)

    def test_not_ready_when_compliance_has_fail_line(self):
        vdir = _ready_video(self.tmp)
        bad = GOOD_REPORT.replace(
            "PASS — thumbnail 1280x720: ok.",
            "FAIL — thumbnail 1280x720: got 1920x1080.",
        )
        _write(vdir / "compliance-report.md", bad)
        code, msg = pf.preflight(vdir)
        self.assertEqual(code, 1)
        self.assertIn("compliance", msg.lower())

    def test_not_ready_when_report_missing(self):
        vdir = _ready_video(self.tmp)
        (vdir / "compliance-report.md").unlink()
        code, msg = pf.preflight(vdir)
        self.assertEqual(code, 1)
        self.assertIn("compliance-report.md", msg)

    def test_not_ready_when_final_mp4_missing(self):
        vdir = _ready_video(self.tmp)
        (vdir / "assets" / "final.mp4").unlink()
        code, msg = pf.preflight(vdir)
        self.assertEqual(code, 1)
        self.assertIn("final.mp4", msg)

    def test_already_published_exit_2(self):
        vdir = _ready_video(self.tmp)
        _write(vdir / "publish-record.json", {"video_id": "VID12345"})
        code, msg = pf.preflight(vdir)
        self.assertEqual(code, 2)
        self.assertIn("already published: VID12345", msg)

    def test_fail_only_in_provenance_section_does_not_block(self):
        # A FAIL — line OUTSIDE the mechanical section must not trip the gate.
        vdir = _ready_video(self.tmp)
        report = GOOD_REPORT.replace(
            "No provenance warnings.",
            "FAIL — this line is in provenance and must be ignored by the gate.",
        )
        _write(vdir / "compliance-report.md", report)
        code, msg = pf.preflight(vdir)
        self.assertEqual(code, 0, msg)

    def test_main_returns_exit_codes(self):
        vdir = _ready_video(self.tmp)
        self.assertEqual(pf.main([str(vdir)]), 0)
        _write(vdir / "publish-record.json", {"video_id": "ABC"})
        self.assertEqual(pf.main([str(vdir)]), 2)


class WriteRecordTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.vdir = _ready_video(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def test_writes_exact_schema(self):
        ts = "2026-07-20T18:30:00Z"
        code = wr.main([str(self.vdir), "--video-id", "dQw4w9WgXcQ", "--timestamp", ts])
        self.assertEqual(code, 0)
        rec = json.loads((self.vdir / "publish-record.json").read_text(encoding="utf-8"))
        self.assertEqual(
            set(rec.keys()),
            {"video_id", "url", "uploaded_at", "privacy_status", "file_sha256", "metadata_snapshot"},
        )
        self.assertEqual(rec["video_id"], "dQw4w9WgXcQ")
        self.assertEqual(rec["url"], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertEqual(rec["uploaded_at"], ts)  # caller-supplied, never ambient
        self.assertEqual(rec["privacy_status"], "private")
        self.assertEqual(rec["metadata_snapshot"], METADATA)  # full parsed metadata embedded

    def test_sha256_matches_fixture(self):
        expected = hashlib.sha256(FIXTURE_MP4_BYTES).hexdigest()
        wr.main([str(self.vdir), "--video-id", "vid", "--timestamp", "2026-07-20T00:00:00Z"])
        rec = json.loads((self.vdir / "publish-record.json").read_text(encoding="utf-8"))
        self.assertEqual(rec["file_sha256"], expected)

    def test_refuses_overwrite_exit_2(self):
        wr.main([str(self.vdir), "--video-id", "first", "--timestamp", "2026-07-20T00:00:00Z"])
        before = (self.vdir / "publish-record.json").read_text(encoding="utf-8")
        code = wr.main([str(self.vdir), "--video-id", "second", "--timestamp", "2026-07-20T01:00:00Z"])
        self.assertEqual(code, 2)
        after = (self.vdir / "publish-record.json").read_text(encoding="utf-8")
        self.assertEqual(before, after)  # untouched
        self.assertIn("first", after)

    def test_timestamp_is_required(self):
        with self.assertRaises(SystemExit):
            wr.main([str(self.vdir), "--video-id", "vid"])


if __name__ == "__main__":
    unittest.main()

"""Integration coverage for authored-versus-resolved semantic audio QA."""

import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_motion import build_piece_spec


WORD_TIMINGS = [
    ["The", 0.00], ["ship", 0.40], ["sailed.", 0.90],
    ["Then", 1.20], ["it", 1.40], ["returned.", 1.90],
]


def _args():
    return argparse.Namespace(
        max_shots=0, no_captions=False, no_audio=False, dry_run=True,
        allow_missing=True, motion_plan=None, chapter=0,
    )


def test_piece_spec_attaches_authored_vs_resolved_audio_qa():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        (base / "visual-kit").mkdir(parents=True)
        (base / "visual-kit" / "audio-tokens.json").write_text("{}", encoding="utf-8")
        video_dir = base / "videos" / "fixture"
        (video_dir / "assets" / "scenes").mkdir(parents=True)
        (video_dir / "audio-plan.json").write_text(json.dumps({"cues": [
            {"kind": "sfx", "anchor": "The ship", "role": "cash"},
            {"kind": "pause", "anchor": "Then it", "pause_s": 0.2},
            {"kind": "music", "from_anchor": "words that are absent", "mood": "sneaky"},
        ]}), encoding="utf-8")

        manifest = {"pieces": [{"piece": "long-form", "audio": "long-form.mp3",
                                 "est_duration_s": 2.5, "word_timings": WORD_TIMINGS}]}
        shots = [{"id": "L01", "vo_ref": "The ship", "duration_s": 1.2},
                 {"id": "L02", "vo_ref": "Then it", "duration_s": 1.3}]
        spec, meta, _ = build_piece_spec(
            "long-form", shots, {"width": 1920, "height": 1080}, False,
            video_dir, manifest, _args(), allow_missing=True)

        qa = spec["audioSpec"]["qa"]
        assert qa["source"] == "unified", qa
        assert qa["authored_by_kind"] == {"sfx": 1, "pause": 1, "music": 1, "dry": 0}, qa
        assert qa["resolved_by_kind"] == {"sfx": 1, "pause": 1, "music": 0, "dry": 0}, qa
        assert qa["unresolved_by_kind"]["music"] == 1, qa
        assert qa["silent_drops"]["sfx_missing"] == 1, qa
        assert meta["audio"]["cues_unresolved"] == 1 and meta["audio"]["qa"] == qa, meta

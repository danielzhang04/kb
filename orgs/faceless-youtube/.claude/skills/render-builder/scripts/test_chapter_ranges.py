#!/usr/bin/env python3
"""Unit tests for build_motion.chapter_ranges (the --chapter boundary resolver; plain-assert)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_motion import chapter_ranges, _parse_ts


def _shots(starts, dur=2.0):
    return [{"id": f"L{i:02d}", "start_s": s, "duration_s": dur} for i, s in enumerate(starts)]


def test_parse_ts():
    assert _parse_ts("0:39") == 39.0
    assert _parse_ts("2:11") == 131.0
    assert _parse_ts("1:02:11") == 3731.0


def test_nearest_and_contiguous():
    # shots at 0,2,4,6,8,10; chapters near 0s / 5s / 9s -> shots 0 / 2(=4s nearest) / 4(=8s)
    shots = _shots([0, 2, 4, 6, 8, 10])
    chs = chapter_ranges([(0.0, "a"), (5.0, "b"), (9.0, "c")], shots)
    assert [c["start_idx"] for c in chs] == [0, 2, 4]
    # ranges are contiguous + cover every shot, no gaps/overlaps
    assert [c["end_idx"] for c in chs] == [2, 4, 6]
    assert chs[0]["n"] == 1 and chs[-1]["end_idx"] == len(shots)


def test_slice_drops_chapters_past_content():
    # only 3 shots (a ~short slice) but 5 chapters from the full-video metadata
    shots = _shots([0, 2, 4])
    chs = chapter_ranges([(0.0, "a"), (3.0, "b"), (60.0, "c"), (90.0, "d"), (120.0, "e")], shots)
    # chapters c/d/e resolve past the last shot -> dropped; a/b kept, still covering all shots
    assert len(chs) == 2
    assert chs[-1]["end_idx"] == 3


def test_collision_forces_monotonic():
    # two chapter times both nearest shot 0 -> second bumped to shot 1 (no empty range)
    shots = _shots([0, 10, 20])
    chs = chapter_ranges([(0.0, "a"), (1.0, "b")], shots)
    assert [c["start_idx"] for c in chs] == [0, 1]


def test_empty_inputs():
    assert chapter_ranges([], _shots([0, 2])) == []
    assert chapter_ranges([(0.0, "a")], []) == []


if __name__ == "__main__":
    print("running")
    test_parse_ts()
    test_nearest_and_contiguous()
    test_slice_drops_chapters_past_content()
    test_collision_forces_monotonic()
    test_empty_inputs()
    print("PASS")

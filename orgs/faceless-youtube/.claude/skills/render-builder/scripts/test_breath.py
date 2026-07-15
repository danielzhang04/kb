#!/usr/bin/env python3
"""Plain-assert tests for breath.py. Deliberate pauses are authored `pause` cues; their gaps shift the
timeline via shift_timings (the mechanism kept after automatic structural breaths were retired 2026-07-12)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from breath import shift_timings

WT = [["The", 0.0], ["deal", 0.3], ["was", 0.6], ["Eight", 1.0], ["million", 1.4], ["acres", 1.8]]


def test_shift_pushes_words_after_an_explicit_gap():
    g = [{"at_s": 1.0, "dur_s": 0.9}]   # a cue-pause gap at the reveal word
    s = shift_timings(WT, g)
    assert s[2] == ["was", 0.6], s[2]      # before the gap — unmoved
    assert s[3] == ["Eight", 1.9], s[3]    # 1.0 + 0.9
    assert s[5] == ["acres", 2.7], s[5]


def test_shift_noop_on_empty_gaps():
    assert shift_timings(WT, []) == WT


def test_multiple_gaps_are_cumulative():
    g = [{"at_s": 1.0, "dur_s": 0.9}, {"at_s": 1.4, "dur_s": 1.2}]
    s = shift_timings(WT, g)
    assert s[3][1] == 1.9, s[3]                        # Eight: after the 0.9 gap only
    assert s[4][1] == round(1.4 + 0.9 + 1.2, 3), s[4]  # million: after both gaps


if __name__ == "__main__":
    print("running")
    test_shift_pushes_words_after_an_explicit_gap()
    test_shift_noop_on_empty_gaps()
    test_multiple_gaps_are_cumulative()
    print("PASS")

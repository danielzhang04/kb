import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from measures import (parse_ebur128, speech_regions, speech_gaps,
                      onset_density, breath_around_events, bucket_by_acoustics,
                      music_presence, music_dips, ducking_depth)

# A real ffmpeg `-af ebur128` Summary block (captured format).
EBUR = """[Parsed_ebur128_0 @ 000] Summary:

  Integrated loudness:
    I:         -18.3 LUFS
    Threshold: -28.6 LUFS

  Loudness range:
    LRA:         4.2 LU
    Threshold: -38.5 LUFS

  True peak:
    Peak:       -1.1 dBFS
"""


def test_parse_ebur128():
    r = parse_ebur128(EBUR)
    assert r["lufs"] == -18.3, r
    assert r["lra"] == 4.2, r
    assert r["true_peak"] == -1.1, r


def test_speech_regions_and_gaps():
    # 0.1s hops: loud,loud,quiet,quiet,quiet,loud -> two spans, one ~0.3s gap
    rms = [-5, -5, -60, -60, -60, -5]
    regs = speech_regions(rms, hop_s=0.1, thresh_db=-35, min_gap_s=0.05)
    assert regs == [[0.0, 0.2], [0.5, 0.6]], regs
    gaps = speech_gaps(regs)
    assert abs(gaps[0] - 0.3) < 1e-6, gaps


def test_short_gap_is_bridged():
    # a single quiet hop between speech is bridged when below min_gap_s
    rms = [-5, -60, -5, -5]
    regs = speech_regions(rms, hop_s=0.1, thresh_db=-35, min_gap_s=0.25)
    assert regs == [[0.0, 0.4]], regs


def test_onset_density():
    assert abs(onset_density([1, 2, 3, 4], 120.0) - 2.0) < 1e-6   # 4 onsets / 2 min


def test_breath_and_buckets():
    regions = [[0, 2.0], [3.2, 5.0]]                    # a 1.2s gap at 2.0..3.2
    events = [{"at_s": 2.1, "dur_s": 1.5, "loud_db": -6, "centroid_hz": 300},    # sustained low, in the gap
              {"at_s": 4.0, "dur_s": 0.1, "loud_db": -8, "centroid_hz": 4000}]   # short bright, mid-speech
    ev = breath_around_events(events, regions)
    assert abs(ev[0]["gap"] - 1.2) < 1e-6 and ev[1]["gap"] == 0.0, ev
    b = bucket_by_acoustics(ev)
    assert b["sustained_loud"]["n"] == 1 and b["short_percussive"]["n"] == 1, b
    # the sustained event landed in the 1.2s gap; the short one was mid-speech (no pause)
    assert b["sustained_loud"]["n_with_pause"] == 1 and b["sustained_loud"]["pause_rate"] == 1.0, b
    assert abs(b["sustained_loud"]["median_pause_when_paused"] - 1.2) < 1e-6, b
    assert b["short_percussive"]["n_with_pause"] == 0 and b["short_percussive"]["pause_rate"] == 0.0, b


def test_music_presence():
    assert abs(music_presence([-20, -20, -60, -20], floor_db=-45) - 0.75) < 1e-6


def test_music_dips():
    rms = [-10] * 5 + [-40] * 4 + [-10] * 5      # steady, then a 0.4s drop, then back
    dips = music_dips(rms, hop_s=0.1, drop_db=10, min_s=0.3)
    assert len(dips) == 1 and dips[0][2] >= 10, dips


def test_ducking_depth():
    rms = [-20, -20, -8, -8, -8, -20]            # quiet under speech, louder in the gap
    regions = [[0.0, 0.2], [0.5, 0.6]]           # speech hops 0-1 and 5; gap hops 2-4
    assert ducking_depth(rms, regions, hop_s=0.1) > 0


print("running")
test_parse_ebur128(); test_speech_regions_and_gaps(); test_short_gap_is_bridged()
test_onset_density(); test_breath_and_buckets()
test_music_presence(); test_music_dips(); test_ducking_depth(); print("PASS")

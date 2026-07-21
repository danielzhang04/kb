#!/usr/bin/env python3
"""Plain-assert tests for voiceover.py's chunk-stitch offset logic (no network calls).

The seam-drift bug (fixed 2026-07-20): per-chunk offsets advanced by the alignment's
last character end (ends[-1]), which misses the mp3 frame padding each chunk's encoder
adds — proven on the poyais VO (alignment-sum 464.24s vs 464.46s of real frames in the
concatenated file; onsets stepped +0.175..+0.72s at seams). Offsets now advance by each
chunk's MEASURED decoded contribution (mp3 frame count x samples-per-frame), with
ends[-1] kept as a warned fallback so synthesis never hard-fails on a probe error.
"""
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from voiceover import measure_chunk_duration_s, stitch_chunks


def _al(text, start, end):
    """ElevenLabs-shaped alignment dict for `text` spoken evenly from start to end."""
    chars = list(text)
    step = (end - start) / len(chars)
    return {
        "characters": chars,
        "character_start_times_seconds": [start + i * step for i in range(len(chars))],
        "character_end_times_seconds": [start + (i + 1) * step for i in range(len(chars))],
    }


# --- offset logic: measured durations, not alignment ends -------------------------

def test_offsets_advance_by_measured_duration_not_alignment_end():
    # chunk-1's alignment claims it ends at 2.0s but it REALLY decodes to 2.5s
    probed = {b"chunk-1": 2.5, b"chunk-2": 3.1}
    results = [(b"chunk-1", _al("hi there", 0.0, 2.0)),
               (b"chunk-2", _al("again", 0.0, 1.0))]
    audio, words, total = stitch_chunks(results, duration_probe=probed.get)
    assert audio == b"chunk-1chunk-2", audio          # bytes concatenated in order
    assert words[0] == ["hi", 0.0], words
    assert words[2] == ["again", 2.5], words          # measured 2.5, NOT aligned 2.0
    assert total == 2.5 + 3.1, total


def test_measured_offsets_accumulate_across_three_chunks():
    probed = {b"a": 1.5, b"b": 2.25, b"c": 0.5}
    results = [(b"a", _al("one", 0.0, 1.0)),
               (b"b", _al("two", 0.0, 1.0)),
               (b"c", _al("three", 0.0, 0.4))]
    _, words, total = stitch_chunks(results, duration_probe=probed.get)
    assert [w for w, _ in words] == ["one", "two", "three"], words
    assert words[1][1] == 1.5, words           # after a's measured 1.5, not aligned 1.0
    assert words[2][1] == 3.75, words          # 1.5 + 2.25 (cumulative measured)
    assert total == 4.25, total


def test_probe_failure_falls_back_to_alignment_end_with_warning(capsys):
    results = [(b"a", _al("one", 0.0, 1.25)),
               (b"b", _al("two", 0.0, 1.0))]
    _, words, total = stitch_chunks(results, duration_probe=lambda b: None)
    assert words[1][1] == 1.25, words          # pre-fix behaviour: chunk a's ends[-1]
    assert total == 2.25, total
    out = capsys.readouterr().out
    assert "probe failed" in out and "falling back" in out, out


def test_mixed_probe_success_and_failure_per_chunk():
    # only chunk b's probe fails -> its ends[-1] is used for that seam alone
    probed = {b"a": 2.0, b"c": 1.0}
    results = [(b"a", _al("one", 0.0, 1.5)),
               (b"b", _al("two", 0.0, 0.75)),
               (b"c", _al("x", 0.0, 0.5))]
    _, words, total = stitch_chunks(results, duration_probe=probed.get)
    assert words[1][1] == 2.0, words           # a: measured
    assert words[2][1] == 2.75, words          # b: fell back to its aligned 0.75
    assert total == 3.75, total


def test_empty_alignment_chunk_yields_no_words_but_still_advances_offset():
    probed = {b"a": 1.5, b"b": 2.0}
    results = [(b"a", None),                   # e.g. alignment missing from the response
               (b"b", _al("hi", 0.0, 1.0))]
    _, words, total = stitch_chunks(results, duration_probe=probed.get)
    assert words == [["hi", 1.5]], words       # placed after a's measured audio
    assert total == 3.5, total


# --- artifact shape: [word, start] with start rounded to 3dp ----------------------

def test_word_timings_format_unchanged_word_and_3dp_start():
    results = [(b"a", _al("x", 0.0, 1.0)),
               (b"b", _al("y", 0.0, 1.0))]
    _, words, _ = stitch_chunks(results, duration_probe=lambda b: 1.23456)
    for pair in words:
        assert isinstance(pair, list) and len(pair) == 2, pair
        w, st = pair
        assert isinstance(w, str) and isinstance(st, float), pair
        assert st == round(st, 3), pair        # rounded to 3dp
    assert words[1] == ["y", 1.235], words     # offset 1.23456 rounded at placement


# --- the probe helper itself (real ffprobe over a real, network-free mp3) ---------

def _ffmpeg_missing():
    return not (shutil.which("ffmpeg") and shutil.which("ffprobe"))


def test_probe_measures_real_mp3_and_is_concat_additive(tmp_path):
    # -write_xing 0 mirrors ElevenLabs output: a headerless CBR mp3 frame stream.
    if _ffmpeg_missing():
        print("  (skipped test_probe_measures_real_mp3_and_is_concat_additive: ffmpeg/ffprobe not on PATH)")
        return
    mp3 = tmp_path / "tone.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi",
                    "-i", "sine=frequency=220:duration=2.0",
                    "-ac", "1", "-ar", "44100", "-b:a", "128k",
                    "-write_xing", "0", str(mp3)], check=True)
    b = mp3.read_bytes()
    d1 = measure_chunk_duration_s(b)
    assert d1 is not None
    assert abs(d1 - 2.0) < 0.1, d1                       # ~2s tone + codec framing
    frames = d1 * 44100 / 1152
    assert abs(frames - round(frames)) < 1e-6, frames    # exact whole-frame multiple
    # additivity under byte-concat — the property that makes this the correct offset
    # for a naively concatenated mp3 (alignment ends and container estimates lack it):
    d2 = measure_chunk_duration_s(b + b)
    assert d2 is not None and abs(d2 - 2 * d1) < 1e-9, (d1, d2)


def test_probe_returns_none_on_empty_or_garbage_bytes():
    assert measure_chunk_duration_s(b"") is None         # no ffprobe needed
    if _ffmpeg_missing():
        print("  (skipped garbage-bytes half of probe-failure test: ffprobe not on PATH)")
        return
    assert measure_chunk_duration_s(b"definitely not an mp3 frame stream") is None

#!/usr/bin/env python3
"""Plain-assert tests for breath.py. Deliberate pauses are authored `pause` cues; their gaps shift the
timeline via shift_timings (the mechanism kept after automatic structural breaths were retired 2026-07-12)."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from breath import (shift_timings, _splice_filtergraph, splice_silence, sentence_gaps, merge_gaps,
                    resolve_cut_points, _valley_cut, _floor_span, _decode_pcm_mono, _load_np)

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


# --- R7 W5: splice micro-fade (M26 click fix) --------------------------------

def test_splice_filtergraph_adds_micro_fades_at_boundaries():
    # one gap -> two VO segments. seg0 [0,1.0) abuts a trailing fill -> fade OUT; seg1 [1.0,EOF)
    # follows the fill -> fade IN. Exactly one fill block. afade, NOT acrossfade (length-preserving).
    # No room_tone_input -> the fill is anullsrc digital silence (fallback). Default (room-tone) fade 0.02.
    fc, out = _splice_filtergraph([{"at_s": 1.0, "dur_s": 0.9}])
    assert out == "[out]", out
    assert "afade=t=out:st=0.98:d=0.02:curve=losi" in fc, fc     # seg0 tail fade (1.0 - 0.02), declick curve
    assert "afade=t=in:st=0:d=0.02:curve=losi" in fc, fc         # seg1 head fade
    assert "acrossfade" not in fc, fc                 # must NOT crossfade (would shorten the timeline)
    assert fc.count("anullsrc") == 1, fc              # one silence block for the one gap


def test_splice_filtergraph_uses_cut_s_when_present():
    # R10 valley cut: when a gap carries cut_s (the valley), the VO is split THERE, not at at_s.
    fc, _ = _splice_filtergraph([{"at_s": 1.0, "dur_s": 0.5, "cut_s": 0.87}])
    assert "atrim=start=0.0:end=0.87" in fc, fc       # seg0 ends at the valley cut, not 1.0
    assert "atrim=start=0.87" in fc, fc               # seg1 resumes at the valley cut


def test_splice_filtergraph_room_tone_fill():
    # R10 room tone: with a room_tone_input, each gap draws an atrim'd bed off [1:a] via asplit — NOT
    # anullsrc digital silence. Tiny triangular joint fades at each fill edge.
    fc, _ = _splice_filtergraph([{"at_s": 1.0, "dur_s": 0.5}], room_tone_input=1)
    assert "anullsrc" not in fc, fc                   # no digital silence when room tone is available
    assert "[1:a]asplit=1[rt0]" in fc, fc             # one bed copy per gap
    assert "[rt0]atrim=duration=0.5" in fc, fc        # the fill is trimmed room tone
    assert "curve=tri" in fc, fc                      # joint fades on the room-tone block


def test_splice_filtergraph_no_gaps_is_plain_single_segment():
    # no gaps -> a single segment, no splice boundary -> no fades, no silence, concat n=1
    fc, _ = _splice_filtergraph([])
    assert "afade" not in fc and "anullsrc" not in fc, fc
    assert "concat=n=1" in fc, fc


def test_splice_fade_never_exceeds_a_short_segment():
    # two close gaps make a tiny middle segment (1.0->1.006, 6 ms); the fade clamps to the segment length
    fc, _ = _splice_filtergraph([{"at_s": 1.0, "dur_s": 0.5}, {"at_s": 1.006, "dur_s": 0.5}])
    # the 6ms segment [1.0,1.006): fade-out d clamps to 0.006 at st=0.0 (never negative st / > seg)
    assert "afade=t=out:st=0.0:d=0.006" in fc, fc


def test_splice_duration_is_exact_with_ffmpeg():
    # sample-count proof: fades scale amplitude only -> spliced length == original + gap (no drift).
    import shutil, subprocess, tempfile, os
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        print("  (skipped test_splice_duration_is_exact_with_ffmpeg: ffmpeg/ffprobe not on PATH)")
        return
    d = tempfile.mkdtemp()
    src, out = os.path.join(d, "vo.mp3"), os.path.join(d, "vo.breath.mp3")
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=2.0",
                    "-ar", "48000", "-c:a", "libmp3lame", "-q:a", "2", src], capture_output=True, text=True)
    assert splice_silence(Path(src), [{"at_s": 0.8, "dur_s": 0.5}], Path(out)), "splice failed"
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", out], capture_output=True, text=True)
    dur = float(p.stdout.strip())
    assert abs(dur - 2.5) < 0.1, f"expected ~2.5s (2.0 VO + 0.5 gap), got {dur}"   # mp3 framing tolerance


# --- R10: universal sentence-gap law — PAD-TO-TARGET -------------------------
# Insert only the shortfall to a target total gap; NOTHING when the natural (start-to-start) spacing
# already meets it. Defaults: body target 0.65, chained (<=2 words) target 0.45, min_insert 0.02.
# done.(0.9): 4-word body, next 1.5, natural 0.6 -> insert 0.05 | acres.(2.1): 3-word body, next 2.6,
# natural 0.5 -> insert 0.15 | Gone.(2.6): 1-word chained, next 3.0, natural 0.4 -> insert 0.05 |
# end.(3.3): FINAL -> no gap.
SENT_WT = [["The", 0.0], ["deal", 0.3], ["was", 0.6], ["done.", 0.9],
           ["Eight", 1.5], ["million", 1.8], ["acres.", 2.1],
           ["Gone.", 2.6],
           ["The", 3.0], ["end.", 3.3]]


def test_sentence_gaps_pad_to_target_inserts_only_shortfall():
    assert sentence_gaps(SENT_WT) == [
        {"at_s": 1.5, "dur_s": 0.05, "source": "sentence"},   # after "done." (0.65 - 0.60 natural)
        {"at_s": 2.6, "dur_s": 0.15, "source": "sentence"},   # after "acres." (0.65 - 0.50)
        {"at_s": 3.0, "dur_s": 0.05, "source": "sentence"},   # after "Gone." (chained 0.45 - 0.40)
    ], sentence_gaps(SENT_WT)                                 # "end." is final -> no trailing gap


def test_sentence_gaps_zero_insertion_when_natural_meets_target():
    # a body sentence whose next word is already >= target (0.65) away -> NO gap at all (continuous).
    wt = [["The", 0.0], ["long", 0.3], ["sentence.", 0.6], ["After", 1.35], ["it.", 1.7]]
    # sentence.@0.6 (3-word body): natural 1.35-0.6=0.75 >= 0.65 -> insert < min -> skipped entirely
    assert sentence_gaps(wt) == [], sentence_gaps(wt)


def test_sentence_gaps_chained_uses_short_target():
    # a chained (<=2-word) sentence pads to the SMALLER 0.45 target.
    wt = [["Yes.", 0.0], ["And", 0.2], ["so", 0.6], ["it", 0.9], ["goes.", 1.2]]
    # Yes.@0.0 chained: natural 0.2 -> insert 0.45-0.2 = 0.25 ; goes. is final -> no gap
    assert sentence_gaps(wt) == [{"at_s": 0.2, "dur_s": 0.25, "source": "sentence"}], sentence_gaps(wt)


def test_sentence_gaps_dials_override_defaults():
    tok = {"sentence_gap_target_s": 1.0, "sentence_gap_chained_target_s": 0.6,
           "sentence_gap_chained_max_words": 3}
    wt = [["A", 0.0], ["b", 0.3], ["c.", 0.6], ["Next", 1.0], ["one", 1.3], ["here.", 1.6], ["End.", 2.0]]
    # both body sentences are 3 words (<=3 chained) -> 0.6 target. c.@0.6 natural 0.4 -> 0.2 ;
    # here.@1.6 natural 0.4 -> 0.2 ; "End." final -> no gap
    assert sentence_gaps(wt, tok) == [{"at_s": 1.0, "dur_s": 0.2, "source": "sentence"},
                                      {"at_s": 2.0, "dur_s": 0.2, "source": "sentence"}], sentence_gaps(wt, tok)


def test_sentence_gaps_disabled_returns_empty():
    assert sentence_gaps(SENT_WT, {"sentence_gap_enabled": False}) == []


def test_sentence_gaps_skip_bracketed_pause_tags():
    # a baked [short pause] aligns as "[short" + "pause]" pseudo-tokens: never sentence-final, never
    # counted as words, and skipped when hunting the next spoken token (P17 robustness).
    wt = [["Done.", 0.0], ["[short", 0.2], ["pause]", 0.3], ["Right.", 0.4]]
    # Done.@0.0 chained (1 word, target 0.45); next SPOKEN token = Right.@0.4 (brackets skipped),
    # natural 0.4 -> insert 0.05. The gap anchors on Right., not the bracket pseudo-tokens.
    assert sentence_gaps(wt) == [{"at_s": 0.4, "dur_s": 0.05, "source": "sentence"}], sentence_gaps(wt)


def test_sentence_gaps_abbreviation_not_a_boundary():
    # "Dr." is an abbreviation -> NOT a sentence end; the whole run is one sentence until "Who."
    wt = [["Meet", 0.0], ["Dr.", 0.4], ["Who.", 0.8], ["Ok.", 1.2]]
    # Who.@0.8 (3-word body, target 0.65): next Ok.@1.2, natural 0.4 -> insert 0.25
    assert sentence_gaps(wt) == [{"at_s": 1.2, "dur_s": 0.25, "source": "sentence"}], sentence_gaps(wt)


# --- R8-B: merge_gaps (co-located stacking) ----------------------------------

def test_merge_gaps_sums_colocated_and_cue_dominates_source():
    raw = [{"at_s": 5.0, "dur_s": 0.5, "source": "sentence"},
           {"at_s": 5.0, "dur_s": 1.0, "source": "cue"},
           {"at_s": 10.0, "dur_s": 0.5, "source": "sentence"}]
    assert merge_gaps(raw) == [
        {"at_s": 5.0, "dur_s": 1.5, "source": "cue"},        # STACKED sum; any cue contributor -> "cue"
        {"at_s": 10.0, "dur_s": 0.5, "source": "sentence"},  # lone sentence keeps its source
    ], merge_gaps(raw)


def test_merge_gaps_pure_sentence_keeps_source():
    m = merge_gaps([{"at_s": 3.0, "dur_s": 0.5, "source": "sentence"},
                    {"at_s": 3.0, "dur_s": 0.3, "source": "sentence"}])
    assert m == [{"at_s": 3.0, "dur_s": 0.8, "source": "sentence"}], m


def test_merged_gaps_make_shift_and_filtergraph_agree():
    # THE core R8-B guarantee: with co-located gaps, shift_timings (sums dur) and _splice_filtergraph
    # (set-dedupes cut points) must insert the SAME total silence. Merging is what makes them agree.
    raw = [{"at_s": 5.0, "dur_s": 0.5, "source": "sentence"},
           {"at_s": 5.0, "dur_s": 1.0, "source": "cue"},
           {"at_s": 10.0, "dur_s": 0.5, "source": "sentence"}]
    gaps = merge_gaps(raw)
    total = round(sum(g["dur_s"] for g in gaps), 3)
    assert total == 2.0, total
    fc, _ = _splice_filtergraph(gaps)
    inserted = sum(float(x) for x in re.findall(
        r"anullsrc=r=48000:cl=stereo,atrim=duration=([\d.]+)", fc))
    assert abs(inserted - total) < 1e-9, (inserted, total)   # filtergraph silence == shift total
    assert fc.count("anullsrc") == 2, fc                     # one block per unique at_s (no lost stack)
    assert shift_timings([["late", 12.0]], gaps) == [["late", 14.0]], shift_timings([["late", 12.0]], gaps)


def test_splice_duration_exact_with_stacked_gaps_ffmpeg():
    # sample-count proof that a STACKED (sentence+cue) co-located gap splices its SUMMED length exactly.
    import shutil, subprocess, tempfile, os
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        print("  (skipped test_splice_duration_exact_with_stacked_gaps_ffmpeg: ffmpeg/ffprobe not on PATH)")
        return
    d = tempfile.mkdtemp()
    src, out = os.path.join(d, "vo.mp3"), os.path.join(d, "vo.breath.mp3")
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=2.0",
                    "-ar", "48000", "-c:a", "libmp3lame", "-q:a", "2", src], capture_output=True, text=True)
    gaps = merge_gaps([{"at_s": 0.8, "dur_s": 0.5, "source": "sentence"},
                       {"at_s": 0.8, "dur_s": 0.7, "source": "cue"}])   # stack -> 1.2s at 0.8
    assert splice_silence(Path(src), gaps, Path(out)), "splice failed"
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", out], capture_output=True, text=True)
    dur = float(p.stdout.strip())
    assert abs(dur - 3.2) < 0.1, f"expected ~3.2s (2.0 VO + 1.2 stacked gap), got {dur}"


# --- R10: valley cut + room-tone fill ----------------------------------------

def test_valley_cut_lands_in_the_silence_valley():
    # a voiced burst that decays into a floor; the nominal onset (at_s) sits in the floor. The valley
    # cut must land where the tail has decayed (start of the floor), NEVER inside the still-voiced burst.
    np = _load_np()
    if np is None:
        print("  (skipped test_valley_cut_lands_in_the_silence_valley: numpy absent)"); return
    sr = 16000
    s = 0.0005 * np.ones(int(0.4 * sr))                                  # low floor everywhere
    burst = 0.5 * np.sin(2 * np.pi * 120 * np.arange(int(0.2 * sr)) / sr)
    s[:int(0.2 * sr)] += burst                                          # voiced tail [0,0.2)
    cut = _valley_cut(s, sr, at_s=0.25)                                 # onset sits in the floor
    assert 0.18 <= cut <= 0.26, cut     # cut at the tail-decay/floor, earliest — not inside the burst


def test_floor_span_finds_the_quiet_region():
    np = _load_np()
    if np is None:
        print("  (skipped test_floor_span_finds_the_quiet_region: numpy absent)"); return
    sr = 16000
    s = 0.4 * np.sin(2 * np.pi * 120 * np.arange(int(1.0 * sr)) / sr)
    s[int(0.5 * sr):int(0.9 * sr)] = 0.001                             # a 0.4s quiet span
    span = _floor_span(s, sr, span_s=0.30)
    assert span is not None and 0.5 <= span[0] <= 0.6, span            # start inside the quiet span


def test_resolve_cut_points_preserves_dur_and_is_monotonic():
    # AUTHORED pause dur (and sentence dur) are untouched — only cut_s is added; cuts strictly increase.
    np = _load_np()
    if np is None:
        print("  (skipped test_resolve_cut_points_preserves_dur_and_is_monotonic: numpy absent)"); return
    s = 0.001 * np.ones(int(3.0 * 16000))                              # uniform floor
    gaps = [{"at_s": 1.0, "dur_s": 0.9, "source": "cue"},              # a 0.9s authored card pause
            {"at_s": 2.0, "dur_s": 0.05, "source": "sentence"}]
    out = resolve_cut_points(None, gaps, samples=s)
    assert [g["dur_s"] for g in out] == [0.9, 0.05], out               # authored + sentence dur preserved
    assert all("cut_s" in g for g in out), out
    assert out[0]["cut_s"] < out[1]["cut_s"], out                      # strictly increasing


def test_room_tone_fill_is_not_digital_silence_ffmpeg():
    # end-to-end proof the inserted gap holds SAMPLED room tone (>> -120 dBFS), not anullsrc digital black.
    import shutil, subprocess, tempfile, os, struct
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        print("  (skipped test_room_tone_fill_is_not_digital_silence_ffmpeg: ffmpeg/ffprobe not on PATH)")
        return
    d = tempfile.mkdtemp()
    src, out = os.path.join(d, "vo.mp3"), os.path.join(d, "vo.breath.mp3")
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=200:duration=2.0",
                    "-ar", "48000", "-c:a", "libmp3lame", "-q:a", "2", src], capture_output=True, text=True)
    assert splice_silence(Path(src), [{"at_s": 1.0, "dur_s": 0.6}], Path(out)), "splice failed"
    # the gap sits around the valley (~0.85) for 0.6s; sample well inside it and measure RMS
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", "0.98", "-t", "0.35", "-i", out,
                          "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    n = len(raw) // 2
    samp = struct.unpack("<%dh" % n, raw[:n * 2]) if n else ()
    rms = (sum((x / 32768.0) ** 2 for x in samp) / len(samp)) ** 0.5 if samp else 0.0
    import math as _m
    db = 20 * _m.log10(rms) if rms > 1e-6 else -120.0
    assert db > -80.0, f"gap floor {db:.1f} dBFS — expected sampled room tone, not digital silence"


if __name__ == "__main__":
    print("running")
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
    print("PASS")

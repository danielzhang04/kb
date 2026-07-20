#!/usr/bin/env python3
"""breath.py — render-time silence gaps: AUTHORED `pause` cues + the UNIVERSAL sentence law.

Two gap sources, one mechanism:
  - AUTHORED pause gaps (`source:"cue"`, from `audio_cues.cue_pause_gaps`): a deliberate silence before
    an authored cue's anchor word, so a reveal/punch lands with a real beat of silence + a bed dip.
  - UNIVERSAL sentence gaps (`source:"sentence"`, from `sentence_gaps()`): PAD-TO-TARGET (R10) — after
    every sentence-final word, pad the TOTAL gap before the next word UP TO a target (~0.65s, ~0.45s
    chained), inserting only the shortfall and NOTHING when the VO's natural spacing already meets it.
    This supersedes the R8-B additive "+0.5s on top" law (which doubled every pause -> the "not
    continuous" defect). Engine-wide VO rhythm; REPLACES the retired baked `[PAUSE]`/`[BEAT]` TTS tags.
    It is NOT music: it is EXCLUDED from bed dips and SFX event-withhold (a sentence boundary is not a
    full-stop), but DOES shift the timeline.

Both gap sources are spliced with a VALLEY cut (the min-RMS point near the boundary, so voiced tails
fully decay) and filled with sampled ROOM TONE, not digital silence (R10 — see the splice block below).

Both sources are on the ORIGINAL (un-shifted) timeline and STACK — a sentence gap and an authored pause
at the SAME boundary SUM (R8-B: stack, not max). `merge_gaps()` combines co-located gaps into ONE gap
whose `dur_s` is the sum, so `shift_timings` (sums all earlier dur) and `_splice_filtergraph` (which
set-dedupes cut points and would otherwise insert only the FIRST gap) AGREE on the spliced length.

Flow (called by build_motion.build_piece_spec, after merge_gaps):
  1. shift_timings(word_timings, gaps) -> word-timings pushed later past each gap (ONE offset point;
     everything downstream reads the shifted list).
  2. splice_silence(vo.mp3, gaps, vo.breath.mp3) -> a DERIVED gapped audio (original untouched).

Deterministic + idempotent: always derived from the ORIGINAL vo.mp3 + original word-timings.
"""
import math
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


# A sentence-final word carries terminal punctuation on the token (ElevenLabs word_timings tokens keep
# it — verified: "owned,", "Poyais.", "home.", "1823.", "existed."). Match a . ! or ? possibly followed
# by a closing quote/bracket. The word_timings token itself is the unit (no look-ahead into text).
_SENTENCE_END_RE = re.compile(r"[.!?][\"')\]]*$")

# Abbreviations whose trailing "." is NOT a sentence end (general-engine guard so a channel with "Mr."
# / "Dr." / "St." / "vs." does not false-fire a gap mid-sentence). Matched case-insensitively on the
# whole token. THIS video has zero such tokens; the guard is for portability.
_ABBREV = {"mr.", "mrs.", "ms.", "dr.", "st.", "sr.", "jr.", "no.", "vs.", "etc.", "prof.",
           "gen.", "sen.", "rev.", "hon.", "co.", "inc.", "ltd.", "e.g.", "i.e.", "a.m.", "p.m."}


def _is_tag_token(w) -> bool:
    """A bracketed pseudo-token from a baked TTS tag (e.g. the `[short pause]` pair aligns as `[short`
    + `pause]`). NOT a spoken word — never counts toward the sentence word-count and is never treated
    as sentence-final. Robust even though the [PAUSE] tags are being removed from the script (P17)."""
    return "[" in str(w) or "]" in str(w)


def _is_sentence_final(w) -> bool:
    s = str(w).strip()
    if not s or _is_tag_token(s):
        return False
    if not _SENTENCE_END_RE.search(s):
        return False
    return s.lower() not in _ABBREV


def sentence_boundaries(word_timings, tokens=None) -> list:
    """Every sentence boundary in word_timings as
    [{"final_word", "final_s", "next_word", "next_s", "target_s"}, ...] — the shared boundary law used
    by sentence_gaps() (which pads them) AND the post-render sentence-gap verifier (audio_checker), so
    the padder and the checker can never disagree about WHERE a sentence pause is owed. The FINAL
    sentence (no next token) yields no boundary; bracketed tag pseudo-tokens are skipped. Targets from
    `tokens` (audio-tokens.json): `sentence_gap_chained_target_s` (0.45s) for a chained
    <= `sentence_gap_chained_max_words` (2) sentence, else `sentence_gap_target_s` (0.65s)."""
    t = tokens or {}
    target_s = float(t.get("sentence_gap_target_s", 0.65))
    chained_target_s = float(t.get("sentence_gap_chained_target_s", 0.45))
    chained_max = int(t.get("sentence_gap_chained_max_words", 2))
    toks = [(str(w), float(ts)) for w, ts in (word_timings or [])]
    out, wc = [], 0
    for i, (w, ts) in enumerate(toks):
        if _is_tag_token(w):
            continue
        wc += 1
        if _is_sentence_final(w):
            nxt = next(((nw, nt) for nw, nt in toks[i + 1:] if not _is_tag_token(nw)), None)
            if nxt is not None:   # no trailing boundary on the last sentence (nothing follows)
                out.append({"final_word": w, "final_s": round(ts, 3),
                            "next_word": nxt[0], "next_s": round(float(nxt[1]), 3),
                            "target_s": chained_target_s if wc <= chained_max else target_s})
            wc = 0
    return out


# Acoustic gap measurement (R11). ElevenLabs word_timings carry word ONSETS only, so the old
# start-to-start "natural" proxy INCLUDED the sentence-final word's own spoken duration — a long final
# word made the boundary look padded when the real silence was a fraction of it (measured on poyais:
# proxy overstated the true gap by a mean +0.20s, up to +0.60s). On top of that, the mp3 chunk stitch
# (`offset += ends[-1]`) drifts the claimed timeline from the real audio by up to ~0.7s at/after chunk
# seams. Both defects suppressed sentence pads (worst in the back half — the "rushed" r10 defect), so
# the pad now derives from the AUDIO ITSELF: measure the real low-RMS silence run at each boundary and
# pad the MEASURED gap up to target.
_GAP_MEASURE_THRESHOLD_DB = -38.0   # below this frame RMS = silence (speech here sits ~-25 dBFS,
                                    # inter-sentence floor ~-85; breaths mostly stay above -38 and
                                    # correctly do NOT count as pause)
_GAP_SEARCH_AFTER_S = 1.2           # search this far past the CLAIMED next onset (covers the measured
                                    # worst-case stitch drift of ~0.7s with margin)
_GAP_FRAME_MS = 10
_GAP_HOP_MS = 5


def measure_natural_gap(samples, sr, final_start_s, next_start_s,
                        threshold_db=_GAP_MEASURE_THRESHOLD_DB,
                        search_after_s=_GAP_SEARCH_AFTER_S,
                        frame_ms=_GAP_FRAME_MS, hop_ms=_GAP_HOP_MS):
    """Measure the REAL acoustic silence at a sentence boundary. Scans frame RMS over
    [final_start_s, next_start_s + search_after_s], collects contiguous below-threshold runs, and picks
    the run maximizing (length - distance_to_claimed_next_onset) — long real inter-sentence silence
    beats a nearby plosive dip, while a same-length run nearer the claimed onset beats e.g. the pause
    after a following "Well," (drift never exceeds the search margin). Returns
    {"gap_s", "start_s", "end_s"} or None when there is no usable PCM / no frames (caller then falls
    back to the start-to-start proxy). A boundary with NO below-threshold run returns gap_s 0.0 (fully
    continuous speech — pad the whole target)."""
    if samples is None or len(samples) == 0:
        return None
    frame = max(1, int(sr * frame_ms / 1000))
    hop = max(1, int(sr * hop_ms / 1000))
    thr_lin = 10.0 ** (threshold_db / 20.0)
    lo = max(0, int(round(final_start_s * sr)))
    hi = min(len(samples), int(round((next_start_s + search_after_s) * sr)))
    if hi - lo < frame:
        return None
    runs, cur = [], None   # [t_start, t_end] of below-threshold frame centers
    i = lo
    while i + frame <= hi:
        t = (i + frame / 2.0) / sr
        if _win_rms_lin(samples, i, i + frame) < thr_lin:
            if cur is None:
                cur = [t, t]
            else:
                cur[1] = t
        else:
            if cur is not None:
                runs.append(cur); cur = None
        i += hop
    if cur is not None:
        runs.append(cur)
    if not runs:
        return {"gap_s": 0.0, "start_s": None, "end_s": None}

    def dist(r):
        s, e = r
        return 0.0 if s <= next_start_s <= e else min(abs(s - next_start_s), abs(e - next_start_s))

    s, e = max(runs, key=lambda r: (r[1] - r[0]) - dist(r))
    return {"gap_s": round(e - s + frame_ms / 1000.0, 3),   # + one frame width (center-to-center span)
            "start_s": round(s, 3), "end_s": round(e, 3)}


def sentence_gaps(word_timings, tokens=None, vo_path=None, samples=None) -> list:
    """The universal sentence-gap law — PAD-TO-TARGET semantics (R10, supersedes the R8-B additive law).

    After every sentence-final word we want the TOTAL gap before the next word (the VO's own natural
    silence + whatever we insert) to reach a target; we insert ONLY the shortfall, and NOTHING when the
    natural silence already meets the target. This replaces the old "+`sentence_gap_s` (0.5s) on top of
    prosody" rule, which doubled every sentence pause (the "not continuous" defect, R10 diag).

      natural = the MEASURED low-RMS silence run at the boundary (R11 — measure_natural_gap(); the audio
                is ground truth). Only when no PCM is available (no vo/ffmpeg, unit tests) does it fall
                back to the start-to-start onset proxy `next_token.start - final_word.start` — which
                overstates the gap by the final word's own spoken duration and drifts at chunk seams
                (the r10 "rushed second half" defect).
      target  = `sentence_gap_chained_target_s` (0.45s) for a chained <= `sentence_gap_chained_max_words`
                (2) sentence, else `sentence_gap_target_s` (0.65s)
      insert  = max(0, target - natural);  emit a gap only when insert >= `sentence_gap_min_insert_s`
                (0.02s) — below that the boundary is left fully continuous (no cut, no splice).

    Measured gaps also carry `cut_s` — the valley INSIDE the measured silence run — so the splice cuts in
    real silence even where the claimed timeline has drifted past the +/-0.15s valley window (r10's
    mid-word room-tone splices at seams); resolve_cut_points() honours it. `at_s` stays the CLAIMED next
    onset (the word-timings timeline) so shift_timings / card-alignment / build_audio are unchanged.

    Bracketed tag pseudo-tokens are skipped. Dials read from `tokens` (audio-tokens.json) with the code
    defaults above; `sentence_gap_enabled:false` disables it entirely. Emits `source:"sentence"` gaps on
    the ORIGINAL timeline — merge_gaps() then stacks any co-located authored pause, and build_audio
    EXCLUDES source=="sentence" from dips + SFX withhold. The OLD keys
    (`sentence_gap_s`/`sentence_gap_chained_s`) are superseded and ignored."""
    t = tokens or {}
    if not t.get("sentence_gap_enabled", True):
        return []
    min_insert = float(t.get("sentence_gap_min_insert_s", 0.02))
    thr_db = float(t.get("sentence_gap_measure_threshold_db", _GAP_MEASURE_THRESHOLD_DB))
    if samples is None and vo_path is not None:
        samples = _decode_pcm_mono(Path(vo_path))
    out = []
    for b in sentence_boundaries(word_timings, t):
        meas = measure_natural_gap(samples, _ANALYSIS_SR, b["final_s"], b["next_s"],
                                   threshold_db=thr_db) if samples is not None else None
        if meas is not None:
            natural = meas["gap_s"]
        else:
            natural = b["next_s"] - b["final_s"]   # onset proxy fallback (no PCM only)
        insert = round(b["target_s"] - natural, 3)
        if insert >= min_insert:
            g = {"at_s": b["next_s"], "dur_s": insert, "source": "sentence"}
            if meas is not None:
                g["natural_s"] = natural   # measured true silence (report/verifier context)
                if meas["start_s"] is not None:
                    # valley INSIDE the real silence run (earliest at-floor point) — the splice cut
                    g["cut_s"] = _valley_cut(samples, _ANALYSIS_SR,
                                             (meas["start_s"] + meas["end_s"]) / 2.0,
                                             window_s=max((meas["end_s"] - meas["start_s"]) / 2.0, 0.02))
            out.append(g)
    return out


def merge_gaps(gaps) -> list:
    """Combine gaps sharing an at_s into ONE gap whose `dur_s` is the SUM (co-located sentence + authored
    pause STACK, per R8-B). REQUIRED before shift_timings/splice: `_splice_filtergraph` set-dedupes cut
    points and would insert only the first gap at a shared at_s, while `shift_timings` sums all dur_s —
    they DISAGREE without this merge. After merging there is exactly one gap per at_s, so both agree and
    the spliced length == sum of all inserted silence.

    Source precedence: the merged gap is `source:"sentence"` ONLY if EVERY contributor is a sentence gap;
    ANY authored (`cue`) contributor makes it `cue` — so a boundary that stacks a sentence gap onto an
    authored pause keeps the authored pause's dip + event-withhold behaviour (the extra sentence silence
    just lengthens the window). A contributor's measured `cut_s` (the valley inside the real silence run,
    R11) is PRESERVED on the merged gap — resolve_cut_points honours it over the +/-0.15s at_s window.
    Returns a NEW list sorted by at_s; input is not mutated."""
    by_at = {}
    for g in gaps or []:
        key = round(float(g["at_s"]), 3)
        src = g.get("source", "cue")
        cur = by_at.get(key)
        if cur is None:
            by_at[key] = {"at_s": key, "dur_s": round(float(g["dur_s"]), 3), "source": src}
            if g.get("cut_s") is not None:
                by_at[key]["cut_s"] = round(float(g["cut_s"]), 3)
        else:
            cur["dur_s"] = round(cur["dur_s"] + float(g["dur_s"]), 3)
            if src != "sentence":
                cur["source"] = "cue"   # any authored contributor dominates the source label
            if cur.get("cut_s") is None and g.get("cut_s") is not None:
                cur["cut_s"] = round(float(g["cut_s"]), 3)
    return sorted(by_at.values(), key=lambda x: x["at_s"])


def shift_timings(word_timings, gaps):
    """Push every word at/after a gap later by that gap's dur_s (cumulative over gaps). The word
    AT a gap's at_s (the breath-beat's first word) shifts — the silence is inserted before it."""
    if not gaps:
        return word_timings
    return [[w, round(float(t) + sum(g["dur_s"] for g in gaps if g["at_s"] <= float(t)), 3)]
            for w, t in word_timings]


# ---------------------------------------------------------------------------
# R10 valley-cut + room-tone splice.  Three joined fixes to the "VO cuts" defect (diag r10-diag-vo.md):
#   (1) VALLEY CUT — cut at the measured min-RMS point in a +/-`_VALLEY_WINDOW_S` window around the
#       gap's nominal at_s (the ElevenLabs next-word ONSET), biased to the EARLIEST point at the floor,
#       so a sentence-final word's low-register voiced tail fully decays before the splice (the "spo-t"
#       truncation). The chosen point is stored on the gap as `cut_s`; at_s (the anchor word) is left
#       untouched so shift_timings / card-alignment / build_audio are unchanged (no word onset ever lies
#       between valley and at_s — the valley is the quiet inter-word floor).
#   (2) ROOM TONE — fill each inserted gap with low-level room tone sampled from the quietest span of the
#       VO itself (looped, tiny joint fades), NOT `anullsrc` -120 dBFS digital black (the dead-air holes
#       between live room-tone). Applies to ALL inserted gaps (sentence gaps AND authored pause cues).
#   (3) SPLICE FADES — sized PER PATH (measured, R10):
#       - ROOM-TONE path: a SHORT declick fade (`_SPLICE_FADE_S`). The bed already sits at the VO's own
#         floor level, so no long ramp is needed — and a LONG fade is actively harmful here: an ~0.10s
#         losi fade drives the VO to DIGITAL ZERO over its tail, and that sub-(-119 dBFS) tail reads as a
#         40-60ms silent NOTCH against the room tone (measured: 17 such notches at 0.10s; ~0 at 0.02s).
#         A short fade just declicks the valley join (which is already at the energy floor).
#       - SILENCE-FALLBACK path (room tone unavailable): a LONG fade (`_SILENCE_FALLBACK_FADE_S`) — here
#         digital zero IS the destination, so a gradual ramp into/out of it is exactly what's wanted.
# All fades scale amplitude ONLY — sample count (hence total spliced length == original + sum(gap dur_s),
# which shift_timings depends on) is unchanged.
_SPLICE_FADE_S = 0.02             # VO<->room-tone declick (SHORT — a long fade notches against the bed)
_SILENCE_FALLBACK_FADE_S = 0.16   # long fade when we fall back to anullsrc digital silence (zero = target)
_SPLICE_FADE_CURVE = "losi"
_ROOM_TONE_JOINT_FADE_S = 0.008   # tiny fade at each room-tone block edge (declick, no long notch)
_ROOM_TONE_STAGGER_S = 0.037      # per-gap read offset into the looped bed (so sub-100ms fills don't
                                  # all sample the bed's identical opening — spreads the sampled tone)
_ANALYSIS_SR = 16000              # mono PCM rate for valley / floor-span analysis
_VALLEY_WINDOW_S = 0.15           # +/- search window around at_s for the cut valley
_ROOM_TONE_SPAN_S = 0.30          # min length of the sampled room-tone span


def _load_np():
    try:
        import numpy as np
        return np
    except Exception:
        return None


def _decode_pcm_mono(vo_path, sr=_ANALYSIS_SR):
    """Decode vo_path to mono PCM at `sr` via ffmpeg s16le. Returns a numpy float64 array in [-1,1] when
    numpy is present, else an array('h') of raw int16 (scaled at RMS time). None on ffmpeg absence / empty
    output — callers then skip valley/room-tone and degrade to the silence-fallback path."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(vo_path), "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"]
    try:
        raw = subprocess.run(cmd, capture_output=True).stdout
    except FileNotFoundError:
        return None
    if not raw:
        return None
    np = _load_np()
    if np is not None:
        return np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    import array
    a = array.array("h")
    a.frombytes(raw[: (len(raw) // 2) * 2])
    return a


def _win_rms_lin(samples, a, b):
    """Linear RMS in [0,1] over samples[a:b] (numpy float array or array('h') int16)."""
    a = max(0, a)
    b = min(len(samples), b)
    if b <= a:
        return 0.0
    np = _load_np()
    if np is not None and hasattr(samples, "dtype"):
        seg = samples[a:b]
        return float(np.sqrt(np.mean(seg * seg)))
    s = samples[a:b]
    return (sum((x / 32768.0) ** 2 for x in s) / len(s)) ** 0.5


def _valley_cut(samples, sr, at_s, window_s=_VALLEY_WINDOW_S,
                frame_ms=10, hop_ms=5, floor_margin_db=2.0):
    """The EARLIEST minimum-RMS point in [at_s-window, at_s+window] — i.e. the first moment the energy
    has decayed to within `floor_margin_db` of the window minimum (so the prior word's tail is spent).
    Returns a cut time (s). Falls back to at_s when there is no usable PCM."""
    if samples is None or len(samples) == 0:
        return round(float(at_s), 3)
    frame = max(1, int(sr * frame_ms / 1000))
    hop = max(1, int(sr * hop_ms / 1000))
    lo = max(0, int(round((at_s - window_s) * sr)))
    hi = min(len(samples), int(round((at_s + window_s) * sr)))
    if hi - lo < frame:
        return round(float(at_s), 3)
    frames = []   # (center_time_s, rms_lin)
    i = lo
    while i + frame <= hi:
        frames.append(((i + frame / 2.0) / sr, _win_rms_lin(samples, i, i + frame)))
        i += hop
    if not frames:
        return round(float(at_s), 3)
    m = min(r for _, r in frames)
    thr = m * (10.0 ** (floor_margin_db / 20.0))
    for t, r in frames:
        if r <= thr:
            return round(max(0.0, t), 3)
    return round(float(at_s), 3)


def _floor_span(samples, sr, span_s=_ROOM_TONE_SPAN_S, hop_ms=20):
    """[start_s, end_s] of the quietest `span_s`-long window in the file (the room-tone source), or None
    when the file is shorter than the span."""
    if samples is None:
        return None
    w = int(span_s * sr)
    n = len(samples)
    if n < w:
        return None
    hop = max(1, int(sr * hop_ms / 1000))
    best, best_start = None, 0
    i = 0
    while i + w <= n:
        r = _win_rms_lin(samples, i, i + w)
        if best is None or r < best:
            best, best_start = r, i
        i += hop
    return (round(best_start / sr, 3), round((best_start + w) / sr, 3))


def _extract_room_tone(vo_path, span, out_path, min_len_s) -> bool:
    """Tile the room-tone span [s0,s1] of vo_path (looped) into a stereo/48k wav >= min_len_s+margin, so
    the splice filtergraph can atrim per-gap fills out of it. Two steps: (1) cut the span to a temp wav,
    (2) `-stream_loop -1` that temp to length (the proven loop pattern — `-stream_loop` does NOT tile a
    span selected via input -ss/-t). Returns True on success."""
    s0, s1 = span
    seg = max(0.05, s1 - s0)
    total = float(min_len_s) + 0.5
    out_path = Path(out_path)
    span_tmp = out_path.with_suffix(".span.wav")
    try:
        p1 = subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{s0:.3f}", "-t", f"{seg:.3f}", "-i", str(vo_path),
             "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(span_tmp)],
            capture_output=True, text=True)
        if p1.returncode != 0 or not span_tmp.exists():
            return False
        p2 = subprocess.run(
            ["ffmpeg", "-y", "-stream_loop", "-1", "-i", str(span_tmp), "-t", f"{total:.3f}",
             "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(out_path)],
            capture_output=True, text=True)
        return p2.returncode == 0 and out_path.exists()
    except FileNotFoundError:
        return False
    finally:
        if span_tmp.exists():
            try:
                span_tmp.unlink()
            except OSError:
                pass


def _splice_filtergraph(gaps, fade_s=_SPLICE_FADE_S, room_tone_input=None,
                        joint_fade_s=_ROOM_TONE_JOINT_FADE_S):
    """Build the ffmpeg filter_complex string for the gapped VO (pure — no ffmpeg call, unit-testable).
    VO is split at each gap's CUT point (`cut_s`, the valley — falls back to `at_s` when absent); a gap
    fill is inserted BEFORE each cut-start segment; everything concats in order. Each VO segment edge that
    abuts a fill gets a <=`fade_s` afade (out into the fill, in out of it). Fills are ROOM TONE atrimmed
    from input `[<room_tone_input>:a]` (one asplit output per gap, each with tiny joint fades) when
    `room_tone_input` is not None, else `anullsrc` digital silence. Fades change amplitude only, never
    sample count, so total duration is unchanged. Returns (filter_complex_string, out_label)."""
    def cut_of(g):
        return float(g.get("cut_s", g["at_s"]))

    cuts = sorted({0.0, *(cut_of(g) for g in gaps)})
    lead = next((g for g in gaps if abs(cut_of(g)) < 1e-6), None)   # leading breath (cut at t=0), rare
    n = len(cuts)
    filt, labels = [], []
    rt_labels = []
    if room_tone_input is not None and gaps:
        outs = "".join(f"[rt{k}]" for k in range(len(gaps)))
        filt.append(f"[{room_tone_input}:a]asplit={len(gaps)}{outs}")   # one identical bed per gap
        rt_labels = [f"[rt{k}]" for k in range(len(gaps))]
    rt_iter = iter(rt_labels)
    fill_k = [0]   # per-fill counter -> staggered read offset into the looped bed

    def _fill(dur, out_label):
        if room_tone_input is not None:
            rl = next(rt_iter)
            off = round(fill_k[0] * _ROOM_TONE_STAGGER_S, 6)
            fill_k[0] += 1
            # atrim `duration` is OUTPUT length (not an end timestamp): read `dur` s from bed offset `off`
            trim = (f"start={off}:duration={dur}" if off > 1e-9
                    else f"duration={dur}")   # start=0 omitted so single-gap output stays stable
            jf = min(joint_fade_s, dur / 2.0)
            return (f"{rl}atrim={trim},asetpts=PTS-STARTPTS,"
                    f"afade=t=in:st=0:d={jf}:curve=tri,"
                    f"afade=t=out:st={round(dur - jf, 6)}:d={jf}:curve=tri{out_label}")
        return f"anullsrc=r=48000:cl=stereo,atrim=duration={dur},asetpts=PTS-STARTPTS{out_label}"

    for i, start in enumerate(cuts):
        end = cuts[i + 1] if i + 1 < n else None
        trim = f"atrim=start={start}" + (f":end={end}" if end is not None else "")
        chain = [f"[0:a]{trim}", "asetpts=PTS-STARTPTS"]
        preceded = (i > 0) or (lead is not None)   # a fill block sits immediately BEFORE this segment
        followed = end is not None                 # every non-final segment abuts a trailing fill block
        seg_dur = (end - start) if end is not None else None
        if preceded and fade_s > 0:
            d_in = min(fade_s, seg_dur) if seg_dur is not None else fade_s
            chain.append(f"afade=t=in:st=0:d={d_in}:curve={_SPLICE_FADE_CURVE}")
        if followed and fade_s > 0:
            d = min(fade_s, seg_dur)               # clamp so the fade never exceeds a (tiny) segment
            st = round(max(0.0, seg_dur - d), 6)
            chain.append(f"afade=t=out:st={st}:d={d}:curve={_SPLICE_FADE_CURVE}")
        filt.append(",".join(chain) + f"[a{i}]")
        labels.append(f"[a{i}]")
        # a fill block precedes every cut point that is a gap start (each start>0 that's a gap cut)
        g = next((g for g in gaps if abs(cut_of(g) - start) < 1e-6 and start > 0), None)
        if g:
            filt.append(_fill(g["dur_s"], f"[s{i}]"))
            labels.insert(len(labels) - 1, f"[s{i}]")   # fill goes BEFORE this segment
    if lead:   # leading breath — a fill block before seg 0
        filt.append(_fill(lead["dur_s"], "[lead]"))
        labels.insert(0, "[lead]")
    filt.append("".join(labels) + f"concat=n={len(labels)}:v=0:a=1[out]")
    return ";".join(filt), "[out]"


def resolve_cut_points(vo_path, gaps, samples=None):
    """Return a COPY of `gaps` with each gap's `cut_s` set to its valley (min-RMS) point, kept strictly
    increasing (no filtergraph cut collision). A gap that ALREADY carries a `cut_s` (the measured-silence
    valley from sentence_gaps, R11) keeps it — that cut was found inside the boundary's REAL silence run,
    which the +/-`_VALLEY_WINDOW_S` search around a drifted at_s can miss entirely. Gaps without one
    (authored cues) get the local valley near at_s as before. `samples` may be pre-decoded; otherwise it
    is decoded from vo_path. Pure of ffmpeg-render side effects — usable by the continuity gate + tests."""
    work = [dict(g) for g in (gaps or [])]
    if not work:
        return work
    if samples is None and any(g.get("cut_s") is None for g in work):
        samples = _decode_pcm_mono(Path(vo_path))
    prev_cut = -1.0
    for g in sorted(work, key=lambda x: float(x["at_s"])):
        if g.get("cut_s") is not None:
            c = round(float(g["cut_s"]), 3)
        else:
            c = _valley_cut(samples, _ANALYSIS_SR, float(g["at_s"]))
        if c <= prev_cut:   # collision guard — keep cut points strictly increasing
            c = round(float(g["at_s"]), 3)
        g["cut_s"] = c
        prev_cut = c
    return work


def splice_silence(vo_path: Path, gaps, out_path: Path) -> bool:
    """Write a COPY of vo_path with dur_s of ROOM TONE (or, as a fallback, digital silence) inserted at
    each gap's valley `cut_s` (near its original at_s). Idempotent: always reads the original vo_path.
    Returns True on success; on ffmpeg absence/failure, warns and returns False (the breath is additive —
    the caller falls back to vo_path). No gaps -> a plain copy (True). See the R10 splice block above for
    the valley-cut / room-tone / fade design; total spliced length == original + sum(gap dur_s)."""
    vo_path, out_path = Path(vo_path), Path(out_path)
    if not vo_path.exists():
        return False
    samples = _decode_pcm_mono(vo_path) if gaps else None
    work = resolve_cut_points(vo_path, gaps, samples=samples)   # each gap gets a valley cut_s

    rt_path, room_tone_input, fade = None, None, _SILENCE_FALLBACK_FADE_S
    try:
        if work and samples is not None:
            span = _floor_span(samples, _ANALYSIS_SR)
            if span is not None:
                fd, rt = tempfile.mkstemp(suffix=".roomtone.wav", dir=str(out_path.parent))
                os.close(fd)
                # bed must cover the longest gap PLUS every fill's staggered read offset
                bed_len = max(g["dur_s"] for g in work) + len(work) * _ROOM_TONE_STAGGER_S
                if _extract_room_tone(vo_path, span, Path(rt), bed_len):
                    rt_path, room_tone_input, fade = rt, 1, _SPLICE_FADE_S
                else:
                    os.remove(rt)
        filter_complex, out_label = _splice_filtergraph(work, fade_s=fade,
                                                        room_tone_input=room_tone_input)
        cmd = ["ffmpeg", "-y", "-i", str(vo_path)]
        if rt_path:
            cmd += ["-i", rt_path]
        cmd += ["-filter_complex", filter_complex, "-map", out_label,
                "-ar", "48000", "-c:a", "libmp3lame", "-q:a", "2", str(out_path)]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True)
        except FileNotFoundError:
            sys.stderr.write("  ! ffmpeg not found — skipping breath splice (rendering un-gapped VO)\n")
            return False
        if proc.returncode != 0 or not out_path.exists():
            sys.stderr.write(f"  ! breath splice failed (ffmpeg exit {proc.returncode}) — un-gapped VO\n")
            return False
        return True
    finally:
        if rt_path and os.path.exists(rt_path):
            os.remove(rt_path)

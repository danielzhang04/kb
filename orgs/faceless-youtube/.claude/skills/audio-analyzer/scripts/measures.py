#!/usr/bin/env python3
"""Pure audio measurement functions (the tested core of the reference-audio analysis).

DETERMINISTIC TOOLS PRODUCE THE NUMBERS; these functions only parse/bucket/aggregate them (G1).
No function here "listens" — every input is a number from ffmpeg/librosa. Pure + hermetic-testable
(numpy-synthesized signals + captured tool-output strings; never Demucs/network/CLAP — G3/G4).

Reliable vs directional (G6): loudness, speech-gaps, music presence/dips/ducking, breath-around-events
are [reliable]. Onset *density* is [directional] (SFX and music hits aren't separable in the residual).
"""
import re


def parse_ebur128(stderr: str) -> dict:
    """Parse an ffmpeg `-af ebur128` Summary block -> {lufs, lra, true_peak} (dB floats).

    Only the FINAL `Summary:` block is parsed — the per-frame lines ffmpeg streams before it also carry
    `I:/LRA:` (e.g. `I: -70.0 LUFS` over the silent intro), so a naive whole-string search grabs a frame
    value, not the integrated result. Isolate the summary first."""
    summary = stderr.rsplit("Summary:", 1)[-1] if "Summary:" in stderr else stderr

    def grab(pat):
        m = re.search(pat, summary)
        return float(m.group(1)) if m else None
    return {"lufs": grab(r"I:\s*(-?\d+\.?\d*)\s*LUFS"),
            "lra": grab(r"LRA:\s*(-?\d+\.?\d*)\s*LU"),
            "true_peak": grab(r"Peak:\s*(-?\d+\.?\d*)\s*dBFS")}


def speech_regions(rms, hop_s, thresh_db=-35, min_gap_s=0.25):
    """Contiguous [start,end] spans where the (vocal-stem) RMS is >= thresh_db dBFS; sub-min_gap_s
    silences between spans are bridged (normal within-phrase micro-pauses). Pure over the frame list."""
    above = [i for i, v in enumerate(rms) if v >= thresh_db]
    if not above:
        return []
    runs, start, prev = [], above[0], above[0]
    for i in above[1:]:
        if i == prev + 1:
            prev = i
        else:
            runs.append((start, prev)); start = i; prev = i
    runs.append((start, prev))
    spans = [[round(s * hop_s, 6), round((e + 1) * hop_s, 6)] for s, e in runs]
    merged = [spans[0]]
    for sp in spans[1:]:
        if sp[0] - merged[-1][1] < min_gap_s:
            merged[-1][1] = sp[1]
        else:
            merged.append(sp)
    return merged


def speech_gaps(regions):
    """The silence durations between speech spans (pure). [] for <2 regions."""
    return [round(regions[i + 1][0] - regions[i][1], 6) for i in range(len(regions) - 1)]


def onset_density(onsets, duration_s):
    """Onsets per minute (pure). [directional] — residual onsets mix SFX + music hits (G6)."""
    return len(onsets) / (duration_s / 60.0) if duration_s else 0.0


def breath_around_events(events, regions):
    """For each event {at_s,dur_s,loud_db,centroid_hz}, add `gap` = length of the speech-silence span
    the event falls in (0.0 if the event is mid-speech). Pure. The measured VO pause an event coincides
    with — captures 'sustained event -> long pause; percussive -> none' WITHOUT naming the SFX (G6)."""
    gaps = [(regions[i][1], regions[i + 1][0]) for i in range(len(regions) - 1)]
    out = []
    for e in events:
        at = e["at_s"]; g = 0.0
        for gs, ge in gaps:
            if gs <= at <= ge:
                g = round(ge - gs, 6); break
        out.append({**e, "gap": g})
    return out


def bucket_by_acoustics(events_with_gaps):
    """Bucket events by MEASURABLE acoustics (never SFX-ID) and describe the VO pause around them.
    sustained_loud = long+low (dramatic-sting-like) · short_percussive = brief (impact-like) · mid = rest.

    Reports, per bucket: n (all events) · n_with_pause (events that land in a VO silence, gap>0) ·
    pause_rate (fraction that get their own silence) · median_pause_when_paused (how big that silence is).
    Reporting the median over ALL events washes to ~0 (most events ride under continuous speech, gap=0);
    the split answers the real question — 'which events get their own silence, and how much'. Pure."""
    from statistics import median

    def which(e):
        if e["dur_s"] >= 0.8 and e["centroid_hz"] < 1500:
            return "sustained_loud"
        if e["dur_s"] < 0.3:
            return "short_percussive"
        return "mid"
    buckets = {}
    for e in events_with_gaps:
        buckets.setdefault(which(e), []).append(e["gap"])
    out = {}
    for k, gaps in buckets.items():
        paused = [g for g in gaps if g > 0]
        out[k] = {"n": len(gaps), "n_with_pause": len(paused),
                  "pause_rate": round(len(paused) / len(gaps), 3) if gaps else 0.0,
                  "median_pause_when_paused": round(median(paused), 3) if paused else 0.0}
    return out


def music_presence(residual_rms, floor_db=-45):
    """Fraction of frames with music (residual) energy above floor (pure). Settles bed-vs-cue empirically."""
    if not residual_rms:
        return 0.0
    return round(sum(1 for v in residual_rms if v >= floor_db) / len(residual_rms), 6)


def music_dips(residual_rms, hop_s, drop_db=10, min_s=0.3):
    """Spans [start,end,depth_db] where the residual drops >= drop_db below its median for >= min_s
    (music tacet / dropout — 'silence as a scalpel'). Pure."""
    from statistics import median
    if not residual_rms:
        return []
    med = median(residual_rms)
    thr = med - drop_db
    dips, i, n = [], 0, len(residual_rms)
    while i < n:
        if residual_rms[i] < thr:
            j = i
            while j < n and residual_rms[j] < thr:
                j += 1
            if (j - i) * hop_s >= min_s:
                dips.append([round(i * hop_s, 6), round(j * hop_s, 6), round(med - min(residual_rms[i:j]), 6)])
            i = j
        else:
            i += 1
    return dips


def ducking_depth(residual_rms, regions, hop_s=0.1):
    """Median residual level in VO gaps minus under speech (pure). Positive = music ducks under the VO."""
    from statistics import median
    speech, gap = [], []
    for i, v in enumerate(residual_rms):
        t = i * hop_s
        (speech if any(s <= t < e for s, e in regions) else gap).append(v)
    if not speech or not gap:
        return 0.0
    return round(median(gap) - median(speech), 6)

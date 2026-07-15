#!/usr/bin/env python3
"""breath.py — render-time silence gaps for AUTHORED `pause` cues.

A pause gap is a deliberate silence the render inserts before an authored cue's anchor word (from
`audio_cues.cue_pause_gaps`), so a reveal/punch lands with a real beat of silence + a bed dip. SEPARATE
from the writer's `[PAUSE]`/`[BEAT]` prosody (baked in the VO); voiceover.py is never touched.
(Automatic structural breaths were retired 2026-07-12 — pauses are now authored `pause` cues.)

Flow (called by build_motion.build_piece_spec):
  1. shift_timings(word_timings, gaps) -> word-timings pushed later past each gap (ONE offset point;
     everything downstream reads the shifted list).
  2. splice_silence(vo.mp3, gaps, vo.breath.mp3) -> a DERIVED gapped audio (original untouched).

Deterministic + idempotent: always derived from the ORIGINAL vo.mp3 + original word-timings.
"""
import subprocess
import sys
from pathlib import Path


def shift_timings(word_timings, gaps):
    """Push every word at/after a gap later by that gap's dur_s (cumulative over gaps). The word
    AT a gap's at_s (the breath-beat's first word) shifts — the silence is inserted before it."""
    if not gaps:
        return word_timings
    return [[w, round(float(t) + sum(g["dur_s"] for g in gaps if g["at_s"] <= float(t)), 3)]
            for w, t in word_timings]


def splice_silence(vo_path: Path, gaps, out_path: Path) -> bool:
    """Write a COPY of vo_path with dur_s of silence inserted at each gap's at_s (original time).
    Idempotent: always reads the original vo_path. Returns True on success; on ffmpeg absence/
    failure, warns and returns False (the breath is additive — the caller falls back to vo_path).
    No gaps -> a plain copy (True)."""
    vo_path, out_path = Path(vo_path), Path(out_path)
    if not vo_path.exists():
        return False
    # Split the source at each gap boundary and concat [seg][silence][seg]... in order.
    cuts = sorted({0.0, *(g["at_s"] for g in gaps)})
    filt, labels = [], []
    for i, start in enumerate(cuts):
        end = cuts[i + 1] if i + 1 < len(cuts) else None
        trim = f"atrim=start={start}" + (f":end={end}" if end is not None else "")
        filt.append(f"[0:a]{trim},asetpts=PTS-STARTPTS[a{i}]")
        labels.append(f"[a{i}]")
        # a silence block follows every cut point that is a gap start (i.e. every start>0 that's a gap)
        g = next((g for g in gaps if abs(g["at_s"] - start) < 1e-6 and start > 0), None)
        if g:
            filt.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={g['dur_s']},asetpts=PTS-STARTPTS[s{i}]")
            labels.insert(len(labels) - 1, f"[s{i}]")   # silence goes BEFORE this segment
    # gap at at_s==0 (leading breath) — rare; a silence block before seg 0
    lead = next((g for g in gaps if abs(g["at_s"]) < 1e-6), None)
    if lead:
        filt.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={lead['dur_s']},asetpts=PTS-STARTPTS[lead]")
        labels.insert(0, "[lead]")
    filt.append("".join(labels) + f"concat=n={len(labels)}:v=0:a=1[out]")
    cmd = ["ffmpeg", "-y", "-i", str(vo_path), "-filter_complex", ";".join(filt),
           "-map", "[out]", "-ar", "48000", "-c:a", "libmp3lame", "-q:a", "2", str(out_path)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        sys.stderr.write("  ! ffmpeg not found — skipping breath splice (rendering un-gapped VO)\n")
        return False
    if proc.returncode != 0 or not out_path.exists():
        sys.stderr.write(f"  ! breath splice failed (ffmpeg exit {proc.returncode}) — un-gapped VO\n")
        return False
    return True

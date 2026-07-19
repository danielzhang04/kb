#!/usr/bin/env python3
"""Objective SFX vetting. probe() = thin ffmpeg/ffprobe wrapper; vet_features() = pure decision (T2).
Vetting is MECHANICAL (duration/clip/loudness/silence) — it is NOT taste (T4). quality is a CLAP
tiebreaker only, never a substitute for the human pick."""
import json, re, subprocess
from pathlib import Path


def _run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def probe(path) -> dict:
    path = str(path)
    pj = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path]).stdout
    dur = float(json.loads(pj)["format"]["duration"]) if pj else 0.0
    st = _run(["ffmpeg", "-hide_banner", "-i", path, "-af", "astats=metadata=1:reset=0", "-f", "null", "-"]).stderr
    peak = max([float(x) for x in re.findall(r"Peak level dB:\s*(-?\d+\.?\d*)", st)] or [-99.0])
    rms = max([float(x) for x in re.findall(r"RMS level dB:\s*(-?\d+\.?\d*)", st)] or [-99.0])
    sil = _run(["ffmpeg", "-hide_banner", "-i", path, "-af", "silencedetect=noise=-40dB:d=0.05", "-f", "null", "-"]).stderr
    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?\d+\.?\d*)", sil)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*(-?\d+\.?\d*)", sil)]
    lead_s = ends[0] if (starts and abs(starts[0]) < 1e-6 and ends) else 0.0
    return {"duration": dur, "peak_db": peak, "rms_db": rms,
            "lead_silence_s": lead_s, "trail_silence_s": 0.0}


def vet_features(feats: dict, dur_lo: float, dur_hi: float) -> dict:
    reasons = []
    d, peak, rms, lead = feats["duration"], feats["peak_db"], feats["rms_db"], feats["lead_silence_s"]
    if not (dur_lo <= d <= dur_hi): reasons.append(f"duration {d:.2f}s out of [{dur_lo},{dur_hi}]")
    if peak > -0.1: reasons.append(f"clip risk (peak {peak:.1f}dB)")
    if rms < -45: reasons.append(f"near-silent (rms {rms:.1f}dB)")
    if lead > 0.3: reasons.append(f"long lead silence {lead:.2f}s")
    loud = max(0.0, min(1.0, (rms + 45) / 45))
    tight = max(0.0, 1.0 - lead / 0.3)
    quality = round(0.6 * loud + 0.4 * tight, 3) if not reasons else 0.0
    return {"ok": not reasons, "reasons": reasons, "quality": quality}

#!/usr/bin/env python3
"""Objective MUSIC vetting for music-forge. vet_music() is a PURE, MINIMAL sanity gate: these tracks come
from a CURATED pro library (Incompetech), not user uploads, so we reject only genuinely-unusable files —
NOT 'not a seamless loop'. Real songs have intros/endings and decay to silence at the tail; the Phase-3B
realizer crossfades/loops them, so seamless-loopability is NOT a requirement. (The original loop-ability +
clip hard-rejects wrongly killed ~all real music on the first live run — removed 2026-07-11.) CLAP + the
human ear do the ranking/picking; this gate only drops the broken. Mechanical, never taste (G6)."""


def vet_music(base: dict, dur_lo: float, dur_hi: float) -> dict:
    """Reject a track only if its duration is out of band or it is near-silent (broken/empty). quality is a
    mild loudness score for tie-breaking; the real ranking is CLAP + the human ear. `base` = vet.probe()
    output (needs `duration` + `rms_db`)."""
    reasons = []
    d, rms = base["duration"], base["rms_db"]
    if not (dur_lo <= d <= dur_hi):
        reasons.append(f"duration {d:.1f}s out of [{dur_lo},{dur_hi}]")
    if rms < -45:
        reasons.append(f"near-silent (rms {rms:.1f}dB)")
    quality = round(max(0.0, min(1.0, (rms + 45) / 45)), 3) if not reasons else 0.0
    return {"ok": not reasons, "reasons": reasons, "quality": quality}

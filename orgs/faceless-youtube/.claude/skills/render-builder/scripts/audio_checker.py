#!/usr/bin/env python3
"""Phase 4 — deterministic post-render audio checker. Verifies a render's audio against the
audioSpec + the loudnorm measurement; returns warn-not-fail findings for the render manifest.
NO model listening (tools produce the numbers — the audio-analyzer doctrine); FEEL stays the human
ear-gate. Lean scope (spec 2026-07-12-phase3b §9 + the owner-approved cuts): missing-files,
LUFS/TP-vs-target, music-lane sanity."""


def _overlaps(a0, a1, b0, b1):
    return a0 < b1 and b0 < a1


def check_audio(audio_spec, shots, loudnorm, master_target, lufs_tol=1.0, tp_tol=0.3):
    """Deterministic (G2). Returns {ok, warnings, measured}. A warning never fails the render (G3)."""
    a = audio_spec or {}
    shots = shots or []
    ln = loudnorm or {}
    mt = master_target or {}
    warnings = []

    # 1. Missing files — a silently-dropped sound/mood (the #1 guard).
    sfx_missing = int(a.get("sfx_missing", 0) or 0)
    music_missing = int(a.get("music_missing", 0) or 0)
    if sfx_missing:
        warnings.append(f"sfx_missing={sfx_missing} — SFX role(s) had no sourced file (run sfx-forge)")
    if music_missing:
        warnings.append(f"music_missing={music_missing} — mood(s) had no sourced track (run music-forge)")

    # 2. Loudness / true-peak vs master_target (loudnorm can soft-fail -> empty dict).
    lufs = ln.get("audio_lufs")
    tp = ln.get("audio_true_peak")
    if lufs is None or tp is None:
        warnings.append("loudnorm did not run / soft-failed — master loudness unverified")
    else:
        tgt_lufs = mt.get("lufs")
        tgt_tp = mt.get("true_peak_max_dbfs")
        if tgt_lufs is not None and abs(float(lufs) - float(tgt_lufs)) > lufs_tol:
            warnings.append(f"LUFS {lufs} off target {tgt_lufs} (tol {lufs_tol})")
        if tgt_tp is not None and float(tp) > float(tgt_tp) + tp_tol:
            warnings.append(f"true-peak {tp} over target {tgt_tp} (tol {tp_tol})")

    # 3. Music-lane sanity: base_db in a sane band. (Human-cost music pull-back is now an AUTHORED `dry`
    #    span, not an auto-derived gravity span — so no gravity/thin-span check anymore, 2026-07-12.)
    for m in a.get("music_states") or []:
        base_db = float(m.get("base_db", 0.0))
        if not (0.0 <= base_db <= 25.0):
            warnings.append(f"music base_db {base_db} out of the sane 0–25 dB band")

    measured = {"lufs": lufs, "true_peak": tp,
                "music_segments": len(a.get("music_states") or []),
                "sfx_count": len(a.get("events") or []),
                "sfx_missing": sfx_missing, "music_missing": music_missing}
    return {"ok": not warnings, "warnings": warnings, "measured": measured}

#!/usr/bin/env python3
"""Phase 4 — deterministic post-render audio checker. Verifies a render's audio against the
audioSpec + the loudnorm measurement; returns warn-not-fail findings for the render manifest.
NO model listening (tools produce the numbers — the audio-analyzer doctrine); FEEL stays the human
ear-gate. Lean scope (spec 2026-07-12-phase3b §9 + the owner-approved cuts): missing-files,
LUFS/TP-vs-target, music-lane sanity, splice-continuity (R10)."""
import math
import subprocess
from pathlib import Path


def _overlaps(a0, a1, b0, b1):
    return a0 < b1 and b0 < a1


def _decode_pcm_mono(vo_path, sr=16000):
    """Mono PCM of vo_path (numpy float array, else array('h') int16), or None on ffmpeg absence."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(vo_path), "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"]
    try:
        raw = subprocess.run(cmd, capture_output=True).stdout
    except FileNotFoundError:
        return None
    if not raw:
        return None
    try:
        import numpy as np
        return np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    except Exception:
        import array
        a = array.array("h")
        a.frombytes(raw[: (len(raw) // 2) * 2])
        return a


def _rms_db(samples, a, b):
    a = max(0, a)
    b = min(len(samples), b)
    if b <= a:
        return -120.0
    try:
        import numpy as np
        if hasattr(samples, "dtype"):
            seg = samples[a:b]
            r = float(np.sqrt(np.mean(seg * seg)))
            return 20.0 * math.log10(r) if r > 1e-6 else -120.0
    except Exception:
        pass
    s = samples[a:b]
    r = (sum((x / 32768.0) ** 2 for x in s) / len(s)) ** 0.5
    return 20.0 * math.log10(r) if r > 1e-6 else -120.0


def check_splice_continuity(vo_path, breath_gaps, warn_db=-35.0, fail_db=-30.0,
                            sr=16000, pre_ms=40):
    """R10 splice-continuity gate: for every breath gap, measure the RAW-VO RMS in the `pre_ms` before the
    CHOSEN cut point (`cut_s` if the valley-cut set it, else `at_s`). Post-valley-cut this must be
    silent-clean; a voiced tail there means the splice truncated a word (the "spo-t" defect). WARN above
    `warn_db`, FAIL above `fail_db`. Returns {ok, warnings, worst, measured} in the checker's string
    style. `ok` is False on any WARN/FAIL. Skips cleanly (ok=True) with no vo/gaps/PCM."""
    gaps = breath_gaps or []
    if not vo_path or not gaps:
        return {"ok": True, "warnings": [], "worst": None, "measured": {"gaps": len(gaps)}}
    vp = Path(vo_path)
    if not vp.exists():
        return {"ok": True, "warnings": [], "worst": None, "measured": {"gaps": len(gaps), "vo": "missing"}}
    samples = _decode_pcm_mono(vp, sr)
    if samples is None:
        return {"ok": True, "warnings": ["splice-continuity: could not decode VO (ffmpeg?) — unchecked"],
                "worst": None, "measured": {"gaps": len(gaps)}}
    if any("cut_s" not in g for g in gaps):
        # Callers (e.g. build_motion's spec["breathGaps"]) hold the PRE-splice gap dicts; the valley
        # cut_s lives only on splice_silence's internal copy (resolve_cut_points returns a copy).
        # Measuring at the nominal at_s reproduces the pre-R10 defect numbers on clean audio — a
        # false alarm. Resolve the same valleys here so the gate measures the REAL cut positions.
        try:
            from breath import resolve_cut_points
            gaps = resolve_cut_points(vp, gaps)
        except Exception as e:
            warnings_pre = [f"splice-continuity: valley resolve failed ({e}) — measuring at nominal at_s"]
        else:
            warnings_pre = []
    else:
        warnings_pre = []
    warnings, rows = list(warnings_pre), []
    for g in gaps:
        cut = float(g.get("cut_s", g.get("at_s")))
        b = int(round(cut * sr))
        a = int(round((cut - pre_ms / 1000.0) * sr))
        db = _rms_db(samples, a, b)
        rows.append((db, cut, g.get("source", "?")))
    rows.sort(reverse=True)
    n_fail = sum(1 for db, _, _ in rows if db > fail_db)
    n_warn = sum(1 for db, _, _ in rows if warn_db < db <= fail_db)
    for db, cut, src in rows:
        if db > fail_db:
            warnings.append(f"SPLICE-CONTINUITY FAIL: raw-VO {db:.1f} dBFS in the {pre_ms}ms before the "
                            f"cut @ {cut:.3f}s ({src}) — voiced tail truncated (> {fail_db:.0f})")
        elif db > warn_db:
            warnings.append(f"splice-continuity WARN: raw-VO {db:.1f} dBFS before the cut @ {cut:.3f}s "
                            f"({src}) — near truncation (> {warn_db:.0f})")
    worst = {"pre_cut_dbfs": round(rows[0][0], 1), "at_s": rows[0][1], "source": rows[0][2]} if rows else None
    return {"ok": not warnings, "warnings": warnings, "worst": worst,
            "measured": {"gaps": len(gaps), "fail": n_fail, "warn": n_warn}}


def check_audio(audio_spec, shots, loudnorm, master_target, lufs_tol=1.0, tp_tol=0.3,
                vo_path=None, breath_gaps=None):
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

    # 4. Splice-continuity (R10): raw-VO tail energy just before each valley cut must be silent-clean.
    #    Wired via optional vo_path + breath_gaps (build_motion passes assets/vo.mp3 + the merged gaps);
    #    absent -> skipped (unchanged behaviour for callers that don't supply them).
    continuity = check_splice_continuity(vo_path, breath_gaps) if (vo_path and breath_gaps) else None
    if continuity is not None:
        warnings.extend(continuity["warnings"])

    measured = {"lufs": lufs, "true_peak": tp,
                "music_segments": len(a.get("music_states") or []),
                "sfx_count": len(a.get("events") or []),
                "sfx_missing": sfx_missing, "music_missing": music_missing}
    if continuity is not None:
        measured["splice_continuity"] = continuity["measured"]
        measured["splice_continuity_worst"] = continuity["worst"]
    return {"ok": not warnings, "warnings": warnings, "measured": measured}

#!/usr/bin/env python3
"""Thin I/O wrappers around ffmpeg/librosa (audio in -> numbers out). Exercised only in the smoke /
precompute path, never in the unit suite (G4). The pure logic that consumes these lives in measures.py."""
import subprocess
import measures


def ebur128(path) -> dict:
    """Integrated LUFS / LRA / true-peak for an audio file (ffmpeg ebur128 -> measures.parse_ebur128).
    `peak=true` is required or ffmpeg never computes the true-peak line (else it parses as None)."""
    p = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "ebur128=peak=true",
                        "-f", "null", "-"], capture_output=True, text=True)
    return measures.parse_ebur128(p.stderr)


def stem_rms(path, hop_s=0.1):
    """Per-hop RMS (dBFS) frames for an audio file — the input to speech_regions / music_presence."""
    import librosa, numpy as np
    y, sr = librosa.load(str(path), sr=None, mono=True)
    hop = max(1, int(sr * hop_s))
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0]
    return (20.0 * np.log10(np.maximum(rms, 1e-8))).tolist(), hop_s


def onsets(path):
    """Onset times (seconds) on an audio file (librosa) + its duration — input to onset_density."""
    import librosa
    y, sr = librosa.load(str(path), sr=None, mono=True)
    ons = librosa.onset.onset_detect(y=y, sr=sr, units="time").tolist()
    return ons, librosa.get_duration(y=y, sr=sr)


def onset_events(path, win_max_s=2.0):
    """Onset times WITH per-onset acoustics -> [{at_s, dur_s, loud_db, centroid_hz}] + duration.

    Feeds measures.breath_around_events / bucket_by_acoustics (which need dur+centroid to tell a
    sustained dramatic hit from a short percussive one WITHOUT naming the SFX). Directional (residual
    mixes SFX + music), but the features themselves are measured. For each onset: window from the
    onset to the next onset (capped at win_max_s); loud_db = window peak RMS; centroid_hz = RMS-weighted
    mean spectral centroid; dur_s = time until RMS decays 12 dB below the window peak (a percussive hit
    decays fast -> small dur; a sustained sting stays up -> large dur)."""
    import librosa, numpy as np
    y, sr = librosa.load(str(path), sr=None, mono=True)
    dur_total = float(librosa.get_duration(y=y, sr=sr))
    hop = 512
    # Prominence filter: raw onset detection on a music-dense residual fires on every note (saturates
    # the density band). Keep only onsets whose strength is in the top quartile of detected onsets — the
    # transients that actually punch through. Still [directional] (SFX+music tangled), just not saturated.
    oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onf = librosa.onset.onset_detect(onset_envelope=oenv, sr=sr, hop_length=hop, backtrack=False)
    if len(onf):
        strengths = oenv[onf]
        onf = onf[strengths >= np.percentile(strengths, 75)]
    ons = librosa.frames_to_time(onf, sr=sr, hop_length=hop)
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    cent = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    events = []
    for k, t in enumerate(ons):
        nxt = ons[k + 1] if k + 1 < len(ons) else dur_total
        end = min(nxt, t + win_max_s)
        mask = (times >= t) & (times < max(end, t + 0.05))
        if not mask.any():
            continue
        seg_rms, seg_cent, seg_t = rms[mask], cent[mask], times[mask]
        peak = float(seg_rms.max())
        loud_db = 20.0 * np.log10(max(peak, 1e-8))
        centroid_hz = float(np.average(seg_cent, weights=seg_rms + 1e-8))
        thr = peak / 4.0                                   # -12 dB from the onset peak
        below = np.where(seg_rms < thr)[0]
        dur_s = float(seg_t[below[0]] - t) if len(below) else float(seg_t[-1] - t)
        dur_s = max(0.02, min(dur_s, win_max_s))
        events.append({"at_s": round(float(t), 3), "dur_s": round(dur_s, 3),
                       "loud_db": round(float(loud_db), 2), "centroid_hz": round(centroid_hz, 1)})
    return events, dur_total

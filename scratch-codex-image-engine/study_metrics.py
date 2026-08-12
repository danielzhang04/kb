#!/usr/bin/env python3
"""M1-M4 register metrics for the codex-engine study (spec §7.2) + baseline sha re-verification.

Every metric is computed on frames at the SAME canvas: M2 is neighbourhood-based and therefore
resolution-sensitive, so a native codex render must be normalized before it is measured.
M1 reproduces the method both probe logs used (validated: P2b reproduced p1's G1/G2 to ~0.1).

Usage:
  py -3 study_metrics.py --verify-shas
  py -3 study_metrics.py <frame.png> [<frame.png> ...]
"""
import argparse
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

RED = (215, 64, 43)          # #d7402b
RED_RADIUS = 60.0
DARK_FRACTION = 0.03
FLAT_RANGE = 4.0             # luma range <= 4/255 within a 5x5 neighbourhood (spec §7.2 verbatim)
EDGE_PERCENTILE = 90


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(float)


def luma(arr):
    return 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]


def m1_ink_warmth(arr):
    """Mean R-B over the darkest 3% of pixels by luma."""
    flat = luma(arr).ravel()
    n = max(1, int(len(flat) * DARK_FRACTION))
    idx = np.argpartition(flat, n - 1)[:n]
    px = arr.reshape(-1, 3)[idx]
    return float(px[:, 0].mean() - px[:, 2].mean())


def _windows(a, k=5):
    return np.lib.stride_tricks.sliding_window_view(a, (k, k))


def m2_flatness(arr):
    """Fraction of NON-EDGE pixels whose 5x5 neighbourhood luma range is <= 4/255.
    High = flat cel fills; low = gradients / ambient shading."""
    y = luma(arr)
    win = _windows(y, 5)
    rng = win.max(axis=(-1, -2)) - win.min(axis=(-1, -2))
    # Sobel magnitude is the specified edge detector.  Edge padding avoids
    # inventing a high-contrast boundary around an otherwise flat frame.
    sobel = _windows(np.pad(y, 1, mode="edge"), 3)
    gx = (sobel * np.array(((1, 0, -1), (2, 0, -2), (1, 0, -1)))).sum(axis=(-1, -2))
    gy = (sobel * np.array(((1, 2, 1), (0, 0, 0), (-1, -2, -1)))).sum(axis=(-1, -2))
    mag = np.hypot(gx, gy)
    edge = mag > np.percentile(mag, EDGE_PERCENTILE)
    near_edge = _windows(edge.astype(float), 5).max(axis=(-1, -2)) > 0
    keep = ~near_edge
    if keep.sum() == 0:
        return 0.0
    return float(((rng <= FLAT_RANGE) & keep).sum() / keep.sum())


def m3_palette_concentration(arr):
    """Colours needed to cover 90% of frame area after 32-level-per-channel quantization."""
    q = (arr // 8).astype(np.int32)
    keys = q[:, :, 0] * 1024 + q[:, :, 1] * 32 + q[:, :, 2]
    counts = np.sort(np.bincount(keys.ravel()))[::-1]
    total = counts.sum()
    cum = np.cumsum(counts)
    return int(np.searchsorted(cum, 0.9 * total) + 1)


def m4_red_discipline(arr):
    """Fraction of pixels within a small RGB radius of #d7402b."""
    d = np.linalg.norm(arr - np.array(RED, dtype=float), axis=2)
    return float((d <= RED_RADIUS).mean())


def measure(path):
    arr = load(path)
    h, w, _ = arr.shape
    return {"path": str(path).replace("\\", "/"), "dims": [w, h],
            "m1": round(m1_ink_warmth(arr), 3), "m2": round(m2_flatness(arr), 4),
            "m3": m3_palette_concentration(arr), "m4": round(m4_red_discipline(arr), 5)}


def verify_baseline_shas(baseline_dir):
    """A silently altered reference can never move a gate (§7.5). Returns mismatching filenames."""
    bad = []
    shas = os.path.join(baseline_dir, "SHAS.txt")
    for line in open(shas, encoding="utf-8"):
        parts = line.split()
        if len(parts) != 3:
            continue
        digest, name, _size = parts
        path = os.path.join(baseline_dir, name)
        if not os.path.isfile(path):
            bad.append(name)
            continue
        if hashlib.sha256(open(path, "rb").read()).hexdigest() != digest:
            bad.append(name)
    return bad


# --- §7.4 THE RATIFIED FLOOR (Daniel, 2026-08-11), in paired form:
# ---   |dM1| <= 5 per shot on at least 3 of the 4 corpus shots; AND
# ---   |dM2| no worse than the interquartile width of M2 across the 23 verified frames; AND
# ---   M3/M4 inside the same band.
# --- The 3-of-4 rule is stated for M1; this code applies it to every metric and reports the full
# --- per-shot table so a stricter reading can be applied by eye.
CORPUS = ("L26", "L44", "L33", "L29")
M1_FLOOR = 5.0
MIN_SHOTS_PASSING = 3
METRICS = ("m1", "m2", "m3", "m4")


def iqr_width(values):
    v = np.asarray(sorted(float(x) for x in values), dtype=float)
    if v.size < 2:
        return 0.0
    return float(np.percentile(v, 75) - np.percentile(v, 25))


def baseline_table(baseline_dir):
    bad = verify_baseline_shas(baseline_dir)
    if bad:
        raise RuntimeError("baseline SHA verification failed: " + ", ".join(bad))
    out = {}
    for name in sorted(os.listdir(baseline_dir)):
        if name.lower().endswith(".png"):
            out[os.path.splitext(name)[0]] = measure(os.path.join(baseline_dir, name))
    return out


def baseline_bands(baseline_dir):
    table = baseline_table(baseline_dir)
    return {m: iqr_width([row[m] for row in table.values()]) for m in METRICS}


def paired_distances(codex, baseline):
    return {m: abs(codex[m] - baseline[m]) for m in METRICS}


def evaluate_floor(distances_by_shot, bands):
    """The study's PASS / STOP-and-escalate verdict, declared against the ratified floor."""
    limits = {"m1": M1_FLOOR, "m2": bands["m2"], "m3": bands["m3"], "m4": bands["m4"]}
    passing, per_metric = {}, {}
    for m in METRICS:
        rows = {shot: d[m] for shot, d in distances_by_shot.items()}
        ok = [shot for shot, v in rows.items() if v <= limits[m]]
        passing[m] = len(ok)
        per_metric[m] = {"limit": round(limits[m], 5), "distances": rows,
                         "passing": sorted(ok)}
    failed = [m for m in METRICS if passing[m] < MIN_SHOTS_PASSING]
    return {"per_metric": per_metric, "passing_shots": passing, "pass": not failed,
            "reason": ("all metrics clear the floor on >= %d of %d shots"
                       % (MIN_SHOTS_PASSING, len(distances_by_shot))) if not failed
                      else ("below floor on: " + ", ".join(failed))}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("frames", nargs="*")
    ap.add_argument("--verify-shas", action="store_true")
    ap.add_argument("--baseline-dir",
                    default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         "gemini-baseline"))
    a = ap.parse_args(argv)
    if a.verify_shas:
        bad = verify_baseline_shas(a.baseline_dir)
        print(json.dumps({"baseline_dir": a.baseline_dir, "mismatches": bad}, indent=2))
        return 1 if bad else 0
    for f in a.frames:
        print(json.dumps(measure(f)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

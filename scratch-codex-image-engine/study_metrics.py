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
    gx = np.zeros_like(y); gy = np.zeros_like(y)
    gx[:, 1:-1] = y[:, 2:] - y[:, :-2]
    gy[1:-1, :] = y[2:, :] - y[:-2, :]
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

"""Reusable measurement script for P2b probes -- mirrors P1's Probe G methodology.
Usage: py -3 measure.py <path-to-png> [<path-to-png> ...]
Prints dims, darkest-3%-by-luma mean RGB, R-B (target +18 per style-bible #241a12).
"""
import sys
import numpy as np
from PIL import Image

TARGET_RB = 18

def measure(path):
    im = Image.open(path).convert("RGB")
    arr = np.asarray(im).astype(np.float64)
    h, w, _ = arr.shape
    luma = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    flat = luma.flatten()
    n = max(1, int(len(flat) * 0.03))
    idx = np.argsort(flat)[:n]
    pixels = arr.reshape(-1, 3)[idx]
    mean_rgb = pixels.mean(axis=0)
    r_b = mean_rgb[0] - mean_rgb[2]
    print(f"{path}: dims={w}x{h} darkest3pct_RGB=({mean_rgb[0]:.1f},{mean_rgb[1]:.1f},{mean_rgb[2]:.1f}) R-B={r_b:+.1f} (target {TARGET_RB:+d})")
    return r_b

if __name__ == "__main__":
    for p in sys.argv[1:]:
        measure(p)

"""Measure a frame's INK register: darkest-3% mean hue + mean R-B, plus median HSV saturation.

Matches the methodology the fresh-eyes verifier used on the phase-6b batch, so the numbers are
directly comparable to its recorded baselines:
  L16 (parked)  hue 172.2 deg, R-B -1.4   <- the sole cool/cyan inversion in the batch
  batch range   hue 6-34 deg,  R-B +3.4 .. +31.3
  L03 plate     R-B +3.8      L05 plate  R-B +24.3
  target ink    #241a12 = warm brown-black (hue ~19 deg, R-B +18)

Hue is averaged as a CIRCULAR mean (via unit vectors) — a plain arithmetic mean is wrong near the
0/360 wrap and would quietly mis-report warm reds.
"""
import os
import sys

import numpy as np
from PIL import Image

TARGET = "#241a12"


def ink_stats(path, pct=3.0):
    im = Image.open(path)
    im.load()
    rgb = np.asarray(im.convert("RGB"), dtype=np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    thr = np.percentile(lum, pct)
    m = lum <= thr                                   # the darkest pct% of pixels == the ink
    hsv = np.asarray(im.convert("RGB").convert("HSV"), dtype=np.float32)
    hue_deg = hsv[:, :, 0][m] * 360.0 / 255.0
    ang = np.deg2rad(hue_deg)
    mean_hue = float(np.rad2deg(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360.0)
    return dict(
        hue=mean_hue,
        rb=float((r[m] - b[m]).mean()),
        ink_lum=float(lum[m].mean()),
        coverage=float(m.mean() * 100.0),
        median_sat=float(np.median(hsv[:, :, 1] / 255.0)),
        size=im.size,
    )


if __name__ == "__main__":
    for p in sys.argv[1:]:
        if not os.path.exists(p):
            print("%s\tMISSING" % os.path.basename(p))
            continue
        s = ink_stats(p)
        warm = "WARM" if s["rb"] > 0 else "COOL/INVERTED"
        print("%-22s %dx%d  ink_hue=%6.1fdeg  R-B=%+6.1f  ink_lum=%5.1f  cov=%4.1f%%  "
              "median_sat=%.4f  -> %s"
              % (os.path.basename(p), s["size"][0], s["size"][1], s["hue"], s["rb"],
                 s["ink_lum"], s["coverage"], s["median_sat"], warm))

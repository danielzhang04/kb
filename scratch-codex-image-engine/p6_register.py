#!/usr/bin/env python3
"""Measure the P6 matched-register data from accepted baseline PNGs.

This module is deliberately independent of the generation engine: all measurements are
deterministic local pixel operations and the JSON it writes contains numbers only.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

import study_metrics as sm


TARGET_SHOTS = ("L26", "L28", "L29", "L33", "L36", "L40", "L44", "L46")
STYLE_SHOT = "L47"
PALETTE_SIZE = 4
PALETTE_CLUSTERS = PALETTE_SIZE + 1  # one deterministic median-cut cluster is the ink cluster


def _hex(rgb):
    return "#" + "".join(f"{int(round(float(channel))):02x}" for channel in rgb)


def ink_rgb(arr):
    """Mean RGB of exactly the same darkest-3%-luma selection as M1."""
    flat_luma = sm.luma(arr).ravel()
    count = max(1, int(len(flat_luma) * sm.DARK_FRACTION))
    index = np.argpartition(flat_luma, count - 1)[:count]
    return arr.reshape(-1, 3)[index].mean(axis=0)


def dominant_palette(arr, *, clusters=PALETTE_CLUSTERS):
    """Return up to four median-cut palette entries after excluding the ink cluster.

    Pillow's median-cut path is deterministic.  Selecting the quantized colour nearest
    to the independently measured darkest-pixel mean makes the excluded cluster explicit
    rather than relying on a hard-coded warm-brown range.
    """
    image = Image.fromarray(np.asarray(arr, dtype=np.uint8), "RGB")
    quantized = image.quantize(colors=min(clusters, 256), method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette()
    counts = quantized.getcolors() or []
    total = image.width * image.height
    entries = []
    for count, index in counts:
        offset = index * 3
        rgb = tuple(palette[offset:offset + 3])
        entries.append({"rgb": rgb, "count": int(count)})
    if not entries:
        return []
    measured_ink = ink_rgb(arr)
    ink_index = min(range(len(entries)), key=lambda i: (
        float(np.linalg.norm(np.asarray(entries[i]["rgb"], dtype=float) - measured_ink)),
        entries[i]["rgb"],
    ))
    kept = [entry for i, entry in enumerate(entries) if i != ink_index]
    kept.sort(key=lambda entry: (-entry["count"], entry["rgb"]))
    return [{"hex": _hex(entry["rgb"]), "coverage": round(entry["count"] / total, 6)}
            for entry in kept[:PALETTE_SIZE]]


def measure_register(path):
    """Return the committable P6 register for one accepted baseline frame."""
    arr = sm.load(path)
    return {
        "ink_hex": _hex(ink_rgb(arr)),
        "palette": dominant_palette(arr),
        "red_accent_present": sm.m4_red_discipline(arr) > 0.0005,
    }


def build_registers(baseline_dir):
    baseline_dir = Path(baseline_dir)
    wanted = TARGET_SHOTS + (STYLE_SHOT,)
    missing = [shot for shot in wanted if not (baseline_dir / f"{shot}.png").is_file()]
    if missing:
        raise RuntimeError("P6 baseline frames missing: " + ", ".join(missing))
    bad = sm.verify_baseline_shas(str(baseline_dir))
    if bad:
        raise RuntimeError("baseline SHA verification failed: " + ", ".join(bad))
    return {
        "schema": "faceless-youtube/codex-image-engine-p6-registers@1",
        "shots": {shot: measure_register(baseline_dir / f"{shot}.png") for shot in wanted},
    }


def write_registers(path, baseline_dir):
    data = build_registers(baseline_dir)
    Path(path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8",
                          newline="\n")
    return data


def main(argv=None):
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="measure P6 registers from verified baselines")
    parser.add_argument("--baseline-dir", type=Path, default=here / "gemini-baseline")
    parser.add_argument("--output", type=Path, default=here / "p6-registers.json")
    args = parser.parse_args(argv)
    write_registers(args.output, args.baseline_dir)
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""P8 register capture: P7 palette/anchors plus flat material fill modes."""
import argparse
import colorsys
import json
from pathlib import Path

import numpy as np

import p7_register as p7
import study_metrics as sm


HERE = Path(__file__).resolve().parent
BASELINE_DIR = HERE / "gemini-baseline"
OUTPUT_PATH = HERE / "p8-registers.json"
PALETTE_SIZE = p7.PALETTE_SIZE
QUANTUM = 8
# Kept local deliberately: P8 uses the same 4/255 flatness scale as M2 but does
# not alter the shared metric implementation.
FLAT_SOBEL_THRESHOLD = sm.FLAT_RANGE


def _hex(rgb):
    return p7._hex(rgb)


def _quantize(arr):
    """Quantize RGB to deterministic eight-step bucket values."""
    values = np.asarray(arr, dtype=np.uint8)
    return ((values // QUANTUM) * QUANTUM).astype(np.uint8)


def _sobel_magnitude(arr):
    luma = sm.luma(np.asarray(arr, dtype=float))
    windows = np.lib.stride_tricks.sliding_window_view(np.pad(luma, 1, mode="edge"), (3, 3))
    gx = (windows * np.array(((1, 0, -1), (2, 0, -2), (1, 0, -1)))).sum(axis=(-1, -2))
    gy = (windows * np.array(((1, 2, 1), (0, 0, 0), (-1, -2, -1)))).sum(axis=(-1, -2))
    return np.hypot(gx, gy)


def fill_modes(arr):
    """Top eight quantized colours among low-gradient (flat material) pixels."""
    values = np.asarray(arr, dtype=np.uint8)
    flat = _sobel_magnitude(values) < FLAT_SOBEL_THRESHOLD
    pixels = _quantize(values)[flat]
    if not len(pixels):
        return []
    packed = (pixels[:, 0].astype(np.uint32) << 16) | (pixels[:, 1].astype(np.uint32) << 8) | pixels[:, 2]
    keys, counts = np.unique(packed, return_counts=True)
    total = int(counts.sum())
    ordered = sorted(zip(keys.tolist(), counts.tolist()), key=lambda pair: (-pair[1], pair[0]))[:8]
    return [{"hex": _hex(((key >> 16) & 255, (key >> 8) & 255, key & 255)),
             "share": round(count / total, 6)} for key, count in ordered]


def _distance(left, right):
    return sum(abs(int(a) - int(b)) for a, b in zip(left, right))


def _merge(entries):
    """Merge selected palette clusters within the P8 sum-abs RGB threshold."""
    groups = []
    for entry in entries:
        rgb = tuple(entry["rgb"])
        group = next((item for item in groups if _distance(rgb, item["rgb"]) <= 12), None)
        if group is None:
            groups.append({"rgb": rgb, "count": entry["count"], "is_accent": entry["is_accent"]})
            continue
        total = group["count"] + entry["count"]
        group["rgb"] = tuple(round((group["rgb"][index] * group["count"] + rgb[index] * entry["count"]) / total)
                             for index in range(3))
        group["count"] = total
        group["is_accent"] = group["is_accent"] or entry["is_accent"]
    return groups


def dominant_palette(arr):
    """P7's palette policy, deduplicated before free base slots admit accents."""
    candidates, entries = p7.palette_candidates(arr)
    if not entries:
        return []
    ordered = sorted(candidates, key=lambda entry: (-entry["count"], entry["rgb"]))
    selected = _merge(ordered[:PALETTE_SIZE])
    # Near-duplicate creams may free a top-six slot. Fill those first from the
    # next accent clusters; then retain P7's all-material-accent guarantee.
    for entry in ordered[PALETTE_SIZE:]:
        if len(selected) >= PALETTE_SIZE:
            break
        if entry["is_accent"] and not any(_distance(entry["rgb"], group["rgb"]) <= 12 for group in selected):
            selected.extend(_merge([entry]))
    for entry in ordered:
        if entry["is_accent"] and not any(_distance(entry["rgb"], group["rgb"]) <= 12 for group in selected):
            selected.extend(_merge([entry]))
    total = sum(entry["count"] for entry in entries)
    return [{"hex": _hex(entry["rgb"]), "coverage": round(entry["count"] / total, 6),
             "is_accent": entry["is_accent"]}
            for entry in sorted(selected, key=lambda entry: (-entry["count"], entry["rgb"]))]


def measure_register(path):
    arr = sm.load(path)
    return {"ink_hex": _hex(p7.ink_rgb(arr)), "palette": dominant_palette(arr), "fill_modes": fill_modes(arr)}


def build_registers(baseline_dir):
    baseline_dir = Path(baseline_dir)
    frames = sorted(path.stem for path in baseline_dir.glob("L*.png"))
    if len(frames) != 23:
        raise RuntimeError(f"P8 requires all 23 accepted frames; found {len(frames)}")
    bad = sm.verify_baseline_shas(str(baseline_dir))
    if bad:
        raise RuntimeError("baseline SHA verification failed: " + ", ".join(bad))
    shots = {shot: measure_register(baseline_dir / f"{shot}.png") for shot in frames}
    anchors = {shot: p7.choose_anchor(shot, shots) for shot in p7.TARGET_SHOTS}
    return {"schema": "p8-registers/1", "shots": shots, "anchors": anchors}


def write_registers(path=OUTPUT_PATH, baseline_dir=BASELINE_DIR):
    data = build_registers(baseline_dir)
    Path(path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description="measure P8 material-fill registers from verified baselines")
    parser.add_argument("--baseline-dir", type=Path, default=BASELINE_DIR)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args(argv)
    write_registers(args.output, args.baseline_dir)
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

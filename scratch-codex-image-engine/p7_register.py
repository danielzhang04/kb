#!/usr/bin/env python3
"""P7 register capture: six dominant colours plus all material accents."""
import argparse
import colorsys
import json
from pathlib import Path

import numpy as np
from PIL import Image

import study_metrics as sm


HERE = Path(__file__).resolve().parent
BASELINE_DIR = HERE / "gemini-baseline"
OUTPUT_PATH = HERE / "p7-registers.json"
TARGET_SHOTS = ("L27", "L28", "L29", "L32", "L33", "L35", "L36", "L42", "L44", "L50")
PALETTE_SIZE = 6
QUANTIZE_CLUSTERS = 16
ACCENT_SATURATION = 0.25
ACCENT_COVERAGE = 0.003


def _hex(rgb):
    return "#" + "".join(f"{int(round(float(channel))):02x}" for channel in rgb)


def _rgb(hex_value):
    return tuple(int(hex_value[index:index + 2], 16) for index in (1, 3, 5))


def ink_rgb(arr):
    """Mean of the darkest three percent by the unchanged M1 luma selection."""
    flat_luma = sm.luma(arr).ravel()
    count = max(1, int(len(flat_luma) * sm.DARK_FRACTION))
    index = np.argpartition(flat_luma, count - 1)[:count]
    return arr.reshape(-1, 3)[index].mean(axis=0)


def _clusters(arr, *, clusters=QUANTIZE_CLUSTERS):
    """Deterministic median-cut clusters, including their centroid HSV saturation."""
    image = Image.fromarray(np.asarray(arr, dtype=np.uint8), "RGB")
    quantized = image.quantize(colors=min(clusters, 256), method=Image.Quantize.MEDIANCUT)
    palette, counts = quantized.getpalette(), quantized.getcolors() or []
    total = image.width * image.height
    entries = []
    for count, index in counts:
        offset = index * 3
        rgb = tuple(palette[offset:offset + 3])
        saturation = colorsys.rgb_to_hsv(*(channel / 255 for channel in rgb))[1]
        entries.append({"rgb": rgb, "count": int(count), "coverage": count / total,
                        "saturation": saturation})
    return entries


def dominant_palette(arr):
    """Return top-six clusters plus every saturated, material-coverage accent cluster."""
    entries = _clusters(arr)
    if not entries:
        return []
    measured_ink = ink_rgb(arr)
    ink_index = min(range(len(entries)), key=lambda index: (
        float(np.linalg.norm(np.asarray(entries[index]["rgb"], dtype=float) - measured_ink)),
        entries[index]["rgb"],
    ))
    non_ink = [entry for index, entry in enumerate(entries) if index != ink_index]
    ordered = sorted(non_ink, key=lambda entry: (-entry["count"], entry["rgb"]))
    dominant = {id(entry) for entry in ordered[:PALETTE_SIZE]}
    chosen = [entry for entry in ordered if id(entry) in dominant or
              (entry["saturation"] >= ACCENT_SATURATION and entry["coverage"] >= ACCENT_COVERAGE)]
    return [{"hex": _hex(entry["rgb"]), "coverage": round(entry["coverage"], 6),
             "is_accent": entry["saturation"] >= ACCENT_SATURATION and entry["coverage"] >= ACCENT_COVERAGE}
            for entry in chosen]


def measure_register(path):
    arr = sm.load(path)
    return {"ink_hex": _hex(ink_rgb(arr)), "palette": dominant_palette(arr)}


def palette_warmth(register):
    """Coverage-weighted R-B mean over the stored palette clusters."""
    palette = register["palette"]
    weight = sum(entry["coverage"] for entry in palette)
    if not weight:
        return 0.0
    return sum(((_rgb(entry["hex"])[0] - _rgb(entry["hex"])[2]) * entry["coverage"])
               for entry in palette) / weight


def _ink_warmth(register):
    rgb = _rgb(register["ink_hex"])
    return rgb[0] - rgb[2]


def choose_anchor(shot, registers):
    """Nearest accepted frame in ink/palette warmth space; never select self."""
    source = registers[shot]
    source_ink, source_warmth = _ink_warmth(source), palette_warmth(source)
    candidates = [other for other in sorted(registers) if other != shot]
    if not candidates:
        raise RuntimeError("anchor selection requires at least two accepted frames")
    return min(candidates, key=lambda other: (
        abs(source_ink - _ink_warmth(registers[other])) +
        0.5 * abs(source_warmth - palette_warmth(registers[other])), other))


def build_registers(baseline_dir):
    baseline_dir = Path(baseline_dir)
    frames = sorted(path.stem for path in baseline_dir.glob("L*.png"))
    if len(frames) != 23:
        raise RuntimeError(f"P7 requires all 23 accepted frames; found {len(frames)}")
    bad = sm.verify_baseline_shas(str(baseline_dir))
    if bad:
        raise RuntimeError("baseline SHA verification failed: " + ", ".join(bad))
    shots = {shot: measure_register(baseline_dir / f"{shot}.png") for shot in frames}
    anchors = {shot: choose_anchor(shot, shots) for shot in TARGET_SHOTS}
    l28_blue = [entry for entry in shots["L28"]["palette"]
                if entry["is_accent"] and _rgb(entry["hex"])[2] > _rgb(entry["hex"])[0] + 20]
    if not l28_blue:
        raise RuntimeError("L28 saturated steel-blue work-mat accent was not captured")
    return {"schema": "faceless-youtube/codex-image-engine-p7-registers@2",
            "shots": shots, "anchors": anchors}


def write_registers(path=OUTPUT_PATH, baseline_dir=BASELINE_DIR):
    data = build_registers(baseline_dir)
    Path(path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description="measure P7 registers from verified baselines")
    parser.add_argument("--baseline-dir", type=Path, default=BASELINE_DIR)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args(argv)
    write_registers(args.output, args.baseline_dir)
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

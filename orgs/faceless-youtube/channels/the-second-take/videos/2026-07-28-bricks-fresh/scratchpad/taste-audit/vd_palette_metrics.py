"""Measured palette table for the Bricks doctrine-variant comparison.

Prints Markdown only; it writes no result files. Run from any directory with:
    py -3 vd_palette_metrics.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


VIDEO = Path(__file__).resolve().parents[2]
VARIANTS = VIDEO / "scratchpad" / "variant-frames"
LIKED = VIDEO / "assets" / "_archive-pre-reset" / "scenes"
KIT = VIDEO.parents[1] / "visual-kit" / "refs"

SAT_MIN = 0.15
HUE_BIN_DEGREES = 15
ORANGE = (15.0, 45.0)
BLUE = (180.0, 240.0)


def rgb_to_hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    data = rgb.astype(np.float32) / 255.0
    red, green, blue = data[..., 0], data[..., 1], data[..., 2]
    maximum = np.maximum.reduce((red, green, blue))
    minimum = np.minimum.reduce((red, green, blue))
    delta = maximum - minimum
    saturation = np.divide(delta, maximum, out=np.zeros_like(delta), where=maximum > 0)
    hue = np.zeros_like(maximum)
    chromatic = delta > 0
    red_max = chromatic & (maximum == red)
    green_max = chromatic & (maximum == green)
    blue_max = chromatic & (maximum == blue)
    hue[red_max] = 60.0 * np.mod((green[red_max] - blue[red_max]) / delta[red_max], 6.0)
    hue[green_max] = 60.0 * (((blue[green_max] - red[green_max]) / delta[green_max]) + 2.0)
    hue[blue_max] = 60.0 * (((red[blue_max] - green[blue_max]) / delta[blue_max]) + 4.0)
    return hue, saturation, maximum


def in_band(hue: np.ndarray, band: tuple[float, float]) -> np.ndarray:
    return (hue >= band[0]) & (hue < band[1])


def grid_coverage(mask: np.ndarray, threshold: float = 0.10) -> float:
    cells = [cell for row in np.array_split(mask, 4, axis=0) for cell in np.array_split(row, 4, axis=1)]
    return sum(float(cell.mean()) >= threshold for cell in cells) / len(cells)


def metrics(path: Path) -> dict[str, object]:
    rgb = np.asarray(Image.open(path).convert("RGB"))
    hue, saturation, value = rgb_to_hsv(rgb)
    chromatic = saturation >= SAT_MIN
    chroma_n = int(chromatic.sum())
    hues = hue[chromatic]
    counts, _ = np.histogram(hues, bins=360 // HUE_BIN_DEGREES, range=(0.0, 360.0))
    top = np.argsort(counts)[-3:][::-1]
    top_hues = [
        ((int(index) * HUE_BIN_DEGREES + HUE_BIN_DEGREES / 2), float(counts[index] / chroma_n))
        for index in top
    ] if chroma_n else []

    orange = chromatic & in_band(hue, ORANGE)
    blue = chromatic & in_band(hue, BLUE)
    warm = chromatic & ((hue < 90.0) | (hue >= 300.0))
    cool = chromatic & ~((hue < 90.0) | (hue >= 300.0))
    orange_chroma = float(orange.sum() / chroma_n) if chroma_n else 0.0
    blue_chroma = float(blue.sum() / chroma_n) if chroma_n else 0.0
    pair_chroma = orange_chroma + blue_chroma
    pair_total = float((orange | blue).mean())
    flag = (
        pair_chroma >= 0.50
        and orange_chroma >= 0.10
        and blue_chroma >= 0.10
        and pair_total >= 0.25
    )
    warmth = rgb[..., 0].astype(np.float32) - rgb[..., 2].astype(np.float32)
    return {
        "top": top_hues,
        "warm": float(warm.sum() / chroma_n) if chroma_n else 0.0,
        "cool": float(cool.sum() / chroma_n) if chroma_n else 0.0,
        "r_minus_b": float(warmth.mean()),
        "sat": float(saturation.mean()),
        "value": float(value.mean()),
        "neutral": float((~chromatic).mean()),
        "orange_chroma": orange_chroma,
        "blue_chroma": blue_chroma,
        "pair_chroma": pair_chroma,
        "pair_total": pair_total,
        "third_chroma": max(0.0, 1.0 - pair_chroma),
        "orange_total": float(orange.mean()),
        "blue_total": float(blue.mean()),
        "orange_grid": grid_coverage(orange),
        "blue_grid": grid_coverage(blue),
        "flag": flag,
    }


def pct(value: float) -> str:
    return f"{100 * value:.1f}"


def top_cell(rows: list[tuple[float, float]]) -> str:
    return ", ".join(f"{centre:.1f}°/{pct(share)}%" for centre, share in rows)


def print_frame_table(rows: list[tuple[str, Path]]) -> dict[str, dict[str, object]]:
    measured = {name: metrics(path) for name, path in rows}
    print("| frame | top-3 hue bins (centre/share of chromatic) | warm/cool % | R-B | mean S | mean V | neutral % | O/B % chromatic | pair % chromatic / frame | O/B grid % | flag |")
    print("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |")
    for name, _ in rows:
        row = measured[name]
        print(
            f"| {name} | {top_cell(row['top'])} | {pct(row['warm'])}/{pct(row['cool'])} | "
            f"{row['r_minus_b']:.1f} | {row['sat']:.3f} | {row['value']:.3f} | "
            f"{pct(row['neutral'])} | {pct(row['orange_chroma'])}/{pct(row['blue_chroma'])} | "
            f"{pct(row['pair_chroma'])}/{pct(row['pair_total'])} | "
            f"{pct(row['orange_grid'])}/{pct(row['blue_grid'])} | "
            f"{'YES' if row['flag'] else '—'} |"
        )
    return measured


def print_aggregate(measured: dict[str, dict[str, object]]) -> None:
    groups = {
        "va": [key for key in measured if key.startswith("va/")],
        "vb": [key for key in measured if key.startswith("vb/")],
        "vc": [key for key in measured if key.startswith("vc/")],
        "liked L01-L12": [key for key in measured if key.startswith("liked/") and int(key[-2:]) <= 12],
        "liked all 17": [key for key in measured if key.startswith("liked/")],
    }
    print("\n| set | n/flagged | mean pair % chromatic/frame | mean O/B % frame | mean S/V | mean neutral/third-chromatic % | mean O/B grid % |")
    print("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
    for name, keys in groups.items():
        rows = [measured[key] for key in keys]
        mean = lambda field: float(np.mean([row[field] for row in rows]))
        print(
            f"| {name} | {sum(bool(row['flag']) for row in rows)}/{len(rows)} | "
            f"{pct(mean('pair_chroma'))}/{pct(mean('pair_total'))} | "
            f"{pct(mean('orange_total'))}/{pct(mean('blue_total'))} | "
            f"{mean('sat'):.3f}/{mean('value'):.3f} | "
            f"{pct(mean('neutral'))}/{pct(mean('third_chroma'))} | "
            f"{pct(mean('orange_grid'))}/{pct(mean('blue_grid'))} |"
        )


def main() -> None:
    rows: list[tuple[str, Path]] = []
    for variant in ("va", "vb", "vc"):
        rows.extend((f"{variant}/L{number:02d}", VARIANTS / variant / f"L{number:02d}.png") for number in range(1, 13))
    liked_ids = list(range(1, 13)) + list(range(21, 26))
    rows.extend((f"liked/L{number:02d}", LIKED / f"L{number:02d}.png") for number in liked_ids)
    missing = [str(path) for _, path in rows if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing images:\n" + "\n".join(missing))
    measured = print_frame_table(rows)
    print_aggregate(measured)

    assets = [
        ("style-tile", KIT / "env" / "scene-style-tile.png"),
        ("lettering", KIT / "env" / "lettering-marker-italic.png"),
        ("pc-boxy", KIT / "pc-boxy" / "pc-boxy.png"),
        ("expr-confused", KIT / "base" / "expr-confused.png"),
        ("expr-surprised", KIT / "base" / "expr-surprised.png"),
        ("crowd-exemplar", KIT / "base" / "crowd-exemplar.png"),
        ("prop-drive", KIT / "env" / "prop-drive.png"),
    ]
    print("\nReference assets:")
    print_frame_table(assets)


if __name__ == "__main__":
    main()

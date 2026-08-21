"""Measured palette table for the Bricks doctrine-variant comparison.

Prints Markdown only; it writes no result files. Run from any directory with:
    py -3 vd_palette_metrics.py
"""

from __future__ import annotations

from pathlib import Path

VIDEO = Path(__file__).resolve().parents[2]

import sys
import numpy as np
SKILL_SCRIPTS = VIDEO.parents[3] / ".claude" / "skills" / "image-generation" / "scripts"
sys.path.insert(0, str(SKILL_SCRIPTS))
from palette_metrics import metrics

VARIANTS = VIDEO / "scratchpad" / "variant-frames"
LIKED = VIDEO / "assets" / "_archive-pre-reset" / "scenes"
KIT = VIDEO.parents[1] / "visual-kit" / "refs"


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

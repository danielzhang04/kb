"""Shared advisory HSV measurements for image-generation review artifacts."""
from pathlib import Path

import numpy as np
from PIL import Image

SAT_MIN = 0.15
HUE_BIN_DEGREES = 15
ORANGE = (15.0, 45.0)
BLUE = (180.0, 240.0)
COOL_PAIR = (165.0, 240.0)


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
    cells = [cell for row in np.array_split(mask, 4, axis=0)
             for cell in np.array_split(row, 4, axis=1)]
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
    cool_pair = chromatic & in_band(hue, COOL_PAIR)
    warm = chromatic & ((hue < 90.0) | (hue >= 300.0))
    cool = chromatic & ~((hue < 90.0) | (hue >= 300.0))
    orange_chroma = float(orange.sum() / chroma_n) if chroma_n else 0.0
    blue_chroma = float(blue.sum() / chroma_n) if chroma_n else 0.0
    cool_pair_chroma = float(cool_pair.sum() / chroma_n) if chroma_n else 0.0
    pair_chroma = orange_chroma + blue_chroma
    complementary_pair_chroma = orange_chroma + cool_pair_chroma
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
        "cool_pair_chroma": cool_pair_chroma,
        "pair_chroma": pair_chroma,
        "complementary_pair_chroma": complementary_pair_chroma,
        "pair_total": pair_total,
        "third_chroma": max(0.0, 1.0 - pair_chroma),
        "orange_total": float(orange.mean()),
        "blue_total": float(blue.mean()),
        "orange_grid": grid_coverage(orange),
        "blue_grid": grid_coverage(blue),
        "flag": flag,
    }

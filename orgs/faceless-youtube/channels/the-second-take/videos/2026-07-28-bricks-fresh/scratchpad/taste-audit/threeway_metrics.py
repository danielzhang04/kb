"""Three-way pixel metrics for the bricks FRESH, V2, and LIKED frame sets.

This is deliberately a proxy battery, not semantic scene understanding.  It
extends the earlier two-set audit with two ground-truth-directed composition
proxies: open low-detail space and horizontal depth layering.  Run from any
working directory with ``python threeway_metrics.py``.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


VIDEO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = Path(__file__).resolve().parent
FRESH_DIR = VIDEO_ROOT / "assets/scenes"
V2_DIR = VIDEO_ROOT / "scratchpad/fresh-gen/v2-frames"
LIKED_DIR = VIDEO_ROOT / "assets/_archive-pre-reset/scenes"
MANIFEST = FRESH_DIR / "manifest.json"

LIKED_IDS = (5, 6, 7, 8, 9, 11, 19, 20, 21, 22, 23, 24, 25)
LOW_RES = (160, 90)
OUTLIER_SIGMAS = 1.5
VERDICT_FLAT_SIGMAS = 0.10

METRICS = (
    ("warmth_mean_r_minus_b", "Warmth: mean R-B", "higher/lower as LIKED"),
    ("warmth_p10_r_minus_b", "Warmth: p10 R-B", "higher/lower as LIKED"),
    ("saturation_mean", "Saturation: mean HSV S", "toward LIKED 0.33"),
    ("grey_share_s_lt_0_08", "Saturation: grey share (S < 0.08)", "higher/lower as LIKED"),
    ("palette_top3_share", "Palette commitment: top-3 of 16 colors", "higher/lower as LIKED"),
    ("accent_pop_share", "Accent pop: high-S, hue-distant share", "higher/lower as LIKED"),
    ("luminance_mean_v", "Light: mean HSV V", "higher/lower as LIKED"),
    ("murk_share_v_lt_0_25", "Light: murk share (V < 0.25)", "higher/lower as LIKED"),
    ("edge_mean_gradient", "Edge/detail: mean gradient magnitude", "higher/lower as LIKED"),
    ("edge_grid_std", "Edge/detail: 4x4 grid density std", "higher/lower as LIKED"),
    ("openness_share", "Openness proxy: contiguous quiet-space share", "higher/lower as LIKED"),
    ("depth_layer_bands", "Depth proxy: horizontal luminance/edge bands", "higher/lower as LIKED"),
)


def rgb_to_hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return hue in degrees and HSV S/V in [0, 1]."""
    data = rgb.astype(np.float32) / 255.0
    r, g, b = data[..., 0], data[..., 1], data[..., 2]
    maximum = np.maximum.reduce((r, g, b))
    minimum = np.minimum.reduce((r, g, b))
    delta = maximum - minimum
    saturation = np.divide(delta, maximum, out=np.zeros_like(delta), where=maximum > 0)
    hue = np.zeros_like(maximum)
    chromatic = delta > 0
    r_max = chromatic & (maximum == r)
    g_max = chromatic & (maximum == g)
    b_max = chromatic & (maximum == b)
    hue[r_max] = 60.0 * np.mod((g[r_max] - b[r_max]) / delta[r_max], 6.0)
    hue[g_max] = 60.0 * (((b[g_max] - r[g_max]) / delta[g_max]) + 2.0)
    hue[b_max] = 60.0 * (((r[b_max] - g[b_max]) / delta[b_max]) + 4.0)
    return hue, saturation, maximum


def luma(rgb: np.ndarray) -> np.ndarray:
    return (
        0.299 * rgb[..., 0].astype(np.float32)
        + 0.587 * rgb[..., 1].astype(np.float32)
        + 0.114 * rgb[..., 2].astype(np.float32)
    ) / 255.0


def gradient_magnitude(luminance: np.ndarray) -> np.ndarray:
    grad_y, grad_x = np.gradient(luminance)
    return np.hypot(grad_x, grad_y)


def box_mean(array: np.ndarray, side: int) -> np.ndarray:
    """Reflect-padded square local mean without a SciPy dependency."""
    pad = side // 2
    padded = np.pad(array, ((pad, pad), (pad, pad)), mode="reflect")
    integral = np.pad(padded, ((1, 0), (1, 0)), mode="constant").cumsum(0).cumsum(1)
    return (
        integral[side:, side:]
        - integral[:-side, side:]
        - integral[side:, :-side]
        + integral[:-side, :-side]
    ) / (side * side)


def contiguous_kept_share(mask: np.ndarray, minimum_pixels: int) -> float:
    """Share belonging to 8-connected qualifying components of sufficient size."""
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    retained = 0
    for start in np.flatnonzero(mask):
        y, x = divmod(int(start), width)
        if seen[y, x]:
            continue
        seen[y, x] = True
        stack = [(y, x)]
        count = 0
        while stack:
            cy, cx = stack.pop()
            count += 1
            for ny in range(max(0, cy - 1), min(height, cy + 2)):
                for nx in range(max(0, cx - 1), min(width, cx + 2)):
                    if mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if count >= minimum_pixels:
            retained += count
    return retained / mask.size


def openness_proxy(image: Image.Image) -> float:
    """Measure large, contiguous areas that are locally quiet in edge and S."""
    low_rgb = np.asarray(image.resize(LOW_RES, Image.Resampling.BILINEAR).convert("RGB"))
    _, saturation, _ = rgb_to_hsv(low_rgb)
    edge = gradient_magnitude(luma(low_rgb))
    local_edge = box_mean(edge, 9)
    local_s_mean = box_mean(saturation, 9)
    local_s_var = np.maximum(box_mean(saturation * saturation, 9) - local_s_mean * local_s_mean, 0.0)
    quiet = (local_edge <= 0.018) & (np.sqrt(local_s_var) <= 0.075)
    return float(contiguous_kept_share(quiet, minimum_pixels=144))


def smooth_profile(values: np.ndarray) -> np.ndarray:
    padded = np.pad(values, (1, 1), mode="edge")
    return 0.25 * padded[:-2] + 0.50 * padded[1:-1] + 0.25 * padded[2:]


def merge_single_strip_bands(labels: np.ndarray) -> np.ndarray:
    """Remove isolated profile blips so a one-strip object is not a depth layer."""
    labels = labels.copy()
    changed = True
    while changed:
        changed = False
        starts = np.r_[0, np.flatnonzero(np.any(np.diff(labels, axis=0) != 0, axis=1)) + 1]
        ends = np.r_[starts[1:], len(labels)]
        for start, end in zip(starts, ends):
            if end - start != 1:
                continue
            if start > 0 and end < len(labels) and np.array_equal(labels[start - 1], labels[end]):
                labels[start] = labels[start - 1]
                changed = True
                break
    return labels


def depth_layer_proxy(image: Image.Image) -> int:
    """Count stable horizontal bands distinguished by luminance and edge density."""
    low_rgb = np.asarray(image.resize(LOW_RES, Image.Resampling.BILINEAR).convert("RGB"))
    low_luma = luma(low_rgb)
    edge = gradient_magnitude(low_luma)
    luma_profile = np.array([part.mean() for part in np.array_split(low_luma, 12, axis=0)])
    edge_profile = np.array([part.mean() for part in np.array_split(edge, 12, axis=0)])
    # Quantization makes a band mean a materially different horizontal visual regime,
    # rather than a tiny stripe-to-stripe numerical fluctuation.
    luma_bin = np.floor(smooth_profile(luma_profile) / 0.08).astype(int)
    edge_bin = np.floor(smooth_profile(edge_profile) / 0.012).astype(int)
    labels = merge_single_strip_bands(np.column_stack((luma_bin, edge_bin)))
    return int(1 + np.count_nonzero(np.any(np.diff(labels, axis=0) != 0, axis=1)))


def image_metrics(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert("RGB")
    rgb = np.asarray(image)
    hue, saturation, value = rgb_to_hsv(rgb)
    chromatic_hues = hue[saturation >= 0.08]
    if chromatic_hues.size:
        hue_counts, _ = np.histogram(chromatic_hues, bins=36, range=(0.0, 360.0))
        dominant_hue = (float(np.argmax(hue_counts)) + 0.5) * 10.0
    else:
        dominant_hue = 0.0
    hue_distance = np.abs(((hue - dominant_hue + 180.0) % 360.0) - 180.0)
    indexed = np.asarray(image.quantize(colors=16, method=Image.Quantize.MEDIANCUT))
    palette_counts = np.bincount(indexed.ravel(), minlength=16)
    gradient = gradient_magnitude(luma(rgb))
    grid_means = [
        cell.mean()
        for row in np.array_split(gradient, 4, axis=0)
        for cell in np.array_split(row, 4, axis=1)
    ]
    warmth = rgb[..., 0].astype(np.float32) - rgb[..., 2].astype(np.float32)
    return {
        "dominant_hue_degrees": float(dominant_hue),
        "warmth_mean_r_minus_b": float(warmth.mean()),
        "warmth_p10_r_minus_b": float(np.percentile(warmth, 10)),
        "saturation_mean": float(saturation.mean()),
        "grey_share_s_lt_0_08": float((saturation < 0.08).mean()),
        "palette_top3_share": float(np.sort(palette_counts)[-3:].sum() / indexed.size),
        "accent_pop_share": float(((saturation > 0.55) & (hue_distance > 60.0)).mean()),
        "luminance_mean_v": float(value.mean()),
        "murk_share_v_lt_0_25": float((value < 0.25).mean()),
        "edge_mean_gradient": float(gradient.mean()),
        "edge_grid_std": float(np.std(grid_means, ddof=0)),
        "openness_share": openness_proxy(image),
        "depth_layer_bands": depth_layer_proxy(image),
    }


def aggregate(per_image: dict[str, dict[str, float | int]]) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for key, _, _ in METRICS:
        values = np.array([metrics[key] for metrics in per_image.values()], dtype=np.float64)
        result[key] = {
            "mean": float(values.mean()),
            "p10": float(np.percentile(values, 10)),
            "p90": float(np.percentile(values, 90)),
            "sample_std": float(values.std(ddof=1)),
        }
    return result


def outliers(
    per_image: dict[str, dict[str, float | int]], liked: dict[str, dict[str, float]]
) -> dict[str, list[dict[str, float | str]]]:
    result: dict[str, list[dict[str, float | str]]] = {}
    for key, _, _ in METRICS:
        centre, sigma = liked[key]["mean"], liked[key]["sample_std"]
        flagged = []
        if sigma > 0:
            for filename, metrics in per_image.items():
                value = float(metrics[key])
                z_score = (value - centre) / sigma
                if abs(z_score) > OUTLIER_SIGMAS:
                    flagged.append({"image": filename, "value": value, "z_score": float(z_score)})
        result[key] = sorted(flagged, key=lambda item: abs(float(item["z_score"])), reverse=True)
    return result


def direction(v2: dict[str, float], fresh: dict[str, float], liked: dict[str, float]) -> str:
    before = abs(v2["mean"] - liked["mean"])
    after = abs(fresh["mean"] - liked["mean"])
    tolerance = VERDICT_FLAT_SIGMAS * liked["sample_std"]
    if abs(after - before) <= tolerance:
        return "flat"
    return "toward-liked" if after < before else "away"


def fmt(value: float) -> str:
    return f"{value:.4f}"


def set_cell(values: dict[str, float]) -> str:
    return f"{fmt(values['mean'])} (p10 {fmt(values['p10'])}; p90 {fmt(values['p90'])})"


def outlier_cell(items: list[dict[str, float | str]]) -> str:
    if not items:
        return "—"
    return "; ".join(f"{item['image']} ({fmt(float(item['value']))})" for item in items)


def verified_fresh_files() -> tuple[list[str], list[dict[str, str]]]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    status_by_id = {shot["shot_id"]: shot.get("review_status") for shot in manifest["shots"]}
    verified, excluded = [], []
    for number in range(1, 26):
        shot_id = f"L{number:02d}"
        filename = f"{shot_id}.png"
        status = status_by_id.get(shot_id)
        if status == "verified" and (FRESH_DIR / filename).is_file():
            verified.append(filename)
        else:
            excluded.append({"shot_id": shot_id, "file": filename, "review_status": status or "missing"})
    return verified, excluded


def require_files(directory: Path, names: list[str]) -> None:
    missing = [str(directory / name) for name in names if not (directory / name).is_file()]
    if missing:
        raise FileNotFoundError("Missing requested images:\n" + "\n".join(missing))


def main() -> None:
    fresh_files, fresh_exclusions = verified_fresh_files()
    v2_files = [f"L{number:02d}.png" for number in range(1, 26)]
    liked_files = [f"L{number:02d}.png" for number in LIKED_IDS]
    require_files(FRESH_DIR, fresh_files)
    require_files(V2_DIR, v2_files)
    require_files(LIKED_DIR, liked_files)

    sets = {
        "LIKED": {"directory": LIKED_DIR, "files": liked_files},
        "V2": {"directory": V2_DIR, "files": v2_files},
        "FRESH": {"directory": FRESH_DIR, "files": fresh_files},
    }
    for data in sets.values():
        directory, files = data["directory"], data["files"]
        data["per_image"] = {name: image_metrics(directory / name) for name in files}
        data["aggregate"] = aggregate(data["per_image"])
        del data["directory"]

    liked_aggregate = sets["LIKED"]["aggregate"]
    for name in ("V2", "FRESH"):
        sets[name]["outliers_vs_liked"] = outliers(sets[name]["per_image"], liked_aggregate)
    verdicts = {
        key: direction(sets["V2"]["aggregate"][key], sets["FRESH"]["aggregate"][key], liked_aggregate[key])
        for key, _, _ in METRICS
    }
    payload = {
        "scope": {
            "FRESH": "Verified L01-L25 assets/scenes frames only; non-verified manifest records are excluded.",
            "V2": "L01-L25 from scratchpad/fresh-gen/v2-frames.",
            "LIKED": "Archive exemplars L05-L08, L09, L11, L19-L25.",
        },
        "fresh_exclusions": fresh_exclusions,
        "method": {
            "warmth": "Per-pixel RGB R-B in 0-255 channel units; p10 is the within-image 10th percentile.",
            "saturation_and_luminance": "HSV S and V in [0, 1].",
            "palette_commitment": "PIL median-cut adaptive 16-colour quantization; top three indexed colours' pixel share.",
            "accent_pop": "S > 0.55 and circular hue distance > 60 degrees from the modal 10-degree hue bin among pixels with S >= 0.08.",
            "edge_detail": "Mean magnitude of NumPy centred finite-difference gradients on Rec. 601 luminance; grid std is across 4x4 cell means.",
            "openness_proxy": "Resize to 160x90. A pixel qualifies when its 9x9 local mean Rec.601-luminance gradient is <= 0.018 and local HSV-S standard deviation is <= 0.075. Openness is the share in 8-connected qualifying regions of at least 144 low-res pixels (1% of the frame). This is a quiet sky/wall/air proxy, not object segmentation or literal empty-space detection.",
            "depth_layer_proxy": "Resize to 160x90, split into 12 horizontal strips, and calculate strip mean Rec.601 luminance and mean luminance-gradient. Smooth each 1D profile [0.25, 0.50, 0.25], quantize luminance in 0.08 bins and edge density in 0.012 bins, merge one-strip blips, then count contiguous distinct paired bins. This is a fore/mid/back horizontal-regime proxy, not true 3D depth.",
            "outlier_rule": "V2/FRESH image differs from the LIKED mean by more than 1.5 LIKED sample standard deviations.",
            "direction_rule": "Compare absolute distance to the LIKED set mean before (V2) and after (FRESH). A change of no more than 0.10 LIKED sample standard deviations is flat; otherwise reduced distance is toward-liked and increased distance is away.",
        },
        "sets": sets,
        "verdicts_v2_to_fresh": verdicts,
    }
    (OUT_DIR / "threeway-metrics.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Three-way pixel metrics — LIKED vs V2 vs FRESH",
        "",
        "FRESH is limited to manifest-verified L01–L25 frames. Excluded: "
        + (", ".join(f"{row['shot_id']} ({row['review_status']})" for row in fresh_exclusions) or "none")
        + ".",
        "",
        "Each set cell is mean (p10; p90) across images. Per-image values, formulas, and the full outlier records are in `threeway-metrics.json`.",
        "",
        "| metric | LIKED | V2 | FRESH | V2 → FRESH verdict | per-shot outliers (>1.5σ from LIKED) |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for key, label, _ in METRICS:
        v2_outliers = outlier_cell(sets["V2"]["outliers_vs_liked"][key])
        fresh_outliers = outlier_cell(sets["FRESH"]["outliers_vs_liked"][key])
        lines.append(
            f"| {label} | {set_cell(liked_aggregate[key])} | {set_cell(sets['V2']['aggregate'][key])} | "
            f"{set_cell(sets['FRESH']['aggregate'][key])} | {verdicts[key]} | V2: {v2_outliers}; FRESH: {fresh_outliers} |"
        )
    lines.extend(
        [
            "",
            "## Proxy formulas",
            "",
            "- **Openness:** On a 160×90 resize, retain pixels whose 9×9 local mean luminance-gradient is ≤0.018 and whose local HSV-S standard deviation is ≤0.075; count only 8-connected retained regions ≥144 pixels (1% of the resize), and divide their area by the frame. It is a quiet sky/wall/air proxy, not semantic empty-space segmentation.",
            "- **Depth layering:** On the same resize, split the frame into 12 horizontal strips. Smooth each strip’s mean luminance and edge-density profile, quantize them (0.08 luminance; 0.012 edge-density), merge one-strip blips, then count contiguous distinct paired regimes. It is a fore/mid/back proxy, not a 3D depth estimate.",
            "- **Verdict rule:** FRESH is toward-liked when its set mean is closer to LIKED’s mean than V2’s by >0.10 LIKED sample SD; farther is away; otherwise flat.",
        ]
    )
    (OUT_DIR / "threeway-metrics-summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

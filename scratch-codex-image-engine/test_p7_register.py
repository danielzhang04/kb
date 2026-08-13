#!/usr/bin/env python3
"""Plain-assert tests for P7 register capture and anchor selection."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))


def test_small_saturated_patch_is_retained_as_an_accent_cluster():
    import p7_register as p7

    arr = np.full((100, 100, 3), (205, 205, 195), dtype=np.uint8)
    arr[:3, :, :] = (20, 20, 20)
    arr[40:50, :40, :] = (35, 110, 210)  # saturated blue, 4% coverage
    palette = p7.dominant_palette(arr)
    blue = [entry for entry in palette if entry["is_accent"] and entry["hex"].endswith("d2")]
    assert blue and blue[0]["coverage"] >= p7.ACCENT_COVERAGE
    assert set(blue[0]) == {"hex", "coverage", "is_accent"}


def test_palette_policy_constants_and_accent_coverage_boundary_are_pinned():
    import p7_register as p7

    assert p7.PALETTE_SIZE == 6
    assert p7.ACCENT_COVERAGE == 0.003
    assert p7.sm.DARK_FRACTION == 0.03
    entries = [
        {"rgb": (10, 10, 10), "count": 300, "coverage": .03, "saturation": 0},
        {"rgb": (210, 210, 200), "count": 9401, "coverage": .9401, "saturation": .05},
        {"rgb": (0, 90, 220), "count": 30, "coverage": .003, "saturation": 1.0},
        {"rgb": (220, 30, 0), "count": 29, "coverage": .0029, "saturation": 1.0},
    ]
    saved_clusters, saved_ink = p7._clusters, p7.ink_rgb
    p7._clusters = lambda _arr: entries
    p7.ink_rgb = lambda _arr: np.asarray((10, 10, 10), dtype=float)
    try:
        palette = p7.dominant_palette(np.zeros((10, 10, 3), dtype=np.uint8))
    finally:
        p7._clusters, p7.ink_rgb = saved_clusters, saved_ink
    assert any(entry["hex"] == "#005adc" and entry["is_accent"] for entry in palette)
    assert not any(entry["hex"] == "#dc1e00" and entry["is_accent"] for entry in palette)


def test_cluster_removed_as_ink_is_still_retained_when_it_is_a_material_accent():
    import p7_register as p7

    entries = [
        {"rgb": (0, 30, 90), "count": 200, "coverage": .02, "saturation": 1.0},
        {"rgb": (210, 210, 200), "count": 9800, "coverage": .98, "saturation": .05},
    ]
    saved_clusters, saved_ink = p7._clusters, p7.ink_rgb
    p7._clusters = lambda _arr: entries
    p7.ink_rgb = lambda _arr: np.asarray((0, 30, 90), dtype=float)
    try:
        palette = p7.dominant_palette(np.zeros((10, 10, 3), dtype=np.uint8))
    finally:
        p7._clusters, p7.ink_rgb = saved_clusters, saved_ink
    assert any(entry["hex"] == "#001e5a" and entry["is_accent"] for entry in palette)


def test_anchor_is_self_excluding_and_prefers_a_warm_neighbour():
    import p7_register as p7

    registers = {
        "L36": {"ink_hex": "#301000", "palette": [{"hex": "#d08030", "coverage": 1.0, "is_accent": False}]},
        "L47": {"ink_hex": "#101020", "palette": [{"hex": "#6080a0", "coverage": 1.0, "is_accent": False}]},
        "L50": {"ink_hex": "#331101", "palette": [{"hex": "#d18131", "coverage": 1.0, "is_accent": False}]},
    }
    assert p7.choose_anchor("L36", registers) == "L50"
    assert p7.choose_anchor("L50", registers) == "L36"


def test_anchor_choice_depends_on_the_half_weight_palette_warmth_term():
    import p7_register as p7

    registers = {
        "source": {"ink_hex": "#000000", "palette": [{"hex": "#000000", "coverage": 1.0}]},
        "ink-only-winner": {"ink_hex": "#010000", "palette": [{"hex": "#640000", "coverage": 1.0}]},
        "warmth-winner": {"ink_hex": "#020000", "palette": [{"hex": "#000000", "coverage": 1.0}]},
    }
    assert p7.choose_anchor("source", registers) == "warmth-winner"


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")

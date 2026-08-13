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


def test_anchor_is_self_excluding_and_prefers_a_warm_neighbour():
    import p7_register as p7

    registers = {
        "L36": {"ink_hex": "#301000", "palette": [{"hex": "#d08030", "coverage": 1.0, "is_accent": False}]},
        "L47": {"ink_hex": "#101020", "palette": [{"hex": "#6080a0", "coverage": 1.0, "is_accent": False}]},
        "L50": {"ink_hex": "#331101", "palette": [{"hex": "#d18131", "coverage": 1.0, "is_accent": False}]},
    }
    assert p7.choose_anchor("L36", registers) == "L50"
    assert p7.choose_anchor("L50", registers) == "L36"


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")

#!/usr/bin/env python3
"""Plain-assert tests for deterministic P6 baseline register measurement."""
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))


def test_ink_hex_uses_the_same_darkest_three_percent_selection_as_m1():
    import p6_register as p6

    arr = np.full((100, 100, 3), (230, 230, 225), dtype=np.uint8)
    arr[:3, :, :] = (20, 22, 24)
    assert p6._hex(p6.ink_rgb(arr)) == "#141618"


def test_palette_excludes_the_dark_ink_cluster_and_reports_coverage_order():
    import p6_register as p6

    arr = np.zeros((100, 100, 3), dtype=np.uint8)
    arr[:10, :, :] = (20, 20, 20)       # ink, 10%
    arr[10:50, :, :] = (200, 210, 220)  # 40%
    arr[50:75, :, :] = (180, 160, 140)  # 25%
    arr[75:90, :, :] = (100, 140, 150)  # 15%
    arr[90:, :, :] = (215, 64, 43)      # 10%
    palette = p6.dominant_palette(arr)
    assert [entry["hex"] for entry in palette] == ["#c8d2dc", "#b4a08c", "#648c96", "#d7402b"]
    assert [entry["coverage"] for entry in palette] == [0.4, 0.25, 0.15, 0.1]


def test_register_has_red_presence_threshold_and_no_image_path_data():
    import p6_register as p6

    arr = np.full((100, 100, 3), (240, 240, 235), dtype=np.uint8)
    arr[:3, :, :] = (20, 20, 20)
    arr[10:11, :6, :] = (215, 64, 43)  # 0.0006, over the strict threshold
    path = Path(tempfile.mkdtemp(prefix="p6-register-")) / "frame.png"
    Image.fromarray(arr).save(path)
    got = p6.measure_register(path)
    assert got["ink_hex"] == "#141414"
    assert got["red_accent_present"] is True
    assert set(got) == {"ink_hex", "palette", "red_accent_present"}
    assert all(set(entry) == {"hex", "coverage"} for entry in got["palette"])


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")

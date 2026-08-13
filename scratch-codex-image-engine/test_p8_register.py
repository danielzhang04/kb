#!/usr/bin/env python3
"""Plain-assert tests for P8 material-fill register capture."""
import sys
import tempfile
import json
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))


def test_flat_fill_mode_survives_dark_hatching_that_pulls_a_cluster_mean():
    import p7_register as p7
    import p8_register as p8

    fill, hatch = (211, 215, 171), (70, 75, 50)
    arr = np.full((80, 80, 3), fill, dtype=np.uint8)
    arr[:, ::5] = hatch
    modes = p8.fill_modes(arr)
    assert modes[0]["hex"] == "#d0d0a8"
    # A deliberately coarse cluster blends fill and hatch; a mode does not.
    coarse = p7._clusters(arr, clusters=1)[0]["rgb"]
    assert coarse != fill


def test_palette_deduplicates_near_creams_and_uses_the_freed_slot_for_an_accent():
    import p7_register as p7
    import p8_register as p8

    entries = [
        {"rgb": (20, 20, 20), "count": 10, "coverage": .01, "saturation": 0},
        {"rgb": (244, 229, 200), "count": 100, "coverage": .1, "saturation": .18},
        {"rgb": (245, 229, 203), "count": 90, "coverage": .09, "saturation": .17},
        {"rgb": (245, 230, 201), "count": 80, "coverage": .08, "saturation": .18},
        {"rgb": (130, 140, 130), "count": 70, "coverage": .07, "saturation": .07},
        {"rgb": (170, 160, 140), "count": 60, "coverage": .06, "saturation": .18},
        {"rgb": (90, 130, 190), "count": 50, "coverage": .05, "saturation": .53},
    ]
    saved = p7._clusters
    p7._clusters = lambda arr: entries
    try:
        palette = p8.dominant_palette(np.full((10, 10, 3), (20, 20, 20), dtype=np.uint8))
    finally:
        p7._clusters = saved
    creams = [entry for entry in palette if entry["hex"].startswith("#f4e")]
    assert len(creams) == 1
    assert any(entry["hex"] == "#5a82be" and entry["is_accent"] for entry in palette)


def test_dark_cluster_can_be_both_measured_ink_and_retained_accent():
    import p7_register as p7
    import p8_register as p8

    entries = [
        {"rgb": (0, 30, 90), "count": 200, "coverage": .02, "saturation": 1.0},
        {"rgb": (210, 210, 200), "count": 9800, "coverage": .98, "saturation": .05},
    ]
    saved_clusters, saved_ink = p7._clusters, p7.ink_rgb
    p7._clusters = lambda _arr: entries
    p7.ink_rgb = lambda _arr: np.asarray((0, 30, 90), dtype=float)
    try:
        palette = p8.dominant_palette(np.zeros((10, 10, 3), dtype=np.uint8))
    finally:
        p7._clusters, p7.ink_rgb = saved_clusters, saved_ink
    assert any(entry["hex"] == "#001e5a" and entry["is_accent"] for entry in palette)


def test_two_writes_are_byte_identical():
    import p8_register as p8
    from PIL import Image

    root = Path(tempfile.mkdtemp(prefix="p8-register-"))
    first, second = root / "one.json", root / "two.json"
    baselines = root / "baselines"
    baselines.mkdir()
    shots = sorted(json.loads((p8.HERE / "p7-registers.json").read_text(encoding="utf-8"))["shots"])
    for index, shot in enumerate(shots):
        Image.new("RGB", (24, 24), (80 + index, 120, 160 - index)).save(
            baselines / f"{shot}.png")
    saved = p8.sm.verify_baseline_shas
    p8.sm.verify_baseline_shas = lambda _path: []
    try:
        p8.write_registers(first, baselines)
        p8.write_registers(second, baselines)
    finally:
        p8.sm.verify_baseline_shas = saved
    assert first.read_bytes() == second.read_bytes()


ALL_TESTS = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

if __name__ == "__main__":
    for function in ALL_TESTS:
        function()
        print(f"  ok  {function.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")

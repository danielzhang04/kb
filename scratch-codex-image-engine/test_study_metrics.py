#!/usr/bin/env python3
"""Unit tests for study_metrics.py (plain asserts, no pytest).
Run: py -3 test_study_metrics.py"""
import io
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
HERE = Path(__file__).resolve().parent


def _img(size, blocks):
    """blocks = [(x0, y0, x1, y1, (r,g,b)), ...] painted over a light ground."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", size, (240, 240, 235))
    d = ImageDraw.Draw(im)
    for x0, y0, x1, y1, col in blocks:
        d.rectangle([x0, y0, x1, y1], fill=col)
    return im


def _save(im):
    tmp = Path(tempfile.mkdtemp(prefix="metrics-")) / "f.png"
    im.save(tmp, format="PNG")
    return str(tmp)


def test_m1_reads_the_darkest_three_percent_ink_warmth():
    import study_metrics as sm
    import numpy as np
    im = _img((400, 400), [(0, 0, 399, 39, (36, 26, 18))])      # 10% of the frame at #241a12
    arr = np.asarray(im).astype(float)
    assert abs(sm.m1_ink_warmth(arr) - 18.0) < 0.05
    cool = _img((400, 400), [(0, 0, 399, 39, (18, 26, 36))])
    assert abs(sm.m1_ink_warmth(np.asarray(cool).astype(float)) + 18.0) < 0.05


def test_m2_flatness_is_high_for_flat_cel_and_low_for_a_gradient():
    import study_metrics as sm
    import numpy as np
    from PIL import Image
    flat = np.asarray(_img((300, 300), [(0, 0, 299, 99, (36, 26, 18)),
                                        (0, 100, 299, 199, (90, 140, 150))])).astype(float)
    assert sm.m2_flatness(flat) > 0.9
    grad = Image.linear_gradient("L").convert("RGB").resize((300, 100))  # ~2.6 luma/px: non-flat under the spec threshold
    assert sm.m2_flatness(np.asarray(grad).astype(float)) < 0.5


def test_m2_uses_sobel_not_central_differences_for_edge_exclusion():
    import study_metrics as sm
    import numpy as np
    # Fixed low-amplitude field: central differences score 0.017241..., while
    # the specified 3x3 Sobel detector scores 0.009433962264150943.
    field = np.random.default_rng(44).integers(0, 7, size=(35, 35)).astype(float)
    arr = np.repeat(field[:, :, None], 3, axis=2)
    assert abs(sm.m2_flatness(arr) - 0.009433962264150943) < 1e-12


def test_m2_counts_a_five_by_five_luma_range_of_four_but_not_above_four():
    import study_metrics as sm
    import numpy as np
    exact = np.zeros((5, 5, 3), dtype=float)
    exact[0, 0] = 4.0
    above = exact.copy()
    above[0, 0] = 4.01
    # Isolate the inclusive flat-window boundary from the independent edge detector.
    original_percentile = sm.np.percentile
    sm.np.percentile = lambda *_args, **_kwargs: float("inf")
    try:
        assert sm.m2_flatness(exact) == 1.0
        assert sm.m2_flatness(above) == 0.0
    finally:
        sm.np.percentile = original_percentile


def test_m3_counts_colours_to_ninety_percent_area():
    import study_metrics as sm
    import numpy as np
    im = _img((300, 300), [(0, 0, 299, 149, (36, 26, 18)), (0, 150, 299, 269, (90, 140, 150))])
    assert sm.m3_palette_concentration(np.asarray(im).astype(float)) == 2


def test_m4_measures_the_red_accent_share():
    import study_metrics as sm
    import numpy as np
    im = _img((400, 400), [(0, 0, 399, 39, (215, 64, 43))])      # exactly 10%
    got = sm.m4_red_discipline(np.asarray(im).astype(float))
    assert abs(got - 0.10) < 0.005
    plain = _img((400, 400), [])
    assert sm.m4_red_discipline(np.asarray(plain).astype(float)) == 0.0


def test_measure_returns_dims_and_all_four_metrics():
    import study_metrics as sm
    path = _save(_img((1376, 768), [(0, 0, 1375, 79, (36, 26, 18))]))
    got = sm.measure(path)
    assert got["dims"] == [1376, 768]
    assert set(got) == {"path", "dims", "m1", "m2", "m3", "m4"}
    assert abs(got["m1"] - 18.0) < 0.05


def test_baseline_shas_reverify_clean():
    import study_metrics as sm
    bad = sm.verify_baseline_shas(str(HERE / "gemini-baseline"))
    assert bad == [], f"baseline frames altered: {bad}"


def test_iqr_width_is_the_interquartile_span():
    import study_metrics as sm
    assert abs(sm.iqr_width([1, 2, 3, 4, 5, 6, 7, 8, 9]) - 4.0) < 1e-9
    assert sm.iqr_width([5.0]) == 0.0


def test_baseline_table_and_bands_over_the_23_verified_frames():
    import study_metrics as sm
    table = sm.baseline_table(str(HERE / "gemini-baseline"))
    assert len(table) == 23
    for shot in sm.CORPUS:
        assert shot in table, shot
        assert table[shot]["dims"] == [1376, 768]
    bands = sm.baseline_bands(str(HERE / "gemini-baseline"))
    assert set(bands) == {"m1", "m2", "m3", "m4"}
    assert all(v >= 0 for v in bands.values())
    assert bands["m1"] > 0, "a zero M1 band over 23 real frames means the metric is broken"


def test_baseline_table_fails_closed_when_a_baseline_copy_is_tampered():
    import shutil
    import study_metrics as sm
    with tempfile.TemporaryDirectory(prefix="baseline-tamper-") as tmp:
        copied = Path(tmp) / "gemini-baseline"
        shutil.copytree(HERE / "gemini-baseline", copied)
        with open(copied / "L26.png", "ab") as f:
            f.write(b"tamper")
        try:
            sm.baseline_table(str(copied))
        except RuntimeError as e:
            assert "L26.png" in str(e)
        else:
            raise AssertionError("tampered baseline was measured instead of rejected")


def test_paired_distances_are_absolute_per_metric():
    import study_metrics as sm
    d = sm.paired_distances({"m1": 4.6, "m2": 0.70, "m3": 9, "m4": 0.012},
                            {"m1": 0.5, "m2": 0.78, "m3": 7, "m4": 0.010})
    assert abs(d["m1"] - 4.1) < 1e-9
    assert abs(d["m2"] - 0.08) < 1e-9
    assert d["m3"] == 2 and abs(d["m4"] - 0.002) < 1e-9


def test_evaluate_floor_passes_on_three_of_four_shots():
    import study_metrics as sm
    bands = {"m1": 20.0, "m2": 0.20, "m3": 6.0, "m4": 0.05}
    good = {"m1": 2.0, "m2": 0.05, "m3": 1, "m4": 0.001}
    bad_m1 = {"m1": 9.0, "m2": 0.05, "m3": 1, "m4": 0.001}
    dist = {"L26": good, "L44": good, "L33": good, "L29": bad_m1}
    got = sm.evaluate_floor(dist, bands)
    assert got["pass"] is True
    assert got["passing_shots"]["m1"] == 3
    dist["L33"] = bad_m1
    assert sm.evaluate_floor(dist, bands)["pass"] is False


def test_evaluate_floor_fails_when_a_band_metric_slips():
    import study_metrics as sm
    bands = {"m1": 20.0, "m2": 0.02, "m3": 1.0, "m4": 0.001}
    d = {"m1": 1.0, "m2": 0.30, "m3": 5, "m4": 0.02}
    got = sm.evaluate_floor({s: d for s in sm.CORPUS}, bands)
    assert got["pass"] is False
    assert got["passing_shots"]["m2"] == 0
    assert "m2" in got["reason"]


ALL_TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    for fn in ALL_TESTS:
        fn()
        print(f"  ok  {fn.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")

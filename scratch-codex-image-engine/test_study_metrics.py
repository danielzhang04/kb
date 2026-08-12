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


ALL_TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    for fn in ALL_TESTS:
        fn()
        print(f"  ok  {fn.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")

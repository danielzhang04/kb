"""Unit tests for the cutout pure helpers (plain-assert; no rembg in the fast suite)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from forge import harden_alpha, trim_to_alpha


def _rgba(w, h, alpha_fn):
    im = Image.new("RGBA", (w, h), (10, 20, 30, 0))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (10, 20, 30, alpha_fn(x, y))
    return im


def test_harden_pushes_soft_alpha_to_extremes():
    # a horizontal alpha ramp 0..255 -> after harden, only a thin transition band is mid-valued
    im = _rgba(256, 4, lambda x, y: x)
    out = harden_alpha(im, lo=100, hi=175)
    a = out.split()[3]
    assert a.getpixel((50, 0)) == 0, "below lo -> transparent"
    assert a.getpixel((240, 0)) == 255, "above hi -> opaque"


def test_trim_crops_to_content():
    # a 100x100 image with a 20x20 opaque block at (40,40) -> trims to 20x20
    im = _rgba(100, 100, lambda x, y: 255 if (40 <= x < 60 and 40 <= y < 60) else 0)
    out = trim_to_alpha(im)
    assert out.size == (20, 20), out.size


def main():
    for fn in [test_harden_pushes_soft_alpha_to_extremes, test_trim_crops_to_content]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()

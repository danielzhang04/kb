"""One staging-only, channel-crowd-seeded restyle retry (r3)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import t16_mint as T  # noqa: E402


DELTA = (
    "Copy the reference image EXACTLY for: the number of figures, their positions, their squat "
    "head-to-body proportions, their short legs, their head shapes, and their simplified faces "
    "(plain dot eyes, one neutral closed mouth, NO nose, NO ears, no eyebrows). Change ONLY the "
    "following three things and NOTHING else: "
    "(1) Era dress: 1980s American ordinary workplace clothes, muted colours, no "
    "lettering/logos/badges/hats. "
    "(2) Flat head tones: only #f5ead6, #e2b78c, #7a4f33 distributed across the six, never "
    "uniform. "
    "(3) Hair: at most three simple repeating silhouettes (short side-parted, short curly cap, "
    "hair pinned up). "
    "Everything not named above stays IDENTICAL to the reference image. Plain flat light-grey "
    "studio background, no props, no text."
)


def main():
    spec = {
        "name": "crowd-exemplar-reroll-r3-candidate",
        "character": "base",
        "mode": "environment",
        "aspect": "4:3",
        "seed": "refs/base/crowd-exemplar.png",
        "delta": DELTA,
    }
    assert all(ord(c) < 128 for c in DELTA), "delta must be ASCII-only"
    print("NAME=" + spec["name"])
    print("DELTA=" + DELTA)
    result = T.run(spec, dry="--live" not in sys.argv)
    if result == "STALL":
        print("REISSUE=STALL_ONLY")
        result = T.run(spec, dry="--live" not in sys.argv)
    print("FINAL_STATUS=" + result)
    if result != "OK":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

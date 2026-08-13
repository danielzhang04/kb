"""One staging-only crowd proportion retry, routed through the t16 forge path."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import t16_mint as T  # noqa: E402

PROPORTION_LAW_R2 = (
    "PROPORTION LAW: every figure has EXACTLY the same squat build, matching the channel's "
    "base rig - a large round head on a short compact body. Draw compact bodies and SHORT, "
    "stubby legs on EVERY figure: visible leg length is under ONE head-width, never long thin "
    "legs on any figure. Total height is 3 to 3.5 head-widths for ALL six figures, none taller. "
    "No figure is taller than any other by more than half a head. No figure is lanky and no "
    "figure is 4 or more heads tall. ")


def main():
    delta = T.CROWD_DELTA.replace(T.PROPORTION_LAW, PROPORTION_LAW_R2, 1)
    assert delta != T.CROWD_DELTA, "t16 proportion-law insertion was not found"
    spec = {
        "name": "crowd-exemplar-reroll-r2-candidate",
        "character": "base",
        "mode": "environment",
        "aspect": "4:3",
        "seed": "refs/base/base.png",
        "delta": delta,
    }
    assert all(ord(c) < 128 for c in delta), "delta must be ASCII-only"
    print("NAME=" + spec["name"])
    print("DELTA=" + delta)
    result = T.run(spec, dry="--live" not in sys.argv)
    print("FINAL_STATUS=" + result)
    if result != "OK":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

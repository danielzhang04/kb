"""Task 16 mint-only candidates: three flat-fill cast retries and a crowd re-roll.

No promotion, stamping, registry write, or review-store write occurs here.  The cast deltas
reuse t14_retry's local no-ear/no-nose clause and change only rendering language adjacent to
the pinned costume.  The crowd uses a distinct staging name, never the library canonical.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import t14_mint as M  # noqa: E402
import t14_retry as R  # noqa: E402


def _identity_with_flat_fill(slug, garment, clause):
    """Insert the rendering instruction immediately after the registry costume sentence."""
    who, identity = next((who, identity) for s, who, identity in M.CAST if s == slug)
    sentence_start = identity.index("costume is ")
    sentence_break = identity.find(". ", sentence_start)
    costume_end = len(identity) if sentence_break < 0 else sentence_break + 1
    return who, identity[:costume_end] + " " + clause + identity[costume_end:]


RETURN_WHO, RETURN_IDENTITY = _identity_with_flat_fill(
    "return-customer", "navy quilted delivery coat",
    "The navy quilted delivery coat is one single flat solid colour fill in flat cel shading - "
    "no fabric texture, no weave, no stitching, no quilting lines, no herringbone, no mottling; "
    "the only shading is the style's simple two-tone cel shadow. ")
SELLER_WHO, SELLER_IDENTITY = _identity_with_flat_fill(
    "brick-co-seller", "heavy canvas apron",
    "The heavy canvas apron is one single flat solid colour fill in flat cel shading - no fabric "
    "texture, no weave, no stitching, no quilting lines, no herringbone, no mottling; the only "
    "shading is the style's simple two-tone cel shadow. ")
HR_WHO, HR_IDENTITY = _identity_with_flat_fill(
    "hr-officer", "long tweed skirt",
    "The long tweed skirt is one single flat solid colour fill in flat cel shading - no fabric "
    "texture, no weave, no stitching, no quilting lines, no herringbone, no mottling; the only "
    "shading is the style's simple two-tone cel shadow. ")


def _cast_spec(slug, who, identity):
    return {
        "name": slug + "-r2-flat-fill-candidate",
        "character": slug,
        "mode": "new_character",
        "aspect": "2:3",
        "seed": "refs/base/base.png",
        "delta": M.cast_delta(slug, who, identity + R.NO_EARS),
    }


PROPORTION_LAW = (
    "PROPORTION LAW: every figure is SQUAT, only 3 to 3.5 heads tall, matching the channel's "
    "base rig - a large round head on a short compact body with short legs. No figure is lanky "
    "and no figure is 4 or more heads tall. ")
CROWD_DELTA = M.CROWD_DELTA.replace(
    "full body, all facing the viewer. ",
    "full body, all facing the viewer. " + PROPORTION_LAW,
    1,
)


SPECS = {
    "return-customer": _cast_spec("return-customer", RETURN_WHO, RETURN_IDENTITY),
    "brick-co-seller": _cast_spec("brick-co-seller", SELLER_WHO, SELLER_IDENTITY),
    "hr-officer": _cast_spec("hr-officer", HR_WHO, HR_IDENTITY),
    "crowd-exemplar": {
        "name": "crowd-exemplar-reroll-candidate",
        "character": "base",
        "mode": "environment",
        "aspect": "4:3",
        "seed": "refs/base/base.png",
        "delta": CROWD_DELTA,
    },
}


def run(spec, dry=False):
    assert all(ord(c) < 128 for c in spec["delta"]), "delta must be ASCII-only"
    cmd = [sys.executable, M.FORGE, "gen", "--kit", M.KIT, "--mode", spec["mode"],
           "--aspect", spec["aspect"], "--name", spec["name"], "--character", spec["character"],
           "--seed", spec["seed"], "--delta", spec["delta"]]
    if dry:
        cmd.append("--dry-run")
    try:
        result = subprocess.run(cmd, cwd=M.ORG, capture_output=True, text=True, timeout=240)
    except subprocess.TimeoutExpired:
        print("STATUS=STALL")
        return "STALL"
    output = (result.stdout or "") + (result.stderr or "")
    print(output[-2400:])
    if result.returncode == 0:
        print("STATUS=OK")
        return "OK"
    if "429" in output and "FreeTier" in output and "limit: 0" in output:
        print("STATUS=BILLING_429")
        return "BILLING_429"
    print("STATUS=FAIL")
    return "FAIL"


def main():
    live = "--live" in sys.argv
    keys = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(keys) != 1 or keys[0] not in SPECS:
        raise SystemExit("usage: t16_mint.py [--live] return-customer|brick-co-seller|hr-officer|crowd-exemplar")
    spec = SPECS[keys[0]]
    print("NAME=" + spec["name"])
    print("DELTA=" + spec["delta"])
    run(spec, dry=not live)


if __name__ == "__main__":
    main()

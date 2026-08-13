"""Task 14 - the ONE sanctioned retry per failed frame.

Each retry is SURGICAL: it rewrites only the clause the verifier pair failed, and holds every
other byte of the original delta. Any frame that fails again is PARKED with a mechanism
diagnosis - no agent clears its own park.

t14_mint.py is imported rather than copied, so the unchanged clauses are literally the same
strings that produced attempt 1 (a retyped "identical" delta is how a second variable sneaks
into a one-variable test).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import t14_mint as M  # noqa: E402

# ---------------------------------------------------------------- trial-judge
# FAILED: identity_per_registry (verifier A). The lenses came back as complete round/oval
# wire frames with rim above AND below the pupil - ordinary glasses worn low - where the
# registry pins "half-moon reading spectacles low on the nose". Position was already right;
# only the LENS SHAPE is wrong, so only the spectacles clause changes.
JUDGE_IDENTITY_R1 = (
    "close-cropped white hair, clean-shaven, jowly build, flat head tone #e8c9a8; costume is a "
    "black judicial robe over a white wing collar, with HALF-MOON reading spectacles: each lens "
    "is a shallow crescent, cut FLAT and STRAIGHT across its TOP edge with NO wire rim above the "
    "lens at all, curving only along the bottom, and the pair sits LOW on the nose so both eyes "
    "look OVER the flat top edge of the lenses with clear bare skin between the eyebrows and the "
    "top of the frames. Not round glasses, not oval glasses, not full-rim glasses.")

# -------------------------------------------------------------- crowd-exemplar
# FAILED: proportion / head_shape. Attempt 1 came back at realistic adult proportions (~6-7
# heads tall, small oval heads) against the base rig's squat ~3.5 heads.
#
# MECHANISM, not a re-roll. Attempt 1 already ASKED for the squat proportion in prose ("the
# EXACT same squat head-to-body proportion as the reference image") and the generator ignored
# it across six figures. Prose lost because the only seed carrying geometry was base.png - a
# SINGLE figure - and nothing in the slate showed what a squat CROWD ROW looks like. Also
# `--mode environment` does not inject forge's family-rig block (that is the identity/
# new_character path), so the rig had no structural voice in the prompt at all.
#
# The fix routes geometry from a seed that HAS it: the channel's standing crowd exemplar
# refs/base/crowd-exemplar.png is exactly a squat six-figure crowd row, and it carries a
# PASSING digest-current store record. It leads the seed list for form; base.png follows.
# Its PERIOD DRESS is explicitly overridden in prose (bible 2d: "The seed reference
# contributes ONLY this head/face/hand simplification, NEVER its own clothing") - that frame
# is 19th-century, so the delta has to refuse its costume by name or the era leaks.
CROWD_DELTA_R1 = (
    "A crowd-rig reference sheet: SIX anonymous background figures standing in a loose row, "
    "full body, all facing the viewer. "
    "PROPORTION AND FORM come from the FIRST reference image and are copied EXACTLY: each "
    "figure is SQUAT and CHILD-LIKE in proportion - a LARGE round head roughly ONE THIRD of "
    "the figure's total height, sitting on a SHORT compact body, so the whole figure stands "
    "only about THREE AND A HALF HEADS TALL. The head is a ROUND NEAR-CIRCLE, only slightly "
    "taller than wide - never an egg, never an oval, never a small realistic head. These are "
    "NOT realistically proportioned adults and NOT tall or lanky figures. "
    "Every one of the six has the SIMPLIFIED crowd face copied from the FIRST reference image: "
    "plain DOT EYES, ONE simple neutral closed mouth, NO nose, NO ears, NO teeth, no eyebrows, "
    "no individuated features. Apply this identical simplified face to EVERY figure without "
    "exception; a single detailed or individuated face anywhere in the group is a failure. "
    "Hands, where visible, are the same four-digit cartoon hand. "
    "IGNORE THE CLOTHING of the FIRST reference image completely - it is the wrong century and "
    "contributes NOTHING but head, face, hand and proportion. No top hats, no bonnets, no "
    "shawls, no long full skirts, no breeches, no 19th-century dress of any kind. "
    "HEAD TONES: use ONLY these three flat tones across the six figures, repeating - #f5ead6, "
    "#e2b78c and #7a4f33. Never one uniform tone for the whole group, and never a tone invented "
    "for an individual figure. "
    "HAIR: at most THREE repeating simple silhouettes across the whole group, repeating - short "
    "side-parted hair, a short curly cap of hair, and hair pinned up. Never a distinct hairstyle "
    "invented per individual figure. "
    "ERA DRESS: 1980s American workplace, the ordinary mid-decade register - plain shirt-sleeved "
    "office and factory clothes, open-collar shirts, plain knitwear, plain trousers and simple "
    "skirts, flat everyday shoes. Muted ordinary colours. No lettering, no logos, no badges, no "
    "brand marks, no slogans anywhere. No hats. "
    "All six stand straight and neutral, arms at their sides, carrying nothing. " + M.BG)

# ------------------------------------------------------- the systematic EAR leak
# FAILED: no_nose_no_ears (verifier B) on drive-maker, return-customer, brick-co-seller,
# hr-officer. One shared mechanism, not four coincidences: every failing frame is one whose
# PINNED costume or hair draws the eye to the side of the skull - a flat cap, a beanie pushed
# back, a wide straw hat, hair pinned up into a bun. Each of those exposes the ear line, and
# the generator filled it in. The three frames with no headwear and no swept-back hair
# (bond-investor, tv-chef, trial-judge) all passed the axis untouched.
#
# Attempt 1 leaned on forge's family-rig block ("NO nose, NO ears") to carry this, which is
# true but sits ~1000 chars upstream of the costume sentence that invites the ear. The retry
# states the ban a second time, locally, right where the defect is generated - and says what
# to draw INSTEAD (bare skin down to the jawline), because a pure negation gives the generator
# nothing to put there. brick-co-seller additionally leaked a nose, so its clause names both.
NO_EARS = (" CRITICAL FACE RULE, overriding anything the costume suggests: this character has "
           "NO EARS AT ALL and NO NOSE AT ALL. Draw NO ear on either side of the head - not "
           "under the headwear, not beside the hair, not in front of it. The sides of the head "
           "are smooth bare skin running unbroken down to the jawline, with no ear shape, no "
           "ear outline and no inner-ear line anywhere. Draw NO nose - no nose shape, no bridge, "
           "no nostril line, no shading where a nose would be. The face carries ONLY eyes, "
           "brows and a mouth.")

EAR_FRAMES = ["drive-maker", "return-customer", "brick-co-seller", "hr-officer"]


def _ear_retry(slug):
    who, ident = next((w, i) for s, w, i in M.CAST if s == slug)
    return dict(name=f"{slug}-r1", character=slug, mode="new_character", aspect="2:3",
                seed="refs/base/base.png",
                delta=M.cast_delta(slug, who, ident + NO_EARS))


RETRIES = {
    "trial-judge": dict(
        name="trial-judge-r1", character="trial-judge", mode="new_character", aspect="2:3",
        seed="refs/base/base.png",
        delta=M.cast_delta("trial-judge", "the trial judge", JUDGE_IDENTITY_R1)),
    "crowd-exemplar": dict(
        name="crowd-exemplar-r1", character="base", mode="environment", aspect="4:3",
        seed="refs/base/crowd-exemplar.png,refs/base/base.png",
        delta=CROWD_DELTA_R1),
}
for _s in EAR_FRAMES:
    RETRIES[_s] = _ear_retry(_s)

# crowd-exemplar PASSED both verifiers (8/8 axes A, 7/7 axes B) and is NOT retried. Its entry
# stays here only as the recorded diagnosis of a concern the executor raised and then measured
# down - see the task-14 report.
DEFAULT = ["trial-judge"] + EAR_FRAMES


def run(spec, dry):
    cmd = [sys.executable, M.FORGE, "gen", "--kit", M.KIT, "--mode", spec["mode"],
           "--aspect", spec["aspect"], "--name", spec["name"], "--character", spec["character"],
           "--seed", spec["seed"], "--delta", spec["delta"]]
    if dry:
        cmd.append("--dry-run")
    assert all(ord(c) < 128 for c in spec["delta"]), f"{spec['name']}: non-ASCII in delta"
    import subprocess
    try:
        r = subprocess.run(cmd, cwd=M.ORG, capture_output=True, text=True, timeout=240)
    except subprocess.TimeoutExpired:
        print(f"  !! {spec['name']}: STALLED past 240s - killed at the ceiling")
        return "STALL"
    print((r.stdout or "")[-700:])
    if r.returncode != 0:
        print((r.stderr or "")[-700:])
        return "FAIL"
    return "OK"


def main():
    dry = "--live" not in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    keys = only or DEFAULT
    print(f"=== {'DRY' if dry else 'LIVE'} retry run: {keys} ===")
    for k in keys:
        spec = RETRIES[k]
        print(f"\n--- {spec['name']} ({spec['mode']}, {spec['aspect']}, "
              f"{len(spec['delta'])} chars, seeds={spec['seed']}) ---")
        print(f"  {spec['name']}: {run(spec, dry)}")


if __name__ == "__main__":
    main()

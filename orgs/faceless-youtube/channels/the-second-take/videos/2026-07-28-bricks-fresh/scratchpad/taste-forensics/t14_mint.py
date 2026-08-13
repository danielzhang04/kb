"""Task 14 Pass-1 mint driver - the 7 new cast canonicals + this video's crowd exemplar.

PATH. The sanctioned cast-generation wave: `forge.py gen --mode new_character --seed
refs/base/base.png`. That ad-hoc `--seed` form is the ONE P3 call-site exemption
(forge.py:3133-3136 "The ad-hoc --seed form above IS the cast-generation wave / single-asset
loop, exempt by the G2 ruling"), and it is the right one here: these are GENUINE new-character
mints with no prior identity frame, so the only seed is the template base, and `base.png`
carries no review record - a gated `gen --batch` would refuse it.

That is the difference from task 12. Task 12 RE-minted existing canonicals, so it could route
identity from a second seed (the character's own prior frame) and go through `--batch`. Here
there is nothing to route from: identity is stated in prose, transcribed from each character's
`registry.json` characters{} row (head_tone + the PINNED costume), and form (resting face,
resting stance, flat cel, four-digit hands) comes from the base template seed. forge's own base
prompt already states the resting invariant for this case ("except when THIS generation is
itself a new-character canonical mint, where the resting expression and resting stance are
invariants inherited from the base").

ASCII-ONLY deltas, deliberately: argv on this box goes through a Windows codepage, so a stray
em-dash or curly quote can be mangled in transit. Task 12 dodged that by using --batch (a UTF-8
file); --batch is gated, so this run pays for the exemption with plain ASCII instead.

Stall policy: 4-minute ceiling per gen, one re-issue (memory: image-gen-stall-policy).
"""
import io
import os
import subprocess
import sys

WT = r"C:\Users\danie\kb-worktrees\boss-taste-forensics"
ORG = os.path.join(WT, "orgs", "faceless-youtube")
KIT = "channels/the-second-take/visual-kit"
FORGE = os.path.join(ORG, ".claude", "skills", "image-generation", "scripts", "forge.py")
STAGING = os.path.join(ORG, KIT, "_staging")

REST_FACE = (
    "RESTING FACE (copy EXACTLY from the reference image, the bald template): heavy lowered "
    "upper eyelids covering the top of each eye, small pupils set high against the upper lid, "
    "thin level gently-arched brows, and a small closed mouth with the faintest upturn at its "
    "corners. Eyes look straight out at the viewer, level and symmetric, not sideways, not up, "
    "not down.")
REST_STANCE = (
    "RESTING STANCE (copy EXACTLY from the reference image): standing straight and frontal, "
    "facing the viewer square-on, both shoulders level, both arms hanging straight down at the "
    "sides, both hands open, relaxed and EMPTY, feet flat and evenly planted. Carries NOTHING "
    "and touches nothing. No emotion of any kind, completely neutral and at rest.")
ANTI_REAL = ("Flat stylized cartoon skull - no jaw, no cheekbones, no realistic face structure.")
BG = ("Plain flat light-grey studio background, no horizon line, no floor line, no props, "
      "no text.")

# IDENTITY strings transcribed from registry.json characters{} rows (head_tone + PINNED costume).
CAST = [
    ("drive-maker",
     "the hard-drive trade personified",
     "short sandy hair, clean-shaven, wiry build, flat head tone #dba97d; costume is a brown "
     "knee-length warehouse coat worn open over a plain collarless shirt, a flat cap, mid-brown "
     "trousers and work boots. The breast pocket is left plain and the collar is open at the "
     "throat. No badge, no tie, no other accessory."),
    ("bond-investor",
     "the MiniScribe bondholder",
     "thin grey hair combed over, clean-shaven, slight build, flat head tone #f0d3b4; costume is "
     "a fawn knitted cardigan over an open-collar shirt, brown corduroy trousers and tartan "
     "slippers, with wire-rimmed spectacles. The tartan slippers are load-bearing and must be "
     "clearly visible on both feet."),
    ("return-customer",
     "the complicit distributor",
     "dark beard, broad build, flat head tone #b07f55; costume is a navy quilted delivery coat "
     "with the breast patch left plain and unlettered, dark trousers, heavy boots, and a knitted "
     "navy beanie pushed back on the head. No lettering, no logo, no company mark anywhere."),
    ("brick-co-seller",
     "the Colorado brick seller",
     "greying moustache, weathered look, sturdy build, flat head tone #c98a5c; costume is a "
     "dusty tan work shirt with the sleeves rolled, a heavy canvas apron, a wide-brimmed straw "
     "hat worn square on the head, dark work trousers and boots."),
    ("tv-chef",
     "a generic television kitchen-rescue host",
     "cropped fair hair, clean-shaven, heavy build, bare-headed, flat head tone #f4d9c0; costume "
     "is a double-breasted white chef's jacket with the sleeves shoved to the elbow, a mid-blue "
     "apron tied at the waist and dark checked trousers. A GENERIC archetype only - not a "
     "likeness of any real person."),
    ("trial-judge",
     "the trial judge",
     "close-cropped white hair, clean-shaven, jowly build, flat head tone #e8c9a8; costume is a "
     "black judicial robe over a white wing collar, with half-moon reading spectacles sitting "
     "low on the nose."),
    ("hr-officer",
     "the HR officer, a woman",
     "dark hair pinned up, slight build, flat head tone #e0b48d; costume is a rust-red knitted "
     "cardigan over a cream blouse, a long tweed skirt and flat shoes, with reading spectacles "
     "hanging on a chain at the chest."),
]


def cast_delta(slug, who, identity):
    return (f"A full-body standing character reference sheet of ONE cast member, {who}. "
            f"IDENTITY: {identity} {ANTI_REAL} {REST_FACE} {REST_STANCE} {BG}")


# The per-video crowd exemplar. Anchor, not a uniform (SKILL.md:64-70): it fixes rig discipline,
# the 2-3 flat head tones and the era; each scene still dresses its OWN crowd (bible 2d).
# Head tones are 2-3 drawn FROM THIS VIDEO'S CAST SET: #f5ead6 (terry-johnson),
# #e2b78c (miniscribe-rep), #7a4f33 (ibm-suit).
CROWD_DELTA = (
    "A crowd-rig reference sheet: SIX anonymous background figures standing in a loose row, "
    "full body, all facing the viewer. "
    "These are CROWD figures, not foreground cast: every one of the six has the SIMPLIFIED crowd "
    "face - plain DOT EYES, ONE simple neutral closed mouth, NO nose, NO ears, NO teeth, no "
    "eyebrows, no individuated features. Apply this identical simplified face to EVERY figure "
    "without exception; a single detailed or individuated face anywhere in the group is a "
    "failure. "
    "PROPORTION is the EXACT same squat head-to-body proportion as the reference image - a large "
    "round head on a short compact body, NOT taller, NOT lanky. Hands, where visible, are the "
    "same four-digit cartoon hand. "
    "HEAD TONES: use ONLY these three flat tones across the six figures, repeating - #f5ead6, "
    "#e2b78c and #7a4f33. Never one uniform tone for the whole group, and never a tone invented "
    "for an individual figure. "
    "HAIR: at most THREE repeating simple silhouettes across the whole group, repeating - short "
    "side-parted hair, a short curly cap of hair, and hair pinned up. Never a distinct hairstyle "
    "invented per individual figure. "
    "ERA DRESS: 1980s American workplace, the ordinary mid-decade register - plain shirt-sleeved "
    "office and factory clothes, open-collar shirts, plain knitwear, plain trousers and simple "
    "skirts, flat everyday shoes. Muted ordinary colours. No lettering, no logos, no badges, no "
    "brand marks, no slogans anywhere. No hats. No period costume from any other decade. "
    "All six stand straight and neutral, arms at their sides, carrying nothing. "
    + BG)


def run(name, character, mode, aspect, delta, timeout=240):
    cmd = [sys.executable, FORGE, "gen", "--kit", KIT, "--mode", mode, "--aspect", aspect,
           "--name", name, "--character", character, "--seed", "refs/base/base.png",
           "--delta", delta]
    if DRY:
        cmd.append("--dry-run")
    assert all(ord(c) < 128 for c in delta), f"{name}: non-ASCII in delta"
    try:
        r = subprocess.run(cmd, cwd=ORG, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"  !! {name}: STALLED past {timeout}s - killed at the ceiling")
        return "STALL"
    tail = (r.stdout or "")[-900:]
    print(tail)
    if r.returncode != 0:
        print((r.stderr or "")[-900:])
        return "FAIL"
    return "OK"


DRY = "--live" not in sys.argv
ONLY = [a for a in sys.argv[1:] if not a.startswith("--")]


def main():
    print(f"=== {'DRY' if DRY else 'LIVE'} run ===")
    items = [(s, "new_character", "2:3", cast_delta(s, w, i)) for s, w, i in CAST]
    items.append(("crowd-exemplar", "environment", "4:3", CROWD_DELTA))
    if ONLY:
        items = [it for it in items if it[0] in ONLY]
        assert items, f"no item matched {ONLY}"
    out = {}
    for name, mode, aspect, delta in items:
        print(f"\n--- {name} ({mode}, {aspect}, {len(delta)} chars) ---")
        character = name if mode == "new_character" else "base"
        out[name] = run(name, character, mode, aspect, delta)
    print("\n=== summary ===")
    for k, v in out.items():
        print(f"  {k}: {v}")
    if not DRY:
        print("\nstaged files:")
        for k in out:
            p = os.path.join(STAGING, k + ".png")
            print(f"  {k}.png {'EXISTS' if os.path.isfile(p) else 'MISSING'}")


if __name__ == "__main__":
    main()

"""Build the Phase-6B fresh-eyes review board over the 23 generated first-tenth scenes.

The stock `build_review_artifact.py` CLI does not fit: its scene cards are collected from
`<video>/assets/scenes|plates/`, which now holds only the 8 PROMOTED board-approved plates, while
these 23 candidates live in `<kit>/_staging` awaiting this very review. `--staging` would also add a
card for every pending `fig-*` in the channel-wide staging dir, none of which this slice minted.

So this driver IMPORTS that module and calls its own `collect` helpers, `build()` renderer and
`figure_verdict_skeleton()` — the board and the skeleton come from the tool's own code paths, not
hand-rolled HTML or a hand-typed schema. Only the CARD SELECTION is ours.

Each card carries the candidate beside its RESOLVED SEED REFS (the frames forge actually sent,
including the promoted place plate where one applies), so the verifier rules the frame against the
exact inputs that produced it. Saturation is MEASURED here from the bytes on disk, never
transcribed by hand.

Every verdict is left EMPTY: the fresh-eyes verifier fills them, the boss stamps.
"""
import io, json, os, sys
import numpy as np
from PIL import Image

ORG = r"C:\Users\danie\kb\orgs\faceless-youtube"
SCRIPTS = os.path.join(ORG, r".claude\skills\image-generation\scripts")
sys.path.insert(0, SCRIPTS)
import build_review_artifact as B  # noqa: E402

VIDEO = os.path.join(ORG, r"channels\the-second-take\videos\2026-07-28-bricks-fresh")
KIT = os.path.join(ORG, r"channels\the-second-take\visual-kit")
STAGING = os.path.join(KIT, "_staging")
SCENES = os.path.join(VIDEO, "assets", "scenes")
SCRATCH = os.path.join(VIDEO, "scratchpad")

SLICE1 = ["L01", "L02", "L04", "L11", "L12", "L13", "L14",
          "L15", "L16", "L17", "L18", "L19", "L20", "L21"]
# L08, L10 and L22 never rendered — three successive provider HTTP 503 waves (sustained demand
# spike, not a content defect). L23/L24/L25 are chain dependents of L22 and were never attempted.
SLICE2 = ["L06", "L07", "L09"]
GENERATED = sorted(SLICE1 + SLICE2, key=lambda s: int(s[1:]))
PROMOTED = ["L03", "L05"]           # in-slice board-approved plates, shown as CONTEXT not targets
REISSUED = {"L19", "L20"}           # transient provider 503, one re-issue, landed

NOTE = {
    "L06": "ANOMALY for your ruling: a SECOND '1983' card appears as a tent card on the counter; "
           "the authored prompt states only 'the window card carrying 1983'. Duplicated diegetic "
           "literal — the frame's one sanctioned retry was deliberately NOT spent, so it is yours.",
}


def measure(path):
    im = Image.open(path); im.load()
    w, h = im.size
    s = np.asarray(im.convert("RGB").convert("HSV"), dtype=np.float32)[:, :, 1] / 255.0
    return w, h, os.path.getsize(path) / 1024.0, float(np.median(s))


def resolve(seed):
    """A spec seed path is stored relative to the kit root, the org root, or the video."""
    for base in (KIT, ORG, VIDEO):
        p = os.path.join(base, seed.replace("/", os.sep))
        if os.path.exists(p):
            return p
    return None


slate = {}
for f in ("p6b-slate.json", "p6b-slate2.json"):
    for i in json.load(io.open(os.path.join(SCRATCH, f), encoding="utf-8")):
        slate[i["name"]] = i

S = B.shot_index(VIDEO)
M = B.motion_index(VIDEO)
LIB = B.library_assets(VIDEO)
named_by_shot = B.named_figures_by_shot(LIB)
seated = B.seated_shots(S, B.identity_names(LIB))
canon_file = B.canonical_files(LIB)
owner_of = B.owner_literal_by_place(S.values())

cards = []

# The two in-slice promoted plates lead the board as CONTEXT: the verifier must be able to judge
# continuity of L06-L10 / L22-L25 against the exact plate they inherited.
for sid in PROMOTED:
    path = os.path.join(SCENES, sid + ".png")
    if not os.path.exists(path):
        raise SystemExit("missing promoted plate: " + path)
    w, h, kb, sat = measure(path)
    s = S.get(sid, {})
    cards.append(dict(
        sid=sid, label="PROMOTED place plate — CONTEXT, already approved (do not re-rule)",
        path=path, cls=s.get("shot_class") or "", vo=s.get("vo_text") or "",
        anim=B.describe_animation(M.get(sid)), flagged=False,
        reason="Daniel board-v2 approved, promoted to assets/scenes/ and stamped `verified` "
               "(%dx%d, %.0fKB, median sat %.4f). Shown so the candidates that inherit this place "
               "can be judged for continuity against it. NOT a target of this review."
               % (w, h, kb, sat),
        review_status="verified",
        invariants=[], canon=[],
    ))

for sid in GENERATED:
    s = S.get(sid, {})
    item = slate[sid]
    path = os.path.join(STAGING, sid + ".png")
    if not os.path.exists(path):
        raise SystemExit("missing staged candidate: " + path)
    w, h, kb, sat = measure(path)

    refs = []
    for role in item.get("seed_roles") or []:
        rp = resolve(role["path"])
        if rp:
            label = "%s — %s" % (os.path.splitext(os.path.basename(rp))[0],
                                 role.get("role") or "seed")
            if role.get("character"):
                label += " (%s)" % role["character"]
            if os.path.normpath(os.path.dirname(rp)) == os.path.normpath(SCENES):
                label += " [PROMOTED PLATE]"
            refs.append((label, rp))
    for n in named_by_shot.get(sid, []):
        if n in canon_file and os.path.exists(canon_file[n]) and \
                not any(canon_file[n] == p for _, p in refs):
            refs.append((n + " — canonical", canon_file[n]))

    seedtxt = ", ".join(os.path.splitext(os.path.basename(r["path"]))[0]
                        for r in (item.get("seed_roles") or [])) or "ROOT-TEXT (zero-seed plate)"
    reason = ("PHASE-6B candidate, staged, NOT promoted. %dx%d @1K/16:9, %.0fKB, era 2-voice prompt "
              "(§2b descriptor head + era suffix tail). Seeds sent: %s. parent_depth=%s lineage=%s. "
              "Median HSV saturation %.4f (R1 tripwire floor 0.10).%s%s"
              % (w, h, kb, seedtxt, item.get("parent_depth"), item.get("lineage"), sat,
                 "  RE-ISSUED once after a transient provider HTTP 503; this is attempt 2."
                 if sid in REISSUED else "",
                 "  " + NOTE[sid] if sid in NOTE else ""))

    cards.append(dict(
        sid=sid, label="scene (staged candidate, not yet promoted)", path=path,
        cls=s.get("shot_class") or "", vo=s.get("vo_text") or "",
        anim=B.describe_animation(M.get(sid)),
        flagged=sid in NOTE,
        reason=reason,
        review_status="unreviewed",
        invariants=B.applicable_invariants(s, sid, named_by_shot.get(sid, []), seated, owner_of),
        canon=refs,
    ))

page, nb = B.build(
    cards,
    "bricks-fresh — Phase 6B fresh-eyes board (first tenth, L01-L25)",
    "17 generated candidates + the 2 in-slice PROMOTED plates shown as context · 6 shots undelivered "
    "(L08/L10/L22 provider 503; L23-L25 chain dependents) · 0 STEP-1 figures minted this slice · verdicts "
    "EMPTY — the fresh-eyes verifier rules, the boss stamps",
    1600, 82)
out_html = os.path.join(SCRATCH, "p6b-board.html")
io.open(out_html, "w", encoding="utf-8").write(page)

# This slice minted ZERO STEP-1 figures (forge reused every figure from an all-pass,
# digest-current C-6 record), so the skeleton is legitimately empty — emitted anyway, through the
# tool's own schema, so the closing `stamp_review.py --figures` step has its documented input.
skel = B.figure_verdict_skeleton([], reviewer="")
out_json = os.path.join(SCRATCH, "p6b-figures.json")
with io.open(out_json, "w", encoding="utf-8") as f:
    json.dump(skel, f, ensure_ascii=False, indent=1)
    f.write("\n")

print("board: %s (%d cards, %.1f MB inlined, %.1f MB page)"
      % (out_html, len(cards), nb / 1e6, os.path.getsize(out_html) / 1e6))
print("figures: %s (%d figures — this slice minted no STEP-1)" % (out_json, len(skel["figures"])))
sats = [measure(os.path.join(STAGING, s + ".png"))[3] for s in GENERATED]
print("candidates: %d · saturation range %.4f – %.4f" % (len(sats), min(sats), max(sats)))

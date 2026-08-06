"""Build the Phase-6B fresh-eyes review board over the first-tenth scenes (L01-L25).

The stock `build_review_artifact.py` CLI does not fit: its scene cards are collected from
`<video>/assets/scenes|plates/`, which holds only the PROMOTED frames, while the candidates awaiting
review live in `<kit>/_staging`. `--staging` would also add a card for every pending `fig-*` in the
channel-wide staging dir, none of which this slice minted.

So this driver IMPORTS that module and calls its own `collect` helpers, `build()` renderer and
`figure_verdict_skeleton()` — the board and the skeleton come from the tool's own code paths, not
hand-rolled HTML or a hand-typed schema. Only the CARD SELECTION is ours.

Each card carries the frame beside its RESOLVED SEED REFS (the frames forge actually sent, including
the promoted place plate where one applies), so the verifier rules it against the exact inputs that
produced it. Saturation is MEASURED here from the bytes on disk, never transcribed by hand.

Board composition (2026-08-06, round-3 corrections pass):
  * 2 promoted in-slice place plates — CONTEXT, already approved, not re-ruled
  * every candidate carries its stamped verdict read from the scenes manifest
  * a PARKED frame is immediately followed by its SUCCESSORS in generation order, so a whole repair
    lineage (original -> round-1 retry -> round-3 re-issue/re-mint) reads as one run of cards
  * 5 round-3 frames — L10-retry1, L23-retry1, L24-retry1, L25-retry1, L16-remint1 — never reviewed
Every verdict checklist is EMPTY (the module emits them empty by construction, C-12): the fresh-eyes
verifier fills them, the boss stamps. Nothing here stamps anything — `stamp_review.py` is the only
writer of a verdict, and it is not run by this pass.
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
SLICE2 = ["L06", "L07", "L09"]
# Minted 2026-08-06 in the post-cooldown resume lane, after the provider recovered. L08 is NOT here:
# it stays doctrine-blocked on its PARKED parent L07 and was deliberately never generated.
RESUME = ["L10", "L22", "L23", "L24", "L25"]
GENERATED = sorted(SLICE1 + SLICE2 + RESUME, key=lambda s: int(s[1:]))
PROMOTED = ["L03", "L05"]           # in-slice board-approved plates, shown as CONTEXT not targets
REISSUED = {"L19", "L20"}           # transient provider 503, one re-issue, landed

# The L03 night plate is human-approved (Daniel's R3 night-scene exception) at a median saturation
# BELOW the R1 tripwire floor. Its inheritors are judged against IT, not against the flat floor.
L03_BASELINE = 0.0902
NIGHT = {"L22", "L23", "L24", "L25"}

NOTE = {
    "L22": "NIGHT SHOT — inherits the approved L03 night plate (baseline median sat %.4f). Its own "
           "median sat lands on that baseline to four decimals, so the sub-0.10 reading is AUTHORED "
           "DARKNESS, not an R1 grey-drain. Ink R-B +4.1 against L03's own +3.8 — the plate's warm "
           "register inherited almost exactly." % L03_BASELINE,
    "L23": "NIGHT SHOT — same L03 lineage; sub-0.10 but ABOVE the %.4f baseline. Second of two "
           "consecutive sub-0.10 frames: the literal R1 tripwire condition, correctly NOT fired "
           "because the authored register here is night." % L03_BASELINE,
    "L24": "NIGHT SHOT — same L03 lineage; saturation climbing back above the floor.",
    "L25": "NIGHT SHOT — same L03 lineage, deepest beat of the chain. ANOMALY FOR YOUR EYE: across "
           "L22->L25 the mean ink luminance falls 5.9 -> 4.3 -> 2.9 -> 1.7 and ink R-B falls +4.1 -> "
           "+3.9 -> +3.1 -> +1.9. Every frame stays WARM so this is NOT the R1 cool inversion, and no "
           "single frame is out of register alone, but the trend is monotonic and generational — each "
           "delta re-seeding its predecessor appears to compound a slight ink darkening. L25 is where "
           "the ink sits nearest pure black. Flagged, not adjudicated; no retry spent.",
    "L10": "Resume-lane canary. Seeds the promoted L05 shop plate; judge continuity against the L05 "
           "context card at the top of this board.",
}

# A parked frame's repair lineage, in generation order. Each successor is a separate card that
# follows its predecessor on the board so the whole run reads together.
ROUND_OF = {"L06-retry1": "2", "L07-retry1": "2", "L16-retry1": "2", "L18-retry1": "2",
            "L10-retry1": "3", "L23-retry1": "3", "L24-retry1": "3", "L25-retry1": "3",
            "L16-remint1": "3"}

SUCCESSORS = {
    "L06": ["L06-retry1"],
    "L07": ["L07-retry1"],
    "L16": ["L16-retry1", "L16-remint1"],
    "L18": ["L18-retry1"],
    "L10": ["L10-retry1"],
    "L23": ["L23-retry1"],
    "L24": ["L24-retry1"],
    "L25": ["L25-retry1"],
}

# Each parked frame's surgical retry: authored as a `forge-retry-overlay@2` manifest, $0-validated at
# changed_spans=1 (exactly one exact-replace authority, every passing clause byte-identical), then
# FIRED 2026-08-06. Retry frames get NO stamp — they return here for fresh eyes.
RETRY_BUILT = {
    "L06-retry1": "ROUND-1 RETRY of L06 — replaces the '1983' window-card clause: that card is the "
                  "ONLY '1983' in frame, no tent card.",
    "L07-retry1": "ROUND-1 RETRY of L07 — replaces the Framing/palette/queue span: counter ACROSS "
                  "the foreground at counter height, crate ON the counter's near end, every note "
                  "gripped by a visible hand and arm, lettering complete.",
    "L16-retry1": "ROUND-1 RETRY of L16 — replaces 'Palette beige on grey.': cases warm beige "
                  "~#d8c9a3 against a cool grey room, outline WARM brown-black #241a12 and never a "
                  "cool blue-black.",
    "L18-retry1": "ROUND-1 RETRY of L18 — replaces the 'Only this changes:' sentence: slabs STAND "
                  "VERTICALLY ON END (never flat or splayed), the parent's plate glass / red "
                  "contact arc / spotlight / case proportion held, the SAME 1980s crowd, red "
                  "semantic only. Seeds the promoted verified scenes/L17.png.",
    "L10-retry1": "ROUND-3 RETRY of L10 — one exact-replace ($0-validated at changed_spans=1) on "
                  "the queue/framing span: the whole overnight queue and every one of its props "
                  "(folding chairs, sleeping bags, flasks, the kerb, the breath in the cold) "
                  "stands OUTSIDE on the pavement beyond the glass; the shop interior is EMPTY of "
                  "people and camping gear; the camera stands BEHIND the counter looking OUT "
                  "through the shopfront. Seeds the promoted verified scenes/L05.png.",
    "L23-retry1": "ROUND-3 RETRY of L23 — one exact-replace ($0-validated at changed_spans=1) on "
                  "the 'Only this changes:' sentence: the opened carton is ONE OF THE RANKED "
                  "CARTONS THE PARENT ALREADY DREW at exactly that carton's size (~1/3 of the "
                  "pallet's width, flaps inside the same footprint, never pallet-width, never "
                  "swallowing the row), and the brick FILLS IT corner to corner. RE-BASED onto the "
                  "PROMOTED VERIFIED scenes/L22.png — round 2 seeded the unreviewed _staging copy.",
    "L24-retry1": "ROUND-3 RE-ISSUE of L24 — TWO authorities, which forge's retry overlay "
                  "structurally cannot express in one entry (`_retry_scene` permits exactly one), "
                  "so this was authored as a slate off forge's OWN native L24 request: (1) RE-BASE "
                  "onto the fresh corrected parent _staging/L23-retry1.png — forge's walk resolved "
                  "NO parent at all for L24, because `on_disk()` looks only in assets/scenes/ and "
                  "parked L23 was never promoted; (2) one exact single-occurrence replace (bytes "
                  "outside the span asserted identical) pinning ranked-carton scale for the whole "
                  "row AND the held crew wardrobe — same people, poses and clothes, all "
                  "bare-headed, no gained hat, hood, hair, collar or tie.",
    "L25-retry1": "ROUND-3 RE-ISSUE of L25 — same two-authority slate form: (1) RE-BASE onto the "
                  "fresh _staging/L24-retry1.png; (2) one exact replace pinning 'HARD DRIVE' on "
                  "EVERY open carton visible in frame (front and receding in depth, each lettered "
                  "at its own size, none left blank) plus the same held-crew-wardrobe clause.",
    "L16-remint1": "ROUND-3 CHANGED-MECHANISM RE-MINT of L16 — NOT a second retry. Built from "
                   "L16's ORIGINAL p6b-slate.json entry, byte-identical in prose and seeds "
                   "(square-to-frame frieze, rank carrying past BOTH frame edges, Tier-A "
                   "de-vantaged, style tile only); only the output name differs. Provenance: L16's "
                   "parking defect was cyan ink (174.2deg / R-B -1.0), a GENERATOR-SIDE fault, and "
                   "the R1 warm-ink fix has since landed across the whole batch — so the original "
                   "staging is re-run under the corrected mechanism rather than re-argued in "
                   "prose. This is the verifier's own round-2 prescription: 'the durable fix is a "
                   "re-issue that keeps the original's staging and inherits the R1 warmth, not "
                   "this frame.'",
}

# What the GENERATOR observed on each frame. Measurement only — no adjudication. The verifier owns
# the verdict; these are the things a fresh eye should be pointed at.
RETRY_OBSERVED = {
    "L06-retry1": "Primary fix LANDED: exactly ONE '1983', on the window card. DRIFT to weigh: the "
                  "crate now sits ON the counter rather than on the floor at its near end. Round 2 "
                  "parked it on that.",
    "L07-retry1": "Round 2 parked it: three of four flagged attributes fixed, but a SECOND oak "
                  "counter with a SECOND brass till appeared — the unauthored-duplicate class.",
    "L16-retry1": "Ink register measured FIXED — 19.7deg / R-B +23.1 (WARM) against the parked "
                  "original's 174.2deg / -1.0 (cyan). BUT the authored square-to-frame shelf came "
                  "back as a DEEP OBLIQUE, a regression on an attribute that PASSED in round 1, "
                  "and round 2 parked it on exactly that. Superseded by L16-remint1, the next card.",
    "L18-retry1": "Round-2 PASS — the one clean recovery of that round; promoted to "
                  "assets/scenes/L18.png. Shown for lineage completeness, not for re-ruling.",
    "L10-retry1": "ANOMALY, TWO OF THEM, both measured and not judged. (1) The authored correction "
                  "did NOT take: the overnight queue with its folding chairs, sleeping bags, "
                  "flasks and visible breath is STILL staged INSIDE the shop, with a thin queue of "
                  "plain figures outside — the same zone inversion round 2 parked — and the camera "
                  "is still in the room rather than behind the counter. (2) THE INK REGISTER "
                  "INVERTED: hue 223.3deg / R-B -1.1 (COOL) against the parked original's 14.4deg "
                  "/ +13.6 (WARM). This is the R1 cool-inversion defect class recurring on a FRESH "
                  "frame, and it is not a sampling artifact — it holds at every sampling depth "
                  "(darkest 3%/1%/0.5% give 223.3/223.7/228.9deg and R-B -1.1/-3.1/-2.7). It is "
                  "the second cool inversion recorded in this video after L16's cyan. Median "
                  "saturation also fell 0.4431 -> 0.2471, still well clear of the 0.10 floor. No "
                  "re-roll was spent.",
    "L23-retry1": "Ink WARM 24.9deg / R-B +3.8 against the promoted parent L22's 36.4deg / +4.1. "
                  "Median sat 0.0980 — NIGHT-SHOT RULE, above the approved L03 baseline of 0.0902. "
                  "PARTIAL on the authored correction, as measurement not verdict: the brick now "
                  "fills a far larger share of the opening than the parked round-2 frame, but the "
                  "opened carton still reads much wider than the ranked cartons flanking it and "
                  "still stands where the centre pallet's top row was. Rule the scale yourself "
                  "against the L22 parent card.",
    "L24-retry1": "Ink WARM 19.5deg / R-B +3.6 — dead on the #241a12 target hue. Median sat 0.1059. "
                  "The WARDROBE correction LANDED: all four packers are bare-headed in the "
                  "parent's clothing, and round 2's gained white head covering, collared shirt, "
                  "tie and grey head covering are gone. Row-wide scale is much closer — several "
                  "separate small open cartons with bricks now stand across the left and right "
                  "pallets — but the oversized centre box inherited from the parent persists.",
    "L25-retry1": "Ink WARM 10.8deg / R-B +2.5, median sat 0.1176 — the chain's highest and still "
                  "climbing, the opposite of a chroma drain. Wardrobe held again. THE LETTERING "
                  "CORRECTION DID NOT TAKE: 'HARD DRIVE' renders exactly three times, once per "
                  "pallet, and it is lettered across the FILM-WRAPPED LOWER COURSES rather than on "
                  "the front face of each open carton — the same count and the same wrong surface "
                  "as the parked round-2 frame. No re-roll spent.",
    "L16-remint1": "THE CLEAN RECOVERY OF THIS PASS, on measurement. Ink 16.5deg / R-B +18.4 — the "
                   "closest any frame in this batch sits to the #241a12 target (~19deg / +18), and "
                   "the cyan inversion that parked the original is gone with NO prose spent on "
                   "colour at all. Median sat 0.1294. Staging observed restored: the shelf face "
                   "reads SQUARE TO THE FRAME with no vanishing point, the rank runs off BOTH "
                   "frame edges, the centre bay is lit from inside, uprights and crossbraces stand "
                   "along the run and flat sleeves stack on the shelf below. Not adjudicated — "
                   "rule it against BOTH cards above.",
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


def seed_refs(item):
    refs = []
    for role in item.get("seed_roles") or []:
        rp = resolve(role["path"])
        if not rp:
            continue
        label = "%s — %s" % (os.path.splitext(os.path.basename(rp))[0], role.get("role") or "seed")
        if role.get("character"):
            label += " (%s)" % role["character"]
        if os.path.normpath(os.path.dirname(rp)) == os.path.normpath(SCENES):
            label += " [PROMOTED PLATE]"
        refs.append((label, rp))
    return refs


slate = {}
for f in ("p6b-slate.json", "p6b-slate2.json", "p6b-slate4.json"):
    for i in json.load(io.open(os.path.join(SCRATCH, f), encoding="utf-8")):
        slate[i["name"]] = i
# Every successor spec, from the round-1 overlay slate, the round-2 overlay slate, and the three
# round-3 corrections slates. Keyed by output name, so a card reads the EXACT spec that produced it.
retry_slate = {}
for f in ("p6b-retry-slate.json", "p6b-retry-slate-r2.json", "p6b-r3-L24-retry1.json",
          "p6b-r3-L25-retry1.json", "p6b-r3-L16-remint1.json"):
    for i in json.load(io.open(os.path.join(SCRATCH, f), encoding="utf-8")):
        retry_slate[i["name"]] = i

MANIFEST = {e['shot_id']: e for e in json.load(
    io.open(os.path.join(SCENES, 'manifest.json'), encoding='utf-8'))['shots']}

S = B.shot_index(VIDEO)
M = B.motion_index(VIDEO)
LIB = B.library_assets(VIDEO)
named_by_shot = B.named_figures_by_shot(LIB)
seated = B.seated_shots(S, B.identity_names(LIB))
canon_file = B.canonical_files(LIB)
owner_of = B.owner_literal_by_place(S.values())

cards = []
counts = dict(verified=0, parked=0, retry=0, new=0, context=0)

# The two in-slice promoted plates lead the board as CONTEXT: the verifier must be able to judge
# continuity of L06-L10 / L22-L25 against the exact plate they inherited.
for sid in PROMOTED:
    path = os.path.join(SCENES, sid + ".png")
    if not os.path.exists(path):
        raise SystemExit("missing promoted plate: " + path)
    w, h, kb, sat = measure(path)
    s = S.get(sid, {})
    extra = ""
    if sid == "L03":
        extra = (" This is the NIGHT plate: its own median saturation %.4f sits BELOW the 0.10 R1 "
                 "floor, approved under Daniel's R3 night-scene exception. L22-L25 inherit it, so "
                 "sub-0.10 readings there are judged against THIS baseline, never halted blind."
                 % sat)
    cards.append(dict(
        sid=sid, label="PROMOTED place plate — CONTEXT, already approved (do not re-rule)",
        path=path, cls=s.get("shot_class") or "", vo=s.get("vo_text") or "",
        anim=B.describe_animation(M.get(sid)), flagged=False,
        reason="Daniel board-v2 approved, promoted to assets/scenes/ and stamped `verified` "
               "(%dx%d, %.0fKB, median sat %.4f). Shown so the candidates that inherit this place "
               "can be judged for continuity against it. NOT a target of this review.%s"
               % (w, h, kb, sat, extra),
        review_status="verified",
        invariants=[], canon=[],
    ))
    counts["context"] += 1

for sid in GENERATED:
    s = S.get(sid, {})
    item = slate[sid]
    path = os.path.join(STAGING, sid + ".png")
    if not os.path.exists(path):
        raise SystemExit("missing staged candidate: " + path)
    w, h, kb, sat = measure(path)

    refs = seed_refs(item)
    for n in named_by_shot.get(sid, []):
        if n in canon_file and os.path.exists(canon_file[n]) and \
                not any(canon_file[n] == p for _, p in refs):
            refs.append((n + " — canonical", canon_file[n]))

    seedtxt = ", ".join(os.path.splitext(os.path.basename(r["path"]))[0]
                        for r in (item.get("seed_roles") or [])) or "ROOT-TEXT (zero-seed plate)"
    floor = ("R1 tripwire floor 0.10; NIGHT baseline (L03) %.4f" % L03_BASELINE) \
        if sid in NIGHT else "R1 tripwire floor 0.10"
    reason = ("PHASE-6B candidate, staged, NOT promoted. %dx%d @1K/16:9, %.0fKB, era 2-voice prompt "
              "(§2b descriptor head + era suffix tail). Seeds sent: %s. parent_depth=%s lineage=%s. "
              "Median HSV saturation %.4f (%s).%s%s"
              % (w, h, kb, seedtxt, item.get("parent_depth"), item.get("lineage"), sat, floor,
                 "  RE-ISSUED once after a transient provider HTTP 503; this is attempt 2."
                 if sid in REISSUED else "",
                 "  " + NOTE[sid] if sid in NOTE else ""))

    # the stamped verdict is read from the manifest — stamp_review.py is its only writer
    me = MANIFEST.get(sid, {})
    status = me.get("review_status", "unreviewed")
    if status == "parked":
        succ = SUCCESSORS.get(sid, [])
        reason = ("PARKED by fresh-eyes 2026-08-06. VERIFIER'S REASONS (verbatim): "
                  + " | ".join(me.get("parked_reasons") or [])
                  + ("  ||  CORRECTION FRAME(S) FIRED — the next %d card(s) on this board carry "
                     "this shot's repair lineage (%s); rule the RUN, not the frame alone."
                     % (len(succ), ", ".join(succ)) if succ else
                     "  ||  No correction frame fired for this shot in this pass.")
                  + "  ||  " + reason)
        label = ("scene candidate — PARKED (compare with the correction card(s) that follow)"
                 if succ else "scene candidate — PARKED")
        counts["parked"] += 1
    elif status == "verified":
        reason = "VERIFIED by fresh-eyes 2026-08-06 and promoted to assets/scenes/. " + reason
        label = "scene candidate — verified"
        counts["verified"] += 1
    else:
        reason = ("NEWLY MINTED 2026-08-06 in the post-cooldown resume lane — NEVER REVIEWED, no "
                  "verdict yet. " + reason)
        label = "scene candidate — NEW, unreviewed"
        counts["new"] += 1

    cards.append(dict(
        sid=sid, label=label, path=path,
        cls=s.get("shot_class") or "", vo=s.get("vo_text") or "",
        anim=B.describe_animation(M.get(sid)),
        flagged=(status == "parked"),
        reason=reason,
        review_status=status,
        invariants=B.applicable_invariants(s, sid, named_by_shot.get(sid, []), seated, owner_of),
        canon=refs,
    ))

    # a parked frame is IMMEDIATELY followed by its successors, so a whole repair lineage — the
    # original, its round-1 retry, its round-3 re-issue or re-mint — reads as one run of cards
    prev_path, prev_sid = path, sid
    for rid in (SUCCESSORS.get(sid, []) if status == "parked" else []):
        if rid not in retry_slate:
            raise SystemExit("no spec on record for successor frame: " + rid)
        rpath = os.path.join(STAGING, rid + ".png")
        if not os.path.exists(rpath):
            raise SystemExit("missing successor frame: " + rpath)
        ritem = retry_slate[rid]
        rw, rh, rkb, rsat = measure(rpath)
        rrefs = [("%s — the PARKED frame this one replaces" % prev_sid, prev_path)] + seed_refs(ritem)
        rseed = ", ".join(os.path.splitext(os.path.basename(r["path"]))[0]
                          for r in (ritem.get("seed_roles") or [])) or "ROOT-TEXT (zero-seed)"
        rme = MANIFEST.get(rid, {})
        rstatus = rme.get("review_status", "unreviewed")
        rnd = ROUND_OF.get(rid, "?")
        stamped = ""
        if rstatus == "parked":
            stamped = ("FINAL VERDICT — PARKED by fresh-eyes round %s. VERIFIER'S REASONS "
                       "(verbatim): %s  ||  "
                       % (rnd, " | ".join(rme.get("parked_reasons") or [])))
            rlabel = "correction frame — PARKED (final, round %s)" % rnd
        elif rstatus == "verified":
            stamped = ("FINAL VERDICT — VERIFIED by fresh-eyes round %s and PROMOTED to %s.  ||  "
                       % (rnd, rme.get("file")))
            rlabel = "correction frame — VERIFIED + PROMOTED (final, round %s)" % rnd
        else:
            rlabel = "correction frame — unreviewed, verdict EMPTY"
        counts["retry"] += 1
        cards.append(dict(
            sid=rid, label=rlabel,
            path=rpath, cls=s.get("shot_class") or "", vo=s.get("vo_text") or "",
            anim=B.describe_animation(M.get(sid)),
            flagged=(rstatus == "parked"),
            reason=("%sCORRECTION FRAME, staged, NOT promoted. %dx%d @1K/16:9, %.0fKB, median HSV "
                    "saturation %.4f (R1 tripwire floor 0.10). Seeds sent: %s. parent_depth=%s "
                    "lineage=%s.  ||  WHAT WAS AUTHORED (derived ONLY from the verifier's failed "
                    "attributes): %s  ||  GENERATOR'S OBSERVATION (measurement only, NOT a "
                    "verdict): %s"
                    % (stamped, rw, rh, rkb, rsat, rseed, ritem.get("parent_depth"),
                       ritem.get("lineage"), RETRY_BUILT.get(rid, ""), RETRY_OBSERVED.get(rid, ""))),
            review_status=rstatus,
            invariants=B.applicable_invariants(s, sid, named_by_shot.get(sid, []), seated, owner_of),
            canon=rrefs,
        ))
        prev_path, prev_sid = rpath, rid

page, nb = B.build(
    cards,
    "bricks-fresh — Phase 6B fresh-eyes board (first tenth, L01-L25)",
    "ROUND-3 CORRECTIONS PASS. %d verified and promoted · %d parked frames, each followed by its "
    "repair lineage in generation order · %d ROUND-3 correction frames (L10-retry1, L23-retry1, "
    "L24-retry1, L25-retry1, L16-remint1) that carry NO stamp and are yours to rule with EMPTY "
    "verdicts · %d promoted place plates shown as continuity context. Cards already ruled in round "
    "1 or 2 carry their verdict verbatim and are shown for lineage, not for re-ruling. TWO "
    "ANOMALIES TO READ FIRST: L10-retry1's ink register INVERTED to COOL (223.3deg / R-B -1.1) on a "
    "fresh frame — the R1 defect class recurring, second occurrence in this video after L16's cyan; "
    "and the scenes manifest now holds TWO records pointing at the same file assets/scenes/L18.png "
    "(shot_id L18, parked, and shot_id L18-retry1, verified), so forge's manifest reader returns "
    "the PARKED one for anything that seeds that path. L08 remains the only undelivered shot in the "
    "slice, doctrine-blocked on its PARKED parent L07. NIGHT-SHOT RULE: L22-L25 inherit the "
    "approved L03 night plate (median sat %.4f), so a sub-0.10 reading there is authored darkness "
    "judged against that baseline, not an R1 regression."
    % (counts["verified"], counts["parked"], counts["retry"], counts["context"], L03_BASELINE),
    1600, 82)
out_html = os.path.join(SCRATCH, "p6b-board.html")
io.open(out_html, "w", encoding="utf-8").write(page)

# This slice minted ZERO STEP-1 figures (forge reused every figure from an all-pass, digest-current
# C-6 record), so the skeleton is legitimately empty — emitted anyway, through the tool's own schema,
# so the closing `stamp_review.py --figures` step has its documented input.
skel = B.figure_verdict_skeleton([], reviewer="")
out_json = os.path.join(SCRATCH, "p6b-figures.json")
with io.open(out_json, "w", encoding="utf-8") as f:
    json.dump(skel, f, ensure_ascii=False, indent=1)
    f.write("\n")

print("board: %s (%d cards, %.1f MB inlined, %.1f MB page)"
      % (out_html, len(cards), nb / 1e6, os.path.getsize(out_html) / 1e6))
print("  verified=%(verified)d parked=%(parked)d retries=%(retry)d new=%(new)d context=%(context)d"
      % counts)
print("figures: %s (%d figures — this slice minted no STEP-1)" % (out_json, len(skel["figures"])))
sats = [measure(os.path.join(STAGING, s + ".png"))[3] for s in GENERATED]
print("candidates: %d · saturation range %.4f – %.4f" % (len(sats), min(sats), max(sats)))

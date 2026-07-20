#!/usr/bin/env python3
"""Build the Pass-2 generation batches for 2026-07-19-wells-fargo, deterministically.

Emits, into assets/_batches/:
  plain.json    - the non-chain, non-layered long-form scenes (parallelisable)
  chains.json   - the 6 delta-chains, each an ordered list (must run in order)
  plates.json   - the 5 layered-shot plates
  cutouts.json  - the 5 layered-shot cutout sources (2:3, magenta field)
  thumbs.json   - primary + 2 challengers

Rules encoded (image-generation SKILL.md Pass 2 + style-bible SS5/SS6/SS8):
 - long-form scenes/plates are 16:9, passed explicitly (forge defaults to 2:3)
 - cutout sources are NEVER 16:9 (forge.py cutout hard-errors at >=1.5 aspect)
 - every environment/style gen carries a style-anchor seed (forge hard-errors otherwise)
 - text-bearing gens also seed the lettering exemplar
 - crowd-bearing gens also seed a crowd exemplar OF THIS VIDEO'S PERIOD
 - figure-bearing gens MUST carry a figure seed so forge appends the SS2c RIG-HOLD block
 - every anchor is period-checked; a foreign-period anchor is a hard error, never a fallback
 - cast figures seed canonical + pose_ref + expression_ref
 - SEED CAP <= 4, enforced; anchors are dropped before character frames
 - staging names are wf-<id> prefixed (visual-kit/_staging still holds Poyais L01-L125)
"""
import json, os, re, collections

VID = os.path.dirname(os.path.abspath(__file__))          # .../videos/<slug>/assets
VID = os.path.dirname(VID)                                 # .../videos/<slug>
ROOT = os.path.abspath(os.path.join(VID, "..", "..", "..", ".."))  # repo root (orgs/faceless-youtube)
KIT = "channels/the-second-take/visual-kit"
REFS = f"{KIT}/refs"
LIB = "channels/the-second-take/videos/2026-07-19-wells-fargo/assets/library"

shots = json.load(open(os.path.join(VID, "shots.json"), encoding="utf-8"))
motion = json.load(open(os.path.join(VID, "shots.motion.json"), encoding="utf-8"))
reg = json.load(open(os.path.join(ROOT, KIT, "registry", "registry.json"), encoding="utf-8"))
by_name = {a["name"]: a["file"] for a in reg["assets"]}

MOT = {s["id"]: s for s in motion["shots"]}
LF = shots["long_form"]["shots"]

# ---------------------------------------------------------------------------
# PERIOD-SAFE ANCHOR SELECTION  (Round 5 fix, 2026-07-20)
#
# ROOT CAUSE this replaces. The channel's "generic" scene anchors are NOT generic: they are
# frames from the 2026-07-04-poyais (1820s Central America) video, and the engine copied their
# SUBJECT, not just their line weight.
#   refs/env/env-exterior-vivid.png  = a tropical palm river valley with blue mountains
#   refs/env/env-exterior-muted.png  = a dead mangrove swamp
#   refs/base/crowd-exemplar.png     = a row of figures in TOP HATS, BONNETS and BREECHES
# The old anchor_for() made the tropical valley the DEFAULT for every frame that matched no
# keyword, and has_crowd() appended the 1820s crowd unconditionally. Measured damage on this
# 1999-2023 American banking video: L17 rendered that exact palm valley through a boardroom
# window, L116 came back as the mangrove swamp with the crowd exemplar's own costumed figures
# standing in it, L31 grew the swamp's cattails and dead leaves, L97 came back as a Victorian
# village. Period and geography rode in on the anchor.
#
# THE RULE NOW: an anchor may only be selected if it is period-NEUTRAL or its period matches
# this video's. A period-bearing channel anchor is never a silent fallback. Where a register
# needs a scene anchor, it resolves to an APPROVED frame from THIS video; if that frame does
# not exist yet, the planner HARD-FAILS with instructions rather than reaching for a foreign
# period. Failing loudly is the point: a silent fallback is what produced the drift.
# ---------------------------------------------------------------------------
VIDEO_PERIOD = "us-modern-1999-2023"

# Period each channel ref DEPICTS (not the register its filename advertises).
ANCHOR_PERIOD = {
    f"{REFS}/env/env-exterior-vivid.png": "poyais-1820s",   # tropical palm valley
    f"{REFS}/env/env-exterior-muted.png": "poyais-1820s",   # mangrove swamp
    f"{REFS}/env/env-map-parchment.png":  "poyais-1820s",   # aged parchment map
    f"{REFS}/base/crowd-exemplar.png":    "poyais-1820s",   # top hats + bonnets + breeches
    f"{REFS}/env/lettering-marker-italic.png": "neutral",   # letterforms only, no scene
    f"{REFS}/env/stamp-block-outlined.png":    "neutral",   # a stamp, no scene
    f"{REFS}/base/base.png":                   "neutral",   # modern hoodie, carries the RIG only
}

# Period-correct anchors for THIS video: approved, fresh-eyes-reviewed frames from this run.
# (Round 4 cleared L05, L11, L51 and L102 as on-recipe with no rig or period defect.)
SELF = "channels/the-second-take/videos/2026-07-19-wells-fargo/assets/scenes"
LOCAL_COOL = f"{SELF}/L05.png"    # modern corporate boardroom, cool slate, city skyline
LOCAL_WARM = f"{SELF}/L11.png"    # modern suburban cutaway, warm teal-and-cream
LOCAL_DOC = f"{SELF}/L51.png"     # marker infographic numerals on slate
LOCAL_CROWD = f"{SELF}/L102.png"  # a row of modern suited figures

# The RIG anchor is period-neutral and carries the no-nose / no-ears / four-digit-hand family
# form. It is ALSO what makes forge's §2c RIG-HOLD block append: forge.should_hold() keys off
# the SEED LIST, and _is_char_seed() returns False for everything under /refs/env/. So a frame
# whose prompt is full of people but whose seeds were all env anchors silently shipped with NO
# rig invariant attached — the rig rules survived only as prose in the delta, which the engine
# ignored. That is exactly and only the set that came back broken: L01 (a drawn ear on the
# cold-open frame), L10 (noses on the investor row), L17 (realistic adults), L31 (noses, an
# ear, a realistic profile jaw). Seeding this on any figure-bearing frame fixes both problems.
RIG = f"{REFS}/base/base.png"

LETTERING = f"{REFS}/env/lettering-marker-italic.png"
CROWD = LOCAL_CROWD   # was the 1820s crowd-exemplar; now this video's own modern crowd

# characters locked in Pass 1 live in the per-video library
CANON = {"kovacevich": f"{LIB}/kovacevich.png",
         "stumpf": f"{LIB}/stumpf.png",
         "tolstedt": f"{LIB}/tolstedt.png"}

STAMP = f"{REFS}/env/stamp-block-outlined.png"

# Register match is about the frame's VISUAL REGISTER, not its subject matter.
# The parchment anchor is for genuinely aged/parchment map-documents only - this is a
# 2016 banking story, so it is effectively never right here. Seeding it into a modern
# teal bank interior produced a thin, sketchy, washed-out off-recipe frame (L01, validation
# slice) - the exact bible SS6 "thin/sparse/basic" slop failure.
PARCHMENTWORDS = ("parchment", "aged", "antique", "vintage map", "old map", "scroll")
COOLWORDS = ("cool ", "slate", "legal", "formal", "courtroom", "grim", "grey", "gray",
             "navy", "night", "cold", "official", "justice", "senate", "court")


def check_period(path):
    """An anchor is selectable only if it is period-neutral or matches this video's period.
    A period-bearing anchor from another video is never a silent fallback — it drags that
    video's costume and geography into the frame (see the ROOT CAUSE note above)."""
    per = ANCHOR_PERIOD.get(path)
    if per is None:
        per = VIDEO_PERIOD if path.startswith(SELF) else "UNKNOWN"
    if per not in ("neutral", VIDEO_PERIOD):
        raise SystemExit(
            f"PERIOD-UNSAFE ANCHOR: {path} depicts '{per}' but this video is '{VIDEO_PERIOD}'.\n"
            "  Seeding it imports that period's costume and geography (the Round-4 drift).\n"
            "  Use a period-neutral ref or an approved frame from this video instead.")
    return path


def anchor_for(prompt):
    """Register match, then PERIOD match. Resolves to an approved frame from THIS video, so the
    anchor can only ever carry this video's period. Hard-fails if that frame is not on disk yet
    rather than falling back to a foreign-period channel anchor."""
    p = prompt.lower()
    if any(w in p for w in PARCHMENTWORDS):
        a = LOCAL_DOC
    elif any(w in p for w in COOLWORDS):
        a = LOCAL_COOL
    else:
        a = LOCAL_WARM
    if not os.path.exists(os.path.join(ROOT, a)):
        raise SystemExit(
            f"period anchor {a} is not on disk. This video has no approved period-correct anchor "
            "for that register yet.\n"
            "  Generate and fresh-eyes-approve a small period anchor set for this video FIRST.\n"
            "  Do NOT substitute a channel refs/env/ anchor — those are Poyais 1820s frames and "
            "the engine copies their subject, not just their line weight.")
    return check_period(a)


# A prompt that puts people on screen MUST carry a figure seed, or forge.should_hold() never
# appends the §2c RIG-HOLD block and the rig invariants degrade to ignorable prose. Detected
# from the prompt text, not from the seed list — the seed list is the thing being fixed.
FIGUREWORDS = ("figure", "figures", "customer", "teller", "executive", "executives", "banker",
               "investor", "investors", "crowd", "staff", "people", "person", "employee",
               "employees", "senator", "senators", "worker", "workers", "cast", "someone",
               "hand ", "hands")


def has_figures(p):
    return any(w in p.lower() for w in FIGUREWORDS)


def is_stamp(prompt):
    return "stamp" in prompt.lower()


TEXT_RE = re.compile(r"'([A-Z0-9$][^']{0,30})'")


def has_text(p):
    return bool(TEXT_RE.search(p))


def has_crowd(p):
    return "crowd rig" in p.lower() or "crowd-rig" in p.lower()


def cap4(char_seeds, anchors):
    """Seed cap <=4 (bible SS5): character frames are load-bearing, anchors yield first."""
    seeds = list(dict.fromkeys(char_seeds))
    room = max(0, 4 - len(seeds))
    for a in anchors:
        if room == 0:
            break
        if a not in seeds:
            seeds.append(a)
            room -= 1
    return seeds[:4]


def cast_seeds(shot):
    out = []
    for fig in shot.get("cast") or []:
        c = fig["character"]
        if c not in CANON:
            raise SystemExit(f"{shot['id']}: no library canonical for cast member '{c}'")
        out.append(CANON[c])
        for k in ("expression_ref", "pose_ref"):
            ref = fig.get(k)
            if ref:
                if ref not in by_name:
                    raise SystemExit(f"{shot['id']}: ref '{ref}' not in registry by name")
                out.append(by_name[ref])
    return out


def rig_held(seeds):
    """Mirror of forge.should_hold()/_is_char_seed(): does this seed list make forge append the
    §2c RIG-HOLD block? Anything under /refs/env/ does NOT count as a figure seed."""
    for s in seeds:
        rp = s.replace("\\", "/")
        if "/refs/env/" in rp or os.path.basename(rp).startswith("prop-"):
            continue
        if "/refs/" in rp or "/assets/library/" in rp or "/assets/scenes/" in rp:
            return True
    return False


def assert_rig(name, prompt, seeds):
    """HARD GATE. A prompt with people in it whose seeds would not trigger RIG-HOLD is the exact
    failure that put a drawn ear on the cold-open frame and noses on the investor row. Refuse to
    emit the batch rather than pay for a frame whose rig invariants are unenforced."""
    if has_figures(prompt) and not rig_held(seeds):
        raise SystemExit(
            f"{name}: prompt puts figures on screen but the seed set would NOT trigger forge's "
            "§2c RIG-HOLD block (all seeds are refs/env/).\n"
            f"  seeds={seeds}\n"
            "  The rig invariants would survive only as prose in the delta, which the engine "
            "ignores. Add the period-neutral rig anchor (refs/base/base.png) or a figure-bearing "
            "approved frame from this video.")
    return seeds


def entry(shot):
    p = shot["still_prompt"]
    cs = cast_seeds(shot)
    anchors = []
    # the rig anchor comes FIRST for a figure-bearing, cast-free frame: it is period-neutral,
    # it carries the no-nose/no-ears/four-digit family form, and it is what makes RIG-HOLD fire.
    if has_figures(p) and not cs:
        anchors.append(RIG)
    if has_crowd(p):
        anchors.append(CROWD)
    if has_text(p):
        anchors.append(LETTERING)
    anchors.append(anchor_for(p))
    return {"name": f"wf-{shot['id']}", "shot_id": shot["id"],
            "mode": "environment",           # (b) composed scene / (c) character-free
            "delta": p, "aspect": "16:9",
            "seed": assert_rig(f"wf-{shot['id']}", p, cap4(cs, anchors)),
            "_cast": [f["character"] for f in (shot.get("cast") or [])],
            "_text": has_text(p), "_crowd": has_crowd(p)}


chain_children = {sid: MOT[sid]["background"]["plate"].split("/")[-1][:-4]
                  for sid in MOT if MOT[sid]["background"]["mode"] == "delta-chain"}
layered = {s["id"]: s for s in motion["shots"] if s.get("layers")}

plain, chains_flat, plates, cutouts = [], [], [], []

for s in LF:
    sid = s["id"]
    if sid in layered:
        lay = layered[sid]
        pp = lay["background"].get("plate_prompt")
        if pp:
            anchors = [RIG] if has_figures(pp) else []
            if has_text(pp):
                anchors.append(LETTERING)
            anchors.append(anchor_for(pp))
            plates.append({"name": f"wf-{sid}", "shot_id": sid, "mode": "environment",
                           "delta": pp, "aspect": "16:9",
                           "seed": assert_rig(f"wf-{sid} (plate)", pp, cap4([], anchors))})
        for L in lay["layers"]:
            if L.get("source") != "cutout":
                continue
            cp = L["cutout_prompt"]
            # a stamp cutout seeds the channel's approved stamp exemplar, not a scene anchor
            anchors = [STAMP] if is_stamp(cp) else []
            if has_figures(cp) and not is_stamp(cp):
                anchors.append(RIG)
            if has_text(cp):
                anchors.append(LETTERING)
            anchors.append(anchor_for(cp))
            cutouts.append({"name": f"wf-{sid}-{L['id']}-src", "shot_id": sid, "layer": L["id"],
                            "mode": "environment", "delta": cp,
                            "aspect": "2:3",   # NEVER 16:9 on a cutout source
                            "seed": assert_rig(f"wf-{sid}-{L['id']}-src", cp,
                                               cap4([], anchors))})
        continue
    if sid in chain_children:
        chains_flat.append(entry(s))
        continue
    plain.append(entry(s))

# order the chains; each delta seeds the PREVIOUS frame's OUTPUT
order = {s["id"]: i for i, s in enumerate(LF)}
chains = collections.defaultdict(list)
for e in sorted(chains_flat, key=lambda e: order[e["shot_id"]]):
    parent = chain_children[e["shot_id"]]
    root = parent
    while root in chain_children:
        root = chain_children[root]
    e["seed"] = [f"channels/the-second-take/videos/2026-07-19-wells-fargo/assets/scenes/{parent}.png"]
    chains[root].append(e)

thumbs = []
t = shots["thumbnail"]
for label, spec in [("primary", t["primary"])] + [
        (f"challenger-{i+1}", c) for i, c in enumerate(t["challengers"])]:
    gp = spec["gen_prompt"]
    anchors = [RIG] if has_figures(gp) else []
    if has_text(gp):
        anchors.append(LETTERING)
    anchors.append(anchor_for(gp))
    thumbs.append({"name": f"wf-thumbnail-{label}", "shot_id": f"thumbnail-{label}",
                   "mode": "environment", "delta": gp, "aspect": "16:9",
                   "seed": assert_rig(f"wf-thumbnail-{label}", gp, cap4([], anchors))})

out = os.path.join(VID, "assets", "_batches")
os.makedirs(out, exist_ok=True)
for fn, data in [("plain.json", plain), ("chains.json", dict(chains)),
                 ("plates.json", plates), ("cutouts.json", cutouts), ("thumbs.json", thumbs)]:
    json.dump(data, open(os.path.join(out, fn), "w", encoding="utf-8"), indent=1)

nchain = sum(len(v) for v in chains.values())
print(f"plain   {len(plain):>4}")
print(f"chains  {nchain:>4}  in {len(chains)} chains: " +
      " | ".join("->".join([k] + [e['shot_id'] for e in v]) for k, v in chains.items()))
print(f"plates  {len(plates):>4}  {[p['shot_id'] for p in plates]}")
print(f"cutouts {len(cutouts):>4}  {[c['name'] for c in cutouts]}")
print(f"thumbs  {len(thumbs):>4}")
print(f"TOTAL GEN CALLS (no retries): {len(plain)+nchain+len(plates)+len(cutouts)+len(thumbs)}")
print("seed-count histogram:", collections.Counter(
    len(e["seed"]) for e in plain + chains_flat + plates + cutouts + thumbs))
print("cast shots:", [(e["shot_id"], e["_cast"]) for e in plain + chains_flat if e.get("_cast")])

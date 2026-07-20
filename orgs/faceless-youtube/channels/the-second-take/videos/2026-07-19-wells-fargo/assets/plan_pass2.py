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
 - crowd-bearing gens also seed the crowd exemplar
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

ANCHOR_MUTED = f"{REFS}/env/env-exterior-muted.png"
ANCHOR_VIVID = f"{REFS}/env/env-exterior-vivid.png"
ANCHOR_DOC = f"{REFS}/env/env-map-parchment.png"
LETTERING = f"{REFS}/env/lettering-marker-italic.png"
CROWD = f"{REFS}/base/crowd-exemplar.png"

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


def anchor_for(prompt):
    p = prompt.lower()
    if any(w in p for w in PARCHMENTWORDS):
        return ANCHOR_DOC
    if any(w in p for w in COOLWORDS):
        return ANCHOR_MUTED
    return ANCHOR_VIVID


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


def entry(shot):
    p = shot["still_prompt"]
    cs = cast_seeds(shot)
    anchors = []
    if has_crowd(p):
        anchors.append(CROWD)
    if has_text(p):
        anchors.append(LETTERING)
    anchors.append(anchor_for(p))
    return {"name": f"wf-{shot['id']}", "shot_id": shot["id"],
            "mode": "environment",           # (b) composed scene / (c) character-free
            "delta": p, "aspect": "16:9",
            "seed": cap4(cs, anchors),
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
            anchors = [LETTERING] if has_text(pp) else []
            anchors.append(anchor_for(pp))
            plates.append({"name": f"wf-{sid}", "shot_id": sid, "mode": "environment",
                           "delta": pp, "aspect": "16:9", "seed": cap4([], anchors)})
        for L in lay["layers"]:
            if L.get("source") != "cutout":
                continue
            cp = L["cutout_prompt"]
            # a stamp cutout seeds the channel's approved stamp exemplar, not a scene anchor
            anchors = [STAMP] if is_stamp(cp) else []
            if has_text(cp):
                anchors.append(LETTERING)
            anchors.append(anchor_for(cp))
            cutouts.append({"name": f"wf-{sid}-{L['id']}-src", "shot_id": sid, "layer": L["id"],
                            "mode": "environment", "delta": cp,
                            "aspect": "2:3",   # NEVER 16:9 on a cutout source
                            "seed": cap4([], anchors)})
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
    anchors = [LETTERING] if has_text(gp) else []
    anchors.append(anchor_for(gp))
    thumbs.append({"name": f"wf-thumbnail-{label}", "shot_id": f"thumbnail-{label}",
                   "mode": "environment", "delta": gp, "aspect": "16:9",
                   "seed": cap4([], anchors)})

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

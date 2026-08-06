"""Build the P6B corrections-pass specs: L24-retry1, L25-retry1 (chain re-bases + one surgical
content span each) and L16-remint1 (changed-mechanism re-mint of the ORIGINAL slate entry).

Why these are slates and not `forge.py batch --retry` overlay entries: `_retry_scene` enforces
EXACTLY ONE surgical authority per entry (`if bool(replacement) == has_seed_change: raise`), so a
single overlay entry cannot both re-base a defective parent AND carry a content correction. L24/L25
need both — their parent must move to the fresh corrected frame AND their authored delta must pin
the attributes the verifier failed. Each replace here is performed in the SAME surgical form the
overlay uses (exactly one occurrence, bytes outside the span asserted byte-identical), and the
seed-role/delta text is produced by forge's own helpers, not hand-written.
"""
import json
import os
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "C:/Users/danie/kb/orgs/faceless-youtube/.claude/skills/image-generation/scripts")
import forge  # noqa: E402

STAGING_L23 = "_staging/L23-retry1.png"
STAGING_L24 = "_staging/L24-retry1.png"
CROWD = "channels/the-second-take/visual-kit/refs/base/crowd-exemplar.png"
LETTER = "channels/the-second-take/visual-kit/refs/env/lettering-marker-italic.png"


def surgical(text, old, new):
    """One exact-replace authority: one occurrence, nothing outside its span changed."""
    assert text.count(old) == 1, "replacement source must occur exactly once"
    start = text.index(old)
    out = text[:start] + new + text[start + len(old):]
    assert out[:start] == text[:start], "bytes changed before the span"
    assert out[start + len(new):] == text[start + len(old):], "bytes changed after the span"
    return out


L24_FROM = ("Only this changes: every remaining carton along that unwrapped top row now stands with "
            "its flaps folded open too, one red clay brick lying inside each on crumpled paper and "
            "filling its box exactly; everything else exactly as established.")
L24_TO = (
    "Only this changes: every remaining carton along that unwrapped top row now stands with its "
    "flaps folded open too. Those cartons are THE RANKED CARTONS THE PARENT ALREADY DREW and each "
    "keeps EXACTLY THAT CARTON'S SIZE: the same small width, height and depth as every other sealed "
    "carton in its own row, roughly one third of its pallet's width, with the folded-open flaps "
    "staying inside that same small footprint. NO box grows to the width of a pallet, no box "
    "replaces or swallows the rest of its row, and each pallet keeps its own several small open "
    "cartons standing separately side by side across its top row. Inside each lies one red clay "
    "brick on crumpled paper, and that brick FILLS ITS CARTON EXACTLY: it spans the carton's "
    "opening corner to corner, its edges nearly touching the carton walls on all four sides, so "
    "each brick is plainly the same size as the box that holds it and only a little crumpled paper "
    "shows at the margins. The crew of packers is held EXACTLY as the parent draws it: the same "
    "people, the same number, the same poses and the same clothes, every one of them bare-headed as "
    "the parent draws them - no packer gains a hat, cap, head covering, hood, hair, collar or tie "
    "the parent does not already draw. Everything else exactly as established.")

L25_FROM = ("Only this changes: the front face of every one of those open cartons now carries 'HARD "
            "DRIVE' lettered across the middle of the board; everything else exactly as established.")
L25_TO = (
    "Only this changes: the front face of EVERY ONE of those open cartons now carries 'HARD DRIVE' "
    "lettered across the middle of the board - not only the nearest boxes. EVERY open carton "
    "visible anywhere in the frame carries those same two hand-lettered words: the ones on all "
    "pallets alike, the front ones and the smaller ones receding in depth, each lettered at its own "
    "size so the words shrink with the carton but stay legible. No open carton is left blank. The "
    "crew of packers is held EXACTLY as the parent draws it: the same people, poses, clothes and "
    "bare heads - no packer gains a hat, cap, head covering, hood, hair, collar or tie. Everything "
    "else exactly as established.")


def rebase(item, parent_path, old_from, old_to, depth, lineage, note):
    payload = surgical(item["payload"], old_from, old_to)
    roles = [forge._seed_role(parent_path, "parent")]
    roles += [r for r in item["seed_roles"] if r["role"] != "parent"]
    roles = forge._dedupe_seed_roles(roles)
    seeds = [r["path"] for r in roles]
    return dict(item, name=item["name"] + "-retry1", seed=seeds, seed_roles=roles,
                payload=payload, delta=forge.placement_delta(payload, roles),
                parent_depth=depth, lineage=lineage, plate=False,
                why=item.get("why", "") + "; " + note)


native = {e["name"]: e for e in json.load(open(os.path.join(SCRATCH, "p6b-native-L2425.json"),
                                              encoding="utf-8"))}

# L23-retry1 is an unreviewed staged frame whose own parent is the VERIFIED scenes/L22.png
# (depth 1 / lineage 1), so it stands at depth 2 / lineage 2 and its children climb from there.
l24 = rebase(native["L24"], STAGING_L23, L24_FROM, L24_TO, 3, 3,
             "RE-BASE onto the fresh corrected parent L23-retry1 (forge's own walk resolved NO "
             "parent for L24: on_disk() looks only in assets/scenes/, and parked L23 was never "
             "promoted) + ONE exact replace pinning ranked-carton scale and the held crew wardrobe")
l25_native = dict(native["L25"])
l25 = rebase(l25_native, STAGING_L24, L25_FROM, L25_TO, 4, 4,
             "RE-BASE onto the fresh corrected parent L24-retry1 + ONE exact replace pinning "
             "'HARD DRIVE' on EVERY open carton and the held crew wardrobe")

l16_src = next(e for e in json.load(open(os.path.join(SCRATCH, "p6b-slate.json"), encoding="utf-8"))
               if e["name"] == "L16")
l16 = dict(l16_src, name="L16-remint1",
           why=l16_src["why"] + "; CHANGED-MECHANISM RE-MINT of the ORIGINAL slate entry (not the "
                                "retry overlay): the parking defect was generator-side cyan ink and "
                                "the R1 fix has since landed; staging and prose are byte-identical "
                                "to the original entry, only the output name differs")
assert l16["payload"] == l16_src["payload"]
assert l16["seed"] == l16_src["seed"]

for spec, fn in ((l24, "p6b-r3-L24-retry1.json"), (l25, "p6b-r3-L25-retry1.json"),
                 (l16, "p6b-r3-L16-remint1.json")):
    json.dump([spec], open(os.path.join(SCRATCH, fn), "w", encoding="utf-8"), indent=2)
    print(fn, "->", spec["name"], "| seeds:", [forge._stem(s) for s in spec["seed"]],
          "| depth/lineage:", spec["parent_depth"], spec["lineage"])

import json

PATH = "videos/2026-07-28-bricks-fresh/shots.json"
with open(PATH, encoding="utf-8") as f:
    d = json.load(f)
shots = d["long_form"]["shots"]
by_id = {s["id"]: s for s in shots}

l13 = by_id["L13"]
for k in ("stage", "stage_role", "changed_elements"):
    l13.pop(k, None)
l13["notes"] = (
    "Figureless by design for ~2.5s: the subject of the line is the object's contents, not a "
    "person. Kept as its own seedless root rather than a stage base: L14 introduces `pc-boxy` "
    "fresh on this set, and a figure's entrance is never legal as a delta (it would seed only "
    "[parent + canonical], with no pixels in the parent frame for it to inherit) -- chaining "
    "them would have required L14 to prove that entrance as prose against an image that does "
    "not contain the figure."
)

l14 = by_id["L14"]
for k in ("stage", "stage_role", "changed_elements"):
    l14.pop(k, None)
l14["still_prompt"] = (
    "`pc-boxy`, `expr-caught`, stage-right beside the oversized `prop-drive` cabinet, which "
    "stands stage-left with its first drawer still fully out, folders and photographs on show. "
    "Seen from the same low three-quarter angle as the vault itself, looking up at the towering "
    "cabinet: foreground a cropped rug edge running across the bottom of frame, midground "
    "pc-boxy and the drawer at hip height, background the cabinet's flat cream body rising past "
    "the frame top. Cream-buff-maroon palette, even frontal light. A second drawer has just slid "
    "open at hip height; pc-boxy leans the flat of both stubby arms against its face, pressing it "
    "shut so whatever sits inside stays hidden behind the drawer front."
)
l14["notes"] = (
    "Punchline beat: the machine that remembers everything is the one caught out, so the "
    "reaction lands on the cast member the line is about. pc-boxy has no hands, so its stance is "
    "authored as a flat-arm press against the drawer face rather than any grip or pull -- the "
    "prior authoring's 'shoving' verb read as a gripped action on a rig that has no fingers to "
    "grip with. Stays a standalone base rather than a delta on L13: pc-boxy enters fresh here, "
    "and a figure's entrance is never a delta (visual-grammar.md §1) -- this is that base, "
    "matching L13's vantage in prose without declaring a schema chain across the entrance. Scene "
    "facts precede the payload so the prompt closes on the drawer being pressed shut."
)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("fixed L13/L14")

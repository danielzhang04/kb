import json

PATH = "videos/2026-07-28-bricks-fresh/shots.json"
with open(PATH, encoding="utf-8") as f:
    d = json.load(f)
shots = d["long_form"]["shots"]
by_id = {s["id"]: s for s in shots}

# --- Finding 2 (L02): payload-ordering break -- trailing decor clause after payload ---
l02 = by_id["L02"]
l02["still_prompt"] = (
    "Beyond a chrome rail crossing low across the frame, a roller-rink lobby packed shoulder "
    "to shoulder with 1980s skaters in shoulder-padded jumpsuits and white hi-tops. Shot from "
    "floor level looking up: foreground the chequer-tile floor and the chrome rail with a "
    "cropped ticket-booth corner stage-left, midground the skaters' shoulders and grinning "
    "faces turned up and shouting over the music, glowing pink and teal wall panels behind "
    "them, background their teased blonde and copper hairdos stacked so high they fill the "
    "entire upper third of the frame like a hedge, thickest dead centre where one enormous "
    "blonde tower rises past the frame top. Teal-pink-cream palette, flat even rink light."
)
l02["notes"] = (
    "Mass action: the era IS the mass, so it is staged as one rather than personified by a "
    "single stand-in. Crowd expression and attitude authored in prose (grinning, shouting) "
    "since a crowd carries no seeded expression. Low upward vantage makes the hair loom, which "
    "is the payload; the floor/wall-panel decor is stated ahead of the payload clause so the "
    "prompt closes on the hair, not on set dressing (critic finding #2, payload-ordering law). "
    "Pac-Man, also named in this VO sentence, is deliberately not staged as its own visual: it "
    "is a specific trademarked game character rather than a generic era signifier, and this "
    "channel already keeps real products/IP generic (e.g. `prop-beige-pc` never a named real "
    "computer brand) -- reviewed and rejected as a critic finding, not silently dropped."
)

# --- Finding 1 (L03): payload-ordering break -- trailing decor clause after payload ---
l03 = by_id["L03"]
l03["still_prompt"] = (
    "Seen from a high vantage at the back of a hotel function room, looking down across the "
    "crowd toward an empty awards dais: foreground a wall of raised applauding hands and "
    "shoulders fills the lower third, midground a velvet rope crossing the room, a pleated "
    "gold curtain wall and banquet tables running back through the depth, background the dais "
    "itself stage-right under one hard overhead spot -- an oversized display board angled on "
    "it, its face completely blank and unlettered, a lectern beside it with nobody behind it. "
    "Gold-cream palette against a warm near-black room shadow, dim ambient light against the "
    "one hot spot on the empty dais."
)
l03["notes"] = (
    "Hook peak. Seen from over the crowd rather than the floor so the empty dais reads as the "
    "whole room's focus. The figureless dais across ~3.8s IS the argument: a standing ovation "
    "aimed at nobody is the scam nobody has heard of. No scam imagery yet, the VO has not "
    "disclosed it. Curtain wall and banquet tables moved into the midground clause, ahead of "
    "the payload, so the prompt closes on the empty dais rather than reopening the scene with "
    "new decor after it (critic finding #1, payload-ordering law)."
)

# --- Finding 3 (L16): pc-boxy / rival-pc under-differentiated beyond colour ---
l16 = by_id["L16"]
l16["still_prompt"] = (
    "`pc-boxy`, `expr-annoyed`, planted low and wide in the near corner stage-left, front "
    "panel squared toward the far corner. Facing it in the far corner stage-right, `rival-pc` "
    "-- a slate-grey desktop case on the same no-hand boxy form but narrower and a head "
    "taller, a pair of stacked vent slots ribbing its front panel above its own cartoon eyes "
    "and mouth, `expr-annoyed` to match. Seen ringside from a low angle looking up at both, so "
    "the two cases loom: foreground a cropped ring post at the right edge, midground the two "
    "machines holding one plane at a matching eye line and equal relative head scale, three "
    "slack ropes crossing between them, background a corner stool at each post and, beyond the "
    "ropes, a dense crowd roaring with arms up under one hard overhead ring light. "
    "Umber-cream-teal palette."
)
l16["notes"] = (
    "The public fight staged as a bout so the next cut can leave it for the quiet money. NEW "
    "CAST, mint owed at Pass-1: `rival-pc`'s pinned form is stated ONCE here (slate-grey case, "
    "same no-hand boxy build as `pc-boxy` but narrower/taller with a stacked-vent front panel "
    "as its own shape differentiator, not colour alone) and re-described nowhere else -- mint "
    "the canonical from this clause. Neither machine has hands, so the bout is staged as "
    "bodies squared off and planted rather than a glove contact; the prior authoring's laced "
    "boxing gloves bled a human hand-rig onto a handless character (and cast an unregistered "
    "'rival personified computer' with no canonical at all) -- both are corrected here. Shape "
    "differentiator added past the critic's finding #3: colour alone risked the two figures "
    "bleeding together on a fresh Pass-1 mint with no reference image yet."
)

# --- Vantage monotony (plan-level): break up the "seen low, looking up" repeat on L07, L19 ---
l07 = by_id["L07"]
l07["still_prompt"] = (
    "A `prop-beige-pc` unit sits on a shop counter top, front panel turned to the far side. "
    "Seen from slightly above the counter, looking down its length toward the till: foreground "
    "the counter top and a cropped till corner at the lower-right, midground fistfuls of "
    "banknotes thrust across the counter from customers crowded three deep against it, arms "
    "eager and impatient, the notes never overlapping the unit, background a pegboard wall of "
    "coiled cables and a queue rope running back stage-left. Cream-brown-teal palette, even "
    "shop light."
)
l07["notes"] = (
    "'Anybody with money' is a genuine mass, so the buying frenzy is carried by the crowd "
    "reaching for it rather than by the object reacting -- it stays a plain unpersonified unit "
    "on the counter. Angled down the counter from above rather than low-up, breaking the "
    "low-angle repeat several other shots in this act use for a different payload (a towering "
    "object) -- here the payload is the thrust of banknotes across a surface, which a "
    "downward-looking angle reads better."
)

l19 = by_id["L19"]
l19["still_prompt"] = (
    "`drive-maker`, `expr-greedy`, `hold-both-hands`, both hands on the shaft of a long garden "
    "rake, dragging a knee-deep drift of loose banknotes toward himself into a growing heap at "
    "his boots. Seen from above looking down into the heap: foreground the drift of loose "
    "banknotes spreading across the lower frame, midground drive-maker planted centre pulling "
    "the rake through them, background a bare loading bay -- corrugated tin walls, a shuttered "
    "bay door, flat cartons stacked to the ceiling stage-left and stage-right so the money lies "
    "in a canyon of stock. Green-brown-amber palette, one hard work lamp from stage-right."
)
l19["notes"] = (
    "The idiom is the beat, so the rake is real and a body is doing the raking. A downward "
    "vantage into the heap reads the growing pile's shape better than a low angle, and varies "
    "the act's vantage mix. Wall material changed from breeze-block to corrugated tin, easing "
    "the run of near-identical breeze-block warehouse walls the critic flagged across L18-L25 "
    "(plan-level finding, partially addressed here; L23-L25 keep breeze-block because they are "
    "one held chain and cannot vary mid-chain, and L18/L22/L27 are each a distinct single set "
    "already differentiated by their own props and framing)."
)

CHANGED = ["L02", "L03", "L07", "L16", "L19"]
for sid in CHANGED:
    assert sid in by_id

with open(PATH, "w", encoding="utf-8") as f:
    f.write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")

print("applied critic-edit patch to:", CHANGED)

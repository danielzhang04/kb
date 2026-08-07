# Phase 6c-slice-2 — fresh-eyes scene verification, worker A (L26–L37)

Twelve frames, all minted tonight (L38 never landed — transport 503 — and is out of scope).
Verification only: nothing here mints, re-prompts, stamps, or moves a file. `stamp_review.py`
remains the sole verdict writer; this log is evidence for it, not a substitute.

Method per frame: (1) composition/staging read against the shot's `still_prompt` in `shots.json`
and the payload in `6c2-wave2-scenes.json`; (2) figure identity/costume/rig against the STEP-1 card
the spec seeded, and against the named-cast canonical in `visual-kit/refs/`; (3) ink measured with
`scratchpad/p6b_ink.py` (darkest-3% circular-mean hue + mean R−B + median saturation) — a cool
inversion (hue ≈223°, R−B ≤ 0) is a hard fail, the era prior is warm; (4) continuity against the
declared chain parent / place seed; (5) flat-cel register.

Ink table for the whole slice, measured in one invocation before any frame was judged, so no
number in this log was fitted to a verdict:

| frame | ink hue | R−B | ink lum | median sat | read |
| --- | --- | --- | --- | --- | --- |
| L26 | 87.3° | +6.5 | 31.2 | 0.1843 | warm-neutral |
| L27 | 30.0° | +37.9 | 42.5 | 0.1333 | warm |
| L28 | 78.6° | +3.0 | 14.7 | 0.1216 | warm-neutral |
| L29 | 111.5° | +1.2 | 8.1 | 0.1255 | near-neutral |
| L30 | 25.7° | +29.8 | 30.9 | 0.0941 | warm |
| L31 | 25.6° | +30.2 | 24.3 | 0.1059 | warm |
| L32 | 19.4° | +47.7 | 37.3 | 0.0745 | warm (on target hue) |
| L33 | 75.1° | +2.5 | 7.8 | 0.1294 | near-neutral |
| L34 | 116.7° | +0.9 | 5.3 | 0.1255 | near-neutral |
| L35 | 74.4° | +5.4 | 13.5 | 0.1686 | warm-neutral |
| L36 | 30.8° | +30.0 | 19.3 | 0.1961 | warm |
| L37 | 30.3° | +36.5 | 32.3 | 0.2039 | warm |

Nothing in the slice is within 130° of the cool inversion and no R−B is negative, so the ink axis
passes on all twelve. The pattern worth naming is separate and is written up at the foot of this log.

---

## L26 — `map-plan-view`, "and sold them to customers around the world."

**Verdict: PASS (one prop-count deviation recorded).**

Staging is the authored one: a flat top-down world map, oceans pale teal, landmasses cream and
completely unlettered, a single red thread fanning out from one point in the middle of North
America to each carton in turn. Palette is charcoal-teal-cream, light is flat and overhead. No
lettering anywhere, so the text-free law holds. Register is flat cel, no sub-outline stroke fields.

Two deviations, both counted rather than eyeballed (crops at 3× on the Europe and South-East Asia
regions):

- **Carton count 7, not the authored 9.** West-coast North America 1 (authored 1), western Europe
  **1** (authored 2), South-East Asia **2** (authored 3), eastern tip of South America 1, southern
  Africa 1, east-coast Australia 1. The two missing cartons are both in the clusters the prose
  asked to be doubled and tripled — the model rendered one token per named region rather than the
  stated multiplicity.
- The map is a bordered board sitting on the concrete with floor visible on all four sides, where
  the prose asked for "the map filling the frame edge to edge". The floor is authored ("laid out
  across a concrete floor"), so this reads as the two clauses being reconciled rather than a miss.

Neither changes what the shot says on the line — the beat is spread, and nine points of spread
versus seven is not legible to a viewer at 1.5s. Recorded, not failed.

Ink: hue 87.3°, R−B +6.5, median sat 0.1843 (era prior ~0.19 — on prior). The darkest 3% here is
the charcoal floor, not the outline, which is why the hue sits green-neutral rather than at the
~19° ink target; R−B stays positive, so no inversion.

Continuity: `ok` — no chain parent, no place seed (style-tile-anchored plate root).

## L27 — `ironic-counterpoint`, "Here is the story of that company."

**Verdict: FAIL — rig register (hands).**

Staging is right and reads well. The seeded `base` performer stands stage-right in the brown
warehouse coat, hauling the grey dust sheet off the front face of a shrink-wrapped pallet stack
that towers over him; half the sheet still lies draped across the top of the stack exactly as
authored; the exposed wrap catches light in flat planes; an empty concrete bay runs back to a shut
roller shutter with a warm bulb over it; one cold skylight shaft falls from above; a cropped
forklift tine cuts the lower-left. Grey-cream-amber palette. No unauthored text, no duplicated
props, no bled '1983' card.

Identity and costume match `fig-base--hold-one-hand--expr-deadpan--l27-d4b1f2ce` exactly: bald
dome, no nose, no ears, heavy-lidded deadpan with the faint closed-mouth line, brown coat with
patch pockets over a grey-olive tee, brown trousers, brown shoes.

The failure is the **left hand** (viewer-left), at roughly x 915–950, y 440–465 in the 1376×768
frame, where the arm meets the sheet's leading edge. It is drawn as a fingerless mitten stub with a
single thumb-like protrusion and no digit separation, at visibly smaller scale than the right hand
gripping the sheet at x 990–1015, y 465–495, which is correctly articulated. That breaks the rig
axis on two counts at once — four digits, and both hands the same size — and it sits at the exact
point the eye goes, because it is the contact point of the shot's one action. The sleeve also ends
without a cuff, so the hand reads as laid on top of the sheet rather than closed on it.

Secondary, not the basis of the verdict: the card action is `hold-one-hand`, and the frame stages a
two-handed haul. Given the prose says "hauling", two hands is the better reading of the intent; the
card mismatch is noted only because it is the same region as the defect.

Ink: hue 30.0°, R−B +37.9, median sat 0.1333. Warm, clean, well clear of inversion. The low
saturation is authored (grey-cream-amber bay), not a wash.

Continuity: `ok` — no chain parent, no place seed.

## L28 — `literal`, "The company was MiniScribe," (PLACE PLATE, parent of L29/L33/L44/L46/L47/L48)

**Verdict: PASS.**

Everything the plate is responsible for is here and correct. Single-storey assembly floor seen wide
and head-on; entirely empty of people, which is the law this shot exists to obey; steel benches
running back into the depth carrying blue anti-static mats and wooden part trays; a rack of empty
tote bins stage-left; a roller door shut at the far end; strip lights in rows overhead; cool
grey-teal-cream palette under flat even industrial light; a cropped bench end cutting the
lower-right corner for foreground depth.

The lettering is the axis that matters most on this frame, because it is the plate every downstream
child inherits and because the wrong-surface class has bitten this run before. It is correct: one
word, `MINISCRIBE`, correctly spelled, in the marker-italic red the `lettering-marker-italic`
exemplar pins, painted on a cream board hung over the entrance at the back of the floor — the exact
surface the prose named. Nothing else in the frame carries text. No bled '1983' tent card, no second
sign, no duplicate till-class object.

The benches read as two runs per side rather than two runs total, forming a corridor. The prose says
"two long steel benches running back into the depth" and the symmetric corridor is the natural
staging of that in a head-on wide; I do not read it as a multiplication defect.

Ink: hue 78.6°, R−B +3.0, median sat 0.1216. The darkest 3% is the dark grey-teal ceiling structure
rather than outline, so hue sits neutral-green; R−B positive, no inversion.

Continuity: `ok` — plate root, nothing upstream to hold against.

## L29 — `personified-character`, "a hard drive manufacturer out of Colorado," (child of L28)

**Verdict: PASS (one placement deviation recorded).**

**Continuity against the L28 parent is the strongest hold in the slice.** Bin rack, bench geometry,
tray shelves, the full strip-light array, the shut roller door, the cream/teal wall split, the floor
tone, and the cropped foreground bench end at lower-right are all carried across unchanged and in
the same positions. Palette identical. Nothing was re-rooted; nothing drifted. The `MINISCRIBE`
board is carried too, still correctly spelled and still on its own painted board — the L-1 carry the
shot notes call for.

`miniscribe-rep` matches the canonical and the seeded card
(`fig-miniscribe-rep--action-powerstance--expr-delighted`) on every identity and costume axis: dark
brown side-parted hair with the same forelock shape, tan blazer, brown open-collar shirt, dark
charcoal trousers, dark brown shoes. `action-powerstance` is staged correctly — both fists on the
hips, the viewer-right fist articulated, the viewer-left one occluded behind the hip. Hands are the
same size. No ears, uniform head tone, flat cel throughout.

Two things to record:

- **Placement.** The prose plants him "centre in the entrance at the back of the assembly floor".
  He is on the centreline with the board over him, but he stands well downstage of the roller door
  — feet near y≈635 of 768, where the roller door's base sits near y≈430. Staged literally he would
  have been a thumbnail; downstaging him is what makes the reveal legible on a naming beat, and the
  authored relationship (board hanging over him, dead centre) survives intact. Deviation, not a
  miss.
- **Expression variance.** The card draws `expr-delighted` with eyes closed in happy arcs; the frame
  draws it with open eyes and the same broad grin. Still inside the register and arguably the better
  read for a reveal, but it is a variance off the card and is logged as one.

Ink: hue 111.5°, R−B +1.2, median sat 0.1255. Lowest R−B margin in the slice but still positive; the
darkest 3% here is ceiling steel plus the figure's charcoal trousers, not outline.

Continuity: `ok`.

## L30 — `personified-character`, "founded in 1980 by" (CHAIN PARENT of L31)

**Verdict: PASS.**

Every authored element is present and correctly placed: `terry-johnson` alone stage-right;
unpainted breeze-block walls; a concrete floor holding one trestle table and a single stool — one
each, no duplication; cardboard cartons still flat and stacked against the wall; the roller shutter
**up** on a strip of grey daylight beyond, with a flat city skyline behind it; one warm bulb on a
flex overhead throwing the only warm light in an otherwise cool grey-cream room; foreground depth
from a cropped stack of flats at the lower-left. The departure from the 1983 floor to the 1980 room
is unmistakable, which is what the shot notes ask for.

The figure matches `fig-terry-johnson--action-armscrossed--expr-thinking` closely enough to be worth
naming detail by detail: balding blond comb-over with the same forelock, blond moustache,
**dark-brown eyebrows**, eyes glancing up and to the viewer-left, small downturned mouth, white
dress shirt, black tie, dark trousers on a belt, dark shoes. `action-armscrossed` reproduces the
card's exact geometry including the raised index finger on the upper hand. Hands are the same size
and correctly articulated. No ears, uniform head tone, flat cel, no text.

Ink: hue 25.7°, R−B +29.8 — the second-warmest reading in the slice and close to the ~19°/+18 ink
target. Median sat 0.0941, the lowest in the slice and about half the era prior; the authored
palette is "cool grey-cream", so this is the frame doing what it was told, not a wash. Flagged only
so the pattern is on record.

Continuity: `ok` — chain root.

## L31 — `personified-character`, "a guy named Terry Johnson." (delta on L30)

**Verdict: PASS (unauthored second delta recorded — see the flicker note; this one wants a ruling).**

I diffed L31 against its L30 parent pixel-wise (threshold 40 on summed RGB) rather than eyeballing
it. 1.48% of pixels moved, and the change mask is almost entirely (a) the authored addition and
(b) hairline outline jitter from the re-render. Structurally the delta is clean: breeze-block
courses, trestle table, stool, the wall-leaning flats, the lower-left stack of flats, the shutter,
the skyline strip, the bulb and its light cone, the floor mottling and the palette all hold in
position. The lower-left stack, cropped side-by-side at 2.5×, is identical plank for plank. **This
child does not read as a fresh root — the chain held.**

The authored change landed correctly: one finished `prop-drive` now stands **upright** on the
trestle in front of him, matching the `prop-drive` ref on casing form, the recessed top plate, the
corner screw bosses and the grey-with-dark-brown-outline treatment.

What I have to report is a **second, unauthored change, on the figure's face** — the prose said
"everything else exactly as established":

- His eyeline snaps from the card's up-and-left thinking glance (L30) to looking straight ahead
  (L31), on a held pose where nothing else about the head moves.
- His **eyebrows change colour**, dark brown in L30 to pale blond in L31.

Both are visible in the side-by-side face crop at 4×. This sits at the ≤2 delta cap rather than over
it, and it does not break the place, so I am not failing the frame — but it produces a face flicker
across a hard cut between two adjacent VO lines, which is exactly the kind of thing an eye catches
even when it cannot name it.

**The brow colour is worth a ruling rather than a fix, because the two authorities disagree.** The
`terry-johnson` canonical in `visual-kit/refs/` draws pale blond brows; the STEP-1 card
`fig-terry-johnson--action-armscrossed--expr-thinking` draws dark brown ones. L30 followed the card,
L31 followed the canonical, and both are defensible against their own source. Whichever way the
stamping pass rules, the pair has to agree — this is a source conflict, not a generation defect.

Ink: hue 25.6°, R−B +30.2, median sat 0.1059 — near-identical to the parent, which is itself
evidence the chain held.

Continuity: `ok` for place, palette and props; figure continuity carries the defect above.

## L32 — `idiom-pun`, "And they were HOT."

**Verdict: FAIL — unauthored lettering.**

The joke lands, and most of the frame is right. The seeded `base` performer is stage-left on his
back foot in a white lab coat and quilted oven gloves, recoiling from a `prop-drive` standing
upright on a small test bench, the casing glowing cherry-red from inside with **exactly two** thin
wisps of smoke curling off it, as authored. Peg rail of hand tools behind — two spanners and a
screwdriver. Fire bucket on the floor stage-right. One hard work lamp above throwing a single hard
cone. Grey-cream-red palette. The dead metaphor is drawn literally, which is the whole assignment.

Figure against `fig-base--action-recoil--expr-shock--l32-36f3a4e9`: identity holds (bald dome, no
nose, no ears, uniform head tone), costume holds and is in fact *closer to the prose than the card
is* — the card's gloves are plain, the frame's are properly quilted with a cuff, which is what the
prompt asked for. `expr-shock` and `action-recoil` both read. Both gloves are the same size and
articulated identically. Flat cel, no sub-outline stroke fields.

**The failure is text.** The fire bucket at x≈1080–1240, y≈500–700 carries the stencilled word
**`FIRE`** across its front. Nothing in this shot's prompt authored any lettering, and — unlike
L28, L29 and L36 — this item was not seeded with the `lettering-marker-italic` exemplar at all. So
the frame both invented text where none was authored and drew it in a plain upright sans that is
not the house letterform. This is the same family as the p6b bled-'1983'-card defect: a text
element arriving on its own initiative. Correctly spelled, which is beside the point.

Two smaller things, recorded not charged:

- The prose asked for foreground depth from "a cropped stool **back**" at lower-left; the frame puts
  a complete backless wooden stool there. It is cropped by the frame edge, so the depth cue works,
  but it is not the object described.
- The shot notes say "the red accent is the whole joke". The frame now carries two red masses — the
  glowing drive and a large saturated fire bucket — and the bucket, being nearer and larger in
  chroma area, competes with the gag it is supposed to support. Worth an eye when the bucket text is
  dealt with anyway.

Ink: hue 19.4°, R−B +47.7 — **the best reading in the slice, sitting exactly on the ~19° ink
target**. Median sat 0.0745 is the lowest in the slice, which is the authored grey-cream room around
one saturated accent, not a wash.

Continuity: `ok` — no chain parent, no place seed.

## L33 — `staged-interaction`, "IBM picked MiniScribe to supply" (CHAIN PARENT of L34; place seed L28)

**Verdict: FAIL — named-cast identity drift on `miniscribe-rep`.**

The staging is good and the interaction template is obeyed. `ibm-suit` and `miniscribe-rep` are
clasped in a single `handshake` at centre frame, both on the same ground plane, eye lines within a
few pixels of each other and head scales effectively equal — which is the clause this shot exists to
test. One clasp, no spare hands, no duplicated figure. Behind them the floor runs back into the
depth with the steel benches and the tote rack stage-left; the roller door is **up** on flat grey
daylight, which is the authored change off the plate; cool grey-teal-cream palette under flat strip
light; cropped bench end at lower-right.

`ibm-suit` is clean: dark skin, grey hair at the temples, navy pinstripe three-piece, blue tie,
white pocket square, black oxfords — matches both the canonical and `fig-ibm-suit--expr-smug`, and
`expr-smug` reads correctly as heavy lids plus a closed smirk.

**`miniscribe-rep` does not match.** Against both the canonical and the seeded card
`fig-miniscribe-rep--expr-delighted`, three things have moved at once:

- **Hair colour**: the canonical and card draw warm dark **brown** hair; this frame draws **jet
  black**.
- **Hair silhouette**: the card's shape is a side-parted quiff with a visible sideburn; the frame
  draws a fuller, rounder mass sweeping down over the viewer-right ear. The head outline reads
  differently at frame scale, not just on a crop.
- **Mouth register**: the card's `expr-delighted` is a closed-teeth grin; the frame is an open
  laughing mouth with the tongue showing.

Taken together this reads as a different man from the one L29 established four shots earlier — and
L29 got him right. That is the definition of a named-cast identity break, and it is the basis of the
fail. It also propagates, because L34 is a delta on this frame.

**Continuity, and a second thing the stamping pass should see.** I diffed L33 against its L28 place
seed: 16.14% of pixels moved, and the change mask is dominated by the two added figures and the
opened roller door, both authored. Racks, benches, tray shelves, strip lights, wall split, floor and
the foreground bench end all hold position. But the mask also shows **the `MINISCRIBE` board gone** —
a solid block of change where the sign hangs in L28 and L29, and plain ceiling in its place here.
L33's own payload does not ask for the sign, so this is not strictly disobedience. It is still worth
a ruling, because six shots seed off this same L28 plate (L29, L33, L44, L46, L47, L48) and if the
board is present in some and absent in others the assembly floor flickers its own signage across the
act.

Ink: hue 75.1°, R−B +2.5, median sat 0.1294. Warm-neutral, no inversion.

Continuity: `ok` on place structure; sign-drop noted above.

## L34 — `staged-interaction`, "hard drives for their PCs," (delta on L33)

**Verdict: FAIL — delta discipline; both figures silently re-drawn.**

The authored change landed, and landed well. Cropped at 4× on the doorway, the open roller door now
shows a **queue of loaded pallets nose to tail running out into the yard**, with one more pallet
further out and blue sky above — exactly the "volume added as one element rather than restaged" the
shot notes ask for. The place also holds: racks, benches, tray shelves, strip lights, wall split,
floor, foreground bench end, palette, and the handshake's contact geometry are all where L33 left
them, and the pixel diff against the parent is only 3.67%.

The failure is what else moved inside that 3.67%. The prompt said "everything else exactly as
established", and **both figures were re-drawn from scratch**:

- `ibm-suit` goes from the card's `expr-smug` — heavy lids, closed smirk — to wide open eyes and an
  open tooth-showing smile. That is a different expression token, not a variance within one.
- `miniscribe-rep` goes from L33's jet-black hair, closed happy-arc eyes and open laughing mouth to
  **warm brown hair**, open round eyes and a small open smile.

Counting properly: one authored change (the pallet queue) plus two unauthored figure re-draws is
**three changes against a ≤2 delta cap** — over the cap, with the overage entirely unauthored.
Across a hard cut between two adjacent VO lines on a held handshake, two faces changing at once is
the most legible defect in my slice.

**The awkward part, and the reason L33 and L34 have to be ruled on together:** L34's
`miniscribe-rep` is the *canonical-correct* one. Its brown hair and head silhouette match
`visual-kit/refs/miniscribe-rep/miniscribe-rep.png` and the L29 rendering; L33's black-haired
version does not. So the chain contains one drifted frame and one corrected frame, and whichever is
kept, the other has to move. Fixing L33's identity would also close L34's larger delta.

Ink: hue 116.7°, R−B +0.9 — the smallest positive margin in the slice, though the sign is still
correct and the frame is not inverted. Median sat 0.1255, in line with its parent (0.1294), which is
itself evidence the palette held.

Continuity: `ok` on place; **figure continuity fails** as described.

## L35 — `physicalized-imbalance`, "and within four years the company was making"

**Verdict: PASS.**

The number-with-a-body staging is exactly the authored one. The tower is **four tiers** of
shrink-wrapped pallets, each stepped visibly wider than the one above, rising to the roof trusses,
with `miniscribe-rep` standing small on the top tier in `action-celebrate` — both fists up, eyes
closed in delighted arcs, grin wide. One shaft of daylight from a roof light comes down and lands on
the top tier, which is the one thing that has to be right for the growth beat to read, and it is.
Below, the factory floor runs back with steel benches on both sides and a forklift parked
stage-right; a cropped forklift mast cuts the lower-left for depth. Cool grey-teal-cream palette.
Both forklift elements are authored, so the pair is not a duplication defect.

The figure is small by design ("standing small"), and at 6× he still reads correctly:
canonical-brown side-parted hair, tan blazer, brown open-collar shirt, dark trousers, dark shoes —
the same man L29, L34 and the canonical draw. No ears, uniform head tone, flat cel. No text anywhere
in the frame.

Ink: hue 74.4°, R−B +5.4, median sat 0.1686 — nearest to the era prior of any frame in the first
two-thirds of the slice.

Continuity: `ok` — no chain parent, no place seed.

## L36 — `number-glued-to-object`, "125 million dollars a year."

**Verdict: PASS.**

The number is glued to its referent mass exactly as the shot notes demand. `miniscribe-rep` is
planted in `action-powerstance` on top of a banded bale of banknotes the size of a car filling the
centre of the frame; two smaller bales sit stage-left and stage-right at half its height; the ground
is flat cream; the palette is charcoal-cream-green; the light is even and frontal.

**Lettering is correct on every axis.** The wide paper band strapping the big bale carries
`125 MILLION`, correctly spelled, in hand-drawn marker caps in the dark-brown house ink, on the
authored surface — the band itself, not the bale face, not the ground. Nothing else in the frame
carries text. This is what L32's bucket should have looked like if lettering had been authored there
at all, and the difference between the two frames is instructive: L36 was seeded with the
`lettering-marker-italic` exemplar and got house lettering; L32 was not seeded with it and invented
off-register lettering anyway.

The figure is the closest card match in my slice. Against
`fig-miniscribe-rep--action-powerstance--expr-greedy` it reproduces the angled dark brows, the heavy
lids over narrowed eyes, the asymmetric closed smirk, the brown hair and silhouette, the tan blazer
over brown open-collar shirt, the dark trousers, and the hands-on-hips geometry with the
viewer-right fist articulated. `expr-greedy` reads as authored rather than sliding into anger.

One trivial deviation: the prose asked for foreground depth from "a cropped bale corner across the
bottom of the frame", singular; the frame gives two cropped bales, one at each bottom corner. Since
the clause says "across the bottom of the frame", two corners spanning it is a defensible reading.

Ink: hue 30.8°, R−B +30.0, median sat 0.1961 — **on the era prior**, and the second-highest
saturation in the slice.

Continuity: `ok` — no chain parent, no place seed.

## L37 — `symbolic-stand-in-object`, "And at their peak in 1988,"

**Verdict: PASS.**

`miniscribe-rep` stands at the very top of a summit built entirely out of stacked drive cartons, in
`action-salute` with `expr-delighted`; the carton slope falls away on both sides into low cloud;
pale blue sky fills the upper half; the palette is cream-teal-charcoal; a cropped carton corner at
the lower-right gives foreground depth. The peak reads as a peak, which is what the shot has to
deliver four cuts ahead of the fall.

The figure matches `fig-miniscribe-rep--action-salute--expr-delighted` almost line for line: brown
hair and silhouette, closed delighted arcs, wide toothed grin, tan blazer over brown shirt, dark
trousers and shoes, the salute hand at the brow drawn with the same three fingers plus thumb as the
card, the free hand at the side at the same scale. No ears, uniform head tone, flat cel, no text.

Two deviations, both recorded rather than charged:

- The prose asks for a **steep** summit with the figure planted **small** at the top. The rendered
  pyramid is a gentle stepped ziggurat, and the figure occupies roughly a third of its height, so he
  reads large rather than small. The "peak" idea survives; the vertigo the adjective was buying does
  not.
- "Hard high sun from stage-left" is not really staged — the lighting is close to flat ambient, with
  the carton shading reading as local occlusion rather than a directional key.

Ink: hue 30.3°, R−B +36.5, median sat **0.2039** — the warmest-saturated frame in the slice and the
only one above the era prior.

Continuity: `ok` — no chain parent, no place seed.

---

# Slice summary

**8 pass / 4 fail.** Fails: L27, L32, L33, L34.

| shot | axis | one-line defect |
| --- | --- | --- |
| L27 | figures/rig | left hand at the sheet's leading edge is a fingerless mitten stub, smaller than the articulated right hand — breaks 4-digit and same-size at the shot's one contact point |
| L32 | register/text | unauthored `FIRE` lettering on the fire bucket, in a non-house sans, on an item never seeded with the lettering exemplar |
| L33 | figures/identity | `miniscribe-rep` drifts off canonical and card at once — brown hair to jet black, quiff silhouette to a full rounded mass, closed-teeth grin to an open laughing mouth |
| L34 | figures/delta | delta re-draws **both** figures unprompted on "everything else exactly as established" — 3 changes against a ≤2 cap; `ibm-suit` loses `expr-smug` entirely |

**Deferred continuity items: none.** Every chain parent and place seed in L26–L37 lies inside the
slice (L28 seeds L29 and L33; L30 parents L31; L33 parents L34), so nothing had to be judged blind.

**Ink: no frame is anywhere near cool inversion.** R−B is positive on all twelve; the closest
approach to the 223° inversion hue is L34 at 116.7°, still 106° away. Nothing to flag under the
30°-proximity rule. The warmest and most on-target frame is L32 at hue 19.4° / R−B +47.7; the
thinnest positive margins are L34 (+0.9), L29 (+1.2), L33 (+2.5) and L28 (+3.0) — all four are cool
grey-teal interiors where the darkest 3% is structural mass rather than outline, which is a caveat
about the proxy, not about those frames.

## Systemic signals (defects appearing across ≥3 frames)

**1. The delta path holds the PLACE and does not hold the FACE. This is the mechanism signal of the
slice.** I had three parent/child comparisons available — L28→L29 (place seed), L30→L31 (chain),
L33→L34 (chain). Environment, palette, prop positions and foreground crops held in **3 of 3**, and
held tightly: 1.48% pixel change on L30→L31, 3.67% on L33→L34, with the change masks confined to the
authored addition plus outline jitter. Figures held in **0 of 3**. L31 moved terry-johnson's eyeline
and brow colour; L34 re-drew both ibm-suit and miniscribe-rep from scratch. Every one of those face
changes was unauthored, and every one lands across a hard cut between adjacent VO lines, which is
where an eye is least forgiving. Whatever the delta mechanism is pinning, it is pinning scenery and
letting the cast float — a fixable asymmetry in how parent frames are seeded, not three independent
accidents.

**2. `miniscribe-rep`'s hair is the canary, and L33 is the single outlier.** He appears in six frames
in my slice: L29, L33, L34, L35, L36, L37. Five draw him with warm dark-brown, side-parted,
quiff-silhouetted hair matching the canonical. **Only L33 draws him jet-black with a different head
outline.** Worth stating precisely, because it means the identity problem is one bad frame rather
than a drifting cast, and re-minting L33 alone would also close L34's over-cap delta. The
terry-johnson case is different in kind: there the STEP-1 card (dark brows) and the canonical (pale
brows) genuinely disagree, so L30 and L31 each obeyed a different authority. That one needs a source
ruling before any re-mint, or the next pass will just flip the flicker the other way.

**3. Median saturation sits below the era prior across most of the act.** Nine of twelve frames
measure 0.0745–0.1686 against a ~0.19 prior; only L26 (0.1843), L36 (0.1961) and L37 (0.2039) reach
it. Every low frame has an explicitly grey or cool palette in its own prompt, so each is
individually compliant — but compliance frame by frame is producing an act that will read flatter
than the era prior taken as a body, and the three frames that do reach the prior are the three that
authored a warm or coloured ground. An act-level colour-budget observation for whoever owns the
palette, not a per-frame defect; nothing is failed on it.

**4. Enumerated counts in prose are not reliably honoured, in either direction.** L26 renders 7 of 9
cartons, undershooting the two clusters the prose explicitly doubled and tripled; L36 renders two
cropped foreground bales where one was named; L28 renders two bench runs per side where two total
were named. Three frames, no consistent direction — an enumerated multiplicity is being treated as a
vague "several". Low stakes on these three specifically, but it matters the moment a count is the
point of a shot.

**5. Not systemic, and worth saying so explicitly.** Unauthored text appeared in exactly one frame
(L32), and lettering was correct on all three frames that seeded the `lettering-marker-italic`
exemplar (L28, its L29 carry, and L36). The p6b duplicate-element class — second '1983' tent card,
second till — did **not** recur anywhere in this slice, and no style-tile content bled into any
frame.

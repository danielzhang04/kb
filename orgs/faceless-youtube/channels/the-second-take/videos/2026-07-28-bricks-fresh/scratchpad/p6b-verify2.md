# Phase 6B fresh-eyes verification — ROUND 2 (4 surgical retries + 5 new chain shots)

Reviewer: fresh-eyes verifier round 2 (uninvolved in generation) · 2026-08-06 · branch `claude/bricks-doctrine-reset`
Scope: the 9 frames in `KIT/_staging/` awaiting a verdict — `L06-retry1`, `L07-retry1`, `L16-retry1`,
`L18-retry1` (retries), `L10`, `L22`, `L23`, `L24`, `L25` (new chain shots).

References used: `shots.json` authored prompts + `global_prompt_suffix`; the parked originals
`_staging/L06.png`, `L07.png`, `L16.png`, `L18.png`; the promoted verified frames
`assets/scenes/L03.png`, `L05.png`, `L17.png`; round-1 verdicts in `p6b-verify.md`.

**Weaknesses first in every note.** Verdicts: PASS = stamp-ready `verified`; CONCERN/FAIL = `parked`
(the stamp script parks on ANY non-clean axis, even LOW, and on ANY failed DSG-lite item).

Criteria: (1) authored content complete / nothing unauthored · (2) plate + chain continuity ·
(3) era register (warm even outline, frontal eye-level, flat cel, chromatic) · (4) figure
integrity/identity · (5) lettering register.

**Retry rule applied:** each retry is judged against BOTH its authored prompt AND its parked
original's ruling. A retry passes only if it fixed the failed attributes *without breaking passing
ones*. The one sanctioned retry is SPENT on all four, so an honest park here is final at this tier
and routes to the human board.

## Independent measurements (my own, same methodology as round 1: darkest-3% circular-mean hue, mean R−B, median HSV saturation)

| frame | med sat | ink RGB | ink hue | R−B | ink lum |
| --- | --- | --- | --- | --- | --- |
| L06-retry1 | 0.2353 | (17.3, 6.5, 0.6) | 26.2° | **+16.7** | 8.1 |
| L07-retry1 | 0.2510 | (21.5, 9.4, 1.5) | 30.6° | **+20.0** | 10.8 |
| L16-retry1 | 0.1255 | (30.3, 14.7, 5.0) | 21.9° | **+25.3** | 16.6 |
| L18-retry1 | 0.2824 | (14.8, 5.8, 0.8) | 23.6° | **+14.0** | 7.1 |
| L10 | 0.4431 | (14.8, 5.3, 1.9) | 18.0° | **+12.9** | 7.3 |
| L22 | 0.0902 | (7.8, 5.7, 3.9) | 40.7° | +3.9 | 5.8 |
| L23 | 0.0980 | (6.3, 4.1, 2.8) | 32.0° | +3.4 | 4.4 |
| L24 | 0.1059 | (4.5, 2.7, 2.1) | 22.3° | +2.4 | 3.1 |
| L25 | 0.1176 | (3.0, 1.6, 1.4) | 13.2° | +1.5 | 2.0 |
| *L16 (parked baseline)* | *0.1686* | *(10.2, 11.1, 10.2)* | *158.4°* | *−0.0* | *10.5* |
| *L03 (approved plate)* | *0.0902* | *(10.1, 8.3, 6.0)* | *40.8°* | *+4.1* | *8.2* |
| *L05 (approved plate)* | *0.2275* | *(30.1, 15.7, 4.9)* | *28.2°* | *+25.2* | *16.9* |
| *L17 (verified parent)* | *0.2824* | *(20.9, 12.4, 3.0)* | *35.6°* | *+18.0* | *12.1* |

Every one of the 9 measures WARM (R−B positive, hue 13–41°). The R1 cool-ink inversion is gone
from the whole set, including L16-retry1, which was the sole inversion in round 1.

---

## L06-retry1 — store-1983 delta, retry of the double-'1983' park — **CONCERN → park**

- **Weakness / the ruling asked for: the crate moved, and it moved to the WRONG END.** The authored
  delta is exactly one element — *"an opened wooden crate now stands **at the counter's near end**"*
  (`changed_elements` repeats it). Rendered, the crate stands **on the counter's top surface at its
  FAR end**. That is not a judgement call about which end is which: `shots.json` L05 fixes the
  geography itself — *"Propped inside the window glass **at the counter's far end**, a small card
  carries '1983'"* — and in this frame the crate sits immediately beside that window card, sharing
  its sill. So the file's own marker for the far end is touching the crate. Round 1 scored this
  attribute an explicit PASS (`e2`: "Present and correctly placed at the counter's near end"), so
  this is a **regression on a passing attribute** — the documented cost of a fresh re-roll.
  Second, smaller: standing the crate ON the counter rather than at it also crowds the frame's right
  third and buries most of the window behind it; a third of the crate is cropped by the frame edge.
- **The primary defect IS fixed, cleanly.** Exactly ONE '1983' renders, on the window card, marker
  capitals, correct wording, fully legible. The unauthored counter tent card is gone. Verified at
  crop.
- Content otherwise complete: the crate is opened ✓, packing straw spills over its lip and down the
  counter's front edge ✓, one beige machine sits half unwrapped inside it ✓ (wrapping paper drawn).
- Continuity: excellent against `assets/scenes/L05.png` — three shelf bays with the same machines in
  the same bays, oak counter, brass till, cream-and-teal lino with teal skirting, street door open
  stage-left with its glazed panel and hung blank picture, ceiling panels. Nothing else moved.
- Register: warm outline (26.2°, R−B +16.7) ✓, flat cel ✓, frontal eye-level ✓; sat 0.2353,
  chromatic on teal/oak/beige ✓.
- Figures: cast-free as authored ✓.
- Lettering: one '1983', correct register, correct count ✓.
- **Board note:** this is the mildest of the four retry outcomes. What it fixed (a duplicated
  diegetic literal, which breaks the dateline's function) is more serious than what it broke (the
  sole changed element's placement relation, on a terminal 2.4s delta with no downstream chain
  dependency — L07 seeds L05, not this frame). It is a defensible human waiver; it is not a
  defensible machine `verified`.

## L07-retry1 — store-rush base, retry of the 4-defect park — **FAIL (park)**

Three of the four flagged attributes were fixed. The retry then introduced two new defects, one of
them a blocking lettering item.

- **New defect 1 — the room now has TWO counters and TWO brass tills.** The retry put a counter
  across the foreground-left (with a large brass till on it) while the seeded L05 plate kept its own
  counter and brass till along the right wall. Both are drawn, both carry a till. The prompt authors
  one counter with one brass till, and L05 establishes one. This is a duplicated established place
  prop — **structurally the same defect class that parked L06 in round 1**, just applied to the till
  instead of the dateline card.
- **New defect 2 — garbled unauthored lettering.** The foreground till's display panel carries
  drawn glyphs (they read approximately "ᴦ9Ȣ£" — mirrored/garbled characters, examined at 8× crop).
  The era suffix forbids unrequested text and DSG-lite makes a garbled render blocking. Nothing in
  the prompt authors a till display legend.
- **Weakness 3 — the flagged vantage is still not delivered, only half-addressed.** The prompt asks
  for *"from down on the shop floor… medium-wide **at counter height**, the counter edge **across**
  the foreground"*. A counter edge is now in the foreground, which the parked original lacked — but
  it occupies only the left third rather than crossing, and the camera looks **down onto both
  counter tops**, which puts it well above counter height. At counter height a counter top is a
  near-edge-on line, not a fully visible surface.
- **Fixed 1 — the floating banknote.** Every raised note is gripped by a visible hand; I walked all
  eight raised fans plus the one held at chest height at crop. Arms are frequently occluded by heads,
  which is honest overlap in a packed crowd, not amputation. The round-1 orphan note is gone.
- **Fixed 2 — the truncated '1983'.** The window card now renders complete and fully legible
  ("1983", marker capitals, verified at 4× crop). Round 1's objection was truncation, not presence,
  so on its own reasoning this item is closed. (The shot's *notes* still say the card should sit
  behind camera at this vantage; it is drawn. I do not charge that — re-quoting an established place
  literal verbatim is the file's own L-1 practice, and round 1 charged only the half-quote.)
- **Fixed 3 — the crate relation.** The crate now sits at the foreground counter's near end with its
  straw, where round 1 found it on the floor at the opposite side of the frame from the counter.
- Content otherwise: queue of buyers packed and ranked back between the bays ✓, wide collars and
  bulky coats ✓, banknotes raised over shoulders ✓, cream-and-teal lino ✓, bays behind ✓. Weaker:
  the right-hand counter stands completely unattended, so "the head of the queue pressed to the
  counter edge" reads only loosely, against one of the two counters.
- Continuity: the L05 room is reproduced faithfully (bays, boxes, till, lino, door, ceiling, window).
- Register: warm outline (30.6°, R−B +20.0) ✓, flat cel ✓; sat 0.2510, chromatic ✓.
- Figures: cream blank-oval faces with dot eyes, consistent with the channel's crowd convention ✓;
  2 arms / 2 legs on every foreground figure checked at crop; no floating props.

## L16-retry1 — crowd-multiplication, retry of the cyan-ink park — **FAIL (park)**

**The tradeoff ruling asked for: the retry bought a measurable invariant and sold the shot's whole
compositional argument. That is not a trade a machine verdict may accept.**

- **What it fixed, and it genuinely fixed it.** Ink measures **21.9° / R−B +25.3** against the parked
  baseline's **158.4° / −0.0** — the cool blue-black inversion is gone and the reading sits on the
  `#241a12` target. The cases now render warm beige against a cool grey room, so the authored "beige
  on grey" two-colour palette reads for the first time. Both flagged attributes are closed.
- **Weakness 1 — the authored square-to-frame shelf is gone.** The prompt pins *"its face **square to
  the frame**"* and the shot's own notes state why: *"Restaged as a frieze… Multiplication reads from
  the rank, **not from a run converging away down its length**."* Rendered, the shelf runs in a deep
  one-point oblique to a vanishing point at right — precisely the geometry the R-16 restaging was
  written to eliminate. This attribute was an explicit PASS in round 1 (`a1`).
- **Weakness 2 — the rank no longer runs past both frame edges.** Authored: *"the row carrying on
  **past both frame edges**"*. Rendered it runs past the left edge and **converges into depth at the
  right**, terminating inside the frame. Round 1 passed this attribute too (`e2`). The multiplication
  argument now reads as perspective recession rather than as an endless rank.
- **Weakness 3 — the era vantage is reintroduced.** The file carried a TIER-A VANTAGE REPAIR on this
  shot that DELETED its off-eye-level camera language on the principle that the house vantage needs
  no camera language. A deep oblique is exactly that camera language, restored — so this is an era
  regression, not only a composition one.
- **Weakness 4 — the lit centre bay is much weaker.** *"The case at centre has its bay lit from
  inside"* renders as a soft warm wash across one case's face rather than the unmistakable amber-lit
  bay of the parked original. The payload contrast the beat turns on is diluted.
- **Weakness 5 — median saturation FELL, 0.1686 → 0.1255.** The subject's chroma improved (the cases
  are beige now), but the oblique opened large flat grey wall and ceiling fields, so the frame as a
  whole is less filled edge-to-edge and more grey in aggregate than the frame it replaces.
- Content otherwise delivered: identical cases nose-out ✓, an identical drive in each front bay ✓,
  steel uprights and crossbraces at intervals ✓, flat cardboard sleeves stacked on the shelf below ✓
  (more of them, and better).
- Figures: cast-free as authored ✓. Lettering: none drawn ✓.
- **Board note, stated plainly:** on the whole-frame test this retry is **worse than the frame it
  replaces**. The parked original's defect was colour temperature — a *generator-side* dial that the
  R1 fix now demonstrably corrects on every other frame in this set. This retry's defect is *authored
  composition and vantage*, which is the shot's reason for existing. If the board must ship one of
  the two today, the parked original holds the authored frieze; the durable fix is a re-issue that
  keeps the parked original's staging and inherits the R1 warmth, not this frame.

## L18-retry1 — shopfront-brawl delta, retry of the worst park in round 1 — **PASS**

**The one clean recovery in the set. All four round-1 defects are closed and nothing measurable broke.**

- **Weakness (the only one I found):** the slabs' contact reads as inner **edges** meeting in a
  shallow ∧ rather than literal face-flush contact. I do not charge it, because the authored clause
  binds the geometry to a comparator — *"locked up **exactly like the two cases behind them** at
  their own smaller scale"* — and the two beige cases in the verified parent L17 meet at exactly that
  kind of angled seam, not face-flush either. The slabs mirror the parent's geometry precisely, which
  is the payload the line "and Apple fight over the phone market" needs. Second, trivial: the slabs
  occlude the lower fronts of both cases — an unavoidable consequence of staging them at the
  platform's front edge as authored, not a change to a held element.
- **Fixed 1 — the R-12 lock-up geometry.** The slabs now **stand upright** at the platform's front
  edge, shoved into each other with a **matching crumpled dent at the contact** (drawn on both) and
  their **bottom edges skidded apart** on the platform. The round-1 failure — two slabs lying flat,
  splayed open like a book, reading as display stock — is completely gone. Verified at 4× crop.
- **Fixed 2 — the held set is held, frame-for-frame.** Against `assets/scenes/L17.png`: the plate-glass
  side panels, the wooden reveal, the black platform, the spotlight and its cone, both beige cases
  with their dented seam and proportions, and the crowd's every figure, pose, coat and shopping bag
  all carry over unchanged. This is now one of the strongest delta holds in the video.
- **Fixed 3 — the crowd is the SAME crowd, in period.** Coats, headscarves, shopping bags at the
  knees, faces turned in to watch — the same individuals in the same positions as L17. The round-1
  era break (t-shirts, modern casual, modern hair, different face treatment) is gone.
- **Fixed 4 — the red accent is semantic again.** The single red is the scuffed contact arc beneath
  the cases, the punch element, exactly the licensed use — plus a small red glow at the slabs' own
  contact, which reinforces rather than dilutes the semantics.
- Register: warm outline (23.6°, R−B +14.0) ✓, flat cel ✓, frontal wide ✓; sat 0.2824, identical to
  its parent ✓.
- Figures: crowd unchanged from the verified parent; integrity holds; no fused or floating limbs.
- Lettering: **none drawn** ✓ — screens blank. **No brand marks** on the slabs ✓ (generic home-button
  circle, earpiece slot, camera dot; no logo, no text), so the evergreen-reference policy holds.

## L10 — ironic-counterpoint (overnight queue), new chain shot off plate L05 — **FAIL (park)**

- **Weakness 1 — the crowd is on the wrong side of the glass, which inverts the shot's entire
  device.** Authored: *"**beyond the window glass** a queue of overnight buyers curls away down the
  pavement in blue half-light, **folding chairs, sleeping bags and flasks along the kerb**, breath
  showing in the cold"*, with framing *"the glass **splitting the still interior from the packed
  street**"* and the note *"Crowd behind the window glass (positive rear zone)"*. Rendered, the
  entire authored group — the camp chairs, the sleeping bag, the flasks, the breath puffs — is
  **inside the shop**, sitting and standing on the shop floor against the bare shelf bays and up
  against the counter. A thin secondary queue of plain standing figures is visible outside through
  the door and window, carrying none of the authored props. So the interior is the packed half and
  the street is the still one: the counterpoint is reversed. Confirmed at crop on both zones.
  A supporting tell: **breath is drawn on the indoor figures**, which is incoherent except as the
  symptom of the two zones being merged.
- **Weakness 2 — the authored vantage was not delivered.** *"Framing: wide from **behind the
  counter**"*. Rendered, the camera sits in the room with the counter running along the right wall
  into depth — the L05 door-side vantage again. Against L05 this will cut as the same camera, which
  is the same failure round 1 charged on L07.
- Content otherwise: the shelf bays are correctly **bare** ✓ (authored), the oak counter and brass
  till are unlit ✓, the door's hung picture is blank ✓, the street beyond reads blue-grey dawn ✓,
  and the palette — *"blue-grey dawn outside, unlit warm brown inside"* — is delivered well and is
  the frame's real strength (sat 0.4431, the richest in this set).
- Continuity: the L05 room holds — proportions, counter, till, ceiling panels, door with glazed panel
  and blank picture ✓.
- Register: warm outline (18.0°, R−B +12.9) ✓, flat cel ✓, frontal eye-level ✓, chromatic ✓.
- Figures: cream blank-oval faces with dot eyes and mouth line, consistent with the crowd convention
  ✓; 2 arms / 2 legs where visible, mittened hands on flasks, no floating props ✓.
- Lettering: **none drawn** ✓ — the window card is correctly out of frame, as the notes require.

## L22 — brick-tease base off plate L03 — **PASS**

- **Weakness 1 — the crew is staged in the light, at the wrong pallet.** Authored: *"A crew of
  packers works **the far pallet in the shadow beyond the lamp**, lifting cartons up off a hand
  truck"*. Rendered, four packers work the **near-left** pallet, standing **inside the lamp's pool**
  and to the camera side of the lamp. The staging intent is nonetheless met — the crew is present,
  visibly packing off a hand truck, in a positive rear-left zone that obstructs neither the pallets
  nor the tally card — so I score this a staging drift inside the authored arrangement, on the same
  standard round 1 applied to L19's crew ("in front of the racks, not on the far side") and L01's
  crowd, both of which passed.
- **Weakness 2 — "the lit pallets stand large and fill the lower two-thirds of the frame"** is
  partially delivered: the stacks occupy the middle band with roughly 130px of empty lit floor below
  them. This matches the human-approved L03 plate's own framing almost exactly, so it is judged
  against a standard the board has already set.
- Content: roller door shut at the rear ✓, empty steel shelving down the right wall ✓, work lamp on
  its tripod stage-left with its amber pool ✓, three pallets built shoulder-high with sealed brown
  cartons in tight rows ✓, **clear film drawn hard round the lower courses and cut back clear of the
  whole top row on each stack** ✓ (the film sheen stops below the top course on all three — the
  feasibility gate L23/L24 depend on is genuinely rendered), hand truck ✓.
- Continuity: **excellent** against `assets/scenes/L03.png` — same roller door, same right-wall
  shelving, same lamp and tripod with its trailing cable, same high blue windows, same concrete, same
  lit pool shape. The authored change (pallets rebuilt, film cut back, crew, tally card) is the only
  difference.
- Register: warm outline (40.7°, R−B +3.9, essentially L03's own +4.1) ✓, flat cel ✓, frontal
  eye-level ✓. **Median saturation 0.0902 — identical to the approved L03 plate to four decimals.**
  Under the R3 night-scene exception this is authored darkness, not a grey-drain regression.
- Figures: four packers, cream blank ovals with dot eyes, consistent with the convention ✓; the near
  packer has 2 arms / 2 legs with both hands on his carton ✓; the lifted carton between the two rear
  packers is **gripped by a visible hand on each side** ✓ — no floating prop; the rest is honest
  occlusion behind the pallet.
- Lettering: the tally card carries **'26,000'** ✓ — marker capitals, comma correct, fully legible,
  and it is the only text in frame. Every carton face, wall and shelf is blank ✓, which a room this
  full of cardboard could easily have got wrong.

## L23 — brick-tease delta 1 (the reveal) — **FAIL (park)**

- **Weakness 1 — the opened carton is roughly 3× the size of the carton the prompt authors.** The
  authored change is *"the **front carton on that unwrapped top row** now stands with its flaps
  folded open"* — one carton among the ranked cartons its parent drew. Measured against the parent:
  in L22 the centre pallet spans x≈565–800 and its top row holds **three** cartons across (~78px
  each); in L23 a **single** open box spans x≈565–830, replacing the whole rank. Its flaps alone are
  wider than any carton in the frame, and they overlap the neighbouring pallets. So the held top row
  of that pallet is not held — it was consumed by the new element.
- **Weakness 2 — the brick does not fill the box, and the prompt says it must.** Authored: *"one red
  clay brick lying inside it on crumpled paper and **filling the box exactly**"*. Rendered, the brick
  spans ~95px inside a ~265px opening — about a third of the width and much less of the area, sitting
  in a bed of crumpled paper. This is not a cosmetic miss: **the very next beat's narration is "red
  clay bricks into little boxes"**, so a pallet-width box contradicts the line it sets up, and the
  gag (a brick exactly filling a computer-sized carton) is the reason the shot exists.
- Content otherwise: the flaps ARE folded open ✓, the brick IS red clay ✓, on crumpled paper ✓, the
  reveal lands on the right beat ✓.
- Continuity: otherwise **exemplary** — lamp, tripod and cable, roller door, right-wall shelving, all
  four packers in identical poses, the left and right pallets with their film, the tally card, the lit
  pool and the parquet-grey floor all hold frame-for-frame against L22.
- Register: warm outline (32.0°, R−B +3.4) ✓, flat cel ✓; sat 0.0980, **above** the approved L03
  baseline of 0.0902 — authored night darkness under the R3 exception, not a drain ✓.
- Figures: unchanged from the parent; integrity holds ✓.
- Lettering: '26,000' re-quoted verbatim and legible ✓; no other text ✓.

## L24 — brick-tease delta 2 (the row) — **FAIL (park)**

- **Weakness 1 — the scale defect propagates row-wide.** The authored change is *"**every remaining
  carton** along that unwrapped top row now stands with its flaps folded open too, one red clay brick
  lying inside each… **filling its box exactly**"*. Rendered, the top row of each of the three pallets
  is replaced by **one pallet-width open box**, each holding one small brick in crumpled paper. So
  both of L23's failed facts recur, now three times over: these are not the ranked cartons, and no
  brick fills its box. Smaller open cartons with bricks do appear in depth behind, so the row-wide
  *read* partially lands — but on the wrong objects.
- **Weakness 2 — two held crew members changed appearance.** Against L22/L23, the second packer from
  the left is now drawn with a **white head covering, hair and a collared shirt with a tie** where he
  was a bare cream oval in workwear, and the fourth packer gains a **grey head covering with hair**.
  A delta's contract is that only the authored change moves. Low severity — they are small, rear-zone
  and unnamed — but it is a real held-set drift, and it persists into L25.
- Content otherwise: flaps folded open ✓, red clay bricks ✓, crumpled paper ✓, the plural the beat
  needs is legible ✓.
- Continuity: everything else holds — lamp, tripod, roller door, shelving, pallets, film on the lower
  courses, the tally card, lit pool.
- Register: warm outline (22.3°, R−B +2.4) ✓, flat cel ✓; sat 0.1059, climbing above the L03 baseline ✓.
- Figures: no amputations or fused limbs; the defect is identity drift, not anatomy.
- Lettering: '26,000' re-quoted, legible ✓; nothing else drawn ✓ (correct — the lettering is L25's beat).

## L25 — brick-tease delta 3, chain close — **FAIL (park)**

- **Weakness 1 — the inherited scale defect, unchanged.** Every fact charged on L23/L24 is still on
  screen: three pallet-width boxes standing in place of the ranked cartons, each holding one brick
  that fills a fraction of its opening. This frame carries the narration *"boxes labelled hard
  drive"* against boxes that are nothing like the "little boxes" the previous line names.
- **Weakness 2 — "the front face of EVERY ONE of those open cartons"** is under-delivered: the three
  foreground boxes carry 'HARD DRIVE', the smaller open cartons in depth behind them carry nothing.
  Low on its own — lettering those at this scale would be illegible, and the three that read carry
  the beat — but the authored quantifier is not met.
- **Weakness 3 — the two crew appearance drifts from L24 persist.**
- **The darkening ruling asked for — it has NOT crossed into defect at L25, and here is the basis.**
  Ink luminance falls monotonically 5.8 → 4.4 → 3.1 → 2.0 down the chain against L03's 8.2, and R−B
  falls +3.9 → +1.5. But (a) the measure samples the darkest 3% of a NIGHT frame, which is dominated
  by the unlit warehouse background rather than by outline strokes, so what is compounding is the
  unlit field, not the ink recipe; (b) **R−B stays positive at every step** — this is not the L16
  cool inversion in slow motion; (c) **median saturation CLIMBS monotonically 0.0902 → 0.1176**,
  the exact opposite of a chroma drain; and (d) at ordinary viewing scale L25 still reads: the lamp
  pool, pallets, bricks, crew, tally card and lettering are all clearly legible, and the right-wall
  shelving still separates from its wall. **Ruling: within register.** It should be treated as a hard
  depth limit, though — the chain correctly closes here at three deltas, and any future night chain
  in this place must re-base off the L03 plate rather than extend, because two more generations at
  this rate would put the unlit field at effective black and R−B at zero.
- Content: the whole top row stands open on red clay bricks ✓, the lettering lands on the beat ✓.
- Continuity: lamp, tripod, roller door, shelving, pallets, film, lit pool, tally card all hold ✓.
- Register: warm outline (13.2°, R−B +1.5) ✓, flat cel ✓; sat 0.1176, the chain's highest ✓.
- Figures: no amputations or fused limbs ✓; identity drift only (weakness 3).
- **Lettering: clean, and this was the highest-risk lettering surface in the set.** 'HARD DRIVE'
  renders three times, transcribed letter-by-letter at 2× crop: H-A-R-D · D-R-I-V-E on all three,
  correctly spelled, marker italic capitals matching the register, no garbling, no partial render.
  '26,000' is re-quoted correctly alongside it. No unrequested text anywhere.

---

## Tally — 9/9 covered

| verdict | count | frames |
| --- | --- | --- |
| **PASS → stamp `verified`** | **2** | L18-retry1, L22 |
| **CONCERN → `parked`** | **1** | L06-retry1 |
| **FAIL → `parked`** | **6** | L07-retry1, L16-retry1, L10, L23, L24, L25 |

Parked reasons in one line each:
- **L06-retry1** — the double '1983' is fixed, but the sole authored delta (the crate) moved onto the
  counter top at its FAR end, where L05's own prose puts the window card; a passing attribute regressed.
- **L07-retry1** — three of four defects fixed, but the frame now draws a SECOND counter with a SECOND
  brass till, the foreground till carries garbled unauthored glyphs, and the counter-height vantage is
  still not delivered.
- **L16-retry1** — warm ink and beige cases landed, but the authored square-to-frame shelf became a deep
  oblique, the rank no longer runs past both frame edges, the Tier-A vantage repair was undone and the
  lit centre bay weakened.
- **L10** — the overnight queue with its chairs, sleeping bags and flasks is staged INSIDE the shop
  instead of beyond the window glass, inverting the shot's still-interior/packed-street device; the
  "wide from behind the counter" vantage was also not delivered.
- **L23** — the opened carton is ~3× the ranked carton it replaces and the brick fills about a third of
  it, against an authored "filling the box exactly" and a next-beat narration of "little boxes".
- **L24** — the same scale defect propagated to all three pallets, plus two held crew members gained
  headwear and clothing against the parent.
- **L25** — the inherited scale defect, 'HARD DRIVE' on only the three front boxes rather than every open
  carton, and the persisting crew drift. Lettering register itself is clean.

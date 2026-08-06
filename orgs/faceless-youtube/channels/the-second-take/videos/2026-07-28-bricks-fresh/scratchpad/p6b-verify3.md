# Phase 6B fresh-eyes verification — ROUND 3 (FINAL) — 1 re-mint + 4 retries

Reviewer: fresh-eyes verifier round 3 (phase-6b, uninvolved in generation) · 2026-08-06 ·
branch `claude/bricks-doctrine-reset`
Scope: the 5 frames in `KIT/_staging/` awaiting a final verdict — `L16-remint1` (changed-mechanism
re-mint), `L23-retry1`, `L24-retry1`, `L25-retry1` (the re-based night chain), `L10-retry1`.

References used: `shots.json` authored `still_prompt` / `changed_elements` / `notes` +
`global_prompt_suffix`; the parked originals `_staging/L16.png`, `L16-retry1.png`, `L10.png`,
`L23.png`, `L24.png`, `L25.png`; the promoted verified plates `assets/scenes/L03.png`, `L05.png`,
`L22.png`; round-1 verdicts in `p6b-verify.md` and round-2 verdicts in `p6b-verify2.md`;
`p6b-genlog.md` round-3 section.

**Weaknesses first in every note.** Verdicts: PASS = stamp-ready `verified`; CONCERN/FAIL = `parked`
(the stamp script parks on ANY non-clean axis, even LOW, and on ANY failed DSG-lite item).

Criteria: (1) authored content complete / nothing unauthored · (2) plate + chain continuity ·
(3) era register (warm even outline, frontal eye-level, flat cel, chromatic) · (4) figure
integrity/identity · (5) lettering register.

**All retry and re-mint budgets are SPENT.** A park here is final at the machine tier and routes to
the human board. I have judged accordingly: no leniency to save a frame, no harshness to look rigorous.

## Independent measurements (mine, same methodology as rounds 1–2: darkest-3% circular-mean hue, mean R−B, median HSV saturation)

| frame | med sat | ink RGB | ink hue | R−B | ink lum |
| --- | --- | --- | --- | --- | --- |
| **L16-remint1** | 0.1294 | (28.7, 17.6, 10.7) | **16.8°** | **+18.0** | 20.1 |
| **L23-retry1** | 0.0980 | (5.5, 3.4, 2.5) | 25.4° | +3.0 | 3.9 |
| **L24-retry1** | 0.1059 | (5.2, 2.9, 2.4) | 21.3° | +2.8 | 3.5 |
| **L25-retry1** | 0.1176 | (3.3, 1.7, 1.6) | 13.2° | +1.7 | 2.1 |
| **L10-retry1** | 0.2471 | (11.6, 13.1, 15.4) | **217.7°** | **−3.8** | 13.0 |
| *L16 (parked baseline)* | *0.1686* | *(9.5, 11.1, 10.9)* | *176.6°* | *−1.4* | *10.6* |
| *L16-retry1 (parked r2)* | *0.1255* | *(29.0, 14.7, 6.5)* | *20.4°* | *+22.5* | *18.0* |
| *L10 (parked r2)* | *0.4431* | *(14.1, 5.3, 2.6)* | *16.0°* | *+11.5* | *7.6* |
| *L03 (approved plate)* | *0.0902* | *(9.9, 8.2, 6.1)* | *40.2°* | *+3.8* | *8.5* |
| *L22 (verified chain root)* | *0.0902* | *(7.6, 5.7, 4.1)* | *37.8°* | *+3.5* | *6.1* |
| *L05 (approved plate)* | *0.2275* | *(29.7, 15.7, 5.3)* | *28.8°* | *+24.4* | *18.7* |

My numbers reproduce the genlog's to within rounding. **Four of five measure warm. `L10-retry1` is
the exception and it is a hard inversion** — 217.7° with R−B **negative**, the same defect class that
parked L16 in round 1, now on a frame generated AFTER the R1 generator-side fix.

## Independent chain-delta measurement (pixel diff, |ΔRGB| sum > 40)

| step | changed px | bbox | where the change concentrates |
| --- | --- | --- | --- |
| L22 → L23-retry1 | 3.63% | x 99–1056, y 288–673 | x 565–830 only — the centre pallet's top row |
| L23-retry1 → L24-retry1 | 3.26% | x 55–1065, y 279–700 | x 400–550 and x 900–1050 — the left and right pallets |
| L24-retry1 → L25-retry1 | 1.13% | x 87–1057, y 191–688 | the lettering band across all three stacks |

**The held-set discipline on this chain is exemplary — the best in the video.** Each delta lands
exactly and only where the authored change lives; nothing outside it moves. Every failure below is
about the *content* of the delta, never about a held element drifting.

---

## L16-remint1 — crowd-multiplication (shelf of identical cases), changed-mechanism re-mint — **PASS**

**The clean recovery of the phase. The round-1 defect (cool ink) and the round-2 defects (broken
frieze, truncated rank, undone Tier-A vantage repair, diluted lit bay) are ALL closed simultaneously,
and I found nothing that regressed against either parked frame.**

- **Weakness 1 — the lit centre bay is delivered but sits at the low end of the range.** Measured, the
  centre case runs **+24.5 luminance over its immediate neighbours** (191.3 vs 166.7 / 167.1); the
  parked original ran **+32.4** (183.5 vs 149.8 / 152.1). At 4× crop the bay panel is the brightest
  element in frame with a warm halo spilling onto the wall behind, so *"the case at centre has its
  bay lit from inside"* is genuinely rendered — but it reads slightly more as a warm wash over the
  whole case than as a hard-edged lit bay. Round 2 charged this attribute on `L16-retry1` as a
  dilution; here it is materially stronger than that frame and only modestly softer than the parked
  original. I do not charge it: the authored clause is met, and *"the rest of the rank sits in even
  shadow"* is also met, so the contrast the beat turns on is present.
- **Weakness 2 — median saturation 0.1294 sits below the parked original's 0.1686.** I name it
  because round 2 named it on `L16-retry1` (0.1255). Not charged, for three reasons: (a) the authored
  palette is *"beige on grey"* — an explicitly two-colour, low-chroma scene, so median saturation is
  a poor proxy for it; (b) the R1 saturation tripwire is 0.10 and this clears it; (c) the *subject's*
  chroma went the right way — the parked original's cases render grey-green because the ink was
  inverted, and here they render beige for the first time, which is what the palette clause asks for.
- **Weakness 3 — rack geometry is loose at 4× crop.** At the uprights, one diagonal crossbrace runs
  past the upright without terminating on it and the column doubles. Invisible at viewing scale, and
  the authored clause (*"steel uprights and crossbraces stand at intervals along the run"*) is met.
  Named, not charged.
- **Fixed 1 — the ink.** **16.8° / R−B +18.0**, the closest frame in the whole batch to the `#241a12`
  target (~19° / +18), against the parked original's **176.6° / −1.4**. The sole round-1 inversion is
  gone, and it is gone without prose being spent on colour — the generator-side mechanism carried it.
- **Fixed 2 — the shelf face is square to the frame.** The shelf's front rail is a level horizontal
  across the full width with no convergence; the cases stand nose-out in a flat frieze. This is
  exactly the geometry the R-16 restaging was written for, and exactly what `L16-retry1` destroyed
  with its one-point oblique.
- **Fixed 3 — the rank carries on past BOTH frame edges.** Verified at crop on both margins: the
  leftmost case is cut by x=0 and the rightmost by x=1375. `L16-retry1` terminated the rank inside
  the frame at right; this does not.
- **Fixed 4 — the Tier-A vantage repair holds.** The camera is frontal and eye-level with no camera
  language of any kind. Nothing in this frame reintroduces the off-eye-level framing the file deleted.
- Content otherwise complete: identical beige cases ranked edge to edge nose-out ✓, an identical
  drive seated in each front bay ✓ (walked at 3× crop across the whole visible run — same bay, same
  floppy slot, same power dot, same vertical seam on every case), steel uprights and crossbraces at
  intervals ✓, flat cardboard sleeves stacked on the shelf below ✓, palette beige on grey ✓.
- Register: warm outline (16.8°, R−B +18.0) ✓, flat cel with gentle soft shading ✓, frontal
  eye-level ✓, locked 2-colour palette ✓, no red accent spent ✓.
- Figures: **cast-free as authored** ✓.
- Lettering: **none drawn** ✓. The label rectangles on the cardboard-sleeve stacks were checked at
  4× crop and are **blank** — no glyphs, no garbling. This was the one place unrequested text could
  plausibly have crept in.
- **Supersession, stated explicitly:** this frame satisfies the authored prompt AND the era register,
  and it does so without giving up anything either parked frame held. **It supersedes both
  `_staging/L16.png` (parked r1, cool ink) and `_staging/L16-retry1.png` (parked r2, broken frieze).**
  Round 2's board note asked for "a re-issue that keeps the parked original's staging and inherits
  the R1 warmth, not this frame" — this is precisely that frame, and it arrived.

---

## L23-retry1 — brick-tease delta 1 (the reveal), re-based on verified `scenes/L22.png` — **FAIL (park)**

One of the two round-2 charges is substantially fixed. The other is unchanged, and it is the one the
next beat's narration depends on.

- **Weakness 1, the charge that stands — the open box is still ~3.4× the carton the prompt authors,
  and it consumed the whole top row.** Measured against the verified parent: in `scenes/L22.png` the
  centre pallet spans x≈578–793 and its unwrapped top row holds **three** cartons across at **≈72px**
  each. In `L23-retry1` the box body spans **x≈565–812 = 247px** and its opened flaps span
  **x≈540–837 = 297px** — so the single open box is **wider than the pallet it stands on** and
  overhangs it on both sides, and no ranked carton of that row survives. The authored delta is
  *"the **front carton on that unwrapped top row** now stands with its flaps folded open"* — one
  carton among the cartons its parent drew. What renders is a new crate-scale object that replaced
  the row. Round 2's charge #1 is **unchanged in the box dimension**.
- **Weakness 2, the charge that is substantially fixed — the brick now nearly fills the box.**
  Measured, the brick spans ≈135px inside a ≈183px interior opening — **~74% of the width**, against
  round 2's ~36% (95px in 265px). Crumpled paper is visible as a margin on the left, right and behind,
  which the authored clause itself requires (*"lying inside it **on crumpled paper**"*), so a literal
  100% fill is in tension with the prompt's own wording. At viewing scale the brick now plainly reads
  as belonging to that box. **I score this attribute delivered.** The genlog's own note — "brick now
  fills far more of the opening" — understates it; the fix landed.
- Content otherwise: the flaps ARE folded open ✓, the brick IS red clay and the frame's only red ✓
  (correct semantic use of `#d7402b` — the reveal IS the punch element), on crumpled paper ✓, the
  reveal lands on the right beat ✓, film still drawn hard round the lower courses ✓.
- **Continuity: outstanding.** The pixel diff confirms the change is confined to x 565–830. Lamp,
  tripod, trailing cable, roller door, right-wall shelving, high blue windows, all four packers in
  identical poses and identical clothing, the left and right pallets with their film, the tally card,
  the lit pool and the concrete all hold frame-for-frame against the verified `scenes/L22.png`. The
  re-base onto the promoted plate (round 2 had seeded the unreviewed `_staging` copy) worked exactly
  as intended.
- Register: warm outline (25.4°, R−B +3.0) ✓, flat cel ✓, frontal eye-level ✓; sat 0.0980, **above**
  the approved L03 baseline of 0.0902 — authored night darkness under the R3 night-scene exception,
  not a chroma drain ✓.
- Figures: unchanged from the verified parent; 4 packers, cream blank ovals with dot eyes, 2 arms /
  2 legs where visible, every carried carton gripped by a visible hand ✓.
- Lettering: '26,000' re-quoted verbatim, marker capitals, comma correct, fully legible ✓; no other
  text anywhere in frame ✓.

---

## L24-retry1 — brick-tease delta 2 (the row), re-based on `L23-retry1` — **FAIL (park)**

**The wardrobe correction LANDED and is the real win of this frame.** The scale/enumeration defect
changed shape rather than closing.

- **Weakness 1 — the top rows are still not cartons.** Examined at 4× crop on both flanking pallets:
  what renders on each of the left and right pallets is **ONE pallet-width open box with a single
  continuous front flap and a single back flap, containing THREE bricks lying side by side on
  crumpled paper** — there are no carton walls between the bricks, only paper. The authored change is
  *"**every remaining carton** along that unwrapped top row now stands with its flaps folded open too,
  one red clay brick lying inside **each** on crumpled paper and **filling its box exactly**"*. Neither
  half is delivered: they are not individual cartons, and no brick has a box of its own to fill. The
  centre pallet still carries the inherited single-brick crate from `L23-retry1`, so the frame is also
  internally inconsistent — one brick in a crate at centre, three bricks in a crate on each flank.
- **Weakness 2 — the frame contradicts its own narration.** This shot carries the VO *"red clay bricks
  into **little boxes**"*. The boxes rendered are pallet-width and overhang the pallets they stand on.
  This is not a pedantic scale complaint: it is the frame stating the opposite of the line playing
  over it, and it is why I do not waive the scale residual (see the explicit call below).
- **What genuinely improved, and it is not small.** The *bricks* are now drawn at ≈65px wide against
  the parent's ranked cartons at ≈72px — comparable, believable objects, where round 2's bricks were
  dwarfed by their containers. Three bricks per stack across three stacks plus more in depth behind
  delivers the **plural** the beat needs, legibly, at viewing scale. If the board waives the container
  scale, the beat reads.
- **Fixed — the held-crew drift is GONE.** Round 2 charged two packers gaining a white head covering
  with hair, a collared shirt and a tie, and a grey head covering. Compared at 3× crop against both
  `L23-retry1` and `scenes/L22.png`: all four packers are bare cream ovals in the parent's exact
  clothing (brown jacket + grey trousers, dark top, blue shirt, rear figure), same poses, same hands.
  **Round 2's weakness 2 is closed.**
- Content otherwise: flaps folded open ✓, red clay bricks ✓, crumpled paper ✓, film still hard round
  the lower courses ✓, crew still working the hand truck ✓, tally card ✓.
- **Continuity: outstanding.** The diff confirms the change is confined to x≈400–550 and x≈900–1050 —
  exactly the two flanking pallets the authored delta names, and nothing else. Lamp, tripod, cable,
  roller door, shelving, windows, lit pool, tally card, concrete all hold.
- Register: warm outline (21.3°, R−B +2.8) ✓, flat cel ✓; sat 0.1059, climbing above the L03
  baseline ✓ — the night chain is still not draining.
- Figures: no amputations, no fused limbs, no floating props ✓; identity now HOLDS ✓.
- Lettering: '26,000' re-quoted, legible ✓; nothing else drawn ✓ — correct, the lettering is L25's beat.

---

## L25-retry1 — brick-tease delta 3, chain close, re-based on `L24-retry1` — **FAIL (park)**

- **Weakness 1 — the authored lettering surface is wrong, for the second consecutive round.**
  Authored: *"the **front face of every one of those open cartons** now carries 'HARD DRIVE' lettered
  across the middle of the board"*. Rendered, 'HARD DRIVE' appears **exactly three times, once per
  pallet, lettered across the SEALED, FILM-WRAPPED middle courses** — the clear film's sheen runs
  visibly *over* the lettering at 3× crop, and on both flanking stacks the word **spans the seam
  between two adjacent cartons**, so it is a legend painted across the stack rather than a label on a
  carton face. **Not one of the open cartons carries any lettering at all.** This inverts the gag's
  own logic: the box that says HARD DRIVE should be the box with the brick in it, and here they are
  different boxes.
- **Weakness 2 — the inherited container-scale defect, unchanged.** Everything charged on
  `L23-retry1` and `L24-retry1` is still on screen: three crate-scale open boxes standing where the
  ranked cartons were, with the narration *"boxes labelled hard drive"* following a line that called
  them "little boxes".
- **The darkening question, re-ruled on this round's own numbers.** Ink luminance still falls down the
  chain (6.1 → 3.9 → 3.5 → 2.1 against L03's 8.5) and R−B falls +3.5 → +1.7. Round 2's ruling holds
  and I reach it independently: (a) the measure samples the darkest 3% of a NIGHT frame, so what
  compounds is the unlit background field, not the ink recipe; (b) **R−B stays positive at every
  step** — this is not the L16 inversion in slow motion; (c) **median saturation CLIMBS monotonically
  0.0902 → 0.1176**, the opposite of a chroma drain; (d) at viewing scale the lamp pool, pallets,
  bricks, crew, tally card and lettering all read cleanly and the right-wall shelving still separates
  from its wall. **Within register.** The hard-depth-limit advice from round 2 stands: any future
  night chain in this place re-bases off the L03 plate rather than extending.
- Content: the whole top row stands open on red clay bricks ✓, the lettering lands on the beat ✓.
- **Continuity: outstanding.** The diff confirms only 1.13% of pixels move, all in the lettering band.
  Lamp, tripod, cable, roller door, shelving, pallets, film, lit pool, tally card, all four packers
  and every brick hold frame-for-frame against `L24-retry1`. The wardrobe fix from L24 **held** ✓.
- Register: warm outline (13.2°, R−B +1.7) ✓, flat cel ✓; sat 0.1176, the chain's highest ✓.
- Figures: no amputations or fused limbs, identity holds ✓.
- **Lettering REGISTER itself is clean.** Transcribed letter-by-letter at 3× crop on all three
  instances: H-A-R-D · D-R-I-V-E, correctly spelled, marker italic capitals matching the house
  register, no garbling, no partial render, no unrequested text anywhere else. '26,000' is re-quoted
  correctly alongside. **The defect is placement, not craft** — this is a content/fidelity failure,
  and the rig and style axes are clean.

---

## L10-retry1 — ironic-counterpoint (overnight queue), retry of the parked L10 — **FAIL (park), the clearest fail in the round**

**Three independent hard failures, one of them objective and measured. The correction this retry was
authorised for was not taken, and the frame additionally regressed on attributes round 2 passed.**

- **Weakness 1 — the ink is COOL-INVERTED, measured.** **217.7° / R−B −3.8**, against the parked
  original L10's **16.0° / +11.5** and against every other frame in this round (13–25° / +1.7 to
  +18.0). The era suffix names the outline colour explicitly — *"even medium-thick dark **warm
  brown-black (#241a12)** outline on everything"* — and at crop the outlines on the mullions, chairs
  and figures read cool blue-black. **This is the same objective defect that parked L16 in round 1,
  now recurring on a frame generated AFTER the R1 generator-side fix landed.** It is not a
  night-sampling artifact: the genlog's depth sweep (3% / 1% / 0.5%) holds the inversion at every
  depth, and my own 3% sample reproduces it. Round 1 parked a frame on this measure alone; the same
  standard applies here.
- **Weakness 2 — the shot's whole device is still inverted; the correction did not take.**
  Authored: *"**beyond the window glass** a queue of overnight buyers curls away down the pavement…
  folding chairs, sleeping bags and flasks along the kerb, breath showing in the cold"*, framed so
  the glass **splits the still interior from the packed street**, with the notes pinning *"Crowd
  behind the window glass (positive rear zone)"*. Rendered, **seven figures sit camped INSIDE the
  shop** on folding chairs, in sleeping bags, holding flasks, ranged along the bare shelf bays and up
  to the counter. Outside the glazing at left there is now *also* a queue with chairs, bags and
  flasks — so the props are drawn on **both** sides and the interior is the packed half. The still
  interior / packed street opposition the beat exists to make is not on screen. **Breath is still
  drawn on the indoor figures**, the same incoherence tell round 2 named. Round 2 parked this exact
  fact; a 4×-longer, fully explicit correction span did not move it.
- **Weakness 3 — the authored vantage was again not delivered, and this time it cost a literal.**
  Authored: *"Framing: wide from **behind the counter**"*. Rendered, the camera sits in the room with
  the counter running along the right wall into depth — **the L05 plate's own camera, reproduced
  almost exactly** (I compared the two side by side: same door-side wide, same wall order, same sill).
  Against L05 this will cut as an identical camera. It also drags in the '1983' window card, which the
  shot's notes say is out of frame here precisely because the vantage was supposed to be different.
- **Weakness 4 — the authored palette is not delivered.** *"Palette: blue-grey dawn outside, **unlit
  warm brown inside**"*. The interior renders blue-grey throughout — ceiling, walls, floor, shelving —
  with only the counter carcass brown. Round 2 called the palette this shot's real strength (sat
  0.4431); it is now 0.2471 and monochromatically cold. **A regression on an attribute round 2 passed.**
- Content that IS delivered: the shelf bays are correctly **bare** ✓ (authored), the counter and till
  are unlit ✓, the street beyond the glazing reads blue dawn ✓, folding chairs / sleeping bags /
  flasks / visible breath are all drawn ✓ — every authored *object* is present; they are simply on the
  wrong side of the glass.
- Continuity: the L05 room otherwise holds — proportions, counter, till, ceiling panels, glazed
  shopfront, window sill ✓.
- Figures: cream blank ovals with dot eyes and mouth line, consistent with the crowd convention ✓;
  2 arms / 2 legs where visible, mittened hands on flasks, no floating props ✓. Figure integrity is
  the one axis with nothing against it.
- Lettering: the '1983' card renders on the right-hand window sill, correctly spelled and legible, in
  the same position and the same style as the verified `scenes/L05.png` plate draws it. **Not charged
  as unauthored** — it is a held place literal inherited from the seed, and round 2 declined to charge
  the same thing on L07 on the file's own L-1 practice. Its presence is evidence for weakness 3, not a
  separate lettering defect. No other text; nothing garbled.

---

## The explicit call on the L23 / L24 residual scale — **PARK, not pass-at-viewing-scale**

This is the round's one genuinely close judgment, so here is the reasoning in full rather than a verdict.

**What would argue for waiving it.** The brick-fill half of round 2's charge is fixed and fixed well
(36% → 74% of the opening). The bricks in L24 are now drawn at a believable size against the ranked
cartons (~65px vs ~72px). The chain's held-set discipline is the best in the video. The wardrobe
regression is closed. On a fast cut of 2.2s and 1.7s, a viewer sees open boxes with red bricks in
them and the beat lands.

**Why I park anyway — three reasons, in descending weight.**

1. **The frame contradicts the line playing over it.** L24's VO is *"red clay bricks into **little
   boxes**"* and L25's is *"labelled hard drive"*. The rendered containers are pallet-width and
   **overhang the pallets they stand on** — the single most legible size comparison available in the
   frame. This is not an invisible-at-speed defect; the oversize is established *by the frame's own
   neighbouring cartons*, three of which sit ~72px wide immediately beside a 247px box. The eye makes
   that comparison without being asked to.
2. **The gag is a scale gag.** The joke MiniScribe's fraud supports is that a brick was shipped in a
   box sized for a hard drive. Once the box is crate-sized, the object being substituted-for changes,
   and the "exactly" clause — which the file wrote deliberately, twice, in two consecutive shots — is
   the clause carrying that joke. A verdict that waives "exactly" waives the shot's reason for existing.
3. **The authored delta names a member of a set that no longer exists.** *"the front carton on that
   unwrapped top row"* and *"every remaining carton along that unwrapped top row"* both presuppose the
   ranked cartons L22 drew. In L23-retry1 that row is gone; in L24-retry1 all three are. That is a
   held-set consumption by the delta, which is the one thing a delta contract forbids — the fact that
   *nothing else* moved makes this the only breach, but it is still a breach.

**What I am NOT saying.** I am not saying these frames are unusable. On the whole-frame test they are
clearly better than the round-2 frames they replace — every charge except the container scale is
closed, and L24's wardrobe fix and L23's brick fill are real gains. **If the human board waives the
container scale, all three frames read at viewing scale and the chain ships coherently.** That is a
defensible human waiver. It is not a defensible machine `verified`, because the authored clause is
explicit, repeated, measurable, and contradicted by the narration on the frame itself.

**One structural note for the board.** The scale miss originates in L23 and is *inherited*, not
re-committed, by L24 and L25 — the diffs prove neither downstream frame touched the centre box. A
single successful re-roll of L23 at correct carton scale, re-based and re-chained, would very likely
close all three. That is the cheapest path to three verified frames, and it is a one-frame spend.

---

## Tally — 5/5 covered

| frame | verdict | stamp | the one-line reason |
| --- | --- | --- | --- |
| **L16-remint1** | **PASS** | `verified` | All r1 + r2 defects closed at once; warm ink 16.8°/+18.0, frieze square to frame, rank off both edges, Tier-A vantage held, nothing regressed. **Supersedes L16.png and L16-retry1.png.** |
| **L23-retry1** | **FAIL** | `parked` | Brick fill fixed (36%→74%); the open box is still ~3.4× the ranked carton it replaces and overhangs its own pallet, so the authored "front carton on that row" and "filling the box exactly" are not met. |
| **L24-retry1** | **FAIL** | `parked` | Wardrobe drift CLOSED; but each top row renders as one pallet-width open box holding three bricks, not individual cartons with one brick each — and the VO on this frame says "little boxes". |
| **L25-retry1** | **FAIL** | `parked` | 'HARD DRIVE' renders three times on the SEALED film-wrapped courses, spanning carton seams, with no open carton lettered at all — the authored clause unmet a second time. Lettering craft itself is clean. |
| **L10-retry1** | **FAIL** | `parked` | Correction not taken (queue still inside the shop, breath on indoor figures); ink COOL-INVERTED at 217.7°/−3.8; vantage still the L05 camera; the "unlit warm brown inside" palette regressed to cold. |

| verdict | count | frames |
| --- | --- | --- |
| **PASS → stamp `verified`** | **1** | L16-remint1 |
| **FAIL → `parked`** | **4** | L23-retry1, L24-retry1, L25-retry1, L10-retry1 |

**Human-board park list (all budgets spent, no machine path remains):** `L23-retry1`, `L24-retry1`,
`L25-retry1` (one shared cause — container scale, originating in L23, inherited downstream; waivable
as a set) and `L10-retry1` (three independent causes, one of them a measured era-register inversion;
**not** waivable on my reading — it is the weakest frame of the nine that entered round 2).

**Two things the board should carry forward beyond these five frames.** First, the cool-ink inversion
recurred post-fix on `L10-retry1`, so the R1 generator-side fix is not total and the ink measure must
stay on every frame's verification, not be assumed. Second, `L16-remint1` is evidence that the
**changed-mechanism re-mint** (zero-seed style-tile plate, no prose spent on colour) recovers a frame
that two prompt-level retries could not — it fixed a colour defect and a composition defect
simultaneously, which is exactly what round 2 said no retry had managed.

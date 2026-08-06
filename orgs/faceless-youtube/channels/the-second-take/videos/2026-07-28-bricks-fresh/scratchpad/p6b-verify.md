# Phase 6B fresh-eyes verification — bricks-fresh first tenth (17 candidates)

Reviewer: fresh-eyes verifier (no involvement in generation) · 2026-08-06 · branch `claude/bricks-doctrine-reset`
Scope: the 17 generated candidates in `KIT/_staging/` — L01, L02, L04, L06, L07, L09, L11–L21.
References used: `assets/scenes/L03.png`, `assets/scenes/L05.png` (verified plates), `KIT/refs/env/scene-style-tile.png`
(register exemplar), `KIT/refs/pc-boxy/pc-boxy.png`, `KIT/refs/env/prop-drive.png`, `shots.json` authored prompts,
`shots.json.global_prompt_suffix` (era register clause).

**Weaknesses first in every note.** Verdicts: PASS = stamp-ready `verified`; CONCERN/FAIL = `parked`
(the stamp script parks on ANY failed DSG-lite item and on ANY non-clean axis, even LOW).

Criteria per shot: (1) authored content present / nothing unauthored added · (2) place + chain continuity ·
(3) era register (warm-toned even medium-thick outline, frontal eye-level, flat cel, chromatic not grey) ·
(4) figure integrity + identity · (5) lettering register (marker capitals, correct wording).

---

## L01 — den-1983 base — **PASS**

- **Weakness:** the crowd does not sit where the prompt stages it. Authored: "fills the **far side of the room
  behind the armchair**, settled along a low sofa and down onto the carpet", framing "the seated crowd ranked
  **along the back wall**". Rendered: ~20 figures ring the television on **both** flanks, the right-hand group
  coming well forward of the back wall into the near right. The staging intent (positive rear zone, faces to
  camera, nobody's back to us, the set unobstructed) is nonetheless satisfied and the frame's payload — the
  dark screen — is clear and centred, so I score this a staging drift inside the authored arrangement, not a
  contradicted fact. Second minor: two unlisted framed pictures on the left wall (blank, no lettering) are
  ordinary set dressing, not an unauthored *story* element.
- Content: boxy TV centre on low walnut cabinet ✓, **screen dark and blank** ✓ (the delta space L02 needs is
  correctly reserved), orange shag carpet to frame edge ✓, plaid armchair angled stage-left ✓ with knitted
  throw over its arm ✓, hanging globe lamp mid-ground ✓, heavy curtains closing the back wall ✓, wide collars /
  denim / lacquered teased hair ✓.
- Continuity: root plate, no parent to reproduce.
- Register: warm brown-black even outline ✓, flat cel with gentle shading ✓, frontal eye-level from the
  doorway ✓, deeply chromatic (median sat 0.7176, the batch high) — no grey drain ✓.
- Figures: 2 arms / 2 legs where limbs are visible; hands read as the house's rounded mitten forms; no fused or
  extra limbs found; occlusion is honest overlap, not amputation.
- Lettering: none authored, **none drawn** ✓ — the framed pictures are correctly blank.

## L02 — den-1983 delta — **PASS**

- **Weakness:** trivial hue drift on two crowd garments between parent and child (a right-hand figure's sweater
  reads orange in L01 and red-brown here). Below the threshold of a held-set violation.
- Content: only the authored change lands — the screen now carries a **dark blue maze grid with one yellow
  wedge and small drifting shapes** ✓, and its cool light falls across the carpet as a blue pool ✓. Maze drawn
  generically: **no logo, no branded character** ✓ (evergreen-reference policy honoured).
- Continuity: the strongest delta in the batch. Cabinet, carpet, armchair, throw, globe lamp, curtains, and
  every crowd figure's pose/position are held frame-for-frame against L01.
- Register: identical warm outline and flat cel to the parent ✓; sat 0.6196, chromatic ✓.
- Figures: unchanged from the parent; integrity holds.
- Lettering: none drawn ✓.

## L04 — ironic-counterpoint (newsstand) — **PASS**

- **Weakness:** the commuter stream reads as passing on the **near** pavement across the left two-thirds, where
  the prompt says "streams past on the **far side of the stand**". The irony the shot exists for still lands
  exactly — the racks are on the right, the stream fills the left, and **not one head is turned toward them** ✓.
  Second: the low chroma (sat 0.2196) is authored ("cold morning blue", "newsprint grey") but this is one of the
  frames closest to a flat-grey read; it stays chromatic because the awning green, the blue sky and the brown
  briefcases all hold saturation.
- Content: pavement newsstand ✓, racks packed roughly three tiers (hanging rail, counter stacks, front rack) ✓,
  **every cover face and masthead blank and unlettered** ✓, green-and-cream awning ✓, plank counter ✓, bundle of
  unsold papers bound with twine at its foot ✓, overcoats and scarves ✓, briefcases ✓.
- Continuity: root frame, no parent.
- Register: even outline, flat cel ✓; frontal static eye-level from the far kerb ✓; the rear rank of commuters is
  desaturated as depth fade, not as a style change.
- Figures: 2 arms / 2 legs on every foreground commuter; hands and briefcase grips plausible; the blank
  dot-eyed faces are the channel's anonymous-crowd convention, consistent with the crowd in L07.
- Lettering: none — the "blank and unlettered" instruction is honoured; the grey blocks on the covers are
  texture, carrying no readable characters ✓.

## L06 — store-1983 delta — **FAIL (park)**

- **Weakness / the ruling asked for:** the known anomaly is **real and is a defect**. Two "1983" cards render:
  the authored **window card** (correct, flat on the window sill, stage-right) **plus an unauthored tent card
  standing on the oak counter** in the near foreground. The prompt authors exactly one — "the window card
  carrying '1983'" — and the era suffix forbids "no unrequested text". This duplicates an established diegetic
  literal inside a single frame, which is worse than a stray prop: the dateline stops being a dateline when the
  room says it twice. **Probable root cause, offered as evidence rather than diagnosis:** the register exemplar
  `KIT/refs/env/scene-style-tile.png` is *itself* a computer-shop interior whose counter carries a "1983" **tent
  card** in the near foreground. The tent card in this frame is a near-exact copy of the exemplar's, in the same
  position on the same counter — the style seed appears to have bled a content element.
- Content: otherwise complete. The authored delta lands ✓ — an opened wooden crate at the counter's near end,
  packing straw spilling over its lip, one beige machine half unwrapped inside ✓, with loose straw scattered on
  the lino as a bonus.
- Continuity: **excellent** against `assets/scenes/L05.png` — three shelf bays with the same beige boxed
  machines in the same bays, the varnished oak counter foreground-right, brass till, cream-and-teal linoleum
  with teal skirting, the street door open stage-left with its glazed panel and hung blank picture, the window
  and its card. This is the promotion working.
- Register: warm outline, flat cel, frontal eye-level ✓; sat 0.2353, chromatic (teal + oak + beige) ✓.
- Figures: cast-free as authored ✓.
- Lettering: marker-capital numerals, correct wording "1983" on both cards — the **register** is right; the
  **count** is wrong. That is what parks it.

## L07 — store-rush base — **FAIL (park)**

- **Weakness 1 — the authored new vantage was not delivered.** The prompt asks for the shop "**from down on the
  shop floor**… the varnished oak counter **crosses the foreground** with its brass till", framing "medium-wide
  **at counter height**, the counter edge across the foreground". Rendered, the counter runs **along the right
  wall into depth** — i.e. L05's own door-side wide vantage, reproduced. The shot's stated reason for existing
  ("New vantage… so the cut reads against L05's door-side wide") is therefore unmet; against L05 and L06 this
  will cut as the same camera.
- **Weakness 2 — a disembodied prop.** Of the raised banknotes, one at approximately (907, 249) in the 1376×768
  frame **floats above a head with no hand and no arm attached**. The prompt says the notes are "held up over
  the shoulders", and the other four raised notes do have hands. This is a figure-integrity failure.
- **Weakness 3 — a truncated established literal.** The '1983' window card **is redrawn** here and is occluded
  by the foreground buyer's head so that only "**83**" reads. The shot's own notes state the card "sits behind
  camera at this vantage, so no established literal is redrawn here". A half-quoted dateline is a lettering
  defect, not a neutral crop.
- **Weakness 4 — a broken relation.** The crate is present but sits on the **floor at foreground-left**, not "at
  the [counter's] near end"; counter and crate are at opposite sides of the frame.
- Content otherwise: queue of eager buyers packed and ranked back toward the bays ✓, wide collars and bulky
  coats ✓, banknotes raised ✓, head of the queue pressed to the counter edge ✓ (the teal-shirted figure, both
  hands on the counter), brass till ✓, bays behind ✓, daylight from the street door ✓.
- Continuity: place reproduced faithfully off L05 (bays, boxes, counter, till, lino, door, ceiling panels) ✓.
- Register: warm outline, flat cel, eye-level ✓; sat 0.2431, chromatic ✓.
- Figures: apart from the orphan banknote, limbs are sound — 2 arms / 2 legs, no fusions, hands plausible.
- Lettering: only the truncated "83" — see weakness 3.

## L09 — idiom-pun (flying off the shelves) — **PASS**

- **Weakness:** the street door drifts from the parent — grey-olive with a teal-framed glazed panel in L05/L06,
  tan-gold here, and hinged to swing into the room rather than standing open against the reveal. The bays also
  lose their four-shelf division to a three-shelf pegboard run. Both are inside "the bays run **bare** to the
  pegboard", which is the authored change to that wall, so I score the door as a low colour drift on a
  non-payload element rather than a broken hold. Second: the hanging unit reads as a slot-fronted machine more
  than as a *boxed* home computer, though it is unmistakably the beige computer of the established set.
- Content: one beige unit **hangs in the air above the emptied middle bay** ✓, held essentially **dead level**
  like an exhibit (not a motion freeze) ✓, **two stiff paper wings taped to its sides and spread wide** ✓ — the
  tape tabs are drawn ✓; the three bays run **bare to the pegboard** ✓, oak counter foreground-right ✓ with
  brass till ✓, street door open with daylight across the cream-and-teal lino ✓, winged box centred with **open
  air above it** ✓.
- Continuity: place holds off L05 — counter, till, lino, window, ceiling panels, teal trim.
- Register: warm outline, flat cel, frontal eye-level ✓; sat 0.2353, chromatic ✓.
- Figures: cast-free as authored ✓.
- Lettering: the single **'1983' window card** ✓ — correctly the established place literal re-quoted verbatim,
  one card only, marker capitals, fully legible. Contrast L06.

## Ink-warmth measurement (the objective basis for the era-register rulings)

The era clause pins "even medium-thick dark **warm** brown-black (#241a12) outline on everything". Sampling the
darkest 3% of pixels in each frame and taking their mean hue gives a defensible read on outline warmth, which
median saturation alone does not:

| frame | ink RGB | ink hue | ink sat | R−B |
| --- | --- | --- | --- | --- |
| L01 | (19.5, 2.3, 0.2) | 6.4° | 0.989 | **+19.3** |
| L04 | (18.6, 16.8, 15.2) | 27.8° | 0.183 | **+3.4** |
| L12 | (34.2, 13.1, 3.0) | 19.3° | 0.913 | **+31.3** |
| **L16** | **(9.6, 11.1, 10.9)** | **172.2°** | **0.140** | **−1.4** |
| L17 | (20.4, 12.5, 3.8) | 31.4° | 0.815 | **+16.6** |
| L18 | (33.7, 12.1, 6.5) | 12.3° | 0.806 | **+27.2** |
| L19 | (20.1, 12.3, 7.3) | 23.5° | 0.637 | **+12.8** |
| L20 | (12.5, 6.1, 3.9) | 15.5° | 0.690 | **+8.6** |
| L21 | (29.8, 10.1, 0.2) | 20.2° | 0.994 | **+29.6** |
| *L03 (Daniel-accepted plate)* | (10.0, 8.3, 6.1) | 33.8° | 0.385 | *+3.8* |
| *L05 (Daniel-accepted plate)* | (29.7, 15.7, 5.3) | 25.5° | 0.820 | *+24.3* |

Every frame in the batch, and both accepted reference plates, sit in a warm 6–34° band with R−B positive.
**L16 alone inverts it: 172° (cyan) with R−B negative — its outline is a cool blue-black, not the era's warm
brown-black.** That single outlier is the objective half of the L16 ruling below. It also clears L04: at R−B
+3.4 it is low-warmth, but so is the plate Daniel already accepted (L03, +3.8), so L04 is judged against a
standard the human board has already set.

## L11 — literal (pc-boxy + prop-drive on a service bench) — **PASS**

- **Weakness:** `pc-boxy`'s **right arm is not visible**. I examined this at 3× crop before ruling: the arm's
  attachment point on the canonical sits at the upper-right of the case, and `prop-drive` stands immediately
  against that edge from exactly that height downward, so a hanging right arm would be wholly behind the drive.
  I score this **plausible occlusion, not amputation** — but it is the one call in this batch I would most want
  a second eye on. Second: the case is drawn ¾-turned rather than "**front-on to the camera**" as the prompt
  says — though that ¾ presentation is precisely how `KIT/refs/pc-boxy/pc-boxy.png` is drawn, so canonical
  fidelity and prompt wording pull against each other and I resolved for the canonical. Third: `prop-drive`
  renders at roughly ⅔ of pc-boxy's body height, far oversized for a drive against a whole computer; the prompt
  pins no scale and the oversize serves legibility on a 1.6s beat, so it is noted, not charged.
- Content: pc-boxy on a plain service bench ✓, stubby legs planted ✓, `prop-drive` **up on its end and turned
  to show its flat top face** ✓, pegboard of hand tools filling the wall behind ✓, rack of spare shells under
  the bench ✓, work lamp lighting from stage-right ✓, machine stage-left / drive centre-right per the framing
  clause ✓. No human pose seeded onto the faced object ✓ (the registry prohibition is honoured).
- Continuity: root frame, no parent.
- Register: warm outline, flat cel, medium at bench height ✓; sat 0.3020, chromatic ✓.
- Identity: **both canonicals read.** pc-boxy — beige boxy case, screen-as-face with bezel, floppy slot on the
  lower body, rounded limbs ✓, carrying `expr-delighted` as arced closed eyes and an open smile ✓.
  prop-drive — grey steel body, rounded corners, corner screw holes, recessed top plate, connector strip along
  the top edge ✓; a clean match to `KIT/refs/env/prop-drive.png`.
- Lettering: none drawn ✓.

## L12 — drive-vault base — **PASS**

- **Weakness:** the explicitly authored **scale pin is under-delivered**. The prompt pins the case "as tall and
  as wide as **four courses** of the drawer wall behind it"; measured against the rendered drawer grid it spans
  roughly **2.5 courses** each way. R-6 wrote that pin specifically so L14's folders and sleeves would stay
  readable — and L14 *does* read them clearly, so the pin's purpose is met even though its literal ratio is
  not. Second: the plinth renders mid-brown rather than the authored "**dark** plinth". Third: "the unit's power
  lamp is dark" has no drawn referent — an unlit lamp is indistinguishable from an absent one, so this is
  unfalsifiable rather than missing.
- Content: one beige drive unit alone on a waist-high plinth ✓, **small steel vault door with a spoked wheel
  handle centred on it, shut tight** ✓, wall of shallow oak card-index drawers running the room's width with
  brass pulls in even rows ✓, banker's lamp lit on a side table stage-right ✓ beside a stack of ledgers ✓, worn
  parquet running back to the skirting ✓, drive centred against the drawer wall with air above it ✓.
- Continuity: root frame, no parent.
- Register: warm outline (ink hue 19.3°, the batch's warmest after L21) ✓, flat cel ✓, frontal medium ✓; sat
  0.4863 ✓. **Red accent correctly absent** — the earlier decorative red on the wheel spokes stayed dropped, so
  the semantic-red law holds.
- Figures: cast-free as authored ✓ (absence earned — the beat's subject is a mechanism).
- Lettering: the drawer label plates are **blank** ✓ — a real trap avoided; a card-index wall is exactly where
  an unrequested-text failure would appear.

## L13 — drive-vault delta 1 — **PASS**

- **Weakness:** "three narrow shelves" renders as **two shelf boards plus the interior floor**, i.e. three shelf
  *surfaces* rather than three boards. The reading is consistent and the chain uses all three tiers correctly
  downstream (L14 fills the top two, L15 curtains the bottom), so the authored count is satisfied on the
  reading that the chain itself relies on.
- Content: the vault door **stands swung fully open on its hinge** ✓, showing narrow shelves **each ruled with
  a shallow lip** ✓, **standing empty and unlettered** ✓ (absence rendered as a positive property, as authored).
- Continuity: **exemplary.** Drawer wall, brass pulls, banker's lamp, ledger stack, side table, parquet grain,
  plinth, light wedge and shadow all hold frame-for-frame against L12. Nothing outside the authored change moved.
- Register: warm outline, flat cel, frontal medium ✓; sat 0.5020 ✓.
- Figures: cast-free ✓.
- Lettering: none, and the shelves are explicitly unlettered ✓.

## L14 — drive-vault delta 2 — **PASS**

- **Weakness:** the middle rank of "flat boxed program sleeves stood on their spines" reads as upright
  spine-out packaging that a viewer could mistake for more binders; the two payload nouns stay distinguishable
  only because the upper rank has staggered pointed manila tabs and the middle has flat square tops. The
  distinction is real but not emphatic, and this beat has to carry **both** nouns of "your files, your
  applications" in 2.45s.
- Content: **the top two shelves fill** ✓ — upper packed edge to edge with upright manila folders, **tabs
  staggered and blank** ✓; middle ranked with flat boxed sleeves on their spines, **unlettered** ✓; the bottom
  shelf correctly stays empty, reserving the space L15's delta needs ✓.
- Continuity: exemplary again — parent held frame-for-frame, one integrative change only.
- Register: warm outline, flat cel ✓; sat 0.5137 ✓.
- Figures: cast-free ✓.
- Lettering: **none** ✓ — folder tabs and sleeve spines both blank, the highest-risk unrequested-text surface in
  the whole batch, and it is clean.

## L15 — drive-vault delta 3 (chain close) — **PASS**

- **Weakness:** two or three of the middle-shelf sleeves shift spine colour against L14 (a couple now read grey
  rather than cream). A held element drifted slightly while the authored change landed elsewhere — low, and
  invisible at cut speed, but it is the one place this otherwise frame-perfect chain moved something it was
  told to hold.
- Content: **a small brown curtain drawn fully across the bottom shelf on a little rail** ✓ — the rail and its
  rings are drawn ✓, the curtain closes the tier completely so what is behind it is genuinely withheld ✓. The
  punchline is carried by composition with **no lettering**, exactly as authored ✓.
- Continuity: top shelf folders, drawer wall, lamp, ledgers, parquet, plinth, light all held ✓.
- Register: warm outline, flat cel ✓; sat 0.5137 ✓.
- Figures: cast-free ✓.
- Lettering: none drawn ✓.

## L16 — crowd-multiplication (shelf of identical cases) — **CONCERN → park**

**This is the frame I was asked to eye hardest for grey drain, and on the evidence it does not clear the bar.**

- **Weakness 1 — the outline is not warm.** Measured, L16's ink sits at **hue 172° (cyan) with R−B = −1.4**.
  Every other frame in the batch runs 6–34° with R−B between +3.4 and +31.3, as do both plates the human board
  accepted. L16 is the sole inversion in the set. The era clause names the outline colour explicitly
  (warm brown-black #241a12), so this is a direct, measurable miss on a pinned invariant rather than a taste call.
- **Weakness 2 — half the authored palette did not render.** The palette clause is "**beige on grey**". The
  stockroom is grey as authored ✓, but the computer cases came out a cool pale grey-green as well, so the
  two-colour palette collapses to one. The cases are the frame's entire subject; their beige is not decoration.
- **Weakness 3 — the batch's saturation floor.** Median 0.1686. It clears the 0.10 R1 tripwire, but that
  tripwire is a crash detector, not the era bar, and this frame cuts between L15 (warm oak and parquet) and
  L17 (warm spotlight and ochre); it will read as a colour-temperature hole in the sequence.
- **Not greyscale, to be exact about it.** The tan cardboard sleeves stacked along the lower shelf and the
  single amber-lit bay are genuinely chromatic, so the failure is *cool-and-drained*, not *monochrome*. That
  distinction is why I rule this CONCERN rather than a hard content FAIL — but the ruling still parks, and it
  should: it is a style-axis defect on an explicitly pinned invariant.
- **What would clear it:** a re-issue that lands warm ink and beige cases. Nothing about the shot's *content* or
  *staging* needs changing — see below.
- Content (all clean, and worth preserving through any re-issue): a long plain shelf running the full frame
  width ✓, **face square to the frame** ✓ (the R-16 frieze restaging worked — multiplication reads from the rank,
  not from a run converging away), identical cases **nose-out ranked edge to edge** ✓ **carrying on past both
  frame edges** ✓, an identical drive seated in each front bay ✓, **the centre case's bay lit from inside** ✓
  with the rest in even shadow ✓, steel uprights and crossbraces at intervals ✓, flat cardboard sleeves stacked
  on the shelf below ✓.
- Continuity: root frame, no parent.
- Figures: cast-free as authored ✓ (this is the act's one declared figureless run, and it is object
  multiplication by design).
- Lettering: none drawn ✓.

## L17 — shopfront-brawl base — **PASS**

- **Weakness:** the plate glass does not run the frame's width as authored. The prompt stages this "**seen from
  inside the window**… Behind them the **plate glass runs the width of the frame**", with the watching market a
  single band beyond it. Rendered, a solid back wall sits behind the two cases and the glass is split into
  **two side panels**, so the crowd reads as two flanking pockets rather than one street watching a fight. The
  shot's argument — the market is out front watching — still lands, and every crowd figure faces in, so I score
  this a staging drift rather than a deleted element. It is the closest call I let pass in this batch, and if the
  board wants one more frame re-issued after L16, this is the one I would nominate. Second, smaller: "one
  spotlight above throws **two hard shadows out to the sides**" — the spotlight and its cone are drawn, the two
  hard side shadows are not.
- Content: two oversized beige cases **butted front to front** ✓, **shoved hard against each other** ✓,
  **corners dented where they meet** ✓ (a jagged contact seam), lit display platform ✓ black ✓, crowd of
  passers-by packed along the pavement beyond the glass in coats and **headscarves** ✓ with **shopping bags at
  their knees** ✓ and **faces turned in to watch** ✓, both cases at the same height dead centre ✓.
- Continuity: root frame of a new stage, no parent.
- Register: warm outline (31.4°) ✓, flat cel ✓, frontal wide ✓; sat 0.2824, chromatic ✓.
- Figures: 2 arms / 2 legs throughout the foreground rank; bag grips plausible; no fused or floating limbs;
  rear ranks are honest head-only depth stacking, consistent with the channel's crowd convention.
- Lettering: **none drawn** ✓, and **no brand marks** on the personified rivals ✓ (evergreen-reference policy).
- Red accent: **semantic and correct** — the single red is the scuffed arc at the point of contact, i.e. the
  punch element, exactly the licensed use.

## L18 — shopfront-brawl delta — **FAIL (park)**

**The most serious failure in the batch: this is a delta that re-invented its parent instead of holding it, and
it also missed the one geometry its own prompt was rewritten to pin.**

- **Weakness 1 — the payload geometry is wrong, and it is the exact error R-12 fixed.** The prompt authors two
  black glass slabs "**stand upright at the front edge of the platform, butted face to face and shoved hard
  against each other… their bottom edges skidded apart under the push, locked up exactly like the two cases
  behind them**". Rendered, the two slabs **lie flat on the platform, splayed open like an opened book** — not
  upright, not butted face to face, not locked up. The mirrored fight the line "*and Apple fight over the phone
  market*" needs is simply not depicted; two phones lying face-up on a plinth read as display stock.
- **Weakness 2 — the held set is not held.** Against L17 essentially nothing carried: the plate-glass side
  panels became a wooden proscenium frame; the black platform's red scuffed arc became faint pink scratches;
  the spotlight cone changed shape and the platform gained a large cream light pool; the cases changed
  proportion and gained scuff marks they did not have. A delta frame's whole contract is that only the authored
  change moves.
- **Weakness 3 — the crowd is a different crowd, in the wrong period.** L17's watchers are 1980s passers-by in
  **coats and headscarves with shopping bags**. L18's are a wholly different set of people in **short-sleeved
  t-shirts, contemporary casual wear, and modern hairstyles**, drawn smaller, with a different face treatment,
  and repositioned from the flanks to a band across the top. This is both a continuity break and an **era
  break** — the frame's costume no longer reads 1983.
- **Weakness 4 — the red accent lost its semantics.** In L17 the red is the contact arc, the punch element. Here
  red survives only as scattered scratch marks with no single semantic referent.
- Register, in fairness: the ink is warm (12.3°) ✓ and the render is flat cel ✓; sat 0.2706, chromatic ✓. The
  *style* is fine. It is content, continuity and era that fail.
- Figures: no amputations or fused limbs found; the crowd's integrity is sound. Its *identity* is the problem,
  not its anatomy.
- Lettering: none drawn ✓; no brand marks ✓.

## L19 — backroom-take base — **PASS** (clears the grey bar)

- **Weakness 1:** "a pallet of finished **drive units** waits **beside it** [the cash box]" is only half
  delivered. A pallet with its **dust sheet folded back** ✓ is present, but it sits at **foreground-left**,
  across the room from the stage-right cash box rather than beside it, and it carries plain cardboard cartons —
  nothing on it identifies the contents as finished drives. The picks-and-shovels thesis leans on this room
  being the *manufacturer's* back-of-house, and the pallet is the prop that says so.
- **Weakness 2:** the packers render with **peach-toned faces carrying eyes, brows and mouth**, where every
  other crowd in this batch (L01, L04, L07, L17, L21) uses the channel's cream blank-oval convention. No named
  cast is in frame so no canonical identity is at stake, but it is an internal-consistency drift.
- **Weakness 3:** the crew works **in front of** the racks, not "on the far side of the racks" as staged.
- **The grey bar — it clears, and I checked it against measurement rather than impression.** Median saturation
  is 0.1922, the batch's second-lowest, and the field is dominated by cool grey concrete — but the concrete
  grey is *authored* ("Palette: cool grey concrete"), the **ink is warm** (hue 23.5°, R−B +12.8, in the middle
  of the batch's band), and the frame carries three substantial chromatic anchors: the **warm amber doorway
  slab** across the centre-left, the **tan cartons, pallet and dust sheet** filling the lower-left, and the
  **green banknote banding** in two clusters. This is cool-but-chromatic with era-correct ink — the pass
  condition. It is not the same failure as L16, and the two should not be treated as one finding.
- Content: **steel cash box open on a packing bench stage-right, packed tight with banded banknotes** ✓, crew of
  packers **in overalls** ✓ **banding notes into bundles** ✓ **and stacking them into a strongbox on a
  trestle** ✓, **roll-up dock door open stage-left on a waiting truck** ✓ **throwing a hard slab of daylight
  across the concrete** ✓, framing with **the money low in frame and the lit dock door high** ✓.
- Continuity: root frame of a new stage; correctly carries **no retail adjacency** to L17 — the R-2 restaging
  held, and this reads as the manufacturer's own dock, not the retailer's till.
- Register: warm outline ✓, flat cel ✓, wide static frontal ✓.
- Figures: 2 arms / 2 legs on all six packers, verified at crop; every bundle and crate is held by visible
  hands; no floating props.
- Lettering: **none drawn** ✓ — cartons, shelf boxes and banknotes all unlettered, which a room this full of
  packaging could easily have got wrong.

## L20 — backroom-take delta — **PASS**

- **Weakness:** "its head **buried in a raked heap** of loose banknotes" renders as a **thin scatter**, not a
  heap — the rake head rests on a flat spread of a dozen notes with nothing piled. The idiom still reads
  (rake + money + drag lines), but the visual claim of accumulation, which is the whole joke of "raking it in",
  is weaker than authored.
- Content: **a long garden rake lies across the floor** ✓ with its head in loose banknotes ✓, **drag lines
  fanning out behind it through the dust** ✓ (drawn as dust puffs and trailing lines).
- Continuity: **the second-best delta in the batch.** Cash box, banded bundles, packing bench, pallet and its
  folded-back dust sheet, cartons, racks, shelf stock, dock door, truck, hanging light, and all six packers in
  their exact poses hold frame-for-frame against L19. One integrative change only.
- Register: warm outline (15.5°) ✓, flat cel ✓; sat 0.2039, chromatic on the same amber/tan/green anchors as
  its parent ✓.
- Figures: unchanged from the parent; integrity holds.
- Lettering: none drawn ✓ — the loose banknotes are correctly unlettered.

## L21 — crowd-multiplication (picks and shovels) — **PASS**

- **Weakness:** the sky renders as a **strong orange dawn gradient**, where the prompt authors "**flat morning
  light**" and a palette of "mud brown, canvas cream, steel grey" that contains no orange. The whole frame
  consequently sits in a sepia wash. It stays chromatic (sat 0.4863) and the warm cast is era-correct, so I
  charge it as a palette drift rather than a defect — but it is the frame where the era suffix's warmth pushed
  hardest against an authored palette. Second, minor: the vantage is mildly high rather than strictly
  eye-level; that is the same deviation the human board explicitly passed on plate L63.
- Content: **plank counter under a canvas awning** ✓, rack behind hung with **pick heads, shovel blades and
  coils of rope** ✓, **a crew of aproned sellers works the stall** ✓ **passing tools across it** ✓ **and
  hauling more from a stack of crates at their backs** ✓, **prospectors working the shallows on the far side of
  the creek, bent over pans in a long line** ✓, stall foreground-right with the diggings receding stage-left ✓.
  **The depopulation failure this shot was rewritten to fix stays fixed** — the people selling are the subject
  and they are in frame.
- The joke lands: **one beige drive unit stands on the counter among the pick heads and blades**, out of place
  and **unremarked** ✓ — no figure looks at it, and it is consistent with the beige drive-unit form established
  in L12–L15.
- Continuity: root frame, no parent.
- Register: warm outline (20.2°, the batch's second-warmest) ✓, flat cel ✓; chromatic ✓.
- Figures: 2 arms / 2 legs verified at crop on all four foreground figures; the sellers' tool handoffs are
  hand-held, not floating; the prospector line is honest depth stacking.
- Lettering: **the board above the awning is broad, plain and unlettered** ✓ — the single highest-risk lettering
  surface in the batch (a shop sign a model badly wants to letter), and it is correctly blank. No text anywhere
  in frame.

---

## Tally

| verdict | count | shots |
| --- | --- | --- |
| **PASS → stamp `verified`** | **13** | L01, L02, L04, L09, L11, L12, L13, L14, L15, L17, L19, L20, L21 |
| **CONCERN → `parked`** | **1** | L16 |
| **FAIL → `parked`** | **3** | L06, L07, L18 |

Parked reasons in one line each:
- **L06** — an unauthored second '1983' tent card duplicates the established diegetic literal.
- **L07** — the authored counter-height vantage was not delivered; one banknote floats with no hand; the '1983'
  card is redrawn truncated to "83"; the crate is not at the counter's near end.
- **L16** — cool blue-black ink (hue 172°, the only inversion in the batch) and the authored beige cases
  rendered grey, collapsing the "beige on grey" palette.
- **L18** — the phone slabs lie flat instead of standing locked up (the R-12 geometry), and the frame
  re-invented its parent's set, crowd and period instead of holding them.


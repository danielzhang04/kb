# P7 boss spec — exact-match round 2 (10 shots, bricks-fresh)

Authored by boss from frame-by-frame forensics of the 10 target baselines and the 4 weakest
P6 outputs (L28/L33/L36/L44). Baselines = `scratch-codex-image-engine/gemini-baseline/` —
SHA-verified identical to the promoted `assets/scenes/` frames of bricks-fresh (6c2 wave,
Daniel-approved). Targets: **L27 L28 L29 L32 L33 L35 L36 L42 L44 L50**.

## Diagnosed P6 failure mechanisms (each maps to a lever below)

1. **Palette clamp squeezed out accent objects.** Top-4 cluster capture missed small-area
   saturated colours (L28/L33/L44's vivid steel-blue table mats; red sign lettering). The
   prompt's "use no colours outside <4 hexes>" then actively FORBADE them → washed
   gray-teal mats, missing accents.
2. **No composition contract.** Figure scale drifted (P6 ~70–75% frame height vs baseline
   ~45–55%), elliptical floor light pools vanished, floor/wall boundary dissolved into
   void, gpt-image-2 added depth-of-field blur (house style has none — L36 P6 blurred the
   foreground stack).
3. **Abstract emotion words underdetermine faces.** "delighted expression" → mild smile
   with open eyes; baseline is closed curved eyes + huge open grin.
4. **No-words law suppressed house lettering.** Baseline MINISCRIBE sign (4 of 10 targets)
   and money-band figures ("125 MILLION", "20 MILLION") are house-legal lettering.
5. **Global single anchor (L47, cool floor)** pulled warm shots and de-saturated fills;
   P6 money greens went gray-green pastel vs baseline's saturated green.

## Global levers (all shots)

- **L1 — register capture v2** (`p7_register.py`): top-**6** palette clusters, PLUS forced
  inclusion of every "accent cluster": saturation ≥ 0.25 and coverage ≥ 0.3% (captures blue
  mats, red accents, lamp green). Measure ALL 23 accepted frames (L26–L50 corpus), not just
  targets. Keep ink hex = darkest-3%-luma mean, unchanged.
- **L2 — class-matched style anchor**: for each target, anchor = the accepted frame nearest
  in register (metric: |Δ(R−B ink)| + 0.5·|Δ mean-palette-warmth|), self excluded. Warm
  shots (L36, L50) must land on a warm anchor, cool floor shots on a cool one. Deterministic,
  computed from the register table; log the chosen anchor per shot.
- **L3 — composition block** in the prompt (new labeled section, after Scene, before
  figures): camera, subject placement, **figure scale as fraction of frame height**, light
  pool geometry, floor/wall boundary. Per-shot prose is given below verbatim — pass through.
- **L4 — expression geometry**: figure clauses use the concrete face spec below INSTEAD of
  bare emotion words (keep the token too: "delighted — closed curved-down eyes, huge open
  smile showing upper teeth, rosy cheeks").
- **L5 — lettering**: shots flagged `lettering` get the exact string + treatment spec below
  and the house lettering exemplar seed (forge lettering path, proven on P6 L36). The Avoid
  block's no-words clause becomes: "no words, letters, numerals or signage EXCEPT the exact
  string(s) specified above". Non-lettering shots keep the full ban.
- **L6 — set-dressing parity**: per-shot dressing inventory with counts (below) goes into
  the Scene section verbatim.
- **L7 — saturation + focus guard**: Constraints gain "cel fills fully saturated exactly as
  in Image <anchor> — washed-out pastel or gray-toned fills are wrong"; Avoid gains
  "depth-of-field blur, bokeh, soft focus — every plane in crisp focus" and "desaturated
  pastel fills".
- Everything that worked in P6 stays: measured ink hex command, front-loaded labeled spec,
  role-labeled refs each ending "do not copy its background or style", anchor last as
  style-only ref, tonal requirements (soft light pools, gentle gradients, subtle contact
  shadows, faint paper grain), red accent #d7402b reservation, ≤5 refs.
- **Ref priority under the 5-cap**: figure plates → lettering exemplar → place ref → style
  anchor; drop from the RIGHT of that list only if over cap (anchor is droppable last in
  principle but in practice trim place ref first; log any trim).

## Per-shot specs

### L27 — tarp reveal (cool garage) — figure: base cast
- Composition: pallet stack of shrink-wrapped cartons on a wooden pallet fills the left 55%
  of frame, a gray canvas tarp half pulled off draping over its top-left; base-cast figure
  (bald, round white head, brown overcoat, tan trousers) stands right of the stack in
  profile leaning back, both arms extended gripping the tarp edge, pulling it away to the
  right; figure ≈55% of frame height. Ceiling skylight upper-left casts a soft beam; one
  hanging bulb with a warm cone upper-right; closed roller door on the right background
  wall; dark forklift tines enter the bottom-left foreground.
- Expression: deadpan — half-lidded flat eyes, tiny straight mouth, no smile.
- Dressing: bare cool-gray concrete floor and walls; shrink-wrap has pale blue-white sheen.
- Lettering: none.

### L28 — empty assembly floor (environment only) — lettering
- Composition: one-point-perspective assembly aisle; closed gray roller door at the center
  back wall; hanging cream signboard centered above it near the ceiling; two rows of steel
  benches recede left and right; a bench corner cuts into the bottom-right foreground; cool
  gray floor with one large soft elliptical light pool centered in the aisle; white
  fluorescent light fixtures hang from the ceiling on rods (≈6 visible); walls cream with a
  teal wainscot band at mid height.
- Dressing (counts matter): left wall shelf unit with ≈9 gray storage bins in 3 rows; each
  bench row carries VIVID steel-blue rectangular work mats (saturated medium blue, NOT
  gray-teal) and angled beige component trays (≈3 per row) holding rows of parts; the
  foreground bench corner also has a vivid blue mat.
- Lettering: hanging sign — cream rectangular board, thin dark outline, hand-painted
  brush-marker capitals reading exactly "MINISCRIBE" in the reserved red #d7402b.

### L29 — rep triumphant on floor (control from P6) — figure: miniscribe-rep
- Composition: same room as L28 (sign, aisle, benches, bins, blue mats, trays, light pool);
  miniscribe-rep centered standing in the light pool, hands on hips, ≈55% frame height,
  full body with feet visible.
- Expression: elated — huge open-mouth grin showing upper teeth, wide-open eyes, raised
  brows.
- Lettering: MINISCRIBE sign as L28.

### L32 — scorched drive recoil (lab void) — figure: scientist/base-cast in lab coat
- Composition: light-gray void room, plain floor with soft shadows only; wooden workbench
  right of center; on it a hard-drive-sized dark plate GLOWING hot red with a radial red
  light bloom and two wavy gray smoke wisps rising; hanging metal dome lamp above casts a
  bright cone onto the bench; scientist figure left of center recoiling away from the
  bench — torso twisted left, both mitted hands raised palms out, right leg kicked up
  mid-stumble; ≈70% frame height; wooden tool pegboard on the wall behind the bench
  (2 screwdrivers with orange handles, 1 wrench hanging); small red bucket on the floor
  right of the bench; round wooden stool bottom-left corner.
- Figure: bald round white head, white lab coat over dark shirt, black trousers, gray
  shoes, gray quilted oven mitts on both hands.
- Expression: shocked — huge wide white eyes with tiny pupils, mouth an open dark oval
  mid-yell.
- Red accent: the glowing plate + bucket are the red elements.
- Lettering: none.

### L33 — handshake (staged interaction) — figures: ibm-suit + miniscribe-rep
- Composition: same room as L28; the two figures stand center-left shaking hands, BOTH
  full-body at ≈45% frame height, feet in the elliptical light pool; ibm-suit on the left
  facing right, miniscribe-rep on the right facing left; blue-mat bench corner bottom-right
  foreground; sign above.
- ibm-suit: dark navy pinstripe suit, gray-templed dark hair, dark skin. Expression smug —
  half-lidded eyes, small closed one-sided smirk.
- miniscribe-rep: tan jacket, BROWN trousers (not black), brown swept hair. Expression
  delighted — closed curved-down eyes, huge open smile showing upper teeth, rosy cheeks.
- Lettering: MINISCRIBE sign as L28.

### L35 — pallet pyramid triumph (warehouse) — figure: miniscribe-rep (tiny)
- Composition: wide warehouse interior, dark roof trusses across the top; a pyramid of
  shrink-wrapped pallet crates center frame — bottom tier 3 crates, middle tier 2, top
  tier 1, each on its own wooden pallet; tiny miniscribe-rep figure stands on the top crate,
  both arms raised in triumph, ≈12% frame height; three wide pale skylight beams fan down
  from the roof onto the pyramid; pale elliptical light pool on the floor around the
  pyramid's base.
- Dressing: background workbenches with small tool silhouettes and wall tool boards on both
  sides; a forklift parked on the right; a forklift mast/cage enters the left foreground;
  muted teal-gray register throughout.
- Expression: joyful — closed curved eyes, wide open smile.
- Lettering: none.

### L36 — 125 MILLION stack (cream void) — figure: miniscribe-rep — lettering
- Composition: cream void with a tan floor plane and a visible soft horizon line — NOT a
  boundless vignette; rep stands atop one large banded stack of bills center frame, fists
  on hips (powerstance), ≈35% frame height; four smaller banded stacks sit around the big
  one at the frame corners (partially cropped); soft contact shadows under every stack;
  every plane crisp — no blur.
- Money treatment: saturated green bills with heavy dark outlines and large pale oval
  portrait medallions; cream paper bands.
- Expression: greedy-smug — half-lidded eyes, small closed smirk.
- Lettering: the big stack's front band reads exactly "125 MILLION" in thick near-black
  hand-marker italic capitals, slightly tilted with the band.

### L42 — balance scale (prop only, cream void)
- Composition: dark cast-iron balance scale fills the frame center; left pan raised high
  holding an open EMPTY tan cardboard box with 3–4 thin single bills leaning against it;
  right pan sunk low under a tall stack of ≈8 banded money bundles (dark olive-green bills,
  cream bands); plain warm cream background, faint paper grain, soft shadows under the
  pans; no figures, no other props; every element heavy-outlined.
- Lettering: none.

### L44 — exec thumbs-down (assembly floor) — figure: ibm-suit
- Composition: same room as L28 (sign, benches, bins, blue mats, beige trays, light pool);
  ibm-suit exec stands center-left IN the light pool, ≈55% frame height full body; left arm
  extended giving a thumbs-down; a small flat tan package lies on the floor in the pool in
  front of his feet; blue-mat bench corner bottom-right foreground.
- Expression: annoyed — flat half-lidded eyes, small tight frown.
- Lettering: MINISCRIBE sign as L28.

### L50 — 20 MILLION desk presentation (warm office) — figure: banker — lettering
- Composition: warm wood-paneled banker's office, tight shot; banker behind a heavy wooden
  desk at frame left, leaning in, both hands presenting/embracing one huge banded brick of
  green bills that dominates the desk center; green glass banker's lamp glowing at frame
  right with a warm light pool on the paneling behind it; wooden drawer cabinets line the
  background walls; dark inkwell and pen stand bottom-right foreground on the desk.
- Figure: banker — swept gray hair, pale round head, brown pinstripe three-piece suit with
  white shirt and dark tie.
- Expression: deadpan-satisfied — half-lidded eyes, tiny closed mouth, faint smugness.
- Money treatment: as L36 (saturated greens, heavy outlines, oval medallions, cream bands).
- Lettering: the brick's front band reads exactly "20 MILLION" in thick near-black
  hand-marker capitals following the band's tilt.

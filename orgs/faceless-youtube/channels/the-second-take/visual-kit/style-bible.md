# The Second Take — Style Bible (LOCKED)

**Engine:** Nano Banana (`gemini-3-pro-image`), seed-from-reference. The single source of law for every
image the channel generates — identity, style, recipe, the asset-library build spec, the verify gates.
The **`image-generation`** skill reads this file and follows it exactly.

## 0. How to use this file

1. Start from the **LOCKED STYLE descriptor (§2)** verbatim, then add only the scene/pose/expression delta.
2. **Seed from the right reference (§5)** — never generate a known character or locked element from text.
3. **Reuse before regenerate** — the registry (§9) is the live index; a hit returns the file.
4. **Every output is reviewed** against §3 in `image-generation`'s one batched post-gen review (identity /
   fidelity / style). **ONE re-authored retry** (§8), then a residual defect is **flagged** for the human
   artifact — never silently ship an off-model frame, never grind.
5. The *process* (two-pass per video, single-asset loop, technique menu) lives in `image-generation`; this
   file is the law it executes.
6. **Edits to any LOCKED value require human approval** — the §2/§2b descriptors, the §3 checklist, §4
   character colours, the §6 recipe, the canonical `base`. `image-generation` proposes and surfaces a
   change, never self-applies one: every reference frame was generated against these values.

## 1. Identity — one template, one rig, a cast

- **No on-screen narrator — a VOICE narrates, the SCREEN is a CAST.** The insider persona is audio only;
  every on-screen character belongs to one visual FAMILY on a shared template, and each story uses many
  distinct characters coming and going.
- **The base is a TEMPLATE, not a character.** `refs/base/base.png` — a bald cream-headed figure in a
  brown hoodie + trousers (its default costume, §4), canonical neutral form, bold dark warm-brown outline
  — is the ANCHOR every cast character seeds off for form, and **it never appears in videos**. Bald +
  cream + hoodie are the template's *default*; cast members vary hair, tone, build, and outfit (costume
  always comes from the generation delta, §2).
- **Default aspect ratios:** `2:3` character portraits/turnarounds · `1:1` props · `16:9` scenes.

**The shared RIG — LOCKED, identical on every character** (this is what lets ONE reaction, built once, map
onto ANY character): the same **round head — a near-perfect circle, at most very slightly taller than
wide, soft rounded jaw, NOT an elongated egg or oval** — and the same head-to-body proportion; the same
**facial layout** (same eye STYLE, size and position, **NO nose**, **NO ears**, brows and mouth in the same
places, so the feature MAP is fixed and reactions are portable); and a simple flat-cel **hand with four
digits — three fingers + a thumb**, never five, six, or a mitten. Hands are de-emphasized (posture is the
acting, §6); the count is not.

**VARIES per character:** hair and hairstyle, facial hair, head tone (flat, stylized), outfit, body build
(stout/slight — proportions stay, mass changes), age/reaction linework (wrinkles, *slight* brow/mouth size
shifts) — never enough to break the shared layout.

**Three tiers of figure — choose by SIZE + RECURRENCE, per figure per shot:**
- **Named / recurring foreground** → seeded from its canonical; §2c auto-appends the form.
- **Anonymous LARGE / foreground** → the **§2e** clause authored into the prompt (full rig, generic fitting
  outfit + hair, no seed, no canonical needed).
- **Anonymous small / many / background** → the **§2d CROWD RIG**: the shared form (round head, same
  proportion, no nose/ears/teeth) with **simplified features — dot eyes + one simple mouth**, identical on
  every crowd figure, because the full rig's fine features are what drift into noses on many tiny faces. A
  crowd is never a Pass-1 lock — different faces each time is a composition, not a recurring identity. *(A
  recurring identifiable GROUP is the opposite: it IS cast and locked, §7.)*

## 2. LOCKED STYLE descriptor (verbatim — prepend to every generation)

> Keep this the SAME single character as the reference — INVARIANTS that never change: SAME perfectly bald
> ROUND head (a soft near-circle, only slightly taller than wide — NOT an egg or oval); the SAME flat head
> colour AS THE REFERENCE character (the base default is #f5ead6, but a named cast member keeps ITS OWN head tone — never forced to cream); SAME dark warm brown-black outline (#241a12); SAME simple cartoon eyes + thin brows,
> NO nose, NO ears; SAME simple hands — a classic cartoon hand with exactly THREE fingers plus ONE thumb (four digits total, like a Mickey Mouse / Simpsons hand), NEVER four fingers, NEVER five digits; SAME clean FLAT cel cartoon style, even medium-thick line.
> Reads unmistakably as the same guy. No text, plain soft light-grey studio background.

Prepended to EVERY generation, so it names only the SHARED rig — **costume and head tone are NOT
invariants.** The **delta ALWAYS supplies the costume**, and **head tone follows the reference character**
(its registry `head_tone` — cream for base, tan `#d9ac82` for MacGregor), never a hard-coded cream. Baking
one costume or tone into the invariant would fight every non-base character. **Precedence:** the delta
overrides this descriptor on exactly the variables it names (an outfit change, era dress, authored diegetic
text per §3); everything it doesn't name, the descriptor holds. For a **new** character keep every
invariant except identity; for an **environment/prop** keep the line + flat cel render and drop the
character clauses (§2b + §5).

## 2b. STYLE-ONLY descriptor (verbatim — for new characters & environments/props)

> Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even
> MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, simple flat colours with gentle
> soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.

For a **new character** the delta supplies only the identity-VARYING traits ("a NEW cartoon person in the
SAME family form as the reference — with [hair / facial hair], a flat [tone] head (§4), and [build +
outfit]"); the rig it must hold is the **§2c RIG-HOLD block**, auto-appended by `forge.py`. For an
**environment/prop**, describe the scene; palette is free.

## 2c. RIG-HOLD descriptor (verbatim — auto-appended to every character-bearing generation)

> Every FOREGROUND / named / seeded cartoon figure in this image keeps the shared FAMILY RIG exactly as
> the reference(s): SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME
> eye style/size/position, NO nose, NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE
> thumb (four digits total, Mickey / Simpsons style, NEVER four fingers, NEVER five digits), SAME even
> medium-thick dark warm brown-black (#241a12) outline, SAME clean FLAT cel render. Anonymous background /
> crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it (simplified: dot eyes,
> one simple mouth) — do NOT force this full rig onto them. Hold ONLY this form — costume, pose,
> expression, head tone, build, and framing are set by the generation delta, not here.

It holds **form, not identity** (it never says "the same person"), so it is safe on any seeded gen.
`forge.py` **auto-appends it whenever a seed is character-bearing** (a `refs/<char>/`, `assets/library/`,
or `assets/scenes/` seed) on a non-identity mode; identity-mode gens already carry the full rig via §2. A
crowd scene that also seeds a named figure still gets §2c for THAT figure — the wording above exempts the
crowd, so both rigs coexist in one frame. The rig VALUES live once in §1 and §3.

## 2d. CROWD-RIG clause (verbatim — write INTO a crowd scene's prompt)

> The background / crowd figures are on the CROWD RIG: round cream-family heads, DOT EYES, one simple
> consistent mouth (neutral / smile / downturn only), NO noses, NO ears, NO teeth, the **EXACT same
> squat head-to-body proportion as the base rig** — a large round head on a short compact body, NOT
> taller/lanky — in varied era-appropriate clothing. Keep every crowd figure on this same simplified rig —
> do not give them individual detailed faces.

The crowd rig differs from the full rig **ONLY in the FACE** — proportion is IDENTICAL to the base rig,
which is why the words above state it as a fact: anonymous figures rendering taller/lankier are the
standing drift (no seed pins their proportion) and a first-class review axis (§3). Unlike §2c, **§2d is
authored by VPW into the `still_prompt`**. **Crowd exemplar:** `refs/base/crowd-exemplar.png` — a
human-approved sample frame (5–6 anonymous figures on the exact squat proportion, dot eyes, one simple
mouth, varied era dress) — is **SEEDED into EVERY crowd-bearing generation**; the §2d words carry the rig
FACTS, but the exemplar seed is what pins proportion and face.

## 2e. BASE-RIG clause (verbatim — write INTO the prompt for an anonymous FOREGROUND figure)

> This prominent foreground figure is an anonymous, non-recurring person drawn on the FULL base family
> rig — SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME eye
> style/size/position, NO nose, NO ears, SAME classic cartoon hands (exactly THREE fingers plus ONE thumb,
> four digits total, never five), SAME even medium-thick dark warm brown-black (#241a12) outline, SAME
> clean FLAT cel render — the identical rig the named cast holds, just NOT a specific person. Give them a
> distinct, era-appropriate outfit and hair so they read as an individual; hold ONLY the rig form.

A large / foreground anonymous figure needs the FULL rig but has no canonical to seed, so §2c's
auto-append never fires for it (`forge.py should_hold` requires a character-bearing seed) and the §2d crowd
rig is too simplified. Like §2d, **§2e is AUTHORED by VPW into the `still_prompt`**.

## 3. The rig checklist — channel invariants (values only)

The **WHAT** `image-generation`'s batched review checks every frame against; that skill owns the **HOW**.
Judge against the channel's **approved canonical** (`refs/<char>/<char>-base.png` — the bar we ship), NOT
an idealized pure-circle / articulated-finger rig: drift from it fails, matching it passes. "Not a mitten"
means *not an undifferentiated blob*, not a demand for articulated fingers; "round near-circle" tolerates
the mild jaw suggestion the canonicals carry, so reject only *distinctly* realistic structure. **In doubt,
put the asset beside the canonical: if it reads as "same channel", it passes** — over-calling a rig fail
costs as much as missing one, queueing needless regens over frames already at the shipped bar, and a regen
that overwrites a good frame can destroy it.

**Every character, every frame — the rig drifts most inside busy scenes:**
- **Head** — round near-circle, only slightly taller than wide, not reshaped, same head-to-body proportion
  as the base. **Facial layout** — same eye style/size/position, brows and mouth in the same places.
- **No nose, no ears.** For a **haired** character the hair/sideburns run down the SIDE of the head to fill
  where an ear would be; a bare, earless, hairless side gap is a FAIL → regenerate.
- **Hands — four digits** (three fingers + a thumb), never five, six, or a mitten. Generation-side digit
  priors are the reliability mechanism: §2/§2c pin the classic 3-finger cartoon hand, which renders 3+1 far
  more reliably than fighting the engine's 5-finger default. **Open / spread / raised hands are the drift
  point** (hands at the sides inherit the base's count), so push the digit clause hardest there and require
  **both hands the SAME size** on a two-hand gesture. **Rig review runs on deterministic crops, not
  full-frame eyeballing:** a **localizer** returns per-figure face + hand bounding boxes →
  **`scripts/crop_battery.py`** (PIL) cuts them at 3–4× → a **SEPARATE fresh judge** rules PASS/FAIL per
  crop with the **crop file path cited as evidence**; prose zoom claims are **inadmissible**. A hand PASS
  is still not a certification — the **human artifact board is the final finger authority**.
- **Outline** — even medium-thick dark warm brown-black (`#241a12`), not pure black, not thin. **Render** —
  clean flat cel shading, even line weight, flat tones. **Head tone** — one uniform flat tone, no gradient,
  no realistic skin, no blush. **Count** — exactly the characters the scene declares.
- **Identity match vs canonical** — a seeded character's head tone + hair must MATCH its canonical: a
  base-cream bald head on a haired/toned character is an **identity FAIL even when every form invariant
  passes**. "Figure present + on-rig" is not an identity ruling; check tone and hair explicitly, because a
  scene-heavy delta can starve the character seed and leave the blank base template in its place. The
  standing prevention is the **two-gen identity pass** (§8), and this check gates that pass's output.
  **Costume** — a named character's pinned canonical costume is part of identity; the wrong outfit fails
  unless the shot authored the change.
- **In-image text is diegetic, baked, and verbatim.** All in-video text is designed into the scene and
  baked into the image; there is no render-time type to fall back on. No unrequested words/labels/logos/
  watermarks — a composed SCENE carries only the text its shot deliberately authored, in the §6 marker
  hand, quoted verbatim in the `still_prompt` and kept SHORT (1–4 words). The review **transcribes it
  letter-by-letter**, and a garbled, misspelled, or partial render is **blocking**. Library CHARACTER
  frames stay fully text-free, but a **seeded PROP carrying its own designed lettering** (a deed, a titled
  banknote, a named guidebook cover) is whitelisted — still transcribed for spelling.
- **Proportion — judged EXPLICITLY, every figure, every tier:** the **squat base proportion** (a large
  round head on a short compact body), not a realistically proportioned adult. Too tall / lanky /
  long-bodied is a FAIL, for seeded figures AND for anonymous §2d/§2e figures with no seed pinning them.
- **Rig judged by tier.** A named/seeded foreground figure and an anonymous LARGE/foreground (§2e) figure
  are both judged against the **FULL** rig; an anonymous crowd/background figure against the **CROWD** rig
  (§2d). A crowd figure with individual detailed faces or noses is a FAIL; so is a prominent foreground
  figure rendered on the simplified crowd rig.
- **Expression register-fit.** An expression is judged against its BEAT: a calm/ordinary/sincere/grim beat
  wants a restrained face, and an **over-the-top expression for its beat is a defect** → reject and regen
  restrained. The big expressions are correct only on a genuine comedic peak.

**Never checked — these vary:** pose, camera framing, hair/facial hair, outfit, head-tone choice, body
build, age linework, action squash/stretch. Never reject a frame for an exaggerated action POSE, for a cast
member having hair, or for a non-default head tone. *(Fidelity and taste are judged in the same batched
review — that procedure lives in `image-generation`.)*

## 4. Palette

**Locked to the character; NOT locked globally** — scene, background, and prop palettes move freely per
video to palette-code tone. Additional recurring characters get a flat tone from a small locked set (cream
`#f5ead6`, warm tan, deeper brown, pale) so different "people" read distinctly while staying on-style;
assign it per cast member in the registry (§9). Same outline and render on all.

| Role | Hex | Notes |
| --- | --- | --- |
| Head tone (default) | `#f5ead6` | cleaner warm cream — the template's face/head |
| Outline | `#241a12` | dark warm brown-black, even medium-thick, on everything |
| Base default costume | warm browns | the base template's brown hoodie + trousers (§1); the delta supplies costume for every other character (§2) |
| Accent (red) | `#d7402b` | **the one locked red** — the single source of truth for BOTH in-image red (a FICTION stamp, a semantic prohibition/alarm/ownership mark) AND the engine's emphasis ink. Pinned to `motion-tokens.json accent`; any red drawn in a gen uses this exact value so a composited frame never shows two reds. |

## 5. Seed rules (identity vs. style — the reproducibility mechanic)

- **A scene generates in ONE run, multi-seeded.** Seeds, in order: **each cast figure's character canonical
  + its `expression_ref` frame + its `pose_ref` frame** (+ the **interaction template** when two figures
  interact), then any needed **style anchor / plate**, prompt last. Identity is the stored canonical frame;
  POSE and EXPRESSION are seeded from the library (§7), never worded — seeding the pose frame carries the
  correct 4-digit library hand, while re-synthesizing a pose from words reverts to the engine's 5-finger
  prior. Both refs are optional (neither = the plain canonical). Outfit and action stay delta variables;
  pose and expression do not.
- **Seed cap — ≤4 per gen:** the character canonical + ONE pose primitive + ONE expression frame + one
  anchor/exemplar (a style anchor OR the crowd exemplar, only when needed). **Beyond 4, dilution weakens
  every prior** — each extra seed pulls toward its own content, and a `base.png` thrown in as an Nth "rig
  anchor" pins nothing. A figure that genuinely needs the base rig gets `base.png` as ONE of the ≤4.
- **Never seed a character variant off a downstream derivative — trace back to the exact frame the human
  approved.** A prior session's "improved" version of a locked design can have silently drifted (an added
  hairline, a shifted tone), and seeding off it propagates that drift as if it were the lock. **Except**
  inside a seeded delta-chain (a held stage's ≤3 delta frames seed the prior frame) and except a re-base
  staying in the SAME location, which seeds the prior stage's base frame (§8).
- **A rig FIX never seeds the defective frame — regen FRESH from canonicals** with a re-authored prompt. An
  identity/de-nose/de-ear pass seeded off the defective frame is **banned as a rig fix**: the defect lives
  in the strongest seed and rides it back about half the time. The ONLY defective-seed exceptions are an
  **authored delta-chain parent** and a **human-ordered framing hold**, and BOTH require a **before/after
  crop diff on EVERY figure** in the frame, not just the targeted one.
- **Library primitives carry the base NEUTRAL face**, never a baked expression: every pose / angle / grip /
  interaction asset is seeded off `base` and holds its neutral face, because expression is a separate seed
  layer applied per scene. A baked face is a build reject → regenerate from `base`. (One exception: a pose
  whose own hand occludes the face, e.g. `facepalm`.) **Expression is the SOFTEST seed** and can land weak,
  so the batched review checks expression-register per beat.
- **An EXPOSED articulated hand MUST come from a seeded pose primitive — never free-drawn.** A salute,
  wave, open palm, or raised/pointing hand is the 5-finger drift point: seed the matching `refs/base/` pose
  frame (e.g. `action-salute.png`) so the hand GEOMETRY comes from the library, AND state the digit FACT in
  the delta ("a hand with exactly three fingers and a thumb, four digits"). No library pose covers the
  gesture → generate that pose on `base` first (§7 / VPW `needed_assets`, human gate).
- **Attribute routing — the seed-routing law.** Base-derived seeds (pose/expression frames, interaction
  templates) are bald, cream, neutral-faced, hoodie, so **any attribute not explicitly sourced from the
  CHARACTER seed bleeds a base trait**. Route by source: **CHARACTER seed** → identity, head/skin tone,
  hair + facial hair/sideburns, costume, the face; **POSE / interaction-template seed** (geometry only) →
  body pose, hands, and for an interaction the clasp geometry, figure placement, and eye-line; **EXPRESSION
  seed** (shape only) → eye/brow/mouth shape, never tone, head, hairline, or identity. Every skin patch,
  INCLUDING BOTH HANDS, renders in the **CHARACTER's** head tone.
- **Brand-new character:** seed off `base` for line, render, and proportions only; give a new head tone
  (§4) and identity; register it (§9). **Reuse:** an exact registry hit returns the file, no generation.
- **A style-anchor seed is MANDATORY on every environment, plate, and composed-scene gen** — the character
  seeds pin identity, NOT art style, and unanchored runs drift chunk-to-chunk into a softer,
  detailed-middle look with mismatched line weight. `forge.py` **hard-errors** an environment/style gen
  with zero seeds (an unseeded gen falls back to a stock-clipart prior, off style). Preference order: **the
  target plate or prior-frame-in-chain (a composed scene's continuity parent) > a `refs/env/` anchor
  matched by REGISTER (vivid exterior / muted exterior / parchment map-document) > an approved on-style
  scene.** That seed carries line weight + flat cel look; describe the scene, palette is free. The
  environment + props are composed in the gen from the shot's facts, **never seeded from a pre-baked
  plate**: a plate generated in isolation commits its lighting, perspective, and negative space blind to
  the figures, so it fights the composite. The delta realizes the `still_prompt`'s authored
  framing/placement (VPW owns composition — `visual-grammar.md §2`).
- **Maps — CROP the existing map canonical, never regen for a new region.** Do it deterministically with
  PIL; a regen invents a new coastline, palette, and lettering hand, so two "same" maps read as two
  different maps. Regen is the fallback only when the canonical genuinely doesn't cover the region, and it
  then seeds the **map canonical + `refs/env/env-map-parchment`**. Borders, routes, and region reveals
  drawn onto the crop are motion layers — the crop is the plate.
- **Match-prop — a prop shown in more than one shot seeds its FIRST APPROVED frame as the prop canonical.**
  When a designed object must look identical across shots (a bond design, a guidebook, a named deed), the
  frame where it was first approved IS its canonical: every later shot seeds that exact frame and never
  re-describes the design in words. This is the §7 recurring-prop lock even for a prop not pre-locked.
- **Crowd scene with ONE seeded lead — assert the lead's costume and contrast the crowd.** A crowd competes
  with a lone seeded figure and can starve its costume, so restate the lead's pinned costume explicitly
  even though it is seeded, and give the anonymous crowd a **contrasting uniform/palette** so the lead
  reads as distinct. The lead is still judged against its canonical in the batched review.

## 6. The committed visual recipe (LOCKED — this is THE direction)

> **Clean 2.5D vector cast + built (flat-but-real) environments + marker-style charts / diegetic
> lettering + one red accent.**

- **Cast:** the locked 2.5D rig (§1) — flat cel characters + money objects, never photoreal, never the
  uncanny middle (`universal.md §13`). The no-nose round head carries a small mouth-led expression
  vocabulary, so read emotion in a legible mouth + brow, restrained by default; the simple hands mean
  **posture/lean/recoil is the acting**; decisive pose keys + hard cuts remove any need for true
  squash-and-stretch. **Personified institutions** are cast members with ONE identity tag (a flag necktie,
  a hat, a uniform) or an iconic building, reused consistently.
- **Environments:** *built* but flat — a real setting per scene (boardroom, street, dock), composed
  **edge-to-edge with a fore/mid/background depth read**, a **committed warm scene palette**, and
  **light/atmosphere** (dawn, spotlight, glow). **Rich, not sparse:** name the real furniture of the place
  (colonnades, boulevards, ship rigging, stacked trunks), not one lone prop on empty air — *no dead air* —
  while staying flat-cel, no parallaxed realism. The bar is the gold composed-scene exemplar (the first
  approved composed scenes become it): dense, deep, warm-palette, filled.
- **Charts / diegetic lettering:** a hand-drawn **marker / sketch family** (deliberately crude, never
  corporate infographic), accreting diagrams and timelines, a recurring "your money" avatar. No title or
  chapter cards — a chapter turn is a hard cut / palette turn. **Lettering is LOCKED: relaxed
  hand-lettered MARKER CAPITALS with a slight lean and baseline bounce — quick confident handwriting, no
  letter joins, never calligraphy or a clean digital font — ink `#241a12`.** The canonical exemplar is
  `refs/env/lettering-marker-italic.png` and **every text-bearing generation seeds it** (it lives under
  `refs/env/` so it never triggers the §2c rig-hold). The bar is FAMILY match, not glyph identity:
  letterforms may wobble like real handwriting, and the review flags a different HAND (clean digital type,
  formal script, wrong weight class), never natural variation. Spelling stays strict.
- **STAMP register — the ONE exception to the marker family (LOCKED):** all big **stamp-down marks** (FAKE
  / FICTION / SOLD and kin) render in **heavy block CAPITALS, dense saturated red `#d7402b` ink** (thick
  solid strokes, distress only at the edges), a **thin `#241a12` letter contour** hugging each glyph (a
  clean ink contour, NOT a drop shadow / offset ghost), **flat matte**, hand-stamped edge distress. **Every
  stamp / seal / mark cutout GEN seeds `refs/env/stamp-block-outlined.png` PLUS its destination plate** for
  scale + palette; a stamp with no exemplar seed is a register FAIL, re-generated and re-checked.
- **Keep authored copy short** (§3) — the marker hand garbles long strings. **A caption that renders
  TRUNCATED or crammed mid-word got too little canvas:** do not squeeze it into a scene edge, re-author the
  text as its OWN architectural element (a wall plaque, signboard, banner) sized with clear margin after
  the final glyph.
- **Diegetic art / artifacts:** an in-world painting, poster, brochure vista, or map-as-artifact renders in
  OUR flat-cel look with the `#241a12` outline — our style *depicting* an artifact, not a soft-gradient
  illustration. A too-perfect glossy "brochure" comes from palette + composition.
- **Colour:** the locked 2–3 colour palette **+ one red accent** (character colours fixed in §4). The
  locked signature is a monetization prerequisite; the moat is the editorial voice, so the recipe is stable
  and the *payload* varies.

## 7. Asset library — build spec + build order

The channel's **STANDING, cross-video kit**, built deliberately over time. A single video's one-off scene
environments and props are composed in-shot at generation time (Pass 2 / §8), never pre-baked as plates;
per-video Pass 1 locks that video's recurring individual characters, any recurring identifiable GROUP
(locked once as a group-character), and any **recurring identifiable PROP** (locked once as
`assets/library/prop-<name>.png`, seeded into each appearance, no pose/expression). **This is the build
spec; the live index of what exists is `registry/registry.json` (§9).** Iconic silhouette shapes, not
realistic detail. The expression set (1) and action-pose set (6) are the **direct scene-seed source** (§5):
a shot's `pose_ref`/`expression_ref` names one and it is seeded straight into the scene gen; a
pose/expression the library lacks is generated on the base first (VPW `needed_assets`, human gate), never
re-drawn ad-hoc inside a scene.

1. **Moderate-register expression set** (the lead of a beat) — small, mouth-led, **restrained by default**:
   held deadpan/unimpressed (the dry default), a measured shock (open mouth, not a wide trapezoid), a warm
   smile, mild irritation, worried knit-brow, smug asymmetric brow; the big end (wide-mouth laughing, full
   shock) exists for a genuine comedic PEAK. The FRAMES are authored moderate, since the scene gen seeds
   each frame's eye/brow/mouth shape directly and a frame that reads flat alone lands flat in the scene.
   Secondary characters get **one held expression**; cheap graphic-symbol overlays (heart, sparkle,
   exclamation, zigzag, blush) add intensity at near-zero cost.
2. **Finance concept-prop library** (highest-leverage build — literalizes the payloads): cracked anchor,
   price-tagged barrel, cash mountain, printing press, gold-bar pyramid, house of cards, sinking boat,
   inflating balloon, leaking bucket, domino line. A prop-only shot can *be* the beat.
3. **Diegetic screen / artifact devices (baked into the scene):** a split-screen A/B frame, a fake-UI screen
   (dashboard/chat/search/CRT-TV/radio/newspaper front page), a "this didn't happen" no-symbol overlay —
   **flavor only, sparingly** (a money-*story* channel, never a lecture; `visual-grammar.md`).
4. **Reusable environment plates:** a power/institution interior, a street/exterior, an interior room, a
   data-void — each with day/night palette variants, from flat gradient + minimal geometry + one foreground
   depth prop. No realistic detail or parallax.
5. **Secondary / personified-institution cast:** banker, customer/mark, 2–3 institution avatars,
   differentiated by flat head-tone + one identity tag, each on the shared rig.
6. **Pose / angle / grip / interaction library** (base figure re-posed, all seeded off `base` with the
   NEUTRAL base face, §5):
   - **Poses:** sit (chair-less, seat implied), facepalm, surrender, whisper-aside, kneel-beg,
     point-at-thing, power stance, slump, shrug, salute, thumbs up/down, accuse, head-in-hands, offering,
     present, arms-crossed, celebrate. Idle micro-motion is the render engine's job.
   - **Angle / movement:** back-to-viewer, 3q-turn-right, walk-left / walk-right (directional). A strong
     static 3/4 resists the front seed — the turn lands only when the figure has a reason to turn; true
     profile is deferred.
   - **Grips** (object-agnostic — store the GRIP; the object is a per-scene delta rendered as a generic grey
     placeholder): hold-one-hand, hold-both-hands, hold-paper-by-sides, carry-by-handle, sign-with-pen,
     reach-to-take.
   - **Interaction templates** (two blank base mannequins; a scene seeds the template + two character
     canonicals and binds identities by `cast` order — first = left, second = right — in ONE gen):
     handshake (right-to-right clasp), handoff, fistbump. The template carries the clasp geometry +
     eye-line, so a scene inherits both by seeding it. **Eye-line is PUPILS-only:** heads stay front-facing
     and round; NEVER turn a head toward the other figure to force the gaze — a profile head-turn grows a
     nose/jaw and breaks the no-nose rig. **Contact interactions only** — a no-contact two-person shot
     composes single-figure poses at scene time.

**Build order (front-loads the most-reused):** expressions → concept props → diegetic screen devices →
plates → secondary cast → action poses.

## 8. Generation protocols

- **Base-then-fan-out:** the canonical `base` is generated, approved, and *verified* first; only then fan
  out the matrix, each frame seeded off it. An unverified base multiplies its drift across every child
  frame, and pro generation is not free.
- **Anchored iteration ("iterate on THIS"):** pin the exact approved frame as the seed, restate §2, change
  ONLY the requested variable — and **prove the change landed by MEASUREMENT, never by eye.** Seeded gen is
  sticky: a worded delta on a small detail is often **silently ignored**, the engine re-emitting the seed.
  Compute the **mean-abs-diff with Pillow** (0 = identical) and sample the changed region; a near-zero
  whole-diff means the delta was **ignored**, not subtle. When it was ignored, **escalate the MECHANISM
  instead of re-wording**: open or replace the pose so the feature is unambiguous, mask + regenerate just
  that region, or restate the whole subject. A relaxed or half-closed feature (a closed hand) is ambiguous
  to judge — never assert a count off one; gate open-pose frames instead (§3).
- **Measure a matte, a colour, or a geometry — never eyeball it.** For any question about a cutout's alpha,
  a halo, a colour value, or a geometric property (tilt, scale), reach for **Pillow before an opinion**:
  sample the **alpha histogram + corner pixels**, sample the disputed **pixel against its canonical's
  value**, compute **tilt from the alpha bbox** — and **composite the cutout over its ACTUAL destination
  plate**, never a neutral field (a defect invisible on cream is glaring on green). Across a full measured
  run every measured call was correct and every eyeballed one wrong, in BOTH directions. **The model's eye
  is not evidence; a measurement is.**
- **Cutout transparency is ALWAYS post-hoc keying — the engine emits NO alpha.** A cutout gen renders the
  object on a **solid MAGENTA chroma field**, prompted as **"one solid uniform FLAT magenta background, NO
  glow, NO gradient, NO vignette"** — fringe/halo failures are generation-side glows, not keying failures,
  so the fix is forcing a flat field at GEN time. **Matte verification samples the ENCLOSED interior
  regions** — letter counters, rigging gaps, frame holes — not only the outer silhouette and corners, and
  composites over the real destination: a pale field starves rembg on a pale subject and rembg keeps
  enclosed pale interior holes, so an exterior that keys clean can still carry an opaque interior patch.
- **Verify loop — ONE re-authored retry, then surface.** Frames are reviewed in `image-generation`'s
  batched post-gen pass (§3 + fidelity + taste), not per-frame mid-gen. A flagged frame gets **exactly one**
  retry, a **FRESH gen off a RE-AUTHORED prompt — never prompt-accretion**: do not append the flag onto the
  failed delta and re-fire; rethink how the frame is described and generate clean off the canonical. Still
  failing → keep the best, flag it, push it to the human artifact. No second retry, no grind. A locked-file
  fault is surfaced for approval, never self-edited.
- **Head shape follows CONTENT, not the shape word.** The engine treats the head-shape adjective as nearly
  inert; drift toward a realistic jaw is driven by *human-defining detail* — age, hair, facial hair, gender,
  build pulling in a realistic-head prior. The lever on a detail-rich NEW character is an explicit
  **anti-realism clause** in the delta ("keep the flat stylized cartoon skull — no jaw, no cheekbones, no
  realistic face structure") plus the seed path (§5). Keep the descriptor's words ACCURATE to the reference
  anyway: they document the lock, not just lever it.
- **Two-gen identity pass** — the default for a scene-heavy single-character shot, where the heavy
  environment delta starves the lone character seed: gen A composes the scene, gen B is an identity pass
  seeded `[gen-A frame + character canonical + expression frame]` changing ONLY the figure's identity.
- **Engine (one, no tiers):** every generation — characters, scenes, chains, thumbnails — uses the single
  registry `engine` `gemini-3-pro-image`. No per-call model choice, no cheaper fallback.

**Scene assembly (how a composed scene is built):**
1. **Compose the whole scene in ONE gen, multi-seeded:** each `cast` figure's canonical + `expression_ref`
   + `pose_ref` (+ the interaction template when two figures interact), plus the style anchor (§5); the
   environment, fixed props, and sky/water are DESCRIBED in the delta and composed in the SAME generation,
   with attributes routing by seed (§5). Seeding the canonical is what holds identity and the library hand
   — a free-drawn named character falls off the rig. **§2c is auto-appended** to every character-seeded gen.
2. **A held scene evolves one of two ways — the BOUNDARY rule.** **DELTA-CHAIN when the change is
   INTEGRATIVE** (the element becomes part of the scene's architecture — a city grows a bank; gold threads
   the streets): regenerate seeded off the prior frame (base + ≤3 deltas; each delta changes ONE element
   and holds the rest — that frame-to-frame carry-over, not a reused plate, is what holds the set). **A
   re-base inside the SAME location seeds the prior stage's BASE frame, never a fresh canonical** —
   canonical throws the set away and the location comes back a visibly different place. **A delta that
   REMOVES a transient element seeds the PRE-TRANSIENT ANCESTOR**, since the immediate predecessor still
   carries the element and drags it back (a crowd departs a dock → seed the empty-dock frame from before
   the crowd). **LAYER when the change is DISCRETE** (the element sits on the scene without fusing — a
   character enters, a stamp slams onto a page): keep the plate and composite an animated cutout. Every
   cutout is SEEDED (from its character/prop canonical, or the plate it lands on plus a style anchor) — an
   unseeded cutout invents its own register.
3. **Every human figure is the §1 family, rendered by tier:** named/seeded foreground figures on the FULL
   rig (their seed + auto-appended §2c), anonymous crowds on the CROWD RIG — the VPW-authored §2d clause is
   already in the `still_prompt` and the crowd is generated **seeded off the crowd exemplar**. Crowd figures
   are a deliberately simpler rig, uniform across the crowd, not a degraded full rig that gets vaguer with
   distance. Art style, proportions, and period never switch.
4. **One-shot whole-scene** is fine for a simple shot with a single prominent character — seeded off that
   character's canonical (+ its expr/pose frames), full §3 check on it and every incidental figure. Then
   **verify the assembled scene** (§3 on every figure + the scene-taste gate). *(True layer compositing —
   placing element PNGs programmatically — is the render engine's layered-shot path; image-gen materializes
   the plate + the seeded cutout.)*

**Channel-signature elements lock like characters:** a NON-character element recurring across MANY videos
(an ongoing ship, a landmark building, a channel flag) can get ONE approved canonical registered via
`register` with `"environment": true`, filing it under `refs/env/` and indexing it as a kind-`environment`
asset; every later use SEEDS off it. A deliberate cross-video lock, not the per-video default. For render
texture that must stay consistent across a video (how skies, clouds, water, and ground render), keep a
short reusable **scene-style descriptor** and prepend it to every scene gen.

## 9. Registry — the live index of recurring cast & world

`registry/registry.json` is the single live index of what exists, in two collections: **`characters`**
(canonical file + head tone + pinned costume) and **`assets`** (expressions, actions, props, plates —
canonical file + seed frame). Cross-video signature environments/plates and the standing **style-anchor
register frames** are `assets` with `kind: environment` (`character: null`, no `seed_frame`). The register
anchors live in `refs/env/` — **three are locked** (`env-exterior-vivid`, `env-exterior-muted`,
`env-map-parchment`, tags `exterior-vivid` / `exterior-muted` / `map-parchment`) — and every
environment/style gen seeds one by REGISTER (§5). A **per-video recurring prop** is NOT a registry entry:
it lives only in that video's `assets/library/` (`kind: prop`, `prop-<name>.png`) and graduates to a
`kind: environment` entry only if it recurs across MANY videos (a deliberate §8 promotion). Canonical
frames live in `refs/` (characters under `refs/<character>/`, props/elements/plates under `refs/env/`), and
**the `refs/` copy is the canonical every later seed references** while a per-video `assets/library/` keeps
its own working copy. Reuse-before-regenerate keys off the registry, `visual-prompt-writer` reads it as the
channel's asset vocabulary, and `image-generation` registers each new verified channel-recurring asset back.

# The Second Take — Style Bible (LOCKED)

**Status:** LOCKED 2026-07-04 · **Engine:** Nano Banana (`gemini-3-pro-image`), seed-from-reference.
**This file is the single source of law for every image the channel generates** — identity, style,
recipe, the asset-library build spec, and the verify gates. Edits to anything marked LOCKED require
human approval (§10). The **`image-generation`** skill reads this file and must follow it exactly.
Design rationale: `docs/superpowers/specs/2026-07-04-visual-style-lock-system-design.md` +
`2026-07-08-image-generation-rebuild-design.md`.

---

## 0. How to use this file (any terminal / the image-generation skill)

1. Start from the **LOCKED STYLE descriptor (§2)** verbatim, then add only the scene/pose/expression delta.
2. **Seed from the right reference (§5)** — never generate a known character or locked element from text alone.
3. **Reuse before regenerate** — the registry (§9) is the live index of what exists; a hit means return the file.
4. **Every output is reviewed** against §3 (the rig checklist) in the `image-generation` skill's one
   batched post-gen review (identity / fidelity / style). **ONE re-authored retry** (§8), then a residual
   defect is **flagged** for the human artifact — never silently ship an off-model frame, and never grind.
5. The *process* (two-pass per video, single-asset loop, technique menu) lives in the
   `image-generation` skill; this file is the law it executes.

## 1. Identity — one template, one rig, a cast

- **No on-screen narrator — a VOICE narrates, the SCREEN is a CAST.** The dry-smart insider persona is
  **audio only**; there is **no recurring host character on screen** (unless we deliberately choose one
  later). Every on-screen character is a member of one visual FAMILY on a single shared template, and each
  story uses many distinct characters coming and going (the OverSimplified / HeyHistorically model).
- **The base is a TEMPLATE, not a character.** `refs/base/base.png` — a bald cream-headed figure in a
  **brown hoodie + trousers** (its default costume, §4), in the canonical neutral form, bold dark warm-brown
  outline — is the design ANCHOR / rig every cast character seeds off for form. **It never appears in
  videos.** Bald + cream + the brown hoodie are the template's *default*; cast members vary hair, tone,
  build, and **outfit** (costume is always supplied by the generation delta — see §2). (Frames live in
  `refs/base/`.)
- **Default aspect ratios:** `2:3` character portraits/turnarounds · `1:1` props · `16:9` scenes/environments.

**The shared RIG — LOCKED, identical on every character** (this is what lets ONE reaction, built once,
map onto ANY character):
- **Head shape + proportions** — the same **round head: a near-perfect circle, at most very slightly taller
  than wide, with a soft rounded jaw — NOT an elongated egg or oval** — and the same head-to-body proportion.
  Held on every character (do not reshape it).
- **Facial layout** — same eye STYLE, size and position; **NO nose**; **NO ears**; eyebrows and mouth in the
  same places. The feature MAP is fixed so reactions are portable.
- **Hands** — a simple flat-cel hand with **four digits: three fingers + a thumb** (as the base renders), on
  every character. Hands are de-emphasized (posture is the acting, §6), but the **digit count is fixed** — it
  never drifts to five, six, or a mitten.

**VARIES — per character (costume + surface):**
- Hair & hairstyle, facial hair, skin/head tone (flat, stylized), outfit, and **body build** (stout/slight is
  allowed — proportions stay, mass can change).
- **Age & reaction linework** — wrinkles/age lines, and *slight* differences in eyebrow/mouth SIZE: small,
  never enough to break the shared layout or stop a reaction mapping onto the character.


## 2. LOCKED STYLE descriptor (verbatim — prepend to every generation)

> Keep this the SAME single character as the reference — INVARIANTS that never change: SAME perfectly bald
> ROUND head (a soft near-circle, only slightly taller than wide — NOT an egg or oval); the SAME flat head
> colour AS THE REFERENCE character (the base default is #f5ead6, but a named cast member keeps ITS OWN head tone — never forced to cream); SAME dark warm brown-black outline (#241a12); SAME simple cartoon eyes + thin brows,
> NO nose, NO ears; SAME simple hands — a classic cartoon hand with exactly THREE fingers plus ONE thumb (four digits total, like a Mickey Mouse / Simpsons hand), NEVER four fingers, NEVER five digits; SAME clean FLAT cel cartoon style, even medium-thick line.
> Reads unmistakably as the same guy. No text, plain soft light-grey studio background.

**Costume AND head tone are NOT invariants.** This block is prepended to EVERY generation (base, cast, period
figures alike), so it names only the SHARED rig — the round head / outline / eyes / no-nose / no-ears /
four-digit-hands / flat-cel style — never a costume, and never a *specific* head colour. The **delta ALWAYS
supplies the costume** (the base default is a brown hoodie + trousers, §1/§4; every named/period character gets
its own outfit from its delta + registry), and **head tone follows the reference character** (its registry
`head_tone` — cream for base, tan `#d9ac82` for MacGregor, etc.), never a hard-coded cream. Baking one costume
or one tone into the invariant would fight every non-base character.

For a **new** character, keep every style invariant EXCEPT identity (vary head tone from the §4 palette, body,
outfit); for an **environment/prop**, keep the line + flat cel render but drop the character clauses. See §2b + §5.
**Precedence:** the generation DELTA overrides this descriptor on exactly the variables it names (an outfit
change, era dress, deliberately-authored diegetic text per §3) — everything the delta doesn't name, the
descriptor holds. That is the standing seed-from-reference mechanic, not an exception.

## 2b. STYLE-ONLY descriptor (verbatim — for new characters & environments/props)

> Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even
> MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, simple flat colours with gentle
> soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.

For a **new character**, the delta supplies only the identity-VARYING traits: "a NEW cartoon person in the
SAME family form as the reference — with [hair / facial hair], a flat [tone] head (§4), and [build +
outfit]." The shared RIG it must hold (round head, no nose/ears, three-fingers-plus-thumb hands, outline,
flat cel) is the **§2c RIG-HOLD block**, which `forge.py` auto-appends to the gen — do not restate it in the
delta. For an **environment/prop**, describe the scene; palette is free.

## 2c. RIG-HOLD descriptor (verbatim — auto-appended to every character-bearing generation)

> Every FOREGROUND / named / seeded cartoon figure in this image keeps the shared FAMILY RIG exactly as
> the reference(s): SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME
> eye style/size/position, NO nose, NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE
> thumb (four digits total, Mickey / Simpsons style, NEVER four fingers, NEVER five digits), SAME even
> medium-thick dark warm brown-black (#241a12) outline, SAME clean FLAT cel render. Anonymous background /
> crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it (simplified: dot eyes,
> one simple mouth) — do NOT force this full rig onto them. Hold ONLY this form — costume, pose,
> expression, head tone, build, and framing are set by the generation delta, not here.

## 2d. Canonical dispatch suffix

**`global_prompt_suffix`** — empty. `shots.json` may omit it or store `""`; Forge dispatches neither.
The authored scene payload owns the provider-weighted tail.

## 3. Review criteria

## 3. The rig checklist — channel invariants (values only)

The **WHAT** the `image-generation` skill's batched review checks every generated frame against; that
skill owns the **HOW** (the one post-gen review — identity/fidelity/style). Judge against the channel's
**approved canonical** (`refs/<char>/<char>-base.png` — the bar we actually ship), NOT an idealized
pure-circle / articulated-finger rig: drift from it fails, matching it passes.

**Read every rule below at that level.** "Not a mitten" means *not an undifferentiated blob you can't
tell is a hand* — it does NOT demand articulated fingers; the channel's flat-cel hand IS simplified.
"Round near-circle, not egg/oval" tolerates the same mild jaw/chin suggestion the approved canonicals
carry — reject only when a head has *distinctly* realistic structure (obvious cheekbones + jawline +
chin bulge that reads photographic). **In doubt, put the new asset beside the canonical: if it reads as
"same channel," it passes.** Over-calling a rig fail costs as much as missing one — it queues needless
regens over assets already at the shipped bar, and a regen that overwrites a good frame can destroy it.

**Every character, every frame (the shared rig, §1) — the rig drifts most inside busy scenes:**
- **Head** — round near-circle, only slightly taller than wide; NOT reshaped, NOT an egg/oval; same
  head-to-body proportion as the base.
- **No nose, no ears** — the first things to drift in scenes. For a **haired** character, the hair/sideburns
  run down the SIDE of the head to fill where an ear would be — a bare, earless, **hairless side gap** (skin
  showing where the hair should be) is a FAIL (a base-derived seed can bleed it off; caught here → regenerate).
- **Hands — four digits** (three fingers + a thumb), never five, six, or a mitten. **Generation-side
  digit priors remain the reliability mechanism** — the §2/§2c descriptors pin the classic 3-finger
  cartoon hand, which renders 3+1 far more reliably than fighting the engine's realistic 5-finger
  default. **Open / spread / raised hands (salute, offering, head-in-hands) are the drift point** — hands
  at the sides inherit the base's correct count — so push the digit clause hardest on open-hand poses, and
- **Facial layout** — same eye style/size/position; brows and mouth in the same places (only expression
  + *slight* brow/mouth-size shifts).
- **Outline** — even medium-thick dark warm brown-black (`#241a12`), not pure black, not thin.
- **Render** — clean flat cel shading, even line weight; cartoon, flat tones, not realistic.
- **Head tone** — one uniform flat tone (no gradient, no realistic skin, no blush).
- **Identity match vs canonical** — a seeded character's head tone + hair must MATCH its canonical: a
  base-cream bald head on a haired/toned character is an **identity FAIL even when every form invariant
  passes**. "Figure present + on-rig" is not an identity ruling — check the head tone and hair against
  the canonical explicitly (a scene-heavy delta can starve the character seed and leave the blank base
  template in its place; that frame passes every §3 form check and is still the wrong character). The
  standing prevention is the **two-gen identity pass** — the DEFAULT for a scene-heavy single-character
  shot (image-generation Pass 2: gen the scene, then an identity pass seeded off the character
  canonical); this check still gates that pass's output.
- **Costume** — a named character's pinned canonical costume is part of identity; the wrong outfit fails
  unless the shot authored the change.
- **In-image text is diegetic, baked, and verbatim** — ALL in-video text is designed into the scene and
  BAKED into the generated image (a stamp, a sign, a ledger, a banner). Engine-drawn text overlays are
  retired, so there is no render-time type to fall back on. No unrequested words/labels/logos/watermarks; a
  composed SCENE carries only the text its shot deliberately authored (the HeyHistorically idiom), rendered
  in the §6 marker hand. Authored text is quoted verbatim in the `still_prompt` and kept SHORT (1–4 words
  proven; longer unproven); the review **transcribes it letter-by-letter** and a garbled, misspelled, or
  partial render of the asked-for words is a **blocking** flag. Library CHARACTER frames stay fully
  text-free — but a **seeded PROP that carries its own designed lettering** (a deed, a titled banknote, a
  named guidebook cover) is the exception: that lettering is part of the prop's authored design, so it is
  whitelisted, NOT an "unrequested text" fail (the deed reading its title is correct, not a defect). A
  prop's own baked lettering is still transcribed letter-by-letter for spelling like any authored text.
- **Proportion — judged EXPLICITLY, every figure.** Named cast matches the shared squat base proportion;
  a genuine crowd matches the crowd exemplar seed on every depicted figure. Too tall, lanky, or
  long-bodied is a drift-from-rig FAIL. Judge proportion alongside head shape, not as an afterthought.
- **Count** — exactly the number of characters the scene declares.

**Never checked — these vary:** pose, camera framing, hair/facial hair, outfit, head-tone choice, body
build (stout/slight), age linework, action squash/stretch. Never reject a frame for an exaggerated action
POSE, for a cast member having hair, or for a non-default head tone (the base template is bald + cream —
that is *its* canonical form, not a cast requirement).

**Expression IS checked for register-fit.** An expression is judged against its BEAT: a calm/ordinary/
sincere/grim beat wants a restrained face, and an **over-the-top expression for its beat is a defect**
(a caricature laughing/shock face on an ordinary or grim beat → reject and regen with a restrained
expression). The big expressions are correct only on a genuine comedic peak. (This replaces the former
blanket "never reject for exaggeration" — exaggerated action *poses* are still fine; over-the-top
*expressions on the wrong beat* are not.)

(A composed scene is additionally judged for **fidelity** and **taste** in the same batched review —
that procedure lives in the `image-generation` skill.)


### Fresh-eyes plan questions

> 1. **Scene logic.** Do the shot's stated facts make sense — geography (the right landmasses,
>    the right direction of travel), spatial layout, orientation (a vehicle faces where it goes;
>    interacting characters face each other), causality? Would a viewer who knows the story spot a
>    wrongness the author missed?
> 2. **Tableau.** Would this still read as a *deliberate composition* if frozen for its full
>    `duration_s`? A freeze of continuous motion (mid-stride, mid-shuffle, mid-sweep, mid-fall) is a
>    finding. A held pose that carries the action's meaning (a salute, a planted stance, presenting,
>    a held point) is correct.
> 3. **Casting.** Is every story-named or story-referenced figure cast from the registry — including
>    inside diegetic media (a brochure figure, a portrait, a poster who IS a named character)? Does
>    every role read at a glance (a king reads as a king)? Is any named figure in the wrong
>    canonical outfit without the shot authoring the change?
> 4. **Acting.** Does expression/pose track the beat and the channel's register map — or is one
>    default face riding every beat? (A character identical across a swagger beat and a ruin beat is
>    a finding.)
> 5. **Staging interest.** Is this the most interesting *legitimate* staging of the beat — or the
>    first competent one? Hold the hook shot to the scroll-stop bar: if it would look at home
>    mid-video, it fails. Flag bare scenes whose interest depends on nothing (no composition idea,
>    no palette code, no world-detail).
> 6. **Renderability.** Does the shot's *meaning* depend on animation the pipeline cannot render
>    (element motion inside a frame — walking, peeling, pouring)? The renderable set is: the still +
>    one camera move + word-anchored overlays + changes arriving AT cuts (stage deltas). A beat that
>    *needs* in-frame element motion must be restaged (as a delta chain, a tableau that implies the
>    motion, or an overlay-carried reveal).

### Machine-emitted applicable review rows

- `support-contact`: Seated named figure names a support + contact phrase (C-7).
- `relative-scale`: Two named cast: plane / eye line / relative head scale stated (C-8).
- `place-owner`: owner cue `'<LITERAL>'` legible in frame per L-1?
- `lettering-register`: Text-bearing frame matches the locked crude-marker exemplar's lettering family, orthogonal to spelling.
- `lettering-fidelity`: Every supplied or carried literal is letter-for-letter exact.
- `crowd`: CROWD rig holds against the crowd exemplar seed on every depicted figure.
- `texture-strip`: No rig-register card introduces a sub-outline micro-pattern texture.

## 4. Palette

**Locked to the character; NOT locked globally.** Scene/background/prop palettes move freely per video
(a warzone is grey, a bank is teal, a park is green). Only the character's own colours are fixed:

| Role | Hex | Notes |
| --- | --- | --- |
| Head tone (default) | `#f5ead6` | cleaner warm cream — the template's face/head |
| Outline | `#241a12` | dark warm brown-black, even medium-thick, on everything |
| Base default costume | warm browns | the base template's default brown hoodie + trousers (§1); the delta supplies costume for every other character (§2) |
| Accent (red) | `#d7402b` | **the one locked red** — the single source of truth for BOTH in-image red (a FICTION stamp, a semantic prohibition/alarm/ownership mark) AND the engine's emphasis ink. Pinned to `motion-tokens.json accent`; any red pixels drawn in a gen use this exact value so a composited frame never shows two reds. |

**Cast head-tone palette (flat, stylized — NOT realistic skin):** additional recurring characters get a
flat tone from a small locked set so different "people" read distinctly while staying on-style. Assign a
tone per cast member in the registry (§9) as they're created (e.g. cream `#f5ead6`, warm tan, deeper brown,
pale). Same outline + render on all.


## 5. The committed visual recipe

The Second Take is **locked** to one recipe:

> **Clean 2.5D vector cast + built (flat-but-real) environments + marker-style charts / diegetic
> lettering + one red accent.**

Unpacked:
- **Cast:** the locked hand-illustrated 2.5D rig (§1) — flat cel characters + money objects, on our own
  render stack. Never photoreal, never the uncanny middle (`universal.md §13`).
- **Charts / diegetic lettering:** hand-drawn **marker / sketch family** (deliberately crude,
  honest-looking — never corporate infographic), accreting diagrams + timelines, a recurring "your
  money" avatar. No title/chapter cards — a chapter turn is a hard cut / palette turn, never a card.
  **Lettering is LOCKED (2026-07-15, human-picked from a 6-candidate audition): relaxed hand-lettered
  MARKER CAPITALS with a slight lean and baseline bounce — quick confident handwriting, no letter
  joins, never calligraphy or a clean digital font — ink `#241a12`.** Canonical exemplar =
  `refs/env/lettering-marker-italic.png`; **every text-bearing generation seeds it** (it lives under
  `refs/env/` so it never triggers the §2c rig-hold). The bar is FAMILY match, not glyph identity —
  letterforms may wobble shot-to-shot like real handwriting; the review flags a different HAND (clean
  digital type, formal script, wrong weight class), not natural variation. Spelling stays strict
  (letter-by-letter, blocking). **STAMP register — the ONE exception to the marker family (LOCKED
  2026-07-15, human-picked):** all big **stamp-down marks** (FAKE / FICTION / SOLD and kin) render in
  the locked stamp register — **heavy block CAPITALS, dense saturated red `#d7402b` ink** (thick solid
  strokes, distress only at the edges), a **thin `#241a12` letter contour** hugging each glyph (a clean
  ink contour, NOT a drop shadow / offset ghost), **flat matte**, hand-stamped edge distress.
  **Every stamp / seal / mark cutout GEN seeds `refs/env/stamp-block-outlined.png` (the register
  exemplar) PLUS its destination plate** (for scale + palette); a stamp generated BEFORE the register
  lock, or with no exemplar seed, is a register FAIL and is re-generated + re-checked against the lock —
  a pre-lock/unseeded stamp does not silently pass (the L10 stamp shipped off-register because it
  predated the lock and nothing forced the re-check). Stamps are the ONLY exception; **ALL OTHER
  in-video text stays in the relaxed marker-italic register above.** **ALL
- **Diegetic art / artifacts:** an in-world painting, poster, brochure vista, or map-as-artifact renders
  in OUR flat-cel look with the `#241a12` outline — our style *depicting* an artifact, NOT a soft-gradient
  illustration or a different medium. A too-perfect glossy "brochure" is achieved with palette +
  composition, still flat-cel. (The frame is a frame; the art inside it is us.)

- **`refs/env/scene-style-tile.png` seeds every cast-free plate/scene gen** — it contributes **line
  register and palette saturation ONLY, never temperature, hues, content, layout, or the place it
  depicts**; a figure-bearing gen carries its own register in the cast seeds and does NOT take the tile.

## 9. Registry

`registry/registry.json` is the single live index of what exists — two collections: **`characters`** (each
with a canonical file + head tone + pinned costume) and **`assets`** (expressions, actions, props, plates —
each with a canonical file + seed frame). Cross-video channel-signature environments/plates AND the standing
**style-anchor register frames** are `assets` with `kind: environment` (`character: null`, no seed_frame;
there is no separate top-level environments list). The register anchors live in `refs/env/` — **three are
`refs/<character>/`, props/elements/plates under `refs/env/`). Reuse-before-regenerate keys off it, and
`visual-prompt-writer` reads it as the channel's asset vocabulary when planning shots. It grows every
video: `image-generation` registers each new verified channel-recurring asset back into it. **The
`refs/` copy is the canonical every later seed references;** a per-video `assets/library/` keeps its own
working copy.

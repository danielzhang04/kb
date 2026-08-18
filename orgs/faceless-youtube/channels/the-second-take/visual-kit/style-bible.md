# The Second Take — Style Bible (LOCKED)

**`image-generation`'s craft law — the LOOK:** identity, the shared rig, the locked descriptors, the rig value
set every generation is built to and every post-gen judge rules against, character colours, the committed
recipe. Generation PROCEDURE lives in the `image-generation` skill; depiction and staging in
`visual-grammar.md`; the asset index in `registry/registry.json`. **Every LOCKED value is human-approved** —
every reference frame was generated against it, so `image-generation` proposes changes, never self-applies.

## 1. Identity — one template, one rig, a cast

- **No on-screen narrator — a VOICE narrates, the SCREEN is a CAST.** Every character belongs to one visual
  FAMILY on a shared template; each story uses many distinct characters coming and going.
- **The base is a TEMPLATE, not a character.** `refs/base/base.png` — a bald cream-headed figure in a brown
  hoodie + trousers (its default costume, §4), bold dark warm-brown outline — is the ANCHOR every cast character
  seeds off for form, and **it never appears as ITSELF** (tier bullet below). **Default aspect
  ratios:** `2:3` character
  portraits/turnarounds · `1:1` props · `16:9` scenes.
- **A character CANONICAL RESTS.** Every cast canonical inherits the base template's RESTING expression and
  RESTING stance unchanged; the VARIES axes below (hair, facial hair, head tone, outfit, build, age/reaction
  linework) are the only things a canonical may differ in. Two-sided by construction — a baked emotion and a re-invented neutral are
  the SAME defect, because this resting face is the shape every later delta re-reads as "unchanged", so one
  cast member resting differently from another is drift in the channel's most-seeded frame. A machine-tier or
  non-humanoid canonical holds the law in SPIRIT: symmetric, static, neutral, nothing held.
- **The shared RIG — LOCKED, identical on every character**, which is what lets ONE reaction map onto ANY
  character: the round near-circle head (never an egg or oval), the head-to-body proportion, the facial layout
  (**NO nose**, **NO ears**, fixed feature MAP so reactions are portable), and the flat-cel **four-digit hand**
  — three fingers + a thumb, never five, six, or a mitten. Fail conditions: §3.
- **VARIES per character:** hair and hairstyle, facial hair, head tone, outfit, body build (proportions stay,
  mass changes), age/reaction linework — never enough to break the layout; costume always comes from the
  generation delta.
- **Figures are SEEDED or CROWD — by IDENTITY, per figure per shot.** SEEDED is named/recurring cast,
  seeded from its own canonical; §2c auto-appends the form. There is no third tier: an anonymous
  foreground story-bearer is CAST (an existing cast member, else a new one minted through the standard
  cast-generation waves) or the beat is staged as mass action. CROWD → the **§2d CROWD RIG** (simplified
  features — dot eyes + one mouth — because fine features drift into noses on tiny faces), reserved for
  genuine masses.
  Crowd is DECLARED per shot, never described in rig prose (`visual-grammar.md §2`); it is never a locked
  identity, while a recurring identifiable GROUP is cast. Tier routing law: `visual-grammar.md §2`.

## 2. LOCKED STYLE descriptor (verbatim — prepend to every generation)

> Keep this the SAME single character as the reference — INVARIANTS that never change: SAME perfectly bald
> ROUND head (a soft near-circle, only slightly taller than wide — NOT an egg or oval); the SAME flat head
> colour AS THE REFERENCE character (the base default is #f5ead6, but a named cast member keeps ITS OWN head tone — never forced to cream); SAME dark warm brown-black outline (#241a12); SAME simple cartoon eyes + thin brows,
> NO nose, NO ears; SAME simple hands — a classic cartoon hand with exactly THREE fingers plus ONE thumb (four digits total, like a Mickey Mouse / Simpsons hand), NEVER four fingers, NEVER five digits; SAME clean FLAT cel cartoon style, even medium-thick line.
> Reads unmistakably as the same guy. No text, plain soft light-grey studio background.

Names only the SHARED rig — **costume and head tone are NOT invariants** (the delta supplies the costume; head
tone follows the character's registry `head_tone`). The delta overrides it on exactly the variables it names.

## 2b. STYLE-ONLY descriptor (verbatim — for new characters & environments/props)

> Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even
> MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colours laid down at FULL
> cel strength — every fill a real colour, and any grey or neutral clearly TINTED WARM, so the frame
> never drains to greyscale; a genuinely cold scene cools its LIGHT, never its neutrals — with gentle
> soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.

For a **new character** the delta supplies only identity-VARYING traits (hair / facial hair, a flat head tone
(§4), build + outfit) and §2c holds the rig. For an **environment/prop**: describe the scene, palette free.

## 2c. RIG-HOLD descriptor (verbatim — auto-appended to every character-bearing generation)

> Every FOREGROUND / named / seeded cartoon figure in this image keeps the shared FAMILY RIG exactly as
> the reference(s): SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME
> eye style/size/position, NO nose, NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE
> thumb (four digits total, Mickey / Simpsons style, NEVER four fingers, NEVER five digits), SAME even
> medium-thick dark warm brown-black (#241a12) outline, SAME clean FLAT cel render. Anonymous background /
> crowd figures instead follow the §2d CROWD-RIG clause when
> the prompt states it (simplified: dot eyes, one simple mouth) — do NOT force this full rig onto them.
> Hold ONLY this form — costume, pose, expression, head tone, build, and framing are set by the
> generation delta, not here, except when THIS generation is itself a new-character canonical mint,
> where the resting expression and resting stance are invariants inherited from the base (§1).

It holds **form, not identity**, so it is safe on any seeded gen; `forge.py` auto-appends it on every
character-bearing seed (non-identity mode). The wording exempts crowds, so both rigs coexist in one frame.

## 2d. CROWD-RIG clause (verbatim template — `forge.py` expands it at gen time)

> The background / crowd figures are on the CROWD RIG: round heads in at most 2–3 repeating FLAT
> tones drawn from the channel's cast head-tone set (e.g. #f5ead6 / #e2b78c / #7a4f33) for the whole
> group — never one uniform cream, never a tone invented per individual figure — DOT EYES, one simple
> consistent mouth (neutral / smile / downturn only), NO noses, NO ears, NO teeth, the **EXACT same
> squat head-to-body proportion as the crowd exemplar seed** — a large round head on a short compact body, NOT
> taller/lanky — hands, where visible, are the same four-digit cartoon hand. The seed reference
> contributes ONLY this head/face/hand simplification, NEVER its own clothing: dress every crowd
> figure for THIS shot's own scene era and setting, not the seed's period dress, and vary hair/headwear
> across at most 2–3 repeating silhouettes for the whole group — never a distinct hairstyle or headwear
> invented per individual figure. Apply this identical simplified face — dot eyes, one simple mouth, no
> nose, no ears — to EVERY crowd figure individually and without exception in a multi-figure group; a
> single detailed or individuated face anywhere in the group is a rig FAIL.

The crowd rig differs from the full rig **ONLY in the FACE** — proportion is IDENTICAL to the crowd exemplar's (squat, ~2.7 head-heights face-only; poyais-era standard, ruling 2026-08-17), and
taller/lankier figures are the standing drift and a review axis (§3). **No prompt ever carries this
text:** the shot declares `figures.crowd: true` (`visual-grammar.md §2`) and `forge.py` appends the
clause at gen time. Every crowd-bearing gen seeds the crowd exemplar — **this video's own
`assets/library/crowd-exemplar.png` when it has minted one, and the channel's
`refs/base/crowd-exemplar.png` as the fallback** (the exemplar is minted per video, so it carries
that video's era dress, head-tone set and hair silhouettes). The seed already
carries the look, so re-describing it in the prompt buys nothing and bleeds crowd wording onto the
foreground figures.

## 3. The rig checklist — channel invariants (values only)

The **WHAT** every generation is built to and every post-gen judge rules against — ONE rule set, both ends.
Judge against the **approved canonical** (`refs/<char>/<char>-base.png`), never an idealized pure-circle rig.
**In doubt, set the asset beside the canonical — if it reads "same channel", it passes.**

- **Head** — round near-circle, only slightly taller than wide, not reshaped, same head-to-body proportion as
  the base. **Facial layout** — same eye style/size/position, brows and mouth in place. **No nose, no ears**; on
  a **haired** character hair/sideburns fill the ear gap, and both a bare earless hairless side gap and
  any ear-shaped hole or notch drawn INTO the hair are FAILs.
- **Hands — four digits** (three fingers + a thumb), never five, six, or a mitten. **Open / spread / raised
  hands are the drift point**, and a two-hand gesture requires **both hands the SAME size**.
- **Outline** — even medium-thick dark warm brown-black (`#241a12`), not pure black, not thin; this weight is the
  frame's FLOOR, not just the figure's (see `line-register`). **Render** — clean flat cel, even line weight, flat
  tones. **Head tone** — one uniform flat tone (no gradient, no realistic skin, no blush).
- **`line-register` — judged frame-wide, on EVERY generated frame:** every line in the image reads at the rig's
  outline weight or heavier. Any element drawn FINER than the rig outline, and any hairline or micro-pattern field
  (blind slats, lattices, grilles, railings, distant filigree, fine grain, repeated thin stripes), is a **FAIL** —
  the drift is a whole frame quietly rendering a register thinner than its own cast. Furniture, foliage and props
  read chunky and simplified; skin/head patches stay one flat uniform fill (airbrushed or gradient skin FAILs).
- **Count** — exactly the characters the scene declares.
- **Identity match vs canonical** — a seeded character's head tone AND hair must MATCH its canonical; a
  base-cream bald head on a haired/toned character is an **identity FAIL even when every form invariant
  passes**. **Costume** — the pinned canonical costume is identity; a wrong outfit fails unless authored.
- **Proportion — judged EXPLICITLY, every figure:** the **squat base proportion** (large round head, short
  compact body); too tall / lanky / long-bodied FAILS. **Rig by tier** — named/seeded cast judge against the
  **FULL** rig; crowd figures against the **CROWD** rig (§2d); detailed faces or noses on a crowd figure FAIL.
  Crowd also judges §2d's BOUNDED variety axes, so they are decided on the pixels and not merely
  written: **era-appropriate dress** (every crowd figure dressed for THIS shot's own scene era and
  setting, never the seed exemplar's period dress) and **at most 2–3 repeating hair/headwear
  silhouettes** and **at most 2–3 repeating FLAT head tones** drawn from the channel's cast
  head-tone set for the group. All three fail in either direction — a uniform group and a per-figure
  invention are the same defect, one axis apart.
- **Expression register-fit** — judged against the BEAT: a calm/ordinary/sincere/grim beat wants a restrained
  face, an **over-the-top expression for its beat is a defect**; big faces need a comedic peak.
- **In-image text is diegetic, baked, and verbatim** — only the text the shot authored, in the §5 marker hand,
  quoted verbatim in the `still_prompt`, 1–4 words; no unrequested words, labels, logos, or watermarks.
  Transcribed **letter-by-letter**; garbled, misspelled, or partial is **blocking**. Library CHARACTER frames
  stay text-free; a **seeded PROP with its own designed lettering** (a deed, a titled banknote) is whitelisted,
  still transcribed for spelling.
- **Never checked — these vary:** pose, camera framing, hair/facial hair, outfit, head-tone choice, body build,
  age linework, action squash/stretch. **Scoped to the NAMED-CAST comparison against its canonical** —
  these are the axes an identity check must never fail a frame on. It licenses nothing about a crowd
  GROUP, which carries §2d's own bounded dress, hair-silhouette and head-tone axes, judged above.

## 4. Palette

Character colors, outline, and semantic red stay locked; scene/background/prop palettes are free per scene within
the channel color family. Neutral-grey-only is not a palette.

| Role | Hex | Notes |
| --- | --- | --- |
| Head tone (default) | `#f5ead6` | cleaner warm cream — the template's face/head |
| Named-cast head tones | e.g. `#d9ac82` | warm tan (MacGregor), deeper brown, pale — one per cast member, pinned in the registry |
| Outline | `#241a12` | dark warm brown-black, even medium-thick, on everything |
| Base default costume | warm browns | the base template's brown hoodie + trousers (§1); the delta supplies costume for every other character |
| Accent (red) | `#d7402b` | **the one locked red** — the single source of truth for BOTH in-image red (a FICTION stamp, a semantic prohibition/alarm/ownership mark) AND the engine's emphasis ink. Pinned to `motion-tokens.json accent`; any red drawn in a gen uses this exact value |

## 5. The committed visual recipe (LOCKED — this is THE direction)

> **Clean 2.5D vector cast + built (flat-but-real) environments + marker-style charts / diegetic
> lettering + one red accent.**

- **Cast:** the locked 2.5D rig (§1) — flat cel characters + money objects, never photoreal, never the uncanny
  middle. Emotion reads in a legible mouth + brow, restrained by default; **posture is the acting**.
  **Personified institutions** carry ONE identity tag (a flag necktie, a hat, a uniform).
- **Environments:** *built* but flat — a real setting per scene, composed **edge-to-edge with a fore/mid/
  background depth read built from overlap and recession**, a **committed warm scene palette**, and **light/atmosphere**.
  **Rich, not sparse:** name the real furniture of the place; no dead air, no parallaxed realism.
  **Diegetic art / artifacts** (a painting, poster, brochure vista, map) render in OUR flat-cel look with
  the `#241a12` outline.
- **`refs/env/scene-style-tile.png` seeds every cast-free plate/scene gen** — it contributes **line
  register, palette saturation AND TEMPERATURE (the strength and warmth its flat colours are laid down
  at, which the new frame matches in its own hues) ONLY, never content, layout, or the place it
  depicts**; a figure-bearing gen carries its own register in the cast seeds and does NOT take the tile.
- **Charts / diegetic lettering:** a hand-drawn **marker / sketch family**, deliberately crude, never corporate
  infographic; no title cards (a chapter turn is a hard cut / palette turn). **Lettering is LOCKED: relaxed
  hand-lettered MARKER CAPITALS with a slight lean and baseline bounce — quick confident handwriting, no letter
  joins, never calligraphy or a clean digital font — ink `#241a12`**; `refs/env/lettering-marker-italic.png`
  seeds every text-bearing gen. FAMILY match, not glyph identity; spelling strict; copy SHORT — a truncated
  caption needs its OWN element (plaque, signboard, banner) with clear margin.
- **STAMP register — the ONE exception to the marker family (LOCKED):** big **stamp-down marks** (FAKE / FICTION
  / SOLD and kin) render in **heavy block CAPITALS, dense saturated red `#d7402b` ink** (thick solid strokes,
  edge-only distress), a **thin `#241a12` letter contour** hugging each glyph (not a drop shadow), **flat
  matte**; `refs/env/stamp-block-outlined.png` seeds every such gen — no exemplar seed is a register FAIL.

## 6. Registry — the live index of recurring cast & world

`registry/registry.json` is the live index of what exists: **`characters`** (canonical file + head tone + pinned
costume) and **`assets`** (expressions, actions, props, plates — canonical file + seed frame). **No cross-video
environment plate exists** — a video mints its own (a `plate: true` candidate batch, human-picked per place,
plus the 2-3 approved VARIANTS a place above the ~5-shot band declares — `visual-grammar.md §2`); the
standing **style-anchor register frames** locked in `refs/env/` are `assets` with `kind:
environment`, and hold only REGISTERS, never places: the lettering + stamp hands
(`lettering-marker-italic`, `stamp-block-outlined`) and the scene line/palette register
(`scene-style-tile`, §5 — a style anchor, not a reusable place).
Canonical frames live under `refs/` and **the `refs/` copy is what every later seed references**; a per-video
recurring prop lives only in that video's `assets/library/`. VPW reads this file as the channel's asset
vocabulary; `image-generation` registers each new verified recurring asset back.

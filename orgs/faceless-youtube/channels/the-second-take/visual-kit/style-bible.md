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
  seeds off for form, and **it never appears in videos**. **Default aspect ratios:** `2:3` character
  portraits/turnarounds · `1:1` props · `16:9` scenes.
- **The shared RIG — LOCKED, identical on every character**, which is what lets ONE reaction map onto ANY
  character: the round near-circle head (never an egg or oval), the head-to-body proportion, the facial layout
  (**NO nose**, **NO ears**, fixed feature MAP so reactions are portable), and the flat-cel **four-digit hand**
  — three fingers + a thumb, never five, six, or a mitten. Fail conditions: §3.
- **VARIES per character:** hair and hairstyle, facial hair, head tone, outfit, body build (proportions stay,
  mass changes), age/reaction linework — never enough to break the layout; costume always comes from the
  generation delta.
- **Three tiers of figure — by SIZE + RECURRENCE, per figure per shot:** named/recurring foreground → seeded
  from its canonical, §2c auto-appends the form · anonymous LARGE/foreground → the **§2e** clause
  (full rig, generic outfit + hair, no seed) · anonymous small/many/background → the **§2d CROWD RIG**
  (simplified features — dot eyes + one mouth — because fine features drift into noses on tiny faces). Both
  anonymous tiers are DECLARED per shot, never described in rig prose (`visual-grammar.md §2`). A crowd
  is never a locked identity; a recurring identifiable GROUP is cast.

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
> MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, simple flat colours with gentle
> soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.

For a **new character** the delta supplies only identity-VARYING traits (hair / facial hair, a flat head tone
(§4), build + outfit) and §2c holds the rig. For an **environment/prop**: describe the scene, palette free.

## 2c. RIG-HOLD descriptor (verbatim — auto-appended to every character-bearing generation)

> Every FOREGROUND / named / seeded cartoon figure in this image keeps the shared FAMILY RIG exactly as
> the reference(s): SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME
> eye style/size/position, NO nose, NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE
> thumb (four digits total, Mickey / Simpsons style, NEVER four fingers, NEVER five digits), SAME even
> medium-thick dark warm brown-black (#241a12) outline, SAME clean FLAT cel render. Anonymous background /
> crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it (simplified: dot eyes,
> one simple mouth) — do NOT force this full rig onto them. Hold ONLY this form — costume, pose,
> expression, head tone, build, and framing are set by the generation delta, not here.

It holds **form, not identity**, so it is safe on any seeded gen; `forge.py` auto-appends it on every
character-bearing seed (non-identity mode). The wording exempts crowds, so both rigs coexist in one frame.
A registry character flagged `no_hands` (a personified object whose canonical deliberately has no hand rig
at all) is exempt from this auto-append too — the clause would otherwise instruct hands onto a character
built to have none.

## 2d. CROWD-RIG clause (verbatim template — `forge.py` expands it at gen time)

> The background / crowd figures are on the CROWD RIG: round cream-family heads, DOT EYES, one simple
> consistent mouth (neutral / smile / downturn only), NO noses, NO ears, NO teeth, the **EXACT same
> squat head-to-body proportion as the base rig** — a large round head on a short compact body, NOT
> taller/lanky — in varied era-appropriate clothing. Keep every crowd figure on this same simplified rig —
> do not give them individual detailed faces.

The crowd rig differs from the full rig **ONLY in the FACE** — proportion is IDENTICAL to the base rig, and
taller/lankier figures are the standing drift and a review axis (§3). **No prompt ever carries this
text:** the shot declares `figures.crowd: true` (`visual-grammar.md §2`) and `forge.py` appends the
clause at gen time. `refs/base/crowd-exemplar.png` seeds every crowd-bearing gen — the seed already
carries the look, so re-describing it in the prompt buys nothing and bleeds crowd wording onto the
foreground figures.

## 2e. BASE-RIG clause (verbatim template — `forge.py` expands it at gen time)

> This prominent foreground figure is an anonymous, non-recurring person drawn on the FULL base family
> rig — SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME eye
> style/size/position, NO nose, NO ears, SAME classic cartoon hands (exactly THREE fingers plus ONE thumb,
> four digits total, never five), SAME even medium-thick dark warm brown-black (#241a12) outline, SAME
> clean FLAT cel render — the identical rig the named cast holds, just NOT a specific identity. Give each
> figure its own distinct, era-appropriate outfit and hair so it reads as an individual; hold ONLY this
> form.

A large / foreground anonymous figure needs the FULL rig but has no canonical to seed, so §2c's
auto-append never fires and §2d is too simplified. Like §2d, **no prompt carries this text** — the shot
lists each such figure in `figures.anon_foreground` (`visual-grammar.md §2`) and `forge.py` expands it:

- **Everything from `FULL base family rig` onward is the LAW and is kept verbatim.** That phrase is the
  split anchor (and lint's rig-clause fingerprint); forge writes the opening itself, naming the shot's
  declared figures, and appends its own binding sentence confining the clause to them — so keep the tail
  number-NEUTRAL ("each figure … it reads"), because one clause serves one figure or four.
- **Delta mode (`stage_role: "delta"`) gets HELD wording instead, never this establishment wording** — "the
  anonymous figure(s) … are unchanged, exactly as established", and none of the tail. Re-issuing
  give-each-a-distinct-outfit on a delta tells the engine to redesign the very figure the chain exists to
  hold; it is a first-establishment instruction only.

## 3. The rig checklist — channel invariants (values only)

The **WHAT** every generation is built to and every post-gen judge rules against — ONE rule set, both ends.
Judge against the **approved canonical** (`refs/<char>/<char>-base.png`), never an idealized pure-circle rig.
**In doubt, set the asset beside the canonical — if it reads "same channel", it passes; a FLAGGED shape
call (nose, ear, digit count) is admissible only as a PAIRED crop against the canonical in the same
normalized zone, never an isolated zoom** — an isolated crop is what let a real ear pass as "hair with
strand texture" once, and only a paired crop against another character's hair exposed it.

- **Head** — round near-circle, only slightly taller than wide, not reshaped, same head-to-body proportion as
  the base. **Facial layout** — same eye style/size/position, brows and mouth in place. **No nose, no ears**; on
  a **haired** character hair/sideburns fill the ear gap, and a bare earless hairless side gap is a FAIL.
- **Hands — four digits** (three fingers + a thumb), never five, six, or a mitten. **Open / spread / raised
  hands are the drift point**, and a two-hand gesture requires **both hands the SAME size**.
- **Outline** — even medium-thick dark warm brown-black (`#241a12`), not pure black, not thin. **Render** —
  clean flat cel, even line weight, flat tones. **Head tone** — one uniform flat tone, no gradient, no realistic
  skin. **Count** — exactly the characters the scene declares.
- **Identity match vs canonical** — a seeded character's head tone AND hair must MATCH its canonical; a
  base-cream bald head on a haired/toned character is an **identity FAIL even when every form invariant
  passes**. **Costume** — the pinned canonical costume is identity; a wrong outfit fails unless authored.
- **Proportion — judged EXPLICITLY, every figure, every tier:** the **squat base proportion** (large round head,
  short compact body); too tall / lanky / long-bodied FAILS, seeded or anonymous. **Rig by tier** — named/seeded
  foreground and anonymous LARGE/foreground (§2e) figures judge against the **FULL** rig, crowd/background
  figures against the **CROWD** rig (§2d); detailed faces or noses on a crowd figure FAIL, as does a foreground
  figure on the crowd rig.
- **Expression register-fit** — judged against the BEAT: a calm/ordinary/sincere/grim beat wants a restrained
  face, an **over-the-top expression for its beat is a defect**; big faces need a comedic peak.
- **In-image text is diegetic, baked, and verbatim** — only the text the shot authored, in the §5 marker hand,
  quoted verbatim in the `still_prompt`, 1–4 words; no unrequested words, labels, logos, or watermarks.
  Transcribed **letter-by-letter**; garbled, misspelled, or partial is **blocking**. Library CHARACTER frames
  stay text-free; a **seeded PROP with its own designed lettering** (a deed, a titled banknote) is whitelisted,
  still transcribed for spelling.
- **Never checked — these vary:** pose, camera framing, hair/facial hair, outfit, head-tone choice, body build,
  age linework, action squash/stretch.

## 4. Palette

**Locked to the character; NOT globally** — scene/background/prop palettes move freely per video; each recurring
character gets one flat head tone, pinned in the registry (§6).

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
  background depth read**, a **committed warm scene palette**, and **light/atmosphere**. **Rich, not sparse:**
  name the real furniture of the place; no dead air, no parallaxed realism. **Diegetic art / artifacts** (a
  painting, poster, brochure vista, map) render in OUR flat-cel look with the `#241a12` outline.
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
- **Colour:** the locked 2–3 colour palette **+ one red accent** (character colours fixed in §4).

## 6. Registry — the live index of recurring cast & world

`registry/registry.json` is the live index of what exists: **`characters`** (canonical file + head tone + pinned
costume) and **`assets`** (expressions, actions, props, plates — canonical file + seed frame). Cross-video
signature environments/plates and the standing **style-anchor register frames** are `assets` with `kind:
environment`; three are locked in `refs/env/` (`env-exterior-vivid`, `env-exterior-muted`, `env-map-parchment`).
Canonical frames live under `refs/` and **the `refs/` copy is what every later seed references**; a per-video
recurring prop lives only in that video's `assets/library/`. VPW reads this file as the channel's asset
vocabulary; `image-generation` registers each new verified recurring asset back.

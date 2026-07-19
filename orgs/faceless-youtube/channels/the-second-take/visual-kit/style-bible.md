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

**The CROWD RIG — anonymous background / crowd figures (a SIMPLER tier, not the full rig).** An
*anonymous* crowd (an audience, a mob, settlers on a dock — different non-recurring people, no shared
identity to lock) is **PROMPTED on a simplified rig, never seeded.** It holds the shared FORM — round
head, same head-to-body proportion, **no nose, no ears, no teeth** — but with **simplified features: DOT
EYES + one simple consistent mouth** (basic emotion only: neutral / smile / downturn), identical on every
crowd figure. The full detailed rig's fine features are exactly what drift into noses on many tiny faces;
the crowd rig is easier for the engine to hold at scale. A *named / foreground* character standing in the
same shot is NOT on the crowd rig — it keeps its full rig via its own seed. Crowds are never a Pass-1
lock (an anonymous crowd is different faces each time — a composition, not a recurring identity). *(A
recurring identifiable GROUP — a specific named band/troupe that reappears — is the opposite: it IS cast
and locked; see §7.)*

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

This block holds **form, not identity** (it never says "the same person"), so it is safe on any generation
with a SEEDED / foreground figure — a seeded existing character (identity carried by the seed image), a new
character (identity set by the delta), or a held-set chain delta. It governs only figures its auto-append
reaches (a character-bearing seed): a background crowd follows **§2d**, and an **UNSEEDED anonymous
foreground figure follows §2e** (authored into the prompt, because auto-append needs a seed). A crowd
scene that also seeds a named figure still gets §2c auto-appended for THAT figure, and the §2c wording
above explicitly exempts the crowd so the rigs coexist in one frame. `image-generation` (`forge.py`) **auto-appends it** whenever a
seed is character-bearing (a `refs/<char>/`, `assets/library/`, or `assets/scenes/` seed) on a non-identity
mode; identity-mode gens already carry the full rig via §2, so it is not re-appended there. The rig VALUES
live once in §3 (the checklist) and §1 (the law) — this is their prompt-side voice, not a third definition.

## 2d. CROWD-RIG clause (verbatim — write INTO a crowd scene's prompt)

> The background / crowd figures are on the CROWD RIG: round cream-family heads, DOT EYES, one simple
> consistent mouth (neutral / smile / downturn only), NO noses, NO ears, NO teeth, the **EXACT same
> squat head-to-body proportion as the base rig** — a large round head on a short compact body, NOT
> taller/lanky — in varied era-appropriate clothing. Keep every crowd figure on this same simplified rig —
> do not give them individual detailed faces.

**The crowd rig differs from the full rig ONLY in the FACE** (dot eyes + one simple mouth vs the full
detailed features) — **head-to-body proportion is IDENTICAL to the base rig** (human-confirmed 2026-07-16:
"the crowd rig should be the exact same proportions as our base rig — the face is different, of course").
So proportion is a stated FACT in every crowd/base-rig delta (the words above carry it), and anonymous
figures rendering **taller/lankier than the base rig** are the proven drift (they carry no seed to pin
proportion) — a first-class review axis, §3.

This clause governs the **anonymous** figures only. Unlike §2c (which `forge.py` auto-appends to every
character-bearing gen), **§2d is authored by VPW into the `still_prompt`** of any shot with an anonymous
crowd (the prompt the engine sees must carry these words) — it is not auto-appended, because most shots
have no crowd. A foreground named character in the same shot still holds its FULL rig via its seed + the
auto-appended §2c; §2d simplifies only the anonymous background.

**Crowd exemplar — the crowd's rig ANCHOR (human-gated 2026-07-16).** `refs/base/crowd-exemplar.png` —
a human-approved crowd sample frame (5–6 anonymous figures on the EXACT squat base-rig proportion, dot
eyes, one simple mouth, no noses/ears/teeth, varied era-appropriate dress) — is **SEEDED into EVERY
crowd-bearing generation** as the crowd's proportion/face anchor. The §2d words above stay in the
`still_prompt` (they carry the rig FACTS), but the **exemplar seed is what actually pins** proportion +
face: a crowd carries no per-figure canonical, and prompt words alone let anonymous figures drift
taller/lankier (the proven failure). This **supersedes** the earlier "author the §2d words, no seed"
handling — a crowd is now prompt-authored (§2d) AND exemplar-seeded. It mechanizes Daniel's directive:
don't generate figures that aren't based on the asset base rig, for the one tier that can't seed
per-figure.

## 2e. BASE-RIG clause (verbatim — write INTO the prompt for an anonymous FOREGROUND figure)

> This prominent foreground figure is an anonymous, non-recurring person drawn on the FULL base family
> rig — SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME eye
> style/size/position, NO nose, NO ears, SAME classic cartoon hands (exactly THREE fingers plus ONE thumb,
> four digits total, never five), SAME even medium-thick dark warm brown-black (#241a12) outline, SAME
> clean FLAT cel render — the identical rig the named cast holds, just NOT a specific person. Give them a
> distinct, era-appropriate outfit and hair so they read as an individual; hold ONLY the rig form.

This clause closes the gap between §2c and §2d. A **large / foreground anonymous figure** (a lone settler
who IS the shot, a cobbler, a sales clerk, a single accusing survivor) needs the FULL rig but has **no
canonical to seed** — so §2c's auto-append never fires for it (`forge.py should_hold` requires a
character-bearing seed), and the §2d crowd rig is too simplified for a prominent figure. Like §2d, **§2e
is AUTHORED by VPW into the `still_prompt`** (not auto-appended — there is no seed to trigger it). **The
three-tier rig model — choose by SIZE + RECURRENCE, per figure per shot:**
- **Named / recurring foreground** → seeded from its canonical; §2c auto-appends the form.
- **Anonymous LARGE / foreground** → the **§2e** clause (full rig, authored into the prompt, a generic
  fitting outfit + hair, no seed, no canonical needed).
- **Anonymous small / many / background** → the **§2d** crowd rig (simplified).

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
  require **both hands the SAME size** on a two-hand gesture. **Rig review runs on deterministic crops,
  not full-frame eyeballing (2026-07-16):** a **localizer** agent returns per-figure face + hand bounding
  boxes → **`scripts/crop_battery.py`** (PIL) cuts them at 3–4× → a **SEPARATE fresh judge** agent rules
  PASS/FAIL per crop with the **crop file path cited as evidence** on every ruling. Prose zoom claims
  ("zoomed 3–4×, verified") are **inadmissible** — a hand ruling with no crop artifact does not count. A
  judge-on-crop still misreads a cartoon hand sometimes, so a hand PASS is **not a certification**: the
  **human artifact board is the final finger authority** (§10), now ruling on the embedded crop sheets at
  seconds per shot.
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
- **Proportion — judged EXPLICITLY, every figure, every tier.** Head-to-body ratio must match the tier's
  rig: the **squat base proportion** (a large round head on a short compact body), NOT a
  realistically-proportioned adult. A figure that renders **too tall / lanky / long-bodied is a
  drift-from-rig FAIL** — this holds for named/seeded figures AND for anonymous §2d/§2e figures, which
  have no seed pinning their proportion (an off-proportion anonymous figure has slipped review before —
  rule on it). Judge proportion alongside head shape, not as an afterthought.
- **Rig judged by tier (§2c/§2e vs §2d).** A **named/seeded** foreground figure and an **anonymous
  LARGE/foreground** figure (the §2e clause) are both judged against the **FULL** rig above (round head,
  no nose/ears, four digits, base proportion). An **anonymous crowd / small / background** figure is judged
  against the **CROWD** rig (§2d): round heads, dot eyes, one simple mouth, no noses/ears/teeth, consistent
  proportion across all crowd figures. A crowd figure with individual detailed faces or noses is a FAIL; a
  prominent foreground figure rendered on the *simplified* crowd rig (when it should be the full §2e/§2c
  rig) is also a FAIL.
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

## 5. Seed rules (identity vs. style — the reproducibility mechanic)

- **A scene generates in ONE run — multi-seeded, no posed-character pre-build.** A character's IDENTITY is
  its stored **canonical frame** (its `base` in the registry); its POSE and EXPRESSION are **not described in
  words** — they are SEEDED from the channel's library (§7) straight into the scene gen. Seeds, in order:
  **each cast figure's character canonical + its `expression_ref` frame + its `pose_ref` frame** (+ the
  **interaction template** when two figures interact), then any needed **style anchor / plate**, prompt last.
  Seeding the pose frame is what carries the correct 4-digit library hand — re-synthesizing a pose from words
  reverts to the engine's 5-finger prior. `pose_ref`/`expression_ref` are each optional (pose-only / expr-only
  / both / neither = the plain canonical); VPW selects them from the registry (it authors INTENT). Outfit and
  action remain delta variables the gen may name; **pose and expression do not** — they are seeded. Never seed
  a character variant off a downstream derivative: **trace back to the exact frame the human approved**, every
  time. A prior session's "improved" version of a locked design can have silently drifted (an added hairline, a
  shifted tone), and seeding off it propagates that drift as if it were the lock — look at the real approved
  image before you seed. **Except** within a **seeded delta-chain** (a held stage's ≤3 delta frames seed off
  the prior frame; that scoped exception lives in the `image-generation` skill's technique menu, and a new
  chain or stage re-seeds canonical — **except a re-base that stays in the SAME location, which seeds the prior
  stage's base frame so the place survives the hop, §8**).
- **Multi-seed staging is proven — no 1-to-1 seed ceiling.** A 6-probe capability test (2026-07-15) held
  identity, costume, and pose from `[canonical + pose + expression + scene prompt]` in a single run (P1),
  survived elaborate regalia (P2, mosquito-king), and held BOTH identities distinctly from
  `[handshake template + canonical A + canonical B]` in one pot (P3). This **supersedes** the retired merge
  tier's "at most one base-derived seed per step / never `[template + A + B]` in a single pot / the base wins
  2-against-1" staging law. **Caveat that survives:** expression is the measured SOFTEST seed (P1's "thinking"
  landed weak) → the batched review explicitly checks expression-register per beat; and the probe is an
  existence proof (N=1 per case), so the first real video run under this doctrine is watched accordingly.
- **Seed cap — ≤4 per gen (the ceiling on the no-1-to-1 rule above).** A single generation carries at
  most FOUR seeds: the character canonical + ONE pose primitive + ONE expression frame + one
  anchor/exemplar (a style anchor OR the crowd exemplar, only when the shot needs it). **Beyond 4,
  dilution weakens every prior** — each extra seed pulls the result toward its own content, and a
  `base.png` thrown in as an Nth "rig anchor" pins nothing (measured 2026-07-16: rework gens carrying 4–5
  seeds — env + two scene frames + base — lost identity). A figure that genuinely needs the base rig gets
  `base.png` as ONE of the ≤4 with the prompt authored around it, never as a diluting extra.
- **A rig FIX never seeds the defective frame — regen FRESH from canonicals.** A "way off rig" /
  multi-defect frame is regenerated fresh from its canonicals with a re-authored prompt; an
  identity/de-nose/de-ear pass seeded off the defective frame is **banned as a rig fix** — the defect
  lives in the strongest seed and rides it back ~50% of the time (the documented sticky-ear rate). The
  ONLY defective-seed exceptions are (a) an **authored delta-chain parent** (a held stage seeds its prior
  frame by design, §8) and (b) a **human-ordered framing hold** (the human explicitly kept a
  composition); BOTH require a **before/after crop diff on EVERY figure** in the frame — the regression
  gate, not just the targeted figure.
- **Library primitives carry the base NEUTRAL face (never a baked expression).** Every pose / angle / grip /
  interaction asset in the library is generated seeded off `base` and holds `base`'s neutral face — expression
  is a *separate* seed layer applied per scene via `expression_ref`. A pose that bakes its own expression
  can't compose against a per-scene expression seed, so a baked / non-neutral face is a build reject →
  regenerate seeded from `base`. (One accepted exception: a pose whose own hand occludes the face, e.g. `facepalm`.)
- **An EXPOSED articulated hand MUST come from a seeded pose primitive — never free-drawn.** A salute,
  wave, open palm, or raised/pointing hand is the 5-finger drift point (hands at the sides inherit the
  base's correct 4-digit count; an open hand does not — human-caught twice in one day). Seed the matching
  `refs/base/` pose frame (e.g. `action-salute.png`) so the hand GEOMETRY comes from the library, AND
  state the digit FACT in the delta ("a hand with exactly three fingers and a thumb, four digits"). If no
  library pose covers the gesture, generate that pose on `base` first (§7 / VPW `needed_assets`, human
  gate) — never author an open hand ad-hoc inside a scene.
- **Attribute provenance — the seed-routing law.** Base-derived seeds (`pose_ref`/`expression_ref` frames and
  interaction templates) are **bald, cream (`base` tone), neutral-faced, hoodie**. So in a scene gen, **any
  character attribute not explicitly sourced from the CHARACTER seed bleeds a base trait** (cream tone, bald
  head, blank face, base costume). Route every attribute by source, never by hope:
  - **From the CHARACTER seed** (all identity/surface attributes): identity, **head/skin tone**, **hair +
    facial hair / sideburns**, **costume**, and the character's **face**.
  - **From the POSE / interaction-template seed** (geometry only): body pose, hands, and — for an interaction —
    the clasp/contact geometry, figure placement, and eye-line.
  - **From the EXPRESSION seed** (shape only): the eye / brow / mouth **shape** — never its tone, head, hairline,
    or identity.
  Every skin patch, INCLUDING BOTH HANDS, renders in the **CHARACTER's** head tone. This one law **replaces**
  the earlier piecemeal clauses (separate hand-tone rule, keep-hair clause, don't-blank note) — each was just
  one instance of it.
- **Brand-new character:** seed off the template `base` for line + render + proportions only; give a new
  head tone (§4) and identity; register it (§9).
- **Environment / prop (style only) — always carries a style-anchor seed.** `forge.py` **hard-errors** an
  environment/style gen with zero seeds (an unseeded gen falls back to a stock-clipart prior, off the locked
  style). Seed a **style anchor** in preference order: **the target plate or prior-frame-in-chain > a
  `refs/env/` anchor matched by REGISTER (vivid exterior / muted exterior / parchment map-document) > an
  approved on-style scene** — that seed carries the line weight + flat cel look; describe the scene, palette is
  free. (This is for a *one-off* asset, a per-video scene environment composed in-shot in Pass 2, or a
  deliberately-registered channel-signature element — a single video's scene environments are composed
  in-shot, never pre-baked as plates.)
- **Maps — CROP the existing map canonical, never regen a new map for a new region.** To show a different
  region of an already-established 2D map (the same map zoomed to South America, Europe, one country), do
  it **deterministically with PIL — crop/zoom the existing map canonical**, never a fresh gen. A regen
  invents a new coastline, palette, and lettering hand, so two "same" maps read as two different maps
  (the reason recurring figures reuse ONE cutout, §8 — a map is the same lock). **Regen is the FALLBACK
  only when the canonical genuinely doesn't cover the region**, and then it seeds the **map canonical +
  the parchment-map register anchor** (`refs/env/env-map-parchment`) so the new region inherits the
  established map's style. Country borders / routes / region reveals drawn ONTO the cropped map are MOTION
  layers, not baked (motion-planner) — the crop is the plate.
- **Composed scene — ALWAYS carries a style anchor too (not just character-free gens).** Multi-seed each
  cast figure's **canonical + `expression_ref` + `pose_ref`** frames, **PLUS a style anchor**, in ONE gen
  (+ the prior frame for a stage delta); the **environment + props are composed in the gen from the shot's
  facts, NOT seeded from a pre-baked plate** — a plate generated in isolation commits its lighting,
  perspective, and negative space blind to the figures, so it fights the composite. The delta realizes the
  `still_prompt`'s authored framing/placement (VPW owns composition — `visual-grammar.md §2`), NOT the
  pose/expression (those are in the seeds); see §8 scene assembly. **The style anchor is mandatory on
  EVERY scene/plate gen, not optional — the character seeds pin identity, NOT art style.** Pick it in the
  same preference order as the ENV rule above: **the shot's continuity parent frame (a prior frame in this
  stage/set, or the plate this scene evolves) > a `refs/env/` anchor matched by REGISTER (vivid / muted
  exterior / parchment map) > an approved on-style scene**. **Cross-chunk ART-STYLE drift is the proven
  failure mode when scene gens run unanchored** (a run of scenes each seeded on its cast but no style
  anchor drifted to different renders chunk-to-chunk — a softer/detailed-middle look, mismatched line
  weight; human-caught across a batch, 2026-07-16); the anchor is what holds one flat-cel look across the
  whole video.
- **Match-prop — a prop shown in more than one shot seeds its FIRST APPROVED frame as the prop canonical.**
  When a specific designed object must look identical across shots (a banknote/bond design, a guidebook, a
  named deed), the frame where it was first approved IS its canonical — every later shot showing it seeds
  that exact frame, never re-describes the design in words (a re-worded design drifts). This is the §7
  recurring-prop lock even when the prop was not pre-locked in Pass 1: the moment a design is approved in
  one shot, it becomes the seed for every later appearance (e.g. a bond design established in one shot
  seeds all three bonds in a later shot). Trace to the approved frame, not a downstream derivative (§5
  never-seed-a-derivative).
- **Reuse:** exact registry hit → return the file, no generation.

## 6. The committed visual recipe (LOCKED — this is THE direction)

The Second Take is **locked** to one recipe:

> **Clean 2.5D vector cast + built (flat-but-real) environments + marker-style charts / diegetic
> lettering + one red accent.**

Unpacked:
- **Cast:** the locked hand-illustrated 2.5D rig (§1) — flat cel characters + money objects, on our own
  render stack. Never photoreal, never the uncanny middle (`universal.md §13`).
- **Environments:** *built* but flat — a real setting per scene (boardroom, street, dock), composed
  **edge-to-edge with a fore/mid/background depth read**, a **committed warm scene palette**, and
  **light/atmosphere** (dawn, spotlight, glow). **Rich, not sparse:** name the real furniture of the place
  (colonnades, boulevards, ship rigging, stacked trunks), not one lone prop on empty air — *no dead air*.
  Still flat-cel: no detailed/parallaxed realism, not void-only. The bar is the **"gold" Poyais scenes**
  (the golden St Joseph vista, the harbour-crowd hook): dense, deep, warm-palette, filled frame.
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
  in-image lettering is authored diegetic and BAKED into the generated image** (a FICTION stamp, a label on
  an artifact, a hand-lettered chart) in this hand-rendered marker hand — there is now ONE type look. The
  engine's clean **Ink Free** type and the T2 device cards / counters / captions are **retired** (code
  producers removed, engine components parked dormant); no render-time text layer draws words, so any words
  on screen live in the still. Keep authored copy short (§3) — the marker hand garbles long strings. **A
  caption / label that renders TRUNCATED or crammed mid-word got too little canvas** — do not squeeze it
  into a scene edge; re-author the text as its OWN distinct architectural element (a wall plaque,
  signboard, or banner) sized with clear margin after the final glyph (a wide brass caption plaque
  cleared "Capt. Thomas Strangeways" first try after an edge-crammed version truncated to "Strangev").
- **Diegetic art / artifacts:** an in-world painting, poster, brochure vista, or map-as-artifact renders
  in OUR flat-cel look with the `#241a12` outline — our style *depicting* an artifact, NOT a soft-gradient
  illustration or a different medium. A too-perfect glossy "brochure" is achieved with palette +
  composition, still flat-cel. (The frame is a frame; the art inside it is us.)
- **Colour:** locked 2–3 colour palette **+ one red accent** (character colours fixed in §4; scene/prop
  palettes move freely per video to palette-code tone).

The recipe blends the reference channels' strengths (Crayon/HeyHistorically's built worlds + the
marker-honest chart look) onto our locked cast. It is a monetization prerequisite (a locked signature); the
moat is the editorial voice, so the recipe is stable and the *payload* varies.

**Why this recipe fits our rig (execution notes):**
- The **no-nose round head carries a tiny, mouth-led expression vocabulary** — read the emotion in a
  LEGIBLE mouth + brow, restrained by default. Reserve a big/extreme mouth for a genuine comedic PEAK; an
  ordinary, sincere, or grim beat gets a calm, plain expression, not a caricature. (A caricature face on
  an ordinary beat is the "everyone mugging" defect — it flattens the register the story is dialing.)
- The cast has **simple hands**, so **posture/lean/recoil is the acting** (body language carries emotion,
  not finger articulation).
- **No true squash-and-stretch needed** — decisive pose KEYS + hard cuts + FX overlays suffice (action
  poses *may* exaggerate proportions per §3, but it isn't required for dynamism).
- **Personified institutions** map cleanly onto the audio-insider narrator + a cast of personified players
  (the con-man, the mark, the Fed, a bank, a nation) — an institution is a cast member with ONE identity
  tag (a flag necktie, a hat, a uniform) or an iconic building, reused consistently.

## 7. Asset library — build spec + build order

What the channel's **STANDING, cross-video kit** consists of — built deliberately over time, not per-video.
(A single video's *one-off* scene environments/props are composed in-shot at generation time —
`image-generation` Pass 2 / §8 step 1 — never pre-baked as plates; per-video Pass 1 locks that video's
recurring individual characters, any recurring identifiable GROUP (locked once as a group-character), AND
any **recurring identifiable PROP** — a specific object whose look must match across shots (a guidebook, a
named banknote), locked once as `assets/library/prop-<name>.png` and seeded into each appearance, no
pose/expression.) **This is the build spec (what to build and why); the live index of what actually exists is
`registry/registry.json` (§9)** — downstream skills read the registry, never this prose. Iconic silhouette
shapes, not realistic detail; each asset is registered via `image-generation`.

The expression set (item 1) and action-pose set (item 6) are the **direct scene-seed source** (§5): a
shot's `pose_ref`/`expression_ref` names one of these, and `image-generation` seeds it — alongside the
character canonical — straight into the scene gen (no posed-character pre-build). That is their function —
not just an authoring vocabulary. A pose/expression a video needs but the library lacks is generated on the
base first (VPW surfaces it via `needed_assets`, human gate), never re-drawn ad-hoc inside a scene.

1. **Moderate-register expression set** (the lead of a beat). Small, mouth-led, **restrained by default —
   legible, not a caricature**: held deadpan/unimpressed (the dry default), a measured shock (open mouth,
   not a wide trapezoid), a warm smile (not crescent-eyed mania), mild irritation, worried knit-brow, smug
   asymmetric brow. The big/extreme end (wide-mouth laughing, full shock) exists for a genuine comedic
   PEAK, reached for deliberately — NOT the baseline. Since the scene gen seeds each frame's eye/brow/mouth
   SHAPE directly, the FRAMES themselves are authored moderate (an extreme frame → an extreme face on every
   beat that uses it); expression is also the softest seed, so a frame that reads flat on its own will land
   flat in the scene. Secondary characters get **one held expression**; cheap
   graphic-symbol overlays (heart, sparkle, exclamation, zigzag, blush, stat glyph) add warmth/intensity at
   near-zero cost.
2. **Finance concept-prop library** (highest-leverage build — literalizes the payloads): cracked anchor
   (leaving a standard), price-tagged barrel (priced-in), cash mountain (surplus/glut), printing press,
   gold-bar pyramid (reserve), house of cards, sinking boat, inflating balloon, leaking bucket, domino
   line. A prop-only shot can *be* the beat.
3. **Diegetic screen / artifact devices (baked, not engine-drawn):** a split-screen A/B frame, a fake-UI
   screen (dashboard/chat/search/CRT-TV/radio/newspaper front page), a "this didn't happen" no-symbol
   overlay — all rendered as BAKED diegetic scene elements. Used **flavor only, sparingly** — a
   money-*story* channel, never a lecture (staging law: `visual-grammar.md`). **The engine device cards
   (definition / meter-gauge / stat-callout / chapter / escalating counter) are retired** along with all
   engine-drawn text; any such payload is now a baked diegetic element or a delta-chain, never a render-time
   card.
4. **Reusable environment plates:** a power/institution interior (boardroom/office), a street/exterior, an
   interior room, a data-void — each with day/night palette variants, built from flat gradient + minimal
   geometry + one foreground depth prop. Skip realistic detail/parallax.
5. **Secondary / personified-institution cast:** banker, customer/mark, 2–3 institution avatars (the Fed,
   a bank, a nation) differentiated by flat head-tone + one identity tag. Each on the shared rig.
6. **Pose / angle / grip / interaction library** (base figure re-posed; all seeded off `base` with the
   **NEUTRAL base face** — expression is a separate seed layer, §5) — expanded 2026-07-10:
   - **Poses:** sit (chair-less — seat implied), facepalm, surrender, whisper-aside, kneel-beg, point-at-thing,
     plus the earlier set (power stance, slump, shrug, salute, thumbs up/down, accuse, head-in-hands, offering,
     present, arms-crossed, celebrate). Idle micro-motion (blink + tiny bob) is the render engine's job.
   - **Angle / movement:** back-to-viewer, 3q-turn-right, walk-left / walk-right (directional). A *strong
     static* 3/4 resists the front seed — the turn lands only when the figure has a reason to turn (walking);
     true profile deferred.
   - **Grips (object-agnostic — store the GRIP, the object is a per-scene delta rendered as a generic grey
     placeholder):** hold-one-hand, hold-both-hands, hold-paper-by-sides, carry-by-handle, sign-with-pen,
     reach-to-take.
   - **Interaction templates (two blank base mannequins; a scene seeds the template + two character canonicals
     and binds identities by `cast` order — first = left, second = right — in ONE scene gen, §5):** handshake
     (right-to-right clasp), handoff, fistbump. The template carries the clasp geometry + eye-line, so a scene
     inherits both by seeding it — do not re-specify them in words. **Eye-line is PUPILS-only:** heads stay
     front-facing and round; NEVER turn a head toward the other figure to force the gaze — a profile head-turn
     grows a nose/jaw and breaks the no-nose rig (the eyes cut sideways, the head does not; same profile limit
     as the 3/4-turn note above). **Contact interactions only** — a no-contact two-person shot composes
     single-figure poses at scene time, no template.

**Build order (front-loads the most-reused):** expressions → concept props → diegetic screen devices →
plates → secondary cast → action poses.

## 8. Generation protocols

- **Base-then-fan-out:** the canonical `base` is generated/approved first *and verified*; only then fan
  out the matrix, each frame seeded off the verified base. Never batch-generate a matrix and present it
  unchecked — an unverified base multiplies its own drift across every child frame, and pro generation is
  not free (~$25+ has gone into settling a single style question).
- **Anchored iteration ("iterate on THIS"):** pin the exact approved frame as the seed, restate §2,
  change ONLY the requested variable, hold everything else. (How the base tone, outline, and face were
  locked — proven 2026-07-04.) **Prove the change landed by MEASUREMENT, never by eye.** Seeded gen is
  sticky: a worded delta asking to change a small detail (a digit count, a head shape) is often
  **silently ignored** — the engine just re-emits the seed (proven 2026-07-08: a "change the hands to
  five fingers" delta returned a near-identical frame at mean-abs-diff **1.46**, and was *claimed* as
  landed until measured). Compute the **mean-abs-diff with Pillow** (0 = identical) and sample/zoom the
  changed region; a near-zero whole-diff means the delta was **ignored**, not that it was subtle. (The old
  `forge.py diff`/`crop` helper commands are gone — measure with Pillow directly, per the measure-a-matte
  rule below.) This is a check on an anchored iteration *you claim changed something*.
- **A worded delta is a weak lever on a seeded detail.** When the measurement shows the change was ignored,
  escalate the MECHANISM instead of re-wording: open or replace the pose so the feature is unambiguous,
  mask + regenerate just that region, or restate the whole subject — a one-line "change only Z" against
  an `identity`-mode seed will not move it. Relatedly, a relaxed or half-closed feature (a closed hand)
  is **ambiguous to judge** — never assert a count off one; gate open-pose frames instead (§3).
- **Measure a matte, a colour, or a geometry — never eyeball it.** For any question about a cutout's alpha,
  a halo, a colour value, or a geometric property (tilt, scale), reach for **Pillow before an opinion**:
  sample the **alpha histogram + the corner pixels**, sample the disputed **pixel against its canonical's
  value**, compute **tilt from the alpha bbox** — and **composite the cutout over its ACTUAL destination
  plate**, never a neutral field (a defect invisible on cream is glaring on green). **Why:** across a full
  measured run, every measured call was correct and every eyeballed one was wrong — in BOTH directions. A
  "white halo" seen on a cutout measured 0.6% partial alpha with corners at 0 (the *viewer* was compositing
  RGB under transparent pixels); a cutout was reported as needing a transparency regen when it already
  measured 38.5% clear; a cream-on-cream defect was waved through as harmless and was glaring once
  composited over a green plate; an iris drift was provable only by sampling — (76,48,29) vs the canonical
  (56,26,10). Both error directions cost: a false alarm queues a needless regen over a good frame, a miss
  ships the defect. Same family as the pixel-diff rule above and the finger-count rule (§3) — **the model's
  eye is not evidence; a measurement is.**
- **Cutout transparency is ALWAYS post-hoc keying — the engine emits NO alpha.** So a cutout gen renders
  the object on a **solid MAGENTA chroma field**, prompted as **"one solid uniform FLAT magenta
  background, NO glow, NO gradient, NO vignette"** — the fringe/halo failures were **generation-side
  glows** (the engine haloing the subject in magenta light), not keying failures, so the fix is forcing a
  flat field at GEN time, not re-keying. Then a deterministic key + despill lifts it: a *pale* field
  starves rembg on a pale subject (a pale ship left opaque-white interior gaps), AND rembg additionally
  KEEPS enclosed pale interior holes (a 7%-of-frame cream patch once shipped opaque inside a stamp). **Matte verification samples the ENCLOSED interior
  regions** — letter counters, rigging gaps, frame holes — not only the outer silhouette + corners, and
  composites over the real destination (the measure-a-matte bullet above): a stamp/ship whose exterior
  keyed clean can still carry an opaque interior patch that only an interior sample catches.
- **Verify loop — ONE re-authored retry, then surface.** Frames are reviewed in the `image-generation`
  skill's batched post-gen pass (§3 checklist + fidelity + taste), not per-frame mid-gen. A flagged frame
  gets **exactly one** retry, and that retry is a **FRESH gen off a RE-AUTHORED prompt — never
  prompt-accretion**: do not append the flag onto the failed delta and re-fire (that keeps the logic that
  just failed and patches over it), rethink how the frame is described and generate clean off the
  canonical. Still failing → keep the best, flag it, and **push it to the human artifact** — the human
  decides. No second retry, no grind. A locked-file fault (a §-value that looks wrong) is surfaced for
  approval, never self-edited here.
- **Head shape follows CONTENT, not the shape word.** The engine is sticky to the seed and treats the
  head-shape adjective as nearly inert (proven 2026-07-06: a forceful "perfect circle, no jaw" prompt on the
  base returned a pixel-identical head). Head drift toward a realistic jaw is driven by *human-defining
  detail* — age, hair, facial hair, gender, build pulling in a realistic-head prior. The lever on a
  detail-rich NEW character is an explicit **anti-realism clause** in the delta ("keep the flat stylized
  cartoon skull — no jaw, no cheekbones, no realistic face structure") plus the seed path (§5). Don't chase
  head shape with the descriptor word. **Keep the descriptor's words ACCURATE to the reference anyway:** an
  adjective that misdescribes the real frame ("egg" for a round head) misleads every human and every later
  terminal reading this file, even where the engine ignores it — the words are documentation of the lock,
  not just a lever on it.

**Engine (one, no tiers):** every generation — characters, scenes, chains, thumbnails — uses the single
registry `engine` **`gemini-3-pro-image`**. There is no per-call model choice and no cheaper fallback;
`forge.py` routes every call to the engine. (Rationale + provenance: §10, 2026-07-09.)

**Scene assembly (how a composed scene is built):**
1. **Compose the whole scene in ONE gen — multi-seeded, no posed-character pre-build:** seed each of the
   shot's `cast` figures' frames — **character canonical + `expression_ref` + `pose_ref`** (+ the
   **interaction template** when two figures interact) — plus any needed **style anchor** (§5 ENV rule); the
   environment + fixed props + sky/water are DESCRIBED in the delta and composed in the SAME generation
   (never pre-baked as an isolated plate — §5). Attribute provenance routes by seed (identity/tone/hair/
   costume from the canonical; body/hands from the pose; eye/brow/mouth shape from the expression). The delta
   REALIZES the `still_prompt`'s authored framing/placement (VPW owns composition — `visual-grammar.md §2`);
   it does NOT describe the pose or expression in words (those are in the seeds). Seeding the canonical is
   what holds identity + the library hand; a free-drawn named character falls off the rig (wrong proportions,
   one ear, a nose). The **§2c RIG-HOLD block is auto-appended** to every character-seeded scene gen (and
   chain delta), so the figures' rig is held without the delta restating it.
2. **A held scene evolves one of two ways — the BOUNDARY rule.** **DELTA-CHAIN when the change is
   INTEGRATIVE** — the new element becomes part of the scene's architecture (a city grows a bank; gold
   threads the streets): regenerate the scene seeded off the prior frame (base + ≤3 deltas; each delta
   changes ONE element and holds the rest — that frame-to-frame carry-over, not a reused plate, is what holds
   the set). **A re-base inside the SAME location seeds the prior stage's BASE frame, never a fresh
   canonical** — the `≤3 deltas then re-base` cap contains drift and assumes a re-base starts a NEW place;
   where the place persists, re-seeding canonical throws the set away and the location comes back different
   (measured: two stages of one location returned as two visibly different places). **A delta that REMOVES
   a transient element seeds the PRE-TRANSIENT ANCESTOR, not the immediate predecessor** — the immediate
   predecessor still carries the element being removed, so it drags it back in; seed the last frame from
   BEFORE the transient was added (the crowd departs a dock → seed the empty-dock frame that preceded the
   crowd, not the crowded frame). **LAYER when the change
   is DISCRETE** — the added element sits on the scene without fusing into its architecture (a character
   enters the foreground; a stamp slams onto a page): keep the plate, composite an animated cutout (the
   layered-shot path, `image-generation` skill). Every cutout is SEEDED (from its character/prop canonical,
   or the plate it lands on plus a style anchor) — an unseeded cutout invents its own register.
3. **Every human figure in the frame is the §1 family — named foreground figures on the FULL rig,
   anonymous crowds on the CROWD RIG (§2d).** A named/seeded figure keeps the full rig (via its seed +
   the auto-appended §2c). An anonymous crowd is rendered on the crowd rig — the VPW-authored §2d clause
   ("round cream-family heads, dot eyes, one simple mouth, no noses/ears/teeth, same proportions, varied
   era clothing") is already in the `still_prompt`; generate the crowd from it **seeded off the crowd
   exemplar** (`refs/base/crowd-exemplar.png`, §2d — the seed pins the proportion + face that prompt words
   alone let drift). Crowd figures are
   not a degraded full rig that gets vaguer with distance — they are a deliberately simpler rig, uniform
   across the crowd. Art style, proportions, and period never switch.
4. **One-shot whole-scene** is fine for a simple shot with a single prominent character — seeded off that
   character's canonical (+ its `expression_ref`/`pose_ref` frames), full §3 check on it and every incidental figure.
5. **Verify the assembled scene** (§3 on every figure + the scene-taste gate).
   *(True layer compositing — placing element PNGs programmatically — is the render engine's layered-shot
   path (LayerView), not this stage; image-gen only materializes the plate + the seeded cutout.)*

**Channel-signature elements lock like characters:** a NON-character element that recurs across MANY videos
(a specific ongoing ship, a landmark building, a channel flag/vehicle) can get ONE approved canonical
registered — via `register` with `"environment": true`, which files it under `refs/env/` and indexes it as
a kind-`environment` asset; every later use SEEDS off it. This is a **deliberate cross-video lock**, NOT the
per-video default (a single video's scene environments are composed in-shot per step 1). For render texture
that must stay consistent across a video (how skies/clouds/water/ground render), keep a short reusable
**scene-style descriptor** and prepend it to every scene gen — the world's equivalent of the §2 character
descriptor.

## 9. Registry — the live index of recurring cast & world

`registry/registry.json` is the single live index of what exists — two collections: **`characters`** (each
with a canonical file + head tone + pinned costume) and **`assets`** (expressions, actions, props, plates —
each with a canonical file + seed frame). Cross-video channel-signature environments/plates AND the standing
**style-anchor register frames** are `assets` with `kind: environment` (`character: null`, no seed_frame;
there is no separate top-level environments list). The register anchors live in `refs/env/` — **three are
locked** (`env-exterior-vivid`, `env-exterior-muted`, `env-map-parchment`, tags `exterior-vivid` /
`exterior-muted` / `map-parchment`); every environment/style gen seeds one by REGISTER (§5 ENV rule) since
`forge.py` hard-errors an unseeded environment gen. A **per-video recurring prop** is NOT a registry entry — it lives
only in that video's `assets/library/` (`kind: prop`, `prop-<name>.png`); it graduates to a `kind:
environment` registry entry only if it recurs across MANY videos (a deliberate §8 promotion). Canonical frames live in `refs/` (characters under
`refs/<character>/`, props/elements/plates under `refs/env/`). Reuse-before-regenerate keys off it, and
`visual-prompt-writer` reads it as the channel's asset vocabulary when planning shots. It grows every
video: `image-generation` registers each new verified channel-recurring asset back into it. **The
`refs/` copy is the canonical every later seed references;** a per-video `assets/library/` keeps its own
working copy.

Current cast: **the base template** (`refs/base/`, head tone `#f5ead6`) with its canonical `base.png`,
a ~14-frame expression set, and a ~10-frame action set; and **MacGregor** (`refs/macgregor/`, head tone
`#d9ac82`, PINNED crimson-hussar-coat costume) — the first registered on-screen cast member. See the
registry for the exact list. Further cast members, props, and environments are added as they're created.

## 10. Lock status & change log

**Approval rule:** edits to any LOCKED value (the §2 / §2b descriptors, the §3 checklist, §4 character
colours, the §6 recipe, the canonical `base`) require **human approval**. `image-generation` proposes a
change and surfaces it; it never self-applies one. The values are the deliberate source of truth — every
reference frame was generated against them, so a silent change desyncs the refs.

**Pending:** the outstanding item is the **gold composed-scene exemplar** — no approved pass-2 scene exists
yet; the first approved Poyais dogfood scenes become it. **MacGregor is the first REGISTERED cast member** —
rig-gate approved, canonical frame at `refs/macgregor/macgregor-base.png`, costume PINNED in `registry.json`
(crimson hussar coat + gold order-star). Seed every MacGregor appearance off his canonical frame; do NOT
regenerate him from scratch.

**Provenance** (each locked point, with its validation proof):
- **2026-07-04 — base LOCKED.** Cream `#f5ead6` head + brown-black `#241a12` outline + no-nose face;
  validated across 3 emotions + 2 exaggerated actions + a 16-frame model sheet. Global-palette lock removed
  (only character colours are fixed); invariants-vs-flex rule adopted (§3).
- **2026-07-05 — reframed to template + CAST; rig locked.** Validated via `_cast_test/`: one shared
  form → 4 instantly-distinct characters + a reaction mapped across the cast. "Bald" demoted to a narrator
  trait; §3 split into family-invariants + template-default.
- **2026-07-05 — hardened for scenes.** The cheaper model tier held the art style but drifted identity
  (MacGregor went bald/bearded; a nose + ears crept in) → added the **NO ears** invariant + verify-every-
  character-in-every-scene + the assembled-scene architecture + recurring-element locks. Proven via
  `_proof/`. (That cheaper tier was removed entirely on 2026-07-09 — see below.)
- **2026-07-06 — head-shape wording corrected to "round near-circle (NOT egg/oval)"** across §1/§2/§2b/§3
  (matches the actual base; the shape WORD is nearly inert — see §8). Accuracy fix, not a value change.
- **2026-07-07 — recipe committed** (2.5D vector cast + built-but-flat environments + marker charts + one
  red accent) in the visual-grammar consolidation; absorbed here 2026-07-08.
- **2026-07-08 — bible becomes the single image-gen doc** (recipe + library build spec absorbed from
  visual-grammar; scene rules rewritten as the positive assembly procedure). `asset-forge` rebuilt as
  `image-generation` (two-pass flow). One locked-value
  clarification, surfaced by the fresh-eyes dry-run and **human-ratified same day**: §3's "No text"
  scoped to **unrequested** text — the original rule predates composed scenes, and the shot grammar
  legitimately authors diegetic text (stamps, counters, on-artifact labels; ~40 Poyais shots would
  otherwise hard-fail their own plan). Library asset frames remain fully text-free; requested text
  must render verbatim/legible.
- **2026-07-08/09 — hand count LOCKED at four digits (three fingers + a thumb), enforced in the PROMPT.**
  The §2/§2b descriptors name the *classic 3-finger cartoon hand (Mickey/Simpsons)* — a strong prior that
  renders 3+1 far more reliably than fighting the engine's realistic 5-finger default (open / spread /
  raised-hand poses were the drift point; hands-at-sides already inherited the base's 3+1). This is a
  **generation-side** guarantee; the standing library was audited and every open-hand offender regenerated
  + verified. (`forge.py` also gained JPEG→PNG normalization — pro `gemini-3-pro-image` started returning
  JPEG, which the PNG-only writer rejected.)
- **2026-07-09 — checking slimmed to ONE batched review.** The per-image rig LOOK grind + per-batch scene
  gate + per-delta diff-gate + hand-crop-and-count procedure collapsed into one post-gen batched review
  (3 concurrent agents: identity / fidelity / style) with retry-2-then-flag (*superseded 2026-07-14 —
  see below*), owned by the
  `image-generation` skill; §3 here is now the **values-only rig checklist** it reads. Removed the
  finger-check self-contradiction (human-authority vs counting-subagent) and the cross-file duplication of
  the gate procedure — the ~30-min `_chain-test` check time was that loop. Descriptors (§2/§2b) unchanged.
  Spec: `docs/superpowers/specs/2026-07-09-image-gen-checking-slim-design.md`.
- **2026-07-09 — ALL generation moved to pro; the flash tier removed.** Two fresh validation runs (a
  campaign map + the poyais-promise delta chain) showed the cheaper flash tier rendering the **off-recipe
  soft-gradient look with no `#241a12` outline** and mangling baked text, while pro held both. With pro at
  ~$0.134/image the all-pro premium is ~$15–30 per full 8–15 min video — immaterial at the current cadence.
  So the tier system was deleted (skill technique table, this §8, `forge.py`'s `--model`/alias logic); the
  single registry `engine` `gemini-3-pro-image` is now the only model. Side effect: this also eliminates the
  mixed-tier-in-a-chain drift (a chain can no longer switch render styles mid-set). Reconsider a cheap tier
  only if volume scales to a daily cadence — and then reach for the Batch API (half price, overnight), not
  flash. (`stack.md` carries the cost model; `decisions.md` 2026-07-09.)
- **2026-07-10 — identity/rig adherence tightened (prevention + forced review verdict).** The per-character
  rig-hold, previously manual delta prose on composed scenes (`mode=environment` prepends only the §2b
  style-only descriptor), is now an extractable **§2c RIG-HOLD block** `forge.py` **auto-appends** to every
  character-bearing gen (seed under `refs/<char>/`, `assets/library/`, or `assets/scenes/`), closing the
  "operator forgot to assert it" hole that shipped noses + five-finger hands on the `_chain-test` slice. The
  §2b add-clause was de-duped to reference §2c (no invariant text stated twice). Move 2 (in the
  `image-generation` skill): the identity review now returns a forced PASS/FAIL per invariant per seeded
  frame instead of "flag if noticed." No objective gate (`diff`/`crop`) re-wired — the human artifact board
  stays the final finger authority. Spec/plan: `docs/superpowers/specs|plans/2026-07-10-image-gen-identity-adherence-tightening*`.
- **2026-07-14 — retry policy: ONE RE-AUTHORED retry, then surface** (replaces retry-≤2/≤3-then-flag
  everywhere; §0.4 + §8 verify loop + the `image-generation` skill). Two changes, one principle:
  **(a) one auto-retry, not two** — a second attempt on a defect the first retry didn't clear is a grind,
  and the human is a better judge than a third roll; **(b) the retry must RE-AUTHOR the prompt logic, not
  append to it.** The old wording actively prescribed accretion ("retry with the violated trait pushed
  explicitly"), which keeps the exact logic that just failed and stacks a patch on top. Evidence: the
  Pass-1b salute merge rendered **five digits even though the §2c RIG-HOLD block — which says "exactly
  THREE fingers plus ONE thumb" — was auto-appended and present in the prompt.** Pushing the same
  invariant harder was never going to fix it; the fix was a fresh gen off re-authored composition logic.
  Corollary already proven at the character-lock level (2026-07-10): **batch-and-pick beats serial
  rolls** — serial single rolls drift one feature per roll and burn credits. Human-directed.
- **2026-07-10 — pose/expression are SEEDED, not word-driven.** §5 rewritten: a character's pose + expression
  come from library frames, carrying the correct 4-digit library hand + hands in the character's tone (folded
  into the §5 attribute-provenance law). The old word-driven pose/expression framing was removed. §7 names
  the expression/pose sets as the seed source. VPW selects `pose_ref`/`expression_ref` (intent). Spec/plan:
  `docs/superpowers/specs|plans/2026-07-10-pose-expression-seeding-two-step*`. *(The intermediate
  posed-character MERGE this entry introduced was retired 2026-07-15 — see below; the seed source and the
  provenance law survive, the merge tier does not.)*
- **2026-07-15 — Pass-1b posed-character merge RETIRED; scenes multi-seed in one run.** A 6-probe capability
  test proved a scene can hold identity, costume, and pose from `[canonical + pose + expression + prompt]` in
  ONE gen (P1), survive elaborate regalia (P2), and hold BOTH identities distinctly from
  `[interaction template + canonical A + canonical B]` in a single pot (P3) — superseding the merge tier's
  "one base-derived seed per step / never `[template+A+B]` / the base wins 2-against-1" staging law. §5, §7,
  §8 rewritten around **direct multi-seeded scene gen**: the ~52 base primitives (expressions/poses/
  interactions) stay, but as **direct scene seeds**, no longer merge inputs; the attribute-provenance law
  survives unchanged (it now routes seeds within the scene gen). **Cascade collapses** frames → scenes:
  re-authoring an expr frame invalidates only the scenes seeded from it (the merge tier no longer exists).
  **Costs honestly acknowledged:** the merge's cheap "isolation gate" (a bad blend caught on a portrait
  before scene gen) is GONE — seed-routing failures (wrong-tone hands, a weak expression, identity bleed)
  now surface at the batched review, at full scene-gen cost; expression is the measured SOFTEST seed, so the
  review checks expression-register per beat, and the probe is N=1 per case so the first real run is watched.
  **Two more changes landed with it:** (1) **all engine-drawn text + T2 device cards retired** — in-video
  text is now baked diegetic, quoted verbatim + kept short + transcribed letter-by-letter (§3, §6); (2)
  **`forge.py` hard-errors any environment/style gen with zero seeds** and `refs/env/` is populated with
  three register anchors (vivid / muted exterior, parchment map) — every environment carries a style-anchor
  seed by register (§5 ENV rule, §9). The retired `forge.py diff`/`crop` helper commands are gone (measure
  with Pillow directly, §8). Human-directed.

# The Hidden Machine — Style Bible (LOCKED)

**Image engine:** `gemini-3-pro-image` (2K, ~$0.134/img), consistency by **iterative edit chain**
(prior-frame-as-input), not by seed number. **Motion engine:** `veo-3.1-fast-generate-preview` (§9).
This file is the single source of law for every frame the channel generates — register, mode routing,
prompt blocks, seed rules, verify gates. The **`image-generation`** skill reads this file and follows it
exactly; the *process* (Pass 0/1/2, the batched review, the single-asset loop) lives in that skill.

## 0. How to use this file

1. **Route the beat to its MODE before writing anything else** — full-texture R1 (§2), mechanism mode
   (§2b), or data card (§2d). Mode is a decision, not a byproduct of the delta.
2. **Prefix the mode's descriptor verbatim** (§2 / §2b), then add only the scene delta.
3. **Append the FULL-BLEED LAW (§2c) verbatim to every generation.** The only exemption is §2f.
4. **Seed from the right canonical (§5)** — a locked figure or environment is never generated from text.
5. **Reuse before regenerate** — `registry/registry.json` (§10) is the live index; a hit returns the file.
6. Every output is reviewed against **§3** in `image-generation`'s one batched post-gen review. **ONE
   re-authored retry**, then the residual defect is **flagged** for the human artifact — never silently
   ship an off-register frame, never grind.
7. **The pre-gen human approval sheet at Pass 1 stands.** Nothing in this file authorizes generating a
   video's locked assets ahead of that gate.
8. **Edits to any LOCKED value require human approval** — the §2/§2b/§2c/§2d blocks, the §3 checklist, the
   §4 cast pin, the §6 recipe, the canonical refs. `image-generation` surfaces a proposed change, never
   self-applies one: every canonical was generated against these values.
9. **Run every generation script with `py -3`.** Plain `python` on this machine lacks Pillow and crashes
   the JPEG-normalize path *after* a billable call has already returned.

## 1. Register — the locked look

- **R1 "screen-print editorial" (LOCKED Daniel 2026-07-29 — REVOCABLE).** Risograph screen-print
  illustration: limited flat inks, visible print grain, registration offset between colour layers,
  hand-pulled poster energy, imperfect edges, flat geometric shapes. The lock is explicitly revocable;
  a revocation invalidates every canonical, so it is a channel-level decision, never a per-video one.
- **The system is the character.** There is no on-screen narrator and no ensemble cast. One recurring
  human — **the everyman** (§4) — is the channel's scale unit; everything else on screen is machinery,
  infrastructure, or the ordinary world above it.
- **Two render modes, one world.** Narrative / mood / human beats render in **full R1 texture** (§2);
  how-it-works and label-carrying beats render in **mechanism mode** (§2b) — R6 clear-line cutaway
  drafting inside R1's inks with registration LOCKED. **Numbers render as data cards** (§2d). Mode
  routing per beat is `visual-grammar.md §4`.
- **Default aspect ratio `16:9`.** Cast/reference portraits are also authored 16:9 (§2f).

## 2. LOCKED STYLE descriptor (verbatim — prefix every full-texture generation)

> Risograph screen-print illustration, limited palette of 3-4 flat inks, visible print grain and subtle
> registration offset between color layers, hand-pulled poster energy, imperfect edges, flat geometric
> shapes.

Immediately followed by the scene delta, then the suffix, then §2c. **Suffix (verbatim):**

> No text, no labels, no logos, no watermark.

**Ink-naming is an optional narrowing, never the default.** The descriptor deliberately does not name
inks (§4). A scene that must sit in a specific ink family may append the named-ink form —
`limited palette of 3-4 flat inks (deep petrol teal, mustard yellow, burnt orange/rust, on a warm cream
base)` — but it is a per-shot instrument, and baking it into the descriptor would fight §4.

## 2b. MECHANISM-MODE descriptor (verbatim — REPLACES §2 on how-it-works beats)

> Clear-line cutaway illustration in the style of a classic how-things-work book: uniform confident ink
> outlines of even weight, meticulous cross-section drafting sensibility, friendly diagrammatic clarity,
> no gradients. Rendered in a limited riso-print ink palette of deep petrol teal, mustard yellow, burnt
> orange/rust, and a warm cream base — flat screen-print color fills with visible print grain, but LOCKED
> registration: no registration drift, no color-layer offset, crisp even linework, clean precise edges
> throughout.

**Anchor:** `refs/mode/mechanism-cutaway.png` — seeded into every mechanism-mode generation. The words
carry the mode's facts; the anchor is what holds it. Registration is **locked** here and drifting **only**
here is a defect (§3) — this is the one place the register's signature texture is deliberately suppressed,
because drift and drafting clarity fight each other. Mechanism mode is a **render mode, not a second
style**: same inks, same grain, same paper, same world.

## 2c. FULL-BLEED LAW (verbatim — appended to EVERY generation)

> Single full-bleed panel: the artwork fills the entire canvas edge to edge, one continuous unbroken
> scene. There is exactly ONE composition in this image — not two, not three, no repeated or duplicated
> variants of the same scene placed side by side, no triptych, no diptych, no filmstrip layout, no
> vertical or horizontal divider strips of any kind. The illustrated scene itself must touch and fill all
> four edges of the canvas with ink — no plain cream, white, or paper-colored strip of any width along any
> edge. No borders, no margins, no mat, no frames, no deckle or torn paper edge, no depicted paper stock
> behind or around the image, no photographed print or physical object presentation, no split panels, no
> gutter, no inset panels. No labels, text, arrows, or diagram annotations.

**DRAFT — validation gap.** This wording fixed the *vignette/inset* failure mode in its one trial (n=1)
and has **never been tested against the uniform-border-ring** failure mode. Treat border containment as an
unsolved risk, not a solved one, and re-open this block when a validation batch exists.

**Containment doctrine (law, not preference):**
- **Fresh generations are the high-risk path; edit-chains are the safe one.** Zero border failures across
  the whole edit-chain probe; 3/9 in fresh generation, and the two worst offenders in the whole lab were
  fresh **wide establishing exteriors** with open sky and ground on every side. Prefer an edit chain off a
  canonical whenever one covers the location, and **budget a retry on every fresh wide**.
- **Retry escalation, in order:** (1) append the border-ring addendum — *"The camera is close and tightly
  cropped: [the scene's structures] are cropped by the left and right edges of the frame, [the overhead
  structure] is cropped by the top edge, the floor is cropped by the bottom edge — no structural element
  floats surrounded by empty background, no vignette halo, no card-mount or poster-mat border. Ink, not
  paper color, must be the very last pixel along all four edges."*; (2) re-author the composition tighter;
  (3) **crop deterministically with Pillow.**
- **Edge-check then crop is the sanctioned fallback, and it happens BEFORE a frame becomes a canonical.**
  Precedent: `refs/env/machine-hall.png` and the everyman's source variant were both border-cropped
  post-generation (their uncropped originals preserved in the lab). A cropped frame is a clean canonical;
  a bordered one is not.
- **A thin, irregular, on-style edge falloff is not a violation.** The failure being policed is a *ruled*
  or *uniform* border, a mat, a deckle edge, or an inset floating in a paper field.

## 2d. DATA-CARD law (verbatim — the ONE text-bearing frame type)

On-screen numbers and stats render as **flat, high-contrast stat cards on the register's paper-grain
background, in the same inks, with the type shapes untextured** — flat solid-ink lettering sitting on top
of the grain, never grained itself. **Exemplar:** the probe's `1.5 SECONDS / 6 MACHINES / 2 STATES` card,
`videos/_style-lab/watchability-probe/frames/N6.png` — **it must be promoted into `refs/mode/` and
registered before `_style-lab/` is pruned**, or this law loses its anchor. Data cards use §2 style + this
law in place of §2c:

> Single full-bleed panel: the artwork fills the entire canvas edge to edge, one continuous unbroken
> scene. There is exactly ONE composition in this image — not two, not three, no repeated or duplicated
> variants of the same scene placed side by side, no triptych, no diptych, no filmstrip layout, no
> vertical or horizontal divider strips of any kind. The background itself must touch and fill all four
> edges of the canvas with ink or paper-grain texture — no plain white gutter of any width along any edge.
> No borders, no margins, no mat, no frames, no deckle or torn paper edge, no depicted paper stock behind
> or around the image, no photographed print or physical object presentation, no split panels, no gutter,
> no inset panels. The ONLY text in the entire image is exactly these short bold poster-style stat labels,
> each on its own flat ink block, no other words, numerals, logos, or diagram annotations anywhere:
> "<LABEL 1>", "<LABEL 2>", "<LABEL 3>".

- **Never ask a full-texture frame to carry data.** A number belongs on a data card or on a diegetic
  surface, never floated over a textured scene.
- **Labels are quoted verbatim in the prompt, ALL-CAPS, ≤3 per card, ≤3 words each.** The review
  transcribes them letter-by-letter; a garbled, misspelled, extra, or missing label is **blocking**.
- The card is **baked at generation time**, full-bleed, one image. It is never a render-time overlay.

## 2e. EDIT-CHAIN preamble (verbatim — prepend to every prior-frame-as-input generation)

> Keep the reference image's exact illustration style — do not change medium or technique: Risograph
> screen-print illustration, limited palette of 3-4 flat inks, visible print grain and subtle registration
> offset between color layers, hand-pulled poster energy, imperfect edges, flat geometric shapes. Keep any
> characters/objects from the reference on-model (same proportions, same palette, same linework) unless
> the instruction below describes an entirely new scene.

## 2f. Reference-frame exemption (the ONLY exemption from §2c)

A **canonical cast/reference portrait** renders its subject on a plain cream field for legibility and is
exempt from the full-bleed law — `refs/everyman/everyman.png` is one. Reference portraits are **seeds,
never shipped frames**; nothing carrying this exemption ever appears in a video.

## 3. The verify checklist — channel invariants (values only)

The **WHAT** the batched review checks every frame against; `image-generation` owns the **HOW**. Judge
against the channel's **approved canonicals** (`refs/`), not an idealized register: drift from them fails,
matching them passes. **In doubt, put the frame beside its canonical — if it reads as the same world, it
passes.** Over-calling costs as much as missing: a needless regen can destroy a good frame.

- **Register held** — print grain present, flat ink fills, hand-pulled poster energy, imperfect edges, no
  gradients, no photoreal rendering, no soft airbrush middle.
- **Registration** — visible colour-layer offset on full-texture frames; **absent** on mechanism-mode
  frames. Drift in mechanism mode, or a dead-clean full-texture frame, is a mode FAIL.
- **Ink discipline** — 3–4 flat inks on a warm paper base, one warm accent breaking a cool scene (or the
  inverse). Which inks is free (§4); how many is not. A muddy 6-ink frame fails.
- **Full-bleed** — ink at the last pixel on all four edges. A ruled/uniform border, mat, deckle edge,
  vignette, or inset FAILS → retry per §2c. A thin irregular on-style falloff passes.
- **Text** — full-texture and mechanism frames carry **zero** text, labels, arrows, or diagram
  annotations. A data card (§2d) carries **exactly** its authored labels, transcribed letter-by-letter.
- **Everyman identity** — when he appears, his pinned look (§4) must match his canonical: slim elongated
  silhouette, navy open overcoat, olive crew-neck, navy trousers, rust messenger bag cross-body, short
  dark side-parted hair, understated minimal face. A generic figure standing in for him is an identity
  FAIL even when the register passes.
- **Scale honesty** — where the shot argues scale, the human-scale element is genuinely small against the
  system at a believable relative size. A scale relationship faked by lens or crop is a doctrine FAIL
  (`visual-grammar.md §2`).
- **Register-fit of mood** — vertigo and wonder, never dread. Alarm-red, menace lighting, ruin/decay
  staging, or threat cues are defects regardless of craft (`dna.md §Doctrine`).
- **Faces stay understated.** The everyman's face is a few simple marks; added realism, detailed
  features, or a big acted expression is drift.

**Never checked — these vary:** which ink subset a scene pulls, palette temperature, camera height,
distance, composition, time of day, weather, and the everyman's seasonal/contextual clothing swaps that
keep his silhouette.

## 4. Palette — behaviour, not hexes (LAW)

**The register's ink subsets shift per scene, and this is intended.** Warm interior, cold infrastructure,
and teal night are different draws from the same limited-ink logic — the lock sweep pulled visibly
different subsets across scene types (blue/orange/yellow, red/orange/gold/navy, teal/violet/cream) with
the register holding in **every** frame. That range is the register's charm and it is **law, not
tolerance**.

- **Locked:** the ink *families* — rust / teal / mustard / cream — and the *behaviour*: 3–4 flat inks per
  frame, a warm paper base, one accent breaking the dominant temperature.
- **Not locked, deliberately:** any hex value, and which subset a given scene pulls. **Do not hex-lock this
  register** — a fixed ink set contradicts the behaviour above and would have failed frames the human
  approved.
- **Palette codes tone and depth** (`universal.md §13a` rule 8, applied): warm and lit at human scale,
  cooling and darkening with each step down into the system, one warm signal thread persisting to the
  bottom.

**Cast — one character, pinned.** `refs/everyman/everyman.png` (charD "slim-urban editorial", Daniel pick
2026-07-29). Pinned look: slim elongated silhouette, navy-blue open overcoat over an olive crew-neck
sweater, navy trousers, dark shoes, orange-rust messenger bag worn cross-body, short dark side-parted
hair, understated minimal face. **Every appearance renders in this** unless a shot deliberately authors a
change; season and context swaps are allowed, **the silhouette is the identity**. He is not named on
screen.

**Environment canonicals** (`refs/env/`): `coffee-shop.png` — the wedge interior where the tap happens;
`machine-hall.png` — the generic "inside the system" infrastructure hall, cold blue-teal with one warm
accent and a human silhouette for scale; `street-corner.png` — the night exterior, wet-pavement
reflections, warm window against teal night, the walk-away / world-above.

## 5. Seed rules — base-then-fan-out (the reproducibility mechanic)

- **Base-then-fan-out.** A canonical is generated, human-approved, and border-verified **first**; only then
  does anything fan out from it. An unverified canonical multiplies its defects into every child, and a
  bordered one propagates the border.
- **Fan out by prior-frame-as-input + a delta instruction**, prefixed with the §2e edit-chain preamble.
  Consistency on this engine comes from the chain, not from a seed number.
- **Chain depth ≤4 deltas, then re-anchor on the canonical.** Four chained edits — a camera pull-back, a
  lighting change to dusk, a new character action, and a full camera reset to an exterior night view —
  produced **zero** style or identity degradation, and a re-anchor into an entirely new scene came back
  clean. Depth past 4 is **unprobed**; the ≤4 bound is the conservative reading of the evidence, not a
  measured limit.
- **Re-anchor on the canonical for a BIG delta** — a new location, a camera reset, a mode switch. Cheap,
  proven, and it costs nothing when it wasn't needed.
- **A delta that REMOVES an element seeds the pre-element ancestor**, not the frame that still carries it.
- **Never chain off a downstream derivative when the canonical is what you mean.** A later "improved"
  frame may have silently drifted; trace back to the exact frame the human approved.
- **A defect is never fixed by chaining off the defective frame — regenerate fresh from the canonical**
  with a re-authored prompt. The defect lives in the strongest input and rides it back.
- **Mechanism-mode gens seed `refs/mode/mechanism-cutaway.png`; environment gens seed their `refs/env/`
  canonical.** A location the canonicals cover is never generated fresh.
- **New cast or environment canonical:** generate on a plain field (§2f) for cast, full-bleed for
  environments, human-gate it, border-verify, crop if needed, then register it (§10).

## 6. The committed visual recipe (LOCKED — this is THE direction)

> **Screen-print editorial world + clear-line mechanism cutaways in the same inks + flat stat cards +
> one recurring everyman as the scale unit.**

- **World:** built, dense, edge-to-edge. Real infrastructure furniture — racks, cable trays, conduit runs,
  counters, wet pavement, storefront glass — not one object floating on empty ground. Depth is read
  through perspective and ink temperature, never through gradient or blur.
- **Mechanism:** the how-it-works beats are cutaways and cross-sections — the surface opened to show the
  layer beneath, drafted with even confident linework and diagrammatic clarity. This is where the channel
  earns its explainer credibility, and it is `universal.md §13a`'s register-shift row realized: the
  cleaner register **is** the signal that you are now seeing the real machinery.
- **Numbers:** flat stat cards (§2d) at the scale-payload beats. Poster-print typography as flat ink
  shapes, never engine type, never a caption over a scene.
- **Human:** one everyman, understated. He is present to establish the ratio, then dwarfed or absent. His
  face never carries the beat — his **scale** does.
- **No lettering system, no chapter cards, no chyrons.** Text exists only on a data card. A chapter turn
  is a hard cut and a palette turn.
- **Never the uncanny middle** (`universal.md §13`): fully committed to the illustrated register, no
  semi-photoreal drift, no stock B-roll, ever.

## 7. Asset library — build spec

The channel's standing cross-video kit, built deliberately. Locked today: the everyman (§4), the three
environment canonicals (§4), and the mechanism-mode anchor (§2b). A single video's one-off scenes and
props are composed in-shot at generation time, never pre-baked as plates.

**Build order** (front-loads the most reused):
1. **Descent frames** — the vertical cutaway cross-section of an ordinary surface opening onto the layers
   below. The channel's signature composition (`visual-grammar.md §2`) and the highest-reuse shape.
2. **Mechanism-mode primitives** — a link/handshake between two machines, a nested-shell wrapping, a
   routed path threading a hall, a conduit descent. These recur across every video's explainer spine.
3. **Scale-token frames** — the everyman at true relative size against a system mass; the lone silhouette
   on a walkway for scale.
4. **Additional environment canonicals** as topics demand — a landing station, a plant floor, a street
   under-surface. Each is a deliberate cross-video lock (§10), not a per-video default.
5. **Data-card layouts** — 1-stat, 2-stat, and 3-stat arrangements, once each, then reused by edit chain.

A **per-video recurring prop** is not a registry entry: it lives in that video's `assets/library/` as
`prop-<name>.png`, seeded into each appearance, and graduates to the registry only if it recurs across
many videos.

## 8. Generation protocols

- **Measure, never eyeball.** For a border, an edge, a crop, a colour, or a geometric property, reach for
  **Pillow before an opinion** — sample the edge columns and rows, compare a disputed pixel against its
  canonical. The model's eye is not evidence; a measurement is.
- **Prove a delta landed by measurement.** Chained generation is sticky and a worded delta on a small
  detail is often silently ignored — the lab's own record shows a "pull back" delta barely honoured.
  Compute the mean-abs-diff against the parent; near-zero means **ignored**, not subtle. Then escalate the
  **mechanism** (re-frame, re-author the composition, restate the subject) instead of re-wording.
- **Verify loop — ONE re-authored retry, then surface.** Reviewed in the batched post-gen pass, not
  per-frame mid-gen. A flagged frame gets exactly one retry: a **fresh generation off a re-authored
  prompt**, never prompt-accretion. Still failing → keep the best, flag it, push it to the human artifact.
  No second retry, no grind. A locked-file fault is surfaced for approval, never self-edited.
- **A frame the human rejected is preserved as evidence, not overwritten** — keep it beside the canonical
  under an `.attemptN` / `.<reason>-fail` name so the rejection is auditable.
- **Cost discipline:** ~$0.134 per image; every paid batch is authorized and ledgered before it runs, and
  a retry budget is declared up front, not discovered mid-run.

## 9. Motion doctrine (LOCKED)

**Engine:** `veo-3.1-fast-generate-preview` — **8s maximum**, native audio, **$0.10/s**.

- **The only sanctioned recipe: single anchor frame + directed beats + a style-lock clause.** The anchor is
  an approved still; the prompt opens with the style lock, then directs the beats in order.
  **Style-lock clause (verbatim, adapt only the medium words for mechanism mode):**
  > Flat risograph screen-print animation, exactly the style of the input image — grain, limited inks,
  > registration drift, static camera, characters move like paper cutouts, no added realism.
- **First+last-frame interpolation is BANNED** until keyframes are canon-locked. Two attempts failed; the
  path re-opens only on an explicit decision with locked keyframes in hand.
- **Density target: 15–20 motion-worthy beats per 8–10 minute video, ≈$15–25/video.** A beat earns a clip
  by carrying real motion — a mechanism acting, a scale reveal, the ordinary action itself — never to
  decorate a static idea.
- **Every still in the render gets an eased Ken Burns move. There are no true statics** — including data
  cards and mechanism frames. This **overrides** `universal.md §13a-iii` rule 1's dead-static
  text/diagram-frame default for this channel.
- **Operational (REST, `predictLongRunning`):** the image field is
  `{"bytesBase64Encoded": …, "mimeType": …}`, **not** an `inlineData` wrapper; `numberOfVideos` is
  rejected — omit it; `durationSeconds` must be a JSON **number**; billing is on **delivered** output, so
  a rejected request costs nothing. Retrieve via
  `response.generateVideoResponse.generatedSamples[0].video.uri` with an `x-goog-api-key` header.

**Evidence standing.** The card-tap clip is the Daniel-liked reference for this recipe. The crowd, hero,
and quiet-register stress clips delivered clean but carry **no explicit human verdict** — they are
**supporting evidence, not a gate**. The still-plus-Ken-Burns discipline is probe-proven and human-passed.

## 10. Registry — the live index

`registry/registry.json` is the single live index of what exists: **`characters`** (canonical file, role,
pinned costume), **`environments`** (canonical file, role), **`modes`** (the mechanism-mode anchor), plus
the channel `register` and `engine`. Canonical frames live under `refs/` — `refs/<character>/`,
`refs/env/`, `refs/mode/` — and **the `refs/` copy is the canonical every later generation chains from**,
while a per-video `assets/library/` keeps its own working copy. Reuse-before-regenerate keys off this
file; `visual-prompt-writer` reads it as the channel's asset vocabulary; `image-generation` registers each
new verified channel-recurring asset back into it.

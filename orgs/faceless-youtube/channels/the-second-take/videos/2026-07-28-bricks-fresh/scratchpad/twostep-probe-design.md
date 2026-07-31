# Two-step character seeding — forensics + probe design (2026-07-30)

Analysis + probe design only. No generation, no spend, no code/doc edits. Written incrementally.

---

**Jump to:** [1. Forensics](#1-forensics-on-the-prior-attempt) · 2. Technique research (below) · 3. Probe
design · 4. Integration sketch

---

## 1. FORENSICS ON THE PRIOR ATTEMPT

**Headline finding: TWO prior attempts exist, not one.** The earlier, cruder one (2026-07-06,
pixel-level compositing) is an exact symptom match for what Daniel described today. The later, more
sophisticated one (2026-07-10→07-15, Pass 1b model-seeded merge) is the closer *mechanism* match to
what he's now proposing, but its documented failure was a different defect (identity base-bleed), and
no isolated verdict on ITS placement quality survives. Both matter; they answer different halves of
the question.

### Attempt A — 2026-07-06, hard pixel compositing: THE exact symptom match

`knowledge/decisions.md:1145-1178` ("Visual-pipeline exploration: findings + doc reconciliations
pending"), a hands-on session using Poyais as the test bench. Scratch test dirs survive on disk
(gitignored, not in git history — confirmed via `git log --diff-filter=A` returning nothing for them):
`channels/the-second-take/visual-kit/_proof/`, `_scene_test/`, `_model_sheet/`, `_cast_test/`,
`_angle_test/` (notes.md + review.html only; the PNG frames themselves are gone — pruned per
operating-law §F-clean, "exploration is ephemeral"). `_mac_clip/` (referenced as the proof case) now
holds only `vo_cuts.json` — the frames are gone too.

**What it was.** *"Compositing separately-generated, front-facing character frames onto detailed
plates"* — generate the character alone, generate the environment plate alone, paste them together
(Remotion/PIL-style hard composite, evidenced by *"a soft shadow + grade"* being the attempted fix —
that is post-hoc 2D image correction on an already-flat paste, not a generation-time technique).

**Verbatim verdict (`decisions.md:1148-1153`):**
> One-shot-in-scene beats compositing for character shots. Compositing separately-generated,
> front-facing character frames onto detailed plates reads as **paper-doll stickers** (proportion
> mismatch — chibi cast vs realistic-scale environments — plus paper-doll posing, lighting/scale
> mismatch; **a soft shadow + grade does NOT fix it**). Generating the character **into** the scene
> one-shot (pro), seeded off a canonical frame for identity, avoids all of that (proven on `_mac_clip/`
> — MacGregor in a candlelit room; mac2/mac5 held his identity via seed-from-reference).

**Direct, literal mapping to Daniel's three named failures today — all four line up:**

| Daniel's symptom (2026-07-30) | 2026-07-06 finding, verbatim |
| --- | --- |
| "threw the characters all over the place" | "paper-doll posing" — the card is generated front-on/neutral with no awareness of the scene's camera angle or blocking, so it sits in the frame however it landed, not where the scene wants it |
| "didn't blend into the background" | "lighting/scale mismatch" — a plate built in isolation commits its own lighting and perspective; the pasted card was lit for nothing in particular |
| "characters didn't have the shadow thing" | **"a soft shadow + grade does NOT fix it"** — they tried exactly this bolt-on and it still read wrong, because the shadow was applied in post, not reasoned about by anything that understood the scene's ground plane |
| "sizing was all wrong" | "proportion mismatch — chibi cast vs realistic-scale environments" |

**What fixed it, and what it became.** One-shot-in-scene generation — seed the character canonical
directly into a SINGLE scene gen, no separate card, no paste. This is the direct ancestor of the
CURRENT mechanism (`image-generation/SKILL.md` Pass 2 technique (b), "Seeded composition": one gen,
multi-seeding canonical + pose + expression + style anchor, environment composed from words in the
same call) and of fix-design.md's seeding law (fix 1). `style-bible.md §8c` was flagged for
reconciliation the same session (it still framed scenes as flash-plate + composited layers); current
style-bible has no such §8c framing, so the reconciliation appears to have landed at some point in the
long doc-trim history, though no single commit isolates it.

**The load-bearing caveat for the probe.** Attempt A tested *pixel compositing* — a flat paste with
post-hoc shadow/grade, no model involved in the join. It did **not** test what Daniel is asking for now
and what the task brief describes: feeding the card image(s) AND a place/scene image into
`gemini-3-pro-image` **together, in one generation call**, with a text prompt instructing the model
itself to place, scale, ground and light the figure into the scene (model-mediated composition, not a
post-process paste). That specific technique has no recorded test anywhere in this repo's history.
Attempt A's failure is real evidence that *naive* card-then-paste is bad, but it does not settle whether
*card-then-model-compose* is bad — the mechanism is different in exactly the respect that might matter
(a paste has no lighting/shadow reasoning at all; a multi-image gen call at least has holistic blending,
per Attempt B's finding below — for better or worse).

### Attempt B — 2026-07-10→07-15, Pass 1b model-seeded merge: the closer mechanism, a different failure

`docs/superpowers/plans/2026-07-10-pose-expression-seeding-two-step.md` +
`...specs/2026-07-10-pose-expression-seeding-two-step-design.md` — built and run, retired 5 days later.
Read together with Attempt A this is not a redundant finding; it is the SECOND, more advanced attempt at
the same idea, and it is the one that most literally matches "stage 1 assembles a card, stage 2 places
it" as a MODEL operation rather than a paste. Approved 2026-07-10, built same day. Exactly the shape
Daniel is describing now:
- **Pass 1b ("the merge")** = stage 1: seed `[character canonical + pose_ref frame + expression_ref
  frame]` into ONE gen, `--mode environment`, **plain background** (not scene), with a binding-delta
  telling the model which reference owns which attribute ("body pose + hands from the POSE reference;
  face/expression from the EXPRESSION reference; identity + costume from the CHARACTER reference").
  Output registered as a **posed-character asset**, `assets/library/<character>--<pose|none>--<expr|none>.png`
  — this is Daniel's "character card."
- **Pass 2 ("placement")** = stage 2: seed the posed-character asset(s) for the shot's `cast` + compose
  environment/props from `still_prompt`; the delta "describes ONLY the environment + placement... does
  NOT describe the pose or expression in words" — confirmed literally run this way on Poyais,
  `channels/the-second-take/videos/2026-07-04-poyais/_image-gen-plan-2026-07-14.md:99-100`: *"Seed the
  posed-character asset named in each cast entry; the pose, expression, hands and tone are baked in —
  your delta describes only environment + placement."* Poyais Pass 2 (~138 shots, 6 chunks) was planned
  and dispatched under this mechanism on 2026-07-14, one day before the pivot below.

**What actually broke it — the documented root cause.**
`docs/superpowers/analysis/2026-07-10-character-seeding-merge-audit.md` (two independent auditors,
converged): the merge (stage 1, the card-assembly step) suffered **base-bleed** — a bald, cream-toned,
neutral-face BASE-DERIVED primitive (the `pose_ref`/`expression_ref` frame, itself generated off the
generic template) out-voted the character canonical. Root cause, stated precisely (`merge-audit.md:22-30`):

> The API carries no per-image role, mask, or weight — `forge.py:210` sends `[<img1>,<img2>,<img3>,{text}]`;
> every seed is an un-labelled blob, the delta never cites image position. The engine
> (`gemini-3-pro-image`) does **holistic blending, not slot-wise feature routing** — it has no operator to
> take scalp pixels from image 1 and jaw pixels from image 3. So base traits get fed in as a **majority
> vote**: an expression merge stacks 2 bald/cream/neutral seeds against 1 character canonical... The model
> obeys the majority → bald, cream tone, blank face, front orientation.

Observed symptoms at the time (`merge-audit.md:14`): *"Bald strip, skin-tone reverts to base cream,
blank face on a weak seed, wrong-hand handshake, figures not turned toward each other, hand-tone bleed."*
A fix wave (`docs/superpowers/plans/2026-07-10-image-gen-seeding-fix.md`, attribute-provenance split +
staged 1-to-1 merging) improved but did not fully close it — see the retirement rationale below.

**Why it was killed (2026-07-15).** `knowledge/decisions.md:2566-2593` — "Pipeline simplification: Pass
1b + engine text/device kit retired." A cheap probe (Phase 0, **6 gens ≈ $0.80**) tested whether the
merge step was even necessary: **one-run multi-seed [canonical+pose+expression] held identity/costume
just as well as the two-step merge, without the merge's base-bleed risk** — "the merge added a pass
without adding capability" (`docs/retired-features.md:61-66`). Pass 1b was deleted; the current
single-step seeding law (fix-design.md fix 1, option (a) FRESH: canonical + pose + expression + plate in
ONE gen) is its direct descendant.

**Symptom mapping to Daniel's three named failures via Attempt B specifically: no exact match.** Attempt
B's OWN documented failure is stage-1 identity base-bleed (bald/cream/neutral primitive out-voting the
character), not stage-2 placement/blend/shadow/scale. No placement-specific complaint is recorded
anywhere in the merge-audit, the fix plan, or the Poyais Pass-2 chunk logs/rework notes (`_r7`–
`_r9-fix-plan`, `_watch-through-*-notes` — those cover a floating book PROP and cutout/motion
positioning, not character scene-placement) or the chunk-1 close-out (`decisions.md:2462-2510`, 4 skill
bugs found, none of them placement/scale/shadow). Poyais's Pass-2 chunks (~138 shots, dispatched
2026-07-14) DID run under the posed-card→scene mechanism, but the pivot away from it landed the very
next day, and no isolated review verdict on THOSE frames' placement/grounding/scale survives separately
from the base-bleed findings — plausibly because base-bleed was severe enough to dominate every review,
burying any placement-specific signal, or because it was genuinely fine and the mechanism was retired
for cost/complexity reasons (the probe, `decisions.md:2571-2576`) rather than a placement failure.
**Which of those is true is UNKNOWN — no file evidence resolves it.**

**Net read, combining both attempts.** Daniel's exact symptom language (thrown around / no blend / no
shadow / wrong sizing) is fully and precisely accounted for by **Attempt A** (2026-07-06, naive pixel
paste) — high confidence, verbatim match on all four points. What is genuinely untested in this repo's
history is the technique the task brief actually describes: card assembled by the ENGINE (full-body,
feet, blank background, angle-matched, baked shadow) then placed by the ENGINE in a second call with a
scene-terms placement prompt. Attempt A never involved the model in the join at all (pure paste).
Attempt B's stage 2 came closest to model-mediated placement but its cards were themselves compromised
by base-bleed before placement was ever cleanly tested, and no isolated placement verdict survives. So
the honest frame for the probe: **card-then-paste is proven bad (Attempt A); card-then-model-place is
untested (neither attempt cleanly isolates it) — that is exactly the gap the probe should close**, using
a card spec that inherits the CURRENT fix-design's seed law (full-body, feet, baked contact shadow,
angle-matched, no bald/neutral primitive in the pot) so Attempt B's base-bleed cause is designed out
before stage 2 is even reached.

---

## 2. TECHNIQUE RESEARCH — gemini-3-pro-image multi-image composition

### What we already knew, from our own dogfooding (internal, high confidence)

`docs/superpowers/analysis/2026-07-10-character-seeding-merge-audit.md` (Attempt B's post-mortem,
§1 above) established two facts about the RAW API that still hold — `forge.py:52-56` shows the current
payload shape and nothing has changed it:
1. **The request carries no per-image role, mask, or weight field.** `{"contents": [{"parts": parts}],
   "generationConfig": {...}}` where `parts` is `[image1, image2, ..., {"text": prompt}]` — every
   reference is an unlabelled blob at the JSON level. Any "role" a reference plays is communicated
   ONLY through what the TEXT prompt says about it (ordinally — "the first image," "the second image" —
   or descriptively), never through structured metadata.
2. **The engine does holistic blending, not slot-wise feature routing**, and under a **majority-vote**
   dynamic: when multiple seeds carry similar generic content (Attempt B's bald/cream/neutral pose +
   expression primitives), that shared content out-votes the one seed that differs (the character
   canonical). This is the mechanism, not a one-off bug — it is why single-dominant-seed + worded delta
   is the pattern that works everywhere else in this pipeline (canonical + pose + expression + plate in
   ONE gen, current fix-design fix 1) and why a "merge two generics against one specific" pass failed.

### What's new from vendor documentation (2026-07, gemini-3-pro-image / "Nano Banana Pro")

Web research on the current model (same `gemini-3-pro-image` id the registry names as `engine`):

- **Reference-image capacity and identity retention.** Up to 14 reference images per call: up to 6
  "object" images for high-fidelity inclusion and up to 5 "human" images for character-identity
  retention, claimed 95%+ appearance consistency across outputs. Comfortably covers our 2-cast-max card
  slate (1-2 cards + 1 plate = 2-3 images, well under any cap). [Nano Banana Pro Multi-Image
  Composition Guide](https://www.aifreeapi.com/en/posts/nano-banana-pro-multi-image-composition)
- **"Role-based image assignment" is marketed as a feature** — "a face reference image tells the model
  whose likeness to preserve, a background image sets the scene, a style reference dictates the
  artistic treatment." Read against fact 1 above, this is near-certainly a PROMPTING CONVENTION the
  model has been tuned to follow reliably (naming each image's job in the text), not a schema-level
  role field — the raw REST payload our own `forge.py` sends has no field for it. [Nano Banana Pro
  Prompting Guide](https://fal.ai/learn/tools/nano-banana-pro-prompting-guide) ·
  [DEV.to prompting strategies](https://dev.to/googleai/nano-banana-pro-prompting-guide-strategies-1h9n)
- **The model is specifically marketed to solve exactly Attempt A's failure.** "Nano Banana Pro solves
  the problem of pasted, floating figures by generating people with perfect shadows and lighting. The
  AI analyzes scene perspective and places figures naturally" (down to secondary cues like "cushions
  compressing under a figure's weight"). [CGwisdom — people in
  visualizations](https://cgwisdom.com/blog/people-in-visualizations-how-to-add-realistic-characters-in-nano-banana-pro.html)
- **Concrete prompting pattern for placement:** treat the prompt as a "directorial brief" — state what
  the subject is doing, the camera position, and close with an explicit **preservation lock** naming
  what must stay fixed (background, shadow placement). Separately: "match the new element's scale,
  texture, and contact shadows to the scene; a contact shadow at the base helps ground objects." [fal.ai
  prompting guide](https://fal.ai/learn/tools/nano-banana-pro-prompting-guide)

### What this changes about OUR probe, specifically

1. **The card+plate case is structurally different from Attempt B's merge case, in the one respect that
   caused Attempt B's failure.** Attempt B's Pass-1b merge seeded 2-3 images where 2 of them (`pose_ref`,
   `expression_ref`) shared generic bald/cream/neutral content — a real majority-vote bloc against the
   character canonical. Stage 2 here seeds a card (already a resolved, specific, full-color figure) +
   a plate (a place, carrying no competing "person" content at all). There is no generic-content bloc to
   vote against the card. This doesn't guarantee stage 2 will hold the card's identity/pose — but the
   SPECIFIC mechanism that broke Attempt B does not obviously apply here, which is exactly the kind of
   thing only a real gen answers, not reasoning.
2. **The placement prompt should name roles and camera/scale explicitly, in the text**, since that's the
   only channel a "role" travels through at all: "the FIRST image is the character, already posed and
   lit; the SECOND image is the destination place. Place the character from image 1 into image 2..." —
   this is a stronger, more explicit version of Attempt B's binding-delta ("body pose + hands from the
   POSE reference...") which DID work for the parts of Attempt B that succeeded (costume/identity
   transfer when the character seed was the strong one).
3. **Angle-matching the card to the scene's camera** is worth testing directly, not assumed: Attempt A's
   "paper-doll posing" symptom (front-facing regardless of context) is consistent with a card generated
   with no awareness of the destination's camera, and the registry has exactly the angle primitives
   needed to test this (`3q-turn-right`, `back-to-viewer`, default-frontal — see §3).
4. **A baked-in contact shadow on the card is an UNTESTED variable**, not a known-good — vendor material
   says the model can synthesize contact shadows when composing a scene fresh (its own generation, own
   lighting), which is a different claim than "a shadow pre-baked into a card, generated under
   flat/neutral card lighting, will transfer correctly onto a scene with its own different lighting
   direction." This could help (gives the model a stronger physical prior that this figure has weight)
   or hurt (a shadow baked at the wrong angle for the plate's light source is a fact the model now has to
   overrule rather than one it's asked to invent fresh). The probe should watch this per-shot rather than
   assume it either way.

Sources: [Nano Banana Pro Multi-Image Composition Guide](https://www.aifreeapi.com/en/posts/nano-banana-pro-multi-image-composition) ·
[Nano Banana Pro Prompting Guide (fal.ai)](https://fal.ai/learn/tools/nano-banana-pro-prompting-guide) ·
[Nano Banana Pro prompting strategies (DEV.to / Google AI)](https://dev.to/googleai/nano-banana-pro-prompting-guide-strategies-1h9n) ·
[People in visualizations — realistic character insertion (CGwisdom)](https://cgwisdom.com/blog/people-in-visualizations-how-to-add-realistic-characters-in-nano-banana-pro.html)

---

## 3. PROBE DESIGN — the deliverable

**Question the probe answers:** does seeding a pre-assembled character CARD into a scene gen (stage 2,
model-mediated placement) beat today's single-step composed-scene gen (canonical + pose + expression +
environment, all in one call) on Daniel's three named defects — placement, blend/grounding, sizing —
without reopening Attempt B's identity base-bleed? One axis (§E): two-step vs one-step, on otherwise
identical shots. Everything else (environment source, pose/expression choice, character costume) held
constant against the shipped frame.

### 3.1 The three test shots, and why each

All three are already in `board-verdict.md`'s condemned/parked set — genuinely bad frames, not
cherry-picked passes — and their existing shipped PNGs are the free control (no regen needed).

| Shot | Cast | Board-verdict defect | Axis it stresses |
| --- | --- | --- | --- |
| **L31** | `miniscribe-rep` (personified-institution lead, solo) | "base-template identity (parked, known class)" — `board-verdict.md:32` | **Identity collapse** — the canonical hard case (fix-design's evidence base treats L31-33/L40 as ITS reference identity-collapse class too). If a card+place two-step can't hold `miniscribe-rep`'s pinned costume/tone through TWO gens instead of one, it has made the worst defect class worse, not better. |
| **L60** | `qt-wiles` (standing, power-stance, lit) + `brick-foreman` (seated, worried) | "L60–68 many off rig" — `board-verdict.md:24` | **Two-cast shape + placement.** Shipped seeds: `qt-wiles.png, brick-foreman.png, expr-deadpan.png, action-powerstance.png` (manifest.json:1298-1303) — a fresh two-cast shot that, per fix-design fix 3's arithmetic, gives up its plate to fit both figures in 4 seeds. Two-stepping changes that arithmetic (cards absorb pose+expression, freeing seed slots for BOTH a plate and precise relative blocking — Wiles lit at the table head, brick-foreman near-end, both at correct depth). This is the shot type fix 3 flags as tightest on seed budget, so it is the sharpest test of whether cards actually buy back room. |
| **L133** | anonymous checkpoint officer (`expr-deadpan` only, no character canonical — the §2e/anon-tier shape) | **"L133 off rig, too tall (parked)"** — `board-verdict.md:27`, Daniel's own word for it | **Sizing + blend/grounding, in Daniel's own language.** Shipped seeds: `expr-deadpan.png, env-interior-cool.png` (manifest.json:2865-2868) — an environment-anchored single-figure shot with real depth cues (scanning tunnel, belt-height framing) to stress grounding. **Scoping note:** this shot's figure is the anon-tier `figures.anon_foreground` shape fix 3 abolishes — the probe tests the CARD→SCENE mechanism on it as authored today (same figure spec as the shipped frame), not a re-authoring under fix 3; that re-authoring is a separate, already-approved fix and doesn't need to be bundled into this mechanism probe. |

Together: 1 solo identity case + 1 two-cast case + 1 anon/environment-heavy case = the three cast shapes
fix-design's arithmetic distinguishes, plus all three of Daniel's named symptoms get a shot where they're
the headline defect.

### 3.2 Card spec (stage 1) — the shape, applied per-figure

One gen per figure needing a card (4 cards total: 1 for L31, 2 for L60, 1 for L133).

- **Seed:** `[character canonical, expression primitive, angle/pose primitive]` — the SAME "single
  dominant seed + specific primitives" pattern Pass 1/2 already use today (never a Pass-1b-style merge
  of two generic primitives against one specific — §2's finding on why that failed). `--mode
  environment` (NOT `--mode identity`, which hard-codes a bald round head per the documented bug at
  `decisions.md:2488-2490` — fatal for any haired/costumed cast member).
- **Full body, feet in frame, a scale/ground cue:** *"`<character>`, full standing figure, head to
  shoe-soles entirely in frame, weight on both feet planted flat on a thin visible ground line."* The
  ground line is the scale cue stage 2 reasons from — a figure with no visible ground reference is a
  figure with no stated scale.
- **Angle — one of the registry's 3 angle primitives, matched to the shot's camera, not defaulted
  blind:** `3q-turn-right` (three-quarter), `back-to-viewer` (rear), or plain frontal (the canonical's
  own angle, no extra pose seed). Justification for defaulting to **3q-turn-right** where a shot doesn't
  specify: `_angle_test/notes.md` (Attempt-A-era angle stress test, §1) found 3/4 the most robust
  general-purpose angle ("PASS, fully on-model") and pure profile the weakest ("a no-nose egg in pure
  profile reads slightly featureless/uncanny") — no primitive for pure profile exists in the registry
  anyway. L60's `qt-wiles` (power-stance, facing the room) and `brick-foreman` (seated, facing up the
  table) both read as 3/4-appropriate from the shot's own blocking language; L31 and L133 get
  3q-turn-right as the default per the same reasoning.
- **Baked ground-contact shadow, nothing else shaded:** *"one soft contact shadow directly beneath the
  feet on the ground line only — the backdrop itself carries no shadow, no gradient, no vignette."*
  Flagged as an UNTESTED variable in §2.4 — watch in review whether it helps or fights the plate's own
  light source; do not treat its presence as self-evidently correct.
- **Blank flat background:** *"flat solid pale-grey studio backdrop, no scenery, no props."* Explicitly
  a REFERENCE-SHEET framing in the prompt (*"this is a reference sheet: the character alone, fully
  resolved, ready to be placed into a separate scene"*) — distinct from the existing cutout system's
  magenta chroma field (that field exists for POST-hoc `rembg` keying into a pixel-layer composite; a
  card is fed whole into a second GENERATION, never keyed, so magenta would be actively misleading here).
- **Tier: 1K, aspect 2:3.** Character-sheet framing, not delivery framing — 2:3 matches the existing
  canonical/library convention; 1K is the cheap tier since the card is a WORKING asset, not a delivery
  frame.

**Per-card prompt (example, `miniscribe-rep` for L31):**
> `miniscribe-rep`, `expr-smug`, full standing figure, head to shoe-soles entirely in frame, three-quarter
> turned stance (`3q-turn-right`), weight on both feet planted flat on a thin visible ground line. Flat
> solid pale-grey studio backdrop, no scenery, no props, one soft contact shadow directly beneath the
> feet on the ground line only. This is a reference sheet: the character alone, fully resolved, ready to
> be placed into a separate scene.

(`forge.py` auto-appends the §2c RIG-HOLD block since this is a figure-bearing `environment`-mode gen —
no extra rig language needed in the delta.)

### 3.3 Stage-2 spec (placement)

One gen per shot (3 total), seeding the card(s) + whatever environment source the SHIPPED frame used (so
the only variable that changes vs. the control is card-vs-single-step — environment sourcing is held
constant, not also re-tested against fix 2's plate doctrine, which is a separate, already-approved
change):

| Shot | Seed slate | Seeds used / cap |
| --- | --- | --- |
| L31 | `[probe-card-L31.png]` + prose environment (L31 shipped with NO environment-anchor seed either — matched) | 1 / 4 |
| L60 | `[probe-card-L60-qtwiles.png, probe-card-L60-brickforeman.png, env-interior-cool.png]` | 3 / 4 |
| L133 | `[probe-card-L133.png, env-interior-cool.png]` | 2 / 4 |

**Placement prompt pattern** (per §2's finding that role/position must be stated in TEXT, since the API
carries no structural role field):

> *"The FIRST image is `<character>`, already posed, lit and fully resolved — carry its identity, costume,
> pose and expression EXACTLY as shown, do not re-draw or re-pose it. The [SECOND / SECOND and THIRD]
> image(s) [is / are] the destination place. Place `<character>` into it at <SCENE-TERMS POSITION> —
> <SCALE ANCHOR relative to a named element in the plate/scene, e.g. 'shoulder-height against the
> conference table's edge'> — with feet resting on <the named ground plane>, in contact with it (no gap,
> no float), casting a shadow that matches the scene's own light direction. <Occlusion note if
> applicable, e.g. 'the near edge of the table crosses in front of his legs below the waist'>. Match the
> plate's palette, outline weight and lighting exactly; do not restate or alter the character's identity,
> costume, pose or expression — those are already correct in image 1."*

Per-shot scale anchors and occlusion notes, drawn from each shot's own already-authored blocking:

- **L31:** scale anchor = office desk/doorway height (from the shot's own composed environment prose,
  held from the shipped delta); no occlusion note beyond standard foreground placement.
- **L60:** two scale anchors — Wiles "at the head of a long conference table... inside one harsh
  interrogation-style lamp's cone of light," brick-foreman "seated tense at the near end"; occlusion =
  the table edge crosses both figures' lower bodies; depth order stated explicitly (table foreground,
  seated figures mid-ground, Wiles lit at the head, background to shadow) since that ordering IS the
  placement risk this shot tests.
- **L133:** scale anchor = "beside the tunnel's monitor... tray and officer sharing the frame, tray
  foreground, officer mid-ground, tunnel background" (verbatim from the shipped delta) — this is the
  shot Daniel called "too tall," so the scale anchor is written as tightly as the original prose allows.

**Tier: 2K, aspect 16:9** (matches every shipped control frame — `manifest.json` confirms all three at
2752×1536/1548, i.e. 16:9).

### 3.4 A/B protocol

- **Control = the EXISTING shipped frame** (`assets/scenes/L31.png`, `L60.png`, `L133.png`) — already
  paid for, already condemned/parked by the board, no regen. This satisfies "no control regen unless a
  fair control demands it": it doesn't — the shipped frames are the exact single-step baseline the
  two-step variant is meant to beat, generated under the SAME cast/pose/expression/environment intent.
- **Treatment = the stage-2 output** from §3.3, one per shot.
- **One axis only** (operating-law §E): two-step vs. one-step. Card angle, pose/expression choice,
  environment source and aspect are all held IDENTICAL to what the shipped control used — nothing else
  changes, so a difference in the outcome is attributable to the card mechanism, not a confound.

### 3.5 Success criteria (6 images: 3 shipped + 3 two-step, side by side)

Daniel eyeballs a 2-column-by-3-row board (shipped | two-step, per shot). Per pair, the two-step frame
wins its shot if:
1. **Character identical to canonical** — ears, eyelids, digit count, proportion match the registry
   canonical, not a base-template revert (the L31 test is specifically whether this HOLDS across a
   second gen, not just the first).
2. **Standing plausibly** — feet in contact with a visible ground plane, a shadow that matches the
   scene's own light direction (not a mismatched or absent one).
3. **Scene-plausible scale** — the figure's height against a named scene element (table edge, tunnel,
   doorway) reads correctly, not "too tall" or dollhouse-small.
4. **Background coherent** — the plate/environment is not disturbed, re-drawn, or degraded by the
   placement gen; palette and outline weight still match the rest of the board.

**The falsifier — what kills the idea:** if **2 of 3** two-step frames reproduce ANY of Attempt A's named
defects (paper-doll posing, lighting/scale mismatch, absent or wrong-direction shadow) OR reproduce
Attempt B's base-bleed (identity/costume drift introduced BY the second gen that wasn't in the card
itself), two-stepping is rejected for this pipeline and fix-design fix 1's single-step law stands as the
answer to Daniel's original complaint — the $0.56 probe cost is the price of that answer either way.

### 3.6 Gen count + cost

| Stage | Gens | Tier | Unit cost | Subtotal |
| --- | --- | --- | --- | --- |
| Cards (L31 ×1, L60 ×2, L133 ×1) | 4 | 1K | $0.039 | $0.156 |
| Scenes (1 per shot) | 3 | 2K | $0.134 | $0.402 |
| **Total** | **7** | | | **$0.558** |

Well under the $5 ceiling — leaves room for the operating-law-mandated `--dry-run` pre-flight (free) and
even a full technical-failure retry of every gen (not a quality re-roll — a probe should show what
naturally comes out, not the best of N) and still land under $1.20.

### 3.7 Execution notes for the runner

- **Pre-flight, zero cost, mandatory before any spend** (operating-law §D): `py -3
  .claude/skills/image-generation/scripts/forge.py gen --kit
  channels/the-second-take/visual-kit --batch scratchpad/twostep-probe/cards_batch.json --dry-run` then
  the same for `scenes_batch.json` (scenes reference `_staging/<card-name>.png` paths, which the dry-run
  will report MISSING until cards actually land — run cards for real first, THEN dry-run scenes to
  confirm seed resolution before spending on them).
- **Cards batch** (`scratchpad/twostep-probe/cards_batch.json`, new probe-scoped file — see cleanup
  note below): a JSON list, each entry `{name, mode: "environment", seed: [...], delta: "...", aspect:
  "2:3", image_size: "1K"}`. Run: `forge.py gen --kit channels/the-second-take/visual-kit --batch
  scratchpad/twostep-probe/cards_batch.json --image-size 1K`. Output lands in
  `visual-kit/_staging/probe-card-*.png` — this is `forge.py`'s only output location for `gen`; no
  `register` step (these are throwaway probe assets, never promoted to `refs/`, per §F-clean "only
  named, locked assets persist").
- **Scenes batch** (`scratchpad/twostep-probe/scenes_batch.json`): each entry seeds the card(s) by their
  **`_staging/`-relative path** directly (forge's `resolve_seed` accepts a kit-relative path with no
  extra step — this is exactly how the existing "two-gen identity pass" technique already seeds
  `_staging/L31-genA.png` as a mid-pipeline reference, per `manifest.json:660`). Run: `forge.py gen --kit
  channels/the-second-take/visual-kit --batch scratchpad/twostep-probe/scenes_batch.json --image-size 2K
  --aspect 16:9`.
- **Review medium** (operating-law §H): build an Artifact — a 3-row, 2-column board (shipped | two-step)
  with each shot's id and one line naming what to look at (identity / two-cast+placement / sizing).
  Never a bare file-path dump for a taste call.
- **Cleanup after the verdict** (§F-clean): `_staging/probe-card-*.png` and the probe's `scenes_batch`
  outputs are scratch regardless of outcome — a WIN routes the mechanism into the repair wave's real
  card build (new cards generated fresh under the locked doctrine, not these probe throwaways promoted
  as-is); a LOSS deletes them outright. `scratchpad/twostep-probe/` itself is removed once the verdict is
  logged.

---

## 4. INTEGRATION SKETCH (if the probe wins)

**No new fix, no new file.** Two-stepping routes into the four already-approved fixes exactly where
fix-design.md's own open question already pointed (its wave-scope note: *"the two-gen ladder may no
longer be necessary... Probe it on ~6 shots; do not assume it"* — this probe IS that check).

1. **Fix 1 (seeding law, `forge.py` predicate)** — one clause edit, not a new branch. Option **(a)
   FRESH** currently reads "canonical + a `kind: pose|action|interaction` frame + a `kind: expression`
   frame are all in the seed list." It becomes: *"that figure's CARD (a pre-merged canonical+pose+
   expression asset) is in the seed list — OR, when no card exists for that combo, canonical + pose +
   expression directly (today's law, kept as the no-card fallback)."* Same predicate, same file, same
   $0-cost hard-error; the law never gets weaker, it gets a second way to satisfy itself.

2. **Fix 4 (`forge batch`)** — stage 1 becomes the FIRST step of the slate builder, not a new pass. Its
   stated priority order (`[character canonical(s)] > [plate] > [pose/interaction primitive] >
   [expression frame]`) gains one step ahead of it: for each `(character, pose, expression)` combo a
   shot's `assets` tags name, `forge batch` first checks the registry for an existing card (the SAME
   `lookup`/reuse-before-regenerate mechanism Pass 1 already runs for canonicals — no new mechanism, one
   more `kind` to check); a hit collapses that figure's 3-seed cost (canonical+pose+expression) to a
   **1-seed** card reference. This is the arithmetic payoff fix 3 needed and didn't have: a fresh 2-cast
   shot today spends all 4 slots on `[canonical A, canonical B, shared pose, shared expression]` and
   forfeits the plate (fix-design fix 3's table, "what it gives up"); with cards, the SAME shot spends
   `[card A, card B, plate]` — **3 of 4**, with one slot still free for a crowd exemplar or a second
   plate-adjacent anchor. A miss (no card yet) falls through to today's raw canonical+pose+expression
   slate — the fallback fix 1's clause 1 already covers.

3. **Cards live in the registry, no new storage shape.** `registry.json`'s `assets[]` already carries a
   free-form `kind` field (`cmd_register`'s `kind = e.get("kind", "expression")` passes any string
   through unchanged today — **zero code change** to accept `kind: "card"`). Naming convention borrows
   Attempt B's proven scheme (`<character>--<pose|none>--<expr|none>`,
   `docs/superpowers/plans/2026-07-10-pose-expression-seeding-two-step.md:18`) — the one part of that
   attempt that was never the problem. Storage: `refs/<character>/cards/<name>.png`, a subfolder under
   the character's EXISTING `refs/<character>/` tree (`forge.py`'s `register` already writes to
   `refs/<subdir>/`; `cards/` is one path-join, not a new top-level convention). `_is_char_seed` already
   treats anything under `/refs/` as a figure seed — no change needed there either.

4. **The ladder becomes obsolete — DELETE, don't keep both.** `image-generation/SKILL.md`'s "Two-gen
   identity pass" (current lines ~156-161: gen A composes an environment-heavy scene, gen B re-seeds
   `[gen-A frame + canonical + expression]` because the heavy delta "starves the lone character seed")
   exists to patch exactly the failure mode a card removes structurally — a strong single-figure seed
   diluted by a long prose delta. A card-seeded placement gen never asks the model to re-compose identity
   from words at all; the placement delta is environment/position ONLY (§3.3's prompt pattern). If the
   probe confirms this, **delete the "Two-gen identity pass" subsection outright** and its two
   cross-references in fix-design fix 1's evidence ("ladder genB... re-seeds only `kind == expression`
   assets") and fix 4's edit shape ("ladder genB re-seeds the pose primitive, not only expressions") —
   those sentences describe a mechanism that no longer exists. Net: one subsection + two pointers
   deleted, against one clause (item 1) + one priority-list step (item 2) added — roughly file-neutral,
   which is the bar Daniel's red line sets.

**What does NOT change.** VPW's authoring (`visual-prompt-writer/SKILL.md`), `shots-schema.md`, and
style-bible §5 are untouched — VPW keeps naming cast/pose/expression inline as backticked registry
vocabulary exactly as fix-design already has it; `forge batch` derives the card need from the SAME
resolved tuple it already reads off `shots[].assets`. This is deliberately NOT Attempt B's schema
(no `cast`/`pose_ref`/`expression_ref`/`needed_assets` fields revived — those were removed in the wave-3
schema cleanup, `retired-features.md:129-134`, for reasons unrelated to this probe and there is no reason
to re-open that). Two-stepping is an `image-generation`-internal seed-resolution choice, invisible
upstream — the same boundary Attempt B itself got right (its own non-goals: "No `forge.py` change... No
`render-builder` change") and the boundary this integration keeps, except this time `forge.py` DOES
change — inside fix 4's own already-approved new subcommand, not a new file.


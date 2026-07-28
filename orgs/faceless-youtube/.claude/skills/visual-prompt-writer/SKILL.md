---
name: visual-prompt-writer
description: Writes a scripted video's complete visual plan as videos/SLUG/shots.json. Covers the long-form still and B-roll shot list, motion-intent metadata, retention cadence, thumbnail generation prompts, and scripted-short visuals. Use for visual prompts, shot lists, storyboards, on-screen choices, B-roll, thumbnail prompts, or image-generation prompts in any niche. Runs after script and metadata work and before voiceover, image generation, and rendering. Do not use it to write scripts, choose titles or tags, generate pixels, or assemble video.
---

# visual-prompt-writer

Turn ONE scripted video into a **complete, render-ready visual plan** — the long-form shot list, the
thumbnail generation prompts, and every scripted short's visuals. One skill for every channel; the niche
is **data** in `channels/<name>/`, never forked into code.

## Mental model

`long-form-writer` left `[B-ROLL]` cues; `metadata-writer` left thumbnail **concepts**. You are the
bridge between words and pixels: the **still-frame plan plus intent metadata** that `image-generation`
turns into verified stills and the local **Remotion engine** turns into motion.

**Engine reality — author only what renders.** Per shot the engine plays the verified still with any
in-video text **baked diegetically into the image** (stamps, signs, ledgers, banners); the camera is
locked (motion-planner may make a rare stage-start exception); an idle micro-motion baseline runs under
every frame; animated cutout **layers** and drawn routes are planned downstream by `motion-planner`;
shorts carry burned word-highlight captions. Every change arrives **AT the cut** — a stage delta is the
next still simply *having* the new element.

**Author intent, never mechanism.** The engine owns treatment (camera, entrance, timing) and
`audio-director` owns sound: never write easing names, amplitudes, camera moves, seeding instructions,
or audio choices. A shot whose meaning depends on unauthorable mechanism is broken output — restage it.

## The authoring laws

**The seven laws — held tableau · scene facts · acting · casting · delta decisiveness · hook bar ·
disclosure order** — are the taste/logic core the Step 8 critic reviews. Use these exact names everywhere
(`references/critics.md` maps its questions to them) and never coin a variant set.

1. **Held tableau.** Every still, a short's `first_frame` included, reads as a deliberate composition
   frozen for its full duration — a held pose carrying the action's meaning (a salute, a planted stance,
   presenting a deed). A freeze of continuous motion is broken output.
2. **Scene facts.** State every fact load-bearing for the beat, precisely enough that a stranger could
   verify the image against the prompt: layout, orientation (who faces whom; a vehicle points where it
   travels), what a gesture or highlight targets ("the northern half of South America", not "the
   continent"), casting/costume, framing + scale per the class (`visual-grammar.md §2`), the committed
   scene palette (2–3 colours + the one red accent), light/atmosphere, and depth (fore/mid/background,
   filled edge-to-edge). Name concrete elements, not categories. A thin, palette-less prompt renders
   thin; an inventory that doesn't carry the beat is bloat.
3. **Acting.** Expression and pose track the beat and the channel's register map, sized to its gravity —
   restrained by default, strong faces reserved for real peaks — and are **selected** as registry
   `pose_ref`/`expression_ref` assets, never prose. One default face on every beat is a defect; so is a
   caricature on every beat.
4. **Casting.** Every story-named or story-referenced figure, diegetic media included (a brochure's
   prince, a portrait), is cast from the channel registry; a recurring identifiable **group** is ONE
   `cast` entry (no refs), a recurring identifiable **prop** goes in `props`, roles read at a glance via
   1–2 signifiers. Anonymous figures stay prose and route by SIZE per `style-bible.md`'s three-tier rig
   model — small/many/background crowds take the **§2d crowd-rig clause** verbatim in the `still_prompt`,
   a LARGE/foreground anonymous figure the **§2e base-rig clause**; VPW authors both.
5. **Delta decisiveness.** A world-flip delta flips the frame — a full palette turn, the paradise fully
   gone. Timid partial coexistence makes the reveal mushy.
6. **Hook bar.** The hook shot (and each new-loop opening) shows something whose meaning is unexplained,
   posing the question the VO answers a beat later (§1b), at a scroll-stop standard: the most arresting
   staging of the beat, not the first competent one.
7. **Disclosure order.** A shot contains only what the VO has introduced by its `vo_ref` position; where
   the script **deliberately withholds** a payload (an identity, a fate, a twist object/number/place),
   that entity appears in **no** earlier shot in any pose or form — re-author the shot with it absent,
   never merely obscured. An ordinary first introduction is not withholding.

**Depiction is a DECISION, not a transcription — non-literal is the default, literal reserved for
concrete physical action and objects** (Step 2.5). Visuals are a primary retention lever (§6a): densify
past the cues to a 2–5s cadence, new stimulus every 30–45s, front-loaded in the first 60s. Every prompt
inherits `dna.md`'s house style — §13 makes a locked signature a **monetization prerequisite**
(templated stock B-roll is the July-2025 policy trigger).

**Mechanical render-contract rules — each silently breaks the render if skipped:**
- **Reveals are realized structurally** (§13a-i-c): an enumeration or reveal that must be SEEN lands as a
  **delta chain** (a `base` holds the set, each named element arrives in its own `delta` with its own
  verbatim `vo_ref`; one change per delta, ≤3 deltas) or as **baked diegetic text**.
- **Cadence + coverage (lint):** 2–5s per shot, at least `Estimated runtime ÷ 5s` shots, Σ `duration_s` ≈
  `Estimated runtime`. A short-summing list forces `render-builder` to stretch every shot, leaving one
  visual dead 15–25s — **densify, never lengthen holds**; a hold over ~6s needs a real progressive reveal
  or a `hold_reason`.
- **Literal-check gate (Step 2.5):** a shot that merely draws the *words* of an abstract, relational,
  quantitative, or claim-type line FAILS → reclassify. **Every prompt carries the
  `global_prompt_suffix`** — long-form, thumbnail, and shorts alike.
- **Anchor fidelity + narration order (lint):** every `vo_ref` is a verbatim copy of its VO line's opening
  words (≥4, exact wording and order) and shots run in strict narration order; `render-builder` times each
  cut off the first 4 normalized words, so a bad anchor mis-places the shot and enough misses drop the
  video to crude proportional timing.
- **All in-video text is diegetic and baked into the image**, quoted VERBATIM and ≤4 words
  (lint-enforced, uniformly including a short's `first_frame` caption). Never describe fonts or lettering
  style — the channel's hand is pinned and seeded automatically (style-bible §6).
- **Supplied-text law (lint, HARD):** never name a text element without supplying its value verbatim,
  inline, adjacent to its own element. "A large marker scorecard number" tells the engine to draw glyphs
  and not which, so it **invents them every time** — that is how a fabricated fact reaches a real
  person's frame. No ledger value → omit the element or author it deliberately blank; never invent one.
  Rule + three resolutions + lettering laws L-1…L-4: `references/shots-schema.md §4`.
- **The shot critic runs before any pixel is bought** (Step 8, mandatory).

## Step 0 — Identify channel + video
**Channel** from the request → `channels/<name>/`. **Video:** the scripted one — a `videos/<slug>/`
folder with a `script.md`. Given a slug use it; several scripted with no `shots.json` → do the one named,
the most recently scripted, or ask. **No `script.md` → stop** and say the video must be scripted first.

## Step 1 — Read (always)
- **`script.md`** — source of truth: `[B-ROLL]` cues are the base shot list, the VO says what each shot
  depicts and when, the beat structure where to escalate, `[PAUSE]` where a reveal can land.
- **`metadata.json`** — thumbnail concepts (primary + 2 challengers) and each short's block; honor them.
  Absent → derive from `script.md` + `brief.md` and flag `thumbnail_source: "derived-from-script
  (metadata.json absent — reconcile)"`. **`shorts/short-NN.md`** — cues, archetype, caption text,
  `publish`|`bench` status; write visuals for **every** short and carry the status. **`dna.md`** — the
  locked house style, locked lever, audience/region.
- **`niche-playbooks/universal.md`** (every run) — §1b visual anchor before context · §6a interrupt every
  30–45s · §8 thumbnail spec · §10 cadence · §12 no static B-roll in the first 3–5s · §13 one locked
  house style · **§13a** the narration→shot-class table · **§13a-ii's binding cadence law**.
- **`visual-kit/visual-grammar.md`** — the channel staging law (pose menu, eye-line, expression-by-beat
  register, role legibility, composition §2, lever/register translation); it overrides generic §13a on
  channel specifics, never §13a-ii's pacing law. Read **`registry/registry.json`** beside it for the live
  cast/prop/plate vocabulary and take `global_prompt_suffix` ingredients from **`style-bible.md §6`**.
- **`niche-playbooks/<niche>.md`** (conventions + policy quirk) · **`playbook.md`** (originality, AI
  disclosure, YMYL) · **`references/shots-schema.md`** (the contract — follow it exactly) ·
  **`performance.md`** (reuse what proved out).

## Step 2 — Set the house style (once, top of the file)
Distill `dna.md`'s visual style + niche conventions into `house_style` and a **`global_prompt_suffix`** —
a short consistent style string (palette, medium, lighting, era, texture) appended to every generation
prompt. Commit to ONE lane (§13): **stylized/illustrated** for abstract niches or **real
footage/screencap/archival** where the value IS the realism — **never the uncanny middle**. If `dna.md`'s
register is `TODO`, pick the lane the niche implies and flag `house_style_source: "inferred"`.

## Step 2.5 — Decide WHAT each shot depicts (the narration→shot grammar)
Runs per VO line, before any prompt; governs every shot in Steps 3 and 5.
1. **Classify → pick a class.** Name the line's narration TYPE, look up its shot CLASS in the **§13a
   table** (read it; never reproduce it from memory), and record the class by its canonical name from the
   `shot_class` enum in `references/shots-schema.md §1`.
2. **Invent a FRESH, on-style shot in that class.** The class carries its composition — realize it
   (physicalized-imbalance → relative size; staged-interaction → an active interaction, never two figures
   parked). Two same-typed lines must produce visibly different images.
3. **Literal-check gate (mandatory)** — reclassify any shot that merely draws the words of its line.
4. **Cast it** per the casting law. Named cast wear their pinned canonical outfits unless the shot
   authors a change; a group member acting alone is cast solo.
5. **Stage the tableau + act it by SELECTING library assets.** Record each prominent figure's
   **`pose_ref`** (the held pose carrying the action's meaning) and/or **`expression_ref`** (the face for
   this beat) on its `cast` entry — image-gen seeds them, so pose/hands and expression are the assets'
   job, not the prompt's. Scene-first: the shot's meaning picks them, never the reverse; both optional. A
   two-figure interaction uses an **interaction** asset referenced by BOTH entries, and **`cast` ORDER
   binds the slots — first = left, second = right.** Nothing close in the registry → a `needed_assets`
   entry.
6. **State the facts (scene + placement only) — and supply every value you name.** Take each literal from
   `research.md`'s fact ledger, quote it inline beside its element, cite `[F-NN]` in `notes`; no ledger
   fact means cut the element. Do **not** describe body pose, hand/finger mechanics, or facial expression
   — seeded in step 5, and authoring them twice is the double-authoring trap.
7. **Realize any reveal structurally** — stage deltas or baked diegetic text; intent only. **Record**
   `narration_type` + `shot_class` on the shot.
8. **Channel translation** (`visual-grammar.md`'s lever/register section): cast on the locked rig;
   ironic-counterpoint as the signature move where the lever is vindication; humor at the channel's dial
   (evergreen, no memes); the desaturated own-style gravity register, never real footage, for grim beats.
9. **Anti-slop guardrail:** the grammar is the reusable asset, the images disposable and story-specific —
   if the shot list starts reusing one depiction across videos, vary the content, keep the relationship.

### The pose/expression gate (hard stop before generation)
When a shot needs a `pose_ref`/`expression_ref` the registry LACKS, record it in `needed_assets` (`kind`
+ `slug` + `wants` + `why`) and **end the run there — do not proceed toward generation.** A human either
**approves** (the asset is generated on the base, rig-gated, registered, and a later invocation resumes)
or **vetoes**, in which case VPW **restages that beat using ONLY existing library assets** and may not
re-request an asset for a vetoed beat (the convergence rule — no endless surface→veto loop); a beat that
genuinely cannot be staged from existing assets is flagged back. Interactions run the same path as
`kind: interaction`. This is the only route new base assets enter the library (`style-bible §7`).

## Step 3 — Long-form shot list (expand the cues, then densify)
Walk the script top to bottom running **Step 2.5 on every shot**, tagging each shot's `beat` from the
fixed vocabulary, applying the hook-bar and disclosure-order laws as you go.
- **Expand each `[B-ROLL]` cue** into a full shot (`from_cue: true`) anchored by a `vo_ref` copied
  VERBATIM from `script.md` — that VO line's opening words (≥4), never reworded or pronoun-swapped — and
  **author in strict narration order**: each anchor at or after the previous shot's script position, a
  densify insert at the *true* position of the line it illustrates.
- **`vo_text` is DERIVED** by `lint_shots.py --write`, never authored, never a depiction brief — the
  image is anchored to its one moment. A long span (>~8s on one anchor) means **densify** or confirm a
  progressive reveal, never cram more meaning into one prompt.
- **Densify to the cadence and cover the runtime.** Cues are the floor: insert `from_cue: false` shots to
  hit the cadence rule above (a 20-second passage with one cue needs 3–5 shots), and never leave static
  ambient B-roll under the first 3–5s. Runtime source of truth is the script header's `Estimated runtime`
  (words ÷ 150 wpm — compute it yourself if absent; trust the word count over a disagreeing header).
- **Stage the run — held evolving stages (the anti-choppiness lever).** Group consecutive shots sharing
  ONE setting/subject under a common `stage` id, mark the first `stage_role: "base"` and the rest
  `"delta"`, and give each delta **exactly ONE** world-change in `changed_elements`, anchored to its own
  word: a bank on "bank" and a coin on "its own money" are TWO deltas, each its own shot with its own
  verbatim `vo_ref`. A beat adding several things at once is several fast deltas or a hard cut to a new
  base. **An ADDITIVE beat is a shared-`stage` delta — author the addition, not the whole scene:** same
  `stage`, name ONLY the added element, never re-describe the established set. Hard-cut to a NEW stage
  only when setting, subject, or register genuinely changes; cap a chain at **≤3 deltas**, then a fresh
  base or a hard cut. Deltas run 1.5–3s, the base/hold frame 4–12s.
- **Diagram-first niches may hold longer per cut** — an annotated schematic that progressively reveals
  can hold 10–14s because the in-shot annotation is the stimulus refresh; set the longer `duration_s`,
  author the reveal, record `hold_reason` past ~6s. Event/reveal/silence shots stay 2–5s.
- **A character enters on their NAME** — a first appearance anchors to the naming line, staged with
  intent (a big reveal gets spotlight / low angle / arrival into a held scene), wearing the
  canonical/default expression unless the beat authors otherwise. Reserve the most striking imagery for
  the hook, the mid-video re-arm (55–65%), and the withheld peak in the final 20%; use **match-cut
  callbacks** (§6a).
- **Tag a source for every shot** (taxonomy in the schema): blend real stock for anything meant to look
  real, reserve `ai-gen` for stylized/impossible/illustrative shots, use `chart`/`screencap` for data and
  receipts, and give `stock`/`hybrid` shots a `stock_query`.

## Step 4 — Thumbnail generation prompts (from metadata's concepts)
Convert the primary **and both challengers** into full `gen_prompt`s honoring **§8**: proof-of-human
beats fully-AI by 18–22% (a real subject + AI or graphic background; a faceless channel uses its locked
signature artifact); neo-minimalism — one dominant subject, **≥50% negative space, ≤2 primary colors**,
channel palette. **Zero-text often wins**; if text helps, carry metadata's thumbnail text at **≤3 words,
no all-caps** — **you own that cap**, so trim a longer concept promise or drop to zero-text, note it in
`composition`, and never restate the title. Use the working devices where they fit (single-artifact focus
+ red circle on the anomaly, before/after split only when the delta is obvious, numbers as objects) and
avoid the dead list (§8c): open-mouth shock, rainbow arrows, cluttered frames, all-caps. Set
`source: "hybrid"` (or the channel default) and respect the niche policy quirk.

## Step 5 — Shorts visuals
For every short write a `first_frame` block **and** an ordered shot list, running **Step 2.5 on every
short shot**. **First frame IS the thumbnail** (§8/§11): a pattern-interrupt tableau already carrying the
beat's tension — a held pose loaded with the story's wrongness, not a freeze of motion — with the caption
**baked diegetically, quoted verbatim, ≤4 words**, winning the swipe in ~1.3–1.8s; no static opening.
Then **a cut every 2–4 seconds** (§11c), same per-shot fields as long-form, **9:16**, on the house style
and locked lever, carrying each short's `archetype` + status.

## Step 6 — Policy, originality & consistency (not optional)
- **Originality moat (July-2025):** compose original frames carrying the channel's POV — never instruct
  "recreate <rival>'s thumbnail/shot" or clone a named channel's signature format (generic archetypes are
  fine; cloning is the inauthentic-content trigger). **AI-synthetic disclosure:** set `synthetic: true`
  on any photoreal AI shot so render-builder / publish-queue honor the `metadata.json` flag; for YMYL
  niches assume the viewer sees the label first.
- **Niche imagery gate:** engineering = analysis-not-gore; horror/lore = suggestion over depiction;
  health = clinical, no body-horror; business = no defamatory depiction of real named people. Flag
  borderline shots in `notes`. **Illustrate the VO, never extend it** — baked diegetic text included:
  never put a casualty count, date, name, or statistic on screen that the script omitted.

## Step 7 — Write the file + lint
Write **`videos/<slug>/shots.json`** per `references/shots-schema.md` (`house_style` + `long_form` +
`thumbnail` + `shorts[]`; `status: "shots-drafted"`, `timing_status: "estimated-from-script — re-time
after render"`). **Then run the lint (mandatory):**
`python .claude/skills/visual-prompt-writer/scripts/lint_shots.py videos/<slug>/shots.json --write`. It
enforces the mechanical rules above and injects the derived `vo_text` + `shot_counts`. **Any HARD failure
degrades render sync — fix it before handoff.** A heads-up (a shot covering >~8s of VO) means densify
there, never widen the image's scope.

## Step 8 — Shot critic (mandatory; before any generation token is spent)
Dispatch the **fresh-eyes shot critic** per `references/critics.md`: one subagent with no share in this
run's authoring context, given `shots.json` + `script.md` + the channel staging law + the seven authoring
laws, answering the charter's six per-shot questions plus its plan-level checks. Edit `shots.json`
through its findings yourself — the critic never writes prompts — then **re-run `lint_shots.py --write`**
and note any finding you rejected, with the reason. Leave the idea-backlog status at **`scripted`**; the
folder is then ready for `voiceover` + `image-generation` → `render-builder` → `publish-queue`.

## Output to the user
Short summary only: the `shots.json` path; the long-form shot count (densified inserts vs cue
expansions); the thumbnail primary one-liner; shorts visualized with total short shots; **confirmation
`lint_shots.py` passed** plus any densify heads-up; **the critic pass result** (N findings, how each was
addressed or why rejected). **If `needed_assets` is non-empty:** STOP and surface each wanted asset
(`kind` + `wants` + `why`) for the human gate — do **not** hand off to `image-generation`.

## Output contract
`videos/<slug>/shots.json` — one JSON object: `house_style` + `global_prompt_suffix`; ordered
`long_form.shots[]`; `thumbnail.{primary,challengers[2]}`; `shorts[]` (`file`, `archetype`, `status`,
`first_frame`, `shots[]`). **The full field list and the field→engine mapping are canonical in
`references/shots-schema.md` §1–§2** — write against that, not against this summary.

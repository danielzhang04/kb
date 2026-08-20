---
name: visual-prompt-writer
description: Writes a scripted video's complete visual plan as videos/SLUG/shots.json — reads the pure-prose script.md and derives the full shot list itself. Covers the long-form still and B-roll shot list, retention cadence, thumbnail generation prompts, and scripted-short visuals. Use for visual prompts, shot lists, storyboards, on-screen choices, B-roll, thumbnail prompts, or image-generation prompts in any niche. Runs after script and metadata work and before voiceover, image generation, and rendering. Do not use it to write scripts, choose titles or tags, generate pixels, or assemble video.
---

# visual-prompt-writer

Turn ONE scripted video into a **complete, render-ready visual plan** — the long-form shot list, the
thumbnail generation prompts, and every scripted short's visuals. One skill for every channel; the niche
is **data** in `channels/<name>/`, never forked into code.

## Mental model

You are the bridge between words and pixels. `script.md` is **pure prose** — no `[B-ROLL]` cues, no
`[PAUSE]` tags — so you derive the ENTIRE shot list yourself, line by line, against the channel's
depiction grammar. Each shot is ONE still the engine holds for its duration, with any in-video text
**baked diegetically into the image**; `image-generation` turns the prompts into verified stills and the
Remotion engine plays them.

**Author intent, never mechanism.** The camera is locked, transitions are hard cuts, and every change
arrives AT a cut. Never write easing, camera moves, seeding instructions, or audio choices — the engine,
`motion-planner`, and `audio-director` own those. A shot whose meaning depends on unauthorable mechanism
is broken output: restage it.

## Step 0 — Identify channel + video
**Channel** from the request → `channels/<name>/`. **Video:** the scripted one — a `videos/<slug>/`
folder with a `script.md`. Given a slug use it; several scripted with no `shots.json` → do the one
named, the most recently scripted, or ask. **No `script.md` → stop** and say the video must be scripted.

**SCOPED-REPAIR mode:** request names specific shot ids AND `shots.json` already exists → read the
file and re-author ONLY those shots, everything else staying byte-identical. Every step below
(1–8, including the per-act self-audit) scopes to the touched shots — apply the full current law,
reusing the cast list already declared in `vpw-log.md` (never re-declare), then
write back in place. The target list arrives from the caller (board verdict, forge violation list);
VPW never picks its own targets. **Absent named targets, author the full list as below** — the
default; scoped-repair is opt-in.

**Process law — re-author, never substitute.** A repair round re-authors each touched shot fresh from its
own `vo_ref`'d VO line. **Bulk vocabulary substitution is banned** — a mass find/replace across many
shots' prose (a generic→named swap, a wholesale term change) is not authoring; it is the mechanism that
produced a wrong-cast wave last time. One shot's fix touches that shot's prose, derived from that shot's
own VO span, never copied across siblings.

## Step 1 — Read (always)
- **`script.md`** — the source of truth; every VO line, in order, is the shot list's spine.
- **`visual-kit/visual-grammar.md`** — the channel depiction law: the narration→shot-class table, the
  literal/non-literal bar, chain logic, staging, composition, `global_prompt_suffix`, policy.
- **`example-shots.md`** — the depiction bar (script line → ideal shot). Match the thinking, never clone.
- **`dna.md`** visual block — the visual-kit pointer + the channel's imagery policy constraints.
- **`visual-kit/registry/registry.json`** — the live cast/pose/expression/prop vocabulary you name inline.
- **`references/shots-schema.md`** — the v2 contract; follow it exactly.
- **`research.md`** (when present) — the fact ledger every on-screen literal must be quoted from.
- **`shorts/short-NN.md`** — each short's archetype, caption text, and `publish`|`bench` status.

**Fresh authoring never reads an archived/quarantined prior `shots.json`.** `script.md` alone is the
source of the shot list; only SCOPED-REPAIR reads a file, and only the CURRENT one. Reading a discarded
file re-admits its drift by copy — the same mechanism that produced the bulk-substitution regression.

## Step 2 — Decide what each line depicts (run per VO line)
1. **Classify → pick a class** from the grammar's narration→shot-class table; record it as `shot_class`.
2. **INVENT the shot** against the example-shots bar. Reach first for the restored non-literal moves:
   symbolic stand-in, map/plan, number-or-text object, reaction, empty-world/aftermath, or hero-object.
   Literal re-enactment is one option, reserved for a concrete physical action or object. A shot that
   merely draws its line's words fails → reclassify.
   **The beat's true subject bears the frame** — a person, an object, or a place: where the subject is a
   person, a party, a decision, or an act, the bodies doing it are what stages it; where it is genuinely a
   thing, place, or mechanism, that is. Non-literal changes the DEPICTION, never the scene's occupancy:
   "the people selling picks and shovels" staged as an unattended stall has deleted the line's subject.
   Full law + the >~10s self-audit flag: `visual-grammar.md §1`.
3. **Reference figures, poses, and expressions by registry vocabulary NAME, backticked, inline** in the
   prompt prose ("MacGregor, `expr-smug`, `action-salute`, stage-left, facing right"). **On a
   registry-backed (named cast) figure, never describe body pose, finger mechanics, or facial
   expression in words** — that figure's seed carries them, and naming the asset IS the authoring act.
   Pose, expression, interaction, and costume are CLOSED-WORLD: the named primitive must already resolve
   in `registry.json` or the video's approved library manifest, and a figure keeps its registry-pinned
   costume. Snap the sentence to the nearest primitive. If none is close, name no invented token or prose
   pose; put `ELEVATION — primitive needed: <act>; BLOCKED until minted + approved` in `notes`. A new named
   CAST member still follows the standard cast-generation wave without a separate human slot (G2,
   2026-08-12) and is planned at Step 3a.
   **COMPOSE the figure's sentence FROM that vocabulary.** The bodily act a sentence gives a figure IS the
   primitive bound to it, written around the backticked name ("stands `action-powerstance`, `expr-smug`, at
   the head of an assembly line"), never a second act the seed cannot hold. The card is minted holding the
   act its sentence authors (`forge.py`), so prose that asks for a different one re-poses a stance card —
   which redraws the hands, and with them the head that sits on the body. **Naming the primitive never
   REPLACES the act:** the sentence still says what the body is DOING, phrased inside that primitive's own
   vocabulary ("`hold-both-hands`, carrying a cardboard box of desk things") — a clause that names the pose
   and describes no act mints the card against the pose REFERENCE alone, and the pose does not land.
   **Conform the sentence to the CLOSEST existing primitive.** A beat no primitive can carry is the
   blocked elevation above; the primitive is minted and approved before the shot can be authored.
   **A crowd-rig figure has no seeded pose or expression, so plain scene prose is its ONLY expression
   channel** — write the beat's simple expression ("grinning", "worried", "deadpan") and the group's
   whole-body attitude, exactly as any other scene fact. An unauthored crowd renders uniformly neutral,
   which is how a comic beat arrives dead.
   **An `interaction` slug is two-figure geometry, not a pose:** author it only on a fresh two-figure stage
   BASE, never on a solo shot and never on a delta (`visual-grammar.md §2` figure-cap table; lint and forge
   both HARD-refuse the other shapes).
   **Declare crowd figures with `"crowd": true` in the shot's `figures` field.** Stage its distance against
   the single crowd-distance law in `visual-grammar.md` §2. **Crowd is for genuine MASSES.**
   **One seeded figure is the default, cheap staging for a human beat.** An anonymous individual who
   performs, reacts, or decides is promoted to CAST — existing where the story identifies one, otherwise
   a new named member from the standard cast wave — never the bare `` `base` `` rig. Crowd is the
   exception, chosen only when the visible mass itself is the story point. Tier law: `visual-grammar.md §2`.
   The style-bible §2d rig-clause TEXT never appears in a prompt — you declare, and `forge.py` expands it at
   gen time (lint HARD-fails the clause fingerprint). Stay inside the grammar's figure cap and flag its
   high-risk case in `notes`. Field spec: `shots-schema.md §2`.

   **Seed-cap displacement (plan at authoring time, not at forge's dry-run):** over `SEED_CAP` (4), forge
   drops ONE seed at a time in priority order — never all at once, never past what the overage requires —
   and records each drop rather than erroring: (1) the crowd exemplar, when the place plate OR the
   in-chain parent frame carries the rear-zone mass (either already holds that mass in pixels; the
   exemplar only pins proportion); (2) an
   interaction template, since its contact geometry also lands in the shot's own prose and in the two named
   figures' own STEP-1 cards; (3) a tagged prop, since the prompt already names it by its own backticked
   slug and forge's derived seed is a reinforcement, not its only carrier. **Never displaced, at any step:**
   the place plate/chain parent, the LOCKED §5 lettering exemplar, or any character STEP-1 — a shape that
   only fits by dropping one of those refuses instead, naming the true bind (figure count against the cap),
   never a locked seed.

   A shot still over cap once crowd, interaction, and prop are ALL legally exhausted is restaged — the
   true bind is figure count against the cap, never a dropped lettering exemplar or place plate.
4. **State the scene facts the beat needs — CONTENT only** — layout, orientation (who faces whom; a
   vehicle points where it travels), the action (a seeded figure's own bodily act is not free scene prose —
   it is the primitive its sentence names, rule 3), what a gesture or highlight targets ("the northern half
   of South America", not "the continent"), framing + scale, the committed scene palette, light/atmosphere, and a
   **payload-driven THREE-PLANE read** — what occupies the foreground, the mid, and the background of THIS
   beat, at what scale, and from where the camera sees them,
   in whatever sentence the scene wants. Name concrete elements, not categories; a thin, palette-less
   prompt renders thin. **Never art style, texture, or line weight** —
   `forge.py` prepends the style bible's §2b descriptor at the HEAD of every scene gen and appends this
   file's `global_prompt_suffix` at its TAIL, so both reach every gen without you, and
   restating them spends the prompt on the look instead of the scene.
   **Stage poses that hold** — a tableau, never a freeze of mid-motion. A load-bearing named face states its
   orientation and what keeps it unobscured; do not let a crowd or foreground object own that face's sightline.
   **Supplied-text law (HARD):** never name a text element without supplying its value verbatim, inline,
   beside its own element — quote the literal from the fact ledger and cite `[F-NN]` in `notes`, or omit
   the element, or author it deliberately blank. Rule + lettering laws L-1…L-4: `shots-schema.md §4`.
   **Then ORDER the finished prompt in the grammar's three zones** — identity, scene, payload as the final
   clause (`visual-grammar.md §2` ordering law; on a delta the final clause is its one change, §1 chain
   logic). Absence is authored as a positive state of the surface, never a "no X, no Y" list (same file,
   header block).
5. **Use a stage chain only for a genuine progressive reveal** — something visible changes at each cut
   and the story needs that change. Otherwise author standalone cuts, even on the same set. A chain has one
   `base` first, each `delta` naming exactly ONE physically feasible, visually distinct semantic
   transformation in `changed_elements`, ≤2 deltas, then a re-base or hard cut. **A figure's ENTRANCE is never a delta**
   (a delta seeds parent + canonical only, so a figure the parent frame does not contain has nothing to
   inherit): stage it as a `base`, or open a new stage on that shot. A place anchor is figure-free or already compatible
   with the later count/scale demand. Completion states quantify the end state (`all`, `entirely`, or what
   `nothing remains`); a parent that has no room for the change is not repaired with a re-roll.
6. **Route the technique before writing precision prose:** an exact percentage scale, pixel-clear gap,
   replace-one-person, or majority-removal beat is not a whole-frame prose delta. Simplify the composition, rebase
   from the pre-transient ancestor, or mark the beat for the layered path; never ask the sticky parent to perform
   measured placement/deletion by wording alone.
7. **Tag a `source`** per the schema's taxonomy (`stock`/`hybrid`/`archival` get a `stock_query`), and
   set `synthetic: true` on any photoreal AI shot.

## Step 3 (staged) — plan the video, then author act by act

A shot list is authored in ACTS, never in one continuous pass. Depiction register decays across a long
pass: the back half of a one-pass file drifts literal, reuses the same two or three classes, and reaches
for the same nouns and the same staging. Once 3a's cast / place / stage plan is locked, the default
execution is DISJOINT CONTIGUOUS ACT PARTITIONS — every planned `stage` whole inside one partition, never
split across two — which a coordinator merges in narration order, then ONE whole-file lint + critic pass.

### 3a — Split + plan (before authoring a single shot)
- **Split `script.md` into its acts** — the story's own turns (setup / scheme / unraveling / aftermath;
  usually 2–4), never equal word counts.
- **The video's named cast** — complete, planned before authoring, and derived from the script: include every recurring or
  story-bearing person or institution whose identity matters. Do not add or remove cast to chase population;
  if a later identity is genuinely needed, revise the plan before continuing, never invent a slug mid-pass.
  **An ANONYMOUS story-bearer is planned INTO this list here, at 3a time** — one seeded figure is the
  default human staging, resolved to existing cast where the story identifies one or minted as NEW named
  cast through the standard wave. Crowd is reserved for a beat whose point is the mass itself; there is
  no anonymous-foreground tier (`visual-grammar.md §2`).
- **The acts the beats need — matched to the primitive library HERE, once.** Walk the planned beats and
  bind each figure's act, expression, and costume to the existing registry/library catalog. The sentence
  conforms to the nearest pose/action primitive and the figure keeps its pinned costume. If nothing close
  carries the beat, emit the Step 2 elevation flag and block the shot; image-generation mints and approves
  the reusable primitive first, then VPW re-authors against the now-live catalog. Never freestyle the gap.
- **Places, stages + environments:** decide now which sets recur and carry held `stage` chains and which
  are one-frame standalones. A **`place`** is a recurring diegetic set identity (kebab-case, e.g.
  `miniscribe-boardroom`) — distinct from `stage`, a continuity chain *within* one place (capped 1 base +
  ≤2 deltas). **A set is a PLACE when the file REVISITS it after leaving** — two or more non-contiguous
  runs; an unbroken single visit is a `stage`, whose base already anchors every shot of the run. Declare
  `place` on every shot of a revisited set. Symbolic/abstract/standalone object-insert `shot_class`es, a
  short's `first_frame`, and the thumbnail block declare no `place` and run as seedless roots. The
  **plate is the first-in-file generated shot declaring the place**
  (`source: ai-gen | hybrid`, absent defaults to `ai-gen`; a stock/chart/screencap/archival shot is
  skipped, mirroring forge's own skip); for a QUALIFYING
  place (it recurs, or its plate declares `place_owner`) the plate must carry zero SEEDED figures (named
  cast) and no `stage_role: delta` — a single-visit, unbranded place is its own place-first frame and stays
  seedless (a dedicated plate for it is pure waste). Every declared `place` must map to a span in
  `script.md` (`script_vocab`) — an invented place fails lint like invented lettering. Every plate makes
  the **owner forced choice**: declare exactly one of `place_owner: '<LITERAL>'` (the quoted cue must
  appear in the plate's own `still_prompt`, carried under L-1 by any delta that redraws it) or
  `owner_ambiguity: true`. **Ambiguity is a first-class answer, not the weak one** — it is the honest
  call whenever the script establishes no visible branding, and reaching for `place_owner` to look
  decisive invents signage, which is fabrication. The literal is per-video data sourced from the
  script — **never a skill constant**. A set invented twice mid-pass gets described twice
  differently and renders twice. Every plate is authored at **working occupancy** with its signage
  ink stated, and a place carrying a long run declares its **plate variants** — the law, with both
  bounds of each target, is `visual-grammar.md` §2 (the plate bullet); do not restate it here.
  Decide the variant split at THIS step, alongside the recurrence decision, so it is planned once
  per place rather than improvised shot by shot.
- **The plate / reveal seam — decide it once, per branded place.** A qualifying place's plate is
  cast-free; a character reveal lands on the line that NAMES them; on a branded set those two laws want
  the same beat. Resolution: **the plate is the place's first CAST-FREE frame and the reveal is its
  first CAST-BEARING frame**, and DISCLOSURE ORDER (never the plate law) decides which comes first — a
  brand cannot appear before the VO says it, and neither can a person. When the naming line carries
  both, author it as two cuts rather than one long hold; the cadence band wants that anyway.
  *Worked example — "The company was MiniScribe, a hard drive manufacturer."* The plate takes the naming
  clause: the cast-free assembly floor mid-work — drives moving along the benches, machines and stock
  running back into the depth — with `'MINISCRIBE'` on the board over the entrance, its ink stated (§5),
  ~2s. The very
  next cut, still inside the same sentence's tail, is the reveal: `miniscribe-rep` planted in that
  doorway, seeded off the plate. The brand and the personification both land on their own line, the
  plate stays clean for everything that seeds it, and the entrance does not slip two shots downstream.
- **The three peaks:** reserve the most striking staging for the opening, the mid-video re-arm (55–65%),
  and the withheld peak in the final 20%. A character enters on the line that NAMES them.
- **Density budget, written down per act:** read the runtime AND the rate off the script header ("N words
  ÷ M wpm"), never a fixed 150 — the header's rate is the channel's MEASURED voice, and sizing off a
  slower one buys shots for a video that doesn't exist. Then split the whole-file limits
  (`shots-schema.md §5` — cadence band, the `runtime ÷ 4s` floor, Σ `duration_s` ≈ runtime, hold lengths)
  into a per-act shot target, **weighted heaviest in the first 60s**; never a static ambient shot under the
  first 3–5s. A short-summing list gets stretched at render, leaving one visual dead 15–25s: **densify,
  never lengthen holds.** 3c audits each act against its number.

### 3b — Author act by act
**Before each act, re-read `example-shots.md` + `visual-grammar.md` §1–3.** Skipping the re-read is how the
back half goes literal. Then run Step 2 on every line of that act, in narration order.
- **Anchor every shot with a `vo_ref`** copied VERBATIM from `script.md` — that VO line's opening words,
  **≥4 where the sentence has them; a shorter sentence anchors on its full text** (a `[PAUSE]`-bounded
  "The audit passed." is a legal 3-word anchor) — exact wording and order, never reworded or
  pronoun-swapped, and authored in **strict narration order**, each anchor at or after the previous
  shot's script position. `render-builder` times each cut off the first 4 normalized words (all of them
  when there are fewer), so a bad anchor mis-places the shot. Anchor only on SPOKEN text: an italic
  authoring note in the script is not narration and matches nothing.
- A shot covering more than ~8s of VO means densify there, never widen the image's scope.

### 3c — Close each act: lint the partial file, then self-audit for drift
Run the Step 7 lint command on the partial file. **Two HARD findings are EXPECTED until the file is
complete** — the duration-sum and shot-floor checks measure the whole runtime — and are judged only at
Step 7; **every other HARD finding is a real defect, fixed now**, while the act is fresh.
Then write yourself ONE paragraph on the act just closed: **non-literal share** (any shot merely drawing
its line's words?), **class variety** (which `shot_class` values repeated, and has one become a reflex?),
**red-ink count** (red is the one semantic accent — alarm / prohibition / ownership / the punch element —
so a rising count means it is turning into decoration), **human use** (flag story-bearing people, decisions, or relationships hidden behind objects, or
habitual people staged where object, place, document, or mechanism is the subject; no target share —
but **name every figureless run longer than ~10s** and say for each what earned the absence), and
**cadence vs the 3a budget** (shot count and Σ
`duration_s` against this act's target; if a VO manifest already exists, the lint's REAL-hold heads-ups
are the truer number and a run of them means densify here, not later). A drifting act is re-authored here, not left for the critic:
Step 8 is whole-file and one cycle only.

## Step 4 — Thumbnails (primary + 2 challengers, derived from script + dna)
Derive the concept yourself from `script.md`'s hook and withheld peak plus `dna.md`'s thumbnail grammar,
then write the full `gen_prompt`:
- **A hero with ONE loud, readable emotion is mandatory** — a cast member, or a personified money object
  WITH a face (smug / menacing / panicked / gloating). A cold faceless object as sole subject is banned.
- **ONE dominant thing, big and simple, legible at 168px.** Overlay text is a **punchline, verdict, or
  fake quote** — never the premise, never the title — and the pixels carry **≤3 words, no all-caps**.
- **The one red accent POINTS** (arrow, circle, underline) at the anomaly or highlights the payoff word.
- Prefer an **absurd or menacing juxtaposition** to literal illustration; lead with a familiar anchor;
  avoid the dead list (open-mouth photoreal shock, rainbow arrows, cluttered frames, all-caps).
- Each challenger tests a genuinely different hero/emotion/framing within the locked lever.

## Step 5 — Shorts visuals
For every short write a `first_frame` block **and** an ordered shot list, running Step 2 on each shot.
**The first frame IS the thumbnail:** a pattern-interrupt tableau already carrying the beat's tension —
a held pose loaded with the story's wrongness — with the caption **baked diegetically, quoted verbatim,
≤4 words**, winning the swipe in ~1.3–1.8s; no static opening. Then **a cut every 2–4 seconds**, **9:16**,
same per-shot fields as long-form, carrying each short's `archetype` and status.

## Step 6 — Policy (not optional)
- **Originality moat:** compose original frames carrying the channel's POV — never instruct "recreate
  <rival>'s thumbnail/shot" or clone a named channel's signature format (cloning is the
  inauthentic-content trigger; generic archetypes are fine).
- **Imagery constraints** come from the grammar's policy section + `dna.md`; flag borderline shots in
  `notes`. **Illustrate the VO, never extend it** — baked diegetic text included: never put a casualty
  count, date, name, or statistic on screen that the script omitted.

## Step 7 — Write the file + lint
Write **`videos/<slug>/shots.json`** per `references/shots-schema.md`: `schema:
"faceless-youtube/shots@2"`, `global_prompt_suffix` copied verbatim from the grammar's header,
`long_form` + `thumbnail` + `shorts[]`, `status: "shots-drafted"`. **Then run the lint (mandatory):**
`python .claude/skills/visual-prompt-writer/scripts/lint_shots.py videos/<slug>/shots.json --write`. It
enforces the mechanical rules above. **Any HARD failure degrades render sync — fix it before handoff.**

## Step 8 — Shot critic (mandatory; before any generation token is spent)
Dispatch the **fresh-eyes shot critic** per `references/critics.md`: one subagent with no share in this
run's authoring context, given `shots.json` + `script.md` + the channel's `visual-grammar.md` +
`registry.json`. Edit `shots.json` through its findings yourself — the critic never writes prompts —
then **re-run `lint_shots.py --write`** and note any finding you rejected, with the reason. Leave the
idea-backlog status at **`scripted`**; the folder is then ready for `voiceover` + `image-generation` →
`render-builder` → `publish-queue`.

## Output to the user
Short summary only: the `shots.json` path; the long-form shot count; the thumbnail primary one-liner;
shorts visualized with total short shots; **confirmation `lint_shots.py` passed** plus any densify
heads-up; **the critic pass result** (N findings, how each was addressed or why rejected). The full
field list is canonical in `references/shots-schema.md` — write against that, not this summary.

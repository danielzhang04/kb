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

## Step 2 — Decide what each line depicts (run per VO line)
1. **Classify → pick a class** from the grammar's narration→shot-class table; record it as `shot_class`.
2. **INVENT the shot** against the example-shots bar — **non-literal by default**, literal only for a
   concrete physical action or object. A shot that merely draws its line's words fails → reclassify.
3. **Reference figures, poses, and expressions by registry vocabulary NAME, backticked, inline** in the
   prompt prose ("MacGregor, `expr-smug`, `action-salute`, stage-left, facing right"). Never describe
   body pose, finger mechanics, or facial expression in words — naming the asset IS the authoring act. A
   name the registry lacks may still be written; `image-generation`'s Pass-1 gate surfaces it for the
   human's pre-gen approval, and a veto comes back to you as a restage.
4. **State the scene facts the beat needs — CONTENT only** — layout, orientation (who faces whom; a
   vehicle points where it travels), the action, what a gesture or highlight targets ("the northern half
   of South America", not "the continent"), framing + scale, the committed scene palette,
   light/atmosphere, and depth (fore/mid/background, filled edge-to-edge). Name concrete elements, not
   categories; a thin, palette-less prompt renders thin. **Never art style, texture, or line weight** —
   the `global_prompt_suffix` and the style bible's forge descriptors inject those on every gen, and
   restating them spends the prompt on the look instead of the scene.
   **Stage poses that hold** — a tableau, never a freeze of mid-motion.
   **Supplied-text law (HARD):** never name a text element without supplying its value verbatim, inline,
   beside its own element — quote the literal from the fact ledger and cite `[F-NN]` in `notes`, or omit
   the element, or author it deliberately blank. Rule + lettering laws L-1…L-4: `shots-schema.md §4`.
5. **Group into stages/chains per the grammar's chain logic** — consecutive shots on one set share a
   `stage`, one `base` first, each `delta` changing exactly ONE element in `changed_elements`, ≤3 deltas,
   then a re-base or a hard cut. Disclosure order holds throughout.
6. **Tag a `source`** per the schema's taxonomy (`stock`/`hybrid`/`archival` get a `stock_query`), and
   set `synthetic: true` on any photoreal AI shot.

## Step 3 — Walk the script, then densify
- **Anchor every shot with a `vo_ref`** copied VERBATIM from `script.md` — that VO line's opening words,
  **≥4 where the sentence has them; a shorter sentence anchors on its full text** (a `[PAUSE]`-bounded
  "The audit passed." is a legal 3-word anchor) — exact wording and order, never reworded or
  pronoun-swapped, and authored in **strict narration order**, each anchor at or after the previous
  shot's script position. `render-builder` times each cut off the first 4 normalized words (all of them
  when there are fewer), so a bad anchor mis-places the shot. Anchor only on SPOKEN text: an italic
  authoring note in the script is not narration and matches nothing.
- **Cadence + coverage (lint-enforced):** 1.5–3s per shot (up to 4s only where the beat earns it), at
  least `Estimated runtime ÷ 4s` shots, and Σ `duration_s` ≈ `Estimated runtime` — read the runtime and
  the rate off the script header ("N words ÷ M wpm"), never a fixed 150; the header's rate is the
  channel's MEASURED voice, and sizing off a slower one buys shots for a video that doesn't exist. A
  short-summing list gets stretched at render, leaving one visual dead 15–25s — **densify, never
  lengthen holds.**
- **Weight the density heaviest in the first 60s**; never leave a static ambient shot under the first
  3–5s. A shot covering more than ~8s of VO means densify there, never widen the image's scope.
- **Reserve the most striking staging** for the opening, the mid-video re-arm (55–65%), and the withheld
  peak in the final 20%. A character enters on the line that NAMES them.
- Deltas run 1.5–3s; a base or hold frame 4–12s.

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

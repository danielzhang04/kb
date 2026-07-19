# Shot composition variety — make the shot-class drive composition (design)

**Date:** 2026-07-09 · **Status:** approved, pre-implementation
**Owner files:** `.claude/skills/visual-prompt-writer/SKILL.md`, `channels/the-second-take/visual-kit/visual-grammar.md`, `.claude/skills/image-generation/SKILL.md`, `channels/the-second-take/visual-kit/style-bible.md`
**Untouched (deliberately):** `knowledge/research/niche-playbooks/universal.md §13a` (already owns class→composition — we execute it, never restate it); `visual-prompt-writer/references/shots-schema.md` (no new field); `references/critics.md` (the fix is generative, not a new checkpoint).

## Problem

Generated shots are monotonous: too many are "characters the same size, centered, in a literal
environment," with flat/repeated expressions. Root-caused by reading the actual authoring flow, NOT
by asserting a discipline failure:

1. **The shot-class is recorded as a tag, not executed as a composition.** `universal §13a`'s
   narration-type → shot-class table already carries each class's composition (comparison → *physicalized
   imbalance / relative size*; relationship → *staged interaction: handshake, linked arms, tug-of-war*;
   scale → *scale as argument*; territory → *top-down map*). But `VPW Step 2.5` picks the class, records
   it, and then stages a **generic centered-medium shot** instead of realizing the class's composition.
   Proof from the Poyais slice: L18 (`physicalized-imbalance`) *executed* its class → the strong
   tiny-figures-vs-huge-"8M ACRES" scale shot; L16/L17 (`staged-interaction`) did *not* → two figures
   parked side-by-side, ignoring the class's own handshake/linked-arms vocabulary.
2. **Expression is decided (Step 5) but not required as a stated fact (Step 6).** Step 6 lists
   layout/orientation/targets/casting — not expression — so it frequently never reaches the prompt text
   and gen defaults to the seed's neutral face (L16's prompt states zero expression).
3. **Composition is double-authored.** VPW writes the `still_prompt`; then `image-generation` *adds its
   own* "placement/depth" language at gen time — so framing is decided in two places and can fight, and
   the payload-driven composition can be overridden at gen time.

## Principle

- **The composition variety is already latent in the shot-class system.** Different narration → different
  class → different inherent composition. So the fix is to make the class **drive** the composition — NOT
  to build a parallel composition taxonomy (that would duplicate `§13a` — the exact cross-file redundancy
  we're avoiding).
- **Composition lives in the `still_prompt`.** It is prompt content, authored ONCE by VPW (from the
  class + the shot's payload), and **executed faithfully by image-gen** — not re-decided downstream.
- **All changes are DO's, integrated in place.** No new prohibitions, no new field, no restated law; each
  concept keeps exactly one home.

## Changes (each concept, one home)

### 1. `VPW SKILL.md` — the class drives composition + expression/framing become stated facts

- **Step 2.5 step 2 ("invent in class")** — realize the shot-class's *inherent composition/scale*, drawn
  from the class's own vocabulary in `§13a` (physicalized-imbalance → relative size; staged-interaction →
  an active interaction pose, not two figures parked; scale → scale-as-argument; etc.). The class is a
  composition prescription, not a label. Stop collapsing every class to a centered medium shot.
- **Step 2.5 step 6 ("state the facts")** — extend the required stated-facts list from
  `layout/orientation/targets/casting` to **+ framing/scale (from the class + payload) + expression (from
  the beat)**. A prompt missing them is visibly incomplete, not silently defaulted.
- This makes `shot_class` load-bearing for composition and closes the expression leak — both as
  positive requirements integrated into the existing steps, not new rules appended.

### 2. `visual-grammar.md §2/§3` — the channel's per-class staging realization

- Today §2 is a **floating composition menu disconnected from the class table**, and §3 covers only a few
  classes' lever translation. **Restructure so the composition guidance is organized as "how we stage
  each recurring class on our rig"** — connecting §2's menu to §13a's classes (staged-interaction HERE =
  …; physicalized-imbalance HERE = tiny figures vs a dominant labeled mass; personified-character HERE =
  a composition idea, never a lone figure in a void). This is the channel's *execution* of the universal
  classes (§13a stays the source of the class definitions — not restated here). Cut the disconnected
  floating list; keep it a focused per-class realization, not an exhaustive camera encyclopedia.

### 3. `image-generation SKILL.md` — execute, don't re-decide composition

- The technique-(b) instruction currently reads "Delta = the shot's `still_prompt` + explicit
  placement/depth …". Change to: **render the `still_prompt`'s authored framing/composition; add only the
  character seeds + minimal technical placement, do NOT re-compose.** VPW owns composition; image-gen
  executes it. (This *removes* a double-authoring source — anti-bloat.)

### 4. `style-bible.md §6` — diegetic art renders flat-cel

- Add one clause to the recipe: **in-world/diegetic art (a framed painting, poster, brochure, or
  map-as-artifact) renders in our flat-cel look with the `#241a12` outline like everything else — not a
  soft-gradient illustration.** (The across-video render rule decided this session; the retried L08/L09
  are the proof.)

## Enforcement (why step-only will work)

No new field and no new checkpoint, so behavior changes at two non-checker points: (a) composition +
expression are now **required stated content in the prompt** (visible-if-missing), and (b) a **gold
exemplar** — a re-authored, approved slice — becomes the reference the writer imitates (the single
strongest behavior-changer, per the storytelling-grammar precedent). The existing pre-gen critic stays
as-is (a light backstop), not beefed up.

## Testing / validation (SEPARATE, after the edits — deferred by user)

Once the file edits land: re-author a Poyais slice under the new logic → regenerate → user approves the
varied set → **that becomes the gold exemplar** locked into `visual-grammar`/`style-bible`. Scope and
run this as its own step; it is not part of the file-edit plan.

## Non-goals

- No new `shots.json` field (step-only — composition lives in the `still_prompt`).
- No new composition taxonomy — `§13a`'s class table is the source; we execute it, never duplicate it.
- No change to the pre-gen critic, the shots schema, or the checking/review layer.
- The image-gen review reliability gap (a nose slipped; finger counts) is a **separate follow-up**, not
  this plan.
- Per-video asset fixes (e.g. recoloring the Miskito king) are out — this is across-video logic only.

## Success criteria

- A re-authored slice shows visibly varied compositions that track each shot's class + payload (scale
  shots read as scale, interactions read as interactions, artifact-detail shots fill the frame), and
  character expressions vary by beat — with **no new rules, no duplicated taxonomy, and each concept in
  one home** (verified by a cross-file read: composition-execution in VPW, per-class staging in
  visual-grammar, class definitions still only in §13a, render in image-gen).

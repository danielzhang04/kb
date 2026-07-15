# Still-side visual authoring rebuild — VPW generator fix + two check layers

**Date:** 2026-07-08 · **Status:** designed, approved in-session, pending implementation
**Fixture:** `channels/the-second-take/videos/_chain-test/` (the ~56s Poyais slice; 12 scenes)

## Problem

The chain-test slice validated the *mechanics* (staging, anchors, chains, render sync) but exposed
systematic quality defects in the still frames. Root-cause review traced them to five causes, not
twelve one-off bugs:

1. **VPW authors animation that doesn't exist.** The skill's mental model is still the retired
   JSON2Video/Kling world (Pattern A/B, mandatory `motion_prompt`, "motion rendering is a later
   Remotion phase"). The Remotion engine is now the default and consumes only `ken_burns`,
   `on_screen_text`, stage structure, and anchors; `motion_prompt` is never read and
   `within_shot_motion` is informational. Because VPW *imagines* element animation, it composes
   stills as **freeze-frames of it** (mid-stride MacGregor, families mid-shuffle, Bolívar
   mid-arm-sweep) — poses that read wrong when held 3–9s. The skill's own law "compose
   `still_prompt` *to move*" directly instructs this bug.
2. **Prompts assert mood, not facts.** Nothing requires a `still_prompt` to state its load-bearing
   spatial/relational facts (which landmass, who faces whom, what a gesture targets), so scenes
   ship with wrong geography, wrong facing, wrong highlight targets — and nobody checks, because
   the scene-taste gate only asks about beat/recipe/slop, never fidelity to the prompt's own claims.
3. **No acting layer.** Expression/pose is never authored, so the rig's default face rides every
   beat. Costume/role legibility gaps (a generic "prince" instead of MacGregor-as-prince; a king
   who doesn't read as a king) because casting isn't pulled through diegetic-media shots.
4. **Look-gates fail at counting.** The §3 rig gate's 4-digit hand rule was checked at
   contact-sheet scale where counting is impossible — a *procedural* failure, not a missing rule.
5. **No pre-pixel plan review.** Plan-level logic errors (wrong-continent arc, authored height
   mismatch, bland hook, bare scenes) surface only after generation tokens are spent.

**Design stance (the project's proven pattern):** fix the generator first, then net it with
independent fresh-eyes checks. No itemized per-defect rules — generalized laws + generalized check
questions. All edits integrate in place (operating rule 6); no dated append-blocks.

## Scope boundaries (parallel-session contract)

The motion-teardown session owns: `universal.md` (incl. the coming §13a-iii), `visual-grammar.md`'s
**motion** section, `motion-tokens.json`, `build_motion.py`, `render-builder/engine/`, fonts/audio,
and **VPW's motion-intent vocabulary** (the beat-taxonomy enum arrives from the teardown synthesis
and will be lint-enforced like the stage fields). This work touches NONE of those. `ken_burns` and
`within_shot_motion` stay authored exactly as today (frozen; schema gains a seam note only).
`universal.md` is not edited at all this session; §13a-i reconciliation happens after the teardown
lands.

## 1. VPW `SKILL.md` — in-place rebuild (still-side)

**New mental model:** VPW writes a still-frame plan plus intent metadata. Stills are produced by
`image-generation`; motion is realized downstream by the Remotion engine from intent (mechanism —
easing, amplitude, camera choice — is never authored in shots.json). Pattern A/B and the
"provider-agnostic, write both specs" doctrine are removed; JSON2Video becomes a legacy footnote.
VPW stops writing `motion_prompt` and `asset_type` (legacy-optional in the schema; the never-used
Pattern B was their only consumer).

**Authoring laws (replace "compose `still_prompt` to move"):**

- **Held-tableau law.** Every still must read as a *deliberate composition when frozen* for its
  full duration. Held poses that carry action meaning are the vocabulary (a salute, a planted
  stance, presenting a deed, a held point); a freeze of continuous motion (mid-stride, mid-shuffle,
  mid-sweep) is broken output. The beat's change arrives **at a cut** (stage delta) or via motion
  intent — never baked into the pose.
- **Scene-facts discipline (scoped).** A `still_prompt` states the facts that are **load-bearing
  for the beat's meaning** — layout (what's where), orientation (who faces whom; a vehicle points
  where it travels), targets (what a gesture/highlight refers to, named precisely — "the northern
  half of South America"), casting/costume — such that a stranger could verify the image against
  the prompt. Load-bearing facts left implied are defects; exhaustive inventories are bloat, also a
  defect.
- **Acting layer.** Expression + pose are authored per shot, tracking beat/register per the channel
  staging law; an expression change is a legitimate `changed_element` in a delta.
- **Casting pull-through.** Every story-named or story-referenced figure — including inside
  diegetic media (the brochure's prince, who IS MacGregor) — routes through registry casting; a
  role must read at a glance (a king reads as a king via 1–2 signifiers).
- **Delta decisiveness.** A delta's `changed_elements` must be decisive: if the beat is a
  world-flip, the frame flips (full palette turn), never a timid partial coexistence.
- **Hook-frame bar.** The hook shot is held to a scroll-stop standard — the most arresting staging
  of the beat, not the first competent one.

Untouched: anchor/`vo_ref` contract, stage/delta structure, cadence + stretch-to-fill law, densify,
thumbnail step, shorts step, `on_screen_text`, Step 2.5 narration→shot-class grammar.

## 2. Pre-gen shot critic — new mandatory VPW step (check #1)

Mirrors the long-form-writer critic layer. After `lint_shots.py` passes, VPW dispatches a
**fresh-eyes subagent** (new `references/critics.md`) with `shots.json` + `script.md` + the staging
law + this design's authoring laws. Generalized questions:

- Does each scene's stated logic hold (geography, spatial sense, orientation, causality)?
- Would each still read as deliberate when frozen (tableau law)? Any freeze-frame poses?
- Is every named figure cast from the registry and role-legible?
- Does acting (expression/pose) track the beat?
- Is this the most interesting legitimate staging of the beat (hook held to the highest bar)?
- Does any shot *depend* on unrenderable animation to make sense?

Findings return → VPW edits `shots.json` in place → re-lint. Runs **before any generation token is
spent.** Not a separate skill — no new pipeline seam.

## 3. `image-generation/SKILL.md` — surgical (check #2 + casting)

- **Scene gate charter extension** (existing fresh-eyes subagent gains ONE question): *"Does the
  image assert exactly what the prompt asserts — every stated fact realized — and nothing extra
  that changes the read?"* Covers wrong continents, wrong facing, unrequested set dressing, missed
  costumes. Interlocks with §1's fact-stating prompts.
- **Verify at the scale of the invariant** (procedural): countable locked invariants (hand digits)
  are judged on zoomed crops at counting scale, never contact sheets. Generalized to any countable
  invariant.
- **Casting:** pass 1's entity table must capture story-named roles inside diegetic media;
  canonical costume is part of identity.
- **Data fix:** pin MacGregor's canonical ref to the red/gold uniform version (user preference).

## 4. `visual-grammar.md` — surgical staging-law additions (staging sections ONLY)

Tableau pose menu (held poses that carry action) · co-stars share eye-line/height unless the size
difference IS the beat's argument · expression-by-beat register mapping (smug on con beats,
grim-flat on human cost, deadpan on irony) · role legibility via 1–2 costume signifiers ·
everything in frame earns its place (no unmotivated set dressing).

## 5. `style-bible.md` §3 — propose-only

Draft the counting-scale verify procedure into the rig gate instructions; user approves before it
lands (locked file, never self-applied).

## 6. `shots-schema.md` — surgical

Mark `motion_prompt` + `asset_type` legacy-optional (Pattern B only). Seam note: the motion-intent
enum arrives from the teardown taxonomy, lint-enforced like stage fields. `ken_burns` +
`within_shot_motion` documented as frozen-until-taxonomy.

## 7. Validation (the acceptance test)

Fresh VPW run on `_chain-test` (scratch fixture; overwrite is intended) → pre-gen critic → user
reviews the new `shots.json` / diff → image-generation re-run through the extended gates → new
render board artifact → user compares against the current 12 scenes. `_chain-test/` remains the
fixture until this passes, then may be deleted.

## Implementation order

1. `shots-schema.md` (schema first — VPW references it)
2. VPW `SKILL.md` rebuild + new `references/critics.md`
3. `image-generation/SKILL.md` surgical edits
4. `visual-grammar.md` staging additions
5. style-bible §3 proposal (user gate) + MacGregor red/gold registry pin
6. Validation run (§7) · close-out: `decisions.md`, CLAUDE.md status, handoff cleanup
7. Post-teardown (deferred, recorded not built): §13a-i reconciliation; VPW motion-intent enum;
   `ken_burns` migration to grammar-owned mechanism; stamp/X-mark beats authored as T2 devices.

**Git discipline:** explicit staged paths only (parallel sessions active); `visual-grammar.md`
committed promptly to minimize collision with the teardown session's motion-section edit.

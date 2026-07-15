---
name: motion-planner
description: Plans the element-layer motion for a storyboarded video in this project — reads a video's shots.json and emits a derived videos/<slug>/shots.motion.json that declares, per shot, a background (a baked plate or a passthrough delta-chain) plus animated cutout/engine LAYERS (the character slide-in, the ship pathing a map, a stamp that slams on, diegetic text drawn by the engine). Use whenever the user wants to plan the animation/layers, "do the motion plan", decide which shots get moving elements, decompose shots into plate + cutouts, or run the motion-planning step after shots.json exists — for ANY channel with a visual-kit/animation setup. It decides PLACEMENT (which shots get Family-A motion + how), grounded in shots.json shot_class + content + an iterable ruleset; the HUMAN gates the plan before image-gen spends tokens, and ear/eye-gates FEEL on the render. Runs AFTER visual-prompt-writer (needs shots.json) and BEFORE image-generation (which materializes the plates/cutouts) + render-builder. Do NOT use it to write the shot list (visual-prompt-writer), generate the plates/cutouts (image-generation), author audio/SFX (audio-cue-writer), or assemble the video (render-builder).
---

# motion-planner

Turns VPW's `shots.json` (the VISUAL truth) into `videos/<slug>/shots.motion.json` (the derived
production spec image-generation + build_motion consume). **Baked only when nothing moves** — a shot
stays baked when nothing enters/moves/accretes, but a motivated element (entrance, travel, stamp, added
prop, chain) gets its layer. ELEMENT motion only; the camera stays locked. Authors PLACEMENT; the human
gates FEEL.

Contract: `render-builder/references/shots-motion-schema.md`. Vocabulary: `render-builder/references/
animation-menu.md` (author ONLY menu animations). Rules: `references/animation-rules.md`. Critic:
`references/critics.md`.

## Procedure

1. **Read** the video's `shots.json`, plus `animation-rules.md` and `animation-menu.md`.
2. **Classify each shot** by the ruleset. Default = **passthrough** (`background.mode: "plate"`, its
   existing `scenes/<id>.png` as `plate`, `layers: []`). A `delta-chain` (shared `stage`/`stage_role`)
   passes through untouched **unless its delta adds a discrete overlay** — a stamp, a CHARACTER entering,
   or a discrete PROP — then it is a **hybrid** (prior-scene plate + an `appear`/`slide` cutout; see
   `animation-rules.md`). Add a layer wherever a beat has a moving/entering/accreting element:
   - character entrance/reveal → cutout `slide`, `anchor`ed to the naming/entry word
   - discrete object travels a route (incl. a mover on a `map-plan-view`) → cutout `path` (+ `draw_line`)
   - live prop vibe → cutout `bob` (sparing) · a discrete overlay lands on a held scene → cutout `appear`
     (`style:"slam"` for a stamp) as a hybrid
   - diegetic on-object text/number → an `engine` `text` layer + `at_scene` (still DEFERRED — do not author)
3. **Decompose layered shots BY SUBTRACTION** (never re-author from scratch): `plate_prompt` = the shot's
   `still_prompt` minus the cutout elements and minus any diegetic text (state the blank region);
   `cutout_prompt` = the single element alone on a plain plate.
4. **Fresh-eyes critic** (`references/critics.md`, a fresh-context reviewer) → apply its fixes in ONE
   revise pass. The #1 defect it catches: a `plate_prompt` that still implies a moved element.
5. **Write** `videos/<slug>/shots.motion.json` (schema per `shots-motion-schema.md`).
6. **Lint gate (HARD):** `py -3 scripts/lint_motion_plan.py <shots.motion.json> <shots.json>` → must be
   `0 error(s)` (schema + menu + shot-id + cutout-prompt checks).
7. **Human gate:** present a short summary — which shots got Family-A motion and the animation each — for
   the human to approve BEFORE image-generation spends tokens. The human authors the ruleset's taste; the
   planner applies it.

## What image-gen then does
For each layered shot, image-generation materializes `plates/<id>.png` (from `plate_prompt`) + each
`cutouts/<id>-<layer>.png` (gen the `cutout_prompt` on a plain plate → `forge cutout`), human-QC-gated on
the hand crop. Passthrough shots keep using `scenes/<id>.png`. Then `build_motion --motion-plan` merges
the layers into motion.json and the engine renders them (LayerView).

---
name: motion-planner
description: Plans element-layer motion after shots.json exists. Emits a derived videos/SLUG/shots.motion.json with baked plates, passthrough delta chains, animated cutouts, opt-in baseline life, and rare stage-start camera punctuation. Use to decide which storyboard shots receive motivated movement or to run the motion-planning step for a channel with a visual-kit animation setup. The human approves the plan before image-generation spends tokens and judges feel on the render. Do not use it to write shots, generate assets, author audio, or assemble the video.
---

# motion-planner

Turns VPW's `shots.json` (the VISUAL truth) into `videos/<slug>/shots.motion.json` (the derived
production spec image-generation + build_motion consume). **Baked only when nothing moves** — a shot
stays baked when nothing enters/moves/accretes, but a motivated element (entrance, travel, stamp, added
prop, chain) gets its layer. ELEMENT motion first; the camera stays locked except for a restrained,
stage-start `camera.move: "push"|"pull"` punctuation. Authors PLACEMENT; the human
gates FEEL.

Contract: `render-builder/references/shots-motion-schema.md`. Vocabulary: `render-builder/references/
animation-menu.md` (author ONLY menu animations). Rules: `references/animation-rules.md`. Critic:
`references/critics.md`.

## Procedure

1. **Read** the video's `shots.json`, plus `animation-rules.md` and `animation-menu.md`.
2. **Classify each shot** by the **two-test boundary** (`animation-rules.md`). A held scene evolves one of
   two ways: **DELTA-CHAIN when the change is INTEGRATIVE** (the element fuses into the scene's
   architecture — a city grows a bank, gold threads the streets): regenerate seeded off the prior frame
   (base + ≤3 deltas; **a re-base inside the SAME location seeds the prior stage's BASE frame, never a
   fresh canonical**). **LAYER when the change is DISCRETE** (the element sits on the scene without fusing —
   a character enters, a stamp slams onto a page): keep the plate, composite an animated cutout. A cutout
   layer requires BOTH: the change is **DISCRETE** (not integrative) **AND** the cutout is **SEEDABLE**
   (from a character/prop canonical, or from the plate it lands on + a `refs/env/` style anchor — an
   unseeded cutout invents its own register). The planner's menu is **cutout-only**: `slide` · `path`
   (+ `draw_line`) · `appear` · `bob`. There are no device cards and no engine text — all in-video text is
   diegetic (baked into the still); the engine draws only the route line.

   Default = **passthrough** (`background.mode: "plate"`, its existing `scenes/<id>.png` as `plate`,
   `layers: []`). A `delta-chain` (shared `stage`/`stage_role`) passes through untouched **unless its delta
   adds a discrete overlay** — a stamp, a CHARACTER entering, or a discrete PROP — then it is a **hybrid**
   (prior-scene plate + an `appear`/`slide` cutout). Add a layer wherever a beat has a moving/entering/
   accreting DISCRETE element:
   - character entrance/reveal → cutout `slide`, `anchor`ed to the naming/entry word
   - discrete object travels a route (incl. a mover on a `map-plan-view`) → cutout `path` (+ `draw_line`)
   - live prop vibe → cutout `bob` (sparing) · a discrete overlay lands on a held scene → cutout `appear`
     (`style:"slam"` for a stamp) as a hybrid
   When a separable object genuinely enters, travels, accumulates, or reveals on the spoken beat, use this
   existing layer machinery unless a concrete practical/visual reason makes a baked delta the better read.
   Do not chase a layer quota.

   A new video may opt into gentle baseline life with top-level `"baseline_life": true`. The renderer then
   reads only the channel's separate `baseline_life` token block and applies it to scene-backed and layered
   tableaux, never placeholders or opaque cards. Omit the flag (or use `false`) to preserve legacy output.
   A camera exception is optional punctuation: author it only on a standalone shot or the first/base shot of
   a stage, as `{ "move": "push" | "pull", "pan": null|"left"|"right"|"top"|"bottom", "intensity": 0..1 }`.
   `push` maps to engine `push-in`; legacy `pull` maps to `pull-back`. Never put one on a later delta: the
   stage camera would ignore it and lint rejects it.
3. **Decompose layered shots BY SUBTRACTION** (never re-author from scratch): `plate_prompt` = the shot's
   `still_prompt` minus the cutout elements (in-video text is NOT subtracted — it stays baked diegetic;
   state what fills the region so no blank slot is left); `cutout_prompt` = the single element alone on a
   plain plate.
   **SUPPLIED-TEXT law (HARD, lint-enforced).** Subtraction is not a licence to *paraphrase* an element.
   If the `still_prompt` bakes a value — a number, a name, a date, a stamp face — carry that literal
   **verbatim** into the `cutout_prompt`/`plate_prompt`; never restate it as a description. Writing
   *"a large marker scorecard number painted on its face"* where the shot means the numeral `'8'` hands
   the value to the diffusion model, which invents one — it rendered `1`. That exact line, in this file,
   is how a fabricated on-screen fact shipped in the Wells Fargo documentary about a real, named person.
   If the source prompt genuinely supplies no value, **cut the element** rather than gesture at it, and
   flag the gap back to `visual-prompt-writer` — never invent a plausible number to fill it.
   **LETTERING-FIDELITY laws (also HARD, also lint-enforced).** Subtraction inherits the still's wording
   wholesale, which makes a `cutout_prompt` the easiest surface in the pipeline for these:
   - **Carry a literal VERBATIM, never RECASED.** A cutout redraws every glyph from scratch, so a
     lowercased literal is a guessed literal — the still's `'CHECKING'` becoming *"the checking
     passbook"* is exactly what rendered `CHECKIG` on L12.
   - **Strip production-control vocabulary when you subtract.** "hold ONLY the rig form" and "comedy
     off" travel out of the `still_prompt` unless you delete them, and a cutout is a lone element on a
     plain plate — the easiest possible surface for a stray instruction to get lettered onto. Both
     `rig form` and `COMEDY OFF` shipped as artwork in this channel.
   - **≤4 words per authored string**, uniformly.
   `lint_motion_plan.py` imports all of these from `lint_shots.py` — one implementation, two callers.
   Full law + worked examples: `visual-prompt-writer/references/shots-schema.md §4`.
4. **Fresh-eyes critic** (`references/critics.md`, a fresh-context reviewer) → apply its fixes in ONE
   revise pass. The #1 defect it catches: a `plate_prompt` that still implies a moved element.
5. **Write** `videos/<slug>/shots.motion.json` (schema per `shots-motion-schema.md`).
6. **Lint gate (HARD):** `py -3 scripts/lint_motion_plan.py <shots.motion.json> <shots.json>` → must be
   `0 error(s)` (schema + menu + shot-id + cutout-prompt checks, plus the delta-vs-layer lineage
   backstops: a passthrough delta-chain needs a stage + an earlier in-stage frame; a `scenes/<id>.png`
   plate reuse must be an earlier same-stage shot — no chaining across stages or forward in time).
   It also validates `baseline_life`, camera move/pan/intensity, and rejects a camera declaration on a
   later stage delta.
7. **Human gate:** present a short summary — which shots got Family-A motion and the animation each — for
   the human to approve BEFORE image-generation spends tokens. The human authors the ruleset's taste; the
   planner applies it.

## What image-gen then does
For each layered shot, image-generation materializes `plates/<id>.png` (from `plate_prompt`) + each
`cutouts/<id>-<layer>.png` (gen the `cutout_prompt` on a plain plate → `forge cutout`), human-QC-gated on
the hand crop. Passthrough shots keep using `scenes/<id>.png`. Then `build_motion --motion-plan` merges
the layers into motion.json and the engine renders them (LayerView).

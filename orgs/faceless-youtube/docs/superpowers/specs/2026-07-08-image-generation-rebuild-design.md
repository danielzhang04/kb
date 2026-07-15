# Image-Generation System Rebuild — Design (2026-07-08)

**Status:** approved 2026-07-08 (brainstormed interactively; all decisions below are settled).
**Pattern:** the scriptwriter-rebuild pattern (decisions.md 2026-07-08) applied to the visual side —
root-cause → architectural fix, positive DO-THIS procedure, fresh-eyes checks — plus a rework of the
generation flow itself (per-shot one-at-a-time → two-pass: library, then scenes).

## Problem

1. **The locked style never reaches the actual video.** Under render Pattern A (the default),
   `shots.json` prompts are sent to JSON2Video's image model as bare text — no seed-from-reference,
   no verify loop, no registry. The entire style-lock system applies only to *library* assets and is
   bypassed for the B-roll the audience sees. (Follow-up #1 wires the fix's output into the render;
   this task builds the generation system that makes that possible.)
2. **One-shot-per-image generation can't hold recurring entities.** Generating each shot independently
   re-invents MacGregor/props/sets every time. Recurrence must be materialized once and seeded
   everywhere.
3. **Doc drift + prohibition pile-up.** `asset-forge` SKILL.md, `style-bible.md`, and
   `visual-grammar.md` overlap, and the scene rules (§8c) are a stack of NEVERs. The scriptwriter
   lesson applies to the *procedure docs* (rebuild as positive DO-THIS) — but **not** to the §3
   invariant checklist, which verifies by looking at pixels the model didn't author (already
   fresh-eyes; it survives as-is, the image-world `lint_shots.py`).
4. **No taste gate.** The rig gate catches noses and outlines; nothing checks whether a composed
   scene *reads as its beat*, is on-recipe, or is slop.
5. **Model-tier doctrine has no wiring.** style-bible §8b (flash for plates, pro for identity) exists
   only as prose; `forge.py` reads one `engine` from the registry.

## Settled decisions

- **Scope: docs + the image-gen skill only.** No changes to `shots-schema.md`,
  `visual-prompt-writer`'s flow, or `render-builder` beyond cross-reference/pointer updates.
  No image generation / dogfooding in this task.
- **Rename** `.claude/skills/asset-forge/` → `.claude/skills/image-generation/`.
- **Two-pass flow** (the new primary mode; the single-asset loop survives as a secondary mode):
  - **Pass 1 — video asset library:** read `videos/<slug>/shots.json` + `script.md` → identify
    medium-to-major recurring characters/props/environments (≥2 shots, or load-bearing in a
    hook/climax beat) → reuse-before-regenerate against the channel registry → generate + verify the
    missing → `videos/<slug>/assets/library/` + manifest; promote genuinely channel-recurring assets
    to `registry/refs`.
  - **Pass 2 — scene assembly:** walk `long_form.shots` in order; per shot pick from an explicit
    technique menu: (a) reuse/reframe a library asset; (b) seeded composition — plate + asset refs
    multi-seeded into one generation, placement/depth directed in the prompt; (c) plate-first, then a
    second generation placing the asset; (d) one-shot whole-scene ONLY for simple single-character
    shots. Output `videos/<slug>/assets/scenes/<shot-id>.png` + manifest.
  - **Compositing is GENERATION-BASED** (multi-seed; `forge.py` already accepts comma-separated
    seeds). Deterministic layer compositing = named Phase-2 (Remotion) only.
- **Two gates on every output:** the rig/invariant gate (every figure incl. incidental extras —
  survives as-is) + a NEW scene-taste gate (reads as the shot's beat + `shot_class`? on-recipe? not
  slop?) run with fresh eyes (subagent), because the generator shares its own blind spot on taste.
- **Doc split by owner:**
  - `style-bible.md` = THE image-gen doc: rig lock + descriptors + verify gate + committed recipe +
    asset-library build spec & build order (absorbed from visual-grammar §1/§2-rig-notes/§3.1–3.6/§4).
  - `visual-grammar.md` survives, slimmed to **staging law** (visual-prompt-writer's doc): cast
    staging notes, composition menu, lever/shot-class translation, pipeline feed, + a one-line
    POINTER to the bible's recipe/build spec (never a copy).
  - **The live asset vocabulary = `registry.json`** (data, single source of truth for what exists);
    no prose copies anywhere.
- **Pipeline order (no circularity):** `visual-prompt-writer` authors `shots.json` FIRST — its
  vocabulary is the *channel-persistent* registry (accumulated across past videos). Pass 1 then
  DERIVES the per-video library from what the shots invented, spotting recurrence by reading the
  prompts with judgment. (A consistent-entity-naming rule in visual-prompt-writer belongs to
  follow-up #1.)
- **`forge.py`:** add per-call model-tier support (flash = plates/props/environments; pro =
  locked-identity frames); registry `engine` stays the default. Minimal change.
- **Hard constraints:** every LOCKED spec value (§2/§2b descriptor text, hexes, §3 invariant items,
  canonical refs, §9 approval rule) survives VERBATIM; propose-don't-self-apply stays law; skills
  stay niche-agnostic; preserve all provenance learnings; don't touch the scriptwriter system or the
  `vo_ref`/`lint_shots.py` anchor contract; append-only history and dated specs stay untouched.

## Named follow-ups (deliberately out of scope)

1. **Render wiring:** `shots.json` per-shot asset references + `render-builder` consuming
   `assets/scenes/`; the consistent-entity-naming rule in `visual-prompt-writer`. Required for the
   locked style to reach the screen.
2. **Poyais dogfood:** run pass 1 + a pass-2 scene slice for real; the first approved composed
   scenes become the gold scene exemplars referenced from the style bible. (Until then, identity
   gold = the existing canonical refs.)

## Validation (this task)

Fresh-eyes doc dry-run, no image spend: a subagent given ONLY the two new files + `registry.json` +
the Poyais `shots.json` dry-runs both passes on paper (assets pass 1 would build; technique + seeds
pass 2 would pick for 10 named shots; every under-specification). Docs fixed against its findings;
one iteration.

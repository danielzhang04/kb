# Pipeline chain / layer / non-literal test (act 1) — design

**Date:** 2026-07-13 · **Status:** approved, in progress

## Why

A style-validation batch was hand-generated (prompts hand-authored, `forge` run directly, seeds
hand-mapped) — which **bypassed the pipeline** and therefore tested nothing. The whole point of the
project is an **autonomous** loop: `VPW → motion-planner → image-generation → render` must reproduce
gold-quality output **on its own**. The hand batch also exposed real gaps: the seeded delta-chains, the
plate+cutout layered motion, and the non-literal editorial shots (the FICTION stamp, the cut-out-vignette
money) were all missing from the current Poyais artifacts even though the gold has them.

**The rubric is the gold** — `channels/the-second-take/videos/_chain-test/` — a validated pipeline run:
chains where a held stage exists (brochure fill L05→L08; MacGregor arc L14→L17; land-deal L18→L19; reveal
L12→L13), layers where an element moves, and non-literal for editorial beats.

## Confirmed architecture (the data flow)

```
VPW  →  shots.json     (authors ALL images: delta-chains via stage/stage_role/changed_elements,
                         non-chain scenes, AND the non-literal editorial shots)
  ↓
motion-planner  →  shots.motion.json   (a DERIVED overlay — does NOT mutate shots.json; human-gated)
                    per shot: keep as a baked plate, OR strip an animatable element from the plate and
                    declare it a layer (route line → engine draws it; ship/MacGregor → moving cutout)
  ↓
shots.motion.json  →  feeds BOTH:
        • image-generation  (seeded scene chains + plates + cutouts)
        • build_motion / render-builder  (animates the layers + device cards)
```

**Key model:** a delta's `changed_elements` and a layer's `cutout` are the same thing — *"what's new in
this shot."* VPW authors it as a delta (it appears at the cut). motion-planner decides, per delta, whether
it **appears-and-stays** (leave it a baked chain) or **moves during the shot** (promote to a cutout layer,
strip it from the plate). That single decision is the whole chain-vs-layer routing.

## The test loop (act 1)

1. **Re-run VPW fresh** on the act-1 script span → `shots.json` (act 1). Scope to act 1 so each iteration
   is cheap (not a 125-shot re-run).
2. **Inspect vs the gold rubric** — did VPW chain the held stages and choose **non-literal** for the
   editorial beats? Where it under-delivers → **fix VPW's skill logic** → re-run. Iterate.
3. **Run motion-planner** → `shots.motion.json`. Inspect — did it promote moving deltas to cutout layers
   and strip them from the plate? Fix motion-planner's logic where needed → re-run. Iterate.
4. **Plan-review artifact** (zero image tokens) — per shot: chain / layer / passthrough · seed source ·
   intended motion · literal-vs-non-literal · `changed_elements`. **Human gate.**
5. Only after the plan is approved → **image-generation** walks the plan (seeded chains + plates/cutouts)
   → then the render.

## Discipline (the rule that was broken)

Every fix lands in the **skills** (VPW, motion-planner) — **never** a hand-edit to `shots.json`, never a
direct `forge` batch. If a skill produces the wrong structure, the skill is wrong; fix it and re-run.

The richness edits already made this session **stay** (they were the right direction, wrong application):
- VPW rule 5 — richness (committed palette · light/atmosphere · depth/fill · crowds-on-rig · concrete
  elements) reframed as load-bearing facts.
- style-bible §6 — rich/deep/filled environments, gold as the bar.
- image-generation batched review — flags thin/sparse/basic frames.

## Known unknowns to surface by running (not to pre-solve)

- **Hybrid shot** (chained-plate continuity + a moving cutout): motion-planner classifies a shot as
  delta-chain (passes through untouched) OR layered — not both. The MacGregor reveal is likely fine as a
  pure layered shot (empty-stage plate + slide cutout); confirm at step 3. If exact pixel-continuity of the
  plate with the prior stage frame is needed, that's a motion-planner logic fix.
- **Non-literal reliability**: VPW rule 4 makes non-literal the default, but the current Poyais came out
  literal (swamp-flip instead of FICTION stamp; literal banknote fan instead of the cut-out-vignette note).
  Whether re-running VPW now produces non-literal, or needs a logic/exemplar fix, is a step-2 finding.
- **Act-1 boundary + VPW scoping** — set from the script's chapters (through the con setup / land-deal,
  ≈ the gold's span); the scoping mechanic (sliced script vs full-run-then-extract) is an execution detail.

## Out of scope

The full 125-shot video (scale up once the act-1 logic holds); the render/audio tail; any further
hand-generation.

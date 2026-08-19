# Fix-plan v2 implementation notes

Date: 2026-08-18

## Pre-edit baseline

- Fleet preamble: `PREAMBLE OK`.
- No work-product file was edited before these checks.
- Image-generation scripts: `293 passed in 12.18s` (pytest cache disabled; explicit workspace temp root because the sandbox denied pytest's default temp/cache paths).
- Visual-prompt-writer scripts: `269 passed in 1.68s` (same temp isolation).
- Absolute-path lint on the current 246-shot `shots.json`: **1 HARD**, **82 heads-up**.
  - Existing HARD: `L17` C-8 seeded-figure topology clause.
  - This differs from the brief's expected `0 HARD / ~36 heads-up`; the discrepancy existed before any edit and is outside V1-V7.
- Initial image-suite invocation before temp isolation: `282 passed, 11 errors`; every error was pytest fixture setup caused by denied temp-directory access, not a test assertion. The isolated rerun above is the valid baseline.

## Scope guard

- Implement V1-V7 and the consistency sweep only.
- Do not touch the crowd exemplar (V8).
- Do not alter authored `shots.json` prompt content (V9); the only permitted `shots.json` edit is the V2 suffix re-copy.

## V1-V6 checkpoint

- V1: added standalone `framing + scale`; deleted only the plane-ownership fragment; retained THREE-PLANE, scale, and camera-vantage wording.
- V2: removed the environment recipe and `locked 2-3 colour`, retained `warm-biased scene palette` and the red-accent clause, then copied the updated suffix into `shots.json` without touching any shot prompt.
- V3: restored `simple flat colours with gentle soft cel shading` from `git show 38e04261:...style-bible.md`; retained the warm-neutral and cold-light clauses; §5 and forge tile prose remain unchanged.
- V4: restored the two positive scale/distance bullets from `git show 6735796d:...visual-grammar.md`; added the standalone-prop rule in §3 and the scale-argument activity sentence in §2.
- V6: grammar §2 now owns the crowd-distance law; VPW and its critic only cite that owner.
- V5 immediate 246-shot comparison, after V1-V4/V6 but immediately around the lint change:
  - Before: **1 HARD** (`L17`), **82 heads-up**.
  - After: **6 HARD**, **82 heads-up**.
  - Newly flagged, and only newly flagged: `L02`, `L06`, `L07`, `L20`, `L21`.
  - Unchanged pre-existing HARD: `L17`.
  - No other shot changed status; the five new ids are exactly the V9 crowd re-pass class allowed by the plan.

## V7 checkpoint

- Scoped `filled edge-to-edge` to environments in the existing image-generation style/taste row.
- Non-environment standalone props/artifacts now cite visual-grammar §3's full-silhouette/air rule in that same row; the existing `thin, sparse` anti-sparse test survives.
- Added one honest `lettering-register` review row for generated text-bearing frames. It judges family match against the locked crude-marker exemplar and is explicitly orthogonal to DSG spelling.

## Consistency sweep

Searched the complete named flow for `built-but-flat`, `locked 2-3 colour`, `payload owning the plane`, `FULL cel strength`, and `every fill a real colour`.

- `visual-prompt-writer/SKILL.md`: removed the plane-ownership fragment under V1.
- `visual-grammar.md`: removed the environment recipe and colour lock from the canonical suffix under V2.
- `style-bible.md`: replaced the two chroma-pressure spans with the exact era phrase under V3.
- `visual-prompt-writer/scripts/test_doctrine_reset_guards.py`: updated its suffix fixture and stale recipe description.
- `image-generation/scripts/test_forge_style_tile.py`: updated the §2b and suffix pins plus the stale STEP-1 docstring.
- `image-generation/scripts/test_forge_figures.py`: updated only the assertions pinning the changed §2b span.
- `image-generation/scripts/forge.py`: removed the deleted environment-recipe wording from the STEP-1 explanatory comment; generation logic and tile prose are untouched.
- `shots.json`: the V2 copied suffix carried the two deleted suffix spans and was replaced verbatim from the grammar header.
- No initial hit existed in VPW references, image-generation `SKILL.md`, `lint_shots.py`, or `build_review_artifact.py`.
- Final whole-flow result: **NO HITS** for all five spans.

## Final verification

- Skill package validation: visual-prompt-writer **valid**; image-generation **valid**.
- Image-generation suite: **294 passed in 14.35s** (baseline **293 passed in 12.18s**).
- Visual-prompt-writer suite: **270 passed in 0.60s** (baseline **269 passed in 1.68s**).
- Suffix byte equality: **true**, 535 UTF-8 bytes on each side, SHA-256 `ce1bc8e02c8678a131018761053d67a1746350fc5d77727c2eb7227ef4c548bb`.
- Final absolute-path lint on 246 shots: **6 HARD**, **82 heads-up**.
  - V5 findings: `L02`, `L06`, `L07`, `L20`, `L21`.
  - Pre-existing baseline finding: `L17`.
  - The brief's requested final `0 HARD` is not the state of this checkout: baseline was already `L17`, and V5 deliberately exposes the five allowed V9 ids. No out-of-scope shot prompt was edited to mask either result.

## Per-file net line delta

| File | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `.claude/skills/visual-prompt-writer/SKILL.md` | 305 | 304 | -1 |
| `.claude/skills/visual-prompt-writer/references/critics.md` | 156 | 157 | +1 |
| `.claude/skills/visual-prompt-writer/scripts/lint_shots.py` | 2711 | 2722 | +11 |
| `.claude/skills/visual-prompt-writer/scripts/test_doctrine_reset_guards.py` | 1339 | 1338 | -1 |
| `.claude/skills/visual-prompt-writer/scripts/test_new_guards.py` | 517 | 530 | +13 |
| `channels/the-second-take/visual-kit/visual-grammar.md` | 288 | 295 | +7 |
| `channels/the-second-take/visual-kit/style-bible.md` | 201 | 201 | 0 |
| `channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json` | 3397 | 3397 | 0 |
| `.claude/skills/image-generation/SKILL.md` | 505 | 508 | +3 |
| `.claude/skills/image-generation/scripts/forge.py` | 3219 | 3219 | 0 |
| `.claude/skills/image-generation/scripts/build_review_artifact.py` | 709 | 724 | +15 |
| `.claude/skills/image-generation/scripts/test_forge_style_tile.py` | 350 | 348 | -2 |
| `.claude/skills/image-generation/scripts/test_forge_figures.py` | 318 | 318 | 0 |
| `.claude/skills/image-generation/scripts/test_build_review_artifact.py` | 739 | 753 | +14 |
| `scratchpad/taste-audit/impl-v2-notes.md` | 0 | 87 | +87 |
| **Implementation/test files subtotal (excluding notes)** |  |  | **+60** |

# Scene regen wave 3 — 10 shots under v2 doctrine (shots.json f8aa5e52)

Scope: L02, L03, L04, L06, L07, L11, L16, L17, L20, L21 (chains L16->L17, L20->L21)

## Pre-flight
- Old scene PNGs backed up to scratchpad/scene-regen-w3/old/ (10 files)
- Pre-run scene manifest: 57 total entries, all 10 target ids were `verified` from a prior (pre-doctrine) wave
- All 10 staged frames in visual-kit/_staging predated the shots.json doctrine commit (2026-08-19 00:05) -> untrusted, force-regenerating
- fig-drive-maker--action-present--expr-smug step1 required a FRESH mint (costume-dress digest changed: eedf2a89 vs stale 5e51ec13) -> forge detected this itself, no manual action needed
- Batch spec built: `forge.py batch --shots L02,L03,L04,L06,L07,L11,L16,L17,L20,L21` -> 10 scenes + 1 STEP-1 figure gen, 0 not-generated; 15 seeding-law violations remain OUTSIDE scope (untouched, as instructed)
- Dry-run preflight: 11/11 prompts assembled clean, crowd-scale + warm-palette doctrine language present, chain seed order correct (L16 before L17 staging; step1 fig before L20; L20 before L21 staging)

## Live gen wave 1
- Issued: `forge.py gen --batch spec.json --force` (background), log: gen-wave1.log
- 9/10 scenes + 1 STEP-1 figure landed OK. **L20 correctly HELD** by forge's C-6 gate (fresh STEP-1 figure had no review record yet). **L21 generated anyway, seeded off the STALE pre-doctrine `_staging/L20.png`** (since the live L20 write never landed) -> discarded, never reviewed/promoted.

## Figure review
Reviewed fig-drive-maker STEP-1 card (rig/expression-register/flat-cel-hazard all pass) -> stamped via `stamp_review.py --figures` into `visual-kit/_staging/review.json`.

## Wave 2 (L20/L21 re-run, forced, scoped `--shots L20,L21`)
Figure now REUSED (verified record). L20 generated fresh; L21 regenerated seeded off the correct FRESH same-wave L20 (confirmed by mtime). Both reviewed clean.

## Fresh-eyes review findings (batch 1)
- **L02, L04, L06, L11, L16, L17, L20, L21: clean** on rig/fidelity/style. L02/L06/L20 in particular show the v2 scale-staging fix landing visibly (crowd small/receding behind real geometry, negative space, warm-balanced palette) vs the old pre-doctrine frames (compared directly against scratchpad/scene-regen-w3/old/).
- **L03: FAIL (rig)** — extreme close-crop bald near-foreground crowd heads drew a `C`-shaped ear mark + nose bump (crop-verified). Bible §3 no-nose/no-ears violation.
- **L07: FAIL (fidelity + rig)** — crowd rendered at near-named-cast scale filling both frame flanks (violates "clearly smaller crowd... at the far side"), with individuated angry brows / open-shout mouths per figure (violates crowd-rig uniform-simple-face invariant).
- L16/L17 crowd carries more expressive brow/mouth rendering than the minimal §3 vocabulary states but UNIFORMLY across the group and consistent with the prior-verified baseline for this stage — judged a non-blocking style note, not a rig fail.

## Retries (ONE sanctioned retry each, per doctrine)
- L03: exact-replace on the still_prompt's foreground-band clause, forcing flat/featureless cheeks at close-crop scale. Retry crop-verified clean (ear/nose gone, 4-digit hands confirmed at 5x zoom).
- L07: exact-replace on the still_prompt's background clause, adding an explicit relative-scale anchor + explicit uniform-face restatement, dropping the mood adjective that was driving individuated expressions. Retry crop-verified clean (crowd smaller/farther, faces uniform).

## Promotion + stamping
All 10 approved frames sha256-verified copied from `visual-kit/_staging/` into `assets/scenes/<id>.png`. `assets/scenes/manifest.json` entries rebuilt (technique/seeds/parent_depth/lineage/retry_cause) for exactly these 10 ids — no other entries touched. `assets/_review/merged.json`: 10 stale entries replaced with fresh rulings (additive by id, other 31 entries untouched). `stamp_review.py` run twice (batch 1: 8 clean ids; batch 2: 2 post-retry ids) — **all 10 targets now `review_status: verified`, `parked_reasons: []`.**

## Scope-integrity counts
- Scene manifest: 57 entries before -> 57 entries after (no adds/removes, only the 10 targets' fields changed)
- Review store (`visual-kit/_staging/review.json` figures): 213 before -> 214 after (+1 = the fig-drive-maker STEP-1 card)
- merged.json: 41 entries before -> 41 entries after (10 stale entries replaced in place, 31 untouched)
- shots.json, doctrine files, other shots' manifest/merged entries: untouched

## STATUS: all 10 shots VERIFIED. Run complete.

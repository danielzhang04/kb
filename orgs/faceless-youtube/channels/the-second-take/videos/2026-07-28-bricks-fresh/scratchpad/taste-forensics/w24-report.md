# W24 — Wave-1 close-out

## Boss adjudication (verbatim)

the audit-room chair count is non-story-bearing set dressing; three generations produced 10/7/10 against an authored numeral — the medium does not hold exact counts on repeated dressing objects, and no VO or story fact references the number. The payload therefore stops authoring the numeral. (Contrast: L198's "twelve seats in two rows of six" STAYS — a jury of twelve is a story-bearing real-world fact, and it rendered correctly.)

## L84 payload, promotion, and stamp ($0)

- The only prompt splice replaces the exact chair-numeral clause with `stacking chairs pushed in along its far side and one at each rounded end`; the matte-cushion clause and all other text remain present.
- `lint_shots.py`: `HARD violations: none`; tail state: 37 pre-existing heads-up rows.
- Scoped Forge dry: the amended clause occurs exactly once; tail: `1 prompts assembled, 0 API calls, 0 files written` (17 seeding-law violations remained outside scope and were not acted on).
- Promoted `_staging/L84-w22.png` to `assets/scenes/L84.png`; fresh SHA-256 `3ec6ff9fadbd66eb63d1e52573bb2073185830dda6235b0dbe916f7b244b62cd`.
- The manifest row was replaced in place through `forge.py manifest`; the scene status is `verified`. The clean adjudication input was passed through `stamp_review.py`, and the asset-review record was stamped through `stamp_review.py --figures`.
- W23-B axes were copied verbatim as pass: `composition`, `flat_cel_render`, `register`, `outline_consistency`, and `palette_discipline`; its measured zone is `~29%`. `place_fidelity`, `no_figures`, and `lettering` are pass under the adjudication provenance.
- P12 rows (`expr-shock`, `expr-pleading`) were asserted byte-identical before/after the one review-store write. Store tail: `95 -> 96` rows; `P12 FAIL rows byte-identical across 1 store write`.

## Seed board v3

- Rebuilt `seed-board.html`: 99 data-URI embeds, 2,758,649 bytes (2.63 MiB), below 14 MiB; no missing assets.
- Counts: 17 cast, 4 flags, 5 crowd images, 7 cast-free enviro plates, 55 refs/base primitives, 2 props, 2 style anchors, 6 cast-bearing (not plate) scenes.
- The board keeps the Poyais footnote and owed-later table, including L96/L230/L232 and the Wave-2 134-card line.

## Genlog

- Appended W16, W18, W20, and W22 exactly once under `## Wave 1 fix cycle — 2026-08-13/14`.
- Cycle total: `$0.390`. Full Wave-1 running total: `$0.975`.

## Deviations

- The incumbent L84 manifest provenance named the older W8 promotion rather than W11; its bytes were nevertheless replaced in place by the requested W22 candidate and its provenance now records W24.
- The first scoped dry-build used a relative `--out`; Forge rooted it again. The accidental spec was removed and the rerun used the absolute in-scope path. It made no API call.
- The first board rebuild exceeded a 30-second local shell timeout while encoding embedded images; the rerun completed at 640px with the verification above. It made no API call.
- The older duplicate-path subtree still holds three pre-existing W18 specs; it was not removed because it contains files outside W24 scope.
- No commit or push.

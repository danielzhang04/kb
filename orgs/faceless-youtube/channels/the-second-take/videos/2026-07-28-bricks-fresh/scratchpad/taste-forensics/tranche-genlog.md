# Task 14 — asset triage + Pass-1 mint round — GEN LOG

Spend law: $0.039/gen (rate from `remint-genlog.md`, task 12). **HARD STOP $1.50.**
Worktree `boss-taste-forensics` @ eb901bb. Never commit/push.

Tranche = **act 1, L01–L27** (27 shots; the story's own first turn per shots.json step-3a act table).

Mint path (sanctioned, image-generation SKILL.md Pass-1 step 4 "New cast member"):
`forge.py gen --mode new_character --aspect 2:3 --batch <spec>`, seeded off
`refs/base/base.png` ONLY — these are genuine new-character mints, so no identity seed
exists (unlike task 12's re-mints, which had a prior canonical to route identity from).
Identity comes from each character's `registry.json` `characters{}` row (head_tone +
PINNED costume). Resting face + resting stance + flat cel copied from the base template.
Every batch `--dry-run` verified at $0 before any live call.

## Ledger

| # | frame | batch | gens | retries | cost | running total | note |
|---|-------|-------|------|---------|------|---------------|------|
| — | act-1 dry batch (triage) | — | 0 | 0 | $0.000 | $0.000 | 27 shots walked, 17 P3 refusals enumerated, 0 API calls |
| — | grandfather stamp (10 standing assets) | — | 0 | 0 | $0.000 | $0.000 | store write only, no generation |
| — | dry run, all 8 mint items | M | 0 | 0 | $0.000 | $0.000 | 8 prompts assembled, 0 API calls |
| 1 | drive-maker | M | 1 | 0 | $0.039 | $0.039 | OK -> _staging/drive-maker.png |
| 2 | bond-investor | M | 1 | 0 | $0.039 | $0.078 | OK -> _staging/bond-investor.png |
| 3 | return-customer | M | 1 | 0 | $0.039 | $0.117 | OK -> _staging/return-customer.png |
| 4 | brick-co-seller | M | 1 | 0 | $0.039 | $0.156 | OK -> _staging/brick-co-seller.png |
| 5 | tv-chef | M | 1 | 0 | $0.039 | $0.195 | OK -> _staging/tv-chef.png |
| 6 | trial-judge | M | 1 | 0 | $0.039 | $0.234 | OK -> _staging/trial-judge.png |
| 7 | hr-officer | M | 1 | 0 | $0.039 | $0.273 | OK -> _staging/hr-officer.png |
| 8 | crowd-exemplar | M | 1 | 0 | $0.039 | $0.312 | OK -> _staging/crowd-exemplar.png (per-video exemplar) |

| — | dry run, 5 retries | R1 | 0 | 0 | $0.000 | $0.312 | 5 prompts assembled, 0 API calls |
| 9 | trial-judge-r1 | R1 | 1 | 1 | $0.039 | $0.351 | ONE sanctioned retry — glasses clause only (verifier A: identity FAIL, full-rim not half-moon) |
| 10 | drive-maker-r1 | R1 | 1 | 1 | $0.039 | $0.390 | ONE sanctioned retry — explicit no-ears/no-nose clause (verifier B: ear under cap) |
| 11 | return-customer-r1 | R1 | 1 | 1 | $0.039 | $0.429 | ONE sanctioned retry — same clause (verifier B: both ears under beanie) |
| 12 | brick-co-seller-r1 | R1 | 1 | 1 | $0.039 | $0.468 | ONE sanctioned retry — same clause (verifier B: nose AND ear) |
| 13 | hr-officer-r1 | R1 | 1 | 1 | $0.039 | $0.507 | ONE sanctioned retry — same clause (verifier B: ear exposed by bun) |

Retry round: all 5 first-try, no stall window. **$0.507 of the $1.50 cap.**

Round-1 verdicts: 3/8 clean (bond-investor, tv-chef, crowd-exemplar), 5 failed —
4 on ONE systematic mechanism (ears leaking wherever pinned headwear/hair exposes the ear
line) + 1 on lens shape. crowd-exemplar passed both verifiers and was NOT retried.

Retry verdicts: `drive-maker-r1` clean on all 8 axes -> promoted. The ear fix WORKED on all
four, but `return-customer` / `brick-co-seller` / `hr-officer` each came back with a new
`flat_cel_render` defect (quilt lattice / mottled apron / herringbone tweed) and
`trial-judge` failed the same lens shape again plus an ear. Retry spent -> all four PARKED.

## FINAL — 13 provider calls, 0 stalls, 0 lost. **$0.507 of the $1.50 cap.**

Promoted + stamped (4): `drive-maker` (r1), `bond-investor`, `tv-chef`,
`crowd-exemplar` -> `assets/library/crowd-exemplar.png`.
Parked (4): `trial-judge`, `return-customer`, `brick-co-seller`, `hr-officer` — none reached
by the L01-L27 tranche. Full diagnoses in `.superpowers/sdd/.../task-14-report.md`.

Tranche readiness proof (post-stamp, $0): 27 scenes + 7 STEP-1 gens, 0 not generated,
0 review holds (was 17), 0 in-scope seeding violations, exit 0.

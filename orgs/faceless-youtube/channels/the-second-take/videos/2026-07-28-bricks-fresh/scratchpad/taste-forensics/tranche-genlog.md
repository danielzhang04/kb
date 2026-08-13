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

---

# Task 15 — act-1 tranche (L01–L27) generation — GEN LOG

Spend law: $0.039/gen. **HARD STOP $2.75** (cumulative session guard for this task).
Worktree `boss-taste-forensics` @ 1a94fa5. Never commit/push.

Tranche = act 1, **L01–L27**: 27 scenes + 7 STEP-1 cards = **34 requests**.

Route: `forge.py gen --batch <spec>` — the GATED builder slate (forge.py:3136,
`gate=bool(a.batch)`). Task 14's ad-hoc `--seed` exemption deliberately NOT taken: these are
builder-routed slates, so P3 applies to the whole slate.

Rounds by dependency (promote-before-seed + forge chain-depth, forge.py:1268-1272):
  R1 = 7 STEP-1 cards · R2 = 23 non-delta scenes · R3 = 4 deltas (L12←L11, L17←L16,
  L21←L20, L25←L24). One-item batch files, so each gen carries its own 4-min stall ceiling.

## Ledger

| # | frame | round | gens | cost | running total | note |
|---|-------|-------|------|------|---------------|------|
| — | act-1 spec rebuild (`t15-act1.spec.json`) | — | 0 | $0.000 | $0.000 | 34 requests, 0 not generated, exit 0 |
| — | dry gen, full spec | — | 0 | $0.000 | $0.000 | 34 prompts assembled, 0 API calls |
| — | dry run, round 1 | R1 | 0 | $0.000 | $0.000 | 7 prompts assembled, 0 API calls |
| 1-7 | 7 STEP-1 cards | R1 | 0 | $0.000 | $0.000 | **ALL 7 HTTP 429 — provider quota exhausted. 0 images returned, 0 billable.** |
| — | quota probe ×6 over ~6 min | — | 0 | $0.000 | $0.000 | 6/6 HTTP 429; not transient |

## BLOCKED — provider quota, free tier, limit 0

Every request returned `429 RESOURCE_EXHAUSTED`. forge's own `nano()` already retries 429 five
times at 12s (forge.py:80-83), so each of the 7 gens burned all five attempts (~55-63s each)
and still failed. The full body names the binding violation:

```
Quota exceeded for metric:
  generativelanguage.googleapis.com/generate_content_free_tier_requests
  limit: 0, model: gemini-3-pro-image
quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier
status: RESOURCE_EXHAUSTED
```

**`limit: 0` on the FREE tier is the diagnosis.** The project is being metered as free tier, and
the free-tier allowance for `gemini-3-pro-image` is zero — so this is not "we spent our paid
quota", it is "the project is no longer on the paid plan". Task 14 generated 13 images through
this exact key/kit/worktree a few hours earlier, so the tier changed between the two tasks.

The body advertises `retryDelay: 56s`, which is a red herring — that belongs to the per-MINUTE
violation listed alongside it. The **per-DAY** violation carries limit 0, which no wait clears.
Probed 6 times across ~6 minutes to confirm rather than assume: 6/6 identical 429.

**Spend: $0.000.** No image was returned, so nothing was billable. Staging verified clean —
0 new PNGs, 0 orphaned `.lock` or `.tmp` files (forge releases its reservation on a failed call).

Not self-fixable within the agent ceiling: `Kit` takes its key from exactly one source
(`load_env(root)["GEMINI_API_KEY"]`, forge.py:332), so there is no stale-vs-fresh key to switch
between, and restoring billing on the API project is a credential/billing action this agent must
never take.

**Tranche state: READY and unchanged.** Task 14's readiness proof still holds — the spec builds
34 requests at $0 with 0 review holds and 0 in-scope seeding violations. The moment paid quota
is restored, `py -3 t15_gen.py 1 --live` resumes at round 1 with nothing to redo.

---

# Mint round - crowd re-roll + flat-fill cast retries (GEN ONLY)

| # | frame | round | gens | cost | running total | note |
|---|-------|-------|------|------|---------------|------|
| 1 | return-customer-r2-flat-fill-candidate | R2 | 1 | $0.039 | $0.039 | OK -> _staging/return-customer-r2-flat-fill-candidate.png; local ear ban retained, navy quilted coat flat-fill clause |
| 2 | brick-co-seller-r2-flat-fill-candidate | R2 | 1 | $0.039 | $0.078 | OK -> _staging/brick-co-seller-r2-flat-fill-candidate.png; local ear ban retained, heavy canvas apron flat-fill clause |
| 3 | hr-officer-r2-flat-fill-candidate | R2 | 1 | $0.039 | $0.117 | OK -> _staging/hr-officer-r2-flat-fill-candidate.png; local ear ban retained, long tweed skirt flat-fill clause |
| 4 | crowd-exemplar-reroll-candidate | R2 | 1 | $0.039 | $0.156 | OK -> _staging/crowd-exemplar-reroll-candidate.png; 6-figure crowd re-roll with 3-3.5-head squat proportion law |
| 5 | crowd-exemplar-reroll-r2-candidate | R2 | 1 | $0.039 | $0.195 | OK -> _staging/crowd-exemplar-reroll-r2-candidate.png; retained t16 crowd prompt with exact-uniform 3-3.5-head build, compact bodies, and short stubby legs under one head-width |

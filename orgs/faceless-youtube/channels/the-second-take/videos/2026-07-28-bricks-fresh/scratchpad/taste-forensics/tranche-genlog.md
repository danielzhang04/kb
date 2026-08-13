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
| 6 | crowd-exemplar-reroll-r3-candidate | R3 | 1 | $0.039 | $0.234 | OK -> _staging/crowd-exemplar-reroll-r3-candidate.png; channel crowd frame seed pinned; restyled only era dress, distributed flat head tones, and repeating hair silhouettes |

## Wave 1 — 2026-08-13

### W1 plate mints

- 2026-08-13 | L65 | dry: cast-free PLATE; one reviewed `scene-style-tile` style-anchor seed; 0 API calls / $0.000.
- 2026-08-13 | L65 | first live invocation: local batch-path resolution failed before forge loaded the spec; 0 API calls / $0.000; reissued with the absolute spec path.
- 2026-08-13 | L65 | generated `visual-kit/_staging/L65.png` via gated one-item batch; 1 API call, 55.9 s, 0 stalls, 0 503s; $0.039 cumulative $0.039. No promotion, stamp, or manifest write.
- 2026-08-13 | L84 | dry: cast-free PLATE; one reviewed `scene-style-tile` style-anchor seed; 0 API calls / $0.000.
- 2026-08-13 | L84 | generated `visual-kit/_staging/L84.png` via gated one-item batch; 1 API call, 54.3 s, 0 stalls, 0 503s; $0.039 cumulative $0.078. No promotion, stamp, or manifest write.
- 2026-08-13 | L86 | dry: cast-free PLATE; reviewed `lettering-marker-italic` and `scene-style-tile` seeds; 0 API calls / $0.000.
- 2026-08-13 | L86 | generated `visual-kit/_staging/L86.png` via gated one-item batch; 1 API call, 58.0 s, 0 stalls, 0 503s; $0.039 cumulative $0.117. No promotion, stamp, or manifest write.

### W2 plate-mint generation log

- Rate: $0.039 per live provider call
- Hard cap: $0.300
- Scope: L112, L114, L198; gated one-item batches only

| Shot | Attempt | Result | Elapsed | Calls | Stalls | Spend |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| L112 | 1 | OK — `_staging/L112.png` | 40.3s | 1 | 0 | $0.039 |
| L114 | 1 | OK — `_staging/L114.png` | 70.7s | 1 | 0 | $0.039 |
| L198 | 1 | OK — `_staging/L198.png` | 58.0s | 1 | 0 | $0.039 |

**Total:** 3 calls, 0 stalls, $0.117; $0.183 remains under the $0.300 cap.

### W3 - hr-officer canonical re-run

- Date: 2026-08-13
- Result: `OK` (one live provider call; 39.9 seconds)
- Forge route: `forge.py gen --kit channels/the-second-take/visual-kit --mode new_character --aspect 2:3 --name w3-hr-officer-rerun --character hr-officer --seed refs/base/base.png --delta <below>`
- Forge output renamed without modification from `_staging/w3-hr-officer-rerun.png` to `_staging/hr-officer-w3-rerun-candidate.png`.
- SHA-256: `c99e4915f0ffa5b3dd80d0a45445b03b4b66fdc3c0384cd67c6009e102f383e8`
- Spend: `$0.039` (one 1K `gemini-3-pro-image` call; forge default). Cap remaining: `$0.061`.
- Deviations: none. The T16 hr-officer delta was reused byte-for-byte; only forge's output name was W3-specific before the requested rename. No verification, promotion, stamping, registry write, or canonical-ref write.

## Exact delta passed to forge

```text
A full-body standing character reference sheet of ONE cast member, the HR officer, a woman. IDENTITY: dark hair pinned up, slight build, flat head tone #e0b48d; costume is a rust-red knitted cardigan over a cream blouse, a long tweed skirt and flat shoes, with reading spectacles hanging on a chain at the chest. The long tweed skirt is one single flat solid colour fill in flat cel shading - no fabric texture, no weave, no stitching, no quilting lines, no herringbone, no mottling; the only shading is the style's simple two-tone cel shadow.  CRITICAL FACE RULE, overriding anything the costume suggests: this character has NO EARS AT ALL and NO NOSE AT ALL. Draw NO ear on either side of the head - not under the headwear, not beside the hair, not in front of it. The sides of the head are smooth bare skin running unbroken down to the jawline, with no ear shape, no ear outline and no inner-ear line anywhere. Draw NO nose - no nose shape, no bridge, no nostril line, no shading where a nose would be. The face carries ONLY eyes, brows and a mouth. Flat stylized cartoon skull - no jaw, no cheekbones, no realistic face structure. RESTING FACE (copy EXACTLY from the reference image, the bald template): heavy lowered upper eyelids covering the top of each eye, small pupils set high against the upper lid, thin level gently-arched brows, and a small closed mouth with the faintest upturn at its corners. Eyes look straight out at the viewer, level and symmetric, not sideways, not up, not down. RESTING STANCE (copy EXACTLY from the reference image): standing straight and frontal, facing the viewer square-on, both shoulders level, both arms hanging straight down at the sides, both hands open, relaxed and EMPTY, feet flat and evenly planted. Carries NOTHING and touches nothing. No emotion of any kind, completely neutral and at rest. Plain flat light-grey studio background, no horizon line, no floor line, no props, no text.
```

### W4 — core-base primitive re-runs — generation log

Scope: stage-only fresh candidates for `handshake`, `expr-laughing`, `action-offering`, and `action-slump`. No registration, promotion, stamping, or `refs/base/` mutation.

## Sanctioned route

- `image-generation/SKILL.md:92-98` — base-seeded `2:3` pose/action/interaction primitives hold the base resting face; interaction templates use two blank mannequins, contact geometry, and pupils-only eye-line; expressions are moderate.
- `forge.py:382-393, 1233-1249, 1312-1320` — `gen` assembles the locked identity descriptor, preflights at $0, seeds the supplied base PNG, then writes only to kit `_staging/`.
- `2026-07-10-character-asset-base-expansion-build.md:181-189` — handshake’s two-mannequin intent and right-to-right clasp geometry.

## Preflight plan

All four calls use `forge.py gen --mode identity --aspect 2:3 --seed refs/base/base.png`, 1K default, and names reserved to this worker as `w4-*-rerun-candidate`. Historical local ledger rate: $0.039/call; planned maximum: $0.156 of the $0.30 cap.

| Primitive | Delta sent after forge’s locked identity descriptor | Dry run | Live result | Spend |
| --- | --- | --- | --- | --- |
| handshake | TWO blank bald base mannequins, both in the base costume and base RESTING face, full-body on a plain soft light-grey studio ground. A genuine right-to-right handshake: the LEFT mannequin reaches ACROSS its own body with its right arm; the RIGHT mannequin reaches with its right arm; their hands clasp cleanly at chest height, each hand a classic four-digit cartoon hand. Each free left hand hangs at that figure's outer side. Keep both heads front-facing with no turn: only their pupils look toward the other figure. Medium 3/4 two-shot, both figures on the same plane, no props, no text. | clean, 0 calls | `visual-kit/_staging/w4-handshake-rerun-candidate.png` | $0.039 |
| expr-laughing | One full-body base figure in the base's unchanged relaxed standing pose, base costume and plain soft light-grey studio ground. Change ONLY the facial expression to a moderate, legible laugh: gently lifted brows, happy crescent eyes, and a clearly open smiling mouth. No extreme caricature, no props, no text. | clean, 0 calls | `visual-kit/_staging/w4-expr-laughing-rerun-candidate.png` | $0.039 |
| action-offering | One full-body base figure on a plain soft light-grey studio ground, base RESTING face unchanged. A reusable OFFERING pose: torso upright, both arms extended forward at waist height, both empty open palms turned up and slightly cupped as if offering an absent object; hands clearly separated and fully visible, each a classic four-digit cartoon hand. No object, no props, no text. | clean, 0 calls | `visual-kit/_staging/w4-action-offering-rerun-candidate.png` | $0.039 |
| action-slump | One full-body base figure on a plain soft light-grey studio ground, base RESTING face unchanged. A reusable SLUMP: shoulders dropped, upper body sagging forward, arms hanging loose at the sides, head inclined down; clear defeated posture without any object, props, or text. | clean, 0 calls | `visual-kit/_staging/w4-action-slump-rerun-candidate.png` | $0.039 |

## Result

Four 1K calls completed: 0 provider errors, 0 429s, 0 503s, 0 stalls, and 0 re-issues. **Total: $0.156 / $0.300.** Candidates remain staged only; the verifier pairs rule them next.

### W11 — targeted Wave-1 texture retries

- Date: 2026-08-13
- Rate: $0.039 per 1K call; cap: $0.250
- Policy: 4-minute stall -> one re-issue; two 503s park; two FreeTier limit-0 429s halt globally as BILLING.
- No promotion, registry, manifest, or review-store write for these retries.

| Frame | Added local clause | Result | Elapsed | Spend | Staged path |
| --- | --- | --- | ---: | ---: | --- |
| L65 | the floor is one single flat solid colour fill in flat cel shading - no basket-weave, no pattern, no texture; at most one clean darker cel shadow slab | OK | 42.1s | $0.039 | `channels/the-second-take/visual-kit/_staging/L65-w11-retry.png` |
| L86 | the shrink-wrapped cartons use flat wrap fills, clean line-art wrap lines only, no gradient sheen, no airbrushed streaks, no soft highlights | OK | 50.5s | $0.039 | `channels/the-second-take/visual-kit/_staging/L86-w11-retry.png` |
| L112 | the concrete floor is one flat concrete fill and the yellow lane paint is clean flat stripes, no scuff marks, no smears, no feathered gradients | OK | 42.2s | $0.039 | `channels/the-second-take/visual-kit/_staging/L112-w11-retry.png` |
| hr-officer | The long tweed skirt is one single flat solid colour fill in flat cel shading - no crosshatch, no lattice, no weave, no herringbone, no fabric texture of any kind; flat like a paper cut-out; the only shading is the style's simple two-tone cel shadow.  | OK | 32.7s | $0.039 | `channels/the-second-take/visual-kit/_staging/hr-officer-w11-retry-candidate.png` |

**Total:** $0.156 across 4 successful 1K calls; cap remaining $0.094.

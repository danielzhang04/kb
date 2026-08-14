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

## Wave 1 fix cycle — 2026-08-13/14

### w16-genlog

# W16 — handshake re-roll — generation log

- Date: 2026-08-13
- Scope: one stage-only candidate. No promotion, stamping, registry, manifest, or `refs/base/` mutation.
- Route: `forge.py gen --mode identity --aspect 2:3 --seed refs/base/base.png`, 1K default, per `image-generation/SKILL.md` interaction-primitive recipe.
- Spend cap: $0.100. Historical 1K rate: $0.039.
- Failure policy: 4-minute stall → one re-issue; two `FreeTier limit=0` 429s → halt and report `BILLING`.

## Exact delta prompt

TWO blank bald base mannequins, both in the base costume and base RESTING face, full-body on a plain soft light-grey studio ground. Both heads are EXACTLY the reference image's head — same large round slightly-wide bald skull shape, same proportion of head to body (3 to 3.5 head-widths tall, squat, short legs), same eyes copied exactly (heavy lowered upper eyelids, small pupils set high against the lid, thin level brows) — no almond eyes, no smaller heads, no lankier bodies than the reference. A genuine right-to-right handshake: the LEFT mannequin reaches ACROSS its own body with its right arm; the RIGHT mannequin reaches with its right arm; their hands clasp cleanly at chest height, each hand a classic four-digit cartoon hand. Each free left hand hangs at that figure's outer side. Keep both heads front-facing with no turn: only their pupils look toward the other figure. Medium 3/4 two-shot, both figures on the same plane, no props, no text.

## Exact Forge-assembled provider prompt

Keep this the SAME single character as the reference — INVARIANTS that never change: SAME perfectly bald ROUND head (a soft near-circle, only slightly taller than wide — NOT an egg or oval); the SAME flat head colour AS THE REFERENCE character (the base default is #f5ead6, but a named cast member keeps ITS OWN head tone — never forced to cream); SAME dark warm brown-black outline (#241a12); SAME simple cartoon eyes + thin brows, NO nose, NO ears; SAME simple hands — a classic cartoon hand with exactly THREE fingers plus ONE thumb (four digits total, like a Mickey Mouse / Simpsons hand), NEVER four fingers, NEVER five digits; SAME clean FLAT cel cartoon style, even medium-thick line. Reads unmistakably as the same guy. No text, plain soft light-grey studio background.

TWO blank bald base mannequins, both in the base costume and base RESTING face, full-body on a plain soft light-grey studio ground. Both heads are EXACTLY the reference image's head — same large round slightly-wide bald skull shape, same proportion of head to body (3 to 3.5 head-widths tall, squat, short legs), same eyes copied exactly (heavy lowered upper eyelids, small pupils set high against the lid, thin level brows) — no almond eyes, no smaller heads, no lankier bodies than the reference. A genuine right-to-right handshake: the LEFT mannequin reaches ACROSS its own body with its right arm; the RIGHT mannequin reaches with its right arm; their hands clasp cleanly at chest height, each hand a classic four-digit cartoon hand. Each free left hand hangs at that figure's outer side. Keep both heads front-facing with no turn: only their pupils look toward the other figure. Medium 3/4 two-shot, both figures on the same plane, no props, no text.

## Ledger

| Step | API calls | Spend | Result |
| --- | ---: | ---: | --- |
| preflight | 0 | $0.000 | clean: 1 prompt assembled; output target and base seed resolved; 0 API calls and 0 files written |
| handshake-w16-rerun-candidate | 1 | $0.039 | OK → `visual-kit/_staging/handshake-w16-rerun-candidate.png` (completed within the 4-minute ceiling; no re-issue) |

**Total: $0.039 / $0.100.** No provider errors, 429s, stalls, re-issues, promotion, stamping, or mutation under `refs/base/`.

## Deviation

The first attempt to start a background monitor failed before `forge.py` launched because this Windows shell exposed duplicate `Path` / `PATH` entries to `Start-Process`. It made no provider call and created no candidate. The direct Forge invocation then completed normally.

### w18-genlog

# W18 plate re-gen log — 2026-08-13

Cap: $0.30. Tier: Forge 1K (nominal $0.039 per provider call).

| Plate | Spec / provider target | Result | Staged W18 candidate | Nominal spend |
| --- | --- | --- | --- | --- |
| L198 | `w18-L198.spec.json` / `L198` | first call OK (46.2s) | `_staging/L198-w18.png` | $0.039 |
| L65 | `w18-L65.spec.json` / `L65-w18` | first call OK (114.2s) | `_staging/L65-w18.png` | $0.039 |
| L84 | `w18-L84.spec.json` / `L84` | first live attempt skipped because `_staging/L84.png` existed ($0); forced first call OK (46.9s) | `_staging/L84-w18.png` | $0.039 |
| L86 | `w18-L86.spec.json` / `L86` | forced first call OK (48.9s) | `_staging/L86-w18.png` | $0.039 |

Total: 4 provider calls, nominal $0.156. No stall (4-minute threshold), 503, or 429. No re-issue.

All four specs were rebuilt from canonical `shots.json` after the PLATE COMPOSITION law and L86 payload splice. L65 alone uses the sanctioned one-span `forge-retry-overlay@2` replacement to retain W11's flat-floor clause. No promotion, review stamp, or scene-manifest mutation was performed.

### w20-genlog

# W20 promote, payload, and plate re-gen log — 2026-08-14

## Handshake promotion ($0)

- Promoted `_staging/handshake-w16-rerun-candidate.png` to `refs/base/handshake.png`.
- New canonical SHA-256: `842bfa0f09b6dd166c3dfda30662d301495e039b2ed55e48cfefee09a851fb0c`.
- W19-A + W19-B axes were merged as all-pass under `refs/base/handshake.png`; reviewer: `sonnet verifier pair w19, Daniel head/proportion/eye re-run ruling 2026-08-13`.
- The original backup `refs/base/handshake-pre-rerun-2026-08-13.png` remains present.
- P12 records (`refs/base/expr-pleading.png`, `refs/base/expr-shock.png`) had canonical serialized bytes SHA-256 `b077ce35de84f0dd6f17721e815b32dddf35401a0102a9b43fa74df798d9acf2` before and after the stamp: PASS.

Stored row:

```json
{"canonical_sha256":"842bfa0f09b6dd166c3dfda30662d301495e039b2ed55e48cfefee09a851fb0c","expression_sha256":null,"verdicts":{"primitive_semantics":"pass","base_identity":"pass","head_shape":"pass","no_nose_no_ears":"pass","four_digit_hands":"pass","proportion":"pass","flat_cel_render":"pass","outline_consistency":"pass"},"reviewer":"sonnet verifier pair w19, Daniel head/proportion/eye re-run ruling 2026-08-13","date":"2026-08-13"}
```

## Payload rewrites

### L65 — wiles-office

Before:

> A wide sun-bleached office seen head-on and entirely empty of people: a big desk across the midground carrying a black telephone and one closed folder, an empty high-backed leather swivel chair pushed back behind it, a tall window filling the back wall on a flat pale sky and the tops of two palms. A potted palm stage-left, a bare cream wall stage-right with nothing hung on it. Cream-amber-charcoal palette, hard afternoon sun laid in one bright slab across the desk and carpet, foreground depth from a cropped visitor chair back at the lower-left.

After:

> A wide sun-bleached cast-free office seen head-on: an open stretch of cream carpet runs from the foreground into the midground. In the back third by the tall window, a big desk carries a black telephone and one closed folder, with an empty high-backed leather swivel chair pushed back behind it. The tall window fills the back wall with a flat pale sky and the tops of two palms; a potted palm stands stage-left and a blank cream wall stands stage-right. Cream-amber-charcoal palette, hard afternoon sun laid in one bright slab across the desk and carpet, foreground depth from a cropped visitor chair back at the lower-left edge.

### L84 — audit-room

Before:

> A plain meeting room seen wide and entirely empty of people: a long table across the midground with eight stacking chairs pushed in, two closed grey steel document boxes squared up at the near end of it, a coat stand by the door stage-left holding nothing, a window at the back onto the frosted car park. Cool grey-cream-teal palette, flat overcast daylight with one strip fitting on, foreground depth from a cropped chair back at the lower-right.

After:

> A plain cast-free meeting room seen wide: an open floor zone runs from the foreground into the midground. Along the back wall, a long table runs stage-right with eight stacking chairs pushed in and two closed grey steel document boxes squared up on its near end; a coat stand stands by the door stage-left, and a window at the back looks onto the frosted car park. Cool grey-cream-teal palette, flat overcast daylight with one strip fitting on, foreground depth from a cropped chair back at the lower-right edge.

### L86 — miniscribe-warehouse

Before:

> A wide warehouse aisle seen head-on and entirely empty of people: steel pallet racking four bays high running away on both sides, pallets of flat cartons filling the lower two tiers, the shrink wrap represented only by one flat pale cel band and two or three crisp hard-edged contour lines per pallet face, a concrete floor with yellow lane paint, roof lights in a row overhead. Cool grey-teal-cream palette, flat industrial light, foreground depth from a cropped rack upright at the right edge. Painted across the end panel of the racking that closes the aisle: 'MINISCRIBE'.

After:

> A wide warehouse aisle seen head-on and entirely empty of people: steel pallet racking four bays high running away on both sides, pallets of flat cartons filling the lower two tiers, their wrap surfaces matte flat colour with only one flat pale cel band and two or three crisp hard-edged contour lines per pallet face, a concrete floor with yellow lane paint, roof lights in a row overhead. Cool grey-teal-cream palette, flat industrial light, foreground depth from a cropped rack upright at the right edge. Painted across the end panel of the racking that closes the aisle: 'MINISCRIBE'.

### L198 — jury-courtroom

Before:

> A courtroom seen wide from the back of the well and entirely empty of people: a raised timber bench across the far end with an empty high-backed chair behind it, an empty jury box of twelve seats stage-left, two counsel tables squared up in the midground, rows of gallery pews running toward the viewer. Panelled walls with tall plain windows, cream-oak-teal palette, cold daylight from stage-left across the empty pews, foreground depth from a cropped pew back across the bottom of the frame.

After:

> A cast-free courtroom seen wide from the well: an open courtroom-well floor runs from the foreground into the midground. At the back, a raised timber bench holds an empty high-backed chair behind it; stage-left, an empty jury box has exactly twelve seats in two rows of six. Two counsel tables sit to the sides of the well, and gallery pews flank the well behind them. Panelled walls with tall plain windows, cream-oak-teal palette, cold daylight from stage-left across the gallery pews, foreground depth from a cropped pew end at one lower corner.

## Validation ($0)

- Lint: `0 HARD` violations; its tail is in `w20-lint.txt` (37 pre-existing heads-up rows remain).
- Scoped dry: 4/4 assembled at 1K, each payload matches `shots.json` and appears exactly once in its assembled delta; `w20-dryrun.txt` ends `4 prompts assembled, 0 API calls, 0 files written`.
- The scoped slate reports 17 seeding-law violations outside the four-shot scope; none was acted on.

## Live generation (cap $0.25)

Tier: Forge 1K, nominal $0.039 per provider call.

| Plate | W20 spec | Result | Staged candidate | SHA-256 | Nominal spend |
| --- | --- | --- | --- | --- | --- |
| L65 | `w20-L65.spec.json` | first call OK | `_staging/L65-w20.png` | `678f8f54649e9bc68ac7aa1721ec5a97d0562b033fec18ebeaac5103399c185c` | $0.039 |
| L84 | `w20-L84.spec.json` | first call OK | `_staging/L84-w20.png` | `b48f9b1d6953686c9f68759665a9e6734e606ed104fd74c2681c0c2b747b532b` | $0.039 |
| L86 | `w20-L86.spec.json` | first call OK | `_staging/L86-w20.png` | `0aee609d8069cabf948ac93f7b6780674e15e7ebdb6fff5166c0b513bc140c19` | $0.039 |
| L198 | `w20-L198.spec.json` | first call OK | `_staging/L198-w20.png` | `5999ae3e3a99e847fa447a70167026768a47c90ea8b4624915a77627c9d1966e` | $0.039 |

Total: 4 provider calls, nominal $0.156 / $0.25 cap. No stall, reissue, 503, 429, billing halt, promotion, scene-manifest write, or review stamp for the four plates.

## Deviations

- Two zero-cost command-construction errors occurred before live generation: the first omitted Forge's positional subcommand; the second used a relative `--out`, creating one W20 spec under a duplicated project prefix. Neither called the provider. The accidental file was removed, then the absolute in-scope output was used.
- PowerShell background launching initially rejected duplicate `Path`/`PATH` process entries. Removing the duplicate `PATH` entry only from the launcher process allowed monitoring; `.env` was not read or modified.

### w22-genlog

# W22 L84 targeted retry

## Scope and preflight ($0)

- L84 `still_prompt` only: chair geometry is now explicit (EXACTLY eight: six far-side plus one at each rounded end); the open teal floor is limited to the near third; two closed grey steel document boxes remain squared on the table; every chair cushion is a single-colour, crisp-edge, unblended matte fill.
- `lint_shots.py`: `HARD violations: none`; 37 pre-existing heads-up rows remain.
- Scoped Forge batch: L84 only; 17 seeding-law violations remained outside this scope and were not acted on.
- Scoped dry: one `L84-w22` request assembled at 1K, the revised payload appeared once, and the tail reported `1 prompts assembled, 0 API calls, 0 files written`.

## Live generation (cap $0.10)

| Request | Result | Staged candidate | SHA-256 | Nominal spend |
| --- | --- | --- | --- | --- |
| L84-w22 | first provider call OK | `_staging/L84-w22.png` | `3ec6ff9fadbd66eb63d1e52573bb2073185830dda6235b0dbe916f7b244b62cd` | $0.039 |

Total: 1 provider call, nominal $0.039 / $0.10 cap. The call completed in about 25 seconds, so the four-minute stall threshold and one permitted re-issue were not triggered. No 503, billing event, promotion, scene-manifest write, or review stamp was performed for L84.

## Deviation

The literal negative phrase `no gradient, no soft highlight` caused the prompt linter's only hard violation because `gradient` is a banned render-technique term. It was replaced, without changing the requested surface constraint, by `single-colour fill with a crisp hard edge and an unblended matte surface`; the subsequent lint had 0 HARD violations.

**Cycle total (w16+w18+w20+w22): $0.390. Wave-1 running total: $0.975.**

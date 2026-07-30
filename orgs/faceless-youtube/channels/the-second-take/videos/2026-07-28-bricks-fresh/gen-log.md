# gen-log — `2026-07-28-bricks-fresh` (full 215-shot video + thumbnail)

Incremental state log, written after every phase. Scope: L01-L42 carried forward byte-identical
from the reviewed `_bricks-seg` slice (no re-review, no regen); L43-L215 + thumbnail set is this
run's own Pass-1 + Pass-2 work.

## Running spend

| Metric | Value |
| --- | --- |
| Generations made this run | **354** — 6 Pass-1 canonicals + 348 Pass-2/retry/repair gens |
| Spend | **~$47.4** (354 × $0.134, 2K tier throughout) |
| Hard cap | $60.00 — **not reached**, ~$12.6 headroom left |
| API failures across the whole run | 12 transient (`HTTP 503` / empty `inlineData`), **0 unrepaired** — every one retried clean |
| L43-L215 + thumbnail: fully clean on first Pass-2 pass | 56 / 176 (32%) |
| **Final: verified / parked** (whole 215-shot video + thumbnail, 218 manifest entries) | **187 / 31** |
| L01-L42 (carried forward, untouched) | 22 verified / 20 parked (byte-identical to `_bricks-seg`) |
| L43-L215 + thumbnail (this run) | 165 verified / 11 parked |
| Retry wave | 120 shots retried (ONE surgical retry each, Daniel's cap), 109 fixed / 11 still parked |
| Tier | 2K, `$0.134`/gen (`forge.py IMAGE_SIZE_DEFAULT`; 4K never passed) |

## Wall-clock (UTC, 2026-07-30)

| Phase | Start | End | Duration | Gens |
| --- | --- | --- | --- | --- |
| Read skill + bible + grammar + registry + video files | 08:19 | 08:26 | ~7 min | 0 |
| Pass 1 — mint 4 cast + 2 poses, dry-run, generate | 08:26 | 08:32 | ~6 min | 6 (1 transient retry) |
| Pass 1 — visual §3 verify (paired crops, viewing scale) + register | 08:32 | 08:39 | ~7 min | 0 |
| Pass 1 tag write-back + Pass-2 batch build (173 shots + thumb) + dry-run validate | 08:39 | 08:43 | ~4 min | 0 |
| Pass 2 — main parallel batch (`--concurrency 4`) | 08:43 | 09:38 | ~55 min | 209 (200 first-pass + 9 in-run repaired) |
| Post-hoc audit + fix: dropped-anchor bug (7 shots) + missed continuity seeds (11 shots) | 09:38 | 10:05 | ~27 min | 19 |
| Dossier build + review dispatch (9 agents: 3 batches × rig/fidelity/style, parallel) | 10:05 | 10:30 | ~25 min | 0 (review only) |
| Rig gap-fill dispatch (3 agents — original rig judges covered 92/111 figure shots) | 10:31 | 10:42 | ~11 min | 0 (review only) |
| Merge + DSG-schema normalization + retry-batch build + dry-run validate | 10:42 | 10:46 | ~4 min | 0 |
| Retry wave (120 flagged shots, `--concurrency 5`, ONE per shot) | 10:46 | 11:12 | ~26 min | 120 (116 first-pass + 4 repaired) |
| Self-check (flagged-points-only, 8 contact sheets + targeted crops) + stamp + board | 11:12 | 11:22 | ~10 min | 0 |
| **Total** | **08:19** | **~11:22** | **~3h 3min** | **354** |

Parallel batch mode (`--concurrency 4-5`) throughout Pass 2 and the retry wave; no rate-limit
pressure ever observed (only isolated transient 503s / empty responses, ~3% of calls, all
repaired). Compares to the `_bricks-seg` 42-shot slice's serial run (~3h for 91 gens): this run
did **354 gens covering 215 shots** (5.6× the volume) in roughly the same wall clock — the
concurrency + up-front batch validation (dry-run, seed-cap audit) is the lever, not raw luck.

## Stage A — Pass 1: resolve, gate, build, verify, register (zero review-agent spend)

Read fresh: `image-generation` SKILL.md, `forge.py` (1034 ln), `style-bible.md`, `visual-grammar.md`,
`registry.json` (11 characters, 69 assets pre-run), `2026-07-28-bricks-fresh/shots.json` (215
shots — L01-L42 imported from `_bricks-seg`, L43-L215 authored this run per `vpw-log.md`).

Resolved 173 new shots + thumbnail set: **33 backticked names already in the registry** (base
poses/expressions, `miniscribe-rep`) vs **6 MISSING** — 4 new named cast (`qt-wiles`, `hq-banker`,
`brick-foreman`, `auditor-rep`) + 2 new pose primitives (`recline`, `lie-supine`), all previously
flagged by `visual-prompt-writer`'s own `notes` as Pass-1 mint candidates, per dispatch pre-approval.

No new environment archetype was needed: all 47 new-material stage palettes (warm interior /
cool interior / exterior / map) fit the 5 existing `refs/env/` register anchors — including the
courtroom beats (L177/L178/L185/L192 etc.), judged cool/pale-daylight against `env-interior-cool`.
Judged, not gold-plated, per the dispatch's own instruction.

### Pass 1 build — 6 gens, $0.80

| Name | Mode | Aspect | Seed | Head tone |
| --- | --- | --- | --- | --- |
| `qt-wiles` | new_character | 2:3 | `refs/base/base.png` | `#d3a878` |
| `hq-banker` | new_character | 2:3 | `refs/base/base.png` | `#e6c69c` |
| `brick-foreman` | new_character | 2:3 | `refs/base/base.png` | `#cf8f5c` |
| `auditor-rep` | new_character | 2:3 | `refs/base/base.png` | `#a67c52` |
| `recline` | identity (pose primitive) | 2:3 | `refs/base/base.png` | n/a |
| `lie-supine` | identity (pose primitive) | 2:3 | `refs/base/base.png` | n/a |

One transient `HTTP 503` on `lie-supine`; plain re-run (idempotent, nothing had been written)
generated it clean.

### Pass 1 verify — all 6 PASS, no retries

Verified against bible §3 via paired crops (canonical zone vs `refs/base/base.png` and
`refs/macgregor/macgregor-base.png` as controls, 4-8× zoom), per the segment run's own lesson that
an isolated zoom is inadmissible:

- **Face/no-nose**: all 4 new characters — no nose visible on any (age-crease linework on
  `qt-wiles`/`hq-banker` correctly read as brow wrinkles, not a nose, on paired inspection).
- **Ear gap**: all 4 — hair forms one continuous curved silhouette from temple to jaw, matching
  the `macgregor` correctly-filled-hair control; no bounded/outlined lobe shape on any.
- **Hands**: `qt-wiles`, `hq-banker`, `brick-foreman`, `auditor-rep` all show 4 digits (3 fingers +
  thumb) on at least one clearly-open hand each; closed/relaxed hands correctly left unasserted per
  the ambiguity rule.
- **`recline`**: round head, no nose/ears, base costume, ONE clearly visible hand at 4 digits.
- **`lie-supine`**: round head, no nose/ears, base costume; visible hand is relaxed/half-closed —
  correctly left unasserted, not condemned, per the ambiguity rule.

All 6 registered to `refs/` (4 new `characters` entries + 2 new `assets` pose rows). Registry now
15 characters, 75 assets.

### Pass 1 tag write-back

`assets` tags written onto all 173 new shots (resolved from `registry.json`, never hand-typed).
`assets/library/manifest.json` documents all 46 distinct assets used across the FULL 215-shot
video (4 generated this run, 42 reused) — L01-L42's own Pass-1 assets are `_bricks-seg`'s work,
already promoted to the shared `refs/` registry, reused here unchanged.

## Stage B — Pass 2: batch spec construction

Built programmatically (`scratchpad/build_batch.py`): per-shot technique/seed/anchor resolution,
33 shots identified as **mandatory two-gen identity-pass ladder units** (exactly one seeded human
cast member, environment-dominated `still_prompt`, per the skill's now-mandatory rule), 91 total
unit heads (bases/standalones), 82 delta/continuity shots seeding their parent frame.

**11 shots needed a curated continuity seed** the mechanical stage-chain walk couldn't find on its
own — a re-based `stage` id or a same-object callback with no `stage_role: "delta"` link (e.g. L94
re-opens the `quota-room` set under a new stage name; L134 explicitly callbacks L106's balance
image; L207 explicitly says "the same brickyard gate from earlier"). Found by grepping every
non-delta `still_prompt` for continuity language (`"the same X"`, `"once more"`, `"unchanged"`) and
resolving each to its real antecedent shot by hand — not exhaustive on the first pass (see
Corrections below).

Pre-flight validated with `forge.py gen --dry-run` (zero API calls) on all root/non-dependent
entries (94/209) before spending a cent, plus an offline seed-cap/seed-resolution audit script
mirroring forge's own checks for the dependency-chain entries dry-run cannot resolve (parent
frames don't exist yet).

## Stage C — Pass 2 generation: 209 gens, $28.01, 0 unrepaired failures

Ran as ONE parallel batch (`--concurrency 4`) rather than gated per-act generation — the dispatch's
"parallel batch mode" instruction, with review still run in 3 act-aligned batches after. 5
transient API errors mid-run (all `HTTP 503` or empty response) cascaded to 4 dependent skips;
all 9 repaired in a follow-up idempotent sub-batch (`forge.py` skip-if-exists means a re-run only
regenerates what's actually missing).

**Mechanical validation before building anything on top:** all 215 scene files measured at
2752×1536 (16:9, 2K tier) — zero mis-framed portraits, zero PNGs under 1KB.

## Stage D — post-hoc build-defect audit (before spending review-agent budget)

Two real gaps found and fixed BEFORE dispatching the fresh-eyes review, per the anti-rework law
(don't spend review cycles judging frames known to be structurally wrong):

1. **7 shots silently lost their MANDATORY style anchor** (`L48`, `L52`, `L60`, `L64`, `L59-genA`,
   `thumb-primary`, `thumb-challenger1`, `thumb-challenger2`) to seed-cap truncation — a
   2-character shot's own pose/expression tags filled all 4 slots before the anchor was appended,
   because the seed-priority order appended the anchor LAST. Root-cause fixed in
   `scratchpad/build_batch.py` (anchor now ordered ahead of pose/expr, which the SKILL itself
   calls the softer seed) and the 8 affected entries (7 + `L59`'s cascade) regenerated.
2. **11 more shots opened `"The same <set>..."`** (a re-base in the SAME location) that the
   mechanical stage-chain walk missed because they carry a fresh `stage` id with
   `stage_role: "base"` rather than `"delta"` — a legitimate VPW pattern the naive walk doesn't
   catch. Regenerated seeding the correct antecedent frame per grammar's re-base rule (`L64`,
   `L66`, `L79`, `L92`, `L114`, `L125`, `L142`, `L163`, `L168`, `L189`, `L206` — 11 total, `L92`
   found in a second, even more thorough continuity sweep after the first 10).

19 gens, $2.55. All dry-run + offline-validated before spending; two more transient 503s repaired
individually.

## Stage E — batched fresh-eyes review: 12 agent dispatches

**Model routing per coordinator mid-run directive**: rig = opus, fidelity = sonnet, style = sonnet
(a deviation from `image-generation` SKILL.md's own default of fidelity=opus, followed as the
coordinator's explicit call for this run; noted here as the honest record of what ran).

Dispatched as **3 act-aligned batches** (L43-L99 / L100-L149 / L150-L215+thumbnail, snapped to
`vpw-log.md`'s own Act boundaries) × 3 mandates (rig/fidelity/style) = 9 parallel background
agents, each given its batch's dossier (`still_prompt`, `vo_text`, `shot_class`, `figures`,
`assets`, `notes`, resolved scene-file path), the relevant bible §3/§2c/§2d/§2e text pasted
verbatim (subagent inheritance isn't reliable), and a reusable `paired_crop.py` helper for
rig-defect escalation evidence.

**Coverage gap caught and repaired**: the 3 original rig judges collectively covered only 92 of
111 figure-bearing shots (ran out of budget mid-batch on the largest batches). Re-audited against
the dossier's `has_seeded_or_2e_figures`/`has_crowd` flags, found the exact 48-shot gap, and
dispatched **3 more rig-focused agents** scoped to precisely the missing shots (opus, same rulebook,
briefed on the systemic defect already found so far). All 12 agent IDs + output files logged in
`scratchpad/review_agent_ids.md`.

### The systemic finding — a severe, dominant identity-collapse defect

Every rig judge independently converged on the SAME root cause: a declared named character
(`qt-wiles`, `hq-banker`, `brick-foreman`, `auditor-rep`, `miniscribe-rep`) intermittently renders
as `refs/base/base.png` itself — bald, base-cream `#f5ead6` head, the base rig's own plain brown
hoodie — instead of its own canonical hair/costume/head-tone. Confirmed **intermittent, not a dead
seed path** (the same character renders perfectly in other shots in the same act, sometimes the
very next shot in a chain), which is exactly why it survived to Pass 2: a spot-check landing on a
clean shot would have passed the run. Present across every technique (ladder genB, chain delta,
plain single-gen) at roughly the same order of magnitude the `_bricks-seg` slice's own Pass-1
round found (31/42 = 74% flagged there; 120/176 = 68% flagged here) — i.e. **not anomalously
worse than the channel's known baseline defect rate**, just a larger absolute count at 5×
the shot volume.

Secondary defect classes: five-digit/mitten hands on open gestures (the stated drift point),
duplicated eyewear, crowd/full-rig tier confusion, held-text drops across delta chains, and — most
interesting — a **recurring scene-hallucination attractor**: a warm wood-panelled Victorian
drawing room (rug, gold curtains, dresser) substituting for an unrelated authored environment on a
a small cluster of shots (see Unresolved, below).

### Merged verdict — `assets/_review/merged.json`

176 rulings (L43-L215 + 3 thumbnails). **56 clean, 120 flagged** (23 low, 81 high, 16 med
pre-retry). DSG-lite ran on the 25 lettering/high-risk-scoped shots per batch; caught 2 real
schema-drift bugs in the judges' own output during merge (see Corrections).

## Stage F — the one surgical retry wave: 120 shots, $16.08

Built systematically (`scratchpad/build_retry_batch.py`): for every flagged shot, seeds
re-derived **fresh from the character canonical(s)** (never the defective frame — the chain-delta
shots' prior pattern of seeding ONLY the parent frame, with no canonical, is the suspected
root-cause contributor and was corrected here), plus a short surgical corrective clause appended
to the ORIGINAL `still_prompt` (never a full re-author) keyed to the judge's specific defect
class: identity-lock (restating the character's costume/hair tag), digit-count, figure-count,
text-cleanliness, environment-fidelity, proportion, or rig-tier.

**One real bug caught by the pre-spend dry-run**: the retry builder's name-resolution treated the
4 newly-registered characters as BOTH a character AND a pose/expression asset (since
`forge.py register` adds every promoted asset to the registry's flat `assets` list too), silently
duplicating the character seed and evicting a real pose/expr seed. Fixed (restored the original
`build_batch.py`'s if/elif mutual-exclusivity) and re-validated before any spend.

120/120 dry-run validated (zero errors: no dropped anchors, no seed-cap violations, no duplicate
seeds, no missing files) before spending. 4 transient failures (3× empty response, 1× 503), all
repaired.

### Self-check (flagged-points-only, never a full re-review — per SKILL law)

Reviewed via 8 contact sheets (15 shots each) plus 2 targeted paired-crop zooms
(`thumb-challenger1`'s previously-confirmed nose+ears, `L48`'s ears), checking specifically the
defect each judge named — not a fresh full review.

**109 of 120 fixed.** The identity-collapse defect resolved on effectively every retried shot
(canonical hair/costume/head-tone now holding); digit counts, figure counts, duplicated eyewear,
and held-text all confirmed corrected where checkable at viewing scale.

**11 still defective after the one retry — PARKED, not retried again** (Daniel's cap: one regen
per shot, full stop):

| Shot | Residual defect |
| --- | --- |
| L78 | Scene-hallucination NOT resolved: still a Victorian drawing room instead of the crude marker diagram |
| L87, L88 | Same scene-hallucination, inherited through the held lockbox-office set |
| L97 | Same class: still a swamp instead of the bare concrete floor |
| L102 | Same class: still a domestic interior instead of the top-down map |
| L112 | Same class: the Victorian room bleeds through behind the pallet |
| L171 | Same class: still the Victorian room instead of the number-line graphic |
| L205 | Fidelity: still 3 groups of 5 tally marks (15) instead of 3 for "three years" — my corrective-clause keyword match missed this defect's phrasing |
| L123 | Rig: anon-figure outline/hand-form issues not confidently resolved on re-check |
| L133 | Rig: checkpoint officer's mitten hands not confidently resolved on re-check |
| L215 | Style: closing brick still reads as plain terracotta, not the locked `#d7402b` semantic accent |

## Stage G — honest stamp + board

`stamp_review.py` (the ONLY writer of `review_status`) → **165 verified / 11 parked** for this
run's material. Two DSG-schema bugs caught and fixed before it would run cleanly: one judge wrote
combined `"pass — <note>"` strings instead of a bare `pass|fail|skipped` token; another used a
different key schema (`fact`/`result` instead of `id`/`q`/`verdict`) entirely. Normalized
(`scratchpad/normalize_dsg.py`), but the FIRST normalization pass had its own bug — splitting on
any hyphen, which broke `"weak-pass"` into `"weak"` + `"pass"` and fail-closed 3 shots
(`L127`, `L177`, `L178`) that were never actually flagged by any judge. Caught by the resulting
flagged-count jumping from 120 to 123 on re-merge; root-caused, fixed (split only on
space-padded dashes; a hedge word like "ambiguous"/"weak-pass" maps to pass, not fail, matching
the SKILL's own "never assert off an ambiguous read" law), and the 3 already-corrupted entries
hand-corrected before re-stamping.

**Combined with L01-L42 carried forward VERBATIM from `_bricks-seg`** (22 verified / 20 parked,
proven byte-identical twice by the source run, PNGs + manifest entries copied unchanged, zero
re-review, zero regen, per dispatch): **final whole-video count is 187 verified / 31 parked** of
218 manifest entries (215 long-form shots + 3 thumbnails).

`shot-board` skill → `assets/board.html`, **5.88 MB** (budget 20 MB), 215 shot cards in story
order, honest verified/parked badges reading straight from the manifest. This worker STOPS at the
board per the skill's own Report law — presenting it to Daniel is the boss's call.

## Systemic findings for the boss change list — SURFACED, none self-applied

1. **The identity-collapse defect (character seed silently reverting to `base.png`) is not new to
   this run** — the `_bricks-seg` slice hit the same failure mode at a similar rate. It persists
   across the two-gen identity-pass mitigation for ladder-unit bases AND across the corrected
   seed-priority ordering for deltas. A structural fix (stronger identity-seed weighting, or a
   verify-then-regen loop built into `forge.py` itself rather than a human-gated retry wave)
   is worth a dedicated design pass — this run's ~68% first-pass flag rate at 5× the shot volume
   is a lot of review-agent and retry spend for what may be a fixable seed-ordering or
   prompt-weighting issue in the generator itself.
2. **A specific scene-hallucination attractor**: a warm Victorian-drawing-room composition
   (rug, gold curtains, dresser) recurs across unrelated prompts (a crude marker diagram, a
   concrete warehouse floor, a top-down map, a swamp) and survived the one retry on every
   instance it hit. Worth a targeted investigation — possibly an anchor (`env-interior-warm`)
   whose reference frame itself carries too strong a "period drawing room" signature.
3. **Review-agent budget exhaustion is a real, silent failure mode.** All 3 original rig judges
   ran out of turns mid-batch and stopped WITHOUT flagging that they hadn't finished — the gap
   was only caught by cross-checking dossier flags against ruling coverage after the fact. A
   structural fix belongs in the skill: either a smaller per-agent shot count, or an explicit
   "confirm N/N shots covered" self-check the agent must pass before it's allowed to report done.
4. **Judge output schema drift** (combined pass/note strings, an alternate `fact`/`result` key
   shape) cost real debugging time and nearly shipped 3 false-park entries. Worth pinning the
   DSG-lite item schema more explicitly in the judge dispatch brief with a literal JSON example.
5. **`forge.py register`'s side effect** (a promoted character also lands in the registry's flat
   `assets` list) silently breaks any downstream script whose name-resolution isn't if/elif
   exclusive between `characters` and `assets` — caught pre-spend here by dry-run, but worth a
   comment/guard in `forge.py` itself for the next script that reads the registry this way.

## Verification performed before calling this done

- `stamp_review.py` exit 0, counts reconciled against `merged.json` (165 verified / 11 parked for
  this run's material; 187/31 combined with the carried-forward slice).
- All 218 manifest entries' underlying PNGs re-validated: 215/215 long-form scenes + 3/3
  thumbnails at 2752×1536 (16:9), valid PNG magic, >1KB.
- L01-L42 byte-identical carry-forward: PNGs copied unchanged from `_bricks-seg/assets/scenes/`,
  manifest entries (`review_status` + `parked_reasons`) copied unchanged from the slice's own
  final stamp — 22 verified / 20 parked reproduced exactly.
- Every parked entry (this run's 11 + the carried-forward 20) confirmed to carry ≥1
  `parked_reasons` string.
- `assets/board.html` self-containment, size (5.88 MB / 20 MB budget), 215-card count asserted.
- Spend reconciled: 354 successful generations × $0.134 = **~$47.4**, under the $60 cap with
  ~$12.6 headroom.

## Not done in this run (out of scope per dispatch)

- No motion planning (`shots.motion.json` does not exist for this video — confirmed absent before
  starting, matching the dispatch's scope).
- No second retry on any of the 11 still-parked shots — Daniel's cap is ONE regen per shot; their
  reasons surface on the board for human judgment, which is what the parked state is for.
- No thumbnail winner picked — that stays a human decision; all 3 thumbnail candidates are
  verified and ready for Daniel's pick, then `finalize_thumbnail.py`.
- No Artifact published — the review surface is the local `board.html`; presenting it to Daniel is
  the boss's call per the skill's own Report law.

<!-- Run complete 2026-07-30 ~11:22 UTC. -->

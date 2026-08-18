# Wave C progress — L18-L25

Partition: L18-L25 (drive-maker intro/idiom + supply-stall chain L20/L21; brick-foreman intro/back-to-viewer + packing-trestle chain L24/L25)

## Pass-1 check
- drive-maker: canonical already registered (refs/drive-maker/drive-maker.png), review record drive-maker-r1.png all-pass.
- brick-foreman: canonical already registered (refs/brick-foreman/brick-foreman.png).
- All needed STEP-1 figure cards for L18/L19/L20/L21/L23/L24 already staged + review.json all-pass (built by a prior wave):
  - fig-drive-maker--carry-by-handle--expr-deadpan--f1c1d333 (L18)
  - fig-drive-maker--hold-both-hands--expr-greedy--12637e2e (L19)
  - fig-drive-maker--action-present--expr-smug--5e51ec13 (L20/L21)
  - fig-brick-foreman--action-shrug--expr-deadpan--1a78cea1 (L23)
  - fig-brick-foreman--hold-one-hand--expr-deadpan--16cc9e92 (L24/L25)
- L22 needs fig-brick-foreman--back-to-viewer, but the hash forge computes for THIS shot's context (7a3b93be) matches a FAILED review record (rig:fail), not the passing one (e88f3bf3, different digest). Forge correctly refused to reuse the failed record and scheduled a fresh STEP-1 mint.

## Batch spec
Built via `forge.py batch --shots L18..L25 --out <abs>/spec-wC.json`. 8 scenes + 1 STEP-1 fig gen, 0 not-generated, 16 seeding-law violations reported OUTSIDE scope (untouched, other partitions).

## Dry-run
`gen --dry-run` on spec-wC.json: 9 prompts assembled cleanly, seed roles + chain order all correct (L21 seeds L20 parent + drive-maker canonical + crowd-exemplar; L25 seeds L24 parent + brick-foreman canonical + lettering exemplar). 0 errors.

## Live gen
First attempt hit the 2-min bash tool timeout after L18-L21 completed (items 1-4 OK), mid-call on item 5 (STEP-1 fig mint). Stale lock reclaimed automatically per forge's dead-PID rule; resumed via background run (gen-wC-2.log) which skips already-staged L18-L21 survivors.

(status continues below as items complete)

## Review round 1 (fresh-eyes subagent, sonnet, no generator context)
- CLEAN -> verified: L18, L19, L23, L24
- FLAGGED -> parked: L20 (crowd rig FAIL: detailed eyes+visible teeth on whole prospector group instead of dot-eyes/no-teeth §2d clause), L21 (inherits L20's crowd-rig fail + money box renders as ornate treasure chest w/ unrequested sparkle FX instead of the authored plain iron box), L25 (spelling DSG-lite PASSES "HARD DRIVE" but font renders as rigid stencil/print, not the locked hand-marker register)
- fig-brick-foreman--back-to-viewer--7a3b93be STEP-1 card: rig FAIL (ear-shaped notch cut into hair, both sides) -> L22 stays blocked, needs a re-mint

## INCIDENT (self-caught, repaired same session): stamp_review.py schema mismatch
My first stamp_review.py run used old-schema merged.json entries (`{id, worst, why}`, no per-axis
r/f/s keys) for my own new entries. The current stamp_review.py requires explicit r/f/s per ruling;
missing axes -> "missing verdict" -> parked. Since stamp_review.py processes the WHOLE video's
merged.json (not scoped to my shots), this incorrectly downgraded ~17 ALREADY-VERIFIED shots outside
my partition (L28,L29,L33,L38,L44,L46,L65,L84,L86,L112,L114,L169,L198 + my own L18/19/23/24) from
verified -> parked ("missing verdict") as a side effect. Caught immediately via before/after diff
against git HEAD + my own pre-stamp manifest snapshot. FIXED by backfilling r=f=s="clean" on every
old-schema entry whose `worst=="clean"` (faithful translation of their own recorded "why" text, e.g.
"all axes pass") — 17 entries fixed — then re-ran stamp_review.py once more. Final state verified
correct: all previously-verified shots restored + newly-clean ones (L01,L02,L06,L09 by another
worker's already-complete-but-unstamped review, plus my L18/L19/L23/L24) promoted; my flagged
L20/L21/L25 correctly parked with precise per-axis reasons. No shots outside my partition were
edited in content — only the review_status/parked_reasons fields were touched, restoring them to
correct values. Lesson for future waves: merged.json entries MUST always carry explicit r/f/s keys,
never the bare {id, worst, why} shape, or a later worker's stamp run will misfire on your rows.

## Retry round 1 (ONE sanctioned retry per frame)
Overlay: scratchpad/scenes-t1/retry-overlay-wC-r1.json (forge-retry-overlay@2)
- fig-brick-foreman--back-to-viewer--7a3b93be: STEP-1 re-mint, defect=rig, instruction targeting the
  ear-notch (old failed frame deleted first per forge's own re-mint procedure, same derived name).
- L20-fix: scene retry, defect=content, exact-replace appending explicit crowd-rig reinforcement
  after "reaches up for the tools."
- L21-fix: scene retry, defect=content, exact-replace covering both the crowd-rig clause AND the
  money-box description (plain flat iron strongbox, no wood/jewels/banding/sparkle).
- L25-fix: scene retry, defect=content, exact-replace "the stencilled words" -> hand-marker register
  phrasing, banning stencil/print typeface.
Dry-run: 4/4 prompts assembled clean, changed_spans:1 each. Live gen: 4/4 OK, 0 failed.
Retried frames copied over the originals at assets/scenes/{L20,L21,L25}.png (sha256-verified copies).
Dispatched a second fresh-eyes mini-pass (separate sonnet subagent) to rule on all 4 retries —
per skill doctrine this is final: whatever doesn't clear stays parked and gets surfaced, no more
retries after this round.

## Retry round 1 result (final, no further retries)
- L20: mini-pass CLEAN -> verified. Crowd rig fix held.
- L21: mini-pass CLEAN -> verified. Crowd rig fix held AND money-box fix held (plain iron strongbox, no sparkle/wood/jewels).
- L25: mini-pass FLAGGED again -> stays PARKED (final). Lettering spelling correct but typeface register
  (lean + baseline bounce) did not move off the rigid/uniform-stroke reading even after the retry. Surfaced
  as a possible systemic mechanism issue (prose-only fix may not reliably move the engine off a rigid
  typeface even once the word "stencilled" is removed) -- worth a channel-level look at other lettering shots.
- fig-brick-foreman--back-to-viewer: mini-pass FLAGGED again -> stays FAIL rig, 3rd failure on the SAME
  ear-notch defect (one side of hairline only). Recorded FAIL in visual-kit/_staging/review.json. L22 stays
  PARKED / never generated, blocker named in its manifest entry. Needs a different repair mechanism than a
  single instruction-only retry (e.g. a targeted de-nose/de-ear-style second pass) -- flagged for a human/
  orchestrator decision, not re-attempted blind a 4th time.

## NEAR-MISS caught before damage: forge.py manifest --out relative-path bug
Ran `forge.py manifest --kind scenes --batch <relative manifest.json path> --out <same relative path>` to
reconcile/validate the final L22 addition. The KNOWN ISSUES note in my brief only mentioned this for
`batch --retry --out`; it turns out `manifest --out` has the SAME relative-path mis-resolution (joins
with the kit root instead of cwd), producing a doubled path
(`orgs/faceless-youtube/orgs/faceless-youtube/channels/.../manifest.json`) and writing an entirely separate
stray file there -- the REAL manifest.json was never touched (verified: all review_status values were
exactly as I'd left them). Deleted the stray `orgs/faceless-youtube/orgs/` tree. Lesson: ALWAYS use an
ABSOLUTE --out for every forge.py subcommand that takes one (batch, manifest, retry-batch), not just
`batch --retry`.

## FINAL STATE — partition L18-L25
- verified (6): L18, L19, L20, L21, L23, L24
- parked (2): L22 (never generated -- blocked by fig-brick-foreman--back-to-viewer rig FAIL x3, needs a
  human-ruled repair mechanism), L25 (generated + retried once, lettering typeface register still off,
  surfaced as possibly systemic)
- Nothing outside L18-L25 was content-edited; the one self-caught stamp_review.py schema incident (see
  above) touched only review_status/parked_reasons fields on OTHER shots and was fully repaired same
  session, verified against git HEAD.

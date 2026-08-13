---
id: 6a7e36a7-19bfacdd
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-workflow-platform
risk-tier: T1
owner: codex-worker
claim-token: 4a456298e53e02a1
state: done
approval: null
workflow: 019ffce9-bbc9-7390-8f2f-4c0652f7387f
depends-on: []
variant-group: null
role: work
session-id: 6a7e2f8a-54b6c121
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Fix round 1: P1 Task 6 — adversarial review findings

Working dir: `C:/Users/danie/kb-worktrees/boss-workflow-platform` (branch `claude/workflow-platform`,
HEAD a1c229c). Cold-start fixer. NO commits — the boss commits after review.

Context: a prior worker implemented plan Task 6 + Amendment A1 ("Schedule turns and pin canonical
lineage") as the current UNCOMMITTED working-tree diff (11 files under `dashboard/server/control/`;
view with `git diff`). Ignore untracked `memory/codex-worker.md`. An independent adversarial review
returned FIX-THEN-SHIP. Read first: the plan's Task 6 section + `## Amendments` A1
(`docs/superpowers/plans/2026-08-12-p1-iteration-loops.md`), then the diff, then fix in place.
Keep everything green; tsc stays at exactly 7. Use `npm.cmd` from `dashboard/`.

\## F1 — BLOCKER — legacy ReviewLoop runs die at reconciliation
`canonicalResultIntegrator.ts:310-316` (`publicResult`) and the file-integrator `lookup`
(`adapters.ts:836-843`) rewrite every LEGACY review record's `reviewOutcome` into a synthetic
`iterationOutcome`. Two lookup seams translate back via `legacyReviewCompatibilityResult`
(`execution.ts:2036-2042`, `:2126`); `reconcileReviewRuntime` (`execution.ts:1660-1671`) does NOT.
It then calls `canonicalStageResultHashMatches`, and `canonicalStageResultHash` short-circuits on
`iterationOutcome` (`:469-471`) BEFORE the `legacy-non-review` fallback — both branches return the
iteration hash, the match fails, and `runToBoundary` throws
`'persisted canonical review result failed reconciliation'` on EVERY pass (`:828`, `:855`).
Every legacy ReviewLoop run with a durable checker result dies; ReviewLoop is live until Task 13.
Even past the hash, `:1417` (`!integrated.reviewOutcome`) and `:1544` would throw.
**Fix:** ONE seam-translation applied uniformly — route `reconcileReviewRuntime`'s lookup result
through the same `legacyReviewCompatibilityResult` translation the other two seams use (prefer:
hoist the translation into a single helper all three call sites share, so a fourth seam can't
repeat this), and make the hash check compare what was actually persisted for legacy rows.
**Test:** the review proved green suites missed this because `execution.test.ts` stubs `lookup`
with a Map that echoes `reviewOutcome` (`:349`, `:528`, `:1535`, `genericIterationFixture:173`).
Add a cross-seam test that drives reconciliation through the PRODUCTION
`createFileResultIntegrator` with a legacy review result (integrate → restart → reconcile) and
asserts no throw + no second integration. Empirical repro shape from the review:
integrate→lookup a review result gives `has reviewOutcome: false / has iterationOutcome: true /
hash matches: false`.

\## F2 — MAJOR — canonical operation-key collision on coordinator/mixed shapes
`execution.ts:1345-1355` (`reviewGeneration` iteration branch) keys the canonical result off
`Math.max(stage.currentGeneration, requestOrdinal)` — two unrelated counters. Proven collision:
seed commits g1 → a producing step mints g2 → key `…:g2`; the next NON-producing step to the same
participant (check/review/reply/position) gets ordinal 2, currentGeneration 2 → `…:g2` again →
`executeAttemptUnsafe` (`:2118-2126`) replays the PREVIOUS turn's canonical result, skips the
worker, and `parseIterationOutcome` rejects on `requestRef` mismatch → run dies. This is exactly
the spec's coordinator-crew and mixed-kind debate shapes.
**Fix:** key the canonical result off the turn's durable identity — the `requestRef` (stable
across restart for the same logical turn; that stability is the requirement the plan sets). Keep
the key format collision-free vs DAG stage keys. Verify restart replay still finds the persisted
result under the new key (reconciliation + replay tests must cover it).
**Tests:** add the coordinator-crew shape (delegate/rework/check routed to one specialist) and a
mixed-kind sequence to the execution suite — assert distinct canonical keys per turn, correct
replay, no cross-turn result reuse. Acceptance line "all four example configurations increment at
their declared machine boundary" must now be TRUE in tests, not just for manager/judge + fan-in.

\## F3 — MINOR — restore defence-in-depth at `execution.ts:1417`
The guard narrowed from `proposalStage.review && !integrated.reviewOutcome` to
`checkerLoop && …`. Restore the belt-and-braces form (both conditions) — compile/proposal
guarantees make it unreachable today; keep it anyway, it's one line.

\## F4 — MINOR — restart replay skips contract re-validation
`execution.ts:1666-1671` does not pass `prepared.iterationContract` to `resultIsSafe`, so a
replayed iteration outcome is accepted on journal-time validation alone. Pass the contract and
re-validate on replay.

\## F5 — MINOR — non-fulfilled receipts accept arbitrary outputGenerationRefs
`store.ts:5200-5203` validates `outputGenerationRefs` only for `fulfilled`. Require it EMPTY for
every non-fulfilled verdict (execution already passes `[]`). Add the negative test.

\## F6 — deferred, do NOT fix here
Transient `resolveBase` miss failing the run rather than parking (`execution.ts:1250-1257`) is
park/termination policy — the boss carries it into Task 7. No change.

\## Acceptance
- All Task-6 + A1 named tests plus the new F1/F2/F5 tests green; five focused suites
  (`execution`, `store`, `canonicalResultIntegrator`, `adapters`, `codexExecAdapter`) green;
  tsc exactly 7; legacy journal fixtures still byte-stable.
- The F1 cross-seam test and F2 collision test FAIL against the pre-fix code — state this
  explicitly (git stash to verify is fine).
- Final message ≤14 lines: per-finding fix summary, test counts, deviations, anything
  deliberately not done.

## Result

Implemented F1–F5 in place; no commit created.

- F1: unified legacy result translation across all lookup seams; production file-backed restart reconciles byte-stably without reintegration.
- F2: generic canonical keys now use `requestRef`, remain distinct from DAG keys, and replay correctly across restarts.
- F3: restored the unconditional proposal-review outcome guard.
- F4: replay reconciliation now revalidates against the durable iteration contract.
- F5: non-fulfilled receipts must have empty `outputGenerationRefs`, including persisted-state validation.
- Pre-fix proof: F1 threw the reported reconciliation error; F2 reused the prior result and failed the mixed turn; F5 accepted the invalid receipt.
- Five suites: 315 passed, 1 skipped.
- TypeScript: exactly 7 existing diagnostics. `git diff --check` clean.
- F6 deliberately unchanged; untracked `memory/codex-worker.md` untouched.

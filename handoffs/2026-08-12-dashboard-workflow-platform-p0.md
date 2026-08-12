# 2026-08-12 — Workflow-platform P0: MERGED to main (PR #117). Remaining: P1 kickoff + run-archive cleanup

## Load list
- `memory/claude-boss.md` (ops) — lessons through this arc
- PR #117 (claude/workflow-platform @ b8fd772 → main) — 18-commit stack, all delta-reviews SHIP
  (post-acceptance addition: fluency item 1 — ops-push reconcile-and-retry, 1843b06+bdb1e14+b8fd772:
  non-fast-forward launch pushes now rebase+retry with pure re-proof per reconcile, LC_ALL=C pinned
  both git runners, replay-branch checkout guard, stale ps1 test literal fixed — suite fully green)
- Prod pin `claude/dashboard-prod-pin` @ **c1fc83d** (= branch tip merged) — LIVE on pm2 :5317, verified
- Acceptance evidence: run-74383969 SUCCEEDED, signoff verdict PASS on managed branch
  `codex/managed-c08a71ee84040459c07dc89d` (409f64f draft → 2865b0f revise → c24cd83 signoff);
  cost `ledgers/cost/dashboard-engine-2026-08-12.tsv` (3 stages, $0 subscription)

## State

P0 is DONE end-to-end. The live gated 3-stage acceptance run passed: one Resume click ran the
chain; auto-resume fired 3× (g1 answer, budget-intervention answer, g2 answer — zero extra clicks);
dependsOn lineage verified on disk. Four REAL defects surfaced live and were fixed+reviewed+deployed
same-session (all invisible to 900+ green tests):
1. df857db — resolveBase was the only integrator method outside the serialized ops-transaction span
   → every multi-stage dispatch crashed (first live multi-stage ever attempted).
2. c9d0ccf — per-attempt budget == window budget → second attempt per window arithmetically
   impossible ("global token or cost budget exhausted").
3. 74602f6 — refused settlement stranded its reservation → with maxConcurrency 1, ONE overage
   blocked every later reserve ("global concurrency limit reached"). Released at ceiling now.
4. d89ce10+4c1e6bf — Windows EPERM on atomic-save rename when ANY reader (CPython open, editors, AV)
   held control-plane.json → bounded transient retry at all 8 rename sites via shared
   server/atomicRename.ts.

## NEXT
1. Start P1: iteration-loops research per the arc prompt on origin/claude/boss-2026-08-11.
   (PR #117 MERGED 2026-08-12; branch+worktree swept same session; prod pin c1fc83d = merged tip, live.)

## Cleanup still owed (task #15)
- Archive dead runs via operator UI: run-73e28f66 ("…no-spend chain + gate smoke test", 2026-08-11,
  8 open policy/execution requests) and run-96ce771d (failed twin, same title as the passing run).
- Scratchpad qtest/, atlas no-.git anomaly, boss-worktree sweep per BOSS.md.

## Non-blocking follow-ups (from final SHIP reviews)
- Duplicate-run guard is one-directional (bridge's own-subject launch skips it) — launch.ts:143.
- cardRouting.ts:392 reroute push answers 409 routing-conflict instead of reconcile-and-retry (card
  re-read reconcile owed, per final review).
- env override on createAsyncGitRunner can silently drop the LC_ALL pin (test-only seam today).
- Usable window = window − attempt_limit (settled+held cliff); durable shape = reserve expected
  usage, reconcile at settle. One overage burns 1M/200k/$2.50 of the window (charged at ceiling).
- Client: treat 409 run-already-exists-for-revision as benign no-op in resumeRunAfterHumanResponse.
- tmp-orphan on final rename failure at canonicalResultIntegrator.ts:416 + spendGrantProvision.ts:73
  (6 of 8 sites clean up; these 2 don't).
- atomicJsonDocument path could sleep async (holds SQLite lock across awaits) — comment marks it.
- park dedup keys on free-text titles (execution.ts:1484 gate title could collide).
- UI: run-title twins indistinguishable in list (two runs same def title) — surface created-at/runRef.
- Earlier-round minors: steering-grace 60s vs long tool calls, shutdown race window, non-ops repoRoot
  exit unreported, manager-command audit gap.

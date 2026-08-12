# 2026-08-12 — Workflow-platform P0: COMPLETE. Acceptance run PASSED live; PR #117 open (merge = Daniel's click)

## Load list
- `memory/claude-boss.md` (ops) — lessons through this arc
- PR #117 (claude/workflow-platform @ 4c1e6bf → main) — full 14-commit stack, all delta-reviews SHIP
- Prod pin `claude/dashboard-prod-pin` @ **da9c79f** (= branch tip merged) — LIVE on pm2 :5317, verified
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

## NEXT (in order)
1. **Daniel merges PR #117** (`gh pr merge 117 --merge` — classifier blocks the boss doing it).
2. After merge: boss session sweeps — delete claude/workflow-platform local+remote (verify
   rev-list==0 first), remove kb-worktrees/workflow-platform, `git worktree prune`.
3. Start P1: iteration-loops research per the arc prompt on origin/claude/boss-2026-08-11.

## Cleanup still owed (task #15)
- Archive dead runs via operator UI: run-73e28f66 ("…no-spend chain + gate smoke test", 2026-08-11,
  8 open policy/execution requests) and run-96ce771d (failed twin, same title as the passing run).
- Scratchpad qtest/, atlas no-.git anomaly, boss-worktree sweep per BOSS.md.

## Non-blocking follow-ups (from final SHIP reviews)
- Duplicate-run guard is one-directional (bridge's own-subject launch skips it) — launch.ts:143.
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

# 2026-08-12 — Workflow-platform P0: fix stack SHIPPED + deployed, acceptance run at the human gate

Supersedes `2026-08-11-dashboard-workflow-platform-p0.md` (consumed; delete both on pickup).

## Load list
- `memory/claude-boss.md` (ops) — lessons through this arc
- Branch `claude/workflow-platform` @ **9a33f7e** (pushed) — the full P0 stack
- Prod pin `claude/dashboard-prod-pin` @ **7a5e832** (pushed) — merge of the stack, LIVE on pm2 :5317
- `orgs/kb-ops/workflows/acceptance-run.md` (ops) — the gated 3-stage def (gates g1/g2)
- Control plane: `AppData/Local/kb-dashboard/control/control-plane.json` — run-74383969

## State: everything built, reviewed, deployed. Blocked ONLY on Daniel's passkey.

Commit chain on `claude/workflow-platform` (all pushed):
804acec (P0 fixes) → ecf7265 (adapter result-correlation) → 89bb805 (auto-close drop + read scope) →
172e0b5 (round 2) → 0b24360 (operator mutation authority, ruling 3) → **SHIP verdict** →
8bed430 (auto-resume + cross-subject activate + owner-keyed locks) → e1aa422 (GAP-3/4/5/6 + dead
/api/timeline removed) → **FIX-THEN-SHIP (2 MAJOR/6 MINOR)** → ef3af4e (all 8 fixed, mutation-checked)
→ **delta verdict SHIP** → 9a33f7e (comment accuracy N1/N2).

All reviews opus, model-grepped (96/187/190/96× claude-opus-5). Final tallies: 382 tests green across
the 5 affected suites, tsc 7-error pre-existing baseline byte-identical.

Deployed: pin merged to 7a5e832, SPA rebuilt (`npm run build` green), `pm2 restart kb-dashboard`,
daemon verified (root 200, API 401 unauth as expected).

## THE GATE — Daniel, in order (~2 min + two gate answers)

1. Dashboard → arm the executor (pm2 restart wiped the in-memory arming latch).
2. Open run **run-74383969** (Workflow-platform P0 chain smoke test, waiting-human, all boundaries
   accepted) → click **Resume** once. The /activate scoping fix + auto-resume are live: this single
   click should carry the run through stage `draft`.
3. Gate **g1-review-draft** fires (approval, blocks `revise`): check
   `orgs/kb-ops/output/acceptance-run-status.md` has a `## Stage: draft` section → Approve.
   Auto-resume now drives `revise` with NO second click — that's the mechanism under test.
4. Gate **g2-review-revise** (blocks `signoff`): confirm draft section intact above the new revise
   section → Approve → `signoff` writes `acceptance-run-signoff.md` with PASS/FAIL.

## Evidence checklist (task #13, collect during/after the run)
- [ ] One Resume click → run executes (no dead park)
- [ ] g1 answer auto-resumes revise (no manual activate) — THE auto-resume proof
- [ ] g2 answer auto-resumes signoff; signoff verdict PASS
- [ ] Workflows graph shows the run; live stream click-in works
- [ ] Cost ledger row for the run; no tracebacks in pm2 logs
Then task #14: present evidence → PR `claude/workflow-platform` → main → start P1 (iteration-loops
research per arc prompt on origin/claude/boss-2026-08-11).

## Known-accepted residuals (logged, not blockers)
- Delta-review MINORs: N1 bridge-side duplicate window (own-subject launch skips the one-run-per-
  revision guard; narrow reachability), N3 park dedup keys on free-text titles, N4 `:954` await has
  no rejecting-sink test.
- Client: `resumeRunAfterHumanResponse` on a foreign pre-publication run now gets 409
  `run-already-exists-for-revision` → error banner though the answer committed; follow-up = treat as
  benign no-op in `controlClient.ts`.
- Earlier round's minors (task #12 description): steering-grace 60s vs long tool calls, shutdown race
  window, non-ops repoRoot exit unreported, manager-command audit gap.
- Cleanup (task #15): parked run-73e28f66 + its 8 open policy/execution requests (archive via
  operator), scratchpad qtest/, atlas no-.git anomaly, boss worktree sweep per BOSS.md.

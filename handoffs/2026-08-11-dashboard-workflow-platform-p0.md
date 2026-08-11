# Workflow-platform arc, P0 mid-flight handoff — 2026-08-11

## Context

Daniel's six-requirement "fix workflows" arc (agent iteration loops, live run graph, visible
human gates, self-improving agents, def freshness, dashboard-wide trim). The Daniel-approved
authority is the spec; the runnable plan is the arc prompt — BOTH live on branch
`origin/claude/boss-2026-08-11` (not yet on main):
- `docs/superpowers/specs/2026-08-11-workflow-platform-design.md` (commit db1f76c)
- `docs/superpowers/plans/2026-08-11-workflow-platform-arc-prompt.md` (commit 6ba9aa9)

Phases P0–P5, one task each; this session ran P0 (foundation attestation: prove PRs #115/#116
work LIVE, not just green suites). P0's live-fire did its job: the first-ever W7 def-card
launches ran and exposed three platform blockers, all now fixed on `claude/workflow-platform`
(commit **804acec**, pushed) together with the Inbox revamp Daniel ordered mid-session.

Environment facts a resumer must know:
- Prod daemon: pm2 `kb-dashboard` from worktree `C:/Users/danie/kb-worktrees/dashboard-prod`
  (branch `claude/dashboard-prod-pin`, tip 6501bc1 = today's main a2e6e2b + windowsHide sweep
  5874532). SPA dist rebuilt today. **6501bc1 does NOT contain the 804acec fixes** — the
  daemon still runs the broken adapter until the pin is advanced.
- Arc build worktree: `C:/Users/danie/kb-worktrees/workflow-platform` (branch
  `claude/workflow-platform`, cut from main a2e6e2b).
- Boss worktree this session: `C:/Users/danie/kb-worktrees/boss-2026-08-11`.
- The queue bridge is constructed only after Daniel arms via passkey in an unlocked tab; a
  hard refresh drops his tab session (run-side data silently vanishes — fixed in 804acec by
  an explicit locked-tab notice, once deployed).

## Done (with evidence)

1. **Live-fire attestation runs.** Two W7 def-card launches of `orgs/kb-ops/workflows/
   acceptance-run.md` (def currently on ops in gateless "v2" form). run-73e28f66 parked on the
   `spending-language-requires-human-review` policy tripwire (v1 def's own no-spend prose
   triggered it). run-96ce771d ran a real claude-sonnet-5 worker that SUCCEEDED at 21:03:28Z
   (wrote `orgs/kb-ops/output/acceptance-run-status.md` in its managed worktree, $0.42) — and
   the platform then mislabeled the attempt failed-as-timed-out at 21:32:54Z, proving:
2. **Blocker A (root-caused + fixed):** `claudeWorkerAdapter.ts` finalized attempts only on
   process exit, but real `claude -p --input-format stream-json` NEVER exits while stdin is
   open (held open for operator messages). Every claude worker attempt idled to the 30-min
   kill-timeout → failed. Fix: detect the `type:"result"` stream-json line in onStdout →
   close operator channel, `endStdin()`, 20s `RESULT_EOF_GRACE_MS` backstop tree-kill;
   `parseWorkerStream` gains `resultObserved` bypassing only the nonzero-exit fail-closed
   check. Suites green because fakes exit on their own — sim-vs-real gap.
3. **Blocker B (fixed):** queueBridge stamped proposal revisions `sourceTurnId:
   "bridge:<defId>"`; the Workflows view's `workflowRefIndex` (routes.ts) keys on unprefixed
   def ids, so every def-card run was invisible in the graph. Fix: `sourceTurnId = def.id`
   verbatim (queueBridge.ts:~614).
4. **Blocker C (fixed):** `QUEUE_BRIDGE_READ_CARD_SCRIPT` (queueBridge.ts:465) crashed on any
   card whose YAML frontmatter holds a bare date (`datetime.date` unserializable) — the
   stray Python traceback in daemon stderr and at vitest start. Fix: `json.dumps(...,
   default=str)`. The old test pinned the broken contract and was rewritten to assert
   date-carded dispatch works.
5. **Inbox revamp (Daniel's mid-session order, built):** engine-side auto-close of orphaned
   humanRequests — same-commit close when `transitionRun` lands succeeded/failed/stopped +
   boot/5-min sweep (`humanRequestSweep.ts`, new) closing (a) requests on already-terminal
   runs, (b) any request older than 7 days regardless of run state; `review`-kind exempt (a
   store quarantine-eligibility invariant needs them to survive); decision recorded as new
   `'auto-closed'` member, state open→resolved, never deleted, never readable as approval.
   SPA: plain-language asks in RunDetail's resolved section; explicit locked-tab notice
   ("run-side requests hidden — unlock") instead of silent hiding; createdAt + relative age
   on rows (cards decode the 8-hex epoch id prefix); actionable-first grouping, collapsed
   "Older / stale" section. The 5 July zombie requests will auto-close on first deployed
   sweep.
6. **Verification state at close:** adapter+bridge suites 125/125 isolated; inbox's 9 touched
   suites 256/256; `tsc --noEmit` byte-identical 7-error baseline (both builders diffed
   against pre-edit capture); vite build green. Full `server/control` dir run: 38/40 files,
   2 failing — both judged load flakes, not regressions: `canonicalResultEmbeddedPython.
   test.ts` re-ran 6/6 green ISOLATED; `authorizedFailedRunReconciliation.test.ts` (8 fails)
   died on a temp-remote `git unpack-objects abnormal exit` infra error after 579s under
   full-suite load — the documented load-flaky reconciliation class. One isolated
   confirmation run of the latter is still owed (see Remaining 2).
7. Both builders graded PASS with transcript model-grep (sonnet), per BOSS.md.

## Remaining (ordered)

1. **Adversarial review verdict.** An opus reviewer over the full 804acec diff was IN FLIGHT
   at session close (briefed to refute; 8 attack angles incl. resultObserved soundness,
   operator-message races, waiting-human resume, sourceTurnId collision with SPA launches,
   default=str validation weakening, auto-close-as-approval, transitionRun invariants,
   locked/loading SPA states). Its output landed (or died) in the closed session — assume
   lost; RE-DISPATCH an opus adversarial reviewer with that scope against the 804acec diff.
   Do not merge or advance the pin before a verdict; fix findings on the same branch.
2. **Confirm `authorizedFailedRunReconciliation.test.ts` green ISOLATED** (from dashboard/:
   `npx vitest run server/control/authorizedFailedRunReconciliation.test.ts`). Its full-suite
   failure signature was pure infra (temp-remote git unpack error under load), but the rule
   stands: isolated green = pass; isolated failure = real regression from 804acec, fix first.
   (Lesson `baseline-failures-are-not-free` applies.)
3. **Daniel gate — sweep window ruling:** the 7-day age-based auto-close fires even on a
   LIVE waiting-human run. If Daniel deliberately parks gates >7 days, the window (or the
   age predicate itself) needs his ruling. Surface this with the review verdict, one gate
   at a time.
4. **Deploy:** merge/fast-forward `claude/workflow-platform` into `claude/dashboard-prod-pin`
   in the dashboard-prod worktree, `npm run build` (NEVER skip the SPA rebuild — pin-advance
   runbook lesson), `pm2 restart kb-dashboard`, verify no visible OpenConsole windows and
   `/api/human-inbox` shows the zombies auto-closed after the boot sweep.
5. **Re-run the gated acceptance def** for the real P0 evidence. The live def
   (`orgs/kb-ops/workflows/acceptance-run.md` on ops) is the gateless v2; restore the two
   humanGates (g1 blocks stage `revise`, g2 blocks stage `signoff` — gates go on the stage
   AFTER the work they judge) while KEEPING the tripwire-safe wording (no "spend"/"money"/
   "credential" phrases — v1 parked on exactly that). Compile-verify the def first:
   `npx tsx` a script importing `parseWorkflowDef` via absolute file:/// URL, knownProfiles
   as a `new Set([...])`, result shape `{ok, value}`. File the card (meta: `owner:
   dashboard-engine`, `state: inbox`, `execution-controller: dashboard`, `workflow-def:
   acceptance-run`, `risk-tier: T1`) on ops in queue/inbox. Daniel arms passkey. Evidence
   checklist: run visible in Workflows graph (Bug B fix proves here), click-in live stream,
   gate 1 answered in run tab, gate 2 answered in revamped Inbox, stages chain to signoff
   PASS, fleet cost ledger row on ops, no stderr tracebacks.
6. **Present the P0 phase gate to Daniel** with that evidence; on approval, PR
   `claude/workflow-platform` → main per commit-commands flow, then start P1 (iteration
   loops research per arc prompt).
7. **Cleanup owed:** parked run-73e28f66 + its policy request (auto-close won't touch a
   waiting-human run until day 7 — close/cancel it deliberately); scratchpad `qtest/` dir;
   `C:/Users/danie/kb-worktrees/atlas/atlas` has NO .git (anomaly) and its `run-worker.js`
   windowsHide fix exists on disk only; boss-worktree sweep per BOSS.md when the arc ends.

## Gotchas

- The daemon harvests worker completion ONLY with the 804acec adapter — on the current pin
  every claude worker attempt still dies as "timed out" after 30 min. Do not file cards
  before deploying.
- pm2 logs for the current process are `kb-dashboard-{out,error}-1.log` (suffix changed after
  the windowsHide restart).
- Managed run worktrees under `AppData/Local/kb-dashboard/control/` are reconciler-owned —
  never git-touch them by hand.
- `control-plane.json` entity keys are `runRef`/`stageRef`/`attemptRef` (not `id`), runs/
  stages/attempts are top-level parallel arrays.
- The two prompt/spec docs are only on `origin/claude/boss-2026-08-11`; cherry-pick or read
  from that branch.

## Load list

1. This file.
2. `docs/superpowers/plans/2026-08-11-workflow-platform-arc-prompt.md` @ origin/claude/boss-2026-08-11 — the plan to execute.
3. `docs/superpowers/specs/2026-08-11-workflow-platform-design.md` @ origin/claude/boss-2026-08-11 — the authority on any conflict.
4. `git -C C:/Users/danie/kb-worktrees/workflow-platform show 804acec --stat` then the diff — the unreviewed change set.
5. `orgs/kb-ops/workflows/acceptance-run.md` (ops) — the def to re-gate.
6. `memory/claude-boss.md` (ops) — lessons including today's.
7. BOSS.md + CLAUDE.md as always; skill `dispatch-codex` NOT used this arc (Daniel: claude subagents only, verified by transcript model-grep).

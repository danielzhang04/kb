# kb-structure Phase I execution — handoff 2026-08-13

**Arc:** Execute `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` (25 tasks) via
superpowers:subagent-driven-development. Goal: move the dashboard/VM platform onto the cloud VM
as an immutable, recoverable, credential-free Phase I platform, behind two Daniel cutover gates.

**Branch:** `claude/boss-2026-08-11c` @ **0da27d5** (pushed, remote == local), **20 commits ahead
of origin/main**. Worktree `C:/Users/danie/kb-worktrees/boss-2026-08-11c` — KEEP (active arc).
PR #118 stays DRAFT (plan-of-record) until execution validates and a final PR supersedes it.
Rebased onto merged main (post #117/#119) at session start; main has NOT moved since.

## EXACT NEXT STEP (pickup)
Task 15 (KB browser root confinement) is **implemented but UNCOMMITTED** — its review did not
finish (the review agent stalled at the 600s watchdog mid symlink/junction scrutiny; it HAD
confirmed 25/25 tests + typecheck clean before stalling). Dirty files: `dashboard/server/kb/
browser.ts`, `browser.test.ts`, `routes.ts`, `routes.test.ts` (4 files, BASE 0da27d5).
Review package already generated: `<sdd>/task-15-review-package.diff`. Report:
`<sdd>/task-15-report.md`.
1. Re-dispatch the Task 15 review (fresh sonnet, security lens: symlink/junction resolution,
   %2f/%2e traversal, does confinement hold for an authenticated caller, does the approved-roots
   list ever expose `.env`/`_private/`). Package is ready; point the reviewer at final files.
2. Clean verdict → boss-shell verify → PowerShell-commit → push. Then continue the loop.

## Remaining work (in order)
- **Task 15** finish (above).
- **Wave E — Tasks 16, 17, 18** (VM outbox git bundles, desktop replay/promotion, spool
  alerting). Opus review on 16/17 (bundle replay + promotion authority).
- **Checkpoint 2**: opus adversarial review over Waves D+F1+E (same pattern as Checkpoint 1 —
  package = e071d77..HEAD range for the new waves; fix wave; scoped re-review). Feed it the
  ledger's deferred/parked/accepted list (below).
- **Wave G1 — Task 19** Gate-1 evidence package → **DANIEL GATE 1** ceremony (read-only web).
  STOP for Daniel — his ceremony, not autonomous.
- **Wave F2 — Tasks 20, 22** (Linux surface disabling, resource limiter).
- **Merge checkpoint + deferred spec pass** (Tasks 9, 21, 23, 24, 25): re-run the plan's
  checkpoint ancestry check against CURRENT origin/main (may have moved — another terminal runs
  workflow-platform P1), **re-grep the merged contracts before writing any deferred test**, write
  the 5 deferred task specs against real merged signatures, adversarial plan re-review, THEN
  execute. Task 24 = Linux canary on VM; Task 25 = Gate-2 evidence.
- **Final whole-branch review + DANIEL GATE 2** (execution authority) → ready the stacked PR
  superseding #118; sweep worktree; save-session.

## Status of the 14 committed tasks (all reviewed, model-verified grades)
6cb5cbd T1 ops classifier · b02d41b T2 python resolver · 412af03 T3 card schema · 01f0a2e T4 card
boundary · d48219f T5 workflow-def versioning · ac61224 T6 migration CLI · cd7e111 T7 startup
refusal · 44851c3 T8 repo registry · **a6225b8 Checkpoint-1 fix wave (11 findings)** · 73c5dd1
T10 release build · bcdd836 T11 /readyz · 5d8582c T12 deploy/rollback (opus, 19 sec findings) ·
43cad29 T13 tier-0 backup · 0da27d5 T14 session auth on reads (opus bypass-hunt CLEAN).
Plus CP0 hygiene: ea02c34 (orphan test), 56ffbd2 (tsc baseline-7 zeroed).

## VM-WINDOW ACCEPTANCE OWED (batch pre-Gate-1; scripted, non-interactive over tailscale SSH)
Banked in each task report: T10 Actions run + Ubuntu determinism rebuild; T12 systemd
install/activation/rollback + `sudo` NOPASSWD provisioning (deferred M3) — full command list in
`task-12-report.md`; T13 restore drill + 8 symlink-gated boundary tests (run natively on Linux) —
list in `task-13-report.md`. None faked; all disclosed as pending.

## Load list (read on resume)
- THIS FILE, then `<sdd>/progress.md` — the SDD ledger, RICHEST record: every task/round/ruling,
  12 plan-defect rulings, all deferred-minor + parked + accepted-documented items, process rules.
  `<sdd>` = `<worktree>/.superpowers/sdd/2026-08-11-kb-structure-phase1/` (gitignored, machine-local
  — do NOT lose the worktree).
- `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` (the plan; `## DEFERRED` = post-merge)
- `docs/superpowers/specs/2026-08-11-kb-structure-design.md` (authority)
- `memory/claude-boss.md` 2026-08-13 lessons
- Skill: superpowers:subagent-driven-development

## Binding process rules learned this arc (all in the ledger, repeated here)
1. **Commits/pushes via the PowerShell tool ONLY** — `kb/.git` carries inherited DENY-write ACEs
   for the sandbox virtual users that the Bash tool's token IS one of; Bash commits fail
   intermittently (on new object-fanout dirs). PowerShell token is not denied.
2. **Codex dispatches via `Start-Process ... -WindowStyle Hidden` (DETACHED) + a Monitor on the
   report file / pending marker** — plain background-shell dispatch gets its whole worker tree
   killed ~3min in by the harness/other terminal (confirmed NOT Daniel). Markers carry
   `cwd: boss-2026-08-11c` so other terminals' sweeps can distinguish mine.
3. **Codex workers CANNOT produce valid evidence for `server/win32/**` or
   `authorizedFailedRunReconciliation` (sandbox breaks the native no-reparse layer) — boss-shell
   runs only.** And they can't write kb/.git objects (worktree .git is outside --cwd) — boss commits.
4. **pytest `--basetemp` / TEMP must be OUTSIDE the repo** (a basetemp inside the worktree makes
   not-a-repo fixtures resolve the enclosing repo; git walks up). Default pytest temp is
   ACL-blocked on this box → redirect TEMP/TMP to a fresh OS-temp child.
5. **Boss-shell re-verify the full narrow suite before committing** — a worker's "N passed" claim
   was FALSE once (Task 14 r3: a module-load-minted 60s test token expired mid-file; opus caught
   it). Trust the reviewer + your own run, not the implementer report.
6. **The plan's prose/acceptance criteria are sound; its verbatim CODE blocks are NOT always
   transplant-safe — 12 defects caught pre-implementation** by the stop-on-contradiction rule
   (normalize deletion, AST-guard→exec swap, $schema key, shared-parser split, dead validation,
   parseCardFrontmatter→parseValidatedCard ripple, .size()→liveCount(), systemctl argv, no
   activeWorkers field, validator static/live ordering paradox, PORT→DASHBOARD_PORT, 401-matrix
   origin ordering, json import). The deferred spec pass MUST expect the same.

## Accepted-documented items for Daniel's Gate-1/Gate-2 briefing (NOT bugs; his call)
- Task 14: PTY writes now cookie-authenticable (CSRF-shaped; mitigated SameSite=Strict +
  origin/host guard); session token still returned in verify JSON (PTY subprotocol needs it —
  caps HttpOnly value); 5-min session TTL, no refresh path → operator re-login cadence.
- Task 2: `runPythonSync` imposes a 30s default timeout on 4 production spawns (plan-mandated).
- Checkpoint-1 residual deferred minors + Task-13 brief-inherited flags (export-vs-activation
  flock are different resources → torn-snapshot window; systemctl-stop-before-try/finally) — all
  in the ledger, routed to Checkpoint 2 / plan-layer follow-up.
- `governance/card-schema.md` doc gap (approval fields added to the JSON schema in the CP1 fix
  wave but the human-edited doc doesn't list them) — Daniel edits that file himself.

## Housekeeping
- Untracked strays in worktree (leave for session-close sweep): `memory/codex-worker.md` (a codex
  worker mis-routed a constitution memory append), `.task3-pytest/` (ACL-locked sandbox scratch,
  undeletable from boss tokens — inert). Neither is committed.
- Keep-awake was ARMED at handoff (Daniel away). The known keepawake-arc parse-error trailer is
  cosmetic (hooks run pre-#119 code); lease holds.

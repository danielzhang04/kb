# KB platform overhaul audit handoff - 2026-09-06

**Topic:** Completed architecture audit and overhaul proposal; design decisions and
implementation remain active follow-on work. This does not replace or consume the
separate dashboard outage recovery handoff.

## Scope and authority

Daniel requested a boss-orchestrated, lower-model-assisted audit of the platform,
public-platform comparison, adversarial review, and a large slim-code overhaul
plan. No implementation, production access, approval, governance change, merge,
or deployment was performed. Three clarification questions remain unanswered:
priority real workflows, supported VM/desktop/multi-host topology, and whether the
next task should implement the plan. Current assumption is one VM, audit/plan only.

Audit base is main `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`.
Historical outage evidence was read from ops `913011cc` at
`handoffs/2026-09-06-dashboard-outage-recovery.md`; the pending #173 repair
`e8bf8d35` was inspected separately, not merged or deployed. Do not infer current
VM status from the historical handoff.

## What WORKED (with evidence)

- Repository preamble passed. Fresh worktrees isolated this task from the user's
  dirty `claude/boss-2026-09-02` checkout and other active worktrees.
- Four native lower-model investigation/review lanes produced source-cited
  execution, operations, supporting-subsystem, coverage, prior-art, plan and
  adversarial reports. Requested models: `gpt-5.6-sol` and `gpt-5.6-terra`.
  Boss checked critical source claims and sent specific corrections/revisions.
- Platform inventory has 1,120 tracked paths: 486 production, 582 test, 52 asset
  entries. Main has 2,438 tracked paths. Inventory is not full semantic review;
  coverage labels distinguish full reads, caller traces, and inventory-only files.
- Boss Python gate: 156 passed with
  `python -m pytest -q tests/test_preamble.py tests/test_schedule_store.py tests/test_queue_bridge_select.py tests/test_validate_vm_runtime.py --basetemp C:/Users/danie/kb/_private/audit-20260906-pytest`.
- Boss focused TypeScript gate: 23 passed, two run-detail failures on default
  user-state writes. Both then passed with isolated `DASHBOARD_STATE_ROOT`.
  Command from `dashboard/`:
  `node node_modules/vitest/vitest.mjs run server/control/runDetailWireContract.test.ts server/control/iterationOutcome.test.ts server/control/attemptVertical.integration.test.ts --maxWorkers=1 --no-file-parallelism --configLoader native --no-cache`.
- Execution worker reports 402 passing cases in four focused files; supporting
  worker reports 123 passing cases in eight files. Exact commands are in their
  reports. Total across these bounded runs is 706 passing selected cases, not a
  whole-suite result or independent boss rerun of worker results.
- Boss independently reproduced `renewLease` accepting missing current capability
  advertisement with an in-memory port. The defect is latent behind the absent
  production placement binding. Caller tracing also confirmed the seven System
  learning paths are library/test-only, not wired from production schedule FIRE.
- Primary-source comparison covers n8n, ECC, Temporal, LangGraph, and Prefect.
  Moving upstream references are marked as retrieved on September 6, not falsely
  SHA-pinned; n8n source-reading depth is explicitly bounded.
- Final adversarial verdict: architecture direction approved with comments;
  implementation/cutover neither authorized nor ready. Original design blockers
  were addressed in the plan; future harness and migration proof remain required.
- All 1,120 inventory paths exist. Actual staged-diff whitespace checks and skill
  sync checks passed. Work packet committed and pushed as `e11cff29` on the work
  branch. No main/ops merge or deployment occurred.

## What Did NOT Work (and why)

- Default Vitest bundled config tried to write shared `.vite-temp` and got EPERM.
  Native config loading and disabled cache avoided the infrastructure failure.
- Two run-detail tests wrote real user AppData through the default naming registry
  and failed EPERM. Re-running only those tests with
  `DASHBOARD_STATE_ROOT=C:/Users/danie/kb/_private/audit-20260906-state` passed; no
  source change was made to hide the issue. Keep this as a real isolation finding.
- An operations worker's broader pytest attempt hit temp-directory setup errors
  (98 passed / 153 setup errors); a second attempt hit sandbox denial. Those are
  environment failures, not 153 product regressions. Boss's bounded 156-case run
  is the successful evidence for the named overlap.
- PowerShell blocked the `npm.ps1` shim. Use `npm.cmd`; no policy weakening needed.
- Fresh audit worktree's skill sync check initially lacked ignored generated kit
  files. The supplied `python scripts/sync_skills.py` generated them; no tracked
  skill/governance changes were made. Ops proposal already passed its sync check.
- A purported high-severity Windows drain race lacked a reachable simple HTTP
  trigger after real microtask ordering was checked. It is now an unproved
  medium design/coverage risk; do not restore the stronger claim without a repro.
- A worker listed nonexistent context lifecycle Python files as reviewed. Boss
  caught this, and the worker read the real JavaScript hooks and corrected its
  full-read/trace inventory. Do not use filenames or a worker verdict as evidence
  until checked against the pinned tree.
- Native delegation did not expose responding-model/token/USD telemetry. The cost
  shard records requested models and unavailable telemetry, with grouped review
  continuations. Its blank USD cells are unknown, not free usage; the existing
  ledger sum cannot certify the session's actual spend or full provider-call count.
  No promotion grade or model-mismatch claim was fabricated.
- `handoffs/README.md`, referenced by save-session, is absent on the ops baseline;
  this handoff uses the skill's complete inline template instead.
- Sandboxed `gh repo view` returned HTTP 401. The approved normal GitHub CLI call
  outside that sandbox succeeded with the existing session; no login, token file,
  credential printing, or authentication change was necessary.

## What Has NOT Been Tried Yet

- Any live VM probe, browser/terminal usability check, actual model subscription
  run, Linux PTY harness, full test suite, restore drill, load test, or deployment.
- Implementing any defect fix or overhaul phase. #173 remains separate recovery.
- The bounded identical-workflow SQLite-versus-Temporal experiment. SQLite is a
  candidate, not a measured winner. See plan for failure/restore/operational gates.
- Human choices of priority workflows, topology, acceptable RPO/RTO, concurrency,
  offline publisher duration, legacy retention, and authority/governance migration.

## Current State of Files

Work product branch: `codex/kb-platform-overhaul-20260906`.
Published work commit: `e11cff29`.
Remote packet: [audit README](https://github.com/danielzhang04/kb/blob/e11cff29/orgs/kb-ops/output/2026-09-06-platform-audit/README.md).
Worktree: `C:/Users/danie/kb/_private/codex-worktrees/kb-platform-overhaul-20260906`.
Coordination proposal: `codex/kb-platform-audit-ops-20260906`, based on `origin/ops`.
Worktree: `C:/Users/danie/kb/_private/codex-worktrees/kb-platform-audit-ops-20260906`.
Coordination reaches ops only through the worker PR flow; do not push directly.
Find the coordination PR by its exact head branch; this handoff cannot embed its
own final commit hash without creating a new commit. Both worktrees remain active.

| File | Status | Notes |
| --- | --- | --- |
| `orgs/kb-ops/output/2026-09-06-platform-audit/README.md` | DONE | Executive findings and packet navigation, work branch |
| `orgs/kb-ops/output/2026-09-06-platform-audit/architecture-brief.md` | DONE | Design assumptions, boundaries, verification |
| `orgs/kb-ops/output/2026-09-06-platform-audit/execution-audit.md` | DONE | State/execution paths and evidence |
| `orgs/kb-ops/output/2026-09-06-platform-audit/operations-audit.md` | DONE | Scheduling, release, health, desktop/outbox |
| `orgs/kb-ops/output/2026-09-06-platform-audit/supporting-audit.md` | DONE | Learning, placement, registry, Brain |
| `orgs/kb-ops/output/2026-09-06-platform-audit/surface-and-coverage.md` | DONE | UI/API seams, size, semantic coverage limits |
| `orgs/kb-ops/output/2026-09-06-platform-audit/platform-file-inventory.tsv` | DONE | 1,120 scoped paths; not line-by-line certification |
| `orgs/kb-ops/output/2026-09-06-platform-audit/prior-art.md` | DONE | Source-linked adopt/adapt/skip comparison |
| `orgs/kb-ops/output/2026-09-06-platform-audit/overhaul-plan.md` | DONE proposal | Phases 0-11, authority/store/capability maps and gates; not implementation |
| `orgs/kb-ops/output/2026-09-06-platform-audit/adversarial-review.md` | DONE review | Independent plan challenges and disposition |
| `queue/done/01K2KBARCH060000000000000001.md` | DONE | Audit assignment/result on ops proposal, not fleet launch |
| `ledgers/cost/codex-worker-2026-09-06.tsv` | DONE evidence | Unmetered native work steps; unknown costs explicit |
| `memory/codex-worker.md` | DONE | Production-composition and realistic race-evidence lessons |
| `orgs/kb-ops/STATE.md` | DONE | Replaces stale July current-state claims with qualified September audit facts |
| `handoffs/2026-09-06-kb-platform-overhaul-audit.md` | WIP continuation | Active design/implementation follow-on context |

Audit `dashboard/node_modules` is a directory junction to the existing
`C:/Users/danie/kb-worktrees/vm-movement-p1/dashboard/node_modules` installation.
Do not recursively remove this worktree or follow the junction during cleanup;
shared dependencies are not owned by this task. Retain both task worktrees while
their branches and handoff are active. Other working copies are untouched.

## Exact Next Step

Read the executive audit, adversarial verdict, and numbered plan sequence with
Daniel; choose three concrete workflows as acceptance fixtures and confirm the
supported topology. Then authorize bounded Phase 0/1 child cards and the Phase 2
comparison as appropriate. Do not jump from this completed audit card to a live
cutover. If asked to recover the outage, load the separate recovery handoff and
recheck its current branch/PR/live evidence under that task's authority.

## Load list

- `CLAUDE.md`, `BOSS.md`, `governance/agent-rules.md`, `orgs/kb-ops/contract.md`.
  `BOSS.md` is on the work/main branch, not this older ops tree.
- `orgs/kb-ops/STATE.md` and `memory/codex-worker.md` on the ops proposal/merged ops.
- `handoffs/2026-09-06-dashboard-outage-recovery.md` (context only; not consumed).
- `orgs/kb-ops/output/2026-09-06-platform-audit/README.md` on the work branch.
- `orgs/kb-ops/output/2026-09-06-platform-audit/adversarial-review.md`.
- `orgs/kb-ops/output/2026-09-06-platform-audit/overhaul-plan.md`.
- `orgs/kb-ops/output/2026-09-06-platform-audit/architecture-brief.md`.
- Invoke code-review/security-review for code changes or review, loop-design-check
  for recurring-loop design, and save-session/growth-log for the next handoff.

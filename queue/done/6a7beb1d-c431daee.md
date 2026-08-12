---
id: 6a7beb1d-c431daee
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-2026-08-11c
risk-tier: T1
owner: codex-worker
claim-token: bec08fce6a58b52e
state: done
approval: null
workflow: 019ff3bc-0a9b-7463-ab6c-a65c093b177a
depends-on: []
variant-group: null
role: work
session-id: 6a7bd604-28a1f835
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Brief: write the Phase I implementation plan for the kb-structure design

Your cwd is the boss worktree `C:/Users/danie/kb-worktrees/boss-2026-08-11c` (branch claude/boss-2026-08-11c, cut from main a2e6e2b). Write EXACTLY ONE file: `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md`. Do NOT commit, do NOT touch any other file, do NOT push.

\## Authority chain (read in order)

1. `docs/superpowers/specs/2026-08-11-kb-structure-design.md` — the approved spec. Phase I + its two cutover gates are your entire scope. Phases II/III and media exile are OUT of scope except where the spec says Phase I builds a Phase II prerequisite (versioned schemas, repository registry) — those ARE in scope.
2. `docs/superpowers/specs/2026-08-11-kb-structure-evidence/` — all six evidence reports. The runtime-boundary-map and adversarial-critique files carry the file:line evidence your tasks must anchor to.
3. Read the actual code before writing any task that modifies it. Never plan against a file you have not opened.

\## Plan format contract (binding — from superpowers:writing-plans)

- Header: goal (one sentence), architecture (2-3 sentences), tech stack, Global Constraints section (verbatim spec constraints, one line each).
- Tasks: smallest unit carrying its own test cycle, worth a fresh reviewer's gate. Each task: **Files** (Create/Modify with exact paths, line ranges for modifies), **Interfaces** (Consumes/Produces with exact signatures), then bite-sized checkbox steps (2-5 min each): write failing test (ACTUAL test code in the step), run to verify fail (exact command + expected output), minimal implementation (ACTUAL code), run to verify pass, commit (exact git command + message).
- NO placeholders. Never: "TBD", "add appropriate error handling", "write tests for the above", "similar to Task N". Every code step shows real code. Repeat code rather than cross-reference.
- Assume the implementer is skilled but knows nothing about this codebase; each task is self-contained.
- TDD throughout; DRY; YAGNI; frequent commits.
- Plan header must include the required-sub-skill line: "> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task."

\## Scope: Phase I work items (from the spec)

Order tasks by dependency, grouped by subsystem:

A. **Immediate defect + prerequisite fixes** (independent of everything, can land first):
   - `dashboard/server/write/branch.ts` COORDINATION_PREFIXES omits `memory/`, `dashboards/`, `handoffs/`, `orgs/*/STATE.md` — fix the classifier per spec Risks. Read the file and its tests first; changing classification changes write routing — plan the behavioral tests that prove memory/dashboard/handoff writes now ride ops pull-rebase-push.
   - Platform-aware Python resolver: production paths hardcode `py -3` (`dashboard/server/write/preambleGate.ts:33`, `workflowRun.ts:481`, and others — grep for execFileSync('py'). Design ONE resolver module consumed by all call sites; Linux uses python3. The existing test substitution hack (`embeddedPython.test.ts:51`) must die — tests must exercise the resolver's real resolution.
B. **Versioned schemas** (Phase II prerequisite built now): machine-readable schema + embedded version for cards and workflow defs; startup refusal on unsupported data. Anchor to `scripts/cards.py` and `dashboard/server/workflows/defs.ts` current parsing; schema version field additions must be backward-compatible (absent version = v0 accepted during transition).
C. **Repository registry** (Phase II prerequisite): server-owned registry mapping project → root, remote, base ref, scope, credential identity; approved proposals bind to an immutable registry identity. Anchor to `dashboard/server/control/activation.ts` repoRoot usage.
D. **Release artifact pipeline**: build-on-merge producing an immutable versioned platform release for the VM (tar or dir under /opt/kb-releases/<version>), versioned symlink selection, quiescent-only restart, rollback = repoint symlink. Includes the systemd unit changes (KillMode=control-group) and a deploy script the desktop (or VM timer) runs. The VM currently runs the daemon from a live checkout — plan the transition.
E. **VM outbox + desktop promotion**: VM commits coordination locally to a durable outbox (local branch/bundle spool); desktop reconciles + promotes to GitHub ops. Bounded retry, spool-growth alerting, replay-after-outage. NO GitHub credential on the VM — enforce by construction and add a check to preamble or deploy validation.
F. **Hardening checklist** (gate-2 evidence): worker drain on shutdown; session-auth on non-health read routes (read routes outside session auth today — verify current state in `dashboard/server/index.ts` and `kb/routes.ts`); per-resource-class concurrency limits; Linux end-to-end dispatch canary (card → bridge dispatch → integration → ledger settle → restart mid-run → recovery) using PRODUCTION command resolution.
G. **Gate evidence assembly**: two tasks that collect and present gate-1 and gate-2 evidence packages per the spec's gate definitions (these are checklists + scripted verification, not new features).

\## Hard constraints

- Base = main a2e6e2b. The UNMERGED branch `claude/workflow-platform` (804acec) modifies `claudeWorkerAdapter.ts` and `queueBridge.ts` (worker finalize-on-result, bridge sourceTurnId, date-card fix). Any task touching those files or the dispatch path MUST be sequenced AFTER a "workflow-platform merge landed" checkpoint task, and the plan must say so explicitly at that point. Do not plan concrete line-level edits to those two files — plan the task to re-read them post-merge.
- Windows is the current dev/test host; Linux (Ubuntu, systemd) is the deploy target. Tests must run on both where the code is shared; Linux-only behavior (systemd, symlink flips) gets scripted VM acceptance steps instead of vitest.
- Never plan credential handling as objects; the VM-has-no-GitHub-credential invariant is enforced by construction/validation, not by storing anything.
- Respect existing repo norms: vitest for dashboard/server, pytest for scripts/, commit style from git log.
- Where the spec leaves a Phase I detail open, choose the simplest YAGNI-compliant option and note the choice in the task's intro line — do not invent scope beyond the spec.

\## Self-review (do before finishing)

1. Spec coverage: every Phase I sentence in the spec maps to a task — list any deliberate gaps at the end of the plan.
2. Placeholder scan: zero occurrences of the forbidden patterns.
3. Type consistency: signatures in later tasks match earlier Produces blocks.

\## Final message

5-line summary: task count, subsystem breakdown, the workflow-platform checkpoint position, deliberate gaps, and any spec ambiguity you resolved (with the choice you made).

## Result

FAILED: timeout after 5400s; JSONL log: C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a7bd604-28a1f835.jsonl

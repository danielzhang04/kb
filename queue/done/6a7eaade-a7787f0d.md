---
id: 6a7eaade-a7787f0d
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-2026-08-11c
risk-tier: T1
owner: codex-worker
claim-token: e76c9a734f209662
state: done
approval: null
workflow: 019ffec7-c20b-7652-8a18-2a555de1e3ef
depends-on: []
variant-group: null
role: work
session-id: 6a7ea9e9-a028ea86
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Implementer dispatch — Plan Task 20: disable Windows-only PTY/runner/Vibe surfaces on Linux

Fresh implementer for one task of the KB Structure Phase I plan (Linux reports PTY, Task
Scheduler runner, and Composer/Vibe as disabled capabilities; never constructs
powershell.exe, never invokes schtasks.exe, never spawns a Composer claude child; governed
dashboard bridge execution stays available). Work ONLY inside
`C:/Users/danie/kb-worktrees/boss-2026-08-11c`.

READ THIS FIRST — requirements, exact code/tests verbatim:
`.superpowers/sdd/2026-08-11-kb-structure-phase1/task-20-brief.md`

Landed context:
- The plan is at defect #15 (verbatim snippets/file lists are NOT always transplant-safe).
  Contradiction or unlisted-but-required file → STOP, NEEDS_CONTEXT with enumeration.
- index.ts/context.ts/surface.ts were touched by Tasks 14/16/18 since the brief's line
  anchors were written — re-locate the named regions by content, not line number, and say so
  in your report.
- Disabled ≠ deleted: Windows behavior must be byte-identical (platform checks gate, no
  Windows code path removed). The existing platform-specific tests are the regression oracle.

Process (TDD, brief's order): red-first narrow (npm.cmd test -- server/runtime/
capabilities.test.ts server/runtime/evidence.test.ts); smallest green; then touched suites
(index.test.ts, surface.test.ts — NOTE: surface.test.ts has exactly 2 pre-existing stale-
expectation failures at HEAD unless CP2's fix wave landed first; count them against baseline,
never fix them yourself); then npx.cmd tsc --noEmit + npm.cmd run typecheck. Timeout flakes
re-pass solo; NEVER authorizedFailedRunReconciliation.test.ts in a parallel selection. No
commit/add/stash. Never touch .env/_private/.

Report: write `.superpowers/sdd/2026-08-11-kb-structure-phase1/task-20-report.md` (APPEND if
exists): red→green evidence, exact counts, capability-surface inventory (every place the
three surfaces could be reached on Linux and what now refuses), self-review. Final message:
STATUS + one-line summary.

## Result

STATUS: NEEDS_CONTEXT

Task 19’s canonical evidence contract/parser is absent; I stopped per defect #15 and documented the red baseline and inventory in [task-20-report.md](C:\Users\danie\kb-worktrees\boss-2026-08-11c\.superpowers\sdd\2026-08-11-kb-structure-phase1\task-20-report.md).

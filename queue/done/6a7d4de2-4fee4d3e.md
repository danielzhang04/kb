---
id: 6a7d4de2-4fee4d3e
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-2026-08-11c
risk-tier: T1
owner: codex-worker
claim-token: 8ace85b4247f7926
state: done
approval: null
workflow: 019ff975-bd73-71c0-952b-1754cb58f05c
depends-on: []
variant-group: null
role: work
session-id: 6a7d4d3a-c471e973
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Implementer dispatch — Plan Task 11: unauthenticated minimal quiescence readiness probe

You are a fresh implementer for one task of the KB Structure Phase I plan (a minimal /readyz
probe reporting quiescence — the only unauthenticated data responses stay /healthz + minimal
/readyz). Work ONLY inside `C:/Users/danie/kb-worktrees/boss-2026-08-11c`.

READ THIS FIRST — your requirements, with exact code/tests verbatim:
`C:/Users/danie/kb-worktrees/boss-2026-08-11c/.superpowers/sdd/2026-08-11-kb-structure-phase1/task-11-brief.md`

Landed context: Tasks 1-8, 10 + checkpoint fix wave. assertSupportedRepositoryData runs first
in buildApp; index.ts wiring gained validateData option (Task 7). parseCardFrontmatter is
generic-only; parseValidatedCard validates (ripple rule if the brief mentions either).

\## Process (TDD, exactly as the brief orders)

1. Failing tests first; narrow command; confirm expected red.
2. Smallest green per the brief's code. Contradiction -> STOP, NEEDS_CONTEXT (6 snippet defects
   so far; report, never improvise).
3. Brief's test commands (`npm.cmd`/`npx.cmd` shims), then `npx.cmd tsc --noEmit`.
4. Consumer scan per the brief; unlisted in-scope files -> NEEDS_CONTEXT.
5. Self-review; APPEND to report; NO commit/add/stash.

\## Host constraints (binding)

- Brief's file list only. Never read/touch `.env` or `_private/`. No full suites — individual
  test files. The probe must leak NOTHING beyond the brief's exact minimal response shape
  (it is unauthenticated by design — flag any field in the brief's shape that looks like an
  information leak instead of silently implementing... no wait: implement per brief AND flag in
  the report's concerns if you see a leak).

\## Report

Write to `C:/Users/danie/kb-worktrees/boss-2026-08-11c/.superpowers/sdd/2026-08-11-kb-structure-phase1/task-11-report.md`.
Final message: STATUS + one-line test summary only.

## Result

STATUS: NEEDS_CONTEXT

Tests red as expected; blocked by `ptySessions.size()` vs existing `liveCount()` API mismatch, recorded in task report.

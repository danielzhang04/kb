---
id: 6a86ece0-c39cac2d
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\vm-movement-p1
risk-tier: T1
owner: codex-worker
claim-token: 57d822d9abba7135
state: done
approval: null
workflow: 01a01ef3-287a-7741-aa86-ee315f7e7628
depends-on: []
variant-group: null
role: work
session-id: 6a86e62b-9a900091
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Build worker: Phase-1 Task 4 — Process-lifetime writer lease and harness modes

Cwd = C:/Users/danie/kb-worktrees/vm-movement-p1 (branch codex/vm-movement-p1;
Tasks 1-3 committed through 7dfa5bc6 — generated schema, lifecycle/migrations/
persistence, deployment records/journal all available). Dashboard deps installed.

\## Read first (absolute paths outside your worktree)
1. C:/Users/danie/kb/docs/plans/2026-08-20-vm-movement-phase1-plan.md — header +
   Global Constraints + **Task 4 ONLY**; execute exactly, in order.
2. C:/Users/danie/kb/docs/specs/2026-08-20-desk-vm-movement-design.md — §2.1 lock
   contract where cited.

\## Rules
- GIT OFF-LIMITS (boss commits). Read-only git ok; rg for greps.
- Execute ONLY Task 4. Known environment facts:
  - The child-process lock fixture uses the plan's `--input-type=module -e` pattern
    (NOT raw .ts spawn).
  - Your sandbox denies some native/host paths: the plan's contention test asserts
    holderPid only on linux (null on win32) — keep that platform gating exactly.
  - If a spawned-child test behaves impossibly under the sandbox (e.g. fd
    inheritance blocked), prove the code path with the in-process seam instead and
    report the substitution — do not delete the test.
- Anchor drift: Tasks 2-3 moved store internals; trust the current tree over stale
  plan line numbers and report adaptations.
- If a step's expectation mismatches reality, STOP that step and report precisely.

\## Final message (≤25 lines)
Per plan step: done/deviation (+ anchor drift). Files created/modified. Test
evidence: exact commands + counts + typecheck. Any sandbox substitution made.

## Result

Task 4 implementation is complete; its focused gate is green. Global full-Vitest remains a deviation.

- Red step: expected missing `writerLease.ts` failure confirmed.
- Added POSIX `O_CLOEXEC`/`flock` and Windows non-inheritable `CreateFileW` adapters, contention sidecar, freshness checks, and branded leases.
- File stores now require an explicit lease or read-only harness; production lease ownership moved solely to `start()`.
- Synthetic acceptance and all listed test harnesses now inject explicit access. No child-process sandbox substitution was needed.
- Anchor drift: Task 3’s `deploymentTransitions.test.ts` and `persistence.test.ts` also required signature conversion; several planned test anchors already used in-memory stores and needed no edit.
- Created: `writerLease.ts`, `.posix.ts`, `.win32.ts`, `.test.ts`, `test-fixtures/writerLeaseChild.ts`, `test-fixtures/controlStore.ts`.
- Modified: 20 server/store, entrypoint, surface, evidence, synthetic-acceptance, and test files shown by `git status`; no git writes/commits performed.
- `npm.cmd --prefix dashboard test -- server/control/writerLease.test.ts` initially: 1 failed file, 0 tests; final coverage included in focused gate.
- Exact prescribed 16-file `npm.cmd --prefix dashboard test -- ...`: **16 files, 564 tests passed**.
- `npm.cmd --prefix dashboard test -- server/control/deploymentTransitions.test.ts server/control/persistence.test.ts`: **2 files, 41 tests passed**.
- `npm.cmd --prefix dashboard run typecheck`: **passed**, zero diagnostics.
- `npm.cmd --prefix dashboard test`: **226 files passed, 21 failed; 3213 passed, 81 failed, 12 skipped**. Failures were broad Windows native-I/O, 5-second load timeouts, and unrelated UI session timing; no unrelated fixes attempted.
- `git diff --check`: passed.

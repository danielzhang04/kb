---
id: 6a7beeec-e983eb8a
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-2026-08-11c
risk-tier: T1
owner: codex-worker
claim-token: 7adff915fefb8e7a
state: done
approval: null
workflow: 019ff419-6b56-7a03-b98a-1b40aa2ccdc9
depends-on: []
variant-group: null
role: work
session-id: 6a7bedec-4e8299b1
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Brief: apply review fixes to the Phase I plan

Your cwd is `C:/Users/danie/kb-worktrees/boss-2026-08-11c`. Modify EXACTLY ONE file: `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md`. Do NOT commit, do NOT touch any other file. Preserve the plan's existing format (checkbox steps, real code in every code step, Files/Interfaces blocks) and its style. Read the surrounding task fully before editing it; your edits must keep internal signatures consistent with what other tasks Consume.

A fresh-context review verified the plan and found these defects. Fix all five, priorities in order:

\## FIX 1 (CRITICAL) — Task 21, WorkerCancellationRegistry.register throw

The plan's shown implementation throws on duplicate registration:
`register(key, cancel) { if (cancels.has(key)) throw new Error(...); cancels.set(key, cancel); }`

But `dashboard/server/control/managedExecution.test.ts` has an EXISTING GREEN test pinning overwrite semantics: "a re-registration for the same operationKey replaces the prior cancel" (registers twice, cancels, expects ['second']). The current source's doc comment states "A re-registration for the same key wins." Task 21's own verify-pass step would fail on it.

Fix: restore overwrite semantics in the snippet (`cancels.set(key, cancel)` unconditionally, no throw). Verify the drain logic in the snippet still works with overwrite semantics (it does — drain iterates current values). Do not change the existing test.

\## FIX 2 (IMPORTANT) — Task 19, Tailscale Serve/Funnel evidence derivation unspecified

Task 19's decide() consumes pre-computed booleans (serveTailnetOnly, funnelDisabled, aclAuthorized, aclDenied, confined) but shows NO code or tests deriving them from `tailscale serve status --json` and `tailscale funnel status --json`. This is the least-precedented logic in the task and is currently delegated to the implementer.

Fix: add to Task 19 (a) a real parsing function with signature like `deriveTailnetEvidence(serveStatusJson: string, funnelStatusJson: string, aclProbeResults: AclProbeResult[]): TailnetEvidence` that: parses serve JSON and requires every handler to proxy only to 127.0.0.1/loopback targets; parses funnel JSON and requires no AllowFunnel/public listener entries; folds ACL probe results (authorized device reaches :4317, denied device gets connection refused/timeout). (b) failing-test code with two realistic JSON fixtures (one passing: loopback proxy + no funnel; one failing: funnel enabled or non-loopback proxy). Consult the real `tailscale serve status --json` output shape — if you cannot verify the exact schema from documentation confidently, define the fixture from the documented CLI behavior and note in the task's Choice line that the fixture shape must be confirmed against the live VM's tailscale version during implementation (that is a legitimate implementation-time check, but the parsing logic and test skeleton must be real now).
Keep the existing decide() aggregate; the new function feeds it.

\## FIX 3 (IMPORTANT) — Task 20, missing Interfaces declaration

Task 20's test and code use `activation.createPtyHost`, but the task's Interfaces block never declares the new `SurfaceActivationSeam.createPtyHost` field (current SurfaceActivationSeam in dashboard/server/http/surface.ts:65-70 has only build, env, createQueueBridge, dispatchClaimedCard). Add the exact field declaration line to Task 20's Interfaces block (e.g. `Produces: SurfaceActivationSeam.createPtyHost?: typeof createPtyHost`) matching how the snippet actually uses it.

\## FIX 4 (MINOR) — Task 22, missing reentrancy pin test

Task 22 replaces asyncGit.ts's private FIFO acquire/release with `runtimeResourceLimiter.run('git', ...)` but adds no failing test pinning that AsyncLocalStorage reentrancy (nested withOpsTransaction on the same store must not deadlock) and single-concurrency survive the swap. Add one failing-test step with real test code: two concurrent withOpsTransaction calls serialize; a nested reentrant call inside a transaction completes without deadlock. Read dashboard/server/write/asyncGit.ts:25-63 and its existing test file first so the test uses the real API.

\## FIX 5 (MINOR) — Global Constraints fragments

Plan lines ~11-28: several constraints are decontextualized fragments lifted from the spec ("This gate does not arm the daemon or transfer execution authority.", "The corrected bridge finding does not relax this gate."). Rewrite ONLY the fragmentary lines so each stands alone (e.g. "Cutover gate 1 (read-only web) does not arm the daemon or transfer execution authority."). Do not reword lines that already stand alone.

\## Acceptance

- All five fixes applied; `git diff --stat` shows only the plan file.
- No signature you touch breaks another task's Consumes reference (grep the plan for the names you change).
- Final message: per-fix one-line summary + any place you deviated and why.

## Result

Updated [2026-08-11-kb-structure-phase1.md](C:\Users\danie\kb-worktrees\boss-2026-08-11c\docs\superpowers\plans\2026-08-11-kb-structure-phase1.md).

- Fix 1: Task 21 registration now overwrites existing cancels, matching the pinned test.
- Fix 2: Task 19 now includes concrete Serve/Funnel parsing, ACL evidence derivation, and passing/failing JSON fixtures.
- Fix 3: Task 20 declares `SurfaceActivationSeam.createPtyHost`.
- Fix 4: Task 22 adds a serialization plus nested-reentrancy regression test.
- Fix 5: Reworded only the fragmentary Gate 1 constraint lines.

Verified: 25 task headings; whitespace check clean; `git status` shows only the plan file.

Deviation: the plan was already untracked, and Git’s index is outside the writable sandbox, so `git diff --stat` cannot include it.

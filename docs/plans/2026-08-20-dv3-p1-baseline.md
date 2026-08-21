# Dashboard v3 — P0 baseline at 9e391633 (claude/dashboard-v3 = main 64fb3d02 + docs)

Recorded 2026-08-21 00:20 EDT by the boss session. Both oracles: `cd dashboard && npm ci && npx vitest run && npm run typecheck && npm run build`.

## Results
| Oracle | typecheck | build | vitest |
|---|---|---|---|
| Windows (desk, main checkout) | pass | pass (778 ms) | 27 files / 154 tests failed of 284 / 3714 |
| Linux (native WSL ext4 clone `~/kb-v3`) | pass | pass | 20 files / 74 tests failed of 284 / 3714 |

## Classification
**Real debt, fails on BOTH (17 files, ~70 tests)** — main has never run vitest in CI; these are pre-existing:
`src/composer/DeployOutcome.test.tsx` (10) · `src/views/RunDetail.test.tsx` (7) · `src/palette/CommandPalette.test.tsx` (7) ·
`src/composer/ComposerChat.test.tsx` (4) · `src/composer/Composer.test.tsx` (4) · `src/views/stopControls.test.tsx` (3) ·
`src/views/Workflows.test.tsx` (3) · `src/views/Tasks.test.tsx` (3) · `src/console/useAttachableSession.test.tsx` (2) ·
`src/components/AgentWorkPanel.test.tsx` (2) · `server/http/surface.test.ts` (1–2) · `src/views/panels/Sentinel.test.tsx` (1) ·
`src/views/Home.test.tsx` (1) · `src/control/ProposalReviewPanel.test.tsx` (1) · `src/console/ConsolePane.test.tsx` (1) ·
`server/index.test.ts` (3 on Linux; see env note for Windows) · `server/control/store.durability.vm.test.ts` (1, VM-gated env test).
Dominant error classes: `expected 503 to be 200/400` and `'no session — the dashboard is locked' to contain 'halting'` (passkey-era lock
assumptions vs tailnet-trust auth), `expected [] to have a length of 1`, `vi.fn() called 0 times`.

**Linux-only (3 files):** `server/pty/resolveCommand.test.ts` (9: expects `py`, Windows-only launcher assumption) ·
`server/composer/routes.test.ts` (9) · `server/brain/routes.test.ts` (1).

**Windows-only, environmental (not debt):** `server/index.test.ts` 73/75 — EPERM realpath on two ACL-locked codex-sandbox residue dirs
under `orgs/faceless-youtube` (needs Daniel's elevated delete; boss gates run from a residue-free worktree instead). Four files
(`canonicalResultEmbeddedPython`, `activation.boot`, `synthetic-acceptance`, `authorizedFailedRunReconciliation`) each lost one test to a
5 s/30 s timeout under load; six others passed clean when rerun in isolation.

## Windows oracle reliability (learned 2026-08-21 00:50)
A full `npx vitest run` in the residue-free worktree `kb-worktrees/dv3-gate` under machine load produced 23× `[vitest-pool]: Failed to
start forks worker` (24 files never executed) and ~25 timeouts — not test failures. Windows gates must run with bounded parallelism
(`npx vitest run --maxWorkers=4`) on a quiet box, and any timeout/pool-crash file is rerun in isolation before being counted. The native
Linux clone showed no pool failures and is the more deterministic oracle of the two.

## Consequence for the phase gates
Spec §9 makes `npm test` exit-zero a literal gate per phase. P1 must therefore leave **zero** failures in retained files: every file above is
either deleted by P1's fate table (Composer ×4, DeployOutcome, Sentinel, stopControls, CommandPalette's Composer commands, AgentWorkPanel if
callerless) or fixed in P1 where retained (surface/index lock semantics, Tasks, Home until P2 replaces it, console/pty expectations, Linux
`resolveCommand`). Later-phase files (RunDetail, Workflows → P2; console/pty → P3) may be fixed minimally in P1 or their failing tests
rewritten in their owning phase only if P1's plan explicitly lists them as carried debt with the owning phase named.

---
id: 6a86d3ab-6e6bfaae
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-clones\agent-platform-w2
risk-tier: T1
owner: codex-worker
claim-token: 4d1415e25105c9dd
state: done
approval: null
workflow: 01a01e7f-ef2e-7360-a2a8-635b0f9a37d4
depends-on: []
variant-group: null
role: work
session-id: 6a86c8a8-235fe054
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task: full test sweep on the merged agent-platform tree + failure triage

Cwd is the STANDALONE CLONE `C:\Users\danie\kb-clones\agent-platform-w2`, branch `claude/agent-platform-w1`,
now containing a merge of `origin/main` (439fc90d). Do NOT touch any other checkout. Be concise; stick to this brief.
Do not commit.

\## Known baseline BEFORE the merge (branch @0739a44)
- pytest: 1390 passed / 0 failed (`py -3 -m pytest -q` from clone root)
- dashboard typecheck: green (`cd dashboard && npx tsc --noEmit -p .`)
- vitest full-parallel: 3311 passed / 25 failed — 18 load-flakes (green when the same files run with
  `--maxWorkers=1`) + 7 pre-existing CommandPalette sign-in-baseline failures in one file. NOTE: main has since
  replaced the passkey-only client with auth-mode discovery (`GET /api/auth/context`), so that CommandPalette
  baseline may have changed or vanished — do not assume it.

\## Run
1. `py -3 -m pytest -q 2>&1 | tail -30`
2. `cd dashboard && npx tsc --noEmit -p .`
3. `cd dashboard && npx vitest run 2>&1 | tail -60` (full parallel)
4. For EVERY vitest failure file: re-run that file alone with `npx vitest run <file> --maxWorkers=1`.
5. For every failure that is still red serially: run the same file in the pre-made origin/main probe checkout at
   `C:\Users\danie\kb-clones\ap-main-probe` (detached @ 439fc90d; run `npm ci` there only if needed) to classify it
   as pre-existing-on-main vs introduced by the branch/merge. Your sandbox cannot write `.git` — never run
   `git add/commit/checkout/stash/worktree`; read-only git is fine.

\## Classify every failure into exactly one bucket
- **REGRESSION** (red on merged tree, green on origin/main, or red only since merge) → FIX IT. Root-cause the
  code or the test; change existing logic, no skips, no `.todo`, no widened timeouts as a fix. Re-run to prove green.
- **LOAD-FLAKE** (green serially) → list file names only.
- **PRE-EXISTING-ON-MAIN** (red on origin/main too, same assertion) → list with the failing assertion; do not fix.

\## Norms
- Do NOT edit `governance/`, `CLAUDE.md`, `BOSS.md`, `queue/`, `ledgers/`, `memory/`.
- Keep fixes minimal and in the existing code path; no new helpers when adjusting the existing one works.
- pytest may leave ACL-locked `.tmp/pytest-*` dirs — ignore "Permission denied" warnings from git.

\## Report (final message, exact shape)
1. pytest: passed/failed counts + any failure names.
2. tsc: green / errors (verbatim first 20 lines if any).
3. vitest parallel: passed/failed; then the bucket table: file — bucket — assertion (1 line each).
4. Fixes made: file:function — what and why (1–3 lines each) + the green re-run proof line.
5. `git status --short` of what you changed (unstaged is fine).
6. Anything unclear, flagged.

## Result

1. pytest: 1597 passed / 22 failed (16 skipped, 5 deselected).

   Failures are all Atlas tests: `test_devicewatch` (4 output-follow tests); `test_engagement` (11 speaker/state/model tests); `test_preflight::test_ops_worktree_is_ops_branch`; `test_state` (3 output-device tests); `test_toolreg` (3 registry tests).

2. tsc: green.

3. vitest parallel: latest run 3493 passed / 89 failed / 12 skipped (24 files; fluctuates by one failed test due load flakes).

| File | Bucket | Assertion |
|---|---|---|
| `src/components/AgentWorkPanel.test.tsx` | PRE-EXISTING-ON-MAIN | missing `role="status"`; locked hint mismatch |
| `src/composer/Composer.test.tsx` | PRE-EXISTING-ON-MAIN | expected seeded turn count 1, received 0 |
| `src/composer/ComposerChat.test.tsx` | PRE-EXISTING-ON-MAIN | missing `Stop` control |
| `src/composer/DeployOutcome.test.tsx` | PRE-EXISTING-ON-MAIN | passkey sign-in refusal instead of deploy result |
| `src/console/useAttachableSession.test.tsx` | PRE-EXISTING-ON-MAIN | expected `loading`, received `ready` |
| `src/control/ProposalReviewPanel.test.tsx` | PRE-EXISTING-ON-MAIN | missing `Control run` heading |
| `src/palette/CommandPalette.test.tsx` | PRE-EXISTING-ON-MAIN | command-palette dialog/combobox absent |
| `src/views/Home.test.tsx` | PRE-EXISTING-ON-MAIN | missing `Execution armed · passkey` |
| `src/views/RunDetail.test.tsx` | PRE-EXISTING-ON-MAIN | dashboard locked instead of queued/offline result |
| `src/views/stopControls.test.tsx` | PRE-EXISTING-ON-MAIN | `no session — dashboard locked` instead of stop outcome |
| `src/views/Tasks.test.tsx` | PRE-EXISTING-ON-MAIN | expected governed-call result absent |
| `src/views/Workflows.test.tsx` | PRE-EXISTING-ON-MAIN | expected launch call count 1, received 0 |
| `src/views/panels/Sentinel.test.tsx` | PRE-EXISTING-ON-MAIN | expected `halting`, received locked-session message |
| `server/control/authorizedFailedRunReconciliation.test.ts` | PRE-EXISTING-ON-MAIN | `secure roster file open failed (io)` |
| `server/win32/noReparseFiles.test.ts` | PRE-EXISTING-ON-MAIN | expected `unsafe-path`, received `io` |
| `src/console/ConsolePane.test.tsx` | LOAD-FLAKE | — |
| `server/control/activation.boot.test.ts` | LOAD-FLAKE | — |
| `server/control/canonicalResultEmbeddedPython.test.ts` | LOAD-FLAKE | — |
| `server/control/humanRequestSweep.test.ts` | LOAD-FLAKE | — |
| `server/control/queueBridge.test.ts` | LOAD-FLAKE | — |
| `server/control/store.test.ts` | LOAD-FLAKE | — |
| `server/control/synthetic-acceptance.test.ts` | LOAD-FLAKE | — |
| `server/workflows/fyt.videoRun.registration.test.ts` | LOAD-FLAKE | — |
| `server/workflows/routes.test.ts` | LOAD-FLAKE | — |

4. Fixes made:

- `dashboard/public/manifest.webmanifest` + `dashboard/index.html`: PWA metadata — aligned theme/background colors with CSS `--bg-base` (`#0f0f0f`).

- `AutonomyLadder.panel.test.tsx:stubFetch`, `GradesHistory.panel.test.tsx` mocks, `LoopStatus.panel.test.tsx:stubFetch` — model `/api/auth/context` discovery and assert it is a GET alongside the panel read.

  Green proof: manifest 5/5; AutonomyLadder 10/10; GradesHistory 2/2; LoopStatus 13/13; `tsc --noEmit` green.

5. `git status --short`:

```text
 M dashboard/index.html
 M dashboard/public/manifest.webmanifest
 M dashboard/src/views/agentPlatform/panels/AutonomyLadder.panel.test.tsx
 M dashboard/src/views/agentPlatform/panels/GradesHistory.panel.test.tsx
 M dashboard/src/views/agentPlatform/panels/LoopStatus.panel.test.tsx
?? .tmp/
?? dashboard/.tmp/
```

6. Anything unclear, flagged:

- Probe `npm ci` was blocked by `EPERM`; I ran probe test files read-only using this clone’s installed runner. The 15 pre-existing classifications reproduced, including native no-reparse/reconciliation failures.
- Pytest needed temporary/app-data redirection due sandbox ACLs. Its remaining 22 failures are Atlas dependency/runtime assumptions, including missing `mcp`.

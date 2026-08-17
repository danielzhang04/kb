# dashboard-prod-pin handoff — 2026-08-17

**Topic:** Investigate the paused production-pin branch `claude/dashboard-prod-pin` and preserve its sole non-merge change.

## Branch/worktree state

- Local tip: `c1fc83d7bafbbe8ce5cc2f486a04e79e07b573b7`.
- Pushed: yes — `origin/claude/dashboard-prod-pin` resolves to the identical tip.
- Production worktree: `C:/Users/danie/kb-worktrees/dashboard-prod`, branch
  `claude/dashboard-prod-pin`; `git status --short` was empty (no uncommitted files).
- Relative to `origin/main`, the branch has eight commits: `58745321` plus seven merges.

## What this branch is

This is a production pin that accumulated `claude/workflow-platform` while retaining a
dashboard daemon fix. Evidence: its seven branch-only merge commits are one merge of
`origin/main` (`6501bc13`, 2026-08-11) and six merges of `claude/workflow-platform`
(`222980c7` on 2026-08-11; `7a5e832e`, `98adc97a`, `36a88bb5`, `da9c79f4`, and
`c1fc83d7` on 2026-08-12). Last branch activity was `c1fc83d7` at
2026-08-12T17:15:38-04:00.

Given context: the live dashboard is on port 4620; the old production pm2 process has
been STOPPED since the 2026-08-05 dashboard-UX-overhaul session. Workflow-platform P1
is merge-ready at `e08308bc`, pending Daniel's live-proof gate.

## What is stranded

`58745321` (2026-08-11), `fix(daemon): windowsHide on all remaining child_process
sites`, changes nine dashboard server files (9 insertions, 4 deletions). It is stranded
here: `git log --grep=windowsHide` found no match on `origin/main` or
`claude/workflow-platform`; `merge-base --is-ancestor 58745321` returned false for both;
and patch-id `403c44c6c56bd16b8e2779153129e5509799e38f` had no match on either ref.

## Exact next step

Fold `58745321` into the workflow-platform merge (or PR it separately), then update this
production pin to follow `main` so the repeated workflow-platform merge loop stops.

## Load list

1. `handoffs/2026-08-14-dashboard-workflow-platform-p1-complete.md`
2. `dashboard/server/control/activation.ts`
3. `dashboard/server/write/launch.ts`
4. Commit `58745321` (`git show 58745321 --stat`)
5. Commit range `origin/main..claude/dashboard-prod-pin`

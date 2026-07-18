# Dashboard execution control — HANDOFF

**Date:** 2026-07-18  
**Branch:** `codex/dashboard-operational-surfaces`  
**Owner:** `codex-worker`  
**Plan:** `docs/plans/2026-07-18-dashboard-execution-control-plan.md`

## Outcome

The dashboard now has a truthful executable vertical slice instead of treating every New action as a generic Composer save:

- Terminal tabs remain mounted across dashboard navigation and close only when the operator closes them (or the security session is lost).
- The old Pipeline destination is presented as **Runs** and groups live queue-card DAGs by workflow run id.
- Composer Task has an execution owner and **Run task** action.
- Composer Workflow has a strict stage/dependency editor, separate **Save definition** and **Run now** actions, and embeds a versioned `workflow-v1` payload when saved.
- `POST /api/write/workflow-runs` validates and atomically files a bounded acyclic DAG with server-resolved routing.
- Task/workflow launch signals the registered Codex scheduled runner immediately and reports whether pickup was actually signaled.
- Registered strict `workflow-v1` definitions can be launched from Workflows; prose-only legacy files are visibly non-runnable.
- Human Inbox combines approval decisions, input requests, wake-me/intervention cards, and halted work. Evidence verification remains honestly distinct from execution/resume.
- One Windows Hello/passkey unlock persists for the configured eight-hour work session; no private key is sent or stored by the dashboard.

## Runtime topology

The three repositories roles are intentionally isolated:

| Purpose | Path / branch |
|---|---|
| Dashboard code | `C:\Users\danie\kb` / `codex/dashboard-operational-surfaces` |
| Canonical reads + queue/audit writes | `C:\Users\danie\kb-worktrees\dashboard-ops` / `ops` |
| Durable Composer saves | `C:\Users\danie\kb-worktrees\dashboard-durable` / `claude/m1-dashboard` |
| Codex execution | `C:\Users\danie\kb-worktrees\codex-runner-runtime` / detached `origin/ops`, then per-run `codex/*` |

PM2 receives the two dashboard data roots through `DASHBOARD_REPO_ROOT` and `DASHBOARD_DURABLE_REPO_ROOT`. The scheduled task `kb-codex-runner` receives the isolated runtime root and deploy-key-bound `codex` push remote.

## Runner changes

- Fetches a detached `origin/ops` snapshot rather than taking over the local `ops` branch.
- Uses the model stamped on the card.
- Supplies dependency results and operator feedback only inside an explicit inert-context boundary; `## Evidence` is excluded.
- Preserves owner/runtime/model on rerun successor cards.
- Records the cost row before committing and stages only the original/result card paths plus the exact cost shard.
- A non-zero Codex exit walks the card to `halted`, never `done`, so failed work cannot release a dependent stage.

## Verification

- Dashboard TypeScript: `npm.cmd run typecheck` — passed.
- Dashboard tests: 131 files, 972 passed, 1 skipped.
- Production SPA build: passed.
- Runner PowerShell parser: passed.
- Runner shape assertions: 15 passed using a direct harness because `pytest` is not installed in the current Python environment.
- `python scripts/preamble.py`: passed.

## Honest remaining boundaries

This is not yet unattended multi-stage orchestration:

1. Codex result cards are pushed to a `codex/*` result branch. Binding worker rules require a human/cloud PR merge into `ops`; the dashboard must not bypass that with its eight-hour bearer session.
2. After that merge, dependency release and next-runner signaling are not yet exposed as a passkey **Continue workflow** action.
3. Composer chat is still a read-only planning conversation. It does not safely convert an arbitrary answer into the structured Task/Workflow form, so “research and build Atlas” still needs the operator to review/populate the stages.
4. There is no arbitrary-card Claude subscription runner. The Broker remains behind its existing ToS/security gates.
5. Human Inbox is a truthful read/verify surface, not yet a durable Approve/Reject/Respond/resume protocol. A real Atlas human-review stage therefore cannot be claimed end-to-end yet.
6. Runs observes canonical `ops`; it cannot show the Codex worker's transient `working` state until the reviewed result branch lands.

## Recommended next slice

Build the reviewed-result continuation loop without widening worker credentials:

1. Index only allow-listed `codex/codex-worker-*` result refs, pin their SHA/diff hash, and show a bounded escaped diff in Human Inbox.
2. Send Daniel to the GitHub PR/compare flow for the required human merge into `ops`.
3. Prove the exact result SHA landed in `origin/ops`.
4. Offer a passkey-confirmed **Continue workflow** action that runs the existing `release_dependents`, commits released paths plus audit atomically on `ops`, and signals newly runnable owners.
5. Separately propose the durable `waiting-human`/response schema before implementing Atlas review gates or live steering.

Do not add `gh pr merge`, direct worker pushes to `ops`, a Claude/Broker bypass, or terminal-spawned fake workflows as shortcuts.

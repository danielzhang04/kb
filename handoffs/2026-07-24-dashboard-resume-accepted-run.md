# Handoff: resume accepted governed runs

_Paused 2026-07-24 at a reviewed, pushed, merge-ready checkpoint. No live process was restarted
or changed by this branch._

## Workspace and merge state

- Worktree:
  `C:\Users\danie\kb\_private\codex-worktrees\dashboard-resume-accepted-run`
- Branch: `codex/dashboard-resume-accepted-run`
- Implementation commit: `649c9f7` (`feat(dashboard): resume accepted governed runs`)
- Base and fetched `origin/main` at commit time: `b7c772e`
- Pull request: <https://github.com/danielzhang04/kb/pull/89>
- PR state at pause: OPEN, CLEAN, MERGEABLE. GitHub reported no remote checks for the branch.
- Human merge is required. Do not merge as an agent and do not park `main` on this branch.

The implementation commit is pushed. This handoff is the only post-implementation documentation
change.

## Goal and acceptance state

The user must be able to resume an already-published governed run after every Human Request is
resolved and accepted. Resume must:

1. Continue the exact run instead of launching another proposal or creating an operator-selected
   Manager successor.
2. Preserve completed work and the existing stage graph.
3. Be safe under retry, double-click, restart, crash, Stop, and Manager-start failure races.
4. Keep Resume and the manual Manager-successor action mutually exclusive.
5. Report an inactive execution runtime on an explicit manual Resume.
6. Preserve the run at a resumable human boundary when startup containment fails.

The code, local verification, and independent review meet this target. The remaining acceptance
step is a post-merge live proof using the stranded run below.

## Implemented functionality

### Durable core

- `StoredRun.activationReceipts` is a bounded journal with
  `claimed | roots-activated | dispatched | failed` phases.
- Claim, phase advance, failure, replay, bounded retention, public-DTO stripping, validation, and
  restart normalization live in the existing `ControlPlaneStore`.
- An exact dispatched activation replay is read-only and never redispatches.
- A pending pre-restart activation returns the run to `waiting-human`; the exact old key can recover,
  while a refreshed visible-version key can supersede that pending receipt.
- Canonical root mutation remains inside the existing ops/Git transaction and happens only after the
  durable claim.
- `dispatched` is written only after the Manager adapter/session/run startup callback observes durable
  running state.

### Concurrency and containment

- `RunControlTransactions` provides per-run FIFO serialization for Resume, Stop, and successor
  operations; unrelated runs remain concurrent.
- Manager-start acknowledgement and containment have bounded deadlines, so a hung adapter cannot
  permanently hold the per-run control lock.
- `containManagerStart` interrupts only the current Manager session and preserves the run/stage graph.
- The Manager session is durably fenced as `interrupted` before awaiting adapter cancellation.
- `ensureManager` re-reads the durable session after its adapter await, preventing a late startup from
  reviving or acknowledging a fenced Manager.
- Late executor rejection produces one intervention and a resumable `waiting-human` run.

### UI and client

- `Resume run` appears in the Run Cockpit, Managed Runs, and the resolved Human Request row when the
  server-derived run is published, `waiting-human`, has at least one Human Request, and all requests
  are accepted.
- Resume uses an exact binding over run ref, run version, proposal hash, and Manager generation.
- Manual Resume exposes `automatic-runtime-not-activated`; only the existing post-response automatic
  attempt tolerates that condition.
- The Manager-successor action is hidden/rejected whenever the accepted boundary belongs to Resume.

The Human Requests row action is intentionally retained alongside the canonical cockpit action
because that is the surface where the stranded run was encountered.

## Existing infrastructure preserved

- Uses the existing control store, automatic execution engine, canonical root activator,
  audit/preamble/policy gates, and dashboard control client.
- No parallel executor, alternate run model, or workflow-specific resume route was added.
- Atlas code, process configuration, read/write/file-card/run/file-pull behavior, and roster projection
  were not modified.
- Atlas remains an independent always-on background service, not a dashboard-launched agent and not a
  normal Agents-roster entry.
- FYT metadata and runner bindings were not modified by this work.
- No credential or secret value was read, copied, recorded, or changed.

## Verification evidence

Final verification on the committed implementation:

- `python scripts/preamble.py`: PASS
- `npm.cmd run typecheck`: PASS
- Focused Resume/control/UI suite: 11 files, 304/304 tests PASS
- Full dashboard suite with bounded workers: 204 files, 2,156 PASS, 2 skipped
- `npm.cmd run build`: PASS
- `git diff --check`: PASS; line-ending warnings only
- `python scripts/canary.py --diff-guard origin/main...HEAD`: clean; no `evals/` changes
- Production build emitted only the existing >500 kB chunk advisory.

Important regression coverage includes concurrent exact activation, stale CAS, async-audit failure,
restart recovery at each receipt phase, replay/supersession, Stop/successor races, late executor
rejection, Manager-start timeout, lock release, hung containment, and the real-engine crossing race
between a held Manager start and held adapter cancellation.

Independent final verdicts:

- `execution_regression_audit`: GO
- `execution_fix_review`: GO (an initial stale-snapshot objection was explicitly withdrawn after
  reopening the current durable-fence code and crossing test)
- `workflow_builder_map`: GO; existing infrastructure reused and Atlas untouched

## Known outstanding work and problems

1. PR #89 is not merged.
2. Therefore the live dashboard does not yet contain this Resume implementation.
3. The exact stranded run has not been resumed against the real daemon with this change.
4. GitHub reported no remote checks; the complete verification evidence is local and listed above.
5. The existing production bundle-size advisory remains unrelated and non-blocking.
6. The user previously stated that the execution gate was turned on. Treat that only as reported
   runtime state: do not inspect, print, or persist environment/credential values. A plain PM2 restart
   preserves the daemon's configured environment; never use `--update-env` from an older shell.

## Exact post-merge continuation

Start by reading `CLAUDE.md`, `governance/agent-rules.md`, and `orgs/kb-ops/contract.md`, then:

```powershell
Set-Location C:\Users\danie\kb
python scripts/preamble.py

Set-Location C:\Users\danie\kb\_private\codex-worktrees\dashboard-resume-accepted-run
Get-Content docs/plans/2026-07-24-dashboard-resume-accepted-run-HANDOFF.md
git status --short --branch
gh pr view 89 --json state,mergeable,mergeStateStatus,headRefOid,baseRefOid,url
```

If PR #89 is still open, stop before deployment and report that human merge is still required.

After the user confirms the merge, update the existing separate deployment worktree; do not use or
switch the primary checkout:

```powershell
Set-Location C:\Users\danie\kb\_private\codex-worktrees\dashboard-postmerge-live
git status --short --branch
git fetch origin main
git merge --ff-only origin/main

Set-Location dashboard
npm.cmd run typecheck
npm.cmd run build
pm2 restart kb-dashboard
```

Before the merge/update, verify the deployment worktree is clean and its branch can fast-forward.
If it cannot, stop and reconcile rather than resetting or overwriting it. Use plain
`pm2 restart kb-dashboard`; do not pass `--update-env`.

Then perform read-only service checks:

1. Confirm `http://localhost:5317/healthz` returns healthy.
2. Confirm the dashboard UI loads at <http://localhost:5317>.
3. Confirm `kb-dashboard` and the independent `atlas-worker` are online in PM2. Do not restart Atlas
   merely because the dashboard was deployed.
4. If Atlas is down, treat it as a separate always-on service incident and follow
   `dashboard/ALWAYS-ON.md`; do not add Atlas to dashboard agent-launch infrastructure.

## Live acceptance: exact stranded run

- Run: `run-87d8aef2-f78b-4e78-ba00-323c67cc8fc6`
- Workflow: `self-lint-report`
- Last observed state: published `waiting-human`
- Last observed Manager:
  `session-4de6aa55-ecb0-4555-b5f0-4fbe0f963c79`, generation 1, state `interrupted`
- Last observed resolved intervention:
  `automatic:execution:report:attempt-ad7b42c6-8d53-44d9-a2f6-5c0430e1ca03`
- Proposal: `proposal-82000862-688a-4570-b713-8ccae2d8dfa8`
- Proposal hash:
  `d33265bf6d55c4455ff7b22f0f028b9ce009809d61d70e14aa0e42b3be933cf8`

Refresh the run detail after deployment. If all Human Requests are still accepted, `Resume run` should
appear. Click Resume once and watch:

- the run ref remains exactly the same;
- no proposal launch occurs;
- no manual successor action is offered;
- the interrupted Manager may receive the engine's deterministic successor generation;
- completed work is not rerun;
- the run advances to running/success or to a new legitimate human boundary.

If Resume reports `automatic-runtime-not-activated`, stop and ask the user to re-arm the watched
runtime; do not commit the gate into `dashboard/pm2.config.cjs`. If any other error occurs, preserve
the run, capture the public error/run state and daemon logs, and diagnose it without relaunching the
workflow or manually starting a Manager successor.

## Completion condition

This workflow is complete only after:

1. PR #89 is human-merged.
2. The separate live deployment worktree is fast-forwarded and the dashboard is rebuilt/restarted.
3. Dashboard and Atlas are independently healthy.
4. The exact stranded run resumes without relaunching or repeating completed work.
5. The resulting run/stage/Manager state is reported to the user.

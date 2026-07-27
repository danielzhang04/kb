# Dashboard governed execution control — HANDOFF

**Date:** 2026-07-18
**Branch:** `codex/dashboard-operational-surfaces`
**Owner:** `codex-worker`
**Architecture:** `docs/plans/2026-07-18-dashboard-agent-workspaces-plan.md`
**Wave A implementation:** `fde0ae5`
**Waves B–D implementation:** `75da1b9`

## Read first

Run `python scripts/preamble.py`, then read `CLAUDE.md`, `governance/agent-rules.md`,
`orgs/kb-ops/_index.md`, `orgs/kb-ops/STATE.md`, and `orgs/kb-ops/contract.md`. This is a
Claude-style handoff; do not substitute `AGENTS.md` for the binding constitution. Do not edit
human-owned governance files.

The product goal remains a local operations console where the operator can begin with a planning
conversation, review an immutable executable proposal, launch a governed run, inspect and steer its
manager/workers, handle human boundaries inline, recover from crashes, and publish exact results
without making browser tabs or free-form prompts the workflow engine. The design remains
multi-project and multi-runtime. Atlas is a later acceptance workload, not an activation shortcut.

## Outcome

Wave A remains deployed at `http://localhost:5317`. Waves B–D are implemented in `75da1b9`, but were
not deployed or activated in production by this run.

### Wave B — proposal compiler and control plane

- Composer now receives a server-owned planning instruction on new, resumed, and rehydrated planning
  turns. The instruction and provider handles are not browser-controlled or exposed in public state.
- Added the closed `kb.plan-proposal/v1` protocol, bounded parsing, schema validation, canonical
  hashing, immutable revisions, material diffs, and exact revision-bound approval.
- Added durable, subject-bound local projections for proposals, runs, stages, attempts, managed
  sessions, Human Requests, events, publication phases, steering receipts, and retention bundles.
- Added deterministic canonical card identities and publication reconciliation. Dashboard-managed
  cards begin blocked, carry `execution-controller: dashboard`, and are excluded from the legacy
  PowerShell agent runner so two execution engines cannot claim the same work.
- Launch compiles required governance/project references, closed action namespaces, server-owned
  runtime/model/skill/scope capabilities, exact Git bases, and pre-pull authorization. Unknown actions,
  T4 namespaces, dirty indexes, stale proposal hashes, and mismatched canonical state fail closed.

### Wave C — cockpit, broker, and Human Requests

- Added a durable managed-session broker with single daemon ownership, cursor replay, restart
  normalization, targeted idempotent steering, explicit safe checkpoints, and stop-before-signal
  shutdown behavior.
- Added public operational DTOs for visible messages, lifecycle, commands, tool status, paths, diffs,
  checkpoints, artifacts, and accounting. Hidden reasoning, raw tool payloads, capabilities, and
  credential-shaped data are not projected.
- Runs now expose the manager/stage/attempt/session graph, operational stream, instructions, artifacts,
  Stop, Retry, Reroute, manager recovery, and checkpoint-bound steering.
- Human Inbox and Runs share one durable Human Request object. Responses are authenticated,
  revision-bound, idempotent, and audited before any stage release or manager signal. Approval/review
  release only on approval; input/intervention release on approved/responded; governance refusals
  cannot be approved and only offer Request changes.
- A governed `401 bad signature` clears the invalid browser session capability and locks affected
  surfaces for reauthentication instead of repeating rejected writes.

### Wave D — governed automatic execution foundation

- Added a deterministic DAG executor with global bounded concurrency, per-attempt isolated worktrees,
  server-owned Claude/Codex profiles, capability/skill resolution, accounting, dependency release,
  successor attempts, manager recovery, and cancellation checkpoints.
- Stop persists cancellation intent before signaling adapters and converges run, stage, attempt, and
  session state. Unacknowledged adapters become interrupted and open an intervention boundary rather
  than being falsely reported stopped.
- Retry creates an immutable successor run only after exact canonical reread, published card links,
  quiescent terminal/interrupted descendants, and settled Human Requests. Reroute uses CAS,
  reauthorization after canonical pull, policy revalidation, and successor lineage when in-place
  switching is unsafe.
- Added a concrete canonical Git result integrator. It journals recovery phases before attempt commit,
  lineage cherry-pick, and canonical card mutation; disables Git hooks; default-denies transports while
  allowing only HTTPS/SSH remotes; verifies exact digests/paths/commits; remotely confirms the managed
  lineage before completing the canonical card; and reconciles one concurrent `ops` advance with exact
  Result re-verification.
- Added retention inventory, content hashes, dry-run, quarantine, and restore. Purge remains absent
  until a human-ratified retention policy exists.

## Deliberately inactive boundaries

These are gates, not hidden completion claims:

1. The production HTTP context does not inject the automatic engine/cancellation adapter by default.
   The inactive/test adapter still uses the app-local result integrator; production activation must
   explicitly select the canonical Git integrator and broker after its separate threat/ToS review.
2. T3 stage release remains `t3-approval-release-not-implemented`. Merge, deploy, publication, and
   release still require a separate dashboard/WebAuthn human approval path and were not enabled.
3. No Waves B–D PM2 restart or deployment was performed. The running site remains the Wave A build.
4. Atlas was not run. First activation acceptance should be a synthetic low-risk two-stage workflow;
   Atlas planning follows only after that passes end to end.
5. Retention has no purge operation. T4 credential-as-object and real-money actions remain forbidden.

## Verification

- `python scripts/preamble.py` — passed.
- Full dashboard regression after the integrated Waves B–D implementation:
  **154 files; 1,180 passed, 1 skipped** using `--maxWorkers=4`.
- Final remediation suite: **5 files; 75 passed** covering the compiler/control routes, store, executor,
  adapters, Git publication crash recovery, and interrupted Retry semantics.
- `npm.cmd run typecheck` — passed after the final fixes.
- `npm.cmd run build` — passed after the final fixes; only the existing >500 kB chunk warning remains.
- `git diff --check` — clean apart from informational Windows LF/CRLF notices.
- Final scoped adversarial review — clean; no blocker, high, or medium findings remain.

The full 1,180-test suite was used once as the cross-file regression baseline. Later iterations used
focused tests rather than repeatedly rerunning the entire suite.

## Next controlled step

Treat production activation as a separate reviewed task: wire the broker, engine, cancellation, and
canonical integrator into the production context; implement the signed T3 release path; then run the
synthetic two-stage acceptance workflow with restart, reconnect, Stop, Retry, Reroute, Human Request,
and canonical publication fault injection. Do not deploy merely because the inactive implementation
and test suite are complete.

The unrelated `orgs/faceless-youtube/.claude/settings.local.json` remains untouched and untracked.

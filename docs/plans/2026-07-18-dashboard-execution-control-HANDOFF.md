# Dashboard agent workspaces — HANDOFF

**Date:** 2026-07-18
**Branch:** `codex/dashboard-operational-surfaces`
**Owner:** `codex-worker`
**Active plan:** `docs/plans/2026-07-18-dashboard-agent-workspaces-plan.md`
**Prior plan:** `docs/plans/2026-07-18-dashboard-execution-control-plan.md`

## Read first

Run `python scripts/preamble.py`, then read `CLAUDE.md`, `governance/agent-rules.md`,
`orgs/kb-ops/_index.md`, `orgs/kb-ops/STATE.md`, and `orgs/kb-ops/contract.md`. Do not replace
this handoff with `AGENTS.md` and do not edit the human-owned governance files.

The product goal is a local operations console that can eventually run a complex project from a
Claude-managed conversation: plan it, compile a reviewed workflow, start it in governed automatic
mode, inspect and steer the manager/workers, and respond to human requests inline. Atlas is the
eventual acceptance workload, **not** the next implementation task.

## Wave A outcome — truthful workspaces

Wave A is complete and deployed:

- **New** is one direct action. It creates an app-local Composer workspace instead of opening an
  entity dropdown where every choice led to the same surface.
- Composer supports multiple independent tabs. Switching dashboard destinations keeps open panes
  mounted; Close is browser-only, with a **Recent** list to reopen it. Archive/Restore are explicit
  durable operations, and Fork creates a distinct conversation without sharing a mutable provider
  session.
- Workspace metadata and visible turns persist outside the repo under `DASHBOARD_STATE_ROOT`.
  Public references are opaque and subject-bound. Claude provider session IDs are encrypted at rest
  and never returned to the browser.
- One process-local writer lease is allowed per workspace. Concurrent workspaces can run, while a
  second turn, archive, or fork on an active workspace returns `409 session-busy`.
- The first real workspace turn receives the idea/planning seed. The prompt control is one primary
  Send/Stop affordance; the structured Draft & run controls remain secondary and collapsed.
- Browser transcript projection removes hidden reasoning and all tool inputs/results, while retaining
  visible assistant text and inspectable tool-name/success shape. Known session capabilities and
  common credential forms are redacted before streaming or persistence.
- Stored provider handles that cannot be decrypted after a daemon secret rotation are discarded
  without losing visible history. The next turn starts a fresh provider session with an inert,
  bounded rehydration of at most the last 12 visible turns.
- Spawn/audit/storage observer failures terminate or contain the child rather than orphaning a Claude
  process or crashing the dashboard daemon.
- Live Claude children are process-tracked and drained before Fastify/PM2 waits on streaming requests.
  A restart normalizes any persisted `running` residue to `interrupted`; a running tab cannot be closed
  until its turn is explicitly stopped.
- Recognizable passwords, API/access tokens, private keys, session capabilities, and other supported
  credential shapes are refused in workspace titles/prompts before persistence or spawn. Public legacy
  fields are redacted too, and Composer warns the operator not to paste credentials.
- Card model/runtime routing now reconciles canonical `ops` before lifecycle checks, freezes active,
  approval-bound, and historical attempts, and uses a pinned single-commit publication check. A
  retryable publication conflict does not permanently freeze the UI.

## Honest runtime boundaries

Wave A does **not** yet make Composer a background workflow engine:

1. Switching dashboard views preserves a live turn because the pane stays mounted. Refreshing,
   closing the page, losing the browser connection, or restarting PM2 stops/interrupts that turn. Live spectator attach,
   background ownership, replay, and reconnect require the Wave B/C managed-session event broker.
2. A stable dashboard session secret permits exact Claude `--resume`. A rotated secret falls back to
   bounded visible-context rehydration; do not claim exact provider continuity across every restart.
3. Composer conversation is persisted but not yet compiled into a schema-constrained immutable plan.
   The existing structured Task/Workflow form remains the only governed launch path.
4. Runs groups canonical queue cards but is not yet a durable manager cockpit. It cannot yet show a
   complete normalized command/tool/diff stream or steer child sessions.
5. Human Inbox is still a read/verify surface, not the durable inline Human Request protocol.
6. Local Composer storage has atomic replacement and restrictive file modes, but no enforced disk
   quota or automatic retention cleanup, and the session-list response still scales with retained
   transcript history. Build metadata-only listing, inventory/dry-run/quarantine before any purge.
7. Do not activate the Claude Broker, pass arbitrary browser CLI flags, use permission-bypass modes,
   expose credentials, or bypass worker-to-`ops` governance.

## Verification at handoff

- `python scripts/preamble.py` — passed.
- `npm.cmd run typecheck` in `dashboard/` — passed.
- `npm.cmd test -- --run` in `dashboard/` — **134 files passed; 997 passed, 1 skipped**.
- `npm.cmd run build` in `dashboard/` — passed.
- Focused restart/workspace hardening — **8 files, 88 tests passed**.
- Final adversarial review — **clean; no blocker, high, or medium findings remain**.

## Continue with Wave B — plan compiler and run control plane

Do not start by adding more buttons. Preserve chat as the primary construction experience.

1. Define a versioned, schema-constrained **proposal protocol** for plan revisions, tasks, stages,
   dependencies, manager runtime/model, worker runtime/model, required skills, scope, artifacts,
   checkpoints, human gates, and executable governance references.
2. Treat assistant proposal blocks as untrusted data. Parse and validate them server-side; never execute
   arbitrary prose, CLI flags, environment, paths, tools, or permission settings from the browser.
3. Show the operator an inspectable proposal revision and diff. A material edit mints a new hash.
   Approval and launch must bind to that exact immutable revision.
4. Add app-local durable projections for `Run`, `Stage`, `Attempt`, `ManagedSession`, and append-only
   operational events, linked to canonical queue cards rather than replacing card truth.
5. Provision one logical Claude Manager head session per run. The deterministic run graph and durable
   events remain authoritative if the Manager exits; a successor Manager can rehydrate from approved
   plan state and checkpoints.
6. Validate this with a synthetic, low-risk two-stage workflow. Do not use Atlas yet.

## Then Wave C — cockpit and Human Requests

1. Normalize supported Claude and Codex operational events into public event DTOs: visible messages,
   session hierarchy, commands, tool names/status, file paths, diffs, checkpoints, and lifecycle. Never
   expose chain-of-thought, raw tool payloads, or credentials.
2. Add durable background session ownership and an event broker so browser refresh/reconnect can attach
   to a running Manager or worker and replay from a cursor without spawning duplicates.
3. Make Runs the central cockpit: manager head, stage/attempt graph, workers/children, terminal or log
   view, code/instructions, artifacts/diffs, Stop/Retry/Reroute, and a conversation channel that applies
   steering at explicit safe checkpoints.
4. Introduce a human-reviewed, versioned `HumanRequest` schema for input, approval, review,
   intervention, and governance refusal. The same durable object appears in Human Inbox and its Run.
5. Respond/Approve/Reject/Request changes inline in either surface. Commit the idempotent,
   revision-bound response before signaling a manager or releasing a stage.

## Then Wave D — governed automatic execution

1. Compile global governance, the project contract, approved plan scope, and server-owned runtime
   capabilities into executable policy checks. Runs proceed automatically inside that envelope and
   stop only at explicit human/governance boundaries.
2. Add server-owned auto profiles for Claude and Codex; no arbitrary browser-supplied permission mode.
   Model/runtime changes follow successor-attempt rules when live switching is unsupported.
3. Add isolated per-run worktrees, bounded concurrency, skill/capability resolution, cost accounting,
   canonical result integration, dependent release, manager recovery, and crash/restart tests.
4. Add storage inventory and operator cleanup prompts, then dry-run/quarantine/restore. Purge only after
   human-ratified retention policy.
5. Only after the synthetic workflow passes end-to-end should a separate planning conversation define
   the Atlas build acceptance run.

## Deployment record

The next terminal should begin from this branch head rather than reconstructing Wave A from
conversation history.

- Wave A implementation commit: `fde0ae5` (`feat(dashboard): add persistent composer workspaces`)
- Handoff/deployment commit: the commit containing this file, immediately after `fde0ae5`
- PM2 process: `kb-dashboard` online on port `5317` after `--update-env` restart
- Health check: `GET http://localhost:5317/healthz` returned `{ "ok": true, "node": "24.18.0" }`
- SPA check: `GET http://localhost:5317/` returned `200` with the built application root

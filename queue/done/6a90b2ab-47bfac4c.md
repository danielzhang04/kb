---
schema-version: 1
id: 6a90b2ab-47bfac4c
project: kb-ops
action: atlas-y3-fix
target: C:\Users\danie\Atlas-worktrees\y3
risk-tier: T1
owner: codex-worker
claim-token: cf7cb55ebfc722df
state: done
approval: null
workflow: 01a0452e-594f-7e43-8746-879869b5ae1b
depends-on: []
variant-group: null
role: work
session-id: 6a90afaa-e8c77885
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 84834007c9431a7ccdab595dcc3652bf80abe981
---

## Work order

\# Atlas Y3 fix round (boss rulings - all seven review findings accepted)

cwd = C:\Users\danie\Atlas-worktrees\y3 (uncommitted Y3 tree). NOT a kb project: ignore every kb preamble/spin-up/card/ops
instruction (no scripts/preamble.py - do NOT stop for it). You never commit. Never launch the app. ASCII, CRLF.
Tests: C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q --basetemp=.pytest-tmp -p no:cacheprovider. Current: 563 passed.

1. HIGH - desktopapps ~157-161: one shared ASCII basename sanitizer for every detail string (strip directory,
   query/fragment, argv, non-ASCII; cap length); test with a profile path carrying "?token=secret" -> detail is
   "signed executable not found: tool.exe".
2. HIGH - mcp_client ~436-440/483-498: only a missing config file or missing entry is not_configured; malformed
   JSON, permission errors, transport import failures -> state error with closed details ("config unreadable",
   "config malformed", "transport unavailable"). Tests for each.
3. HIGH - mcp_client ~392-415: connect() while a server task exists must either raise a bounded error or stop and
   await the existing task before replacing it; close() must never orphan a session/child. Test: double connect
   -> exactly one live task, one child kill path.
4. HIGH - app.py ~550-554 / desktopapps ~153-155,396-433 / ui/app.js ~1165: the Settings poll must NOT re-run
   signed-executable resolution. Cache the desktop status snapshot: computed once lazily on first request and
   refreshed at most every 10 minutes in a background task (or on an explicit "refresh" Settings action) -
   never on the poll path; /health returns the cached snapshot with an "as_of" timestamp. Test: 20 consecutive
   /health calls invoke the resolver at most once.
5. MEDIUM - closed vocabulary: a single module-level table of allowed states and detail renderers; _set_status
   validates every (state, detail) pair against it and raises in tests / logs once in production for unknown
   pairs. Test that every detail produced in the suite is in the table.
6. MEDIUM - /health: derive `connected` from `state` and force `tools: 0` unless connected; reject/normalize
   inconsistent records at the boundary. Tests for the contradictory shapes the review listed.
7. MEDIUM - brain capability text: sort tool names and (server, state) pairs before rendering; permutation test
   proves identical text for reordered snapshots.

READ BUDGET: the ranges cited above plus the touched tests. Stop at 45 minutes. Exit: focused
(tests/test_mcp_client.py tests/test_desktopapps.py tests/test_stateserver.py tests/test_brain.py), full suite
(>= 563), node --check ui/app.js, git diff --check, eol w/crlf. Final message: per-item changes + red-on-revert
for 1-4. Do not commit.

## Result

Implemented all seven review findings without committing or launching Atlas.

1. Shared ASCII basename sanitizer strips paths, query/fragment, argv, and non-ASCII; caps at 80 characters.
2. MCP configuration failures now distinguish missing file/entry from malformed, unreadable, and unavailable transport states.
3. Double `connect()` raises a bounded error while preserving the sole live task and cleanup path.
4. Desktop status is lazily cached, refreshed every 600 seconds in a background task, and exposed with `as_of`; health polling never re-resolves it.
5. Added one closed status-detail vocabulary in [statusdetail.py](/C:/Users/danie/Atlas-worktrees/y3/worker/statusdetail.py). Tests reject unknown pairs; production logs once and normalizes.
6. `/health` derives `connected` from `state`, clears incompatible errors, and forces zero tools unless connected.
7. Brain capability names and MCP `(server, state)` pairs are deterministically sorted.

Red-on-revert coverage for items 1–4:

- Secret-bearing `tool.exe?token=secret` profile must render only `tool.exe`.
- Missing, malformed, unreadable, and transport-unavailable configurations have dedicated tests.
- Double-connect must retain one task and invoke one child-kill path.
- Twenty consecutive health-provider calls must perform one desktop status resolution.

Verification:

- Focused: `144 passed`
- Full: `572 passed` (baseline requirement: ≥563)
- `node --check ui/app.js`: passed
- `git diff --check`: passed
- Added lines: ASCII
- Touched files: CRLF
- One existing Pydantic warning remains
- Durable note added to [memory/codex.md](/C:/Users/danie/Atlas-worktrees/y3/memory/codex.md)

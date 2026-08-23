---
schema-version: 1
id: 6a8a86cf-a590fdcd
project: atlas-prep
action: atlas-wave2-fix-c
target: C:\Users\danie\Atlas-worktrees\revamp
risk-tier: T1
owner: codex-worker
claim-token: 47ced841950e80da
state: done
approval: null
workflow: 01a02d12-b790-72e1-8394-235cde5a8cb6
depends-on: []
variant-group: null
role: work
session-id: 6a8a83bf-b01d6a41
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Atlas wave 2 — live-smoke fixes C (find_file matching, MCP child-tree hygiene)

You are a Codex worker on the standalone Atlas application. Working directory:
`C:\Users\danie\Atlas-worktrees\revamp` (branch `claude/atlas-revamp`, HEAD f2246f5). Work ONLY there.
Read `CLAUDE.md`, `docs/specs/2026-08-22-atlas-wave2-design.md` §2, then `worker/localfiles.py`,
`worker/mcp_client.py`, `worker/desktop.py` (its Job Object helper), `worker/app.py`, `worker/chat.py`,
`worker/runtime.py` and their tests.

Live evidence:
1. "find the atlas voice layer design spec" → the model called `find_file` with `query="atlas voice layer design spec"`
   and got nothing, although `C:\Users\danie\kb\docs\specs\2026-07-15-atlas-voice-layer-design.md` exists under a
   root: matching is a raw substring test. Fix in `LocalFiles.find`: normalize both the query and each entry
   name by lower-casing and replacing `-`, `_`, `.` and whitespace runs with single spaces; tokenize the query;
   drop stop-words (`the a an of my file files spec document doc`); a name matches when every remaining query
   token is a substring of the normalized name; if nothing matches all tokens, fall back to entries matching
   at least half of the tokens, ranked by tokens matched then mtime. Keep limits/deadline/thread. Tests with
   the real-looking filename above and queries "atlas voice layer design spec", "voice layer", "atlas-voice".
2. Twenty orphaned `workspace-mcp` processes were found after today's `worker.chat` and worker runs: closing
   the MCP stdio client ends `uvx` but its grandchild Python server survives on Windows. Fix: (a) factor the
   Job Object helper out of `worker/desktop.py` into `worker/jobobject.py` with `assign_current_process()`
   and `assign_process(handle_or_pid)` (both no-ops with a warning off Windows or on failure) and make
   `desktop.py` use it; (b) `worker/app.py` `entrypoint`/`main` and `worker/chat.py` call
   `jobobject.assign_current_process()` first thing so every descendant (MCP servers, `claude` launches'
   helper processes, uvx) dies with the process; (c) `McpServers.close()` additionally kills each server's
   process tree explicitly (`taskkill /T /F /PID <pid>` via an injectable killer) using the pid from the
   stdio transport (inspect `mcp.client.stdio.stdio_client` 1.29 to obtain the process object/pid cleanly;
   if it is not reachable, wrap the spawn: pass `StdioServerParameters` through a small subclassed
   context manager that records the pid). Tests inject fake killers / job-object functions; never spawn.
Norms: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp .pytest-tmp`
(full suite; delete `.pytest-tmp`); account-free tests; one statement per line; no dead information (no duplicate
job-object code); no commits; no git stash/reset/checkout. Report files, suite summary, `git diff --check`.

## Result

Implemented both live-smoke fixes.

- `find_file`: normalized token matching, stop-word removal, partial-match fallback, and ranking by matched tokens then mtime.
- MCP hygiene: centralized Job Object support, early process assignment in app/chat entrypoints, PID tracking, explicit Windows tree-kill before stdio close, and cancellation cleanup.
- Added account-free, no-spawn regression tests with injected killers and Job Object functions.

Files changed:

- [worker/localfiles.py](C:/Users/danie/Atlas-worktrees/revamp/worker/localfiles.py)
- [worker/jobobject.py](C:/Users/danie/Atlas-worktrees/revamp/worker/jobobject.py)
- [worker/mcp_client.py](C:/Users/danie/Atlas-worktrees/revamp/worker/mcp_client.py)
- [worker/desktop.py](C:/Users/danie/Atlas-worktrees/revamp/worker/desktop.py)
- [worker/app.py](C:/Users/danie/Atlas-worktrees/revamp/worker/app.py)
- [worker/chat.py](C:/Users/danie/Atlas-worktrees/revamp/worker/chat.py)
- [tests/test_localfiles.py](C:/Users/danie/Atlas-worktrees/revamp/tests/test_localfiles.py)
- [tests/test_mcp_client.py](C:/Users/danie/Atlas-worktrees/revamp/tests/test_mcp_client.py)
- [tests/test_jobobject.py](C:/Users/danie/Atlas-worktrees/revamp/tests/test_jobobject.py)
- [tests/test_desktop.py](C:/Users/danie/Atlas-worktrees/revamp/tests/test_desktop.py)
- [tests/test_process_entrypoints.py](C:/Users/danie/Atlas-worktrees/revamp/tests/test_process_entrypoints.py)

Verification:

- Focused tests: `60 passed`
- Full suite: `311 passed, 1 third-party Pydantic warning`
- `git diff --check`: passed
- `.pytest-tmp`: removed
- Branch/HEAD unchanged: `claude/atlas-revamp` at `f2246f5`
- No commit created
- Pre-existing modification to `handoffs/2026-08-22-atlas-wave2.md` was preserved untouched.

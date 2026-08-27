---
schema-version: 1
id: 6a8fc277-b29ebfff
project: kb-ops
action: atlas-x6b
target: C:\Users\danie\Atlas-worktrees\x6
risk-tier: T1
owner: codex-worker
claim-token: 785f59631a446cae
state: done
approval: null
workflow: 01a0418a-c4f8-7d40-ae26-7f5ec7012dc1
depends-on: []
variant-group: null
role: work
session-id: 6a8fc127-bc249815
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 1a9c685318874eb944e4f669f9a9c0015f53d2e7
---

## Work order

\# Atlas X6b - un-pin the machine path in a config test (coordinator-owned)

cwd = C:\Users\danie\Atlas-worktrees\x6 (uncommitted X6 tree - keep its edits). NOT a kb project: ignore every
kb preamble/spin-up/card/ops instruction (no scripts/preamble.py - do NOT stop for it). You never commit.
ASCII, CRLF. Tests: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q --basetemp=.pytest-tmp -p no:cacheprovider`.
Current: 552 passed, 1 failed: `tests/test_mcp_client.py::test_checked_in_kb_config_lists_every_read_tool_and_confirms_every_other_tool`.

Cause: the boss changed Daniel's machine config `config/atlas.yaml` `kb_bridge.path` from
`C:/Users/danie/kb/dashboard/atlas-bridge` to `C:/Users/danie/kb-worktrees/atlas-bridge/dashboard/atlas-bridge`
(the bridge lives in a kb worktree until the dashboard workover lands). The failing test pins the old literal.
Ruling: tests must not pin a machine-specific location. Change ONLY that test so it asserts the contract:
the resolved spawn argv is `["node", "<kb_bridge.path>/dist/server.js"]` where `<kb_bridge.path>` is the
value read from the same config (or a fixture config value), the path uses forward slashes, is absolute
(drive letter), and ends with `/atlas-bridge`; env keys exactly the three named flags + PATH + SystemRoot.
Do not touch worker code or the other X6 edits. Stop at 10 minutes. Exit: full suite 553 passed,
`git diff --check`, eol w/crlf. Do not commit.

## Result

Updated [tests/test_mcp_client.py](C:\Users\danie\Atlas-worktrees\x6\tests\test_mcp_client.py) only:

- Resolves expected argv from checked-in `kb_bridge.path`.
- Validates forward-slash, drive-absolute, `/atlas-bridge` path contract.
- Retains exact environment-key assertion.

Verified:

- Full suite: `553 passed, 1 warning`
- `git diff --check`: clean
- Test file line endings: CRLF
- No commit made.

---
schema-version: 1
id: 6a99bbc2-045fbfda
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p2
risk-tier: T1
owner: codex-worker
claim-token: 67fe6af05e240b0a
state: done
approval: null
workflow: 01a06882-9fa0-7893-9cc8-ec9596c612f5
depends-on: []
variant-group: null
role: work
session-id: 6a99bb01-9d54bfda
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 16bec2a5a819b7baff88944623604e630e26edff
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p2`
(branch `claude/prospecting-p2`). Run `python scripts/preamble.py` once (expect PREAMBLE OK; if no
output within 60 s, retry once, then proceed and note it). NEVER commit, never touch git refs, never
pip install, never run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/,
dashboard/. Use `--basetemp .pytest-tmp-fix9 -p no:cacheprovider`. Stop at 25 minutes. First edit by command 4.

\# Fix brief — P2 Task 9 snapshot fetcher (three review items). Keep public signatures.
READ: `scripts/prospecting/fetcher.py`, `scripts/prospecting/tests/test_fetcher.py`. Nothing else.
1. HIGH: no live HTTP adapter is enabled by default. The fetcher's transport is selected explicitly by
   the caller/executor (`transport=` argument or an executor-provided callable); the default is the
   recorded-fixture transport; `_http` exists but is only reachable when the executor passes it with a
   claimed `fetch_snapshot` exec_request. Test: default construction never opens a socket even when
   `KB_PROSPECTING_NO_NETWORK` is unset (monkeypatch `socket.socket` to raise).
2. MEDIUM: never issue a bare `BEGIN`/`rollback()` on a caller's connection: use a SAVEPOINT
   (`SAVEPOINT snap; ... RELEASE snap` / `ROLLBACK TO snap`) so a failure only undoes this snapshot
   attempt. Test: a caller with an open transaction keeps its own uncommitted rows after a failed fetch.
3. MEDIUM: fixture lookup resolves relative to the repository root derived from `__file__`
   (`Path(__file__).resolve().parents[2]`), not the process CWD. Test from a different CWD (tmp_path).
Run `py -3 -m pytest scripts/prospecting/tests/test_fetcher.py -q --basetemp .pytest-tmp-fix9 -p no:cacheprovider`;
all pass. Report files changed, counts, summary.

## Result

Implemented all three fetcher fixes.

- [fetcher.py](C:\Users\danie\kb-worktrees\prospecting-p2\scripts\prospecting\fetcher.py): default fixture transport, repo-root fixture resolution, savepoint-based database cleanup.
- [test_fetcher.py](C:\Users\danie\kb-worktrees\prospecting-p2\scripts\prospecting\tests\test_fetcher.py): added coverage for socket-free defaults, CWD-independent fixtures, and preservation of an open caller transaction.

Verification: `9 passed in 3.42s` using the prescribed pytest command.

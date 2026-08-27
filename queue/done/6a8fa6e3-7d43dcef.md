---
schema-version: 1
id: 6a8fa6e3-7d43dcef
project: kb-ops
action: atlas-reconcile
target: C:\Users\danie\Atlas-worktrees\streamline
risk-tier: T1
owner: codex-worker
claim-token: 83135df676d655a3
state: done
approval: null
workflow: 01a04122-bfb5-7421-897a-9bda2801bffb
depends-on: []
variant-group: null
role: work
session-id: 6a8fa686-cc5edab2
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: ca365d0053d182ebb607431c35a90e2133eaca41
---

## Work order

\# Atlas: reconcile tests/test_runtime.py after X1+X2 merge (coordinator-owned)

cwd = C:\Users\danie\Atlas-worktrees\streamline (branch claude/atlas-streamline, X1+X2 merged). NOT a kb
project: ignore every kb preamble/spin-up/card/ops instruction (no scripts/preamble.py - do NOT stop for
it). You never commit. ASCII only. Tests: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q
--basetemp=.pytest-tmp -p no:cacheprovider`. Current: 530 passed, 1 failed.

The one failure: `tests/test_runtime.py::test_build_registers_count_mail_before_google_connects_and_swaps_in_raw_search`
(JSONDecodeError: Extra data). Cause: X1 changed `count_mail` to issue TWO Gmail queries (whole inbox +
Primary category) and report both; the runtime test's fake still returns a single-query response shape and
asserts the old single count. The production behavior is INTENDED - do not touch `worker/tools.py`.

Task: update ONLY `tests/test_runtime.py` so its fake returns valid responses for both queries and the
assertions match the inbox+Primary contract already tested in `tests/test_tools.py` (mirror those
expectations; keep the test's original purpose: count_mail registered before google connects, raw search
swapped in after). Keep CRLF, ASCII, minimal hunk.

READ BUDGET: `tests/test_runtime.py` (the failing test range only), `grep -n "count_mail" tests/test_tools.py
worker/tools.py` + ranges. Stop at 15 minutes. Exit: full suite 531 passed, `git diff --check`,
`git ls-files --eol tests/test_runtime.py`. Do not commit.

## Result

Updated [tests/test_runtime.py](C:\Users\danie\Atlas-worktrees\streamline\tests\test_runtime.py) only.

- Fake now returns valid inbox and Primary Gmail responses.
- Assertions cover both queries and `"61 in your inbox, 14 in Primary"`.
- Preserved the count-mail registration/raw-search behavior.

Verified:

- Full suite: `531 passed, 1 warning`
- `git diff --check`: passed
- EOL: `i/lf w/crlf`
- No commit made.

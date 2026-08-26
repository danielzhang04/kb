---
schema-version: 1
id: 6a8f5a37-e4cfe8de
project: kb-ops
action: atlas-w3c
target: C:\Users\danie\Atlas-worktrees\v5
risk-tier: T1
owner: codex-worker
claim-token: e9f3e93c205b514e
state: done
approval: null
workflow: 01a03ff6-5f6f-71a2-8f7b-61fe8c59faed
depends-on: []
variant-group: null
role: work
session-id: 6a8f59a8-76a66420
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 80d4fd2e6f295dd056d49dbd3c6a52525f1692bb
---

## Work order

\# Atlas W3c - configure the native window only after it exists

cwd = C:\Users\danie\Atlas-worktrees\v5 (uncommitted W3b tree). NOT a kb project: ignore every kb
preamble/spin-up/card/ops instruction (no scripts/preamble.py - do NOT stop for it). You never commit. Never
launch the app. ASCII only. Tests: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q
--basetemp=.pytest-tmp -p no:cacheprovider`. Baseline: 470 passed.

Boss-verified live root cause (from the new exception logging - good work):
`worker/desktop.py` ~504-513: the `webview.start` callback runs `window.native.Invoke(...)` IMMEDIATELY, but
pywebview assigns `window.native` only when the GUI thread constructs `BrowserForm` (winforms.py: BrowserForm
__init__ sets `pywebview_window.native = self`; `window.events.shown` is set from `Form.Shown`). At callback
time `native` is None -> `AttributeError: 'NoneType' object has no attribute 'Invoke'` -> icon and style both
abort every run.

Fix (TDD): in the start callback, before configuring, wait for the window to exist:
`window.events.shown.wait(timeout=30)` (pywebview events support wait); if it times out or `window.native` is
still None, log ONE bounded warning and continue to `_watch_child` (never block child watching forever).
On success proceed with the existing Invoke(configure) path. Keep the two success INFO logs. Update/extend the
tests: a fake window whose `native` is None until a fake shown-event fires must end configured (icon + style
called once, after the event); the timeout path logs and still reaches `_watch_child`.

READ BUDGET: `worker/desktop.py` lines 480-530 + the two configure functions; `tests/test_desktop.py` targeted
ranges; `grep -n "shown" C:\Users\danie\Atlas\.venv\Lib\site-packages\webview\window.py` + <= 20-line ranges.
Stop at 25 minutes. Exit: focused `tests/test_desktop.py`, full suite (>= 470), `git diff --check`.
Final message: the diff (short), red-on-revert evidence. Do not commit.

## Result

Implemented W3c without launching or committing.

- [worker/desktop.py](C:/Users/danie/Atlas-worktrees/v5/worker/desktop.py:504): waits up to 30 seconds for `window.events.shown`; missing native window logs one bounded warning, then continues to `_watch_child`.
- [tests/test_desktop.py](C:/Users/danie/Atlas-worktrees/v5/tests/test_desktop.py:526): covers delayed native creation and timeout behavior.

Verification:

- Red-on-revert: both new tests failed against the old callback.
- Focused: `67 passed`.
- Full suite: `471 passed, 1 existing warning`.
- `git diff --check`: passed; only Git LF-to-CRLF notices.
- Adversarial review: child watching remains reachable on timeout, missing native state, wait exceptions, and configuration exceptions. Success INFO logging remains intact.

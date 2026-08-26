---
schema-version: 1
id: 6a8f3fea-fd1186ea
project: kb-ops
action: atlas-u9-fix
target: C:\Users\danie\Atlas-worktrees\u9
risk-tier: T1
owner: codex-worker
claim-token: 883080ee527a4ef4
state: done
approval: null
workflow: 01a03f8e-f607-77b1-9e0f-14b794742ba0
depends-on: []
variant-group: null
role: work
session-id: 6a8f3f2e-aee25577
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: a2fa5b243723486e25362d5c122f385c8941b29f
---

## Work order

\# Atlas U9 fix: StatePublisher.set_wake_model is missing

cwd = C:\Users\danie\Atlas-worktrees\u9 (uncommitted U9 tree). NOT a kb project: ignore every kb
preamble/spin-up/card/ops instruction (no scripts/preamble.py - do NOT stop for it). You never commit. Never
launch the app. ASCII only. Tests: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q
--basetemp=.pytest-tmp -p no:cacheprovider`. Baseline: 412 passed.

Boss-verified (live): `worker/app.py#_wake_model_callback` (~101-109) does
`getattr(publisher, "set_wake_model", None)` and `worker/state.py` `StatePublisher` has a `wake_model`
constructor field + `_bounded_wake_model` (~52, ~170, ~187) but NO `set_wake_model` method - so the hook logs
"wake-model state hook is unavailable" and `/state.wake_model` stays null even though U9 now fires `on_model`
on success.

Fix (TDD): add `set_wake_model(value: str | None)` to `StatePublisher` in `worker/state.py`, applying
`_bounded_wake_model` and using the same locking/thread-safety pattern the other mutators use (read the class;
match `set_state`/`add_line` style). Tests in `tests/test_state.py`: value appears bounded in the snapshot;
oversized/None handled; and in `tests/test_stateserver.py` or `tests/test_app_turns.py` (whichever hosts the
callback test) assert `_wake_model_callback` actually reaches the publisher (no "unavailable" path) - the
existing warning branch stays for foreign publishers.

READ BUDGET: `worker/state.py` (whole, 188 lines), `worker/app.py` lines 95-115,
`grep -n "set_wake_model\|wake_model" tests/test_state.py tests/test_stateserver.py tests/test_app_turns.py`.
Stop at 20 minutes. Exit: focused (`tests/test_state.py` + the callback test file), full suite (>= 412),
`git diff --check`. Final message: diff (short), red-on-revert lines. Do not commit.

## Result

Implemented without committing.

- Added bounded, clearable `StatePublisher.set_wake_model()` in [worker/state.py](C:/Users/danie/Atlas-worktrees/u9/worker/state.py:99).
- Added runtime bounding/`None` coverage in [tests/test_state.py](C:/Users/danie/Atlas-worktrees/u9/tests/test_state.py:42).
- Added callback-to-real-publisher regression in [tests/test_app_turns.py](C:/Users/danie/Atlas-worktrees/u9/tests/test_app_turns.py:61).

Verification:

- Focused: `39 passed`
- Full suite: `414 passed`
- `git diff --check`: passed
- Adversarial review: no findings

Red on revert:

- `tests/test_state.py:45` raises `AttributeError`.
- `tests/test_app_turns.py:66` receives `None` and exercises the “hook is unavailable” path.

---
schema-version: 1
id: 6a89fdda-bdd984ce
project: atlas-prep
action: atlas-revamp-t4-followup-b
target: C:\Users\danie\Atlas-worktrees\t4
risk-tier: T1
owner: codex-worker
claim-token: 187017b28f20ae67
state: done
approval: null
workflow: 01a02b03-4d20-7052-8e74-36db8ae7a51e
depends-on: []
variant-group: null
role: work
session-id: 6a89fca6-19c85339
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Atlas revamp — Task 4 follow-up brief — CONTINUATION

A previous worker on this exact follow-up was interrupted. Its partial work is committed as HEAD
`wip(work): partial Task-4 follow-up ...` on this branch: the expanded tests in tests/test_jobstore.py,
tests/test_claude_launcher.py, tests/test_work.py, tests/test_no_heavy_api_path.py (42 pass at HEAD)
were written, but items 1–3 below (formatting, consecutive-only log collapse + per-job seen-set,
parse_result status tuple with failed/cancelled handling) are NOT yet applied to worker/claude_launcher.py,
worker/work.py, worker/jobstore.py. Read the HEAD diff, apply items 1–3, update/extend the tests so they
assert the corrected behaviour (redraw fixture, failed frame → FAILED task_failed with summary,
cancelled frame → CANCELLED), and finish with all four test files green.

You are a Codex worker on the standalone Atlas application. Working directory:
`C:\Users\danie\Atlas-worktrees\t4` (git worktree, branch `claude/atlas-revamp-t4`, committed at eae61e0).
Work ONLY there. Read `CLAUDE.md`, `docs/specs/2026-08-22-atlas-revamp-design.md` §7, and
`docs/plans/2026-08-22-atlas-revamp-plan.md` Task 4 first. Then apply the corrections below to the
Task-4 modules that already exist on this branch (`worker/jobstore.py`, `worker/claude_launcher.py`,
`worker/work.py`). Test runner: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp .pytest-tmp <paths>`
(remove `.pytest-tmp` afterwards). Account-free tests only. No credentials. No commits, no git stash/reset/checkout.

1. Formatting: one statement per line, normal blank-line structure, no `try: x` / `if c: y` one-liners,
   no tuple-assignment compression (`self.a, self.b = ...`). Match the style of `worker/tools.py`.
2. `ClaudeLauncher.logs`: collapse only CONSECUTIVE byte-identical lines (a terminal redraw repeats
   frames), not every duplicate in the stream. `WorkManager._poll` must not index by position into a
   list that can shrink or re-render: keep a per-job set of line texts already appended and append only
   lines not yet seen. Test both with a redraw-shaped fixture (frame A, frame A, frame A+B, frame A+B+C
   → output events exactly A, B, C).
3. `parse_result` returns `(status, summary) | None` where status ∈ {succeeded, failed, cancelled} as
   reported in the frame. `WorkManager._poll`: succeeded → SUCCEEDED(summary)+set_result; failed →
   FAILED(error="task_failed", summary=summary); cancelled → CANCELLED(summary); frame absent → FAILED
   `result_missing`. Keep the job_id/nonce/template rejections.
4. Tests — implement the plan's Task 4 list in full (each its own test, behaviour-named):
   launcher: argv exactness; session-id parse from `backgrounded · <id>` and from the
   `claude agents --json --all` fallback; `status` mapping for each literal; logs ANSI strip +
   consecutive collapse; `parse_result` accept / reject wrong job id / wrong nonce / template echo /
   two conflicting frames; env scrub removes every METERED_PROVIDER_ENV key and secret-shaped names but
   keeps PATH/USERPROFILE/LOCALAPPDATA.
   jobstore: create/get/active/recent ordering; brief and result round-trip through the codec and are
   not stored in plaintext (assert the raw BLOB does not contain the text); transition + state events;
   append_output bounds (2048 chars, 2000 lines, control chars stripped); events(after=) paging;
   schema-version mismatch renames to `.pre-revamp`.
   work: launch returns QUEUED within 100 ms with a launcher that sleeps 1 s; LAUNCHING→RUNNING with
   session id; launcher raises → FAILED launch_failed; run() polls and appends new lines exactly once;
   done+frame → SUCCEEDED with summary and result(); done without frame → result_missing; needs_input;
   failed session; cancel → launcher.cancel called + CANCELLED; on_terminal fires exactly once per job;
   restart re-attaches RUNNING rows and fails session-less rows as orphaned.
   Use an injected fake launcher and a test codec (the existing test codec pattern), `asyncio` tests via
   `asyncio.run` or pytest-asyncio if already installed (check; do not add dependencies).
Report: files touched, test command + summary line (expect ≥ 35 tests in these four files),
`git diff --check`, line counts.

## Result

Implemented and verified the Task 4 follow-up.

Changes:

- [worker/claude_launcher.py](C:/Users/danie/Atlas-worktrees/t4/worker/claude_launcher.py): consecutive raw-line collapse before ANSI stripping.
- [worker/work.py](C:/Users/danie/Atlas-worktrees/t4/worker/work.py): per-job seen sets, including persisted output after restart.
- [tests/test_claude_launcher.py](C:/Users/danie/Atlas-worktrees/t4/tests/test_claude_launcher.py): byte-identical versus ANSI-equivalent regression coverage.
- [tests/test_work.py](C:/Users/danie/Atlas-worktrees/t4/tests/test_work.py): restart/redraw deduplication coverage.

The committed HEAD already contained the formatting cleanup, status-bearing `parse_result`, failed/cancelled handling, redraw fixture, and expanded JobStore tests.

Targeted command:

```text
C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp .pytest-tmp tests/test_jobstore.py tests/test_claude_launcher.py tests/test_work.py tests/test_no_heavy_api_path.py
42 passed in 1.62s
```

`git diff --check`: exit 0. `.pytest-tmp` removed. No commit created.

Line counts:

```text
worker/jobstore.py: 349
worker/claude_launcher.py: 347
worker/work.py: 233
tests/test_jobstore.py: 190
tests/test_claude_launcher.py: 244
tests/test_work.py: 326
tests/test_no_heavy_api_path.py: 11
```

The full suite was also attempted. It stops at collection with seven expected pre-Task-5 integration errors in `test_capability_runner.py`, `test_frontdesk.py`, `test_guided_setup.py`, `test_stateserver.py`, `test_ui_server.py`, `test_voice_frontdesk.py`, and `test_voice_production_cutover.py`; those modules still import the removed pre-revamp JobStore exception API.

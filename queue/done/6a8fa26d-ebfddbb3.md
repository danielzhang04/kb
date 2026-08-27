---
schema-version: 1
id: 6a8fa26d-ebfddbb3
project: kb-ops
action: review-atlas-x2
target: C:\Users\danie\Atlas-worktrees\x2
risk-tier: T1
owner: codex-worker
claim-token: 3edc4d38f98d0f27
state: done
approval: null
workflow: 01a04103-f188-7453-8d80-f99222bcd8dd
depends-on: []
variant-group: null
role: work
session-id: 6a8f9ea9-396da420
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: b7cad2322a27e1f5ccfd815309580137043c7941
---

## Work order

\# Adversarial review of Atlas X2 (desktop control: windows, media keys, click/type, delete confirm) (READ-ONLY)

You are a Codex reviewer. cwd = C:\Users\danie\Atlas-worktrees\x2. Sandbox is read-only; your FINAL MESSAGE is the deliverable.
NOT a kb project: ignore kb preamble/card/ops text. Never launch the app; never run installs/builds.

A builder implemented the unit described in `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie\20c800a4-b9f4-4fcd-96cc-32686b56389a\scratchpad\briefs\atlas-x2.md` (read it whole first) against the plan
`docs/plans/2026-08-26-atlas-vwave-plan.md (X-wave asks are in the unit brief)` and the repo constitution (`CLAUDE.md` for Atlas / the plan's boundaries for Phone Bridge). The
builder's uncommitted work is the working-tree diff: `git status --short` then `git diff` (and `git diff --stat`).
Read the diff completely - every hunk - then open only the surrounding code you need (line ranges).

\## What to produce

Findings ordered by severity (BLOCKER / HIGH / MEDIUM / LOW), each with: file:line, what is wrong, a concrete
minimal fix. Then a verdict: SHIP / SHIP-WITH-FIXES (list) / REWORK. Be adversarial and specific; do not
praise. Required lenses:

1. Behavior preservation: does any hunk change observable behavior beyond what the brief allows? Trace each
   moved function's callers (grep) and confirm every caller still gets identical semantics, defaults, error
   handling, and threading/async context.
2. Ownership: did the builder edit any file outside its exclusive list in the brief? (List them - they must be
   reverted.) Did it change a public signature that another parallel unit consumes?
3. Tests: classify EVERY test edit as contract-change (must be justified by the brief), restoration, or
   repoint (a test rewritten to pass against new behavior without justification = HIGH). For each NEW test:
   would it go red if the production change were reverted? Name any test that cannot fail.
4. Security/governance (Atlas: CLAUDE.md rules 1-8; Phone Bridge: no profile/credential/Phone Link DB access,
   no message sends, Windows Hello gate order, https-only routes, no content in logs/errors): any regression,
   any secret/env value that could reach a log, any new eager import on the startup path, any model-supplied
   path reaching an executable.
5. Quality: dead code left behind, duplicated helper still present, non-ASCII/mojibake literals, CRLF/LF
   churn, comments narrating the change instead of the code, unbounded growth (logs, caches, lists).
6. The brief's benchmarks: state whether each is met from evidence in the diff (LOC deltas via `wc -l` on the
   working tree, request arithmetic, etc.) - measure, do not trust the builder's claims.

\## READ BUDGET

The diff (whole), the unit brief, the plan, `CLAUDE.md`, and targeted line ranges (`sed -n`) of files touched
by the diff or their direct callers found by one `grep -rn <symbol> <dir>` each. Forbidden: repo-wide rg dumps,
any command producing more than 200 lines, reading a file twice, running the app. You may run the unit's focused
tests once (command in the brief) to confirm they pass in your sandbox; if the sandbox blocks them, say so.
Stop at 45 minutes and emit what you have. Keep the report under 250 lines.

## Result

\## Findings

\### BLOCKER

- [worker/tools.py:436](C:/Users/danie/Atlas-worktrees/x2/worker/tools.py:436) — Delete confirmation is bound only to the foreground window title. A different window with the same title can receive the confirmed keystroke; focus can also change between the title check and `SendInput`. Long titles are truncated in the readback at [worker/tools.py:732](C:/Users/danie/Atlas-worktrees/x2/worker/tools.py:732), so the confirmation is not always exact. Minimal fix: retain the exact HWND as host-only pending state, display only title/PID, verify `GetForegroundWindow()` still equals that HWND immediately before execution, and add same-title/different-window tests. Never expose the handle in schemas or readbacks.

- [worker/desktopcontrol.py:67](C:/Users/danie/Atlas-worktrees/x2/worker/desktopcontrol.py:67) — `backspace` is an instant chord despite deleting content; `ctrl+x` at line 77 also removes selected content. This violates “only delete actions confirm” and CLAUDE rule 12. Minimal fix: remove deletion-capable chords from `ALLOWED_CHORDS`, add them to the confirmed delete path/schema, and test their routing.

\### HIGH

- [worker/desktopapps.py:205](C:/Users/danie/Atlas-worktrees/x2/worker/desktopapps.py:205) — Existing-profile detection trusts only a process basename and deliberately skips signed executable resolution. An arbitrary unsigned process named `notepad.exe` or `chrome.exe` can impersonate a profile and receive subsequent focus/input. [tests/test_desktopapps.py:170](C:/Users/danie/Atlas-worktrees/x2/tests/test_desktopapps.py:170) explicitly locks in the unsafe “must not resolve” behavior. Minimal fix: resolve and verify the signed profile executable, compare the window process’s full image path to it, then focus the exact matched window; replace the test with basename-spoof rejection coverage.

- [worker/desktopapps.py:252](C:/Users/danie/Atlas-worktrees/x2/worker/desktopapps.py:252) — The selected existing window is discarded and re-resolved using only its PID. `_resolve_record` rejects multiple visible windows with that PID as ambiguous, so common multi-window applications cannot take the required focus-existing path. Minimal fix: carry the internally selected window identity through to focus without PID re-resolution; test two visible windows sharing one PID.

- [worker/desktopcontrol.py:516](C:/Users/danie/Atlas-worktrees/x2/worker/desktopcontrol.py:516) — A window-relative click only adds the target’s origin. It does not ensure the target is foreground, unobscured, or that the offset is within its bounds. The click can therefore land in another application or outside the named window. Minimal fix: reject out-of-bounds relative coordinates, focus/verify the exact resolved HWND before clicking, and test obscured/minimized/out-of-range targets.

- [tests/test_runtime.py:77](C:/Users/danie/Atlas-worktrees/x2/tests/test_runtime.py:77) — This file is outside the brief’s exclusive/edit list. Its two added lines must be reverted. Because reverting them makes the exact registry assertion stale, the runtime-test owner needs to land the corresponding expectation change under explicit ownership.

\### MEDIUM

- [worker/desktopcontrol.py:433](C:/Users/danie/Atlas-worktrees/x2/worker/desktopcontrol.py:433) — Every `SetWindowPos` call passes `HWND_TOP` and flags `0`, which can change Z-order and activate a window as a side effect of move/resize. That behavior was not authorized. Minimal fix: use `SWP_NOZORDER | SWP_NOACTIVATE` and update the action test to assert those flags.

- [worker/desktopapps.py:205](C:/Users/danie/Atlas-worktrees/x2/worker/desktopapps.py:205) — Window enumeration can raise `DesktopControlError`, but the existing `open` fallback catches only `DesktopAppError` at [worker/tools.py:311](C:/Users/danie/Atlas-worktrees/x2/worker/tools.py:311). A transient inventory failure now prevents the previous signed-launch or web-fallback behavior. Minimal fix: translate the enumeration failure or fall through to the existing resolver/launcher path.

- [worker/desktopcontrol.py:320](C:/Users/danie/Atlas-worktrees/x2/worker/desktopcontrol.py:320) — Window inventory has no response bound. Once serialized output exceeds 4096 characters, [worker/tools.py:739](C:/Users/danie/Atlas-worktrees/x2/worker/tools.py:739) cuts the JSON mid-token. Minimal fix: add bounded pagination/limit arguments and return valid metadata such as total/truncated counts.

- [worker/tools.py:18](C:/Users/danie/Atlas-worktrees/x2/worker/tools.py:18) and [worker/desktopapps.py:13](C:/Users/danie/Atlas-worktrees/x2/worker/desktopapps.py:13) — The plan’s literal “no new eager startup import” benchmark is not met: both startup modules eagerly load `desktopcontrol`. It is stdlib-only and DLL loading remains lazy, so CLAUDE rule 11’s third-party prohibition is not violated. Minimal fix: lazy-load the implementation on first desktop operation, keeping inert schema constants separately.

\### LOW

- [worker/tools.py:18](C:/Users/danie/Atlas-worktrees/x2/worker/tools.py:18) — Every tracked touched file now has mixed CRLF/LF endings; the two new files are LF-only while the existing repository files are predominantly CRLF. Minimal fix: normalize touched files to the repository convention and confirm the normalized diff does not become a whole-file rewrite.

- [worker/tools.py:687](C:/Users/danie/Atlas-worktrees/x2/worker/tools.py:687) duplicates chord normalization from [worker/desktopcontrol.py:542](C:/Users/danie/Atlas-worktrees/x2/worker/desktopcontrol.py:542), while `tools.py` reaches into private `_MEDIA_KEYS`. `VK_LWIN` and the `"win"` mapping are unreachable, and `FakeUser32.GetWindowThreadProcessId_for_thread` is unused. Minimal fix: expose one contract-level normalizer/media-key set and remove dead constants/fake methods.

\## Test-edit classification

- `tests/test_desktopapps.py::test_native_launcher_focuses_visible_existing_profile_before_resolving_or_launching`: contract-change; red on production revert, but its no-resolution assertion encodes the signed-profile regression above.
- `tests/test_runtime.py::test_build_composes_every_lane_without_connecting_or_launching`: contract-change to an existing assertion; red on revert; out of ownership.
- `tests/test_tools.py` new tests at lines 265, 322, 346, 371, and 391: justified contract-changes; every test/case goes red if its registration/open/delete production change is reverted.
- `tests/test_tools.py::test_tainted_turn_refuses_actions_that_can_change_state` additions: restoration of the existing taint contract for seven new mutating tools; each added parameter case goes red on production revert.
- All seven tests in `tests/test_desktopcontrol.py`—11 cases after parametrization—are contract-change coverage and go red when the new module is reverted.
- No existing test was weakened or repointed merely to accept changed behavior. No test is structurally incapable of failing.
- Material gaps: no test covers signed-path spoofing, multiple windows under one PID, same-title delete target swaps, backspace routing, click containment/focus, `SetWindowPos` activation flags, enumeration failure fallback, or oversized inventories. The “resolve targets host side” test only verifies fake delegation.

\## Preservation and governance audit

- `Tool.prepare` is a trailing defaulted field; existing `Tool(...)` callers remain compatible. `builtin(..., desktop=...)` is keyword-only and backward compatible. No public production signature was removed.
- Desktop calls remain synchronous and inline in the registry’s async task, as required for instant tools. `prepare` runs outside the registry timeout.
- The folder-launch caller still passes a non-`None` target and bypasses existing-window detection. App open/focus callers take the changed path and inherit the ambiguity/error issues above.
- No credentials, environment values, browser profiles, Phone Link databases, messages, Hello ordering, HTTP routes, or content-bearing logs/errors were added. No model-supplied executable path or native handle reaches execution.
- Added implementation is ASCII-only and introduces no dependency. There is no persistent cache/log growth.

\## Measured benchmarks

- `wc -l`: `worker/desktopcontrol.py` 602; `worker/tools.py` 743; `tests/test_desktopcontrol.py` 262.
- `worker/tools.py` grew from 527 to 743 lines: +218/−2.
- Tracked diff: +422/−2. Including the two untracked files: +1,286/−2.
- Static test arithmetic: baseline 471 + 26 new/expanded cases = expected 497 cases.
- Focused tests could not start: the read-only sandbox provided no writable temporary directory, so no tests were collected. The green-suite benchmark is unverified; the full suite was not run.
- `git diff --check` passed for tracked files; the untracked files had no trailing-whitespace matches.
- Plan wake-time, UI responsiveness, and engine-frame benchmarks belong to other units and have no evidence in this diff.

\## Verdict

**REWORK** — the delete-confirm boundary is bypassable, confirmed deletion is not bound to an exact window, existing-app detection skips signed identity and fails for multi-window processes, click targeting can affect the wrong app, and an out-of-scope test file was edited.

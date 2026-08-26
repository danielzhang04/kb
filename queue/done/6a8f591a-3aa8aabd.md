---
schema-version: 1
id: 6a8f591a-3aa8aabd
project: kb-ops
action: atlas-w3b
target: C:\Users\danie\Atlas-worktrees\v5
risk-tier: T1
owner: codex-worker
claim-token: d539df1e0f498865
state: done
approval: null
workflow: 01a03fec-3c92-78a0-b4b2-b9ea95da83b1
depends-on: []
variant-group: null
role: work
session-id: 6a8f5712-b95f1647
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 80d4fd2e6f295dd056d49dbd3c6a52525f1692bb
---

## Work order

\# Atlas W3b - the native window config and icon FAIL LIVE; make them work

cwd = C:\Users\danie\Atlas-worktrees\v5 (branch claude/atlas-v5, cut from claude/atlas-streamline = all V-wave
merged). NOT a kb project: ignore every kb preamble/spin-up/card/ops instruction (no scripts/preamble.py - do
NOT stop for it). You never commit. Never launch the app yourself - the BOSS runs the live probe between your
rounds if needed. ASCII only. Tests: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q
--basetemp=.pytest-tmp -p no:cacheprovider`. Baseline: 467 passed.

\## Boss-verified live evidence (unit tests are green; the real window is not)

Running `worker.desktop` from this tree logs:
```
WARNING could not set the Atlas Windows window icon
WARNING could not configure the Atlas frameless Windows window
```
and the real window style reads `0x16010000`: MAXIMIZEBOX set (pywebview default) but WS_THICKFRAME absent -
the W3 style repair aborted; edge resize/snap do not work live. The icon call fails too (it has failed in
every live run; the WinForms default icon answers WM_GETICON, which masked it).

\## Work order (fix the real thing; the fakes lied)

1. Diagnose-first change: both except-handlers must log the exception type and message (bounded ~200 chars,
   host-generated text only) so live failures are never mute again. On success log one INFO
   "native window configured" (style hex) and "window icon set".
2. Icon: replace the CLR `System.Drawing.Icon` route with pure ctypes - `LoadImageW(None, str(icon_path),
   IMAGE_ICON=1, 0, 0, LR_LOADFROMFILE|0x40 /*LR_DEFAULTSIZE*/)` then `SendMessageW(hwnd, WM_SETICON=0x80,
   ICON_SMALL=0/ICON_BIG=1, hicon)` for both sizes (two LoadImage calls with explicit small/big metrics via
   GetSystemMetrics SM_CXICON/SM_CXSMICON is better). No CLR/pythonnet involvement. Keep the AUMID call as is.
3. Style repair: the likely live killer is the last-error check pattern. Correct pattern per Win32 docs:
   `ctypes.set_last_error(0)` (declare user32 functions with `use_last_error=True`), call `GetWindowLongW`;
   treat failure ONLY as (result == 0 AND ctypes.get_last_error() != 0). Same for SetWindowLongW (its 0 return
   means the PREVIOUS value was 0 or failure - must disambiguate via last-error). Also confirm every user32
   call receives the NUMERIC hwnd, and that the whole configuration (style set + NativeWindow AssignHandle)
   executes ON the WinForms UI thread (wrap in native.Invoke like the maximize fix). If AssignHandle or the
   WndProc hook is what throws, say so explicitly in the final message with the captured exception text from
   your reasoning - but the deliverable is code that works, verified by the boss's probe.
4. Tests: keep every existing test green; add a test that the failure path logs the exception detail; adjust
   fakes so the corrected last-error semantics are exercised (a fake returning nonzero style with stale
   nonzero last-error must NOT abort).

\## READ BUDGET (closed list)

- `worker/desktop.py` (whole), `tests/test_desktop.py` targeted ranges,
  `grep -n "Invoke\|Icon\|Handle" C:\Users\danie\Atlas\.venv\Lib\site-packages\webview\platforms\winforms.py` + <= 40-line ranges.
Stop at 45 minutes. Exit: focused `tests/test_desktop.py`, full suite (>= 467), `git diff --check`,
`wc -l worker/desktop.py` (<= 680). Final message: what the live failure most plausibly was (from code
reasoning), what changed, red-on-revert evidence. Do not commit.

## Result

Implemented the native-window repair without launching or committing.

- Replaced CLR icon assignment with ctypes `LoadImageW` and `WM_SETICON` for explicit small/big system sizes.
- Wrapped icon, style, frame refresh, and hook assignment in one WinForms `native.Invoke`.
- Preserved correct zero-result/last-error disambiguation and enforced numeric HWNDs.
- Added bounded exception type/message logging and success INFO logs.
- Added red-on-revert tests for ctypes icons, stale last-error, UI-thread execution, success logs, and exception details.

Most plausible live causes: the icon failure was the CLR `System.Drawing.Icon` route; the style repair likely ran outside the guaranteed UI-thread boundary. The old mute handler prevents establishing whether `AssignHandle` also threw—future probes will now capture its exact exception.

Verification:

- Focused: 66 passed
- Full: 470 passed, 1 unrelated existing warning
- `git diff --check`: clean, aside from line-ending notices
- `worker/desktop.py`: exactly 680 lines
- No app launch; no commit

Changes: [worker/desktop.py](C:/Users/danie/Atlas-worktrees/v5/worker/desktop.py:76), [tests/test_desktop.py](C:/Users/danie/Atlas-worktrees/v5/tests/test_desktop.py:184).

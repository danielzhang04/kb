---
schema-version: 1
id: 6a8b4774-eba3baae
project: atlas-prep
action: atlas-titlebar
target: C:\Users\danie\Atlas-worktrees\titlebar
risk-tier: T1
owner: codex-worker
claim-token: 71d11552f5a563dd
state: done
approval: null
workflow: 01a02fd0-7118-7661-a475-24c803fbb4a4
depends-on: []
variant-group: null
role: work
session-id: 6a8b3762-516fc25c
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Atlas — frameless window: fold OS title bar into our own top bar

You are a Codex worker on the standalone Atlas application. Working directory:
`C:\Users\danie\Atlas-worktrees\titlebar` (branch `claude/atlas-titlebar`, from the deployed HEAD). Work ONLY there.
Touch only `worker/desktop.py`, `ui/index.html`, `ui/styles.css`, `ui/app.js`, `tests/test_desktop.py`. Read
`CLAUDE.md`, then `worker/desktop.py` (esp. `run()` and its `window_factory`/`confirm_close`/`closing` wiring) and
the current `ui/*`.

Problem: `webview.create_window("Atlas", …)` in `desktop.py:437` is NOT frameless, so Windows draws its own grey
title bar (default script icon top-left, minimize/maximize/close top-right) ABOVE Atlas's own 40 px `.topbar`. Two
stacked bars, the OS one blank and ugly. Make Atlas a single custom title bar.

Facts (verified against the installed pywebview 6.x):
- `create_window` accepts `frameless`, `easy_drag`, `js_api`, `resizable`, `confirm_close`. Window objects have
  `.minimize()`, `.restore()`, `.toggle_fullscreen()`, `.destroy()`, `.maximize` may not exist — use `restore`/a
  size toggle if needed; DO NOT rely on a `maximize()` method without checking `hasattr`.
- With `frameless=True`, elements whose class is `pywebview-drag-region` are draggable (pywebview's default
  `drag_selector`); use `easy_drag=False` so ONLY that region drags (not the whole body).
- A `js_api` object's public methods are callable from the page as `window.pywebview.api.<name>()` returning a
  Promise.

Implement:
1. `desktop.py`: create the window with `frameless=True, easy_drag=False, resizable=True`, and a `js_api` instance
   (a small class defined in `desktop.py`) exposing:
   - `minimize()` → the window's `.minimize()`.
   - `toggle_maximize()` → track a bool; when maximizing, remember current size/pos and `resize()`+`move()` to the
     work area (use `webview.screens[0]` for the work area if available, else the window's current screen), when
     restoring, resize/move back. If a reliable maximize is not achievable, expose only minimize + close and drop
     the maximize button (say so in the report).
   - `request_close()` → run the SAME graceful path the window-close does today (the `closing`/`_confirm_close_current`
     → `/shutdown` → terminate flow). Do not bypass the active-jobs confirm. The cleanest wiring: have `request_close`
     call `window.destroy()` (which fires the existing `closing` handler), OR factor the current close logic into a
     function both the `closing` event and `request_close` call. Keep exactly one implementation.
   The window is created after `js_api`; bind the window into the js_api instance right after creation (attribute set)
   so its methods can reach it. Keep the exit-21 restart, Job Object, single-instance, stopped/reconnecting pages,
   and `ATLAS_UI` handshake unchanged.
2. `ui/index.html` + `ui/styles.css`: the existing `.topbar` (40 px) becomes the drag region — add class
   `pywebview-drag-region` to it. Add a window-controls group on the far right (after the connection dot): buttons
   `minimize`, `maximize` (if kept), `close`, each `type=button`, with `aria-label`s and the class
   `no-drag` styled `-webkit-app-region: no-drag`-equivalent (in pywebview, buttons inside the drag region still get
   mousedown; to keep them clickable, give them their own class and, in app.js, `stopPropagation` on their
   mousedown so the drag handler ignores them — OR rely on `drag_region_direct_target_only`; simplest: mark buttons
   so their `mousedown` calls `event.stopPropagation()`). Draw the icons as inline SVG (a minus; a square; an X),
   ~12 px, stroke `currentColor`; hover backgrounds subtle, the close button hover red `#e5484d`. Keep the brand
   mark + "Atlas" left and the connection dot; the bar stays 40 px and the Atlas palette (neutral chrome + purple).
   Double-clicking the drag region toggles maximize (call the same api).
3. `ui/app.js`: wire the three buttons to `window.pywebview.api.minimize()/toggle_maximize()/request_close()`
   guarded by `window.pywebview?.api` (in a plain browser — `worker.ui_server` / tests — the buttons are simply
   inert or hidden; detect absence of `window.pywebview` and add a `no-native` class to the controls so they hide,
   so the browser-only command center is unaffected). Add the button `mousedown` → `stopPropagation` so dragging
   the bar never triggers a button.
4. `tests/test_desktop.py`: the fake `window_factory` now receives `frameless`, `easy_drag`, `js_api` kwargs —
   update it to accept/ignore them and assert `frameless is True`; add a test that the js_api `request_close` runs
   the graceful close (reuse the existing close-path fakes), and that `minimize` calls the window's minimize. Keep
   every existing desktop test green.

Norms: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp .pytest-tb-tmp`
(full suite; delete the temp dir); `node --check ui/app.js`; `git diff --check`; account-free tests (no real window);
one statement per line; no dead information; no commits; no git stash/reset/checkout.
Report: files changed, suite summary, node check, and whether maximize was kept or dropped and why.

## Result

Implemented the single frameless Atlas title bar.

Changed:

- [worker/desktop.py](C:\Users\danie\Atlas-worktrees\titlebar\worker\desktop.py): frameless window, native control API, graceful close reuse, custom maximize/restore.
- [ui/index.html](C:\Users\danie\Atlas-worktrees\titlebar\ui\index.html): draggable top bar and SVG window controls.
- [ui/styles.css](C:\Users\danie\Atlas-worktrees\titlebar\ui\styles.css): native control styling and drag exclusions.
- [ui/app.js](C:\Users\danie\Atlas-worktrees\titlebar\ui\app.js): native API wiring, browser-only hiding, double-click maximize.
- [tests/test_desktop.py](C:\Users\danie\Atlas-worktrees\titlebar\tests\test_desktop.py): frameless, minimize, graceful close, and maximize/restore coverage.

Validation:

- Full suite: `383 passed`, one existing Pydantic warning.
- `node --check ui/app.js`: passed.
- `git diff --check`: passed.
- Pytest temp directory removed.
- Only the five authorized files changed.

Maximize was kept. It uses `resize()` and `move()` with pywebview’s Windows working-area rectangle, restores saved bounds, and does not rely on `window.maximize()`.

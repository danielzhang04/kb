---
schema-version: 1
id: 6a8fdd7d-e8051eaa
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\AppData\Local\kb-codex-dispatch\worktrees\6a8fda98-33c4336e
risk-tier: T1
owner: codex-worker
claim-token: 9a500607becc5b01
state: done
approval: null
workflow: 01a041ee-17c1-7b13-9ebb-589bafd6b109
depends-on: []
variant-group: null
role: work
session-id: 6a8fda98-33c4336e
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 9a52d101de44d19cc9f6686c3f18b8f48ab244f0
---

## Work order

\# Codex build brief — U8: sidebar manual-only + true content responsiveness + rail Inbox badge

Repo: kb. Branch base: `claude/dashboard-v3` (tip 9a52d101, has U1–U6). Dispatched with `--worktree`; build there, do NOT commit (orchestrator harvests). Work in `dashboard/src/` ONLY. NOTE: the worktree has NO node_modules — you CANNOT run tsc/vitest/build and MUST NOT attempt a network install; self-review + `git diff --check`, the orchestrator verifies. Presentation/layout only — no routes/behavior/wire changes.

Daniel's feedback on the U2 responsive work: "(a) the page wasn't really adapting to the window size correctly. (b) the side panel should be able to open and shrink [manually], shouldn't auto shrink [and shouldn't auto-shrink on the Terminal view]. (c) when shrunk, the Inbox [nav item] is weird — it should still depict the icon with a little corner number [badge]."

\## A. Sidebar is MANUAL-ONLY (remove all auto-shrink)
In `src/App.tsx` (AppShell + Sidebar), U2 made the rail auto-engage. Undo the automatic behavior, KEEP the manual toggle:
- `App.tsx:222` `const [rail, setRail] = useState(view === 'terminal')` → default `false` (do NOT auto-rail when the Terminal view is active).
- `App.tsx:226` `viewportForcesRail = useMediaQuery(NARROW_VIEWPORT_QUERY)` and `:231` `railMode = rail || viewportForcesRail` → the sidebar rails ONLY from the user's toggle. Make `railMode = rail`. Remove the viewport-forced-rail path (and `NARROW_VIEWPORT_QUERY`/the `useMediaQuery` call if now unused — but keep `useMediaQuery` if other code uses it; grep first).
- `railForced` (passed to Sidebar, `:154/:158`, used at `:166` `hidden={railForced}`) is now always false → the collapse/expand toggle is ALWAYS visible and usable. Remove the `railForced` prop/plumbing or hard-false it cleanly.
- Net: the user opens/shrinks the sidebar with the toggle; nothing shrinks it automatically — not on narrow windows, not on the Terminal view.
- The tests U2 added for forced-rail/manual-state (`App.test.tsx`, the appTokens/rail coverage) MUST be updated to the new manual-only contract — remove the viewport-forces-rail assertions, keep/adjust the manual-toggle ones. Update deliberately; say what changed. Do NOT delete coverage wholesale.

\## B. Content adapts to window size correctly (the real fix)
The CONTENT must reflow fluidly at every width with the sidebar in EITHER state — no horizontal page scroll ever. The shell grid is `.app-shell` in `src/styles/app.css` (~`:410`, `grid-template-columns: var(--sidebar-w) 1fr`, `.mc-main` has `min-width:0`).
- Make the card grids continuously fluid: the entity/agent/workflow card grid (`.entity-card-grid` / `entity-card-groups--grid` in `src/styles/views/entity.css`) should use `grid-template-columns: repeat(auto-fill, minmax(<~260px>, 1fr))` so columns adapt to available width instead of a fixed count — verify no fixed pixel widths on cards force overflow.
- Audit for any element with a fixed/min width that overflows when the content area is narrow (tables `.mc-table`, the workflow/agents detail drawer, search inputs). Tables scroll inside their own `overflow-x:auto` container; the PAGE body must not scroll horizontally.
- Keep the U2 single-column breakpoint behavior for genuinely narrow widths, but the primary mechanism should be fluid (auto-fill) not breakpoint-stepped. Test the flow at 1440 / 1200 / 1000 / 820 / 640 with the sidebar BOTH expanded (220px) and railed (48px): content reflows, nothing clipped, no horizontal page scroll.

\## C. Rail Inbox badge (icon + corner number)
When the sidebar is railed (icon-only), each nav item shows only its icon and the text label is hidden. The Inbox (and Agents/Workflows) badges carry a pending COUNT (`badges` prop, `App.tsx:160,174`; rendered in `NavItem` — locate it, likely near the Sidebar). In rail mode the count currently reads wrong/disappears.
- In rail mode, render the count as a SMALL CORNER BADGE overlaid on the icon (top-right superscript bubble with the number), so a collapsed Inbox still shows "there are N pending" at a glance. Full (expanded) mode keeps the current inline label+badge.
- Do it in `NavItem` + the sidebar rail CSS (`.mc-sidebar`/`.mc-nav` rules in `app.css`). Keep it accessible: the aria-label/title should still convey "Inbox, N pending" in both modes. Only show the corner badge when count > 0.

\## Norms
- Strip-only TS floor: NO enum/namespace/constructor param-properties; no raw NUL. `git diff --check` clean.
- Do NOT touch `dashboard/server/`, do NOT change the U2 FONT tokens or the other views' content. Layout/shell/nav + the card-grid fluidity only.

\## Deliverable (final message)
Files+lines changed; confirm the sidebar is manual-only (no viewport/terminal auto-rail, toggle always live); the fluid-grid mechanism used; how the rail corner badge renders + its aria; which App.test/token assertions you updated and why; `git diff --check` clean. Orchestrator verifies tsc/tests/build + screenshots at multiple widths × both sidebar states.

## Result

Implemented U8 within `dashboard/src/` only.

- [App.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fda98-33c4336e/dashboard/src/App.tsx:85): sidebar now defaults expanded and changes only through its always-visible toggle. Viewport, Terminal navigation, and popstate no longer alter rail state.
- [app.css](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fda98-33c4336e/dashboard/src/styles/app.css:415): shell tracks use shrinkable `minmax(0, 1fr)` content; narrow CSS no longer forces a 48px rail. Rail counts render as small superscript icon badges around line 615.
- [entity.css](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fda98-33c4336e/dashboard/src/styles/views/entity.css:438): drawer/search containers shrink safely; card grids use `repeat(auto-fill, minmax(260px, 1fr))`, retaining the narrow single-column breakpoint.
- [App.test.tsx](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fda98-33c4336e/dashboard/src/App.test.tsx:119): replaced forced viewport/Terminal assertions with manual-state coverage across navigation and popstate; added expanded-versus-corner badge assertions.
- [appTokens.test.ts](C:/Users/danie/AppData/Local/kb-codex-dispatch/worktrees/6a8fda98-33c4336e/dashboard/src/styles/appTokens.test.ts:68): now pins both manual shell widths and the shrinkable content track.

Badged nav buttons expose labels such as `Inbox, 1 pending` through both `aria-label` and `title`; corner badges appear only for positive counts.

`git diff --check`, scope, and raw-NUL checks are clean. Per the brief, tsc/Vitest/build were not attempted because dependencies are absent.

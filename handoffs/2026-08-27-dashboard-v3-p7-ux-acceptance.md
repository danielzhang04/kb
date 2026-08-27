# Handoff — dashboard-v3 P7 UX-acceptance (4 rounds), 2026-08-27

## Status
`claude/dashboard-v3` @ **`7cf3401d`** — UNMERGED (194 commits ahead of `origin/main`). All build phases
(P0–P6) + the streamline + **four rounds of Daniel's hands-on UX acceptance** are done, green, and
opus-reviewed. Daniel has been walking a **local dev sandbox** and giving round-by-round feedback;
he's happy with the current state ("Great"). NEXT is his call: keep walking, or **merge → deploy to
the VM** (where real agent/workflow testing happens).

## What P7 delivered (14 UX units over 4 feedback rounds, base `a2fa5b24`→`7cf3401d`)
- **R1 U1–U6:** U1 Agents `/api/agents` 500 fix (one projectless agent no longer kills the roster);
  U2 design system (clean system sans, retreated titles, spacing tokens, first responsive story);
  U3 Agents/Workflows grid-only + removed the stray dashed `.code-view` border; U4 workflow detail
  = plain summary + Advanced-expander, entity-builder explains the curate model; U5 Tasks click-out
  fix + human-first rows; U6 Home graceful "No deployed release detected."
- **R2 U8:** sidebar manual-only (killed viewport/Terminal auto-rail), truly fluid content
  (auto-fill grids, no h-overflow), rail Inbox corner badge.
- **R3 U9/U10/U11:** **U9 merged Tasks INTO one sectioned "needs you" Inbox** (Approvals/cards +
  Deploys + PRs + Asset-pulls; card actions inline; age labels via card file-mtime; **Tasks removed
  from nav → NINE destinations**; deep links canonicalize to Inbox). U10 spacing + shared
  `EntityBrief` component + Details-tab-shows-directly. U11 Run button "Not activated" for
  non-runner-bound agents (was raw `agent-not-launchable`).
- **R4 U12/U13/U14:** U12 copy pass (Home "Needs you" → one "{n} things need you" → Inbox line; risk
  tiers → Low/Medium/High plain words, code kept in data/audit; de-jargoned Card#/Owner-Unassigned/
  PTY/artifacts/section-subtitles). U13 Terminal content gutter + search-box padding. U14 Home+Inbox
  full content width (dropped the 1120px cap to match the grid views).

Each unit: codex-deep/terra build → harvest to `dv3-gate` → tsc+suite+build verify → Playwright
screenshot → commit. U9 (the architectural merge) got a dedicated opus review = **U9-MERGE-CLEAN**.
Full Linux gate on the R3 tip: 4854 passed, only the 2 known singleton load-flakes red.

## PENDING — Daniel's call, NOT built (raised during the walk)
1. **Grader/hygiene run panels** — RunDetail shows only the raw stream today; dedicated panels are a
   real feature, deferred.
2. **Files whitelist width** — Files shows `docs/orgs/queue/ledgers/memory/dashboards/handoffs`
   (`server/kb/browser.ts:29`), intentionally hiding `dashboard/`+code. Widen if he wants.
3. **VM↔desktop terminal bridge** — terminals are separate hosts today; a bridge is unscoped.
4. **A visible "execution armed/locked" indicator** — the arming machinery runs but
   `<ExecutionUnlock>` (the status readout) is mounted by NO view; small gap, offered.
5. **Workflow summary literal `#`** — the workflow purpose shows a leading markdown `#`; minor polish.
6. If Home/Inbox full-width feels too wide on his big monitor, restore a generous cap (U14 reversal).

## Why nothing runs locally (answered for Daniel)
Deploy-then-run. On a Windows desktop sandbox: no host advertises placement (`hostAdvertisements` is
empty; the advertisement-sender daemon isn't wired in the dashboard package), so **every** launch
409s `no-complete-placement`; the FYT agents also aren't `runner-bound`; `pty:false` so Terminal is
"unavailable" (a separate gate). Execution DOES auto-arm on sign-in. Real agent/workflow testing
needs the VM (Linux host advertising placement + agents flipped runner-bound).

## The local dev sandbox (how to resume the walk)
- Served from the **`dv3-gate` worktree** (`C:/Users/danie/kb-worktrees/dv3-gate`), NOT the main
  checkout (main's `node_modules` is incomplete — no vitest/tsc; ALWAYS verify + build + serve from
  `dv3-gate`).
- **Relaunch (detached, survives harness reaping — plain `&`/run_in_background get killed):**
  ```
  # PowerShell, from a clean dv3-gate at the branch tip, after `npm run build`:
  $env:DASHBOARD_SESSION_SECRET="kb-local-dev-p7walk-secret"; $env:DASHBOARD_DEV_ORIGIN="http://127.0.0.1:4319";
  $env:DASHBOARD_STATE_ROOT="<a temp dir>"; $env:DASHBOARD_REPO_ROOT="C:\Users\danie\kb"; $env:DASHBOARD_PORT="4319";
  Start-Process node -ArgumentList "server/index.ts" -WorkingDirectory "C:\Users\danie\kb-worktrees\dv3-gate\dashboard" -WindowStyle Hidden
  ```
  (An isolated `DASHBOARD_STATE_ROOT` is REQUIRED so it doesn't fight the live local control-plane
  daemon's writer lease.)
- **Auto-unlock:** win32-desktop mode wants a passkey. The sandbox's served `dist/index.html` has an
  injected classic `<script>` (before the app module) that seeds `sessionStorage['kb-dashboard-session-v1']`
  + the `kb_session` cookie with an operator token → the page loads already unlocked, every tab.
  **`npm run build` regenerates index.html and wipes it — RE-INJECT after every build.** Token
  (72h from mint, `mintSession('operator', …)` with the secret above) currently valid through
  ~2026-08-30; mint a fresh one via `server/auth/session.ts#mintSession` if expired. Also needs
  `DASHBOARD_DEV_ORIGIN` set or every route 403s `no-allowlist`.
- If the sandbox is down, currently detached at pid varies (last: 59268) — just relaunch per above.

## Load list (read on resume)
- `memory/dashboard-v3-arc.md` (PRIMARY resume point — full arc history + this P7 wave)
- `docs/plans/2026-08-26-vm-runtime-streamline-design.md` (streamline spec, underneath P7)
- This handoff
- The R4 analysis of confusing lines / arming chain is in the session transcript (Explore agents
  a065ab15/a2e3ca8f) if the copy decisions need revisiting.

## Merge/deploy when Daniel says go
`claude/dashboard-v3` → main is a BIG merge (P0–P6 + streamline + P7). Then VM deploy per the
cloud-migration/vm-movement recipes; the VM runs tailnet-trust (no sign-in — none of the local
unlock friction). Real agent/workflow acceptance happens there.

# Dashboard UX overhaul — design (2026-08-04)

Daniel-approved direction, brainstormed 2026-08-04. Goal: the dashboard reads as a calm
operator surface — one unlock, human names instead of IDs, one Workflows surface instead of
Runs/cockpit/canvas, digestible panels, and a measurably smaller codebase.

Branch: `claude/dashboard-ux-overhaul` (worktree `kb-worktrees/boss-dashboard-ux`), based on
`claude/headless-roster` @ae8a80c — the thin-slice terminal's platform tip (headless
execution T1–T6; supersedes `claude/fyt-paid-wiring`, which it contains). Acceptance daemon =
the isolated 4620 launcher (`start-headless-daemon.mjs`), repointed to this worktree during
implementation. Build = Claude subagents (haiku/sonnet/opus by stakes, model verified at
grading via transcript grep); boss verifies every unit. NOT codex dispatch this arc
(Daniel's 2026-08-04 override).

Live-UI evidence (4620 walkthrough, 2026-08-04): SIX distinct unlock surfaces visible
(sidebar "Unlock dashboard", Home "Sign in to inspect execution state", Home "Sign in to
launch or rerun cards", Run Canvas full-page sign-in banner, Runs "Unlock cockpit", Inbox
"Unlock run requests"). Nav carries Workflows AND Runs AND Run Canvas. Inbox renders raw
card IDs as primary text with the human name demoted to small grey. Workflows list keys rows
on file paths with an overflowing governance-chip column and zero run info. 8 runs sit
parked (6 waiting-human, 2 failed) — all stale thin-slice validation attempts whose open
"asks" are TUI-era boot failures the headless rework already obsoleted.

## 1. Single unlock

One WebAuthn session for the entire platform. A `SessionContext` at App level owns the
session (mint, storage, expiry, 401-invalidation via `SESSION_INVALIDATED_EVENT`) and
exposes `session` + `requireSession()` (auto-prompts the passkey ceremony when locked).

- Top bar: small lock chip — locked/unlocked state + expiry; clicking it unlocks.
- Any governed action while locked triggers the same single prompt; after mint, every
  surface is unlocked until expiry.
- DELETE: `ManagedRuns` "Unlock cockpit" button, all per-view unlock branches/copy, and
  the `onRequestSession`/`sessionToken` prop-drilling through App → views → panels.
  Existing point-of-action flows (ApprovalsLive, Workflows launch, Composer) switch to the
  context; no second unlock path survives.

## 2. Naming layer (server-owned, Option A)

Humans see titles + short ordinals; backends keep real IDs.

- New server module `dashboard/server/naming.ts`: append-only ordinal registry per entity
  type (card, run, workflow, agent, task) persisted in the daemon state root. First time an
  ID is projected it gets the next ordinal; ordinals never change or get reused.
- Display title derived from the entity's own data (card title, workflow name, run =
  workflow name + ordinal, agent name, task title) — no new authored metadata.
- Existing list/detail endpoints embed `displayName` + `shortRef` in their DTOs. No new
  endpoint.
- Client: one `EntityName` component (title + `#n`; full ID behind tooltip + copy). All
  views stop rendering raw IDs, file paths, hashes, branch refs in primary UI — those
  demote to a detail disclosure ("Technical" fold) or tooltip.

## 3. Workflows unification

One surface for definitions + their executions. The platform's two parallel vocabularies —
control plane (proposals/runs/stages/attempts, cockpit) and queue (cards, DAG) — collapse to
ONE presented concept: a workflow and its runs. Cards/stages are implementation detail
behind the technical fold.

- Nav: `pipeline` ("Runs") AND the Run Canvas destinations REMOVED. `DestinationId`, App
  body switch, palette, and entity links updated — no redirect stubs. One "Workflows" entry.
- Workflows tab: informative list — name, project, status of latest run, live-run indicator,
  last-run outcome/time. No file paths, no governance-chip dump.
- Workflow detail: each workflow shows live + past runs. Runs not born from a definition
  appear under one catch-all group ("Ad-hoc").
- Launch: ONE button on the workflow. The pre-launch manager-assignment ceremony (governor
  dropdown, amendment phases, "enter all required parameters" wall) dies. Per-agent
  assignment/model is edited inline on the graph node ("per-agent fix on the graph");
  launch uses what the graph shows.
- The workflow graph replaces the "agent handoff network" jargon panel: agent nodes with
  plain-language handoff edges, editable assignment/model per node, no dead canvas space.
  Stage/agent copy de-jargoned throughout.
- Run detail (Run Canvas content absorbed): per-agent live stream tiles + two-way operator
  messaging (T4/T5 machinery), the run's own card DAG inline (scoped projection — the
  whole-queue canvas dies), de-jargoned per §2.
- `ManagedRuns` wrapper, `RunGrid`, cockpit-vs-graph split all collapse into this surface.
  `RetentionPanel` survives only if the bloat sweep proves it earns its place.

### 3b. Waiting-on-human runs

- Every run in `waiting-human` renders a plain-language ask (what happened, what you can
  do) — never raw error text or tracebacks as the prompt.
- Add an archive/dismiss action for dead runs and their open requests (T3-audited write);
  parked runs stop haunting every list forever.
- At implementation validation: archive the 8 stale thin-slice validation runs (6
  waiting-human, 2 failed) whose asks are obsolete TUI-era boot failures; root-cause any
  ask that survives (e.g. canonical-result identity mismatch) before archiving it.

## 4. Agents

- "Work with this agent" → **"Run agent"**. Spawns the agent for interactive use: PTY
  terminal (Terminal view) primed with the agent's binding/prompt files, with a toggle
  agent-primed ↔ plain claude. If implementation shows headless spawn + attach is cleaner,
  that substitution is allowed — criterion: Daniel types to the agent within one click.
- Composer-workspace link removed from Agents/AgentDetail.
- Agents list + detail become digestible: name, role, model, current run, last activity.
  IDs/paths per §2.

## 5. Inbox

- Remove the "Select an item…" placeholder pane; empty selection renders nothing beyond
  the list.
- Inbox = pure live projection of queue card state (SSE-refreshed): when ANY writer
  (kb-platform agent, terminal, VS Code session) moves a card out of a needs-human state,
  the item disappears on its own. Any dashboard-side resolution bookkeeping that can
  disagree with queue truth is deleted.

## 6. Stop floor

- `SessionStopFloor` deleted from the sidebar (App.tsx + app.css floor block).
- `StopControls` moves inside the Sentinel view. Session/lock state lives in the top-bar
  chip (§1). Sidebar ends at the nav sections.

## 7. Visual polish

Core five surfaces: Home, Workflows, Agents, Tasks, Inbox. Within the locked near-black
direction plus ONE muted accent color — 2–3 swatch options presented to Daniel as a gate
during implementation before any accent lands. Typography hierarchy, spacing, card
layouts, empty states, status-dot consistency, hover/transition feel. Density stays
(Linear-like calm, not airy).

## 8. Adversarial bloat sweep

A first-class workstream, not a cleanup afterthought:

- Adversarial pass over `dashboard/src` + `dashboard/server`: dead/hanging files, unused
  exports, redundant components, duplicated logic, oversized files, stale docs/comments.
- Output: evidence-backed cut list (per item: what, why dead, proof — grep/import-graph).
  Boss gates the list (Daniel sees anything load-bearing); then deletions execute.
- Includes everything §§1–6 orphan (Pipeline canvas, ManagedRuns wrapper, unlock plumbing,
  Composer-from-Agents path, stop-floor CSS).
- Named fix: static serving (`server/static/routes.ts`) registers asset routes only from
  the dist present at boot (`wildcard: false`), so any rebuild 404s the UI until a daemon
  restart — serve `/assets/*` from disk at request time.
- Base is `claude/headless-roster`, which already contains `claude/fyt-paid-wiring` — no
  cross-branch constraint remains; the T6 deletion (−6,362 lines) already cleared the TUI
  roster layer, so the sweep targets what's left.
- Success: measurable LOC/file-count reduction, reported before/after.

## Testing & verification

- Existing vitest suites updated in place with each logic change; tests for deleted paths
  are deleted, never left skipped. No appended test files for moved logic.
- Each unit: tests green + live check against the local daemon; boss grades with model
  verification before acceptance.
- Final acceptance: Daniel walks the five surfaces — one unlock, no raw IDs in primary UI,
  one Workflows surface, inbox auto-clears, no stop floor.

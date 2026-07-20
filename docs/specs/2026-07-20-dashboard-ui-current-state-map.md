# Dashboard client UI — current-state map (2026-07-20)

Produced by a read-only Opus explorer sweep for arc-3 (Daniel's runs/workflows/agents UI mandate).
This is the INPUT to the redesign. Everything below was verified against the code in
`kb-worktrees/fleet-arc` (branch `claude/fleet-arc`).

## Stack

| Aspect | Reality |
|---|---|
| Framework | React 19.2 + Vite 8 + TS 7 |
| Router | **NONE.** Hand-rolled `useState<DestinationId>` switch in `src/App.tsx:500`, `ViewBody` switch `App.tsx:405-478`. No URL, no deep links, no history. Deliberate (`App.tsx:7-9`). |
| State | **NONE.** Local `useState` per view, each self-fetches. One shared cache: `src/flyout/useFleetData.ts`. |
| Live | SSE tick counter only (`src/lib/sseClient.ts` `useSse('/events')`); views refetch on tick. **ManagedRuns is NOT SSE-wired** — manual Refresh (`ManagedRuns.tsx:230`). |
| Styling | Hand-written CSS, no modules/Tailwind. Tokens `src/styles/app.css` (`:root` + `[data-theme=light]`); per-view `src/styles/views/*.css`; control plane `src/control/control.css`. |
| Theme | `src/lib/theme.ts`, `localStorage['mc-theme']`, `[data-theme]`. |
| Tests | Vitest + testing-library, colocated `*.test.tsx`, per-file `// @vitest-environment jsdom` (global env is node). Convention: **inject data via optional props to suppress self-fetch**; assert via `data-testid`/`aria-label`. |

## Surface 1 — Runs (route id `pipeline`, label "Runs")

Files: `src/views/Pipeline.tsx` (shell), `src/control/ManagedRuns.tsx` (list+actions),
`src/control/RunCockpit.tsx` (detail), `src/control/RetentionPanel.tsx`,
`src/control/controlClient.ts` (all `/api/control/*` DTOs).

Layout = vertical stack, NOT a board: h2 + lede → ManagedRuns (a horizontal `<nav>` of run buttons
showing only title, mono runRef, state, "N needs you") → selected run's RunCockpit below →
collapsed-by-default `<details>` legacy React Flow DAG of QUEUE CARDS (a separate data source).

RunCockpit shows: runRef, title, proposalRevision, proposalHash **truncated to 12 chars**
(`:97`), manager generation/session/runtime/model/state, an `<ol>` of stages (title, state,
canonicalCardRef, `attempt N · runtime · model`, reroute inputs), open Human Requests, flat `<ol>`
of events.

**Key truncations:** `RunCockpit.tsx:51-53` `eventText()` = `summary ?? command ?? toolName ??
path ?? checkpoint ?? kind` — **`event.diff` is never in the chain, arrives in the client and is
discarded**. `ManagedRuns.tsx:61` `listRunEvents(runRef, 0, 500)` hardcoded, no pagination/tailing.
Event rows show no `createdAt`/`stageRef`/`attemptRef`. Only `stage.currentAttemptRef` is read
(`:149`) so the whole attempt chain in `detail.attempts` is invisible.

Click-through: ManagedRuns buttons select in place. The ONLY navigation is in the collapsed legacy
DAG (`onOpenCard` → `App.tsx:594` → Tasks).

## Surface 2 — Workflows

`src/views/Workflows.tsx`. Two dense `<table>`s of DEFINITIONS (not instances): registry artifacts
from `GET /api/registry`, and org defs from `GET /api/workflows` (title+path, profile, inline `<ul>`
of every stage as `action → target` + tier, valid dot, Launch).

Unrendered: `WorkflowDefEntry.detail` only as a `title=` tooltip (`:302`, invisible);
definition-level `riskTier` in the DTO (`:38`) never rendered. **Launch returns a `runRef` shown as
inert text — not a link into Runs.**

**Relation to Runs: fully separate.** No shared components, no shared client module, no navigation.
Only three prose strings point the operator at Runs (`:182`, `:194`, `:313`).

## Surface 3 — Agents

`src/views/Agents.tsx` — a full-width TABLE (the "sidebar" is just the nav destination + hover
flyout). 8 columns: status dot + mono id, role, binding chips, "Doing" (action + card id), project
chips, card count, last-active, governed `RoutingControl`. Plus a routing-audit strip.

**Detail view: NONE.** No row is clickable, no drawer, no per-agent page. This is exactly what
Daniel asked for.

Records come from `dashboard/server/agents/roster.ts` `buildRoster` (`:262-306`) — a FIVE-source
union: queue-card owners, ledger writers (`ledgers/<kind>/<writer>-<date>.tsv`), role catalog
`routines/roles/*.md`, **C7 registry `agents/<id>.md` YAML frontmatter** (`:205-241`, symlink-
refusing, 64KB cap, fail-open), routing projection. `DeclaredAgent` = id, role, runtime, model,
runnerBound, description (`:121-128`).

> **`agents/` does not exist in this worktree** — `readDeclaredAgents` fails open to empty, so every
> row currently renders `observed` / `no runner`. Populating it is a prerequisite for a good detail view.

Fetched-but-unrendered agent fields: `description` (the one-line definition!), `declaredModel`,
`ledger.{dispatches,steps,days}`, `sources` provenance. No tools, no history, **no join anywhere
between an agent and the control-plane sessions it runs.**

## Surface 4 — the inventory: exists server-side, not rendered

**Live terminal.** `/api/pty` WS + `views/Terminal.tsx` is the one fully-realized streaming surface.
`server/pty/persistentSessions.ts:9-26,152,195` keeps a bounded scrollback ring (buffers while
detached, replay-then-flush on attach) — replayed into xterm but never exposed as readable
history/export. `GET /api/pty/sessions` is consumed headlessly by `lib/terminalClient.ts`; the
operator never sees "3 shells running".
**BIGGEST STRUCTURAL GAP: managed runs have NO raw stream route.** Broker
`ManagedSessionAdapter.start(...).onEvent` (`control/broker.ts:16-21`) yields normalized events
only; RunCockpit is poll-only. A live terminal for a run requires new server work.

**Per-attempt transcripts.** `claudeWorkerAdapter.ts:9-10,32-34` collects the full stream-json
transcript per attempt (64MB cap, 4000-char stderr tail) but only `boundSummary(...)` at 60k chars
survives into the result. **The transcript is never persisted and no route exposes it.**

**Diffs / code history.** `OperationalEvent.diff` (`control/types.ts:194`) IS persisted, IS returned
by `/api/control/runs/:runRef/events`, IS typed in `controlClient.ts:207` — and is **never
rendered**. `WorktreeAdapter.inspect()` returns `changed: {path,digest}[]` (`execution.ts:51-56`)
with no read route. `ProposalDiffDto` + `src/control/ProposalDiff.tsx` render structured diffs
already — but are reachable ONLY via Composer, not from Runs.

**Checkpoints.** `OperationalEvent.checkpoint` + public `{kind,name,state: reached|released|blocked}`
reachable; rendered as an undifferentiated fallback string so **the state is lost**.
`ProposalStageDto.checkpoints[{id,label}]` gives the valid names, yet RunCockpit makes the operator
**type the checkpoint into a free-text input** (`RunCockpit.tsx:137`). Durable
`StoredSteeringInstruction` queue (`store.ts:168-173`) has **no read route** — queued steering is
invisible.

**Timing.** `createdAt`/`updatedAt` on EVERY entity (run/stage/attempt/session/humanRequest/event),
all already in the browser. **Not one timestamp is rendered.** A full waterfall needs no new data.

**Model/usage.** `ExecutionUsage {inputTokens, outputTokens, costUsdMicros}` (`execution.ts:24-28`)
is measured per attempt (incl. cache-creation/read) and budget-enforced — but `AccountingAdapter`
(`execution.ts:35-49`) has **no read method, no store field, no route**. Richest fully-invisible
dataset; surfacing it is the one genuine server gap.
**BINDING CONSTRAINT: never surface dollars.** `panels/usage.ts:4-9` deliberately suppresses USD
(only a boolean `usdPresent`); the arc design's hard constraint is "'usage' not 'spend' under
subscription metering". Show steps/tokens.

**Other reachable-but-unrendered:** `Run.predecessorRunRef` (retry lineage), `Run.publicationState`
(5 states), `RunMetadataDto.{stageCount,attemptCount,sessionCount,eventCount}` (fetched in
`listRuns`, **zero of four rendered**), `Stage.dependsOn` (**no dependency graph for managed
runs**), worker sessions (only the manager is looked up), resolved Human Requests (filtered to
`state==='open'` only, `RunCockpit.tsx:198`).

## Binding design rules (do not violate)

`dashboard/docs/design-brief.md` + Daniel's 2026-07-17 override:
- **No decorative accent color.** Terracotta retired; `--accent-*` resolve to a neutral
  white/opacity hierarchy. ALL structural chrome is neutral. **EXCEPTION** (data-encoding only):
  running/ok `#5cae7e`, error/STOP `#e0554a`, warning `#e0a040`, tier T1/T2/T3.
  **No new decorative color.** New taxonomies get shape/label/mono differences, never new hues.
- Dark default pinned `[data-theme=dark]`; light = warm cream. Live values in `src/styles/app.css`
  + `src/lib/theme.ts` are authoritative over the brief's hexes.
- Self-contained (no external fonts/CDNs); hand-written CSS; mono + `tabular-nums` for every
  id/hash/tier/count/timestamp; 4px-atomic spacing, radius 6/8/12.
- **Left-border marker is the single active/selected language everywhere** (§F.3).
- Motion 150-200ms ease-out opacity/transform. No bounce/spring/parallax, no glassmorphism/
  gradients/glow.
- Timeline: dense single column, tool-use rows get a left-border, auto-scroll on tail with freeze +
  "N new" pill on manual scroll-up. Terminal: bg-sunken, mono only, override xterm defaults.

`src/nav/config.ts:8-24` — **locked entity-first IA, SUPERSEDES design-brief §D.** Groups are
UNLABELLED (hairline dividers, Linear pattern); rendering a group label is intentionally impossible
(`NavSection` has no `label` field). Order: `Home · Inbox · Activity · Atlas(soon) · Terminal` /
`Workflows · Runs · Agents · Tasks · Projects · Files` / `Connectors · Ledgers · Sentinel` /
pinned Session+STOP floor. A new destination = one `NAV_SECTIONS` entry + one `App.tsx` case.

`docs/specs/2026-07-16-dashboard-design.md` — Option B "Hybrid Workbench": calm no-code board for
the 90%, terminal+editor as escape hatch for the 10%. Git stays the database; **the dashboard is a
projection, never a second brain.**

## Three highest-leverage conclusions for arc-3

1. **Runs already receives everything needed for a rich detail view in the browser** — full attempt
   chains, every timestamp, per-event diffs, checkpoint states, `dependsOn`, four rollup counts —
   and renders ~20% of it via a flat `<ol>` and a lossy `eventText()`. **The largest win needs NO
   new endpoint.** This is where Daniel's "click a card, see details/terminal/code history" mostly
   lands.
2. **Token/usage telemetry is the one genuinely missing read path** (AccountingAdapter). Needs
   server work; must render as steps/tokens, never dollars.
3. **Runs, Workflows and Agents share no components and no navigation.** A launch returns an inert
   `runRef`; an agent row cannot reach its session; ManagedRuns cannot reach the DAG below it. The
   entity-first IA is locked in the sidebar but not reflected in cross-entity linking — **that is
   the structural gap the redesign should close**, and it is exactly what Daniel described.

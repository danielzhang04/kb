# arc-3 UI design — entity detail, horizontal runs, cross-entity linking (2026-07-20)

Design only. No component code. Input: `docs/specs/2026-07-20-dashboard-ui-current-state-map.md`
(re-verified against the code in `kb-worktrees/fleet-arc`, branch `claude/fleet-arc`; two
corrections/additions to the map are called out inline).

Scope of ownership for the build: `dashboard/src/**` only, plus one server addition in §7 that is
explicitly handed to whoever owns `dashboard/server/execution/**`.

---

## 0. Are workflows and runs the same thing?

**No — but they are two views of one pipeline, and they must share one detail surface.**

A WORKFLOW is a reusable *definition*. A RUN is one *execution instance*. The relationship is 1:N,
and the thing they share is the `kb.plan-proposal/v1` wire shape.

Evidence:

- `dashboard/server/workflows/compile.ts:74` — `compileWorkflowDef(def, env)` takes a `WorkflowDef`
  and returns a `PlanProposal`. The file header states the intent outright: the output is
  "deliberately the SAME wire shape the reviewed proposal machinery already admits, so a launched
  definition reuses the proposal → approval → launch → canonical-cards path instead of a second
  executor."
- `compile.ts:38-57` — `deriveProposalId(def)` is a pure function of definition content
  (`wf-<sha256[0:48]>`). The same definition always compiles to the same proposal identity. That is
  template semantics, not instance semantics.
- `dashboard/server/workflows/routes.ts:150-224` — `launchDefinition` compiles → validates →
  `createProposalRevision` → approves → `executeApprovedLaunch` → returns a `runRef`. A workflow
  does not execute; it *produces a proposal*, and the proposal produces a run.
- `routes.ts:173-181` — a launch explicitly **reuses** the already-approved revision when the
  definition content hash is unchanged. One definition, many launches, many runs.
- Runs are not exclusive to workflows: `launchProposalRevision` (`controlClient.ts:373`) is also
  reached from ad-hoc Composer proposals. So a run is an instance of *any* proposal, not only of a
  workflow.

So the correct model:

```
WorkflowDef (file, reusable)  ──compile──▶  PlanProposal ──launch──▶  Run (instance)
Composer idea (ad hoc)        ──import──▶  PlanProposal ──launch──▶  Run (instance)
```

**Design consequence.** They are distinct entities and keep distinct nav destinations (the IA is
locked anyway). But a workflow's detail and a run's detail render the *same proposal structure* —
stages, `dependsOn`, tiers, targets, scope — one as a plan and one as a realized state machine.
That is why they share one detail component with different section sets, and why "workflow → its
runs" is the single most important missing link. Daniel's instinct that they are "pretty much the
same thing" is right about the *surface* and wrong about the *entity*; this design honors both.

---

## 1. The shared entity-detail surface

### 1.1 Component contract

One presentational shell. It owns chrome, tabs, back, and cross-links. It owns no fetching.

```tsx
// src/entity/EntityDetail.tsx
export type EntityKind = 'run' | 'workflow' | 'agent';

export interface EntityRef { kind: EntityKind; id: string }

export interface DetailSection {
  id: string;
  label: string;
  /** Rendered mono + tabular-nums beside the label. Omit when a count is meaningless. */
  count?: number;
  /** Amber dot on the tab when the section needs the operator (open requests, blocked checkpoint). */
  attention?: boolean;
  render: () => React.ReactNode;
}

export interface EntityLink {
  label: string;
  target: NavTarget;          // see §3
  /** Mono id shown after the label, e.g. the runRef being linked to. */
  ref?: string;
}

export interface EntityDetailProps {
  entity: EntityRef;
  eyebrow: string;                 // "Governed run · <runRef>"
  title: string;
  status?: { label: string; tone: 'running' | 'ok' | 'error' | 'warn' | 'idle' };
  /** Header key/value strip. `mono` opts the value into mono + tabular-nums. */
  facts: Array<{ label: string; value: React.ReactNode; mono?: boolean }>;
  sections: DetailSection[];
  links?: EntityLink[];
  /** Controlled so the nav stack can restore the tab on back. Uncontrolled falls back to sections[0]. */
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onNavigate: (target: NavTarget) => void;
  onBack: () => void;
  backLabel: string;               // "All runs", "video-pipeline"
  /** Actions live in the header, not in sections — governed mutations stay one place. */
  actions?: React.ReactNode;
}
```

`render()`-per-section matches the existing tabbed-panel convention already in `App.tsx`
(`{active.render()}` in the Sentinel panel host), so this introduces no new pattern.

### 1.2 Component tree

```
EntityDetail
├── EntityDetail__back        (button, "← {backLabel}")
├── EntityDetail__head
│   ├── eyebrow (mono)  ·  h2 title  ·  StatusDot + status.label
│   ├── FactStrip        <dl>, mono+tabular-nums where flagged
│   ├── LinkRow          EntityLink[] → onNavigate  (§4)
│   └── actions          (governed buttons, passed in)
├── EntityDetail__tabs       underline tab bar, left-border marker on active
└── EntityDetail__body       sections[active].render()
```

Section bodies are separate pure components, each taking its DTO slice as a prop. That is what makes
them testable per the repo convention (§8).

### 1.3 Run sections — field-by-field

The map's central claim is correct and I confirmed it: `RunDetailDto` (`controlClient.ts:186-192`)
already carries `stages`, the **full** `attempts` array, **all** `sessions`, **all** `humanRequests`,
and `listRunEvents` returns `OperationalEventDto` with `diff`, `checkpoint`, `createdAt`, `stageRef`,
`attemptRef`, `sessionRef`, `status`. **Sections 1–6 below need no new endpoint.** Only §7 (Usage)
does.

| Section | Fields made visible (all currently fetched-and-discarded unless noted) |
|---|---|
| **Overview** | `run.proposalHash` **in full** (today sliced to 12 at `RunCockpit.tsx:97`), `predecessorRunRef` (retry lineage → link), `publicationState` (5 states, never rendered), `proposalRef`, `proposalRevision`, `version`, `managerGeneration`, `createdAt`, `updatedAt` |
| **Stages** | per stage: `dependsOn` (**this is the managed-run DAG — never rendered**), `canonicalCardRef` → link, `state`, `version`, `createdAt`/`updatedAt`, and the **full attempt chain** — `detail.attempts.filter(a => a.stageRef === stage.stageRef)`, today only `currentAttemptRef` is read (`RunCockpit.tsx:149`). Each attempt shows `generation`, `predecessorAttemptRef`, `runtime`, `model`, `state`, `managedSessionRef` → link, timestamps |
| **Timeline** | `createdAt`, `kind`, `source`, `status`, `stageRef`/`attemptRef` attribution, and the full `eventText` chain **unflattened** — `summary`, `command`, `toolName`, `path`, and `checkpoint` **with its `{kind,name,state}` parsed** so `reached`/`released`/`blocked` survives (today it collapses to one fallback string) |
| **Changes** | `event.diff` — persisted, typed at `controlClient.ts:207`, arrives in the browser, **never in `eventText()`'s chain, silently dropped**. This is "code history". |
| **Sessions** | **all** sessions incl. workers (today only the manager is looked up, `RunCockpit.tsx:72`): `role`, `generation`, `predecessorSessionRef`, `runtime`, `model`, `state`, timestamps |
| **Requests** | resolved requests too — today filtered to `state==='open'` (`RunCockpit.tsx:198`) — plus `response.{decision,response,respondedAt}` and `revision` |
| **Usage** | `ExecutionUsage` — **the one genuine server gap** (§6). Ships as an honest empty state. |

Two fixes that fall out of rendering the above:

- The steering **checkpoint free-text input** (`RunCockpit.tsx:137`) becomes a `<select>` populated
  from `ProposalStageDto.checkpoints[{id,label}]` (`controlClient.ts:39`). The valid names are
  already in the browser; making the operator type them is a defect.
- `RunMetadataDto.{stageCount, attemptCount, sessionCount, eventCount}` (`controlClient.ts:114-120`)
  are fetched by `listRuns` and **zero of four are rendered**. They become the section tab counts
  and the run-card rollups (§2), so they cost nothing.

### 1.4 Workflow sections

| Section | Fields |
|---|---|
| **Overview** | title, path, project, profile, `riskTier` (in the DTO at `Workflows.tsx:38`, never rendered), `detail` (today only an invisible `title=` tooltip at `:302`), validity |
| **Stages** | compiled stages: `action → target`, `riskTier`, `dependsOn`, `workOrder`, `scope` |
| **Runs** | **new join, §4.2** — every run launched from this definition. This is what makes the launch `runRef` stop being inert text. |
| **Compiled** | `proposalId` (`wf-…`), `contentHash` — both already returned by `GET /api/workflows/:id` via `compiledPreview` (`routes.ts:227-232`) |

### 1.5 Agent sections

| Section | Fields |
|---|---|
| **Overview** | `id`, `role`, **`description`** — the one-line "what this agent exists to do", fetched and never rendered; this is literally Daniel's ask — `declaredRuntime`, `declaredModel`, `runnerBound`, `declared`, and `sources` provenance chips (which of the five roster sources produced this row) |
| **Work** | `current` card (`{action,id}`) → link to Tasks, owned cards, `projects` |
| **Activity** | `ledger.{dispatches, steps, days}`, `lastActive` |
| **Runs** | runs this agent is working, via the derived join in §4.3 |
| **Routing** | existing `RoutingControl`, moved not changed — it stays governed |

> **Prerequisite, from the map and confirmed:** `agents/` does not exist in this worktree, so
> `readDeclaredAgents` fails open and every row is `observed` / `no runner`. The detail view must
> degrade to an explicit "not declared — no `agents/<id>.md`" empty state, never to a blank panel
> that reads as broken. Populating `agents/` is a separate, non-UI prerequisite for this section to
> be worth much.

---

## 2. The horizontal run layout

**The problem is truncation, not density.** Daniel asked to "see the full text of each card". Today
`ManagedRuns.tsx:230` renders a `<nav>` of flex-row buttons that clip. A tighter strip of shorter
buttons would be a worse version of the same defect.

**Solution: a wrapping horizontal grid of run cards. Horizontal *arrangement*, never a horizontal
*scroller*.** Wrapping is precisely what lets every card show its full title.

```css
.run-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 8px;                       /* 4px-atomic */
}
```

Card anatomy — every field already in `RunMetadataDto`, nothing fetched:

```
┌────────────────────────────────────────┐
│▍ Rebuild the faceless video pipeline   │  title, wraps to 3 lines max, NO ellipsis
│  and republish the audio stage         │
│  run-8f2c19ab                          │  mono, tabular-nums
│  ● running · 2 needs you               │  status dot (data hue) · amber when >0
│  6 stages · 11 attempts · 340 events   │  the four rollups, mono tabular-nums
│  updated 4m ago                        │
└────────────────────────────────────────┘
 ▲ 4px left-border marker = selected (§F.3, the single active language)
```

Rules honored: selection is the **left-border marker only** — no fill, no accent, no glow. The only
hues are data-encoding (running green, failed red, needs-you amber, tier chips). All ids, counts and
timestamps are mono + `tabular-nums`.

**Narrow behavior.** `auto-fill` collapses to one column with no media query. Below ~560px the
rollup-counts line is dropped (title, ref, state, needs-you survive). Title never truncates at any
width — that is the requirement. The grid never scrolls sideways.

**Interaction.** A card click pushes the run detail (§3), which replaces the grid in place. The
Refresh button and `RetentionPanel` stay on the list level. `ManagedRuns` is still not SSE-wired
(manual Refresh, per the map); that stays true here and is listed as server-side follow-up in §7.

The legacy collapsed `<details>` React Flow DAG of queue cards below the cockpit is **removed from
this surface**. It is a different data source (queue cards, not managed stages), it confused the two
models, and the managed-run dependency graph it appeared to offer is now rendered honestly from
`Stage.dependsOn` in the Stages section. The queue-card view remains reachable via Tasks, which is
where it belongs, and via the per-stage `canonicalCardRef` link.

---

## 3. Navigation and back, without a router

### 3.1 Decision: no router. Add a nav stack.

There is already a working precedent for cross-view navigation *with a payload* in `App.tsx`:
`openCardId` + `goTo('tasks')` + the `taskSelectedId` prop threaded into `ViewBody`. It is a
hand-rolled, single-purpose version of exactly what arc-3 needs. The design generalizes it rather
than adding a dependency.

```tsx
// src/nav/stack.ts
export type Focus =
  | { kind: 'run'; id: string }
  | { kind: 'workflow'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'card'; id: string };

export interface NavTarget { view: DestinationId; focus?: Focus; section?: string }
export interface NavEntry extends NavTarget { }
```

In `App.tsx`, `useState<DestinationId>` becomes:

```tsx
const [stack, setStack] = useState<NavEntry[]>([{ view: DEFAULT_DESTINATION }]);
const current = stack[stack.length - 1];
const view = current.view;          // every existing read site keeps working
```

Three operations:

| Op | Semantics |
|---|---|
| `goTo(view)` | **Resets** the stack to `[{ view }]`. A sidebar click is a fresh root — no back arrow, no accumulated history. This preserves today's mental model exactly. |
| `push(target)` | Drill in. Back appears. No-op if identical to the top entry (kills double-click dupes). Depth capped at 8; pushing past the cap drops from the bottom. |
| `back()` | Pop one. Disabled/hidden at depth 1. |

`backLabel` is derived from the entry *below* the top: depth-2 in `pipeline` with no focus →
`"All runs"`; a run pushed from a workflow → the workflow's title. The label is resolved by the view
(it holds the data), not by the stack.

Section tabs write back into the top entry via `section`, so `back()` then forward returns the
operator to the tab they were on.

`goTo` keeps its existing Composer-closing behavior. Long-lived overlays (Terminal, Composer) are
unaffected — they are rendered outside the body switch and stay mounted.

### 3.2 Why not react-router — costed honestly

Cost if we adopt it:

- ~12-15 KB gz dependency into a deliberately self-contained app.
- Rewrite `ViewBody`'s switch (`App.tsx:405-478`) into a route tree and the sidebar into `NavLink`s.
- **The real blocker:** `App.tsx` deliberately keeps Terminal mounted across view changes — its own
  comment says navigating away "must not unmount its xterm instances or close their WebSockets".
  A router that owns mount/unmount fights that directly. Keeping Terminal and Composer mounted
  *outside* the router means the router does not actually own the shell, so we would pay the full
  migration cost for partial ownership.
- `App.tsx:7-9` records the routerless choice as deliberate.

Benefit forgone: shareable/bookmarkable URLs and browser back. Neither is a stated arc-3 requirement,
and the dashboard is localhost-only today (remote access is its own future security milestone).

**Verdict: nav stack now (~40 lines, zero deps, solves Daniel's back button completely). Revisit
routing when shareable deep links become a real requirement** — at that point the `NavTarget` type
above is already the URL schema, so the migration is mechanical.

---

## 4. Cross-entity linking

This is the structural gap. Every link below is specified with its join key and whether it needs
server work.

### 4.1 Run → its queue cards — **client only**

`StageDto.canonicalCardRef` is the queue card id. Confirmed by
`server/control/canonicalResultIntegrator.ts:598`, which writes results to
`queue/done/${canonicalCardRef}.md` — the ref is the filename stem, i.e. the card id.
Target: `push({ view: 'tasks', focus: { kind: 'card', id: canonicalCardRef } })`. The Tasks
detail-pane payload path already exists (`openCardId`), so this is a rename onto the stack.

### 4.2 Workflow → its runs — **client only** (this one is a real find)

The map did not identify the join key. It exists and the data is already on the wire:

- `server/workflows/routes.ts:183-188` stamps every workflow-launched proposal revision with
  `sourceComposerRef: 'workflow-registry'` and **`sourceTurnId: def.id`** (the workflow definition id).
- `GET /api/control/proposals` (`server/control/routes.ts:49-57`) sends the store records
  **verbatim** — `return reply.send({ proposals: values })` — so `sourceComposerRef` and
  `sourceTurnId` are already in the browser's response body.
- **The client throws them away.** `normalizedMetadata()` (`controlClient.ts:300-309`) maps only six
  fields and silently drops both. `RawProposalMetadata` (`:285`) already types them.

So the join is:

```
workflowDef.id
  → GET /api/control/proposals?composerRef=workflow-registry
  → revisions where sourceTurnId === def.id        (stop dropping the field)
  → their proposalRef set
  → runs.filter(r => proposalRefs.has(r.proposalRef))   // RunDto.proposalRef, from listRuns
```

**Fix = add two fields to `ProposalRevisionMetadataDto` and `normalizedMetadata`. No server work.**

Secondary corroboration: `RunDto.proposalHash` should equal the workflow's compiled `contentHash`.
Both are sha256 over canonical JSON (`store.ts:526` `proposalSnapshotHash`, `proposal.ts:694`
`proposalContentHash`) but via two different canonicalizers (`canonicalJson` vs `canonicalValue`).
**Use `sourceTurnId` as the authoritative join; treat hash equality as a display-only cross-check and
verify the two canonicalizers agree before relying on it anywhere.**

Launch stops rendering an inert `runRef` string (`Workflows.tsx:136`) and renders a link that pushes
the new run's detail.

### 4.3 Run → its agent, and Agent → its runs — **client only, via cards; the session join needs server work**

Be precise here, because there are two candidate joins and only one is real:

- **Not available:** `AttemptDto`/`ManagedSessionDto` carry `runtime` and `model` but **no agent id**.
  There is no direct agent↔session join in any DTO. The map is right that this is missing.
- **Available:** stage → `canonicalCardRef` → queue card → card `owner` = agent id. The Agents view
  already loads the card index with owners (`AgentRow.current`, `projectsOf`), so both directions are
  computable in the browser today:
  - run → agent: map each stage's card to its owner.
  - agent → runs: the inverse index, agent id → cards → stages → runs.

This is an honest, derived link and it is labeled as such in the UI ("via queue cards"). A true
`agentId` on `ManagedSession` would be better and is listed in §7 as server work — but it is **not**
required to ship the link Daniel asked for.

### 4.4 Run → predecessor run — **client only**

`RunDto.predecessorRunRef` (`controlClient.ts:100`) is fetched and never rendered. Renders as a
"Retried from" link in the Overview fact strip; the successor direction is the inverse scan over
`listRuns`.

### 4.5 Run → its sessions / attempts — **client only**

Intra-detail anchors, not navigation: `attempt.managedSessionRef` → the Sessions section row,
`event.attemptRef`/`stageRef` → the Stages section row. All refs present, none currently rendered.

### 4.6 Link summary

| Link | Join key | Server work? |
|---|---|---|
| workflow → its runs | `sourceTurnId` → `proposalRef` → `run.proposalRef` | **No** (un-drop 2 client fields) |
| run → its workflow | inverse of the above | **No** |
| run → its queue cards | `stage.canonicalCardRef` | **No** |
| run → its agent | card owner via `canonicalCardRef` | **No** |
| agent → its runs | inverse card index | **No** |
| run → predecessor/successor | `run.predecessorRunRef` | **No** |
| run → attempts/sessions | `managedSessionRef`, `stageRef` | **No** |
| agent → its live *sessions* | none exists | **Yes** — needs `agentId` on `ManagedSession` |

---

## 5. The terminal and code-history question — the honest split

Daniel asked to "see the running details/terminal, code history, and such". Here is exactly what
that can and cannot mean.

### 5.1 Deliverable now, with ZERO server work

- **Code history = the diffs.** `OperationalEvent.diff` (`control/types.ts:194`) is persisted,
  returned by `GET /api/control/runs/:runRef/events`, and typed at `controlClient.ts:207`. It is in
  the browser on every load and is dropped on the floor because `eventText()`
  (`RunCockpit.tsx:51-53`) never includes it in its `??` chain. Rendering it in a **Changes** section
  is the single highest value-per-line change in this arc. Presentation reuses the language of the
  existing `src/control/ProposalDiff.tsx`, which today is reachable only from Composer.
- **"Running details" = a real Timeline.** Every field needed for a dense operational trace —
  `createdAt`, `kind`, `source`, `status`, `stageRef`, `attemptRef`, `command`, `toolName`, `path`,
  `checkpoint` — is already on `OperationalEventDto` and is flattened to one string today. Rendered
  in the terminal's visual language (bg-sunken, mono only, tool-use rows get a left-border,
  auto-scroll on tail with freeze + "N new" pill per the brief).
- **Checkpoint states.** `{kind, name, state: reached|released|blocked}` currently collapses to an
  undifferentiated string, losing the state. Parsed and rendered.
- **Full timing.** Every entity carries `createdAt`/`updatedAt`, not one is rendered. A complete
  run waterfall needs no new data.

**Naming rule — do not lie to the operator.** This surface is labeled **"Activity stream"**, never
"Terminal". It is a normalized, redacted operational trace (the existing copy is explicit: "private
reasoning and raw tool payloads are not part of this feed"). Calling it a terminal would promise a
TTY the backend does not have.

### 5.2 NOT deliverable without server work — do not promise any of this

| Want | Why it can't ship client-side |
|---|---|
| **Live terminal for a managed run** | **No raw stream route exists.** The broker's `ManagedSessionAdapter.start(...).onEvent` (`control/broker.ts:16-21`) yields *normalized events only*. `RunCockpit` is poll-only. Needs a new streaming route **and** a raw channel out of the broker. This is the biggest single gap. |
| **Per-attempt transcripts** | `claudeWorkerAdapter.ts:9-10,32-34` collects the full stream-json transcript (64MB cap) but only a 60k-char `boundSummary` survives. **Never persisted, no route.** |
| **Worktree file changes** | `WorktreeAdapter.inspect()` returns `changed:{path,digest}[]` (`execution.ts:51-56`) with **no read route**. |
| **Queued steering visibility** | `StoredSteeringInstruction` (`store.ts:168-173`) has **no read route** — queued steering is invisible after submit. |
| **Live-updating run list** | `ManagedRuns` is not SSE-wired; manual Refresh only. |

The one genuinely live terminal in the product is the PTY shell (`/api/pty` + `views/Terminal.tsx`),
which is a fully-realized streaming surface with bounded scrollback. Runs link *to* Terminal; they do
not pretend to be it. A cheap adjacent win: `GET /api/pty/sessions` is consumed headlessly by
`lib/terminalClient.ts` and the operator never sees "3 shells running" — surfacing that count is
client-only.

---

## 6. Usage telemetry

`ExecutionUsage {inputTokens, outputTokens, costUsdMicros}` (`execution.ts:24-28`) is measured per
attempt (including cache-creation/read) and is budget-enforced, but `AccountingAdapter`
(`execution.ts:35-49`) has **no read method, no store field, and no route**. This is the one genuine
server gap in arc-3 and the richest fully-invisible dataset.

Required (owned by whoever owns `dashboard/server/execution/**` — **not this agent**):
1. a read method on `AccountingAdapter`,
2. a store field persisting usage per attempt,
3. `GET /api/control/runs/:runRef/usage` returning per-attempt and run-total rollups.

**BINDING: never surface dollars.** Render steps and tokens only. `costUsdMicros` must not cross the
wire into the browser at all — strip it server-side, mirroring the existing `panels/usage.ts:4-9`
approach, which deliberately reduces USD to a boolean `usdPresent`. Client-side suppression is not
sufficient; if the number is in the response body it is one devtools tab from being surfaced.

Render: steps, input tokens, output tokens, cache-read, cache-creation — mono + `tabular-nums`, per
attempt and rolled up per run. Until the route exists, the Usage section ships as an explicit
"not yet instrumented" empty state, not a hidden tab.

---

## 7. Build plan

Ordered by value-per-unit-risk. Steps 1–4 need **no server work at all**.

| # | Increment | Independently shippable? |
|---|---|---|
| **1** | **Nav stack + `EntityDetail` shell + horizontal run grid + Run sections Overview/Stages/Timeline/Changes.** This is the mandate's core: horizontal full-text cards, click-through, back button, attempt chains, diffs, timestamps, checkpoint states, `dependsOn`. Also the checkpoint `<select>` fix. | **Yes.** Delivers most of what Daniel asked for on its own. |
| **2** | **Cross-entity links** (§4): un-drop `sourceTurnId`/`sourceComposerRef` in `normalizedMetadata`, workflow→runs, run→workflow, run→cards, run→predecessor, run→agent + agent→runs via the card index. | **Yes.** Each link lands independently; workflow→runs is the highest value. |
| **3** | **Agent detail sections** (Overview/Work/Activity/Runs/Routing), incl. the honest not-declared empty state. Gated on `agents/` being populated to be *useful*, not to *ship*. | **Yes.** |
| **4** | **Workflow detail sections** (Overview/Stages/Runs/Compiled), plus `riskTier` and `detail` finally rendered. | **Yes.** |
| **5** | **Usage** (§6). Blocked on the server read path; UI is a thin table once the route exists. | **Yes**, gated on server. |
| **6** | **Live stream / transcripts / worktree changes / steering queue / SSE for runs** (§5.2). Substantial server work, separate arc. Do not begin before 1–5 land. | Separate arc. |

Remove-as-you-go: the legacy collapsed React Flow queue-card DAG under the cockpit (§2).

## 8. Testing shape

Per the repo convention — Vitest + testing-library, colocated `*.test.tsx`, per-file
`// @vitest-environment jsdom` (global env is node), data injected via **optional props to suppress
self-fetch**, assertions via `data-testid` / `aria-label`.

This design is built for that: `EntityDetail` is purely presentational and every section body is a
pure component over its DTO slice, so each is testable with a literal DTO fixture and no fetch mock.
The nav stack is tested through `App` — `push` → assert detail + back affordance → `back()` → assert
the list and the restored section tab. The run grid is tested by asserting a long title renders in
full (no ellipsis, no clipping) and that the selected card carries the left-border marker class,
which is the actual requirement rather than a proxy for it.

## 9. Binding rules compliance

- **No decorative accent.** Selection everywhere is the left-border marker. The only hues are
  data-encoding: running/ok `#5cae7e`, error `#e0554a`, warning/needs-you `#e0a040`, tier T1/T2/T3.
  New taxonomies (event `kind`, session `role`, `publicationState`) get shape/label/mono differences —
  **no new hues**.
- Mono + `tabular-nums` on every id, hash, ref, tier, count, and timestamp.
- 4px-atomic spacing; radius 6/8/12.
- Motion 150-200ms ease-out opacity/transform on tab and detail transitions. No bounce, spring,
  parallax, glassmorphism, gradient, or glow.
- **Nav IA untouched.** No new `NAV_SECTIONS` entry and no new `App.tsx` case: detail views are
  pushed *within* their existing destination, exactly as Daniel described ("a separate window, still
  inside the agents sidebar, with a back button"). Groups stay unlabelled.
- The dashboard remains a projection over git, never a second brain.

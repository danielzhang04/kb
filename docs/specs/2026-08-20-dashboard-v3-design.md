# Dashboard v3 design

## 1. Purpose and success condition

Dashboard v3 is the operator surface for starting and watching agents and workflows, handling only decisions that require Daniel, and seeing whether the two-host system is healthy. The one-minute success test is: open Home and identify what is running, what needs Daniel, the next three fires, and the live VM version; open Agents or Workflows and recognize every runnable noun from a compact box; open one without losing the list, enter its active run, watch the same live stream that the CLI produces, and resolve its gate there; then open a full-screen terminal on either host. At no point should the operator encounter an all-panels page, proposed schedule, fleet graph, learning-history page, deploy page, run-envelope jargon, or a control that exposes credentials, merge authority, or spending.

## 2. Current state

The shell is a hand-built destination switch, not a router: `dashboard/src/App.tsx#ViewBody` selects a view from `DestinationId`, and `dashboard/src/nav/config.ts#NAV_SECTIONS` defines ordering and grouping. `dashboard/server/index.ts#buildApp` composes the authenticated read and write surfaces; `dashboard/server/http/surface.ts#makeSurfaceContext` owns the shared store, runtime capability set, PTY host, and persistent-session registries. Those composition points remain the owners of navigation and HTTP behavior.

### Current pages

| Current page | Current client and data route | v3 fate |
|---|---|---|
| Home | `views/Home.tsx`; `/api/index`, `/events` | Replace in P2 with the D13 projection. |
| Inbox / Approvals | `views/ApprovalsLive.tsx#ApprovalsLive`; `/api/human-inbox`, `/api/control/runs*`, `/events` | Rename code and destination to Inbox in P1; remove run gates; replace the projection in P4 and add deploy subjects in P5. |
| Activity | `views/Timeline.tsx`; `lib/timelineModel.ts#foldRecords`, timeline SSE | Delete the destination and view in P1. Keep the fold and `server/timeline/stream.ts#streamSession` as the run-stream engine. |
| Atlas | `views/Atlas.tsx`, `components/AtlasMiniOrb.tsx`; `/api/panels/atlas` | Delete page, mini-orb, state hook, route, and tests in P1. A separate Atlas client uses `/api/v1` in P6. |
| Terminal | `views/Terminal.tsx`; WebSocket `/api/pty`, `/api/pty/sessions`, `/api/pty/session-runs*` | Keep mounted behavior, replace the surface and host abstraction in P3. |
| Schedules | `App.tsx#ViewBody` renders `views/agentPlatform/panels/Schedules.panel.tsx#SchedulesBody` directly; `/api/panels/schedules*`, `/api/schedules/edit`, `/api/write/pause-cadence` | Extract to `views/Schedules.tsx` in P1. P2 replaces file-shaped rows with live control-store records and immediate CAS actions. |
| Workflows | `views/Workflows.tsx`, `views/WorkflowDetail.tsx`; `/api/workflows*`, `/api/control/runs*` | Replace in place in P2 with grid/list, slide-in entity page, workflow DAG, and builder. |
| Agents | `views/Agents.tsx`, `views/AgentDetail.tsx`; `/api/agents*`, `/api/index`, `/api/routing` | Replace in place in P2 with grouped grid/list, slide-in entity page, and builder. |
| Tasks | `views/Tasks.tsx`; `/api/index`, routing and card write routes | Keep as queue cards; restyle to the v3 row vocabulary in P1. |
| Projects | `views/Projects.tsx`; `/api/kb/tree` | Keep as orgs; restyle in P1. |
| Files | `views/Browser.tsx`; `/api/kb/*` | Keep as repository files; restyle in P1. |
| Agent Platform | `views/AgentPlatform.tsx`, `views/agentPlatform/registry.ts#collectPanels` | Delete the destination, registry, shell, and all panel UI in P1. |
| Connectors | `views/Connectors.tsx`; `/api/registry` | Fold the MCP-per-project projection into Health in P1; delete the page and standalone route. |
| Ledgers | `views/Ledgers.tsx`; `/api/index`, `/api/ledgers/slices` | Fold usage into Health in P1; delete the page and standalone route. Spend remains suppressed. |
| Sentinel | `views/panels/Sentinel.tsx`, `views/panels/Quartermaster.tsx`, `views/panels/FlightRecorder.tsx`; `/api/panels/health`, `/api/panels/usage`, `/api/index` | Replace with Health rows in P1; complete machine and deploy data in P5. |

### Auto-registered Agent Platform panels

`dashboard/src/views/agentPlatform/registry.ts#AGENT_PLATFORM_PANELS` and `dashboard/src/views/agentPlatform/registry.ts#collectPanels` are the registry to remove. The panel entry modules are deleted when their destination disappears; reusable server readers move behind their owning v3 service rather than preserving panel routes.

| Panel | Current route/source | v3 fate |
|---|---|---|
| Agent Management | `/api/agents` | Agents Brief/Details in P2. |
| Autonomy Ladder | `/api/panels/autonomy-ladder` | One Brief sentence and the closed Details disclosure in P2. |
| Brain Search | `/api/brain/search` | No page. Keep `dashboard/server/brain/routes.ts#registerBrainSearch` and `/api/brain/*` as agent capability routes. |
| Context Lifecycle | `/api/context-lifecycle*` | System-agent runs; remove legacy projection routes in P4. |
| Fleet Graph | `/api/agents`, `/api/dag` | Delete without replacement; only per-workflow step graphs remain. |
| Grades History | `/api/panels/grades-history` | Grader runs and proposal files; remove legacy route in P4. |
| Hygiene Report | `/api/hygiene/report` | Hygiene-agent runs; remove legacy route in P4. |
| Loop Status | `/api/panels/loop-status` | Entity status plus Schedules; delete the panel route. |
| Model Audit | `/api/model-audit` | Model-audit agent runs; remove legacy route in P4. |
| Proposed Lessons | `/api/lessons/proposals` | Filesystem proposal records and Implementer PRs; remove UI and route in P4. |
| Run Envelope | `/api/trace*` | Run Details disclosure; keep trace readers only where the run projector consumes them. |
| Schedules | `/api/panels/schedules*`, `/api/schedules/edit` | Immediate control-store Schedules service in P2; HEARTBEAT becomes seed/mirror only. |
| Watch agents run | `/events`, `/api/control/runs*` | Entity Live tab and full-width Run view in P2. |

### Existing services and migrations

| Concern | Current owner and v3 treatment |
|---|---|
| Declarations | `dashboard/server/agents/roster.ts#buildRoster` and `#readDeclaredAgentDetails`; `agents/*.md`. |
| Workflow definitions | `dashboard/server/workflows/routes.ts#registerWorkflows`, `workflows/defaults.ts#resolveWorkflowDefaults`, `#stagesInDependencyOrder`; `orgs/*/workflows/*.md`. |
| Runs, gates, events | `dashboard/server/control/store.ts#createFileControlPlaneStore` and `ControlPlaneStore`; `control/routes.ts#registerControlRoutes`. |
| Queue/project/ledger index | `dashboard/server/planeA/indexer.ts#indexRepo`; its card parsing remains governed by `governance/card-schema.md` and `governance/risk-tiers.md`. |
| Run DAG | `dashboard/src/control/runGraph.ts#overlaysFromRun`; workflow stages and `RunDetail` stages/attempts. |
| Live/replay transcript | `dashboard/src/lib/timelineModel.ts#foldRecords`; `dashboard/server/timeline/stream.ts#streamSession`. |
| Schedule seeds | Root/org `HEARTBEAT.md` and `scripts/dispatch.py#parse_heartbeat` | Import once into the control store in P2. Thereafter files are store-mirrored recovery/bookkeeping seeds, never live input. |
| Schedule clock and firing | `scripts/dispatch.py#parse_cron`, `#latest_occurrence`, `#due` | Keep Python as the single firing oracle; P2 makes it read raw schedule records and claim occurrences through the daemon's local store API. |
| Cadence pause | `queue/paused/<cadence>` and `/api/write/pause-cadence` | One-time migration `migratePausedCadenceMarkersToScheduleArmedV1` writes `armed:false`; then delete markers, route, and sentinel code. |
| Durable writes | `dashboard/server/runtime/capabilities.ts#composeRuntimeCapabilities`; `runtimeCapabilities.durablePrWrites`; `dashboard/server/write/branch.ts#routeDurable`. |
| PTY | `dashboard/server/pty/host.ts#createPtyHost`, `persistentSessions.ts#createPersistentSessionRegistry`, `route.ts#registerPtyRoute`. |
| Single writer | `dashboard/server/control/writerLease.ts#acquireWriterLease`; the VM control store. |

## 3. Information architecture

`DestinationId` and `NAV_SECTIONS` in `dashboard/src/nav/config.ts` become exactly:

| Altitude | Destination ids in rendered order | Labels |
|---|---|---|
| Operate | `home`, `inbox`, `schedules`, `terminal` | Home, Inbox, Schedules, Terminal |
| Build | `agents`, `workflows`, `tasks`, `projects`, `files` | Agents, Workflows, Tasks, Projects, Files |
| System | `health` | Health |

`NavSection.label` is removed. `Sidebar` in `App.tsx` renders a one-pixel divider between arrays and no group header. The old ids `approvals`, `activity`, `atlas`, `agentPlatform`, `connectors`, `ledgers`, and `sentinel` are removed from the union and from `ViewBody`; `inbox` and `health` are real ids, not labels over legacy ids. Deep-link parsing rejects removed ids and falls back to Home.

`NewMenu` is deleted. Repository search shows Composer is reached from `App.tsx#ComposerView` and the `+ New` flow rather than another retained product surface, so P1 deletes `ComposerView`, its launcher, its composer-only workspace state, and composer-only server entry points after an import/reference check. Terminal session tabs remain owned by `views/Terminal.tsx`. `CommandPalette` remains, limited to the ten destinations and retained entity actions; its tests contain no removed destination or Composer command.

P1 also deletes the sidebar hover-flyout feature, `dashboard/src/flyout/**`, its CSS/tests, and `useFleetData`; compact cards and slide-ins replace that hidden secondary surface. This removes the retained `/api/registry` caller before the standalone route is deleted. Health calls `registry/connections.ts#indexConnections` server-side and never fetches the retired route.

The sidebar is expanded on every page except Terminal. Terminal collapses it to the glyph rail; the operator may expand it temporarily. The light-theme toggle remains. Badges appear only on Inbox, Agents, and Workflows under the derivation rules below.

## 4. Domain model

### Runnable nouns and groups

There are exactly two runnable noun types:

```ts
type RunnableRef =
  | { type: "agent"; id: string; sourcePath: `agents/${string}.md` }
  | { type: "workflow"; id: string; project: string; sourcePath: `orgs/${string}/workflows/${string}.md` };
```

An Agent is one active declaration returned by `readDeclaredAgentDetails`. A Workflow is one parsed workflow returned by `registerWorkflows`' shared reader. A loop is not stored or displayed as a noun; it is an armed or disarmed `Schedule` whose owner is an Agent or Workflow. Superseded declarations are not runnable cards and remain discoverable only through the replacement agent's Details lineage.

Tasks remain queue cards parsed under `governance/card-schema.md`; risk labels and action gates continue to come from `governance/risk-tiers.md`. Dashboard v3 introduces no second task, approval, or risk schema.

System-maintenance declarations carry `group: system` in their `agents/*.md` frontmatter. Every other runnable Agent must have at least one valid project. `projectAgentGroups` normalizes and lexically sorts the declaration's project ids; the first is its single rendered group and additional projects appear only in Details. Agent and Workflow org groups sort by lexical org id. System renders last and collapsed by default. Unit fixtures cover multi-project, invalid-project, and System ordering; `buildRoster` is only the declaration source, not the group-order source.

### Persisted run identity and outcome

P2 extends the existing `Run` record in `dashboard/server/control/types.ts`, not a companion table:

```ts
type RunOutcome = "ok" | "failed" | "stopped" | "interrupted" | "abandoned";
type ArchivedFrom = "succeeded" | "failed" | "stopped" | "interrupted" | "waiting-human";

interface RunIdentityFields {
  owner: RunnableRef;               // immutable launch owner
  executionHost: HostKind;          // immutable actual host, not a UI guess
  terminalOutcome: RunOutcome | null;
  completedAt: string | null;       // immutable first terminal-result time
  archivedFrom: ArchivedFrom | null;
}
```

Every launch transaction persists `owner` and `executionHost` atomically with the Run. Workflow launch writes its Workflow ref; standalone launch writes its Agent ref. `migrateRunIdentityV1` backfills legacy owners only from unique workflow proposal/audit provenance or `agentWorkspaceLaunch`; ambiguity aborts startup with `run-owner-migration-required` and a bounded mapping report instead of guessing. Before cross-host placement exists, every legacy run in one control document ran on that document's daemon, so the same migration stamps that daemon's boot-verified VM/Desktop identity as `executionHost`. P6 placement writes the selected lease host into the new Run before dispatch.

Transitions to succeeded, failed, or stopped set the corresponding outcome and `completedAt`. Archiving preserves both and sets `archivedFrom`; direct archive from interrupted produces `interrupted`, and direct archive from waiting-human produces `abandoned`. Recovery from interrupted leaves outcome null until a later terminal result. Migration reconstructs an archived result from ordered lifecycle events; an ambiguous archived result fails with `run-outcome-migration-required`. No projection infers success from `archived` alone.

### Summary and card projection

```ts
type EntityStatus = "running" | "needs-you" | "failed" | "idle" | "scheduled";
type HostKind = "vm" | "desktop";

interface EntitySummary {
  ref: RunnableRef;
  humanName: string;
  status: EntityStatus;
  modelLabel: string;             // resolved agent model; always "varies" for a workflow
  temporalLabel: string;          // "ran 2h ago · ok" or "next 09:00"
  host: HostKind;
  gatedRunCount: number;          // distinct waiting runs, not HumanRequest count
  activeRuns: RunRow[];
  latestRun: RunOutcome | null;
  nextSchedule: ScheduleOccurrence | null;
}
```

The card's above-the-fold DOM contains exactly: human name, one status pill, one model badge, one temporal line, one host chip, and a gate-count badge only when `gatedRunCount > 0`. It contains no purpose, tool list, autonomy ladder, id, action button, run count, or secondary metadata. The entire card opens the entity slide-in. Grid is the default; the grid/list toggle persists as `kb.dashboard.entity-layout.v1` with separate `agents` and `workflows` values.

### Status derivation

`projectRunActivity` exhaustively switches on `RunLifecycleKind`: `waiting-human` is attention; `planned`, `recovering`, `running`, `stopping`, and `paused-for-deploy` are active; `interrupted` is failed/recoverable; `succeeded`, `failed`, `stopped`, and `archived` are completed. Its default calls `assertNever`; a meta-test iterates `RUN_LIFECYCLE_KINDS`. Waiting-human counts as attention even when a corrupt/legacy run lacks a `HumanRequest`; Run view then shows the server-owned Resume/repair prompt.

`projectEntitySummary` reads Runs by immutable `Run.owner`, live schedules, and no client joins. It applies this precedence: Needs you when any owned run is attention; Running when any is active; Failed when any non-recovered interrupted run exists or the latest completed outcome is failed, interrupted, or abandoned; Scheduled when an armed schedule has a next occurrence; Idle otherwise. Active/attention ties sort by `createdAt` descending then `runRef`; completed ties sort by `completedAt` descending then `runRef`. A stopped or successful latest run falls through to Scheduled/Idle.

The displayed labels are Running, Needs you, Failed, Scheduled, and Idle. A workflow always shows model badge `varies`; an agent shows the model resolved by `createAssignedAgentResolver` and the declaration defaults. The temporal line uses the latest completed outcome when one exists, otherwise the next armed occurrence. Times are tabular and rendered in the operator's Eastern clock without a timezone suffix or timezone control.

### Humanization and host chip

Add one shared `humanizeEntityId(id)` utility and use it in rosters, entity headers, run owner labels, schedules, Inbox, and Home. It splits hyphen/underscore tokens, applies Title Case, then applies the small exact acronym map `API`, `CLI`, `CPU`, `FYT`, `GPU`, `KB`, `MCP`, `PR`, `PTY`, `RAM`, `SSE`, `VM`, and `WSL`; for example, `fyt-checker` becomes `FYT Checker`. The card/header human name always derives from the id; an existing workflow `title` supplies Brief purpose/context and never replaces that name.

The host chip comes from the selected active Run's immutable `executionHost`, else the latest completed Run's `executionHost`, else `resolveExecutionHost`'s deterministic preview for a never-run entity. P2 implements the preview over current routing (`cloud` → VM, `desktop` → Desktop) and also adds the persisted field/migration above, so its binding card contract is complete before P6. P6 changes preview internals to capability matching with VM-first tie-breaking; the launch still records the chosen host on Run. The only visible labels are VM and Desktop.

## 5. Surfaces

### Agents and Workflows

**Layout.** `views/Agents.tsx` and `views/Workflows.tsx` render search/filter controls, grid/list toggle, and grouped `EntityCard`s. Clicking a card opens an overlay panel from the right; the list remains mounted with its scroll, filter, group-collapse, and layout state. Escape and the close button close it and restore focus to the originating card. A URL state such as `?entity=agent:fyt-checker` makes the overlay linkable without changing the shell destination.

**Entity tabs.** Rework `entity/EntityDetail.tsx#EntityDetail` rather than creating a parallel detail framework.

| Tab | Binding contents |
|---|---|
| Live, default | Active runs as tight rows: state, elapsed, tools called, last line, and gate badge. Clicking opens the Run view. The tab badge is the entity's distinct gated-run count. |
| Brief | One sentence of purpose; what it is doing now; last five runs as `time · outcome · one-line result`; recent output links; pending gates; schedule; autonomy tier in one sentence. |
| Details | One disclosure **button**, initially `aria-expanded=false`, containing source path/revision, tools, declared ceiling, replaces/builds-on, knowledge sources, skills, schemas, lineage, grades, and ids. There are no separately expanded technical panels. |

Workflows additionally show this workflow's stage DAG from the selected run's workflow definition plus `RunDetail.stages` and attempts. `control/runGraph.ts#overlaysFromRun` is extended to return step nodes rather than agent-collapsed nodes. Clicking a step selects that step's event stream. There is no fleet graph.

**Data.** Extend the existing `/api/agents`, `/api/agents/:id`, `/api/workflows`, and `/api/workflows/:id` shared services to return `EntitySummary`, Brief fields, output refs, schedule summary, and source revision. Do not make the client join `/api/index`, `/api/routing`, and control details. `OutputRef` is a safe union of repository file, artifact, and external PR links projected from workflow artifact declarations and file/diff/PR operational events.

**Actions.** Secondary actions at the overlay's top right are Run now, Schedule, Edit, and Open terminal. Run now invokes the same launch service as scheduled and `/api/v1` runs. Schedule navigates to New schedule with owner prefilled. Edit opens the form-first builder with the existing declaration loaded. Open terminal creates or attaches a session in that entity's safe cwd. Workflows use the same four actions.

**Empty/error.** Live empty state is `Last ran <relative time> · next <time>`; omit either absent half and use `Never run · no schedule` when both are absent. Brief output groups say `No recent outputs`; they do not disappear. A failed summary request leaves the roster shell and filter in place and shows one retry row. A failed detail request leaves the overlay open with Retry.

**Replaces.** This removes current row-only rosters, route-stack detail replacement, Agent Management, Autonomy Ladder, Run Envelope, Watch agents run, and fleet-wide graph UI.

### Run view

**Layout.** `views/RunDetail.tsx` becomes a full-width stream with a collapsible right inspector. The stream occupies all remaining width and follows the active tail unless the operator scrolls back. Transcript runs show normalized turns, tool calls/results, file/diff events, checkpoints, and lifecycle lines. PTY-backed runs render the terminal itself. A workflow step selection filters the same ordered event source by `stageRef`; it does not open a second viewer.

**Data and parity.** Keep `timelineModel.ts#foldRecords` as the sole transcript fold and feed it both replay pages and live records from `server/timeline/stream.ts#streamSession`. Add `GET /api/control/runs/:runRef/events/stream?after=<cursor>` as the SSE sibling of the existing replay event route; both call the same redaction and ordering service. Reconnect begins at the last accepted cursor, deduplicates by event cursor, and produces byte-equivalent folded state to a full replay. PTY runs carry `streamKind: "pty"` and `sessionId`; transcript runs carry `streamKind: "transcript"`.

**Inspector.** The right inspector contains plan, milestones, built links/outputs, and the active gate prompt. Respond/approve calls one gate-kind-aware `respondHumanRequest` service and remains disabled after one accepted revision. `input` and `intervention` use the deployment's ordinary authenticated operator channel. `approval`, `review`, and `governance-refusal` are T3: the service accepts only a fresh WebAuthn assertion pinned to request ref, request revision, response digest, action, origin, and expiry. Where WebAuthn is not deployed—including the current tailnet mode that retires it in `dashboard/server/auth/mode.ts`—the service returns `403 ceremony-unavailable`; it never downgrades the gate. One closed Details disclosure contains the step skeleton, envelope, linked cards, evidence including tests/lint/self-checks, and ids.

Human gate response and host execution reports are separate services and transitions. A host may append only the closed `started|event|gate-opened|completed|failed|lease-renewed` report union; it cannot supply a human response, approve, change a `HumanRequest` revision, or transition waiting-human to running. There is no test, lint, self-check, trace, or run-envelope surface elsewhere.

**Actions and states.** Reattach, detach, copy safe output link, gate response, and the existing governed run stop are allowed. An ended run switches to replay without changing layout. A disconnected live stream shows `Reconnecting…` while preserving replayed content; a terminal that ended shows its exit code and transcript. No error clears prior stream content.

**Replaces.** Delete the Activity page and the tile-based live-run sections of the current `RunDetail`; retain and move their model/store logic in place.

### Gate counts

Add a server projector `projectRunAttention(store)` beside the control-store readers. It queries Runs whose lifecycle is waiting-human or which have an open `HumanRequest`, reads their immutable `Run.owner`, reduces them to distinct `(runRef, owner)` pairs, and returns agent and workflow maps. It never reconstructs ownership from proposal ids, stages, cards, or audit text. `RunMetadata.openHumanRequestCount` remains metadata, not a UI counter store.

One gated run contributes one to exactly one noun's entity card and Live tab and one to that noun's sidebar destination aggregate, even if the run has several open requests. Resolving the last request—or the repair prompt for a request-less waiting run—changes the store once, emits an event, and all projections decrement on their next SSE invalidation/refetch. Agents, Workflows, and Inbox never maintain local counters. Run gates are excluded from `projectInbox`.

### Schedules

**Layout.** `views/Schedules.tsx` lists only stored schedules as tight rows: owner, cadence in words, next occurrence, last outcome, armed toggle, and Delete. New schedule is a form: select an existing Agent or Workflow, enter cadence words or five-field cron, choose time, and Create. It never renders declaration rows without schedules, suggestions, cadence proposals, or timezone UI.

**Data shape and routes.** Replace panel-shaped rows with:

```ts
interface Schedule {
  id: string;
  owner: RunnableRef;
  cadence: { source: string; words: string };
  nextAt: string | null;
  lastOutcome: RunOutcome | null;
  armed: boolean;
  origin: "seed" | "operator";
  mirroredAt: string | null;
  mirrorPath: "HEARTBEAT.md" | `orgs/${string}/HEARTBEAT.md`;
  version: number;
}
```

The existing VM control store v2 (`ControlPlaneStore`) under `writerLease` is the live authority. P2 adds its `schedules` collection, `scheduleCollectionRevision`, occurrence claims, and seed/mirror metadata through the normal store migration registry. `GET /api/schedules` returns the collection watermark and rows. Operator-authenticated `POST /api/schedules` creates `origin:"operator"` immediately with an idempotency key and expected collection revision; daemon/host identities cannot mutate schedules. Arm, disarm, and Delete compare the row's expected `version`, mutate immediately, increment both row and collection revisions, emit one event, and return the new row/tombstone. Arm refuses `origin:"seed"` with `409 seed-not-on-protected-main` until its byte-identical protected-main authorization is verified. No mutation opens a PR, no active change waits for merge, and no row has a pending-PR state.

Ids are deterministic: seed id is `sha256("schedule\0" + normalizedHeartbeatPath + "\0" + cadenceName)`; operator id is `sha256("schedule\0operator\0" + owner.type + "\0" + owner.id + "\0" + clientIdempotencyKey)`. `mirrorPath` is root for System agents and the owner's lexical primary org otherwise. Delete immediately excludes the row from GET/firing and writes a store tombstone until its removal has been included in a merge-confirmed mirror, preventing a lost deletion during recovery.

**Seeds and pause migration.** Root/org `HEARTBEAT.md` cadences are one-time seeds, not live inputs. On the first boot whose store has the schedule collection, `importHeartbeatScheduleSeedsV1` parses all files, inserts absent deterministic ids with `origin:"seed"`, and atomically records `{version:1, releaseSha, seedDigest, importedAt}`; that marker makes every later boot/retry a no-op. A seed imports armed only when its complete cadence entry is byte-identical at the attested protected-main source commit for the booted release. A branch/dev-only entry imports disarmed. This makes Daniel's reviewed merge to protected `main` the standing-authorization gate required by `governance/risk-tiers.md`; nothing arms merely because it exists on a worker branch.

Immediately after seed import, the named migration `migratePausedCadenceMarkersToScheduleArmedV1` maps each unambiguous `queue/paused/<cadence>` marker to the matching store row, CAS-writes `armed:false`, records the marker digest, then removes the obsolete marker through its owning coordination publisher. A collision or missing schedule aborts migration visibly; it is never guessed. After migration, delete `/api/write/pause-cadence` and all marker reads/writes.

**Clock and firing.** Keep `scripts/dispatch.py#parse_cron`, `#latest_occurrence`, and `#due` as the one firing clock. The Python dispatcher reads an uncomputed raw schedule snapshot from `GET /api/internal/schedules/snapshot` and CAS-claims the exact occurrence at `POST /api/internal/schedules/:id/claim` over a daemon-owned Unix socket authenticated with `SO_PEERCRED`; the public/tailnet surface never exposes these routes. The daemon validates/returns store data but never decides due time. This local API is chosen over reading the store file because only the daemon holds the VM writer lease, runs migrations, and can atomically dedupe occurrence claims; Python remains the single firing oracle. Keep `lib/scheduleWords.ts` for display and shared JSON vectors so TypeScript next-time text and Python clock behavior agree.

**Repo mirror and recovery.** After the one-time import, direction is store → repo only. On the System Sweeper cadence, the read-only agent emits the desired full HEARTBEAT file set plus schedule collection watermark. The server-owned reconciliation publisher validates the snapshot and calls the existing `routeDurable` multi-path batch once, producing at most one mirror PR for all changes since the last merge-confirmed mirror. New changes accumulate behind an open mirror PR and enter the next batch. Merge is bookkeeping, never a schedule gate; the PR appears in Inbox like any other PR.

The mirror writes stable schedule id, origin, armed state, row version, and collection watermark as machine fields in each cadence/file manifest. After observing merge, the publisher CAS-sets `mirroredAt` and clears covered tombstones; mirror metadata has its own revision and is excluded from the live schedule-content watermark, so acknowledgement cannot generate a mirror loop or invalidate an operator action ETag. VM-loss recovery validates the latest state snapshot and last merged full mirror, then restores the higher schedule collection watermark; if only one survives it restores that one. This is the only post-migration repo → store recovery path.

**States.** All times use `America/New_York` internally and render without a timezone suffix. Invalid words/cron fail inline before write. A schedule whose owner no longer resolves is a server integrity error, appears in Health, and is not turned into an `Unknown` row. Empty state is `No schedules`; load failure is a retry row, not the empty state.

**Replaces.** Removes proposed schedules, unscheduled-entity rows, history-as-page behavior, file-first mutation, and post-hoc pause markers. Delete `/api/panels/schedules*` and `/api/schedules/edit` after the store service is live. Next occurrence is projected onto the owner's card from the same store snapshot.

### Inbox

**Layout and data.** `views/Inbox.tsx` renders high-level subjects only:

```ts
interface InboxBase {
  id: string;                       // deterministic hash of kind + pinned subject
  createdAt: string;                // source event time
  revision: string;
}
type InboxItem = InboxBase & (
  | { kind: "pr"; subject: { owner: string; repo: string; number: number }; title: string; href: string }
  | { kind: "deployment"; subject: { deploymentRef: string }; title: string; state: string; blockingPtyIds: string[] }
  | { kind: "asset-pull"; subject: { intentRef: string; runRef: string; manifestDigest: string }; title: string; state: string }
  | { kind: "escalation"; subject: { cardId: string }; related: { runRef?: string; stopEvent?: string }; title: string; reason: string }
);
```

`projectInbox` reads live PR subjects, control-store Deployment and AssetPullIntent records, and escalation cards. Existing failure/STOP handlers create a deduped wake-me card pinned to the failed System `runRef` or STOP event; System Sweeper backfills a missing card before the item can appear. Thus every escalation's subject is a card id and the run/event is related context, never its lifecycle authority. Inbox owns no read state, archive, snooze, retention cap, or copied resolution bit. Run `HumanRequest`s and request-less waiting runs are excluded because their only surface is Run view.

**Actions.** PR exposes Open PR, explicitly labelled external, using a server-constructed URL from the pinned owner/repo and positive number. Deployment exposes exactly the state-valid action from Confirm, Deploy, Inspect, Abort, Acknowledge, or Close PTYs and continue; the last is part of deploy quiescence, pins the exact live session ids and deployment revision, records Daniel as actor, and refuses unless every `closeAndWait` confirms. Asset pull exposes Pull home, Retry, or Inspect against its pinned manifest digest. Escalation exposes Open card. There is no merge action and no VM merge credential.

**Lifecycle.** A PR item vanishes when merged or closed. A deployment item changes action with its canonical Deployment state and vanishes only after terminal Acknowledge. A successful asset pull vanishes on the helper receipt; offline/failure stays visible and retryable. An escalation vanishes when its subject card is done. Source events invalidate immediately. System Sweeper reconciles all subjects and repairs missed invalidations without inventing Inbox state.

**Empty/error.** Empty is `Nothing needs you`; the next scheduled fire belongs to Schedules and never appears in Inbox (Daniel, 2026-08-21). If one source fails, retain verified items and show a source-specific retry row; never report an empty Inbox from a partial read.

**Replaces.** Deletes `ApprovalsLive`, the run-detail join in `#asksForRun`, generic approval categories, read/snooze/resolve controls, and the current overpopulated projection.

**Movement supersession.** D10 supersedes movement spec §4 only for run subjects: Respond and Resume move exclusively to the Run inspector and never appear in Inbox. It retains PRs, the full deployment action set including PTY close-and-continue, and asset-pull subjects/actions. P5 applies a one-line supersession note to movement §4 so both specifications name this one canonical lifecycle.

### Terminal

**Layout.** Terminal uses the full content viewport and collapses the sidebar to its rail. The header contains named session tabs/list, host selector, safe cwd selector, and launchers Shell, Claude, and Codex. The terminal consumes the rest of the viewport. Sessions can be named, detached, reattached, listed, and closed.

**Host and capability.** Replace `runtimeCapabilities(platform).pty = platform === "windows"` with an async host probe composed by `makeSurfaceContext`. Windows probes the local `node-pty` host and allowlisted shell. Linux probes the dedicated broker socket and service identity. The `repo` root id resolves exactly to `/var/lib/kb/ops`; every requested cwd is realpathed, then permanently denied if it equals or descends from `/var/lib/kb/state`, `/opt/kb-releases`, or `/var/lib/kb-activation`. Symlinks cannot cross those boundaries.

Linux uses socket activation, not sudo, setuid, or the dashboard uid: root-owned `kb-shell-broker.socket` creates `/run/kb-shell/broker.sock` with a narrow `kb-dashboard` client ACL, and `kb-shell-broker.service` runs `User=kb-shell` and owns every PTY child. `kb-shell` has its own protected home at `/var/lib/kb-shell/home`, read/execute access to `/var/lib/kb/ops`, writable session worktrees only under `/var/lib/kb-shell/worktrees`, and systemd `InaccessiblePaths` for state, releases, and activation roots. The broker protocol is a closed create/attach/input/resize/close union; it accepts root ids and relative paths, never executables, environment blobs, uid, or credentials. A failed broker identity/path check advertises `pty:false` and refuses spawn.

**Sessions and runs.** Extend `createPersistentSessionRegistry` and `createSessionRunStore`; do not add another process registry. Session records add `name`, `host`, `launcher: shell|claude|codex`, safe root id, cwd-relative path, attached run ref, and `controllerBrowserSessionRef`. The dashboard mints a 256-bit opaque browser-session ref in a Secure, HttpOnly, SameSite=Strict cookie; registry list/attach/write/resize/close requires both `operator` and that ref. Tabs share it, but a separately minted authenticated browser session receives not-found and cannot evict the controller. Run-owned sessions expose transcript observation through run authorization; interactive control still requires an explicit controller grant bound to the browser ref.

Persistence means the child survives navigation/disconnect and can be reattached while the daemon lives. A daemon restart marks unrecoverable children abandoned. The only cross-controller termination is the Daniel-authorized deployment `close-ptys-and-continue` action against exact ids; ordinary callers cannot list, attach, close, or write another controller's session.

`registerPtyRoute` accepts only launcher enums, registered cwd-root ids plus normalized relative paths, dimensions, and optional existing session id. It never accepts executable paths, raw commands, environment blobs, usernames, tokens, or host addresses. Agent-run adapters create sessions through the same host/registry, so Run view and Terminal attach to one `sessionId` and transcript.

**States.** Empty shows the three launchers. A host without PTY gives a Health link. Disconnection preserves the buffer and offers Reattach. Closing an active session requires confirmation and records its exit. Daniel signs in to Claude/Codex once as `kb-shell` outside the dashboard; login material remains in that uid's home and is never read, returned, logged, or stored as an object.

**Replaces.** Replaces the fractional terminal, Windows-only capability check, anonymous browser-local tabs, fixed repo cwd, and Claude-only launcher assumptions.

### Health

**Layout.** `views/Health.tsx` is one row-oriented page with sections in this order: fleet liveness per agent; STOP; daemon and machine; MCP wiring per project; usage rollup. It has no tiles. The only control is STOP.

**Data.** `GET /api/health` composes the pure readers behind current `/api/panels/health`, `/api/panels/usage`, `registry/connections.ts#indexConnections`, ledger slicing, runtime capability probes, OS CPU/RAM/disk/uptime, immutable release metadata, and latest Deployment. Spend fields are omitted, not zeroed. MCP rows distinguish configured, available on VM, available on Desktop, and missing.

**STOP.** Narrow `StopControls` to one fleet STOP backed by the existing `/api/write/stop` floor, mounted once in Health with confirmation and a resulting STOP event. Delete its card-stop and cadence-pause controls; Schedules owns arming, and an individual running session uses the existing control-plane run-stop action in Run view.

**States.** Each section has last-observed time. One failed probe produces an unavailable row without hiding other sections. Fleet liveness uses the current Sentinel health projection and declared agents; no undeclared fake nodes are drawn.

**Replaces.** Deletes Connectors, Ledgers, Sentinel, Quartermaster, Flight Recorder, their standalone routes, and the three-tab layer panel. Run trace links remain outputs/evidence, not a system page.

### Home

**Layout.** Home contains, in order: Running now cards; three linked counts (Agents gates, Workflows gates, Inbox items); next three schedule fires; version chip; last ten completed run outcomes as one-line rows. There is no panel grid, proposed schedule section, or `Recent N` summary bar.

**Data.** `GET /api/home` is a server projection over the same run-attention, Inbox, schedule, and Health/release services. It does not persist summary state. The version chip format is `VM · 64fb3d02 · 2h ago`; the SHA and activation time come from immutable live release status, not the checkout symlink or client cache.

**Actions and states.** Running cards open Run view. Counts navigate to the exact destination with attention filtering. Schedule rows open the owner. Outcome rows open replay. When nothing runs, say `Nothing running`; when no outcome exists, say `No runs yet`. Partial failures stay section-local and never turn counts into zero.

**Replaces.** Rewrites `Home.tsx` and removes KPI tiles, project tiles, proposed schedules, usage tile, resume groups, and recent-count bars.

## 6. Automation

### Learnings pipeline

Lessons Miner, Grader, Model Audit, Hygiene, and Context Lifecycle are declared System agents. Each scheduled run writes zero or more immutable proposal records under `docs/proposals/learnings/`. This extends the existing `docs/proposals/*` convention and generalizes the lesson-only records currently written by `scripts/brain/session_miner.py`.

```yaml
schema: kb.learning-proposal/v1
id: lessons-miner-run_01HXYZ-01
kind: lesson | agent-improvement | grade-finding | model-audit | hygiene | context-lifecycle
source-agent: lessons-miner
source-run: run_01HXYZ
created-at: 2026-08-20T05:30:00Z
target: agents/fyt-checker.md
status: proposed | implemented
batch-id: null
implemented-at: null
---
## Evidence
- path: memory/lessons-miner.md
  locator: "2026-08-20 run_01HXYZ"
## Proposed change
One bounded, testable change.
```

The file name is `<created-date>-<id>.md`. `id` is deterministic from source agent, run ref, and ordinal, so a retry is idempotent. `target` is one normalized repo-relative path. `## Evidence` is inert under the repository authorization law and cannot grant permission. Miners never edit their target.

Learnings Implementer is a System agent. It reads only `status: proposed`, batches records with non-conflicting targets, applies their tests and smallest permitted edits on a work branch, and asks the server-owned durable publisher to commit and open one PR. Extend `write/branch.ts#routeDurable` to validate a bounded exact `relpaths[]` batch; do not create a second PR implementation. The worker never invokes commit, never targets main, and never merges. The same PR changes each included record to `implemented`, adds `batch-id`, and sets `implemented-at`; therefore the record becomes implemented only when the PR merges. The PR is an Inbox item. Records remain on disk; no dashboard history reads them.

`scripts/agent_maintainer.py#run_fire` and `scripts/agent_evals.py#run_suite` remain reusable engines called by the appropriate System agent, subject to their current target walls and human-blessing rules. Their dashboard panels and hand-trigger-only UX are removed.

### Seeded System schedules

P2 creates or normalizes the System declarations and declares these seed entries in root `HEARTBEAT.md` on `claude/dashboard-v3`. The source entries state `armed:true`, but a branch boot imports them disarmed; only a byte-identical entry in the attested protected-main release imports armed. Existing human-authored protected-main rows retain their standing authorization. New P4 implementations receive manual supervised Run now tests and recorded grades on the branch before Daniel reviews the final merge; after that human merge, the fresh production seed import may arm them. Implementer and schedule-mirror effects are limited to producing a reviewed PR: that PR is the human gate for their repository writes, and neither can merge or write main.

| Schedule id | Owner | Seed cadence |
|---|---|---|
| `context-lifecycle` | Context Lifecycle | `15 1 * * *` |
| `lessons-miner` | Lessons Miner | `45 1 * * *` |
| `grader` | Grader | `15 2 * * *` |
| `model-audit` | Model Audit | `45 2 * * 1` |
| `hygiene` | Hygiene | `15 3 * * 0` |
| `learnings-implementer` | Learnings Implementer | `30 3 * * *` |
| `system-sweeper` | System Sweeper | `*/15 * * * *` |

Existing `nightly-review` and `weekly-audit` remain seeds assigned to declared System owners; `grades-reconcile` maps to Grader and `branch-hygiene` maps to Hygiene. Times are interpreted by the single Python dispatcher in the operator's Eastern clock. Placement selects VM or Desktop from required tools; schedule records do not hard-code a host after P6.

### System Sweeper and reconciliation publisher

System Sweeper is a read-only agent. On each fire it reads the same subject resolvers as `projectInbox` plus the store schedule snapshot and emits a bounded `ReconciliationIntent[]`; it never edits cards, Inbox state, HEARTBEAT files, git, or ledgers. Intent kinds are `card-transition`, `escalation-card`, `schedule-mirror`, and `mirror-merged`, each carrying actor, idempotency key, expected source/store revision, and exact targets.

For authorization and grading, `schedule-mirror` is a write-capable effect because its publisher produces a PR, even though the Sweeper process is read-only. Its first supervised run and grade are recorded beside the Implementer's before either protected-main cadence can arm.

One server-owned `publishReconciliationIntent` service is the only card/Inbox transition executor. Human Tasks verification supplies its pinned card plus human actor; System Sweeper supplies a read-only intent. Card and escalation transitions use a CAS against pinned content, then the existing ops outbox publisher with actor audit; the agent never receives ops credentials or writes the ops checkout. Schedule-mirror validates the full schedule watermark and calls the existing bounded multi-path `routeDurable` once. Mirror-merged CAS-updates `mirroredAt`. Replays with the same key/body return the original result; a changed body conflicts. A supervisor-detected Sweeper failure asks this publisher to create one deduped wake-me card under actor `dashboard-supervisor`. Inbox remains a projection and is never directly mutated.

### Deploy

Dashboard v3 consumes, and does not restate, the state machine and closed desktop-helper verb union in `docs/specs/2026-08-20-desk-vm-movement-design.md` §3. P5 projects a deploy-ready Inbox item only when tested green `main` is newer than the immutable VM live release. Daniel alone triggers Confirm/Deploy/Abort or Close PTYs and continue through Inbox and his desktop helper; VM quiescence, activation, re-arm, result, cooldown, and receipt behavior remain exactly §3. Deployment and asset-pull records drive their Inbox subjects, and Deployment drives the Home version chip. The VM never receives a merge endpoint or merge token and never merges.

For movement §4, v3 explicitly supersedes only its Runs bullet and Respond/Resume Inbox endpoints: all run gates live and resolve in Run view. The PR, deployment (Confirm/Deploy/Inspect/Abort/Acknowledge/close-and-continue), and asset-pull bullets remain binding and use the canonical D10 projection. P5 adds that one-line supersession note to the movement spec in the implementation branch before deleting its obsolete run-Inbox assumptions.

Movement spec §8 remains the infrastructure dependency order: service identity/dual roots, writer lease/store, quiescence/activator, and desktop helper must be proven before Dashboard P5 enables Deploy. Dashboard P5 adds the projection and control only; Dashboard P6 exposes the shared services through the §6 `/api/v1` seam. Neither phase duplicates the movement implementation.

## 7. Placement and `/api/v1`

### Capability and placement records

The builder is form-first on Agents and Workflows. It assigns existing tools, MCP connector/tool grants, skills, and symbolic filesystem roots. It does not expose or write a `needs` field. The server materializes the current `agents/*.md` or `orgs/*/workflows/*.md` schema through the durable PR path; edit uses the same form and source. Purpose, model/profile, project, and runnable assignments remain explicit fields.

Agent declarations retain the keys parsed by `agents/roster.ts#readDeclaredAgentDetails`; P2 adds optional `group: system`, `connectors: [{ server, tools }]`, and `filesystem-roots: [<symbolic-root-id>]` beside existing `tools` and `skills`. Workflow definitions retain `project`, `profile`, `readScope`, and `stages`; P2 adds top-level `tools`, `connectors`, `skills`, and `filesystemRoots`. Placement requirements are the union of workflow-level capabilities and every assigned stage agent's capabilities. Builders serialize keys in those source-native casing conventions and reject unknown connector tools/root ids.

Each daemon advertises:

```ts
interface HostAdvertisement {
  hostId: "vm" | "desktop";
  daemonVersion: string;
  reportedAt: string;
  connectors: Array<{ server: string; tools: string[] }>;
  skills: string[];
  filesystemRoots: string[];       // symbolic ids, never absolute client paths
  pty: boolean;
  gpu: boolean;
  clis: { claude: "ready" | "missing" | "login-required"; codex: "ready" | "missing" | "login-required" };
}

interface PlacementLease {
  runRef: string;
  hostId: "vm" | "desktop";
  capabilityHash: string;
  revision: number;
  expiresAt: string;
  lastReportSequence: number;
}
```

The scheduler expands an entity's declared tools/connectors/skills/root ids and selects a fresh host whose advertisement contains every requirement. VM wins a tie; Desktop wins whenever it is the only complete match. No partial placement occurs. The VM control store and writer lease remain the source of truth. Desktop claims leased work and sends sequence-checked run reports over `/api/v1`; it never opens the VM store or infers completion from its local process alone.

### Host identity and enrollment

Operator browser auth and daemon auth are separate. `OPERATOR_SUBJECT` plus `tailscale-user-login` remains the human identity from `auth/mode.ts`; it cannot call host advertisement/lease/report routes. Bootstrap extends the trusted loopback proxy to strip inbound identity headers, resolve the remote peer through Tailscale LocalAPI `WhoIs`, and inject canonical `Tailscale-Node-ID`. The app accepts that header only after the existing proxy-uid/full-4-tuple proof, then records it as daemon attribution.

`/etc/kb-dashboard/host-nodes.json` is the human-managed, root-owned `0444` mapping `{schema:"kb.host-node-map/v1", revision, hosts:{vm:{nodeId},desktop:{nodeId}}, revoked:[{nodeId,revokedAt}]}`. Boot validates unique active ids and fails closed. Daniel enrolls or rotates it through bootstrap/deploy review; rotation adds the old id to `revoked`, increments revision, restarts both sides, and invalidates its leases. Authorization derives host id from this map, never from the path/body. Tests prove advertisement, claim, renew, and report reject missing/spoofed/revoked/wrong-host node ids and operator-user requests.

### Envelope and mutation rules

Every v1 success is `{apiVersion:"v1",kind,data,meta:{etag?,watermark?,nextCursor?},actions?}`; fields not meaningful to that kind are absent. Errors are `{apiVersion:"v1",error:{code,message,retryable},meta:{currentEtag?,currentWatermark?}}`. There is no universal `revision` domain.

| Kind | ETag/watermark and precondition |
|---|---|
| Agent/Workflow item | ETag is its source hash. Create requires `If-None-Match:*` plus definitions-list watermark; edit compares the item ETag. |
| Run | ETag is `run:<runRef>:<version>`. Launch compares the selected owner definition ETag and idempotency key; run actions compare Run or HumanRequest revision as named by the action. |
| Schedule | Item ETag is `schedule:<id>:<version>`; list watermark is `schedules:<scheduleCollectionRevision>`. Create compares the collection watermark; arm/disarm/delete compare item ETag. |
| Deployment/asset/inbox | Action compares the source Deployment, AssetPullIntent, PR/card blob, or escalation-card revision; an Inbox list watermark is a hash of those pinned source revisions. |
| Host/lease/report | Advertisement and lease have independent numeric versions. Claim/renew/report compare lease version; reports also compare monotonic per-run sequence. |
| Health/read-only aggregate | Watermark is a hash of contributing source revisions/timestamps and is never accepted for mutation. |

All mutations require the authenticated actor, `Idempotency-Key`, and the kind-specific precondition above. Missing precondition is `428`; mismatch is `412` with current ETag/watermark; reuse of a key with a changed body is `409`. A list cursor encodes kind, watermark, filter hash, and last stable sort key. It is valid only while that watermark remains current; otherwise the server returns `409 cursor-stale` and the client restarts, preventing mixed-snapshot duplicates. Actions are a closed relation/href union and never contain executable paths, arbitrary commands, credentials, environment blobs, merge verbs, or spending.

`If-Match` always compares the ETag of the item named by the mutation URI; it never compares a list or unrelated source. Creates use `If-None-Match:*` plus body `expectedCollectionWatermark` (schedule create uses its numeric `expectedCollectionRevision`). Run launch uses body `expectedOwnerEtag`; HumanRequest response uses `expectedRequestRevision`; Inbox actions use the subject item's `If-Match`. This naming is shared by old-route adapters and v1 clients.

`registerV1Routes` is composed in `server/index.ts#buildApp` under the same auth, origin, rate, and session middleware. Existing `/api/*` clients and `/api/v1/*` routes call extracted shared services; two URLs may coexist temporarily, but two implementations or stores may not. This is the seam required by movement spec §6 and the separate Atlas desktop app.

### Minimum endpoints

| Method and path | Purpose and shared owner |
|---|---|
| `GET /api/v1/agents`, `GET /api/v1/agents/:id` | Summary/detail/Brief projections from agent readers and control store. |
| `POST /api/v1/agents`, `PUT /api/v1/agents/:id` | Form builder/edit through governed durable writes. |
| `GET /api/v1/workflows`, `GET /api/v1/workflows/:id` | Workflow summaries, detail, stage graph. |
| `POST /api/v1/workflows`, `PUT /api/v1/workflows/:id` | Form builder/edit through governed durable writes. |
| `GET /api/v1/runs`, `GET /api/v1/runs/:runRef` | VM run source of truth, filters by entity/host/state. |
| `POST /api/v1/runs` | Calls the exact launch transaction extracted from `workflows/routes.ts#registerWorkflows`; standalone agents use the same compiler/store path. |
| `GET /api/v1/runs/:runRef/events` | Cursor replay; `Accept: text/event-stream` selects the same live source and fold input. |
| `POST /api/v1/runs/:runRef/human-requests/:requestRef/respond` | Shared gate-kind-aware human service. T3 kinds require a pinned WebAuthn authorization; a deployment without that ceremony returns `403 ceremony-unavailable`. Host node identities are forbidden. |
| `GET /api/v1/schedules`, `POST /api/v1/schedules` | List and operator-only immediate CAS-create against the collection watermark. |
| `POST /api/v1/schedules/:id/arm`, `POST /api/v1/schedules/:id/disarm`, `DELETE /api/v1/schedules/:id` | Operator-only immediate item-ETag mutations; seed arm also proves protected-main authorization; no PR/pending state. |
| `GET /api/v1/inbox` | D10 source-truth PR, deployment, asset-pull, and escalation projection; no run gates. |
| `POST /api/v1/deployments/:ref/{confirm,deploy,abort,acknowledge}`, `GET /api/v1/deployments/:ref/inspect` | Closed deployment actions with expected Deployment ETag; T3 mutations require Daniel's pinned WebAuthn authorization. |
| `POST /api/v1/deployments/:ref/close-ptys-and-continue` | Human-authorized exact-session quiescence action with Deployment ETag. |
| `POST /api/v1/asset-pulls/:intentRef/{pull,retry}`, `GET /api/v1/asset-pulls/:intentRef/inspect` | Closed asset-helper lifecycle pinned to run and manifest digest. |
| `GET /api/v1/health` | Fleet, daemon/machine, MCP, usage, and release projection. |
| `PUT /api/v1/hosts/:hostId` | Tailnet-node-bound capability advertisement/heartbeat. Caller node must map to `hostId`. |
| `POST /api/v1/hosts/:hostId/leases/claim` | Long-poll and atomically claim one compatible VM-assigned run. |
| `POST /api/v1/runs/:runRef/leases/renew` | Node/host/run-bound lease renewal with expected lease version. |
| `POST /api/v1/runs/:runRef/reports` | Node-authorized append of `started|event|gate-opened|completed|failed`; it cannot respond to or resolve a human gate. |

Atlas does not receive filesystem browsing, raw PTY spawn, helper internals, credentials, or merge endpoints in this minimum seam.

## 8. Visual system

P1 replaces the token declarations in `dashboard/src/styles/app.css` in place. Components use tokens only; retired view/panel stylesheets are deleted with their views. Accent never encodes success, warning, failure, or generic decoration.

`dashboard/docs/design-brief.md` remains historical rationale, and `docs/research/2026-08-20-dashboard-v3-inspiration.md` plus `docs/research/_ig-saved/uiux-inspiration-summary.md` remain reference material. They do not override the exact tokens, anatomy, density, or surface inventory in this specification and introduce no external font or asset dependency.

| Role | Dark | Light |
|---|---:|---:|
| Page | `#000000` | `#ffffff` |
| Surface | `#111111` | `#f7f7f7` |
| Raised | `#1a1a1a` | `#ededed` |
| Hairline | `#333333` | `#d4d4d4` |
| Muted | `#888888` | `#666666` |
| Text | `#ffffff` | `#000000` |
| Focus/selection accent | `#0070f3` | `#0070f3` |
| Success | `#46a758` | `#18794e` |
| Warning | `#f5a623` | `#9a6700` |
| Failure | `#e5484d` | `#d1242f` |

Type uses installed/system fonts only. Headers: condensed sans stack, 24/28 page title and 16/20 section title, weight 600. Body: sans, 13/18. Meta: sans, 12/16. Times, ids, code, and streams: mono, 12/18, with `font-variant-numeric: tabular-nums`. Names are Title Case. Navigation groups, section labels, and buttons are never forced uppercase.

| Component | Binding vocabulary |
|---|---|
| Pill | Text state on semantic tint/hairline; only Running/Needs you/Failed/Idle/Scheduled. |
| Badge | Compact count or model label; no icon-only badge. Gate badge is absent at zero. |
| Chip | Host or version identity; neutral surface/hairline, mono only for SHA/time. |
| Row | 36–44 px dense horizontal record with one hairline separator; primary action is the row. |
| Card | Hairline box on Surface, no isolated sub-boxes; exact D3 anatomy; selected/focused border uses Accent. |
| Disclosure | Real button with caret and `aria-expanded`; closed by default; one per entity/run Details area. |
| Overlay | Right slide-in over mounted list, Raised background, hairline left edge, focus trap, responsive full-screen below 720 px. |

Decorative icons are prohibited outside navigation rail glyphs. Empty states use one sentence plus one useful next fact/action. No surface may use nested cards to separate fields that rows or hairlines can separate.

## 9. Engineering rules and testing strategy

### Binding engineering rules

1. Change the owning service/component in place. Do not add a v3 store, parallel route implementation, feature flag, or old/new UI toggle.
2. Delete a replaced destination, panel, route, stylesheet, export, fixture, and test in the same phase that replaces its behavior. A compatibility URL is allowed only as a thin caller of the new shared service.
3. Every server shape change updates its client decoder, fixture, unit/component/server tests, and error state together.
4. Add or change a failing test before executable behavior, make the smallest coherent change, and never weaken or skip a test to pass.
5. Workers never commit. Server-owned durable publishers may commit only validated bounded output to a work branch and open a PR. The boss may review/commit the feature branch and stops at a reviewed PR; Daniel alone performs human-owned merge and deploy transitions with explicit T3 authorization. No agent pushes or commits to main.
6. Never handle credentials as objects, emit them in errors/logs, accept executable paths/commands from a client, add VM merge authority, or spend money.
7. Preserve the control-store writer lease and branch/worker/ops coordination rules from `CLAUDE.md`, `BOSS.md`, `governance/agent-rules.md`, and the applicable org contract.
8. Run all dashboard tests on Windows and a native Linux filesystem clone under WSL; a Windows-mounted `/mnt/c` checkout is not the Linux oracle.

### Test layers

| Layer | Required coverage |
|---|---|
| Pure/unit | Humanization/group order; exhaustive lifecycle/outcome/status; gate dedupe by Run owner; schedule store CAS, seed ids/authorization, cron vectors; Inbox lifecycle; capability matching; per-kind v1 ETags/cursors. |
| Vitest component | Nav/dividers, exact cards, grid/list persistence, slide-in focus, stream parity, T3 ceremony/refusal, immediate schedule actions with no PR state, Inbox action union, Terminal controller binding. |
| Server | REST/SSE/WS auth; pinned WebAuthn T3 response; host-report separation; route/client parity; store/seed/pause/run migrations; occurrence claims; node enrollment; PTY broker/path/session isolation; publisher CAS/audit. |
| Integration | Compiler launch persists owner/host; gate resolve updates all projections; schedule immediate mutation→dispatch and batched mirror PR; fixture proposal→Implementer PR→fixture merge; deploy/PTY/asset helper lifecycle. |
| Linux oracle | `cd dashboard && npm ci && npm test && npm run typecheck && npm run build` in a native Linux clone; broker children run as `kb-shell` with ops/worktree access and state/release/activation denial. |
| Windows gate | From `dashboard`: `npm test`, `npm run typecheck`, `npm run build`; run affected Python suites from repo root with `py -3 -m pytest <named tests> -q`. |

The three Windows dashboard commands and four Linux commands after `cd dashboard` are literal per-phase gates: every command must exit zero. P2 additionally runs `py -3 -m pytest tests/test_dispatch.py tests/test_dispatch_cron.py tests/test_schedule_store.py -q`; P4 runs `py -3 -m pytest tests/test_agent_maintainer.py tests/test_agent_evals.py tests/test_brain_store.py tests/test_learning_proposals.py tests/test_schedule_mirror.py -q`; P5 runs `py -3 -m pytest tests/test_deploy_release.py tests/test_build_platform_release.py -q`; P7 runs `py -3 -m pytest tests -q`. New named tests are created in their owning phase, never skipped.

Each phase's browser checklist below is executed in dark and light themes at desktop width and at 720 px. Keyboard-only checks cover rail, list/card focus, slide-in close/restore, tabs, disclosure, stream follow, and gate response.

### Adversarial review checklist

- PTY REST/WS/broker requests cannot inject command, executable, environment, uid, traversal, or denied-root symlink; every Linux child is `kb-shell`, and an independent browser session cannot list/control it.
- Desktop helper accepts only movement §3 verbs/fields, pinned node/source/attestation/request, rate/cooldown, and returns no signer/key material. Merge is absent; Daniel owns both merge and Deploy.
- Human-response services reject host identities. T3 gate/deploy kinds require a WebAuthn assertion pinned to subject/revision/decision/digest; missing ceremony refuses and never downgrades.
- `/api/v1` rejects missing auth, forged/revoked node ids, wrong object/host, wrong kind ETag/watermark, stale cursor, changed idempotency replay, out-of-order report, expired lease, and oversized/unknown input.
- Existing and v1 launch routes demonstrably call one launch service; old route tests fail if they bypass placement, compiler, gates, or writer lease.
- All URL builders pin repo/PR/card/deployment subjects and reject open redirects. Files/output links resolve within declared roots after symlink resolution.
- Inbox cannot show a run gate, persist read/archive state, retain a resolved subject, or perform merge; it retains deployment close-and-continue and asset-pull. Spend and credentials are absent from payloads/logs.
- Schedule UI/actions mutate only the writer-leased store; seed import is once/main-aware, dispatcher claims through the daemon, and one mirror watermark produces at most one PR without gating live state.
- System Sweeper remains read-only; every card transition or mirror goes through the one audited CAS/outbox publisher, and changed replays conflict.
- Transcript replay after reconnect folds to the same `TimelineModel` state as uninterrupted live delivery, including tool-result joins and redaction.

## 10. Phases

The requested order is retained. Two code-forced P1 moves prevent dead code: extract Schedules before deleting Agent Platform, and connect `TimelineModel` to `RunDetail` before deleting Activity. P5 consumes the already-specified movement helper/state prerequisites; it does not rebuild them.

All seven phases stay on `claude/dashboard-v3`. Each phase completes in the fixed order plan → build → command/browser test → adversarial review → Daniel's test before the next begins. Workers do not commit; the boss owns reviewed feature-branch commits/PR preparation and stops at that PR. Daniel alone merges and deploys.

### P1 — Shell, IA, tokens, humanization, structural surfaces

**Plan.** Capture the current import graph and route snapshots; identify Composer-only callers, Agent Platform panel exports, and CSS selectors; add failing nav, exact-token, humanization, Health-composition, and removed-route tests.

**Build scope.** In: `nav/config.ts`, `App.tsx`, `styles/app.css`, `entity/EntityDetail.tsx`, Tasks/Projects/Browser styling, new `views/Inbox.tsx` and `views/Health.tsx`, extracted `views/Schedules.tsx`, health service/route, and the shared run-stream adapter. Out: control-store schema, entity projections, schedule semantics, PTY host, learning automation, deploy, placement, `/api/v1`.

**Data/routes touched.** Add composed `GET /api/health`; rename `/api/human-inbox` to `GET /api/inbox` and narrow its P1 projection to card-backed escalations. Delete only `GET /api/approvals`; retain `POST /api/approvals/verify` as a thin caller of the canonical pinned-card verifier because `dashboard/src/lib/approvalsClient.ts#verifyApproval`, called by Tasks, still consumes it. P4 later makes that verifier publish through the same CAS/outbox service as Sweeper intents. Keep the existing schedule reader temporarily behind the extracted standalone page; wire existing control events through `foldRecords`. Standalone `/api/registry`, `/api/ledgers/slices`, `/api/panels/health`, and `/api/panels/usage` disappear only after the flyout/client callers are removed and their readers are called by Health.

**Delete.** Activity and Atlas views/routes/mini-orb; Agent Platform shell, registry, 13 panel entry modules, panel CSS; Connectors, Ledgers, Sentinel, Quartermaster, Flight Recorder; sidebar flyout components/model/hook/CSS/tests; `NewMenu`; `/api/write/stop-card`; Composer client/server entry points proven callerless; retired styles/tests/exports. Do not delete `POST /api/approvals/verify`, `/api/brain/*`, or the timeline fold/stream.

**Verify.** Windows dashboard test/typecheck/build commands plus focused server route tests. Browser: ten destinations in exact order with two unlabeled dividers; no `+ New`, Atlas orb, Activity, panel registry, or old system page; grid/list vocabulary and slide-in shell work; Health contains rows; Files/Tasks/Projects remain usable; both palettes match the token table.

**Adversarial review and Daniel test.** Search build output/source for every removed id, route, panel title, `NewMenu`, Composer entry, and retired stylesheet. Daniel completes the one-minute IA/color scan and confirms no old destination remains.

**Risks.** `App.tsx` keeps Terminal mounted across destinations, so shell deletion must not destroy active sessions. CSS selector removal can regress retained queue/file controls. Schedules extraction must not preserve registry imports.

### P2 — Agents, Workflows, Run view, gates, Schedules, Home

**Plan.** Add projector contracts and golden fixtures for agent/workflow summaries, Brief, outputs, step DAG, immutable Run owner/host/outcome, exhaustive lifecycle status, attention, store schedules, and Home. Add live/replay parity plus run/store migration dry-runs before rewriting views.

**Build scope.** In: agent roster/routes/views/detail, workflow routes/views/detail/graph, `RunDetail`, control Run fields/migrations, client/graph/event window, timeline stream, control-store schedule collection/actions/claims, one-time HEARTBEAT seed and paused-marker migrations, dispatcher local API, Home, entity builders, System declarations. Out: Linux PTY implementation, learning execution and schedule mirroring, high-level PR/deploy Inbox sources, deployment UI, cross-host placement, public v1.

**Data/routes touched.** Extend `/api/agents*`, `/api/workflows*`, and every launch call with immutable `Run.owner`, `executionHost`, terminal outcome/time, and archive provenance. Repoint `/api/control/human-requests/:requestRef/respond` to the gate-kind-aware service and keep host reports separate. Add `/api/control/runs/:runRef/events/stream`, `/api/attention`, immediate `/api/schedules` CAS actions, internal schedule snapshot/claim socket routes, and `/api/home`. Extend the existing store document/migration registry; do not add a schedule file/store. Builders use existing durable writes and launch uses the existing compiler/store service.

**Delete.** Old table roster/detail blocks, agent-collapsed workflow graph, tile run stream, `dashboard/server/dag/**` plus `registerDag` and tests after the new step-DAG projector replaces RunDetail's last `/api/dag` fetch, panel schedule routes/editor, pause-cadence route/markers/sentinel creation after migration, proposed-schedule constants/UI, old Home sections, dead fixtures/CSS.

**Verify.** Windows dashboard commands; affected Python dispatch/schedule tests; Linux oracle. Server tests cover schedule create/arm/disarm/delete immediate CAS, stale revisions, idempotency body conflict, deterministic seed import/re-import no-op, protected-main versus branch arming, `migratePausedCadenceMarkersToScheduleArmedV1`, occurrence-claim dedupe, and state-snapshot recovery. Browser: exact cards/group ordering, preserved overlay, exhaustive run status, step stream, and gate dedupe work; a schedule mutation changes its row/card immediately, opens no PR, and never shows pending; Home has only D13 sections.

**Adversarial review and Daniel test.** Try raw-id/acronym cases, ambiguous owner/outcome migration, every lifecycle kind, concurrent runs, request-less waiting, multiple gates, stale/T3 responses, event reconnects, invalid cron, duplicate seed boot, schedule-owner deletion, and direct builder path injection. Daniel runs an agent and workflow, watches one stream, resolves a non-T3 gate, and creates/arms/disarms/deletes a test schedule with immediate store results.

**Risks.** Run owner/outcome migration must abort rather than misattribute history. Seed arming depends on a verified protected-main release source, not a movable branch ref. Store snapshot/occurrence-claim failure must stop firing, while mirror failure must not stop live schedules. TypeScript and Python schedule clocks can drift without shared vectors.

### P3 — Terminal and shared session host

**Plan.** Define the `SessionHost`/broker contract and `kb-shell` Linux fixture; add failing broker identity, realpath deny-root, browser-session controller, launcher, detach/reattach, and deploy-quiescence tests.

**Build scope.** In: `runtime/capabilities.ts`, `http/surface.ts`, all `server/pty/**`, browser-session binding, `kb-shell-broker.socket`/service/bootstrap policy, session-run/transcript stores, Terminal view/styles, run-session attachment. Out: learnings, Inbox PR/deploy projection, deploy helper, general placement and v1.

**Data/routes touched.** Extend `/api/pty` handshake and `/api/pty/sessions*` with name/host/launcher/root/cwd/run ref and controller browser-session ref; every list/attach/input/resize/close checks it. Add the closed Unix broker protocol and Codex resolution. `runtimeCapabilities.pty` becomes probe output, not OS-name output.

**Delete.** Windows-only boolean, hard-coded `powershell.exe` composition, fixed repo cwd assumption, anonymous local-only tab model, duplicated run process attachment, and callerless spawn helpers/tests.

**Verify.** Windows dashboard commands and real Shell/Claude/Codex smoke tests; Linux oracle proves every child uid is `kb-shell`, repo id resolves `/var/lib/kb/ops`, worktrees alone are writable, and state/release/activation realpaths are inaccessible. Browser: full viewport/rail, named detach/reattach, and run attach work; a second independently minted authenticated browser session cannot list, attach, close, resize, or write the first session, while a same-cookie tab can reattach.

**Adversarial review and Daniel test.** Execute the PTY checklist in §9, including traversal, symlink, raw command/env, cross-session attach, root service, oversized input, and WebSocket auth/origin. Daniel logs into CLIs outside the dashboard once, launches all three modes on VM, and reattaches from another dashboard tab.

**Risks.** `node-pty` native builds differ on Windows/Linux. Broker socket ACL or systemd sandbox drift could collapse the uid boundary, so production unit tests inspect effective uid and mount/path access. A daemon/broker restart records unrecoverable children abandoned; it never claims false persistence.

### P4 — Learnings pipeline and high-level Inbox

**Plan.** Add proposal schema/parser fixtures, deterministic id tests, Implementer target-wall tests, source-truth Inbox lifecycle fixtures, read-only Sweeper intent tests, reconciliation-publisher CAS/audit tests, and schedule-mirror batch fixtures.

**Build scope.** In: System agent execution paths and supervised fixtures, `scripts/brain/**`, `agent_maintainer.py`, `agent_evals.py` adapters, proposal parser, bounded multi-path durable publisher, Inbox projector/UI, PR/card/run/STOP resolvers, read-only System Sweeper, `publishReconciliationIntent`, and store-to-HEARTBEAT mirror. Out: deploy-ready generation and helper invocation, machine release detail, general placement/v1.

**Data/routes touched.** Add `docs/proposals/learnings` schema support; replace `GET /api/inbox` in place with PR/escalation projection; add source invalidations and the audited reconciliation intent service. Implementer and schedule mirror reach only `runtimeCapabilities.durablePrWrites` through the server publisher; mirror passes one full schedule watermark and all changed HEARTBEAT targets to one `routeDurable` PR.

**Delete.** Legacy lesson/context/hygiene/model-audit/grades dashboard projection routes and tests; generic approval categories; run-ask join; read/snooze/resolve/archive/retention code; any separate PR publisher.

**Verify.** Windows dashboard commands, proposal/agent/eval Python tests, durable-write server tests, Linux oracle. Browser: only PR/escalation subjects appear; resolved fixture subjects disappear; failed source does not produce false empty. An isolated bare fixture remote plus fixture control store proves miner proposal → Implementer branch/PR → simulated fixture-main merge → implemented record/removal. Separate fixtures prove three store mutations become one mirror PR, a second fire is idempotent, changes behind an open PR form the next batch, and merge-confirmation updates `mirroredAt`. No P4 test merges the live feature branch or touches live main.

**Adversarial review and Daniel test.** Try evidence instructions, traversal/symlink, conflicting targets, partial durable failure, replayed/changed intents, direct Sweeper writes, ops bypass, stale card, failed Sweeper, mirror watermark races, and attempted run-gate injection. Daniel reviews fixture Implementer/mirror PRs, records each new write-capable path's first supervised run, and confirms the dashboard has no learning history; he does not merge live work in P4.

**Risks.** Batch commits cross multiple target walls; validation must occur before staging any path. The read-only agent/publisher boundary must survive failure and replay. External PR state can be stale, so event invalidation and scheduled reconciliation are both required; fixture merge proves logic, not live authority.

### P5 — Inbox Deploy and Health completion

**Plan.** Confirm movement §3 prerequisites and the v3 supersession of its §4 run subjects; add deployment, PTY-close, asset-pull, immutable-release, T3-token, machine-budget, and partial-failure fixtures.

**Build scope.** In: Deployment and AssetPullIntent service/store adapters, Inbox Confirm/Deploy/Inspect/Abort/Acknowledge/close-and-continue and pull/retry actions, desktop-helper client, Home version chip source, Health machine/daemon/release/deploy rows, quiescence integration, and the one-line movement §4 supersession note. Out: rewriting the helper state machine, placement, general v1/Atlas.

**Data/routes touched.** Add the closed deployment and asset-pull actions to `/api/inbox`; consume existing control-store Deployment transitions and exact PTY ids; extend `/api/health` and `/api/home`. Helper payload/result remain the movement §3 closed union. Every T3 mutation requires Daniel's WebAuthn-bound token; direct tailnet browser/curl calls without a deployed ceremony are refused.

**Delete.** Any deploy page/route, checkout-derived release status, duplicate deploy transition logic, and obsolete deployment Composer outcome UI.

**Verify.** Windows dashboard/server commands, movement helper contract tests, Linux release/status/quiescence oracle. Browser: deployment states expose only their valid Confirm/Deploy/Inspect/Abort/Acknowledge action; active PTYs offer exact close-and-continue and refuse on unconfirmed exit; asset intents pull/retry by pinned digest; missing WebAuthn disables/refuses T3. Resolved subjects disappear; Home/Health show immutable live SHA/time; no Deploys page exists.

**Adversarial review and Daniel test.** Run the helper checklist: forged node/source/attestation, unknown verb/field, repeat key, cooldown, stale revision, active PTY, failed swap, rollback, misleading symlink. Daniel deploys one tested commit and verifies the chip against service MainPID loaded-root status.

**Risks.** P5 is blocked if movement helper signing/activation prerequisites are not installed. Machine probes must be bounded so disk or MCP failure cannot stall Health.

### P6 — Placement and `/api/v1`

**Plan.** Extract service functions behind existing routes; freeze per-kind v1 ETags/watermarks/cursors; add trusted-proxy node-id, enrollment/rotation, capability subset, lease/report sequence, T3 refusal, and compatibility-route tests.

**Build scope.** In: builder declaration fields, scheduler/compiler placement, host advertisements, root-owned host-node map loader, trusted-proxy node attribution, store migration, desktop claim/report client, `/api/v1` per-kind envelopes/auth, existing-route thin adapters. Out: Atlas UI, bearer/node credentials, raw remote shell, merge or spending authority.

**Data/routes touched.** Add `HostAdvertisement` and `PlacementLease` records to the migrated control store and all endpoints in §7. Repoint current launch/summary/schedule/inbox/health routes to the same services. Desktop reports events/gate-open/outcomes to VM with node-derived host, lease revision, and sequence; it has no human-response transition.

**Delete.** Tier/platform-only run routing where capability matching replaces it, duplicated route handlers, client-side host inference, unversioned cross-host calls, dead migrations/tests.

**Verify.** Windows and Linux full suites; two-daemon integration with synthetic Gmail/browser available only on Desktop and a VM-only agent. Browser/API: VM schedules Desktop and both dashboards show one run/stream/gate; lease expiry/reclaim is safe. Contract tests cover every endpoint's exact ETag/watermark/create precondition, stale cursor, idempotency conflict, T3 WebAuthn/refusal, node enrollment/rotation/revocation, and object authorization for advertise/claim/renew/report. Old and v1 launches produce identical Run owner/host/outcome records.

**Adversarial review and Daniel test.** Run all `/api/v1` and auth checks in §9, plus forged proxy/node headers, operator calls to daemon routes, revoked rotation, false capabilities, stale advertisement, split brain, duplicate completion, out-of-order gate, host human-response attempts, lease theft, and capability loss. Daniel enrolls the Desktop node, runs a Desktop-only agent from VM, and watches it from both hosts.

**Risks.** Store migration and lease recovery are the highest data-integrity risk. Proxy node attribution and the root-owned map must fail closed during rotation; user login cannot substitute for node id. Per-kind revision domains must not be collapsed by generic client helpers. Capability names need canonical normalization.

### P7 — Final review, full test, merge, deploy

**Plan.** Freeze features; generate a current-tree deletion inventory, route matrix, payload snapshot set, and all D1–D16 browser scripts. No waiver is implicit.

**Build scope.** Only fixes found by tests/review and deletion of proven dead code. No new surface, noun, control, compatibility implementation, or product decision enters P7.

**Data/routes touched.** None intentionally; any necessary contract change returns to its owning phase tests and documentation before acceptance.

**Delete.** All remaining dead exports, routes, CSS, snapshots, feature flags, old terms, and orphan tests identified by import/route/string scans.

**Verify.** Clean installs and full dashboard/Python suites on Windows and native Linux; production build; browser matrix; live two-host placement; PTY; Inbox reconciliation. P4's fixture lifecycle remains the automated oracle. After Daniel's authorized v3 merge/deploy, he runs one live supervised Implementer acceptance, reviews and human-merges its PR, verifies the record becomes implemented and its Inbox item disappears, then triggers the final green-main deploy. Record commands, tokens' subject/digest metadata (never secret material), SHAs, and results in the phase card.

**Adversarial review and Daniel test.** Independent review executes §9 and searches for removed destinations/panels, proposed schedules, Inbox run gates, credentials/spend, agent main writes, generic T3 response, and parallel implementations. The boss presents a reviewed PR and stops. Daniel performs the §1 test, supplies the pinned T3 WebAuthn/passkey authorization, human-merges the exact reviewed SHA, and triggers Deploy through Inbox/Desktop helper or the v1 command; absent ceremony or SHA mismatch refuses.

**Risks.** Environment-only passes can conceal Linux service-user or tailnet faults; P7 requires the native Linux and two-host oracles. A merged branch is dead and is not reused after promotion.

## 11. Risks and open technical questions

| Technical issue | Required resolution before owning phase closes |
|---|---|
| Linux PTY broker boundary | Prove broker children are `kb-shell`, repo id is `/var/lib/kb/ops`, only `/var/lib/kb-shell/worktrees` is writable, and realpath access to state, `/opt/kb-releases`, `/var/lib/kb-activation`, root, sudo, and setuid all fail. |
| Transcript normalization | Establish golden Claude and Codex transcript fixtures whose replay and SSE folds are identical through `TimelineModel`; unknown provider events render as safe raw lifecycle lines, not disappear. |
| Schedule authority and clock | Prove immediate store CAS, one-time protected-main-aware seed import, paused-marker migration, Python due/claim dedupe, state-snapshot recovery, and store-to-repo mirror batching across DST/restart/race fixtures. |
| Existing undeclared cadence owners | Seed import must map every HEARTBEAT cadence to a declared RunnableRef before inserting it; an unknown or duplicate owner aborts visibly and no synthetic row is created. |
| Ambiguous agent projects | Normalize projects and choose lexical first/group order in `projectAgentGroups`; invalid projects fail validation and never inherit `buildRoster` row order. |
| Output links and symlinks | Resolve repository outputs against allowlisted roots after symlink resolution and pin external PR subjects; reject links that escape or change subject. |
| Multi-path durable publication | Extend the existing publisher atomically with a bounded path manifest for Implementer and schedule mirror; Sweeper stays read-only, card transitions use audited ops CAS/outbox, and workers never invoke git. |
| External PR reconciliation | Define bounded timeout/cache behavior when `gh` is unavailable while preserving last verified items and showing source failure; absence is never resolution. |
| Movement prerequisite drift | P5 must byte/schema-check the installed helper protocol against movement spec §3 before enabling Deploy; mismatch fails closed and creates an escalation. |
| Control-store migrations and split brain | Back up and migrate under `writerLease`; seed schedules and backfill Run owner/host/outcome without guessing, then reject old daemon, duplicate writer, expired lease, or regressing report sequence. |
| Tailnet host binding | Trusted proxy must supply LocalAPI-derived node id; root-owned enrollment/revocation mapping decides VM/Desktop, and user login/body `hostId` never substitutes. |
| T3 ceremony availability | Gate/deploy services must verify a request/revision/decision-bound WebAuthn token where installed and return `403 ceremony-unavailable` in tailnet-only deployments; no lower channel fallback exists. |
| v1 revision domains | Contract fixtures freeze each kind's ETag/watermark/create precondition and stale-cursor behavior; generic clients cannot compare hashes, store versions, and source revisions as one counter. |
| Fixture versus live merge | P4 proves lifecycle only against an isolated remote/store; P7's Daniel-authorized live merge and deploy is the sole production assertion. |
| Daemon restart and named PTYs | The UI/store distinguish detached-live from abandoned-after-restart; browser-controller binding prevents takeover, and deploy closes exact live ids only through Daniel's quiescence action. |

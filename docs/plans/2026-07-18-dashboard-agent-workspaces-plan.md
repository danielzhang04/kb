# Dashboard agent workspaces plan

**Status:** active
**Owner:** codex-worker
**Branch:** `codex/dashboard-operational-surfaces`
**Project:** `kb-ops`

## Product target

The dashboard is a local operations console for long-running Claude- and Codex-managed work. The operator starts with a conversation, reviews the resulting plan, starts a governed run, and can then inspect or steer the manager, workers, tools, commands, files, diffs, and human requests without treating Terminal tabs as the workflow engine.

The sidebar remains entity-first. This work changes the behavior behind existing destinations; it does not add schema concepts to navigation. **New** is one direct action that creates and opens a Composer workspace.

## Binding interaction semantics

### Composer

- Composer is a persistent, multi-tab conversational workspace.
- Claude is the default planning manager.
- Each tab owns an independent conversation and remains until the operator closes or archives it.
- Navigation hides Composer without unmounting active tabs, matching the persistent Terminal pattern.
- Refresh and daemon restart restore workspace metadata and visible history. Exact provider-session
  resume survives only while the dashboard session secret remains stable; otherwise the next turn
  starts a fresh provider session with a bounded rehydration of the last 12 visible turns.
- Public workspace references are opaque. Provider session IDs and transcript paths remain server-private.
- One turn may write to a workspace at a time. Other clients can read the last persisted snapshot;
  live spectator attach/replay is deferred until the managed-session event broker exists.
- Switching dashboard destinations keeps an active turn mounted. A browser refresh, network loss, or
  closed page currently stops that turn; durable background turn ownership/reattach is a later wave.
- Closing a tab, archiving a workspace, trashing a transcript, and purging data are distinct operations.
- Composer discussion does not itself mutate the KB. A structured proposal must validate before it can become a workflow definition or run.

### Runs

- A run is a durable instance of an immutable approved plan revision.
- Every run has a logical Claude Manager session as its conversational head node.
- The deterministic stage graph, attempts, gates, and results remain authoritative if the Manager process exits.
- A replacement Manager generation can rehydrate from the approved plan, durable events, decisions, and checkpoints.
- Workers and managed child sessions are individually inspectable. Native opaque subagents are only independently controllable when the runtime exposes that capability.

### Automatic execution

- A run starts with one operator action and proceeds automatically inside its approved scope.
- Browser input cannot choose arbitrary CLI flags, environment, working directory, tools, or permission bypasses.
- Server-owned execution profiles define the allowed runtime capabilities.
- Global governance, project contracts, the approved plan, and runtime capability policy are all enforced before and during execution.
- Ambiguous or prose-only rules fail closed until represented by executable policy.
- Contract-required review, approval, risk, secret, spending, publication, and scope-change boundaries stop the run and create a durable Human Request.

### Routing

| Target | Model/runtime change |
|---|---|
| Composer proposal | Apply immediately and mint a new proposal revision/hash. |
| Queued or blocked stage | Apply with compare-and-swap revision, then revalidate. |
| Approval-bound stage | Freeze; amend the plan and collect a new content-bound approval. |
| Active session with supported same-runtime switch | Apply only at the next safe checkpoint. |
| Active session without switch support, or any runtime change | Create a successor attempt with an explicit handoff. |
| Completed, rejected, or halted attempt | Immutable; Retry creates a successor attempt. |
| Agent default | Prospective only for future sessions and child agents. |

### Human Requests

- One durable Human Request appears in both Human Inbox and its originating Run.
- It can represent input, approval, review, intervention, or governance refusal.
- Inline responses are content/revision-bound, idempotent, authenticated, and audited.
- The response commits before a manager is signaled or a stage is released.
- Material scope or risk changes become plan amendments, not unreviewed prompt injection.

## App-local foundation

The first foundation is local operational state, not a new coordination database and not a change to `governance/card-schema.md`.

```ts
interface ComposerWorkspace {
  composerRef: string;
  owner: string;
  title: string;
  state: 'open' | 'archived';
  createdAt: string;
  updatedAt: string;
  sourceComposerRef: string | null;
  providerSessionId: string | null; // server-private
  turns: ComposerTurn[];
}

interface ComposerTurn {
  turnId: string;
  prompt: string;
  state: 'running' | 'completed' | 'stopped' | 'failed';
  model: unknown;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}
```

The production store is local-only and outside git coordination truth. It is atomically replaced,
subject-bound, and stores provider resume capabilities in encrypted server-private state. Tests use an
in-memory implementation. Storage inventory and retention bounds are explicitly deferred to Wave D;
this wave does not claim automatic cleanup or a hard disk quota.

Initial APIs:

```text
GET    /api/composer/sessions
POST   /api/composer/sessions
GET    /api/composer/sessions/:composerRef
POST   /api/composer/sessions/:composerRef/turns
POST   /api/composer/sessions/:composerRef/fork
POST   /api/composer/sessions/:composerRef/archive
POST   /api/composer/sessions/:composerRef/restore
```

## Delivery sequence

### Wave A - truthful workspaces

1. Add the app-local Composer workspace store, opaque references, subject binding, and single-writer lease.
2. Replace browser-carried provider resume IDs with workspace-scoped turns.
3. Add list/create/detail/fork/archive/restore routes and adversarial route tests.
4. Make **New** direct and add persistent multi-Composer tabs with autosaved history.
5. Simplify the prompt control: one send affordance while idle and one stop affordance while running.
6. Freeze routing edits on active, approval-bound, and terminal card states; explain Retry/successor semantics honestly.

### Wave B - plan compiler and run control plane

1. Define a schema-constrained proposal protocol for tasks and workflows.
2. Parse assistant proposals as untrusted data, validate server-side, and show an inspectable diff from the prior revision.
3. Start a run from a reviewed immutable proposal snapshot.
4. Add app-local run, stage, attempt, managed-session, and event projections linked to canonical cards.
5. Provision the resumable Manager head without making it the dependency engine.

### Wave C - operational cockpit and human interaction

1. Normalize Claude and Codex operational events and transcript metadata.
2. Add Run views for manager/workers/child sessions, prompts, tool calls, commands, output, files, and diffs.
3. Never expose hidden chain-of-thought; display only user-visible text and operational trace.
4. Introduce a human-reviewed durable Human Request schema and waiting-human transition.
5. Implement inline Respond, Approve, Reject, Request changes, Stop, Retry, and Reroute in both Runs and Inbox.

### Wave D - governed automatic execution

1. Compile global governance, project contracts, approved plan scope, and runtime capabilities into executable policy decisions.
2. Add server-owned automatic execution profiles for Claude, Codex, and later adapters.
3. Add canonical result integration and dependent release without widening worker credentials.
4. Add isolated per-run worktrees, bounded parallelism, skills/capability resolution, accounting, and manager recovery.
5. Add retention inventory, dry-run cleanup prompts, quarantine/restore, and only then a human-ratified purge cadence.

## First-wave acceptance

- Clicking **New** creates a fresh Composer tab directly; there is no entity dropdown.
- Two Composer tabs can run independent conversations without sharing provider session IDs or prompts.
- Leaving Composer does not close a running turn or remove tabs.
- Refresh restores workspace tabs and conversation history; any turn interrupted by the refresh is
  visibly stopped rather than silently claimed as running.
- Restarting the daemon preserves metadata and permits a valid subject to continue its own workspace,
  using exact provider resume when its encrypted handle is readable and bounded visible-context
  rehydration otherwise.
- The browser never receives a Claude provider session ID or transcript filesystem path.
- Concurrent sends to one workspace return a deterministic conflict; separate workspaces can run concurrently.
- Archive hides a workspace without deleting its transcript; restore reverses archive.
- Active, approval-bound, done, rejected, and halted cards do not offer a misleading in-place routing mutation.
- The full dashboard tests, typecheck, and production build pass.

## Deferred gates

- No Broker activation until its existing subscription-ToS and threat-review gates are approved.
- No arbitrary Claude execution adapter is claimed until the server-owned auto profile and executable policy boundary exist.
- No automatic transcript purge occurs until the operator ratifies retention thresholds and the cleanup path has passed dry-run and quarantine tests.
- Atlas is an eventual acceptance workload, not part of this implementation run. A synthetic low-risk workflow validates the platform first.

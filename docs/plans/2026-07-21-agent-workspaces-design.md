# Agent workspaces and unified workflow registry

_Date: 2026-07-21. Status: design / implementation decision record. Scope: the KB Agents and Workflows dashboard surfaces, using the existing Claude-oriented Composer, control-plane, and workflow-definition infrastructure._

## Decision summary

1. `agents/<id>.md` is the authoritative declaration of a fleet agent. Queue cards and ledgers are observations of that identity, not substitute definitions.
2. The dashboard must render declared configuration and observed runtime separately. It must never infer that an observed owner is runnable, or that a declared agent has ever run.
3. `fyt-producer` is removed from `agents/`, not retained as a dashboard-visible tombstone. Git history preserves the old definition. `fyt-runner` is the one active FYT agent declaration.
4. An agent workspace is a constrained reuse of Composer's durable, operator-owned conversation/session model. It is not a new direct-shell or ungoverned agent runner.
5. The only workflow registry is `orgs/<project>/workflows/*.md`, validated by `parseWorkflowDef`, compiled by `compileWorkflowDef`, and served by `/api/workflows`. The root `workflows/wf_*.md` registry and embedded `workflow-v1` format are legacy and must be retired from the Workflows UI and Composer creation path.
6. Keep **one** FYT Runner conductor. Do not split it into fixed chronological thirds. The workflow supplies stage workers and fresh-context reviewers at the correct gate boundaries; the conductor keeps the gates, state, staging merge, and human conversation coherent.

## What is true today

The new agent registry work already made the current two declarations readable by the server: `dashboard/server/agents/roster.ts#readDeclaredAgents` reads the YAML frontmatter in `agents/*.md`, and `buildRoster` unions it with queue-card owners and ledger writers. `AgentDetail` already renders purpose, declared runtime/model, and the honest `runner-bound` flag. The missing pieces are (a) a full authoritative definition/source view, (b) a supported interactive workspace and run route for a declared agent, and (c) removal of the old producer from the registry.

The dashboard currently has two incompatible workflow concepts:

- Legacy registry: `dashboard/server/registry/workflows.ts` reads root `workflows/wf_*.md`, optionally extracts an embedded `workflow-v1` JSON fence, and `Composer` creates that same shape.
- Definition registry: `dashboard/server/workflows/{defs,compile,routes}.ts` reads `orgs/<project>/workflows/*.md`, validates a closed YAML schema, compiles to `kb.plan-proposal/v1`, and launches through the existing proposal/control-plane path.

The latter is already the real model for `orgs/faceless-youtube/workflows/video-run.md`; it is valid (`id: video-run`, profile `producer`, 14 dependency-checked stages), visible through `GET /api/workflows`, and launchable only through the governed route. A workflow exists now in the repository, but the parallel legacy empty-state and Composer authoring route make the product look as though none is registered.

## Terms that the UI must use consistently

| Term | Meaning | Authority |
| --- | --- | --- |
| Declared agent | Durable definition at `agents/<id>.md`: identity, role, default runtime/model, description, project hints, and runner binding status. | `agents/<id>.md` |
| Observed identity | A string seen as a queue owner and/or ledger writer. It may be stale, human-created, or have no definition. | queue / ledger projection |
| Runtime binding | A human-established process able to claim this exact owner identity. `runner-bound: true` is the declaration's status claim; a successful execution is separate evidence. | human provision + execution records |
| Agent workspace | An operator-owned, durable conversation about one declared agent, with a provider session handle held privately and resumable only for that operator. | Composer store/session safeguards |
| Workflow definition | A reusable, validated project artifact describing a DAG of governed stage envelopes. It is not a run and does not itself execute. | `orgs/<project>/workflows/*.md` |
| Workflow run | One approved, launched instance of a definition. Its canonical cards, attempts, managed sessions, events, and human requests are execution evidence. | control-plane store + canonical cards |

## Declared versus observed agent model

The Agents list should become a single roster with an explicit **kind/provenance** column, not two unrelated pages:

- A declared row is created from every valid `agents/<id>.md`, including an idle agent with no cards or ledger rows.
- Its observed section aggregates queue ownership and ledger activity under the same `id`; `sources` remains an evidence list (`queue`, `ledger`), never a definition source.
- An observed-only row remains visible for reconciliation but is labelled **Observed only — no `agents/<id>.md`**. It has no declared purpose, codebase, runner claim, or Run button.
- A malformed declaration must show a bounded validation diagnostic keyed by file path rather than silently disappearing. The current fail-open reader is correct for availability but wrong for a human control surface because it hides the configuration defect.

The detail needs these sections, all facts with their source:

1. **Definition** — full rendered Markdown body plus structured frontmatter; a direct repo path; role link; declared project hints; runtime/model defaults; `runner-bound`; and the definition revision/content hash. This answers “what FYT does” and “what its code base is” without inventing an executable codebase: the source is the agent declaration, linked workflow definition, project router, and owned skills.
2. **Runtime** — declared binding status, effective routing (existing governed override control), last successful run/attempt, active managed session, and a truthful state: `not bound`, `ready`, `running`, `waiting-human`, `failed`, or `idle`. `runner-bound: false` must visibly disable “Run agent”.
3. **Workspace** — current and prior conversations for the declared id, each operator-owned and resumable; link their proposals and runs. This is distinct from queue-card history.
4. **Work** — the existing cards, managed runs, attempts, stages, events, and human gates, joined through explicit stable references rather than only queue-owner inference where a control-plane run exists.
5. **Observed evidence** — ledger totals and queue/ledger provenance retained from the current detail.

No row may display a generic dashboard runtime/model as the agent's declared runtime. The current `effective` routing must remain separately labelled live policy resolution; declared frontmatter is advisory and never overrides governance by itself.

## FYT Runner: source, workspace, and launch behaviour

`fyt-runner` should declare `projects: [faceless-youtube]` (the Composer agent draft already writes that established field). Its Agent Detail must make the following source chain first-class and clickable:

```
agents/fyt-runner.md                         declaration and conductor law
  -> orgs/faceless-youtube/                   project/codebase router
  -> orgs/faceless-youtube/CLAUDE.md          project operating syntax and file map
  -> workflows/video-run.md                   DAG of record / dashboard definition
  -> workflows/segments/*.workflow.js         optional workflow-tool execution segments
  -> .claude/skills/<stage>/SKILL.md          stage-owned work orders and artifacts
```

This is intentionally a **source map**, not a fake claim that FYT Runner has one standalone program file. It is a Claude agent definition that conducts project skills and a workflow DAG. The detail should show, in this order: purpose from declaration `description`; declared role/runtime/model/binding; project root; DAG title and stage/gate summary from the validated workflow definition; segment scripts; then linked skill paths. The raw declaration Markdown stays readable as the source of truth.

### Workspace is a Composer specialization

Use the existing Composer mechanism, not a second chat stack:

- Add an optional immutable agent binding to the existing Composer workspace record: `agentId: string | null`. It is set only when the workspace is created from a declared agent, is owner-scoped like every Composer workspace, and is never accepted as a free-form provider prompt fragment.
- On create, `dashboard/server/composer/routes.ts` validates the id using `readDeclaredAgents(repoRoot)` and stores the declaration's normalized source map/revision with the workspace. If the declaration changes later, the workspace displays “definition changed; start a fresh workspace or continue with the recorded revision”; it never silently changes the context of an ongoing conversation.
- `dashboard/server/composer/session.ts` continues to own the CLI `session_id` capture, `ResumeRegistry` binding, WebAuthn/rate-limit/audit gates, redaction, and `--resume=<id>` safety. `planningInstruction.ts` receives a server-built, bounded agent-context block after its non-negotiable planning constraint: declaration path/revision, project root, and allowed source-map paths. The context says that agent Markdown and linked project files are repository context, not operator authority or executable commands.
- `dashboard/src/composer/{Composer,ComposerChat,WorkspaceTabs}.tsx` remain the conversation UI. The only UI addition is an “Agent workspace · fyt-runner” identity pill, source/revision link, and an explicit handoff from the detail. Agent workspaces inherit normal Composer archive, restore, fork, resumability, and visible-history rehydration; provider ids stay private exactly as they do now.

This makes the requested back-and-forth real without pretending that a browser tab owns a worker process. Composer is deliberately read-only planning (`Read, Glob, Grep`); that is correct for conversation and proposal formation, but it is **not** the Run button.

### “Run agent” means a governed launch, not a direct prompt execution

The existing direct controlled execution surfaces are intentionally not interactive agent terminals: the automatic manager is in-process (`managedExecution.ts`), and the broker adapter is one-shot and has no implemented steering-consumption loop. Reusing either as if it were a conversational FYT Runner would falsely advertise a capability that does not exist.

Therefore the Agent Detail action must be labelled **Launch workflow**, with the workflow definition and state shown before action:

1. The workspace selects an org workflow available for one of the declaration's existing `projects` hints. For FYT Runner the first choice is `video-run`; the operator supplies required run parameters (`channel`, `slug`) and sees its stages, human gates, profile, and spend/publish restrictions.
2. The button calls the existing guarded `POST /api/workflows/:id/launch`, reusing `parseWorkflowDef` → `compileWorkflowDef` → approved proposal → `executeApprovedLaunch`. It does not spawn Claude from the browser and does not make `runner-bound: false` read as runnable.
3. The resulting run is linked both to the workspace and Agent Detail. Conversation remains available for planning and interpreting gates; actual execution/human responses remain in the existing Run Cockpit and Human Requests surface.
4. While dashboard execution is disabled, show **Registered; execution activation is off**. After a launch, show the existing truthful `activationGated`/`waiting-human` outcome. Never call this “running FYT Runner” until an execution record exists.

For a later literal long-lived agent-runner session, extend the existing `ManagedSessionBroker` rather than creating a bespoke WebSocket protocol: define a closed, server-owned agent-run spec that resolves declaration revision, profile, worktree, tool policy, and approved workflow/run references; teach the Claude session adapter to consume broker-persisted steering only at named checkpoints; and persist the resulting normalized events in the same run. That is a separate activation increment, gated by a proven one-workflow slice. It is not necessary to give the operator a useful first-class FYT conversation and governed workflow launch now.

### FYT decomposition recommendation

Do **not** divide FYT Runner into “first third / second third / last third” agents. The divisions would be arbitrary and would break at the very places this pipeline is designed to protect: script approval, paid generation authorization, image review/stamping, shot-board review, render verification, and publish approval.

Keep one `fyt-runner` manager/conductor with these non-delegable responsibilities:

- inject the operating-law clauses and current run context;
- own the gate spine, `parked` state, human requests, spend/publish boundaries, resume state, and run report;
- own staging-to-root merges and root-path re-lints under the single-writer rule; and
- aggregate fresh review verdicts but never self-stamp generation output.

The existing `video-run` DAG is the decomposition: stage workers are ephemeral work orders routed to their owning skills; image review is independent fresh-context work; the human owns Gates 1–3. The segment files (`segment-a`, `segment-b1`, `segment-b2`, `segment-c`) are useful *execution cuts* at human gates, not new persistent agent identities. If scale later proves a bottleneck, add role-specific reviewers or an asset-generation worker only after they have an exclusive artifact boundary and a measured failure mode; do not create three managers that all believe they can advance the same run.

## Unified workflow definition and registry

A workflow is a **reusable, versioned project DAG that compiles to a governed proposal**. It contains a project, server-owned execution profile name, stage ids/titles/actions/targets/work orders, dependency edges, and risk tiers. It has no run state, provider session, live output, or implicit authority to spend/publish. A run is the separately-created instance that owns those facts.

The canonical definition grammar is already implemented in `dashboard/server/workflows/defs.ts`:

```text
orgs/<project>/workflows/<name>.md
  YAML: id, project, title, profile, stages[]
  Markdown body: human description / fallback work order
  validation: closed fields, safe paths, known profile, risk floor, DAG acyclicity
  compile: kb.plan-proposal/v1
  launch: canonical proposal -> approval -> run -> cards/attempts/events
```

`video-run.md` is therefore registered as soon as the dashboard's `repoRoot` includes this checkout and `GET /api/workflows` returns it as `valid`. The immediate implementation acceptance check is a dashboard/API test against the live repo root that asserts `video-run` appears, has profile `producer`, and exposes its 14 stages; it must not rely on the legacy `/api/registry` slice.

### Registry unification decision

Retire the root-level `workflows/wf_*.md` indexer (`dashboard/server/registry/workflows.ts`) from the Workflows destination and from `GET /api/registry`. It uses an unrelated optional embedded JSON fence and has no relationship to the org-definition compiler. Because the current root registry is empty, this is a removal rather than a content migration.

Update Composer's Workflow draft to write the same org definition grammar at `orgs/<project>/workflows/<slug>.md` and validate it against the same server source of truth. Do not preserve `workflow-v1` creation “for compatibility”; it creates a second kind of workflow that cannot faithfully be shown with the project definitions. If backwards compatibility is needed for an existing root file, supply a one-time import/migration command that emits a proposed org definition for human review, then delete the legacy file only after the new definition validates. No workflow is “registered” merely because Composer saved prose.

The Workflows page should show one list only, driven by `/api/workflows`, with these fields: project, definition path, validity/error, profile, highest tier, gate/stage DAG, source revision/hash, and runs. “Launch” must preserve the existing passkey, origin, rate-limit, idempotency, proposal, approval, and activation behavior. Invalid definitions stay visible with their exact parser diagnostic; they cannot launch.

## Incremental implementation plan and exact seams

### Increment 1 — make the registry truthful

1. Delete `agents/fyt-producer.md`; do not replace it with a tombstone file. Update only references that present it as a current agent. The old text remains recoverable from Git history.
2. Update `agents/fyt-runner.md` frontmatter to include the established `projects: [faceless-youtube]` declaration hint. Do not set `runner-bound: true` unless a human has actually provisioned and verified an exact runner binding.
3. Extend `dashboard/server/agents/roster.ts` declaration projection to retain `projects` and a bounded source revision/digest. Keep its filesystem hardening (no symlinks, byte cap, UTF-8).
4. Add a declaration validation projection (not a silent fail-open replacement) so `GET /api/agents` returns declared entries plus malformed-file diagnostics. `readDeclaredAgents` can remain safe/empty for assignment; the detail/list needs a separate non-authorizing diagnostic view.
5. Extend `dashboard/src/views/{Agents,AgentDetail}.tsx` and their tests with the declared-versus-observed model and Definition/Runtime/Workspace/Work/Evidence sections. `AgentDetail` must read the full source only through a bounded read-only server route; it must not use client-side filesystem assumptions.

### Increment 2 — agent workspaces without a new chat stack

1. `dashboard/server/composer/store.ts`: add immutable nullable `agentId`, `agentSourceRef`, and `agentSourceHash` fields to `ComposerWorkspace`/public DTO and persist them alongside the existing subject-bound workspace. Fork retains the binding and recorded revision; an unbound Composer workspace remains byte-for-byte equivalent.
2. `dashboard/server/composer/routes.ts`: extend `POST /api/composer/sessions` with a closed `{ agentId? }` creation input. Resolve it server-side with the declaration reader and reject unknown/observed-only ids. Return the public agent binding, never raw provider ids or unrestricted file bodies.
3. `dashboard/server/composer/session.ts` plus `planningInstruction.ts`: accept a typed, server-built `AgentWorkspaceContext`; compose it with the existing read-only planning instruction and continue to use `spawnComposerTurn`, `ResumeRegistry`, and existing audit action. Do not add browser-chosen CLI flags, cwd, model, tools, or direct `--resume` input.
4. `dashboard/src/App.tsx`, `dashboard/src/composer/{workspaceClient,WorkspaceTabs,Composer,ComposerChat}.tsx`: add `openAgentWorkspace(agentId)`, preserve mounted-tab behavior, and show immutable binding/revision in the UI. `AgentDetail` owns the entry point. Reuse the current archive/restore/fork controls.
5. Tests: ownership isolation, unknown agent refusal, source revision persistence, resumed multi-turn conversation, redaction, no provider-id exposure, and proof that a generic Composer session has no agent context.

### Increment 3 — make the run path honest and useful

1. Add a presentational `Launch workflow` action to `AgentDetail`; populate choices from the canonical `/api/workflows` list filtered by declared project hints. FYT Runner initially selects `video-run`.
2. Reuse `dashboard/server/workflows/routes.ts#launchDefinition` and `executeApprovedLaunch`; the new control passes a client idempotency key and then links the returned `runRef` to the initiating Composer workspace in the control-store provenance. It never substitutes a new executor or a browser process spawn.
3. Update `dashboard/server/control/{types,store}.ts` and `dashboard/src/control/entityLinks.ts` only enough to store/query the optional originating workspace and declared agent id for a launch. Keep the canonical card join as compatibility evidence, but prefer this explicit provenance for agent-workspace launches.
4. The Run Cockpit remains the execution/live-state surface. The workspace offers “Open run”; human approvals remain Human Requests, not free-form chat messages. With `DASHBOARD_EXECUTION_ACTIVATED` off, report the existing activation-gated outcome.
5. Do not implement a persistent interactive executor in this increment. Its prerequisite is an end-to-end broker steering checkpoint protocol with a real activated worker/manager test; until then conversation is planning and execution is a governed run by design.

### Increment 4 — remove the parallel workflow format

1. Remove legacy workflow rows from `dashboard/src/views/Workflows.tsx`; it fetches `/api/workflows` only. Remove `registry.workflows` from `dashboard/server/registry/{routes,workflows}.ts` once no other caller uses it, with a migration notice/release note rather than dual display.
2. Replace the legacy `WorkflowDraft` and `workflow-v1` fence production in `dashboard/src/composer/artifactTypes.ts` with an org-definition draft. Its client form is an honest preview; server validation is `parseWorkflowDef` only.
3. Provide a governed durable save route/plan for exactly `orgs/<project>/workflows/<name>.md`. The server must validate the proposed source before save or show the exact rejection. It must not create `workflows/wf_*.md`.
4. Preserve `dashboard/server/workflows/{defs,compile,routes}.ts`, `control/launch.ts`, execution profiles in `control/environment.ts`, risk classification in `control/policy.ts`, and the current tests as the one compiler/executor line.

## Acceptance criteria

### Agents

- The roster has exactly one declared FYT agent, `fyt-runner`; no `fyt-producer` row appears from an agent declaration.
- An observed-only owner remains visible but is clearly marked as such and cannot open a runnable workspace or launch action.
- Opening FYT Runner shows its purpose, declaration body/path/hash, project root, effective versus declared model/runtime, `runner-bound` truth, source map, linked `video-run` workflow, segments, skills, cards, and runs.
- Changing a declaration after a workspace begins does not silently alter its retained agent context; the UI exposes the recorded source revision.
- Two users cannot read, resume, fork, or launch from each other's agent workspace; raw Claude session ids and hidden reasoning never cross the public API.

### Conversations and runs

- From FYT Runner an operator can create/reopen a durable multi-turn workspace, ask planning questions, and resume after a reload using the existing Composer safeguards.
- “Launch workflow” does not appear as “run agent directly”; it names `video-run`, its profile, stages, human gates, and bounded action before launch.
- Launch produces the same content-addressed proposal/run/card sequence as the existing workflow route, is idempotent, and links the resulting run back to the workspace and agent declaration.
- With activation disabled, no worker/Claude process is spawned. With activation enabled, run state, stages, human requests, and events appear only in the Run Cockpit; human Gate 1/2/3, spend authorization, and publish boundaries remain enforced.

### Workflows

- `GET /api/workflows` lists `video-run` validly from `orgs/faceless-youtube/workflows/video-run.md` and returns its 14 stages/profile `producer`; the UI makes this visible without a root `workflows/` directory.
- There is one Workflow list and one canonical definition grammar. Composer-created workflow drafts validate and save as org workflow definitions; they compile through the same parser/compiler/launch chain.
- An invalid org definition remains inspectable with the parser error and cannot launch. A legacy root workflow is either migrated once or not displayed; no dual registry survives.

## Risks and decisions deliberately not hidden

- **Current dashboard execution is intentionally gated.** The presence of a workflow definition does not make it run; activation must be on and its control-plane constraints must accept the proposal. The UI must surface this condition at the button, not after an opaque click.
- **FYT's paid stages cannot be honestly automated by the generic policy today.** The workflow definition documents image/TTS authorization, but `evaluateExecutionPolicy` currently refuses `requestsSpending`; retain the human/card gate and do not “fix” it by loosening the generic policy. A dedicated, reviewed spend-authorization bridge is a later project decision.
- **`runner-bound` is not proof of a live runner.** It is a human assertion about provisioning. Show actual run/attempt evidence separately and never auto-flip the field.
- **The existing manager is not a persistent conversational conductor.** It is in-process by design, while the broker session adapter is one-shot. Treating queued steering as live dialogue before the adapter consumes it would be a safety and UX lie.
- **The FYT declaration is large Markdown, not executable source.** Render/read it as a bounded file and use explicit repo paths for source map links; do not parse arbitrary prose into authority, capabilities, or workflow launches.
- **Do not split FYT to satisfy an organizational diagram.** The conductor boundary is defined by gates and single-writer ownership, not equal elapsed-time thirds. A split is warranted only with an exclusive artifact interface, an accountable owner, and a tested recovery boundary.

## Verification sequence for the implementation PR

1. Unit test declaration parsing/diagnostics and declared-vs-observed roster fixtures, including deletion of `fyt-producer`.
2. UI tests for Agent Detail source map, disabled/available actions, workspace handoff, and declared/effective distinction.
3. Composer store/route/session tests for agent binding, ownership, resume safety, source revision, and unchanged unbound behavior.
4. Workflow parser/route/UI tests using the real `video-run.md` via the existing live-worktree loader; verify no legacy registry dependency remains.
5. Control-plane launch test proving the agent-workspace action reuses the exact canonical workflow launch body, idempotency, and activation gate.
6. A single no-spend FYT dry-run slice to the first human gate before any paid stage or persistent-manager expansion is considered. This validates the direction without spending against unreviewed orchestration.

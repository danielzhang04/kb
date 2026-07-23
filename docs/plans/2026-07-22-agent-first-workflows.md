# Agent-first workflows and agent roster

## Outcome

The dashboard presents declared agents as the primary objects an operator creates and works with.
Registered runtime workers remain inspectable in a collapsed secondary panel. Humans and identities
seen only in queue or ledger history are not part of either roster.

Workflow definitions remain stage DAGs for dependency, retry, gate, and resume semantics, while the
workflow UI projects that DAG as an agent-first graph. Agent nodes own groups of stages and handoff
edges summarize cross-agent dependencies.

## Model

Ownership and execution assignment are deliberately separate:

- `governedBy` on a workflow identifies the declared agent that governs the workflow.
- `governedBy` on a stage identifies the declared agent accountable for that stage.
- Existing `manager.agentId/profileId` and stage `agentId/profileId` remain executable assignments.
- Ownership may point at an unbound declared agent. It never makes a workflow launchable.
- Execution assignment keeps the existing runner-bound, profile, runtime, model, and activation gates.

The server validates ownership IDs against declared agents and project membership. The browser never
infers FYT ownership from stage names.

## User experience

### Agents

- The main roster contains only `agents/*.md` declarations.
- A collapsed **System workers** disclosure contains only `default_worker` identities from
  `governance/model-routing.yaml` that are not already declared agents.
- Human identities and historical queue/ledger-only identities are omitted.
- Opening a declared agent enumerates workflow-manager ownership, governed stages, stage inputs
  (`dependsOn`), outputs (`action` and target), review relationships, completion gates, declared
  profiles, codebases, and runner status.

### Workflows

- Workflow detail opens on an **Agents** section rather than a flat stage-first table.
- Declared agents are graph nodes. Stages are cards inside their owner node. Unowned stages sit in an
  explicit Unassigned node.
- Cross-owner stage dependencies become aggregated handoff edges; the underlying stage DAG remains the
  source of truth.
- Nodes can be repositioned by drag. Stage cards can be dragged between owner nodes to create an
  ownership draft.
- Ownership edits are reviewed as one batch before durable save; execution assignments remain a
  separate advanced control and keep their current human-merge path.
- Clicking an agent node shows exactly what it governs and links to the agent detail.

## FYT ownership

- `fyt-runner`: workflow manager; no artifact-producing stage.
- `fyt-preproduction`: idea, research, script, shorts, metadata, shots, motion.
- `fyt-production`: images, voiceover, audio-plan, render.
- `fyt-checker`: judge-gate, image-review, verify.

All four declarations remain `runner-bound: false`; no activation, spend, upload, publish, or external
action is added by this change.

## Verification

- Parser tests prove ownership is closed-shape, safe-ID, declaration-independent syntax.
- Registry tests prove ownership is exposed without affecting compilation or launchability.
- Agent API tests prove governed stages and handoffs are derived from canonical workflow data.
- Agents UI tests prove declared-only primary roster and default-hidden runtime workers.
- Workflow UI tests prove agent grouping, click-through governance detail, drag drafting, and preserved
  execution-assignment controls.
- FYT registration tests pin the ownership map and continue pinning all runner bindings false.
- Typecheck, focused dashboard tests, build, full dashboard suite, canary guard, and merge simulation run
  before handoff.

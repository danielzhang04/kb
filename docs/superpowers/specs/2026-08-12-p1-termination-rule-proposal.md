# P1 iteration-group termination rule

**Date:** 2026-08-12

**Status:** Locked by Daniel for P1 implementation planning

**Authority:** `2026-08-11-workflow-platform-design.md` remains the arc authority. Daniel's rulings below supersede the earlier draft of this proposal.

## Decision in one paragraph

Generalize the existing `ReviewLoop` into one durable `IterationLoop` primitive for N declared
participants. Every participant has an immutable role, perspective, and mandate. Every permitted
sender-to-recipient route, artifact set, cycle unit, and positive `maxCycles` value is declared in the
workflow definition. There is no platform default and no platform policy ceiling. A loop terminates
successfully as soon as an authorized participant records the configured semantic acceptance verdict,
at any round count. Pairwise review, manager/judge review, mediated debate, and a coordinator-led crew
are configurations of this primitive, not separate engines. If the declared bound is exhausted, the
platform never silently passes or truncates the work. It parks at a human gate with the complete
unresolved residue visible. Run budget windows and a byte-identical no-progress check remain mandatory
platform backstops for every configuration.

## Daniel's rulings, 2026-08-12

These statements are the binding product rulings for this decision:

> "There's no default. If agent X says fix this, passes it back to agent Y who fixes, passes it back to agent X who reviews and says 'Oh, this looks great', then it moves on."

> Debate "was just an example of agents interacting and feeding information back to each other."

> "In image gen, I don't want 15 loops. But if it's a debate, I might want 15 loops. Or if it's a critic, I won't want 15 loops, but I don't want shit left on the table... It depends."

> "If we're doing an FYT feedback on shots.json... it should be maybe once. MAYBE twice. If we're doing a full write of an essay, or building out a large spreadsheet, certain use cases might take more. Like I have a styler, a builder, a checker, and a researcher, and a coordinator right? Somewhere it should declare and enforce perhaps. Or a manager with goals. Or agent has goals."

## General primitive

An iteration group declares:

- a stable group id and a group goal, or an equivalent goal carried in an accepting manager or
  coordinator mandate;
- N participants, each bound to one workflow stage and carrying an immutable role, perspective, and
  mandate in the approved definition snapshot;
- the allowed directed routes between participants;
- a deterministic schedule for choosing a route and turn owner;
- the artifacts and criteria the group owns;
- a required positive safe-integer `maxCycles`, chosen for that use case;
- a required, human-readable `cycleUnit` that explains exactly what consumes one cycle; and
- the participant and verdict combinations authorized to terminate the group successfully;
- optionally, a definition-declared post-acceptance completion gate that withholds downstream release
  after semantic termination without scheduling another participant turn.

The platform does not infer a topology from participant count or role names. It validates the
declaration, binds it into the approved proposal and run snapshot, and executes the same state machine
for every group. Roles describe responsibility. Routes and terminal authorities determine behavior.
The compiler derives the stage-level dependency wiring required by those routes. Every declared route
compiles into whatever `dependsOn` and base-resolution linkage the engine needs so every participant turn,
including a non-seed peer, mediator, or coordinator turn, reaches server-side generation pinning. A
fan-in turn pins the current generation of every routed peer, never a legacy generation-one fallback.
Derived `dependsOn` stays acyclic: it carries only the seed/activation direction. Reverse-route base
pinning rides a per-turn dependency list supplied to `resolveBase`, not a DAG edge — bidirectional
routes never compile into a cyclic stage dependency graph.

Goals may live at group level or in a mandate-carrying participant such as a manager or coordinator.
Every participant still has a mandate. A perspective states the participant's stable lens, constraints,
or constituency. Neither may be rewritten by a turn result or by another participant.

### One channel: commits plus structured requests and receipts

Participants do not free-chat. Each turn consumes a server-created `IterationRequest` tied to exact
artifact generations and commits. It names the sender, recipient, route, group, cycle, criteria,
unresolved findings, requested disposition, preserved invariants, and the next acceptance check. The
recipient returns one closed-schema `IterationOutcome`. After canonical integration, the server binds
that outcome to lineage and mints the durable `IterationReceipt`. Prose is bounded evidence inside those
objects, not authority.

This is the same safety model already used by review generation pinning. The engine selects the input
generation and base commit. A worker cannot redirect the turn, substitute a different artifact, enlarge
its role, change the mandate, or increase the bound.

## Termination and backstop rules

### Semantic termination is primary

After validating a receipt and its artifact lineage, the engine first asks whether its sender and
verdict match a terminal authority declared by the definition. If so, participant scheduling stops
immediately and the engine pins the exact accepted artifact generation. The round count does not delay
or invalidate acceptance. A definition-declared post-acceptance completion gate may still withhold
downstream release, but it cannot reopen the loop or add a cycle. Peers may be terminal authorities. A
judge is not required.

Examples of semantic termination include a reviewer recording `accept`, a judge recording `pass`, a
mediator recording `consensus`, or a coordinator recording `complete` under its mandate. A role label by
itself grants no terminal authority.

### The definition owns the bound

Every iteration group must declare `maxCycles`. The validator rejects a missing, zero, negative,
fractional, or unsafe-integer value. It imposes no product default, recommended value, or maximum. The
definition also declares the cycle unit, so the value is reviewable and legible before launch.

If a valid nonterminal receipt would require another cycle after `maxCycles`, the engine does not start
that turn. It atomically records exhaustion, preserves the full residue, and opens an `iteration-park`
gate with reason `exhausted`. There is no successful fall-through at the bound.

### Nothing left on the table

An exhaustion park exposes, at minimum:

- every unresolved finding and criterion status;
- each participant's latest recorded position, including dissent;
- all requests and receipts with their participant, cycle, artifact generation, and commit bindings;
- the active and previously accepted artifact references;
- the route that would have run next; and
- the declared cycle unit, cycles used, and bound.

The human may approve the exact parked artifact set or decline it. Approval marks the group passed and
pins that set. Decline marks the group declined and prevents successful run settlement. Neither decision
adds an in-place cycle. A declined `iteration-park` gate settles the run `failed`. More work requires a
separate operator relaunch with a new run lineage. Changing
the bound requires a newly approved definition or proposal; it is never a mutation of the parked run.
An open iteration-park gate blocks only its own iteration group. Other groups in the run may continue to
advance and settle against their own state.

### Always-on platform backstops

Two controls apply even if the definition says nothing about them:

1. **Run budget windows.** The existing token and cost reservation and settlement checks run for every
   participant turn. A turn that cannot reserve budget does not launch and follows the existing
   fail-closed intervention path.
2. **No progress.** Before an artifact-producing rework turn, the engine snapshots every declared
   output's regular-file status and streamed SHA-256. After the turn, every required output must be a
   regular nonempty file and must differ from its corresponding snapshot. A missing, empty, irregular,
   or byte-identical required output parks fail-closed before canonical integration. It opens the same
   `iteration-park` gate used for exhaustion, with reason `no-progress`, the same exact-set approve or
   decline semantics, the same residue exposure, and no in-place extension. This implements the doctrine
   in `orgs/faceless-youtube/knowledge/decisions.md:3721-3730`. The attempted request and outcome remain
   in residue, but no successor generation, supersession, or extra cycle is recorded.

## Configuration examples

These examples explain useful declarations. They do not create topology-specific runtime branches.

### Pairwise rework: X <-> Y

X and Y are peers with declared routes in both directions. X may issue a structured `rework` request to
Y. Y commits a successor artifact and routes it back to X. If X is declared as a terminal authority for
`accept`, X can accept directly without a judge.

**Cycle unit:** one feedback, response, and check round trip. The initial artifact exists before cycle
one. X requests a fix, Y supplies the successor, and X accepts it in cycle one. Acceptance stops at once.
If X instead requests another rework and that request would start a cycle beyond the bound, the group
parks with the unresolved request and both artifact generations visible.

### Manager/judge: producer -> judge -> producer

A producer commits a generation. A judge evaluates it against declared criteria and records `pass`,
`fail`, or `parked`. The judge is the terminal authority for `pass`. A valid `fail` routes a structured
rework request to the producer when another cycle is available.

**Cycle unit:** one producer generation followed by one judge verdict. `pass` terminates immediately.
`fail` is nonterminal. A `fail` at the declared bound parks with all findings. This configuration is the
compatibility form of the current `ReviewLoop`.

### Debate with mediator

Peers submit structured positions or replies over declared routes. A mediator receives the current
position set and applies its immutable synthesis mandate. The mediator may record `consensus`,
`continue`, or `parked`.

**Cycle unit:** every scheduled peer contributes once, followed by one mediator decision. `consensus`
is terminal only when the mediator's mandate criteria pass and every current position is either
incorporated or named as recorded dissent. Unanimity is not required unless the definition explicitly
requires it. `continue` is nonterminal and parks at exhaustion with every position preserved.

### Coordinator crew

A coordinator has a declared goal and routes bounded tasks among participants such as a stylist,
builder, checker, and researcher. Each specialist has a stable mandate and perspective. The coordinator
may route `delegate`, `rework`, or `check` requests only along declared edges. The coordinator is the
terminal authority for `complete`, although a definition may also authorize a checker to record `pass`.

**Cycle unit:** one complete traversal of the definition's coordinator schedule, followed by the
coordinator verdict. `complete` is valid only when the coordinator's goal criteria pass and every open
specialist finding is resolved or recorded as accepted residue. A further delegation after the bound
parks to the same human gate.

## Schema sketch: generalize, do not parallel

```ts
type IterationRole = 'peer' | 'judge' | 'mediator' | 'manager' | 'coordinator' | 'contributor';
type IterationRequestKind = 'review' | 'rework' | 'position' | 'reply' | 'delegate' | 'check';
type IterationVerdict =
  | 'fulfilled'
  | 'accept' | 'rework'
  | 'pass' | 'fail'
  | 'consensus' | 'continue'
  | 'complete' | 'parked';
type IterationParkReason = 'exhausted' | 'no-progress';

interface IterationParticipant {
  participantId: string;
  stageRef: string;
  role: IterationRole;
  perspective: string;
  mandate: string;
  goal?: string; // permitted only for a manager or coordinator terminal authority
}

interface IterationRoute {
  routeId: string;
  senderParticipantId: string;
  recipientParticipantId: string;
  requestKinds: IterationRequestKind[];
}

interface IterationScheduleStep {
  stepId: string;
  routeId: string;
  after?: { stepId: string; participantId: string; verdict: IterationVerdict };
  cycle: 'current' | 'next';
}

interface IterationTerminalAuthority {
  participantId: string;
  verdict: Extract<IterationVerdict, 'accept' | 'pass' | 'consensus' | 'complete'>;
}

interface IterationGroupDefinition {
  iterationGroupId: string;
  goal?: string;
  participants: IterationParticipant[];
  routes: IterationRoute[];
  activation: {
    seedParticipantId: string;
    seedArtifactIds: string[];
  };
  initialStepId: string;
  schedule: IterationScheduleStep[];
  artifacts: string[];
  criteria: ReviewCriterion[];
  maxCycles: number;       // required; no platform default or policy ceiling
  cycleUnit: string;       // required disclosure of what increments cyclesUsed
  terminalAuthorities: IterationTerminalAuthority[];
  completionGate?: ProposalCompletionGate; // optional gate after semantic acceptance
}

interface IterationLoop extends IterationGroupDefinition {
  iterationLoopRef: string;
  runRef: string;
  definitionHash: string;
  cyclesUsed: number;
  state:
    | 'awaiting-seed' | 'awaiting-turn' | 'running-turn'
    | 'failed' | 'rework-queued' | 'exhausted'
    | 'parked' | 'awaiting-completion-gate' | 'awaiting-park-gate'
    | 'passed' | 'declined';
  turnOwnerParticipantId?: string;
  currentStepId?: string;
  activeGenerationRefs: string[];
  acceptedGenerationRefs?: string[];
  lastReceiptRef?: string;
  gateRef?: string;
  parkReason?: IterationParkReason;
  unresolvedResidue?: IterationResidue;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface IterationRequest {
  schema: 'kb.iteration-request/v1';
  requestRef: string;
  iterationLoopRef: string;
  senderParticipantId: string;
  recipientParticipantId: string;
  kind: IterationRequestKind;
  cycle: number;
  inputGenerationRefs: string[];
  baseCommit: string;
  artifactHashes: Record<string, string>;
  criteria: ReviewCriterion[];
  unresolvedFindingRefs: string[];
  preservedInvariants: string[];
  nextAcceptanceCheck: string;
  instructions: string;
}

interface IterationOutcome {
  schema: 'kb.iteration-outcome/v1';
  requestRef: string;
  iterationLoopRef: string;
  participantId: string;
  cycle: number;
  verdict: IterationVerdict;
  inputGenerationRefs: string[];
  criteria: CriterionResult[];
  findings: IterationFinding[];
  positions: IterationPosition[];
  recordedDissent: IterationDissent[];
  summary: string;
}

interface IterationReceipt extends Omit<IterationOutcome, 'schema'> {
  schema: 'kb.iteration-receipt/v1';
  receiptRef: string;
  outcomeHash: string;
  outputGenerationRefs: string[];
  baseCommit: string;
  canonicalCommit: string;
  createdAt: string;
}
```

Verdict legality is declaration-driven rather than inferred from role labels. A participant's terminal
verdicts are exactly its `terminalAuthorities`; its nonterminal vocabulary is the verdicts naming it in
schedule `after` conditions, plus `fulfilled` when it receives `rework` or `delegate`, and universal
`parked`, which always transfers control to the platform human gate and is exempt from successor coverage.

The closed parser may require or forbid outcome fields by verdict and participant role. A worker never
chooses `receiptRef`, output generation refs, commits, timestamps, or the final receipt hash. The server
mints those after canonical integration. The runtime transition function remains generic: validate
identity and lineage, validate the verdict against the participant's mandate and declared terminal
authority, accept or select the next declared route, then enforce the backstops.

`fulfilled` is the nonterminal receipt for an artifact-producing participant that completed a
structured request. It records the successor generation and lineage but grants no semantic acceptance.
The next schedule step routes that generation to an authorized reviewer, judge, mediator, or
coordinator.

Cycle enforcement is machine-decidable. A new loop opens cycle one at `initialStepId`. Every later
schedule step declares whether it stays in the current cycle or opens the next one. The validator
rejects ambiguous matching steps. It also performs exhaustive verdict coverage: every reachable
nonterminal verdict for every participant must match a successor step in the current or next cycle. A
missing match is a definition defect rejected at validation time. Before a `cycle: 'next'` step opens,
the engine compares the next cycle number with `maxCycles`. `cycleUnit` explains the same boundary to
humans but is not parsed to enforce it.

Activation is also declared. At run creation, every non-seed participant stage is fenced from ordinary
DAG scheduling. The named seed participant may run once as a normal DAG stage to create the exact
`seedArtifactIds`. Its committed generation activates `initialStepId`, opens cycle one, and moves the
seed participant under loop scheduling too. The validator rejects a seed outside the group, artifacts
outside that stage, a stage assigned to more than one iteration group, or any schedule step that can
activate before those pinned artifacts exist.

## `ReviewLoop` migration mapping

Existing review definitions compile mechanically into one manager/judge configuration:

- the subject stage becomes the producer participant;
- the review stage becomes the judge participant;
- the review criteria become group criteria;
- the subject generation and review pin become `activeGenerationRefs` and the request's input refs;
- `maxCycles = maxCreatorReworks + 1`, preserving the legacy definition's authored behavior;
- an `awaiting-subject` loop with no active generation starts at `cyclesUsed = 0`; after the initial
  subject generation, `cyclesUsed = reworksUsed + 1`;
- `ReviewReceipt` becomes `IterationReceipt`;
- `failedReviewReceiptRef` on `GenerationSupersession` becomes the generic `triggerReceiptRef`; and
- the legacy `completionGate` remains a distinct optional post-semantic-pass gate on the generic group.

The migration intentionally removes the legacy `0..2` validation ceiling on `maxCreatorReworks`.
Legacy definitions gain the wider safe-integer bound while preserving their authored value through the
`maxCycles = maxCreatorReworks + 1` mapping.

That completion gate is not exhaustion. A terminal receipt ends participant scheduling, then the
existing completion approval may withhold downstream release and retain its current response behavior.
Exhaustion and no progress use one `iteration-park` gate kind, distinguished only by its reason field.
It is the locked approve-or-decline decision on unresolved artifacts and cannot request an in-place
extension.

The current `failed` state keeps its meaning during migration. It is the durable state after a valid
nonterminal negative verdict and before the engine queues the next route or parks. It is not, by itself,
a terminal run failure.

Legacy `review` syntax may remain as a compiler input during migration, but it produces the same
`IterationGroupDefinition`, `IterationLoop`, request, receipt, transitions, and persistence records as
new definitions. The completed system has one engine state machine and one receipt family. There is no
parallel `ReviewLoop` runtime and no dead review-only transition path.

## Run-graph surface

The live run graph must make the loop inspectable without reconstructing it from logs:

- each participant stage is represented distinctly, either as its own card or as a keyed per-stage row
  on its agent card, with that group's role, cycle count, declared bound, current turn owner, last
  verdict, and park or gate state;
- iteration routes are visually distinct from ordinary workflow DAG dependencies;
- selecting a loop or route reveals the cycle-unit disclosure, immutable mandate and perspective,
  requests, receipts, pinned artifacts and commits, findings, positions, dissent, and unresolved
  residue; and
- an `iteration-park` gate, for either reason, shows exactly what approval accepts and makes decline and
  separate relaunch explicit.

The server DTO is authoritative. The SPA does not infer termination, reconstruct routes from logs, or
decide which generation was accepted.

## External-framework sanity check

The outside examples support the primitive but do not set kb policy:

- [AutoGen termination conditions](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/termination.html)
  combine semantic conditions with a caller-selected turn bound. Either condition can stop execution.
- [LangGraph graph execution](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
  combines conditional termination with a configurable recursion limit.
- [CrewAI crews](https://github.com/crewAIInc/crewAI) model role and goal based agents, including
  hierarchical manager coordination.
- [Du et al., Multiagent Debate](https://arxiv.org/abs/2305.14325) demonstrates multi-round peer
  interaction, but does not justify making debate a platform-specific engine or setting a kb-wide cap.

What kb should imitate is semantic completion plus a definition-selected guard. What kb must preserve
as its own control-plane contract is commit lineage, structured receipts, fail-closed gates, budget
accounting, no-progress detection, and auditable human override.

## YAGNI: P1 exclusions

- No platform default, suggested cap, or policy ceiling for `maxCycles`.
- No runtime mutation of a group's cap, routes, participants, mandates, perspectives, or terminal
  authorities.
- No topology-specific engines, receipt families, or persistence tables.
- No free-form participant chat or worker-selected routing.
- No dynamic participant admission, route creation, voting scheme, or learned stopping policy.
- No nested iteration groups or one stage participating in more than one iteration group. P1 cuts
  sequential shared-stage membership; separate stages may still use the same agent.
- No parallel or simultaneous turns. P1 uses a deterministic order of committed turns.
- No automatic continuation from an exhausted run. Further work is a separate operator relaunch.
- No cross-run hidden memory. A relaunch is a fresh run; reusing a parked artifact is an operator's
  explicit choice through the normal definition-input mechanism.
- No external coordination framework or framework adapter.
- No token-level participant streaming. Existing per-agent run streams remain sufficient.

## Resolved rulings

1. **May peers accept without a judge?** Yes. A peer listed as a terminal authority may record the
   configured acceptance verdict directly.
2. **What is the default cap?** There is none. Every group declares a required positive safe-integer
   bound, and the platform imposes no policy ceiling.
3. **What counts as consensus?** A mandate-satisfied synthesis in which every current position is
   incorporated or preserved as recorded dissent. Unanimity is required only when the definition says
   so.
4. **What happens at exhaustion?** The platform parks with the full unresolved record. The human may
   approve or decline the exact parked artifacts. More rounds require a separate operator relaunch,
   never in-place cap mutation.

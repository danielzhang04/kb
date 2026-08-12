# P1 iteration-group termination rule proposal

**Date:** 2026-08-12  
**Status:** proposal for Daniel's gate; no implementation is authorized by this document.  
**Authority:** the approved workflow-platform design and Daniel's 2026-08-12 ruling override this proposal.

## Decision in one paragraph

Generalize the existing `ReviewLoop` into one durable `IterationLoop` for N declared participants.
Every turn reads an immutable commit-lineage artifact and produces either a new artifact generation or
a schema-validated receipt; no participant receives a free-form chat channel. Each topology has a
semantic terminal verdict plus a definition-declared `maxCycles`; the first terminal condition wins,
and a non-terminal verdict at the cap atomically parks the loop and opens the existing human
intervention gate.

## Iteration-group model

An iteration group is compiled into the approved workflow identity. It declares:

- a stable group id and topology: `pairwise`, `judge`, or `debate`;
- two or more participant stages, each with role `peer`, `judge`, or `mediator`;
- for a peer, an optional immutable `perspective`/mandate; for a judge or mediator, a required immutable
  mandate and ordered acceptance/consensus criteria;
- an ordered turn schedule and explicit allowed sender -> recipient routes;
- a positive `maxCycles`, defaulting to 3 and limited to 1-4 in v1;
- the artifact paths each participant may change, inherited from ordinary stage scope.

A cycle is one full scheduled round of the topology; the number of agent turns per cycle differs by topology (2 pairwise / 2 judge / N+1 debate).

`maxCycles = 3` preserves today's maximum of an initial judged generation plus two creator reworks
(`dashboard/server/workflows/defs.ts:558-581`) and matches the observed center of one to three review
rounds; the configurable ceiling of 4 covers the observed content tail without making it the default
(`2026-08-12-p1-iteration-research.md`, "Rounds are few and explicitly bounded").

### One channel: commits plus structured receipts

The server, not an agent, selects the input to every turn:

1. Resolve the exact predecessor/accepted generation and verify its result hash and canonical commit.
2. Base the recipient's worktree on that commit. Current review execution already pins checker and
   rework generations this way (`dashboard/server/control/execution.ts:1180-1238,1571-1584`;
   `dashboard/server/control/store.ts:4108-4193`).
3. Add a bounded, server-authored `IterationRequest` to the existing inert prompt boundary. That
   boundary already admits dependency results and feedback as data only
   (`dashboard/server/control/claudeWorkerAdapter.ts:254-320`).
4. Canonically integrate the recipient's actual changed artifacts and persist an immutable receipt.

The request is data, not authority:

```ts
interface IterationRequest {
  schema: 'kb.iteration-request/v1';
  loopRef: string;
  cycle: number;
  fromStageRef: string;
  toStageRef: string;
  artifactGenerationRef: string;
  artifactResultHash: string;
  disposition: 'rework' | 'position' | 'reply';
  criteria: Array<{ criterionId: string; verdict: 'pass' | 'fail' | 'unverified' }>;
  findings: Array<{
    id: string;
    criterionId: string;
    severity: 'blocking' | 'advisory';
    summary: string;
    evidencePaths: string[];
  }>;
  instructions: string;
  preserve: string[];
}
```

The recipient may justify a different mechanism while satisfying the finding; the next authorized
judge/peer/mediator evaluates the actual result and evidence. This follows the observed reviewer-
implementer dialectic rather than treating reviewer prose as executable truth
(`origin/ops:memory/claude-boss.md:270-272,277-280`).

## Falsifiable topology rules

### 1. Pairwise rework: A <-> B

Both participants are `peer`; the definition orders them `[A, B]` and permits only A -> B and B -> A.
A **cycle** completes after both scheduled peers have had at most one artifact-bound turn (the initial
artifact counts as A's turn in cycle 1). On receipt, a peer must emit exactly one structured disposition:

- `accept`: terminate `passed`, accepting the exact received generation;
- `rework`: commit a successor artifact and a request to the other peer;
- `parked`: terminate `parked` and open a human intervention.

**Rule P:** after each peer disposition, if it is `accept` or `parked`, stop immediately. Otherwise,
advance the schedule. If a `rework` would begin a turn after cycle `maxCycles`, do not launch it; persist
the last request and artifact, set `exhausted`, then atomically park to the human gate. This is testable
from the ordered receipt history: no participant can have more than one turn per cycle, no undeclared
edge can occur, and no attempt can start at cycle `maxCycles + 1`.

### 2. Manager/judge: worker -> judge -> worker

The producer is role `peer`; the manager is role `judge`. The judge may send rework only to the declared
producer and cannot modify the producer's artifact paths. Each **cycle** is one producer generation plus
one judge receipt against the exact generation commit and immutable criteria. The judge must emit the
existing semantic shape: `pass`, `fail`, or `parked`, with one verdict per criterion and linked findings
(`dashboard/server/control/reviewOutcome.ts:15-40,224-313`).

**Rule J:** `pass` terminates and accepts that exact generation; `parked` terminates to the human gate;
`fail` launches one successor generation only when `cycle < maxCycles`. A `fail` at `maxCycles` is
persisted as the final receipt and parks to the human gate. A missing/unverified required criterion can
never produce `pass`. Thus the manager judges the actual result, not worker self-report or general
confidence.

This topology is the compatibility form of current `ReviewLoop`: `maxCycles =
maxCreatorReworks + 1`; `subjectStageRef` becomes the producer participant; `reviewStageRef` becomes the
judge participant.

### 3. Debate plus mediator: peers -> mediator

There are at least two `peer` stages with distinct declared perspectives and exactly one `mediator`.
Peers publish ordered, separately named position artifacts. In cycle 1 each peer starts from the common
accepted dependency base; in later cycles each peer receives the canonically integrated position bundle
from the previous cycle plus the mediator's structured request. After all peers publish once, the
mediator reads every current position artifact and judges them against its own immutable mandate.

The mediator emits exactly one decision:

- `consensus`: terminal, with a canonical synthesis, criterion verdicts, and explicit treatment of each
  peer's latest position;
- `continue`: non-terminal, with named disagreements/evidence gaps and one bounded request per peer;
- `parked`: terminal to the human gate, with the unresolved disagreement recorded.

**Rule D:** `consensus` is valid only if all mandate criteria are `pass` and every peer's latest position
is cited as incorporated or recorded dissent; it then accepts the mediator's synthesis generation.
`continue` schedules the next peer round only when `cycle < maxCycles`. `continue` at the cap, or an
explicit `parked`, preserves the last positions and mediator receipt and parks to the human gate. The
mediator alone calls consensus; peer majority, repeated wording, or silence cannot terminate the loop.

## Schema sketch: generalize, do not parallel

```ts
type IterationRole = 'peer' | 'judge' | 'mediator';
type IterationTopology = 'pairwise' | 'judge' | 'debate';

interface IterationParticipant {
  stageRef: string;
  role: IterationRole;
  perspective?: string; // immutable declared text/hash input
}

interface IterationLoop {
  iterationLoopRef: string;          // ReviewLoop.reviewLoopRef, renamed
  runRef: string;                    // kept
  topology: IterationTopology;       // new
  participants: IterationParticipant[]; // replaces reviewStageRef + subjectStageRef
  routes: Array<{ fromStageRef: string; toStageRef: string }>; // new, compiled
  maxCycles: number;                 // replaces maxCreatorReworks (+1 compatibility)
  definitionHash: string;            // reviewDefinitionHash, generalized
  cyclesUsed: number;                // replaces reworksUsed; 2 pairwise / 2 judge / N+1 debate turns per cycle
  state:
    | 'awaiting-artifact' | 'running' | 'awaiting-verdict'
    | 'failed' | 'rework-queued' | 'exhausted' | 'parked' | 'awaiting-gate' | 'passed';
  // 'failed' maps 1:1 to today's ReviewLoop 'failed'. After a non-terminal fail/continue verdict, the loop sits here until the engine either queues rework (cycle < maxCycles) or parks (cycle == maxCycles), exactly as ReviewLoop does today.
  activeParticipantStageRef: string | null; // new observable turn owner
  activeGenerationRefs: string[];           // extends activeGenerationRef for debate fan-in
  acceptedGenerationRefs: string[];         // extends acceptedGenerationRef
  activeReceiptRef: string | null;          // kept
  interventionRequestRef: string | null;    // kept: normal HumanRequest
  version: number;                   // kept CAS boundary
  createdAt: string;                 // kept
  updatedAt: string;                 // kept
}

interface IterationReceipt {
  iterationReceiptRef: string;
  iterationLoopRef: string;
  runRef: string;
  cycle: number;
  fromStageRef: string;
  toStageRefs: string[];
  artifactGenerationRefs: string[];
  artifactResultHashes: string[];
  outcome: PairOutcome | JudgeOutcome | MediatorOutcome;
  outcomeHash: string;
  operationKey: string;
  state: 'accepted' | 'rework' | 'continue' | 'awaiting-gate' | 'parked';
  completionRequestRef: string | null;
  interventionRequestRef: string | null;
  version: number;
  createdAt: string;
  finalizedAt: string | null;
}
```

Keep the current mechanisms, not only similarly named fields:

- `StageGeneration` and `GenerationSupersession`, including predecessor/successor links, result hashes,
  base/canonical commits, failed receipt linkage, and idempotent operation keys
  (`dashboard/server/control/types.ts:138-171`);
- immutable receipt hashing and generation/commit/attempt cross-checks;
- compare-and-swap versions, restart reconciliation, quarantine validation, and generation
  supersession;
- optional completion approval after a semantic pass/consensus;
- exhaustion/explicit park -> existing `HumanRequest` -> run `waiting-human`;
- run success only when all stages succeed and all iteration groups pass, matching today's loop
  settlement invariant (`dashboard/server/control/execution.ts:2059-2063`).

Existing `ReviewLoop` definitions migrate mechanically to topology `judge`. There is one engine state
machine and one receipt family after migration; there is no `ReviewLoop` engine beside an
`IterationLoop` engine.

## Run-graph surface

Each participating agent card must show, without opening details:

- topology and role (`pairwise / peer`, `judge / judge`, `debate / mediator`);
- loop state and cycle, e.g. `judging - 2/3`, plus rounds remaining;
- active turn owner and the current sender -> recipient edge;
- active artifact generation and whether a newer generation superseded the one on the card;
- last semantic result (`fail`, `accept`, `continue`, `consensus`, `parked`);
- open human-gate chip when parked/exhausted.

The detail panel should show receipt history, criteria/findings, evidence paths, accepted/current commit
identity, and supersession history. Iteration/back edges must be visually distinct from ordinary DAG
dependency edges. Today the DTO exposes only loop identity/state/version and graph overlays ignore loops,
so both the DTO and overlay derivation must grow rather than inferring state from stage status
(`dashboard/src/control/controlClient.ts:256-287`; `dashboard/src/control/runGraph.ts:62-102`;
`dashboard/src/views/WorkflowAgentGraph.tsx:355-401,465-540`).

## External-framework sanity check

### (a) Does the survey falsify the no-framework decision?

**No.** The useful external mechanisms are policy patterns, not capabilities that require importing a
runtime:

- AutoGen combines a semantic termination condition with `max_turns` and stops when either fires; it
  also uses persistence plus human feedback between bounded runs
  ([AutoGen human-in-the-loop](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html)).
- LangGraph uses conditional termination and a recursion limit when convergence is not guaranteed; it
  documents graceful state-based exit using remaining steps
  ([LangGraph graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api)).
- CrewAI supplies role-based agents, hierarchical manager validation, and per-agent `max_iter`, but
  those are generic orchestration constructs
  ([CrewAI repository](https://github.com/crewAIInc/crewAI),
  [CrewAI agent definition](https://github.com/crewAIInc/crewAI/blob/main/docs/en/concepts/agents.mdx)).
- Debate research has peers revise after reading other positions, commonly uses fixed rounds, and notes
  that convergence is not guaranteed. A judge-managed variant uses an adaptive break
  ([Du et al. 2023](https://arxiv.org/abs/2305.14325),
  [Liang et al. 2023](https://arxiv.org/abs/2305.19118)).

None supplies kb's server-owned definition hashes, exact commit lineage, generation supersession,
receipts, or existing human-gate projection. Adopting one would add a second coordination/state plane
while the required termination mechanics fit the current primitive.

### (b) What should kb imitate natively?

Imitate four ideas only: semantic stop **OR** hard cap; declared participant roles; a judge/mediator
whose mandate is distinct from producers' perspectives; and preserved state when control returns to a
human. Keep kb's stronger artifact-grounding: every verdict binds exact commits/hashes, structured
criteria, and evidence. Do not imitate framework-owned free-form group chat, implicit speaker selection,
or an uncapped default.

The debate evidence also supports a small cap: the original study mainly used three agents and two
rounds, found convergence non-guaranteed, and reported little additional performance above four rounds
([Du et al. 2023](https://arxiv.org/abs/2305.14325)). That is consistent with default 3 / maximum 4,
but it is corroboration, not the primary basis; Daniel's observed one-to-three-round practice is.

## YAGNI: v1 exclusions

- Free-form agent-to-agent or manager-to-worker chat.
- Dynamic participant creation, undeclared routing, or model-selected speaker order.
- Nested iteration groups or one stage participating in two active groups at once.
- Majority voting, weighted votes, quorum rules, secret ballots, or multi-mediator panels.
- Parallel/simultaneous debate turns; v1 uses deterministic ordered commits.
- Automatic cap extension, autonomous appeals, or retrying a parked/exhausted loop.
- Cross-run conversational memory, learned persuasion profiles, or self-modifying mandates.
- External coordination frameworks or framework adapters.
- Token-level live debate streaming; existing per-agent run streams remain sufficient.

## Open questions for Daniel

1. **May a peer accept another peer's artifact without a third-party check?** Recommendation: yes for
   explicit `pairwise`; use `judge` whenever independent acceptance matters. This keeps the topologies
   meaningfully different.
2. **Should v1 permit `maxCycles: 4` or hard-limit every topology to 3?** Recommendation: permit 1-4,
   default 3. Four is an observed content exception; definitions must opt into its cost explicitly.
3. **Does mediator `consensus` mean unanimous peer assent or mandate-satisfied synthesis with recorded
   dissent?** Recommendation: the latter. The mediator has its own mandate and should be able to call a
   result while preserving dissent; requiring unanimity turns one peer into an undeclared veto.
4. **Should cap exhaustion offer approve/reject only, or also a human-authored rework extension?**
   Recommendation: v1 offers approve/decline on the parked artifact and a separate operator relaunch;
   never mutate the approved definition's cap in place.

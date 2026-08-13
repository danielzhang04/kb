# P1 iteration loops implementation plan

**Goal:** Replace the review-specific runtime with one durable iteration-loop state machine for
definition-declared participants, routes, mandates, semantic termination, per-group bounds, and
fail-closed human parking.

**Authority chain:**
`docs/superpowers/specs/2026-08-11-workflow-platform-design.md` >
`docs/superpowers/specs/2026-08-12-p1-termination-rule-proposal.md` > this plan.

**Branch and worktree:** `claude/workflow-platform` in
`C:/Users/danie/kb-worktrees/boss-workflow-platform`.

**Merge bar:** All targeted suites are green; `tsc --noEmit` reports exactly the 7 known baseline
errors and no new error; an Opus fresh-context adversarial review passes; LIVE RUN PROOF is captured;
Daniel reviews the gate evidence and approves merge. Do not merge on unit tests alone.

## Execution rules

- Work task by task. For each task, add the named tests and see the relevant new assertion fail before
  changing production code.
- Migrate `ReviewLoop`; do not wrap it. At the end there is one state machine, one request schema, one
  receipt schema, and one durability validator.
- Keep server-selected artifact generations, commits, routes, and turn owners authoritative. Worker
  prose and SPA state never select them.
- Keep each task inside its listed files. A task that exposes an unlisted dependency stops for a plan
  amendment instead of growing a bolt-on.
- Run the listed focused tests after each task. Run the full targeted set and typecheck at the final
  merge bar.
- From Task 2 onward, no intermediate task may make load-time durability validation vacuous. Each
  task's acceptance includes a load test in which the current generic validator rejects a corrupted
  fixture containing every generic record type introduced by that point.

## Risk register to pin in tests

| Risk | Required control |
| --- | --- |
| Restart during an in-flight loop turn | Reconcile the persisted request, receipt, operation key, and canonical commit without launching or integrating twice. |
| Quarantine or restore of a run with loop state | Validate loops, generations, supersessions, receipts, gates, and accepted artifacts as one graph before move, restore, or delete. |
| W7 queue bridge | A registered workflow-definition card must carry the compiled iteration groups into the same single run. It must not expand loop turns into queue cards. |
| Canonical git coordination | Every integrator method that touches canonical state, including lookup and nonempty base resolution, stays inside the serialized ops-transaction span. `resolveBase` deliberately returns before serialization for a zero-dependency stage; compiler-derived route wiring makes fenced loop turns ineligible for that path. |
| Windows `EPERM` during persistence | Every new atomic file replacement uses shared `renameWithRetrySync` from `dashboard/server/atomicRename.ts`. Do not add a local retry loop or raw rename site. |

## Task 1: Define and compile the iteration-group contract

**Files:**

- `dashboard/server/control/types.ts`, around `StageGeneration`, `GenerationSupersession`,
  `ReviewLoop`, and `ReviewReceipt` at lines 146-208
- `dashboard/server/workflows/defs.ts`, including `WorkflowReviewDef` and the review validation at
  lines 545-581
- `dashboard/server/workflows/defs.test.ts`
- `dashboard/server/workflows/compile.ts`, especially `deriveProposalId` and the stage compilation at
  lines 74-97 and 257-297
- `dashboard/server/workflows/compile.test.ts`
- `dashboard/server/control/proposal.ts`, including `ProposalReview`, `PlanProposal`, and the closed
  compiled-proposal validator at lines 121-148 and 580-615
- `dashboard/server/control/proposal.test.ts`
- `dashboard/server/control/compiler.ts` and `dashboard/server/control/compiler.test.ts`

**Write these tests first:**

- `defs.test.ts`: `parses an iteration group only when participants routes mandates cycleUnit and maxCycles are declared`
- `defs.test.ts`: `rejects missing or nonpositive bounds duplicate participants unknown routes and undeclared terminal authorities`
- `defs.test.ts`: `rejects nested groups shared participant stages parallel turns and ambiguous schedule matches`
- `defs.test.ts`: `allows separate participant stages in different groups to use the same agent`
- `defs.test.ts`: `rejects a group with neither a group goal nor a goal-bearing accepting manager or coordinator`
- `defs.test.ts`: `rejects an activation seed outside the group or seed artifacts outside that participant stage`
- `defs.test.ts`: `rejects every reachable nonterminal participant verdict without an in-cycle or next-cycle successor`
- `defs.test.ts`: `increments cycles only at declared schedule boundaries in pair judge mediator and coordinator configurations`
- `defs.test.ts`: `accepts a positive safe-integer maxCycles without a platform ceiling`
- `compile.test.ts`: `derives stage dependency and base-resolution wiring for every declared iteration route`
- `compile.test.ts`: `compiles a legacy review block into the judge configuration with maxCycles equal to maxCreatorReworks plus one`
- `compile.test.ts`: `maps a legacy review completion gate to the generic post-acceptance completion gate`
- `compile.test.ts`: `rejects a legacy rework count that cannot be incremented as a safe integer`
- `compile.test.ts`: `hash-binds iteration groups mandates routes and terminal authorities into the proposal identity`
- `proposal.test.ts`: `rejects browser-supplied iteration fields that differ from the compiler-owned snapshot`
- `compiler.test.ts`: `does not grant checker-readonly tools from an iteration role label`

**Implementation:** Add `IterationParticipant`, `IterationRequest`, `IterationReceipt`, and
`IterationLoop` to `control/types.ts`, together with the route, schedule-step, terminal-authority,
residue, finding,
position, and dissent shapes they directly use. Add a top-level `iterationGroups` array to the workflow
definition and compiled proposal. Validate nonempty immutable mandates and perspectives, existing stage
references, unique participant ids, declared directed routes, deterministic schedule steps, artifact and
criterion references, terminal authorities, a nonempty `cycleUnit`, and required positive safe-integer
`maxCycles`. Require an activation block naming one seed participant and its exact declared seed
artifacts. Each schedule step names its route, predecessor step and verdict match, and whether it stays
in the current cycle or opens the next one. Reject ambiguous matches, parallel turns, nested groups, and
any stage assigned to more than one iteration group. Validate exhaustive verdict coverage: every
reachable nonterminal verdict of every participant must have exactly one matching successor step in the
current or next cycle. Require either a nonempty group goal or a nonempty participant goal on an
accepting manager or coordinator; a generic mandate does not satisfy that check. Do not impose a product
default or policy maximum. Compile every declared route into whatever stage-level `dependsOn` and
base-resolution linkage is required for server-selected generation pinning on every participant turn,
including fan-in turns.

Keep legacy stage `review` syntax as compiler input only. Remove its upper cap, require
`maxCreatorReworks` to be a nonnegative integer no greater than `Number.MAX_SAFE_INTEGER - 1`, and
compile it immediately to a two-participant judge group with
`maxCycles = maxCreatorReworks + 1`. Map its optional `completionGate` to the generic group's distinct
post-acceptance gate. Include the compiled group in `deriveProposalId` and the approved `PlanProposal`.
`policyScopeForStage` must continue to derive capabilities from the server-owned workflow profile and
stage scope, never from `role: judge` or another role string.

**Acceptance:** Both authored iteration groups and legacy review blocks produce the same closed compiled
group type. Definition or proposal drift changes the proposal hash. Missing bounds, uncovered reachable
nonterminal verdicts, shared participant stages, and unsafe references fail before launch. The legacy
`0..2` cap is intentionally gone: any nonnegative safe `maxCreatorReworks` that can be incremented
compiles to `maxCycles = maxCreatorReworks + 1`. The focused defs, compile, proposal, and compiler suites
pass.

**Do not touch:** Store persistence, runtime scheduling, prompt construction, routes, or SPA code.

## Task 2: Materialize iteration groups in run state

**Files:**

- `dashboard/server/control/store.ts`, including `CreateRunStageInput` and `CreateRunInput` at lines
  410-440, `createRun` at lines 3234-3414, public detail projection at lines 1369-1403, and
  `commit()` around line 5604; replace `validateReviewDurability` at lines 2326-2736 and its normal-load
  calls at lines 2908 and 2911 with the generic durability validator in this task; cover quarantine
  eligibility at lines 1451-1457 and quarantine/restore mutations at lines 5482-5563
- `dashboard/server/control/store.test.ts`
- `dashboard/server/control/launch.ts`, especially the `createRun` input at lines 221-229
- `dashboard/server/control/routes.test.ts`

**Write these tests first:**

- `store.test.ts`: `materializes approved iteration groups with immutable definition hashes and version zero`
- `store.test.ts`: `materializes cycle zero awaiting seed with no schedule step or turn owner`
- `store.test.ts`: `rejects an iteration group whose participant stage artifact or route is outside the approved run snapshot`
- `store.test.ts`: `migrates persisted review loops receipts completion gates and supersessions into generic records on load`
- `store.test.ts`: `projects temporary review compatibility fields from generic records without duplicate persistence`
- `store.test.ts`: `rejects a corrupted generic loop request receipt generation gate or supersession fixture on load`
- `store.test.ts`: `rejects quarantine or restore when the generic iteration durability graph is corrupt`
- `routes.test.ts`: `launch passes the exact compiler-owned iteration group snapshot to createRun`

**Implementation:** Make iteration loops, requests, and receipts the only persisted runtime records.
Materialize each loop from the approved proposal during `createRun`, with stable refs, a definition
hash, version 0, cycle 0, state `awaiting-seed`, no current schedule step or turn owner, optional
completion gate, and exact activation artifact bindings. Carry the compiled groups through `launch.ts`. During store
normalization, convert legacy live `ReviewLoop`, `ReviewReceipt`, completion-gate, and supersession rows
using the amended proposal's mapping, then write only the generic shape on the next normal commit.

Replace `validateReviewDurability` now, when generic records first exist, with one validator covering the
generic loop definitions, participants, routes, requests, receipts, generations, supersessions, residue,
gates, interventions, and accepted artifacts. Call it on every normal and quarantined bundle load at the
existing lines 2908 and 2911. It must validate whichever generic collections exist at this point as well
as the temporary legacy migration inputs, so the load-time safety net never passes vacuously between
Tasks 2 and 13.
Use the same validator before quarantine moves and restores so no retention path can move a partial or
corrupt generic graph.

To keep this task and the next five independently green, expose a temporary ReviewLoop projection and
the existing review-named mutation methods over the generic records. Each mutation method must delegate
to the same generic compare-and-swap transition core introduced here; it cannot write an old collection
or contain a second transition rule. Task 4 expands that core to every declared role, route, and gate.
Mark every compatibility adapter for deletion in Task 13. Persist through the existing `commit()` path,
which already calls `renameWithRetrySync`.

**Acceptance:** A run created from either new or legacy syntax persists only generic records. An
existing control-plane file loads and migrates without losing completion-gate or `failed` state. The
temporary read and write adapters keep all current callers and the full store and route suites green,
and store inspection confirms they write only generic records. Normal load rejects a corrupted fixture
containing every generic record type introduced so far.

**Do not touch:** Review outcome parsing, turn execution, gate resolution, queue bridge, or UI.

## Task 3: Generalize the closed outcome validator

**Files:**

- `dashboard/server/control/reviewOutcome.ts`, especially `parseReviewOutcome` at lines 228-313
- `dashboard/server/control/reviewOutcome.test.ts`
- `dashboard/server/control/types.ts` only for corrections exposed by the parser tests

**Write these tests first:**

- `reviewOutcome.test.ts`: `accepts a peer accept outcome bound to the exact request participant and generation`
- `reviewOutcome.test.ts`: `accepts judge pass and fail mediator consensus and continue and coordinator complete`
- `reviewOutcome.test.ts`: `accepts fulfilled as a nonterminal artifact-producing outcome without server lineage fields`
- `reviewOutcome.test.ts`: `requires fulfilled to carry no criteria verdicts`
- `reviewOutcome.test.ts`: `requires judge mediator and coordinator terminal verdicts to carry every authored criterion exactly once`
- `reviewOutcome.test.ts`: `rejects worker-supplied receipt refs output generations commits timestamps and hashes`
- `reviewOutcome.test.ts`: `requires every mediated position to be incorporated or recorded as dissent before consensus`
- `reviewOutcome.test.ts`: `rejects a verdict the participant is not authorized to issue`
- `reviewOutcome.test.ts`: `rejects duplicate keys unknown criteria stale generations and oversized evidence for every role`
- `reviewOutcome.test.ts`: `parses one kb iteration outcome schema without a review outcome fallback`

**Implementation:** Rename the public parser to `parseIterationOutcome` while keeping the file name.
Retain the duplicate-key scanner, bounded redacted text handling, exact criterion linkage, and closed
object checks already enforced by `parseReviewOutcome`. Make verdict-dependent fields explicit. Peer
accept, judge pass, mediator consensus, and coordinator complete are valid only when the request,
participant, criteria, generation refs, and the group's declared terminal authority agree. Negative
verdicts must carry structured findings. Consensus must account for every current position or record its
dissent. `fulfilled` reports completion of an artifact-producing request but never terminates a group.
It carries no criteria verdicts. Terminal judge, mediator, and coordinator verdicts carry the full
authored criterion set exactly once, preserving the ordering and identity checks currently enforced in
`reviewOutcome.ts:250-256`; other verdict-specific requirements remain closed and explicit.
The parsed worker value is an untrusted transient `kb.iteration-outcome/v1`; reject any worker-supplied
receipt ref, output generation ref, commit, timestamp, or durable hash. After canonical integration,
the server combines the validated outcome with server-owned lineage to mint the sole durable
`kb.iteration-receipt/v1`. Until Task 13 moves the remaining
callers, keep a thin `parseReviewOutcome` compatibility function that translates legacy contracts into
the generic parser and returns no legacy persisted receipt shape. Task 13 deletes it.

**Acceptance:** All roles pass through the same outcome parser, and the server yields one durable receipt
family after integration. Malformed, stale, or server-field-bearing worker output fails closed with
bounded diagnostics. Existing callers remain green through the temporary parser adapter, and no parser
accepts free-form chat as a verdict.

**Do not touch:** Store transitions, worker prompts, graph rendering, or legacy migration.

## Task 4: Replace review transitions with the generic store state machine

**Files:**

- `dashboard/server/control/store.ts`, replacing the `recordReviewReceipt`, completion-gate,
  `advanceReviewGeneration`, and `parkExhaustedReview` methods at lines 3889-4282
- `dashboard/server/control/store.test.ts`
- `dashboard/server/control/types.ts` for transition input types

**Write these tests first:**

- `store.test.ts`: `records one iteration request and receipt idempotently by operation key`
- `store.test.ts`: `activates an awaiting seed loop atomically and idempotently from its pinned seed generation`
- `store.test.ts`: `advances only the declared route with matching loop and generation CAS versions`
- `store.test.ts`: `rejects a stale turn owner duplicate successor or receipt from the wrong participant`
- `store.test.ts`: `parks exhaustion atomically with every unresolved finding position artifact and next route`
- `store.test.ts`: `scopes an open iteration park gate to its group while a sibling group completes`
- `store.test.ts`: `approves the exact parked generation set or declines without adding a cycle`
- `store.test.ts`: `keeps post-acceptance completion approval distinct from iteration-park approval`
- `store.test.ts`: `uses triggerReceiptRef for every generation supersession`

**Implementation:** Add generic methods named
`activateIterationLoop`, `recordIterationRequest`, `recordIterationReceipt`, `advanceIterationTurn`,
`parkIterationLoop`, and `resolveIterationGate`. `activateIterationLoop` moves one `awaiting-seed` loop
from cycle zero to `initialStepId` and cycle one only after matching the exact committed seed generation,
artifact refs, loop version, and canonical operation key. Use loop versions, generation compare-and-swap checks, stable operation keys,
and idempotent replay. Generalize `GenerationSupersession.failedReviewReceiptRef` to
`triggerReceiptRef`. A park operation must write the state, residue, gate linkage, request and receipt
refs, active generations, and intervention linkage in one store commit. Exhaustion and no progress both
mint the single `iteration-park` gate kind with a reason of `exhausted` or `no-progress`. Gate approval
pins the exact parked generation set and marks `passed`; decline marks `declined`. Reject
`changes-requested` for an iteration-park gate because further rounds require another run. Scope the
advance and park guard to the affected iteration group: an open gate blocks only that group, not any
sibling group in the run. Keep the definition-declared
post-acceptance completion gate as a distinct gate kind with its existing approval, rejection, and
intervention behavior.

Retain the old store method names only as temporary typed wrappers over these generic transitions so
the uncut execution caller remains green. The wrappers must not contain transition logic or write old
records and are deleted in Task 13.

**Acceptance:** Every legal transition is a single atomic store mutation and every replay returns the
same record. No transition can choose an undeclared route, mutate the bound, or hide residue. In a run
with two active groups, one can remain parked at its open gate while the other advances and completes.

**Do not touch:** The execution scheduler, adapter prompt, HTTP routes, or SPA.

## Task 5: Carry iteration requests through the inert worker boundary

**Files:**

- `dashboard/server/control/execution.ts`, including `WorkerExecutionResult`, `WorkerAdapter`, and
  `ResultIntegrator` at lines 111-220
- `dashboard/server/control/claudeWorkerAdapter.ts`, especially `WorkerPromptInput` and
  `buildWorkerPrompt` at lines 254-333, stream parsing at lines 564-626, and adapter validation at
  lines 690-724
- `dashboard/server/control/claudeWorkerAdapter.test.ts`

**Write these tests first:**

- `claudeWorkerAdapter.test.ts`: `places the structured iteration request inside the inert input boundary`
- `claudeWorkerAdapter.test.ts`: `keeps the server-owned iteration contract outside the inert boundary`
- `claudeWorkerAdapter.test.ts`: `takes recipient mandate and perspective from the approved definition not request prose`
- `claudeWorkerAdapter.test.ts`: `carries preserved invariants and the next acceptance check in the inert request`
- `claudeWorkerAdapter.test.ts`: `requires exactly one closed iteration outcome for a verdict-producing turn`
- `claudeWorkerAdapter.test.ts`: `does not treat sender instructions perspective or findings as executable authority`
- `claudeWorkerAdapter.test.ts`: `allows artifact writes only when the recipient stage profile allows them`

**Implementation:** Replace `reviewContract` and `reviewOutcome` in the worker and integrator interfaces
with the generic iteration request, contract, and outcome. Put the sender's request, prior findings,
positions, preserved invariants, next acceptance check, instructions, and feedback inside the existing
inert delimiter. Outside it, put the server-authored schema instructions, allowed verdicts, criteria
ids, artifact refs, required output path, and the recipient's mandate and perspective read directly
from the approved definition. Validate the result through `parseIterationOutcome`. A forged request
copy of mandate or perspective cannot override those fields. Tool access remains a function of the
recipient stage's declared workflow profile; a judge can be writable and a peer can be read-only.

Keep temporary property adapters for `reviewContract` and `reviewOutcome` at interface boundaries still
used by Task 6. They translate to the generic fields and never create a second journal or receipt
family. Task 13 removes them after every caller moves.

**Acceptance:** The model sees enough artifact-bound context to act but cannot change its identity,
route, mandate, bound, or tool profile. Existing delimiter-injection tests remain green.

**Do not touch:** Store transition semantics, cycle accounting, HTTP gates, or UI.

## Task 6: Schedule turns and pin canonical lineage

**Files:**

- `dashboard/server/control/execution.ts`, including `runToBoundary` at line 732,
  `releaseDependents`, `reviewGeneration`, `isReviewOwned`, and `dependencyResultOperationKeys` at
  lines 1125-1164,
  `finalizeCanonicalSuccess` at lines 1173-1259, `prepareAttempt` at lines 1548-1584, and the integration
  calls at lines 1756-1988
- `dashboard/server/control/execution.test.ts`
- `dashboard/server/control/canonicalResultIntegrator.ts`, especially `lookup`, `resolveBase` at lines
  864-888, and `integrate` around lines 816-967
- `dashboard/server/control/canonicalResultIntegrator.test.ts`
- `dashboard/server/control/adapters.ts`, including result-record validation and integration around
  lines 421-568 and 808-842
- `dashboard/server/control/adapters.test.ts`
- `dashboard/server/control/codexExecAdapter.ts`, around the result handoff at line 262
- `dashboard/server/control/codexExecAdapter.test.ts`

**Write these tests first:**

- `execution.test.ts`: `selects the next participant only from the declared route and deterministic schedule`
- `execution.test.ts`: `activates initialStepId only after the declared seed generation commits`
- `execution.test.ts`: `never schedules one participant stage through the DAG and iteration loop at the same time`
- `execution.test.ts`: `opens cycle one at activation while an awaiting seed remains at cycle zero`
- `execution.test.ts`: `opens the next cycle only at a declared schedule step boundary`
- `execution.test.ts`: `runs a declared maxCycles above the legacy cap until semantic acceptance`
- `execution.test.ts`: `pins every turn to the server-selected generation refs base commit and artifact hashes`
- `execution.test.ts`: `resolves a verified canonical base for every fenced participant turn instead of the null unverified path`
- `execution.test.ts`: `pins a fan-in turn to the current generation of every peer and never generation one fallback`
- `execution.test.ts`: `creates one successor generation and one supersession for an artifact-producing turn`
- `execution.test.ts`: `records fulfilled between rework and the next reviewing verdict`
- `execution.test.ts`: `replays an already integrated turn by operation key without a second worker call`
- `execution.test.ts`: `keeps canonical operation keys collision-free across cycles for the same stage`
- `canonicalResultIntegrator.test.ts`: `resolves every iteration lookup base and integration inside the ops transaction span`
- `canonicalResultIntegrator.test.ts`: `verifies the compiler-derived dependency base for a fenced iteration participant`
- `canonicalResultIntegrator.test.ts`: `reads a byte-stable legacy review journal and exposes only a generic outcome to callers`
- `adapters.test.ts`: `validates a legacy review result in place and writes only generic fields for new results`
- `execution.test.ts`: `never releases a downstream DAG stage from a nonterminal iteration verdict`

**Implementation:** Replace `routeReviewReceipt` and generalize the real scheduling and generation
helpers: `releaseDependents`, `reviewGeneration`, `isReviewOwned`, and
`dependencyResultOperationKeys`. Use group lookup plus a server-selected `IterationRequest`. From run
creation, fence every non-seed participant stage from ordinary DAG
readiness. The declared seed participant alone remains a normal DAG stage until it commits the exact
activation artifact set. The group stays `cyclesUsed = 0` with no active schedule step before that
commit. The commit pins the seed generation, activates `initialStepId`, opens cycle one, and transfers
the seed participant to loop scheduling. Every participant is then loop-owned until termination, so no
stage can launch through both schedulers. `releaseDependents` must not make a fenced participant
DAG-ready merely because its compiled route dependencies have succeeded.

`prepareAttempt` must supply only the active generation refs and base commit chosen from durable group
state. The worker returns a transient `IterationOutcome`. `finalizeCanonicalSuccess`, after canonical
integration, adds the server-owned output generation refs, base and canonical commits, receipt ref,
timestamp, and hashes to mint the durable `IterationReceipt`, then records any supersession and advances
the route. An artifact-producing participant's durable receipt has the nonterminal `fulfilled` verdict
before the next review step. Preserve the request and logical-turn operation identity plus predecessor
attempt lineage across restart; recovery may create the normal successor attempt.

For every declared route, use the compiler-derived dependency and base-resolution linkage to call
`resolveBase` with nonempty verified dependencies before worker launch. Fenced participant turns must
never take its null, unverified zero-dependency path. `dependencyResultOperationKeys` must select each
routed dependency's current pinned generation from durable group state while the loop is in flight; a
missing accepted ref must not fall back to generation 1. A fan-in turn resolves and pins the current
generation of every peer.

Replace `runToBoundary`'s review-specific pass estimate at lines 753-755. Derive any internal progress
guard overflow-safely from the finite compiled schedules and declared group bounds, or yield at every
durable turn boundary. It must not reintroduce an implicit ceiling or truncate a valid high-bound group.

Keep every call to canonical git coordination inside `CanonicalResultIntegrator`'s serialized
`withOpsTransaction` span. This includes read-looking methods such as `lookup` and `resolveBase`, not
only `integrate` — with the one documented exception in the risk register: `resolveBase`'s deliberate
pre-serialization return for zero-dependency stages stays as-is, and fenced iteration turns never take
that path. Extend the existing P0 regression test rather than adding a second lock.

Move the file-backed result adapter, Codex exec handoff, and new canonical integration journal writes to
generic iteration contract and outcome fields in the same task. A legacy journal row is immutable
historical evidence: validate its original legacy hash and published-card wire byte-stably, leave its
raw keys and result hash untouched, and expose a generic outcome only in the in-memory caller result.
Only a new operation writes generic fields. Every new file replacement uses the existing shared atomic
write path and `renameWithRetrySync`.

**Acceptance:** A legal route advances exactly once with immutable lineage. All four example
configurations increment at their declared machine boundary, and a valid large bound is not truncated.
Every fenced participant turn has a verified base, and fan-in uses every peer's current generation. An
undeclared sender, recipient, base, or generation fails before worker launch or integration. Legacy
journals replay without mutation, new journals contain only the generic family, and DAG dependents remain blocked until
their iteration groups pass.

**Do not touch:** Termination policy, bounds, no-progress handling, gate routes, or graph UI.

## Task 7: Enforce semantic termination, bounds, budgets, and no progress

**Files:**

- `dashboard/server/control/execution.ts`, replacing `routeReviewReceipt`, updating budget reservation
  and settlement at lines 1837-1937, and updating `settleRunState` at lines 2059-2063
- `dashboard/server/control/execution.test.ts`
- `dashboard/server/control/store.ts`, including `runCanSucceed` at lines 2141-2147
- `dashboard/server/control/store.test.ts`

**Write these tests first:**

- `execution.test.ts`: `accepts an authorized terminal verdict at the declared bound without parking`
- `execution.test.ts`: `parks before launching maxCycles plus one and preserves the complete unresolved residue`
- `execution.test.ts`: `parks before integration when any required rework artifact is missing empty irregular or byte-identical`
- `execution.test.ts`: `records no successor or supersession and makes zero integration calls on no progress`
- `execution.test.ts`: `mints one iteration-park gate with reason no-progress and full exhaustion-equivalent residue`
- `execution.test.ts`: `reserves and settles the run token and cost windows for every participant turn`
- `execution.test.ts`: `opens the existing fail-closed intervention and preserves loop state when budget reservation fails`
- `store.test.ts`: `settles success only when every iteration group is terminal passed`
- `store.test.ts`: `keeps a declined completion-gated or iteration-parked group from successful settlement`
- `store.test.ts`: `resolves exhausted and no-progress iteration-park gates with identical approve or decline semantics`

**Implementation:** Validate the request, participant, verdict, and lineage first. For an
artifact-producing turn, validation includes the always-on artifact checks below; a worker claim cannot
bypass them. After validation, semantic acceptance is the first termination decision, followed by an
explicit park, then route and bound enforcement. Snapshot every declared output before launch with
regular-file status and a streamed SHA-256.
Inspect the worktree before `CanonicalResultIntegrator.integrate`. After the turn, require every
declared output to be regular and nonempty, then park when any required output remains byte-identical to
its corresponding pinned input. A no-progress park creates no successor generation or supersession and
makes no integration call. Preserve the attempted request, parsed outcome, artifact snapshot, and
failure reason in residue. A terminal verdict wins at any cycle count. A next turn beyond the bound
parks without launching. A byte-identical declared output parks under the doctrine in
`orgs/faceless-youtube/knowledge/decisions.md:3721-3730` and does not consume another cycle.

Both exhaustion and no progress call the same store park transition and mint the single
`iteration-park` gate kind, with reason `exhausted` or `no-progress`. They expose the same residue and
exact artifact set, accept only approve or decline, and never add an in-place turn or cycle.

Keep the existing accounting reservation before every worker call and settlement after every result.
Do not special-case roles out of token or cost windows. A reservation refusal keeps the loop at its
current durable step, interrupts the attempt and session, and opens the existing fail-closed human
intervention; it is not an exhaustion or no-progress park. Change `settleRunState` and `runCanSucceed`
so a run succeeds only when all DAG stages have succeeded and all iteration groups are `passed`.

**Acceptance:** Semantic acceptance and budget refusal retain their distinct durable records and
recovery paths. Exhaustion and no progress share the reason-coded `iteration-park` gate contract. There
is no silent pass, truncation, default cap, or platform ceiling.

**Do not touch:** Restart reconciliation, legacy row migration, queue bridge, or SPA.

## Task 8: Reconcile restarts

**Files:**

- `dashboard/server/control/execution.ts`, replacing `reconcileReviewRuntime` at lines 1334-1370
- `dashboard/server/control/execution.test.ts`

**Write these tests first:**

- `execution.test.ts`: `resumes a persisted request with no canonical result once using the same logical turn and operation identity`
- `execution.test.ts`: `allows recovery to create the normal successor attempt and session lineage`
- `execution.test.ts`: `replays a canonical receipt and successor exactly once after restart`

**Implementation:** Replace `reconcileReviewRuntime` with generic reconciliation keyed by persisted
request, attempt, operation, receipt, generation, and canonical commit refs. Treat the crash windows
separately. A persisted request with no canonical result resumes exactly once with the same request,
logical-turn operation identity, and pinned inputs while allowing the existing recovery path to mark the
old running attempt interrupted and create a successor attempt and session. A canonical result or
receipt already present is replayed and integrated exactly once without rerunning the worker. Preserve
the current `failed` state as the transient post-negative-verdict state, not a terminal run failure.

**Acceptance:** Restart reconciliation is idempotent across each crash window. It uses generic records
as authoritative, never reruns a completed worker turn, and never integrates or advances twice. The
Task 2 load-time validator remains active and rejects a corrupted fixture containing every record type
introduced through this task.

**Do not touch:** Public HTTP shape, queue bridge, SPA, or demo definitions.

## Task 9: Expose loop detail and resolve the human gate

**Files:**

- `dashboard/server/control/routes.ts`, including `runDetailDto` at lines 163-168, the generic human
  response guard around line 1392, and the review completion gate route around line 1443
- `dashboard/server/control/routes.test.ts`
- `dashboard/server/control/types.ts` for server DTO fields only
- `dashboard/src/components/AgentWorkPanel.tsx`, including specialized-gate filtering at lines 43-45
- `dashboard/src/components/AgentWorkPanel.test.tsx`

**Write these tests first:**

- `routes.test.ts`: `returns participants routes cycles turn owner verdict lineage and full residue in run detail`
- `routes.test.ts`: `approves only the exact iteration-park artifact set with matching gate reason and loop versions`
- `routes.test.ts`: `declines an exhausted or no-progress iteration-park gate and makes the run unable to succeed`
- `routes.test.ts`: `rejects changes-requested and stale approval for an iteration-park gate`
- `routes.test.ts`: `preserves the optional post-acceptance completion gate and withholds downstream release`
- `routes.test.ts`: `does not let the generic intervention endpoint bypass the iteration gate contract`
- `AgentWorkPanel.test.tsx`: `excludes reason-coded iteration-park gates from generic human response controls`

**Implementation:** Grow `runDetailDto` to expose the authoritative iteration records needed by the
SPA. Replace the review-specific completion endpoint with an iteration-gate endpoint using exact gate,
gate-kind, park-reason, loop-version, and generation-set compare-and-swap inputs. The one
`iteration-park` kind accepts reason `exhausted` or `no-progress`; either reason uses the same approval
and decline handler. Approval accepts the displayed artifact set, decline marks the group `declined`
and the run `failed`, and `changes-requested` is invalid. For a definition-declared post-acceptance completion gate, preserve the existing approval,
rejection, and intervention behavior while keeping participant scheduling stopped. Keep the generic
human-response route and `AgentWorkPanel` generic controls from resolving either specialized gate. An iteration-park response names separate
relaunch as the only continuation path. Until the SPA moves in Task 11, keep the old completion URL as a
temporary route alias into the generic completion-gate handler. It accepts no `iteration-park` gate and is
deleted in Task 13.

**Acceptance:** The API provides enough state to audit a pass or park without log reconstruction. A
stale page, changed artifact, or wrong endpoint cannot approve the loop.

**Do not touch:** Store semantics already completed in Task 4, worker execution, queue bridge, or SPA
surfaces other than the minimal `AgentWorkPanel` specialized-gate filter.

## Task 10: Preserve iteration groups through the W7 queue bridge

**Files:**

- `dashboard/server/control/queueBridge.ts`, especially `registeredWorkflowRequest` at line 317,
  `cardToWorkflowRequest` at line 415, and `dispatchClaimedCard` at line 577
- `dashboard/server/control/queueBridge.test.ts`
- `dashboard/server/control/launch.ts` only if its existing snapshot type must expose the compiled groups

**Write these tests first:**

- `queueBridge.test.ts`: `launches one registered workflow run with the exact compiled iteration groups`
- `queueBridge.test.ts`: `preserves participant mandates routes maxCycles and definition hashes through workflow-def dispatch`
- `queueBridge.test.ts`: `does not synthesize queue cards for iteration turns`
- `queueBridge.test.ts`: `rejects a workflow-def card whose declared tier cannot cover an iteration participant stage`

**Implementation:** Carry the compiler-owned `iterationGroups` value through the existing registered
definition request and the one `launch` call. Keep the bridge's safe workflow id, project containment,
definition byte limit, parameter validation, risk floor, and authoritative per-stage work orders. The
bridge launches one governed run. Internal participant turns remain engine records and attempts, not
queue cards.

**Acceptance:** A card with `execution-controller: dashboard`, `owner: dashboard-engine`, and
`workflow-def: iteration-loop-demo` launches one run containing the exact groups from the registered
definition. W7 retains one owner and one reconciliation path.

**Do not touch:** `governance/card-schema.md`, the terminal runner, dispatcher ownership rules, or loop
state transitions.

## Task 11: Add authoritative loop data to SPA DTOs and graph derivation

**Files:**

- `dashboard/src/control/controlClient.ts`, replacing `ReviewLoopDto` and `ReviewReceiptDto` at lines
  257-287
- `dashboard/src/control/controlClient.test.ts`
- `dashboard/src/control/runGraph.ts`, especially `AgentRunOverlay`, `entryFromRun`, and
  `overlaysFromRun` at lines 14-102
- `dashboard/src/control/runGraph.test.ts`
- `dashboard/src/views/RunDetail.tsx`, around the `WorkflowAgentGraph` input near line 1112
- `dashboard/src/views/WorkflowAgentGraph.tsx`, including `agentGroups` agent-keyed derivation at lines
  228-250 and `agentEdges` at line 361, for the participant-stage model passed to Task 12
- `dashboard/src/views/WorkflowAgentGraph.test.tsx`
- `dashboard/src/components/AgentWorkPanel.tsx`, including its completion-request filtering around
  lines 43-45
- `dashboard/src/components/AgentWorkPanel.test.tsx`
- `dashboard/src/views/ApprovalsLive.test.tsx`

**Write these tests first:**

- `controlClient.test.ts`: `retains complete iteration loop request receipt and residue fields from run detail`
- `controlClient.test.ts`: `resolves completion and reason-coded iteration-park gates through the dedicated iteration endpoint`
- `AgentWorkPanel.test.tsx`: `excludes specialized iteration gates from the generic human response controls`
- `ApprovalsLive.test.tsx`: `accepts run detail with generic iteration collections and no review collections`
- `runGraph.test.ts`: `adds role cycle turn owner last verdict and park state to each participant overlay`
- `runGraph.test.ts`: `keeps two stages using one agent as distinct participant overlays keyed by stage group and participant`
- `runGraph.test.ts`: `derives iteration edges only from server-declared routes`
- `runGraph.test.ts`: `keeps iteration edges distinct from DAG dependencies with stable ids`
- `runGraph.test.ts`: `shows one accepted generation and full parked residue without inferring either from logs`
- `WorkflowAgentGraph.test.tsx`: `derives a distinct participant-stage row for each loop role when one agent owns multiple stages`

**Implementation:** Replace review DTOs with the server's iteration loop, participant, route, request,
receipt, generation, and residue shapes. Extend `AgentRunOverlay` and graph derivation with role,
perspective summary, cycle and bound, turn ownership, last verdict, park/gate state, and accepted artifact
refs. Return iteration edges as a separate typed collection. Pass those values from `RunDetail` to the
graph. Rename `resolveReviewCompletionGate` at lines 973-986 to `resolveIterationGate` and bind it to the
new dedicated endpoint with gate kind and compare-and-swap fields. Update `AgentWorkPanel` and existing
approval fixtures so neither generic human controls nor old DTO names survive.

Extend the graph DTO and `agentGroups` derivation with participant-stage rows keyed by stage id,
iteration group id, and participant id. Keep one outer card per agent for the minimal UI change, but do
not merge loop role, cycle, bound, turn owner, verdict, or gate state across that agent's stages.
`agentEdges` keeps ordinary DAG edges at agent-card level and carries iteration route endpoints to the
distinct participant-stage rows.

**Acceptance:** DTO parsing and graph derivation are lossless for audit fields. Every participant stage
remains distinct even when several stages use one agent. Missing optional state renders as absent; the
client never fabricates a verdict, route, or accepted generation.

**Do not touch:** Server behavior, React node markup, CSS, or demo definitions.

## Task 12: Render iteration state on agent cards and distinct edges

**Files:**

- `dashboard/src/views/WorkflowAgentGraph.tsx`, including `agentGroups` keying at lines 228-250,
  `agentEdges` at lines 361-405, `AgentNode` around lines 465-492, and run-overlay handling at lines
  602-639
- `dashboard/src/views/WorkflowAgentGraph.test.tsx`
- `dashboard/src/views/RunDetail.tsx`, including iteration-gate detection and submission around the
  current review gate code at lines 943-994
- `dashboard/src/views/RunDetail.test.tsx`
- `dashboard/src/components/AgentWorkPanel.tsx`, the graph-selected participant detail surface
- `dashboard/src/components/AgentWorkPanel.test.tsx`
- `dashboard/src/styles/views/workflows.css`, including handoff-edge styles around line 183 and agent
  state styles around line 338

**Write these tests first:**

- `WorkflowAgentGraph.test.tsx`: `renders participant role cycle bound and current turn owner on agent cards`
- `WorkflowAgentGraph.test.tsx`: `renders distinct per-stage participant rows for multiple loop stages owned by one agent`
- `WorkflowAgentGraph.test.tsx`: `renders the last semantic verdict and a visible parked gate chip`
- `WorkflowAgentGraph.test.tsx`: `renders iteration routes with a class and marker distinct from DAG handoffs`
- `WorkflowAgentGraph.test.tsx`: `opens loop detail with mandate perspective receipts commits and unresolved residue`
- `WorkflowAgentGraph.test.tsx`: `does not label an exhausted or declined group as complete`
- `RunDetail.test.tsx`: `approves or declines either iteration-park reason with the displayed loop version and generation set`
- `RunDetail.test.tsx`: `submits the optional post-acceptance completion gate without reopening a turn`
- `AgentWorkPanel.test.tsx`: `shows the selected participant mandate perspective lineage receipts and parked residue`

**Implementation:** Merge the separately typed iteration edges into the React Flow edge list with stable
ids, a distinct marker, and a dedicated CSS class. Render the Task 11 participant-stage model as compact
per-stage rows on each agent card, keyed by stage id, iteration group id, and participant id. Each row
shows its own role, cycle/bound, turn owner, last verdict, and park/gate status; no agent-level merge may
collapse those values. The detail interaction must expose immutable mandates and
perspectives, request and receipt lineage, positions and dissent, and the exact artifact set presented
for approval in `AgentWorkPanel`, the existing graph-selected detail surface. Replace `RunDetail`'s review-specific gate detection and submit call with the generic
iteration gate client. Render either iteration-park reason as approve or decline only, and render the distinct optional
completion gate with its preserved response choices.

**Acceptance:** The graph clearly separates workflow dependency flow from iteration traffic. A parked
loop is visible from the relevant participant-stage row and its edge without opening raw logs. Reusing
one agent across groups never merges their role, cycle, bound, or turn-owner state. Existing DAG layout
and handoff tests remain green.

**Do not touch:** Server DTOs, execution state, unrelated workflow-page styling, or global graph layout.

## Task 13: Complete the ReviewLoop cutover and delete compatibility paths

**Files:**

- `dashboard/server/control/types.ts`
- `dashboard/server/control/store.ts` and `dashboard/server/control/store.test.ts`
- `dashboard/server/control/reviewOutcome.ts` and `dashboard/server/control/reviewOutcome.test.ts`
- `dashboard/server/control/execution.ts` and `dashboard/server/control/execution.test.ts`
- `dashboard/server/control/claudeWorkerAdapter.ts` and
  `dashboard/server/control/claudeWorkerAdapter.test.ts`
- `dashboard/server/control/adapters.ts` and `dashboard/server/control/adapters.test.ts`
- `dashboard/server/control/codexExecAdapter.ts` and
  `dashboard/server/control/codexExecAdapter.test.ts`
- `dashboard/server/control/canonicalResultIntegrator.ts` and
  `dashboard/server/control/canonicalResultIntegrator.test.ts`
- `dashboard/server/control/routes.ts` and `dashboard/server/control/routes.test.ts`
- `dashboard/src/control/controlClient.ts` and `dashboard/src/control/controlClient.test.ts`

**Write these tests first:**

- `store.test.ts`: `returns run detail with iteration collections and no review collections after cutover`
- `adapters.test.ts`: `writes and replays only iteration contract and outcome properties after cutover`
- `canonicalResultIntegrator.test.ts`: `leaves a legacy journal byte-stable while exposing no review fields to callers`
- `routes.test.ts`: `returns not found for the removed review completion gate endpoint`
- `controlClient.test.ts`: `uses no review DTO or review gate client surface after cutover`

**Implementation:** Remove the temporary projections, method wrappers, property aliases, parser alias,
and HTTP alias introduced to keep Tasks 2-12 independently green. Remove `ReviewLoop`, `ReviewReceipt`,
`routeReviewReceipt`, `reconcileReviewRuntime`, `resolveReviewCompletionGate`, and review-named DTOs and
worker or journal fields. Delete their obsolete tests and fixtures only after equivalent generic tests
exist.

Keep the isolated legacy readers because they still serve deployed data: the workflow compiler's
`review` input mapping, store-row decoder, and canonical journal decoder. Name and isolate them as
migrations. Store migration may write the generic store shape on a normal commit. The canonical journal
decoder must leave historical rows byte-stable because their wire and result hash bind published
evidence. All readers return generic records and can neither schedule a turn nor create a new old-shape
record. Run `rg` over
production sources to confirm every other `ReviewLoop`, `ReviewReceipt`, `reviewContract`,
`reviewOutcome`, and review-completion endpoint reference is gone.

**Acceptance:** All targeted server and SPA suites pass with one runtime state machine and one receipt
family. New persistence and API output contain no review-only records. A legacy definition, store file,
and canonical journal still migrate idempotently through their isolated readers.

**Do not touch:** The legacy migration inputs themselves, queue bridge ownership, workflow semantics,
or demo definitions.

## Task 14: Add the no-spend demo and capture live proof

**Files:**

- new `orgs/faceless-youtube/workflows/iteration-loop-demo.md`
- new `dashboard/server/workflows/compile.iterationLoopDemo.test.ts`
- `dashboard/server/control/queueBridge.test.ts` only for the registered-definition fixture from Task 10

**Write these tests first:**

- `compile.iterationLoopDemo.test.ts`: `compiles the demo into pairwise judge exhaustion and no-progress groups with explicit cycle units and bounds`
- `compile.iterationLoopDemo.test.ts`: `marks the exact machine cycle boundary on every demo schedule`
- `compile.iterationLoopDemo.test.ts`: `keeps every demo stage local T2 and free of external or spend capabilities`
- `compile.iterationLoopDemo.test.ts`: `allows one group to park while a sibling group is mid-cycle`
- `compile.iterationLoopDemo.test.ts`: `makes the no-progress producer return a byte-identical required output`

**Implementation:** Create one `executionMode: validation-slice` workflow with a required `slug`
parameter and only local T2 artifact work under
`orgs/faceless-youtube/output/iteration-loop-demo/<slug>`. Bind executable stages to the declared
`fyt-story` and `fyt-checker` agents with their existing Codex worker profiles. Declare `fyt-runner` as
the workflow manager with its existing Codex manager profile; do not bind it to a worker stage. Declare
these four groups:

1. `pair-fix-accept`, `maxCycles: 1`: Y creates the initial local artifact, X records one structured
   rework request, Y changes the declared status marker, and X accepts the successor in the same
   feedback/response/check cycle. The receipts are `rework`, `fulfilled`, `accept`; the check step is
   the declared cycle boundary.
2. `judge-rework-pass`, `maxCycles: 2`: the producer's first local JSON generation is deliberately
   `draft`; the judge fails the named readiness criterion; the producer changes it to `ready`; the judge
   passes the exact successor. The receipts are `fail`, `fulfilled`, `pass`; each judge verdict closes
   its producer-generation/judge-verdict cycle.
3. `exhaust-with-residue`, `maxCycles: 1`: the local artifact truthfully records that an external source
   id is unavailable. The producer mandate forbids fabrication, the judge criterion requires the id,
   and the judge fails. Exhaustion parks with that finding, the producer's recorded position, the judge
   position, all refs, and the artifact visible. Codex execution keeps network and web search disabled;
   no stage declares an external action, spend authorization, image, voice, or publishing capability.
4. `no-progress-park`, `maxCycles: 2`: the producer receives a declared rework request but writes the
   required output byte-for-byte unchanged. The runtime parks before canonical integration with
   `iteration-park` reason `no-progress`, the attempted request and outcome, artifact snapshot and hash,
   and the exact artifact set visible. Its schedule overlaps another group's live cycle so this park
   proves the group-scoped gate guard instead of relying on demo order.

**Live proof recipe:**

1. From `dashboard/`, run `npm run dev:server` and `npm run dev` in separate terminals. Open the local
   dashboard, sign in, and confirm the header says `Execution armed`.
2. In PowerShell, run
   `$proofSlug = 'p1-iteration-proof-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'); $proofSlug`.
   In Workflows, open `iteration-loop-demo`, paste that exact output into `slug`, and launch once. Record
   the returned `runRef`.
3. Watch the graph. Expect `pair-fix-accept` to show `1/1`, receipts `rework`, `fulfilled`, `accept`,
   one supersession, and state `passed`. Expect `judge-rework-pass` to show `2/2`, receipts `fail`,
   `fulfilled`, `pass`, and the accepted successor generation. Neither group may visit a human gate.
4. While another group is mid-cycle, expect `exhaust-with-residue` to stop at `1/1` in
   `awaiting-park-gate` with `iteration-park` reason `exhausted`. Confirm the gate shows the missing
   source-id finding, producer and judge positions, request and receipt refs, generation refs, base and
   canonical commits, artifact hashes, the next route, and the exact artifact set. Confirm the run is not
   successful, then confirm the sibling group continues and completes while this gate remains open.
5. Approve that exact artifact set. Expect the exhaustion group to become `passed` without cycle 2.
   Then expect `no-progress-park` to write its required output byte-identically and stop before canonical
   integration in `awaiting-park-gate` with reason `no-progress`. Confirm it shows the same residue fields
   and approve-or-decline controls as exhaustion, with no successor generation or supersession. Approve
   the displayed set and expect the run to settle successfully.
6. Launch the same immutable definition again with a new timestamped slug. Confirm a new `runRef` and
   cycle count starting at zero. At either iteration-park gate choose decline. Expect group state
   `declined`, run state `failed`, and no mutation of either run's bound. This proves a separate rerun
   lineage. The relaunch is a fresh run and inherits no hidden cross-run state; any artifact reuse is the
   operator's explicit choice through the normal definition-input mechanism.
7. Capture both run refs, the group states and cycle counts, terminal receipt refs, accepted generation
   refs, both iteration-park gate refs and reasons, canonical commits, and graph screenshots in the implementation card or PR
   evidence. Give that evidence, the focused test output, and the exact 7-error typecheck output to the
   Opus reviewer, then to Daniel.

**Acceptance:** The compiled fixture proves all bounds and capabilities statically. The two live runs
prove peer acceptance without a judge, judge rework and pass, full-residue exhaustion parking, exact-set
approval, byte-identical no-progress parking, group-scoped gate isolation, decline, and separate relaunch.
No external action, provider call, or spend authorization occurs.

**Do not touch:** Production faceless-youtube workflows, channel artifacts, spend gates, external
connectors, or queue-card schemas.

## Final verification

From `dashboard/`, run the focused suites covering every changed seam:

```text
npm test -- server/workflows/defs.test.ts server/workflows/compile.test.ts server/workflows/compile.iterationLoopDemo.test.ts
npm test -- server/control/proposal.test.ts server/control/compiler.test.ts server/control/reviewOutcome.test.ts
npm test -- server/control/store.test.ts server/control/execution.test.ts server/control/claudeWorkerAdapter.test.ts
npm test -- server/control/adapters.test.ts server/control/codexExecAdapter.test.ts server/control/canonicalResultIntegrator.test.ts
npm test -- server/control/routes.test.ts server/control/queueBridge.test.ts
npm test -- src/control/controlClient.test.ts src/control/runGraph.test.ts src/components/AgentWorkPanel.test.tsx
npm test -- src/views/RunDetail.test.tsx src/views/WorkflowAgentGraph.test.tsx src/views/ApprovalsLive.test.tsx
npm run typecheck
```

The first seven commands must be green. Save the `npm run typecheck` output and compare it to the checked
baseline: exactly 7 known errors, with no changed location or new error. Then complete the Opus
adversarial review, the two-run LIVE RUN PROOF in Task 14, and Daniel's gate. A pass requires evidence for
all three; none may be waived by the others.

## Amendments

### A1 (2026-08-13, boss ruling) — Task 6 gains store.ts for producer-turn completion

**Trigger:** The Task 6 implementer stopped per the execution rules: Task 4's landed generic
transitions cannot express Task 6's required semantics. Verified against `store.ts` at HEAD
800ba78: (1) `recordIterationRequest` is legal only in `awaiting-turn` (:5006); (2)
`advanceIterationTurn` parks queued successors in `rework-queued`, where no request can be
recorded (:5251); (3) the legacy projection inside `recordStageGeneration` auto-routes a
producer commit straight to the judge with no durable `fulfilled` receipt (:4887-4914); (4) no
generic transition mints or adopts the queued successor generation — only the legacy path does;
(5) `recordIterationReceipt` binds every receipt to the primary INPUT generation's base and
canonical commits (:5084-5087), contradicting Task 6's post-integration receipt whose lineage
for an artifact-producing turn is the OUTPUT successor's.

**Ruling:** This is mechanical completion of the one-state-machine contract already stated in
Task 4's acceptance ("Every legal transition is a single atomic store mutation") and Task 6's
implementation text (durable `fulfilled` receipts between rework and the next reviewing
verdict). No Daniel-locked semantic changes (termination order, bounds, park contract, gate
kinds are untouched). Task 6's file list therefore gains `dashboard/server/control/store.ts`,
`dashboard/server/control/store.test.ts`, and `dashboard/server/control/types.ts` for exactly
these changes:

1. Producer turns are first-class loop turns. `recordIterationRequest` is also legal when the
   loop awaits its producer turn (state `rework-queued`, recipient = the successor route's
   recipient); recording transitions to `running-turn` as usual. No other entry state changes.
2. `recordIterationReceipt` branches its lineage check by verdict family: verdict-producing
   receipts keep the existing input-generation binding; a `fulfilled` receipt validates OUTPUT
   lineage — its `outputGenerationRefs` name the committed successor generation(s) whose base
   and canonical commits match the receipt's, with the request's input refs preserved on the
   receipt for audit. `fulfilled` still cannot terminate a group and still carries no criteria
   verdicts (parser-enforced).
3. The generic path adopts/commits the queued successor generation for producer turns without
   the legacy projection. The legacy auto-route inside `recordStageGeneration` remains solely
   for the uncut legacy-syntax callers and is deleted or reclassified as migration-only in
   Task 13; the Task 6 execution engine never routes new-syntax runs through it.
4. Cycle accounting for producer turns derives from schedule-step cycle markers exactly like
   verdict turns (no separate counter).
5. The Task 2 durability validator covers `fulfilled` receipts and any state-union adjustment;
   the corrupted-fixture load test grows to include one.

**New named store tests (in addition to Task 6's list):**
`records a producer iteration request while a rework successor is queued`,
`mints a durable fulfilled receipt with output lineage after canonical integration`,
`rejects a fulfilled receipt whose output lineage does not match the committed successor`,
and the full pre-amendment store suite stays green (any landed test that enshrines the
legacy-only mechanism may be adjusted only with an explicit list and justification).

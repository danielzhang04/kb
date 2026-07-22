# FYT checker runtime: durable outcomes and bounded rework

## Decision and critical blockers

This is an incremental design for the control engine, not a second executor or a UI
workflow.  The intended loop is:

`creator generation N commits canonical result -> fresh read-only checker -> pass -> optional human approval -> release`,

or `fail -> creator generation N+1`, up to the immutable authored bound.  A checker
never edits the subject, never receives a live creator session, and never turns a
failed result into an untracked retry.

Three blockers govern activation of this runtime:

1. **Fixed in `b205acf`:** declaration, compiler, and server-compiled validation now
   require exactly `workflowProfile: checker-readonly` for every review stage.
2. `execution.ts` currently passes `proposal.profile` to every worker, ignoring the
   new per-stage `workflowProfile`.  Consequently a declared checker override cannot
   cap the spawned checker.  Resolve and pass the effective stage profile, fail closed
   when it is absent, and test that the checker receives `checker-readonly`.
3. A canonical result is currently one immutable receipt per `(runRef, stageId)` and a
   succeeded `Stage` is terminal.  Reopening that stage through the generic lifecycle,
   replacing its receipt, or reusing `result:${runRef}:${stageId}` for a successor
   generation would corrupt replay and downstream lineage. Rework therefore requires immutable generation records,
   generation-qualified canonical-result keys, and one privileged, atomic
   generation-advance store method; do not add a generic `succeeded -> ready` edge.

Unsafe shortcuts rejected: model prose as an outcome; parsing arbitrary tool stream
events; a checker write scope with an instruction saying "do not edit"; letting the
creator overwrite its prior canonical receipt; creating an approval request before a
checker pass; or treating a malformed/missing outcome as pass.

## Closed checker payload

The existing Claude `stream-json` result event remains the sole transport.  For a
review stage, its final `result` string must be exactly one UTF-8 JSON object with
this closed shape; no second stdout channel, sidecar file, or tool-event protocol is
introduced:

```ts
type ReviewOutcome = {
  schema: 'kb.review-outcome/v1';
  decision: 'pass' | 'fail' | 'parked';
  summary: string;                         // 1..4,000 chars, no NUL
  criteria: Array<{
    criterionId: string;                   // each authored criterion exactly once
    verdict: 'pass' | 'fail' | 'unverified';
    findingIds: string[];                  // unique safe ids, 0..32
  }>;
  findings: Array<{
    id: string;                            // unique safe id
    criterionId: string;                   // one of criteria[].criterionId
    severity: 'blocking' | 'advisory';
    summary: string;                       // 1..2,000 chars, no NUL
    evidencePaths: string[];               // unique safe repo-relative paths, 0..16
  }>;
};
```

Parser rules are structural, bounded, and cross-checked against the immutable
`ProposalStage.review.criteria` snapshot:

- Reject unknown and missing fields at every level; reject duplicate IDs, unknown
  criterion IDs, unsafe paths, invalid UTF-8/JSON, and oversized text or arrays.
- `criteria` contains every declared criterion exactly once, in declaration order.
  Findings reference one declared criterion and their IDs appear only in that
  criterion's `findingIds` (and every listed ID exists once).
- `pass` means every criterion is `pass`, none is `unverified`, and there are no
  `blocking` findings. `fail` means no criterion is `unverified`, at least one is
  `fail`, and each failed criterion has a linked blocking finding. `parked` requires
  at least one `unverified` criterion and never schedules automatic rework.
- The server, not the model, binds `subjectStageId`, `subjectGeneration`, subject
  `resultHash`, checker attempt, review definition hash, timestamps, and a canonical
  hash of this outcome. They are durable receipt fields, not model-authored fields.

`parseWorkerStream` already selects the final successful stream-json `result` event.
Add a review-aware strict parse at that point (or immediately after it in the adapter)
and populate `WorkerExecutionResult.reviewOutcome` only for an input carrying a review
contract. A normal stage keeps the exact legacy result mapping. A review-stage
`WAITING-HUMAN:` marker, non-JSON text, or semantic mismatch is a malformed outcome:
park the review with an intervention; it must not become a generic success or a pass.

## Durable model and migration

Keep `Stage`, `Attempt`, and existing canonical receipts immutable history. Add two
store-owned append-only collections rather than altering a succeeded record:

```ts
type StageGeneration = {
  generationRef: string;
  runRef: string;
  logicalStageRef: string;                 // original Stage.stageRef
  logicalStageId: string;
  generation: number;                      // 1 for the original execution
  predecessorGenerationRef: string | null;
  attemptRef: string;
  canonicalResultOperationKey: string | null;
  resultCardRef: string | null;            // generation 1 workflow card only; null for g >= 2
  resultHash: string | null;
  baseCommit: string | null;               // exact IntegrationRecord.baseCommit, including g1
  canonicalCommit: string | null;          // exact IntegrationRecord.integrationCommit
  state: 'queued' | 'running' | 'committed';
  createdAt: string;
  updatedAt: string;
};

type GenerationSupersession = {
  predecessorGenerationRef: string;
  successorGenerationRef: string;
  failedReviewReceiptRef: string;
  operationKey: string;
  createdAt: string;
};

type ReviewReceipt = {
  reviewReceiptRef: string;
  runRef: string;
  reviewStageRef: string;
  subjectStageRef: string;
  subjectGenerationRef: string;
  subjectResultHash: string;
  checkerAttemptRef: string;
  outcome: ReviewOutcome;
  outcomeHash: string;
  operationKey: string;
  state: 'passed' | 'awaiting-completion-gate' | 'failed' | 'parked';
  completionRequestRef: string | null;
  createdAt: string;
  finalizedAt: string | null;
};
```

Store the immutable `maxCreatorReworks`, review-definition digest, and current active
generation pointer in a `ReviewLoop` record keyed by `(runRef, reviewStageRef)`:
`reworksUsed`, `state` (`checking`, `rework-queued`, `awaiting-gate`, `passed`,
`parked`), `activeGenerationRef`, `acceptedGenerationRef`, and `activeReceiptRef`.
`GenerationSupersession` is append-only: after a generation has committed its payload,
hash, and canonical commit never change; a successor relationship is recorded beside
it instead. The store validates one loop per review stage, one receipt per `(loop,
subjectGeneration)`, monotonically increasing generations, and that all refs belong
to the same run. A committed `StageGeneration` has non-null `baseCommit`,
`canonicalCommit`, and `resultHash`; they must equal, byte-for-byte, the matching v2
integration record's `baseCommit`, `integrationCommit`, and `result.resultHash`.
Its `canonicalResultOperationKey` and `resultCardRef` must likewise equal that
record's `operationKey` and `resultCardRef`. This equality applies to generation 1 as
well as successors.

### Exact runnable-generation mechanism

Choose **one logical `Stage` plus a privileged atomic generation advance**, not
synthetic `stageId` values. The existing dashboard, dependency graph, canonical card
link, route DTOs, and `stageById(proposal, stageId)` all treat `stageRef`/`stageId` as
the stable logical identity. Synthetic `creator--g2` stages would either break that
identity or require an unreviewed, server-mutated proposal graph. The original `Stage`
row consequently becomes the mutable projection for its *current* generation; immutable
history lives in `StageGeneration` and the existing `Attempt`/`ManagedSession` rows.

Add the following nullable/current fields to a loop-managed logical stage only:

```ts
currentGenerationRef: string | null;
currentGeneration: number;                 // starts at 1
acceptedGenerationRef: string | null;      // null until review pass (+ gate, if any)
```

Add `advanceReviewGeneration(subject, runRef, input)` to `ControlPlaneStore`. It is
the sole method allowed to move a loop-managed creator projection from `succeeded` to
`ready`, and simultaneously moves the paired review-stage projection from `succeeded`
to `blocked`. It requires: expected versions for creator, checker, loop, failed
receipt, and current creator attempt; the failed receipt must bind the current creator
generation; checker attempt/session must already be terminal-successful; the review
stage must directly depend on that creator; no open completion gate may exist; and
`reworksUsed < maxCreatorReworks`.

In one store commit it:

1. appends a `GenerationSupersession` from creator generation `N` to `N+1` (never
   edits N's result/hash/commit), increments `reworksUsed`, and appends creator
   generation `N+1` in `queued` state;
2. appends a queued creator `Attempt` with `predecessorAttemptRef` equal to generation
   `N`'s attempt, sets the logical creator's `currentAttemptRef`,
   `currentGenerationRef`, `currentGeneration`, and state to `ready`;
3. preserves the successful checker attempt as history, clears only the *logical*
   checker projection's `currentAttemptRef`, and sets that checker stage to `blocked`
   so normal dependency release will create a fresh checker attempt after creator
   generation `N+1` commits; and
4. changes the loop to `rework-queued`, invalidates no historical receipt, and records
   the `rework:${runRef}:${subjectStageId}:g${N+1}` operation key/fingerprint.

This is intentionally not expressible through `transitionStage`. Its implementation
must live beside the store's other compound projection operations, validate all
relationship and version preconditions under one document lock, and replay the exact
already-created generation on an identical key. Generic `STAGE_EDGES` remains unchanged;
ordinary callers can never reopen a succeeded stage. `createAttempt` remains usable
only for the current nonterminal projection and must refuse an attempt whose supplied
generation does not equal `Stage.currentGeneration`.

Migration is additive. Existing documents deserialize with no generation/loop rows or
current-generation fields; non-checker stages retain their current behavior. When a
checker loop is initialized, an existing successful subject becomes immutable generation
1 and the stage projection receives `currentGeneration = 1`. Existing non-checker run
bytes, hashes, stage lifecycles, and result IDs remain unchanged. New result storage
moves from the old unique key `(runRef, stageId)` to `(runRef, stageId, generation)`
only for loop-managed creator generations. The generation-1 operation key is
**universally** the legacy `result:${runRef}:${stageId}` key: this applies to
pre-existing rows, migrated rows, and newly created loop-aware runs. Only a successor
generation `g >= 2` uses `result:${runRef}:${stageId}:g${generation}`. The result
integrator must retain every receipt and expose an explicit active-generation lookup;
never overwrite or relabel old records.

## Runtime state machine

1. A creator's generation completes only after the existing server inspection and
   canonical integration succeed. Record its `StageGeneration` as `committed`.
   Dependents are still held if that logical creator has an active review loop.
2. Spawn the checker in a fresh attempt/worktree based on that exact committed subject
   lineage. Its prompt contains the immutable review criteria and exactly one inert
   dependency result: the committed subject result (`resultHash`, summary, artifacts,
   changed paths/digests, checkpoints). It contains no creator conversation, previous
   checker output, operator feedback, or other dependency summaries.
3. The checker must use `checker-readonly`, `readScope` only, empty `writeScope`, and
   yield no artifacts/checkpoints. Server inspection must return zero changed files.
   Any write, artifact, checkpoint, unknown tool cap, or malformed outcome parks the
   loop for intervention and preserves the subject generation unchanged.
4. `pass` creates the authored completion `HumanRequest(kind: 'approval')` only now,
   with the immutable outcome summary/hash in its prompt. With no completion gate the
   receipt may become `passed` immediately. An approved request marks the receipt and
   loop `passed`; rejection or changes-requested parks it. Only `passed` releases
   downstream stages.
5. A valid checker `fail` is a successful **checker attempt**: persist the failed
   receipt, then call `advanceReviewGeneration`. That atomically creates creator
   generation `N+1`, resets the logical creator to ready, and resets the logical
   checker to blocked. Once creator `N+1` commits, ordinary dependency release makes
   the checker ready and creates a fresh checker attempt. The new creator gets the
   durable failed outcome as inert feedback, not a mutable checker session. If the
   bound is exhausted, create one intervention request and park; do not silently fail
   the run or exceed the bound.
6. `parked` always creates/reuses one intervention request and blocks release. A human
   decision may only resume a documented server transition (for example, approve an
   explicit plan amendment); it cannot turn a parked or failed review into `passed`.

`Stage.state` is the current-generation projection, not immutable history for a
loop-managed stage. `StageGeneration(N).state === committed` is the durable fact that
creator generation N succeeded; `acceptedGenerationRef` and the review-loop pass
condition are the release authority. `releaseDependents` must require both ordinary
current-projection dependency success and, for each dependency with a review loop, an
accepted latest generation. This prevents a sibling dependent from bypassing the
checker merely because it directly depends on the creator.

### Exact base and integration semantics

The integrator must return and durably bind the server-owned canonical integration
commit for every generation; a worker never supplies it.

- Generation 1 uses the existing dependency-base resolution and the legacy operation
  key `result:${runRef}:${stageId}`, producing
  `StageGeneration(1).canonicalCommit`. For a direct dependency with a review loop,
  the resolver selects its accepted generation; an ordinary dependency continues to
  use its existing committed result.
- Creator generation `N+1` is based **only** on creator generation `N`'s verified
  `canonicalCommit`, not on a recomputed dependency base and never on repository HEAD.
  That commit already contains the accepted upstream base plus the prior creator
  output, so the reworker can make a delta while remaining reproducible. The resolver
  checks the exact generation ref/result hash/commit before creating the worktree.
- The fresh checker for generation `N+1` uses exactly that generation's canonical
  commit. Its sole prompt dependency is the matching committed result; it cannot
  inspect a newer worktree or earlier checker state.
- After pass (and delayed approval when authored), a downstream node with exactly one
  direct dependency selects that dependency's accepted-generation canonical commit.
  The first safe runtime does **not** compose multiple reviewed dependency commits:
  when a node has more than one direct dependency and any selected dependency is
  generation-managed, it creates/reuses a non-approvable intervention and parks with
  `reviewed-multi-dependency-composition-not-supported`. Deterministic merge
  composition is deferred to a separately reviewed design. Commits referenced by a
  `GenerationSupersession` stay addressable for audit only and are never selected as
  active lineage.

### Implementation addendum: generation-qualified result integration and immutable cards

The current result adapters are keyed only by `(runRef, stageId)`: both the
file integrator's `ResultRecord` and the Git integrator's `IntegrationRecord`
reject a second record for that pair. That is incompatible with rework. A
generation must never overwrite the result, commit, or card for an earlier one.

**Integrator contract.** Replace stage-only operations with
generation-qualified operations. A lookup is for exactly
`{ subject, runRef, stageId, generation, operationKey }`, and returns a
`CanonicalGenerationResult` that adds `generation`, `generationRef`,
`baseCommit`, and `integrationCommit` to the present result. `resultCardRef` is
present only for generation 1 and is the stable `workflowCardId(runRef, stageId)`;
it is `null` for every `g >= 2`. `integrate` receives the generation fields plus an
explicit, authorized `baseCommit`, and returns its persisted `integrationCommit`
(and the generation-1 workflow card ref, if applicable).
`resolveCommit` verifies an exact `{ stageId, generation, resultHash,
integrationCommit }` record; it cannot fall back to the same logical stage.
`resolveDependencyBase` receives the store-selected accepted generation and
exact commit for a single dependency, rather than reading shared branch `HEAD`. It
must refuse/park `reviewed-multi-dependency-composition-not-supported` when a
multi-dependency node selects any generation-managed dependency; it must not invent a
merge base.

`ResultRecord` and `IntegrationRecord` are append-only **terminal receipts**. They need `generation`, `generationRef`,
`baseCommit`, `integrationCommit`, and nullable `resultCardRef` (`stageRef` too in
the Git record). Their uniqueness key is `(subject, runRef, stageId, generation)`;
`operationKey` remains globally unique and idempotent only with a complete immutable
fingerprint match. Generation 1 binds its existing workflow card; `g >= 2` must
reject any non-null card reference. `StageGeneration` persists the same operation
key, result hash, commit, and nullable card reference, making the control
plane—not branch position—the authority for active and accepted generations.

The v2 persisted records are closed and must contain at least these fields:

```ts
type ResultRecordV2 = {
  operationKey: string;
  fingerprint: string;
  subject: string;
  runRef: string;
  stageRef: string;
  stageId: string;
  generation: number;
  generationRef: string;
  attemptRef: string;
  baseCommit: string;
  integrationCommit: string;
  cardRef: string | null;
  resultCardRef: string | null;
  terminalPolicyState: 'card-committed' | 'non-card-committed';
  result: CanonicalStageResult;
};
type IntegrationRecordV2 = ResultRecordV2 & { integrationBranch: string | null };

/** Mutable durable progress only; never part of an immutable receipt predicate. */
type GenerationIntegrationJournal = {
  operationKey: string;
  fingerprint: string;
  subject: string;
  runRef: string;
  stageRef: string;
  stageId: string;
  generation: number;
  generationRef: string;
  attemptRef: string;
  authorizedBaseCommit: string;
  expectedResultHash: string;
  requiredCardRef: string | null;
  lineageRef: string;                      // deterministic refs/kb-generation/<sha256(runRef\0stageId\0generation)>
  state: 'intent' | 'integrating' | 'integrated' | 'finalized' | 'parked';
  integrationCommit: string | null;
  parkReason: string | null;
};
```

`GenerationIntegrationJournal` is the sole mutable per-operation state. Its state,
timestamps, retry count, and diagnostic/park fields are excluded from the immutable
receipt equality predicate. A journal may move only
`intent -> integrating -> integrated -> finalized` or to `parked`; an identical
operation key/fingerprint replays its current state, while a changed fingerprint parks.
`lineageRef` is derived exactly as
`refs/kb-generation/${sha256(runRef + "\\0" + stageId + "\\0" + generation)}` and is
stored in the journal before any Git operation; it is never derived from or replaced
by a shared integration branch or `HEAD`.

The integration commit on that ref must carry an exact machine-verifiable witness in
its commit trailers: `KB-Generation-Operation`, `KB-Generation-Fingerprint`,
`KB-Generation-Base`, `KB-Generation-ResultHash`, and
`KB-Generation-Identity` (canonical `{runRef, stageRef, stageId, generation,
generationRef, attemptRef}`). The Git verifier recomputes the journal fingerprint,
checks every trailer byte-for-byte, verifies the commit's first parent is the journal's
authorized base commit, and verifies the committed changed result against
`expectedResultHash`. A commit without this complete witness is never a recovery
candidate. Even a generation with zero changed files creates an empty witness commit;
reusing `baseCommit` as the integration commit is forbidden because it cannot bind the
journal operation.

There is exactly one `ResultRecordV2` and one `IntegrationRecordV2` for
`(subject, runRef, stageId, generation)`, exactly one record for each `operationKey`,
and exactly one non-null `generationRef` for that same tuple. The two records must
have identical `operationKey`, `fingerprint`, subject/run/stage identity,
`generation`, `generationRef`, `attemptRef`, `baseCommit`, `integrationCommit`,
`cardRef`, `resultCardRef`, `terminalPolicyState`, and `result.resultHash`. Their equality predicate is a
canonical serialization of those fields; any mismatch, duplicate tuple, reused
generationRef, reused operation key with a different fingerprint, or non-null commit
field with an invalid immutable commit id is a terminal integrity failure.

**Exact bases.** Generation 1 uses the ordinary dependency base and the legacy
unsuffixed operation key. Creator generation *N+1* uses exactly generation *N*'s
recorded `integrationCommit`; the checker uses exactly the current subject
generation's commit. A downstream node with one direct dependency uses exactly that
dependency's accepted-generation commit. Execution must resolve and verify the
selected commit before creating a worker worktree or integrating its result. The
present per-run integration branch is not sufficient: an unrelated integration can
advance `HEAD`. Loop-managed work therefore needs a deterministic generation lineage
ref/worktree at the supplied base (for example `.../<stage-hash>/g<N>`), with that
base recorded verbatim. No multi-dependency composition is permitted in this runtime:
if any selected dependency is generation-managed, park with
`reviewed-multi-dependency-composition-not-supported`; a future design must specify an
exact merge algorithm, operation/fingerprint, and conflict behavior instead of merely choosing
commits ordered by logical stage id—never an implicit branch-head choice.

**The single workflow card is immutable.** `workflowCardId(runRef, stageId)`
remains the one DAG/control card and is the generation-1 result card. It is not
reopened or rewritten for generation 2+. The existing canonical-card script rejects
a different `## Result`, verification requires one result block, and the published
card is already terminal in `queue/done`; replacement would mutate committed queue
history and make prior receipt verification ambiguous. No generation-result queue
cards are created. For `g >= 2`, the immutable receipt is the v2
canonical-integration record, cross-bound to `StageGeneration` by exact operation
key, generation ref, result hash, base commit, and integration commit; its
`resultCardRef` is null. The verifier checks those two durable records and their
exact cross-references, then verifies the recorded integration commit. This keeps
queue/card governance and lifecycle unchanged. UI reads active/accepted state from
the store, not by editing the original card.

**Non-card terminal integration path.** Generation 1 is mandatory card-backed
integration: both v1 and v2 records require
`cardRef === resultCardRef === workflowCardId(runRef, stageId)`, and the existing
canonical-card publication/verification path remains mandatory. For `g >= 2`, the
integrator takes a non-card terminal path: it writes the immutable v2 result and Git
integration records, verifies the exact integration commit, and marks that integration
record `terminalPolicyState: 'non-card-committed'`; only then may the control store finalize the matching
`StageGeneration` as `committed`. In that path
`cardRef === resultCardRef === null`; a non-null value is a terminal integrity failure.
Calling `CANONICAL_RESULT_CARD_SCRIPT`, `CANONICAL_RESULT_VERIFY_SCRIPT`,
`verifyCanonical`, or any queue-card lifecycle/publication operation for `g >= 2` is
prohibited and must fail closed. No g>=2 code path may create, find, modify, reopen,
or verify a workflow card.

**Migration and replay.** Readers treat legacy `kb.execution-results/v1` and
`kb.canonical-integration/v1` records as generation 1 with their existing workflow
card, integration commit, and legacy unsuffixed
`result:${runRef}:${stageId}` operation key. The compatibility matrix is closed:

| Generation | Operation key | Queue card |
| --- | --- | --- |
| 1, legacy/migrated | `result:${runRef}:${stageId}` | existing workflow card |
| 1, newly created loop-aware run | `result:${runRef}:${stageId}` | existing workflow card |
| N >= 2 | `result:${runRef}:${stageId}:g${N}` | none; v2 integration record + `StageGeneration` receipt |

The first loop-aware write migrates records within each owning store only; there is no
claim of one atomic transaction across the control store, result store, and Git
integration store. Legacy card contents are never rewritten.

### Ordered cross-store integration intent and recovery

Before an integration adapter is called, the control store durably appends the
`GenerationIntegrationJournal` keyed by the generation operation key. It contains the
complete canonical request fingerprint, `{subject, runRef, stageRef, stageId,
generation, generationRef, attemptRef}`, authorized `baseCommit`, expected
`resultHash`, and the required card policy (`workflowCardId(...)` for generation 1;
both refs null for `g >= 2`). It begins in `intent`; it is idempotently replayable
only with byte-identical immutable intent fields. It is not a result receipt.

The ordered protocol is:

1. Persist that control-store intent. Do not mark `StageGeneration` committed and do
   not advance a review loop yet.
2. On the journal's deterministic `lineageRef`, perform the one Git integration and
   create exactly one witness-bound immutable integration commit. Generation 1 follows
   the existing mandatory card path exactly once; `g >= 2` performs no card action.
   At this point there is intentionally no mutable/partial `ResultRecordV2` or
   `IntegrationRecordV2`.
3. Immediately after Git, before either final receipt is appended, compare-and-swap
   the journal from `intent` to `integrating`, recording that exact
   `integrationCommit`. The CAS requires the expected journal revision, operation key,
   fingerprint, lineageRef, base commit, result hash, and generation identity. A
   replay may accept an already-`integrating` journal only when every field, including
   the commit, is identical.
4. After the commit and journal CAS are verified, append the matching final `ResultRecordV2` and final
   `IntegrationRecordV2` with their immutable equality fields and terminal policy
   state (`card-committed` for generation 1 or `non-card-committed` for `g >= 2`),
   then move the journal to `integrated`. The final receipts are never updated.
5. Re-read the exact operation key and tuple from both final receipts, verify their
   equality predicate and the recorded commit, then finalize the journal and
   `StageGeneration` in one **control-store** transaction. Finalization copies the
   exact base/result/integration fields and card refs; no other values are inferred
   from branch `HEAD` or a card lookup.

Crash reconciliation repeats those steps, never re-executes work. For an `intent`, it
inspects only its deterministic `lineageRef` and enumerates witness-bound commits on
that ref: zero witnesses means Git never committed and may start step 2; exactly one
matching witness means it performs the post-Git CAS then resumes step 4; multiple or
conflicting witnesses park. For an `integrating` journal, `integrationCommit` is
mandatory: reconciliation inspects only `lineageRef`, requires exactly one witness,
requires that witness's commit id equal the journal field, and verifies every bound
trailer, base, result hash, and identity. Zero, multiple, or conflicting witnesses
park; it never consults `HEAD` or any shared branch. After that exact witness passes,
it appends any missing final receipts idempotently, without rerunning work or any card
script. If exactly one final receipt exists, it verifies that receipt and appends only
its missing counterpart. A journal in `integrated` resumes step 5. A finalized control
row requires exact matching final receipts; it never reopens or duplicates a
generation-1 card. Any missing expected record, fingerprint mismatch, conflicting
commit/ref, duplicate tuple, Git commit that cannot be proven to match the journal, or
externally committed record lacking its matching journal parks the journal and loop
terminally for intervention.
`advanceReviewGeneration` may create N+1 only after N's finalized integration record
and failed-review receipt are durably linked; it creates no queue card and records
`resultCardRef: null` for the successor.

## Atomicity, operation keys, and restart invariants

All state-changing methods take expected versions and an idempotency key with a
canonical request fingerprint. Suggested stable namespaces are:

- `result:${runRef}:${stageId}` for generation 1 (legacy and newly created loops),
  and `result:${runRef}:${stageId}:g${generation}` only for `generation >= 2`;
- `review-outcome:${runRef}:${reviewStageId}:g${generation}` for the outcome receipt;
- `review-loop:${runRef}:${reviewStageId}:g${generation}` for loop advancement;
- `rework:${runRef}:${subjectStageId}:g${nextGeneration}` for successor creation;
- `review-gate:${runRef}:${reviewStageId}:g${generation}` for the delayed completion
  request.

On restart, recover active process records as today, then reconcile each
`GenerationIntegrationJournal` by the ordered cross-store protocol before examining
review outcomes, delayed gates, or logical active pointers. A committed operation key
replays only if its complete fingerprint matches. An ambiguous crash after an outcome
or successor commit must look up that receipt/generation and resume reconciliation,
never rerun the checker or create another creator generation. A missing or
hash-mismatched referenced result parks the loop.

Canonical integration/replay remains append-only: old creator generations are still
auditable and resolvable by exact generation; only the active accepted generation is
eligible as a base for post-review dependents. Worktree removal occurs only after the
external integration record and its matching control-store finalization have both
committed, as in the current engine.

## Smallest safe implementation checkpoints

1. **Schema/capability repair** — `workflows/defs.ts`, `compile.ts`,
   `control/proposal.ts`, `environment.ts`, and their tests. Require the exact checker
   profile for `review`; defend it at compile and server-validation boundaries; test
   missing/non-checker profile rejection and browser rejection of compiler-only fields.
2. **Outcome parser and read-only execution seam** — `control/execution.ts`,
   `claudeWorkerAdapter.ts`, `types.ts`, and focused tests. Add the closed parser using
   the existing final stream-json result; pass the effective per-stage profile; pass a
   single committed subject result to a review worker; reject changed files/artifacts/
   checkpoints. Preserve legacy normal-stage prompt/result bytes and tests.
3. **Durable generation/receipt store** — `control/types.ts`, `store.ts`,
   `adapters.ts` (result-integrator history), plus store/adapter migration and replay
   tests. Implement atomic loop/outcome/successor methods before connecting them to
   execution. Test file-store restart, duplicate keys, stale versions, and migration
   defaults.
4. **Engine reconciliation** — `control/execution.ts` and tests only. Gate dependency
   release on accepted review, create delayed approval only after pass, execute bounded
   rework, and park all malformed/ambiguous paths. Test pass, fail/rework/pass,
   exhausted bound, parked, rejected gate, changed checker worktree, duplicate replay,
   and crash at every commit boundary.

Routes, dashboard UI, daemon activation, video-run behavior, and publishing are
explicitly out of scope until these server invariants are proven.

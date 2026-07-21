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
   replacing its receipt, or reusing `result:${runRef}:${stageId}` would corrupt replay
   and downstream lineage. Rework therefore requires immutable generation records,
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
  resultHash: string | null;
  canonicalCommit: string | null;          // server-owned immutable integration commit
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
to the same run.

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
only for loop-managed creator generations; legacy rows retain generation 1 and their
old operation key. The result integrator must retain every receipt and expose an
explicit active-generation lookup; never overwrite or relabel old records.

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

- Generation 1 uses the existing dependency-base resolution, but only from each direct
  dependency's accepted active generation. It integrates under
  `result:${runRef}:${stageId}:g1`, producing `StageGeneration(1).canonicalCommit`.
- Creator generation `N+1` is based **only** on creator generation `N`'s verified
  `canonicalCommit`, not on a recomputed dependency base and never on repository HEAD.
  That commit already contains the accepted upstream base plus the prior creator
  output, so the reworker can make a delta while remaining reproducible. The resolver
  checks the exact generation ref/result hash/commit before creating the worktree.
- The fresh checker for generation `N+1` uses exactly that generation's canonical
  commit. Its sole prompt dependency is the matching committed result; it cannot
  inspect a newer worktree or earlier checker state.
- After pass (and delayed approval when authored), downstream base resolution selects
  the accepted generation's canonical commit. Commits referenced by a
  `GenerationSupersession` stay addressable for audit only and are never selected as
  active lineage.

## Atomicity, operation keys, and restart invariants

All state-changing methods take expected versions and an idempotency key with a
canonical request fingerprint. Suggested stable namespaces are:

- `result:${runRef}:${stageId}:g${generation}` for generation-qualified integration;
- `review-outcome:${runRef}:${reviewStageId}:g${generation}` for the outcome receipt;
- `review-loop:${runRef}:${reviewStageId}:g${generation}` for loop advancement;
- `rework:${runRef}:${subjectStageId}:g${nextGeneration}` for successor creation;
- `review-gate:${runRef}:${reviewStageId}:g${generation}` for the delayed completion
  request.

On restart, recover active process records as today, then reconcile in this order:
canonical subject result -> generation record -> review outcome receipt -> delayed
gate -> logical active pointer. A committed operation key replays only if its complete
fingerprint matches. An ambiguous crash after an outcome or successor commit must look
up that receipt/generation and resume it, never rerun the checker or create another
creator generation. A missing or hash-mismatched referenced result parks the loop.

Canonical integration/replay remains append-only: old creator generations are still
auditable and resolvable by exact generation; only the active accepted generation is
eligible as a base for post-review dependents. Worktree removal occurs only after the
corresponding result/outcome transaction has committed, as in the current engine.

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

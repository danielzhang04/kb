# DRAFT — A1 engine lifetime and spend-grant preflight, 2026-09-08

Author: `codex-worker`

Source reviewed: `36f76379c422aa1133f5421fe6258dd254e9d35e`

Status: **PLAN ONLY — no production or test implementation performed**

This preflight defines one atomic four-file implementation window:

- A: `dashboard/server/control/execution.ts` and `execution.test.ts`;
- D grant adapter: `dashboard/server/control/spendGrantProvision.ts` and
  `spendGrantProvision.test.ts`.

C delivery and D1 ledger acceptance are not technical prerequisites for this
engine-local window. `execution.ts` imports no fleet-ledger port, and B alone
will consume D1. The current C delivery files do not overlap these four files.
B must still wait for accepted A, C, and D surfaces before changing activation
or callers. No activation, route, DTO, store, schema, governance, canonical, or
ledger file belongs to this window.

## Fixed interface window

Keep Brief A's strict type:

```ts
lifetime?: ExecutionLifetime;
provisionSpendGrant?: (
  input: ProvisionSpendGrantInput,
) => Promise<SpendGrantProvisionOutcome>;
```

The four files must change together. Today the only production producer is
`createSpendGrantProvisioner`, passed unchanged through `activation.ts`; its
current `Promise<void>` is not assignable to the strict engine hook. D changes
that producer in the same window. The two existing adapter expectations of
`undefined` become `{ kind: 'ready' }`. New engine fixtures return either
`ready` or `tokenless-already-live`. No activation edit is required, and
omitting both optional options continues to preserve inactive and existing unit
construction.

D maps the existing `ProvisionSpendGrantResult` without changing it:

| Existing result | Engine outcome |
| --- | --- |
| `provisioned: true` | `{ kind: 'ready' }` |
| `not-a-paid-stage` or `no-spend-gate` | `{ kind: 'ready' }` |
| `already-live` | `{ kind: 'tokenless-already-live', grantRef }` |
| `spend-authorization-not-approved` | unchanged throw |

Unexpected mint failures still throw. The already-live path writes no token
file. The outcome has exactly the discriminated fields and no token or logger
payload. The engine does not persist, display, or log `grantRef`.

## Explicit lifetime pattern

Add one small `assertCurrent()` method that calls
`this.options.lifetime?.assertCurrent()`. Do not add a proxy, effect factory, or
second controller. At every call site, spell out this order:

1. assert immediately before issuing an external operation;
2. call the real port and retain its native promise;
3. pass that exact promise to `lifetime.track(label, promise)` when a lifetime
   exists;
4. await the tracked promise;
5. assert immediately after the await, before reading its value into any
   forward mutation.

All catches on the forward execution path assert current before recovery,
containment, an event, a boundary, or a transition. An
`ExecutionWithdrawnError` therefore bypasses ordinary failure containment.
`recoverCaughtIterationResult` must rethrow withdrawal rather than erase it in
its broad catch. Cleanup catches are the exception: cleanup remains permitted
after withdrawal, but a cleanup failure may append no event once withdrawn.

`cancelRun` and `containManagerStart` are operator cleanup/control paths, not
forward automatic execution. They must remain callable after revocation and do
not acquire the A1 forward-admission guard. Keep the shared transition helpers
forward-guarded, and give these two methods explicit private control-cleanup
transition calls that do not consult the lifetime. Do not use a process-wide or
await-spanning "mute" flag: a concurrent retired continuation could otherwise
borrow it and project forward state.

## Guard map

| Seam | Required admission and withdrawal behavior |
| --- | --- |
| Manager | Guard/track `managers.ensure` before and after. Guard successor creation, manager/run transitions, intervention creation, and `onManagerStarted` immediately before invocation. A withdrawn ensure cannot revive a session or call the callback. |
| Canonical reads | Guard/track every `results.lookup` and `resolveBase`, including iteration scheduling, initial reconciliation, dependency resolution, and caught-result recovery. A catch must not translate withdrawal into an intervention. |
| Worktree and skills | Guard/track `worktrees.ensure` and `skills.resolve`. Guard direct artifact snapshot/inspection awaits and `worktrees.inspect`. A worktree whose ensure fulfilled is owned and is removed once on withdrawal after no reader remains. |
| Accounting | Guard/track `reserve` and normal `settle`. If withdrawal is observed before any settlement was issued, the only permitted settlement is `settle:<attemptRef>` with zero usage. Never issue an actual-usage or ceiling settlement after withdrawal. An actual-usage settlement issued while current is merely observed if revocation occurs while it is held; do not issue a second settlement or fallback. |
| Grant | Guard/track the strict grant hook. Withdrawal after it lands permits only the same-key zero settlement and worktree cleanup; it cannot create a boundary or start a worker. |
| Worker launch | Assert before the synchronous `workers.begin`. Once it returns, immediately observe and separately track its exact `receipt` and `result` promises before the post-call assertion. Guard after each await. On withdrawal, issue the one owned `cancelWorker` cleanup, observe receipt, result, and close, then use only the zero settlement if no settlement was already issued. A held receipt/result cannot project `running`, append events, inspect, integrate, or finalize after withdrawal. |
| Post-worker | Guard/track artifact inspection and `results.integrate`. Guard lifecycle events, iteration park/advance/receipt writes, canonical finalization, and all terminal transitions. A landed integration may finish, but its post-await value cannot drive a retired store projection. |
| Manager shutdown | In `settleRunState`, guard/track the run-complete `cancelManager` call and guard its intent event, result transitions, intervention, and final run transition. |
| Capacity/internal joins | Check current before and after capacity waiting, iteration reconciliation, scheduling, `Promise.all` attempt joins, and async finalization helpers. Remove or neutralize a retired capacity waiter so the tracked engine call cannot outlive the generation solely on an internal waiter. |

The synchronous mutation guards cover every forward writer reached by
`runToBoundary`: `releaseDependents`; `scheduleIterationTurns`;
`finalizeCanonicalSuccess`; `routeIterationReceipt`; `stageBoundary`;
`createBoundary`; `ensureStageWaiting`; `prepareOrContain`; `prepareAttempt`;
`executeAttempt` containment; `recoverCaughtIterationResult`;
`parkStrandedIntegration`; `executeAttemptUnsafe`; `settleRunState`;
`projectAttemptRunning`; and the transition helpers. This includes direct
`appendEvent`, `createHumanRequest(s)`, `createManagerSuccessor`, `createAttempt`,
`createWorkerSession`, stage-generation, iteration activation/request/receipt/
park/advance calls, and every run/stage/attempt/session transition.

Guard placement is caller-scoped. Forward-only helpers may assert internally,
but `cancelRun` and `containManagerStart` use their explicit control-cleanup
path. Tests must revoke first and prove those two public methods still converge
only their authorized cancellation/containment state, while a concurrently
released forward continuation produces no event, boundary, or transition.

## Cleanup ownership

Use explicit local state in `executeAttemptUnsafe`; do not introduce another
controller. Record whether worktree ensure fulfilled, whether a reservation was
accepted, whether any settlement was issued, and whether a worker launch was
issued. A small internal cleanup error may distinguish strict cleanup failure
from an ordinary adapter error so `executeAttempt` rethrows it instead of
creating its generic intervention.

| Withdrawal point | Permitted completion |
| --- | --- |
| Before worktree ensure lands | Observe the issued promise; remove once only if ensure fulfilled. |
| After ensure, before successful reserve | One worktree remove; no settlement. |
| Successful reserve, before worker begin | Strict same-key zero-usage settlement, then one strict worktree remove. |
| Grant held or landed, before worker begin | Observe grant; then strict zero settlement and strict remove. No boundary or worker. |
| Worker begin issued, no settlement issued | Immediately issue one owned `cancelWorker` with a stable cleanup key. Observe both native receipt/result promises and the close. Regardless of receipt/result outcome, attempt the same-key zero settlement once. Remove once only after close and settlement both succeed. Never interpret result usage. |
| Actual-usage settlement already issued while current | Observe that exact admitted settlement. Issue no zero settlement, ceiling fallback, or second key after revocation. Propagate rejection; after fulfillment, remove only when no worker/worktree reader remains. |
| Inspect or integrate issued after a completed settlement | Observe the admitted operation. After it settles, remove once; do not consume its value into events, finalization, or another port. |

The worker-withdrawal path observes receipt and result even when owned close
fails. It then attempts the required zero settlement. A failed close or zero
settlement prevents removal; a successful close and settlement admit exactly
one strict removal. All cleanup calls are one-shot and are awaited through the
affected engine invocation. The close is the existing idempotent
`cancellation.cancelWorker` port, using the attempt's existing
`attemptOperationKey` and a stable withdrawal cleanup operation key. It is
issued as allowed cleanup after revocation, tracked, and awaited before removal;
it does not pass through a forward-admission assertion.

`ExecutionLifetime.track` removes pending labels on fulfillment and rejection;
it does not retain a failed-cleanup barrier. A rejected close, zero settlement,
or strict removal must reject the affected engine invocation, stop that retired
path, create no event or boundary, and admit no later worker from that path.
The tracking observer prevents an unhandled rejection, while the caller's await
observes the actual failure. Once rejection is observed, A1 does not claim that
cleanup succeeded or that B remains locked until it succeeds. No retry, failure
map, permanently pending promise, or new persistent authority is added. B's
separate host-drain, real-pending-operation, and ledger-key gates remain the
only later unlock barriers defined by the integration plan.

The existing best-effort `cleanupAttemptWorktree` remains suitable for current
terminal cleanup. Tokenless and withdrawal use a separate strict local path:
it calls `worktrees.remove` once, does not swallow rejection, and never appends
a cleanup event after withdrawal.

## Tokenless already-live amendment

Amend Brief A's attempt/session parking tuple for this no-worker case:

- attempt: `interrupted`;
- worker session: `interrupted`;
- stage: `waiting-human`;
- run: `waiting-human`.

This is the smallest correct path. No worker or prompt delivery began, so the
attempt is an abandoned launch and a successor is required. The existing
`stageBoundary` and `prepareAttempt` flow already turns an accepted stage
boundary back to ready and creates one successor from an interrupted attempt.
The original `waiting-human`/`waiting` tuple is not safely resumable:
`prepareAttempt` accepts only queued or interrupted attempts, and the store has
no `waiting-human -> ready` attempt edge. Keeping that tuple would require a new
durable cause lookup and store authority solely to identify which waiting
attempt may be interrupted. This amendment avoids that wider surface and never
uses an old title as authority over a later attempt.

On `tokenless-already-live`, perform this order:

1. zero-settle the accepted reservation with `settle:<attemptRef>`;
2. require that settlement to fulfill, then strictly remove the unused
   worktree once with the existing `worktree-remove:<attemptRef>` key;
3. assert current;
4. create one `intervention` through the existing one-item
   `createHumanRequests` batch, using an attempt-derived idempotency key;
5. transition the unstarted attempt and session to `interrupted`;
6. transition stage and run to `waiting-human`;
7. return `waiting-human` without calling `workers.begin`.

Neither strict cleanup step uses the current best-effort removal helper. A
zero-settlement rejection stops before removal. A removal rejection stops
before boundary creation. Both reject through the engine observer with no
generic containment boundary, no worker, no retry, and no false cleanup
success.

The exact title is
`automatic:spend:<stageId>:tokenless-already-live`. Extend the internal
`stableHumanTitle` kind to `spend` or construct the same bounded string locally.
Use the stable prompt:

> A previous spend grant is still live, but this attempt has no capability
> file. Wait for the bounded grant TTL to expire before Resume.

The prompt contains no raw token or grant reference. The one-item batch makes
boundary creation idempotent for the attempt without exposing a new public
field. No lookup by title, editable prose, or old resolved request is used to
authorize a later attempt. The store accepts idempotency keys up to 512
characters, while an attempt reference is constrained to the repository's
128-character safe-reference envelope, so the prefixed key fits without a hash
or store change.

An accepted boundary allows the normal next invocation to create one successor.
If Resume occurs before expiry, the successor receives another tokenless
outcome, is interrupted, and parks once on its own idempotent boundary. One
`runToBoundary` call never retries automatically. Repeated premature Resumes are
bounded by the existing attempt-generation limit and eventually reach the
existing attempt-budget intervention.

## Acceptance proof

Focused tests in `execution.test.ts` must use held real promises, snapshot the
store and downstream call counts at withdrawal, then release the held promise:

- Manager ensure, canonical lookup, dependency/iteration base resolution,
  worktree ensure, skill resolution, reserve, grant provision, worker receipt,
  worker result, inspect, and integrate each issue at most once and invoke zero
  next ports or forward projections after withdrawal.
- A held successful reserve revoked before worker begin gets exactly one
  zero-usage settlement with the same key and one worktree removal.
- Worker receipt and result are both observed. Withdrawal while either is held
  issues one owned close and produces no unhandled rejection or
  post-withdrawal `running`/terminal projection. Removal occurs only after the
  receipt, result, and close are observed and close succeeds.
- Withdrawal before settlement issues only the same-key zero settlement.
  Withdrawal while an actual-usage settlement was already held only observes
  that exact operation and issues no zero, ceiling, or second settlement.
- Rejected owned close, zero settlement, and strict remove each reject the
  affected engine invocation, leave `lifetime.pending()` empty after
  observation, append no retired event/boundary, and admit no later worker from
  that invocation. The test does not assert a retained unlock barrier or
  successful resource cleanup.
- Withdrawal during caught-result recovery is not swallowed into the generic
  interruption/boundary path.
- `onManagerStarted` is never invoked after withdrawal.
- A revoked engine still permits explicit `cancelRun` and
  `containManagerStart` to perform their authorized cancellation/containment;
  releasing a concurrent forward continuation cannot use that cleanup path.
- A run held in the outer capacity wait unregisters its waiter on revocation
  and never enters preparation when capacity later wakes. A multi-stage run
  held at the outer `Promise.all` join produces no later pass, boundary, event,
  or transition when released.
- A held Manager-shutdown cancellation may finish, but withdrawal before its
  completion prevents the stopped-session transition, shutdown intervention,
  and run-success transition.
- With lifetime omitted, existing execution behavior remains covered by the
  unchanged suite.

Tokenless tests use the stateful accounting fixture whose active reservation
consumes its sole slot. They prove exact title and prompt, one open intervention,
zero worker calls, a fulfilled zero-usage same-key settlement, one fulfilled
strict cleanup, the interrupted/interrupted/waiting-human/waiting-human tuple,
and absence of token/grant data. A second reservation on Resume is therefore
possible only if the first slot was truly released. Separate settlement- and
remove-rejection cases prove zero boundary and zero worker. Then:

- resolve it with an accepted `responded` or `approved` decision after the fake
  grant becomes ready; the next run creates one successor and one worker;
- leave it open or resolve it with `rejected`/`changes-requested`; no successor
  or worker is admitted;
- resolve it while the fake remains already-live; one successor re-parks once,
  with no inner-loop retry, and repeated explicit Resumes stop at the attempt
  budget;
- resolve an unrelated request while the tokenless intervention remains
  unaccepted; it cannot resume the stage.

`spendGrantProvision.test.ts` proves all four mappings above, unchanged approval
and unexpected-error throws, zero token-file writes for already-live, and exact
outcome keys with no token/logger payload. The final gate is the two focused
test files, full dashboard typecheck, and repository diff check. No C or D1 test
is part of this window.

## Bounded implementation experiments

1. Implement the capacity wait as a local withdrawal race that removes its own
   exact waiter by identity. Verify the later capacity wake cannot resolve an
   already-retired path.
2. Implement worker withdrawal as an explicit cleanup branch, separate from the
   normal validated-usage settlement and its ceiling fallback. Use settled
   observations for receipt/result/close so every native promise is consumed;
   then apply the strict zero-settle/remove rules above.

This DRAFT grants no source-file release, acceptance, commit, merge, deployment,
or Phase 0 authority.

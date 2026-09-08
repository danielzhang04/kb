# DRAFT — B activation, latch, settlement, and route preflight, 2026-09-08

Author: `codex-worker`

Status: **PLAN ONLY.** No production or test source was changed. B must not
start until A, C, and D have each been accepted with their fixed interfaces.

## Owned implementation window

The work order assigns B only:

- `dashboard/server/control/activation.ts` and `activation.test.ts`;
- `dashboard/server/http/context.ts`;
- `dashboard/server/control/routes.ts` and `routes.test.ts`;
- `dashboard/server/control/launch.ts` and `launch.test.ts`.

`http/surface.ts` already rebinds the returned `ActivatedExecution` closures in
place on latch change. It needs no B edit. `adapters.ts`, `managedExecution.ts`,
C's attempt/claim store, A's engine/lifetime, and D's receipt implementation
remain their owners' files. B passes their fixed interfaces; it does not add a
controller, proxy, public route, DTO field, or failure-barrier map.

## Construction and generation ownership

`buildActivatedExecution` must create one private `ExecutionGeneration` first,
before constructing the worktree, grant, canonical, attempt, ledger, engine, or
`runAutomatic` closure. It owns exactly the new `ExecutionLifetime` and
`ledgerRecoveries: Map<string, LedgerRecoveryEntry>`. `LedgerRecoveryEntry` is
the Brief B shape: immutable `receiptKey` and prepared
`LedgerSettlementInput`, `pending | required | recovering` state, native
completion and observed promises, plus a process-local object identity.

Every object built for that generation receives the same
`generation.lifetime.assertCurrent` forward-admission closure:

- A's `AutomaticExecutionEngine` receives `lifetime`.
- The frozen worktree, canonical integrator, and spend-grant provisioner receive
  their existing optional `assertForwardAdmission` option.
- C's attempt adapter receives `assertForwardAdmission` and the one
  `sessionChains` instance as `messageClaims`. The existing `drainMessages`
  option remains only as a deprecated type-compatibility field and is never
  passed or invoked.
- D's ledger unit is called only through generation-owned closures. B constructs
  one `FleetLedgerReceiptStore` with `{ stateRoot }` and supplies that same
  store to begin and reconciliation dependencies.

This order makes a lifetime and ledger-key registry exist before any engine
effect can start. It also means a retired latch holds the actual map used by an
in-flight closure, rather than a reconstructed view of durable receipts.

`runAutomatic` returns A's internal `AutomaticExecutionSettlement`, not the
old bare `ExecutionOutcome`. It issues the real `engine.runToBoundary(input)`
once, tracks that native promise on the lifetime immediately, attaches a
rejection observer, and races it with `lifetime.withdrawn`. A withdrawal returns
`{ kind: 'withdrawn' }` promptly. The losing engine promise remains observed;
it cannot become an unhandled rejection or start a later settlement. On an
engine boundary, B asserts the same generation is current before ledger
admission. A revocation that wins before that assertion produces no D call,
receipt, row, Git action, or route error. If D admission already occurred, its
entry stays on that generation after withdrawal and is resolved only by the
normal completion or later Lock recovery path.

The assertion is followed by exactly one current `controlStore.getRun(subject,
runRef)` snapshot for that boundary. B keeps the legacy terminal-run gate:
unknown and non-terminal runs issue no D operation, and terminal runs use
`collectTerminalStageCosts(snapshot, readUsageMicros)` before preparation.
Rows without a terminal stage, minted canonical card, or resolvable attempt
model are already omitted by that helper; an empty result also issues no D
operation. Only this terminal, nonempty, immutable row set is prepared and
registered. The retained entry never reads the run again, including on
recovery. This prevents a waiting-human boundary from registering an incomplete
same-run snapshot which would conflict with the eventual terminal one.

Sparse path registration remains ownership-aware around the one issued engine
promise. A duplicate call for the same run cannot let a losing `finally` delete
the live registration.

## Ledger admission and native-promise rules

On a `{ kind: 'boundary' }` result, B obtains D's immutable prepared snapshot
with `prepareFleetLedgerSettlement`. Before any begin effect it inserts a new
entry in the active generation map. If the key already exists, B compares the
prepared normalized input byte-for-byte: equal input reuses the entry and makes
no D call; a mismatch fails closed without overwriting its completion or state.

For a new entry, B calls `beginFleetLedgerSettlement(deps, prepared)` directly
inside synchronous `try/catch`, stores that exact native promise as
`completion`, tracks that exact promise on the generation lifetime, and attaches
one observed fulfillment/rejection continuation. Do not wrap issuance in
`Promise.resolve`, an async helper, or an inferred retry. A synchronous throw,
including `throw undefined`, and every rejection including `Promise.reject(0)`
set that identity-matching entry to `required`. Only literal fulfillment
`'settled'` removes the same map entry; literal `'required'` and malformed
fulfillment retain it as `required`. Completion callbacks compare
`map.get(receiptKey) === entry` before every state change or deletion.

Replace the legacy `ActivationDeps.settleLedgerForRun` seam entirely with the
explicit defaults `createFleetLedgerReceiptStore`,
`prepareFleetLedgerSettlement`, `beginFleetLedgerSettlement`,
`reconcileFleetLedgerReceipt`, and `collectTerminalStageCosts`; retain the
existing `BuildActivatedExecutionOptions.readUsageMicros` default of zero.
B's D deps pass the one generation receipt store, `repoRoot`, existing
publication/outbox/preamble/Git seams, and the existing fleet-row writer. This
is a replacement for `settleFleetLedgerForRun`, not a second settlement path.

`ActivatedExecution.reconcileLedger(entry)` is the sole B-to-D recovery
closure. It calls `reconcileFleetLedgerReceipt` with the entry's exact prepared
snapshot and the same receipt store, never re-reads run state to derive rows or
keys. The second and later existing Lock action, while still locked, visits only
`required` entries. It changes that exact entry to `recovering`, invokes the
real native reconciliation promise once, tracks and observes it, then maps
settled/required, sync throws, falsey rejections, and malformed fulfillment by
the same identity rule. Pending and recovering entries do not issue a second
begin or reconcile call.

## Lock and Unlock map

`ExecutionLatch.lock` captures the active generation and calls
`generation.lifetime.revoke()` synchronously *before* `attemptPort.drain()`,
`attemptIo.stop()`, queue/surface unbinding, or any `onChange` callback. It then
installs one `RetiredExecution` containing the exact execution and generation,
even when there is no PTY port. It starts and observes the host drain if one
exists, attempts `attemptIo.stop()` as the existing fail-safe cleanup, and
unbinds the active surface.

Retirement is retained while any of these is true: a host drain is pending or
failed, `generation.lifetime.pending()` is nonempty for tracked work, or the
ledger map has an entry. Unlock remains synchronous:

1. return `execution-draining` while a host drain, tracked effect, or recovery
   is pending;
2. return the existing drain failure if that is the unresolved host condition;
3. return `execution-ledger-reconciliation-required` when no pending work
   remains but any ledger entry is still required;
4. construct a replacement only once the retired generation is quiescent and
   its exact map is empty.

Do not turn this into a failed-cleanup persistence barrier. A observed cleanup
rejection is propagated/contained by its issuing path as A specifies; B neither
retries it nor manufactures a new durable lifetime state. Late drain, engine,
begin, and reconciliation callbacks are all guarded against the retired object
and entry identity, so Generation A cannot clear a barrier, mutate a map, or
touch Generation B after a later unlock.

## Route and DTO wiring

`SurfaceContext.runAutomatic` and `ActivatedExecution.runAutomatic` change only
to the internal settlement union. Browser responses remain the existing run DTO.
The `surface.ts` on-change assignment remains compatible because it copies the
closure without inspecting its result.

Each current consumer must branch on `{ kind: 'withdrawn' }` before generic
error/reporting behavior:

- `activateRunUnderOwner` in `routes.ts`: if withdrawal occurs before Manager
  acknowledgement, do not fail the activation receipt, contain Manager, or
  create **Activation dispatch needs reconciliation**. Read the run after the
  withdrawal and return `202 { ok: true, value: runDto(currentRun),
  starting: false }`; its receipt stays `roots-activated`/recovering and an
  operator Resume after Unlock is required.
- Its post-202 detached observer ignores withdrawal, so it creates no
  **Automatic execution needs intervention**. Real rejection behavior stays.
- The Manager-successor detached call in `routes.ts` ignores withdrawal and
  does not create **Manager successor needs intervention**.
- The automatic Resume observer ignores the withdrawn outcome and does not
  create **Automatic resume needs intervention**.
- The approved-launch detached call in `launch.ts` ignores withdrawal and does
  not call `surfaceAutomaticExecutionFailure`. Genuine errors retain the
  existing lifecycle/intervention behavior.

No route gains a recovery endpoint: only the existing audited Lock action
starts ledger recovery. Human approval, activation, lock/unlock, and existing
response shapes remain intact.

## Held-seam acceptance plan

Add behavior tests only in the B-owned test files, using real latch and route
paths plus held native promises:

1. Hold canonical lookup before Manager acknowledgement, then Lock. Release it
   and prove no Manager callback, successor, dispatch transition, or activation
   intervention occurs; the pre-ack HTTP result is the exact existing 202 DTO
   with `starting: false`.
2. Hold base resolution and every later engine port. Lock before release and
   prove no next port, boundary, event, lifecycle projection, or detached
   reporter runs. Include full/sparse worktree, inner verification, and grant
   mint counters from A's exposed seams; no post-add chmod/verify, sparse
   command, token write, or token leak is allowed.
3. Hold C session start and first write through the actual generation callback.
   Lock and release; prove the C-owned close/cancel behavior and durable
   claim/operation state, without a B-side second delivery path.
4. Drive a run to a waiting-human boundary, then Resume it to a terminal
   boundary. Prove the first single snapshot makes no D call, the second uses
   one final terminal row set and one prepared key, and recovery uses that
   stored input without re-reading the run. Also prove unknown, non-terminal,
   and empty terminal-cost snapshots make no D call.
5. Hold D begin after pre-registration. Lock immediately and prove Unlock is
   refused while pending; release as `required`, prove the existing second Lock
   invokes exactly one reconciliation, and Unlock succeeds only after its
   literal `settled` result. Repeat sync `throw undefined`, rejected `0`, and
   malformed fulfillment; each stays required with no automatic retry.
6. Admit two terminal runs with distinct prepared ledger keys. Settle the
   second first and leave the first required. Lock/Unlock must be blocked only
   by the first key; a second Lock starts one real first-key recovery. Repeat
   with both required resolving out of order and with a falsey rejection.
   Repeated Lock while a key is pending/recovering proves no duplicate D call;
   repeat same-key observation proves no entry overwrite; release an old held
   completion after the entry changes and prove its identity guard cannot clear
   the current entry.
7. Lock Generation A during tracked work, refuse Unlock, then quiesce and build
   Generation B. Releasing A later must not call B ports or mutate B's registry.

## Source blockers verified before implementation

- `activation.ts:547-550` still passes C's destructive `drainMessages` rather
  than `messageClaims` and `assertForwardAdmission`; C will fail closed while
  this remains.
- `activation.ts:595-612` builds the engine with neither A's lifetime nor the
  frozen collaborators' forward-admission closures.
- `activation.ts:619-656` awaits legacy `settleFleetLedgerForRun`, catches it,
  and logs it. `queueBridge.ts:1280-1291` shows the required current behavior:
  one `getRun`, terminal-run gating, and `collectTerminalStageCosts` before
  ledger settlement. B must retain that projection before immutable D
  preparation, rather than prepare after every engine boundary.
- `activation.ts:744-838` defines retirement as only a drain promise/failure;
  `lock` starts drain before unbinding/revocation and skips retirement entirely
  when no attempt port exists. It cannot enforce the required ledger or tracked
  barriers.
- `http/context.ts:248` exposes the old internal `Promise<ExecutionOutcome>`
  signature and must be changed with the caller window.
- `routes.ts:2439-2519` treats any returned completion before acknowledgement
  as dispatch failure and its post-ack observer reports all failures. It needs
  the pre/post-ack withdrawal branches above. `routes.ts:1731-1742` and
  `launch.ts:553-564` are the separate detached Manager-successor and approved
  launch consumers; `routes.ts:2609-2619` is automatic Resume.
- `http/surface.ts:516-579` already performs in-place latch binding and guards
  queue dispatch by execution identity. It is not a B edit target, so B must
  preserve that construction contract rather than duplicate it.

The D receipt module already exposes the fixed
`prepareFleetLedgerSettlement`, `beginFleetLedgerSettlement`, and
`reconcileFleetLedgerReceipt` names (`fleetLedgerReceipt.ts:99`, `422`, `429`),
but its acceptance remains a prerequisite. The A lifetime currently exposes
`withdrawn`, `assertCurrent`, `track`, and `pending`; B should consume those
fixed names only after A acceptance.

`http/surface.test.ts:1339-1345` has an intentionally cast, incomplete
`activatedTriple`. Its instances are actually locked at lines 1425 and 1468.
If B makes `generation` a required runtime member that `lock()` dereferences,
this fixture will throw before the existing stop/unbind assertions. Therefore
B should make the narrow fixture-only addition of a fresh fake generation with
an idempotent lifetime (`revoke`, `assertCurrent`, `withdrawn`, `track`, and
`pending`) and an empty recovery map. No `surface.ts` production change is
needed. This is a real runtime dependency, not a type-only cast cleanup.

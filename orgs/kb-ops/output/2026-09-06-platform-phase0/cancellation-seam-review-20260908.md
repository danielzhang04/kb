# DRAFT — cancellation seam review, 2026-09-08

Author: `codex-worker`

Status: **TECHNICALLY READY after implementation and independent root review.**
The original read-only finding below is preserved as history; the authorized
two-file correction and verification are recorded at the end.

## Finding

`createBrokerCancellationController.cancelWorker` currently awaits
`attemptPort.cancel(...)` and discards its `PortResult` before it calls the
worker registry (`managedExecution.ts:123-124`). Consequently an actual C
refusal fulfills `ExecutionCancellationController.cancelWorker(): Promise<void>`.

That is not a close proof. C deliberately returns
`{ ok: false, refusal: 'internal', detail:
'message-claim-reconciliation-required' }` for a foreign/observer adapter,
poisoned creator, ambiguous claim transition, or failed owned close
(`attemptSessionAdapter.ts:1524-1563`). In particular, `closeAttempt` converts a
host close refusal or throw into a false `PortResult` (`:920-937`), and C's
cancel path returns it after a write-intent or released-claim close attempt.
Ignoring it lets A1's withdrawal cleanup regard an unconfirmed close as a
fulfilled `worker-close` promise.

The active A1 cleanup awaits receipt, result, and the close together, then
permits a zero settlement and tests whether close was rejected before removal
(`execution.ts:2765-2818`). It is structurally correct once the real controller
rejects an unconfirmed C close. With today's controller, a false C result is a
fulfilled promise, so `closeReady` is incorrectly true and the worktree can be
removed while the session/claim is reconciliation-required.

## Smallest correct implementation

Change only `dashboard/server/control/managedExecution.ts` and its test. Keep
the existing public `ExecutionCancellationController.cancelWorker` signature
as `Promise<void>`; A1 needs no new input, durable state, controller, or
string-derived authority.

The method should:

1. issue the existing `attemptPort.cancel` with the exact existing
   `attemptOperationKey` and reason;
2. call `registry.cancel(attemptOperationKey)` in a `finally`, so a locally
   registered worker cancellation is attempted even if the PTY port throws or
   returns a refusal;
3. after the port call fulfills, accept only `ok: true` or the structured
   `refusal === 'not-found'`; reject every other false result with a bounded
   diagnostic based on its structured refusal code, never its detail;
4. let a port throw and a registry cancellation throw reject naturally after
   the registry attempt. Do not turn either into a success sentinel.

The control flow can be expressed without a new result type:

```ts
let portResult: Awaited<ReturnType<AttemptExecutionPort['cancel']>> | null = null;
try {
  portResult = await options.attemptPort?.cancel({ operationKey, reason }) ?? null;
} finally {
  options.registry.cancel(operationKey);
}
if (portResult && !portResult.ok && portResult.refusal !== 'not-found') {
  throw new Error(`worker cancellation was not confirmed: ${portResult.refusal}`);
}
```

The precise local type syntax may differ because the options port is a `Pick`,
but the semantic shape must stay as above. `not-found` is the sole confirmed
absence result: the session record APIs use it only when a session is absent or
no longer live. It preserves the existing unknown-worker/no-port no-op
behavior. C's observer/reconciliation refusal is `internal`, not `not-found`,
and must reject. Do not inspect `detail`, convert arbitrary false values to
absence, or use an operation-key string to grant authority.

Calling the registry in `finally` is intentional. The registry callback is the
same exact worker-operation cleanup already registered at launch. A PTY refusal
does not prove that a child no longer needs cancellation; running the registry
callback cannot make the C refusal a close success. A thrown registry callback
also remains visible to A1 cleanup and blocks removal.

## Compatibility and tests in the managed-execution pair

Retain the existing test that an unknown/not-found port and a null port are
no-ops. Strengthen it to assert `registry.cancel` receives the exact operation
key in the not-found case. Add focused tests that prove:

- an `ok: true` port result fulfills and invokes the registry once;
- a `not-found` result fulfills and invokes the registry once;
- a C-shaped `ok: false, refusal: 'internal'` result rejects and still invokes
  the registry once;
- a thrown port call still invokes the registry once and rejects;
- if the registry callback throws, cancellation rejects rather than reporting
  a confirmed close.

Existing manager no-op and operation-key mapping behavior remain unchanged.
No source outside this pair is necessary merely to make the contract strict.

## Required real composition proof for A1

Add one test in A1's `execution.test.ts`, not a controller-only mock test. It
uses the real `createBrokerCancellationController` over a real C
`createAttemptSessionAdapter`, a real shared claim store, and a synthetic
`SessionHost`/binding registry. The host must start one owned C attempt and
hold its exit/result; its `close` returns the actual false
`PortResult<ObservedExit>` used by C's `closeAttempt`.

Drive the engine through worker launch, wait until C's successful launch receipt
has settled, revoke the A1 lifetime while its result remains held, and then
release the synthetic exit/result. Assert all of the following:

- C cancel was invoked through the real controller exactly once and the
  registered worker callback was invoked once;
- the failed C close makes the real controller reject, even though the C port
  promise itself fulfilled with a false result;
- the engine observes both receipt and result, performs exactly one same-key
  zero-usage settlement, and rejects its withdrawn cleanup path;
- `worktrees.remove` is never called; no retired lifecycle event, boundary,
  canonical integration, or second worker begins;
- the attempt's claim/operation remains C's reconciliation-required state.

The host must make receipt and result separately controllable so the test proves
the cleanup's `Promise.allSettled` observation rather than merely exercising a
synchronous fake. A companion successful-close control can retain the existing
proof that removal occurs only after close and the zero settlement both fulfill.

Add one observer case through a second C adapter sharing the same claim store:
its begin/cancel returns C's reconciliation refusal, the controller still fires
the registered worker cancellation, and it rejects rather than permitting a
worktree removal. This is not an adoption or recovery path.

## Scope conclusion

The two-file managed-execution change makes A1's existing strict cleanup gate
truthful. It requires no A1 input/interface amendment: `attemptOperationKey`
is already immutable launch identity and A1 already treats a rejected close as
failure. The A1 author separately owns its local one-shot handling of falsey
and synchronous cleanup failures. This review proposes no C modification, no
new durable recovery state, and no public route or authority.

## Implementation evidence — 2026-09-08

Implemented only `dashboard/server/control/managedExecution.ts` and
`managedExecution.test.ts`. The controller now validates the close result,
accepts only a valid observed exit or structured `not-found`, captures the
first port/refusal/malformed-result failure with an explicit boolean so `throw
undefined` and `Promise.reject(0)` remain failures, and calls the registry once
in `finally`. A registry failure is reported only when it is the first failure;
it cannot mask an earlier port rejection.

Focused verification passed:

```text
dashboard> npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/managedExecution.test.ts
Test Files  1 passed (1)
Tests  17 passed (17)
```

`git diff --check` has no patch errors. Full dashboard typecheck remains
coordinated with root. The files are frozen for independent review.

## Independent root acceptance - 2026-09-08

Reviewed the complete managed-execution pair, its diff, the cancellation port
contract, and the C refusal path. No remaining blocking finding in this scope.
The controller preserves falsey failures, attempts registry cancellation once,
and rejects unconfirmed closes without exposing the port diagnostic detail.
Root independently ran the native focused command above: **17/17 PASS** in
263 ms, followed by full dashboard `npm.cmd run typecheck`: **PASS**.
The real engine/C composition remains an A1 acceptance requirement; this
two-file acceptance does not claim that pending integration proof or a merge.

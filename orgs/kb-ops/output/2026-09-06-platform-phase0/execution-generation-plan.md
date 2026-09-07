# DRAFT — Phase 0 execution-generation fence

Status: **planning only; not approved for implementation; Phase 0 is not complete**.

This draft describes the smallest coherent fence for execution wiring that has been withdrawn by Lock.
It does not claim cancellation, rollback, or exactly-once effects. Its safety claim is narrower and
decidable: after a lifetime is synchronously revoked, that lifetime may not admit a new **forward-
execution effect** or project new run/control-plane state. An effect already invoked may finish, and only
the explicitly enumerated cleanup/receipt operations below may be newly invoked. The system must retain
enough per-port receipt state to recover or diagnose either kind of completion.

## Current gap, traced to source

The current drain barrier prevents replacement wiring from being constructed while the retired session
host is draining. `lock()` retains the old wiring, starts `attemptPort.drain()`, stops attempt IO, then
unbinds the surface; `unlock()` refuses while that drain is pending or failed
(`dashboard/server/control/activation.ts:795-820`, `activation.ts:833-877`). The attempt adapter makes
`draining = true` before its first await and refuses later `begin()` calls, then drains the current host
epoch (`dashboard/server/control/attemptSessionAdapter.ts:815-829`,
`attemptSessionAdapter.ts:1267-1272`).

That is a host-overlap barrier, not an execution-lifetime fence:

- `runToBoundary()` keeps process-local `activeRuns`/`cancellingRuns` state and resumes after many awaits
  (`dashboard/server/control/execution.ts:853-878`, `execution.ts:945-963`). Its cancellation predicate
  observes only the local cancellation set or durable `stopping`, `stopped`, and `interrupted` run
  states; Lock changes none of those (`execution.ts:2492-2496`). Store compare-and-swap versions therefore
  do not reject an old lifetime merely because the latch was locked.
- After an awaited result lookup or base resolution, the old engine can still create a Manager successor,
  record an iteration request, launch a worker, append lifecycle state, integrate a result, or settle the
  run (`execution.ts:1183-1246`, `execution.ts:1322-1409`, `execution.ts:2164-2428`,
  `execution.ts:2498-2528`).
- The activated wrapper always calls terminal ledger settlement after `engine.runToBoundary()` resolves
  (`dashboard/server/control/activation.ts:616-657`). Settlement appends rows before committing them
  (`dashboard/server/control/queueBridge.ts:1191-1218`), so abandoning it after append can leave the ops
  checkout in the poison state its own comments warn about (`queueBridge.ts:1177-1189`).
- Manager startup does not presently spawn a process: `ensure()` is metadata-only and records a session
  ref in a process-local set; `cancelManager()` is a no-op (`dashboard/server/control/managedExecution.ts:7-12`,
  `managedExecution.ts:63-78`, `managedExecution.ts:107-123`). A production-faithful reproduction must
  pause at real asynchronous work before Manager acknowledgement (for example canonical lookup/Git), not
  pretend that the present Manager adapter has a long-running child.

## Why a private withdrawn result alone is insufficient

`ActivatedExecution.runAutomatic` and `SurfaceContext.runAutomatic` currently return
`Promise<ExecutionOutcome>` (`dashboard/server/control/activation.ts:249-265`,
`dashboard/server/http/context.ts:247-252`). The activation route attaches two different consumers to
that promise:

1. Before acknowledgement, any fulfillment that occurs before `onManagerStarted` is converted to
   `automatic execution returned before durable Manager startup`, while any rejection rejects the same
   acknowledgement promise (`dashboard/server/control/routes.ts:2427-2465`). The timeout/catch path then
   fails the activation receipt, attempts Manager containment, creates **Activation dispatch needs
   reconciliation**, and may interrupt the run (`routes.ts:2466-2508`). Merely hiding the original error
   would still create this stale intervention.
2. After acknowledgement and the 202 response, a rejection creates **Automatic execution needs
   intervention** and can move the run to `waiting-human` or `interrupted`
   (`routes.ts:2511-2529`).

Other real callers also matter. Manager-successor dispatch reports every rejection as **Manager
successor needs intervention** (`routes.ts:1723-1743`); approved launch reports every rejection through
its automatic-failure surface (`dashboard/server/control/launch.ts:549-561`); automatic resume parks any
non-2xx fulfillment or rejection as **Automatic resume needs intervention**
(`routes.ts:2568-2621`). A withdrawn lifetime therefore needs an explicit internal settlement understood
at all four seams, including both activation-ack consumers. It must not masquerade as an ordinary
`ExecutionOutcome` such as `interrupted`.

Proposed internal shape:

```ts
type AutomaticExecutionSettlement =
  | { kind: 'boundary'; outcome: ExecutionOutcome }
  | { kind: 'withdrawn' };
```

This is an internal control result, not a new public run DTO. `runAutomatic` races the still-observed
engine promise against the lifetime's revocation signal. On revocation it promptly fulfills with
`{kind:'withdrawn'}`; the original engine promise remains observed and fenced until it settles. Terminal
ledger settlement runs only for a `boundary` result. The route must branch on `withdrawn` before its
generic acknowledgement timeout/catch and must treat a post-ack withdrawal as contained, not reportable.
Automatic resume must likewise avoid converting an `execution-withdrawn` activation response into a new
park. The exact durable receipt response is a human choice listed below.

## Effect-admission boundary

A broad `runPhase(async () => ...)` lease is unsafe. If admitted before Lock, it could start a session or
write a later prompt after revocation. Admission is instead checked immediately before each concrete
effect invocation. JavaScript cannot interleave a separate Lock request inside one synchronous store
call, so a synchronous store mutation admitted before revocation completes before revocation; the next
call is refused. Async ports require both an immediate pre-call check and a post-await check before the
next hop.

The fence does **not** claim that no bytes, commit, or publisher effect can become visible after Lock. If
`host.write`, Git, or the publisher was invoked just before revocation, its promise may resolve after
revocation and its external effect may already exist. The claim is: no subsequent invocation is admitted,
and completion/cleanup receipts from the issued operation remain recoverable.

Real boundaries, rather than a generic phase framework, are listed per port below. “Pre-call” means the
old generation must still be current immediately before invoking that port. “Post-await” means no later
forward hop or control-store projection occurs unless it is still current.

| Port / hop | Existing call site | Admission and post-revocation rule |
| --- | --- | --- |
| Control-store mutations | Manager successor, transitions, requests, events, iteration requests, and finalization throughout `execution.ts`, including `execution.ts:1183-1246`, `execution.ts:1403-1409`, and `execution.ts:2398-2428` | Gate every mutation. Reads may continue only to select cleanup or return the withdrawn settlement. No human request or lifecycle projection is cleanup. |
| `managers.ensure` | `execution.ts:1199-1224` | Check before invocation and after await. The production adapter is metadata-only today, but it remains an async port and must be fenced before a future implementation can add work. An already-issued completion cannot call `onManagerStarted` or transition state. |
| `results.lookup`, `results.resolveBase`, `results.integrate` | `execution.ts:1322-1327`, `execution.ts:1380-1385`, `execution.ts:1462-1471`, `execution.ts:2164-2211`, `execution.ts:2412-2428` | Check before each call and after await. `lookup` is not assumed read-only because it can advance an incomplete canonical saga. Its internal mutating hops use the canonical rules below. |
| `worktrees.ensure` | `execution.ts:2214-2217` | Check immediately before Git/FS provisioning and after await. It is a forward effect and may not start after revocation. |
| `skills.resolve` | `execution.ts:2218-2224` | Check before and after the port even though the current use is policy resolution; no boundary may be created from an old result. |
| `accounting.reserve` | `execution.ts:2226-2241` | Check before reserve and after await. A reservation issued before revocation may be released exactly once through its existing `settle:<attemptRef>` key; no worker or grant may follow it. |
| `provisionSpendGrant` | `execution.ts:2252-2268` | Check immediately before the grant-file/budget effect and after await. A grant must never be minted by a revoked generation. An issued grant is retained as an opaque receipt for explicit recovery; it does not authorize worker admission. |
| `workers.begin` and attempt session start | `execution.ts:2270-2307`; `attemptSessionAdapter.ts:1021-1069` | Check before `workers.begin` and before `startRunSession`, then after start before any prompt reservation. Lock durably cancels active operation keys and closes/drains their sessions. |
| `host.write` / `host.endInput` | `attemptSessionAdapter.ts:1073-1139` | Check before every invocation. An already-issued write may complete and be receipted, but no later prompt or EOF is issued. An ambiguous write remains claimed for reconciliation. |
| `accounting.settle` | `execution.ts:2314-2354` | A settle already admitted before revocation may finish under its same operation key. After revocation, only the zero-usage release of a reservation that was itself issued before revocation is newly admissible cleanup; no second ceiling/retry call is automatic. |
| Canonical Git and publisher hops | `canonicalResultIntegrator.ts:856-991`, `canonicalResultIntegrator.ts:1018-1052`, `canonicalResultIntegrator.ts:1085-1109` | Check before attempt commit, lineage cherry-pick, lineage publication, coordination preparation, and each publisher call. The existing journal remains the recovery authority. One issued hop may finish and record its own receipt; the old generation cannot invoke the next hop or project run/stage success. |
| `worktrees.inspect` | `execution.ts:2391-2395` | Check before and after inspection. No event, boundary, or integration can be derived from an old inspection. |
| `worktrees.remove` | `execution.ts:2477-2488` | This is explicitly allowed cleanup for an attempt already owned by the retired generation, at most once for its `worktree-remove:<attemptRef>` key. Failure may be retained/logged as cleanup metadata, but the revoked engine may not append the current lifecycle event at `execution.ts:2484-2488`. |
| Cancellation/host cleanup | `execution.ts:1013-1023`, `execution.ts:1265-1273`, `execution.ts:2511-2528`; `attemptSessionAdapter.ts:1233-1272` | Only cancellation of already-owned Manager/attempt operation keys plus session close/drain is admitted. Its cancellation/exit receipts may settle; catch paths cannot create an intervention or lifecycle transition for the revoked generation. |
| Fleet ledger unit | `activation.ts:637-657`; `queueBridge.ts:1191-1218` | Check immediately before the whole settlement unit. Once admitted, append plus governed commit/publication finishes as one tracked unit because stopping between them can poison coordination. A unit not admitted before revocation never starts. |

The canonical states are already resumable: `intent -> attempt-committed -> lineage-local ->
lineage-committed -> canonical-intent -> canonical-committed`
(`dashboard/server/control/canonicalResultIntegrator.ts:856-991`). No replacement saga or broad
`runPhase` lease is proposed.

## Four bounded implementation packages

### Package 1 — lifetime identity and engine state projection

Files:

- new `dashboard/server/control/executionLifetime.ts` and focused test;
- `dashboard/server/control/activation.ts` and `activation.test.ts`;
- `dashboard/server/control/execution.ts` and `execution.test.ts`.

Add one process-local, monotonically identified lifetime per constructed execution. Its deliberately
small API is `revoke()`, an already-observed `withdrawn` promise, `assertCurrent()` for immediate
admission, and tracking for specifically admitted async effects. `lock()` synchronously revokes first,
then performs host drain and surface withdrawal. The engine receives a gated mutation view of the
control store plus explicit checks after real awaits; it does not receive a general-purpose `runPhase`
abstraction. Run cleanup in `finally` remains allowed, but it cannot write new control-plane lifecycle.

The wrapper races engine completion against revocation, observes the losing promise, and suppresses
terminal ledger admission for a withdrawn lifetime. The retired lifetime, attempt-host drain, and any
already-issued tracked effect jointly block construction of replacement wiring.

### Package 2 — activation acknowledgement and detached caller settlement

Files:

- `dashboard/server/http/context.ts`;
- `dashboard/server/control/routes.ts` and `routes.test.ts`;
- `dashboard/server/control/launch.ts` and `launch.test.ts`.

Thread `AutomaticExecutionSettlement` through the server-local context without changing public success
DTOs. Gate `onManagerStarted`. In `activateRunUnderOwner`, resolve a pre-ack withdrawal through a dedicated
branch before the timeout/catch reporter, and treat a post-ack withdrawal as a contained completion. Teach
manager-successor, approved-launch, and automatic-resume seams that withdrawal is not an execution
failure. Preserve all genuine error reporters and their current intervention/dedup behavior.

This package must not merely filter an error string. Its tests must prove the actual route callback graph:
pre-ack withdrawal, timeout race, post-202 withdrawal, manager-successor, approved launch, and automatic
resume.

### Package 3 — concrete async effect ports and recoverable settlement

Files:

- `dashboard/server/control/attemptSessionAdapter.ts` and its tests;
- `dashboard/server/control/canonicalResultIntegrator.ts` and its tests;
- `dashboard/server/control/queueBridge.ts` and its ledger tests;
- only the minimal activation wiring needed to pass the lifetime admission callback.

Add explicit admission callbacks at every port/hop in the table above. On drain,
durably cancel active attempt operation keys and close their sessions while allowing operation receipts,
exit observation, and resource cleanup to settle. Do not permit adapter completion to project current run
state: the engine's post-await lifetime check is the boundary.

Canonical integration keeps its existing journal and publisher idempotency; no second saga is introduced.
Fleet ledger becomes one tracked admitted transaction, not a loop with a revocation check between row
append and commit. Accounting reserve/settle retains its existing attempt operation keys, and grant/
worktree cleanup is fenced independently from worker admission. Tests use delayed real port seams
corresponding to production subprocess/host/publisher awaits and distinguish an already-issued effect from
a prohibited later hop.

### Package 4 — operator-message claim receipt

Files:

- `dashboard/server/control/agentSessionChains.ts` and `agentSessionChains.test.ts`;
- `dashboard/server/control/attemptSessionAdapter.ts` and focused adapter tests.

This is required for correctness, not an optional cleanup. Today `drainMessages()` atomically copies and
deletes queued text (`agentSessionChains.ts:189-200`) before any attempt operation intent or worker
admission (`attemptSessionAdapter.ts:954-986`). If revocation refuses the later start, the operator's
instructions have already disappeared.

Replace destructive drain with a bounded claim keyed by the attempt operation key. The atomic document
move is `queued -> claimed`; a duplicate begin recovers the same claim. A successful attempt start receipt
acknowledges the claim. A refusal before any prompt-write invocation releases it to the queue. If a write
was issued and its delivery is ambiguous, retain the claim and its operation key for reconciliation rather
than silently deleting or automatically duplicating it. This package promises no silent loss and an
inspectable recovery state, not magic exactly-once delivery.

## Concrete yield-point reproductions

The acceptance harness must pause at production-reachable await seams and invoke the real latch Lock while
the old call is in flight:

1. Pause canonical lookup/Git during initial reconciliation, Lock, then release it. This is a real
   pre-Manager await. Assert the old generation creates no Manager successor, makes no Manager-start
   callback, advances no activation receipt to dispatched, and creates no activation intervention.
2. Pause dependency/iteration base resolution, Lock, then release. Assert no iteration request, attempt,
   session, boundary, event, or successor is created after release.
3. At separate earlier awaits, Lock immediately before each continuation would invoke `managers.ensure`,
   `worktrees.ensure`, `accounting.reserve`, or `provisionSpendGrant`. Assert each old-generation port
   invocation count remains zero. Pause each port after a valid pre-Lock invocation, then revoke and
   release it; assert no next hop or control-store projection occurs.
4. Pause `startRunSession`, Lock, then return a successful start. Assert the session is closed/cancelled,
   its operation receipt is retained, and `host.write`/`host.endInput` are never invoked.
5. Pause the first `host.write` after invocation, Lock, then accept it. Assert that one issued write is
   recorded as possibly delivered, no later prompt or `endInput` is invoked, and the attempt operation is
   recoverably cancelled.
6. Pause one canonical publisher hop after invocation, Lock, then resolve it. Assert no next publisher
   hop, canonical-final state, run success, or stage success is projected; the journal remains resumable.
7. Pause `worktrees.remove` after revocation and assert exactly one cleanup invocation for the retired
   attempt, zero lifecycle-event projections, and an idempotent retryable cleanup receipt on failure.
8. Pause immediately before fleet-settlement admission and revoke: zero rows and zero Git/publication
   calls. Separately pause an already-admitted ledger commit, Lock, complete it, and assert unlock remains
   refused until the tracked transaction settles.
9. Queue an operator message, claim it, revoke before worker admission, and retry with a new lifetime.
   Assert the message is either delivered by the retry or remains in a named claimed recovery state;
   it must not vanish. Add an ambiguous issued-write case that explicitly does not assert exactly once.

An integration test must also unlock generation A, hold an old callback, Lock, attempt an unlock while A
has pending tracked work (refused), then unlock generation B after quiescence and release A. Assert A can
neither write B's run state nor invoke B's store/effect ports. Helper-only tests are insufficient.

## Decidable acceptance and failure bounds

The work is acceptable only if all of these are machine-observed:

- The revocation flag is set synchronously at the start of Lock, before host drain or surface unbinding.
- After that point, counters for **new forward admissions** and forbidden control-store projections stay
  exactly zero. The named forward counters are: Manager ensure; result lookup/base/integration; worktree
  ensure/inspect; skill resolution; accounting reserve; spend-grant provisioning; worker/session begin;
  prompt/EOF; a next canonical Git/publisher hop; and a not-yet-admitted fleet-ledger unit.
- Each scenario separately asserts the exact allowed completion/cleanup count: one completion of the
  already-issued port call; one cancellation/close/drain sequence per active attempt; at most one
  `worktree-remove:<attemptRef>` cleanup; one zero-usage `settle:<attemptRef>` release for a pre-revocation
  reservation; one receipt/journal advance for an already-issued canonical hop; and completion of one
  already-admitted append+commit ledger unit. None may mint a human request or run/stage/session/attempt
  lifecycle projection.
- Every old engine promise, revocation race loser, reporter, logger, drain, and tracked effect rejection is
  observed; there is no production-global `unhandledRejection` listener.
- Pre-ack and post-ack route tests create zero generic activation/automatic-execution interventions for a
  withdrawal, while genuine faults still create the existing reporters.
- No Manager-start callback or activation receipt can advance after revocation.
- A replacement lifetime cannot be constructed while retired host drain or an admitted recovery-critical
  effect is still pending. A settled failure follows the named port recovery below; it never becomes a
  permanent undifferentiated lifetime deadlock or a blind generic retry.
- Attempt cancellation/exit, canonical publisher, and ledger receipts remain recoverable after revocation.
- Claimed operator messages are acknowledged only on the defined delivery receipt, released when no write
  was issued, or retained in a named ambiguous state. No test claims exactly once across an ambiguous
  external write.

Explicit non-goals and bounds:

- This is process-lifetime fencing, not distributed cancellation. A process restart removes old JavaScript
  callbacks; durable operation and saga receipts provide recovery.
- Lock does not retract already-issued host bytes, Git commands, publisher intents, or ledger appends.
- The fence does not prove complete worker cancellation, durable run-state interruption, or exactly-once
  external effects.
- Cleanup authority is limited to the retired lifetime's own attempt-operation receipts, session close/
  drain, at-most-once keyed worktree removal, release of a pre-revocation accounting reservation, an
  already-issued canonical receipt, and completion of an admitted ledger unit. It cannot create
  successors, prompts, grants, later canonical hops, human requests, or current-run lifecycle projections.

## Per-port failure recovery and unblock

There is no generic “retry failed effect” operation:

- **Host drain/close:** retain the current precise `execution-drain-failed` posture and explicit second-
  Lock retry. Attempt cancellation uses the same durable operation key; it never starts a replacement
  attempt.
- **Accounting:** `reserve:<attemptRef>` and `settle:<attemptRef>` are the only recovery identities. A
  reserve that completed before revocation is released with zero usage once. If release is refused or
  ambiguous, persist/name that reservation as accounting-reconciliation-required and let an explicit
  later run reconciliation retry the same settle key before any worker admission. Do not auto-reserve or
  run the ceiling-settlement fallback after revocation. A settled rejection no longer holds the process
  lifetime pending; its named durable receipt is the gate for that attempt.
- **Canonical integration:** an issued Git/publisher hop records only the journal/publisher receipt it owns.
  On rejection or ambiguity, leave the existing integration record at its last proven phase and mark the
  run as needing canonical reconciliation only through a current generation. Once the promise is settled,
  the retired process lifetime can quiesce; a later explicit Resume calls the existing same-operation-key
  `lookup`/`advanceIntegration` saga. There is no automatic post-Lock publisher retry.
- **Fleet ledger:** add a ledger-specific durable operation receipt keyed by run and the exact sorted row
  identities/hashes, with phases for intent, rows appended, committed, and publication uncertain. An
  admitted unit attempts append+commit once. On a definite pre-append failure it can close as failed with
  no retry needed; after append or an ambiguous commit/publication result, a second explicit Lock/recovery
  action may invoke only this ledger operation's same-key reconciler. That reconciler proves the exact
  rows/commit before appending anything, completes only missing phases, and never blindly appends duplicate
  rows. Unlock returns a precise `execution-ledger-reconciliation-required` refusal until that receipt is
  reconciled; it is not folded into generic drain failure.
- **Worktree/grant cleanup:** `worktree-remove:<attemptRef>` is idempotent and retryable only for that
  retired attempt. An already-minted grant is not replayed or treated as worker authority; its attempt
  remains blocked on explicit accounting/grant reconciliation. Neither failure can create an old-
  generation lifecycle event.

## Preserved Lock mechanics and the unresolved human ruling

This plan preserves three bounded mechanics rather than reopening them as implementation choices:

- Lock acknowledges synchronously after changing the global execution-wiring posture to `locked` and
  revoking new admissions. It does not claim already-issued effects are quiescent; Unlock remains blocked
  while they are pending or have a named ledger/drain recovery requirement.
- A fleet-ledger unit admitted before Lock finishes its append+commit/publication unit.
- An already-issued ambiguous host write leaves its operator-message claim parked for explicit
  reconciliation; it is never blindly replayed.

One policy question remains genuinely unresolved: **what durable meaning does Lock have for a run that is
`roots-activated`/`recovering` but has not acknowledged Manager startup?**

- Wiring-brake semantics: revoke only the process generation, leave the activation receipt
  `roots-activated` and the run retryable/recovering, return a stable withdrawn response without an
  intervention, and require explicit Resume after Unlock. This preserves the current distinction between
  global Lock and per-run Stop and is the recommended bounded interpretation.
- Durable interruption semantics: fail the activation receipt and durably interrupt/park the run, again
  without the generic stale intervention. Resume must explicitly repair that state.

Treating Lock as “finish the whole existing run” or “permanently cancel every run” would be a different
control contract: the former conflicts with generation withdrawal, and the latter duplicates/expands
per-run Stop. This draft does not assume the operator's answer or implement either expansion.

## Next risk gate

Before any implementation authorization, obtain the human ruling on the pre-Manager-ack run/receipt
meaning above. Then have a fresh reviewer challenge this revision against the diagnostics findings, the
per-port table, and the exact production callers. Only after that review should Package 1 be separately
approved. Until the operator-message receipt package and the cross-generation integration acceptance pass,
**Phase 0 remains incomplete**.

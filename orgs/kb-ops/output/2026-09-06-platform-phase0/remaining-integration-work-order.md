# DRAFT — Remaining Phase 0 integrated generation fence work order

Status: planning only. Slice 1A alone is technically reviewed; the full Phase 0 plan remains gated. This converts its remaining Slice 1B and Packages 2–4 into build briefs, without binding Slice 1A or completing Phase 0. The default is the compatibility-preserving wiring brake: Lock withdraws this process generation, leaves the run resumable, and requires Resume after Unlock. It does not durably stop, interrupt, or complete a run. First independent plan review requested changes; this revision resolves its ledger, claim, and dependency findings.

## Frozen boundary and common contract

`dashboard/server/control/adapters.ts`, `adapters.test.ts`, `spendGrantProvision.ts`, and `spendGrantProvision.test.ts` are frozen pending independent review and a Linux run. The Slice 1A Linux mode-fixture failure is paused under the two-failure rule and is outside this work order. Their optional `assertForwardAdmission(): void` callback is the only worktree/grant seam used below. This plan does not release or edit any frozen file.

Create `dashboard/server/control/executionLifetime.ts` with this server-internal interface:

```ts
export class ExecutionWithdrawnError extends Error {}
export interface ExecutionLifetime {
  readonly withdrawn: Promise<void>; // resolves once; never rejects
  revoke(): void;                    // synchronous and idempotent
  assertCurrent(): void;             // throws ExecutionWithdrawnError after revoke
  track<T>(label: string, issued: Promise<T>): Promise<T>;
  pending(): readonly string[];      // labels only; no values or secrets
}
export function createExecutionLifetime(): ExecutionLifetime;
export type AutomaticExecutionSettlement =
  | { kind: 'boundary'; outcome: ExecutionOutcome }
  | { kind: 'withdrawn' };
```

`track` observes an already-issued promise; it never takes an effect factory and is not a lease. Each call site asserts immediately before a concrete effect, tracks its returned promise, then asserts after await before a later forward effect or projection. Every rejection stays observed; no process-global unhandled-rejection listener is introduced.

Do not add a generic store proxy, `runPhase`, public DTO, or generic retry. `execution.ts` retains named transition/boundary helpers and adds explicit current-generation assertions at the top of each, immediately before actual store mutation. Reads may continue only to select cleanup or withdrawal. Cleanup is limited to owned cancellation/close/drain, one `worktree-remove:<attemptRef>`, zero-usage `settle:<attemptRef>` after an issued reservation, an issued canonical receipt, and a whole admitted ledger unit. It cannot create successors, prompts, grants, requests, or lifecycle state.

## Ownership and integration order

No two workers edit a listed file. Each stops with evidence after two verification failures on the same scenario. Builders may add focused tests for their section but may not weaken this work order or Slice 1A acceptance.

| Order / owner | Sole files | Fixed handoff |
| --- | --- | --- |
| A — lifetime/engine | new `executionLifetime.ts` + test; new `spendGrantProvisionOutcome.ts`; `execution.ts`, `execution.test.ts` | Owns the neutral lifetime and grant-outcome interfaces, then explicit engine admission/projection checks. Does not edit activation, routes, attempts, canonical, ledger, or Slice 1A. |
| B — activation/callers | `activation.ts` + test; `http/context.ts`; `routes.ts` + test; `launch.ts` + test | Sole owner of latch, wiring, settlement translation, and all detached callers. Consumes A/C/D interfaces unchanged. |
| C — attempt/message receipts | `attemptSessionAdapter.ts` + test; `agentSessionChains.ts` + test | Replaces destructive drain with durable claims and fences session/write/EOF. Defines only options B passes. |
| D — canonical/ledger/grant refusal | `canonicalResultIntegrator.ts` + test; `queueBridge.ts` + ledger tests; after Slice 1A is released for the integration wave, `spendGrantProvision.ts` + test | Fences canonical hops, adds ledger receipt/reconciliation, and implements the mandatory tokenless already-live refusal. Defines only construction/settlement options B passes. |

The dependency graph is A0 interface stage → C plus D canonical/ledger ports → D grant port after Slice 1A release → A1 engine → B integration. A0 creates only `executionLifetime.ts` and `spendGrantProvisionOutcome.ts`; `SpendGrantProvisionOutcome` is `{ kind: 'ready' } | { kind: 'tokenless-already-live'; grantRef: string | null }`. D imports that type when it reopens the grant provisioner, and A1 imports the same type when it changes engine control flow. Thus A does not need a D-created interface, and no worker edits the same file. B starts only after A1/C/D focused acceptance passes and performs integrated wiring last. No partial activation wiring lands. The internal `runAutomatic` type becomes `Promise<AutomaticExecutionSettlement>` only in server control/context modules; browser DTOs remain unchanged.

## Brief A — lifetime and engine projection

1. A0 owns and freezes `SpendGrantProvisionOutcome` above before any port work. A1 adds optional `lifetime?: ExecutionLifetime` and `provisionSpendGrant?: (...) => Promise<SpendGrantProvisionOutcome>` to `AutomaticExecutionOptions`; omission preserves inactive and existing unit construction. B creates the lifetime; A only consumes it through an explicit local assertion.
2. Immediately before and after every await, gate and track `managers.ensure`; `results.lookup`, `resolveBase`, `integrate`; `worktrees.ensure`, `inspect`; `skills.resolve`; `accounting.reserve`; `provisionSpendGrant`; and `workers.begin`. A post-await withdrawal cannot project its returned value.
3. Gate each forward mutation: Manager successor creation, transitions, iteration requests, boundaries, events, and finalization. `onManagerStarted` is a forward projection and is gated.
4. After a pre-revocation reserve resolves, use only its same-key zero-usage settlement. Do not ceiling settle, reserve again, grant, or start a worker. `worktrees.remove` stays one cleanup call; its catch may not append an event after withdrawal.
5. Consume D's internal `SpendGrantProvisionOutcome`: `ready` continues; `tokenless-already-live` creates exactly one `intervention` boundary titled `automatic:spend:<stageId>:tokenless-already-live`, moves the attempt and worker session to `waiting`, and returns `waiting-human` before `workers.begin`. Its stable prompt says that a previous grant is live but has no capability file and that the bounded TTL must expire before Resume. It includes no raw token.
6. Tests hold real promise seams for canonical lookup/base, Manager ensure, worktree ensure, reserve, grant provision, worker begin, inspect, and integration. Each proves at most one issued completion and zero next ports, store projections, or Manager callback. They also prove the tokenless outcome invokes zero workers. Boolean-only lifetime tests do not meet this brief.

## Brief C — claim receipt and attempt admission

Atomically migrate the agent-chain document to structured queued messages `{ messageRef, text, queuedAt }`. `queueMessage` generates `messageRef`. A first mutate of legacy string arrays assigns deterministic refs from `(runRef, agentId, ordinal, text)`, so duplicate text keeps distinct order. Add claims keyed by attempt operation key, including empty claims so the same operation cannot acquire later messages after restart:

```ts
{ claimRef, declarationFingerprint, agentId, messageRefs, messages, promptFingerprint: string | null,
  state: 'claimed' | 'write-intent' | 'acknowledged' | 'released', releaseNonce: string | null, revision, claimedAt, updatedAt }
```

Expose internal `claimMessages(runRef, agentId, operationKey, declarationFingerprint)`, `bindPromptFingerprint(runRef, operationKey, claimRef, expectedRevision, promptFingerprint)`, `recordWriteIntent(runRef, operationKey, claimRef, expectedRevision)`, `ackClaim(runRef, operationKey, claimRef, expectedRevision)`, and `releaseClaim(runRef, operationKey, claimRef, releaseNonce)`. `claimMessages` atomically creates or returns the immutable durable record, including its ordered messages, refs, empty set, and `createdByThisCaller`; on repeat it never reads the current queue. It refuses agent/declaration mismatch. `bindPromptFingerprint` CASes the exact augmented encoded-prompt-byte fingerprint before any attempt write-ahead/session action; every replay must re-supply and match it. The later methods are revision CASes and refuse a different claim ref or fingerprint. Claim moves messages atomically, release restores original order, and acknowledgement removes a claim only after a successful attempt-start receipt. Recovery errors never include message text.

`attemptSessionAdapter.begin` orders work as claim → prepare exact augmented prompts → `bindPromptFingerprint` → bind `claimRef`, declaration fingerprint, and exact prompt fingerprint into the existing durable attempt-operation record by its own CAS → start session → durable write-intent immediately before first host-write admission → prompt writes/EOF → acknowledgement with the success receipt. Every replay cross-checks all three immutable bindings before it can adopt a receipt. A repeat that loses the attempt-operation CAS treats a pending/bound record as in-flight and returns/adopts its result; it never starts a second session, writes, or releases that winner's claim. Preparation failure releases then refuses; it never falls back to a prompt sequence that silently drops a message.

C adds `assertForwardAdmission?: () => void`. Check before `startRunSession`, each `host.write`, and `host.endInput`, and after their awaits before later hops. Every refusal before any prompt-write invocation — preparation failure, attempt-record read/write failure or conflict, `startRunSession` throw/refusal, cancellation, or revoked admission — releases the claim. The caller that created an unbound claim releases it directly with a nonce minted by the claim CAS when its attempt-record read/write fails; a replay caller has no such nonce and therefore cannot release another caller's claim. Once an attempt record exists, release first CASes that exact record to `claim-release-pending` only when its claim/prompt/declaration bindings match and it has no write-intent; this mints `releaseNonce`, and only that CAS winner calls `releaseClaim`. A conflict loser treats the winner as in-flight and never starts, writes, or releases. A crash after release-pending retries the same nonce. Write-intent that might have reached the host remains ambiguous after crash/revoke and is never blindly replayed. A partial `host.write` result (`0 < accepted < prompt.byteLength`) is an issued ambiguous write: it performs no later prompt/EOF, acknowledgement, or release. Cancellation/close and receipt observation remain allowed cleanup. The stored prompt fingerprint is the hash of exact encoded prompt bytes plus ordered message refs, binding recovery to the same message content.

Focused tests cover empty-claim restart with a later queued message excluded; immutable prompt fingerprint replay mismatch refusal before any record/session action; claim then revoke before session start (release); each pre-write record/start refusal listed above (release); a two-adapter shared-store race where the loser neither starts/writes/releases; preparation failure (queued message remains); held session start (close/cancel, zero write/EOF); held first and partial write (no later prompt/EOF, acknowledgement, or release; retained ambiguity); duplicate begin (one immutable claim); legacy duplicate identities; and restart/retry (no loss or automatic duplicate of write-intent).

## Brief D — canonical and ledger recovery

`createCanonicalGitResultIntegrator` gains optional `assertForwardAdmission`. Its serialized callback checks on entry, not just before joining `tail`, and immediately before attempt commit, lineage cherry-pick, lineage publication, coordination preparation, and every Git/publisher call. An issued hop may record its existing journal receipt; a retired callback cannot invoke the next hop, verify/project canonical success, or produce an engine event. Keep the current journal and operation keys; do not create a second saga or automatic retry.

Add a local fleet-ledger receipt keyed by run plus a canonical hash of sorted terminal row identities/costs. Phases: `intent`, `rows-appended`, `committed`, `publication-uncertain`, and `completed`. Persist intent; append exact rows; persist rows-appended; use existing governed commit/publication; then prove exact rows/commit before completed. After append/crash, the same key reconciles by inspecting shards and Git, completing only proven missing phases and never appending duplicates. This is explicit cross-store recovery, not a fictional atomic transaction.

B asserts current immediately before starting this whole ledger unit and tracks the issued promise without a later check inside it. Before revoke: no D call, rows, or Git. After admission: complete or retain the named receipt. D owns `FleetLedgerReceiptStore`, constructed by B as `createFleetLedgerReceiptStore({ stateRoot })` at `<stateRoot>/control/fleet-ledger-receipts.json`; D's settlement and reconciler both receive that same store, never a copied receipt. D exports `reconcileFleetLedgerReceipt({ receipts, repoRoot, publication, outboxRoot }, { subject, runRef, receiptKey }): Promise<'settled' | 'required'>`; it uses the same receipt key and proves rows/commit before returning `settled`, while expected incomplete/ambiguous states return `required` rather than throw. Unexpected errors reject and are observed by B. `ActivatedExecution` owns `reconcileLedger(receiptKey)` as the sole B-to-D closure. Unlock refuses `execution-ledger-reconciliation-required` until this reconciler proves settlement; the present best-effort `console.error` must not hide that state.

D tests held canonical Git/publisher (zero next hop/projection), held pre-ledger admission (zero rows/Git), held admitted commit (one unit completes), and crash-shaped phases (same-key reconciliation, never duplicate rows).

After the paused Slice 1A work has passed its separate review and is explicitly released for this integration wave, D reopens only `spendGrantProvision.ts` and its test. It replaces the current silent `already-live` no-op from `createSpendGrantProvisioner` with the internal discriminated return `SpendGrantProvisionOutcome = { kind: 'ready' } | { kind: 'tokenless-already-live'; grantRef: string | null }`. `provisionAttemptSpendGrant` still returns its existing result and still discards the raw token after revocation; only the engine-hook adapter maps `already-live` to the named outcome. D proves an already-live grant causes no token-file write and that the outcome contains no token or logger payload. A owns the corresponding no-worker engine test. This is mandatory Package 3 work, not a reviewer-finding exception or an optional cleanup.

## Brief B — latch, settlement, and route graph

B creates one lifetime, passes it to A's engine, and passes `lifetime.assertCurrent` to frozen worktree/grant constructors and C/D constructors. The wrapper races `engine.runToBoundary()` against `lifetime.withdrawn`, observes the losing engine promise through tracking, and returns `{ kind: 'withdrawn' }` promptly. Only `{ kind: 'boundary' }` admits ledger settlement. No raw token, effect result, or caught secret enters a settlement or log.

`ExecutionLatch.lock` calls `lifetime.revoke()` synchronously before `attemptPort.drain()`, `attemptIo.stop`, or surface unbinding. Retired wiring remains until host drain and tracked recovery-critical effects settle, even when there is no attempt port. `RetiredExecution` owns `ledgerReceiptKey`, `ledgerRecoveryRequired`, and an observed `ledgerRecovery` promise. A first Lock only observes an admitted unit and records whether it reached a recovery-required receipt. A second invocation of the existing Lock action while locked is the sole recovery trigger: it calls the retired execution's internal `reconcileLedger` closure, stores `void reconcileFleetLedgerReceipt(...)` as `ledgerRecovery`, and returns the existing synchronous locked state. Its promise always has fulfillment/rejection observers; a rejection keeps `ledgerRecoveryRequired` true. `unlock()` remains synchronous and returns `execution-draining` while drain/tracked work/recovery is pending, then `execution-ledger-reconciliation-required` while the receipt is unproven. It constructs replacement wiring only after the same-key reconciler returns `settled`. No route, DTO, or new public authority is added; the existing Lock route's locked response is unchanged.

Routes branch on withdrawal before generic reporting at every current consumer: pre-ack activation creates no failed receipt, Manager containment, or **Activation dispatch needs reconciliation**; post-202 activation creates no **Automatic execution needs intervention**; Manager successor and approved launch contain detached withdrawal; automatic resume creates no **Automatic resume needs intervention**. Genuine errors retain every existing reporter/transition. The run remains `roots-activated`/recovering and requires Resume after Unlock. The deterministic pre-ack response is `202 { ok: true, value: runDto(currentRun), starting: false }`: `currentRun` is read after withdrawal, the receipt remains `roots-activated`, and no new browser DTO or settlement field is exposed.

## Integrated black-box obligations

B's final suite pauses production-reachable seams, calls real Lock, then releases: (1) canonical lookup before Manager acknowledgement: no successor/callback/dispatch/intervention; (2) base resolution and each later port: no next port, boundary, event, or lifecycle projection; (3) full/sparse worktree add, inner verify, and grant mint: preserve Slice 1A counters, including no post-add chmod/verify, sparse command, token write, or token leak; (4) session-start and first-write: close/cancel and retain the correct operation/claim receipt; (5) canonical publisher and ledger: journal/ledger receipt survives while no next forward action runs; (6) Lock A, try Unlock during tracked A work (refused), unlock B after quiescence, then release A: A cannot mutate B's store or call B's ports.

Required final gates are focused worker tests, B integrated suite, typecheck, and fresh independent review. No builder self-certifies acceptance.

# DRAFT — Remaining Phase 0 integrated generation fence work order

Status: planning only. Slice 1A alone is technically reviewed; the full Phase 0 plan remains gated. This converts its remaining Slice 1B and Packages 2–4 into build briefs, without binding Slice 1A or completing Phase 0. The default is the compatibility-preserving wiring brake: Lock withdraws this process generation, leaves the run resumable, and requires Resume after Unlock. It does not durably stop, interrupt, or complete a run.

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
| A — lifetime/engine | new `executionLifetime.ts` + test; `execution.ts`, `execution.test.ts` | Defines lifetime and explicit engine admission/projection checks, including the tokenless grant outcome. Does not edit activation, routes, attempts, canonical, ledger, or Slice 1A. |
| B — activation/callers | `activation.ts` + test; `http/context.ts`; `routes.ts` + test; `launch.ts` + test | Sole owner of latch, wiring, settlement translation, and all detached callers. Consumes A/C/D interfaces unchanged. |
| C — attempt/message receipts | `attemptSessionAdapter.ts` + test; `agentSessionChains.ts` + test | Replaces destructive drain with durable claims and fences session/write/EOF. Defines only options B passes. |
| D — canonical/ledger/grant refusal | `canonicalResultIntegrator.ts` + test; `queueBridge.ts` + ledger tests; after Slice 1A is released for the integration wave, `spendGrantProvision.ts` + test | Fences canonical hops, adds ledger receipt/reconciliation, and implements the mandatory tokenless already-live refusal. Defines only construction/settlement options B passes. |

Build A first. C and D may build in parallel after A's interface is fixed. B starts only after A/C/D focused acceptance passes and performs the integrated wiring last. No partial activation wiring lands. The internal `runAutomatic` type becomes `Promise<AutomaticExecutionSettlement>` only in server control/context modules; browser DTOs remain unchanged.

## Brief A — lifetime and engine projection

1. Add optional `lifetime?: ExecutionLifetime` to `AutomaticExecutionOptions`; omission preserves inactive and existing unit construction. B creates it; A only consumes it through an explicit local assertion.
2. Immediately before and after every await, gate and track `managers.ensure`; `results.lookup`, `resolveBase`, `integrate`; `worktrees.ensure`, `inspect`; `skills.resolve`; `accounting.reserve`; `provisionSpendGrant`; and `workers.begin`. A post-await withdrawal cannot project its returned value.
3. Gate each forward mutation: Manager successor creation, transitions, iteration requests, boundaries, events, and finalization. `onManagerStarted` is a forward projection and is gated.
4. After a pre-revocation reserve resolves, use only its same-key zero-usage settlement. Do not ceiling settle, reserve again, grant, or start a worker. `worktrees.remove` stays one cleanup call; its catch may not append an event after withdrawal.
5. Consume D's internal `SpendGrantProvisionOutcome`: `ready` continues; `tokenless-already-live` creates exactly one `intervention` boundary titled `automatic:spend:<stageId>:tokenless-already-live`, moves the attempt and worker session to `waiting`, and returns `waiting-human` before `workers.begin`. Its stable prompt says that a previous grant is live but has no capability file and that the bounded TTL must expire before Resume. It includes no raw token.
6. Tests hold real promise seams for canonical lookup/base, Manager ensure, worktree ensure, reserve, grant provision, worker begin, inspect, and integration. Each proves at most one issued completion and zero next ports, store projections, or Manager callback. They also prove the tokenless outcome invokes zero workers. Boolean-only lifetime tests do not meet this brief.

## Brief C — claim receipt and attempt admission

Atomically migrate the agent-chain document to structured queued messages `{ messageRef, text, queuedAt }`. `queueMessage` generates `messageRef`. A first mutate of legacy string arrays assigns deterministic refs from `(runRef, agentId, ordinal, text)`, so duplicate text keeps distinct order. Add claims keyed by attempt operation key:

```ts
{ agentId, messageRefs, promptFingerprint: string | null,
  state: 'claimed' | 'write-intent' | 'acknowledged' | 'released', claimedAt, updatedAt }
```

Expose internal `claimMessages(runRef, agentId, operationKey)`, `recordWriteIntent(runRef, operationKey, promptFingerprint)`, `ackClaim(runRef, operationKey)`, and `releaseClaim(runRef, operationKey)`. A repeat requires the same agent, ordered refs, and, once present, prompt fingerprint; mismatch is a binding conflict. Claim moves messages atomically, release restores original order, and acknowledgement removes a claim only after a successful attempt-start receipt. Recovery errors never include message text.

`attemptSessionAdapter.begin` orders work as claim → prepare exact augmented prompts → existing attempt write-ahead record → start session → durable write-intent immediately before first host-write admission → prompt writes/EOF → acknowledgement with the success receipt. Preparation failure releases then refuses; it never falls back to a prompt sequence that silently drops a message.

C adds `assertForwardAdmission?: () => void`. Check before `startRunSession`, each `host.write`, and `host.endInput`, and after their awaits before later hops. Revoke before write-intent releases the claim. Write-intent that might have reached the host remains ambiguous after crash/revoke and is never blindly replayed. Cancellation/close and receipt observation remain allowed cleanup. The stored fingerprint binds ordered message refs to recovered approved prompt bytes.

Focused tests cover claim then revoke before session start (release); preparation failure (queued message remains); held session start (close/cancel, zero write/EOF); held first write (no later prompt/EOF, retained ambiguity); duplicate begin (one claim); legacy duplicate identities; and restart/retry (no loss or automatic duplicate of write-intent).

## Brief D — canonical and ledger recovery

`createCanonicalGitResultIntegrator` gains optional `assertForwardAdmission`. Its serialized callback checks on entry, not just before joining `tail`, and immediately before attempt commit, lineage cherry-pick, lineage publication, coordination preparation, and every Git/publisher call. An issued hop may record its existing journal receipt; a retired callback cannot invoke the next hop, verify/project canonical success, or produce an engine event. Keep the current journal and operation keys; do not create a second saga or automatic retry.

Add a local fleet-ledger receipt keyed by run plus a canonical hash of sorted terminal row identities/costs. Phases: `intent`, `rows-appended`, `committed`, `publication-uncertain`, and `completed`. Persist intent; append exact rows; persist rows-appended; use existing governed commit/publication; then prove exact rows/commit before completed. After append/crash, the same key reconciles by inspecting shards and Git, completing only proven missing phases and never appending duplicates. This is explicit cross-store recovery, not a fictional atomic transaction.

B asserts current immediately before starting this whole ledger unit and tracks the issued promise without a later check inside it. Before revoke: no D call, rows, or Git. After admission: complete or retain the named receipt. Unlock refuses `execution-ledger-reconciliation-required` until D's reconciler proves settlement; the present best-effort `console.error` must not hide that state.

D tests held canonical Git/publisher (zero next hop/projection), held pre-ledger admission (zero rows/Git), held admitted commit (one unit completes), and crash-shaped phases (same-key reconciliation, never duplicate rows).

After the paused Slice 1A work has passed its separate review and is explicitly released for this integration wave, D reopens only `spendGrantProvision.ts` and its test. It replaces the current silent `already-live` no-op from `createSpendGrantProvisioner` with the internal discriminated return `SpendGrantProvisionOutcome = { kind: 'ready' } | { kind: 'tokenless-already-live'; grantRef: string | null }`. `provisionAttemptSpendGrant` still returns its existing result and still discards the raw token after revocation; only the engine-hook adapter maps `already-live` to the named outcome. D proves an already-live grant causes no token-file write and that the outcome contains no token or logger payload. A owns the corresponding no-worker engine test. This is mandatory Package 3 work, not a reviewer-finding exception or an optional cleanup.

## Brief B — latch, settlement, and route graph

B creates one lifetime, passes it to A's engine, and passes `lifetime.assertCurrent` to frozen worktree/grant constructors and C/D constructors. The wrapper races `engine.runToBoundary()` against `lifetime.withdrawn`, observes the losing engine promise through tracking, and returns `{ kind: 'withdrawn' }` promptly. Only `{ kind: 'boundary' }` admits ledger settlement. No raw token, effect result, or caught secret enters a settlement or log.

`ExecutionLatch.lock` calls `lifetime.revoke()` synchronously before `attemptPort.drain()`, `attemptIo.stop`, or surface unbinding. Retired wiring remains until host drain and tracked recovery-critical effects settle; named drain/ledger recovery failure keeps the fail-closed unlock posture. Unlock cannot construct a replacement while either is pending.

Routes branch on withdrawal before generic reporting at every current consumer: pre-ack activation creates no failed receipt, Manager containment, or **Activation dispatch needs reconciliation**; post-202 activation creates no **Automatic execution needs intervention**; Manager successor and approved launch contain detached withdrawal; automatic resume creates no **Automatic resume needs intervention**. Genuine errors retain every existing reporter/transition. The run remains `roots-activated`/recovering and requires Resume after Unlock. The deterministic pre-ack response is `202 { ok: true, value: runDto(currentRun), starting: false }`: `currentRun` is read after withdrawal, the receipt remains `roots-activated`, and no new browser DTO or settlement field is exposed.

## Integrated black-box obligations

B's final suite pauses production-reachable seams, calls real Lock, then releases: (1) canonical lookup before Manager acknowledgement: no successor/callback/dispatch/intervention; (2) base resolution and each later port: no next port, boundary, event, or lifecycle projection; (3) full/sparse worktree add, inner verify, and grant mint: preserve Slice 1A counters, including no post-add chmod/verify, sparse command, token write, or token leak; (4) session-start and first-write: close/cancel and retain the correct operation/claim receipt; (5) canonical publisher and ledger: journal/ledger receipt survives while no next forward action runs; (6) Lock A, try Unlock during tracked A work (refused), unlock B after quiescence, then release A: A cannot mutate B's store or call B's ports.

Required final gates are focused worker tests, B integrated suite, typecheck, and fresh independent review. No builder self-certifies acceptance.

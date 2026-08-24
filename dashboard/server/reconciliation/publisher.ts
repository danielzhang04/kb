// P4 section 3.4: the ONE server-owned reconciliation publisher. Every card/Inbox transition and
// schedule effect passes through `publishReconciliationIntent`; nothing else may reach the ops
// outbox or the durable publisher.
//
// AUTHORIZATION BOUNDARY. This module is NOT one. It gates exactly one privilege — only an
// authenticated Task action may claim the `human-operator` actor — and nothing else: an
// unauthenticated caller that reaches this function can perform the same card transition by
// declaring `actor: 'system-sweeper'`, which merely lands on a different idempotency key. W6.2's
// route is therefore the entire authentication/authorization boundary; the publisher is the
// integrity boundary (CAS, receipts, recomputed targets, audit).
//
// OPS-BYPASS WALL. Effect ports refuse any request object this module did not mint
// (`assertReconciliationPublisher`); membership lives in a module-private `WeakSet`, so there is no
// grant symbol to lift off a real request and no payload a captured request can be replayed with.
// The publisher asserts membership itself immediately before every port call, so a port that
// forgets its own assert still adds no hole on the publisher's path — and `portConformanceSuite`
// lets W6.2 prove each REAL port refuses an unminted request with 403.
//
// Every collaborator is an INJECTED PORT. In particular the two-phase receipt is
// `ReconciliationReceiptPort`, backed here by an in-memory fake in the tests; W6.2 substitutes the
// real `control/store.ts` implementation behind the same port and re-runs these suites unchanged
// [P4-C33]. This file never touches `store.ts`.
import {
  ReconciliationConflictError, classifyReplay, decodeReconciliationIntent,
  reconciliationExactTargets, reconciliationIdempotencyKey, reconciliationIntentSha256,
} from './contracts.ts';
import type {
  CardBlockSection, PreparedReconciliationReceipt, ReconciliationActor, ReconciliationIntent,
  ReconciliationReceiptPort, ReconciliationResult, ScheduleMirrorIntent,
} from './contracts.ts';
import { appendReconciliationAudit } from './audit.ts';
import type { ReconciliationAuditInput, ReconciliationAuditSink } from './audit.ts';
import { scheduleMirrorOperationKey } from '../write/durableManifest.ts';
import type { RouteDurableReceipt } from '../write/durableManifest.ts';
import { isWatermarkUnchanged, scheduleMirrorBatchId } from '../schedules/mirrorContracts.ts';
import type { ScheduleMirrorWatermark } from '../schedules/mirrorContracts.ts';

// --- Ops-bypass wall ---------------------------------------------------------------------------

/**
 * The exact request OBJECTS this publisher minted. A `WeakSet` cannot be enumerated and carries no
 * key or symbol, so nothing is extractable from a request that ever reaches other code: a forged
 * literal is not a member, a structural clone of a captured request is not a member, and a captured
 * request cannot be re-submitted with a mutated payload (minted requests are frozen, and a copy
 * with a different `fromState`/`section`/target set is a different object).
 */
const mintedRequests = new WeakSet<object>();

/** Thrown when an effect is invoked outside the one publisher, or under the wrong operation. */
export class OpsBypassError extends Error {
  readonly status = 403;
  constructor(detail: string) {
    super(`direct reconciliation effect refused: ${detail}`);
    this.name = 'OpsBypassError';
  }
}

/**
 * Every effect port MUST call this first, with the request object it was handed. A hand-built or
 * mutated request cannot satisfy it, so a direct ops-outbox or durable publication attempted
 * outside the publisher is refused with 403.
 */
export function assertReconciliationPublisher(request: unknown): void {
  if (request === null || typeof request !== 'object') {
    throw new OpsBypassError('no publisher-minted request');
  }
  if (!mintedRequests.has(request)) {
    throw new OpsBypassError('request was not minted by the reconciliation publisher');
  }
}

/** Freezes, records, and re-checks a request. Used for every port call the publisher makes. */
function issue<T extends object>(request: T): T {
  const sealed = Object.freeze(request);
  mintedRequests.add(sealed);
  // The publisher's own copy of the wall: it can never call a port with an unminted request, even
  // if a future port implementation forgets to assert.
  assertReconciliationPublisher(sealed);
  return sealed;
}

// --- Injected ports ------------------------------------------------------------------------------

export interface ReconciliationSourceSnapshot {
  readonly sourceRevision: string;
  readonly storeRevision: string;
  /** The card's current bytes digest for a `card-transition`; `null` when there is no card. */
  readonly cardSha256: string | null;
  /**
   * The server-derived escalation card path; `null` when the server derives none. This is the ONE
   * authoritative source of an escalation's target: a Sweeper-supplied `cardPath` that disagrees
   * refuses the intent rather than publishing to either path.
   */
  readonly escalationCardPath: string | null;
  /**
   * The mirror watermark the durable tree currently carries, when the source can read it. A
   * byte-identical watermark makes a `schedule-mirror` intent a no-op receipt that opens no PR
   * (section 3.5); `undefined`/`null` means "unknown", and the effect runs.
   */
  readonly currentMirrorWatermark?: ScheduleMirrorWatermark | null;
}

export interface ReconciliationSourcePort {
  snapshot(intent: ReconciliationIntent): Promise<ReconciliationSourceSnapshot>;
}

export interface ReconciliationEffectResult {
  readonly revision: string;
  readonly receipt?: string;
  readonly detail?: string;
  /** The store revision AFTER the effect; omitted when the effect moved no store row. */
  readonly storeRevision?: string;
  /** `true` when the effect found the world already in the requested state and changed nothing. */
  readonly noop?: boolean;
}

/**
 * Every effect request carries only its operation identity and targets. There is no authorization
 * field: authorization IS membership of the request object in `mintedRequests`, which no payload
 * can express and no caller can copy.
 */
interface AuthorizedRequest {
  readonly idempotencyKey: string;
  readonly exactTargets: readonly string[];
}

export interface CardMutationRequest extends AuthorizedRequest {
  readonly cardId: string;
  readonly expectedCardSha256: string;
  readonly fromState: string;
  readonly toState: string;
  readonly section?: CardBlockSection;
  readonly block?: string;
}

export interface OpsOutboxRequest extends AuthorizedRequest {
  readonly intent: ReconciliationIntent;
}

export interface DurablePublishRequest extends AuthorizedRequest {
  readonly manifest: ScheduleMirrorIntent['manifest'];
}

export interface MirrorMergeRequest extends AuthorizedRequest {
  readonly batchId: string;
  readonly pr: { readonly owner: string; readonly repo: string; readonly number: number; readonly mergeCommit: string };
  readonly mergedAt: string;
}

export interface CardMutationPort {
  executeCardMutation(request: CardMutationRequest): Promise<ReconciliationEffectResult>;
}
export interface OpsOutboxPort {
  publishOpsOutbox(request: OpsOutboxRequest): Promise<ReconciliationEffectResult>;
}
export interface DurablePublisherPort {
  routeDurable(request: DurablePublishRequest): Promise<{ readonly revision: string; readonly receipt: RouteDurableReceipt }>;
}
export interface MirrorCompletionPort {
  completeMirrorMerge(request: MirrorMergeRequest): Promise<ReconciliationEffectResult>;
}

/** Resolves whether a `prepared` receipt's operation already landed, so a replay never repeats it. */
export interface PreparedReconcilerPort {
  findCompleted(idempotencyKey: string, requestSha256: string): Promise<ReconciliationResult | null>;
}

export interface ReconciliationClock {
  now(): string;
}

export interface ReconciliationPublisherPorts {
  readonly receipts: ReconciliationReceiptPort;
  readonly source: ReconciliationSourcePort;
  readonly cards: CardMutationPort;
  readonly outbox: OpsOutboxPort;
  readonly durable: DurablePublisherPort;
  readonly mirror: MirrorCompletionPort;
  readonly reconciler: PreparedReconcilerPort;
  readonly audit: ReconciliationAuditSink;
  readonly clock: ReconciliationClock;
}

export interface ReconciliationRequestContext {
  /** Only an authenticated Task action may claim the `human-operator` actor. */
  readonly authenticatedTaskAction: boolean;
}

// --- Port conformance (W6.2 runs this against each REAL port) -------------------------------------

export interface ReconciliationEffectPortSet {
  readonly cards?: CardMutationPort;
  readonly outbox?: OpsOutboxPort;
  readonly durable?: DurablePublisherPort;
  readonly mirror?: MirrorCompletionPort;
}

export interface PortConformanceSample {
  readonly intent: ReconciliationIntent;
  readonly manifest: ScheduleMirrorIntent['manifest'];
}

export interface PortConformanceResult {
  readonly port: 'cards' | 'outbox' | 'durable' | 'mirror';
  readonly refusedUnauthorized: boolean;
  readonly detail: string;
}

/**
 * Calls each supplied port with a structurally valid request the publisher never minted. A
 * conforming port refuses every one with `OpsBypassError` (403). W6.2 runs this per real port so a
 * port that omits `assertReconciliationPublisher` is a RED test rather than a silent hole.
 */
export async function portConformanceSuite(
  ports: ReconciliationEffectPortSet,
  sample: PortConformanceSample,
): Promise<readonly PortConformanceResult[]> {
  const idempotencyKey = sample.intent.idempotencyKey;
  const exactTargets = [...sample.intent.exactTargets];
  const probes: { readonly port: PortConformanceResult['port']; readonly run: () => Promise<unknown> }[] = [];
  const { cards, outbox, durable, mirror } = ports;
  if (cards !== undefined) {
    probes.push({
      port: 'cards',
      run: () => cards.executeCardMutation({
        idempotencyKey, exactTargets, cardId: 'queue/inbox/port-conformance.md',
        expectedCardSha256: '0'.repeat(64), fromState: 'inbox', toState: 'done',
      }),
    });
  }
  if (outbox !== undefined) {
    probes.push({ port: 'outbox', run: () => outbox.publishOpsOutbox({ idempotencyKey, exactTargets, intent: sample.intent }) });
  }
  if (durable !== undefined) {
    probes.push({ port: 'durable', run: () => durable.routeDurable({ idempotencyKey, exactTargets, manifest: sample.manifest }) });
  }
  if (mirror !== undefined) {
    probes.push({
      port: 'mirror',
      run: () => mirror.completeMirrorMerge({
        idempotencyKey, exactTargets, batchId: 'port-conformance',
        pr: { owner: 'kb', repo: 'kb', number: 1, mergeCommit: '0'.repeat(40) },
        mergedAt: '1970-01-01T00:00:00Z',
      }),
    });
  }
  const results: PortConformanceResult[] = [];
  for (const probe of probes) {
    try {
      await probe.run();
      results.push({
        port: probe.port, refusedUnauthorized: false,
        detail: 'the port accepted a request the publisher never minted',
      });
    } catch (error) {
      const refused = error instanceof OpsBypassError;
      results.push({
        port: probe.port,
        refusedUnauthorized: refused,
        detail: refused ? 'refused with OpsBypassError (403)' : `threw ${error instanceof Error ? error.name : 'a non-Error'} instead of OpsBypassError`,
      });
    }
  }
  return results;
}

// --- Publisher -----------------------------------------------------------------------------------

function sameTargets(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function mayClaimActor(actor: ReconciliationActor, context: ReconciliationRequestContext): boolean {
  return actor !== 'human-operator' || context.authenticatedTaskAction;
}

/**
 * A `schedule-mirror` submitter supplies the manifest, so recomputing `exactTargets` from that same
 * manifest proves nothing. The publisher pins the manifest to the kind before routing: the durable
 * purpose, the W0 operation-key formula, and the batch/watermark linkage. Kind confusion — e.g. a
 * `learning-implementation` manifest with arbitrary relpaths smuggled inside a `schedule-mirror`
 * intent — is refused here, before any port is touched.
 */
function scheduleMirrorManifestMismatch(intent: ScheduleMirrorIntent): string | null {
  if (intent.manifest.purpose !== 'schedule-mirror') {
    return `schedule-mirror intent carries a ${intent.manifest.purpose} manifest`;
  }
  const expectedOperationKey = scheduleMirrorOperationKey(intent.batchId);
  if (intent.manifest.operationKey !== expectedOperationKey) {
    return `schedule-mirror manifest operationKey must be ${expectedOperationKey}`;
  }
  if (intent.batchId !== scheduleMirrorBatchId(intent.targetWatermark)) {
    return 'schedule-mirror batchId must be the target-watermark hash';
  }
  return null;
}

/**
 * Applies one intent under CAS with a two-phase receipt:
 * refusals audit and stage nothing; a fresh intent prepares, applies its single effect, audits, and
 * CAS-advances to `published`; an exact published replay returns the original result; the same key
 * with a different canonical hash is 409; a `prepared` receipt is reconciled before completing.
 *
 * The intent is decoded here even though W6.2's route decodes it too: schema, closed actor set,
 * sorted/unique targets, digest shapes, and the key formula then hold even if a route forgets. A
 * value that fails to decode is refused as a `ContractDecodeError` before any port is touched; it
 * cannot be audited, because an audit record is built from closed intent fields it does not have.
 */
export async function publishReconciliationIntent(
  submitted: ReconciliationIntent,
  ports: ReconciliationPublisherPorts,
  context: ReconciliationRequestContext,
): Promise<ReconciliationResult> {
  const startedAt = ports.clock.now();
  const intent = decodeReconciliationIntent(submitted);
  const requestSha256 = reconciliationIntentSha256(intent);

  const refuse = async (error: Error, exactTargets: readonly string[]): Promise<never> => {
    const input: ReconciliationAuditInput = {
      intent,
      oldSourceRevision: intent.expectedSourceRevision,
      newSourceRevision: intent.expectedSourceRevision,
      oldStoreRevision: intent.expectedStoreRevision,
      newStoreRevision: intent.expectedStoreRevision,
      exactTargets,
      publisherReceipt: null,
      pr: null,
      startedAt,
      finishedAt: ports.clock.now(),
      outcome: 'refused',
    };
    await appendReconciliationAudit(ports.audit, input);
    throw error;
  };

  if (!mayClaimActor(intent.actor, context)) {
    return refuse(
      new OpsBypassError('only an authenticated Task action may claim human-operator'),
      intent.exactTargets,
    );
  }
  if (intent.idempotencyKey !== reconciliationIdempotencyKey(intent)) {
    return refuse(
      new ReconciliationConflictError(intent.idempotencyKey, 'idempotency key does not match its formula'),
      intent.exactTargets,
    );
  }
  if (intent.kind === 'schedule-mirror') {
    const mismatch = scheduleMirrorManifestMismatch(intent);
    if (mismatch !== null) {
      return refuse(new ReconciliationConflictError(intent.idempotencyKey, mismatch), intent.exactTargets);
    }
  }

  const existing = await ports.receipts.read(intent.idempotencyKey);
  const replay = classifyReplay(existing, requestSha256);
  if (replay === 'conflict') {
    return refuse(
      new ReconciliationConflictError(intent.idempotencyKey, 'same key with a different intent hash'),
      intent.exactTargets,
    );
  }
  if (replay === 'exact-replay') {
    return (existing as Extract<typeof existing, { phase: 'published' }>).result;
  }

  const preparedRow = replay === 'reconcile-prepared' ? (existing as PreparedReconciliationReceipt) : null;

  if (preparedRow !== null) {
    // A `prepared` receipt means a previous attempt may have LANDED its effect and crashed before
    // advancing the receipt — and in exactly that state the source revision (and, for a card, its
    // bytes) has already moved. Asking the freshness gates first would refuse that crash state as
    // stale and make this path unreachable in the only situation it exists for, so the reconciler
    // is consulted FIRST.
    const completed = await ports.reconciler.findCompleted(intent.idempotencyKey, requestSha256);
    if (completed !== null) {
      // Audited exactly once: the crash may also have happened AFTER the audit append, so reuse the
      // existing record for this key and outcome rather than appending a second one for one effect.
      const priorRef = await ports.audit.find(intent.idempotencyKey, completed.outcome);
      const auditRef = priorRef ?? await appendReconciliationAudit(ports.audit, {
        intent,
        oldSourceRevision: preparedRow.expectedSourceRevision,
        newSourceRevision: completed.revision,
        oldStoreRevision: preparedRow.expectedStoreRevision,
        newStoreRevision: preparedRow.expectedStoreRevision,
        exactTargets: preparedRow.exactTargets,
        publisherReceipt: null,
        pr: null,
        startedAt,
        finishedAt: ports.clock.now(),
        outcome: completed.outcome,
      });
      await ports.receipts.publish({ ...preparedRow, phase: 'published', result: completed, auditRef });
      return completed;
    }
  }

  // The effect did NOT land. Gate freshness on the STORED receipt's expectations when reconciling a
  // `prepared` row (the intent's own copy is only trustworthy because `requestSha256` matched, and
  // the receipt is the record of what was actually staged). `expectedCardSha256` has no stored
  // counterpart, but the canonical-hash match proves it is the same value that was prepared.
  const gateSourceRevision = preparedRow?.expectedSourceRevision ?? intent.expectedSourceRevision;
  const gateStoreRevision = preparedRow?.expectedStoreRevision ?? intent.expectedStoreRevision;

  const snapshot = await ports.source.snapshot(intent);
  if (snapshot.sourceRevision !== gateSourceRevision) {
    return refuse(
      new ReconciliationConflictError(intent.idempotencyKey, 'stale source revision'),
      intent.exactTargets,
    );
  }
  if (snapshot.storeRevision !== gateStoreRevision) {
    return refuse(
      new ReconciliationConflictError(intent.idempotencyKey, 'stale store revision'),
      intent.exactTargets,
    );
  }
  if (intent.kind === 'card-transition' && snapshot.cardSha256 !== intent.expectedCardSha256) {
    return refuse(
      new ReconciliationConflictError(intent.idempotencyKey, 'stale card bytes'),
      intent.exactTargets,
    );
  }

  const recomputed = reconciliationExactTargets(intent, snapshot.escalationCardPath ?? undefined);
  if (!sameTargets(recomputed, intent.exactTargets)) {
    return refuse(
      new ReconciliationConflictError(intent.idempotencyKey, 'exact targets disagree with the kind payload'),
      intent.exactTargets,
    );
  }

  const prepared: PreparedReconciliationReceipt = preparedRow ?? {
    idempotencyKey: intent.idempotencyKey,
    requestSha256,
    phase: 'prepared',
    expectedSourceRevision: intent.expectedSourceRevision,
    expectedStoreRevision: intent.expectedStoreRevision,
    exactTargets: [...recomputed],
  };

  if (preparedRow === null) {
    try {
      await ports.receipts.prepare(prepared);
    } catch {
      // A concurrent submission won the insert-if-absent CAS. Exactly one of the two racers may
      // apply the effect; the loser gets the same audited 409 a changed replay gets, never the
      // store's raw error.
      return refuse(
        new ReconciliationConflictError(intent.idempotencyKey, 'a concurrent publish already prepared this operation'),
        recomputed,
      );
    }
  }

  let effect: ReconciliationEffectResult;
  let outcome: ReconciliationResult['outcome'] = 'applied';
  let pr: { owner: string; repo: string; number: number } | null = null;

  try {
    switch (intent.kind) {
      case 'card-transition':
        effect = await ports.cards.executeCardMutation(issue({
          idempotencyKey: intent.idempotencyKey, exactTargets: recomputed,
          cardId: intent.cardId, expectedCardSha256: intent.expectedCardSha256,
          fromState: intent.fromState, toState: intent.toState,
          ...(intent.section === undefined ? {} : { section: intent.section }),
          ...(intent.block === undefined ? {} : { block: intent.block }),
        }));
        break;
      case 'escalation-card':
        effect = await ports.outbox.publishOpsOutbox(issue({
          idempotencyKey: intent.idempotencyKey, exactTargets: recomputed, intent,
        }));
        break;
      case 'schedule-mirror': {
        const current = snapshot.currentMirrorWatermark ?? null;
        if (current !== null && isWatermarkUnchanged(current, intent.targetWatermark)) {
          // Section 3.5: a byte-identical current watermark is a no-op receipt and opens no PR.
          effect = { revision: snapshot.sourceRevision, detail: 'mirror watermark already current' };
          outcome = 'no-op';
          break;
        }
        const durable = await ports.durable.routeDurable(issue({
          idempotencyKey: intent.idempotencyKey, exactTargets: recomputed,
          manifest: intent.manifest,
        }));
        if (durable.receipt.mode === 'pr') {
          pr = {
            owner: durable.receipt.pr.owner,
            repo: durable.receipt.pr.repo,
            number: durable.receipt.pr.number,
          };
        }
        effect = {
          revision: durable.revision,
          receipt: durable.receipt.mode === 'pr' ? durable.receipt.branch : durable.receipt.commit,
        };
        break;
      }
      case 'mirror-merged':
        effect = await ports.mirror.completeMirrorMerge(issue({
          idempotencyKey: intent.idempotencyKey, exactTargets: recomputed,
          batchId: intent.batchId, pr: intent.pr, mergedAt: intent.mergedAt,
        }));
        pr = { owner: intent.pr.owner, repo: intent.pr.repo, number: intent.pr.number };
        break;
    }
  } catch (error) {
    // The receipt stays `prepared` so the next attempt reconciles rather than repeats.
    await appendReconciliationAudit(ports.audit, {
      intent,
      oldSourceRevision: intent.expectedSourceRevision,
      newSourceRevision: intent.expectedSourceRevision,
      oldStoreRevision: intent.expectedStoreRevision,
      newStoreRevision: intent.expectedStoreRevision,
      exactTargets: recomputed,
      publisherReceipt: null,
      pr: null,
      startedAt,
      finishedAt: ports.clock.now(),
      outcome: 'failed',
    });
    throw error;
  }

  if (effect.noop === true) outcome = 'no-op';

  const result: ReconciliationResult = {
    outcome,
    revision: effect.revision,
    ...(effect.detail === undefined ? {} : { detail: effect.detail }),
  };

  const auditRef = await appendReconciliationAudit(ports.audit, {
    intent,
    oldSourceRevision: intent.expectedSourceRevision,
    newSourceRevision: effect.revision,
    oldStoreRevision: intent.expectedStoreRevision,
    // The store revision the EFFECT reported; a port that moved no store row reports none, and the
    // record then honestly shows no store delta.
    newStoreRevision: effect.storeRevision ?? snapshot.storeRevision,
    exactTargets: recomputed,
    publisherReceipt: effect.receipt ?? null,
    pr,
    startedAt,
    finishedAt: ports.clock.now(),
    outcome,
  });

  await ports.receipts.publish({ ...prepared, phase: 'published', result, auditRef });
  return result;
}

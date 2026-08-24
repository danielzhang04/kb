// P4 section 3.4 closed contracts: the reconciliation intent union, its idempotency-key formulas,
// the two-phase receipt port W4 injects (and W6.2 backs with `control/store.ts` [P4-C33]), and the
// audit record. Types, pure formulas, and strict decoders ONLY — W0 adds no publisher, no store, no
// card mutation, and no ops-outbox call. The Sweeper is read-only by construction: `SweeperPorts`
// rejects every effect member at compile time.
import {
  ContractDecodeError, closedObject, decodeDurablePathManifest, isCommitSha, isDigestSha256,
  requireString, sha256Hex,
} from '../write/durableManifest.ts';
import type { DurablePathManifest } from '../write/durableManifest.ts';
import { decodeScheduleMirrorWatermark } from '../schedules/mirrorContracts.ts';
import type { ScheduleMirrorWatermark } from '../schedules/mirrorContracts.ts';

export const RECONCILIATION_INTENT_SCHEMA = 'kb.reconciliation-intent/v1';

export type ReconciliationIntentKind = 'card-transition' | 'escalation-card' | 'schedule-mirror' | 'mirror-merged';
export const RECONCILIATION_INTENT_KINDS: readonly ReconciliationIntentKind[] = [
  'card-transition', 'escalation-card', 'schedule-mirror', 'mirror-merged',
];

/** Only an authenticated Task action may claim `human-operator`. */
export type ReconciliationActor = 'human-operator' | 'system-sweeper' | 'dashboard-supervisor';
export const RECONCILIATION_ACTORS: readonly ReconciliationActor[] = [
  'human-operator', 'system-sweeper', 'dashboard-supervisor',
];

export type CardBlockSection = 'Feedback' | 'Result';
export type EscalationSourceKind = 'run' | 'stop' | 'sweeper-failure';

export interface ReconciliationIntentBase {
  readonly schema: typeof RECONCILIATION_INTENT_SCHEMA;
  readonly kind: ReconciliationIntentKind;
  readonly actor: ReconciliationActor;
  readonly idempotencyKey: string;
  readonly expectedSourceRevision: string;
  readonly expectedStoreRevision: string;
  /** Sorted and unique; the publisher recomputes it from the kind payload and rejects a mismatch. */
  readonly exactTargets: readonly string[];
}

export interface CardTransitionIntent extends ReconciliationIntentBase {
  readonly kind: 'card-transition';
  readonly cardId: string;
  readonly expectedCardSha256: string;
  readonly fromState: string;
  readonly toState: string;
  readonly section?: CardBlockSection;
  readonly block?: string;
}

export interface EscalationCardIntent extends ReconciliationIntentBase {
  readonly kind: 'escalation-card';
  readonly source: { readonly kind: EscalationSourceKind; readonly ref: string; readonly createdAt: string };
  readonly title: string;
  readonly reason: string;
  readonly related: { readonly runRef?: string; readonly stopEvent?: string };
}

export interface ScheduleMirrorIntent extends ReconciliationIntentBase {
  readonly kind: 'schedule-mirror';
  readonly batchId: string;
  readonly targetWatermark: ScheduleMirrorWatermark;
  readonly manifest: DurablePathManifest;
}

export interface MirrorMergedIntent extends ReconciliationIntentBase {
  readonly kind: 'mirror-merged';
  readonly batchId: string;
  readonly pr: { readonly owner: string; readonly repo: string; readonly number: number; readonly mergeCommit: string };
  readonly mergedAt: string;
}

export type ReconciliationIntent =
  | CardTransitionIntent | EscalationCardIntent | ScheduleMirrorIntent | MirrorMergedIntent;

/** The four closed key formulas of section 3.4. */
export function reconciliationIdempotencyKey(intent: ReconciliationIntent): string {
  switch (intent.kind) {
    case 'card-transition':
      return [
        'card-transition', intent.actor, intent.cardId, intent.expectedCardSha256, intent.toState,
        sha256Hex(intent.block ?? ''),
      ].join(':');
    case 'escalation-card':
      return `escalation:${intent.source.kind}:${intent.source.ref}`;
    case 'schedule-mirror':
      return `schedule-mirror:${intent.batchId}`;
    case 'mirror-merged':
      return `mirror-merged:${intent.batchId}:${intent.pr.mergeCommit}`;
  }
}

/** The publisher recomputes `exactTargets` from the kind payload; a mismatch rejects. */
export function reconciliationExactTargets(
  intent: ReconciliationIntent,
  escalationCardPath?: string,
): readonly string[] {
  switch (intent.kind) {
    case 'card-transition':
      return [intent.cardId];
    case 'escalation-card':
      return escalationCardPath === undefined ? [] : [escalationCardPath];
    case 'schedule-mirror':
      return [...intent.manifest.relpaths].sort();
    case 'mirror-merged':
      return [];
  }
}

// --- Two-phase receipt (persisted by `control/store.ts`; W6.2 adds it [P4-C33]) ---------------

export type ReconciliationReceiptPhase = 'prepared' | 'published';

export interface PreparedReconciliationReceipt {
  readonly idempotencyKey: string;
  readonly requestSha256: string;
  readonly phase: 'prepared';
  readonly expectedSourceRevision: string;
  readonly expectedStoreRevision: string;
  readonly exactTargets: readonly string[];
}

export interface PublishedReconciliationReceipt extends Omit<PreparedReconciliationReceipt, 'phase'> {
  readonly phase: 'published';
  readonly result: ReconciliationResult;
  readonly auditRef: string;
}

export type ReconciliationReceipt = PreparedReconciliationReceipt | PublishedReconciliationReceipt;

export interface ReconciliationResult {
  readonly outcome: 'applied' | 'no-op';
  readonly revision: string;
  readonly detail?: string;
}

/**
 * The injected receipt port. W4 backs it with an in-memory fake; W6.2 substitutes the real store.
 * Both writes are CAS: `prepare` fails if a receipt already exists, `publish` fails unless the
 * stored receipt is exactly the `prepared` one it advances.
 */
export interface ReconciliationReceiptPort {
  read(idempotencyKey: string): Promise<ReconciliationReceipt | null>;
  prepare(receipt: PreparedReconciliationReceipt): Promise<PreparedReconciliationReceipt>;
  publish(receipt: PublishedReconciliationReceipt): Promise<PublishedReconciliationReceipt>;
}

export type ReplayOutcome = 'fresh' | 'exact-replay' | 'reconcile-prepared' | 'conflict';

/**
 * Exact published replay returns the original result; same key with a different hash is 409; a
 * `prepared` receipt is reconciled against the ops audit/remote branch before completing.
 */
export function classifyReplay(existing: ReconciliationReceipt | null, requestSha256: string): ReplayOutcome {
  if (existing === null) return 'fresh';
  if (existing.requestSha256 !== requestSha256) return 'conflict';
  return existing.phase === 'published' ? 'exact-replay' : 'reconcile-prepared';
}

export class ReconciliationConflictError extends Error {
  readonly status = 409;
  readonly idempotencyKey: string;
  constructor(idempotencyKey: string, detail: string) {
    super(`reconciliation conflict for ${idempotencyKey}: ${detail}`);
    this.name = 'ReconciliationConflictError';
    this.idempotencyKey = idempotencyKey;
  }
}

// --- Audit ------------------------------------------------------------------------------------

export interface ReconciliationAuditRecord {
  readonly actor: ReconciliationActor;
  readonly intentKind: ReconciliationIntentKind;
  readonly idempotencyKey: string;
  readonly intentSha256: string;
  readonly oldSourceRevision: string;
  readonly newSourceRevision: string;
  readonly oldStoreRevision: string;
  readonly newStoreRevision: string;
  readonly exactTargets: readonly string[];
  readonly publisherReceipt: string | null;
  readonly pr: { readonly owner: string; readonly repo: string; readonly number: number } | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: 'applied' | 'no-op' | 'refused' | 'failed';
}

// --- Read-only Sweeper wall ---------------------------------------------------------------------

/** The effect members a read-only Sweeper may never hold; mirrored by section 9 probe 5. */
export type ForbiddenSweeperEffect =
  | 'writeFile' | 'appendFile' | 'routeDurable' | 'executeCardMutation' | 'publishOpsOutbox'
  | 'spawn' | 'exec' | 'commit' | 'push' | 'transition';

/** `SweeperPorts<T>` is `never` when `T` carries any effect member, so a direct effect cannot compile. */
export type SweeperPorts<T> = Extract<keyof T, ForbiddenSweeperEffect> extends never ? T : never;

/** The Sweeper emits at most 20 intents per fire and applies none of them. */
export const MAX_SWEEPER_INTENTS = 20;

// --- Canonical hashing + decoders -----------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) target[key] = canonicalize(source[key]);
    }
    return target;
  }
  return value;
}

/** Canonical hash of the complete intent; the publisher stores it as `requestSha256`. */
export function reconciliationIntentSha256(intent: ReconciliationIntent): string {
  return sha256Hex(JSON.stringify(canonicalize(intent)));
}

const BASE_KEYS = [
  'schema', 'kind', 'actor', 'idempotencyKey', 'expectedSourceRevision', 'expectedStoreRevision',
  'exactTargets',
] as const;
const CARD_KEYS = [...BASE_KEYS, 'cardId', 'expectedCardSha256', 'fromState', 'toState', 'section', 'block'] as const;
const ESCALATION_KEYS = [...BASE_KEYS, 'source', 'title', 'reason', 'related'] as const;
const MIRROR_KEYS = [...BASE_KEYS, 'batchId', 'targetWatermark', 'manifest'] as const;
const MERGED_KEYS = [...BASE_KEYS, 'batchId', 'pr', 'mergedAt'] as const;

function decodeBase(record: Record<string, unknown>): Omit<ReconciliationIntentBase, 'kind'> {
  if (record['schema'] !== RECONCILIATION_INTENT_SCHEMA) {
    throw new ContractDecodeError('intent.schema', `expected ${RECONCILIATION_INTENT_SCHEMA}`);
  }
  const actor = record['actor'];
  if (typeof actor !== 'string' || !RECONCILIATION_ACTORS.includes(actor as ReconciliationActor)) {
    throw new ContractDecodeError('intent.actor', 'closed actor required');
  }
  const exactTargets = record['exactTargets'];
  if (!Array.isArray(exactTargets) || !exactTargets.every((entry): entry is string => typeof entry === 'string')) {
    throw new ContractDecodeError('intent.exactTargets', 'string array required');
  }
  for (let index = 1; index < exactTargets.length; index += 1) {
    if (exactTargets[index - 1]! >= exactTargets[index]!) {
      throw new ContractDecodeError('intent.exactTargets', 'sorted unique targets required');
    }
  }
  return {
    schema: RECONCILIATION_INTENT_SCHEMA,
    actor: actor as ReconciliationActor,
    idempotencyKey: requireString(record, 'idempotencyKey', 'intent'),
    expectedSourceRevision: requireString(record, 'expectedSourceRevision', 'intent'),
    expectedStoreRevision: requireString(record, 'expectedStoreRevision', 'intent'),
    exactTargets,
  };
}

function assertKeyMatchesFormula(intent: ReconciliationIntent): ReconciliationIntent {
  const expected = reconciliationIdempotencyKey(intent);
  if (intent.idempotencyKey !== expected) {
    throw new ContractDecodeError('intent.idempotencyKey', `expected ${expected}`);
  }
  return intent;
}

export function decodeReconciliationIntent(value: unknown): ReconciliationIntent {
  if (value === null || typeof value !== 'object') throw new ContractDecodeError('intent', 'object required');
  const kind = (value as Record<string, unknown>)['kind'];
  if (kind === 'card-transition') {
    const record = closedObject(value, CARD_KEYS, 'intent');
    const section = record['section'];
    if (section !== undefined && section !== 'Feedback' && section !== 'Result') {
      throw new ContractDecodeError('intent.section', "'Feedback' | 'Result'");
    }
    const block = record['block'];
    if (block !== undefined && typeof block !== 'string') throw new ContractDecodeError('intent.block', 'string required');
    const expectedCardSha256 = record['expectedCardSha256'];
    if (!isDigestSha256(expectedCardSha256)) throw new ContractDecodeError('intent.expectedCardSha256', 'sha256 hex required');
    return assertKeyMatchesFormula({
      ...decodeBase(record), kind: 'card-transition',
      cardId: requireString(record, 'cardId', 'intent'),
      expectedCardSha256,
      fromState: requireString(record, 'fromState', 'intent'),
      toState: requireString(record, 'toState', 'intent'),
      ...(section === undefined ? {} : { section }),
      ...(block === undefined ? {} : { block }),
    });
  }
  if (kind === 'escalation-card') {
    const record = closedObject(value, ESCALATION_KEYS, 'intent');
    const sourceRecord = closedObject(record['source'], ['kind', 'ref', 'createdAt'], 'intent.source');
    const sourceKind = sourceRecord['kind'];
    if (sourceKind !== 'run' && sourceKind !== 'stop' && sourceKind !== 'sweeper-failure') {
      throw new ContractDecodeError('intent.source.kind', "'run' | 'stop' | 'sweeper-failure'");
    }
    const relatedRecord = closedObject(record['related'], ['runRef', 'stopEvent'], 'intent.related');
    const related: { runRef?: string; stopEvent?: string } = {};
    if (relatedRecord['runRef'] !== undefined) related.runRef = requireString(relatedRecord, 'runRef', 'intent.related');
    if (relatedRecord['stopEvent'] !== undefined) related.stopEvent = requireString(relatedRecord, 'stopEvent', 'intent.related');
    return assertKeyMatchesFormula({
      ...decodeBase(record), kind: 'escalation-card',
      source: {
        kind: sourceKind,
        ref: requireString(sourceRecord, 'ref', 'intent.source'),
        createdAt: requireString(sourceRecord, 'createdAt', 'intent.source'),
      },
      title: requireString(record, 'title', 'intent'),
      reason: requireString(record, 'reason', 'intent'),
      related,
    });
  }
  if (kind === 'schedule-mirror') {
    const record = closedObject(value, MIRROR_KEYS, 'intent');
    return assertKeyMatchesFormula({
      ...decodeBase(record), kind: 'schedule-mirror',
      batchId: requireString(record, 'batchId', 'intent'),
      targetWatermark: decodeScheduleMirrorWatermark(record['targetWatermark']),
      manifest: decodeDurablePathManifest(record['manifest']),
    });
  }
  if (kind === 'mirror-merged') {
    const record = closedObject(value, MERGED_KEYS, 'intent');
    const prRecord = closedObject(record['pr'], ['owner', 'repo', 'number', 'mergeCommit'], 'intent.pr');
    const number = prRecord['number'];
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
      throw new ContractDecodeError('intent.pr.number', 'positive integer required');
    }
    const mergeCommit = prRecord['mergeCommit'];
    if (!isCommitSha(mergeCommit)) throw new ContractDecodeError('intent.pr.mergeCommit', '40 lowercase hex required');
    return assertKeyMatchesFormula({
      ...decodeBase(record), kind: 'mirror-merged',
      batchId: requireString(record, 'batchId', 'intent'),
      pr: {
        owner: requireString(prRecord, 'owner', 'intent.pr'),
        repo: requireString(prRecord, 'repo', 'intent.pr'),
        number, mergeCommit,
      },
      mergedAt: requireString(record, 'mergedAt', 'intent'),
    });
  }
  throw new ContractDecodeError('intent.kind', 'closed intent kind required');
}

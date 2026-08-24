import { describe, expect, it } from 'vitest';
import {
  ReconciliationConflictError, reconciliationIdempotencyKey, reconciliationIntentSha256,
} from './contracts.ts';
import type {
  CardTransitionIntent, EscalationCardIntent, MirrorMergedIntent, ReconciliationAuditRecord,
  ReconciliationIntent, ReconciliationReceipt, ReconciliationReceiptPort, ScheduleMirrorIntent,
} from './contracts.ts';
import { ContractDecodeError, scheduleMirrorOperationKey } from '../write/durableManifest.ts';
import { scheduleMirrorBatchId } from '../schedules/mirrorContracts.ts';
import type { ReconciliationAuditSink } from './audit.ts';
import {
  OpsBypassError, assertReconciliationPublisher, portConformanceSuite, publishReconciliationIntent,
} from './publisher.ts';
import type {
  CardMutationRequest, ReconciliationPublisherPorts, ReconciliationSourceSnapshot,
} from './publisher.ts';

const CARD_SHA = 'a'.repeat(64);
const MIRROR_WATERMARK = { revision: 7, digest: 'd'.repeat(64) } as const;
const MIRROR_BATCH_ID = scheduleMirrorBatchId(MIRROR_WATERMARK);

function seal<T extends ReconciliationIntent>(draft: T): T {
  return { ...draft, idempotencyKey: reconciliationIdempotencyKey(draft) };
}

function cardIntent(overrides: Partial<CardTransitionIntent> = {}): CardTransitionIntent {
  return seal({
    schema: 'kb.reconciliation-intent/v1', kind: 'card-transition', actor: 'system-sweeper',
    idempotencyKey: '', expectedSourceRevision: 'src-1', expectedStoreRevision: 'store-1',
    exactTargets: ['queue/inbox/card-1.md'], cardId: 'queue/inbox/card-1.md',
    expectedCardSha256: CARD_SHA, fromState: 'inbox', toState: 'done',
    ...overrides,
  } as CardTransitionIntent);
}

function escalationIntent(): EscalationCardIntent {
  return seal({
    schema: 'kb.reconciliation-intent/v1', kind: 'escalation-card', actor: 'dashboard-supervisor',
    idempotencyKey: '', expectedSourceRevision: 'src-1', expectedStoreRevision: 'store-1',
    exactTargets: ['queue/inbox/run-9.md'],
    source: { kind: 'run', ref: 'run-9', createdAt: '2026-08-22T23:00:00Z' },
    title: 'Run failed', reason: 'terminal failure', related: { runRef: 'run-9' },
  } as EscalationCardIntent);
}

function mirrorIntent(overrides: Partial<ScheduleMirrorIntent> = {}): ScheduleMirrorIntent {
  return seal({
    schema: 'kb.reconciliation-intent/v1', kind: 'schedule-mirror', actor: 'system-sweeper',
    idempotencyKey: '', expectedSourceRevision: 'src-1', expectedStoreRevision: 'store-1',
    exactTargets: ['HEARTBEAT.md'], batchId: MIRROR_BATCH_ID,
    targetWatermark: { ...MIRROR_WATERMARK },
    manifest: {
      schema: 'kb.durable-path-manifest/v1', operationKey: scheduleMirrorOperationKey(MIRROR_BATCH_ID),
      purpose: 'schedule-mirror', baseCommit: 'b'.repeat(40), relpaths: ['HEARTBEAT.md'],
    },
    ...overrides,
  } as ScheduleMirrorIntent);
}

function mergedIntent(): MirrorMergedIntent {
  return seal({
    schema: 'kb.reconciliation-intent/v1', kind: 'mirror-merged', actor: 'system-sweeper',
    idempotencyKey: '', expectedSourceRevision: 'src-1', expectedStoreRevision: 'store-1',
    exactTargets: [], batchId: 'batch-0',
    pr: { owner: 'kb', repo: 'kb', number: 12, mergeCommit: 'c'.repeat(40) },
    mergedAt: '2026-08-22T22:00:00Z',
  } as MirrorMergedIntent);
}

class FakeReceipts implements ReconciliationReceiptPort {
  readonly rows = new Map<string, ReconciliationReceipt>();
  prepares = 0;
  publishes = 0;
  async read(key: string) { return this.rows.get(key) ?? null; }
  async prepare(receipt: Extract<ReconciliationReceipt, { phase: 'prepared' }>) {
    if (this.rows.has(receipt.idempotencyKey)) throw new Error('receipt already exists');
    this.rows.set(receipt.idempotencyKey, receipt);
    this.prepares += 1;
    return receipt;
  }
  async publish(receipt: Extract<ReconciliationReceipt, { phase: 'published' }>) {
    const existing = this.rows.get(receipt.idempotencyKey);
    if (!existing || existing.phase !== 'prepared' || existing.requestSha256 !== receipt.requestSha256) {
      throw new Error('receipt CAS failed');
    }
    this.rows.set(receipt.idempotencyKey, receipt);
    this.publishes += 1;
    return receipt;
  }
}

interface Harness {
  ports: ReconciliationPublisherPorts;
  readonly receipts: FakeReceipts;
  readonly audits: ReconciliationAuditRecord[];
  readonly calls: string[];
  readonly seenRequests: unknown[];
  failEffect: boolean;
  completedReplay: { outcome: 'applied'; revision: string } | null;
  priorAuditRef: string | null;
  auditLookups: string[];
}

function harness(snapshot: Partial<ReconciliationSourceSnapshot> = {}): Harness {
  const receipts = new FakeReceipts();
  const audits: ReconciliationAuditRecord[] = [];
  const calls: string[] = [];
  const seenRequests: unknown[] = [];
  const state: Harness = {
    receipts, audits, calls, seenRequests, failEffect: false, completedReplay: null,
    priorAuditRef: null, auditLookups: [],
    ports: undefined as unknown as ReconciliationPublisherPorts,
  };
  // Every effect port refuses a request the publisher did not mint, then applies its one effect.
  const effect = async (label: string, request: unknown) => {
    assertReconciliationPublisher(request);
    seenRequests.push(request);
    calls.push(label);
    if (state.failEffect) throw new Error(`${label} failed`);
    return { revision: 'src-2', receipt: 'receipt-1', storeRevision: 'store-2' };
  };
  const sink: ReconciliationAuditSink = {
    async append(record) { audits.push(record); return `audit-${audits.length}`; },
    async find(key, outcome) { state.auditLookups.push(`${key}/${outcome}`); return state.priorAuditRef; },
  };
  state.ports = {
    receipts,
    source: {
      async snapshot() {
        return {
          sourceRevision: 'src-1', storeRevision: 'store-1', cardSha256: CARD_SHA,
          escalationCardPath: 'queue/inbox/run-9.md', ...snapshot,
        };
      },
    },
    cards: {
      executeCardMutation: (request) => effect('card', request),
    },
    outbox: {
      publishOpsOutbox: (request) => effect('outbox', request),
    },
    durable: {
      async routeDurable(request) {
        assertReconciliationPublisher(request);
        seenRequests.push(request);
        calls.push('durable');
        if (state.failEffect) throw new Error('durable failed');
        return {
          revision: 'src-2',
          receipt: { mode: 'pr', branch: 'dv3-p4/schedule-mirror-1', pr: { owner: 'kb', repo: 'kb', number: 12, url: 'https://example.invalid/pr/12' } },
        };
      },
    },
    mirror: {
      completeMirrorMerge: (request) => effect('mirror', request),
    },
    reconciler: {
      async findCompleted() {
        calls.push('reconcile-lookup');
        return state.completedReplay;
      },
    },
    audit: sink,
    clock: { now: () => '2026-08-23T00:00:00Z' },
  };
  return state;
}

async function seedPrepared(state: Harness, intent: ReconciliationIntent): Promise<void> {
  await state.receipts.prepare({
    idempotencyKey: intent.idempotencyKey,
    requestSha256: reconciliationIntentSha256(intent),
    phase: 'prepared',
    expectedSourceRevision: intent.expectedSourceRevision,
    expectedStoreRevision: intent.expectedStoreRevision,
    exactTargets: [...intent.exactTargets],
  });
}

describe('publishReconciliationIntent', () => {
  it('prepares, applies, audits, and advances the receipt for a fresh card transition', async () => {
    const state = harness();
    const result = await publishReconciliationIntent(cardIntent(), state.ports, { authenticatedTaskAction: false });
    expect(result.outcome).toBe('applied');
    expect(state.calls).toEqual(['card']);
    expect(state.receipts.prepares).toBe(1);
    expect(state.receipts.publishes).toBe(1);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]!.outcome).toBe('applied');
    expect(state.audits[0]!.exactTargets).toEqual(['queue/inbox/card-1.md']);
    // The store delta is the one the EFFECT reported, not a copy of the pre-effect revision.
    expect(state.audits[0]!.oldStoreRevision).toBe('store-1');
    expect(state.audits[0]!.newStoreRevision).toBe('store-2');
    const stored = state.receipts.rows.get(cardIntent().idempotencyKey)!;
    expect(stored.phase).toBe('published');
  });

  it('records no store delta when the effect reports none', async () => {
    const state = harness();
    await publishReconciliationIntent(mirrorIntent(), state.ports, { authenticatedTaskAction: false });
    expect(state.audits[0]!.newStoreRevision).toBe('store-1');
    expect(state.audits[0]!.oldStoreRevision).toBe('store-1');
  });

  it('routes each of the four intent kinds to its own effect port', async () => {
    for (const [intent, label] of [
      [cardIntent(), 'card'], [escalationIntent(), 'outbox'],
      [mirrorIntent(), 'durable'], [mergedIntent(), 'mirror'],
    ] as const) {
      const state = harness();
      await publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false });
      expect(state.calls).toEqual([label]);
    }
  });

  it('refuses a stale source revision with 409 and stages nothing', async () => {
    const state = harness({ sourceRevision: 'src-9' });
    await expect(publishReconciliationIntent(cardIntent(), state.ports, { authenticatedTaskAction: false }))
      .rejects.toBeInstanceOf(ReconciliationConflictError);
    expect(state.calls).toEqual([]);
    expect(state.receipts.prepares).toBe(0);
    expect(state.audits[0]!.outcome).toBe('refused');
  });

  it('refuses a stale store revision with 409 and stages nothing', async () => {
    const state = harness({ storeRevision: 'store-9' });
    await expect(publishReconciliationIntent(cardIntent(), state.ports, { authenticatedTaskAction: false }))
      .rejects.toMatchObject({ status: 409 });
    expect(state.calls).toEqual([]);
    expect(state.receipts.prepares).toBe(0);
  });

  it('refuses a stale card and leaves the card bytes untouched', async () => {
    const state = harness({ cardSha256: 'f'.repeat(64) });
    await expect(publishReconciliationIntent(cardIntent(), state.ports, { authenticatedTaskAction: false }))
      .rejects.toMatchObject({ status: 409 });
    expect(state.calls).toEqual([]);
    expect(state.receipts.prepares).toBe(0);
  });

  it('returns the original result on an exact replay without repeating the effect', async () => {
    const state = harness();
    const first = await publishReconciliationIntent(cardIntent(), state.ports, { authenticatedTaskAction: false });
    const second = await publishReconciliationIntent(cardIntent(), state.ports, { authenticatedTaskAction: false });
    expect(second).toEqual(first);
    expect(state.calls).toEqual(['card']);
    expect(state.receipts.prepares).toBe(1);
    expect(state.receipts.publishes).toBe(1);
  });

  it('refuses a changed replay under the same key with 409', async () => {
    const state = harness();
    await publishReconciliationIntent(cardIntent(), state.ports, { authenticatedTaskAction: false });
    const changed = { ...cardIntent(), fromState: 'blocked' } as CardTransitionIntent;
    expect(changed.idempotencyKey).toBe(cardIntent().idempotencyKey);
    await expect(publishReconciliationIntent(changed, state.ports, { authenticatedTaskAction: false }))
      .rejects.toBeInstanceOf(ReconciliationConflictError);
    expect(state.calls).toEqual(['card']);
  });

  it('reconciles a prepared receipt in the REAL crash state: the effect landed and the source moved', async () => {
    // The state `findCompleted` exists for. The mutation landed and the process died before the
    // receipt advanced, so the card's bytes and the source revision have already moved on. If the
    // freshness gates ran first this would be refused as stale and the effect would be repeated.
    const state = harness({ sourceRevision: 'src-2', cardSha256: 'f'.repeat(64) });
    const intent = cardIntent();
    await seedPrepared(state, intent);
    state.completedReplay = { outcome: 'applied', revision: 'src-2' };
    const result = await publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false });
    expect(result).toEqual({ outcome: 'applied', revision: 'src-2' });
    expect(state.calls).toEqual(['reconcile-lookup']);
    expect(state.receipts.publishes).toBe(1);
    expect(state.receipts.rows.get(intent.idempotencyKey)!.phase).toBe('published');
    expect(state.audits).toHaveLength(1);
  });

  it('audits a reconciled effect exactly once when the crash followed the audit append', async () => {
    const state = harness({ sourceRevision: 'src-2', cardSha256: 'f'.repeat(64) });
    const intent = cardIntent();
    await seedPrepared(state, intent);
    state.completedReplay = { outcome: 'applied', revision: 'src-2' };
    state.priorAuditRef = 'audit-prior';
    await publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false });
    expect(state.auditLookups).toEqual([`${intent.idempotencyKey}/applied`]);
    expect(state.audits).toHaveLength(0);
    const stored = state.receipts.rows.get(intent.idempotencyKey)!;
    expect(stored.phase === 'published' && stored.auditRef).toBe('audit-prior');
  });

  it('re-runs the effect when a prepared receipt never landed its effect', async () => {
    const state = harness();
    const intent = cardIntent();
    await seedPrepared(state, intent);
    state.completedReplay = null;
    const result = await publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false });
    expect(result.outcome).toBe('applied');
    expect(state.calls).toEqual(['reconcile-lookup', 'card']);
    expect(state.receipts.prepares).toBe(1); // the seeded row; no second prepare
    expect(state.receipts.publishes).toBe(1);
  });

  it('refuses when the recomputed exact targets disagree with the intent', async () => {
    const state = harness();
    const intent = { ...cardIntent(), exactTargets: ['queue/inbox/other.md'] } as CardTransitionIntent;
    await expect(publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false }))
      .rejects.toMatchObject({ status: 409 });
    expect(state.calls).toEqual([]);
    expect(state.receipts.prepares).toBe(0);
    expect(state.audits[0]!.outcome).toBe('refused');
  });

  it('refuses an escalation whose target disagrees with the server-derived card path', async () => {
    const state = harness({ escalationCardPath: 'queue/inbox/elsewhere.md' });
    await expect(publishReconciliationIntent(escalationIntent(), state.ports, { authenticatedTaskAction: false }))
      .rejects.toMatchObject({ status: 409 });
    expect(state.calls).toEqual([]);
  });

  it('refuses a schedule-mirror intent that smuggles another durable purpose (kind confusion)', async () => {
    const state = harness();
    // A manifest that is perfectly valid on its own — `learning-implementation` with a learning
    // record path — carried inside a `schedule-mirror` intent whose targets agree with it. Without
    // the publisher's purpose pin, both sides of the "server recomputes the targets" check derive
    // from this same submitter-supplied manifest, and it routes to the durable publisher unchanged.
    const smuggled = ['docs/proposals/learnings/2026-08-24-smuggled.md'];
    const intent = mirrorIntent({
      exactTargets: smuggled,
      manifest: {
        schema: 'kb.durable-path-manifest/v1',
        operationKey: scheduleMirrorOperationKey(MIRROR_BATCH_ID),
        purpose: 'learning-implementation',
        baseCommit: 'b'.repeat(40),
        relpaths: smuggled,
      },
    } as Partial<ScheduleMirrorIntent>);
    await expect(publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false }))
      .rejects.toMatchObject({ status: 409 });
    expect(state.calls).toEqual([]);
    expect(state.receipts.prepares).toBe(0);
    expect(state.audits[0]!.outcome).toBe('refused');
  });

  it('refuses a schedule-mirror manifest whose operation key is not the W0 formula', async () => {
    const state = harness();
    const intent = mirrorIntent({
      manifest: {
        schema: 'kb.durable-path-manifest/v1', operationKey: 'schedule-mirror:someone-elses-batch',
        purpose: 'schedule-mirror', baseCommit: 'b'.repeat(40), relpaths: ['HEARTBEAT.md'],
      },
    } as Partial<ScheduleMirrorIntent>);
    await expect(publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false }))
      .rejects.toMatchObject({ status: 409 });
    expect(state.calls).toEqual([]);
  });

  it('refuses a schedule-mirror batch that is not the hash of its target watermark', async () => {
    const state = harness();
    const forgedBatch = 'e'.repeat(64);
    const intent = mirrorIntent({
      batchId: forgedBatch,
      manifest: {
        schema: 'kb.durable-path-manifest/v1', operationKey: scheduleMirrorOperationKey(forgedBatch),
        purpose: 'schedule-mirror', baseCommit: 'b'.repeat(40), relpaths: ['HEARTBEAT.md'],
      },
    } as Partial<ScheduleMirrorIntent>);
    await expect(publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false }))
      .rejects.toMatchObject({ status: 409 });
    expect(state.calls).toEqual([]);
  });

  it('records a no-op receipt and opens no PR when the mirror watermark is byte-identical', async () => {
    const state = harness({ currentMirrorWatermark: { ...MIRROR_WATERMARK } });
    const result = await publishReconciliationIntent(mirrorIntent(), state.ports, { authenticatedTaskAction: false });
    expect(result.outcome).toBe('no-op');
    expect(state.calls).toEqual([]);
    expect(state.audits[0]!.outcome).toBe('no-op');
    expect(state.receipts.publishes).toBe(1);
  });

  it('lets exactly one of two concurrent duplicate submissions apply the effect', async () => {
    const state = harness();
    const intent = cardIntent();
    const settled = await Promise.all([
      publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false })
        .then((result) => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error })),
      publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false })
        .then((result) => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error })),
    ]);
    const winners = settled.filter((entry) => entry.ok);
    const losers = settled.filter((entry) => !entry.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ error: { status: 409 } });
    expect((losers[0] as { error: unknown }).error).toBeInstanceOf(ReconciliationConflictError);
    expect(state.calls).toEqual(['card']);
    expect(state.receipts.prepares).toBe(1);
    expect(state.receipts.publishes).toBe(1);
    // Both submissions are on the trail: one applied, one refused.
    expect(state.audits.map((record) => record.outcome).sort()).toEqual(['applied', 'refused']);
  });

  it('refuses a direct ops publication forged outside the publisher', () => {
    expect(() => assertReconciliationPublisher({ idempotencyKey: 'k' })).toThrow(OpsBypassError);
    expect(() => assertReconciliationPublisher(undefined)).toThrow(OpsBypassError);
    let thrown: unknown;
    try { assertReconciliationPublisher(null); } catch (error) { thrown = error; }
    expect(thrown).toMatchObject({ status: 403 });
  });

  it('leaks nothing extractable from a real request and refuses a mutated copy of one', async () => {
    const state = harness();
    await publishReconciliationIntent(cardIntent(), state.ports, { authenticatedTaskAction: false });
    const captured = state.seenRequests[0] as CardMutationRequest;
    expect(() => { assertReconciliationPublisher(captured); }).not.toThrow();
    // No grant symbol or property to lift off a request that reached a port.
    expect(Object.getOwnPropertySymbols(captured)).toEqual([]);
    expect(Object.keys(captured).sort()).toEqual([
      'cardId', 'exactTargets', 'expectedCardSha256', 'fromState', 'idempotencyKey', 'toState',
    ]);
    // A structural copy — even one that keeps the idempotency key — is a different object.
    expect(() => { assertReconciliationPublisher({ ...captured }); }).toThrow(OpsBypassError);
    expect(() => { assertReconciliationPublisher({ ...captured, toState: 'blocked' }); }).toThrow(OpsBypassError);
    // And a minted request cannot be mutated in place.
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it('proves a real port refuses an unminted request (the suite W6.2 runs per port)', async () => {
    const conforming = {
      async executeCardMutation(request: CardMutationRequest) {
        assertReconciliationPublisher(request);
        return { revision: 'src-2' };
      },
    };
    const forgetful = { async executeCardMutation() { return { revision: 'src-2' }; } };
    const sample = { intent: cardIntent(), manifest: mirrorIntent().manifest };
    expect(await portConformanceSuite({ cards: conforming }, sample))
      .toEqual([{ port: 'cards', refusedUnauthorized: true, detail: 'refused with OpsBypassError (403)' }]);
    const sloppy = await portConformanceSuite({ cards: forgetful }, sample);
    expect(sloppy[0]!.refusedUnauthorized).toBe(false);
  });

  // The publisher gates ONE privilege: the `human-operator` actor. Any other actor is accepted from
  // any caller that reaches this function — W6.2's route is the authentication boundary.
  it('refuses an unauthenticated human-operator claim', async () => {
    const state = harness();
    const intent = cardIntent({ actor: 'human-operator' });
    await expect(publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false }))
      .rejects.toMatchObject({ status: 403 });
    expect(state.calls).toEqual([]);
    expect(state.receipts.prepares).toBe(0);
    expect(state.audits[0]!.outcome).toBe('refused');
  });

  it('accepts a human-operator claim from an authenticated Task action', async () => {
    const state = harness();
    const result = await publishReconciliationIntent(
      cardIntent({ actor: 'human-operator' }), state.ports, { authenticatedTaskAction: true },
    );
    expect(result.outcome).toBe('applied');
    expect(state.calls).toEqual(['card']);
  });

  it('audits a failed effect and leaves the receipt prepared', async () => {
    const state = harness();
    state.failEffect = true;
    const intent = cardIntent();
    await expect(publishReconciliationIntent(intent, state.ports, { authenticatedTaskAction: false }))
      .rejects.toThrow('card failed');
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]!.outcome).toBe('failed');
    expect(state.receipts.publishes).toBe(0);
    expect(state.receipts.rows.get(intent.idempotencyKey)!.phase).toBe('prepared');
  });

  it('decodes the intent itself, so a route that forgot to decode reaches no effect', async () => {
    const state = harness();
    const forgedKey = { ...cardIntent(), idempotencyKey: 'card-transition:forged' } as CardTransitionIntent;
    await expect(publishReconciliationIntent(forgedKey, state.ports, { authenticatedTaskAction: false }))
      .rejects.toBeInstanceOf(ContractDecodeError);
    const unsortedTargets = seal({
      ...cardIntent(), exactTargets: ['queue/inbox/b.md', 'queue/inbox/a.md'],
    } as CardTransitionIntent);
    await expect(publishReconciliationIntent(unsortedTargets, state.ports, { authenticatedTaskAction: false }))
      .rejects.toBeInstanceOf(ContractDecodeError);
    const openActor = seal({ ...cardIntent(), actor: 'root' } as unknown as CardTransitionIntent);
    await expect(publishReconciliationIntent(openActor, state.ports, { authenticatedTaskAction: false }))
      .rejects.toBeInstanceOf(ContractDecodeError);
    expect(state.calls).toEqual([]);
    expect(state.receipts.prepares).toBe(0);
  });
});

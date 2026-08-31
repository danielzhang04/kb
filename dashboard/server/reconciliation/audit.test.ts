import { describe, expect, it } from 'vitest';
import { reconciliationIdempotencyKey, reconciliationIntentSha256 } from './contracts.ts';
import type { CardTransitionIntent, ReconciliationAuditRecord } from './contracts.ts';
import {
  AuditSecretError, appendReconciliationAudit, buildReconciliationAuditRecord,
} from './audit.ts';
import type { ReconciliationAuditSink } from './audit.ts';

const CARD_SHA = 'a'.repeat(64);

function cardIntent(overrides: Partial<CardTransitionIntent> = {}): CardTransitionIntent {
  const draft = {
    schema: 'kb.reconciliation-intent/v1',
    kind: 'card-transition',
    actor: 'human-operator',
    idempotencyKey: '',
    expectedSourceRevision: 'src-1',
    expectedStoreRevision: 'store-1',
    exactTargets: ['queue/inbox/card-1.md'],
    cardId: 'queue/inbox/card-1.md',
    expectedCardSha256: CARD_SHA,
    fromState: 'inbox',
    toState: 'done',
    section: 'Result',
    block: 'operator note with private detail',
    ...overrides,
  } as CardTransitionIntent;
  return { ...draft, idempotencyKey: reconciliationIdempotencyKey(draft) };
}

const AUDIT_INPUT = {
  oldSourceRevision: 'src-1',
  newSourceRevision: 'src-2',
  oldStoreRevision: 'store-1',
  newStoreRevision: 'store-2',
  exactTargets: ['queue/inbox/card-1.md'],
  publisherReceipt: 'receipt-1',
  pr: null,
  startedAt: '2026-08-23T00:00:00Z',
  finishedAt: '2026-08-23T00:00:01Z',
} as const;

describe('reconciliation audit record', () => {
  it('carries exactly the closed audit field set derived from the intent', () => {
    const intent = cardIntent();
    const record = buildReconciliationAuditRecord({ ...AUDIT_INPUT, intent, outcome: 'applied' });
    expect(Object.keys(record).sort()).toEqual([
      'actor', 'exactTargets', 'finishedAt', 'idempotencyKey', 'intentKind', 'intentSha256',
      'newSourceRevision', 'newStoreRevision', 'oldSourceRevision', 'oldStoreRevision', 'outcome',
      'pr', 'publisherReceipt', 'startedAt',
    ]);
    expect(record.actor).toBe('human-operator');
    expect(record.intentKind).toBe('card-transition');
    expect(record.idempotencyKey).toBe(intent.idempotencyKey);
    expect(record.intentSha256).toBe(reconciliationIntentSha256(intent));
    expect(record.outcome).toBe('applied');
  });

  it('never copies free-form intent payload into the record', () => {
    const intent = cardIntent();
    const record = buildReconciliationAuditRecord({ ...AUDIT_INPUT, intent, outcome: 'applied' });
    expect(JSON.stringify(record)).not.toContain('operator note with private detail');
  });

  it('refuses a record whose strings carry a credential-shaped token', () => {
    const intent = cardIntent();
    expect(() => buildReconciliationAuditRecord({
      ...AUDIT_INPUT, intent, outcome: 'applied',
      publisherReceipt: 'ghp_0123456789abcdefghij',
    })).toThrow(AuditSecretError);
  });

  it('records a refused outcome with unchanged revisions', () => {
    const intent = cardIntent();
    const record = buildReconciliationAuditRecord({
      ...AUDIT_INPUT, intent, outcome: 'refused',
      newSourceRevision: AUDIT_INPUT.oldSourceRevision,
      newStoreRevision: AUDIT_INPUT.oldStoreRevision,
      publisherReceipt: null,
    });
    expect(record.outcome).toBe('refused');
    expect(record.newSourceRevision).toBe(record.oldSourceRevision);
    expect(record.publisherReceipt).toBeNull();
  });

  it('appends the built record through the sink and returns its audit ref', async () => {
    const appended: ReconciliationAuditRecord[] = [];
    const sink: ReconciliationAuditSink = {
      async append(record) { appended.push(record); return `audit-${appended.length}`; },
      async find(idempotencyKey, outcome) {
        const index = appended.findIndex(
          (record) => record.idempotencyKey === idempotencyKey && record.outcome === outcome,
        );
        return index === -1 ? null : `audit-${index + 1}`;
      },
    };
    const ref = await appendReconciliationAudit(sink, {
      ...AUDIT_INPUT, intent: cardIntent(), outcome: 'applied',
    });
    expect(ref).toBe('audit-1');
    expect(appended).toHaveLength(1);
    expect(appended[0]!.intentKind).toBe('card-transition');
  });
});

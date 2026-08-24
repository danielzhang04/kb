import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from '../write/durableManifest.ts';
import {
  classifyReplay, decodeReconciliationIntent, MAX_SWEEPER_INTENTS, RECONCILIATION_ACTORS,
  RECONCILIATION_INTENT_KINDS, reconciliationExactTargets, reconciliationIdempotencyKey,
  reconciliationIntentSha256,
} from './contracts.ts';
import type {
  CardTransitionIntent, PreparedReconciliationReceipt, PublishedReconciliationReceipt,
  ReconciliationIntent, SweeperPorts,
} from './contracts.ts';

interface VectorCase { readonly name: string; readonly field?: string; readonly value: unknown }
interface ContractVectors {
  readonly reconciliation: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p4-contract-vectors.json', import.meta.url),
  'utf8',
)) as ContractVectors;

const decoded = (index: number): ReconciliationIntent =>
  decodeReconciliationIntent(vectors.reconciliation.valid[index]!.value);

describe('reconciliation intent union', () => {
  it('closes the kind and actor sets', () => {
    expect([...RECONCILIATION_INTENT_KINDS]).toEqual(['card-transition', 'escalation-card', 'schedule-mirror', 'mirror-merged']);
    expect([...RECONCILIATION_ACTORS]).toEqual(['human-operator', 'system-sweeper', 'dashboard-supervisor']);
    expect(MAX_SWEEPER_INTENTS).toBe(20);
  });

  for (const [index, vector] of vectors.reconciliation.valid.entries()) {
    it(`decodes ${vector.name} and recomputes its key`, () => {
      const intent = decoded(index);
      expect(intent).toEqual(vector.value);
      expect(reconciliationIdempotencyKey(intent)).toBe(intent.idempotencyKey);
    });
  }

  for (const vector of vectors.reconciliation.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => decodeReconciliationIntent(vector.value)).toThrow(ContractDecodeError);
    });
  }

  it('recomputes exactTargets from the kind payload', () => {
    expect(reconciliationExactTargets(decoded(0))).toEqual(decoded(0).exactTargets);
    expect(reconciliationExactTargets(decoded(2))).toEqual(['HEARTBEAT.md', 'orgs/faceless-youtube/HEARTBEAT.md']);
    expect(reconciliationExactTargets(decoded(3))).toEqual([]);
  });

  it('hashes the complete intent canonically and independently of key order', () => {
    const intent = decoded(0) as CardTransitionIntent;
    const reordered = JSON.parse(JSON.stringify({ ...intent })) as ReconciliationIntent;
    expect(reconciliationIntentSha256(reordered)).toBe(reconciliationIntentSha256(intent));
    expect(reconciliationIntentSha256({ ...intent, toState: 'blocked' })).not.toBe(reconciliationIntentSha256(intent));
  });
});

describe('two-phase receipt replay [P4-C33]', () => {
  const prepared: PreparedReconciliationReceipt = {
    idempotencyKey: 'escalation:sweeper-failure:system-sweeper-run-91',
    requestSha256: 'a'.repeat(64),
    phase: 'prepared',
    expectedSourceRevision: 'b'.repeat(64),
    expectedStoreRevision: 'c'.repeat(64),
    exactTargets: [],
  };
  const published: PublishedReconciliationReceipt = {
    ...prepared, phase: 'published', result: { outcome: 'applied', revision: 'd'.repeat(64) }, auditRef: 'audit-1',
  };

  it('classifies fresh, exact replay, prepared reconcile, and conflict', () => {
    expect(classifyReplay(null, prepared.requestSha256)).toBe('fresh');
    expect(classifyReplay(published, published.requestSha256)).toBe('exact-replay');
    expect(classifyReplay(prepared, prepared.requestSha256)).toBe('reconcile-prepared');
    expect(classifyReplay(published, 'e'.repeat(64))).toBe('conflict');
  });
});

describe('compile negatives', () => {
  it('refuses a direct Sweeper effect port at compile time', () => {
    const readOnly: SweeperPorts<{ readSnapshot(): string }> = { readSnapshot: () => 'snapshot' };
    expect(readOnly.readSnapshot()).toBe('snapshot');
    // @ts-expect-error - SweeperPorts collapses to `never` when any effect member is present.
    const effectful: SweeperPorts<{ routeDurable(): void }> = { routeDurable: () => undefined };
    expect(effectful).toBeDefined();
    // The allowlist also collapses for members no blacklist of effect names would have caught.
    // @ts-expect-error - only `readSnapshot` is on the allowlist.
    const unlisted: SweeperPorts<{ readSnapshot(): string; persist(): void }> = {
      readSnapshot: () => 'snapshot', persist: () => undefined,
    };
    expect(unlisted).toBeDefined();
  });

  it('refuses a changed replay by making the persisted receipt readonly', () => {
    const receipt: PublishedReconciliationReceipt = {
      idempotencyKey: 'k', requestSha256: 'a'.repeat(64), phase: 'published',
      expectedSourceRevision: 'b'.repeat(64), expectedStoreRevision: 'c'.repeat(64), exactTargets: [],
      result: { outcome: 'no-op', revision: 'd'.repeat(64) }, auditRef: 'audit-2',
    };
    // @ts-expect-error - a persisted receipt is readonly; a replay cannot rewrite its request hash.
    receipt.requestSha256 = 'f'.repeat(64);
    expect(classifyReplay(receipt, 'f'.repeat(64))).toBe('exact-replay');
  });
});

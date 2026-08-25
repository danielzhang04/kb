import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from '../../write/durableManifest.ts';
import {
  IDEMPOTENCY_KEY, assertIdempotencyKey, canonicalBodyHash, decodeV1IdempotencyRecord, evaluateReplay,
  idempotencyRecordKey, isIdempotencyKey,
} from './idempotency.ts';
import type { V1IdempotencyRecord } from './idempotency.ts';

interface VectorCase { readonly name: string; readonly value: unknown }
const vectors = JSON.parse(readFileSync(
  new URL('../../../../tests/fixtures/dashboard-v3-p6-contract-vectors.json', import.meta.url), 'utf8',
)) as { readonly idempotencyRecords: { readonly valid: VectorCase[]; readonly invalid: VectorCase[] } };

describe('Idempotency-Key grammar (§3.4:205)', () => {
  it('accepts 16..128 of the allowed charset and rejects the rest', () => {
    expect(IDEMPOTENCY_KEY.test('idem-key-0000000001')).toBe(true);
    expect(isIdempotencyKey('short')).toBe(false);            // < 16
    expect(isIdempotencyKey('a'.repeat(129))).toBe(false);    // > 128
    expect(isIdempotencyKey('has space 0000000')).toBe(false);
    expect(() => assertIdempotencyKey('short')).toThrow(ContractDecodeError);
  });
});

describe('canonicalBodyHash (§3.4:205) — computed in-code from a short fixed input', () => {
  it('hashes the canonical JSON, order-independent', () => {
    const expected = createHash('sha256').update('{"a":1,"b":2}', 'utf8').digest('hex');
    expect(canonicalBodyHash({ b: 2, a: 1 })).toBe(expected);
    expect(canonicalBodyHash({ a: 1, b: 2 })).toBe(expected);
  });
  it('distinguishes a changed body', () => {
    expect(canonicalBodyHash({ a: 1 })).not.toBe(canonicalBodyHash({ a: 2 }));
  });
});

describe('composite record key (actorOrNodeId, method, URI, key)', () => {
  it('joins the four parts and validates each', () => {
    const key = idempotencyRecordKey({ actorOrNodeId: 'vmnode01', method: 'POST', uri: '/api/v1/runs', key: 'idem-key-0000000001' });
    expect(key).toContain('vmnode01');
    expect(key).toContain('/api/v1/runs');
    expect(() => idempotencyRecordKey({ actorOrNodeId: 'vmnode01', method: 'POST', uri: '/api/v1/runs', key: 'short' })).toThrow(ContractDecodeError);
    // @ts-expect-error - GET is not a mutating idempotency method.
    expect(() => idempotencyRecordKey({ actorOrNodeId: 'x', method: 'GET', uri: '/u', key: 'idem-key-0000000001' })).toThrow(ContractDecodeError);
  });
});

describe('decodeV1IdempotencyRecord exact-key wall (P6-C59)', () => {
  for (const v of vectors.idempotencyRecords.valid) {
    it(`accepts ${v.name}`, () => {
      expect(decodeV1IdempotencyRecord(v.value)).toEqual(v.value);
    });
  }
  for (const v of vectors.idempotencyRecords.invalid) {
    it(`rejects ${v.name}`, () => {
      expect(() => decodeV1IdempotencyRecord(v.value)).toThrow(ContractDecodeError);
    });
  }
});

describe('evaluateReplay (§3.4:205)', () => {
  const record = decodeV1IdempotencyRecord(vectors.idempotencyRecords.valid[0]!.value) as V1IdempotencyRecord;
  it('returns the stored response verbatim on an identical replay', () => {
    expect(evaluateReplay(record, record.bodyHash))
      .toEqual({ outcome: 'replay', status: record.status, responseBody: record.responseBody });
  });
  it('is 409 idempotency-conflict on a changed body', () => {
    expect(evaluateReplay(record, canonicalBodyHash({ changed: true })))
      .toEqual({ outcome: 'conflict', status: 409, code: 'idempotency-conflict' });
  });
});

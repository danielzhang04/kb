import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_SCHEMA_ID, PROTOCOL_VERSION, ProtocolSchemaError, ProtocolVersionError,
  assertAdvertised, assertReceiptValid, assertRequestValid, expectedAdvertisement,
} from './protocolCheck.ts';

interface VectorCase { readonly name: string; readonly value: unknown }
interface ContractVectors {
  readonly helperRequests: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
  readonly helperReceipts: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../../tests/fixtures/dashboard-v3-p5-contract-vectors.json', import.meta.url),
  'utf8',
)) as ContractVectors;

describe('protocol.schema.json is P5 transcription of movement §3', () => {
  it('has a versioned $id and a v1 protocol version', () => {
    expect(PROTOCOL_SCHEMA_ID).toBe('https://schemas.kb.local/deploy-helper/v1');
    expect(PROTOCOL_VERSION).toBe('v1');
  });

  it('accepts every valid request vector (movement:235 verb union)', () => {
    for (const vector of vectors.helperRequests.valid) {
      expect(() => assertRequestValid(vector.value), vector.name).not.toThrow();
    }
  });

  it('rejects every invalid request vector — unknown verb, extra/path/host field, bad hex', () => {
    for (const vector of vectors.helperRequests.invalid) {
      expect(() => assertRequestValid(vector.value), vector.name).toThrow(ProtocolSchemaError);
    }
  });

  it('accepts every valid receipt vector (movement:237 record)', () => {
    for (const vector of vectors.helperReceipts.valid) {
      expect(() => assertReceiptValid(vector.value), vector.name).not.toThrow();
    }
  });

  it('rejects every invalid receipt vector — extra signature key, bad short sha, unknown outcome', () => {
    for (const vector of vectors.helperReceipts.invalid) {
      expect(() => assertReceiptValid(vector.value), vector.name).toThrow(ProtocolSchemaError);
    }
  });

  it('rejects a receipt carrying a signature field (design 527 — never secrets or signatures)', () => {
    expect(() => assertReceiptValid({
      time: '2026-08-24T10:00:00Z', requestRef: 'req-1', shortSha: 'aaaaaaa', callerNode: 'vm',
      outcome: 'accepted', signature: 'deadbeef',
    })).toThrow(ProtocolSchemaError);
  });

  it('rejects a request carrying a key/command field (movement:235 — no keys, no commands)', () => {
    expect(() => assertRequestValid({
      verb: 'deploy', sourceCommit: 'a'.repeat(40), attestationDigest: 'c'.repeat(64),
      requestRef: 'req-1', signingKey: 'x',
    })).toThrow(ProtocolSchemaError);
  });
});

describe('design 667 version handshake', () => {
  it('the advertisement is <verb>/<version>', () => {
    expect(expectedAdvertisement('deploy')).toBe('deploy/v1');
    expect(expectedAdvertisement('pull-assets')).toBe('pull-assets/v1');
  });

  it('accepts a matching advertisement', () => {
    expect(() => assertAdvertised('deploy', 'deploy/v1')).not.toThrow();
  });

  it('fails closed on a mismatched advertisement', () => {
    expect(() => assertAdvertised('deploy', 'deploy/v2')).toThrow(ProtocolVersionError);
  });

  it('fails closed on an unfetchable (null/empty) advertisement', () => {
    expect(() => assertAdvertised('deploy', null)).toThrow(ProtocolVersionError);
    expect(() => assertAdvertised('deploy', '')).toThrow(ProtocolVersionError);
  });
});

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from '../write/durableManifest.ts';
import {
  DEPLOY_T3_DECISIONS, DEPLOY_T3_PREIMAGE_PREFIX, DEPLOY_T3_SUBJECTS, HELPER_RECEIPT_OUTCOMES,
  HELPER_REFUSAL_CODES, HELPER_VERBS, T3_REFUSAL_CODES,
  decodeDeployReadyCandidate, decodeHelperReceipt, deployT3Digest, deployT3Preimage,
  deriveHelperOutcome, encodeHelperRequest,
} from './contracts.ts';
import type {
  DeployReadyPort, DeployT3Preimage, HelperDeployRequest, HelperReceipt, HelperVerb,
} from './contracts.ts';

interface VectorCase { readonly name: string; readonly field?: string; readonly value: unknown }
interface T3Case { readonly name: string; readonly input: DeployT3Preimage; readonly digest?: string }
interface ContractVectors {
  readonly constants: Record<string, string>;
  readonly helperRequests: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
  readonly helperReceipts: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
  readonly deployReadyCandidates: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
  readonly t3: { readonly valid: readonly T3Case[]; readonly invalid: readonly T3Case[] };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p5-contract-vectors.json', import.meta.url),
  'utf8',
)) as ContractVectors;

describe('helper request union (movement:230)', () => {
  it('freezes the three verbs', () => {
    expect([...HELPER_VERBS]).toEqual(['deploy', 'pull-assets', 'deployment-result']);
  });

  for (const vector of vectors.helperRequests.valid) {
    it(`encodes ${vector.name}`, () => {
      const wire = encodeHelperRequest(vector.value as HelperDeployRequest);
      expect(JSON.parse(wire)).toEqual(vector.value);
    });
  }

  for (const vector of vectors.helperRequests.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => encodeHelperRequest(vector.value as HelperDeployRequest)).toThrow(ContractDecodeError);
    });
  }
});

describe('helper receipt (movement:232) and derived HelperOutcome', () => {
  it('freezes the receipt outcomes', () => {
    expect([...HELPER_RECEIPT_OUTCOMES]).toEqual(['accepted', 'refused', 'failed']);
  });

  for (const vector of vectors.helperReceipts.valid) {
    it(`decodes ${vector.name}`, () => {
      const receipt = decodeHelperReceipt(vector.value);
      expect(receipt).toEqual(vector.value);
      const outcome = deriveHelperOutcome('deploy', receipt);
      expect(outcome).toEqual({
        verb: 'deploy', requestRef: receipt.requestRef, receiptAt: receipt.time,
        shortSha: receipt.shortSha, callerNode: receipt.callerNode, outcome: receipt.outcome,
      });
    });
  }

  for (const vector of vectors.helperReceipts.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => decodeHelperReceipt(vector.value)).toThrow(ContractDecodeError);
    });
  }

  it('the dashboard refusal union is separate from the wire and closes with confirm/deploy-required', () => {
    expect(HELPER_REFUSAL_CODES).toContain('confirm-required');
    expect(HELPER_REFUSAL_CODES).toContain('deploy-required');
    expect(HELPER_REFUSAL_CODES).toContain('revision-changed');
    // stale-revision / misleading-symlink map into revision-changed / release-unavailable, not wire codes.
    expect(HELPER_REFUSAL_CODES).not.toContain('stale-revision');
  });
});

describe('DeployReadyPort candidate (P5-C42)', () => {
  for (const vector of vectors.deployReadyCandidates.valid) {
    it(`decodes ${vector.name}`, () => {
      expect(decodeDeployReadyCandidate(vector.value)).toEqual(vector.value);
    });
  }
  for (const vector of vectors.deployReadyCandidates.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => decodeDeployReadyCandidate(vector.value)).toThrow(ContractDecodeError);
    });
  }

  it('is a pure reader: a null candidate is a legal answer, and the port has no write method', () => {
    const port: DeployReadyPort = { latestCandidate: () => null };
    expect(port.latestCandidate()).toBeNull();
    expect(Object.keys(port)).toEqual(['latestCandidate']);
  });
});

describe('deploy-purpose T3 preimage (P5-C20, §3.3)', () => {
  it('reuses the three SHIPPED ceremony codes and mints none', () => {
    expect([...T3_REFUSAL_CODES]).toEqual(['ceremony-unavailable', 'ceremony-invalid', 'ceremony-expired']);
    expect(T3_REFUSAL_CODES as readonly string[]).not.toContain('ceremony-mismatch');
  });

  it('binds the four T3 verbs (Confirm included) and the two subjects', () => {
    expect([...DEPLOY_T3_DECISIONS]).toEqual(['deploy', 'confirm', 'abort', 'close-ptys-and-continue']);
    expect([...DEPLOY_T3_SUBJECTS]).toEqual(['deployment', 'pty-quiescence']);
  });

  for (const vector of vectors.t3.valid) {
    it(`builds the NUL-joined preimage and digest for ${vector.name}`, () => {
      const preimage = deployT3Preimage(vector.input);
      const expected = [
        DEPLOY_T3_PREIMAGE_PREFIX, vector.input.subject, vector.input.ref,
        vector.input.revision, vector.input.decision, vector.input.digest,
      ].join('\u0000');
      expect(preimage).toBe(expected);
      const digest = createHash('sha256').update(preimage, 'utf8').digest('hex');
      expect(deployT3Digest(vector.input)).toBe(digest);
      if (vector.digest) expect(deployT3Digest(vector.input)).toBe(vector.digest);
    });
  }

  for (const vector of vectors.t3.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => deployT3Preimage(vector.input)).toThrow(ContractDecodeError);
    });
  }
});

describe('compile negatives (verified by tsc --noEmit)', () => {
  it('rejects an unknown helper verb at compile time', () => {
    // @ts-expect-error - 'frobnicate' is not a member of the closed HelperVerb union.
    const verb: HelperVerb = 'frobnicate';
    expect(typeof verb).toBe('string');
  });

  it('rejects an extra field on a helper request at compile time', () => {
    const request: HelperDeployRequest = {
      verb: 'deploy',
      sourceCommit: vectors.constants['targetSha']!,
      attestationDigest: vectors.constants['attestationDigest']!,
      requestRef: 'req-1',
      // @ts-expect-error - no verb accepts a path field (movement:230).
      path: '/etc/passwd',
    };
    expect(request.verb).toBe('deploy');
  });

  it('rejects a T3 payload missing digest at compile time', () => {
    // @ts-expect-error - digest is REQUIRED on the T3 binding preimage.
    const payload: DeployT3Preimage = {
      subject: 'deployment', ref: 'deploy-ready:x', revision: 'deploy-ready:y', decision: 'deploy',
    };
    expect(payload.decision).toBe('deploy');
  });

  it('rejects a receipt outcome outside the closed union at compile time', () => {
    const receipt: HelperReceipt = {
      time: 't', requestRef: 'r', shortSha: 'aaaaaaa', callerNode: 'n',
      // @ts-expect-error - 'pending' is not a HelperReceipt outcome.
      outcome: 'pending',
    };
    expect(receipt.requestRef).toBe('r');
  });
});

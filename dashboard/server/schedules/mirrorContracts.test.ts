import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractDecodeError, scheduleMirrorOperationKey } from '../write/durableManifest.ts';
import {
  decodeScheduleMirrorBatch, decodeScheduleMirrorWatermark, isRowCoveredByMirror, isWatermarkUnchanged,
  MAX_SCHEDULE_MIRROR_PATHS, scheduleMirrorBatchId, SCHEDULE_MIRROR_BATCH_STATES,
} from './mirrorContracts.ts';

interface VectorCase { readonly name: string; readonly field?: string; readonly value: unknown }
interface ContractVectors {
  readonly constants: { readonly mirrorBatchId: string };
  readonly scheduleMirror: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p4-contract-vectors.json', import.meta.url),
  'utf8',
)) as ContractVectors;

describe('schedule mirror batch and watermark', () => {
  for (const vector of vectors.scheduleMirror.valid) {
    it(`decodes ${vector.name}`, () => {
      const batch = decodeScheduleMirrorBatch(vector.value);
      expect(batch).toEqual(vector.value);
      expect(batch.id).toBe(vectors.constants.mirrorBatchId);
      expect(batch.operationKey).toBe(scheduleMirrorOperationKey(batch.id));
      expect(batch.paths.length).toBeLessThanOrEqual(MAX_SCHEDULE_MIRROR_PATHS);
    });
  }

  for (const vector of vectors.scheduleMirror.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => decodeScheduleMirrorBatch(vector.value)).toThrow(ContractDecodeError);
    });
  }

  it('derives the batch id from the full target watermark only', () => {
    const target = { revision: 7, digest: 'a'.repeat(64) };
    expect(scheduleMirrorBatchId(target)).toBe(scheduleMirrorBatchId({ ...target }));
    expect(scheduleMirrorBatchId({ ...target, revision: 8 })).not.toBe(scheduleMirrorBatchId(target));
    expect(scheduleMirrorBatchId({ ...target, digest: 'b'.repeat(64) })).not.toBe(scheduleMirrorBatchId(target));
    expect(() => scheduleMirrorBatchId({ revision: -1, digest: 'a'.repeat(64) })).toThrow(ContractDecodeError);
  });

  it('caps the batch at thirty-two changed files and closes its state set', () => {
    expect(MAX_SCHEDULE_MIRROR_PATHS).toBe(32);
    expect([...SCHEDULE_MIRROR_BATCH_STATES]).toEqual(['prepared', 'pr-open', 'merged', 'failed']);
  });

  it('treats a byte-identical watermark as a no-op that opens no PR', () => {
    const watermark = decodeScheduleMirrorWatermark({ revision: 7, digest: 'c'.repeat(64) });
    expect(isWatermarkUnchanged(watermark, { ...watermark })).toBe(true);
    expect(isWatermarkUnchanged(watermark, { ...watermark, revision: 8 })).toBe(false);
  });

  it('bounds mirror-merged row updates by lastMirrorRevision <= target.revision', () => {
    const target = { revision: 7, digest: 'd'.repeat(64) };
    expect(isRowCoveredByMirror(7, target)).toBe(true);
    expect(isRowCoveredByMirror(6, target)).toBe(true);
    // A mutation that landed while the batch was open forms the NEXT batch and is not covered.
    expect(isRowCoveredByMirror(8, target)).toBe(false);
  });

  it('refuses a malformed watermark', () => {
    expect(() => decodeScheduleMirrorWatermark({ revision: 1.5, digest: 'e'.repeat(64) })).toThrow(ContractDecodeError);
    expect(() => decodeScheduleMirrorWatermark({ revision: 1, digest: 'nope' })).toThrow(ContractDecodeError);
    expect(() => decodeScheduleMirrorWatermark({ revision: 1, digest: 'f'.repeat(64), extra: true })).toThrow(ContractDecodeError);
  });
});

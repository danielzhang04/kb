import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ContractDecodeError, COORDINATION_PURPOSES, decodeDurablePathManifest, decodeRouteDurableReceipt,
  derivedDurableBranch, isImplementerTargetPath, learningBatchId, learningImplementationOperationKey,
  learningProposalOperationKey, learningRecordRetireOperationKey, manifestRelpaths,
  MAX_MANIFEST_RELPATHS, purposeMode, purposeRequiresDurablePrWrites, scheduleMirrorOperationKey,
} from './durableManifest.ts';
import type { DurableManifestPurpose, RouteDurableReceipt } from './durableManifest.ts';

interface VectorCase { readonly name: string; readonly field?: string; readonly value: unknown }
interface ManifestVectorCase extends VectorCase {
  readonly mode: 'pr' | 'coordination';
  readonly requiresDurablePrWrites: boolean;
}
interface ContractVectors {
  readonly constants: { readonly baseCommit: string; readonly mergeCommit: string; readonly batchId: string; readonly recordPath: string; readonly mirrorBatchId: string };
  readonly durableManifest: {
    readonly valid: readonly ManifestVectorCase[];
    readonly invalid: readonly VectorCase[];
    readonly receipts: { readonly valid: readonly VectorCase[]; readonly invalid: readonly VectorCase[] };
  };
  readonly compileNegatives: readonly { readonly id: string; readonly description: string }[];
}

export const P4_CONTRACT_VECTORS_URL = new URL(
  '../../../tests/fixtures/dashboard-v3-p4-contract-vectors.json',
  import.meta.url,
);
const vectors = JSON.parse(readFileSync(P4_CONTRACT_VECTORS_URL, 'utf8')) as ContractVectors;

describe('durable path manifest', () => {
  for (const vector of vectors.durableManifest.valid) {
    it(`decodes ${vector.name}`, () => {
      const manifest = decodeDurablePathManifest(vector.value);
      expect(manifest).toEqual(vector.value);
      expect(purposeMode(manifest.purpose)).toBe(vector.mode);
      expect(purposeRequiresDurablePrWrites(manifest.purpose)).toBe(vector.requiresDurablePrWrites);
      expect(derivedDurableBranch(manifest) === null).toBe(vector.mode === 'coordination');
    });
  }

  for (const vector of vectors.durableManifest.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => decodeDurablePathManifest(vector.value)).toThrow(ContractDecodeError);
    });
  }

  it('derives a pinned dv3-p4 branch only for the two PR purposes', () => {
    const manifest = decodeDurablePathManifest(vectors.durableManifest.valid[1]!.value);
    expect(derivedDurableBranch(manifest)).toMatch(/^dv3-p4\/learning-implementation-[0-9a-f]{16}$/);
    expect(COORDINATION_PURPOSES).toEqual(['learning-proposal', 'learning-record-retire']);
  });

  it('renders the four new-purpose operation keys', () => {
    const { batchId, mergeCommit, mirrorBatchId } = vectors.constants;
    expect(learningProposalOperationKey('lessons-miner', 'run_01HXYZ')).toBe('learning-proposal:lessons-miner:run_01HXYZ');
    expect(learningImplementationOperationKey(batchId)).toBe(`learning-implementation:${batchId}`);
    expect(learningRecordRetireOperationKey(batchId, mergeCommit)).toBe(`learning-record-retire:${batchId}:${mergeCommit}`);
    expect(scheduleMirrorOperationKey(mirrorBatchId)).toBe(`schedule-mirror:${mirrorBatchId}`);
  });

  it('hashes batch-id over baseCommit plus sorted record ids only [P4-C30]', () => {
    const { baseCommit, batchId } = vectors.constants;
    expect(learningBatchId(baseCommit, ['lessons-miner-run_01HXYZ-01'])).toBe(batchId);
    // Sort order of the input is irrelevant; the record's own null `batch-id` is never an input.
    expect(learningBatchId(baseCommit, ['b-02', 'a-01'])).toBe(learningBatchId(baseCommit, ['a-01', 'b-02']));
  });

  it('keeps the Implementer target wall at agents/<name>.md and routines/roles/<name>.md [P4-C22]', () => {
    expect(isImplementerTargetPath('agents/fyt-checker.md')).toBe(true);
    expect(isImplementerTargetPath('routines/roles/dispatcher.md')).toBe(true);
    for (const outside of ['agents/nested/x.md', 'memory/lessons-miner.md', 'agents/x.py', 'governance/budget.yaml']) {
      expect(isImplementerTargetPath(outside)).toBe(false);
    }
  });

  it('caps a manifest at thirty-two paths', () => {
    expect(MAX_MANIFEST_RELPATHS).toBe(32);
    expect(manifestRelpaths(['a.md', 'b.md'] as const)).toEqual(['a.md', 'b.md']);
  });
});

describe('routeDurable receipt union [P4-C32]', () => {
  for (const vector of vectors.durableManifest.receipts.valid) {
    it(`decodes the ${vector.name}`, () => {
      expect(decodeRouteDurableReceipt(vector.value)).toEqual(vector.value);
    });
  }
  for (const vector of vectors.durableManifest.receipts.invalid) {
    it(`refuses the ${vector.name}`, () => {
      expect(() => decodeRouteDurableReceipt(vector.value)).toThrow(ContractDecodeError);
    });
  }

  it('exposes PR fields only on the pr arm', () => {
    const receipt = decodeRouteDurableReceipt(vectors.durableManifest.receipts.valid[1]!.value);
    expect(receipt.mode).toBe('coordination');
    // @ts-expect-error - a coordination receipt has no `pr` field to read.
    expect(receipt.pr).toBeUndefined();
  });
});

describe('compile negatives', () => {
  it('refuses a thirty-third manifest path at compile time', () => {
    const thirtyThree = [
      'p01.md', 'p02.md', 'p03.md', 'p04.md', 'p05.md', 'p06.md', 'p07.md', 'p08.md', 'p09.md',
      'p10.md', 'p11.md', 'p12.md', 'p13.md', 'p14.md', 'p15.md', 'p16.md', 'p17.md', 'p18.md',
      'p19.md', 'p20.md', 'p21.md', 'p22.md', 'p23.md', 'p24.md', 'p25.md', 'p26.md', 'p27.md',
      'p28.md', 'p29.md', 'p30.md', 'p31.md', 'p32.md', 'p33.md',
    ] as const;
    // @ts-expect-error - BoundedRelpaths resolves to `never` above thirty-two paths.
    expect(() => manifestRelpaths(thirtyThree)).toThrow(ContractDecodeError);
  });

  it('refuses an unknown receipt mode at compile time', () => {
    // @ts-expect-error - 'direct' is outside the closed receipt union.
    const receipt: RouteDurableReceipt = { mode: 'direct', branch: 'ops', commit: 'a'.repeat(40) };
    expect(receipt.mode).toBe('direct');
  });

  it('refuses an unknown purpose at compile time', () => {
    // @ts-expect-error - 'deploy' is outside the closed purpose union.
    const purpose: DurableManifestPurpose = 'deploy';
    expect(purpose).toBe('deploy');
  });

  it('lists the five W0 compile negatives in the shared vectors', () => {
    expect(vectors.compileNegatives.map((entry) => entry.id)).toEqual([
      'extra-proposal-key', 'run-subject', 'direct-sweeper-effect', 'changed-replay',
      'thirty-third-manifest-path',
    ]);
  });
});

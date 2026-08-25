import { describe, expect, it } from 'vitest';
import { resolveMergedPullRequests } from './mergePoll.ts';
import type {
  ImplementerBatchRef, MergePollDeps, MergedPrStatus, RepoPin,
} from './mergePoll.ts';
import { reconciliationIdempotencyKey } from './contracts.ts';
import type { MirrorMergedIntent, ReconciliationIntent, ReconciliationResult } from './contracts.ts';
import type { LearningRecordRetireInput } from './publisher.ts';
import { scheduleMirrorOperationKey } from '../write/durableManifest.ts';
import { scheduleMirrorBatchId } from '../schedules/mirrorContracts.ts';
import type { ScheduleMirrorBatch } from '../schedules/mirrorContracts.ts';

const PIN: RepoPin = { owner: 'kb', repo: 'kb' };
const WATERMARK = { revision: 7, digest: 'd'.repeat(64) } as const;
const BATCH_ID = scheduleMirrorBatchId(WATERMARK);
const MERGE_COMMIT = 'c'.repeat(40);

function openMirrorBatch(overrides: Partial<ScheduleMirrorBatch> = {}): ScheduleMirrorBatch {
  return {
    schema: 'kb.schedule-mirror-batch/v1', id: BATCH_ID,
    baseWatermark: { revision: 6, digest: 'a'.repeat(64) },
    targetWatermark: { ...WATERMARK },
    paths: [{ path: 'HEARTBEAT.md', digest: 'b'.repeat(64) }],
    state: 'pr-open', operationKey: scheduleMirrorOperationKey(BATCH_ID),
    pr: { owner: 'kb', repo: 'kb', number: 12 }, createdAt: '2026-08-24T00:00:00Z',
    ...overrides,
  };
}

interface Recorder {
  readonly published: ReconciliationIntent[];
  readonly retired: LearningRecordRetireInput[];
  invalidations: number;
}

function deps(input: {
  recorder: Recorder;
  gh: (pr: { owner: string; repo: string; number: number }) => MergedPrStatus | null;
  batch?: ScheduleMirrorBatch | null;
  implementers?: readonly ImplementerBatchRef[];
}): MergePollDeps {
  return {
    repoPin: PIN,
    gh: async (pr) => input.gh(pr),
    readOpenMirrorBatch: async () => input.batch ?? null,
    readOpenImplementerBatches: async () => input.implementers ?? [],
    readSourceRevision: async () => 'ops-head-1',
    readStoreRevision: () => 'store-1',
    publish: async (intent: ReconciliationIntent): Promise<ReconciliationResult> => {
      input.recorder.published.push(intent);
      return { outcome: 'applied', revision: 'ops-head-2' };
    },
    retire: async (retireInput: LearningRecordRetireInput): Promise<ReconciliationResult> => {
      input.recorder.retired.push(retireInput);
      return { outcome: 'applied', revision: 'ops-head-3' };
    },
    invalidatePr: () => { input.recorder.invalidations += 1; },
    now: () => '2026-08-24T12:00:00Z',
  };
}

function recorder(): Recorder {
  return { published: [], retired: [], invalidations: 0 };
}

describe('resolveMergedPullRequests — read-only merge poll', () => {
  it('emits a mirror-merged intent and invalidates the PR cache when the open mirror PR has merged', async () => {
    const rec = recorder();
    const merged: MergedPrStatus = { merged: true, mergeCommit: MERGE_COMMIT, mergedAt: '2026-08-24T11:00:00Z' };
    const outcome = await resolveMergedPullRequests(deps({
      recorder: rec, batch: openMirrorBatch(), gh: () => merged,
    }));

    expect(rec.published).toHaveLength(1);
    const intent = rec.published[0] as MirrorMergedIntent;
    expect(intent.kind).toBe('mirror-merged');
    expect(intent.batchId).toBe(BATCH_ID);
    expect(intent.pr).toEqual({ owner: 'kb', repo: 'kb', number: 12, mergeCommit: MERGE_COMMIT });
    expect(intent.mergedAt).toBe('2026-08-24T11:00:00Z');
    expect(intent.expectedSourceRevision).toBe('ops-head-1');
    // The idempotency key is the closed §3.4 formula, so a re-poll of the same merge lands on one key.
    expect(intent.idempotencyKey).toBe(reconciliationIdempotencyKey(intent));
    expect(rec.invalidations).toBe(1);
    expect(outcome.mirrorsMerged).toEqual([BATCH_ID]);
    expect(rec.retired).toEqual([]);
  });

  it('does nothing for an unmerged mirror PR or an unknown (null) gh read', async () => {
    const unmerged = recorder();
    await resolveMergedPullRequests(deps({
      recorder: unmerged, batch: openMirrorBatch(), gh: () => ({ merged: false, mergeCommit: null, mergedAt: null }),
    }));
    expect(unmerged.published).toEqual([]);
    expect(unmerged.invalidations).toBe(0);

    const unknown = recorder();
    await resolveMergedPullRequests(deps({ recorder: unknown, batch: openMirrorBatch(), gh: () => null }));
    expect(unknown.published).toEqual([]);
    expect(unknown.invalidations).toBe(0);
  });

  it('ignores a mirror batch whose PR is not the pinned repo, and one still only prepared', async () => {
    const offRepo = recorder();
    await resolveMergedPullRequests(deps({
      recorder: offRepo, gh: () => ({ merged: true, mergeCommit: MERGE_COMMIT, mergedAt: null }),
      batch: openMirrorBatch({ pr: { owner: 'evil', repo: 'fork', number: 3 } }),
    }));
    expect(offRepo.published).toEqual([]);

    const prepared = recorder();
    await resolveMergedPullRequests(deps({
      recorder: prepared, gh: () => ({ merged: true, mergeCommit: MERGE_COMMIT, mergedAt: null }),
      batch: openMirrorBatch({ state: 'prepared', pr: undefined }),
    }));
    expect(prepared.published).toEqual([]);
  });

  it('drives the learning-record-retire action for a merged Implementer batch PR and invalidates', async () => {
    const rec = recorder();
    const impl: ImplementerBatchRef = {
      batchId: 'learn-0123456789abcdef01234567',
      recordPaths: ['docs/proposals/learnings/2026-08-24-run_01HXYZ-01.md'],
      pr: { owner: 'kb', repo: 'kb', number: 44 },
    };
    const merged: MergedPrStatus = { merged: true, mergeCommit: 'e'.repeat(40), mergedAt: '2026-08-24T10:00:00Z' };
    const outcome = await resolveMergedPullRequests(deps({
      recorder: rec, batch: null, implementers: [impl], gh: () => merged,
    }));

    expect(rec.published).toEqual([]);
    expect(rec.retired).toHaveLength(1);
    expect(rec.retired[0]).toMatchObject({
      batchId: 'learn-0123456789abcdef01234567',
      baseCommit: 'ops-head-1', // the retire commits against current ops HEAD
      mergeCommit: 'e'.repeat(40),
      mergedAt: '2026-08-24T10:00:00Z',
      recordPaths: ['docs/proposals/learnings/2026-08-24-run_01HXYZ-01.md'],
    });
    expect(rec.invalidations).toBe(1);
    expect(outcome.recordsRetired).toEqual(['learn-0123456789abcdef01234567']);
  });

  it('does not retire an Implementer PR that has not merged', async () => {
    const rec = recorder();
    const impl: ImplementerBatchRef = {
      batchId: 'learn-0123456789abcdef01234567',
      recordPaths: ['docs/proposals/learnings/2026-08-24-run_01HXYZ-01.md'],
      pr: { owner: 'kb', repo: 'kb', number: 44 },
    };
    await resolveMergedPullRequests(deps({
      recorder: rec, batch: null, implementers: [impl],
      gh: () => ({ merged: false, mergeCommit: null, mergedAt: null }),
    }));
    expect(rec.retired).toEqual([]);
    expect(rec.invalidations).toBe(0);
  });
});

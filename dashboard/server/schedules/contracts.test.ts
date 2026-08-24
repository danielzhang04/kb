import { describe, expectTypeOf, it } from 'vitest';
import type {
  CadenceInput,
  ClaimScheduleOccurrenceInput,
  CommitScheduleMirrorPreparationResult,
  CreateScheduleInput,
  Schedule,
  ScheduleMirrorBatchStorePort,
  ScheduleMirrorFilePort,
  ScheduleMirrorMergeProofPort,
  ScheduleMirrorRenderOutcome,
  ScheduleMirrorRenderedPath,
  ScheduleMirrorRendererPort,
  ScheduleMirrorRow,
  ScheduleMirrorRowStorePort,
  ScheduleMirrorSkippedRow,
  ScheduleMirrorSnapshot,
  ScheduleMirrorStorePort,
  ScheduleStorePort,
  SetScheduleArmedInput,
} from './contracts.ts';
import type { ScheduleMirrorBatch, ScheduleMirrorWatermark } from './mirrorContracts.ts';

describe('P2 schedule contracts', () => {
  it('keeps the public schedule and mutation DTOs closed', () => {
    expectTypeOf<Schedule>().toMatchTypeOf<{ id: string; owner: { sourcePath: string }; cadence: { source: string; words: string }; version: number }>();
    expectTypeOf<CadenceInput>().toEqualTypeOf<
      | { kind: 'words'; words: string; time: string }
      | { kind: 'cron'; minute: string; hour: string; dayOfMonth: string; month: string; dayOfWeek: string }
    >();
    expectTypeOf<CreateScheduleInput>().toMatchTypeOf<{ owner: { type: 'agent' | 'workflow'; id: string }; expectedCollectionRevision: number; idempotencyKey: string }>();
    expectTypeOf<SetScheduleArmedInput>().toMatchTypeOf<{ expectedVersion: number; idempotencyKey: string; armed: boolean }>();
    expectTypeOf<ClaimScheduleOccurrenceInput>().toMatchTypeOf<{
      occurrence: { scheduleId: string; scheduledFor: string; nextAt: string };
      expectedVersion: number;
      idempotencyKey: string;
    }>();
  });

  it('exposes the complete atomic schedule port', () => {
    expectTypeOf<ScheduleStorePort>().toMatchTypeOf<{
      readScheduleSnapshot: (...args: never[]) => Promise<unknown>;
      createSchedule: (...args: never[]) => Promise<unknown>;
      setScheduleArmed: (...args: never[]) => Promise<unknown>;
      deleteSchedule: (...args: never[]) => Promise<unknown>;
      claimScheduleOccurrence: (...args: never[]) => Promise<unknown>;
      completeScheduleOccurrence: (...args: never[]) => Promise<unknown>;
    }>();
  });
});

describe('P4 section 3.5 mirror contracts', () => {
  it('models a row with no seed identity and no agent owner as null, not as a fabricated string', () => {
    expectTypeOf<ScheduleMirrorRow['name']>().toEqualTypeOf<string | null>();
    expectTypeOf<ScheduleMirrorRow['agent']>().toEqualTypeOf<string | null>();
    expectTypeOf<ScheduleMirrorRow['schedule']>().toEqualTypeOf<string>();
    expectTypeOf<ScheduleMirrorRow['armed']>().toEqualTypeOf<boolean>();
    expectTypeOf<ScheduleMirrorRow['mirrorPath']>().toEqualTypeOf<Schedule['mirrorPath']>();
    expectTypeOf<ScheduleMirrorSnapshot>().toEqualTypeOf<{ revision: number; rows: readonly ScheduleMirrorRow[] }>();
  });

  it('keeps a skipped row addressable by identity and reason', () => {
    expectTypeOf<ScheduleMirrorSkippedRow>().toEqualTypeOf<{ id: string; name: string | null; reason: string }>();
    expectTypeOf<ScheduleMirrorRenderedPath>().toMatchTypeOf<{
      path: string; content: string; digest: string; changed: boolean; skipped: ScheduleMirrorSkippedRow[];
    }>();
  });

  it('makes the preparation commit a CAS with three closed outcomes', () => {
    expectTypeOf<CommitScheduleMirrorPreparationResult['outcome']>()
      .toEqualTypeOf<'committed' | 'replayed' | 'batch-open'>();
    expectTypeOf<Extract<CommitScheduleMirrorPreparationResult, { outcome: 'batch-open' }>['batch']>()
      .toEqualTypeOf<ScheduleMirrorBatch>();
  });

  it('keeps the render outcome a closed ok/reject union', () => {
    expectTypeOf<Extract<ScheduleMirrorRenderOutcome, { ok: false }>>()
      .toEqualTypeOf<{ ok: false; code: string; path: string | null }>();
    expectTypeOf<ScheduleMirrorRendererPort>().toMatchTypeOf<{
      render: (...args: never[]) => Promise<ScheduleMirrorRenderOutcome>;
    }>();
    expectTypeOf<ScheduleMirrorFilePort>().toMatchTypeOf<{
      readMirrorFile: (path: Schedule['mirrorPath']) => Promise<string>;
    }>();
  });

  it('exposes the whole mirror store surface, rows and batch alike', () => {
    expectTypeOf<ScheduleMirrorStorePort>().toMatchTypeOf<{
      readScheduleMirrorSnapshot: (...args: never[]) => Promise<ScheduleMirrorSnapshot>;
      commitScheduleMirrorPreparation: (...args: never[]) => Promise<CommitScheduleMirrorPreparationResult>;
      applyScheduleMirrorMerge: (...args: never[]) => Promise<{ updatedRowIds: string[] }>;
      recordScheduleMirrorUnchanged: (...args: never[]) => Promise<void>;
      markScheduleMirrorBatchFailed: (...args: never[]) => Promise<{ failed: boolean }>;
      readOpenScheduleMirrorBatch: (...args: never[]) => Promise<ScheduleMirrorBatch | null>;
      readMergedScheduleMirrorWatermark: (...args: never[]) => Promise<ScheduleMirrorWatermark>;
    }>();
    expectTypeOf<ScheduleMirrorStorePort>().toMatchTypeOf<ScheduleMirrorRowStorePort>();
    expectTypeOf<ScheduleMirrorStorePort>().toMatchTypeOf<ScheduleMirrorBatchStorePort>();
  });

  it('proves a merge with the PR and the digests it landed', () => {
    expectTypeOf<ScheduleMirrorMergeProofPort>().toMatchTypeOf<{
      proveScheduleMirrorMerge: (batch: ScheduleMirrorBatch) => Promise<{
        merged: boolean;
        pr: ScheduleMirrorBatch['pr'];
        paths: readonly { path: string; digest: string }[];
      }>;
    }>();
  });
});

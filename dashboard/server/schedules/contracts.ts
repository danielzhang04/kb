import type { RunOutcome, RunnableRef, Schedule, ScheduleOccurrence } from '../control/p2Contracts.ts';
import type { RunnableSelector } from '../entities/contracts.ts';

export type { Schedule } from '../control/p2Contracts.ts';

export type CadenceInput =
  | { kind: 'words'; words: string; time: string }
  | { kind: 'cron'; minute: string; hour: string; dayOfMonth: string; month: string; dayOfWeek: string };

export interface CreateScheduleInput {
  owner: RunnableSelector;
  cadence: CadenceInput;
  expectedCollectionRevision: number;
  idempotencyKey: string;
}

/** Trusted create payload assembled only after the server resolves the selector. */
export interface ResolvedCreateScheduleInput {
  owner: RunnableRef;
  cadence: Schedule['cadence'];
  mirrorPath: Schedule['mirrorPath'];
  expectedCollectionRevision: number;
  idempotencyKey: string;
}

export interface SetScheduleArmedInput {
  expectedVersion: number;
  idempotencyKey: string;
  armed: boolean;
}

export interface DeleteScheduleInput {
  expectedVersion: number;
  idempotencyKey: string;
}

export interface ScheduleSnapshot {
  collectionRevision: number;
  schedules: Schedule[];
}

/** Exact browser-facing collection shape. The internal socket keeps ScheduleSnapshot. */
export interface ScheduleCollection {
  scheduleCollectionRevision: number;
  rows: Schedule[];
}

/** One durable event for a fresh operator arm, disarm, or delete mutation. */
export interface ScheduleMutationEvent {
  kind: 'schedule-mutation-event';
  cursor: number;
  operation: 'armed' | 'disarmed' | 'deleted';
  scheduleId: string;
  scheduleVersion: number;
  collectionRevision: number;
  idempotencyKey: string;
  createdAt: string;
}

export interface ScheduleTombstone {
  id: string;
  deletedAt: string;
  version: number;
}

export interface ScheduleMutationReceipt {
  schedule: Schedule;
  collectionRevision: number;
  replayed: boolean;
}

export interface DeleteScheduleReceipt {
  tombstone: ScheduleTombstone;
  collectionRevision: number;
  replayed: boolean;
}

export interface ScheduleOccurrenceClaim {
  scheduleId: string;
  scheduledFor: string;
  owner: RunnableRef;
  phase: 'claimed' | 'card-saved' | 'ledger-appended';
  card: Record<string, unknown>;
  cardBytesSha256: string;
}

export interface ClaimScheduleOccurrenceInput {
  /** The dispatcher supplies clock identity only; the server reattaches the trusted stored owner. */
  occurrence: Omit<ScheduleOccurrence, 'owner'>;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface CompleteScheduleOccurrenceInput {
  scheduleId: string;
  scheduledFor: string;
  runRef: string;
  lastOutcome: RunOutcome;
  nextAt: string | null;
  idempotencyKey: string;
}

/**
 * P4 section 3.5 mirror row: the live schedule projection the renderer merges, field by field, into
 * the matching HEARTBEAT cadence entry, plus the store-owned `lastMirrorRevision` that bounds
 * `mirror-merged`. Additive — no P2 schedule shape changes [P4-C28, P4-C37].
 *
 * `name` is the cadence identity the file is keyed on (`launchPayload.cadenceName`); it is null for
 * a row no seed import produced, and such a row is skipped rather than rendered. `schedule` is the
 * canonical source expression the file carries (`daily`, `weekly:sat`, a cron string) — never the
 * human words, which no consumer of HEARTBEAT.md can parse.
 */
export interface ScheduleMirrorRow {
  id: string;
  name: string | null;
  schedule: string;
  agent: string | null;
  armed: boolean;
  mirrorPath: Schedule['mirrorPath'];
  lastMirrorRevision: number;
}

export interface ScheduleMirrorSnapshot {
  revision: number;
  rows: readonly ScheduleMirrorRow[];
}

/** A store row the renderer declined to mirror. A skip is per-row and never rejects the batch. */
export interface ScheduleMirrorSkippedRow {
  id: string;
  name: string | null;
  reason: string;
}

export type CommitScheduleMirrorPreparationResult =
  | { outcome: 'committed' }
  | { outcome: 'replayed'; batch: import('./mirrorContracts.ts').ScheduleMirrorBatch }
  | { outcome: 'batch-open'; batch: import('./mirrorContracts.ts').ScheduleMirrorBatch };

/** The row side of the mirror, implemented by the control store. */
export interface ScheduleMirrorRowStorePort {
  readScheduleMirrorSnapshot(): Promise<ScheduleMirrorSnapshot>;
  /**
   * First write of `scheduleMirrorRevision`/`lastMirrorRevision` happens here [P4-C37]. The
   * read-and-commit runs inside the store's single-writer schedule transaction, so this call is the
   * CAS that makes "at most one open batch" true: a second concurrent preparation for a different
   * target loses with `batch-open`, and an identical one replays.
   */
  commitScheduleMirrorPreparation(
    batch: import('./mirrorContracts.ts').ScheduleMirrorBatch,
  ): Promise<CommitScheduleMirrorPreparationResult>;
  applyScheduleMirrorMerge(input: {
    batch: import('./mirrorContracts.ts').ScheduleMirrorBatch;
    mirroredAt: string;
  }): Promise<{ updatedRowIds: string[] }>;
  /** A byte-identical mirror advances the merged watermark with no batch and no PR. */
  recordScheduleMirrorUnchanged(watermark: import('./mirrorContracts.ts').ScheduleMirrorWatermark): Promise<void>;
  /** Operator abandon: marks the stored batch `failed` so the next preparation supersedes it. */
  markScheduleMirrorBatchFailed(batchId: string): Promise<{ failed: boolean }>;
}

/** The batch side, also implemented by the control store: the durable §3.5 batch record. */
export interface ScheduleMirrorBatchStorePort {
  /** The stored batch record, whatever its state (a merged record still answers merge replay). */
  readOpenScheduleMirrorBatch(): Promise<import('./mirrorContracts.ts').ScheduleMirrorBatch | null>;
  readMergedScheduleMirrorWatermark(): Promise<import('./mirrorContracts.ts').ScheduleMirrorWatermark>;
}

export interface ScheduleMirrorStorePort extends ScheduleMirrorRowStorePort, ScheduleMirrorBatchStorePort {}

/** Reads the current mirror-file bytes; the renderer preserves every byte it does not own. */
export interface ScheduleMirrorFilePort {
  readMirrorFile(path: Schedule['mirrorPath']): Promise<string>;
}

export interface ScheduleMirrorRenderedPath {
  path: string;
  content: string;
  digest: string;
  changed: boolean;
  skipped: ScheduleMirrorSkippedRow[];
}

export type ScheduleMirrorRenderOutcome =
  | { ok: true; paths: ScheduleMirrorRenderedPath[] }
  | { ok: false; code: string; path: string | null };

/** `scripts/schedule_mirror.py` is executed for JSON output and never loaded as text. */
export interface ScheduleMirrorRendererPort {
  render(paths: Array<{ path: string; bytes: string; rows: ScheduleMirrorRow[] }>): Promise<ScheduleMirrorRenderOutcome>;
}

/** Proves the pinned fixture/real PR merged and reports the target path digests it landed. */
export interface ScheduleMirrorMergeProofPort {
  proveScheduleMirrorMerge(batch: import('./mirrorContracts.ts').ScheduleMirrorBatch): Promise<{
    merged: boolean;
    pr: import('./mirrorContracts.ts').ScheduleMirrorBatchPr;
    paths: readonly import('./mirrorContracts.ts').ScheduleMirrorPathDigest[];
  }>;
}

export interface ScheduleStorePort {
  readScheduleSnapshot(): Promise<ScheduleSnapshot>;
  createSchedule(input: ResolvedCreateScheduleInput): Promise<ScheduleMutationReceipt>;
  setScheduleArmed(id: string, input: SetScheduleArmedInput): Promise<ScheduleMutationReceipt>;
  deleteSchedule(id: string, input: DeleteScheduleInput): Promise<DeleteScheduleReceipt>;
  claimScheduleOccurrence(input: ClaimScheduleOccurrenceInput): Promise<ScheduleOccurrenceClaim>;
  completeScheduleOccurrence(input: CompleteScheduleOccurrenceInput): Promise<ScheduleMutationReceipt>;
}

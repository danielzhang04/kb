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
  occurrence: ScheduleOccurrence;
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

export interface ScheduleStorePort {
  readScheduleSnapshot(): Promise<ScheduleSnapshot>;
  createSchedule(input: ResolvedCreateScheduleInput): Promise<ScheduleMutationReceipt>;
  setScheduleArmed(id: string, input: SetScheduleArmedInput): Promise<ScheduleMutationReceipt>;
  deleteSchedule(id: string, input: DeleteScheduleInput): Promise<DeleteScheduleReceipt>;
  claimScheduleOccurrence(input: ClaimScheduleOccurrenceInput): Promise<ScheduleOccurrenceClaim>;
  completeScheduleOccurrence(input: CompleteScheduleOccurrenceInput): Promise<ScheduleMutationReceipt>;
}

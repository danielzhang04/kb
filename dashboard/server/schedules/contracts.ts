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
}

export interface ClaimScheduleOccurrenceInput {
  occurrence: ScheduleOccurrence;
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
  createSchedule(input: CreateScheduleInput): Promise<ScheduleMutationReceipt>;
  setScheduleArmed(id: string, input: SetScheduleArmedInput): Promise<ScheduleMutationReceipt>;
  deleteSchedule(id: string, input: DeleteScheduleInput): Promise<DeleteScheduleReceipt>;
  claimScheduleOccurrence(input: ClaimScheduleOccurrenceInput): Promise<ScheduleOccurrenceClaim>;
  completeScheduleOccurrence(input: CompleteScheduleOccurrenceInput): Promise<ScheduleMutationReceipt>;
}

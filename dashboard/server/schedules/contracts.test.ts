import { describe, expectTypeOf, it } from 'vitest';
import type { CadenceInput, CreateScheduleInput, Schedule, ScheduleStorePort, SetScheduleArmedInput } from './contracts.ts';

describe('P2 schedule contracts', () => {
  it('keeps the public schedule and mutation DTOs closed', () => {
    expectTypeOf<Schedule>().toMatchTypeOf<{ id: string; owner: { sourcePath: string }; cadence: { source: string; words: string }; version: number }>();
    expectTypeOf<CadenceInput>().toEqualTypeOf<
      | { kind: 'words'; words: string; time: string }
      | { kind: 'cron'; minute: string; hour: string; dayOfMonth: string; month: string; dayOfWeek: string }
    >();
    expectTypeOf<CreateScheduleInput>().toMatchTypeOf<{ owner: { type: 'agent' | 'workflow'; id: string }; expectedCollectionRevision: number; idempotencyKey: string }>();
    expectTypeOf<SetScheduleArmedInput>().toMatchTypeOf<{ expectedVersion: number; idempotencyKey: string; armed: boolean }>();
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

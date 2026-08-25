// P6 W2 — characterization of the four schedule handlers' extracted service. Drives the list ETag/304,
// each closed body wall, and the `ScheduleServiceError` status/code mapping from an injected fake service.

import { describe, expect, it, vi } from 'vitest';
import {
  createSchedule, deleteSchedule, listSchedules, setScheduleArmed, type ScheduleServicePort,
} from './scheduleService.ts';
import type { ScheduleSnapshot } from '../schedules/contracts.ts';

class ScheduleServiceError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function snapshot(rev: number, schedules: unknown[] = []): ScheduleSnapshot {
  return { collectionRevision: rev, schedules } as unknown as ScheduleSnapshot;
}

function port(over: Partial<ScheduleServicePort> = {}): ScheduleServicePort {
  return {
    list: async () => snapshot(7, [{ id: 's1' }]),
    create: async () => ({ ok: true }),
    setArmed: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    ...over,
  };
}

const VALID_ID = 'a'.repeat(64);
const goodCreate = { owner: { type: 'agent', id: 'worker' }, cadence: { kind: 'words', words: 'every day', time: '09:00' }, expectedCollectionRevision: 3, idempotencyKey: 'k1' };

describe('scheduleService', () => {
  it('lists with the schedules ETag and body', async () => {
    const out = await listSchedules(port(), undefined);
    expect(out).toEqual({ status: 200, etag: '"schedules:7"', body: { scheduleCollectionRevision: 7, rows: [{ id: 's1' }] } });
  });

  it('returns 304 when the schedules ETag matches', async () => {
    const out = await listSchedules(port(), '"schedules:7"');
    expect(out).toEqual({ status: 304, etag: '"schedules:7"' });
  });

  it('maps a ScheduleServiceError thrown by list', async () => {
    const out = await listSchedules(port({ list: async () => { throw new ScheduleServiceError(503, 'schedule-store-unavailable'); } }), undefined);
    expect(out).toEqual({ status: 503, body: { error: 'schedule-store-unavailable' } });
  });

  it('creates with 201 on a valid closed body', async () => {
    const create = vi.fn(async () => ({ id: 'new' }));
    const out = await createSchedule(port({ create }), goodCreate);
    expect(out).toEqual({ status: 201, body: { id: 'new' } });
    expect(create).toHaveBeenCalledOnce();
  });

  it('refuses 400 invalid-schedule-create-body for an extra key or bad owner', async () => {
    const create = vi.fn();
    const extra = await createSchedule(port({ create }), { ...goodCreate, surprise: 1 });
    expect(extra).toEqual({ status: 400, body: { error: 'invalid-schedule-create-body' } });
    const badOwner = await createSchedule(port({ create }), { ...goodCreate, owner: { type: 'nope', id: 'x' } });
    expect(badOwner.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps a create ScheduleServiceError (e.g. expected-collection-revision-mismatch)', async () => {
    const out = await createSchedule(port({ create: async () => { throw new ScheduleServiceError(409, 'expected-collection-revision-mismatch'); } }), goodCreate);
    expect(out).toEqual({ status: 409, body: { error: 'expected-collection-revision-mismatch' } });
  });

  it('arms with the matching armed flag and refuses a mismatched id or flag', async () => {
    const armed = { expectedVersion: 2, idempotencyKey: 'k', armed: true };
    const ok = await setScheduleArmed(port(), VALID_ID, armed, true);
    expect(ok.status).toBe(200);
    const badId = await setScheduleArmed(port(), 'not-hex', armed, true);
    expect(badId).toEqual({ status: 400, body: { error: 'invalid-schedule-arm-body' } });
    const wrongFlag = await setScheduleArmed(port(), VALID_ID, armed, false); // body.armed=true but armed=false expected
    expect(wrongFlag).toEqual({ status: 400, body: { error: 'invalid-schedule-arm-body' } });
  });

  it('deletes with a valid closed body and refuses otherwise', async () => {
    const ok = await deleteSchedule(port(), VALID_ID, { expectedVersion: 1, idempotencyKey: 'k' });
    expect(ok.status).toBe(200);
    const bad = await deleteSchedule(port(), VALID_ID, { expectedVersion: 0, idempotencyKey: 'k' });
    expect(bad).toEqual({ status: 400, body: { error: 'invalid-schedule-delete-body' } });
  });
});

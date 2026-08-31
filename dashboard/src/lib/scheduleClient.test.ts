import { describe, expect, it, vi } from 'vitest';
import type { Schedule } from '../../server/control/p2Contracts.ts';
import { ScheduleClientError, createSchedule, decodeScheduleCollection, fetchSchedules, setScheduleArmed } from './scheduleClient.ts';

const ROW: Schedule = {
  id: 'a'.repeat(64), owner: { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' },
  cadence: { source: '15 3 * * 0', words: 'Sun · 3:15 AM' }, nextAt: '2026-08-23T03:15:00-04:00',
  lastOutcome: null, armed: true, origin: 'seed', mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 3,
};

describe('scheduleClient', () => {
  it('decodes the closed W0 schedule snapshot and rejects extra/source-path shapes', () => {
    expect(decodeScheduleCollection({ scheduleCollectionRevision: 4, rows: [ROW] })).toEqual({ scheduleCollectionRevision: 4, rows: [ROW] });
    expect(() => decodeScheduleCollection({ scheduleCollectionRevision: 4, rows: [{ ...ROW, pending: true }] })).toThrow('Invalid Schedule response');
    expect(() => decodeScheduleCollection({ scheduleCollectionRevision: 4, rows: [{ ...ROW, owner: { type: 'agent', id: 'hygiene', sourcePath: '../hygiene.md' } }] })).toThrow('Invalid Schedule response');
    expect(() => decodeScheduleCollection({ collectionRevision: 4, schedules: [ROW] })).toThrow('Invalid Schedule response');
  });

  it('uses immediate REST actions with expected revisions and idempotency keys', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ scheduleCollectionRevision: 4, rows: [ROW] }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ schedule: { ...ROW, origin: 'operator' }, collectionRevision: 5, replayed: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ schedule: { ...ROW, armed: false, version: 4 }, collectionRevision: 6, replayed: false }) });
    await fetchSchedules('token', fetchImpl);
    await createSchedule('token', { owner: { type: 'agent', id: 'hygiene' }, cadence: { kind: 'words', words: 'daily', time: '09:00' }, expectedCollectionRevision: 4, idempotencyKey: 'create-1' }, fetchImpl);
    await setScheduleArmed('token', ROW.id, { expectedVersion: 3, idempotencyKey: 'disarm-1', armed: false }, fetchImpl);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/schedules', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer token' }) }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/schedules', expect.objectContaining({ method: 'POST', body: expect.stringContaining('create-1') }));
    expect(fetchImpl).toHaveBeenNthCalledWith(3, `/api/schedules/${ROW.id}/disarm`, expect.objectContaining({ method: 'POST', body: expect.stringContaining('disarm-1') }));
  });

  it('surfaces the exact 409 code for inline handling', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'seed-not-on-protected-main' }) }));
    await expect(setScheduleArmed('token', ROW.id, { expectedVersion: 3, idempotencyKey: 'arm', armed: true }, fetchImpl))
      .rejects.toEqual(expect.objectContaining<Partial<ScheduleClientError>>({ status: 409, code: 'seed-not-on-protected-main' }));
  });
});

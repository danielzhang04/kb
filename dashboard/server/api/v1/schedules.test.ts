// P6 W6.1 §6 — /api/v1/schedules over services/scheduleService.ts. List watermark = schedules:<rev>;
// create carries the NUMERIC expectedCollectionRevision precondition [§3.4:433] — a foreign-domain value
// (a Run ETag string) fails the numeric wall -> 400, proving the domain is non-interchangeable on the wire.
import { describe, expect, it } from 'vitest';
import { opCtx, operatorApp, opHeaders, HOST, operatorBearer } from './_nodeHarness.ts';
import type { ScheduleServicePort } from '../../services/scheduleService.ts';

function port(over: Partial<ScheduleServicePort> = {}): ScheduleServicePort {
  return {
    async list() { return { collectionRevision: 7, schedules: [] } as never; },
    async create() { return { ok: true }; },
    async setArmed() { return { ok: true }; },
    async delete() { return { ok: true }; },
    ...over,
  };
}

const okCreate = {
  owner: { type: 'agent', id: 'agent-a' },
  cadence: { kind: 'words', words: 'every day', time: '09:00' },
  expectedCollectionRevision: 7,
  idempotencyKey: 'sched-key-1',
};

describe('GET /api/v1/schedules', () => {
  it('200 kind:schedule-list with meta.watermark = schedules:7', async () => {
    const res = await operatorApp(opCtx({ schedulePort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/schedules', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('schedule-list');
    expect(body.meta).toEqual({ watermark: 'schedules:7' });
  });
});

describe('POST /api/v1/schedules — numeric expectedCollectionRevision precondition', () => {
  it('201 on a well-formed create', async () => {
    const res = await operatorApp(opCtx({ schedulePort: port() }), 'mutations').inject({ method: 'POST', url: '/api/v1/schedules', headers: opHeaders(), payload: okCreate });
    expect(res.statusCode).toBe(201);
  });

  it('SECURITY/domain: a Run ETag string where the NUMERIC expectedCollectionRevision is expected -> 400', async () => {
    const bad = { ...okCreate, expectedCollectionRevision: 'run:run-1:5' };
    const res = await operatorApp(opCtx({ schedulePort: port() }), 'mutations').inject({ method: 'POST', url: '/api/v1/schedules', headers: opHeaders(), payload: bad });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('invalid-schedule-create-body');
  });

  it('400 idempotency-key-required without the header', async () => {
    const res = await operatorApp(opCtx({ schedulePort: port() }), 'mutations').inject({ method: 'POST', url: '/api/v1/schedules', headers: { host: HOST, authorization: operatorBearer() }, payload: okCreate });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('idempotency-key-required');
  });
});

describe('arm / disarm / delete', () => {
  const id = 'a'.repeat(64);
  it('arm 200', async () => {
    const res = await operatorApp(opCtx({ schedulePort: port() }), 'mutations').inject({ method: 'POST', url: `/api/v1/schedules/${id}/arm`, headers: opHeaders(), payload: { expectedVersion: 1, idempotencyKey: 'k', armed: true } });
    expect(res.statusCode).toBe(200);
  });
  it('disarm 400 on a mismatched armed flag (closed body wall)', async () => {
    const res = await operatorApp(opCtx({ schedulePort: port() }), 'mutations').inject({ method: 'POST', url: `/api/v1/schedules/${id}/disarm`, headers: opHeaders(), payload: { expectedVersion: 1, idempotencyKey: 'k', armed: true } });
    expect(res.statusCode).toBe(400);
  });
  it('delete 200', async () => {
    const res = await operatorApp(opCtx({ schedulePort: port() }), 'mutations').inject({ method: 'DELETE', url: `/api/v1/schedules/${id}`, headers: opHeaders(), payload: { expectedVersion: 1, idempotencyKey: 'k' } });
    expect(res.statusCode).toBe(200);
  });
});

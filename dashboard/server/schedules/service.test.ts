import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { RunnableRef, Schedule } from '../control/p2Contracts.ts';
import type {
  ClaimScheduleOccurrenceInput,
  CompleteScheduleOccurrenceInput,
  CreateScheduleInput,
  DeleteScheduleInput,
  DeleteScheduleReceipt,
  ResolvedCreateScheduleInput,
  ScheduleMutationReceipt,
  ScheduleOccurrenceClaim,
  ScheduleSnapshot,
  SetScheduleArmedInput,
} from './contracts.ts';
import {
  ScheduleService,
  ScheduleServiceError,
  normalizeCadenceInput,
  operatorScheduleId,
  registerScheduleRoutes,
  selectScheduleRecoverySnapshot,
  type AtomicScheduleStorePort,
  type ScheduleMutationReceiptKey,
  type StoredScheduleMutationReceipt,
} from './service.ts';

const OWNER: RunnableRef = { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' };

function replayKey(key: ScheduleMutationReceiptKey): string {
  return `${key.operation}:${key.target}:${key.idempotencyKey}`;
}

class MemoryScheduleStore implements AtomicScheduleStorePort {
  snapshot: ScheduleSnapshot = { collectionRevision: 0, schedules: [] };
  readonly order: string[] = [];
  claimEmissions = 0;
  private readonly replays = new Map<string, StoredScheduleMutationReceipt>();

  async transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    this.order.push('transaction');
    return operation(this);
  }
  async readMutationReceipt(key: ScheduleMutationReceiptKey): Promise<StoredScheduleMutationReceipt | null> {
    this.order.push('receipt');
    return structuredClone(this.replays.get(replayKey(key)) ?? null);
  }
  async writeMutationReceipt(
    key: ScheduleMutationReceiptKey,
    fingerprint: string,
    receipt: ScheduleMutationReceipt | DeleteScheduleReceipt,
  ): Promise<void> {
    this.order.push('write-receipt');
    this.replays.set(replayKey(key), { fingerprint, receipt: structuredClone(receipt) });
  }
  async readScheduleSnapshot(): Promise<ScheduleSnapshot> {
    this.order.push('snapshot');
    return structuredClone(this.snapshot);
  }
  async createSchedule(input: ResolvedCreateScheduleInput): Promise<ScheduleMutationReceipt> {
    this.order.push('create');
    if (input.expectedCollectionRevision !== this.snapshot.collectionRevision) throw new ScheduleServiceError(409, 'stale-schedule-collection');
    const id = operatorScheduleId(input.owner, input.idempotencyKey);
    const schedule: Schedule = {
      id, owner: input.owner, cadence: input.cadence, nextAt: null, lastOutcome: null,
      armed: false, origin: 'operator', mirroredAt: null, mirrorPath: input.mirrorPath, version: 1,
    };
    this.snapshot = { collectionRevision: this.snapshot.collectionRevision + 1, schedules: [...this.snapshot.schedules, schedule] };
    return { schedule, collectionRevision: this.snapshot.collectionRevision, replayed: false };
  }
  async setScheduleArmed(id: string, input: SetScheduleArmedInput): Promise<ScheduleMutationReceipt> {
    this.order.push('set-armed');
    const row = this.snapshot.schedules.find((schedule) => schedule.id === id);
    if (!row) throw new ScheduleServiceError(404, 'schedule-not-found');
    if (row.version !== input.expectedVersion) throw new ScheduleServiceError(409, 'stale-schedule-version');
    const schedule = { ...row, armed: input.armed, version: row.version + 1 };
    this.snapshot = {
      collectionRevision: this.snapshot.collectionRevision + 1,
      schedules: this.snapshot.schedules.map((candidate) => candidate.id === id ? schedule : candidate),
    };
    return { schedule, collectionRevision: this.snapshot.collectionRevision, replayed: false };
  }
  async deleteSchedule(id: string, input: DeleteScheduleInput): Promise<DeleteScheduleReceipt> {
    this.order.push('delete');
    const row = this.snapshot.schedules.find((schedule) => schedule.id === id);
    if (!row) throw new ScheduleServiceError(404, 'schedule-not-found');
    if (row.version !== input.expectedVersion) throw new ScheduleServiceError(409, 'stale-schedule-version');
    this.snapshot = {
      collectionRevision: this.snapshot.collectionRevision + 1,
      schedules: this.snapshot.schedules.filter((candidate) => candidate.id !== id),
    };
    return {
      tombstone: { id, deletedAt: '2026-08-21T12:00:00.000Z', version: row.version + 1 },
      collectionRevision: this.snapshot.collectionRevision,
      replayed: false,
    };
  }
  async claimScheduleOccurrence(input: ClaimScheduleOccurrenceInput): Promise<ScheduleOccurrenceClaim> {
    this.order.push('claim');
    this.claimEmissions += 1;
    const schedule = this.snapshot.schedules.find((row) => row.id === input.occurrence.scheduleId);
    if (!schedule) throw new ScheduleServiceError(404, 'schedule-not-found');
    return {
      scheduleId: schedule.id,
      scheduledFor: input.occurrence.scheduledFor,
      owner: schedule.owner,
      phase: 'claimed',
      card: {},
      cardBytesSha256: 'a'.repeat(64),
    };
  }
  async completeScheduleOccurrence(_input: CompleteScheduleOccurrenceInput): Promise<ScheduleMutationReceipt> { throw new Error('unused'); }
}

function service(
  store = new MemoryScheduleStore(),
  protectedMain = false,
  resolveOwner: (selector: { type: 'agent' | 'workflow'; id: string }) => Promise<RunnableRef | null> = async (selector) => (
    selector.type === 'agent' && selector.id === OWNER.id ? OWNER : null
  ),
): ScheduleService {
  return new ScheduleService({ store, resolveOwner, seedAuthorization: async () => protectedMain });
}

const CREATE: CreateScheduleInput = {
  owner: { type: 'agent', id: 'hygiene' },
  cadence: { kind: 'words', words: 'daily', time: '09:15' },
  expectedCollectionRevision: 0,
  idempotencyKey: 'operator-key-1',
};

describe('ScheduleService', () => {
  it('registers the closed immediate REST surface and rejects extra owner provenance', async () => {
    const app = Fastify();
    registerScheduleRoutes(app, service(), async () => undefined);

    const listed = await app.inject({ method: 'GET', url: '/api/schedules' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ scheduleCollectionRevision: 0, rows: [] });
    expect(listed.headers.etag).toBe('"schedules:0"');
    expect((await app.inject({
      method: 'GET', url: '/api/schedules', headers: { 'if-none-match': String(listed.headers.etag) },
    })).statusCode).toBe(304);

    const refused = await app.inject({
      method: 'POST', url: '/api/schedules',
      payload: { ...CREATE, sourcePath: '../agents/hygiene.md' },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ error: 'invalid-schedule-create-body' });

    const created = await app.inject({ method: 'POST', url: '/api/schedules', payload: CREATE });
    expect(created.statusCode).toBe(201);
    const row = created.json().schedule as Schedule;
    expect(row.owner).toEqual(OWNER);

    const stale = await app.inject({
      method: 'POST', url: `/api/schedules/${row.id}/arm`,
      payload: { expectedVersion: 9, idempotencyKey: 'arm-stale', armed: true },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'stale-schedule-version' });

    const armed = await app.inject({
      method: 'POST', url: `/api/schedules/${row.id}/arm`,
      payload: { expectedVersion: 1, idempotencyKey: 'arm-current', armed: true },
    });
    expect(armed.statusCode).toBe(200);
    expect(armed.json()).toMatchObject({ schedule: { armed: true, version: 2 }, collectionRevision: 2 });
    await app.close();
  });

  it('normalizes valid cadence input and refuses invalid preview before mutation', async () => {
    expect(normalizeCadenceInput({ kind: 'words', words: 'daily', time: '09:15' })).toEqual({
      source: '15 9 * * *', words: 'Daily \u00b7 9:15 AM',
    });
    expect(normalizeCadenceInput({ kind: 'cron', minute: '*/15', hour: '*', dayOfMonth: '*', month: '*', dayOfWeek: '*' })).toEqual({
      source: '*/15 * * * *', words: 'Every 15 minutes',
    });
    const store = new MemoryScheduleStore();
    await expect(service(store).create({
      ...CREATE,
      cadence: { kind: 'cron', minute: '60', hour: '9', dayOfMonth: '*', month: '*', dayOfWeek: '*' },
    })).rejects.toMatchObject({ status: 400, code: 'invalid-cadence' });
    expect(store.snapshot.schedules).toEqual([]);
  });

  it('looks up create replay first in the transaction and conflicts on a changed body', async () => {
    const store = new MemoryScheduleStore();
    const resolveOwner = vi.fn(async () => OWNER);
    const api = service(store, false, resolveOwner);
    const first = await api.create(CREATE);
    expect(first.schedule.id).toBe(createHash('sha256').update('schedule\0operator\0agent\0hygiene\0operator-key-1').digest('hex'));
    expect(store.order.slice(0, 5)).toEqual(['transaction', 'receipt', 'create', 'write-receipt']);

    store.order.length = 0;
    resolveOwner.mockRejectedValueOnce(new Error('mutable roster unavailable'));
    await expect(api.create(CREATE)).resolves.toMatchObject({ replayed: true, collectionRevision: 1 });
    expect(store.order).toEqual(['transaction', 'receipt']);

    store.order.length = 0;
    await expect(api.create({ ...CREATE, cadence: { kind: 'words', words: 'daily', time: '10:15' } }))
      .rejects.toMatchObject({ status: 409, code: 'idempotency-conflict' });
    expect(store.order).toEqual(['transaction', 'receipt']);
  });

  it('replays arm/disarm before stale CAS and conflicts on a changed body', async () => {
    const store = new MemoryScheduleStore();
    const api = service(store);
    const created = await api.create(CREATE);
    const input = { expectedVersion: 1, idempotencyKey: 'arm-1', armed: true };
    await expect(api.setArmed(created.schedule.id, input)).resolves.toMatchObject({ schedule: { version: 2, armed: true } });

    store.order.length = 0;
    await expect(api.setArmed(created.schedule.id, input)).resolves.toMatchObject({ replayed: true, schedule: { version: 2 } });
    expect(store.order).toEqual(['transaction', 'receipt']);

    store.order.length = 0;
    await expect(api.setArmed(created.schedule.id, { ...input, armed: false }))
      .rejects.toMatchObject({ status: 409, code: 'idempotency-conflict' });
    expect(store.order).toEqual(['transaction', 'receipt']);
  });

  it('replays delete before 404 and conflicts on a changed body', async () => {
    const store = new MemoryScheduleStore();
    const api = service(store);
    const created = await api.create(CREATE);
    const input = { expectedVersion: 1, idempotencyKey: 'delete-1' };
    await expect(api.delete(created.schedule.id, input)).resolves.toMatchObject({ tombstone: { version: 2 } });

    store.order.length = 0;
    await expect(api.delete(created.schedule.id, input)).resolves.toMatchObject({ replayed: true, tombstone: { version: 2 } });
    expect(store.order).toEqual(['transaction', 'receipt']);

    store.order.length = 0;
    await expect(api.delete(created.schedule.id, { ...input, expectedVersion: 2 }))
      .rejects.toMatchObject({ status: 409, code: 'idempotency-conflict' });
    expect(store.order).toEqual(['transaction', 'receipt']);
  });

  it('applies row CAS and returns the exact protected-main 409 for an unauthorized seed arm', async () => {
    const store = new MemoryScheduleStore();
    store.snapshot = {
      collectionRevision: 4,
      schedules: [{
        id: 'a'.repeat(64), owner: OWNER, cadence: { source: '15 3 * * 0', words: 'Sun \u00b7 3:15 AM' },
        nextAt: null, lastOutcome: null, armed: false, origin: 'seed', mirroredAt: null,
        mirrorPath: 'HEARTBEAT.md', version: 2,
      }],
    };
    const api = service(store, false);
    await expect(api.setArmed('a'.repeat(64), { expectedVersion: 1, idempotencyKey: 'stale', armed: true }))
      .rejects.toMatchObject({ status: 409, code: 'stale-schedule-version' });
    await expect(api.setArmed('a'.repeat(64), { expectedVersion: 2, idempotencyKey: 'arm-seed', armed: true }))
      .rejects.toMatchObject({ status: 409, code: 'seed-not-on-protected-main' });
    expect(store.snapshot.schedules[0].armed).toBe(false);
  });

  it('validates expectedVersion in the same transaction before creating a claim', async () => {
    const store = new MemoryScheduleStore();
    const schedule: Schedule = {
      id: 'a'.repeat(64), owner: OWNER, cadence: { source: '*/15 * * * *', words: 'Every 15 minutes' },
      nextAt: '2026-08-21T12:30:00-04:00', lastOutcome: null, armed: true, origin: 'seed',
      mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 3,
    };
    store.snapshot = { collectionRevision: 7, schedules: [schedule] };
    const api = service(store, true);
    const input: ClaimScheduleOccurrenceInput = {
      occurrence: {
        scheduleId: schedule.id,
        scheduledFor: '2026-08-21T12:15:00-04:00',
        nextAt: '2026-08-21T12:30:00-04:00',
      },
      expectedVersion: 2,
      idempotencyKey: 'claim-stale',
    };
    await expect(api.claimScheduleOccurrence(input))
      .rejects.toMatchObject({ status: 409, code: 'stale-schedule-version' });
    expect(store.order).toEqual(['transaction', 'snapshot']);
    expect(store.claimEmissions).toBe(0);

    store.order.length = 0;
    await expect(api.claimScheduleOccurrence({ ...input, expectedVersion: 3, idempotencyKey: 'claim-current' }))
      .resolves.toMatchObject({ scheduleId: schedule.id, phase: 'claimed' });
    expect(store.order).toEqual(['transaction', 'snapshot', 'claim']);
    expect(store.claimEmissions).toBe(1);
  });

  it('keeps a deleted schedule owner non-firing by refusing GET rows and occurrence claims', async () => {
    const store = new MemoryScheduleStore();
    const schedule: Schedule = {
      id: 'c'.repeat(64), owner: OWNER, cadence: { source: '*/15 * * * *', words: 'Every 15 minutes' },
      nextAt: '2026-08-21T12:30:00-04:00', lastOutcome: null, armed: true, origin: 'operator',
      mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 3,
    };
    store.snapshot = { collectionRevision: 7, schedules: [schedule] };
    const api = service(store, true, async () => null);

    await expect(api.list()).rejects.toMatchObject({ status: 409, code: 'schedule-owner-unresolvable' });
    await expect(api.claimScheduleOccurrence({
      occurrence: { scheduleId: schedule.id, scheduledFor: '2026-08-21T12:15:00-04:00', nextAt: schedule.nextAt! },
      expectedVersion: schedule.version,
      idempotencyKey: 'deleted-owner-claim',
    })).rejects.toMatchObject({ status: 409, code: 'schedule-owner-unresolvable' });
    expect(store.claimEmissions).toBe(0);
  });

  it('recovers the higher watermark, accepts one survivor, and ignores mirror outage when live exists', () => {
    const live: ScheduleSnapshot = { collectionRevision: 8, schedules: [] };
    const state: ScheduleSnapshot = { collectionRevision: 12, schedules: [] };
    const mirror: ScheduleSnapshot = { collectionRevision: 10, schedules: [] };
    expect(selectScheduleRecoverySnapshot({ live, stateSnapshot: state, mergedMirror: mirror })).toMatchObject({ source: 'state-snapshot', snapshot: state });
    expect(selectScheduleRecoverySnapshot({ live: null, stateSnapshot: null, mergedMirror: mirror })).toMatchObject({ source: 'merged-mirror', snapshot: mirror });
    expect(selectScheduleRecoverySnapshot({ live, stateSnapshot: null, mergedMirror: null })).toMatchObject({ source: 'live', snapshot: live });
  });
});

import type { RunnableRef, Schedule } from '../../server/control/p2Contracts.ts';
import type {
  CreateScheduleInput,
  DeleteScheduleInput,
  DeleteScheduleReceipt,
  ScheduleCollection,
  ScheduleMutationReceipt,
  SetScheduleArmedInput,
} from '../../server/schedules/contracts.ts';
import { invalidateSessionOnGovernedAuthFailure } from './authClient.ts';
import { record, exactKeys } from './decodeGuards.ts';

interface ScheduleResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type ScheduleFetch = (input: string, init?: RequestInit) => Promise<ScheduleResponseLike>;

export class ScheduleClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.name = 'ScheduleClientError';
  }
}


function validIso(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

function runnable(value: unknown): RunnableRef | null {
  const ref = record(value);
  if (!ref || typeof ref.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(ref.id)) return null;
  if (ref.type === 'agent' && exactKeys(ref, ['type', 'id', 'sourcePath'])
    && ref.sourcePath === `agents/${ref.id}.md`) return { type: 'agent', id: ref.id, sourcePath: ref.sourcePath as `agents/${string}.md` };
  if (ref.type === 'workflow' && exactKeys(ref, ['type', 'id', 'project', 'sourcePath'])
    && typeof ref.project === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(ref.project)
    && ref.sourcePath === `orgs/${ref.project}/workflows/${ref.id}.md`) {
    return { type: 'workflow', id: ref.id, project: ref.project, sourcePath: ref.sourcePath as `orgs/${string}/workflows/${string}.md` };
  }
  return null;
}

function schedule(value: unknown): Schedule | null {
  const row = record(value);
  if (!row || !exactKeys(row, ['id', 'owner', 'cadence', 'nextAt', 'lastOutcome', 'armed', 'origin', 'mirroredAt', 'mirrorPath', 'version'])) return null;
  const owner = runnable(row.owner);
  const cadence = record(row.cadence);
  if (!owner || !cadence || !exactKeys(cadence, ['source', 'words']) || typeof cadence.source !== 'string' || typeof cadence.words !== 'string') return null;
  if (typeof row.id !== 'string' || !/^[0-9a-f]{64}$/.test(row.id)
    || (row.nextAt !== null && !validIso(row.nextAt))
    || (row.lastOutcome !== null && !['ok', 'failed', 'stopped', 'interrupted', 'abandoned'].includes(String(row.lastOutcome)))
    || typeof row.armed !== 'boolean' || (row.origin !== 'seed' && row.origin !== 'operator')
    || (row.mirroredAt !== null && !validIso(row.mirroredAt))
    || (row.mirrorPath !== 'HEARTBEAT.md' && !(typeof row.mirrorPath === 'string' && /^orgs\/[a-z0-9][a-z0-9-]*\/HEARTBEAT\.md$/.test(row.mirrorPath)))
    || !Number.isSafeInteger(row.version) || Number(row.version) < 1) return null;
  return {
    id: row.id,
    owner,
    cadence: { source: cadence.source, words: cadence.words },
    nextAt: row.nextAt as string | null,
    lastOutcome: row.lastOutcome as Schedule['lastOutcome'],
    armed: row.armed,
    origin: row.origin,
    mirroredAt: row.mirroredAt as string | null,
    mirrorPath: row.mirrorPath as Schedule['mirrorPath'],
    version: row.version as number,
  };
}

export function decodeScheduleCollection(value: unknown): ScheduleCollection {
  const body = record(value);
  if (!body || !exactKeys(body, ['scheduleCollectionRevision', 'rows'])
    || !Number.isSafeInteger(body.scheduleCollectionRevision) || Number(body.scheduleCollectionRevision) < 0
    || !Array.isArray(body.rows)) throw new Error('Invalid Schedule response');
  const rows = body.rows.map(schedule);
  if (rows.some((row) => row === null)) throw new Error('Invalid Schedule response');
  return { scheduleCollectionRevision: body.scheduleCollectionRevision as number, rows: rows as Schedule[] };
}

function decodeMutation(value: unknown): ScheduleMutationReceipt {
  const body = record(value);
  const row = body ? schedule(body.schedule) : null;
  if (!body || !exactKeys(body, ['schedule', 'collectionRevision', 'replayed']) || !row
    || !Number.isSafeInteger(body.collectionRevision) || Number(body.collectionRevision) < 0
    || typeof body.replayed !== 'boolean') throw new Error('Invalid Schedule response');
  return { schedule: row, collectionRevision: body.collectionRevision as number, replayed: body.replayed };
}

function decodeDelete(value: unknown): DeleteScheduleReceipt {
  const body = record(value);
  const tombstone = body ? record(body.tombstone) : null;
  if (!body || !exactKeys(body, ['tombstone', 'collectionRevision', 'replayed']) || !tombstone
    || !exactKeys(tombstone, ['id', 'deletedAt', 'version'])
    || typeof tombstone.id !== 'string' || !/^[0-9a-f]{64}$/.test(tombstone.id)
    || !validIso(tombstone.deletedAt) || !Number.isSafeInteger(tombstone.version) || Number(tombstone.version) < 1
    || !Number.isSafeInteger(body.collectionRevision) || Number(body.collectionRevision) < 0
    || typeof body.replayed !== 'boolean') throw new Error('Invalid Schedule response');
  return {
    tombstone: { id: tombstone.id, deletedAt: tombstone.deletedAt, version: tombstone.version as number },
    collectionRevision: body.collectionRevision as number,
    replayed: body.replayed,
  };
}

async function bodyOrError(response: ScheduleResponseLike): Promise<unknown> {
  const body = await response.json();
  if (response.ok) return body;
  await invalidateSessionOnGovernedAuthFailure(response as Response);
  const error = record(body);
  throw new ScheduleClientError(response.status, typeof error?.error === 'string' ? error.error : 'schedule-request-failed');
}

function headers(token: string): HeadersInit {
  return { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

export async function fetchSchedules(token: string, fetchImpl: ScheduleFetch = fetch): Promise<ScheduleCollection> {
  const response = await fetchImpl('/api/schedules', { headers: headers(token) });
  return decodeScheduleCollection(await bodyOrError(response));
}

export async function createSchedule(token: string, input: CreateScheduleInput, fetchImpl: ScheduleFetch = fetch): Promise<ScheduleMutationReceipt> {
  const response = await fetchImpl('/api/schedules', { method: 'POST', headers: headers(token), body: JSON.stringify(input) });
  return decodeMutation(await bodyOrError(response));
}

export async function setScheduleArmed(token: string, id: string, input: SetScheduleArmedInput, fetchImpl: ScheduleFetch = fetch): Promise<ScheduleMutationReceipt> {
  const action = input.armed ? 'arm' : 'disarm';
  const response = await fetchImpl(`/api/schedules/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: headers(token), body: JSON.stringify(input) });
  return decodeMutation(await bodyOrError(response));
}

export async function deleteSchedule(token: string, id: string, input: DeleteScheduleInput, fetchImpl: ScheduleFetch = fetch): Promise<DeleteScheduleReceipt> {
  const response = await fetchImpl(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers(token), body: JSON.stringify(input) });
  return decodeDelete(await bodyOrError(response));
}

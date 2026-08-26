// P6 W2 [design:435] — the pure schedule service extracted from `registerScheduleRoutes`
// (`schedules/service.ts:357,375,381,388`). Each function reproduces one handler's success + refusal
// matrix byte-for-byte over an injected `ScheduleService`-shaped port: the list ETag/304, the closed
// create/arm/disarm/delete body walls, and the `ScheduleServiceError` status/code mapping. W6.2 makes
// the routes thin callers; W2 only BUILDS the service + its characterization test. No route file edited.

import type {
  CreateScheduleInput, DeleteScheduleInput, ScheduleSnapshot, SetScheduleArmedInput,
} from '../schedules/contracts.ts';
import { record, exactKeys } from '../shared/decode.ts';

/** The service surface the routes drive; a structural subset of the shipped `ScheduleService`. */
export interface ScheduleServicePort {
  list(): Promise<ScheduleSnapshot>;
  create(input: CreateScheduleInput): Promise<unknown>;
  setArmed(id: string, input: SetScheduleArmedInput): Promise<unknown>;
  delete(id: string, input: DeleteScheduleInput): Promise<unknown>;
}

/** The normalized reply the route wrapper sends. `status:304` carries no body; `etag` sets the header. */
export interface ServiceReply {
  readonly status: number;
  readonly body?: unknown;
  readonly etag?: string;
}

function idempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

/** Closed create-body wall (`schedules/service.ts#createBody`), reproduced so an extra key is `null`. */
export function createBody(value: unknown): CreateScheduleInput | null {
  const body = record(value);
  if (!body || !exactKeys(body, ['owner', 'cadence', 'expectedCollectionRevision', 'idempotencyKey'])
    || !Number.isSafeInteger(body.expectedCollectionRevision) || Number(body.expectedCollectionRevision) < 0
    || !idempotencyKey(body.idempotencyKey)) return null;
  const owner = record(body.owner);
  if (!owner || !exactKeys(owner, ['type', 'id'])
    || (owner.type !== 'agent' && owner.type !== 'workflow')
    || typeof owner.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(owner.id)) return null;
  const cadence = record(body.cadence);
  if (!cadence || typeof cadence.kind !== 'string') return null;
  if (cadence.kind === 'words') {
    if (!exactKeys(cadence, ['kind', 'words', 'time']) || typeof cadence.words !== 'string' || typeof cadence.time !== 'string') return null;
  } else if (cadence.kind === 'cron') {
    if (!exactKeys(cadence, ['kind', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'])
      || ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'].some((key) => typeof cadence[key] !== 'string')) return null;
  } else return null;
  return body as unknown as CreateScheduleInput;
}

export function armedBody(value: unknown, armed: boolean): SetScheduleArmedInput | null {
  const body = record(value);
  return body && exactKeys(body, ['expectedVersion', 'idempotencyKey', 'armed'])
    && Number.isSafeInteger(body.expectedVersion) && Number(body.expectedVersion) >= 1
    && idempotencyKey(body.idempotencyKey) && body.armed === armed
    ? body as unknown as SetScheduleArmedInput : null;
}

export function deleteBody(value: unknown): DeleteScheduleInput | null {
  const body = record(value);
  return body && exactKeys(body, ['expectedVersion', 'idempotencyKey'])
    && Number.isSafeInteger(body.expectedVersion) && Number(body.expectedVersion) >= 1
    && idempotencyKey(body.idempotencyKey)
    ? body as unknown as DeleteScheduleInput : null;
}

export function scheduleIdParam(id: unknown): string | null {
  return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) ? id : null;
}

/** `ScheduleServiceError`-shaped mapping (`schedules/service.ts#routeResult`): any error carrying an
 *  integer `status` and a string `code` becomes `{status, body:{error:code}}`; anything else rethrows. */
function mapError(error: unknown): ServiceReply {
  const candidate = record(error);
  if (candidate && Number.isInteger((error as { status?: unknown }).status)
    && typeof (error as { code?: unknown }).code === 'string') {
    return { status: (error as { status: number }).status, body: { error: (error as { code: string }).code } };
  }
  throw error;
}

async function run(operation: () => Promise<unknown>, success: number): Promise<ServiceReply> {
  try {
    return { status: success, body: await operation() };
  } catch (error) {
    return mapError(error);
  }
}

/** GET /api/schedules — list with the `"schedules:<rev>"` ETag/304. */
export async function listSchedules(port: ScheduleServicePort, ifNoneMatch: string | undefined): Promise<ServiceReply> {
  let snapshot: ScheduleSnapshot;
  try {
    snapshot = await port.list();
  } catch (error) {
    return mapError(error);
  }
  const etag = `"schedules:${snapshot.collectionRevision}"`;
  if (ifNoneMatch === etag) return { status: 304, etag };
  return { status: 200, etag, body: { scheduleCollectionRevision: snapshot.collectionRevision, rows: snapshot.schedules } };
}

/** POST /api/schedules — closed create body then `service.create`. */
export async function createSchedule(port: ScheduleServicePort, body: unknown): Promise<ServiceReply> {
  const input = createBody(body);
  if (!input) return { status: 400, body: { error: 'invalid-schedule-create-body' } };
  return run(() => port.create(input), 201);
}

/** POST /api/schedules/:id/(arm|disarm) — closed armed body then `service.setArmed`. */
export async function setScheduleArmed(port: ScheduleServicePort, idParam: unknown, body: unknown, armed: boolean): Promise<ServiceReply> {
  const id = scheduleIdParam(idParam);
  const input = armedBody(body, armed);
  if (!id || !input) return { status: 400, body: { error: 'invalid-schedule-arm-body' } };
  return run(() => port.setArmed(id, input), 200);
}

/** DELETE /api/schedules/:id — closed delete body then `service.delete`. */
export async function deleteSchedule(port: ScheduleServicePort, idParam: unknown, body: unknown): Promise<ServiceReply> {
  const id = scheduleIdParam(idParam);
  const input = deleteBody(body);
  if (!id || !input) return { status: 400, body: { error: 'invalid-schedule-delete-body' } };
  return run(() => port.delete(id, input), 200);
}

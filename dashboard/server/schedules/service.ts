import { createHash } from 'node:crypto';
import type { RunnableRef } from '../control/p2Contracts.ts';
import type { RunnableSelector } from '../entities/contracts.ts';
import type {
  CadenceInput,
  ClaimScheduleOccurrenceInput,
  CreateScheduleInput,
  DeleteScheduleInput,
  DeleteScheduleReceipt,
  ScheduleMutationReceipt,
  ScheduleOccurrenceClaim,
  ScheduleSnapshot,
  ScheduleStorePort,
  SetScheduleArmedInput,
} from './contracts.ts';

export class ScheduleServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) {
    super(message);
    this.name = 'ScheduleServiceError';
  }
}

export interface ScheduleServiceOptions {
  store: AtomicScheduleStorePort;
  resolveOwner(selector: RunnableSelector): Promise<RunnableRef | null>;
  seedAuthorization(scheduleId: string): Promise<boolean>;
}

export type ScheduleMutationOperation = 'create' | 'set-armed' | 'delete';

export interface ScheduleMutationReceiptKey {
  operation: ScheduleMutationOperation;
  target: string;
  idempotencyKey: string;
}

export interface StoredScheduleMutationReceipt {
  fingerprint: string;
  receipt: ScheduleMutationReceipt | DeleteScheduleReceipt;
}

export interface ScheduleMutationTransaction extends Pick<
ScheduleStorePort,
'readScheduleSnapshot' | 'createSchedule' | 'setScheduleArmed' | 'deleteSchedule' | 'claimScheduleOccurrence'
> {
  readMutationReceipt(key: ScheduleMutationReceiptKey): Promise<StoredScheduleMutationReceipt | null>;
  writeMutationReceipt(
    key: ScheduleMutationReceiptKey,
    fingerprint: string,
    receipt: ScheduleMutationReceipt | DeleteScheduleReceipt,
  ): Promise<void>;
}

export interface AtomicScheduleStorePort extends ScheduleStorePort {
  transaction<T>(operation: (transaction: ScheduleMutationTransaction) => Promise<T>): Promise<T>;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_NAME = new Map<string, number>(DAYS.map((day, index) => [day, index]));

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function atom(value: string, minimum: number, maximum: number, names?: ReadonlyMap<string, number>): number | null {
  const normalized = value.toLowerCase();
  const parsed = names?.get(normalized) ?? (/^\d+$/.test(normalized) ? Number(normalized) : Number.NaN);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function cronField(value: string, minimum: number, maximum: number, names?: ReadonlyMap<string, number>): boolean {
  if (value === '') return false;
  return value.split(',').every((part) => {
    const [range, stepText, ...extraStep] = part.split('/');
    if (extraStep.length > 0 || (stepText !== undefined && (!/^\d+$/.test(stepText) || Number(stepText) < 1))) return false;
    if (range === '*') return true;
    const bounds = range.split('-');
    if (bounds.length > 2) return false;
    const start = atom(bounds[0], minimum, maximum, names);
    const end = bounds.length === 2 ? atom(bounds[1], minimum, maximum, names) : start;
    return start !== null && end !== null && end >= start;
  });
}

export function validCron(source: string): boolean {
  const fields = source.trim().split(/\s+/);
  return fields.length === 5
    && cronField(fields[0], 0, 59)
    && cronField(fields[1], 0, 23)
    && cronField(fields[2], 1, 31)
    && cronField(fields[3], 1, 12)
    && cronField(fields[4], 0, 7, DAY_NAME);
}

function cronWords(source: string): string {
  const fields = source.split(/\s+/);
  const everyMinutes = /^\*\/(\d+)$/.exec(fields[0]);
  if (everyMinutes && fields.slice(1).every((field) => field === '*')) return `Every ${Number(everyMinutes[1])} minutes`;
  if (/^\d+$/.test(fields[0]) && /^\d+$/.test(fields[1]) && fields[2] === '*' && fields[3] === '*') {
    const time = formatTime(Number(fields[1]), Number(fields[0]));
    if (fields[4] === '*') return `Daily · ${time}`;
    if (fields[4].toLowerCase() === 'mon-fri') return `Every weekday (Mon–Fri) · ${time}`;
    const day = DAY_NAME.has(fields[4].toLowerCase()) ? fields[4].slice(0, 3) : fields[4];
    return `${day.charAt(0).toUpperCase()}${day.slice(1).toLowerCase()} · ${time}`;
  }
  return source;
}

export function normalizeCadenceInput(input: CadenceInput): { source: string; words: string } {
  if (input.kind === 'words') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new ScheduleServiceError(400, 'invalid-cadence');
    const [hour, minute] = input.time.split(':').map(Number);
    const words = input.words.trim().toLowerCase();
    let dayField: string;
    if (words === 'daily') dayField = '*';
    else if (words === 'weekday' || words === 'weekdays') dayField = 'mon-fri';
    else {
      const weekly = /^weekly:([a-z]+)$/.exec(words);
      if (!weekly || !DAY_NAME.has(weekly[1].slice(0, 3))) throw new ScheduleServiceError(400, 'invalid-cadence');
      dayField = weekly[1].slice(0, 3);
    }
    const source = `${minute} ${hour} * * ${dayField}`;
    return { source, words: cronWords(source) };
  }
  const source = [input.minute, input.hour, input.dayOfMonth, input.month, input.dayOfWeek].join(' ').trim();
  if (!validCron(source)) throw new ScheduleServiceError(400, 'invalid-cadence');
  return { source, words: cronWords(source) };
}

export function operatorScheduleId(owner: Pick<RunnableRef, 'type' | 'id'>, clientIdempotencyKey: string): string {
  return createHash('sha256')
    .update(`schedule\0operator\0${owner.type}\0${owner.id}\0${clientIdempotencyKey}`, 'utf8')
    .digest('hex');
}

function sameOwner(left: RunnableRef, right: RunnableRef): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalValue(child)]));
}

function mutationFingerprint(key: ScheduleMutationReceiptKey, input: unknown): string {
  return createHash('sha256')
    .update(`schedule-mutation\0${key.operation}\0${key.target}\0${JSON.stringify(canonicalValue(input))}`, 'utf8')
    .digest('hex');
}

function replayedReceipt<T extends ScheduleMutationReceipt | DeleteScheduleReceipt>(
  stored: StoredScheduleMutationReceipt | null,
  fingerprint: string,
  kind: 'schedule' | 'delete',
): T | null {
  if (!stored) return null;
  if (stored.fingerprint !== fingerprint) throw new ScheduleServiceError(409, 'idempotency-conflict');
  const receipt = stored.receipt;
  if ((kind === 'schedule' && !('schedule' in receipt)) || (kind === 'delete' && !('tombstone' in receipt))) {
    throw new ScheduleServiceError(500, 'schedule-mutation-receipt-invalid');
  }
  return { ...structuredClone(receipt), replayed: true } as T;
}

export class ScheduleService {
  constructor(private readonly options: ScheduleServiceOptions) {}

  list(): Promise<ScheduleSnapshot> { return this.options.store.readScheduleSnapshot(); }

  async create(input: CreateScheduleInput): Promise<ScheduleMutationReceipt> {
    const key: ScheduleMutationReceiptKey = {
      operation: 'create', target: `${input.owner.type}:${input.owner.id}`, idempotencyKey: input.idempotencyKey,
    };
    const fingerprint = mutationFingerprint(key, input);
    return this.options.store.transaction(async (transaction) => {
      const prior = replayedReceipt<ScheduleMutationReceipt>(
        await transaction.readMutationReceipt(key), fingerprint, 'schedule',
      );
      if (prior) return prior;
      normalizeCadenceInput(input.cadence);
      const owner = await this.options.resolveOwner(input.owner);
      if (!owner) throw new ScheduleServiceError(409, 'schedule-owner-unresolvable');
      const receipt = await transaction.createSchedule(input);
      if (!sameOwner(receipt.schedule.owner, owner)
        || receipt.schedule.id !== operatorScheduleId(owner, input.idempotencyKey)) {
        throw new ScheduleServiceError(409, 'schedule-store-owner-conflict');
      }
      await transaction.writeMutationReceipt(key, fingerprint, receipt);
      return receipt;
    });
  }

  async setArmed(id: string, input: SetScheduleArmedInput): Promise<ScheduleMutationReceipt> {
    const key: ScheduleMutationReceiptKey = { operation: 'set-armed', target: id, idempotencyKey: input.idempotencyKey };
    const fingerprint = mutationFingerprint(key, input);
    return this.options.store.transaction(async (transaction) => {
      const prior = replayedReceipt<ScheduleMutationReceipt>(
        await transaction.readMutationReceipt(key), fingerprint, 'schedule',
      );
      if (prior) return prior;
      const snapshot = await transaction.readScheduleSnapshot();
      const schedule = snapshot.schedules.find((row) => row.id === id);
      if (!schedule) throw new ScheduleServiceError(404, 'schedule-not-found');
      if (schedule.version !== input.expectedVersion) throw new ScheduleServiceError(409, 'stale-schedule-version');
      if (input.armed && schedule.origin === 'seed' && !(await this.options.seedAuthorization(schedule.id))) {
        throw new ScheduleServiceError(409, 'seed-not-on-protected-main');
      }
      const receipt = await transaction.setScheduleArmed(id, input);
      await transaction.writeMutationReceipt(key, fingerprint, receipt);
      return receipt;
    });
  }

  async delete(id: string, input: DeleteScheduleInput): Promise<DeleteScheduleReceipt> {
    const key: ScheduleMutationReceiptKey = { operation: 'delete', target: id, idempotencyKey: input.idempotencyKey };
    const fingerprint = mutationFingerprint(key, input);
    return this.options.store.transaction(async (transaction) => {
      const prior = replayedReceipt<DeleteScheduleReceipt>(
        await transaction.readMutationReceipt(key), fingerprint, 'delete',
      );
      if (prior) return prior;
      const snapshot = await transaction.readScheduleSnapshot();
      const schedule = snapshot.schedules.find((row) => row.id === id);
      if (!schedule) throw new ScheduleServiceError(404, 'schedule-not-found');
      if (schedule.version !== input.expectedVersion) throw new ScheduleServiceError(409, 'stale-schedule-version');
      const receipt = await transaction.deleteSchedule(id, input);
      await transaction.writeMutationReceipt(key, fingerprint, receipt);
      return receipt;
    });
  }

  async claimScheduleOccurrence(input: ClaimScheduleOccurrenceInput): Promise<ScheduleOccurrenceClaim> {
    return this.options.store.transaction(async (transaction) => {
      const snapshot = await transaction.readScheduleSnapshot();
      const schedule = snapshot.schedules.find((row) => row.id === input.occurrence.scheduleId);
      if (!schedule) throw new ScheduleServiceError(404, 'schedule-not-found');
      if (schedule.version !== input.expectedVersion) throw new ScheduleServiceError(409, 'stale-schedule-version');
      if (!schedule.armed) throw new ScheduleServiceError(409, 'schedule-not-armed');
      return transaction.claimScheduleOccurrence(input);
    });
  }
}

function sameRunnable(left: RunnableRef, right: RunnableRef): boolean {
  return left.type === right.type && left.id === right.id && left.sourcePath === right.sourcePath
    && (left.type === 'agent' || right.type === 'agent' || left.project === right.project);
}

/** Read-only entity projection over W4's schedule service/store collection. */
export function nextScheduleOccurrence(
  readSide: { getScheduleSnapshot(): ScheduleSnapshot },
  owner: RunnableRef,
): import('../control/p2Contracts.ts').ScheduleOccurrence | null {
  const next = readSide.getScheduleSnapshot().schedules
    .filter((schedule) => schedule.armed && schedule.nextAt !== null && sameRunnable(schedule.owner, owner))
    .sort((left, right) => left.nextAt!.localeCompare(right.nextAt!) || left.id.localeCompare(right.id))[0];
  return next?.nextAt ? { scheduleId: next.id, scheduledFor: next.nextAt, nextAt: next.nextAt } : null;
}

type RecoverySource = 'live' | 'state-snapshot' | 'merged-mirror';

export function selectScheduleRecoverySnapshot(input: {
  live: ScheduleSnapshot | null;
  stateSnapshot: ScheduleSnapshot | null;
  mergedMirror: ScheduleSnapshot | null;
}): { source: RecoverySource; snapshot: ScheduleSnapshot } {
  const candidates: Array<{ source: RecoverySource; snapshot: ScheduleSnapshot }> = [];
  if (input.live) candidates.push({ source: 'live', snapshot: input.live });
  if (input.stateSnapshot) candidates.push({ source: 'state-snapshot', snapshot: input.stateSnapshot });
  if (input.mergedMirror) candidates.push({ source: 'merged-mirror', snapshot: input.mergedMirror });
  if (candidates.length === 0) throw new ScheduleServiceError(503, 'schedule-recovery-source-unavailable');
  candidates.sort((left, right) => right.snapshot.collectionRevision - left.snapshot.collectionRevision
    || ['live', 'state-snapshot', 'merged-mirror'].indexOf(left.source) - ['live', 'state-snapshot', 'merged-mirror'].indexOf(right.source));
  return candidates[0];
}

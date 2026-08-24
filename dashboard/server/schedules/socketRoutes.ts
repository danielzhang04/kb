import { chmodSync, existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import type {
  ClaimScheduleOccurrenceInput,
  CompleteScheduleOccurrenceInput,
  ScheduleMutationReceipt,
  ScheduleOccurrenceClaim,
  ScheduleStorePort,
} from './contracts.ts';

const nodeRequire = createRequire(import.meta.url);
const PROTOCOL_VERSION = 1 as const;
const MAX_REQUEST_BYTES = 64 * 1024;
const SOL_SOCKET = 1;
const SO_PEERCRED = 17;

export class ScheduleSocketError extends Error {
  readonly code: string;

  constructor(code: string, message: string = code) {
    super(message);
    this.code = code;
    this.name = 'ScheduleSocketError';
  }
}

type SnapshotRequest = { version: 1; operation: 'snapshot' };
type ClaimRequest = {
  version: 1;
  operation: 'claim';
  scheduleId: string;
  scheduledFor: string;
  nextAt: string;
  expectedVersion: number;
  idempotencyKey: string;
};
type AdvanceRequest = {
  version: 1;
  operation: 'advance';
  scheduleId: string;
  scheduledFor: string;
  nextAt: string;
  phase: 'card-saved' | 'ledger-appended';
  idempotencyKey: string;
};
type CompleteRequest = {
  version: 1;
  operation: 'complete';
  scheduleId: string;
  scheduledFor: string;
  runRef: string;
  lastOutcome: 'ok' | 'failed' | 'stopped' | 'interrupted' | 'abandoned';
  nextAt: string | null;
  idempotencyKey: string;
};
type ScheduleSocketRequest = SnapshotRequest | ClaimRequest | AdvanceRequest | CompleteRequest;

export interface AdvanceScheduleOccurrenceInput {
  scheduleId: string;
  scheduledFor: string;
  nextAt: string;
  phase: 'card-saved' | 'ledger-appended';
  idempotencyKey: string;
}

export interface ScheduleSocketStorePort extends ScheduleStorePort {
  advanceScheduleOccurrence(input: AdvanceScheduleOccurrenceInput): Promise<ScheduleOccurrenceClaim>;
}

export type ScheduleSocketRuntimeCapability =
  | { available: true }
  | { available: false; reason: 'linux-so-peercred-required' };

export function scheduleSocketRuntimeCapability(): ScheduleSocketRuntimeCapability {
  return process.platform === 'linux'
    ? { available: true }
    : { available: false, reason: 'linux-so-peercred-required' };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function validOccurrence(input: Record<string, unknown>): boolean {
  return typeof input.scheduleId === 'string' && /^[0-9a-f]{64}$/.test(input.scheduleId)
    && validIso(input.scheduledFor) && validIso(input.nextAt);
}

function parseRequest(value: unknown): ScheduleSocketRequest {
  const input = record(value);
  if (!input || input.version !== PROTOCOL_VERSION || typeof input.operation !== 'string') {
    throw new ScheduleSocketError('schedule-socket-request-invalid');
  }
  if (input.operation === 'snapshot' && exactKeys(input, ['version', 'operation'])) {
    return { version: 1, operation: 'snapshot' };
  }
  if (input.operation === 'claim'
    && exactKeys(input, ['version', 'operation', 'scheduleId', 'scheduledFor', 'nextAt', 'expectedVersion', 'idempotencyKey'])
    && validOccurrence(input)
    && Number.isSafeInteger(input.expectedVersion) && Number(input.expectedVersion) >= 1
    && validIdempotencyKey(input.idempotencyKey)) {
    return {
      version: 1, operation: 'claim', scheduleId: input.scheduleId as string,
      scheduledFor: input.scheduledFor as string, nextAt: input.nextAt as string,
      expectedVersion: input.expectedVersion as number, idempotencyKey: input.idempotencyKey,
    };
  }
  if (input.operation === 'advance'
    && exactKeys(input, ['version', 'operation', 'scheduleId', 'scheduledFor', 'nextAt', 'phase', 'idempotencyKey'])
    && validOccurrence(input)
    && (input.phase === 'card-saved' || input.phase === 'ledger-appended')
    && validIdempotencyKey(input.idempotencyKey)) {
    return {
      version: 1, operation: 'advance', scheduleId: input.scheduleId as string,
      scheduledFor: input.scheduledFor as string, nextAt: input.nextAt as string,
      phase: input.phase, idempotencyKey: input.idempotencyKey,
    };
  }
  if (input.operation === 'complete'
    && exactKeys(input, ['version', 'operation', 'scheduleId', 'scheduledFor', 'runRef', 'lastOutcome', 'nextAt', 'idempotencyKey'])
    && typeof input.scheduleId === 'string' && /^[0-9a-f]{64}$/.test(input.scheduleId)
    && validIso(input.scheduledFor) && typeof input.runRef === 'string' && input.runRef !== ''
    && ['ok', 'failed', 'stopped', 'interrupted', 'abandoned'].includes(String(input.lastOutcome))
    && (input.nextAt === null || validIso(input.nextAt))
    && validIdempotencyKey(input.idempotencyKey)) {
    return {
      version: 1, operation: 'complete', scheduleId: input.scheduleId, scheduledFor: input.scheduledFor,
      runRef: input.runRef, lastOutcome: input.lastOutcome as CompleteRequest['lastOutcome'],
      nextAt: input.nextAt as string | null, idempotencyKey: input.idempotencyKey,
    };
  }
  throw new ScheduleSocketError('schedule-socket-request-invalid');
}

async function dispatchScheduleSocketRequest(
  request: unknown,
  store: ScheduleSocketStorePort,
): Promise<Record<string, unknown>> {
  const parsed = parseRequest(request);
  if (parsed.operation === 'snapshot') {
    return { ok: true, version: 1, operation: 'snapshot', snapshot: await store.readScheduleSnapshot() };
  }
  if (parsed.operation === 'claim') {
    const input: ClaimScheduleOccurrenceInput = {
      occurrence: { scheduleId: parsed.scheduleId, scheduledFor: parsed.scheduledFor, nextAt: parsed.nextAt },
      expectedVersion: parsed.expectedVersion,
      idempotencyKey: parsed.idempotencyKey,
    };
    return { ok: true, version: 1, operation: 'claim', claim: await store.claimScheduleOccurrence(input) };
  }
  if (parsed.operation === 'advance') {
    const input: AdvanceScheduleOccurrenceInput = {
      scheduleId: parsed.scheduleId,
      scheduledFor: parsed.scheduledFor,
      nextAt: parsed.nextAt,
      phase: parsed.phase,
      idempotencyKey: parsed.idempotencyKey,
    };
    return { ok: true, version: 1, operation: 'advance', claim: await store.advanceScheduleOccurrence(input) };
  }
  const input: CompleteScheduleOccurrenceInput = {
    scheduleId: parsed.scheduleId,
    scheduledFor: parsed.scheduledFor,
    runRef: parsed.runRef,
    lastOutcome: parsed.lastOutcome,
    nextAt: parsed.nextAt,
    idempotencyKey: parsed.idempotencyKey,
  };
  return { ok: true, version: 1, operation: 'complete', receipt: await store.completeScheduleOccurrence(input) };
}

interface KoffiLibrary { func(name: string, result: string, args: string[]): (...args: unknown[]) => unknown }
interface Koffi { load(name: string): KoffiLibrary }

function socketFd(socket: Socket): number {
  const handle = (socket as Socket & { _handle?: { fd?: number } })._handle;
  if (!handle || !Number.isInteger(handle.fd) || (handle.fd ?? -1) < 0) throw new ScheduleSocketError('schedule-socket-io');
  return handle.fd as number;
}

function linuxPeerUid(socket: Socket): number {
  try {
    const koffi = nodeRequire('koffi') as Koffi;
    const getsockopt = koffi.load('libc.so.6').func('getsockopt', 'int', ['int', 'int', 'int', 'void *', 'void *']);
    const credentials = Buffer.alloc(12);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(credentials.length);
    if ((getsockopt(socketFd(socket), SOL_SOCKET, SO_PEERCRED, credentials, length) as number) !== 0 || length.readUInt32LE() < 12) {
      throw new ScheduleSocketError('schedule-peer-unauthorized');
    }
    return credentials.readUInt32LE(4);
  } catch (error) {
    if (error instanceof ScheduleSocketError) throw error;
    throw new ScheduleSocketError('schedule-peer-unauthorized');
  }
}

function send(socket: Socket, body: Record<string, unknown>): void {
  if (!socket.destroyed) socket.end(`${JSON.stringify(body)}\n`);
}

function responseError(error: unknown): string {
  if (error instanceof ScheduleSocketError) return error.code;
  const candidate = record(error);
  return typeof candidate?.code === 'string' && /^[a-z0-9-]{1,80}$/.test(candidate.code)
    ? candidate.code
    : 'schedule-socket-io';
}

export function createScheduleSocketServer(options: {
  socketPath: string;
  store: ScheduleSocketStorePort;
  dispatcherUid: number;
}): Server {
  if (!scheduleSocketRuntimeCapability().available) {
    throw new ScheduleSocketError('schedule-socket-io', 'schedule Unix service requires Linux');
  }
  if (!isAbsolute(options.socketPath) || options.socketPath.includes('\0') || Buffer.byteLength(options.socketPath) > 100) {
    throw new ScheduleSocketError('schedule-socket-io', 'schedule socket path is invalid');
  }
  const pathExists = existsSync(options.socketPath);
  if (pathExists && !lstatSync(options.socketPath).isSocket()) {
    throw new ScheduleSocketError('schedule-socket-io', 'schedule socket path already exists');
  }
  const server = createServer((socket) => {
    let bytes = 0;
    let encoded = '';
    let handled = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      if (handled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_REQUEST_BYTES) {
        handled = true;
        send(socket, { ok: false, version: 1, error: 'schedule-socket-request-invalid' });
        return;
      }
      encoded += chunk;
      const newline = encoded.indexOf('\n');
      if (newline === -1) return;
      handled = true;
      const line = encoded.slice(0, newline);
      void (async () => {
        try {
          if (linuxPeerUid(socket) !== options.dispatcherUid) throw new ScheduleSocketError('schedule-peer-unauthorized');
          send(socket, await dispatchScheduleSocketRequest(JSON.parse(line), options.store));
        } catch (error) {
          send(socket, { ok: false, version: 1, error: responseError(error) });
        }
      })();
    });
  });
  server.once('listening', () => {
    const address = server.address();
    if (typeof address !== 'string' || address !== options.socketPath) {
      server.close();
      server.emit('error', new ScheduleSocketError('schedule-socket-io', 'schedule socket bound to a non-path address'));
      return;
    }
    chmodSync(options.socketPath, 0o600);
  });
  server.once('close', () => { if (existsSync(options.socketPath)) unlinkSync(options.socketPath); });
  const listen = (): void => { server.listen(options.socketPath); };
  if (!pathExists) {
    listen();
    return server;
  }
  const probe = createConnection(options.socketPath);
  probe.once('connect', () => {
    probe.destroy();
    server.emit('error', new ScheduleSocketError('schedule-socket-io', 'schedule socket path already exists'));
  });
  probe.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ECONNREFUSED' && error.code !== 'ENOENT') {
      server.emit('error', new ScheduleSocketError('schedule-socket-io', 'schedule socket path already exists'));
      return;
    }
    if (existsSync(options.socketPath)) {
      if (!lstatSync(options.socketPath).isSocket()) {
        server.emit('error', new ScheduleSocketError('schedule-socket-io', 'schedule socket path already exists'));
        return;
      }
      unlinkSync(options.socketPath);
    }
    listen();
  });
  return server;
}

interface FixtureProtocolExample {
  operation: 'snapshot' | 'claim' | 'advance' | 'complete';
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}

function fixtureExamples(): Map<FixtureProtocolExample['operation'], FixtureProtocolExample> {
  const protocol = JSON.parse(readFileSync(
    resolve(import.meta.dirname, '../../shared/schedule-socket-v1.json'),
    'utf8',
  )) as { examples: FixtureProtocolExample[] };
  return new Map(protocol.examples.map((item) => [item.operation, item]));
}

function fixtureStore(): ScheduleSocketStorePort {
  const examples = fixtureExamples();
  const claimExample = examples.get('claim');
  const snapshotExample = examples.get('snapshot');
  const completeExample = examples.get('complete');
  if (!claimExample || !snapshotExample || !completeExample) throw new Error('fixture protocol incomplete');
  const originalClaim = (claimExample.response.claim ?? {}) as Record<string, unknown>;
  let phase: ScheduleOccurrenceClaim['phase'] = 'claimed';
  const unused = async (): Promise<never> => { throw new Error('fixture operation unavailable'); };
  return {
    readScheduleSnapshot: async () => structuredClone(snapshotExample.response.snapshot) as { collectionRevision: number; schedules: [] },
    createSchedule: unused,
    setScheduleArmed: unused,
    deleteSchedule: unused,
    claimScheduleOccurrence: async (input) => {
      const expected = claimExample.request;
      if (input.expectedVersion !== expected.expectedVersion
        || input.occurrence.scheduleId !== expected.scheduleId
        || input.occurrence.scheduledFor !== expected.scheduledFor
        || input.occurrence.nextAt !== expected.nextAt) {
        throw Object.assign(new Error('stale claim'), { code: 'stale-schedule-version' });
      }
      return { ...structuredClone(originalClaim), phase } as unknown as ScheduleOccurrenceClaim;
    },
    advanceScheduleOccurrence: async (input) => {
      if (input.scheduleId !== originalClaim.scheduleId || input.scheduledFor !== originalClaim.scheduledFor) {
        throw Object.assign(new Error('claim mismatch'), { code: 'schedule-occurrence-conflict' });
      }
      if (phase === 'claimed' && input.phase === 'card-saved') phase = 'card-saved';
      else if (phase === 'card-saved' && input.phase === 'ledger-appended') phase = 'ledger-appended';
      else if (input.phase !== phase) throw Object.assign(new Error('phase conflict'), { code: 'schedule-phase-conflict' });
      return {
        scheduleId: String(originalClaim.scheduleId),
        scheduledFor: String(originalClaim.scheduledFor),
        owner: originalClaim.owner as ScheduleOccurrenceClaim['owner'],
        phase,
        card: originalClaim.card as Record<string, unknown>,
        cardBytesSha256: String(originalClaim.cardBytesSha256),
      };
    },
    completeScheduleOccurrence: async () => structuredClone(completeExample.response.receipt) as ScheduleMutationReceipt,
  };
}

async function runFixtureServer(socketPath: string): Promise<void> {
  const uid = process.getuid?.();
  if (uid === undefined) throw new ScheduleSocketError('schedule-socket-io');
  const server = createScheduleSocketServer({ socketPath, store: fixtureStore(), dispatcherUid: uid });
  server.once('listening', () => process.stdout.write('READY\n'));
  const close = (): void => { server.close(() => process.exit(0)); };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

if (process.argv[2] === '--fixture-socket' && process.argv[3]) {
  void runFixtureServer(process.argv[3]);
}

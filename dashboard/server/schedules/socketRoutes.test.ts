import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ClaimScheduleOccurrenceInput,
  CompleteScheduleOccurrenceInput,
  ScheduleMutationReceipt,
  ScheduleOccurrenceClaim,
} from './contracts.ts';
import {
  createScheduleSocketServer,
  scheduleSocketRuntimeCapability,
  type AdvanceScheduleOccurrenceInput,
  type ScheduleSocketStorePort,
} from './socketRoutes.ts';

interface ProtocolExample {
  operation: 'snapshot' | 'claim' | 'advance' | 'complete';
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}

interface ProtocolVectors {
  version: 1;
  operations: Array<ProtocolExample['operation']>;
  examples: ProtocolExample[];
}

const PROTOCOL = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../../shared/schedule-socket-v1.json'),
  'utf8',
)) as ProtocolVectors;
const SERVERS: Server[] = [];
const DIRECTORIES: string[] = [];

function example(operation: ProtocolExample['operation']): ProtocolExample {
  const found = PROTOCOL.examples.find((candidate) => candidate.operation === operation);
  if (!found) throw new Error(`missing ${operation} vector`);
  return found;
}

class VectorStore implements ScheduleSocketStorePort {
  emissions = 0;
  private version = 3;

  async readScheduleSnapshot() { return example('snapshot').response.snapshot as { collectionRevision: number; schedules: [] }; }
  async claimScheduleOccurrence(input: ClaimScheduleOccurrenceInput): Promise<ScheduleOccurrenceClaim> {
    if (input.expectedVersion !== this.version) throw Object.assign(new Error('stale'), { code: 'stale-schedule-version' });
    this.emissions += 1;
    return structuredClone(example('claim').response.claim) as ScheduleOccurrenceClaim;
  }
  async advanceScheduleOccurrence(_input: AdvanceScheduleOccurrenceInput): Promise<ScheduleOccurrenceClaim> {
    return structuredClone(example('advance').response.claim) as ScheduleOccurrenceClaim;
  }
  async completeScheduleOccurrence(_input: CompleteScheduleOccurrenceInput): Promise<ScheduleMutationReceipt> {
    this.version = 4;
    return structuredClone(example('complete').response.receipt) as ScheduleMutationReceipt;
  }
  async createSchedule(): Promise<never> { throw new Error('unused'); }
  async setScheduleArmed(): Promise<never> { throw new Error('unused'); }
  async deleteSchedule(): Promise<never> { throw new Error('unused'); }
}

async function socketPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'schedule-socket-'));
  DIRECTORIES.push(directory);
  return join(directory, 'schedules.sock');
}

async function exchange(path: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const socket = createConnection(path);
  socket.setEncoding('utf8');
  let body = '';
  socket.on('data', (chunk: string) => { body += chunk; });
  await once(socket, 'connect');
  socket.end(`${JSON.stringify(request)}\n`);
  await once(socket, 'close');
  return JSON.parse(body.trim()) as Record<string, unknown>;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((done) => server.close(() => done()));
}

afterEach(async () => {
  await Promise.all(SERVERS.splice(0).map(close));
  await Promise.all(DIRECTORIES.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('schedule Unix socket protocol', () => {
  it('pins one shared closed request/response union on every platform', async () => {
    expect(PROTOCOL.version).toBe(1);
    expect(PROTOCOL.operations).toEqual(['snapshot', 'claim', 'advance', 'complete']);
    expect(PROTOCOL.examples.map((item) => item.operation)).toEqual(PROTOCOL.operations);
    expect(example('claim').request).toMatchObject({ expectedVersion: 3, nextAt: expect.any(String) });
    expect(example('advance').request).toMatchObject({ phase: 'card-saved', nextAt: expect.any(String) });
    expect(example('complete').request).toMatchObject({ nextAt: expect.any(String) });

    const capability = scheduleSocketRuntimeCapability();
    if (!capability.available) {
      expect(capability).toEqual({ available: false, reason: 'linux-so-peercred-required' });
      expect(() => createScheduleSocketServer({ socketPath: 'not-used', store: new VectorStore(), dispatcherUid: 1 }))
        .toThrow('schedule Unix service requires Linux');
      return;
    }

    const path = await socketPath();
    const server = createScheduleSocketServer({ socketPath: path, store: new VectorStore(), dispatcherUid: process.getuid!() });
    SERVERS.push(server);
    await once(server, 'listening');
    for (const vector of PROTOCOL.examples) {
      await expect(exchange(path, vector.request)).resolves.toEqual(vector.response);
    }
  });

  it('binds internally to a path and refuses TCP and a non-dispatcher peer through a real server', async () => {
    const source = readFileSync(resolve(import.meta.dirname, 'socketRoutes.ts'), 'utf8');
    expect(source).not.toMatch(/peerUid\?:|export function linuxPeerUid/);
    const capability = scheduleSocketRuntimeCapability();
    if (!capability.available) {
      expect(capability.reason).toBe('linux-so-peercred-required');
      return;
    }

    const path = await socketPath();
    const server = createScheduleSocketServer({ socketPath: path, store: new VectorStore(), dispatcherUid: process.getuid!() + 1 });
    SERVERS.push(server);
    await once(server, 'listening');
    expect(server.address()).toBe(path);
    expect(() => server.listen(0, '127.0.0.1')).toThrow();
    await expect(exchange(path, example('snapshot').request)).resolves.toEqual({
      ok: false, version: 1, error: 'schedule-peer-unauthorized',
    });
  });

  it('passes expectedVersion into atomic claim CAS and emits nothing for stale input', async () => {
    const capability = scheduleSocketRuntimeCapability();
    if (!capability.available) {
      expect(example('claim').request).toHaveProperty('expectedVersion', 3);
      return;
    }
    const store = new VectorStore();
    const path = await socketPath();
    const server = createScheduleSocketServer({ socketPath: path, store, dispatcherUid: process.getuid!() });
    SERVERS.push(server);
    await once(server, 'listening');
    const stale = { ...example('claim').request, expectedVersion: 2 };
    await expect(exchange(path, stale)).resolves.toEqual({
      ok: false, version: 1, error: 'stale-schedule-version',
    });
    expect(store.emissions).toBe(0);
  });
});

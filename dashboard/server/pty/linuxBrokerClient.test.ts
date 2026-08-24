import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';

import type { SessionHost, SessionSink } from './contracts.ts';
import { encodeBrokerFrame } from './brokerProtocol.ts';
import { LinuxBrokerClient } from './linuxBrokerClient.ts';
import { LinuxBrokerServer, type BrokerPty } from './linuxBrokerServer.ts';
import { createSessionRecordRegistry } from './sessionRecord.ts';
import { createEmptyPtySessionsDocument, enforcePtySessionRetention } from './sessionPersistence.ts';
import type { SessionPersistence } from './sessionPersistence.ts';

class MemoryDuplex extends Duplex {
  peer: MemoryDuplex | null = null;
  _read(): void {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.peer?.push(Buffer.from(chunk)); done();
  }
  _final(done: (error?: Error | null) => void): void { this.peer?.push(null); done(); }
}
function pair(): [MemoryDuplex, MemoryDuplex] {
  const a = new MemoryDuplex(); const b = new MemoryDuplex(); a.peer = b; b.peer = a; return [a, b];
}
class FakePty implements BrokerPty {
  pid = 7; identity = { pid: 7, pgid: 7, startTimeTicks: '7' };
  onDataListener: (data: Uint8Array) => void = () => {}; onExitListener: (c: number | null, s: number | null) => void = () => {};
  write(): Promise<void> { return Promise.resolve(); } resize(): void {} kill(): void {}
  onData(cb: (data: Uint8Array) => void): void { this.onDataListener = cb; }
  onExit(cb: (c: number | null, s: number | null) => void): void { this.onExitListener = cb; }
}

const epochId = 'epoch-0123456789abcdef0123456789abcdef';
const sessionId = 'pty-0123456789abcdef0123456789abcdef';
const operationKey = 'op-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// Every host create names its browser principal (contracts.ts:92); the broker never sees it.
const principal = { operator: 'daniel', browserSessionRef: 'bs-0123456789abcdef' };

describe('LinuxBrokerClient', () => {
  it('implements SessionHost over an in-memory duplex and drains the ready epoch', async () => {
    const child = new FakePty();
    const [clientSocket, serverSocket] = pair();
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => child }, makeSessionId: () => sessionId,
      now: () => '2026-08-22T00:00:00.000Z' });
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => 'req-0123456789abcdef0123456789abcdef' });
    expect((await client.probe()).available).toBe(true);
    const data: string[] = []; const exits: string[] = [];
    const sink: SessionSink = { data: (frame) => data.push(Buffer.from(frame.data, 'base64').toString()),
      exit: (exit) => exits.push(exit.reason), closed: () => false };
    const launch = client.create({ operationKey, principal,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 }, sink);
    expect(await launch.receipt).toEqual({ ok: true, value: expect.objectContaining({ sessionId, epochId }) });
    child.onDataListener(Buffer.from('hello'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(data).toEqual(['hello']);
    expect(await client.listEpoch()).toEqual({ ok: true, value: { epochId, sessionIds: [sessionId] } });
    expect(await client.drain(epochId)).toEqual({ ok: true, value: { epochId, closed: [sessionId], alreadyGone: [] } });
    child.onExitListener(null, null);
    expect((await launch.exit).reason).toBe('closed');
    expect(exits).toEqual(['closed']);
  });

  it('refuses an old-epoch frame after drain and suppresses late exit exactly once', async () => {
    const child = new FakePty();
    const [clientSocket, serverSocket] = pair();
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => child }, makeSessionId: () => sessionId,
      now: () => '2026-08-22T00:00:00.000Z' });
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => 'req-0123456789abcdef0123456789abcdef' });
    await client.probe();
    const exits: string[] = [];
    const launch = client.create({ operationKey, principal,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 },
    { data: () => {}, exit: (exit) => exits.push(exit.reason), closed: () => false });
    expect((await launch.receipt).ok).toBe(true);
    expect((await client.drain(epochId)).ok).toBe(true);
    serverSocket.write(encodeBrokerFrame({ type: 'exit', requestId: null, sessionId,
      epochId: 'epoch-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sequence: 100, exitCode: 0, signal: null,
      reason: 'exited', observedAt: '2026-08-22T00:00:01.000Z' }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(exits).toEqual([]);
    child.onExitListener(null, null);
    expect((await launch.exit).reason).toBe('closed');
    child.onExitListener(0, null);
    expect(exits).toEqual(['closed']);
  });
  it('caps a composite principal at eight live sessions over the real broker client host', async () => {
    // The Linux twin of the registry race: the broker frame carries no principal at all, so if the cap
    // lived in a host it would simply not exist on the VM. Composed over the REAL LinuxBrokerClient
    // talking to a real LinuxBrokerServer, the ninth create for one {operator, browserSessionRef} is
    // still refused - by the registry, before the wire.
    const [clientSocket, serverSocket] = pair();
    let minted = 0;
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => new FakePty() },
      makeSessionId: () => `pty-${(++minted).toString(16).padStart(32, '0')}`,
      now: () => '2026-08-22T00:00:00.000Z' });
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    let request = 0;
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => `req-${(++request).toString(16).padStart(32, '0')}` });

    let document = createEmptyPtySessionsDocument();
    let queue = Promise.resolve();
    const persistence: SessionPersistence = {
      read: () => structuredClone(document),
      mutate: async (expectedRevision, callback) => {
        let result!: { revision: number; value: unknown };
        const action = queue.then(async () => {
          if (expectedRevision !== null && expectedRevision !== document.revision) {
            throw new Error('revision-conflict');
          }
          const draft = structuredClone(document);
          const value = await callback(draft);
          enforcePtySessionRetention(draft);
          draft.revision += 1;
          document = draft;
          result = { revision: draft.revision, value };
        });
        queue = action.then(() => undefined, () => undefined);
        await action;
        return result as never;
      },
    };
    let operation = 0;
    const registry = createSessionRecordRegistry({
      persistence,
      host: client as unknown as SessionHost,
      resolveManualRecipe: () => ({ launcher: 'shell', mode: 'interactive', model: null,
        toolPolicyId: 'shell-default', sandbox: 'interactive' }),
      now: () => '2026-08-22T00:00:00.000Z',
      makeOperationKey: () => `op-${(++operation).toString(16).padStart(64, '0')}`,
    });
    const manual = { launcher: 'shell' as const, rootId: 'repo' as const, relativeCwd: '', cols: 80, rows: 24 };

    for (let index = 0; index < 8; index += 1) {
      expect(await registry.create(principal, manual)).toMatchObject({ ok: true });
    }
    expect(await registry.create(principal, manual))
      .toEqual({ ok: false, refusal: 'capacity', detail: null });
    // The broker was asked for exactly the eight that were admitted.
    expect(minted).toBe(8);
    // A second browser session of the same operator is a different bucket and still admitted.
    expect(await registry.create({ operator: principal.operator, browserSessionRef: 'bs-fedcba9876543210' }, manual))
      .toMatchObject({ ok: true });
  });
});

import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';

import type { SessionSink } from './contracts.ts';
import { encodeBrokerFrame } from './brokerProtocol.ts';
import { LinuxBrokerClient } from './linuxBrokerClient.ts';
import { LinuxBrokerServer, type BrokerPty } from './linuxBrokerServer.ts';

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
});

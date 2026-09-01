import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';

import type { PtyCapabilityProbe, SessionHost, SessionSink } from './contracts.ts';
import { encodeBrokerFrame } from './brokerProtocol.ts';
import { LinuxBrokerClient } from './linuxBrokerClient.ts';
import { LinuxBrokerServer, type BrokerPty, type LinuxBrokerServerOptions } from './linuxBrokerServer.ts';
import type { BrokerLaunchSpec } from './fdPinnedPaths.ts';
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
  /**
   * A destroyed Unix socket closes on BOTH ends — the far side gets `close`, which is what
   * `LinuxBrokerClient` listens for to fail its in-flight requests. Without this the pair models a
   * connection the broker can hang up on without the client ever noticing, so an undecodable frame
   * looked like a hang here and like a refusal in production. The peer link is cleared first so the
   * two `_destroy` calls do not bounce off each other.
   */
  _destroy(error: Error | null, done: (error?: Error | null) => void): void {
    const peer = this.peer;
    this.peer = null;
    if (peer !== null) { peer.peer = null; peer.destroy(); }
    done(error);
  }
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

function memoryPersistence(): SessionPersistence {
  let document = createEmptyPtySessionsDocument();
  let queue = Promise.resolve();
  return {
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
}

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

  it('reports the launchers the BROKER enumerated, not a literal, and fails closed when it cannot', async () => {
    const probeAgainst = async (
      enumerateLaunchers: LinuxBrokerServerOptions['enumerateLaunchers'],
    ): Promise<PtyCapabilityProbe> => {
      const [clientSocket, serverSocket] = pair();
      const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
        launcher: { launch: async () => new FakePty() }, enumerateLaunchers,
        makeSessionId: () => sessionId, now: () => '2026-08-22T00:00:00.000Z' });
      server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
      let request = 0;
      const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
        makeRequestId: () => `req-${(++request).toString(16).padStart(32, '0')}` });
      const probed = await client.probe();
      client.disconnect();
      return probed;
    };

    // The machine's answer travels the wire verbatim. Each of these is a different real VM.
    const full = await probeAgainst(async () => ['shell', 'claude', 'codex']);
    expect(full).toMatchObject({ available: true, launchers: ['shell', 'claude', 'codex'] });
    expect(await probeAgainst(async () => ['shell']))
      .toMatchObject({ available: true, launchers: ['shell'] });
    expect(await probeAgainst(async () => ['shell', 'claude']))
      .toMatchObject({ available: true, launchers: ['shell', 'claude'] });

    // An enumeration that throws is the empty set, and a broker with no enumerator at all is too.
    // Neither may produce a launcher: a `ready` frame is proof of a broker, never proof of a CLI.
    for (const broken of [async (): Promise<never> => { throw new Error('EIO'); }, undefined]) {
      const probed = await probeAgainst(broken);
      expect(probed).toMatchObject({ available: true, launchers: [] });
      expect(probed.available && probed.launchers).not.toContain('claude');
      expect(probed.available && probed.launchers).not.toContain('codex');
    }

    // A duplicated or out-of-order set never reaches the client: the broker canonicalizes before it
    // answers, so `claude,shell,claude` comes back as the one wire form this protocol admits.
    expect(await probeAgainst(async () => ['claude', 'shell', 'claude'] as never))
      .toMatchObject({ available: true, launchers: ['shell', 'claude'] });

    // `roots` stays the compiled-in policy pair; only launchers are enumerated.
    expect(full.available && full.roots).toEqual(['repo', 'worktrees']);
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
      // `sessionRecord.ts` re-probes the host on every create and refuses a launcher the host does not
      // name, so a broker fixture that admits a `shell` create must enumerate one. Before enumeration
      // the client asserted `shell,claude,codex` for any broker that answered `ready`, which is exactly
      // the fabrication this fixture no longer gets for free.
      enumerateLaunchers: async () => ['shell', 'claude', 'codex'],
      makeSessionId: () => `pty-${(++minted).toString(16).padStart(32, '0')}`,
      now: () => '2026-08-22T00:00:00.000Z' });
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    let request = 0;
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => `req-${(++request).toString(16).padStart(32, '0')}` });

    const persistence = memoryPersistence();
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

  it('opens a shell with the PRODUCTION recipe — no injected resolver — and leaves the host usable', async () => {
    // The test above injects `resolveManualRecipe`, and it injects the RIGHT answer. That is exactly why
    // production shipped a manual recipe (`toolPolicyId: 'interactive'`) that the broker's own decoder
    // refuses: every path that would have caught it was either stubbed out (the Linux capability probe) or
    // handed the correct value by a fixture. This test injects nothing, so `sessionRecord.ts`'s own
    // `manualRecipe` is what crosses the wire, through the real `decodeBrokerClientFrame` and the real
    // `buildBrokerLaunch` on the far side.
    //
    // The failure it guards is not one refused session. An undecodable frame throws inside
    // `BrokerFrameDecoder.push`, which `accept` answers by destroying the socket; the client's
    // `handleDisconnect` then latches `unavailable` permanently, so the FIRST shell an operator opened
    // would take the daemon's whole PTY host down until a service restart. Hence the assertions below
    // check that the host still works afterwards, not merely that one create returned ok.
    const [clientSocket, serverSocket] = pair();
    const specs: BrokerLaunchSpec[] = [];
    let minted = 0;
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async (spec) => { specs.push(spec); return new FakePty(); } },
      enumerateLaunchers: async () => ['shell'],
      makeSessionId: () => `pty-${(++minted).toString(16).padStart(32, '0')}`,
      now: () => '2026-08-22T00:00:00.000Z' });
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    let request = 0;
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => `req-${(++request).toString(16).padStart(32, '0')}` });
    let operation = 0;
    const registry = createSessionRecordRegistry({
      persistence: memoryPersistence(),
      host: client as unknown as SessionHost,
      // NO `resolveManualRecipe`: production injects none, so the module's own builder is under test.
      now: () => '2026-08-22T00:00:00.000Z',
      makeOperationKey: () => `op-${(++operation).toString(16).padStart(64, '0')}`,
    });
    const manual = { launcher: 'shell' as const, rootId: 'repo' as const, relativeCwd: '', cols: 80, rows: 24 };

    expect(await registry.create(principal, manual)).toMatchObject({ ok: true });
    // The recipe reached the far side and `buildBrokerLaunch` resolved it, so it cleared BOTH gates.
    expect(specs).toHaveLength(1);
    expect(specs[0]?.executable).toBe('/bin/bash');
    // The connection survived, and the client is not latched unavailable: a second create still works.
    expect(serverSocket.destroyed).toBe(false);
    expect(await registry.create(principal, manual)).toMatchObject({ ok: true });
    expect(minted).toBe(2);
  });
});

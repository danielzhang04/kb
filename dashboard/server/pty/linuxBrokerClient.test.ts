import { Duplex } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { PtyCapabilityProbe, SessionHost, SessionSink } from './contracts.ts';
import { BrokerFrameDecoder, decodeBrokerClientFrame, encodeBrokerFrame } from './brokerProtocol.ts';
import { LinuxBrokerClient, type LinuxBrokerClientOptions } from './linuxBrokerClient.ts';
import { LinuxBrokerServer, type BrokerPty, type LinuxBrokerServerOptions } from './linuxBrokerServer.ts';
import type { BrokerLaunchSpec } from './fdPinnedPaths.ts';
import { createSessionRecordRegistry } from './sessionRecord.ts';
import { createEmptyPtySessionsDocument, enforcePtySessionRetention } from './sessionPersistence.ts';
import type { SessionPersistence } from './sessionPersistence.ts';

class MemoryDuplex extends Duplex {
  peer: MemoryDuplex | null = null;
  readonly writes: Buffer[] = [];
  _read(): void {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    const copied = Buffer.from(chunk);
    this.writes.push(copied);
    this.peer?.push(copied); done();
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
/** A client-side socket that silently drops every outgoing frame of one type, forwarding all others. */
class DroppingMemoryDuplex extends MemoryDuplex {
  private readonly decoder = new BrokerFrameDecoder(decodeBrokerClientFrame);
  private readonly dropTypes: readonly string[];
  constructor(dropTypes: readonly string[]) { super(); this.dropTypes = dropTypes; }
  override _write(chunk: Buffer, encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    const frames = this.decoder.push(chunk);
    // One `write()` call carries exactly one frame in this harness (matches how the client itself
    // writes). A chunk that decodes to more than one would make the single `forward` flag below drop
    // or keep frames it was never asked to, silently - fail loudly instead of forwarding the wrong set.
    if (frames.length > 1) throw new Error('DroppingMemoryDuplex only supports one frame per chunk');
    const forward = frames.every((frame) => !this.dropTypes.includes(frame.type));
    if (forward) super._write(chunk, encoding, done);
    else done();
  }
}
function droppingPair(dropTypes: string | readonly string[]): [DroppingMemoryDuplex, MemoryDuplex] {
  const types = typeof dropTypes === 'string' ? [dropTypes] : dropTypes;
  const a = new DroppingMemoryDuplex(types); const b = new MemoryDuplex(); a.peer = b; b.peer = a;
  return [a, b];
}
class FakePty implements BrokerPty {
  pid = 7; identity = { pid: 7, pgid: 7, startTimeTicks: '7' };
  onDataListener: (data: Uint8Array) => void = () => {}; onExitListener: (c: number | null, s: number | null) => void = () => {};
  inputEnds = 0;
  write(): Promise<boolean> { return Promise.resolve(true); } endInput(): void { this.inputEnds += 1; }
  resize(): void {} kill(): void {}
  onData(cb: (data: Uint8Array) => void): void { this.onDataListener = cb; }
  onExit(cb: (c: number | null, s: number | null) => void): void { this.onExitListener = cb; }
}

class ExitsOnKillPty extends FakePty {
  override kill(): void { this.onExitListener(null, null); }
}

const epochId = 'epoch-0123456789abcdef0123456789abcdef';
const sessionId = 'pty-0123456789abcdef0123456789abcdef';
const operationKey = 'op-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// Every host create names its browser principal (contracts.ts:92); the broker never sees it.
const principal = { operator: 'daniel', browserSessionRef: 'bs-0123456789abcdef' };

type DisconnectInfo = Parameters<NonNullable<LinuxBrokerClientOptions['onDisconnect']>>[0];

function requestFor(index: number) {
  return {
    operationKey: `op-${index.toString(16).padStart(64, '0')}`,
    principal,
    recipe: { launcher: 'shell' as const, mode: 'interactive' as const, model: null,
      toolPolicyId: 'shell-default' as const, sandbox: 'interactive' as const },
    rootId: 'repo' as const,
    relativeCwd: '',
    cols: 80,
    rows: 24,
  };
}

function openSink(exits: string[] = []): SessionSink {
  return { data: () => {}, exit: (exit) => exits.push(exit.reason), closed: () => false };
}

function reconnectingHarness(onDisconnect?: (info: DisconnectInfo) => void) {
  const clientSockets: MemoryDuplex[] = [];
  const serverSockets: MemoryDuplex[] = [];
  let request = 0;
  let session = 0;
  let connectCalls = 0;
  const client = new LinuxBrokerClient({
    connect: async () => {
      connectCalls += 1;
      const [clientSocket, serverSocket] = pair();
      clientSockets.push(clientSocket);
      serverSockets.push(serverSocket);
      const server = new LinuxBrokerServer({
        epochId,
        expectedClientUid: 1000,
        expectedClientGid: 1000,
        launcher: { launch: async () => new FakePty() },
        enumerateLaunchers: async () => ['shell'],
        makeSessionId: () => `pty-${(++session).toString(16).padStart(32, '0')}`,
        now: () => '2026-09-02T00:00:00.000Z',
      });
      server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
      return clientSocket;
    },
    dashboardEpochId: epochId,
    makeRequestId: () => `req-${(++request).toString(16).padStart(32, '0')}`,
    ...(onDisconnect === undefined ? {} : { onDisconnect }),
  });
  return { client, clientSockets, serverSockets, connectCalls: () => connectCalls };
}

function persistentBrokerHarness() {
  const clientSockets: MemoryDuplex[] = [];
  const serverSockets: MemoryDuplex[] = [];
  const closeAcks: string[] = [];
  let request = 0;
  let session = 0;
  const server = new LinuxBrokerServer({
    epochId,
    expectedClientUid: 1000,
    expectedClientGid: 1000,
    launcher: { launch: async () => new ExitsOnKillPty() },
    enumerateLaunchers: async () => ['shell'],
    makeSessionId: () => `pty-${(++session).toString(16).padStart(32, '0')}`,
    now: () => '2026-09-02T00:00:00.000Z',
    log: () => {},
  });
  server.onFrame((frame) => {
    if (frame.type === 'ack' && frame.action === 'close') closeAcks.push(frame.sessionId);
  });
  const connect = async (): Promise<MemoryDuplex> => {
    const [clientSocket, serverSocket] = pair();
    clientSockets.push(clientSocket);
    serverSockets.push(serverSocket);
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    return clientSocket;
  };
  const client = new LinuxBrokerClient({
    connect,
    dashboardEpochId: epochId,
    makeRequestId: () => `req-${(++request).toString(16).padStart(32, '0')}`,
  });
  const inspectSessionIds = async (): Promise<string[]> => {
    const inspector = new LinuxBrokerClient({
      connect,
      dashboardEpochId: epochId,
      makeRequestId: () => `req-${(++request).toString(16).padStart(32, '0')}`,
    });
    const listed = await inspector.listEpoch();
    inspector.disconnect();
    if (!listed.ok) throw new Error('broker inspection failed');
    return listed.value.sessionIds;
  };
  return { client, clientSockets, serverSockets, closeAcks, inspectSessionIds };
}

function helloEpochs(socket: MemoryDuplex): string[] {
  const decoder = new BrokerFrameDecoder(decodeBrokerClientFrame);
  return socket.writes.flatMap((chunk) => decoder.push(chunk))
    .flatMap((frame) => frame.type === 'hello' ? [frame.dashboardEpochId] : []);
}

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
  it('reconnects lazily after a socket close and repeats hello before create', async () => {
    const disconnected: DisconnectInfo[] = [];
    const harness = reconnectingHarness((info) => disconnected.push(info));
    expect((await harness.client.probe()).available).toBe(true);
    harness.serverSockets[0]!.destroy();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const launch = harness.client.create(requestFor(1), openSink());
    expect(await launch.receipt).toMatchObject({ ok: true });
    expect(harness.connectCalls()).toBe(2);
    expect(harness.clientSockets.map(helloEpochs)).toEqual([[epochId], [epochId]]);
    expect(disconnected).toEqual([{ cause: 'socket-close', error: null, lastErrorFrame: null }]);
  });

  it('reconnects lazily after a socket error', async () => {
    const disconnected: DisconnectInfo[] = [];
    const harness = reconnectingHarness((info) => disconnected.push(info));
    expect((await harness.client.probe()).available).toBe(true);
    harness.clientSockets[0]!.destroy(new Error('simulated socket reset'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const launch = harness.client.create(requestFor(2), openSink());
    expect(await launch.receipt).toMatchObject({ ok: true });
    expect(harness.connectCalls()).toBe(2);
    expect(harness.clientSockets.map(helloEpochs)).toEqual([[epochId], [epochId]]);
    expect(disconnected).toEqual([{
      cause: 'socket-error', error: 'simulated socket reset', lastErrorFrame: null,
    }]);
  });

  it('keeps explicit disconnect terminal', async () => {
    const disconnected: DisconnectInfo[] = [];
    const harness = reconnectingHarness((info) => disconnected.push(info));
    expect((await harness.client.probe()).available).toBe(true);
    harness.client.disconnect();
    const launch = harness.client.create(requestFor(3), openSink());
    expect(await launch.receipt).toEqual({ ok: false, refusal: 'unavailable', detail: null });
    expect(harness.connectCalls()).toBe(1);
    expect(disconnected).toEqual([{ cause: 'explicit', error: null, lastErrorFrame: null }]);
  });

  it('rejects an in-flight request and abandons a known session once before reconnecting', async () => {
    const harness = reconnectingHarness();
    const exits: string[] = [];
    const first = harness.client.create(requestFor(4), openSink(exits));
    const receipt = await first.receipt;
    expect(receipt).toMatchObject({ ok: true });
    if (!receipt.ok) throw new Error('expected the first create to succeed');
    harness.serverSockets[0]!.pause();
    const inFlight = harness.client.attach(receipt.value.sessionId, openSink());
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.serverSockets[0]!.destroy();
    expect(await inFlight).toEqual({ ok: false, refusal: 'unavailable', detail: null });
    expect((await first.exit).reason).toBe('abandoned');
    expect(exits).toEqual(['abandoned']);
    const second = harness.client.create(requestFor(5), openSink());
    expect(await second.receipt).toMatchObject({ ok: true });
    expect(harness.connectCalls()).toBe(2);
    expect(exits).toEqual(['abandoned']);
  });

  it('reconciles a locally abandoned session against a broker that survives the drop', async () => {
    const harness = persistentBrokerHarness();
    const first = harness.client.create(requestFor(6), openSink());
    const firstReceipt = await first.receipt;
    expect(firstReceipt).toMatchObject({ ok: true });
    if (!firstReceipt.ok) throw new Error('expected the first create to succeed');

    harness.serverSockets[0]!.destroy();
    expect((await first.exit).reason).toBe('abandoned');
    expect((await harness.client.probe()).available).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.closeAcks).toEqual([firstReceipt.value.sessionId]);
    expect(await harness.inspectSessionIds()).toEqual([]);
    expect((await harness.client.create(requestFor(7), openSink()).receipt).ok).toBe(true);
  });

  it('destroys every socket when hello is refused per request', async () => {
    const sockets: MemoryDuplex[] = [];
    let request = 0;
    const client = new LinuxBrokerClient({
      connect: async () => {
        const [clientSocket, serverSocket] = pair();
        sockets.push(clientSocket);
        const decoder = new BrokerFrameDecoder(decodeBrokerClientFrame);
        serverSocket.on('data', (chunk: Buffer) => {
          for (const frame of decoder.push(chunk)) {
            serverSocket.write(encodeBrokerFrame({
              type: 'error', requestId: frame.requestId, sessionId: null, epochId,
              code: 'invalid-request', detail: 'protocol is invalid',
            }));
          }
        });
        return clientSocket;
      },
      dashboardEpochId: epochId,
      makeRequestId: () => `req-${(++request).toString(16).padStart(32, '0')}`,
      requestTimeoutMs: 200,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await client.probe()).available).toBe(false);
    }
    expect(sockets).toHaveLength(5);
    expect(sockets.filter((socket) => !socket.destroyed)).toHaveLength(0);
  });

  it('closes on an invalid hello protocol but recovers an identified malformed create', async () => {
    const helloPair = pair();
    const helloLogs: string[] = [];
    const helloServer = new LinuxBrokerServer({
      epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => new FakePty() },
      makeSessionId: () => sessionId, now: () => '2026-09-02T00:00:00.000Z',
      log: (message) => helloLogs.push(message),
    });
    helloServer.accept(helloPair[1], { uid: 1000, gid: 1000, pid: 4 });
    helloPair[0].write(encodeBrokerFrame({
      type: 'hello', requestId: 'req-0123456789abcdef0123456789abcdef', sessionId: null,
      protocol: 'nope', dashboardEpochId: epochId,
    } as never));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(helloPair[0].destroyed).toBe(true);
    expect(helloPair[1].destroyed).toBe(true);
    expect(helloLogs).toContain('broker: closed peer connection: protocol-error:invalid-request');

    const harness = reconnectingHarness();
    const malformed = harness.client.create({ ...requestFor(8), operationKey: 'nope' }, openSink());
    expect(await malformed.receipt).toMatchObject({ ok: false, refusal: 'invalid-request' });
    expect(harness.clientSockets[0]!.destroyed).toBe(false);
    expect((await harness.client.probe()).available).toBe(true);
    expect(harness.connectCalls()).toBe(1);
  });

  it('reports the last broker error frame when the socket then closes', async () => {
    const disconnected: DisconnectInfo[] = [];
    const harness = reconnectingHarness((info) => disconnected.push(info));
    expect((await harness.client.probe()).available).toBe(true);
    harness.serverSockets[0]!.write(encodeBrokerFrame({
      type: 'error', requestId: null, sessionId: null, epochId: null,
      code: 'invalid-request', detail: 'fixture refusal',
    }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.serverSockets[0]!.destroy();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disconnected).toEqual([{
      cause: 'socket-close', error: null,
      lastErrorFrame: { code: 'invalid-request', detail: 'fixture refusal' },
    }]);
  });

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

  /**
   * `endInput` across the real client AND the real server, because the client half is nothing but a
   * frame plus a sequence number and it is the SEQUENCE that matters: an end-of-input that took a
   * number out of order, or one taken from a separate counter, could reach the child before the prompt
   * it terminates. Driven against a headless recipe, the only kind a broker will end.
   */
  it('half-closes a headless session in the same ordered input sequence as its writes', async () => {
    const child = new FakePty();
    const [clientSocket, serverSocket] = pair();
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => child }, makeSessionId: () => sessionId,
      now: () => '2026-08-22T00:00:00.000Z' });
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    let request = 0;
    // A short request timeout so the close below settles on its synthesized `closed` exit rather than
    // waiting five seconds for an exit frame this fake child never emits.
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => `req-${(++request).toString(16).padStart(32, '0')}`, requestTimeoutMs: 200 });
    const sink: SessionSink = { data: () => {}, exit: () => {}, closed: () => false };
    const launch = client.create({ operationKey, principal,
      recipe: { launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6-terra',
        toolPolicyId: 'producer', sandbox: 'codex-workspace-write' },
      rootId: 'worktrees', relativeCwd: 'run-1', cols: 80, rows: 24 }, sink);
    expect(await launch.receipt).toMatchObject({ ok: true });

    expect(await client.write(sessionId, Buffer.from('prompt'))).toEqual({ ok: true, value: { accepted: 6 } });
    expect(await client.endInput(sessionId)).toEqual({ ok: true, value: { ended: true } });
    expect(child.inputEnds).toBe(1);
    // The broker refuses a repeat, and the client surfaces it as a refusal rather than an exception.
    expect(await client.endInput(sessionId)).toMatchObject({ ok: false, refusal: 'invalid-request' });
    // ...and a session this client never bound is `not-found` without a frame leaving the process.
    expect(await client.endInput(`pty-${'e'.repeat(32)}`)).toMatchObject({ ok: false, refusal: 'not-found' });
    expect(child.inputEnds).toBe(1);

    // THE REGRESSION: a refusal does not consume the broker's `inputSequence`, so a client that kept
    // counting would send its next request one number ahead and the broker would refuse that, and
    // everything after it. The compensating close that cleans up a stranded codex session is exactly
    // the request that would have been lost, so it is the one asserted here.
    expect(await client.close(sessionId)).toMatchObject({ ok: true });
    client.disconnect();
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

  it('marks a session exited and drops it from listEpoch when close times out waiting for the exit frame, then ignores a later real exit frame', async () => {
    // FakePty's `kill()` is a no-op that never calls `onExitListener`, so the broker acks the close
    // immediately but the real exit frame `exitWithinTimeout` waits for never arrives; exactly the
    // case its timeout branch exists for.
    const child = new FakePty();
    const [clientSocket, serverSocket] = pair();
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => child }, makeSessionId: () => sessionId,
      now: () => '2026-09-02T00:00:00.000Z' });
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => 'req-0123456789abcdef0123456789abcdef', requestTimeoutMs: 30 });
    await client.probe();
    const exits: string[] = [];
    const launch = client.create({ operationKey, principal,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 },
    { data: () => {}, exit: (exit) => exits.push(exit.reason), closed: () => false });
    expect((await launch.receipt).ok).toBe(true);
    expect(await client.listEpoch()).toEqual({ ok: true, value: { epochId, sessionIds: [sessionId] } });

    const closed = await client.close(sessionId);
    expect(closed).toEqual({ ok: true, value: { sessionId, sequence: expect.any(Number),
      exitCode: null, signal: null, reason: 'closed', observedAt: expect.any(String) } });
    // The synthesized exit removed the id from the ready listing exactly like a real exit frame would;
    // without this fix the id lingers in `listEpoch()` forever, because `session.exited` was never set.
    expect(await client.listEpoch()).toEqual({ ok: true, value: { epochId, sessionIds: [] } });
    // `create()`'s own provisional exit is chained off the SAME `session.exit`, so it settles too.
    expect(await launch.exit).toMatchObject({ reason: 'closed', exitCode: null });
    // The synthesized exit reached the attached sink exactly once - an attached browser viewer waits
    // on this same event, and without this delivery it would hang forever.
    expect(exits).toEqual(['closed']);

    // A real exit frame landing after the timeout already settled things must be a no-op: no throw, and
    // no second delivery to the sink (it is dropped, not delivered twice).
    expect(() => child.onExitListener(0, null)).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(exits).toEqual(['closed']);
  });

  it('still resolves the synthesized exit and drops the id from listEpoch when a sink throws on exit', async () => {
    // The teardown (`session.exit.resolve` + the `ready.sessions` filter) must settle BEFORE the sink
    // fan-out runs, and the fan-out itself must be fault-isolated - otherwise a throwing sink raises
    // out of the bare timer callback and strands `close()` (and every future `listEpoch()`) forever.
    const child = new FakePty();
    const [clientSocket, serverSocket] = pair();
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => child }, makeSessionId: () => sessionId,
      now: () => '2026-09-02T00:00:00.000Z' });
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => 'req-0123456789abcdef0123456789abcdef', requestTimeoutMs: 30 });
    await client.probe();
    const launch = client.create({ operationKey, principal,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 },
    { data: () => {}, exit: () => { throw new Error('sink faulted'); }, closed: () => false });
    expect((await launch.receipt).ok).toBe(true);

    const closed = await client.close(sessionId);
    expect(closed).toEqual({ ok: true, value: { sessionId, sequence: expect.any(Number),
      exitCode: null, signal: null, reason: 'closed', observedAt: expect.any(String) } });
    expect(await client.listEpoch()).toEqual({ ok: true, value: { epochId, sessionIds: [] } });
    expect(await launch.exit).toMatchObject({ reason: 'closed', exitCode: null });
  });

  it('releases a bound session and its sink with a compensating close when create fails after binding', async () => {
    // The create ack binds the session and sink SYNCHRONOUSLY (`bindSession`, see the comment on
    // `PendingCreate`). Dropping only the follow-up `attach` request lets that bind succeed while the
    // continuation then throws (a broker request timeout): the exact leak LOW-3 fixes. Without the
    // cleanup, the bound session and its sink live on with nothing to ever close them.
    const closeAcks: string[] = [];
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => new ExitsOnKillPty() }, makeSessionId: () => sessionId,
      now: () => '2026-09-02T00:00:00.000Z', log: () => {} });
    server.onFrame((frame) => {
      if (frame.type === 'ack' && frame.action === 'close') closeAcks.push(frame.sessionId);
    });
    const [clientSocket, serverSocket] = droppingPair('attach');
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => 'req-0123456789abcdef0123456789abcdef', requestTimeoutMs: 30 });
    await client.probe();
    const launch = client.create({ operationKey, principal,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 },
    { data: () => {}, exit: () => {}, closed: () => false });
    // The dropped attach request times out inside `create()`'s try block, so the caller sees the same
    // generic refusal it always has; the leak fix changes cleanup, not this outward result.
    expect(await launch.receipt).toEqual({ ok: false, refusal: 'unavailable', detail: null });
    // The bound session was released with a compensating close, reaching the broker exactly once.
    await vi.waitFor(() => expect(closeAcks).toEqual([sessionId]));
  });

  it('reports a refused compensating close through onReconcile instead of discarding it', async () => {
    // Same leaked-bind scenario as above, but this time the compensating close ALSO gets no answer
    // (both `attach` and `close` are dropped), so it comes back refused. That refusal must not be
    // discarded silently - it is reported through `onReconcile`, the same hook the abandoned-session
    // reconciliation path already uses, and carries only the refusal code, never prompt or key text.
    const reconciled: Array<{ sessionId: string; error: string }> = [];
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => new ExitsOnKillPty() }, makeSessionId: () => sessionId,
      now: () => '2026-09-02T00:00:00.000Z', log: () => {} });
    const [clientSocket, serverSocket] = droppingPair(['attach', 'close']);
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 4 });
    const client = new LinuxBrokerClient({ connect: async () => clientSocket, dashboardEpochId: epochId,
      makeRequestId: () => 'req-0123456789abcdef0123456789abcdef', requestTimeoutMs: 30,
      onReconcile: (info) => reconciled.push(info) });
    await client.probe();
    const launch = client.create({ operationKey, principal,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 },
    { data: () => {}, exit: () => {}, closed: () => false });
    expect(await launch.receipt).toEqual({ ok: false, refusal: 'unavailable', detail: null });
    await vi.waitFor(() => expect(reconciled).toEqual([{ sessionId, error: 'unavailable' }]));
  });
});

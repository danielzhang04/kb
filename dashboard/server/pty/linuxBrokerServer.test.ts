import { EventEmitter } from 'node:events';
import { Duplex, PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { BrokerClientFrame, BrokerServerFrame } from '../../shared/ptyProtocol.ts';
import { BrokerFrameDecoder, decodeBrokerServerFrame, encodeBrokerFrame } from './brokerProtocol.ts';
import { BROKER_RUNTIME_POLICY, buildBrokerLaunch, type BrokerLaunchSpec } from './fdPinnedPaths.ts';
import { NodePtyChild, PipeStdinChild, assertBrokerRuntimeNode, brokerRuntimePolicy,
  decodeBrokerRuntimeState, loadRuntimeState, nodePtySpawnOptions, parseLinuxBrokerInvocation,
  runLinuxBrokerEntrypoint, terminateVerifiedIdentity, validateServiceIdentity } from './linuxBrokerMain.ts';
import {
  LinuxBrokerServer,
  MAX_BROKER_RECEIPTS,
  listenOnUnixSocket,
  type BrokerPty,
  type BrokerPtyLauncher,
  type BrokerRuntimeState,
} from './linuxBrokerServer.ts';

class MemoryDuplex extends Duplex {
  peer: MemoryDuplex | null = null;
  _read(): void {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.peer?.push(Buffer.from(chunk));
    done();
  }
  _final(done: (error?: Error | null) => void): void { this.peer?.push(null); done(); }
}

class SlowDuplex extends Duplex {
  constructor() { super({ writableHighWaterMark: 1 }); }
  _read(): void {}
  _write(_chunk: Buffer, _encoding: BufferEncoding, _done: (error?: Error | null) => void): void {}
}

function pair(): [MemoryDuplex, MemoryDuplex] {
  const left = new MemoryDuplex();
  const right = new MemoryDuplex();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

class FakePty implements BrokerPty {
  readonly pid = 4321;
  readonly identity = { pid: 4321, pgid: 4321, startTimeTicks: '99' };
  readonly writes: Uint8Array[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  kills = 0;
  inputEnds = 0;
  private dataListener: (data: Uint8Array) => void = () => {};
  private exitListener: (exitCode: number | null, signal: number | null) => void = () => {};
  /** Records the ORDER of both operations: an end-input that overtook a write is visible here. */
  readonly calls: string[] = [];
  write(data: Uint8Array): Promise<boolean> {
    this.writes.push(data); this.calls.push('write'); return Promise.resolve(true);
  }
  endInput(): void { this.inputEnds += 1; this.calls.push('endInput'); }
  resize(cols: number, rows: number): void { this.resizes.push({ cols, rows }); }
  kill(): void { this.kills += 1; }
  onData(listener: (data: Uint8Array) => void): void { this.dataListener = listener; }
  onExit(listener: (exitCode: number | null, signal: number | null) => void): void { this.exitListener = listener; }
  emitData(data: string | Uint8Array): void { this.dataListener(typeof data === 'string' ? Buffer.from(data) : data); }
  emitExit(code: number | null): void { this.exitListener(code, null); }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const requestId = 'req-0123456789abcdef0123456789abcdef';
const epochId = 'epoch-0123456789abcdef0123456789abcdef';
const operationKey = 'op-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const shellRecipe = { launcher: 'shell', mode: 'interactive', model: null,
  toolPolicyId: 'shell-default', sandbox: 'interactive' } as const;
const headlessRecipe = { launcher: 'claude', mode: 'headless-json', model: 'claude-opus-5',
  toolPolicyId: 'producer', sandbox: 'claude-policy' } as const;

/**
 * A child that owns BOTH sinks a broker child can have - a stdin pipe and a pty master - and routes
 * `write` by the `stdinMode` its launch spec carried. A headless child whose input went to the pty
 * would be the live failure in mirror image: the bytes would echo into the transcript and the CLI,
 * reading `--input-format stream-json` off fd 0, would wait for a prompt that never came.
 */
class TwoSinkPty implements BrokerPty {
  readonly pid = 5150;
  readonly identity = { pid: 5150, pgid: 5150, startTimeTicks: '7' };
  readonly pipeWrites: Uint8Array[] = [];
  readonly ptyWrites: Uint8Array[] = [];
  inputEnds = 0;
  private readonly stdinMode: BrokerLaunchSpec['stdinMode'];
  constructor(stdinMode: BrokerLaunchSpec['stdinMode']) { this.stdinMode = stdinMode; }
  readonly calls: string[] = [];
  /** Gated so a test can hold a write in flight and prove an end-input queues BEHIND it. */
  gate: Promise<void> | null = null;
  async write(data: Uint8Array): Promise<boolean> {
    if (this.gate !== null) await this.gate;
    (this.stdinMode === 'pipe' ? this.pipeWrites : this.ptyWrites).push(Buffer.from(data));
    this.calls.push('write');
    return true;
  }
  /** A tty-mode child would throw here, as `NodePtyChild` does; the server must never call it. */
  endInput(): void {
    if (this.stdinMode !== 'pipe') throw new Error('a tty session has no stdin pipe to end');
    this.inputEnds += 1;
    this.calls.push('endInput');
  }
  resize(): void {}
  kill(): void {}
  onData(): void {}
  onExit(): void {}
}

/** A broker plus a connected client, driving create/exit cycles that exercise the receipt ring. */
function makeReceiptHarness() {
  const children: FakePty[] = [];
  let snapshot: BrokerRuntimeState | null = null;
  let sessionCounter = 0;
  const operationKeyOf = (index: number): string => `op-${index.toString(16).padStart(64, '0')}`;
  const options = {
    epochId, expectedClientUid: 1000, expectedClientGid: 1000,
    launcher: { launch: async () => { const child = new FakePty(); children.push(child); return child; } },
    makeSessionId: () => `pty-${(sessionCounter++).toString(16).padStart(32, '0')}`,
    now: () => '2026-08-22T00:00:00.000Z',
    persistState: (state: BrokerRuntimeState) => { snapshot = structuredClone(state); },
  };
  const attach = (server: LinuxBrokerServer) => {
    const [clientSocket, serverSocket] = pair();
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    clientSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });
    clientSocket.write(encodeBrokerFrame({ type: 'hello', requestId, sessionId: null,
      protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId }));
    return {
      frames,
      create: (index: number): void => {
        clientSocket.write(encodeBrokerFrame({ type: 'create',
          requestId: `req-${index.toString(16).padStart(32, '0')}`, sessionId: null, epochId,
          operationKey: operationKeyOf(index), recipe: shellRecipe,
          rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 }));
      },
    };
  };
  const primary = attach(new LinuxBrokerServer(options));
  return {
    children, options, attach, frames: primary.frames, create: primary.create,
    operationKey: operationKeyOf,
    snapshot: (): BrokerRuntimeState | null => snapshot,
    createThenExit: async (index: number): Promise<void> => {
      primary.create(index);
      await tick();
      children.at(-1)!.emitExit(0);
      await tick();
    },
  };
}

describe('LinuxBrokerServer', () => {
  it('accepts only the exact fd-3 process interface and prints exact protocol bytes', async () => {
    expect(parseLinuxBrokerInvocation(['--socket-fd=3', '--protocol-version=kb-shell-broker/v1']))
      .toEqual({ kind: 'serve', socketFd: 3 });
    expect(parseLinuxBrokerInvocation(['--print-protocol-version'])).toEqual({ kind: 'print-version' });
    for (const argv of [[], ['--socket-fd=4', '--protocol-version=kb-shell-broker/v1'],
      ['--protocol-version=kb-shell-broker/v1'], ['--socket-fd=3'],
      ['--socket-fd=3', '--protocol-version=kb-shell-broker/v1', '--extra'],
      ['--print-protocol-version', '--extra']]) expect(() => parseLinuxBrokerInvocation(argv)).toThrow(/arguments/);
    let stdout = '';
    expect(await runLinuxBrokerEntrypoint(['--print-protocol-version'], {
      stdout: (value) => { stdout += value; }, stderr: () => {}, isSocketFd: () => false,
      start: async () => ({ epochId, close: async () => {} }),
    })).toBe(0);
    expect(Buffer.from(stdout)).toEqual(Buffer.from('kb-shell-broker/v1\n'));
    let reason = '';
    expect(await runLinuxBrokerEntrypoint(['--socket-fd=3', '--protocol-version=kb-shell-broker/v1'], {
      stdout: () => {}, stderr: (value) => { reason += value; }, isSocketFd: () => false,
      start: async () => { throw new Error('must not start'); },
    })).toBe(1);
    expect(reason.trim()).toBe('fd 3 is not a socket');
    expect(reason.trim().split('\n')).toHaveLength(1);
  });

  it('requires the named non-root kb-shell and kb-dashboard uid/gid policy', () => {
    const accounts = 'kb-shell:x:1002:1002::/var/lib/kb-shell/home:/usr/sbin/nologin\nkb-dashboard:x:1001:1001::/nonexistent:/usr/sbin/nologin\n';
    const groups = 'kb-shell:x:1002:\nkb-dashboard:x:1001:\n';
    expect(validateServiceIdentity(accounts, groups, { uid: 1002, gid: 1002 }))
      .toEqual({ shellUid: 1002, shellGid: 1002, dashboardUid: 1001, dashboardGid: 1001 });
    expect(() => validateServiceIdentity(accounts, groups, { uid: 0, gid: 1002 })).toThrow('root');
    expect(() => validateServiceIdentity(accounts, groups, { uid: 1002, gid: 1001 })).toThrow('gid');
  });

  it('does not kill a reused pid whose proc start time differs', async () => {
    const kill = vi.fn();
    await terminateVerifiedIdentity({ pid: 91, pgid: 91, startTimeTicks: '100' }, {
      read: async () => ({ pid: 91, pgid: 91, startTimeTicks: '101' }), kill,
    });
    expect(kill).not.toHaveBeenCalled();
  });

  it('refuses oversized runtime state from fstat before parsing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'kb-broker-state-'));
    const statePath = join(directory, 'state.json');
    try {
      writeFileSync(statePath, Buffer.alloc(262_145, 0x20));
      await expect(loadRuntimeState(statePath)).rejects.toThrow('oversized');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('passes binary input to node-pty byte-for-byte', async () => {
    const writes: unknown[] = [];
    const native = { pid: 91, write: (data: unknown) => { writes.push(data); }, resize: () => {}, kill: () => {},
      onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) };
    const child = new NodePtyChild(native as never, { pid: 91, pgid: 91, startTimeTicks: '9' });
    await child.write(Buffer.from([0xff]));
    expect(writes).toHaveLength(1);
    expect(Buffer.isBuffer(writes[0])).toBe(true);
    expect(writes[0]).toEqual(Buffer.from([0xff]));
  });

  it('carries binary PTY output through node-pty without UTF-8 decoding', async () => {
    expect(nodePtySpawnOptions(buildBrokerLaunch(shellRecipe, 'repo', '', { cols: 80, rows: 24 })).encoding)
      .toBeNull();
    let emit!: (data: string | Uint8Array) => void;
    const native = { pid: 91, write: () => {}, resize: () => {}, kill: () => {},
      onData: (listener: (data: string | Uint8Array) => void) => { emit = listener; return { dispose() {} }; },
      onExit: () => ({ dispose() {} }) };
    const child = new NodePtyChild(native as never, { pid: 91, pgid: 91, startTimeTicks: '9' });
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => child }, makeSessionId: () => 'pty-0123456789abcdef0123456789abcdef',
      now: () => '2026-08-22T00:00:00.000Z' });
    const [clientSocket, serverSocket] = pair();
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    clientSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });
    clientSocket.write(encodeBrokerFrame({ type: 'hello', requestId, sessionId: null,
      protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId }));
    clientSocket.write(encodeBrokerFrame({ type: 'create', requestId, sessionId: null, epochId, operationKey,
      recipe: shellRecipe, rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 }));
    await tick();
    emit(Buffer.from([0xff, 0xfe, 0x00, 0x80]));
    await tick();
    const data = frames.find((frame) => frame.type === 'data') as { data: string } | undefined;
    expect(Buffer.from(data!.data, 'base64')).toEqual(Buffer.from([0xff, 0xfe, 0x00, 0x80]));
  });

  it('holds an input in flight until the pty master socket drains', async () => {
    const drains: Array<() => void> = [];
    const socket = { writableNeedDrain: true,
      once: (event: string, listener: () => void) => { if (event === 'drain') drains.push(listener); } };
    const native = { pid: 91, _socket: socket, write: () => {}, resize: () => {}, kill: () => {},
      onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) };
    const child = new NodePtyChild(native as never, { pid: 91, pgid: 91, startTimeTicks: '9' });
    let settled = false;
    const pending = child.write(Buffer.from('a')).then(() => { settled = true; });
    await tick();
    expect(settled).toBe(false);
    expect(drains).toHaveLength(1);
    socket.writableNeedDrain = false;
    for (const drain of drains) drain();
    await pending;
    expect(settled).toBe(true);
    // Without an observable master socket the in-flight window is bounded only by the 262,144-byte cap.
    const opaque = new NodePtyChild({ ...native, _socket: undefined } as never,
      { pid: 92, pgid: 92, startTimeTicks: '9' });
    await expect(opaque.write(Buffer.from('a'))).resolves.toBe(true);
  });

  it('enforces runtime state ownership, mode, and runtime directory mode from policy', async () => {
    const policy = brokerRuntimePolicy({ shellUid: 1002, shellGid: 1002, dashboardUid: 1001, dashboardGid: 1001 });
    expect(policy.state.modes).toEqual([BROKER_RUNTIME_POLICY.stateMode]);
    expect(policy.directory.modes).toContain(BROKER_RUNTIME_POLICY.runtimeDirectoryMode);
    expect(policy.directoryPath).toBe(BROKER_RUNTIME_POLICY.runtimeDirectory);
    expect(() => assertBrokerRuntimeNode({ mode: 0o100600, uid: 1002, gid: 1002 }, policy.state, 'state file'))
      .not.toThrow();
    for (const stats of [{ mode: 0o100644, uid: 1002, gid: 1002 }, { mode: 0o100660, uid: 1002, gid: 1002 },
      { mode: 0o100600, uid: 0, gid: 1002 }, { mode: 0o100600, uid: 1002, gid: 0 }]) {
      expect(() => assertBrokerRuntimeNode(stats, policy.state, 'state file')).toThrow('violates policy');
    }
    expect(() => assertBrokerRuntimeNode({ mode: 0o040750, uid: 1002, gid: 1001 }, policy.directory, 'directory'))
      .not.toThrow();
    for (const stats of [{ mode: 0o040755, uid: 1002, gid: 1001 }, { mode: 0o040770, uid: 1002, gid: 1001 },
      { mode: 0o040750, uid: 1001, gid: 1001 }]) {
      expect(() => assertBrokerRuntimeNode(stats, policy.directory, 'directory')).toThrow('violates policy');
    }

    const directory = mkdtempSync(join(tmpdir(), 'kb-broker-policy-'));
    const statePath = join(directory, 'state.json');
    try {
      writeFileSync(statePath, JSON.stringify({ protocol: 'kb-shell-broker/v1',
        epochId: `epoch-${'a'.repeat(32)}`, sessions: [], receipts: [] }));
      const stateStats = statSync(statePath);
      const directoryStats = statSync(directory);
      const observed = {
        state: { uid: stateStats.uid, gids: [stateStats.gid], modes: [stateStats.mode & 0o7777] },
        directory: { uid: directoryStats.uid, gids: [directoryStats.gid], modes: [directoryStats.mode & 0o7777] },
        directoryPath: directory,
      };
      await expect(loadRuntimeState(statePath, observed)).resolves.toMatchObject({ sessions: [], receipts: [] });
      await expect(loadRuntimeState(statePath,
        { ...observed, state: { ...observed.state, uid: stateStats.uid + 1 } }))
        .rejects.toThrow('violates policy');
      await expect(loadRuntimeState(statePath,
        { ...observed, state: { ...observed.state, modes: [0o007] } })).rejects.toThrow('violates policy');
      await expect(loadRuntimeState(statePath,
        { ...observed, directory: { ...observed.directory, modes: [0o007] } })).rejects.toThrow('violates policy');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('refuses a 0700 kb-shell:kb-shell runtime directory instead of booting unreachable', () => {
    // The old shape (service-owned RuntimeDirectory, 0700 kb-shell:kb-shell) leaves broker.sock
    // untraversable by kb-dashboard. Accepting it produced a broker that starts and is never
    // reached; the only accepted shape is the socket unit's kb-shell:kb-dashboard 0750.
    const policy = brokerRuntimePolicy({ shellUid: 1002, shellGid: 1002, dashboardUid: 1001, dashboardGid: 1001 });
    expect(policy.directory.gids).toEqual([1001]);
    expect(policy.directory.modes).toEqual([0o750]);
    expect(() => assertBrokerRuntimeNode({ mode: 0o040700, uid: 1002, gid: 1002 }, policy.directory, 'directory'))
      .toThrow('violates policy');
    expect(() => assertBrokerRuntimeNode({ mode: 0o040750, uid: 1002, gid: 1002 }, policy.directory, 'directory'))
      .toThrow('violates policy');
    expect(() => assertBrokerRuntimeNode({ mode: 0o040700, uid: 1002, gid: 1001 }, policy.directory, 'directory'))
      .toThrow('violates policy');
    expect(() => assertBrokerRuntimeNode({ mode: 0o040750, uid: 1002, gid: 1001 }, policy.directory, 'directory'))
      .not.toThrow();
  });

  it('uses only a canonical Unix listen path and checks the post-listen address', async () => {
    const fake = {
      listen: vi.fn((_path: string, callback: () => void) => callback()),
      address: vi.fn(() => '/run/kb-shell/broker.sock'),
    };
    await listenOnUnixSocket(fake, { fd: 3, expectedPath: '/run/kb-shell/broker.sock' });
    expect(fake.listen).toHaveBeenCalledWith({ fd: 3 }, expect.any(Function));
    await expect(listenOnUnixSocket(fake, { fd: 4, expectedPath: '/run/kb-shell/broker.sock' }))
      .rejects.toThrow('fd 3');
    fake.address.mockReturnValue('\\\\.\\pipe\\broker');
    await expect(listenOnUnixSocket(fake, { fd: 3, expectedPath: '/run/kb-shell/broker.sock' })).rejects.toThrow('canonical');
  });

  it('serves create/input/output/close with broker-owned launch data and strict bounds', async () => {
    const child = new FakePty();
    const launcher: BrokerPtyLauncher = { launch: vi.fn(async () => child) };
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000, launcher,
      makeSessionId: () => 'pty-0123456789abcdef0123456789abcdef',
      now: () => '2026-08-22T00:00:00.000Z' });
    const [clientSocket, serverSocket] = pair();
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    clientSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });

    const send = (frame: BrokerClientFrame) => clientSocket.write(encodeBrokerFrame(frame));
    send({ type: 'hello', requestId, sessionId: null, protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId });
    send({ type: 'create', requestId, sessionId: null, epochId, operationKey,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 });
    await tick();
    expect(launcher.launch).toHaveBeenCalledWith(expect.objectContaining({ executable: '/bin/bash' }));
    const sessionId = 'pty-0123456789abcdef0123456789abcdef';
    send({ type: 'input', requestId, sessionId, epochId, sequence: 0, encoding: 'base64', data: 'YQ==' });
    child.emitData('ok');
    await tick();
    expect(child.writes).toEqual([Buffer.from('a')]);
    expect(frames).toContainEqual(expect.objectContaining({ type: 'data', sessionId, data: 'b2s=' }));

    send({ type: 'input', requestId, sessionId, epochId, sequence: 1, encoding: 'base64',
      data: Buffer.alloc(65_537).toString('base64') });
    await tick();
    expect(frames).toContainEqual(expect.objectContaining({ type: 'error', code: 'input-too-large' }));
  });

  /**
   * The stdin switch as the SERVER sees it. `create` resolves the recipe into a spec whose
   * `stdinMode` the launcher acts on, and every accepted `input` frame goes to `child.write` - the
   * stdin pipe for a headless child, the pty master for an interactive one. Both recipes are driven
   * through the same broker in one test so a change that collapses the two is red here.
   */
  it('routes input to the stdin pipe for a headless recipe and to the pty for a shell recipe', async () => {
    const specs: BrokerLaunchSpec[] = [];
    const children: TwoSinkPty[] = [];
    let sessionCounter = 0;
    const server = new LinuxBrokerServer({
      epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: {
        launch: async (spec) => {
          specs.push(spec);
          const child = new TwoSinkPty(spec.stdinMode);
          children.push(child);
          return child;
        },
      },
      makeSessionId: () => `pty-${(sessionCounter++).toString(16).padStart(32, '0')}`,
      now: () => '2026-09-03T00:00:00.000Z',
    });
    const [clientSocket, serverSocket] = pair();
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    clientSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });
    const send = (frame: BrokerClientFrame): void => { clientSocket.write(encodeBrokerFrame(frame)); };
    send({ type: 'hello', requestId, sessionId: null, protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId });

    const sessionOf = (index: number): string => `pty-${index.toString(16).padStart(32, '0')}`;
    for (const [index, recipe] of [headlessRecipe, shellRecipe].entries()) {
      send({ type: 'create', requestId: `req-${index.toString(16).padStart(32, '0')}`, sessionId: null,
        epochId, operationKey: `op-${index.toString(16).padStart(64, '0')}`, recipe,
        rootId: 'worktrees', relativeCwd: 'run-1', cols: 80, rows: 24 });
      await tick();
      send({ type: 'input', requestId, sessionId: sessionOf(index), epochId, sequence: 0,
        encoding: 'base64', data: Buffer.from(`prompt-${index}`).toString('base64') });
      await tick();
    }

    expect(specs.map((spec) => spec.stdinMode)).toEqual(['pipe', 'tty']);
    const [headless, shell] = children;
    expect(headless!.pipeWrites).toEqual([Buffer.from('prompt-0')]);
    expect(headless!.ptyWrites).toEqual([]);
    expect(shell!.ptyWrites).toEqual([Buffer.from('prompt-1')]);
    expect(shell!.pipeWrites).toEqual([]);
    expect(frames.filter((frame) => frame.type === 'error')).toEqual([]);
    expect(frames).toContainEqual(expect.objectContaining({ type: 'ack', action: 'input',
      sessionId: sessionOf(0), accepted: 8 }));
  });

  /**
   * Frames arriving in ONE socket chunk are decoded in one synchronous loop, and every handler awaits
   * `persist()` before it touches the child - so an `end-input` decoded second could reach the child
   * FIRST and close the pipe on a prompt still in flight, which is the same lost-instruction failure
   * the frame exists to prevent. The child's work is queued per session, so the order the frames were
   * decoded in is the order the child sees.
   *
   * RED ON REVERT: drop `session.inputTail` and call `child.write`/`child.endInput` directly, and the
   * gated write below lets the end-input past - `calls` comes back `['endInput', 'write']`.
   */
  it('runs a queued end-input behind the write that was decoded before it', async () => {
    const children: TwoSinkPty[] = [];
    let release = (): void => {};
    const server = new LinuxBrokerServer({
      epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: {
        launch: async (spec) => {
          const child = new TwoSinkPty(spec.stdinMode);
          child.gate = new Promise<void>((resolve) => { release = resolve; });
          children.push(child);
          return child;
        },
      },
      makeSessionId: () => `pty-${'0'.repeat(32)}`,
      now: () => '2026-09-03T00:00:00.000Z',
    });
    const [clientSocket, serverSocket] = pair();
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    clientSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });
    const sessionId = `pty-${'0'.repeat(32)}`;
    clientSocket.write(encodeBrokerFrame({ type: 'hello', requestId, sessionId: null,
      protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId }));
    clientSocket.write(encodeBrokerFrame({ type: 'create', requestId, sessionId: null, epochId,
      operationKey, recipe: headlessRecipe, rootId: 'worktrees', relativeCwd: 'run-1', cols: 80, rows: 24 }));
    await tick();

    // ONE chunk, so both frames are decoded before either handler resumes past its first await.
    clientSocket.write(Buffer.concat([
      encodeBrokerFrame({ type: 'input', requestId: `req-${'1'.repeat(32)}`, sessionId, epochId,
        sequence: 0, encoding: 'base64', data: Buffer.from('prompt').toString('base64') }),
      encodeBrokerFrame({ type: 'end-input', requestId: `req-${'2'.repeat(32)}`, sessionId, epochId, sequence: 1 }),
    ]));
    await tick();
    // The write is still gated, so nothing has reached the child - least of all the EOF.
    expect(children[0]!.calls).toEqual([]);
    release();
    await vi.waitFor(() => expect(children[0]!.calls).toEqual(['write', 'endInput']));
    expect(children[0]!.pipeWrites).toEqual([Buffer.from('prompt')]);
    expect(frames.filter((frame) => frame.type === 'error')).toEqual([]);
    expect(frames).toContainEqual(expect.objectContaining({ type: 'ack', action: 'input', accepted: 6 }));
    expect(frames).toContainEqual(expect.objectContaining({ type: 'ack', action: 'end-input' }));
  });

  /**
   * `end-input` end to end through the server, on the same two-recipe harness as the routing test
   * above - because the whole point of the frame is that it means something on ONE of them.
   *
   * Four rules, one session table:
   *   - a pipe-mode session's end-input reaches THAT child's `endInput`, after the input already sent;
   *   - a tty session's is refused (there is no write end to close, and `TwoSinkPty.endInput` throws
   *     if it is ever called for one, so a regression cannot pass this quietly);
   *   - a second one for the same session is refused - EOF is a one-way door;
   *   - and every `input` after an accepted end-input is refused, rather than acked as accepted into
   *     a pipe that can no longer take it.
   */
  it('half-closes a pipe-mode child once, and refuses end-input on a tty, twice, or after it', async () => {
    const children: TwoSinkPty[] = [];
    let sessionCounter = 0;
    const server = new LinuxBrokerServer({
      epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: {
        launch: async (spec) => { const child = new TwoSinkPty(spec.stdinMode); children.push(child); return child; },
      },
      makeSessionId: () => `pty-${(sessionCounter++).toString(16).padStart(32, '0')}`,
      now: () => '2026-09-03T00:00:00.000Z',
    });
    const [clientSocket, serverSocket] = pair();
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    clientSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });
    const send = (frame: BrokerClientFrame): void => { clientSocket.write(encodeBrokerFrame(frame)); };
    const req = (index: number): string => `req-${index.toString(16).padStart(32, '0')}`;
    const sessionOf = (index: number): string => `pty-${index.toString(16).padStart(32, '0')}`;
    send({ type: 'hello', requestId, sessionId: null, protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId });
    for (const [index, recipe] of [headlessRecipe, shellRecipe].entries()) {
      send({ type: 'create', requestId: req(index), sessionId: null, epochId,
        operationKey: `op-${index.toString(16).padStart(64, '0')}`, recipe,
        rootId: 'worktrees', relativeCwd: 'run-1', cols: 80, rows: 24 });
      await tick();
    }

    send({ type: 'input', requestId: req(10), sessionId: sessionOf(0), epochId, sequence: 0,
      encoding: 'base64', data: Buffer.from('prompt').toString('base64') });
    await tick();
    send({ type: 'end-input', requestId: req(11), sessionId: sessionOf(0), epochId, sequence: 1 });
    await tick();
    expect(children[0]!.inputEnds).toBe(1);
    expect(children[0]!.pipeWrites).toEqual([Buffer.from('prompt')]);
    expect(frames).toContainEqual(expect.objectContaining({
      type: 'ack', action: 'end-input', requestId: req(11), sessionId: sessionOf(0) }));

    // Unknown session: answered `not-found` off the session table, never routed anywhere.
    send({ type: 'end-input', requestId: req(12), sessionId: `pty-${'f'.repeat(32)}`, epochId, sequence: 0 });
    // A tty session, which has no stdin pipe at all.
    send({ type: 'end-input', requestId: req(13), sessionId: sessionOf(1), epochId, sequence: 0 });
    // The same pipe session a second time.
    send({ type: 'end-input', requestId: req(14), sessionId: sessionOf(0), epochId, sequence: 2 });
    // ...and bytes after the door closed.
    send({ type: 'input', requestId: req(15), sessionId: sessionOf(0), epochId, sequence: 2,
      encoding: 'base64', data: Buffer.from('late').toString('base64') });
    await tick();

    const refusalOf = (id: string): unknown => frames.find(
      (frame) => frame.type === 'error' && frame.requestId === id);
    expect(refusalOf(req(12))).toMatchObject({ code: 'not-found' });
    expect(refusalOf(req(13))).toMatchObject({ code: 'invalid-request' });
    expect(refusalOf(req(14))).toMatchObject({ code: 'invalid-request' });
    expect(refusalOf(req(15))).toMatchObject({ code: 'invalid-request' });
    // Not one refused frame moved the child: no second half-close, and no late byte.
    expect(children[0]!.inputEnds).toBe(1);
    expect(children[0]!.pipeWrites).toEqual([Buffer.from('prompt')]);
    expect(children[1]!.inputEnds).toBe(0);
    expect(frames.some((frame) => frame.type === 'ack' && frame.action === 'end-input'
      && frame.requestId !== req(11))).toBe(false);
  });

  /**
   * The two descriptor rules a pipe-mode child lives under, on the one interleaving that separates
   * them from `settled`: the pty master can go BEFORE the process is reaped (the child closed fd 1
   * and fd 2, or the master reported EIO first), which leaves `settle` waiting on the exit status
   * with the master's descriptor already closed and its NUMBER free for the next open.
   *
   *   - No resize may reach that number afterwards. An ioctl on a recycled descriptor is EBADF or
   *     ENOTTY surfaced to the client as `internal` AFTER the server advanced inputSequence, which
   *     desyncs the session - or, worse, a TIOCSWINSZ landing on another session's pty.
   *   - The stdin pipe is closed when the exit is reported. Left open it is a descriptor and a libuv
   *     handle leaked per completed headless run, and a pending `write` waits on a 'close' that never
   *     comes.
   */
  it('stops resizing a pipe-mode child once its master is gone and closes its stdin at exit', async () => {
    const resizes: Array<{ fd: number; cols: number; rows: number }> = [];
    const exits: Array<number | null> = [];
    const stdin = new PassThrough();
    const master = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, kill: () => {} });
    const wrapped = new PipeStdinChild(4321, child as never, master as never, 77,
      (fd, cols, rows) => { resizes.push({ fd, cols, rows }); });
    wrapped.onExit((exitCode) => exits.push(exitCode));

    wrapped.resize(100, 30);
    expect(resizes).toEqual([{ fd: 77, cols: 100, rows: 30 }]);

    // The master goes first; nothing has reaped the process, so the exit is still pending.
    master.destroy();
    await tick();
    expect(exits).toEqual([]);
    wrapped.resize(120, 40);
    expect(resizes).toEqual([{ fd: 77, cols: 100, rows: 30 }]);
    expect(stdin.destroyed).toBe(false);

    child.emit('exit', 7, null);
    await tick();
    expect(exits).toEqual([7]);
    expect(stdin.destroyed).toBe(true);
    // Reported once, and still no resize gets through.
    child.emit('exit', 9, null);
    wrapped.resize(140, 50);
    await tick();
    expect(exits).toEqual([7]);
    expect(resizes).toHaveLength(1);
  });

  /**
   * `PipeStdinChild.endInput` is a HALF-close and nothing more. `end()`, not `destroy()`: the child
   * must see EOF on fd 0 while its output keeps arriving on the pty master and its exit is still
   * observed the ordinary way. If this ever became a destroy, a codex child would lose the tail of its
   * own transcript at the exact moment it started producing it.
   */
  it('half-closes a pipe-mode child stdin without touching its output or its exit', async () => {
    const chunks: string[] = [];
    const exits: Array<number | null> = [];
    const stdin = new PassThrough();
    const master = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, kill: () => {} });
    const wrapped = new PipeStdinChild(4321, child as never, master as never, 78, () => {});
    wrapped.onData((data) => chunks.push(Buffer.from(data).toString('utf8')));
    wrapped.onExit((exitCode) => exits.push(exitCode));

    await expect(wrapped.write(Buffer.from('prompt'))).resolves.toBe(true);
    wrapped.endInput();
    expect(stdin.writableEnded).toBe(true);
    expect(stdin.destroyed).toBe(false);
    // RED ON REVERT: make `write` resolve `true` unconditionally and this goes red - the broker would
    // then ack bytes that the closed write end swallowed as `accepted`, which is the silent input loss
    // the end-input frame exists to end.
    await expect(wrapped.write(Buffer.from('after-eof'))).resolves.toBe(false);
    // A second call is a no-op rather than an ERR_STREAM_WRITE_AFTER_END thrown at the frame handler.
    expect(() => wrapped.endInput()).not.toThrow();

    // Output after EOF still arrives, and the exit still reports.
    master.write(Buffer.from('AFTER-EOF'));
    await tick();
    expect(chunks.join('')).toContain('AFTER-EOF');
    master.destroy();
    child.emit('exit', 0, null);
    await tick();
    expect(exits).toEqual([0]);

    // The other half of the contract: an interactive child REFUSES to pretend. Its fd 0 is the pty
    // slave it shares with fd 1/2, so there is no write end to close and closing the master would take
    // its output with it - the server never asks, and this is what happens if it ever does.
    const native = { pid: 91, write: () => {}, resize: () => {}, kill: () => {},
      onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) };
    expect(() => new NodePtyChild(native as never).endInput())
      .toThrow('an interactive pty session has no stdin pipe to end');
  });

  /**
   * D6: a spawn that never became a process. `child_process` reports it as an 'error' event and never
   * an 'exit', so the session's exit frame carries no code and no signal - which tells an operator
   * nothing at all. The reason belongs in the transcript, the one place they are already looking, as
   * one bounded ASCII line so a byte-exact transcript stays byte-exact.
   */
  it('writes a failed spawn into the transcript instead of exiting silently', async () => {
    const chunks: string[] = [];
    const exits: Array<number | null> = [];
    const stdin = new PassThrough();
    const master = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, kill: () => {} });
    const wrapped = new PipeStdinChild(4321, child as never, master as never, 77, () => {});
    wrapped.onData((data) => chunks.push(Buffer.from(data).toString('latin1')));
    wrapped.onExit((exitCode) => exits.push(exitCode));

    child.emit('error', new Error('spawn /proc/self/fd/9 ENOENT\nsecond line \u00e9'));
    await tick();
    // One line, printable ASCII only, and the newline and the accented byte are gone.
    expect(chunks).toEqual(['[broker] spawn failed: spawn /proc/self/fd/9 ENOENT second line  \r\n']);
    expect(exits).toEqual([null]);
    expect(stdin.destroyed).toBe(true);
  });

  it('kills an old epoch, finalizes an exit once, and drops a late exit after shutdown', async () => {
    const children: FakePty[] = [];
    const emitted: BrokerServerFrame[] = [];
    const killOrphan = vi.fn();
    const identity = { pid: 88, pgid: 88, startTimeTicks: '123' };
    let sessionCounter = 0;
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => { const child = new FakePty(); children.push(child); return child; } },
      makeSessionId: () => `pty-${(sessionCounter++).toString(16).padStart(32, '0')}`,
      now: () => '2026-08-22T00:00:00.000Z',
      recoveredSessions: [{ sessionId: 'pty-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', epochId: 'epoch-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', identity }],
      killOrphan });
    server.onFrame((frame) => emitted.push(frame));
    await server.recoverOrphans();
    expect(killOrphan).toHaveBeenCalledWith(identity);
    expect(server.orphanSessionIds()).toEqual([]);

    const [clientSocket, serverSocket] = pair();
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });
    const send = (frame: BrokerClientFrame) => clientSocket.write(encodeBrokerFrame(frame));
    send({ type: 'hello', requestId, sessionId: null, protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId });
    const create = (index: number): void => void send({ type: 'create',
      requestId: `req-${index.toString(16).padStart(32, '0')}`, sessionId: null, epochId,
      operationKey: `op-${index.toString(16).padStart(64, '0')}`,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 });

    create(0);
    await tick();
    const first = 'pty-' + '0'.repeat(32);
    // node-pty can deliver an exit twice; the session must be finalized exactly once
    children[0]!.emitExit(0);
    await tick();
    children[0]!.emitExit(0);
    await tick();
    expect(emitted.filter((frame) => frame.type === 'exit' && frame.sessionId === first)).toHaveLength(1);

    // a real late exit: shutdown suppresses this epoch and kills the child, whose exit lands after
    create(1);
    await tick();
    await server.shutdown();
    expect(children[1]!.kills).toBe(1);
    const beforeLateExit = emitted.length;
    children[1]!.emitExit(0);
    await tick();
    expect(emitted.slice(beforeLateExit)).toEqual([]);
  });

  // The gated writes below are the same shape production sees: NodePtyChild.write stays pending
  // while the pty master socket needs a drain, so queuedInputBytes is a real in-flight measure.
  it('bounds queued decoded input at 262,144 bytes without dropping accepted writes', async () => {
    const gates: Array<() => void> = [];
    const writes: Uint8Array[] = [];
    const child: BrokerPty = {
      pid: 55, identity: { pid: 55, pgid: 55, startTimeTicks: '5' },
      write: (data) => { writes.push(data); return new Promise<boolean>((resolve) => gates.push(() => resolve(true))); },
      endInput: () => {}, resize: () => {}, kill: () => {}, onData: () => {}, onExit: () => {},
    };
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => child }, makeSessionId: () => 'pty-0123456789abcdef0123456789abcdef',
      now: () => '2026-08-22T00:00:00.000Z' });
    const [clientSocket, serverSocket] = pair();
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    clientSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });
    const send = (frame: BrokerClientFrame) => clientSocket.write(encodeBrokerFrame(frame));
    send({ type: 'hello', requestId, sessionId: null, protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId });
    send({ type: 'create', requestId, sessionId: null, epochId, operationKey,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 });
    await tick();
    const data = Buffer.alloc(65_536).toString('base64');
    clientSocket.write(Buffer.concat(Array.from({ length: 5 }, (_, index) => encodeBrokerFrame({
      type: 'input', requestId: `req-${index.toString(16).padStart(32, '0')}`,
        sessionId: 'pty-0123456789abcdef0123456789abcdef', epochId, sequence: index,
        encoding: 'base64', data }))));
    await tick();
    expect(writes).toHaveLength(4);
    expect(serverSocket.isPaused()).toBe(true);
    expect(frames).toContainEqual(expect.objectContaining({ type: 'error', code: 'input-too-large' }));
    for (const release of gates) release();
    await tick();
    expect(serverSocket.isPaused()).toBe(false);
    expect(frames.filter((frame) => frame.type === 'ack' && frame.action === 'input')).toHaveLength(4);
  });

  it('kills a spawned child and sends no create ack when durable persistence fails', async () => {
    const child = new FakePty();
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => child }, makeSessionId: () => 'pty-0123456789abcdef0123456789abcdef',
      now: () => '2026-08-22T00:00:00.000Z', persistState: async () => { throw new Error('disk failed'); } });
    const [clientSocket, serverSocket] = pair();
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    clientSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });
    clientSocket.write(encodeBrokerFrame({ type: 'hello', requestId, sessionId: null,
      protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId }));
    clientSocket.write(encodeBrokerFrame({ type: 'create', requestId, sessionId: null, epochId, operationKey,
      recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
      rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 }));
    await tick(); await tick();
    expect(child.kills).toBe(1);
    expect(frames.some((frame) => frame.type === 'ack' && frame.action === 'create')).toBe(false);
  });

  it('refuses a replayed operationKey after exit instead of launching a second shell', async () => {
    const cycles = makeReceiptHarness();
    for (let index = 0; index < 20; index += 1) await cycles.createThenExit(index);
    expect(cycles.children).toHaveLength(20);
    expect(cycles.snapshot()!.sessions).toEqual([]);
    expect(cycles.snapshot()!.receipts.length).toBeLessThanOrEqual(MAX_BROKER_RECEIPTS);

    // the terminal receipt for cycle 0 is retained, so its replay is refused with no new child
    cycles.create(0);
    await tick();
    expect(cycles.children).toHaveLength(20);
    expect(cycles.frames.at(-1)).toMatchObject({ type: 'error', code: 'not-found' });

    // the persisted receipts load back through the real decoder and still refuse that replay
    const restored = decodeBrokerRuntimeState(cycles.snapshot());
    const restarted = new LinuxBrokerServer({ ...cycles.options, recoveredSessions: restored.sessions,
      recoveredReceipts: restored.receipts });
    await restarted.recoverOrphans();
    const replay = cycles.attach(restarted);
    replay.create(0);
    await tick();
    expect(cycles.children).toHaveLength(20);
    expect(replay.frames.at(-1)).toMatchObject({ type: 'error', code: 'not-found' });
    replay.create(999);
    await tick();
    expect(cycles.children).toHaveLength(21);
    expect(replay.frames.at(-1)).toMatchObject({ type: 'ack', action: 'create', replayed: false });
  });

  it('bounds the receipt ring at 16 live plus 64 terminal, evicting oldest first', async () => {
    const cycles = makeReceiptHarness();
    for (let index = 0; index < 70; index += 1) {
      await cycles.createThenExit(index);
      expect(cycles.snapshot()!.receipts.length).toBeLessThanOrEqual(MAX_BROKER_RECEIPTS);
    }
    const keys = cycles.snapshot()!.receipts.map((receipt) => receipt.operationKey);
    expect(keys).toHaveLength(64);
    expect(keys).not.toContain(cycles.operationKey(0));
    expect(keys.at(-1)).toBe(cycles.operationKey(69));
    // an evicted key is a fresh create again — the acknowledged bound of the ring
    cycles.create(0);
    await tick();
    expect(cycles.children).toHaveLength(71);
  });

  it('refuses an unsafe cwd by request id and keeps serving the socket', async () => {
    const logs: string[] = [];
    const server = new LinuxBrokerServer({
      epochId,
      expectedClientUid: 1000,
      expectedClientGid: 1000,
      launcher: { launch: async () => new FakePty() },
      enumerateLaunchers: async () => ['shell'],
      makeSessionId: () => 'pty-0123456789abcdef0123456789abcdef',
      now: () => '2026-09-02T00:00:00.000Z',
      log: (message) => logs.push(message),
    });
    const [clientSocket, serverSocket] = pair();
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    clientSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    server.accept(serverSocket, { uid: 1000, gid: 1000, pid: 99 });
    clientSocket.write(encodeBrokerFrame({
      type: 'hello', requestId: 'req-11111111111111111111111111111111', sessionId: null,
      protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId,
    }));
    await tick();
    clientSocket.write(Buffer.concat([
      encodeBrokerFrame({
        type: 'create', requestId: 'req-22222222222222222222222222222222', sessionId: null,
        epochId, operationKey,
        recipe: { launcher: 'shell', mode: 'interactive', model: null,
          toolPolicyId: 'shell-default', sandbox: 'interactive' },
        rootId: 'repo', relativeCwd: '..', cols: 80, rows: 24,
      }),
      encodeBrokerFrame({
        type: 'launchers', requestId: 'req-33333333333333333333333333333333',
        sessionId: null, epochId,
      }),
    ]));
    await tick();

    expect(frames.at(-2)).toMatchObject({
      type: 'error', requestId: 'req-22222222222222222222222222222222', code: 'unsafe-cwd',
    });
    expect(serverSocket.destroyed).toBe(false);
    expect(logs).toEqual(['broker: refused request unsafe-cwd']);
    expect(frames.at(-1)).toMatchObject({
      type: 'launchers', requestId: 'req-33333333333333333333333333333333', launchers: ['shell'],
    });
  });

  it('bounds all outbound frames and detaches a client that never drains', async () => {
    const child = new FakePty();
    const server = new LinuxBrokerServer({ epochId, expectedClientUid: 1000, expectedClientGid: 1000,
      launcher: { launch: async () => child }, makeSessionId: () => 'pty-0123456789abcdef0123456789abcdef',
      now: () => '2026-08-22T00:00:00.000Z' });
    const socket = new SlowDuplex();
    server.accept(socket, { uid: 1000, gid: 1000, pid: 99 });
    socket.push(Buffer.concat([
      encodeBrokerFrame({ type: 'hello', requestId, sessionId: null,
        protocol: 'kb-shell-broker/v1', dashboardEpochId: epochId }),
      encodeBrokerFrame({ type: 'create', requestId, sessionId: null, epochId, operationKey,
        recipe: { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'shell-default', sandbox: 'interactive' },
        rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 }),
    ]));
    await tick();
    for (let index = 0; index < 18; index += 1) child.emitData(Buffer.alloc(65_536));
    expect(socket.destroyed).toBe(true);
  });
});

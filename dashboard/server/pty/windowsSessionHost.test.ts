import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';
import * as nodePty from 'node-pty';

import type { BrowserPrincipal, LaunchRecipe, SessionHostRequest, SessionSink } from './contracts.ts';
import { RUN_CONTROLLER_NULL_BROWSER_SESSION_REF } from './contracts.ts';
import {
  createWindowsTreeCloser,
  createWindowsSessionHost,
  inspectWindowsSessionHostResources,
  TaskkillNoSuchProcessError,
} from './windowsSessionHost.ts';

class FakePty {
  readonly pid: number;
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  writes: string[] = [];
  sizes: Array<[number, number]> = [];
  killCalls = 0;

  constructor(pid: number) { this.pid = pid; }
  onData(listener: (data: string) => void) {
    this.dataListeners.push(listener);
    return { dispose: () => { this.dataListeners = this.dataListeners.filter((item) => item !== listener); } };
  }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.push(listener);
    return { dispose: () => { this.exitListeners = this.exitListeners.filter((item) => item !== listener); } };
  }
  write(data: string) { this.writes.push(data); }
  resize(cols: number, rows: number) { this.sizes.push([cols, rows]); }
  kill() { this.killCalls += 1; }
  emitData(data: string) { for (const listener of this.dataListeners) listener(data); }
  emitExit(exitCode = 0) { for (const listener of this.exitListeners) listener({ exitCode }); }
  listenerCount() { return this.dataListeners.length + this.exitListeners.length; }
}

const shellRecipe: LaunchRecipe = {
  launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'interactive', sandbox: 'interactive',
};

const principal = (operator = 'operator-a', browserSessionRef = 'browser-a'): BrowserPrincipal =>
  ({ operator, browserSessionRef });

const request = (suffix: string, owner: BrowserPrincipal = principal()): SessionHostRequest => ({
  operationKey: `op-${suffix.repeat(64)}`,
  principal: owner,
  recipe: shellRecipe,
  rootId: 'repo',
  relativeCwd: '',
  cols: 80,
  rows: 24,
});

function sink(events: string[]): SessionSink {
  return {
    data(frame) { events.push(`data:${Buffer.from(frame.data, 'base64').toString('utf8')}`); },
    exit(observed) { events.push(`exit:${observed.reason}:${observed.exitCode}`); },
    closed() { return false; },
  };
}

function fakeLaunch(environment: Record<string, string> = {}) {
  return {
    launcher: 'shell' as const,
    file: 'cmd',
    args: [] as string[],
    cwd: 'C:\\repo',
    env: environment,
    validationPaths: [] as string[],
    rootValidationPaths: [] as string[],
    codexShim: null,
    codexEntry: null,
  };
}

describe('Windows SessionHost', () => {
  it('runs a bounded real node-pty child on this Windows host', async () => {
    const windowsRoot = process.env.SystemRoot;
    expect(windowsRoot).toBeTruthy();
    const host = createWindowsSessionHost({
      epochId: `epoch-${'0'.repeat(32)}`,
      roots: { repo: process.cwd(), worktrees: process.cwd() },
      resolveLaunch: async () => ({
        ok: true,
        value: { ...fakeLaunch({ SystemRoot: windowsRoot as string }),
          file: `${windowsRoot}\\System32\\cmd.exe`, args: ['/d', '/s', '/c', 'exit 0'],
          cwd: process.cwd(),
        },
      }),
      spawn: nodePty.spawn,
    });
    let sessionId: string | null = null;
    try {
      const launch = host.create(request('0'), sink([]));
      const receipt = await launch.receipt;
      expect(receipt).toMatchObject({ ok: true });
      if (receipt.ok) sessionId = receipt.value.sessionId;
      await expect(launch.exit).resolves.toMatchObject({ exitCode: 0, reason: 'exited' });
    } finally {
      if (sessionId !== null) await host.close(sessionId);
    }
  }, 10_000);

  it('records transcript data before ordered additive sink fan-out and observes exit', async () => {
    const child = new FakePty(101);
    const events: string[] = [];
    const host = createWindowsSessionHost({
      epochId: `epoch-${'1'.repeat(32)}`,
      now: () => new Date('2026-08-23T12:00:00.000Z'),
      randomId: () => 'a'.repeat(32),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      transcript: {
        async data(_sessionId, sequence) { events.push(`record:${sequence}`); },
        async exit(observed) { events.push(`record-exit:${observed.reason}`); },
      },
      killProcessTree: async () => {},
    });
    const launch = host.create(request('a'), sink(events));
    const receipt = await launch.receipt;
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    await host.attach(receipt.value.sessionId, sink(events));
    child.emitData('one');
    child.emitData('two');
    child.emitExit(0);
    await expect(launch.exit).resolves.toMatchObject({ exitCode: 0, reason: 'exited', sequence: 3 });
    expect(events).toEqual([
      'record:1', 'data:one', 'data:one',
      'record:2', 'data:two', 'data:two',
      'record-exit:exited', 'exit:exited:0', 'exit:exited:0',
    ]);
  });

  it('reserves the final host and principal slots atomically without leaks', async () => {
    const children: FakePty[] = [];
    const host = createWindowsSessionHost({
      epochId: `epoch-${'2'.repeat(32)}`,
      randomId: (() => { let id = 0; return () => (++id).toString(16).padStart(32, '0'); })(),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      hostCapacity: 1,
      principalCapacity: 1,
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => { const child = new FakePty(children.length + 1); children.push(child); return child; },
      killProcessTree: async () => {},
    });
    const [first, second] = await Promise.all([
      host.create(request('b'), sink([])).receipt,
      host.create(request('c'), sink([])).receipt,
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].filter((result) => !result.ok)).toEqual([
      { ok: false, refusal: 'capacity', detail: null },
    ]);
    children[0].emitExit(0);
    await Promise.resolve();
    const third = await host.create(request('d'), sink([])).receipt;
    expect(third.ok).toBe(true);
  });

  it('refuses a ninth session for one composite principal while another principal still succeeds', async () => {
    const children: FakePty[] = [];
    const host = createWindowsSessionHost({
      epochId: `epoch-${'3'.repeat(32)}`,
      randomId: (() => { let id = 100; return () => (++id).toString(16).padStart(32, '0'); })(),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => { const child = new FakePty(children.length + 1); children.push(child); return child; },
      killProcessTree: async () => {},
    });

    // Nine creates for one {operator, browserSessionRef}, spread across both roots so no per-root
    // bucket could account for the refusal.
    const owner = principal('operator-a', 'browser-a');
    const receipts = await Promise.all(
      Array.from({ length: 9 }, (_, index) => host.create({
        ...request((index + 1).toString(16), owner),
        rootId: index % 2 === 0 ? 'repo' : 'worktrees',
      }, sink([])).receipt),
    );
    expect(receipts.slice(0, 8).every((receipt) => receipt.ok)).toBe(true);
    expect(receipts[8]).toEqual({ ok: false, refusal: 'capacity', detail: null });

    // A different browserSessionRef for the same operator is a different bucket and is not starved.
    const sameOperatorOtherBrowser = await host.create(
      request('a', principal('operator-a', 'browser-b')), sink([])).receipt;
    expect(sameOperatorOtherBrowser.ok).toBe(true);
    // So is a controller-null Run session, which counts against its own operator's bucket.
    const runSession = await host.create(
      request('b', principal('operator-b', RUN_CONTROLLER_NULL_BROWSER_SESSION_REF)), sink([])).receipt;
    expect(runSession.ok).toBe(true);
    for (const child of children) child.emitExit(0);
  });

  it('refuses a malformed principal or an unknown root id before spawning', async () => {
    let spawnCount = 0;
    const host = createWindowsSessionHost({
      epochId: `epoch-${'4'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => { spawnCount += 1; return new FakePty(140); },
      killProcessTree: async () => {},
    });
    const malformed: SessionHostRequest[] = [
      { ...request('4'), principal: undefined } as unknown as SessionHostRequest,
      { ...request('4'), principal: { operator: '', browserSessionRef: 'browser-a' } },
      { ...request('4'), principal: { operator: 'operator-a', browserSessionRef: '' } },
      { ...request('4'), rootId: undefined } as unknown as SessionHostRequest,
    ];
    for (const candidate of malformed) {
      await expect(host.create(candidate, sink([])).receipt).resolves.toEqual({
        ok: false, refusal: 'invalid-request', detail: null,
      });
    }
    expect(spawnCount).toBe(0);
  });

  it('rechecks pinned identities immediately before spawn and never launches a replacement', async () => {
    let spawnCount = 0;
    const host = createWindowsSessionHost({
      epochId: `epoch-${'a'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      serviceSid: 'S-1-5-21-service',
      pathInspector: {
        async pin(path) {
          return {
            path,
            fileId: path,
            canonicalPath: path,
            ownerSid: 'S-1-5-18',
            unsafeWriteAce: false,
            async currentFileId() {
              return path.endsWith('cmd.exe') ? 'replacement' : path;
            },
            async close() {},
          };
        },
        async readText() { return ''; },
      },
      resolveLaunch: async () => ({ ok: true, value: {
        ...fakeLaunch(), validationPaths: ['C:\\repo', 'C:\\Windows\\System32\\cmd.exe'],
        rootValidationPaths: ['C:\\repo'],
      } }),
      spawn: () => { spawnCount += 1; return new FakePty(141); },
      killProcessTree: async () => {},
    });
    await expect(host.create(request('a'), sink([])).receipt).resolves.toEqual({
      ok: false, refusal: 'launcher-unavailable', detail: null,
    });
    expect(spawnCount).toBe(0);
  });

  it('shares a pending exact operation receipt and refuses a changed replay', async () => {
    const child = new FakePty(150);
    let releaseProfile = (_value: ReturnType<typeof fakeLaunch>): void => {};
    const profileBarrier = new Promise<ReturnType<typeof fakeLaunch>>((resolve) => { releaseProfile = resolve; });
    const host = createWindowsSessionHost({
      epochId: `epoch-${'5'.repeat(32)}`,
      randomId: () => '5'.repeat(32),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: await profileBarrier }),
      spawn: () => child,
      killProcessTree: async () => {},
    });
    const first = host.create(request('5'), sink([]));
    const replay = host.create(request('5'), sink([]));
    const changed = host.create({ ...request('5'), cols: 81 }, sink([]));
    await expect(changed.receipt).resolves.toEqual({
      ok: false, refusal: 'binding-conflict', detail: null,
    });
    let replaySettled = false;
    void replay.receipt.then(() => { replaySettled = true; });
    await Promise.resolve();
    expect(replaySettled).toBe(false);
    releaseProfile(fakeLaunch());
    const [firstReceipt, replayReceipt] = await Promise.all([first.receipt, replay.receipt]);
    expect(firstReceipt.ok && replayReceipt.ok).toBe(true);
    if (!firstReceipt.ok || !replayReceipt.ok) return;
    expect(replayReceipt.value).toEqual({ ...firstReceipt.value, replayed: true });
    child.emitExit(0);
  });

  it('cancels a reserved starting session before spawn and releases its slot', async () => {
    let releaseProfile = (_value: ReturnType<typeof fakeLaunch>): void => {};
    const profileBarrier = new Promise<ReturnType<typeof fakeLaunch>>((resolve) => { releaseProfile = resolve; });
    let spawnCount = 0;
    const host = createWindowsSessionHost({
      epochId: `epoch-${'6'.repeat(32)}`,
      randomId: (() => { let id = 30; return () => (++id).toString(16).padStart(32, '0'); })(),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      hostCapacity: 1,
      resolveLaunch: async () => ({ ok: true, value: await profileBarrier }),
      spawn: () => { spawnCount += 1; return new FakePty(160); },
      killProcessTree: async () => {},
    });
    const launch = host.create(request('6'), sink([]));
    const drain = host.drain(`epoch-${'6'.repeat(32)}`);
    releaseProfile(fakeLaunch());
    await expect(launch.receipt).resolves.toEqual({ ok: false, refusal: 'cancelled', detail: null });
    await expect(drain).resolves.toMatchObject({ ok: true, value: { closed: [expect.any(String)] } });
    expect(spawnCount).toBe(0);
    const next = host.create(request('7'), sink([]));
    await expect(next.receipt).resolves.toMatchObject({ ok: true });
  });

  it('bounds input and resize before invoking the live PTY', async () => {
    const child = new FakePty(170);
    const host = createWindowsSessionHost({
      epochId: `epoch-${'7'.repeat(32)}`,
      randomId: () => '7'.repeat(32),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      killProcessTree: async () => {},
    });
    const receipt = await host.create(request('8'), sink([])).receipt;
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    await expect(host.write(receipt.value.sessionId, new Uint8Array(65_537))).resolves.toEqual({
      ok: false, refusal: 'input-too-large', detail: null,
    });
    await expect(host.write(receipt.value.sessionId, new TextEncoder().encode('echo ok'))).resolves.toEqual({
      ok: true, value: { accepted: 7 },
    });
    await expect(host.resize(receipt.value.sessionId, { cols: 19, rows: 24 })).resolves.toEqual({
      ok: false, refusal: 'size-out-of-range', detail: null,
    });
    await expect(host.resize(receipt.value.sessionId, { cols: 120, rows: 40 })).resolves.toEqual({
      ok: true, value: { cols: 120, rows: 40 },
    });
    expect(child.writes).toEqual(['echo ok']);
    expect(child.sizes).toEqual([[120, 40]]);
    child.emitExit(0);
  });

  it('refuses the seventeenth concurrent session on the host ceiling alone', async () => {
    const hostChildren: FakePty[] = [];
    const host = createWindowsSessionHost({
      epochId: `epoch-${'9'.repeat(32)}`,
      randomId: (() => { let id = 200; return () => (++id).toString(16).padStart(32, '0'); })(),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => { const child = new FakePty(300 + hostChildren.length); hostChildren.push(child); return child; },
      killProcessTree: async () => {},
    });
    // Seventeen distinct principals, so the 8-per-principal bucket can never be the refusing ceiling;
    // roots alternate to prove the refusal is not keyed on rootId either.
    const hostRace = await Promise.all(Array.from({ length: 17 }, (_, index) =>
      host.create({
        ...request('0', principal(`operator-${index}`, `browser-${index}`)),
        operationKey: `op-${index.toString(16).padStart(64, '0')}`,
        rootId: index % 2 === 0 ? 'repo' : 'worktrees',
      }, sink([])).receipt));
    expect(hostRace.filter((result) => result.ok)).toHaveLength(16);
    expect(hostRace.filter((result) => !result.ok)).toEqual([
      { ok: false, refusal: 'capacity', detail: null },
    ]);
    for (const child of hostChildren) child.emitExit(0);
  });

  it('closes the process tree, waits for observed exit, and lists/drains only its epoch', async () => {
    const children: FakePty[] = [];
    const killed: number[] = [];
    const host = createWindowsSessionHost({
      epochId: `epoch-${'3'.repeat(32)}`,
      randomId: (() => { let id = 10; return () => (++id).toString(16).padStart(32, '0'); })(),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => { const child = new FakePty(children.length + 20); children.push(child); return child; },
      killProcessTree: async (pid) => { killed.push(pid); children.find((child) => child.pid === pid)?.emitExit(1); },
    });
    const first = await host.create(request('e'), sink([])).receipt;
    const second = await host.create(request('f'), sink([])).receipt;
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    await expect(host.listEpoch()).resolves.toEqual({
      ok: true,
      value: { epochId: `epoch-${'3'.repeat(32)}`, sessionIds: [first.value.sessionId, second.value.sessionId] },
    });
    await expect(host.drain(`epoch-${'4'.repeat(32)}`)).resolves.toEqual({
      ok: false, refusal: 'epoch-lost', detail: null,
    });
    await expect(host.close(first.value.sessionId)).resolves.toMatchObject({
      ok: true, value: { reason: 'closed', exitCode: 1 },
    });
    await expect(host.drain(`epoch-${'3'.repeat(32)}`)).resolves.toEqual({
      ok: true,
      value: { epochId: `epoch-${'3'.repeat(32)}`, closed: [second.value.sessionId], alreadyGone: [] },
    });
    expect(killed).toEqual([20, 21]);
  });

  it('retries taskkill failures and gives every helper a fresh minimal environment', async () => {
    const calls: Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
    const closer = createWindowsTreeCloser({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      PATH: 'C:\\unsafe',
      PROVIDER_SESSION: 'never-copy',
    }, (file, args, options) => {
      calls.push({ file, args, env: options.env });
      const helper = new EventEmitter();
      queueMicrotask(() => helper.emit('close', 1));
      return helper;
    });
    await expect(closer(4242)).rejects.toThrow('taskkill failed');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      file: 'C:\\Windows\\System32\\taskkill.exe',
      args: ['/T', '/F', '/PID', '4242'],
      env: { SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp' },
    });
    expect(calls[1]).toEqual(calls[0]);
  });

  it('reports tree-close failure without falling back to direct child kill', async () => {
    const child = new FakePty(4250);
    const host = createWindowsSessionHost({
      epochId: `epoch-${'b'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      killProcessTree: async () => { throw new Error('taskkill failed'); },
    });
    const receipt = await host.create(request('b'), sink([])).receipt;
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    await expect(host.close(receipt.value.sessionId)).resolves.toEqual({
      ok: false, refusal: 'internal', detail: null,
    });
    expect(child.killCalls).toBe(0);
    child.emitExit(1);
  });

  it('uses the tree closer for a post-spawn cancellation and kills the fake grandchild', async () => {
    const child = new FakePty(4260);
    let grandchildAlive = true;
    let recordedExits = 0;
    let drainPromise: ReturnType<ReturnType<typeof createWindowsSessionHost>['drain']> | undefined;
    let host!: ReturnType<typeof createWindowsSessionHost>;
    host = createWindowsSessionHost({
      epochId: `epoch-${'c'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => {
        drainPromise = host.drain(`epoch-${'c'.repeat(32)}`);
        return child;
      },
      killProcessTree: async () => {
        grandchildAlive = false;
      },
      transcript: { exit() { recordedExits += 1; } },
    });
    const launch = host.create(request('c'), sink([]));
    let receiptSettled = false;
    void launch.receipt.then(() => { receiptSettled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(receiptSettled).toBe(false);
    child.emitExit(1);
    await expect(launch.receipt).resolves.toEqual({ ok: false, refusal: 'cancelled', detail: null });
    await expect(drainPromise).resolves.toMatchObject({ ok: true });
    await expect(launch.exit).resolves.toMatchObject({ reason: 'closed', exitCode: 1 });
    expect(grandchildAlive).toBe(false);
    expect(child.killCalls).toBe(0);
    child.emitExit(2);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(recordedExits).toBe(1);
  });

  it('uses the tree closer when listener wiring fails after spawn', async () => {
    const child = new FakePty(4265);
    child.onData = () => { throw new Error('listener wiring failed'); };
    const treeClosed: number[] = [];
    const host = createWindowsSessionHost({
      epochId: `epoch-${'1'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      killProcessTree: async (pid) => { treeClosed.push(pid); child.emitExit(1); },
    });
    await expect(host.create(request('1'), sink([])).receipt).resolves.toEqual({
      ok: false, refusal: 'launcher-unavailable', detail: null,
    });
    expect(treeClosed).toEqual([4265]);
    expect(child.killCalls).toBe(0);
  });

  it('awaits each sink independently and detaches only a sink buffered above 1 MiB', async () => {
    const child = new FakePty(4270);
    let releaseSlow = (): void => {};
    const slowBarrier = new Promise<void>((resolve) => { releaseSlow = resolve; });
    let slowFrames = 0;
    let fastFrames = 0;
    const slowSink: SessionSink = {
      async data() { slowFrames += 1; await slowBarrier; },
      exit() {},
      closed() { return false; },
    };
    const fastSink: SessionSink = {
      data() { fastFrames += 1; },
      exit() {},
      closed() { return false; },
    };
    const host = createWindowsSessionHost({
      epochId: `epoch-${'d'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      killProcessTree: async () => { child.emitExit(1); },
    });
    const launch = host.create(request('d'), slowSink);
    const receipt = await launch.receipt;
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    await host.attach(receipt.value.sessionId, fastSink);
    child.emitData('x'.repeat(65_536));
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (let index = 1; index < 17; index += 1) child.emitData('x'.repeat(65_536));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fastFrames).toBe(17);
    expect(slowFrames).toBe(1);
    releaseSlow();
    child.emitExit(0);
    await launch.exit;
  });

  it('bounds a slow transcript at 1 MiB and closes the process tree on overflow', async () => {
    const child = new FakePty(4280);
    let treeCloses = 0;
    const transcriptBarrier = new Promise<void>(() => {});
    const host = createWindowsSessionHost({
      epochId: `epoch-${'e'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      transcript: { async data() { await transcriptBarrier; } },
      killProcessTree: async () => { treeCloses += 1; child.emitExit(1); },
    });
    const launch = host.create(request('e'), sink([]));
    await expect(launch.receipt).resolves.toMatchObject({ ok: true });
    for (let index = 0; index < 17; index += 1) child.emitData('x'.repeat(65_536));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(treeCloses).toBe(1);
    await expect(launch.exit).resolves.toMatchObject({ reason: 'closed', exitCode: 1 });
  });

  it('releases child, listener, session, and sink resources after observed exit', async () => {
    const child = new FakePty(4290);
    const host = createWindowsSessionHost({
      epochId: `epoch-${'f'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      killProcessTree: async () => {},
    });
    const launch = host.create(request('f'), sink([]));
    await expect(launch.receipt).resolves.toMatchObject({ ok: true });
    child.emitExit(0);
    await launch.exit;
    expect(child.listenerCount()).toBe(0);
    expect(inspectWindowsSessionHostResources(host)).toEqual({
      sessions: 0, childRefs: 0, listeners: 0, sinks: 0, operations: 1,
    });
  });

  it('spawns through the uninjected resolver with the pin/ACL block active', async () => {
    const windowsRoot = process.env.SystemRoot;
    expect(windowsRoot).toBeTruthy();
    const systemRoot = windowsRoot as string;
    const spawned: Array<{ file: string; cwd: string | undefined }> = [];
    // `resolveLaunch` is NOT injected: the real mapWindowsLaunchRecipe runs and the host therefore
    // builds a real createWindowsPathPinInspector, so the pin/ACL/file-id recheck block executes.
    // Only the argv is bounded, by wrapping the real node-pty spawner.
    const host = createWindowsSessionHost({
      epochId: `epoch-${'2'.repeat(32)}`,
      roots: { repo: systemRoot, worktrees: systemRoot },
      spawn: (file, _args, spawnOptions) => {
        spawned.push({ file, cwd: spawnOptions.cwd });
        return nodePty.spawn(file, ['/d', '/s', '/c', 'exit 0'], spawnOptions);
      },
    });
    let sessionId: string | null = null;
    try {
      const launch = host.create(request('2'), sink([]));
      const receipt = await launch.receipt;
      expect(receipt).toMatchObject({ ok: true });
      if (receipt.ok) sessionId = receipt.value.sessionId;
      // The pinned executable is the server-derived cmd.exe, never a PATH lookup.
      expect(spawned).toEqual([{ file: `${systemRoot}\\System32\\cmd.exe`, cwd: systemRoot }]);
      await expect(launch.exit).resolves.toMatchObject({ exitCode: 0, reason: 'exited' });
      // D8: a host built on the real resolver has a wired pathInspector. An unwired one short-circuits
      // every probe to `root-policy-invalid`, so reaching any other outcome proves the wiring. Which
      // optional launchers pass their ACL check is machine-dependent, so only the wiring is asserted.
      const probe = await host.probe();
      expect(probe.available ? 'wired' : probe.reason).not.toBe('root-policy-invalid');
      // Contrast: injecting resolveLaunch turns the inspector off, and the probe says so.
      const unpinned = createWindowsSessionHost({
        epochId: `epoch-${'2'.repeat(32)}`,
        roots: { repo: systemRoot, worktrees: systemRoot },
        resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      });
      await expect(unpinned.probe()).resolves.toMatchObject({
        available: false, reason: 'root-policy-invalid',
      });
    } finally {
      if (sessionId !== null) await host.close(sessionId);
    }
  }, 20_000);

  it('resolves close and drain when a sink data callback never settles', async () => {
    const child = new FakePty(4300);
    const wedged: SessionSink = {
      data() { return new Promise<void>(() => {}); },
      exit() {},
      closed() { return false; },
    };
    const host = createWindowsSessionHost({
      epochId: `epoch-${'2'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      drainTimeoutMs: 20,
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      killProcessTree: async () => { child.emitExit(0); },
    });
    const launch = host.create(request('2'), wedged);
    const receipt = await launch.receipt;
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    // One frame is now parked forever inside the sink's data() promise.
    child.emitData('wedge');
    await expect(host.close(receipt.value.sessionId)).resolves.toMatchObject({
      ok: true, value: { reason: 'closed' },
    });
    await expect(launch.exit).resolves.toMatchObject({ reason: 'closed' });
    await expect(host.drain(`epoch-${'2'.repeat(32)}`)).resolves.toMatchObject({ ok: true });
  }, 10_000);

  it('reports a clean close when the child already exited despite a failed tree close', async () => {
    const child = new FakePty(4310);
    const host = createWindowsSessionHost({
      epochId: `epoch-${'3'.repeat(32)}`,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      // The child exits naturally in the window between the exitValue check and the closer returning,
      // exactly as taskkill exit 128 ("no such process") reports.
      killProcessTree: async () => {
        child.emitExit(0);
        throw new TaskkillNoSuchProcessError();
      },
    });
    const receipt = await host.create(request('3'), sink([])).receipt;
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    await expect(host.close(receipt.value.sessionId)).resolves.toMatchObject({
      ok: true, value: { reason: 'closed', exitCode: 0 },
    });
  });

  it('does not retry taskkill when it reports exit code 128', async () => {
    const calls: string[][] = [];
    const closer = createWindowsTreeCloser({ SystemRoot: 'C:\\Windows' }, (_file, args) => {
      calls.push(args);
      const helper = new EventEmitter();
      queueMicrotask(() => helper.emit('close', 128));
      return helper;
    });
    await expect(closer(4315)).rejects.toBeInstanceOf(TaskkillNoSuchProcessError);
    expect(calls).toHaveLength(1);
  });

  it('releases host and principal reservations when a close is unrecoverable', async () => {
    const children: FakePty[] = [];
    const host = createWindowsSessionHost({
      epochId: `epoch-${'4'.repeat(32)}`,
      randomId: (() => { let id = 400; return () => (++id).toString(16).padStart(32, '0'); })(),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      hostCapacity: 2,
      principalCapacity: 2,
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => { const child = new FakePty(4320 + children.length); children.push(child); return child; },
      killProcessTree: async () => { throw new Error('taskkill failed'); },
    });
    const owner = principal('operator-a', 'browser-a');
    for (const suffix of ['4', '5']) {
      const launch = host.create(request(suffix, owner), sink([]));
      const receipt = await launch.receipt;
      expect(receipt.ok).toBe(true);
      if (!receipt.ok) return;
      await expect(host.close(receipt.value.sessionId)).resolves.toEqual({
        ok: false, refusal: 'internal', detail: null,
      });
      // The abandoned session resolves create()'s exit promise instead of hanging it.
      await expect(launch.exit).resolves.toMatchObject({ reason: 'abandoned', exitCode: null });
    }
    // Both slots were released, so a third create for the same principal still fits.
    const third = await host.create(request('6', owner), sink([])).receipt;
    expect(third.ok).toBe(true);
    expect(inspectWindowsSessionHostResources(host)).toMatchObject({ sessions: 1, childRefs: 1 });
  });

  it('evicts terminal operations beyond the retention bound and keeps live ones', async () => {
    const children: FakePty[] = [];
    const host = createWindowsSessionHost({
      epochId: `epoch-${'5'.repeat(32)}`,
      randomId: (() => { let id = 500; return () => (++id).toString(16).padStart(32, '0'); })(),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => { const child = new FakePty(4400 + children.length); children.push(child); return child; },
      killProcessTree: async () => {},
    });
    // One long-lived session first; it must survive every later eviction sweep.
    const liveReceipt = await host.create(request('7'), sink([])).receipt;
    expect(liveReceipt.ok).toBe(true);
    for (let index = 0; index < 80; index += 1) {
      const launch = host.create({
        ...request('8'),
        operationKey: `op-${index.toString(16).padStart(64, '0')}`,
      }, sink([])).receipt;
      await launch;
      children[children.length - 1].emitExit(0);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    const counts = inspectWindowsSessionHostResources(host);
    expect(counts.operations).toBeLessThanOrEqual(64);
    expect(counts.sessions).toBe(1);
    // The live session's own operation entry was never evicted, so its receipt still replays.
    if (!liveReceipt.ok) return;
    const replay = await host.create(request('7'), sink([])).receipt;
    expect(replay).toEqual({ ok: true, value: { ...liveReceipt.value, replayed: true } });
    children[0].emitExit(0);
  }, 10_000);

  it('replays a receipt for an identical request written with a different key order', async () => {
    const child = new FakePty(4500);
    const host = createWindowsSessionHost({
      epochId: `epoch-${'6'.repeat(32)}`,
      randomId: () => '6'.repeat(32),
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      resolveLaunch: async () => ({ ok: true, value: fakeLaunch() }),
      spawn: () => child,
      killProcessTree: async () => {},
    });
    const original = request('9');
    const reordered: SessionHostRequest = {
      rows: original.rows,
      cols: original.cols,
      relativeCwd: original.relativeCwd,
      rootId: original.rootId,
      recipe: {
        sandbox: original.recipe.sandbox,
        toolPolicyId: original.recipe.toolPolicyId,
        model: original.recipe.model,
        mode: original.recipe.mode,
        launcher: original.recipe.launcher,
      },
      principal: {
        browserSessionRef: original.principal.browserSessionRef,
        operator: original.principal.operator,
      },
      operationKey: original.operationKey,
    };
    const first = await host.create(original, sink([])).receipt;
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replay = await host.create(reordered, sink([])).receipt;
    expect(replay).toEqual({ ok: true, value: { ...first.value, replayed: true } });
    child.emitExit(0);
  });
});

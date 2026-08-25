import { describe, expect, it } from 'vitest';
import {
  P4_LIFECYCLE_EXIT, defaultReadyProbe, parseP4FixtureLifecycleArgs, runP4FixtureLifecycle,
} from './p4FixtureLifecycle.ts';
import type { LifecycleChild, P4FixtureLifecycleDeps } from './p4FixtureLifecycle.ts';
import { startP4FixtureServer } from './p4FixtureServer.ts';

/** A fake child with no real process: exit is driven by the test. */
class FakeChild implements LifecycleChild {
  readonly pid = 1234;
  readonly signals: string[] = [];
  private exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  constructor(private readonly exitCode: number | null, private readonly autoExit = true) {}
  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? 'SIGTERM');
    this.exitListener?.(this.exitCode, null);
    return true;
  }
  once(event: 'exit' | 'error', listener: (...args: never[]) => void): unknown {
    if (event === 'exit') {
      this.exitListener = listener as never;
      if (this.autoExit) queueMicrotask(() => this.exitListener?.(this.exitCode, null));
    }
    // 'error' listeners are accepted (structural ChildProcess compatibility) but never fired here.
    return this;
  }
}

function deps(overrides: Partial<P4FixtureLifecycleDeps>): P4FixtureLifecycleDeps {
  return {
    spawn: () => new FakeChild(0),
    readyProbe: async () => true,
    now: () => 0,
    sleep: async () => undefined,
    onSignal: () => () => undefined,
    ...overrides,
  };
}

const options = {
  fixtureArgv: ['server/testFixtures/p4FixtureServer.ts', '--port', '4421'],
  clientArgv: ['node', 'client.ts'],
  readyUrl: 'https://127.0.0.1:4421/readyz',
  readyTimeoutMs: 1000,
  shutdownTimeoutMs: 500,
  pollIntervalMs: 10,
};

describe('parseP4FixtureLifecycleArgs', () => {
  it('splits own flags from the client argv after `--`', () => {
    const parsed = parseP4FixtureLifecycleArgs([
      '--fixture', 'real', '--scenario', 'partial-source-failure', '--https', '--port', '4423',
      '--', 'node', 'server/testFixtures/p4ActualBrowserRunner.ts', '--matrix', 'all',
    ]);
    expect(parsed.clientArgv).toEqual(['node', 'server/testFixtures/p4ActualBrowserRunner.ts', '--matrix', 'all']);
    expect(parsed.readyUrl).toBe('https://127.0.0.1:4423/readyz');
    expect(parsed.fixtureArgv).toContain('real');
    expect(parsed.fixtureArgv).toContain('--https');
  });
  it('requires a client command after `--`', () => {
    expect(() => parseP4FixtureLifecycleArgs(['--fixture', 'bounded'])).toThrow(/client command/);
  });
  it('spawns the fixture as `node <server>.ts` (execPath first, then the module)', () => {
    const parsed = parseP4FixtureLifecycleArgs(['--port', '4421', '--', 'node', 'client.ts']);
    expect(parsed.fixtureArgv[0]).toBe(process.execPath);
    expect(parsed.fixtureArgv[1]).toBe('server/testFixtures/p4FixtureServer.ts');
  });
});

describe('defaultReadyProbe — real HTTP readiness', () => {
  it('returns true once a live fixture server answers /readyz, false for a dead port', async () => {
    const server = await startP4FixtureServer({ port: 0, scenario: 'empty-inbox' });
    try {
      expect(await defaultReadyProbe(`${server.origin}/readyz`)).toBe(true);
    } finally {
      await server.close();
    }
    // After close, the port no longer answers.
    expect(await defaultReadyProbe(`${server.origin}/readyz`)).toBe(false);
  });
});

describe('runP4FixtureLifecycle — four teardown paths', () => {
  it('success: ready, client exits 0, fixture torn down', async () => {
    const children: FakeChild[] = [];
    let call = 0;
    // The fixture child (first spawn) stays running so finally must kill it; the client exits 0.
    const spawn = () => { const child = new FakeChild(0, call++ !== 0); children.push(child); return child; };
    const exit = await runP4FixtureLifecycle(options, deps({ spawn }));
    expect(exit).toBe(P4_LIFECYCLE_EXIT.ok);
    expect(children[0].signals.length).toBeGreaterThan(0);
  });

  it('client failure: nonzero client exit propagates and fixture is torn down', async () => {
    const children: FakeChild[] = [];
    let call = 0;
    const spawn = () => {
      const isFixture = call++ === 0;
      const child = new FakeChild(isFixture ? 0 : 1, !isFixture);
      children.push(child);
      return child;
    };
    const exit = await runP4FixtureLifecycle(options, deps({ spawn }));
    expect(exit).toBe(1);
    expect(children[0].signals.length).toBeGreaterThan(0);
  });

  it('ready-timeout: the client is never started and the fixture is torn down', async () => {
    const children: FakeChild[] = [];
    let time = 0;
    const spawn = () => { const child = new FakeChild(0, false); children.push(child); return child; };
    const exit = await runP4FixtureLifecycle(options, deps({
      spawn, readyProbe: async () => false, now: () => (time += 200), sleep: async () => undefined,
    }));
    expect(exit).toBe(P4_LIFECYCLE_EXIT.readyTimeout);
    // Only the fixture child was spawned; the client never started.
    expect(children).toHaveLength(1);
    expect(children[0].signals.length).toBeGreaterThan(0);
  });

  it('signal: a SIGINT handler closes the fixture', async () => {
    let registered: (() => void) | null = null;
    const children: FakeChild[] = [];
    let call = 0;
    const spawn = () => { const child = new FakeChild(0, call++ !== 0); children.push(child); return child; };
    await runP4FixtureLifecycle(options, deps({
      spawn, onSignal: (handler) => { registered = handler; return () => undefined; },
    }));
    expect(registered).not.toBeNull();
    (registered as unknown as () => void)();
    expect(children[0].signals).toContain('SIGTERM');
  });
});

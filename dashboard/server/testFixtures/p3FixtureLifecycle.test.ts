/**
 * The four teardown paths the §7/§8 commands depend on, proven against a FAKE child — no real process,
 * no real port, no real clock. What matters is that the fixture is always reaped and that only the
 * fixture's own pid is ever killed.
 */
import { describe, expect, it } from 'vitest';
import {
  parseP3FixtureLifecycleArgs,
  runP3FixtureLifecycle,
  type LifecycleChild,
} from './p3FixtureLifecycle.ts';

interface FakeChild extends LifecycleChild {
  signals: NodeJS.Signals[];
  settle(code: number): void;
  fail(error: Error): void;
}

function fakeChild(pid: number, options: { ignoresSigterm?: boolean } = {}): FakeChild {
  const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  const errorListeners: Array<(error: Error) => void> = [];
  const signals: NodeJS.Signals[] = [];
  let dead = false;
  const settle = (code: number): void => {
    if (dead) return;
    dead = true;
    for (const listener of [...exitListeners]) listener(code, null);
  };
  return {
    pid,
    signals,
    settle,
    fail(error) {
      if (dead) return;
      dead = true;
      for (const listener of [...errorListeners]) listener(error);
    },
    kill(signal) {
      signals.push(signal ?? 'SIGTERM');
      // A child that ignores SIGTERM is exactly the case the shutdown deadline exists for.
      if (signal === 'SIGKILL' || !options.ignoresSigterm) settle(0);
      return true;
    },
    once(event: 'exit' | 'error', listener: never) {
      if (event === 'exit') exitListeners.push(listener as never);
      else errorListeners.push(listener as never);
      return undefined;
    },
  } as FakeChild;
}

/**
 * A harness that hands out queued children in spawn order and advances a virtual clock on sleep.
 * `autoExit[i]` settles child `i` right AFTER it is spawned — settling it earlier would be a lie, since
 * the lifecycle can only observe an exit it has already subscribed to.
 */
function harness(children: FakeChild[], probeResults: boolean[],
  extras: { autoExit?: Array<number | null>; onProbe?: (call: number) => void } = {}) {
  const spawned: Array<{ command: string; args: readonly string[] }> = [];
  let clock = 0;
  let probeCalls = 0;
  const logs: string[] = [];
  let index = 0;
  return {
    spawned,
    logs,
    probeCalls: () => probeCalls,
    options: {
      origin: 'https://127.0.0.1:4321',
      readyTimeoutMs: 1_000,
      shutdownTimeoutMs: 500,
      readyIntervalMs: 100,
      now: () => clock,
      // Yield a real macrotask so a queued child exit is observed, then advance the VIRTUAL clock: the
      // deadline arithmetic stays deterministic while ordering still matches a real event loop.
      sleep: async (ms: number) => {
        await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        clock += ms;
      },
      log: (line: string) => logs.push(line),
      onInterrupt: () => () => {},
      probe: async () => {
        const result = probeResults[probeCalls] ?? false;
        extras.onProbe?.(probeCalls);
        probeCalls += 1;
        return result;
      },
      spawn: (command: string, args: readonly string[]) => {
        spawned.push({ command, args });
        const child = children[index];
        const code = extras.autoExit?.[index] ?? null;
        index += 1;
        if (!child) throw new Error('harness: unexpected spawn');
        if (code !== null) setTimeout(() => child.settle(code), 0);
        return child;
      },
    },
  };
}

describe('p3FixtureLifecycle — bounded fixture + client', () => {
  it('waits for /readyz, runs the client, and reaps the fixture with its exit code', async () => {
    const fixture = fakeChild(101);
    const client = fakeChild(102);
    const h = harness([fixture, client], [false, true], { autoExit: [null, 0] });

    const outcome = await runP3FixtureLifecycle({
      fixtureCommand: ['node', 'fixture.ts', '--port', '4321'],
      clientCommand: ['node', 'client.ts', '--origin', 'https://127.0.0.1:4321'],
      ...h.options,
    });

    expect(outcome).toEqual({ ok: true, exitCode: 0, forcedKill: false });
    // The client starts ONLY after readiness, and the fixture is always reaped.
    expect(h.spawned.map((call) => call.args[0])).toEqual(['fixture.ts', 'client.ts']);
    expect(h.probeCalls()).toBe(2);
    expect(fixture.signals).toEqual(['SIGTERM']);
  });

  it('a NON-ZERO client exit becomes the command exit code and still reaps the fixture', async () => {
    const fixture = fakeChild(201);
    const client = fakeChild(202);
    const h = harness([fixture, client], [true], { autoExit: [null, 7] });

    const outcome = await runP3FixtureLifecycle({
      fixtureCommand: ['node', 'fixture.ts'],
      clientCommand: ['node', 'client.ts'],
      ...h.options,
    });

    expect(outcome).toEqual({ ok: true, exitCode: 7, forcedKill: false });
    expect(fixture.signals).toEqual(['SIGTERM']);
  });

  it('a fixture that never answers /readyz times out WITHOUT starting the client', async () => {
    const fixture = fakeChild(301);
    const client = fakeChild(302);
    const h = harness([fixture, client], []);

    const outcome = await runP3FixtureLifecycle({
      fixtureCommand: ['node', 'fixture.ts'],
      clientCommand: ['node', 'client.ts'],
      ...h.options,
    });

    expect(outcome).toMatchObject({ ok: false, reason: 'ready-timeout', exitCode: 1 });
    expect(h.spawned).toHaveLength(1);
    expect(client.signals).toEqual([]);
    expect(fixture.signals).toEqual(['SIGTERM']);
    expect(h.logs.join(' ')).toContain('did not answer /readyz');
  });

  it('a fixture that DIES while starting fails fast instead of burning the ready budget', async () => {
    const fixture = fakeChild(401);
    const client = fakeChild(402);
    const h = harness([fixture, client], [false, false, false], { autoExit: [1] });

    const outcome = await runP3FixtureLifecycle({
      fixtureCommand: ['node', 'fixture.ts'],
      clientCommand: ['node', 'client.ts'],
      ...h.options,
    });

    expect(outcome).toMatchObject({ ok: false, reason: 'fixture-failed', exitCode: 1 });
    expect(h.spawned).toHaveLength(1);
    // Already dead: no signal is sent to a child that exited on its own.
    expect(fixture.signals).toEqual([]);
  });

  it('Ctrl-C stops the run and still reaps the fixture', async () => {
    const fixture = fakeChild(501);
    const client = fakeChild(502);
    let fire: (() => void) | null = null;
    // Ctrl-C lands while the wrapper is still polling readiness — the window where an unbounded
    // implementation would leave the fixture running and never start (or stop) anything.
    const h = harness([fixture, client], [false, true], { onProbe: () => fire?.() });

    const outcome = await runP3FixtureLifecycle({
      fixtureCommand: ['node', 'fixture.ts'],
      clientCommand: ['node', 'client.ts'],
      ...h.options,
      onInterrupt: (handler) => { fire = handler; return () => { fire = null; }; },
    });

    expect(h.spawned).toHaveLength(1);

    expect(outcome).toMatchObject({ ok: false, reason: 'interrupted', exitCode: 130 });
    expect(fixture.signals).toEqual(['SIGTERM']);
  });

  it('force-kills ONLY the fixture pid when it ignores SIGTERM past the shutdown deadline', async () => {
    const fixture = fakeChild(601, { ignoresSigterm: true });
    const client = fakeChild(602);
    const h = harness([fixture, client], [true], { autoExit: [null, 0] });

    const outcome = await runP3FixtureLifecycle({
      fixtureCommand: ['node', 'fixture.ts'],
      clientCommand: ['node', 'client.ts'],
      ...h.options,
    });

    expect(outcome.exitCode).toBe(0);
    expect(fixture.signals).toEqual(['SIGTERM', 'SIGKILL']);
    // The client's pid is never signalled: the wrapper kills one child, never a group or a name.
    expect(client.signals).toEqual([]);
    expect(h.logs.join(' ')).toContain('force-killing pid 601');
  });
});

describe('p3FixtureLifecycle — argument parsing', () => {
  it('splits the §8 browser command at `--` and derives the HTTPS origin from the port', () => {
    const parsed = parseP3FixtureLifecycleArgs([
      '--fixture', 'p1',
      '--scenario', 'p3-terminal-named-sessions',
      '--https', '--port', '4322',
      '--ready-timeout-ms', '10000',
      '--shutdown-timeout-ms', '5000',
      '--', 'node', 'server/testFixtures/p3ActualBrowserRunner.ts', '--themes', 'dark,light',
    ]);

    expect(parsed.origin).toBe('https://127.0.0.1:4322');
    expect(parsed.readyTimeoutMs).toBe(10_000);
    expect(parsed.shutdownTimeoutMs).toBe(5_000);
    expect(parsed.fixtureCommand.slice(1)).toEqual([
      '--experimental-transform-types', '--disable-warning=ExperimentalWarning',
      'server/testFixtures/p1BrowserFixture.ts', '--port', '4322', '--scenario', 'p3-terminal-named-sessions', '--https',
    ]);
    expect(parsed.clientCommand[1]).toBe('server/testFixtures/p3ActualBrowserRunner.ts');
    // The client argv passes through untouched — the wrapper never reinterprets a client flag.
    expect(parsed.clientCommand.slice(-2)).toEqual(['--themes', 'dark,light']);
  });

  it('routes the §7 authenticated smoke to its own fixture module', () => {
    const parsed = parseP3FixtureLifecycleArgs([
      '--fixture', 'p3-authenticated', '--real-windows-host', '--https', '--port', '4317',
      '--ready-timeout-ms', '10000', '--shutdown-timeout-ms', '5000',
      '--', 'node', 'server/testFixtures/p3RealPtySmokeClient.ts',
    ]);

    expect(parsed.fixtureCommand[3]).toBe('server/testFixtures/p3AuthenticatedServer.ts');
    expect(parsed.fixtureCommand).toContain('--real-windows-host');
    expect(parsed.origin).toBe('https://127.0.0.1:4317');
  });

  it.each([
    [['--fixture', 'p1', '--port', '4321', '--ready-timeout-ms', '1', '--shutdown-timeout-ms', '1'], 'missing `--`'],
    [['--fixture', 'p1', '--port', '4321', '--ready-timeout-ms', '1', '--shutdown-timeout-ms', '1', '--'], 'client command is empty'],
    [['--fixture', 'nope', '--port', '4321', '--ready-timeout-ms', '1', '--shutdown-timeout-ms', '1', '--', 'node'], '--fixture must be'],
    [['--fixture', 'p1', '--port', '0', '--ready-timeout-ms', '1', '--shutdown-timeout-ms', '1', '--', 'node'], '--port must be'],
    [['--fixture', 'p1', '--port', '4321', '--ready-timeout-ms', '0', '--shutdown-timeout-ms', '1', '--', 'node'], '--ready-timeout-ms must be'],
    [['--fixture', 'p1', '--port', '4321', '--ready-timeout-ms', '1', '--shutdown-timeout-ms', '-1', '--', 'node'], '--shutdown-timeout-ms must be'],
    [['--fixture', 'p1', '--wat', '--port', '4321', '--ready-timeout-ms', '1', '--shutdown-timeout-ms', '1', '--', 'node'], 'unknown flag'],
  ])('refuses a malformed command line (%#)', (argv, message) => {
    expect(() => parseP3FixtureLifecycleArgs(argv as string[])).toThrow(message);
  });
});

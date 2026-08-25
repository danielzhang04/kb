import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  P5_INBOX_SCENARIOS, P5_LIFECYCLE_EXIT, isP5InboxScenario, parseP5FixtureLifecycleArgs,
  runP5FixtureLifecycle,
} from './p5FixtureLifecycle.ts';
import type { LifecycleChild, P5FixtureLifecycleDeps } from './p5FixtureLifecycle.ts';
import { defaultReadyProbe } from './p4FixtureLifecycle.ts';
import { startP1BrowserFixture, type P1BrowserFixture } from './p1BrowserFixture.ts';

/** A fake child with no real process: exit is driven by the test. Mirrors the P4 fake. */
class FakeChild implements LifecycleChild {
  readonly pid = 4321;
  readonly signals: string[] = [];
  private exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  private readonly exitCode: number | null;
  private readonly autoExit: boolean;
  constructor(exitCode: number | null, autoExit = true) {
    this.exitCode = exitCode;
    this.autoExit = autoExit;
  }
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
    return this;
  }
}

function deps(overrides: Partial<P5FixtureLifecycleDeps>): P5FixtureLifecycleDeps {
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
  fixtureArgv: ['server/testFixtures/p1BrowserFixture.ts', '--port', '4521'],
  clientArgv: ['node', 'client.ts'],
  readyUrl: 'http://127.0.0.1:4521/readyz',
  readyTimeoutMs: 1000,
  shutdownTimeoutMs: 500,
  pollIntervalMs: 10,
};

describe('parseP5FixtureLifecycleArgs', () => {
  it('splits own flags from the client argv after `--` and spawns the shell fixture', () => {
    const parsed = parseP5FixtureLifecycleArgs([
      '--scenario', 'inbox-populated', '--port', '4523',
      '--', 'node', 'server/testFixtures/p5ActualBrowserRunner.ts', '--matrix', 'all',
    ]);
    expect(parsed.clientArgv).toEqual(['node', 'server/testFixtures/p5ActualBrowserRunner.ts', '--matrix', 'all']);
    expect(parsed.readyUrl).toBe('http://127.0.0.1:4523/readyz');
    expect(parsed.fixtureArgv[0]).toBe(process.execPath);
    expect(parsed.fixtureArgv[1]).toBe('server/testFixtures/p1BrowserFixture.ts');
    expect(parsed.fixtureArgv).toContain('inbox-populated');
  });
  it('requires a client command after `--`', () => {
    expect(() => parseP5FixtureLifecycleArgs(['--scenario', 'inbox-populated'])).toThrow(/client command/);
  });
  it('rejects an unknown scenario against the closed P5 set', () => {
    expect(() => parseP5FixtureLifecycleArgs(['--scenario', 'not-a-scenario', '--', 'node', 'c.ts']))
      .toThrow(/--scenario must be one of/);
    expect(isP5InboxScenario('inbox-populated')).toBe(true);
    expect(isP5InboxScenario('nope')).toBe(false);
    expect(P5_INBOX_SCENARIOS).toContain('inbox-populated');
  });
  it('passes --https through to the fixture and the ready URL', () => {
    const parsed = parseP5FixtureLifecycleArgs(['--https', '--port', '4525', '--', 'node', 'c.ts']);
    expect(parsed.fixtureArgv).toContain('--https');
    expect(parsed.readyUrl).toBe('https://127.0.0.1:4525/readyz');
  });
});

describe('defaultReadyProbe — real HTTP readiness against the P5 shell fixture', () => {
  const fixtures: P1BrowserFixture[] = [];
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('returns true once a live P5 Inbox fixture answers /readyz, false for a dead port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-p5-life-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
    const fixture = await startP1BrowserFixture({ scenario: 'inbox-populated', distDir: root, port: 0 });
    fixtures.push(fixture);
    expect(await defaultReadyProbe(`${fixture.origin}/readyz`)).toBe(true);
    await fixture.close();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    expect(await defaultReadyProbe(`${fixture.origin}/readyz`)).toBe(false);
  });
});

describe('runP5FixtureLifecycle — four teardown paths', () => {
  it('success: ready, client exits 0, fixture torn down', async () => {
    const children: FakeChild[] = [];
    let call = 0;
    const spawn = () => { const child = new FakeChild(0, call++ !== 0); children.push(child); return child; };
    const exit = await runP5FixtureLifecycle(options, deps({ spawn }));
    expect(exit).toBe(P5_LIFECYCLE_EXIT.ok);
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
    const exit = await runP5FixtureLifecycle(options, deps({ spawn }));
    expect(exit).toBe(1);
    expect(children[0].signals.length).toBeGreaterThan(0);
  });

  it('ready-timeout: the client is never started and the fixture is torn down', async () => {
    const children: FakeChild[] = [];
    let time = 0;
    const spawn = () => { const child = new FakeChild(0, false); children.push(child); return child; };
    const exit = await runP5FixtureLifecycle(options, deps({
      spawn, readyProbe: async () => false, now: () => (time += 200), sleep: async () => undefined,
    }));
    expect(exit).toBe(P5_LIFECYCLE_EXIT.readyTimeout);
    expect(children).toHaveLength(1);
    expect(children[0].signals.length).toBeGreaterThan(0);
  });

  it('signal: a SIGINT handler closes the fixture', async () => {
    let registered: (() => void) | null = null;
    const children: FakeChild[] = [];
    let call = 0;
    const spawn = () => { const child = new FakeChild(0, call++ !== 0); children.push(child); return child; };
    await runP5FixtureLifecycle(options, deps({
      spawn, onSignal: (handler) => { registered = handler; return () => undefined; },
    }));
    expect(registered).not.toBeNull();
    (registered as unknown as () => void)();
    expect(children[0].signals).toContain('SIGTERM');
  });
});

import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  P5_ATTACK_IDS, P5_BROWSER_SCENARIOS, P5_LIFECYCLE_EXIT, assertArtifactDirIsolated, isP5AttackId,
  isP5FixtureKind, isP5Scenario, parseP5AttackCliArgs, parseP5FixtureLifecycleArgs, runP5Attack,
  runP5FixtureLifecycle,
} from './p5FixtureLifecycle.ts';
import type { LifecycleChild, P5FixtureLifecycleDeps } from './p5FixtureLifecycle.ts';
import { defaultReadyProbe } from './p4FixtureLifecycle.ts';
import { startP5FixtureServer, type P5FixtureServer } from './p5FixtureServer.ts';
import {
  assertP5GateResults, P5_ATTACK_IDS as ASSERTER_ATTACK_IDS,
} from './assertP5GateResults.ts';

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
  it('splits own flags from the client argv after `--` and spawns the p5 fixture server', () => {
    const parsed = parseP5FixtureLifecycleArgs([
      '--fixture', 'bounded', '--scenario', 'deployment-action-matrix', '--port', '4523',
      '--', 'node', 'server/testFixtures/p5ActualBrowserRunner.ts', '--matrix', 'all',
    ]);
    expect(parsed.clientArgv).toEqual(['node', 'server/testFixtures/p5ActualBrowserRunner.ts', '--matrix', 'all']);
    expect(parsed.readyUrl).toBe('http://127.0.0.1:4523/readyz');
    expect(parsed.fixtureArgv[0]).toBe(process.execPath);
    expect(parsed.fixtureArgv[1]).toBe('server/testFixtures/p5FixtureServer.ts');
    expect(parsed.fixtureArgv).toContain('deployment-action-matrix');
    expect(parsed.fixtureArgv).toContain('--fixture');
    expect(parsed.fixtureArgv).toContain('bounded');
  });
  it('requires a client command after `--`', () => {
    expect(() => parseP5FixtureLifecycleArgs(['--scenario', 'no-deploy-destination'])).toThrow(/client command/);
  });
  it('rejects an unknown scenario and an unknown fixture kind against the closed P5 sets', () => {
    expect(() => parseP5FixtureLifecycleArgs(['--scenario', 'not-a-scenario', '--', 'node', 'c.ts']))
      .toThrow(/--scenario must be one of/);
    expect(() => parseP5FixtureLifecycleArgs(['--fixture', 'nope', '--', 'node', 'c.ts']))
      .toThrow(/--fixture must be bounded or real/);
    expect(isP5Scenario('home-health-live-release')).toBe(true);
    expect(isP5Scenario('nope')).toBe(false);
    expect(isP5FixtureKind('real')).toBe(true);
    expect(P5_BROWSER_SCENARIOS).toContain('no-deploy-destination');
    expect(P5_BROWSER_SCENARIOS).toHaveLength(7);
  });
  it('passes --https and --fixture real through to the fixture server and the ready URL', () => {
    const parsed = parseP5FixtureLifecycleArgs(['--fixture', 'real', '--scenario', 't3-missing-ceremony', '--https', '--port', '4525', '--', 'node', 'c.ts']);
    expect(parsed.fixtureArgv).toContain('--https');
    expect(parsed.fixtureArgv).toContain('real');
    expect(parsed.readyUrl).toBe('https://127.0.0.1:4525/readyz');
  });
});

describe('p5FixtureServer — the boot-route fix and per-scenario surfaces', () => {
  const fixtures: P5FixtureServer[] = [];
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function startServer(scenario: Parameters<typeof startP5FixtureServer>[0]['scenario']): Promise<P5FixtureServer> {
    const root = await mkdtemp(join(tmpdir(), 'kb-p5-srv-'));
    roots.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="root" class="app-shell"></div></body></html>');
    const fixture = await startP5FixtureServer({ scenario, fixtureKind: 'bounded', distDir: root, port: 0 });
    fixtures.push(fixture);
    return fixture;
  }

  it('serves BOTH boot routes /api/home AND /api/attention (the W6.5 404 fix) and /readyz for every scenario', async () => {
    for (const scenario of P5_BROWSER_SCENARIOS) {
      const fixture = await startServer(scenario);
      const home = await fetch(`${fixture.origin}/api/home`);
      const attention = await fetch(`${fixture.origin}/api/attention`);
      const ready = await fetch(`${fixture.origin}/readyz`);
      expect(home.status, `${scenario} /api/home`).toBe(200);
      expect(attention.status, `${scenario} /api/attention`).toBe(200);
      expect(ready.status).toBe(200);
      // The two boot routes that used to 404 now both answer, so a cell can reach 0 console errors.
      await Promise.all([home.body?.cancel(), attention.body?.cancel(), ready.body?.cancel()]);
    }
  });

  it('defaultReadyProbe returns true for a live server and false once closed', async () => {
    const fixture = await startServer('deployment-action-matrix');
    expect(await defaultReadyProbe(`${fixture.origin}/readyz`)).toBe(true);
    await fixture.close();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    expect(await defaultReadyProbe(`${fixture.origin}/readyz`)).toBe(false);
  });

  it('no-deploy-destination: GET /api/deploy and /api/deploys both return 404 on the wire', async () => {
    const fixture = await startServer('no-deploy-destination');
    const deploy = await fetch(`${fixture.origin}/api/deploy`);
    const deploys = await fetch(`${fixture.origin}/api/deploys`);
    expect(deploy.status).toBe(404);
    expect(deploys.status).toBe(404);
    await Promise.all([deploy.body?.cancel(), deploys.body?.cancel()]);
  });

  it('home-health-live-release: Home chip SHA equals Health release-row SHA (one injected activation)', async () => {
    // W6.5b: the OLD version of this test read a top-level `home.release`/`health.release` key that
    // neither `D13Home.tsx` (Home's "Version" section, `sections[3].data`) nor `Health.tsx` (the
    // `daemon-machine` release ROW) ever reads — it was asserting a field the browser never renders,
    // so it stayed green while the chip and the release row silently disagreed. This reads the SAME
    // fields the client actually renders.
    const fixture = await startServer('home-health-live-release');
    const home = await (await fetch(`${fixture.origin}/api/home`)).json() as {
      generatedAt?: string;
      sections?: { data?: { section?: string; sha?: string; activatedAt?: string } }[];
    };
    const health = await (await fetch(`${fixture.origin}/api/health`)).json() as {
      sections: { id: string; rows: { key: string; value: unknown }[] }[];
    };
    const versionSection = home.sections?.[3]?.data;
    expect(versionSection?.section).toBe('version');
    const releaseRow = health.sections.find((s) => s.id === 'daemon-machine')?.rows.find((r) => r.key === 'release');
    const releaseValue = releaseRow?.value as { sha?: string; activatedAt?: string } | undefined;
    expect(versionSection?.sha).toBeDefined();
    expect(versionSection?.sha).toBe(releaseValue?.sha);
    expect(versionSection?.sha).toBe('a'.repeat(40));
    expect(versionSection?.activatedAt).toBe(releaseValue?.activatedAt);
    expect(home.generatedAt).toBe('2026-08-25T12:00:00.000Z');
  });

  it('home-health-live-release digest: every OTHER scenario keeps the default fixture sha untouched (no cross-scenario leakage)', async () => {
    const fixture = await startServer('deployment-action-matrix');
    const home = await (await fetch(`${fixture.origin}/api/home`)).json() as { sections?: { data?: { sha?: string } }[] };
    expect(home.sections?.[3]?.data?.sha).toBe('64fb3d02');
  });

  it('health-bounded-probe-failure: exactly one health row is unavailable, every other daemon-machine row is intact', async () => {
    const fixture = await startServer('health-bounded-probe-failure');
    const health = await (await fetch(`${fixture.origin}/api/health`)).json() as {
      sections: { id: string; rows: { kind: string; key: string }[] }[];
    };
    const unavailable = health.sections.flatMap((s) => s.rows).filter((row) => row.kind === 'unavailable');
    expect(unavailable).toHaveLength(1);
    const daemonMachine = health.sections.find((s) => s.id === 'mcp');
    expect(daemonMachine?.rows).toEqual([expect.objectContaining({ kind: 'unavailable' })]);
    const fleet = health.sections.find((s) => s.id === 'fleet');
    expect(fleet?.rows.every((row) => row.kind !== 'unavailable')).toBe(true);
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

// =================================================================================================
// §9 adversarial attack harness — each attack drives a REAL production module and refuses.
// =================================================================================================

describe('the twelve §9 adversarial attacks', () => {
  it('the harness attack-id list equals the frozen asserter list and the manifest', () => {
    expect([...P5_ATTACK_IDS]).toEqual([...ASSERTER_ATTACK_IDS]);
    const manifest = JSON.parse(readFileSync(resolve('server/testFixtures/p5AttackManifest.json'), 'utf8')) as {
      attacks: { id: string }[];
    };
    expect(manifest.attacks.map((a) => a.id)).toEqual([...P5_ATTACK_IDS]);
    expect(isP5AttackId('forged-node')).toBe(true);
    expect(isP5AttackId('not-an-attack')).toBe(false);
  });

  for (const id of P5_ATTACK_IDS) {
    it(`refuses: ${id}`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `p5-attack-${id}-`));
      const result = await runP5Attack(id, dir);
      expect(result.id).toBe(id);
      expect(result.passed).toBe(true);
      expect(result.assertion.trim().length).toBeGreaterThan(0);
      // The assertion must name a REAL production module — a forged assertion detached from a driven
      // module is refused.
      expect(result.drivenModules.length).toBeGreaterThan(0);
      expect(result.assertion).toMatch(/REAL /);
      expect(existsSync(result.artifactPath)).toBe(true);
      const written = JSON.parse(readFileSync(result.artifactPath, 'utf8'));
      expect(written.id).toBe(id);
      expect(written.passed).toBe(true);
    });
  }
});

describe('attack isolation + artifact placement', () => {
  it('mirrors the per-case artifact FLAT into the parent attack root (the frozen asserter reads it there)', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'p5-attackroot-'));
    const perCase = join(parent, 'rollback');
    const result = await runP5Attack('rollback', perCase);
    expect(existsSync(join(perCase, 'rollback.json'))).toBe(true);
    // basename(perCase) === id, so the artifact is ALSO written flat into the parent.
    expect(existsSync(join(parent, 'rollback.json'))).toBe(true);
    expect(result.artifactPath).toBe(join(perCase, 'rollback.json'));
  });

  it('assertArtifactDirIsolated refuses an artifact dir outside the gitignored .artifacts/ tree', () => {
    const outside = mkdtempSync(join(tmpdir(), 'p5-not-artifacts-'));
    expect(() => assertArtifactDirIsolated(outside, resolve('..'))).toThrow(/\.artifacts/);
    expect(() => assertArtifactDirIsolated(resolve('.artifacts/p5-attacks/rollback'), resolve('..'))).not.toThrow();
  });

  it('parseP5AttackCliArgs requires --attack and --artifact-dir and validates the case', () => {
    const parsed = parseP5AttackCliArgs(['--attack', 'cooldown', '--artifact-dir', '.artifacts/p5-attacks/cooldown', '--assert-isolated']);
    expect(parsed.attack).toBe('cooldown');
    expect(parsed.assertIsolated).toBe(true);
    expect(() => parseP5AttackCliArgs(['--attack', 'nope', '--artifact-dir', 'd'])).toThrow(/unknown attack/);
    expect(() => parseP5AttackCliArgs(['--attack', 'cooldown'])).toThrow(/--artifact-dir/);
    expect(() => parseP5AttackCliArgs(['--artifact-dir', 'd'])).toThrow(/--attack/);
  });
});

describe('the twelve attacks produce artifacts the frozen assertP5GateResults accepts', () => {
  it('all twelve pass and the gate asserter accepts the flat attack root', { timeout: 120000 }, async () => {
    const attackRoot = mkdtempSync(join(tmpdir(), 'p5-attacks-gate-'));
    for (const id of P5_ATTACK_IDS) {
      const result = await runP5Attack(id, attackRoot);
      expect(result.passed).toBe(true);
    }
    expect(readdirSync(attackRoot).filter((f) => f.endsWith('.json'))).toHaveLength(12);

    // A synthetic zero-skip gate-results doc covering exactly the manifest gate files, with the twelve
    // `refuses:` titles owned by p5FixtureLifecycle.test.ts, is accepted alongside the real artifacts.
    const manifest = JSON.parse(readFileSync(resolve('server/testFixtures/p5AttackManifest.json'), 'utf8')) as {
      gateFiles: string[]; attacks: { id: string; suite: string; title: string }[];
    };
    const dashboardRoot = process.cwd();
    const testResults = manifest.gateFiles.map((file) => {
      const assertionResults = [{ title: 'runs', fullName: `${file} > runs`, status: 'passed' }];
      if (file === 'server/testFixtures/p5FixtureLifecycle.test.ts') {
        for (const attack of manifest.attacks) {
          assertionResults.push({ title: attack.title, fullName: `x > ${attack.title}`, status: 'passed' });
        }
      }
      return { name: join(dashboardRoot, file), status: 'passed', assertionResults };
    });
    const results = { numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numTotalTests: testResults.length, testResults };
    const resultsPath = join(mkdtempSync(join(tmpdir(), "p5-gate-")), "gate-results.json");
    writeFileSync(resultsPath, JSON.stringify(results));

    const lines: string[] = [];
    const exit = assertP5GateResults(
      { resultsPath, requireZeroSkips: true, attackRoot, requireExact: true },
      { dashboardRoot, log: (line) => lines.push(line) },
    );
    expect(lines.join('\n')).toContain('P5 gate clean');
    expect(exit).toBe(0);
  });

  it('the gate asserter refuses a tampered (passed:false) artifact', { timeout: 120000 }, async () => {
    const attackRoot = mkdtempSync(join(tmpdir(), 'p5-attacks-bad-'));
    for (const id of P5_ATTACK_IDS) await runP5Attack(id, attackRoot);
    const victim = join(attackRoot, `${P5_ATTACK_IDS[0]}.json`);
    const parsed = JSON.parse(readFileSync(victim, 'utf8'));
    parsed.passed = false;
    writeFileSync(victim, JSON.stringify(parsed));

    const manifest = JSON.parse(readFileSync(resolve('server/testFixtures/p5AttackManifest.json'), 'utf8')) as {
      gateFiles: string[]; attacks: { id: string; suite: string; title: string }[];
    };
    const dashboardRoot = process.cwd();
    const testResults = manifest.gateFiles.map((file) => {
      const assertionResults = [{ title: 'runs', fullName: `${file} > runs`, status: 'passed' }];
      if (file === 'server/testFixtures/p5FixtureLifecycle.test.ts') {
        for (const attack of manifest.attacks) assertionResults.push({ title: attack.title, fullName: `x > ${attack.title}`, status: 'passed' });
      }
      return { name: join(dashboardRoot, file), status: 'passed', assertionResults };
    });
    const resultsPath = join(mkdtempSync(join(tmpdir(), "p5-gate-")), "gate-results.json");
    writeFileSync(resultsPath, JSON.stringify({ numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numTotalTests: testResults.length, testResults }));

    const lines: string[] = [];
    const exit = assertP5GateResults({ resultsPath, requireZeroSkips: true, attackRoot, requireExact: true }, { dashboardRoot, log: (line) => lines.push(line) });
    expect(exit).toBe(1);
    expect(lines.join('\n')).toContain('passed is not true');
  });
});

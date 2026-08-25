/**
 * The gate asserter guards the boundary between "green line" and "proved", so it gets its own suite
 * inside the gate it guards. Every refusal below is a way a P5 gate could otherwise pass while a proof
 * silently did not run, or an attack artifact silently went missing.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  P5_ATTACK_IDS, P5_GATE_EXIT, P5GateUsageError,
  assertP5GateResults, collectArtifactViolations, collectManifestViolations, collectResultsViolations,
  parseAssertP5GateArgs, toDashboardRelative,
  type P5AttackArtifact, type P5AttackManifest, type VitestJsonResults,
} from './assertP5GateResults.ts';

const ROOT = '/repo/dashboard';
const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'p5AttackManifest.json');
const shippedManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as P5AttackManifest;

// A tiny stand-in manifest with two gate files and two attacks.
const manifest: P5AttackManifest = {
  note: 'test',
  gateFiles: ['server/deploy/contracts.test.ts', 'server/testFixtures/p5FixtureLifecycle.test.ts'],
  attacks: [
    { id: 'forged-node', suite: 'server/testFixtures/p5FixtureLifecycle.test.ts', title: 'refuses: forged-node', summary: 's' },
    { id: 'cooldown', suite: 'server/testFixtures/p5FixtureLifecycle.test.ts', title: 'refuses: cooldown', summary: 's' },
  ],
};

const cleanResults = (): VitestJsonResults => ({
  numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numTotalTests: 3,
  testResults: [
    {
      name: `${ROOT}/server/deploy/contracts.test.ts`,
      assertionResults: [{ fullName: 'contracts x', title: 'x', status: 'passed' }],
    },
    {
      name: `${ROOT}/server/testFixtures/p5FixtureLifecycle.test.ts`,
      assertionResults: [
        { fullName: 'refuses: forged-node', title: 'refuses: forged-node', status: 'passed' },
        { fullName: 'refuses: cooldown', title: 'refuses: cooldown', status: 'passed' },
      ],
    },
  ],
});

const cleanArtifacts = (): Map<string, P5AttackArtifact> => new Map([
  ['forged-node', { id: 'forged-node', passed: true, assertion: 'refused before signer', artifactPath: 'a/forged-node.json' }],
  ['cooldown', { id: 'cooldown', passed: true, assertion: 'refused in cooldown', artifactPath: 'a/cooldown.json' }],
]);

const resultsViolations = (results: VitestJsonResults): string[] =>
  collectResultsViolations(results, manifest, { dashboardRoot: ROOT });

describe('parseAssertP5GateArgs — exactly one CLI, all four flags required [P5-C44]', () => {
  it('parses the section-9 invocation', () => {
    expect(parseAssertP5GateArgs([
      '--results', '.artifacts/p5-gate-results.json', '--require-zero-skips',
      '--attack-root', '.artifacts/p5-attacks', '--require-exact',
    ])).toEqual({
      resultsPath: '.artifacts/p5-gate-results.json', requireZeroSkips: true,
      attackRoot: '.artifacts/p5-attacks', requireExact: true,
    });
  });

  it('refuses when ANY of the four flags is missing, and an unknown flag', () => {
    const argvs = [
      [],
      ['--require-zero-skips', '--attack-root', 'a', '--require-exact'],
      ['--results', 'r', '--attack-root', 'a', '--require-exact'],
      ['--results', 'r', '--require-zero-skips', '--require-exact'],
      ['--results', 'r', '--require-zero-skips', '--attack-root', 'a'],
      ['--results', 'r', '--require-zero-skips', '--attack-root', 'a', '--require-exact', '--nope'],
      ['--results', '--require-zero-skips', '--attack-root', 'a', '--require-exact'],
    ];
    for (const argv of argvs) expect(() => parseAssertP5GateArgs(argv)).toThrow(P5GateUsageError);
  });

  it('there is no --manifest flag — the manifest path is an internal constant', () => {
    expect(() => parseAssertP5GateArgs([
      '--results', 'r', '--require-zero-skips', '--attack-root', 'a', '--require-exact', '--manifest', 'm',
    ])).toThrow(/unknown flag: --manifest/);
  });
});

describe('the shipped manifest is well-formed [P5-C24]', () => {
  it('freezes the twelve attack ids in order', () => {
    expect(collectManifestViolations(shippedManifest)).toEqual([]);
    expect(shippedManifest.attacks.map((a) => a.id)).toEqual([...P5_ATTACK_IDS]);
    expect(P5_ATTACK_IDS).toHaveLength(12);
  });

  it('freezes a non-trivial focused test-file set that excludes deploymentState.test.ts', () => {
    expect(shippedManifest.gateFiles.length).toBeGreaterThan(40);
    expect(shippedManifest.gateFiles).not.toContain('server/control/deploymentState.test.ts');
    expect(shippedManifest.gateFiles).toContain('server/testFixtures/assertP5GateResults.test.ts');
    expect(shippedManifest.gateFiles).toContain('server/pty/sessionRecord.test.ts');
    expect(new Set(shippedManifest.gateFiles).size).toBe(shippedManifest.gateFiles.length);
  });

  it('every attack maps to a gate file in the set', () => {
    for (const attack of shippedManifest.attacks) expect(shippedManifest.gateFiles).toContain(attack.suite);
  });
});

describe('toDashboardRelative', () => {
  it('normalises the reporter absolute path to a POSIX manifest path', () => {
    expect(toDashboardRelative(ROOT, `${ROOT}/server/deploy/contracts.test.ts`)).toBe('server/deploy/contracts.test.ts');
    expect(toDashboardRelative(ROOT, 'server/deploy/contracts.test.ts')).toBe('server/deploy/contracts.test.ts');
  });
});

describe('collectResultsViolations', () => {
  it('accepts a clean run', () => expect(resultsViolations(cleanResults())).toEqual([]));

  it('names a failed test', () => {
    const results = cleanResults();
    results.testResults![0]!.assertionResults![0]!.status = 'failed';
    results.numFailedTests = 1;
    expect(resultsViolations(results)).toEqual(expect.arrayContaining([
      'failed test: server/deploy/contracts.test.ts > contracts x', 'numFailedTests = 1',
    ]));
  });

  it.each(['skipped', 'pending', 'todo'])('names a %s test — zero-skips is always required', (status) => {
    const results = cleanResults();
    results.testResults![0]!.assertionResults![0]!.status = status;
    expect(resultsViolations(results)).toEqual(expect.arrayContaining([
      `${status} test: server/deploy/contracts.test.ts > contracts x`,
    ]));
  });

  it('names a missing gate file and the attack it orphans', () => {
    const results = cleanResults();
    results.testResults!.pop();
    expect(resultsViolations(results)).toEqual(expect.arrayContaining([
      'manifest gate file missing from results: server/testFixtures/p5FixtureLifecycle.test.ts',
      "attack 'forged-node': owning suite absent from results: server/testFixtures/p5FixtureLifecycle.test.ts",
    ]));
  });

  it('names an EXTRA file the run reported but the manifest gate does not list', () => {
    const results = cleanResults();
    results.testResults!.push({
      name: `${ROOT}/server/control/deploymentState.test.ts`,
      assertionResults: [{ fullName: 'y', title: 'y', status: 'passed' }],
    });
    expect(resultsViolations(results)).toEqual(expect.arrayContaining([
      'results ran a file not in the manifest gate: server/control/deploymentState.test.ts',
    ]));
  });

  it('names an attack whose owning test did not run, even though the suite passed', () => {
    const results = cleanResults();
    results.testResults![1]!.assertionResults = [{ fullName: 'refuses: cooldown', title: 'refuses: cooldown', status: 'passed' }];
    expect(resultsViolations(results)).toEqual(expect.arrayContaining([
      "attack 'forged-node': no test titled 'refuses: forged-node' ran in server/testFixtures/p5FixtureLifecycle.test.ts",
    ]));
  });

  it('names a zero-test suite and a file the reporter marked failed while its tests passed', () => {
    const results = cleanResults();
    results.testResults![0]!.assertionResults = [];
    results.testResults![0]!.message = 'Error: transform failed\nat ...';
    expect(resultsViolations(results)).toEqual(expect.arrayContaining([
      'zero-test suite: server/deploy/contracts.test.ts (Error: transform failed)',
    ]));
  });

  it('refuses aggregate pending/todo counts the per-test list did not show', () => {
    const results = cleanResults();
    results.numPendingTests = 2;
    results.numTodoTests = 1;
    expect(resultsViolations(results)).toEqual(expect.arrayContaining(['numPendingTests = 2', 'numTodoTests = 1']));
  });
});

describe('collectArtifactViolations — --require-exact forbids stray or missing [P5-C44]', () => {
  it('accepts the exact twelve-analog set', () => {
    expect(collectArtifactViolations(manifest, cleanArtifacts())).toEqual([]);
  });

  it('names a missing attack artifact', () => {
    const artifacts = cleanArtifacts();
    artifacts.delete('cooldown');
    expect(collectArtifactViolations(manifest, artifacts)).toEqual(expect.arrayContaining([
      "attack 'cooldown': no artifact found in the attack root",
      'found 1 artifacts, --require-exact expects 2',
    ]));
  });

  it('names a stray artifact with no manifest entry', () => {
    const artifacts = cleanArtifacts();
    artifacts.set('surprise', { id: 'surprise', passed: true, assertion: 'x', artifactPath: 'p' });
    expect(collectArtifactViolations(manifest, artifacts)).toEqual(expect.arrayContaining([
      "artifact 'surprise' has no manifest entry", 'found 3 artifacts, --require-exact expects 2',
    ]));
  });

  it('names a passed:false artifact and an empty assertion', () => {
    const artifacts = cleanArtifacts();
    artifacts.set('forged-node', { id: 'forged-node', passed: false, assertion: '   ', artifactPath: 'p' });
    expect(collectArtifactViolations(manifest, artifacts)).toEqual(expect.arrayContaining([
      "attack 'forged-node': passed is not true (false)", "attack 'forged-node': empty assertion",
    ]));
  });
});

describe('assertP5GateResults — one invocation validates BOTH sides', () => {
  // The full integration uses the SHIPPED manifest (all 43 gate files, all twelve attacks), so
  // collectManifestViolations' drift check passes only against the frozen list.
  const fullCleanResults = (): VitestJsonResults => {
    const testResults = shippedManifest.gateFiles.map((f) => (
      f === 'server/testFixtures/p5FixtureLifecycle.test.ts'
        ? {
            name: `${ROOT}/${f}`,
            assertionResults: shippedManifest.attacks.map((a) => ({ fullName: a.title, title: a.title, status: 'passed' })),
          }
        : { name: `${ROOT}/${f}`, assertionResults: [{ fullName: `${f} ok`, title: 'ok', status: 'passed' }] }
    ));
    return { numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numTotalTests: testResults.length, testResults };
  };
  const fullArtifacts = (): Map<string, P5AttackArtifact> => new Map(
    shippedManifest.attacks.map((a) => [a.id, { id: a.id, passed: true, assertion: 'refused', artifactPath: `a/${a.id}.json` }]),
  );

  const run = (results: VitestJsonResults, artifacts: Map<string, P5AttackArtifact>): { code: number; lines: string[] } => {
    const lines: string[] = [];
    const artifactFiles = [...artifacts.keys()].map((id) => `${id}.json`);
    const code = assertP5GateResults(
      { resultsPath: 'results.json', requireZeroSkips: true, attackRoot: 'attacks', requireExact: true },
      {
        readFile: (path) => {
          if (path.endsWith('results.json')) return JSON.stringify(results);
          if (path === MANIFEST_PATH || path.endsWith('p5AttackManifest.json')) return JSON.stringify(shippedManifest);
          const id = path.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
          return JSON.stringify(artifacts.get(id));
        },
        readDir: () => artifactFiles,
        manifestPath: MANIFEST_PATH,
        dashboardRoot: ROOT,
        log: (line) => lines.push(line),
      },
    );
    return { code, lines };
  };

  it('exits 0 and reports the counts it verified', () => {
    const { code, lines } = run(fullCleanResults(), fullArtifacts());
    expect(code).toBe(P5_GATE_EXIT.ok);
    expect(lines.join('\n')).toContain('P5 gate clean:');
    expect(lines.join('\n')).toContain('12 attacks owned and 12 artifacts present');
  });

  it('exits 1 when the gate JSON is dirty OR an artifact is missing', () => {
    const dirty = fullCleanResults();
    dirty.testResults![0]!.assertionResults![0]!.status = 'todo';
    const shortArtifacts = fullArtifacts();
    shortArtifacts.delete('cooldown');
    const { code, lines } = run(dirty, shortArtifacts);
    expect(code).toBe(P5_GATE_EXIT.violations);
    expect(lines.at(-1)).toMatch(/^P5 gate REFUSED: \d+ violation\(s\)$/);
    expect(lines.join('\n')).toContain('todo test');
    expect(lines.join('\n')).toContain("attack 'cooldown': no artifact found");
  });
});

describe('assertP5GateResults CLI', () => {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), 'assertP5GateResults.ts');
  const workspace = mkdtempSync(join(tmpdir(), 'p5-gate-cli-'));
  afterAll(() => { rmSync(workspace, { recursive: true, force: true }); });

  const runCli = (args: readonly string[]): { status: number; output: string } => {
    try {
      const stdout = execFileSync(process.execPath, [cliPath, ...args], {
        cwd: workspace, timeout: 60_000, encoding: 'utf8', stdio: 'pipe',
      });
      return { status: 0, output: stdout };
    } catch (error: unknown) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  };

  it('exits 2 on a usage error (a missing required flag)', () => {
    const misuse = runCli(['--results', 'r.json', '--require-zero-skips']);
    expect(misuse.status).toBe(P5_GATE_EXIT.usage);
    expect(misuse.output).toContain('is required');
  });

  it('exits 1 against the SHIPPED manifest when results/artifacts are empty', () => {
    // Wiring proof: the real manifest loads and every one of its gate files is reported missing.
    const resultsPath = join(workspace, 'results.json');
    const attackRoot = join(workspace, 'attacks');
    mkdirSync(attackRoot, { recursive: true });
    writeFileSync(resultsPath, JSON.stringify({ testResults: [], numTotalTests: 0 }), 'utf8');
    const refused = runCli([
      '--results', resultsPath, '--require-zero-skips', '--attack-root', attackRoot, '--require-exact',
    ]);
    expect(refused.status).toBe(P5_GATE_EXIT.violations);
    expect(refused.output).toContain('P5 gate REFUSED');
    expect(refused.output).toContain('manifest gate file missing from results');
  }, 90_000);
});

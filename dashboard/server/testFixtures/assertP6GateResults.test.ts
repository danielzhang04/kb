import { describe, expect, it } from 'vitest';
import {
  P6_ATTACK_IDS, P6_GATE_EXIT, P6GateUsageError,
  assertP6GateResults, parseAssertP6GateArgs,
  type P6AttackManifest, type VitestJsonResults,
} from './assertP6GateResults.ts';

// A minimal manifest with the frozen ids but a SMALL gate-file set, so the results fixture can be
// hand-built. The asserter's logic is identical to the real run — only the fixture is small.
const SUITE = 'server/testFixtures/p6TwoDaemonFixture.test.ts';
function manifest(overrides: Partial<P6AttackManifest> = {}): P6AttackManifest {
  return {
    note: 'test manifest',
    gateFiles: [SUITE, 'server/index.test.ts'],
    attacks: P6_ATTACK_IDS.map((id) => ({ id, suite: SUITE, title: `refuses: ${id}`, summary: 's' })),
    ...overrides,
  };
}

/** A clean vitest JSON: every gate file present, every attack owned by a passing 'refuses: <id>' test. */
function cleanResults(overrides: Partial<VitestJsonResults> = {}): VitestJsonResults {
  const attackAssertions = P6_ATTACK_IDS.map((id) => ({ title: `refuses: ${id}`, status: 'passed' }));
  return {
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numTotalTests: attackAssertions.length + 1,
    testResults: [
      { name: `/dash/${SUITE}`, status: 'passed', assertionResults: attackAssertions },
      { name: '/dash/server/index.test.ts', status: 'passed', assertionResults: [{ title: 'boots', status: 'passed' }] },
    ],
    ...overrides,
  };
}

const DASH = '/dash';
function run(args: Parameters<typeof assertP6GateResults>[0], _m: P6AttackManifest, files: Record<string, string>) {
  const logs: string[] = [];
  const code = assertP6GateResults(args, {
    dashboardRoot: DASH,
    readFile: (path) => {
      const key = Object.keys(files).find((k) => path.replace(/\\/g, '/').endsWith(k));
      if (key === undefined) throw new Error(`no fixture for ${path}`);
      return files[key]!;
    },
    readDir: () => Object.keys(files).filter((k) => k.startsWith('attacks/')).map((k) => k.slice('attacks/'.length)),
    log: (line) => logs.push(line),
  });
  return { code, logs };
}

describe('parseAssertP6GateArgs', () => {
  it('requires --manifest', () => {
    expect(() => parseAssertP6GateArgs(['--results', 'x', '--require-zero-skips'])).toThrow(P6GateUsageError);
  });
  it('results mode requires --require-zero-skips', () => {
    expect(() => parseAssertP6GateArgs(['--manifest', 'm', '--results', 'r'])).toThrow(/require-zero-skips/);
  });
  it('attack mode requires an integer --require-exact', () => {
    expect(() => parseAssertP6GateArgs(['--manifest', 'm', '--attack-root', 'a'])).toThrow(/require-exact/);
    expect(() => parseAssertP6GateArgs(['--manifest', 'm', '--attack-root', 'a', '--require-exact', 'xx'])).toThrow(/integer/);
  });
  it('requires at least one mode', () => {
    expect(() => parseAssertP6GateArgs(['--manifest', 'm'])).toThrow(/either --results/);
  });
  it('parses a valid results-mode line', () => {
    expect(parseAssertP6GateArgs(['--results', 'r', '--manifest', 'm', '--require-zero-skips'])).toMatchObject({
      resultsPath: 'r', manifestPath: 'm', requireZeroSkips: true,
    });
  });
  it('parses a valid attack-mode line', () => {
    expect(parseAssertP6GateArgs(['--attack-root', 'a', '--manifest', 'm', '--require-exact', '21'])).toMatchObject({
      attackRoot: 'a', manifestPath: 'm', requireExact: 21,
    });
  });
});

describe('assertP6GateResults results mode', () => {
  const base = { manifestPath: 'server/testFixtures/p6AttackManifest.json', resultsPath: 'r.json', requireZeroSkips: true } as const;

  it('exits 0 on a clean results document', () => {
    const { code } = run(base, manifest(), {
      'server/testFixtures/p6AttackManifest.json': JSON.stringify(manifest()),
      'r.json': JSON.stringify(cleanResults()),
    });
    expect(code).toBe(P6_GATE_EXIT.ok);
  });

  it('exits nonzero when a gate file is missing from the results (missing test file)', () => {
    const results = cleanResults({ testResults: [cleanResults().testResults![0]!] }); // drop index.test.ts
    const { code, logs } = run(base, manifest(), {
      'server/testFixtures/p6AttackManifest.json': JSON.stringify(manifest()),
      'r.json': JSON.stringify(results),
    });
    expect(code).toBe(P6_GATE_EXIT.violations);
    expect(logs.join('\n')).toContain('gate file missing');
  });

  it('exits nonzero when the results ran an extra file not in the manifest', () => {
    const results = cleanResults();
    results.testResults!.push({ name: '/dash/server/extra.test.ts', status: 'passed', assertionResults: [{ title: 't', status: 'passed' }] });
    const { code, logs } = run(base, manifest(), {
      'server/testFixtures/p6AttackManifest.json': JSON.stringify(manifest()),
      'r.json': JSON.stringify(results),
    });
    expect(code).toBe(P6_GATE_EXIT.violations);
    expect(logs.join('\n')).toContain('not in the manifest gate');
  });

  it('exits nonzero on a failed suite', () => {
    const results = cleanResults({ numFailedTests: 1 });
    results.testResults![1]!.assertionResults = [{ title: 'boots', status: 'failed' }];
    const { code, logs } = run(base, manifest(), {
      'server/testFixtures/p6AttackManifest.json': JSON.stringify(manifest()),
      'r.json': JSON.stringify(results),
    });
    expect(code).toBe(P6_GATE_EXIT.violations);
    expect(logs.join('\n')).toContain('failed test');
  });

  it('exits nonzero on a skipped or todo case', () => {
    const results = cleanResults({ numPendingTests: 1 });
    results.testResults![1]!.assertionResults = [{ title: 'boots', status: 'skipped' }];
    const { code, logs } = run(base, manifest(), {
      'server/testFixtures/p6AttackManifest.json': JSON.stringify(manifest()),
      'r.json': JSON.stringify(results),
    });
    expect(code).toBe(P6_GATE_EXIT.violations);
    expect(logs.join('\n')).toContain('skipped test');
  });

  it('exits nonzero on a missing attack mapping', () => {
    // The owning test title is absent from the suite.
    const results = cleanResults();
    results.testResults![0]!.assertionResults = results.testResults![0]!.assertionResults!.slice(1);
    const { code, logs } = run(base, manifest(), {
      'server/testFixtures/p6AttackManifest.json': JSON.stringify(manifest()),
      'r.json': JSON.stringify(results),
    });
    expect(code).toBe(P6_GATE_EXIT.violations);
    expect(logs.join('\n')).toContain('no test titled');
  });

  it('exits nonzero when the manifest attack ids drift', () => {
    const drifted = manifest({ attacks: manifest().attacks.slice(0, 20) });
    const { code, logs } = run(base, drifted, {
      'server/testFixtures/p6AttackManifest.json': JSON.stringify(drifted),
      'r.json': JSON.stringify(cleanResults()),
    });
    expect(code).toBe(P6_GATE_EXIT.violations);
    expect(logs.join('\n')).toContain('drift');
  });
});

describe('assertP6GateResults attack mode', () => {
  const base = { manifestPath: 'server/testFixtures/p6AttackManifest.json', attackRoot: 'attacks', requireExact: 21, requireZeroSkips: true } as const;
  function artifactFiles(count: number): Record<string, string> {
    const files: Record<string, string> = { 'server/testFixtures/p6AttackManifest.json': JSON.stringify(manifest()) };
    for (const id of P6_ATTACK_IDS.slice(0, count)) {
      files[`attacks/${id}.json`] = JSON.stringify({ id, passed: true, assertion: `refused ${id}`, artifactPath: `.artifacts/p6-attacks/${id}` });
    }
    return files;
  }

  it('exits 0 when all twenty-one artifacts are present and passed', () => {
    const { code } = run(base, manifest(), artifactFiles(21));
    expect(code).toBe(P6_GATE_EXIT.ok);
  });

  it('exits nonzero when --require-exact disagrees with the manifest count', () => {
    const { code, logs } = run({ ...base, requireExact: 20 }, manifest(), artifactFiles(21));
    expect(code).toBe(P6_GATE_EXIT.violations);
    expect(logs.join('\n')).toContain('disagrees with the manifest');
  });

  it('exits nonzero on a missing artifact', () => {
    const { code, logs } = run(base, manifest(), artifactFiles(20));
    expect(code).toBe(P6_GATE_EXIT.violations);
    expect(logs.join('\n')).toMatch(/no artifact found|--require-exact expects/);
  });

  it('exits nonzero when an artifact did not pass', () => {
    const files = artifactFiles(21);
    files['attacks/missing-auth.json'] = JSON.stringify({ id: 'missing-auth', passed: false, assertion: 'x', artifactPath: 'p' });
    const { code, logs } = run(base, manifest(), files);
    expect(code).toBe(P6_GATE_EXIT.violations);
    expect(logs.join('\n')).toContain('passed is not true');
  });
});

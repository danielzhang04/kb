/**
 * The gate asserter is the thing standing between "green line" and "proved"; it gets its own suite
 * inside the gate it guards. Every refusal below is a way a P3 gate could otherwise pass while a
 * proof silently did not run.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATE_RESULT_EXIT,
  GateResultUsageError,
  assertP3GateResults,
  collectGateViolations,
  parseAssertP3GateResultsArgs,
  toDashboardRelative,
  type GateManifest,
  type VitestJsonResults,
} from './assertP3GateResults.ts';

const ROOT = '/repo/dashboard';

const manifest: GateManifest = {
  gateFiles: ['server/pty/route.test.ts', 'server/pty/sessionRecord.test.ts'],
  attacks: [
    { id: 'high-water', suite: 'server/pty/route.test.ts', title: 'high-water: detaches' },
    { id: 'same-pair multi-tab', suite: 'server/pty/sessionRecord.test.ts', title: 'same-pair multi-tab' },
  ],
};

const clean = (): VitestJsonResults => ({
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numTotalTests: 2,
  testResults: [
    {
      name: `${ROOT}/server/pty/route.test.ts`,
      assertionResults: [{ fullName: 'registerPtyRoute high-water: detaches', title: 'high-water: detaches', status: 'passed' }],
    },
    {
      name: `${ROOT}/server/pty/sessionRecord.test.ts`,
      assertionResults: [{ fullName: 'same-pair multi-tab', title: 'same-pair multi-tab', status: 'passed' }],
    },
  ],
});

const violations = (results: VitestJsonResults, useManifest = true): string[] =>
  collectGateViolations(results, useManifest ? manifest : null, { requireZeroSkipped: true, dashboardRoot: ROOT });

describe('parseAssertP3GateResultsArgs', () => {
  it('parses the exact plan section 7 invocation', () => {
    expect(parseAssertP3GateResultsArgs([
      '.p3-vitest-results.json', '--require-zero-skipped', '--manifest', 'shared/ptyAdversarialManifest.json',
    ])).toEqual({
      resultsPath: '.p3-vitest-results.json',
      requireZeroSkipped: true,
      manifestPath: 'shared/ptyAdversarialManifest.json',
    });
  });

  it('refuses a missing results path, an unknown flag, a second path, and a valueless --manifest', () => {
    for (const argv of [[], ['--require-zero-skipped'], ['a.json', '--nope'], ['a.json', 'b.json'], ['a.json', '--manifest']]) {
      expect(() => parseAssertP3GateResultsArgs(argv)).toThrow(GateResultUsageError);
    }
  });

  it('leaves the zero-skipped and manifest checks OFF unless asked', () => {
    expect(parseAssertP3GateResultsArgs(['a.json'])).toEqual({
      resultsPath: 'a.json', requireZeroSkipped: false, manifestPath: null,
    });
  });
});

describe('toDashboardRelative', () => {
  it('normalises the reporter absolute path to a POSIX manifest path', () => {
    expect(toDashboardRelative(ROOT, `${ROOT}/server/pty/route.test.ts`)).toBe('server/pty/route.test.ts');
    expect(toDashboardRelative(ROOT, 'server/pty/route.test.ts')).toBe('server/pty/route.test.ts');
  });
});

describe('collectGateViolations', () => {
  it('accepts a run where every gate file, attack, and total is clean', () => {
    expect(violations(clean())).toEqual([]);
  });

  it('names a failed test', () => {
    const results = clean();
    results.testResults![0].assertionResults![0].status = 'failed';
    results.numFailedTests = 1;
    expect(violations(results)).toEqual(expect.arrayContaining([
      'failed test: server/pty/route.test.ts > registerPtyRoute high-water: detaches',
      'numFailedTests = 1',
    ]));
  });

  it.each(['skipped', 'pending', 'todo'])('names a %s test under --require-zero-skipped', (status) => {
    const results = clean();
    results.testResults![1].assertionResults![0].status = status;
    expect(violations(results)).toEqual(expect.arrayContaining([
      `${status} test: server/pty/sessionRecord.test.ts > same-pair multi-tab`,
    ]));
  });

  it('tolerates a skipped test only when zero-skipped is not required', () => {
    const results = clean();
    results.testResults![1].assertionResults![0].status = 'skipped';
    expect(collectGateViolations(results, null, { requireZeroSkipped: false, dashboardRoot: ROOT })).toEqual([]);
  });

  it('names a zero-test suite even when nothing failed', () => {
    const results = clean();
    results.testResults![0].assertionResults = [];
    results.testResults![0].message = 'Error: transform failed\nat ...';
    expect(violations(results)).toEqual(expect.arrayContaining([
      'zero-test suite: server/pty/route.test.ts (Error: transform failed)',
    ]));
  });

  it('names a manifest gate file the run never reported', () => {
    const results = clean();
    results.testResults!.pop();
    expect(violations(results)).toEqual(expect.arrayContaining([
      'manifest gate file missing from results: server/pty/sessionRecord.test.ts',
      "attack 'same-pair multi-tab': owning suite absent from results: server/pty/sessionRecord.test.ts",
    ]));
  });

  it('names an attack whose owning test did not run, even though the suite passed', () => {
    const results = clean();
    results.testResults![0].assertionResults = [
      { fullName: 'registerPtyRoute something else entirely', title: 'something else entirely', status: 'passed' },
    ];
    expect(violations(results)).toEqual([
      "attack 'high-water': no test titled 'high-water: detaches' ran in server/pty/route.test.ts",
    ]);
  });

  it('names an attack whose owning test ran but did not pass', () => {
    const results = clean();
    results.testResults![0].assertionResults![0].status = 'skipped';
    expect(violations(results)).toEqual(expect.arrayContaining([
      "attack 'high-water': owning test is 'skipped' in server/pty/route.test.ts",
    ]));
  });

  it('refuses aggregate pending/todo counts the per-test list did not show', () => {
    const results = clean();
    results.numPendingTests = 3;
    results.numTodoTests = 1;
    expect(violations(results)).toEqual(['numPendingTests = 3', 'numTodoTests = 1']);
  });

  it('refuses an empty results document rather than reading it as a clean run', () => {
    expect(violations({ testResults: [] })).toEqual(expect.arrayContaining(['results contain no test files at all']));
  });

  it('refuses an unrecognised test state instead of ignoring it', () => {
    const results = clean();
    results.testResults![1].assertionResults![0].status = 'disabled';
    expect(violations(results)).toEqual(expect.arrayContaining([
      "test in state 'disabled': server/pty/sessionRecord.test.ts > same-pair multi-tab",
      "attack 'same-pair multi-tab': owning test is 'disabled' in server/pty/sessionRecord.test.ts",
    ]));
  });
});

describe('assertP3GateResults', () => {
  const run = (results: VitestJsonResults): { code: number; lines: string[] } => {
    const lines: string[] = [];
    const code = assertP3GateResults(
      { resultsPath: 'results.json', requireZeroSkipped: true, manifestPath: 'manifest.json' },
      {
        readFile: (path) => JSON.stringify(path === 'manifest.json' ? manifest : results),
        dashboardRoot: ROOT,
        log: (line) => lines.push(line),
      },
    );
    return { code, lines };
  };

  it('exits 0 and reports the counts it verified', () => {
    const { code, lines } = run(clean());
    expect(code).toBe(GATE_RESULT_EXIT.ok);
    expect(lines.join('\n')).toContain('P3 gate clean: 2 tests across 2 files, 0 failed, 0 skipped/pending/todo, 2 attacks owned');
  });

  it('exits 1 and prints every violation by name', () => {
    const results = clean();
    results.testResults![1].assertionResults![0].status = 'todo';
    const { code, lines } = run(results);
    expect(code).toBe(GATE_RESULT_EXIT.violations);
    expect(lines).toContain('P3 gate violation: todo test: server/pty/sessionRecord.test.ts > same-pair multi-tab');
    expect(lines.at(-1)).toMatch(/^P3 gate REFUSED: \d+ violation\(s\)$/);
  });

  it('checks the real repository manifest against a results document that omits it', () => {
    // Guards the wiring, not a fixture: the shipped manifest must be readable and its gateFiles must
    // be what the asserter enumerates.
    const lines: string[] = [];
    const code = assertP3GateResults(
      { resultsPath: 'results.json', requireZeroSkipped: true, manifestPath: 'shared/ptyAdversarialManifest.json' },
      {
        readFile: (path) => (path === 'results.json'
          ? JSON.stringify({ testResults: [], numTotalTests: 0 })
          : readFileSync(new URL('../../shared/ptyAdversarialManifest.json', import.meta.url), 'utf8')),
        dashboardRoot: ROOT,
        log: (line) => lines.push(line),
      },
    );
    expect(code).toBe(GATE_RESULT_EXIT.violations);
    expect(lines.filter((line) => line.includes('manifest gate file missing')).length).toBeGreaterThan(60);
  });
});
describe('collectGateViolations - file-level status and freshness', () => {
  it('refuses a suite the reporter marked failed while every one of its tests passed', () => {
    // The doctored document: an `afterAll` throw or an unhandled rejection is attributed to the FILE,
    // so `numFailedTests` stays 0 and every assertion reads `passed`.
    const results = clean();
    results.testResults![0].status = 'failed';
    results.testResults![0].message = 'Error: afterAll hook failed\n    at ...';
    expect(violations(results)).toContain(
      'suite file failed with all tests passing: server/pty/route.test.ts (Error: afterAll hook failed)',
    );
  });

  it('accepts the same document when the file status is passed', () => {
    const results = clean();
    results.testResults![0].status = 'passed';
    expect(violations(results)).toEqual([]);
  });

  it('refuses a results document that predates a gate file, and one that carries no startTime', () => {
    const stale = { ...clean(), startTime: 1_000 };
    expect(collectGateViolations(stale, manifest, {
      requireZeroSkipped: true, dashboardRoot: ROOT, newestGateFileMtimeMs: 2_000,
    })).toContain(`stale results: run started ${new Date(1_000).toISOString()} but a gate file `
      + `was modified ${new Date(2_000).toISOString()}`);

    expect(collectGateViolations(clean(), manifest, {
      requireZeroSkipped: true, dashboardRoot: ROOT, newestGateFileMtimeMs: 2_000,
    })).toContain('results document declares no numeric startTime, so it cannot be dated');

    // A run that started after the newest gate-file write is fresh, and passes.
    expect(collectGateViolations({ ...clean(), startTime: 3_000 }, manifest, {
      requireZeroSkipped: true, dashboardRoot: ROOT, newestGateFileMtimeMs: 2_000,
    })).toEqual([]);
  });

  it('does not accept an unrelated test whose title merely ENDS WITH the attack title', () => {
    const results = clean();
    results.testResults![1].assertionResults = [{
      fullName: 'sessionRecord rejects a same-pair multi-tab',
      title: 'rejects a same-pair multi-tab',
      status: 'passed',
    }];
    expect(violations(results)).toContain(
      "attack 'same-pair multi-tab': no test titled 'same-pair multi-tab' ran in server/pty/sessionRecord.test.ts",
    );
  });
});

describe('assertP3GateResults CLI', () => {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), 'assertP3GateResults.ts');
  const workspace = mkdtempSync(join(tmpdir(), 'p3-gate-cli-'));
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

  it('exits 0 on a clean document, 1 on a violation, and 2 on a usage error', () => {
    const relativeResults = (): VitestJsonResults => ({
      ...clean(),
      testResults: clean().testResults!.map((file) => ({
        ...file,
        name: file.name!.slice(`${ROOT}/`.length),
      })),
    });
    const manifestPath = join(workspace, 'manifest.json');
    const cleanPath = join(workspace, 'clean.json');
    const dirtyPath = join(workspace, 'dirty.json');
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    writeFileSync(cleanPath, JSON.stringify(relativeResults()), 'utf8');
    const dirty = relativeResults();
    dirty.testResults![0].assertionResults![0].status = 'failed';
    writeFileSync(dirtyPath, JSON.stringify(dirty), 'utf8');

    const ok = runCli([cleanPath, '--require-zero-skipped', '--manifest', manifestPath]);
    expect([ok.status, ok.output]).toEqual([GATE_RESULT_EXIT.ok, expect.stringContaining('P3 gate clean')]);

    const refused = runCli([dirtyPath, '--require-zero-skipped', '--manifest', manifestPath]);
    expect(refused.status).toBe(GATE_RESULT_EXIT.violations);
    expect(refused.output).toContain('P3 gate REFUSED');

    const misuse = runCli([cleanPath, '--not-a-flag']);
    expect([misuse.status, misuse.output]).toEqual([GATE_RESULT_EXIT.usage, expect.stringContaining('unknown flag')]);
  }, 90_000);
});

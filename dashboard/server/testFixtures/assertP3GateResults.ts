/**
 * P3 closure gate-result asserter (plan section 7 / section 9 [C-M9]).
 *
 *   node server/testFixtures/assertP3GateResults.ts .p3-vitest-results.json \
 *     --require-zero-skipped --manifest shared/ptyAdversarialManifest.json
 *
 * Reads the Vitest JSON reporter output the focused gate wrote and refuses anything that would let a
 * green line hide an unrun proof: a failed test, a skipped/pending/todo test, a suite that ran zero
 * tests, a manifest gate file missing from the results, and — with `--manifest` — an adversarial
 * attack whose owning test did not run and pass. Every violation names the offending file or test, so
 * the operator never has to re-derive which proof went missing.
 *
 * Exit codes: 0 clean, 1 violations (each printed), 2 usage error.
 */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  SKIPPED_STATUSES,
  toDashboardRelative,
  type VitestAssertionResult,
  type VitestFileResult,
  type VitestJsonResults as VitestJsonResultsBase,
} from './gateResultsCore.ts';

export { toDashboardRelative };
export type { VitestAssertionResult, VitestFileResult };

export const GATE_RESULT_EXIT = { ok: 0, violations: 1, usage: 2 } as const;
export type GateResultExitCode = (typeof GATE_RESULT_EXIT)[keyof typeof GATE_RESULT_EXIT];

export class GateResultUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateResultUsageError';
  }
}

export interface AssertP3GateResultsArgs {
  /** Path to the Vitest `--reporter=json --outputFile=...` document. */
  resultsPath: string;
  /** Refuse any skipped, pending, or todo test. The gate always passes this. */
  requireZeroSkipped: boolean;
  /** Path to `shared/ptyAdversarialManifest.json`, or null to check results only. */
  manifestPath: string | null;
}

export function parseAssertP3GateResultsArgs(argv: readonly string[]): AssertP3GateResultsArgs {
  let resultsPath: string | null = null;
  let requireZeroSkipped = false;
  let manifestPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--require-zero-skipped') { requireZeroSkipped = true; continue; }
    if (arg === '--manifest') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new GateResultUsageError('--manifest requires a path');
      }
      manifestPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new GateResultUsageError(`unknown flag: ${arg}`);
    if (resultsPath !== null) throw new GateResultUsageError(`unexpected second results path: ${arg}`);
    resultsPath = arg;
  }

  if (resultsPath === null) throw new GateResultUsageError('a Vitest JSON results path is required');
  return { resultsPath, requireZeroSkipped, manifestPath };
}

/** The subset of the Vitest JSON reporter document this asserter reads. P3 alone needs `startTime`, its
 *  freshness anchor, so it extends the shared base rather than using it as-is. */
export interface VitestJsonResults extends VitestJsonResultsBase {
  /** Epoch ms the run started. The gate's freshness anchor: a results document older than the code it
   *  claims to have proved is a stale green, and satisfies every other check verbatim. */
  startTime?: number;
}

export interface GateManifest { gateFiles: string[]; attacks: { id: string; suite: string; title: string }[] }

/**
 * Returns one human-readable line per violation. An empty array means the gate genuinely proved
 * everything it claims; the caller exits 0 only then.
 */
export function collectGateViolations(
  results: VitestJsonResults,
  manifest: GateManifest | null,
  options: {
    requireZeroSkipped: boolean;
    dashboardRoot: string;
    /** Newest mtime (epoch ms) among the manifest's gate files, or null when it cannot be determined. */
    newestGateFileMtimeMs?: number | null;
  },
): string[] {
  const violations: string[] = [];
  const files = results.testResults ?? [];
  if (files.length === 0) violations.push('results contain no test files at all');

  const byRelPath = new Map<string, VitestFileResult>();
  for (const file of files) {
    const relPath = toDashboardRelative(options.dashboardRoot, file.name ?? '');
    byRelPath.set(relPath, file);

    const assertions = file.assertionResults ?? [];
    if (assertions.length === 0) {
      violations.push(`zero-test suite: ${relPath}${file.message ? ` (${file.message.split('\n')[0]})` : ''}`);
    }
    // FILE-level status, read independently of the per-test statuses: a suite whose every test passed
    // while an `afterAll` threw (or an unhandled rejection was attributed to the file) reports
    // `status: 'failed'` with `numFailedTests: 0`, and was green here.
    if (file.status === 'failed' && assertions.every((assertion) => assertion.status === 'passed')) {
      violations.push(`suite file failed with all tests passing: ${relPath}`
        + `${file.message ? ` (${file.message.split('\n')[0]})` : ''}`);
    }
    for (const assertion of assertions) {
      const name = assertion.fullName ?? assertion.title ?? '<unnamed test>';
      const status = assertion.status ?? 'unknown';
      if (status === 'failed') violations.push(`failed test: ${relPath} > ${name}`);
      else if (SKIPPED_STATUSES.has(status) && options.requireZeroSkipped) {
        violations.push(`${status} test: ${relPath} > ${name}`);
      } else if (status !== 'passed' && status !== 'skipped' && status !== 'pending' && status !== 'todo') {
        violations.push(`test in state '${status}': ${relPath} > ${name}`);
      }
    }
  }

  // Totals are a second, independent witness: a reporter that under-reports per-test statuses still
  // cannot hide a nonzero aggregate.
  if ((results.numFailedTests ?? 0) > 0) violations.push(`numFailedTests = ${results.numFailedTests}`);
  if (options.requireZeroSkipped) {
    if ((results.numPendingTests ?? 0) > 0) violations.push(`numPendingTests = ${results.numPendingTests}`);
    if ((results.numTodoTests ?? 0) > 0) violations.push(`numTodoTests = ${results.numTodoTests}`);
  }

  // Freshness. A results document is only evidence about the tree that produced it: if any gate file
  // was modified after the run started, this JSON predates the code and its green means nothing.
  const newestMtime = options.newestGateFileMtimeMs ?? null;
  if (newestMtime !== null) {
    const startTime = results.startTime;
    if (typeof startTime !== 'number' || !Number.isFinite(startTime)) {
      violations.push('results document declares no numeric startTime, so it cannot be dated');
    } else if (startTime < newestMtime) {
      violations.push(`stale results: run started ${new Date(startTime).toISOString()} but a gate file `
        + `was modified ${new Date(newestMtime).toISOString()}`);
    }
  }

  if (manifest !== null) {
    for (const gateFile of manifest.gateFiles) {
      if (!byRelPath.has(gateFile)) violations.push(`manifest gate file missing from results: ${gateFile}`);
    }
    for (const attack of manifest.attacks) {
      const file = byRelPath.get(attack.suite);
      if (file === undefined) {
        violations.push(`attack '${attack.id}': owning suite absent from results: ${attack.suite}`);
        continue;
      }
      // Ownership is the test's OWN title, exactly. The reporter emits `title` alongside the
      // describe-joined `fullName`; matching a SUFFIX of `fullName` let an unrelated test whose title
      // merely ends with the attack title (`... and the traversal`) satisfy the attack. When `title` is
      // missing, `fullName` must equal the attack title outright — never end with it.
      const owning = (file.assertionResults ?? []).filter((assertion) => (
        assertion.title === undefined
          ? (assertion.fullName ?? '') === attack.title
          : assertion.title === attack.title
      ));
      if (owning.length === 0) {
        violations.push(`attack '${attack.id}': no test titled '${attack.title}' ran in ${attack.suite}`);
        continue;
      }
      for (const assertion of owning) {
        if (assertion.status !== 'passed') {
          violations.push(`attack '${attack.id}': owning test is '${assertion.status}' in ${attack.suite}`);
        }
      }
    }
  }

  return violations;
}

export interface AssertP3GateResultsDeps {
  readFile?: (path: string) => string;
  /** Modification time of a gate file in epoch ms, or null when it cannot be read. */
  fileMtimeMs?: (path: string) => number | null;
  dashboardRoot?: string;
  log?: (line: string) => void;
}

export function assertP3GateResults(
  args: AssertP3GateResultsArgs,
  deps: AssertP3GateResultsDeps = {},
): GateResultExitCode {
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const dashboardRoot = deps.dashboardRoot ?? process.cwd();
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const results = JSON.parse(readFile(args.resultsPath)) as VitestJsonResults;
  const manifest = args.manifestPath === null
    ? null
    : (JSON.parse(readFile(args.manifestPath)) as GateManifest);

  const fileMtimeMs = deps.fileMtimeMs ?? ((path: string) => {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return null;
    }
  });
  // Only the manifest's own gate files date the run — the set the results claim to cover.
  const mtimes = (manifest?.gateFiles ?? [])
    .map((gateFile) => fileMtimeMs(resolve(dashboardRoot, gateFile)))
    .filter((value): value is number => value !== null);
  const newestGateFileMtimeMs = mtimes.length === 0 ? null : Math.max(...mtimes);

  const violations = collectGateViolations(results, manifest, {
    requireZeroSkipped: args.requireZeroSkipped,
    dashboardRoot,
    newestGateFileMtimeMs,
  });

  if (violations.length > 0) {
    for (const violation of violations) log(`P3 gate violation: ${violation}`);
    log(`P3 gate REFUSED: ${violations.length} violation(s)`);
    return GATE_RESULT_EXIT.violations;
  }
  log(`P3 gate clean: ${results.numTotalTests ?? 0} tests across ${(results.testResults ?? []).length} files, `
    + `0 failed, 0 skipped/pending/todo${manifest === null ? '' : `, ${manifest.attacks.length} attacks owned`}`);
  return GATE_RESULT_EXIT.ok;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = assertP3GateResults(parseAssertP3GateResultsArgs(process.argv.slice(2)));
  } catch (error: unknown) {
    const usage = error instanceof GateResultUsageError;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = usage ? GATE_RESULT_EXIT.usage : GATE_RESULT_EXIT.violations;
  }
}

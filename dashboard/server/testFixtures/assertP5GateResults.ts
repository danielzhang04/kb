/**
 * P5 W6.4 gate-result asserter, frozen by W0 [P5-C24, P5-C44]. Unlike the P3/P4 asserters, which had two
 * mutually-exclusive modes, P5 has EXACTLY ONE CLI with all four flags REQUIRED, invoked ONCE at section 9
 * closure after the attack artifacts exist:
 *
 *     node server/testFixtures/assertP5GateResults.ts \
 *       --results .artifacts/p5-gate-results.json \
 *       --require-zero-skips \
 *       --attack-root .artifacts/p5-attacks \
 *       --require-exact
 *
 * The manifest path (`p5AttackManifest.json`) is an INTERNAL CONSTANT, never a flag. The single invocation
 * validates BOTH:
 *   - the Vitest JSON reporter document (--results): no failed test, no skipped/pending/todo test (always,
 *     since --require-zero-skips is mandatory), no zero-test suite, no suite file that failed with all tests
 *     passing, the manifest gate-file set EQUAL to the reported files, and every attack owned by a passing
 *     test titled 'refuses: <id>' in its suite; and
 *   - the per-attack artifact directory (--attack-root): each of the twelve ids present exactly once with
 *     passed:true, a nonempty assertion, and an artifact path, with --require-exact forbidding a stray or
 *     missing artifact (count === the manifest's twelve).
 *
 * Exit codes: 0 clean, 1 violations (each printed), 2 usage error.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const P5_GATE_EXIT = { ok: 0, violations: 1, usage: 2 } as const;
export type P5GateExitCode = (typeof P5_GATE_EXIT)[keyof typeof P5_GATE_EXIT];

/** The frozen twelve — design 619's nine checklist entries expanded [P5-C40]. The manifest must match. */
export const P5_ATTACK_IDS = [
  'forged-node', 'forged-source', 'forged-attestation', 'unknown-verb', 'unknown-field', 'repeat-key',
  'cooldown', 'stale-revision', 'active-pty', 'failed-swap', 'rollback', 'misleading-symlink',
] as const;

/** The manifest path is a constant relative to this tool, NOT a flag [P5-C44]. */
export const P5_MANIFEST_PATH = fileURLToPath(new URL('./p5AttackManifest.json', import.meta.url));

export class P5GateUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P5GateUsageError';
  }
}

export interface AssertP5GateArgs {
  readonly resultsPath: string;
  readonly requireZeroSkips: true;
  readonly attackRoot: string;
  readonly requireExact: true;
}

/** All four flags are REQUIRED. Any missing flag, unknown flag, or valueless value flag is a usage error. */
export function parseAssertP5GateArgs(argv: readonly string[]): AssertP5GateArgs {
  let resultsPath: string | undefined;
  let requireZeroSkips = false;
  let attackRoot: string | undefined;
  let requireExact = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P5GateUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--results': resultsPath = needValue(); break;
      case '--require-zero-skips': requireZeroSkips = true; break;
      case '--attack-root': attackRoot = needValue(); break;
      case '--require-exact': requireExact = true; break;
      default: throw new P5GateUsageError(`unknown flag: ${arg}`);
    }
  }
  if (resultsPath === undefined) throw new P5GateUsageError('--results <json> is required');
  if (!requireZeroSkips) throw new P5GateUsageError('--require-zero-skips is required');
  if (attackRoot === undefined) throw new P5GateUsageError('--attack-root <dir> is required');
  if (!requireExact) throw new P5GateUsageError('--require-exact is required');
  return { resultsPath, requireZeroSkips: true, attackRoot, requireExact: true };
}

export interface P5AttackManifestEntry { id: string; suite: string; title: string; summary: string }
export interface P5AttackManifest { note: string; gateFiles: string[]; attacks: P5AttackManifestEntry[] }

export interface VitestAssertionResult { fullName?: string; title?: string; status?: string }
export interface VitestFileResult { name?: string; status?: string; message?: string; assertionResults?: VitestAssertionResult[] }
export interface VitestJsonResults {
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  numTotalTests?: number;
  testResults?: VitestFileResult[];
}

/** Vitest reports absolute OS paths; the manifest speaks repo-relative POSIX ones. */
export function toDashboardRelative(dashboardRoot: string, name: string): string {
  const absolute = isAbsolute(name) ? name : resolve(dashboardRoot, name);
  return relative(dashboardRoot, absolute).split(sep).join('/');
}

const SKIPPED_STATUSES = new Set(['skipped', 'pending', 'todo']);

export function collectManifestViolations(manifest: P5AttackManifest): string[] {
  const violations: string[] = [];
  if (JSON.stringify(manifest.attacks.map((a) => a.id)) !== JSON.stringify([...P5_ATTACK_IDS])) {
    violations.push('manifest attack ids drift from the frozen section-9 list');
  }
  return violations;
}

export function collectResultsViolations(
  results: VitestJsonResults,
  manifest: P5AttackManifest,
  options: { dashboardRoot: string },
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
    if (file.status === 'failed' && assertions.every((a) => a.status === 'passed')) {
      violations.push(`suite file failed with all tests passing: ${relPath}`);
    }
    for (const assertion of assertions) {
      const name = assertion.fullName ?? assertion.title ?? '<unnamed test>';
      const status = assertion.status ?? 'unknown';
      if (status === 'failed') violations.push(`failed test: ${relPath} > ${name}`);
      else if (SKIPPED_STATUSES.has(status)) violations.push(`${status} test: ${relPath} > ${name}`);
      else if (status !== 'passed') violations.push(`test in state '${status}': ${relPath} > ${name}`);
    }
  }

  if ((results.numFailedTests ?? 0) > 0) violations.push(`numFailedTests = ${results.numFailedTests}`);
  if ((results.numPendingTests ?? 0) > 0) violations.push(`numPendingTests = ${results.numPendingTests}`);
  if ((results.numTodoTests ?? 0) > 0) violations.push(`numTodoTests = ${results.numTodoTests}`);

  // Gate-file set equality: a MISSING or EXTRA test file both fail.
  const gate = new Set(manifest.gateFiles);
  for (const gateFile of manifest.gateFiles) {
    if (!byRelPath.has(gateFile)) violations.push(`manifest gate file missing from results: ${gateFile}`);
  }
  for (const relPath of byRelPath.keys()) {
    if (!gate.has(relPath)) violations.push(`results ran a file not in the manifest gate: ${relPath}`);
  }

  // Attack ownership: each attack's suite ran a passing test with the exact title.
  for (const attack of manifest.attacks) {
    const file = byRelPath.get(attack.suite);
    if (file === undefined) {
      violations.push(`attack '${attack.id}': owning suite absent from results: ${attack.suite}`);
      continue;
    }
    const owning = (file.assertionResults ?? []).filter((a) => (
      a.title === undefined ? (a.fullName ?? '') === attack.title : a.title === attack.title
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

  return violations;
}

export interface P5AttackArtifact {
  id?: unknown;
  passed?: unknown;
  assertion?: unknown;
  artifactPath?: unknown;
}

export function collectArtifactViolations(
  manifest: P5AttackManifest,
  artifacts: Map<string, P5AttackArtifact>,
): string[] {
  const violations: string[] = [];
  const expected = manifest.attacks.length;

  for (const attack of manifest.attacks) {
    const artifact = artifacts.get(attack.id);
    if (artifact === undefined) {
      violations.push(`attack '${attack.id}': no artifact found in the attack root`);
      continue;
    }
    if (artifact.id !== attack.id) violations.push(`attack '${attack.id}': artifact id mismatch (${String(artifact.id)})`);
    if (artifact.passed !== true) violations.push(`attack '${attack.id}': passed is not true (${String(artifact.passed)})`);
    if (typeof artifact.assertion !== 'string' || artifact.assertion.trim().length === 0) {
      violations.push(`attack '${attack.id}': empty assertion`);
    }
    if (typeof artifact.artifactPath !== 'string' || artifact.artifactPath.length === 0) {
      violations.push(`attack '${attack.id}': missing artifact path`);
    }
  }

  for (const id of artifacts.keys()) {
    if (!manifest.attacks.some((a) => a.id === id)) violations.push(`artifact '${id}' has no manifest entry`);
  }
  // --require-exact: the count must equal the frozen twelve exactly.
  if (artifacts.size !== expected) {
    violations.push(`found ${artifacts.size} artifacts, --require-exact expects ${expected}`);
  }
  return violations;
}

export interface AssertP5GateDeps {
  readFile?: (path: string) => string;
  readDir?: (path: string) => string[];
  manifestPath?: string;
  dashboardRoot?: string;
  log?: (line: string) => void;
}

export function assertP5GateResults(args: AssertP5GateArgs, deps: AssertP5GateDeps = {}): P5GateExitCode {
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const readDir = deps.readDir ?? ((path: string) => readdirSync(path));
  const manifestPath = deps.manifestPath ?? P5_MANIFEST_PATH;
  const dashboardRoot = deps.dashboardRoot ?? process.cwd();
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const manifest = JSON.parse(readFile(manifestPath)) as P5AttackManifest;

  const results = JSON.parse(readFile(resolve(args.resultsPath))) as VitestJsonResults;
  const attackRoot = resolve(args.attackRoot);
  const artifacts = new Map<string, P5AttackArtifact>();
  for (const entry of readDir(attackRoot)) {
    if (!entry.endsWith('.json')) continue;
    const artifact = JSON.parse(readFile(join(attackRoot, entry))) as P5AttackArtifact;
    const id = typeof artifact.id === 'string' ? artifact.id : entry.replace(/\.json$/, '');
    artifacts.set(id, artifact);
  }

  const violations = [
    ...collectManifestViolations(manifest),
    ...collectResultsViolations(results, manifest, { dashboardRoot }),
    ...collectArtifactViolations(manifest, artifacts),
  ];

  if (violations.length > 0) {
    for (const violation of violations) log(`P5 gate violation: ${violation}`);
    log(`P5 gate REFUSED: ${violations.length} violation(s)`);
    return P5_GATE_EXIT.violations;
  }
  log(
    `P5 gate clean: ${results.numTotalTests ?? 0} tests across ${(results.testResults ?? []).length} files, `
    + `0 failed, 0 skipped/pending/todo, ${manifest.gateFiles.length} gate files, `
    + `${manifest.attacks.length} attacks owned and ${artifacts.size} artifacts present`,
  );
  return P5_GATE_EXIT.ok;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = assertP5GateResults(parseAssertP5GateArgs(process.argv.slice(2)));
  } catch (error: unknown) {
    const usage = error instanceof P5GateUsageError;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = usage ? P5_GATE_EXIT.usage : P5_GATE_EXIT.violations;
  }
}

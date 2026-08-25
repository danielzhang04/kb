/**
 * P6 W6.3 gate-result asserter [P6-C50, P6-C75]. The SOLE enforcer of `--require-zero-skips`, the
 * exact-file-set manifest, and `--require-exact 21`, so r5 gave it a suite of its own
 * (`assertP6GateResults.test.ts`) — without one, a misbehaving asserter would turn the whole zero-skip
 * guarantee into a no-op it also reported as green.
 *
 * Unlike P5's single combined invocation, P6 runs it TWICE, in two modes, and `--manifest` is a real
 * flag in both (the two gate blocks name different manifests only in principle; in practice both point at
 * `p6AttackManifest.json`):
 *
 *   §7 (results mode):
 *     node assertP6GateResults.ts --results .artifacts/p6-gate-results.json \
 *       --manifest server/testFixtures/p6AttackManifest.json --require-zero-skips
 *
 *   §9 (attack mode):
 *     node assertP6GateResults.ts --attack-root .artifacts/p6-attacks \
 *       --manifest server/testFixtures/p6AttackManifest.json --require-exact 21
 *
 * Results mode validates the Vitest JSON reporter document: no failed test, no skipped/pending/todo test
 * (always — `--require-zero-skips` is mandatory in that mode), no zero-test suite, no suite file that
 * failed with all tests passing, the manifest gate-file set EQUAL to the reported files, and every attack
 * owned by a passing test titled 'refuses: <id>' in its suite. Attack mode validates the per-attack
 * artifact directory: each of the twenty-one ids present exactly once with passed:true, a nonempty
 * assertion, and an artifact path, with `--require-exact N` asserting N equals the frozen count AND the
 * on-disk artifact count.
 *
 * Exit codes: 0 clean, 1 violations (each printed), 2 usage error.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const P6_GATE_EXIT = { ok: 0, violations: 1, usage: 2 } as const;
export type P6GateExitCode = (typeof P6_GATE_EXIT)[keyof typeof P6_GATE_EXIT];

/** The frozen twenty-one — design 529 + 635's clauses [P6-C50]. The manifest must match this order. */
export const P6_ATTACK_IDS = [
  'missing-auth', 'forged-proxy-header', 'forged-node-id', 'revoked-node-id', 'wrong-host-object',
  'operator-calls-daemon-route', 'host-attempts-human-response', 'wrong-kind-etag', 'stale-cursor',
  'changed-idempotency-replay', 'out-of-order-report', 'duplicate-completion', 'out-of-order-gate',
  'expired-lease', 'lease-theft', 'false-capability', 'stale-advertisement', 'split-brain',
  'oversized-unknown-input', 'node-flood', 'capability-loss',
] as const;

export class P6GateUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P6GateUsageError';
  }
}

export interface AssertP6GateArgs {
  readonly manifestPath: string;
  readonly resultsPath?: string;
  readonly requireZeroSkips: boolean;
  readonly attackRoot?: string;
  readonly requireExact?: number;
}

/** `--manifest` is required. At least one of results-mode (`--results` + `--require-zero-skips`) or
 *  attack-mode (`--attack-root` + `--require-exact N`) must be complete. */
export function parseAssertP6GateArgs(argv: readonly string[]): AssertP6GateArgs {
  let manifestPath: string | undefined;
  let resultsPath: string | undefined;
  let requireZeroSkips = false;
  let attackRoot: string | undefined;
  let requireExact: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P6GateUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--manifest': manifestPath = needValue(); break;
      case '--results': resultsPath = needValue(); break;
      case '--require-zero-skips': requireZeroSkips = true; break;
      case '--attack-root': attackRoot = needValue(); break;
      case '--require-exact': {
        const raw = needValue();
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isInteger(parsed) || String(parsed) !== raw) throw new P6GateUsageError('--require-exact needs an integer');
        requireExact = parsed;
        break;
      }
      default: throw new P6GateUsageError(`unknown flag: ${arg}`);
    }
  }
  if (manifestPath === undefined) throw new P6GateUsageError('--manifest <json> is required');
  const resultsMode = resultsPath !== undefined;
  const attackMode = attackRoot !== undefined;
  if (!resultsMode && !attackMode) {
    throw new P6GateUsageError('either --results (with --require-zero-skips) or --attack-root (with --require-exact N) is required');
  }
  if (resultsMode && !requireZeroSkips) throw new P6GateUsageError('--require-zero-skips is required in results mode');
  if (attackMode && requireExact === undefined) throw new P6GateUsageError('--require-exact <N> is required in attack mode');
  return { manifestPath, resultsPath, requireZeroSkips, attackRoot, requireExact };
}

export interface P6AttackManifestEntry { id: string; suite: string; title: string; summary: string }
export interface P6AttackManifest { note: string; gateFiles: string[]; attacks: P6AttackManifestEntry[] }

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

export function collectManifestViolations(manifest: P6AttackManifest): string[] {
  const violations: string[] = [];
  if (JSON.stringify(manifest.attacks.map((a) => a.id)) !== JSON.stringify([...P6_ATTACK_IDS])) {
    violations.push('manifest attack ids drift from the frozen twenty-one section-9 list');
  }
  return violations;
}

export function collectResultsViolations(
  results: VitestJsonResults,
  manifest: P6AttackManifest,
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
      a.title === undefined ? (a.fullName ?? '') === attack.title || (a.fullName ?? '').endsWith(` ${attack.title}`) : a.title === attack.title
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

export interface P6AttackArtifact {
  id?: unknown;
  passed?: unknown;
  assertion?: unknown;
  artifactPath?: unknown;
}

export function collectArtifactViolations(
  manifest: P6AttackManifest,
  artifacts: Map<string, P6AttackArtifact>,
  requireExact: number,
): string[] {
  const violations: string[] = [];
  const expected = manifest.attacks.length;
  if (requireExact !== expected) {
    violations.push(`--require-exact ${requireExact} disagrees with the manifest's ${expected} attack ids`);
  }

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
  // --require-exact: the on-disk count must equal the requested exact count.
  if (artifacts.size !== requireExact) {
    violations.push(`found ${artifacts.size} artifacts, --require-exact expects ${requireExact}`);
  }
  return violations;
}

export interface AssertP6GateDeps {
  readFile?: (path: string) => string;
  readDir?: (path: string) => string[];
  dashboardRoot?: string;
  log?: (line: string) => void;
}

export function assertP6GateResults(args: AssertP6GateArgs, deps: AssertP6GateDeps = {}): P6GateExitCode {
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const readDir = deps.readDir ?? ((path: string) => readdirSync(path));
  const dashboardRoot = deps.dashboardRoot ?? process.cwd();
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const manifest = JSON.parse(readFile(resolve(args.manifestPath))) as P6AttackManifest;
  const violations = [...collectManifestViolations(manifest)];

  let resultsSummary = 'results: not checked';
  if (args.resultsPath !== undefined) {
    const results = JSON.parse(readFile(resolve(args.resultsPath))) as VitestJsonResults;
    violations.push(...collectResultsViolations(results, manifest, { dashboardRoot }));
    resultsSummary = `results: ${results.numTotalTests ?? 0} tests across ${(results.testResults ?? []).length} files`;
  }

  let attackSummary = 'attacks: not checked';
  if (args.attackRoot !== undefined) {
    const attackRoot = resolve(args.attackRoot);
    const artifacts = new Map<string, P6AttackArtifact>();
    for (const entry of readDir(attackRoot)) {
      if (!entry.endsWith('.json')) continue;
      const artifact = JSON.parse(readFile(join(attackRoot, entry))) as P6AttackArtifact;
      const id = typeof artifact.id === 'string' ? artifact.id : entry.replace(/\.json$/, '');
      artifacts.set(id, artifact);
    }
    violations.push(...collectArtifactViolations(manifest, artifacts, args.requireExact ?? -1));
    attackSummary = `attacks: ${artifacts.size} artifacts`;
  }

  if (violations.length > 0) {
    for (const violation of violations) log(`P6 gate violation: ${violation}`);
    log(`P6 gate REFUSED: ${violations.length} violation(s)`);
    return P6_GATE_EXIT.violations;
  }
  log(`P6 gate clean: ${resultsSummary}; ${attackSummary}; ${manifest.gateFiles.length} gate files, ${manifest.attacks.length} attacks`);
  return P6_GATE_EXIT.ok;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = assertP6GateResults(parseAssertP6GateArgs(process.argv.slice(2)));
  } catch (error: unknown) {
    const usage = error instanceof P6GateUsageError;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = usage ? P6_GATE_EXIT.usage : P6_GATE_EXIT.violations;
  }
}

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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BaseAttackArtifact,
  collectArtifactBaseViolations,
  collectAttackIdDriftViolations,
  collectResultsViolationsCore,
  toDashboardRelative,
  type VitestJsonResults,
} from './gateResultsCore.ts';

export { toDashboardRelative };
export type { VitestJsonResults };

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

export function collectManifestViolations(manifest: P5AttackManifest): string[] {
  return collectAttackIdDriftViolations(
    manifest.attacks.map((a) => a.id), P5_ATTACK_IDS, 'the frozen section-9 list',
  );
}

export function collectResultsViolations(
  results: VitestJsonResults,
  manifest: P5AttackManifest,
  options: { dashboardRoot: string },
): string[] {
  return collectResultsViolationsCore(results, manifest, { ...options, requireZeroSkips: true });
}

export type P5AttackArtifact = BaseAttackArtifact;

export function collectArtifactViolations(
  manifest: P5AttackManifest,
  artifacts: Map<string, P5AttackArtifact>,
): string[] {
  const violations = collectArtifactBaseViolations(manifest.attacks.map((a) => a.id), artifacts);
  // --require-exact: the count must equal the frozen twelve exactly.
  const expected = manifest.attacks.length;
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

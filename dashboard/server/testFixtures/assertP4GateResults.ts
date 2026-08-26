/**
 * P4 W6.4 gate-result asserter (plan sections 7 and 9). It runs in TWO modes off one frozen manifest
 * (`p4AttackManifest.json`, which freezes both the section-7 focused test-file set and the eleven
 * section-9 attack ids):
 *
 *  1. RESULTS mode (section 7, line 414):
 *       node server/testFixtures/assertP4GateResults.ts \
 *         --results .artifacts/p4-gate-results.json \
 *         --manifest server/testFixtures/p4AttackManifest.json --require-zero-skips
 *     Reads the Vitest JSON reporter document and refuses anything that lets a green line hide an unrun
 *     proof: a failed test, a skipped/pending/todo test (with --require-zero-skips), a zero-test suite,
 *     a suite file that failed with all tests passing, a manifest gate file MISSING from or EXTRA in the
 *     results (set equality — §417), and any attack whose owning test did not run and pass.
 *
 *  2. ARTIFACT mode (section 9, line 475):
 *       node server/testFixtures/assertP4GateResults.ts \
 *         --attack-root .artifacts/p4-attacks \
 *         --manifest server/testFixtures/p4AttackManifest.json --require-exact 11
 *     Reads the per-attack artifact JSON the isolated fixture-remote proof wrote and refuses a missing
 *     attack, an artifact with `passed !== true`, an empty assertion, a missing artifact path or fixture
 *     identity, a stray artifact, or a count that disagrees with --require-exact.
 *
 * Exit codes: 0 clean, 1 violations (each printed), 2 usage error.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { P4_ATTACK_IDS } from './p4FixtureRemoteLifecycle.ts';
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

export const P4_GATE_EXIT = { ok: 0, violations: 1, usage: 2 } as const;
export type P4GateExitCode = (typeof P4_GATE_EXIT)[keyof typeof P4_GATE_EXIT];

export class P4GateUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P4GateUsageError';
  }
}

export interface AssertP4GateArgs {
  readonly manifestPath: string;
  /** RESULTS mode: the Vitest JSON reporter document. */
  readonly resultsPath?: string;
  readonly requireZeroSkips?: boolean;
  /** ARTIFACT mode: the directory of per-attack `<id>.json` files. */
  readonly attackRoot?: string;
  readonly requireExact?: number;
}

export function parseAssertP4GateArgs(argv: readonly string[]): AssertP4GateArgs {
  let manifestPath: string | null = null;
  let resultsPath: string | undefined;
  let requireZeroSkips = false;
  let attackRoot: string | undefined;
  let requireExact: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P4GateUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--manifest': manifestPath = needValue(); break;
      case '--results': resultsPath = needValue(); break;
      case '--require-zero-skips': requireZeroSkips = true; break;
      case '--attack-root': attackRoot = needValue(); break;
      case '--require-exact': requireExact = Number.parseInt(needValue(), 10); break;
      default: throw new P4GateUsageError(`unknown flag: ${arg}`);
    }
  }
  if (manifestPath === null) throw new P4GateUsageError('--manifest is required');
  if (resultsPath === undefined && attackRoot === undefined) {
    throw new P4GateUsageError('one of --results (section 7) or --attack-root (section 9) is required');
  }
  if (resultsPath !== undefined && attackRoot !== undefined) {
    throw new P4GateUsageError('--results and --attack-root are mutually exclusive');
  }
  if (attackRoot !== undefined && (requireExact === undefined || Number.isNaN(requireExact))) {
    throw new P4GateUsageError('--attack-root requires --require-exact <n>');
  }
  return { manifestPath, resultsPath, requireZeroSkips, attackRoot, requireExact };
}

export interface P4AttackManifestEntry { id: string; suite: string; title: string; proof: string; summary: string }
export interface P4AttackManifest { note: string; gateFiles: string[]; attacks: P4AttackManifestEntry[] }

// ---------------------------------------------------------------------------------------------------
// RESULTS mode (section 7).
// ---------------------------------------------------------------------------------------------------

export function collectResultsViolations(
  results: VitestJsonResults,
  manifest: P4AttackManifest,
  options: { requireZeroSkips: boolean; dashboardRoot: string },
): string[] {
  return [
    ...collectResultsViolationsCore(results, manifest, options),
    // The manifest attack ids must equal the frozen §9 list.
    ...collectAttackIdDriftViolations(manifest.attacks.map((a) => a.id), P4_ATTACK_IDS, 'the section-9 list'),
  ];
}

// ---------------------------------------------------------------------------------------------------
// ARTIFACT mode (section 9).
// ---------------------------------------------------------------------------------------------------

export interface P4AttackArtifact extends BaseAttackArtifact {
  fixtureIdentity?: { tempRoot?: unknown; bareRemote?: unknown; fixtureHead?: unknown; fixtureTag?: unknown };
}

export function collectArtifactViolations(
  manifest: P4AttackManifest,
  artifacts: Map<string, P4AttackArtifact>,
  requireExact: number,
): string[] {
  const violations: string[] = [
    ...collectAttackIdDriftViolations(manifest.attacks.map((a) => a.id), P4_ATTACK_IDS, 'the section-9 list'),
  ];
  if (requireExact !== manifest.attacks.length) {
    violations.push(`--require-exact ${requireExact} != manifest attack count ${manifest.attacks.length}`);
  }

  violations.push(...collectArtifactBaseViolations(manifest.attacks.map((a) => a.id), artifacts));

  // P4-only: each artifact that exists must also carry a valid fixture identity. (A missing artifact
  // already produced its own violation in the base pass above — no double-report here.)
  for (const attack of manifest.attacks) {
    const artifact = artifacts.get(attack.id);
    if (artifact === undefined) continue;
    const identity = artifact.fixtureIdentity;
    if (
      identity === undefined
      || typeof identity.bareRemote !== 'string' || identity.bareRemote.length === 0
      || typeof identity.fixtureHead !== 'string' || !/^[0-9a-f]{40}$/.test(identity.fixtureHead)
    ) {
      violations.push(`attack '${attack.id}': missing or invalid fixture identity`);
    }
  }

  if (artifacts.size !== requireExact) {
    violations.push(`found ${artifacts.size} artifacts, --require-exact ${requireExact}`);
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------
// Entry.
// ---------------------------------------------------------------------------------------------------

export interface AssertP4GateDeps {
  readFile?: (path: string) => string;
  readDir?: (path: string) => string[];
  dashboardRoot?: string;
  log?: (line: string) => void;
}

export function assertP4GateResults(args: AssertP4GateArgs, deps: AssertP4GateDeps = {}): P4GateExitCode {
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const readDir = deps.readDir ?? ((path: string) => readdirSync(path));
  const dashboardRoot = deps.dashboardRoot ?? process.cwd();
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const manifest = JSON.parse(readFile(resolve(args.manifestPath))) as P4AttackManifest;

  let violations: string[];
  let summary: string;
  if (args.resultsPath !== undefined) {
    const results = JSON.parse(readFile(resolve(args.resultsPath))) as VitestJsonResults;
    violations = collectResultsViolations(results, manifest, {
      requireZeroSkips: args.requireZeroSkips ?? false,
      dashboardRoot,
    });
    summary = `P4 gate clean: ${results.numTotalTests ?? 0} tests across ${(results.testResults ?? []).length} files, `
      + `0 failed, 0 skipped/pending/todo, ${manifest.gateFiles.length} gate files, ${manifest.attacks.length} attacks owned`;
  } else {
    const attackRoot = resolve(args.attackRoot as string);
    const artifacts = new Map<string, P4AttackArtifact>();
    for (const entry of readDir(attackRoot)) {
      if (!entry.endsWith('.json')) continue;
      const artifact = JSON.parse(readFile(join(attackRoot, entry))) as P4AttackArtifact;
      const id = typeof artifact.id === 'string' ? artifact.id : entry.replace(/\.json$/, '');
      artifacts.set(id, artifact);
    }
    violations = collectArtifactViolations(manifest, artifacts, args.requireExact as number);
    summary = `P4 gate clean: ${artifacts.size} attacks, all passed with nonempty assertions and fixture identities`;
  }

  if (violations.length > 0) {
    for (const violation of violations) log(`P4 gate violation: ${violation}`);
    log(`P4 gate REFUSED: ${violations.length} violation(s)`);
    return P4_GATE_EXIT.violations;
  }
  log(summary);
  return P4_GATE_EXIT.ok;
}

// Referenced for parity with the P3 asserter's freshness note; statSync kept available to callers that
// want to date a results document against the gate files. Not part of the default violation set.
export function gateFileMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = assertP4GateResults(parseAssertP4GateArgs(process.argv.slice(2)));
  } catch (error: unknown) {
    const usage = error instanceof P4GateUsageError;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = usage ? P4_GATE_EXIT.usage : P4_GATE_EXIT.violations;
  }
}

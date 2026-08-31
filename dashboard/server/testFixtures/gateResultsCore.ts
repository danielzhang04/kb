/**
 * Shared core for the P3-P6 closure gate-result asserters (assertP3GateResults.ts .. assertP6GateResults.ts).
 * Extracted per docs/plans/2026-08-26-vm-runtime-streamline-design.md §4 Slice D: the four phase
 * asserters carried byte-identical Vitest-JSON reporter types, `toDashboardRelative`, and the generic
 * shapes of their violation-collection logic. Each phase file keeps only what genuinely differs — its
 * own attack-id list, CLI/mode parsing, and any phase-specific check (P3's freshness anchor, P4's
 * fixture-identity field, P6's suffix-tolerant title match). The CLI layer is deliberately NOT unified
 * here: P3/P4/P5/P6 argument parsing differs for real reasons (single mode vs dual mode vs all-required
 * flags) and stays in each phase file.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** The subset of the Vitest JSON reporter document every phase asserter reads. */
export interface VitestAssertionResult { fullName?: string; title?: string; status?: string }
export interface VitestFileResult {
  name?: string;
  status?: string;
  message?: string;
  assertionResults?: VitestAssertionResult[];
}
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

export const SKIPPED_STATUSES = new Set(['skipped', 'pending', 'todo']);

/** Manifest shape shared by the P4/P5/P6 attack manifests: a gate-file list plus attack entries whose
 *  owning test the results must contain, passing, under an exact (or, for P6, suffix-tolerant) title. */
export interface AttackManifestLike { gateFiles: string[]; attacks: { id: string; suite: string; title: string }[] }

export interface CollectResultsViolationsOptions {
  dashboardRoot: string;
  /** P4 exposes this as a CLI flag (`--require-zero-skips`, may be false); P5/P6 always pass true —
   *  their CLIs make it mandatory. */
  requireZeroSkips: boolean;
  /** P6 additionally accepts a `fullName` ending with ` <attack title>` when `title` is absent; P3/P4/P5
   *  require an exact match only. Defaults to false (exact-match only). */
  allowFullNameSuffixMatch?: boolean;
}

/**
 * The section-7 "results mode" checks common to the P4/P5/P6 asserters: no failed test, no
 * skipped/pending/todo test (when `requireZeroSkips`), no zero-test suite, no suite file that failed
 * with all tests passing, the manifest gate-file set EQUAL to the reported files (a missing or an extra
 * file both fail), and every attack owned by a passing test at its title. Does NOT check attack-id
 * drift against a frozen list — that check's wording differs per phase, so callers add it themselves via
 * `collectAttackIdDriftViolations`.
 */
export function collectResultsViolationsCore(
  results: VitestJsonResults,
  manifest: AttackManifestLike,
  options: CollectResultsViolationsOptions,
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
    if (file.status === 'failed' && assertions.every((assertion) => assertion.status === 'passed')) {
      violations.push(`suite file failed with all tests passing: ${relPath}`);
    }
    for (const assertion of assertions) {
      const name = assertion.fullName ?? assertion.title ?? '<unnamed test>';
      const status = assertion.status ?? 'unknown';
      if (status === 'failed') violations.push(`failed test: ${relPath} > ${name}`);
      else if (SKIPPED_STATUSES.has(status) && options.requireZeroSkips) {
        violations.push(`${status} test: ${relPath} > ${name}`);
      } else if (status !== 'passed' && !SKIPPED_STATUSES.has(status)) {
        violations.push(`test in state '${status}': ${relPath} > ${name}`);
      }
    }
  }

  if ((results.numFailedTests ?? 0) > 0) violations.push(`numFailedTests = ${results.numFailedTests}`);
  if (options.requireZeroSkips) {
    if ((results.numPendingTests ?? 0) > 0) violations.push(`numPendingTests = ${results.numPendingTests}`);
    if ((results.numTodoTests ?? 0) > 0) violations.push(`numTodoTests = ${results.numTodoTests}`);
  }

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
    const owning = (file.assertionResults ?? []).filter((assertion) => (
      assertion.title === undefined
        ? (assertion.fullName ?? '') === attack.title
          || (options.allowFullNameSuffixMatch === true && (assertion.fullName ?? '').endsWith(` ${attack.title}`))
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

  return violations;
}

/** The manifest-vs-frozen-list attack-id drift check. Wording differs per phase (P4: "the section-9
 *  list", P5: "the frozen section-9 list", P6: "the frozen twenty-one section-9 list"), so callers pass
 *  their own label verbatim to keep the violation text byte-identical to the pre-extraction original. */
export function collectAttackIdDriftViolations(
  manifestAttackIds: readonly string[],
  frozenAttackIds: readonly string[],
  label: string,
): string[] {
  if (JSON.stringify(manifestAttackIds) !== JSON.stringify([...frozenAttackIds])) {
    return [`manifest attack ids drift from ${label}`];
  }
  return [];
}

/** The subset of a per-attack artifact JSON every phase asserter's ARTIFACT mode requires. P4 extends
 *  this with a `fixtureIdentity` field the others don't have. */
export interface BaseAttackArtifact { id?: unknown; passed?: unknown; assertion?: unknown; artifactPath?: unknown }

/**
 * Per-attack `id`/`passed`/`assertion`/`artifactPath` validation, plus the reverse "stray artifact"
 * check — identical across P4/P5/P6. Phase-specific extras (P4's fixture-identity check, the
 * `--require-exact` count comparison, whose source and wording differ per phase) stay in each phase
 * file's own `collectArtifactViolations`.
 */
export function collectArtifactBaseViolations<A extends BaseAttackArtifact>(
  attackIds: readonly string[],
  artifacts: ReadonlyMap<string, A>,
): string[] {
  const violations: string[] = [];
  for (const id of attackIds) {
    const artifact = artifacts.get(id);
    if (artifact === undefined) {
      violations.push(`attack '${id}': no artifact found in the attack root`);
      continue;
    }
    if (artifact.id !== id) violations.push(`attack '${id}': artifact id mismatch (${String(artifact.id)})`);
    if (artifact.passed !== true) violations.push(`attack '${id}': passed is not true (${String(artifact.passed)})`);
    if (typeof artifact.assertion !== 'string' || artifact.assertion.trim().length === 0) {
      violations.push(`attack '${id}': empty assertion`);
    }
    if (typeof artifact.artifactPath !== 'string' || artifact.artifactPath.length === 0) {
      violations.push(`attack '${id}': missing artifact path`);
    }
  }
  for (const id of artifacts.keys()) {
    if (!attackIds.includes(id)) violations.push(`artifact '${id}' has no manifest entry`);
  }
  return violations;
}

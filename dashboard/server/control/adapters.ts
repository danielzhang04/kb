import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { redactSensitiveText } from '../composer/publicTimeline.ts';
import type { ExecutionProfile } from './policy.ts';
import { isSafeRepoRelativePath } from './proposal.ts';
import {
  canonicalStageResultHash,
  canonicalResultOperationKey,
  type AccountingAdapter,
  type CanonicalStageResultPayload,
  type ExecutionBudget,
  type ExecutionUsage,
  type ResultIntegrator,
  type SkillResolver,
  type WorkerArtifactResult,
  type WorktreeAdapter,
} from './execution.ts';
import { parseReviewOutcome, type ReviewContract, type ReviewOutcome } from './reviewOutcome.ts';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_FILE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PINNED_COMMIT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const MAX_OPERATION_KEY = 512;
const MAX_RESULT_SUMMARY_BYTES = 64 * 1024;
const MAX_STATE_BYTES = 32 * 1024 * 1024;

export class ExecutionAdapterError extends Error {}

export interface GitCommandResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

/** The only injectable process boundary. Production always invokes local Git with a closed environment. */
export interface GitCommandRunner {
  run(args: readonly string[], cwd: string): Promise<GitCommandResult>;
}

export interface LocalGitRunnerOptions {
  maxOutputBytes?: number;
}

/**
 * Local-only Git runner. It exposes no executable, shell, environment, or permission-mode option.
 * The adapter adds protocol and hook restrictions to every invocation.
 */
export function createLocalGitCommandRunner(options: LocalGitRunnerOptions = {}): GitCommandRunner {
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  requireSafeInteger(maxOutputBytes, 'maxOutputBytes', 1);
  return {
    run(args, cwd) {
      return new Promise((resolvePromise, reject) => {
        const environment: NodeJS.ProcessEnv = {};
        for (const name of ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL']) {
          if (process.env[name] !== undefined) environment[name] = process.env[name];
        }
        const child = spawn('git', [...args], {
          cwd,
          env: environment,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let total = 0;
        let exceeded = false;
        const collect = (target: Buffer[]) => (chunk: Buffer): void => {
          total += chunk.length;
          if (total > maxOutputBytes) {
            exceeded = true;
            child.kill();
            return;
          }
          target.push(chunk);
        };
        child.stdout.on('data', collect(stdout));
        child.stderr.on('data', collect(stderr));
        child.once('error', reject);
        child.once('close', (code) => {
          if (exceeded) return reject(new ExecutionAdapterError('git output exceeded the server-owned limit'));
          resolvePromise({
            exitCode: code ?? -1,
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr).toString('utf8').slice(0, maxOutputBytes),
          });
        });
      });
    },
  };
}

export interface GitWorktreeAdapterOptions {
  repoRoot: string;
  worktreeRoot: string;
  /** Immutable server-selected commit, never a browser-selected ref. */
  baseCommit: string;
  runner?: GitCommandRunner;
  maxChangedFiles?: number;
  maxChangedFileBytes?: number;
  /**
   * C2 (2026-07-21) — when true, `ensure` materializes only the attempt's `sparsePaths`
   * (effectiveRead ∪ writeScope) via `git sparse-checkout` instead of the full tree. DEFAULT FALSE:
   * the full-checkout path is byte-identical to the pre-change adapter, so this flag is the deliberate
   * opt-in that keeps full checkout the default until the sparse path is reviewed on Windows. This is a
   * DRIFT + non-git read control, NOT adversary containment: a Bash worker can still reach the whole repo
   * through the shared `.git` object store (`git show`), which is why sparse pairs with the no-Bash
   * scanner profile (C1). See docs/specs/2026-07-21-worker-read-scope-design.md §5.1.
   */
  sparseReadScope?: boolean;
  /**
   * C2 wiring (2026-07-21) — the per-attempt sparse path source used when the engine's `ensure` call does
   * NOT itself carry `sparsePaths`. The live engine call site (execution.ts) passes no `sparsePaths` and
   * MUST NOT be edited, so activation.ts supplies this callback (keyed on `input.runRef`) to hand the
   * approved run scope (effectiveRead ∪ writeScope) to the adapter at provisioning time. Only consulted
   * when `sparseReadScope` is on AND `input.sparsePaths` is absent; returning `undefined` means "nothing
   * to materialize sparsely" and the adapter falls back to a full checkout. Pure of any acceptance role —
   * §6 write acceptance stays anchored on scope.write in execution.ts.
   */
  resolveSparsePaths?: (input: GitWorktreeEnsureInput) => readonly string[] | undefined;
}

/** The `ensure` input the git adapter accepts — the base `WorktreeAdapter` shape plus the optional C2
 *  sparse path list. The extra field is optional, so this stays assignable to `WorktreeAdapter.ensure`
 *  and the live execution call site (which passes no `sparsePaths`) keeps full checkout unchanged. */
export interface GitWorktreeEnsureInput {
  operationKey: string;
  runRef: string;
  path: string;
  baseCommit?: string;
  /** Repo-relative paths to materialize when the adapter is built with `sparseReadScope: true`. */
  sparsePaths?: readonly string[];
}

/** The git worktree adapter: a `WorktreeAdapter` whose `ensure` additionally accepts C2 sparse paths. */
export interface GitWorktreeAdapter extends WorktreeAdapter {
  ensure(input: GitWorktreeEnsureInput): Promise<void>;
}

/**
 * Validate + dedupe the C2 sparse path set (same safe-path rule the compiled scope.read passes) and emit
 * ROOT-ANCHORED git sparse-checkout patterns.
 *
 * Anchoring is load-bearing (live-verified 2026-07-22 on real git, Windows): `git sparse-checkout --no-cone`
 * uses gitignore semantics, where an UNANCHORED pattern like `_index.md` or `dashboards` matches that name
 * at ANY depth. Unanchored, `_index.md` materialized EVERY org's `_index.md` (a cross-org privacy leak) and
 * `dashboards`/`ledgers` matched nested `dashboard/server/__fixtures__` dirs. A leading-slash pattern
 * anchors to the repo root and matches the exact file OR directory (and, for a directory, everything
 * beneath it) — materializing exactly the declared set with zero other-org files. The safe-path validator
 * rejects a leading `/`, so we validate the raw repo-relative path THEN anchor it.
 *
 * NOTE for humans testing these patterns from Git Bash: prefix the git call with `MSYS_NO_PATHCONV=1` or
 * MSYS rewrites a leading-slash pattern into the Git install path. The daemon's direct (non-shell) spawn
 * via `createLocalGitCommandRunner` is unaffected.
 */
function normalizeSparsePaths(paths: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths ?? []) {
    if (!isSafeRepoRelativePath(path)) throw new ExecutionAdapterError('sparse read-scope path is not a canonical safe repo-relative path');
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(`/${path}`);
  }
  return out;
}

function requireAbsolute(path: string, name: string): string {
  if (!isAbsolute(path) || path.includes('\0')) throw new ExecutionAdapterError(`${name} must be an absolute server-owned path`);
  return resolve(path);
}

function requireSafeInteger(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new ExecutionAdapterError(`${name} is invalid`);
}

function requireOperationKey(value: string): void {
  if (!value || value.length > MAX_OPERATION_KEY || value.includes('\0')) throw new ExecutionAdapterError('operationKey is invalid');
}

function childOf(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function expectedAttemptPath(worktreeRoot: string, runRef: string, candidate: string): string {
  if (!SAFE_FILE_SEGMENT.test(runRef) || runRef.includes('..') || !isSafeRepoRelativePath(runRef)) {
    throw new ExecutionAdapterError('runRef is unsafe');
  }
  const absolute = requireAbsolute(candidate, 'attempt worktree path');
  if (!childOf(worktreeRoot, absolute)) throw new ExecutionAdapterError('attempt worktree escapes the server-owned root');
  const parts = relative(worktreeRoot, absolute).split(sep);
  if (parts.length !== 2 || parts[0] !== runRef || !SAFE_FILE_SEGMENT.test(parts[1])
    || parts[1].includes('..') || !isSafeRepoRelativePath(parts[1])) {
    throw new ExecutionAdapterError('attempt worktree path does not match the server-owned run layout');
  }
  return absolute;
}

function commandFailure(label: string, result: GitCommandResult): never {
  throw new ExecutionAdapterError(`${label} failed (${result.exitCode}): ${result.stderr.slice(0, 512)}`);
}

function normalizedExistingPath(path: string): string {
  return resolve(realpathSync(path));
}

function parseStatus(output: Buffer, maxChangedFiles: number): string[] {
  const records = output.toString('utf8').split('\0');
  if (records.at(-1) === '') records.pop();
  if (records.length > maxChangedFiles) throw new ExecutionAdapterError('changed-file count exceeds the server-owned limit');
  const paths: string[] = [];
  for (const record of records) {
    if (record.length < 4 || record[2] !== ' ') throw new ExecutionAdapterError('git returned an invalid porcelain status record');
    const status = record.slice(0, 2);
    const path = record.slice(3);
    // The canonical result DTO cannot safely represent removals, renames, conflicts, type changes, or submodules.
    if (!(status === '??' || [...status].every((value) => value === ' ' || value === 'M' || value === 'A'))) {
      throw new ExecutionAdapterError(`unsupported changed-file status '${status}'`);
    }
    if (!isSafeRepoRelativePath(path)) throw new ExecutionAdapterError('git returned an unsafe changed-file path');
    if (paths.includes(path)) throw new ExecutionAdapterError('git returned a duplicate changed-file path');
    paths.push(path);
  }
  return paths.sort();
}

async function runGit(
  runner: GitCommandRunner,
  prefix: readonly string[],
  args: readonly string[],
  cwd: string,
  label: string,
): Promise<GitCommandResult> {
  const result = await runner.run([...prefix, ...args], cwd);
  if (result.exitCode !== 0) commandFailure(label, result);
  return result;
}

/** Git-backed, non-destructive worktree provisioning and server-side content inspection. */
export function createGitWorktreeAdapter(options: GitWorktreeAdapterOptions): GitWorktreeAdapter {
  const repoRoot = requireAbsolute(options.repoRoot, 'repoRoot');
  const worktreeRoot = requireAbsolute(options.worktreeRoot, 'worktreeRoot');
  if (!existsSync(repoRoot) || !lstatSync(repoRoot).isDirectory()) throw new ExecutionAdapterError('repoRoot is unavailable');
  if (repoRoot === worktreeRoot || childOf(repoRoot, worktreeRoot) || childOf(worktreeRoot, repoRoot)) {
    throw new ExecutionAdapterError('worktreeRoot and repoRoot must be disjoint');
  }
  if (!PINNED_COMMIT.test(options.baseCommit)) throw new ExecutionAdapterError('baseCommit must be a full immutable object id');
  const runner = options.runner ?? createLocalGitCommandRunner();
  const maxChangedFiles = options.maxChangedFiles ?? 1_024;
  const maxChangedFileBytes = options.maxChangedFileBytes ?? 16 * 1024 * 1024;
  requireSafeInteger(maxChangedFiles, 'maxChangedFiles', 1);
  requireSafeInteger(maxChangedFileBytes, 'maxChangedFileBytes', 1);
  mkdirSync(worktreeRoot, { recursive: true, mode: 0o700 });
  const hooksPath = join(worktreeRoot, '.disabled-hooks');
  mkdirSync(hooksPath, { recursive: true, mode: 0o700 });
  // core.longpaths=true: server-owned worktrees live under a deep state-root path
  // (…/control/worktrees/run-…/attempt-…); combined with long repo-relative paths this exceeds Windows
  // MAX_PATH (260) and `git worktree add` fails "Filename too long". A no-op off Windows. Not a gate.
  const prefix = ['-c', 'protocol.allow=never', '-c', 'core.longpaths=true', '-c', `core.hooksPath=${hooksPath}`, '--literal-pathspecs'] as const;

  const verify = async (path: string): Promise<void> => {
    const top = await runGit(runner, prefix, ['rev-parse', '--show-toplevel'], path, 'worktree verification');
    if (normalizedExistingPath(top.stdout.toString('utf8').trim()) !== normalizedExistingPath(path)) {
      throw new ExecutionAdapterError('existing path is not the planned worktree root');
    }
    const repoCommon = await runGit(runner, prefix, ['rev-parse', '--path-format=absolute', '--git-common-dir'], repoRoot, 'repository identity');
    const treeCommon = await runGit(runner, prefix, ['rev-parse', '--path-format=absolute', '--git-common-dir'], path, 'worktree identity');
    if (normalizedExistingPath(repoCommon.stdout.toString('utf8').trim()) !== normalizedExistingPath(treeCommon.stdout.toString('utf8').trim())) {
      throw new ExecutionAdapterError('existing worktree belongs to a different repository');
    }
  };

  return {
    async ensure(input) {
      requireOperationKey(input.operationKey);
      const path = expectedAttemptPath(worktreeRoot, input.runRef, input.path);
      const baseCommit = input.baseCommit ?? options.baseCommit;
      if (!PINNED_COMMIT.test(baseCommit)) throw new ExecutionAdapterError('attempt baseCommit must be a full immutable object id');
      if (existsSync(path)) {
        if (!lstatSync(path).isDirectory()) throw new ExecutionAdapterError('planned worktree path is not a directory');
        await verify(path);
        const existing = await runGit(runner, prefix, ['rev-parse', 'HEAD'], path, 'attempt base verification');
        if (existing.stdout.toString('utf8').trim() !== baseCommit) {
          throw new ExecutionAdapterError('existing attempt worktree has a different committed lineage base');
        }
        return;
      }
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      // C2: with sparseReadScope AND a non-empty sparse set, materialize only those repo-relative paths
      // (effectiveRead ∪ writeScope). The write-scope paths MUST be included so the worker can write and
      // `inspect` can see the change — sparse checkout bounds READS only; §6 acceptance stays anchored on
      // scope.write. With the flag off (default) this is the exact pre-change `worktree add --detach`.
      // Live-verified 2026-07-22 (real git, Windows): `git status --porcelain=v1 -z --untracked-files=all`
      // still reports untracked writes in NON-materialized dirs (e.g. `?? scripts/evil.txt`), so write-scope
      // enforcement is NOT blinded by sparse checkout — out-of-scope writes are still detected and rejected.
      // The engine call site (execution.ts) is not edited and passes no `sparsePaths`, so fall back to the
      // construction-time `resolveSparsePaths` callback (activation.ts, keyed on runRef). The callback is
      // consulted ONLY when the flag is on; with the flag off this is the exact pre-change full checkout and
      // `resolveSparsePaths` is never evaluated.
      const sparsePaths = options.sparseReadScope
        ? normalizeSparsePaths(input.sparsePaths ?? options.resolveSparsePaths?.(input))
        : [];
      if (sparsePaths.length > 0) {
        await runGit(runner, prefix, ['worktree', 'add', '--no-checkout', '--detach', path, baseCommit], repoRoot, 'worktree creation');
        if (!existsSync(path)) throw new ExecutionAdapterError('git did not create the planned worktree');
        // `init --no-cone` takes a literal path list (not cone patterns), matching arbitrary repo roots.
        await runGit(runner, prefix, ['sparse-checkout', 'init', '--no-cone'], path, 'sparse-checkout init');
        await runGit(runner, prefix, ['sparse-checkout', 'set', ...sparsePaths], path, 'sparse-checkout set');
        await runGit(runner, prefix, ['checkout'], path, 'sparse worktree checkout');
      } else {
        await runGit(runner, prefix, ['worktree', 'add', '--detach', path, baseCommit], repoRoot, 'worktree creation');
        if (!existsSync(path)) throw new ExecutionAdapterError('git did not create the planned worktree');
      }
      await verify(path);
    },

    async inspect(input) {
      requireOperationKey(input.operationKey);
      const path = expectedAttemptPath(worktreeRoot, input.runRef, input.path);
      if (!existsSync(path) || !lstatSync(path).isDirectory()) throw new ExecutionAdapterError('planned worktree is unavailable');
      await verify(path);
      const status = await runGit(
        runner,
        prefix,
        ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all'],
        path,
        'changed-file inspection',
      );
      const paths = parseStatus(status.stdout, maxChangedFiles);
      const changed: WorkerArtifactResult[] = [];
      for (const repoPath of paths) {
        const absolute = resolve(path, ...repoPath.split('/'));
        if (!childOf(path, absolute)) throw new ExecutionAdapterError('changed file escapes its worktree');
        const before = lstatSync(absolute, { bigint: true });
        if (!before.isFile() || before.isSymbolicLink()) throw new ExecutionAdapterError('changed path is not a regular file');
        if (!childOf(normalizedExistingPath(path), normalizedExistingPath(absolute))) {
          throw new ExecutionAdapterError('changed file resolves outside its worktree');
        }
        if (before.size > BigInt(maxChangedFileBytes)) throw new ExecutionAdapterError('changed file exceeds the server-owned size limit');
        const content = readFileSync(absolute);
        const after = statSync(absolute, { bigint: true });
        if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) throw new ExecutionAdapterError('changed file mutated during inspection');
        changed.push({ path: repoPath, digest: createHash('sha256').update(content).digest('hex') });
      }
      return { changed };
    },

    async remove(input) {
      requireOperationKey(input.operationKey);
      // Validate the layout with the same containment check as ensure/inspect before touching Git,
      // so removal can never target anything outside the server-owned worktree root.
      const path = expectedAttemptPath(worktreeRoot, input.runRef, input.path);
      const result = await runner.run([...prefix, 'worktree', 'remove', '--force', path], repoRoot);
      if (result.exitCode === 0) return;
      // Best-effort and idempotent: a missing or already-removed worktree is success. Unexpected
      // failures (a broken repository, a locked tree) still surface so they are not silently lost.
      const stderr = result.stderr.toLowerCase();
      const benign = stderr.includes('is not a working tree')
        || stderr.includes('not a working tree')
        || stderr.includes('no such file')
        || stderr.includes('does not exist')
        || stderr.includes('cannot find')
        || stderr.includes('enoent');
      if (!benign) commandFailure('worktree removal', result);
    },
  };
}

interface AccountingReservationRecord {
  operationKey: string;
  fingerprint: string;
  reservationRef: string;
  subject: string;
  runRef: string;
  attemptRef: string;
  limits: ExecutionBudget;
  state: 'active' | 'settled';
  usage: ExecutionUsage | null;
  settlementOperationKey: string | null;
  settlementFingerprint: string | null;
  reservedAt: string;
  settledAt: string | null;
}

interface AccountingDocument {
  schema: 'kb.execution-accounting/v1';
  revision: number;
  policyHash: string;
  windowId: string;
  reservations: AccountingReservationRecord[];
}

interface ResultRecord {
  operationKey: string;
  fingerprint: string;
  subject: string;
  runRef: string;
  stageRef: string;
  stageId: string;
  attemptRef: string;
  canonicalCardRef: string | null;
  /** Absent only on legacy non-review v1 records written before review contracts were journaled. */
  reviewContract?: ReviewContract | null;
  result: CanonicalStageResultPayload & { resultHash: string };
  integratedAt: string;
}

interface ResultDocument {
  schema: 'kb.execution-results/v1';
  revision: number;
  results: ResultRecord[];
}

interface AtomicDocumentOptions<T> {
  path: string;
  empty: () => T;
  validate: (value: unknown) => asserts value is T;
  lockTimeoutMs?: number;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function validCanonicalCardRef(operationKey: string, runRef: string, stageId: string, cardRef: string | null): boolean {
  const firstGeneration = canonicalResultOperationKey(runRef, stageId);
  if (operationKey === firstGeneration) return typeof cardRef === 'string' && SAFE_REF.test(cardRef) && !cardRef.includes('..');
  const match = /^:g([1-9]\d*)$/.exec(operationKey.slice(firstGeneration.length));
  return Boolean(match && Number(match[1]) >= 2 && cardRef === null);
}

function validatedReviewOutcome(value: unknown, contract: unknown): ReviewOutcome | undefined {
  if (value === undefined) {
    if (contract !== null && contract !== undefined) throw new ExecutionAdapterError('canonical result has a review contract without an outcome');
    return undefined;
  }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new ExecutionAdapterError('canonical review outcome lacks an immutable review contract');
  }
  try {
    const parsed = parseReviewOutcome(JSON.stringify(value), contract as ReviewContract);
    if (!parsed.ok) throw new ExecutionAdapterError(parsed.detail);
    return parsed.value;
  } catch (error) {
    if (error instanceof ExecutionAdapterError) throw error;
    throw new ExecutionAdapterError('canonical review outcome is invalid');
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertRecord(value: unknown, schema: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).schema !== schema) {
    throw new ExecutionAdapterError(`invalid ${schema} state document`);
  }
}

function assertAccountingDocument(value: unknown): asserts value is AccountingDocument {
  assertRecord(value, 'kb.execution-accounting/v1');
  if (!Number.isSafeInteger(value.revision) || !SHA256.test(String(value.policyHash)) || typeof value.windowId !== 'string' || !Array.isArray(value.reservations)) {
    throw new ExecutionAdapterError('invalid accounting state document');
  }
  const operations = new Set<string>();
  const references = new Set<string>();
  for (const item of value.reservations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ExecutionAdapterError('invalid accounting reservation record');
    const record = item as unknown as AccountingReservationRecord;
    requireOperationKey(record.operationKey);
    if (operations.has(record.operationKey) || references.has(record.reservationRef) || !SAFE_REF.test(record.reservationRef)
      || !SHA256.test(record.fingerprint) || !['active', 'settled'].includes(record.state)) {
      throw new ExecutionAdapterError('invalid accounting reservation identity');
    }
    if ([record.subject, record.runRef, record.attemptRef, record.reservedAt].some((field) =>
      typeof field !== 'string' || field.length === 0 || field.includes('\0'))) {
      throw new ExecutionAdapterError('invalid accounting reservation metadata');
    }
    assertBudget(record.limits, 'stored reservation limits');
    if (record.fingerprint !== digest({
      operationKey: record.operationKey,
      subject: record.subject,
      runRef: record.runRef,
      attemptRef: record.attemptRef,
      limits: record.limits,
    })) throw new ExecutionAdapterError('stored accounting reservation fingerprint differs');
    if (record.state === 'active' && (record.usage !== null || record.settlementOperationKey !== null || record.settlementFingerprint !== null)) {
      throw new ExecutionAdapterError('active accounting reservation contains a settlement');
    }
    if (record.state === 'settled') {
      if (!record.usage || !record.settlementOperationKey || !record.settlementFingerprint || !SHA256.test(record.settlementFingerprint)) {
        throw new ExecutionAdapterError('settled accounting reservation is incomplete');
      }
      assertUsage(record.usage, 'stored settlement usage');
      if (!withinBudget(record.usage, record.limits)) throw new ExecutionAdapterError('stored settlement exceeds its reservation');
      if (record.settlementFingerprint !== digest({
        operationKey: record.settlementOperationKey,
        reservationRef: record.reservationRef,
        usage: record.usage,
      })) throw new ExecutionAdapterError('stored accounting settlement fingerprint differs');
    }
    operations.add(record.operationKey);
    references.add(record.reservationRef);
  }
}

function assertResultDocument(value: unknown): asserts value is ResultDocument {
  assertRecord(value, 'kb.execution-results/v1');
  if (!Number.isSafeInteger(value.revision) || !Array.isArray(value.results)) throw new ExecutionAdapterError('invalid result state document');
  const operations = new Set<string>();
  for (const item of value.results) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ExecutionAdapterError('invalid canonical result record');
    const record = item as unknown as ResultRecord;
    const hasReviewContract = Object.prototype.hasOwnProperty.call(record, 'reviewContract');
    if (!hasReviewContract && record.result && Object.prototype.hasOwnProperty.call(record.result, 'reviewOutcome')) {
      throw new ExecutionAdapterError('canonical result review contract is absent');
    }
    requireOperationKey(record.operationKey);
    if (operations.has(record.operationKey) || !SHA256.test(record.fingerprint)
      || !record.result || !SHA256.test(record.result.resultHash)) {
      throw new ExecutionAdapterError('invalid canonical result identity');
    }
    if ([record.subject, record.runRef, record.stageRef, record.stageId, record.attemptRef, record.integratedAt]
      .some((field) => typeof field !== 'string' || field.length === 0 || field.includes('\0'))
      || [record.runRef, record.stageRef, record.stageId, record.attemptRef]
        .some((field) => !SAFE_REF.test(field) || field.includes('..'))) {
      throw new ExecutionAdapterError('invalid canonical result metadata');
    }
    if (!validCanonicalCardRef(record.operationKey, record.runRef, record.stageId, record.canonicalCardRef)) {
      throw new ExecutionAdapterError('invalid canonical result card identity');
    }
    const reviewOutcome = validatedReviewOutcome(
      record.result.reviewOutcome,
      hasReviewContract ? record.reviewContract : undefined,
    );
    if (!record.result.summary || record.result.summary.includes('\0')
      || Buffer.byteLength(record.result.summary, 'utf8') > MAX_RESULT_SUMMARY_BYTES
      || redactSensitiveText(record.result.summary) !== record.result.summary) {
      throw new ExecutionAdapterError('invalid canonical result summary');
    }
    const canonicalResult = {
      summary: record.result.summary,
      artifacts: normalizedArtifacts(record.result.artifacts),
      changed: normalizedArtifacts(record.result.changed),
      checkpoints: normalizedCheckpoints(record.result.checkpoints),
      ...(reviewOutcome ? { reviewOutcome } : {}),
    };
    if (canonicalStageResultHash(canonicalResult) !== record.result.resultHash) {
      throw new ExecutionAdapterError('stored canonical result hash does not match its payload');
    }
    const fingerprintInput = {
      operationKey: record.operationKey,
      subject: record.subject,
      runRef: record.runRef,
      stageRef: record.stageRef,
      stageId: record.stageId,
      attemptRef: record.attemptRef,
      canonicalCardRef: record.canonicalCardRef,
      result: { ...canonicalResult, resultHash: record.result.resultHash },
    };
    const storedFingerprint = digest(hasReviewContract
      ? { ...fingerprintInput, reviewContract: record.reviewContract }
      : fingerprintInput);
    if (record.fingerprint !== storedFingerprint) throw new ExecutionAdapterError('stored canonical result fingerprint differs');
    operations.add(record.operationKey);
  }
}

function createAtomicDocument<T>(options: AtomicDocumentOptions<T>): {
  read(): T;
  mutate<R>(callback: (document: T) => R | Promise<R>): Promise<R>;
} {
  const lockPath = `${options.path}.lock`;
  const timeout = options.lockTimeoutMs ?? 5_000;
  requireSafeInteger(timeout, 'lockTimeoutMs', 1);
  mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });

  const read = (): T => {
    if (!existsSync(options.path)) return options.empty();
    if (statSync(options.path).size > MAX_STATE_BYTES) throw new ExecutionAdapterError('execution adapter state exceeds its limit');
    const parsed: unknown = JSON.parse(readFileSync(options.path, 'utf8'));
    options.validate(parsed);
    return clone(parsed);
  };
  const save = (document: T): void => {
    const encoded = `${JSON.stringify(document)}\n`;
    if (Buffer.byteLength(encoded, 'utf8') > MAX_STATE_BYTES) throw new ExecutionAdapterError('execution adapter state exceeds its limit');
    const temp = `${options.path}.${process.pid}.${randomUUID()}.tmp`;
    let fd: number | null = null;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, encoded, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(temp, options.path);
    } finally {
      if (fd !== null) closeSync(fd);
      if (existsSync(temp)) rmSync(temp, { force: true });
    }
  };
  const acquire = async (): Promise<number> => {
    const deadline = Date.now() + timeout;
    while (true) {
      try {
        return openSync(lockPath, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new ExecutionAdapterError('execution adapter state is busy');
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      }
    }
  };
  return {
    read,
    async mutate(callback) {
      const lockFd = await acquire();
      try {
        const document = read();
        const result = await callback(document);
        save(document);
        return result;
      } finally {
        closeSync(lockFd);
        rmSync(lockPath, { force: true });
      }
    },
  };
}

function assertBudget(value: ExecutionBudget, label: string): void {
  requireSafeInteger(value.maxAttempts, `${label}.maxAttempts`, 1);
  requireSafeInteger(value.maxInputTokens, `${label}.maxInputTokens`, 0);
  requireSafeInteger(value.maxOutputTokens, `${label}.maxOutputTokens`, 0);
  requireSafeInteger(value.maxCostUsdMicros, `${label}.maxCostUsdMicros`, 0);
}

function assertUsage(value: ExecutionUsage, label: string): void {
  requireSafeInteger(value.inputTokens, `${label}.inputTokens`, 0);
  requireSafeInteger(value.outputTokens, `${label}.outputTokens`, 0);
  requireSafeInteger(value.costUsdMicros, `${label}.costUsdMicros`, 0);
}

function plusUsage(left: ExecutionUsage, right: ExecutionUsage): ExecutionUsage {
  const add = (one: number, two: number): number => one > Number.MAX_SAFE_INTEGER - two ? Number.POSITIVE_INFINITY : one + two;
  return {
    inputTokens: add(left.inputTokens, right.inputTokens),
    outputTokens: add(left.outputTokens, right.outputTokens),
    costUsdMicros: add(left.costUsdMicros, right.costUsdMicros),
  };
}

function budgetAsUsage(value: ExecutionBudget): ExecutionUsage {
  return { inputTokens: value.maxInputTokens, outputTokens: value.maxOutputTokens, costUsdMicros: value.maxCostUsdMicros };
}

function withinBudget(usage: ExecutionUsage, budget: ExecutionBudget): boolean {
  return usage.inputTokens <= budget.maxInputTokens
    && usage.outputTokens <= budget.maxOutputTokens
    && usage.costUsdMicros <= budget.maxCostUsdMicros;
}

export interface FileAccountingAdapterOptions {
  stateRoot: string;
  /** Server-owned accounting period, for example an ISO date. */
  windowId: string;
  maxConcurrency: number;
  globalBudget: ExecutionBudget;
  now?: () => Date;
  newId?: () => string;
  lockTimeoutMs?: number;
}

/** Durable global reservation ledger with lock-serialized version CAS and exact idempotency. */
export function createFileAccountingAdapter(options: FileAccountingAdapterOptions): AccountingAdapter {
  const stateRoot = requireAbsolute(options.stateRoot, 'stateRoot');
  if (!SAFE_FILE_SEGMENT.test(options.windowId) || options.windowId.includes('..') || !isSafeRepoRelativePath(options.windowId)) {
    throw new ExecutionAdapterError('windowId is invalid');
  }
  requireSafeInteger(options.maxConcurrency, 'maxConcurrency', 1);
  assertBudget(options.globalBudget, 'globalBudget');
  const policyHash = digest({ maxConcurrency: options.maxConcurrency, globalBudget: options.globalBudget });
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const document = createAtomicDocument<AccountingDocument>({
    path: join(stateRoot, 'control', 'execution-accounting', `${options.windowId}.json`),
    empty: () => ({ schema: 'kb.execution-accounting/v1', revision: 0, policyHash, windowId: options.windowId, reservations: [] }),
    validate: assertAccountingDocument,
    lockTimeoutMs: options.lockTimeoutMs,
  });
  const requirePolicy = (value: AccountingDocument): void => {
    if (value.policyHash !== policyHash || value.windowId !== options.windowId) {
      throw new ExecutionAdapterError('accounting policy differs from the durable window policy');
    }
  };

  return {
    async reserve(input) {
      requireOperationKey(input.operationKey);
      assertBudget(input.limits, 'reservation limits');
      const fingerprint = digest(input);
      return document.mutate((state) => {
        requirePolicy(state);
        const prior = state.reservations.find((item) => item.operationKey === input.operationKey);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new ExecutionAdapterError('reservation operationKey was reused with different content');
          return { ok: true as const, value: { reservationRef: prior.reservationRef, replayed: true } };
        }
        if (state.reservations.length >= options.globalBudget.maxAttempts) return { ok: false as const, reason: 'global attempt budget exhausted' };
        if (state.reservations.filter((item) => item.state === 'active').length >= options.maxConcurrency) {
          return { ok: false as const, reason: 'global concurrency limit reached' };
        }
        if (input.limits.maxAttempts > options.globalBudget.maxAttempts) {
          return { ok: false as const, reason: 'reservation exceeds the global attempt budget' };
        }
        const committedOrHeld = state.reservations.reduce<ExecutionUsage>((sum, item) =>
          plusUsage(sum, item.state === 'settled' ? item.usage as ExecutionUsage : budgetAsUsage(item.limits)),
        { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 });
        const projected = plusUsage(committedOrHeld, budgetAsUsage(input.limits));
        if (!withinBudget(projected, options.globalBudget)) return { ok: false as const, reason: 'global token or cost budget exhausted' };
        const reservationRef = `reservation-${newId()}`;
        if (!SAFE_REF.test(reservationRef)) throw new ExecutionAdapterError('generated reservation reference is invalid');
        state.reservations.push({
          operationKey: input.operationKey,
          fingerprint,
          reservationRef,
          subject: input.subject,
          runRef: input.runRef,
          attemptRef: input.attemptRef,
          limits: clone(input.limits),
          state: 'active',
          usage: null,
          settlementOperationKey: null,
          settlementFingerprint: null,
          reservedAt: now().toISOString(),
          settledAt: null,
        });
        state.revision += 1;
        return { ok: true as const, value: { reservationRef, replayed: false } };
      });
    },

    async settle(input) {
      requireOperationKey(input.operationKey);
      assertUsage(input.usage, 'settlement usage');
      await document.mutate((state) => {
        requirePolicy(state);
        const reservation = state.reservations.find((item) => item.reservationRef === input.reservationRef);
        if (!reservation) throw new ExecutionAdapterError('accounting reservation was not found');
        const fingerprint = digest(input);
        if (reservation.state === 'settled') {
          if (reservation.settlementOperationKey !== input.operationKey || reservation.settlementFingerprint !== fingerprint) {
            throw new ExecutionAdapterError('settlement replay differs from the committed usage');
          }
          return;
        }
        if (!withinBudget(input.usage, reservation.limits)) throw new ExecutionAdapterError('settlement exceeds its reserved limits');
        reservation.state = 'settled';
        reservation.usage = clone(input.usage);
        reservation.settlementOperationKey = input.operationKey;
        reservation.settlementFingerprint = fingerprint;
        reservation.settledAt = now().toISOString();
        state.revision += 1;
      });
    },
  };
}

function normalizedArtifacts(value: readonly WorkerArtifactResult[]): WorkerArtifactResult[] {
  const paths = new Set<string>();
  return value.map((item) => {
    if (!isSafeRepoRelativePath(item.path) || !SHA256.test(item.digest) || paths.has(item.path)) {
      throw new ExecutionAdapterError('canonical result contains an invalid or duplicate artifact');
    }
    paths.add(item.path);
    return { path: item.path, digest: item.digest };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function normalizedCheckpoints(value: readonly string[]): string[] {
  if (value.some((item) => !SAFE_REF.test(item)) || new Set(value).size !== value.length) {
    throw new ExecutionAdapterError('canonical result contains an invalid or duplicate checkpoint');
  }
  return [...value].sort();
}

export interface FileResultIntegratorOptions {
  stateRoot: string;
  now?: () => Date;
  lockTimeoutMs?: number;
}

/**
 * Durable app-local result receipts with exact replay checks. This adapter is useful for inactive
 * tests/recovery only; it is not canonical queue truth and must not be used to activate execution.
 * Production activation must select createCanonicalGitResultIntegrator instead.
 */
export function createFileResultIntegrator(options: FileResultIntegratorOptions): ResultIntegrator {
  const stateRoot = requireAbsolute(options.stateRoot, 'stateRoot');
  const now = options.now ?? (() => new Date());
  const document = createAtomicDocument<ResultDocument>({
    path: join(stateRoot, 'control', 'execution-results.json'),
    empty: () => ({ schema: 'kb.execution-results/v1', revision: 0, results: [] }),
    validate: assertResultDocument,
    lockTimeoutMs: options.lockTimeoutMs,
  });
  return {
    async lookup(input) {
      requireOperationKey(input.operationKey);
      const state = document.read();
      const byOperation = state.results.find((item) => item.operationKey === input.operationKey);
      if (!byOperation) return null;
      if (byOperation.subject !== input.subject || byOperation.runRef !== input.runRef || byOperation.stageId !== input.stageId) {
        throw new ExecutionAdapterError('canonical result lookup identity differs from the committed operation');
      }
      return {
        ...clone(byOperation.result),
        durability: 'inactive' as const,
        attemptBaseCommit: null,
        integrationCommit: null,
      };
    },

    async integrate(input) {
      requireOperationKey(input.operationKey);
      if (!input.summary || input.summary.includes('\0') || Buffer.byteLength(input.summary, 'utf8') > MAX_RESULT_SUMMARY_BYTES) {
        throw new ExecutionAdapterError('canonical result summary is invalid');
      }
      // Credential-shape gate only — `redactSensitiveText` recognizes secrets, not PII or content.
      if (redactSensitiveText(input.summary) !== input.summary) throw new ExecutionAdapterError('canonical result summary contains a recognized secret');
      for (const ref of [input.runRef, input.stageRef, input.stageId, input.attemptRef]) {
        if (!SAFE_REF.test(ref) || ref.includes('..')) throw new ExecutionAdapterError('canonical result identity is invalid');
      }
      if (!validCanonicalCardRef(input.operationKey, input.runRef, input.stageId, input.canonicalCardRef)) {
        throw new ExecutionAdapterError('canonical result card identity is invalid');
      }
      const reviewOutcome = validatedReviewOutcome(input.reviewOutcome, input.reviewContract);
      const result: CanonicalStageResultPayload & { resultHash: string } = {
        summary: input.summary,
        artifacts: normalizedArtifacts(input.artifacts),
        changed: normalizedArtifacts(input.changed),
        checkpoints: normalizedCheckpoints(input.checkpoints),
        ...(reviewOutcome ? { reviewOutcome } : {}),
        resultHash: input.resultHash,
      };
      const computed = canonicalStageResultHash({
        summary: result.summary,
        artifacts: result.artifacts,
        changed: result.changed,
        checkpoints: result.checkpoints,
        ...(result.reviewOutcome ? { reviewOutcome: result.reviewOutcome } : {}),
      });
      if (computed !== input.resultHash) throw new ExecutionAdapterError('canonical result hash does not match its payload');
      const normalizedInput = {
        operationKey: input.operationKey,
        subject: input.subject,
        runRef: input.runRef,
        stageRef: input.stageRef,
        stageId: input.stageId,
        attemptRef: input.attemptRef,
        canonicalCardRef: input.canonicalCardRef,
        reviewContract: reviewOutcome ? clone(input.reviewContract as ReviewContract) : null,
        result,
      };
      const fingerprint = digest(normalizedInput);
      const { reviewContract: _reviewContract, ...legacyNormalizedInput } = normalizedInput;
      const legacyFingerprint = digest(legacyNormalizedInput);
      return document.mutate((state) => {
        const byOperation = state.results.find((item) => item.operationKey === input.operationKey);
        if (byOperation) {
          const expectedFingerprint = Object.prototype.hasOwnProperty.call(byOperation, 'reviewContract')
            ? fingerprint
            : legacyFingerprint;
          if (byOperation.fingerprint !== expectedFingerprint || byOperation.result.resultHash !== input.resultHash) {
            throw new ExecutionAdapterError('canonical result replay differs from the committed payload');
          }
          return { status: 'replayed' as const, resultHash: byOperation.result.resultHash, durability: 'inactive' as const };
        }
        state.results.push({ ...normalizedInput, fingerprint, integratedAt: now().toISOString() });
        state.revision += 1;
        return { status: 'integrated' as const, resultHash: input.resultHash, durability: 'inactive' as const };
      });
    },
  };
}

/** Closed deterministic resolver; it can only return exact ids from the server-owned curated set. */
export function createCuratedSkillResolver(curatedSkills: ReadonlySet<string>): SkillResolver {
  const admitted = new Set(curatedSkills);
  return {
    async resolve(input: { operationKey: string; profile: ExecutionProfile; requested: readonly string[] }) {
      requireOperationKey(input.operationKey);
      if (input.profile.role !== 'worker') return { ok: false as const, reason: 'skills may only be resolved for a worker profile' };
      if (new Set(input.requested).size !== input.requested.length) return { ok: false as const, reason: 'requested skills contain duplicates' };
      const unknown = input.requested.find((skill) => !SAFE_REF.test(skill) || !admitted.has(skill));
      if (unknown) return { ok: false as const, reason: `skill is not curated: ${unknown}` };
      return { ok: true as const, skills: [...input.requested] };
    },
  };
}

export interface InactiveExecutionAdaptersOptions {
  repoRoot: string;
  worktreeRoot: string;
  stateRoot: string;
  baseCommit: string;
  accountingWindowId: string;
  maxConcurrency: number;
  globalBudget: ExecutionBudget;
  curatedSkills: ReadonlySet<string>;
  gitRunner?: GitCommandRunner;
}

/**
 * Concrete inactive adapters for AutomaticExecutionEngine. Deliberately returns no Manager or Worker
 * process adapter and only an app-local result receipt store, so constructing this bundle cannot
 * activate either runtime or release canonical dependencies before the broker gate.
 */
export function createInactiveExecutionAdapters(options: InactiveExecutionAdaptersOptions): {
  worktrees: WorktreeAdapter;
  skills: SkillResolver;
  accounting: AccountingAdapter;
  results: ResultIntegrator;
} {
  return {
    worktrees: createGitWorktreeAdapter({
      repoRoot: options.repoRoot,
      worktreeRoot: options.worktreeRoot,
      baseCommit: options.baseCommit,
      runner: options.gitRunner,
    }),
    skills: createCuratedSkillResolver(options.curatedSkills),
    accounting: createFileAccountingAdapter({
      stateRoot: options.stateRoot,
      windowId: options.accountingWindowId,
      maxConcurrency: options.maxConcurrency,
      globalBudget: options.globalBudget,
    }),
    results: createFileResultIntegrator({ stateRoot: options.stateRoot }),
  };
}

/**
 * P4 §3.2 — durable path manifest construction and worktree preparation.
 *
 * This module builds the closed `DurablePathManifest` for every purpose and prepares the dedicated
 * worktree the two new PR purposes need. Per the §3.2 capability table [P4-C21] it is NOT
 * publish-capable: its permitted git subcommands are exactly `worktree add` and `checkout`, enforced
 * structurally by the guard below, and every injected runner call passes through that guard. Only
 * `write/branch.ts#routeDurable` may write history or reach the `gh` floor in `write/asyncGit.ts`.
 *
 * The head branch of a new PR purpose is DERIVED from the operation key, never accepted from a
 * caller: `dv3-p4/<purpose>-<first 16 hex of sha256(operationKey)>`.
 */
import {
  ContractDecodeError,
  DURABLE_PATH_MANIFEST_SCHEMA,
  assertSortedUniqueRelpaths,
  decodeDurablePathManifest,
  derivedDurableBranch,
  isCommitSha,
  learningImplementationOperationKey,
  learningProposalOperationKey,
  learningRecordRetireOperationKey,
  purposeMode,
  scheduleMirrorOperationKey,
  type DurablePathManifest,
} from './durableManifest.ts';
import { isAbsolute, relative, resolve } from 'node:path';
import { resolveDashboardStateRoot } from '../composer/store.ts';
import type { GitRunner } from './branch.ts';

/** The complete permitted subcommand set for this file [P4-C21]. */
export const SERVICE_PERMITTED_SUBCOMMANDS: readonly string[] = ['worktree', 'checkout'];
/** `worktree` is permitted only in its non-destructive `add` form. */
const PERMITTED_WORKTREE_VERBS: readonly string[] = ['add'];

/** Thrown when this module is asked for a capability the §3.2 table does not grant it. */
export class ServiceCapabilityError extends Error {
  constructor(detail: string) {
    super(`durableManifestService refuses: ${detail}`);
    this.name = 'ServiceCapabilityError';
  }
}

function manifest(
  operationKey: string,
  purpose: DurablePathManifest['purpose'],
  baseCommit: string,
  relpaths: readonly string[],
): DurablePathManifest {
  if (!isCommitSha(baseCommit)) throw new ContractDecodeError('baseCommit', '40 lowercase hex required');
  const sorted = [...new Set(relpaths)].sort();
  assertSortedUniqueRelpaths(sorted);
  return decodeDurablePathManifest({
    schema: DURABLE_PATH_MANIFEST_SCHEMA, operationKey, purpose, baseCommit, relpaths: sorted,
  });
}

export function buildGovernedSaveManifest(input: {
  operationKey: string; baseCommit: string; relpaths: readonly string[];
}): DurablePathManifest {
  return manifest(`governed-save:${input.operationKey}`, 'governed-save', input.baseCommit, input.relpaths);
}

export function buildWorkflowAmendmentManifest(input: {
  operationKey: string; baseCommit: string; relpaths: readonly string[];
}): DurablePathManifest {
  return manifest(`workflow-amendment:${input.operationKey}`, 'workflow-amendment', input.baseCommit, input.relpaths);
}

export function buildLearningProposalManifest(input: {
  sourceAgent: string; sourceRun: string; baseCommit: string; recordPaths: readonly string[];
}): DurablePathManifest {
  return manifest(
    learningProposalOperationKey(input.sourceAgent, input.sourceRun),
    'learning-proposal',
    input.baseCommit,
    input.recordPaths,
  );
}

/** The batch shape the Implementer hands to the publisher: validated targets plus batch records. */
export interface LearningBatchManifestInput {
  readonly batchId: string;
  readonly baseCommit: string;
  readonly implementedAt: string;
  readonly targetPaths: readonly string[];
  readonly recordPaths: readonly string[];
}

export function buildLearningImplementationManifest(batch: LearningBatchManifestInput): DurablePathManifest {
  return manifest(
    learningImplementationOperationKey(batch.batchId),
    'learning-implementation',
    batch.baseCommit,
    [...batch.targetPaths, ...batch.recordPaths],
  );
}

/**
 * The retire manifest exists ONLY against a proven merge: `merged` is a literal `true` in the type
 * and re-checked at runtime, and the proven merge commit is part of the operation key.
 */
export function buildLearningRecordRetireManifest(
  batch: LearningBatchManifestInput & { mergeCommit: string; merged: true },
): DurablePathManifest {
  if (!isCommitSha(batch.mergeCommit)) throw new ContractDecodeError('mergeCommit', '40 lowercase hex required');
  if (batch.merged !== true) {
    throw new ServiceCapabilityError('a record retire requires a proven merge of its batch PR');
  }
  return manifest(
    learningRecordRetireOperationKey(batch.batchId, batch.mergeCommit),
    'learning-record-retire',
    batch.baseCommit,
    batch.recordPaths,
  );
}

export function buildScheduleMirrorManifest(input: {
  batchId: string; baseCommit: string; paths: readonly string[];
}): DurablePathManifest {
  return manifest(scheduleMirrorOperationKey(input.batchId), 'schedule-mirror', input.baseCommit, input.paths);
}

export interface PreparedWorktree {
  readonly branch: string;
  readonly path: string;
  /** The guarded runner this preparation used — exposed so a caller cannot obtain a wider one here. */
  readonly runGuarded: (args: readonly string[]) => Promise<string>;
}

/**
 * `worktreePath` reaches `git worktree add` as an argv token, so it is validated before anything runs:
 * absolute, normalized, not option-like (`-`/`--` would be parsed as a flag, never as a path), and
 * strictly inside the dashboard state root — a relative or repo-internal path would let a caller point
 * the publication worktree at the coordination checkout itself.
 */
export function assertWorktreePath(worktreePath: string, worktreeRoot = resolveDashboardStateRoot()): void {
  if (typeof worktreePath !== 'string' || worktreePath.trim().length === 0) {
    throw new ServiceCapabilityError('worktree path must be a non-empty string');
  }
  if (worktreePath.startsWith('-')) {
    throw new ServiceCapabilityError(`worktree path may not look like an option: ${JSON.stringify(worktreePath)}`);
  }
  if (!isAbsolute(worktreePath)) {
    throw new ServiceCapabilityError(`worktree path must be absolute: ${JSON.stringify(worktreePath)}`);
  }
  const root = resolve(worktreeRoot);
  const inside = relative(root, resolve(worktreePath));
  if (inside.length === 0 || inside.startsWith('..') || isAbsolute(inside)) {
    throw new ServiceCapabilityError(`worktree path escapes the state root: ${JSON.stringify(worktreePath)}`);
  }
}

/** Wrap an injected runner so only the permitted subcommands of this file can ever be issued. */
function guard(runGit: GitRunner, repoRootFor: (args: readonly string[]) => string) {
  return async (args: readonly string[]): Promise<string> => {
    const subcommand = args[0] ?? '';
    if (!SERVICE_PERMITTED_SUBCOMMANDS.includes(subcommand)) {
      throw new ServiceCapabilityError(`subcommand '${subcommand}' is outside its permitted table`);
    }
    if (subcommand === 'worktree' && !PERMITTED_WORKTREE_VERBS.includes(args[1] ?? '')) {
      throw new ServiceCapabilityError(`worktree '${args[1] ?? ''}' is outside its permitted table`);
    }
    return runGit(repoRootFor(args), [...args]);
  };
}

/**
 * Prepare the dedicated worktree for a PR-purpose manifest at its exact base commit and derive its
 * head branch. Coordination purposes derive no branch and open no worktree — they reuse the existing
 * `prepareCoordination`/`commitPreparedCoordination` path on `ops` [P4-C41].
 */
export async function prepareDurableWorktree(input: {
  repoRoot: string;
  manifest: DurablePathManifest;
  /** Absolute, inside {@link DurableWorktreeRoot}, never option-like — it reaches `git worktree add` argv. */
  worktreePath: string;
  runGit: GitRunner;
  /** The state root the worktree must live under; defaults to the caller's own repo-external root. */
  worktreeRoot?: string;
}): Promise<PreparedWorktree> {
  assertWorktreePath(input.worktreePath, input.worktreeRoot);
  if (purposeMode(input.manifest.purpose) === 'coordination') {
    throw new ServiceCapabilityError(`purpose ${input.manifest.purpose} publishes on ops and prepares no worktree`);
  }
  const branch = derivedDurableBranch(input.manifest);
  if (branch === null) throw new ServiceCapabilityError('no derived branch for this manifest');

  let inWorktree = false;
  const runGuarded = guard(input.runGit, () => (inWorktree ? input.worktreePath : input.repoRoot));
  await runGuarded(['worktree', 'add', '--no-checkout', input.worktreePath, input.manifest.baseCommit]);
  inWorktree = true;
  await runGuarded(['checkout', '-b', branch, input.manifest.baseCommit]);
  return { branch, path: input.worktreePath, runGuarded };
}

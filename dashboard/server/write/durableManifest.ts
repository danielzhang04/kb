// P4 §3.2 closed contracts: the durable path manifest, its purpose/mode/path rules, and the closed
// `routeDurable` receipt union [P4-C13, P4-C21, P4-C30, P4-C32]. Types and strict decoders ONLY —
// W0 adds no publisher, no worktree preparation, and no git capability here. W2 extends
// `write/branch.ts#routeDurable` in place to consume these types.
import { createHash } from 'node:crypto';
import type { AsyncPrResult } from './asyncGit.ts';

export const DURABLE_PATH_MANIFEST_SCHEMA = 'kb.durable-path-manifest/v1';
export const MAX_MANIFEST_RELPATHS = 32;
export const MAX_MANIFEST_RELPATH_BYTES = 240;
export const OPS_BRANCH = 'ops';
export const LEARNING_RECORD_PREFIX = 'docs/proposals/learnings/';
export const DURABLE_BRANCH_PREFIX = 'dv3-p4/';

/** The six closed purposes of the one durable publisher (§3.2 purpose table). */
export type DurableManifestPurpose =
  | 'governed-save'
  | 'workflow-amendment'
  | 'learning-proposal'
  | 'learning-implementation'
  | 'learning-record-retire'
  | 'schedule-mirror';

export const DURABLE_MANIFEST_PURPOSES: readonly DurableManifestPurpose[] = [
  'governed-save', 'workflow-amendment', 'learning-proposal', 'learning-implementation',
  'learning-record-retire', 'schedule-mirror',
];

/** Publication mode. Coordination mode is the constitution's `ops` direct-push path [P4-C13]. */
export type DurableManifestMode = 'pr' | 'coordination';

/** The two coordination-mode purposes: no PR, no derived branch, no worktree [P4-C41]. */
export const COORDINATION_PURPOSES: readonly DurableManifestPurpose[] = ['learning-proposal', 'learning-record-retire'];

export interface DurablePathManifest {
  readonly schema: typeof DURABLE_PATH_MANIFEST_SCHEMA;
  readonly operationKey: string;
  readonly purpose: DurableManifestPurpose;
  /** 40 lowercase hex. */
  readonly baseCommit: string;
  /** Sorted, unique, 1..32 repository-relative paths. */
  readonly relpaths: readonly string[];
}

/**
 * The pinned PR receipt of §3.2: `AsyncPrResult` "becomes required pinned `{owner,repo,number,url}`".
 * W0 does not own `write/asyncGit.ts`, so the required shape is declared here and W2 widens
 * `AsyncPrResult` additively / W6.1 makes the fields required [P4-C16, P4-C32]. The compile-time
 * assertion below keeps this type assignable to the current `AsyncPrResult` so the widening is a
 * narrowing of optionality and never a divergent shape.
 */
export interface PinnedAsyncPrResult {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
}
const _pinnedIsAsyncPrResult: (value: PinnedAsyncPrResult) => AsyncPrResult = (value) => value;
void _pinnedIsAsyncPrResult;

/** Closed receipt union so a caller cannot read a PR field off a coordination push [P4-C32]. */
export type RouteDurableReceipt =
  | { readonly mode: 'pr'; readonly branch: string; readonly pr: PinnedAsyncPrResult }
  | { readonly mode: 'coordination'; readonly branch: typeof OPS_BRANCH; readonly commit: string };

export class ContractDecodeError extends Error {
  readonly field: string;
  constructor(field: string, detail: string) {
    super(`${field}: ${detail}`);
    this.name = 'ContractDecodeError';
    this.field = field;
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && HEX40.test(value);
}
export function isDigestSha256(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}

export function purposeMode(purpose: DurableManifestPurpose): DurableManifestMode {
  return COORDINATION_PURPOSES.includes(purpose) ? 'coordination' : 'pr';
}

/** Producers publish in coordination mode and therefore require no `durablePrWrites` [P4-C13]. */
export function purposeRequiresDurablePrWrites(purpose: DurableManifestPurpose): boolean {
  return purposeMode(purpose) === 'pr';
}

export function learningProposalOperationKey(sourceAgent: string, sourceRun: string): string {
  return `learning-proposal:${sourceAgent}:${sourceRun}`;
}
export function learningImplementationOperationKey(batchId: string): string {
  return `learning-implementation:${batchId}`;
}
export function learningRecordRetireOperationKey(batchId: string, mergeCommit: string): string {
  return `learning-record-retire:${batchId}:${mergeCommit}`;
}
export function scheduleMirrorOperationKey(batchId: string): string {
  return `schedule-mirror:${batchId}`;
}

/** `dv3-p4/<purpose>-<first 16 hex of sha256(operationKey)>`; coordination purposes derive none. */
export function derivedDurableBranch(manifest: DurablePathManifest): string | null {
  if (purposeMode(manifest.purpose) === 'coordination') return null;
  return `${DURABLE_BRANCH_PREFIX}${manifest.purpose}-${sha256Hex(manifest.operationKey).slice(0, 16)}`;
}

/**
 * `batch-id = learn-<first 24 hex of sha256(baseCommit + "\0" + sorted record ids)>`. `batch-id` is
 * `null` in every record when ids are computed and is excluded from this input [P4-C30].
 */
export function learningBatchId(baseCommit: string, recordIds: readonly string[]): string {
  if (!isCommitSha(baseCommit)) throw new ContractDecodeError('baseCommit', '40 lowercase hex required');
  const sorted = [...recordIds].sort();
  return `learn-${sha256Hex(`${baseCommit}\u0000${sorted.join('\u0000')}`).slice(0, 24)}`;
}

const RELPATH_REJECT = /^[/\\]|^[A-Za-z]:|(?:^|\/)\.\.?(?:\/|$)|\\/;

/** Structural path wall applied before any purpose rule: no absolute/drive/UNC/dot/control paths. */
export function isStructuralRelpath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (Buffer.byteLength(value, 'utf8') > MAX_MANIFEST_RELPATH_BYTES) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return !RELPATH_REJECT.test(value);
}

export function isLearningRecordPath(relpath: string): boolean {
  return relpath.startsWith(LEARNING_RECORD_PREFIX)
    && relpath.slice(LEARNING_RECORD_PREFIX.length).length > 0
    && !relpath.slice(LEARNING_RECORD_PREFIX.length).includes('/')
    && relpath.endsWith('.md');
}

/** The Implementer TARGET wall — unchanged by P4-C13: exactly these two shapes [P4-C22]. */
const IMPLEMENTER_TARGET = /^(?:agents|routines\/roles)\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
export function isImplementerTargetPath(relpath: string): boolean {
  return isStructuralRelpath(relpath) && IMPLEMENTER_TARGET.test(relpath);
}

export function isMirrorPath(relpath: string): boolean {
  return relpath === 'HEARTBEAT.md' || /^orgs\/[A-Za-z0-9][A-Za-z0-9._-]*\/HEARTBEAT\.md$/.test(relpath);
}

/**
 * Per-purpose staged-path rule (§3.2). `learning-implementation` permits `docs/proposals/learnings/**`
 * alongside its validated targets [P4-C13]; the two coordination purposes permit records only.
 * `governed-save`/`workflow-amendment` keep their existing classifier wall, which is not restated here.
 */
export function purposePermitsPath(purpose: DurableManifestPurpose, relpath: string): boolean {
  if (!isStructuralRelpath(relpath)) return false;
  switch (purpose) {
    case 'learning-proposal':
    case 'learning-record-retire':
      return isLearningRecordPath(relpath);
    case 'learning-implementation':
      return isLearningRecordPath(relpath) || isImplementerTargetPath(relpath);
    case 'schedule-mirror':
      return isMirrorPath(relpath);
    case 'governed-save':
    case 'workflow-amendment':
      return true;
  }
}

/**
 * Compile-negative helper for the thirty-third manifest path. A literal list longer than
 * `MAX_MANIFEST_RELPATHS` resolves to `never` and cannot be passed.
 */
type RelpathCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16
  | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32;
export type BoundedRelpaths<T extends readonly string[]> = T['length'] extends RelpathCount ? T : never;
export function manifestRelpaths<const T extends readonly string[]>(relpaths: T & BoundedRelpaths<T>): readonly string[] {
  const list = relpaths as readonly string[];
  return assertSortedUniqueRelpaths(list);
}

export function assertSortedUniqueRelpaths(relpaths: readonly string[]): readonly string[] {
  if (relpaths.length < 1) throw new ContractDecodeError('relpaths', 'at least one path required');
  if (relpaths.length > MAX_MANIFEST_RELPATHS) {
    throw new ContractDecodeError('relpaths', `at most ${MAX_MANIFEST_RELPATHS} paths, got ${relpaths.length}`);
  }
  const seen = new Set<string>();
  for (let index = 0; index < relpaths.length; index += 1) {
    const relpath = relpaths[index]!;
    if (!isStructuralRelpath(relpath)) throw new ContractDecodeError('relpaths', `rejected path ${JSON.stringify(relpath)}`);
    const folded = relpath.toLowerCase();
    if (seen.has(folded)) throw new ContractDecodeError('relpaths', `case-fold duplicate ${JSON.stringify(relpath)}`);
    seen.add(folded);
    if (index > 0 && relpaths[index - 1]! >= relpath) throw new ContractDecodeError('relpaths', 'paths must be sorted');
  }
  return relpaths;
}

const MANIFEST_KEYS = ['schema', 'operationKey', 'purpose', 'baseCommit', 'relpaths'] as const;

export function closedObject(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractDecodeError(field, 'object required');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new ContractDecodeError(field, `unknown key ${JSON.stringify(key)}`);
  }
  return record;
}

export function requireString(record: Record<string, unknown>, key: string, field: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new ContractDecodeError(`${field}.${key}`, 'non-empty string required');
  return value;
}

export function decodeDurablePathManifest(value: unknown): DurablePathManifest {
  const record = closedObject(value, MANIFEST_KEYS, 'manifest');
  if (record['schema'] !== DURABLE_PATH_MANIFEST_SCHEMA) {
    throw new ContractDecodeError('manifest.schema', `expected ${DURABLE_PATH_MANIFEST_SCHEMA}`);
  }
  const operationKey = requireString(record, 'operationKey', 'manifest');
  const purpose = record['purpose'];
  if (typeof purpose !== 'string' || !DURABLE_MANIFEST_PURPOSES.includes(purpose as DurableManifestPurpose)) {
    throw new ContractDecodeError('manifest.purpose', 'closed purpose required');
  }
  const baseCommit = record['baseCommit'];
  if (!isCommitSha(baseCommit)) throw new ContractDecodeError('manifest.baseCommit', '40 lowercase hex required');
  const relpaths = record['relpaths'];
  if (!Array.isArray(relpaths) || !relpaths.every((entry): entry is string => typeof entry === 'string')) {
    throw new ContractDecodeError('manifest.relpaths', 'string array required');
  }
  assertSortedUniqueRelpaths(relpaths);
  const typedPurpose = purpose as DurableManifestPurpose;
  for (const relpath of relpaths) {
    if (!purposePermitsPath(typedPurpose, relpath)) {
      throw new ContractDecodeError('manifest.relpaths', `purpose ${typedPurpose} rejects ${JSON.stringify(relpath)}`);
    }
  }
  return { schema: DURABLE_PATH_MANIFEST_SCHEMA, operationKey, purpose: typedPurpose, baseCommit, relpaths };
}

const PR_RECEIPT_KEYS = ['mode', 'branch', 'pr'] as const;
const COORDINATION_RECEIPT_KEYS = ['mode', 'branch', 'commit'] as const;
const PINNED_PR_KEYS = ['owner', 'repo', 'number', 'url'] as const;

export function decodePinnedAsyncPrResult(value: unknown): PinnedAsyncPrResult {
  const record = closedObject(value, PINNED_PR_KEYS, 'pr');
  const owner = requireString(record, 'owner', 'pr');
  const repo = requireString(record, 'repo', 'pr');
  const url = requireString(record, 'url', 'pr');
  const number = record['number'];
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
    throw new ContractDecodeError('pr.number', 'positive integer required');
  }
  return { owner, repo, number, url };
}

export function decodeRouteDurableReceipt(value: unknown): RouteDurableReceipt {
  if (value === null || typeof value !== 'object') throw new ContractDecodeError('receipt', 'object required');
  const mode = (value as Record<string, unknown>)['mode'];
  if (mode === 'pr') {
    const record = closedObject(value, PR_RECEIPT_KEYS, 'receipt');
    return { mode: 'pr', branch: requireString(record, 'branch', 'receipt'), pr: decodePinnedAsyncPrResult(record['pr']) };
  }
  if (mode === 'coordination') {
    const record = closedObject(value, COORDINATION_RECEIPT_KEYS, 'receipt');
    if (record['branch'] !== OPS_BRANCH) throw new ContractDecodeError('receipt.branch', `coordination mode publishes to ${OPS_BRANCH}`);
    const commit = record['commit'];
    if (!isCommitSha(commit)) throw new ContractDecodeError('receipt.commit', '40 lowercase hex required');
    return { mode: 'coordination', branch: OPS_BRANCH, commit };
  }
  throw new ContractDecodeError('receipt.mode', "closed union 'pr' | 'coordination'");
}

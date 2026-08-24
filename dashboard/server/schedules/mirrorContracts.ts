// P4 section 3.5 closed contracts: the schedule mirror watermark and batch record. Types, the batch-id
// formula, and strict decoders ONLY — W0 adds no store field, no mutation hook, no renderer, and no
// publisher call. W5 adds `scheduleMirrorRevision`/`lastMirrorRevision` as ADDITIVE control-store
// document fields with no version bump [P4-C37]; these contracts are the shape it writes.
import {
  ContractDecodeError, closedObject, isDigestSha256, isMirrorPath, MAX_MANIFEST_RELPATHS,
  requireString, scheduleMirrorOperationKey, sha256Hex,
} from '../write/durableManifest.ts';

export const SCHEDULE_MIRROR_BATCH_SCHEMA = 'kb.schedule-mirror-batch/v1';
/** A batch of more than 32 changed files rejects, matching the manifest cap. */
export const MAX_SCHEDULE_MIRROR_PATHS = MAX_MANIFEST_RELPATHS;

/** A full canonical snapshot of all mirror rows. `revision` is the store-owned counter. */
export interface ScheduleMirrorWatermark {
  readonly revision: number;
  readonly digest: string;
}

export interface ScheduleMirrorPathDigest {
  readonly path: string;
  readonly digest: string;
}

export type ScheduleMirrorBatchState = 'prepared' | 'pr-open' | 'merged' | 'failed';
export const SCHEDULE_MIRROR_BATCH_STATES: readonly ScheduleMirrorBatchState[] = [
  'prepared', 'pr-open', 'merged', 'failed',
];

export interface ScheduleMirrorBatchPr {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface ScheduleMirrorBatch {
  readonly schema: typeof SCHEDULE_MIRROR_BATCH_SCHEMA;
  readonly id: string;
  readonly baseWatermark: ScheduleMirrorWatermark;
  readonly targetWatermark: ScheduleMirrorWatermark;
  readonly paths: readonly ScheduleMirrorPathDigest[];
  readonly state: ScheduleMirrorBatchState;
  readonly operationKey: string;
  readonly pr?: ScheduleMirrorBatchPr;
  readonly createdAt: string;
  readonly mergedAt?: string;
}

/** `id = sha256('schedule-mirror\u0000' + revision + '\u0000' + digest)`. */
export function scheduleMirrorBatchId(watermark: ScheduleMirrorWatermark): string {
  assertWatermark(watermark, 'targetWatermark');
  return sha256Hex(`schedule-mirror\u0000${watermark.revision}\u0000${watermark.digest}`);
}

/** A byte-identical current watermark is a no-op receipt and opens no PR. */
export function isWatermarkUnchanged(base: ScheduleMirrorWatermark, target: ScheduleMirrorWatermark): boolean {
  return base.revision === target.revision && base.digest === target.digest;
}

/**
 * `mirror-merged` CAS-updates only rows whose `lastMirrorRevision <= target.revision`; later
 * mutations advance the store watermark but never amend the open batch.
 */
export function isRowCoveredByMirror(lastMirrorRevision: number, target: ScheduleMirrorWatermark): boolean {
  return lastMirrorRevision <= target.revision;
}

function assertWatermark(value: ScheduleMirrorWatermark, field: string): ScheduleMirrorWatermark {
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    throw new ContractDecodeError(`${field}.revision`, 'non-negative integer required');
  }
  if (!isDigestSha256(value.digest)) throw new ContractDecodeError(`${field}.digest`, 'sha256 hex required');
  return value;
}

export function decodeScheduleMirrorWatermark(value: unknown, field = 'watermark'): ScheduleMirrorWatermark {
  const record = closedObject(value, ['revision', 'digest'], field);
  const revision = record['revision'];
  if (typeof revision !== 'number') throw new ContractDecodeError(`${field}.revision`, 'number required');
  const digest = record['digest'];
  if (typeof digest !== 'string') throw new ContractDecodeError(`${field}.digest`, 'string required');
  return assertWatermark({ revision, digest }, field);
}

const BATCH_KEYS = [
  'schema', 'id', 'baseWatermark', 'targetWatermark', 'paths', 'state', 'operationKey', 'pr',
  'createdAt', 'mergedAt',
] as const;

function decodePaths(value: unknown): readonly ScheduleMirrorPathDigest[] {
  if (!Array.isArray(value) || value.length < 1) throw new ContractDecodeError('batch.paths', 'at least one path required');
  if (value.length > MAX_SCHEDULE_MIRROR_PATHS) {
    throw new ContractDecodeError('batch.paths', `at most ${MAX_SCHEDULE_MIRROR_PATHS} paths`);
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const record = closedObject(entry, ['path', 'digest'], 'batch.paths');
    const path = requireString(record, 'path', 'batch.paths');
    if (!isMirrorPath(path)) throw new ContractDecodeError('batch.paths.path', 'HEARTBEAT.md or orgs/<slug>/HEARTBEAT.md');
    if (seen.has(path)) throw new ContractDecodeError('batch.paths.path', `duplicate ${path}`);
    seen.add(path);
    const digest = record['digest'];
    if (!isDigestSha256(digest)) throw new ContractDecodeError('batch.paths.digest', 'sha256 hex required');
    return { path, digest };
  });
}

export function decodeScheduleMirrorBatch(value: unknown): ScheduleMirrorBatch {
  const record = closedObject(value, BATCH_KEYS, 'batch');
  if (record['schema'] !== SCHEDULE_MIRROR_BATCH_SCHEMA) {
    throw new ContractDecodeError('batch.schema', `expected ${SCHEDULE_MIRROR_BATCH_SCHEMA}`);
  }
  const state = record['state'];
  if (typeof state !== 'string' || !SCHEDULE_MIRROR_BATCH_STATES.includes(state as ScheduleMirrorBatchState)) {
    throw new ContractDecodeError('batch.state', 'closed batch state required');
  }
  const baseWatermark = decodeScheduleMirrorWatermark(record['baseWatermark'], 'batch.baseWatermark');
  const targetWatermark = decodeScheduleMirrorWatermark(record['targetWatermark'], 'batch.targetWatermark');
  if (targetWatermark.revision < baseWatermark.revision) {
    throw new ContractDecodeError('batch.targetWatermark', 'target revision cannot precede the base revision');
  }
  const id = requireString(record, 'id', 'batch');
  if (id !== scheduleMirrorBatchId(targetWatermark)) {
    throw new ContractDecodeError('batch.id', 'id must be the target-watermark hash');
  }
  const operationKey = requireString(record, 'operationKey', 'batch');
  if (operationKey !== scheduleMirrorOperationKey(id)) {
    throw new ContractDecodeError('batch.operationKey', `expected ${scheduleMirrorOperationKey(id)}`);
  }
  const typedState = state as ScheduleMirrorBatchState;
  let pr: ScheduleMirrorBatchPr | undefined;
  if (record['pr'] !== undefined) {
    const prRecord = closedObject(record['pr'], ['owner', 'repo', 'number'], 'batch.pr');
    const number = prRecord['number'];
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
      throw new ContractDecodeError('batch.pr.number', 'positive integer required');
    }
    pr = { owner: requireString(prRecord, 'owner', 'batch.pr'), repo: requireString(prRecord, 'repo', 'batch.pr'), number };
  }
  const mergedAt = record['mergedAt'] === undefined ? undefined : requireString(record, 'mergedAt', 'batch');
  if (typedState === 'merged' && (pr === undefined || mergedAt === undefined)) {
    throw new ContractDecodeError('batch.state', 'a merged batch carries its pr and mergedAt');
  }
  if (typedState === 'prepared' && pr !== undefined) {
    throw new ContractDecodeError('batch.state', 'a prepared batch has opened no PR');
  }
  return {
    schema: SCHEDULE_MIRROR_BATCH_SCHEMA, id, baseWatermark, targetWatermark,
    paths: decodePaths(record['paths']), state: typedState, operationKey,
    ...(pr === undefined ? {} : { pr }),
    createdAt: requireString(record, 'createdAt', 'batch'),
    ...(mergedAt === undefined ? {} : { mergedAt }),
  };
}

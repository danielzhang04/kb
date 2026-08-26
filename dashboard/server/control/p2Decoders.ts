import type { HostKind, RunIdentityFields, RunnableRef } from './p2Contracts.ts';
import { RUN_LIFECYCLE_KINDS } from './runLifecycle.ts';
import type { Run } from './types.ts';
import type { StoredRun } from './store.ts';
import { record, exactKeys } from '../shared/decode.ts';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OUTCOMES = new Set(['ok', 'failed', 'stopped', 'interrupted', 'abandoned']);
const ARCHIVED_FROM = new Set(['succeeded', 'failed', 'stopped', 'interrupted', 'waiting-human']);
const PUBLICATION_STATES = new Set(['pending', 'waiting-human', 'publishing', 'published', 'reconcile-required']);
const RUN_KEYS = [
  'owner', 'executionHost', 'terminalOutcome', 'completedAt', 'archivedFrom',
  'runRef', 'predecessorRunRef', 'title', 'proposalRef', 'proposalRevision', 'proposalHash',
  'publicationState', 'lifecycle', 'version', 'managerSessionRef', 'managerGeneration',
  'managerAssignment', 'agentWorkspaceLaunch', 'createdAt', 'updatedAt',
] as const;
const STORED_RUN_REQUIRED_KEYS = [...RUN_KEYS, 'subject'] as const;
const STORED_RUN_OPTIONAL_KEYS = [
  'launchOperationKey', 'launchOperationFingerprint', 'archiveOperationKey', 'archiveOperationFingerprint',
  'activationReceipts', 'authorizedFailedRunReconciliation',
] as const;
const HASH = /^[a-f0-9]{64}$/;


function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function isoOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value);
}

function iso(value: unknown): value is string {
  return typeof value === 'string' && isoOrNull(value);
}

function nullableSafeId(value: unknown): value is string | null {
  return value === null || safeId(value);
}

function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\0'));
}

function nullableHash(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && HASH.test(value));
}

function decodeAssignment(value: unknown): unknown | null {
  if (value === null) return null;
  const item = record(value);
  if (!item || !exactKeys(item, ['agentId', 'declarationPath', 'declarationHash', 'profileId', 'runtime', 'model'])
    || !safeId(item.agentId) || item.declarationPath !== `agents/${item.agentId}.md`
    || typeof item.declarationHash !== 'string' || !HASH.test(item.declarationHash)
    || typeof item.profileId !== 'string' || item.profileId.length === 0
    || (item.runtime !== 'claude' && item.runtime !== 'codex')
    || typeof item.model !== 'string' || item.model.length === 0) return undefined;
  return item;
}

function decodeWorkspaceLaunch(value: unknown): unknown | null {
  if (value === null) return null;
  const item = record(value);
  if (!item || !exactKeys(item, ['composerRef', 'agentId', 'declarationPath', 'declarationHash'])
    || typeof item.composerRef !== 'string' || item.composerRef.length === 0 || item.composerRef.includes('\0') || !safeId(item.agentId)
    || item.declarationPath !== `agents/${item.agentId}.md`
    || typeof item.declarationHash !== 'string' || !HASH.test(item.declarationHash)) return undefined;
  return item;
}

function validLifecycle(value: unknown): boolean {
  const item = record(value);
  if (!item || !exactKeys(item, ['kind', 'deployPause'])
    || !RUN_LIFECYCLE_KINDS.includes(item.kind as never)) return false;
  if (item.kind !== 'paused-for-deploy') return item.deployPause === null;
  const pause = record(item.deployPause);
  if (!pause || !exactKeys(pause, [
    'deploymentRef', 'pausedAt', 'priorKind', 'resumeStreak', 'lastResumeAttemptCursor', 'resumeClaim',
  ]) || !safeId(pause.deploymentRef) || !iso(pause.pausedAt)
    || pause.priorKind === 'paused-for-deploy' || !RUN_LIFECYCLE_KINDS.includes(pause.priorKind as never)
    || !Number.isSafeInteger(pause.resumeStreak) || Number(pause.resumeStreak) < 0
    || !(pause.lastResumeAttemptCursor === null
      || (Number.isSafeInteger(pause.lastResumeAttemptCursor) && Number(pause.lastResumeAttemptCursor) >= 0))) return false;
  if (pause.resumeClaim === null) return true;
  const claim = record(pause.resumeClaim);
  return !!claim && exactKeys(claim, ['deploymentRef', 'bootId', 'claimantRef'])
    && claim.deploymentRef === pause.deploymentRef
    && typeof claim.bootId === 'string' && claim.bootId.length > 0 && !claim.bootId.includes('\0')
    && typeof claim.claimantRef === 'string' && claim.claimantRef.length > 0 && !claim.claimantRef.includes('\0');
}

function validRunValues(item: Record<string, unknown>): boolean {
  const identity = identityFieldsFromRun(item);
  return !!identity && safeId(item.runRef) && nullableSafeId(item.predecessorRunRef)
    && typeof item.title === 'string' && item.title.length > 0
    && safeId(item.proposalRef) && Number.isSafeInteger(item.proposalRevision) && Number(item.proposalRevision) >= 1
    && typeof item.proposalHash === 'string' && HASH.test(item.proposalHash)
    && PUBLICATION_STATES.has(String(item.publicationState)) && validLifecycle(item.lifecycle)
    && Number.isSafeInteger(item.version) && Number(item.version) >= 1
    && safeId(item.managerSessionRef) && Number.isSafeInteger(item.managerGeneration) && Number(item.managerGeneration) >= 0
    && decodeAssignment(item.managerAssignment) !== undefined
    && decodeWorkspaceLaunch(item.agentWorkspaceLaunch) !== undefined
    && iso(item.createdAt) && iso(item.updatedAt);
}

function validActivationReceipts(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((candidate) => {
    const item = record(candidate);
    return !!item && exactKeys(item, ['idempotencyKey', 'fingerprint', 'phase', 'claimedAt', 'updatedAt'])
      && typeof item.idempotencyKey === 'string' && item.idempotencyKey.length > 0
      && typeof item.fingerprint === 'string' && HASH.test(item.fingerprint)
      && ['claimed', 'roots-activated', 'dispatched', 'failed'].includes(String(item.phase))
      && iso(item.claimedAt) && iso(item.updatedAt);
  });
}

function validFailedReconciliation(value: unknown): boolean {
  if (value === null) return true;
  const item = record(value);
  return !!item && exactKeys(item, [
    'idempotencyKey', 'fingerprint', 'phase', 'claimedAt', 'updatedAt', 'canonicalCommit', 'eventCursor',
  ]) && typeof item.idempotencyKey === 'string' && item.idempotencyKey.length > 0
    && typeof item.fingerprint === 'string' && HASH.test(item.fingerprint)
    && ['claimed', 'committed'].includes(String(item.phase)) && iso(item.claimedAt) && iso(item.updatedAt)
    && (item.canonicalCommit === null || (typeof item.canonicalCommit === 'string' && /^[a-f0-9]{40,64}$/.test(item.canonicalCommit)))
    && (item.eventCursor === null || (Number.isSafeInteger(item.eventCursor) && Number(item.eventCursor) >= 1));
}

export function decodeRunnableRef(value: unknown): RunnableRef | null {
  const item = record(value);
  if (!item || !safeId(item.id)) return null;
  if (item.type === 'agent') {
    if (!exactKeys(item, ['type', 'id', 'sourcePath']) || item.sourcePath !== `agents/${item.id}.md`) return null;
    return { type: 'agent', id: item.id, sourcePath: item.sourcePath as `agents/${string}.md` };
  }
  if (item.type === 'workflow') {
    if (!exactKeys(item, ['type', 'id', 'project', 'sourcePath']) || !safeId(item.project)
      || item.sourcePath !== `orgs/${item.project}/workflows/${item.id}.md`) return null;
    return {
      type: 'workflow', id: item.id, project: item.project,
      sourcePath: item.sourcePath as `orgs/${string}/workflows/${string}.md`,
    };
  }
  return null;
}

export function decodeHostKind(value: unknown): HostKind | null {
  return value === 'vm' || value === 'desktop' ? value : null;
}

export function decodeRunIdentityFields(value: unknown): RunIdentityFields | null {
  const item = record(value);
  if (!item || !exactKeys(item, ['owner', 'executionHost', 'terminalOutcome', 'completedAt', 'archivedFrom'])) return null;
  const owner = decodeRunnableRef(item.owner);
  const executionHost = decodeHostKind(item.executionHost);
  const terminalOutcome = item.terminalOutcome === null || OUTCOMES.has(String(item.terminalOutcome))
    ? item.terminalOutcome as RunIdentityFields['terminalOutcome'] : undefined;
  const archivedFrom = item.archivedFrom === null || ARCHIVED_FROM.has(String(item.archivedFrom))
    ? item.archivedFrom as RunIdentityFields['archivedFrom'] : undefined;
  if (!owner || !executionHost || terminalOutcome === undefined || archivedFrom === undefined || !isoOrNull(item.completedAt)) return null;
  if ((terminalOutcome === null) !== (item.completedAt === null) || (archivedFrom !== null && terminalOutcome === null)) return null;
  return { owner, executionHost, terminalOutcome, completedAt: item.completedAt, archivedFrom };
}

export function identityFieldsFromRun(value: unknown): RunIdentityFields | null {
  const item = record(value);
  if (!item) return null;
  return decodeRunIdentityFields({
    owner: item.owner,
    executionHost: item.executionHost,
    terminalOutcome: item.terminalOutcome,
    completedAt: item.completedAt,
    archivedFrom: item.archivedFrom,
  });
}

/** Closed persisted/internal Run decoder. Unknown top-level keys are never tolerated. */
export function decodeRun(value: unknown): Run | null {
  const item = record(value);
  if (!item || !exactKeys(item, RUN_KEYS) || !validRunValues(item)) return null;
  return structuredClone(item) as unknown as Run;
}

/** Closed StoredRun decoder. Optional persistence receipts may be absent, but no unknown key may exist. */
export function decodeStoredRun(value: unknown): StoredRun | null {
  const item = record(value);
  if (!item) return null;
  const allowed = new Set<string>([...STORED_RUN_REQUIRED_KEYS, ...STORED_RUN_OPTIONAL_KEYS]);
  if (!STORED_RUN_REQUIRED_KEYS.every((key) => Object.hasOwn(item, key))
    || Object.keys(item).some((key) => !allowed.has(key)) || !safeId(item.subject) || !validRunValues(item)) return null;
  for (const key of ['launchOperationKey', 'archiveOperationKey'] as const) {
    if (Object.hasOwn(item, key) && !nullableText(item[key])) return null;
  }
  for (const key of ['launchOperationFingerprint', 'archiveOperationFingerprint'] as const) {
    if (Object.hasOwn(item, key) && !nullableHash(item[key])) return null;
  }
  if (Object.hasOwn(item, 'activationReceipts') && !validActivationReceipts(item.activationReceipts)) return null;
  if (Object.hasOwn(item, 'authorizedFailedRunReconciliation')
    && !validFailedReconciliation(item.authorizedFailedRunReconciliation)) return null;
  return structuredClone(item) as unknown as StoredRun;
}

import type { HostKind, RunIdentityFields, RunnableRef } from './p2Contracts.ts';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OUTCOMES = new Set(['ok', 'failed', 'stopped', 'interrupted', 'abandoned']);
const ARCHIVED_FROM = new Set(['succeeded', 'failed', 'stopped', 'interrupted', 'waiting-human']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function isoOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value);
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

/** Durable, dashboard-owned state for workflow definition amendments. This is deliberately outside
 * the repository: a pending PR is runtime control state, not canonical workflow content. */
import { sha256Hex } from '../shared/hashing.ts';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { renameWithRetrySync } from '../atomicRename.ts';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DEFAULT_WORK_BRANCH } from '../write/branch.ts';

export type AmendmentPhase = 'prepared' | 'committed' | 'pushed' | 'audit-pending' | 'pending-human-merge' | 'audit-failed' | 'settled';
export type DefinitionAmendmentKind = 'assignment' | 'governance'
  | 'agent-builder-create' | 'agent-builder-edit' | 'workflow-builder-create' | 'workflow-builder-edit';

export interface PendingDefinitionAmendment {
  kind: DefinitionAmendmentKind;
  workflowPath: string;
  baseSourceHash: string;
  proposedSourceHash: string;
  branch: string;
  pr: { url?: string; number?: number };
  phase: AmendmentPhase;
  /** Present on builder operations; durable across daemon restarts. */
  idempotencyKey?: string;
  requestFingerprint?: string;
}
export type AmendmentLookup = { ok: true; record: PendingDefinitionAmendment | null } | { ok: false; detail: string };

export interface DefinitionAmendmentStore {
  lookup(workflowPath: string, activeSourceHash: string): AmendmentLookup;
  lookupRequest(entityPath: string, idempotencyKey: string): AmendmentLookup;
  put(record: PendingDefinitionAmendment): void;
  update(record: PendingDefinitionAmendment): void;
  remove(workflowPath: string): void;
}

const WORKFLOW_PATH = /^(?:agents\/[a-z0-9][a-z0-9-]{0,63}\.md|orgs\/[A-Za-z0-9._-]+\/workflows\/[A-Za-z0-9._-]+\.md)$/;
const HASH = /^[a-f0-9]{64}$/;
const PHASES = new Set<AmendmentPhase>(['prepared', 'committed', 'pushed', 'audit-pending', 'pending-human-merge', 'audit-failed', 'settled']);

function isSafePrUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function key(workflowPath: string): string {
  return sha256Hex(workflowPath);
}

function validate(value: unknown, workflowPath: string): PendingDefinitionAmendment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((name) => !['kind', 'workflowPath', 'baseSourceHash', 'proposedSourceHash', 'branch', 'pr', 'phase', 'idempotencyKey', 'requestFingerprint'].includes(name))
    || row.workflowPath !== workflowPath || !HASH.test(String(row.baseSourceHash)) || !HASH.test(String(row.proposedSourceHash))
    || (row.kind !== undefined && !['assignment', 'governance', 'agent-builder-create', 'agent-builder-edit', 'workflow-builder-create', 'workflow-builder-edit'].includes(String(row.kind)))
    || row.branch !== DEFAULT_WORK_BRANCH || !row.pr || typeof row.pr !== 'object' || Array.isArray(row.pr) || !PHASES.has(row.phase as AmendmentPhase)) return null;
  const pr = row.pr as Record<string, unknown>;
  if (Object.keys(pr).some((name) => name !== 'url' && name !== 'number')
    || (pr.url !== undefined && !isSafePrUrl(pr.url)) || (pr.number !== undefined && (!Number.isInteger(pr.number) || (pr.number as number) < 1))) return null;
  const kind = (row.kind ?? 'assignment') as DefinitionAmendmentKind;
  const builder = kind.includes('-builder-');
  if (builder && (typeof row.idempotencyKey !== 'string' || row.idempotencyKey.trim() === '' || !HASH.test(String(row.requestFingerprint)))) return null;
  if (!builder && (row.idempotencyKey !== undefined || row.requestFingerprint !== undefined)) return null;
  return { kind, workflowPath, baseSourceHash: row.baseSourceHash as string, proposedSourceHash: row.proposedSourceHash as string,
    branch: row.branch, pr: { ...(typeof pr.url === 'string' ? { url: pr.url } : {}), ...(typeof pr.number === 'number' ? { number: pr.number } : {}) }, phase: row.phase as AmendmentPhase,
    ...(builder ? { idempotencyKey: row.idempotencyKey as string, requestFingerprint: row.requestFingerprint as string } : {}) };
}

function assertRecord(record: PendingDefinitionAmendment): void {
  if (!WORKFLOW_PATH.test(record.workflowPath) || !validate(record, record.workflowPath)) throw new Error('invalid definition amendment state');
}

export function createInMemoryDefinitionAmendmentStore(): DefinitionAmendmentStore {
  const rows = new Map<string, PendingDefinitionAmendment>();
  return {
    lookup(workflowPath, activeSourceHash) {
      const row = rows.get(workflowPath);
      if (!row) return { ok: true, record: null };
      if (row.phase === 'settled') return { ok: true, record: null };
      if (row.proposedSourceHash === activeSourceHash) { rows.set(workflowPath, { ...row, phase: 'settled' }); return { ok: true, record: null }; }
      return { ok: true, record: { ...row, pr: { ...row.pr } } };
    },
    lookupRequest(entityPath, idempotencyKey) {
      const row = rows.get(entityPath);
      return { ok: true, record: row?.idempotencyKey === idempotencyKey ? { ...row, pr: { ...row.pr } } : null };
    },
    put(record) { assertRecord(record); rows.set(record.workflowPath, { ...record, pr: { ...record.pr } }); },
    update(record) { assertRecord(record); rows.set(record.workflowPath, { ...record, pr: { ...record.pr } }); },
    remove(workflowPath) { rows.delete(workflowPath); },
  };
}

export function createFileDefinitionAmendmentStore(stateRoot: string): DefinitionAmendmentStore {
  const root = resolve(stateRoot);
  const dir = join(root, 'workflows', 'assignment-amendments');
  const pathFor = (workflowPath: string): string => {
    if (!WORKFLOW_PATH.test(workflowPath)) throw new Error('unsafe workflow identity');
    return join(dir, `${key(workflowPath)}.json`);
  };
  const ensureDir = (): void => {
    mkdirSync(root, { recursive: true });
    const actualRoot = realpathSync(root);
    mkdirSync(dir, { recursive: true });
    const actual = realpathSync(dir);
    const rel = relative(actualRoot, actual);
    if (isAbsolute(rel) || rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || lstatSync(dir).isSymbolicLink()) throw new Error('assignment amendment state directory refused');
  };
  const read = (workflowPath: string): PendingDefinitionAmendment | null => {
    ensureDir();
    const path = pathFor(workflowPath);
    if (!existsSync(path)) return null;
    if (lstatSync(path).isSymbolicLink()) throw new Error('assignment amendment state file refused');
    const value = validate(JSON.parse(readFileSync(path, 'utf8')), workflowPath);
    if (!value) throw new Error('assignment amendment state is invalid');
    return value;
  };
  const write = (record: PendingDefinitionAmendment): void => {
    assertRecord(record); ensureDir();
    const path = pathFor(record.workflowPath);
    const temp = join(dirname(path), `.${key(record.workflowPath)}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(temp, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx' });
    try { renameWithRetrySync(temp, path); } catch (error) { try { unlinkSync(temp); } catch { /* preserve original error */ } throw error; }
  };
  return {
    lookup(workflowPath, activeSourceHash) {
      try {
        const row = read(workflowPath);
        if (!row) return { ok: true, record: null };
        if (row.phase === 'settled') return { ok: true, record: null };
        if (row.proposedSourceHash === activeSourceHash) { write({ ...row, phase: 'settled' }); return { ok: true, record: null }; }
        return { ok: true, record: row };
      } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
    },
    lookupRequest(entityPath, idempotencyKey) {
      try {
        const row = read(entityPath);
        return { ok: true, record: row?.idempotencyKey === idempotencyKey ? row : null };
      } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
    },
    put: write,
    update: write,
    remove(workflowPath) { ensureDir(); const path = pathFor(workflowPath); if (existsSync(path)) unlinkSync(path); },
  };
}

/** @deprecated Use DefinitionAmendmentStore. Kept for existing integrations. */
export type PendingAssignmentAmendment = Omit<PendingDefinitionAmendment, 'kind'> & { kind?: 'assignment' };
/** @deprecated Use DefinitionAmendmentStore. Kept for existing integrations. */
export interface AssignmentAmendmentStore extends Omit<DefinitionAmendmentStore, 'put' | 'update'> {
  put(record: PendingDefinitionAmendment | PendingAssignmentAmendment): void;
  update(record: PendingDefinitionAmendment | PendingAssignmentAmendment): void;
}
function normalizeLegacyAssignmentRecord(record: PendingDefinitionAmendment | PendingAssignmentAmendment): PendingDefinitionAmendment {
  return { ...record, kind: record.kind ?? 'assignment' };
}
function legacyAssignmentStore(store: DefinitionAmendmentStore): AssignmentAmendmentStore {
  return {
    lookup: store.lookup,
    lookupRequest: store.lookupRequest,
    put: (record) => store.put(normalizeLegacyAssignmentRecord(record)),
    update: (record) => store.update(normalizeLegacyAssignmentRecord(record)),
    remove: store.remove,
  };
}
/** @deprecated Use createInMemoryDefinitionAmendmentStore. */
export function createInMemoryAssignmentAmendmentStore(): AssignmentAmendmentStore {
  return legacyAssignmentStore(createInMemoryDefinitionAmendmentStore());
}
/** @deprecated Use createFileDefinitionAmendmentStore. */
export function createFileAssignmentAmendmentStore(stateRoot: string): AssignmentAmendmentStore {
  return legacyAssignmentStore(createFileDefinitionAmendmentStore(stateRoot));
}

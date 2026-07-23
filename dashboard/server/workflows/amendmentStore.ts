/** Durable, dashboard-owned state for workflow definition amendments. This is deliberately outside
 * the repository: a pending PR is runtime control state, not canonical workflow content. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DEFAULT_WORK_BRANCH } from '../write/branch.ts';

export type AmendmentPhase = 'prepared' | 'committed' | 'pushed' | 'audit-pending' | 'pending-human-merge' | 'audit-failed' | 'settled';
export type DefinitionAmendmentKind = 'assignment' | 'governance';

export interface PendingDefinitionAmendment {
  /** Missing on disk is accepted as a pre-generalization assignment record. */
  kind?: DefinitionAmendmentKind;
  workflowPath: string;
  baseSourceHash: string;
  proposedSourceHash: string;
  branch: string;
  pr: { url?: string; number?: number };
  phase: AmendmentPhase;
}
export type AmendmentLookup = { ok: true; record: PendingDefinitionAmendment | null } | { ok: false; detail: string };

export interface DefinitionAmendmentStore {
  lookup(workflowPath: string, activeSourceHash: string): AmendmentLookup;
  put(record: PendingDefinitionAmendment): void;
  update(record: PendingDefinitionAmendment): void;
  remove(workflowPath: string): void;
}

const WORKFLOW_PATH = /^orgs\/[A-Za-z0-9._-]+\/workflows\/[A-Za-z0-9._-]+\.md$/;
const HASH = /^[a-f0-9]{64}$/;
const PHASES = new Set<AmendmentPhase>(['prepared', 'committed', 'pushed', 'audit-pending', 'pending-human-merge', 'audit-failed', 'settled']);

function isSafePrUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function key(workflowPath: string): string {
  return createHash('sha256').update(workflowPath, 'utf8').digest('hex');
}

function validate(value: unknown, workflowPath: string): PendingDefinitionAmendment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((name) => !['kind', 'workflowPath', 'baseSourceHash', 'proposedSourceHash', 'branch', 'pr', 'phase'].includes(name))
    || row.workflowPath !== workflowPath || !HASH.test(String(row.baseSourceHash)) || !HASH.test(String(row.proposedSourceHash))
    || (row.kind !== undefined && row.kind !== 'assignment' && row.kind !== 'governance')
    || row.branch !== DEFAULT_WORK_BRANCH || !row.pr || typeof row.pr !== 'object' || Array.isArray(row.pr) || !PHASES.has(row.phase as AmendmentPhase)) return null;
  const pr = row.pr as Record<string, unknown>;
  if (Object.keys(pr).some((name) => name !== 'url' && name !== 'number')
    || (pr.url !== undefined && !isSafePrUrl(pr.url)) || (pr.number !== undefined && (!Number.isInteger(pr.number) || (pr.number as number) < 1))) return null;
  return { kind: (row.kind ?? 'assignment') as DefinitionAmendmentKind, workflowPath, baseSourceHash: row.baseSourceHash as string, proposedSourceHash: row.proposedSourceHash as string,
    branch: row.branch, pr: { ...(typeof pr.url === 'string' ? { url: pr.url } : {}), ...(typeof pr.number === 'number' ? { number: pr.number } : {}) }, phase: row.phase as AmendmentPhase };
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
      if (row.proposedSourceHash === activeSourceHash) { rows.set(workflowPath, { ...row, phase: 'settled' }); return { ok: true, record: null }; }
      return { ok: true, record: { ...row, pr: { ...row.pr } } };
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
    try { renameSync(temp, path); } catch (error) { try { unlinkSync(temp); } catch { /* preserve original error */ } throw error; }
  };
  return {
    lookup(workflowPath, activeSourceHash) {
      try {
        const row = read(workflowPath);
        if (!row) return { ok: true, record: null };
        if (row.proposedSourceHash === activeSourceHash) { if (row.phase !== 'settled') write({ ...row, phase: 'settled' }); return { ok: true, record: null }; }
        return { ok: true, record: row };
      } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
    },
    put: write,
    update: write,
    remove(workflowPath) { ensureDir(); const path = pathFor(workflowPath); if (existsSync(path)) unlinkSync(path); },
  };
}

/** @deprecated Use DefinitionAmendmentStore. Kept for existing integrations. */
export type PendingAssignmentAmendment = PendingDefinitionAmendment;
/** @deprecated Use DefinitionAmendmentStore. Kept for existing integrations. */
export type AssignmentAmendmentStore = DefinitionAmendmentStore;
/** @deprecated Use createInMemoryDefinitionAmendmentStore. */
export const createInMemoryAssignmentAmendmentStore = createInMemoryDefinitionAmendmentStore;
/** @deprecated Use createFileDefinitionAmendmentStore. */
export const createFileAssignmentAmendmentStore = createFileDefinitionAmendmentStore;

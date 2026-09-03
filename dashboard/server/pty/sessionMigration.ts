import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { renameWithRetrySync } from '../atomicRename.ts';
import type { ArchiveKeyEntry, PtySessionsDocumentV2, PtySessionsDocumentV3 } from './contracts.ts';
import {
  assertPtySessionsDocumentV2,
  assertPtySessionsDocumentV3,
  createEmptyPtySessionsDocument,
  MAX_PTY_DOCUMENT_BYTES,
} from './sessionPersistence.ts';
import type { SessionRunRecord } from './sessionRuns.ts';
import { exactKeys } from '../shared/decode.ts';

export const PTY_SESSION_MIGRATION_REQUIRED = 'pty-session-migration-required' as const;
export type PtySessionMigrationStage = 'directory' | 'mutex' | 'source-read' | 'backup'
  | 'fsync-backup' | 'write-temp' | 'fsync-temp' | 'validation' | 'rename'
  | 'fsync-parent' | 'restore' | 'cleanup';

export class PtySessionMigrationError extends Error {
  readonly code = PTY_SESSION_MIGRATION_REQUIRED;

  readonly report: readonly string[];

  constructor(message: string, report: readonly string[]) {
    super(message);
    this.report = report;
    this.name = 'PtySessionMigrationError';
  }
}

export interface PtySessionMigrationDeps {
  now?: () => string;
  /** Retained deterministic stage seam; partial I/O tests use the fs port below. */
  failAt?: PtySessionMigrationStage;
  fs?: Partial<PtySessionMigrationFs>;
  afterBackup?: () => void;
  afterPublish?: () => void;
}

export interface PtySessionMigrationResult {
  migrated: boolean;
  replayed: boolean;
  backupPath: string | null;
}

/** `SessionRunDocument` is private in sessionRuns.ts; this is its one verbatim v1 document copy. */
interface SessionRunDocumentV1 {
  schema: 'kb.pty-session-runs/v1';
  runs: SessionRunRecord[];
  archiveKeys: ArchiveKeyEntry[];
}

export interface PtySessionMigrationFs {
  mkdir(path: string, options: { recursive: true; mode: number }): void;
  exists(path: string): boolean;
  readFile(path: string): Buffer;
  writeFile(path: string, data: string | NodeJS.ArrayBufferView,
    options: { flag: 'wx'; mode: number }): void;
  open(path: string, flags: string): number;
  fsync(descriptor: number): void;
  close(descriptor: number): void;
  rename(source: string, destination: string): void;
  remove(path: string): void;
}

const DEFAULT_FS: PtySessionMigrationFs = {
  mkdir: (path, options) => { mkdirSync(path, options); },
  exists: existsSync,
  readFile: (path) => readFileSync(path),
  writeFile: (path, data, options) => { writeFileSync(path, data, options); },
  open: openSync,
  fsync: fsyncSync,
  close: closeSync,
  rename: renameWithRetrySync,
  remove: (path) => { rmSync(path, { force: true }); },
};


function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function boundedReport(entries: readonly string[]): readonly string[] {
  return entries.slice(0, 20).map((entry) => entry.replace(/[\r\n\u0000-\u001f\u007f]/gu, ' ').slice(0, 160));
}

function migrationError(message: string, report: readonly string[] = []): PtySessionMigrationError {
  return new PtySessionMigrationError(message, boundedReport(report));
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw migrationError('PTY session migration requires a valid source document', ['source: malformed JSON']);
  }
}

function assertLegacyDocument(value: unknown): asserts value is SessionRunDocumentV1 {
  const document = object(value);
  if (document === null || !exactKeys(document, ['schema', 'runs', 'archiveKeys'])
    || document.schema !== 'kb.pty-session-runs/v1' || !Array.isArray(document.runs)
    || !Array.isArray(document.archiveKeys)) {
    throw migrationError('PTY session migration requires an exact v1 document', ['source: schema or keys invalid']);
  }
  if (document.runs.length > 500 || document.archiveKeys.length > 512) {
    throw migrationError('PTY session migration source exceeds retention bounds', ['source: array cap exceeded']);
  }
  const duplicateRows: string[] = [];
  for (const [label, values] of [
    ['sessionRunRef', document.runs.map((run) => object(run)?.sessionRunRef)],
    ['archive key', document.archiveKeys.map((entry) => object(entry)?.key)],
  ] as const) {
    const seen = new Set<unknown>();
    for (const value of values) {
      if (typeof value === 'string' && seen.has(value)) duplicateRows.push(`${label}: duplicate ${value}`);
      seen.add(value);
    }
  }
  if (duplicateRows.length > 0) {
    throw migrationError('PTY session migration found ambiguous duplicate records', duplicateRows);
  }
  const probe = createEmptyPtySessionsDocument();
  probe.legacyRuns = structuredClone(document.runs) as SessionRunRecord[];
  probe.legacyArchiveKeys = structuredClone(document.archiveKeys) as ArchiveKeyEntry[];
  try {
    assertPtySessionsDocumentV3(probe);
  } catch {
    throw migrationError('PTY session migration requires valid v1 records', ['source: record validation failed']);
  }
}

function abandonmentTime(startedAt: string, migrationTime: string): string {
  const minimum = Date.parse(startedAt) + 1;
  const migration = Date.parse(migrationTime);
  if (!Number.isFinite(migration)) {
    throw migrationError('PTY session migration clock is invalid', ['clock: timestamp invalid']);
  }
  return new Date(Math.max(minimum, migration)).toISOString();
}

export function mapPtySessionV1ToV3(source: SessionRunDocumentV1, migrationTime: string): PtySessionsDocumentV3 {
  const document = createEmptyPtySessionsDocument();
  document.legacyRuns = source.runs.map((run) => run.outcome === 'live' ? {
    ...structuredClone(run),
    outcome: 'abandoned',
    endedAt: abandonmentTime(run.startedAt, migrationTime),
    version: run.version + 1,
  } : structuredClone(run));
  document.legacyArchiveKeys = structuredClone(source.archiveKeys);
  assertPtySessionsDocumentV3(document);
  return document;
}

export function mapPtySessionV2ToV3(source: PtySessionsDocumentV2): PtySessionsDocumentV3 {
  const document: PtySessionsDocumentV3 = {
    ...structuredClone(source),
    schema: 'kb.pty-sessions/v3',
    epochId: null,
  };
  assertPtySessionsDocumentV3(document);
  return document;
}

function fsyncFile(fs: PtySessionMigrationFs, path: string): void {
  const fd = fs.open(path, 'r+');
  try { fs.fsync(fd); } finally { fs.close(fd); }
}

function fsyncDirectory(fs: PtySessionMigrationFs, path: string): void {
  const fd = fs.open(path, 'r');
  try {
    try {
      fs.fsync(fd);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || code !== 'EPERM') throw error;
    }
  } finally { fs.close(fd); }
}

async function withDocumentLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const mutex = new DatabaseSync(`${path}.mutex.sqlite`);
  let committed = false;
  try {
    mutex.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const result = await action();
    mutex.exec('COMMIT');
    committed = true;
    return result;
  } finally {
    if (!committed) {
      try { mutex.exec('ROLLBACK'); } catch { /* the migration error remains authoritative */ }
    }
    mutex.close();
  }
}

function injectFailure(deps: PtySessionMigrationDeps, stage: PtySessionMigrationStage): void {
  if (deps.failAt === stage) throw new Error(`injected ${stage} failure`);
}

function restoreSource(fs: PtySessionMigrationFs, path: string, original: Buffer): void {
  const restore = `${path}.${process.pid}.${randomUUID()}.restore`;
  try {
    fs.writeFile(restore, original, { flag: 'wx', mode: 0o600 });
    fsyncFile(fs, restore);
    fs.rename(restore, path);
    fsyncDirectory(fs, dirname(path));
  } finally {
    if (fs.exists(restore)) fs.remove(restore);
  }
}

/**
 * Migrates the one existing session-runs document in place. Callers derive `path` from stateRoot;
 * routes and browser input never supply it.
 */
export async function migratePtySessionDocument(
  path: string,
  deps: PtySessionMigrationDeps = {},
): Promise<PtySessionMigrationResult> {
  if (!isAbsolute(path) || path.includes('\0')) {
    throw migrationError('PTY session migration path is invalid', ['path: not absolute']);
  }
  const canonicalPath = resolve(path);
  const directory = dirname(canonicalPath);
  const fs: PtySessionMigrationFs = { ...DEFAULT_FS, ...deps.fs };
  let outerStage: PtySessionMigrationStage = 'directory';
  try {
    injectFailure(deps, outerStage);
    fs.mkdir(directory, { recursive: true, mode: 0o700 });
    outerStage = 'mutex';
    injectFailure(deps, outerStage);
    return await withDocumentLock(canonicalPath, async () => {
      outerStage = 'source-read';
      injectFailure(deps, outerStage);
      if (!fs.exists(canonicalPath)) {
        throw migrationError('PTY session migration source is missing', ['source: missing']);
      }
      const original = fs.readFile(canonicalPath);
      if (original.byteLength > MAX_PTY_DOCUMENT_BYTES) {
        throw migrationError('PTY session migration source exceeds 4000000 bytes', ['source: document oversized']);
      }
      const parsed = parseJson(original);
      const maybeDocument = object(parsed);
      if (maybeDocument?.schema === 'kb.pty-sessions/v3') {
        try { assertPtySessionsDocumentV3(parsed); } catch {
          throw migrationError('PTY session migration found an invalid v3 document', ['source: v3 validation failed']);
        }
        const v2Backup = `${canonicalPath}.v2.bak`;
        const v1Backup = `${canonicalPath}.v1.bak`;
        return { migrated: false, replayed: true,
          backupPath: fs.exists(v2Backup) ? v2Backup : fs.exists(v1Backup) ? v1Backup : null };
      }

      let candidate: PtySessionsDocumentV3;
      let backupPath: string;
      if (maybeDocument?.schema === 'kb.pty-sessions/v2') {
        try { assertPtySessionsDocumentV2(parsed); } catch {
          throw migrationError('PTY session migration found an invalid v2 document', ['source: v2 validation failed']);
        }
        candidate = mapPtySessionV2ToV3(parsed);
        backupPath = `${canonicalPath}.v2.bak`;
      } else {
        assertLegacyDocument(parsed);
        const migrationTime = (deps.now ?? (() => new Date().toISOString()))();
        try {
          candidate = mapPtySessionV1ToV3(parsed, migrationTime);
        } catch (error) {
          if (error instanceof PtySessionMigrationError) throw error;
          throw migrationError('PTY session migration validation failed', ['validation: field map refused']);
        }
        backupPath = `${canonicalPath}.v1.bak`;
      }

      const tempPath = `${canonicalPath}.${process.pid}.${randomUUID()}.tmp`;
      let sourceReplaced = false;
      let stage: PtySessionMigrationStage = 'backup';
      try {
        injectFailure(deps, stage);
        if (fs.exists(backupPath)) {
          if (!fs.readFile(backupPath).equals(original)) {
            throw migrationError('PTY session migration cannot choose between existing source and backup',
              [`backup: pre-existing ${backupPath.endsWith('.v2.bak') ? '.v2.bak' : '.v1.bak'} differs from source`]);
          }
        } else {
          fs.writeFile(backupPath, original, { flag: 'wx', mode: 0o600 });
          if (!fs.readFile(backupPath).equals(original)) throw new Error('backup bytes differ');
          stage = 'fsync-backup';
          injectFailure(deps, stage);
          fsyncFile(fs, backupPath);
        }
        deps.afterBackup?.();

        stage = 'write-temp';
        injectFailure(deps, stage);
        const encoded = Buffer.from(`${JSON.stringify(candidate)}\n`, 'utf8');
        if (encoded.byteLength > MAX_PTY_DOCUMENT_BYTES) throw new Error('v3 document oversized');
        fs.writeFile(tempPath, encoded, { flag: 'wx', mode: 0o600 });

        stage = 'fsync-temp';
        injectFailure(deps, stage);
        fsyncFile(fs, tempPath);

        stage = 'validation';
        injectFailure(deps, stage);
        assertPtySessionsDocumentV3(parseJson(fs.readFile(tempPath)));

        stage = 'rename';
        injectFailure(deps, stage);
        sourceReplaced = true;
        fs.rename(tempPath, canonicalPath);
        deps.afterPublish?.();

        stage = 'fsync-parent';
        injectFailure(deps, stage);
        fsyncDirectory(fs, directory);
        return { migrated: true, replayed: false, backupPath };
      } catch (error) {
        if (error instanceof PtySessionMigrationError && !sourceReplaced) throw error;
        const report = [`${stage}: failed`];
        if (sourceReplaced) {
          try { restoreSource(fs, canonicalPath, original); } catch { report.push('restore: failed'); }
        }
        try {
          if (fs.exists(tempPath)) fs.remove(tempPath);
        } catch {
          report.push('cleanup: failed');
        }
        throw migrationError('PTY session migration failed atomically', report);
      }
    });
  } catch (error) {
    if (error instanceof PtySessionMigrationError) throw error;
    throw migrationError('PTY session migration failed atomically', [`${outerStage}: failed`]);
  }
}

export async function migratePtySessionStateRoot(
  stateRoot: string,
  deps: PtySessionMigrationDeps = {},
): Promise<PtySessionMigrationResult> {
  if (!isAbsolute(stateRoot) || stateRoot.includes('\0')) {
    throw migrationError('PTY session migration state root is invalid', ['stateRoot: not absolute']);
  }
  return migratePtySessionDocument(resolve(stateRoot, 'pty', 'session-runs.json'), deps);
}

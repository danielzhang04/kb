import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** A server-owned error factory keeps persistence failures in the caller's error domain. */
export interface AtomicJsonDocumentOptions<T> {
  path: string;
  empty: () => T;
  validate: (value: unknown) => asserts value is T;
  error: (message: string) => Error;
  maxBytes: number;
  lockTimeoutMs?: number;
}

export interface AtomicJsonDocument<T> {
  read(): T;
  mutate<R>(callback: (document: T) => R | Promise<R>): Promise<R>;
}

/**
 * Small, local, lock-serialized JSON document primitive.
 *
 * A companion SQLite `BEGIN IMMEDIATE` transaction is the exclusion primitive. SQLite holds a real
 * OS file lock for the transaction lifetime, so another process cannot steal it and Windows releases
 * it automatically if the owner crashes. There is deliberately no pathname stale-lock recovery.
 * Callers still own document schema validation and safe-path validation.
 */
export function createAtomicJsonDocument<T>(options: AtomicJsonDocumentOptions<T>): AtomicJsonDocument<T> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw options.error('atomic document maximum size is invalid');
  }
  const timeout = options.lockTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1) {
    throw options.error('atomic document lock timeout is invalid');
  }
  if (!options.path || options.path.includes('\0')) {
    throw options.error('atomic document path is invalid');
  }

  const mutexPath = `${options.path}.mutex.sqlite`;
  mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });

  const read = (): T => {
    if (!existsSync(options.path)) return structuredClone(options.empty());
    if (statSync(options.path).size > options.maxBytes) {
      throw options.error('atomic document state exceeds its limit');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(options.path, 'utf8'));
    } catch {
      throw options.error('atomic document state is invalid');
    }
    options.validate(parsed);
    return structuredClone(parsed);
  };

  const save = (document: T): void => {
    const encoded = `${JSON.stringify(document)}\n`;
    if (Buffer.byteLength(encoded, 'utf8') > options.maxBytes) {
      throw options.error('atomic document state exceeds its limit');
    }
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

  const acquire = async (): Promise<DatabaseSync> => {
    const deadline = Date.now() + timeout;
    while (true) {
      let mutex: DatabaseSync | null = null;
      try {
        mutex = new DatabaseSync(mutexPath);
        mutex.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
        return mutex;
      } catch (error) {
        try { mutex?.close(); } catch { /* fail closed below */ }
        const sqlite = error as { code?: unknown; message?: unknown };
        const busy = sqlite.code === 'ERR_SQLITE_ERROR' && sqlite.message === 'database is locked';
        if (!busy) throw options.error('atomic document mutex is unavailable');
        if (Date.now() >= deadline) throw options.error('atomic document state is busy');
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      }
    }
  };

  return {
    read,
    async mutate(callback) {
      const mutex = await acquire();
      let committed = false;
      try {
        const document = read();
        const result = await callback(document);
        save(document);
        mutex.exec('COMMIT');
        committed = true;
        return result;
      } finally {
        if (!committed) {
          try { mutex.exec('ROLLBACK'); } catch { /* process/SQLite releases the OS lock on close */ }
        }
        try { mutex.close(); } catch { /* fail closed: a leaked handle keeps exclusion, never weakens it */ }
      }
    },
  };
}

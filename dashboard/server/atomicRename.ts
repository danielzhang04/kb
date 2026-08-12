/**
 * The single rename seam every atomic save in the server funnels through.
 *
 * An atomic save is "write a sibling temp file, then rename it over the target". On Windows that
 * final rename fails when ANY process holds the TARGET open without FILE_SHARE_DELETE — and
 * CPython's `open()`, most editors, antivirus scanners and search indexers all open files that way.
 * The collision is sub-millisecond (it clears the instant the reader closes its handle), but it
 * surfaced as a hard save failure: a monitoring script polling `control-plane.json` every 2s
 * produced `EPERM: operation not permitted, rename '…control-plane.json.<pid>.<uuid>.tmp' ->
 * '…control-plane.json'`, which the daemon escalated into a human-gated run parking.
 *
 * So the rename retries briefly on the codes Windows reports for a share violation. Fail-loud is
 * preserved on both ends: a non-transient code rethrows immediately with no retry, and a genuinely
 * stuck target rethrows the ORIGINAL error once the bound is spent. Nothing above this function
 * changes — a save that truly cannot land still fails exactly as before.
 */
import { renameSync } from 'node:fs';

/** Windows reports a share violation as one of these; POSIX never produces them for a valid rename. */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** 10 attempts, capped exponential backoff => ~0.8s of waiting worst case. */
export const ATOMIC_RENAME_ATTEMPTS = 10;
const BACKOFF_START_MS = 5;
const BACKOFF_CAP_MS = 160;

export interface AtomicRenameDeps {
  /** Injectable for tests: real Windows share violations cannot be provoked on a test runner. */
  rename?: (from: string, to: string) => void;
  sleep?: (ms: number) => void;
}

/**
 * Blocking sleep. Every caller of this seam is a synchronous `save()` running under an exclusion
 * lock, so the retry must not yield the save to another writer mid-flight; `Atomics.wait` gives a
 * dependency-free synchronous wait.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `renameSync` with a bounded retry on transient Windows share violations. */
export function renameWithRetrySync(from: string, to: string, deps: AtomicRenameDeps = {}): void {
  const rename = deps.rename ?? renameSync;
  const sleep = deps.sleep ?? sleepSync;
  let delay = BACKOFF_START_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code !== 'string' || !TRANSIENT_RENAME_CODES.has(code)) throw error;
      if (attempt >= ATOMIC_RENAME_ATTEMPTS) throw error;
      sleep(delay);
      delay = Math.min(delay * 2, BACKOFF_CAP_MS);
    }
  }
}

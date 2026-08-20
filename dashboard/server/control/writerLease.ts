import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { acquirePosixWriterLease, posixProcessStartTicks } from './writerLease.posix.ts';
import { acquireWin32WriterLease, win32ProcessStartTicks } from './writerLease.win32.ts';

export interface LockContentionRecord {
  bootId: string;
  contenderPid: number;
  contenderStartTicks: number;
  holderPid: number | null;
  observedAt: string;
}

export interface LockContentionReport extends LockContentionRecord {
  contenderAlive: boolean;
}

export interface WriterLease {
  readonly mode: 'already-locked';
  readonly stateRoot: string;
  readonly bootId: string;
  readonly pid: number;
  assertHeld(): void;
  release(): void;
}

export type FileControlPlaneAccess =
  | { mode: 'already-locked'; lease: WriterLease }
  | { mode: 'read-only-harness' };

export interface NativeWriterLease {
  readonly inheritFlagSet: boolean;
  assertHeld(): void;
  assertOwnedForContentionCleanup(): void;
  release(): void;
}

export interface NativeWriterLeaseAdapter {
  acquire(lockPath: string): { lease: NativeWriterLease; holderPid: null } | { lease: null; holderPid: number | null };
  processStartTicks(pid: number): number | null;
}

const writerLeaseBrand: unique symbol = Symbol('WriterLease');
type BrandedWriterLease = WriterLease & { readonly [writerLeaseBrand]: true };
const mintedLeases = new WeakSet<object>();
const leaseInspection = new WeakMap<object, { inheritFlagSet: boolean; held: () => boolean }>();

export class WriterLeaseContentionError extends Error {
  readonly contention: LockContentionRecord;

  constructor(contention: LockContentionRecord) {
    super(`dashboard writer lease is already held${contention.holderPid === null ? '' : ` by pid ${contention.holderPid}`}`);
    this.name = 'WriterLeaseContentionError';
    this.contention = contention;
  }
}

function platformAdapter(): NativeWriterLeaseAdapter {
  if (process.platform === 'win32') {
    return { acquire: acquireWin32WriterLease, processStartTicks: win32ProcessStartTicks };
  }
  return { acquire: acquirePosixWriterLease, processStartTicks: posixProcessStartTicks };
}

function contentionPath(stateRoot: string): string {
  return join(stateRoot, 'control', 'lock-contention.json');
}

function writeContention(stateRoot: string, record: LockContentionRecord): void {
  const path = contentionPath(stateRoot);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, path);
  } catch (error) {
    try { rmSync(temp, { force: true }); } catch {}
    throw error;
  }
}

function parseContention(value: unknown): LockContentionRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'bootId,contenderPid,contenderStartTicks,holderPid,observedAt') return null;
  if (typeof row.bootId !== 'string' || row.bootId.length === 0
    || !Number.isInteger(row.contenderPid) || Number(row.contenderPid) <= 0
    || !Number.isFinite(row.contenderStartTicks) || Number(row.contenderStartTicks) <= 0
    || !(row.holderPid === null || (Number.isInteger(row.holderPid) && Number(row.holderPid) > 0))
    || typeof row.observedAt !== 'string' || !Number.isFinite(Date.parse(row.observedAt))) return null;
  return row as unknown as LockContentionRecord;
}

/** @internal Test seam for deterministic native-adapter contract tests. */
export function currentLockContentionWithAdapterForTest(
  stateRoot: string,
  adapter: NativeWriterLeaseAdapter,
): LockContentionReport | null {
  try {
    const record = parseContention(JSON.parse(readFileSync(contentionPath(stateRoot), 'utf8')));
    if (!record) return null;
    return {
      ...record,
      contenderAlive: adapter.processStartTicks(record.contenderPid) === record.contenderStartTicks,
    };
  } catch {
    return null;
  }
}

export function currentLockContention(stateRoot: string): LockContentionReport | null {
  return currentLockContentionWithAdapterForTest(stateRoot, platformAdapter());
}

/** @internal Test seam for both platform contracts without loading the other host's native ABI. */
export function acquireWriterLeaseWithAdapterForTest(
  input: { stateRoot: string; bootId: string; now?: () => Date },
  adapter: NativeWriterLeaseAdapter,
): WriterLease {
  const stateRoot = resolve(input.stateRoot);
  const lockPath = join(stateRoot, 'control', 'dashboard.lock');
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const acquired = adapter.acquire(lockPath);
  if (acquired.lease === null) {
    const contenderStartTicks = adapter.processStartTicks(process.pid);
    if (contenderStartTicks === null) throw new Error('could not determine writer-lease contender process start time');
    const contention: LockContentionRecord = {
      bootId: input.bootId,
      contenderPid: process.pid,
      contenderStartTicks,
      holderPid: acquired.holderPid,
      observedAt: (input.now ?? (() => new Date()))().toISOString(),
    };
    writeContention(stateRoot, contention);
    throw new WriterLeaseContentionError(contention);
  }

  let held = true;
  const nativeLease = acquired.lease;
  const lease: BrandedWriterLease = {
    [writerLeaseBrand]: true,
    mode: 'already-locked',
    stateRoot,
    bootId: input.bootId,
    pid: process.pid,
    assertHeld() {
      if (!held) throw new Error('writer lease has been released');
      nativeLease.assertHeld();
      const sidecar = contentionPath(stateRoot);
      if (existsSync(sidecar)) {
        try {
          nativeLease.assertOwnedForContentionCleanup();
          rmSync(sidecar, { force: true });
        } catch {}
      }
    },
    release() {
      if (!held) return;
      held = false;
      nativeLease.release();
    },
  };
  mintedLeases.add(lease);
  leaseInspection.set(lease, { inheritFlagSet: nativeLease.inheritFlagSet, held: () => held });
  try {
    lease.assertHeld();
  } catch (error) {
    lease.release();
    throw error;
  }
  return lease;
}

export function acquireWriterLease(input: {
  stateRoot: string;
  bootId: string;
  now?: () => Date;
}): WriterLease {
  return acquireWriterLeaseWithAdapterForTest(input, platformAdapter());
}

/** Runtime capability check used by the file store; the unique brand is deliberately not exported. */
export function assertWriterLeaseForRoot(lease: WriterLease, stateRoot: string): void {
  if (!mintedLeases.has(lease as object)) throw new Error('invalid writer lease capability');
  if (lease.stateRoot !== resolve(stateRoot)) throw new Error('writer lease root does not match control-store root');
  lease.assertHeld();
}

/** @internal */
export function inspectWriterLeaseForTest(lease: WriterLease): { inheritFlagSet: boolean; held: boolean } {
  const inspection = leaseInspection.get(lease as object);
  if (!inspection) throw new Error('invalid writer lease capability');
  return { inheritFlagSet: inspection.inheritFlagSet, held: inspection.held() };
}

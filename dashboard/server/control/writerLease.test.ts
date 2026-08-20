import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  WriterLeaseContentionError, acquireWriterLease, acquireWriterLeaseWithAdapterForTest,
  currentLockContention, inspectWriterLeaseForTest,
  type NativeWriterLeaseAdapter,
} from './writerLease.ts';
import {
  ControlStoreReadOnlyError,
  createFileControlPlaneStore,
} from './store.ts';
import { parseProcLocksForTest } from './writerLease.posix.ts';
import {
  makeCurrentV2RootForTest, makeLeaseRoot, spawnLeaseFixture, writeContentionForTest,
} from './test-fixtures/writerLeaseChild.ts';
import { createExistingRootFileStoreHarnessForTest } from './test-fixtures/controlStore.ts';

describe('writer lease', () => {
  it('refuses a second process and records current contention', async () => {
    const root = makeLeaseRoot();
    const held = await spawnLeaseFixture('hold', root, 'boot-a');
    expect(() => acquireWriterLease({ stateRoot: root, bootId: 'boot-b' }))
      .toThrow(WriterLeaseContentionError);
    const contention = currentLockContention(root);
    expect(contention).toMatchObject({ bootId: 'boot-b', contenderAlive: true });
    if (process.platform === 'linux') expect(contention?.holderPid).toBe(held.pid);
    if (process.platform === 'win32') expect(contention?.holderPid).toBeNull();
    await held.stop();
  });

  it('does not leak the fd into a spawned child', async () => {
    const root = makeLeaseRoot();
    const lease = acquireWriterLease({ stateRoot: root, bootId: 'boot-a' });
    const sleeper = await spawnLeaseFixture('sleep', root, 'unused');
    lease.release();
    expect((await spawnLeaseFixture('try', root, 'boot-b')).exitCode).toBe(0);
    await sleeper.stop();
  });

  it('reports a stopped contender until the incumbent verifies and clears it', async () => {
    const root = makeLeaseRoot();
    const lease = acquireWriterLease({ stateRoot: root, bootId: 'boot-a' });
    expect((await spawnLeaseFixture('try', root, 'boot-b')).exitCode).toBe(17);
    expect(currentLockContention(root)).toMatchObject({ bootId: 'boot-b', contenderAlive: false });
    expect(existsSync(join(root, 'control', 'lock-contention.json'))).toBe(true);
    lease.assertHeld();
    expect(existsSync(join(root, 'control', 'lock-contention.json'))).toBe(false);
    lease.release();
  });

  it('reports stale contention and lets a new incumbent clear it', () => {
    const root = makeLeaseRoot();
    writeContentionForTest(root, { bootId: 'dead', contenderPid: process.pid,
      contenderStartTicks: 1, holderPid: null, observedAt: '2026-08-20T00:00:00.000Z' });
    expect(currentLockContention(root)).toMatchObject({ bootId: 'dead', contenderAlive: false });
    const lease = acquireWriterLease({ stateRoot: root, bootId: 'live' });
    lease.assertHeld();
    expect(existsSync(join(root, 'control', 'lock-contention.json'))).toBe(false);
    lease.release();
  });

  it('keeps the current-schema root helper available for read-only store tests', () => {
    expect(existsSync(join(makeCurrentV2RootForTest(), 'control', 'control-plane.json'))).toBe(true);
  });

  it('restarts the file-store harness with a fresh lease', () => {
    const root = makeCurrentV2RootForTest();
    const harness = createExistingRootFileStoreHarnessForTest();
    try {
      const beforeRestart = harness.open(root);
      expect(beforeRestart.listDeployments()).toEqual([]);
      const afterRestart = harness.restart(root);
      expect(() => beforeRestart.listDeployments()).toThrow(/released/);
      expect(afterRestart.listDeployments()).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it('sets the native noninherit flag', () => {
    const lease = acquireWriterLease({ stateRoot: makeLeaseRoot(), bootId: 'boot-a' });
    expect(inspectWriterLeaseForTest(lease).inheritFlagSet).toBe(false);
    lease.release();
  });

  it('rejects a lease minted for another root', () => {
    const lease = acquireWriterLease({ stateRoot: makeLeaseRoot(), bootId: 'boot-a' });
    expect(() => createFileControlPlaneStore(makeLeaseRoot(), { mode: 'already-locked', lease })).toThrow(/root/);
    lease.release();
    lease.release();
  });

  it('read-only harness refuses before mutation', () => {
    const ro = createFileControlPlaneStore(makeCurrentV2RootForTest(), { mode: 'read-only-harness' });
    expect(() => ro.createDeployment('operator', {
      deploymentRef: 'deploy-1', initialState: 'waiting-confirmation',
      targetCommit: 'b'.repeat(40), previousCommit: 'a'.repeat(40),
      requestedAt: '2026-08-20T00:00:00.000Z', parkWarnAt: '2026-08-20T00:35:00.000Z',
      idempotencyKey: 'create-1',
    })).toThrow(ControlStoreReadOnlyError);
  });

  it('does not report a lock-path open failure as contention or write a sidecar', () => {
    const root = makeLeaseRoot();
    mkdirSync(join(root, 'control', 'dashboard.lock'));
    let thrown: unknown;
    try {
      acquireWriterLease({ stateRoot: root, bootId: 'boot-a' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(WriterLeaseContentionError);
    if (process.platform === 'win32') expect((thrown as Error).message).toMatch(/Win32 error 5\b/);
    if (process.platform === 'linux') expect((thrown as Error).message).toMatch(/errno \d+/);
    expect(existsSync(join(root, 'control', 'lock-contention.json'))).toBe(false);
  });

  it('matches the full device-major/device-minor/inode tuple in proc locks', () => {
    const locks = [
      '0: POSIX  ADVISORY WRITE 40 08:01:900 0 EOF',
      '1: FLOCK ADVISORY WRITE 41 08:01:900 0 EOF',
      '2: FLOCK ADVISORY WRITE 42 08:02:900 0 EOF',
      '3: FLOCK ADVISORY WRITE 43 08:01:901 0 EOF',
    ].join('\n');
    expect(parseProcLocksForTest(locks, { major: 0x08n, minor: 0x01n, inode: 900n })).toBe(41);
    expect(parseProcLocksForTest(locks, { major: 0x08n, minor: 0x03n, inode: 900n })).toBeNull();
  });

  it('writes deterministic contention through the injected native adapter seam', () => {
    const adapter: NativeWriterLeaseAdapter = {
      acquire: () => ({ lease: null, holderPid: 321 }),
      processStartTicks: () => 456,
    };
    const root = makeLeaseRoot();
    expect(() => acquireWriterLeaseWithAdapterForTest({
      stateRoot: root,
      bootId: 'boot-fake',
      now: () => new Date('2026-08-20T12:00:00.000Z'),
    }, adapter)).toThrow(WriterLeaseContentionError);
    expect(JSON.parse(readFileSync(join(root, 'control', 'lock-contention.json'), 'utf8'))).toEqual({
      bootId: 'boot-fake', contenderPid: process.pid, contenderStartTicks: 456,
      holderPid: 321, observedAt: '2026-08-20T12:00:00.000Z',
    });
  });

  it('holds and idempotently releases through the injected native adapter seam', () => {
    const nativeAssertHeld = vi.fn();
    const nativeAssertOwnedForContentionCleanup = vi.fn();
    const nativeRelease = vi.fn();
    const adapter: NativeWriterLeaseAdapter = {
      acquire: () => ({
        lease: {
          inheritFlagSet: false,
          assertHeld: nativeAssertHeld,
          assertOwnedForContentionCleanup: nativeAssertOwnedForContentionCleanup,
          release: nativeRelease,
        },
        holderPid: null,
      }),
      processStartTicks: () => 456,
    };
    const lease = acquireWriterLeaseWithAdapterForTest({
      stateRoot: makeLeaseRoot(), bootId: 'boot-fake-success',
    }, adapter);
    lease.assertHeld();
    lease.release();
    lease.release();
    expect(nativeAssertHeld).toHaveBeenCalledTimes(2);
    expect(nativeAssertOwnedForContentionCleanup).not.toHaveBeenCalled();
    expect(nativeRelease).toHaveBeenCalledTimes(1);
  });

  it('uses the stronger ownership check only to clear a contention sidecar', () => {
    const nativeAssertHeld = vi.fn();
    const nativeAssertOwnedForContentionCleanup = vi.fn();
    const root = makeLeaseRoot();
    writeContentionForTest(root, { bootId: 'old', contenderPid: process.pid,
      contenderStartTicks: 1, holderPid: null, observedAt: '2026-08-20T00:00:00.000Z' });
    const adapter: NativeWriterLeaseAdapter = {
      acquire: () => ({
        lease: {
          inheritFlagSet: false,
          assertHeld: nativeAssertHeld,
          assertOwnedForContentionCleanup: nativeAssertOwnedForContentionCleanup,
          release: vi.fn(),
        },
        holderPid: null,
      }),
      processStartTicks: () => 456,
    };
    const lease = acquireWriterLeaseWithAdapterForTest({ stateRoot: root, bootId: 'boot-new' }, adapter);
    lease.assertHeld();
    expect(nativeAssertHeld).toHaveBeenCalledTimes(2);
    expect(nativeAssertOwnedForContentionCleanup).toHaveBeenCalledTimes(1);
    expect(existsSync(join(root, 'control', 'lock-contention.json'))).toBe(false);
    lease.release();
  });

  it('keeps an acquired lease usable when sidecar cleanup ownership cannot be rechecked', () => {
    const fdOnlyAssertHeld = vi.fn();
    const cleanupRecheck = vi.fn(() => { throw new Error('ownership recheck unavailable'); });
    const root = makeLeaseRoot();
    writeContentionForTest(root, { bootId: 'old', contenderPid: process.pid,
      contenderStartTicks: 1, holderPid: null, observedAt: '2026-08-20T00:00:00.000Z' });
    const adapter: NativeWriterLeaseAdapter = {
      acquire: () => ({
        lease: {
          inheritFlagSet: false,
          assertHeld: fdOnlyAssertHeld,
          assertOwnedForContentionCleanup: cleanupRecheck,
          release: vi.fn(),
        },
        holderPid: null,
      }),
      processStartTicks: () => 456,
    };

    const firstLease = acquireWriterLeaseWithAdapterForTest({ stateRoot: root, bootId: 'boot-first' }, adapter);
    firstLease.assertHeld();
    expect(inspectWriterLeaseForTest(firstLease).held).toBe(true);
    expect(existsSync(join(root, 'control', 'lock-contention.json'))).toBe(true);
    firstLease.release();

    const secondLease = acquireWriterLeaseWithAdapterForTest({ stateRoot: root, bootId: 'boot-second' }, adapter);
    secondLease.assertHeld();
    expect(inspectWriterLeaseForTest(secondLease).held).toBe(true);
    expect(existsSync(join(root, 'control', 'lock-contention.json'))).toBe(true);
    expect(fdOnlyAssertHeld).toHaveBeenCalledTimes(4);
    expect(cleanupRecheck).toHaveBeenCalledTimes(4);
    secondLease.release();
  });
});

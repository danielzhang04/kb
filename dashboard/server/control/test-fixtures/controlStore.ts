/**
 * Legacy file-store shim. createExistingRootFileStoreHarnessForTest is the harness entry point;
 * restart() deliberately rotates its writer-lease boot ID for simulated daemon restarts.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFileControlPlaneStore,
  type ControlPlaneStore,
  type ControlStoreOptions,
} from '../store.ts';
import type { CreateDeploymentInput } from '../types.ts';
import { acquireWriterLease, type WriterLease } from '../writerLease.ts';

/** @internal Adapter for legacy tests that prepare a specific root before opening/reopening it. */
export function createExistingRootFileStoreHarnessForTest(): {
  open(root: string, options?: ControlStoreOptions, bootId?: string): ControlPlaneStore;
  /** Release this root's old lease and reopen it under a fresh boot ID. */
  restart(root: string, options?: ControlStoreOptions): ControlPlaneStore;
  lease(root: string): WriterLease | undefined;
  close(): void;
} {
  const leases = new Map<string, WriterLease>();
  let sequence = 0;
  const open = (
    root: string,
    options: ControlStoreOptions = {},
    bootId = `existing-root-test-${++sequence}`,
  ): ControlPlaneStore => {
    let lease = leases.get(root);
    if (!lease) {
      lease = acquireWriterLease({ stateRoot: root, bootId });
      leases.set(root, lease);
    }
    return createFileControlPlaneStore(root, { mode: 'already-locked', lease }, options);
  };
  return {
    open,
    restart(root, options = {}) {
      leases.get(root)?.release();
      leases.delete(root);
      return open(root, options);
    },
    lease(root) {
      return leases.get(root);
    },
    close() {
      for (const lease of leases.values()) lease.release();
      leases.clear();
    },
  };
}

/** @internal Isolated leased file-store fixture for tests. */
export function createLeasedFileStoreForTest(
  options: ControlStoreOptions = {},
  seed?: unknown,
  bootId = 'test-boot',
): {
  root: string;
  path: string;
  store: ControlPlaneStore;
  lease: WriterLease;
  close(): void;
} {
  const root = mkdtempSync(join(tmpdir(), 'control-store-test-'));
  const path = join(root, 'control', 'control-plane.json');
  const fileStores = createExistingRootFileStoreHarnessForTest();
  let closed = false;
  try {
    mkdirSync(join(root, 'control'), { recursive: true });
    if (seed !== undefined) writeFileSync(path, `${JSON.stringify(seed)}\n`, 'utf8');
    const store = fileStores.open(root, options, bootId);
    const lease = fileStores.lease(root);
    if (!lease) throw new Error('leased file-store fixture did not acquire a writer lease');
    return {
      root,
      path,
      store,
      lease,
      close() {
        if (closed) return;
        closed = true;
        fileStores.close();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    fileStores.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** @internal Complete unique deployment input for file-store tests and benchmarks. */
export function createDeploymentFixture(sequence = 1): CreateDeploymentInput {
  const suffix = sequence.toString().padStart(4, '0');
  return {
    deploymentRef: `deploy-${suffix}`,
    initialState: 'waiting-confirmation',
    targetCommit: sequence.toString(16).padStart(40, '0'),
    previousCommit: 'a'.repeat(40),
    requestedAt: '2026-08-20T00:00:00.000Z',
    parkWarnAt: '2026-08-20T00:35:00.000Z',
    idempotencyKey: `create-${suffix}`,
  };
}

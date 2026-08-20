/**
 * Legacy file-store shim. createExistingRootFileStoreHarnessForTest is the harness entry point;
 * restart() deliberately rotates its writer-lease boot ID for simulated daemon restarts.
 */
import {
  createFileControlPlaneStore,
  type ControlPlaneStore,
  type ControlStoreOptions,
} from '../store.ts';
import { acquireWriterLease, type WriterLease } from '../writerLease.ts';

/** @internal Adapter for legacy tests that prepare a specific root before opening/reopening it. */
export function createExistingRootFileStoreHarnessForTest(): {
  open(root: string, options?: ControlStoreOptions): ControlPlaneStore;
  /** Release this root's old lease and reopen it under a fresh boot ID. */
  restart(root: string, options?: ControlStoreOptions): ControlPlaneStore;
  close(): void;
} {
  const leases = new Map<string, WriterLease>();
  let sequence = 0;
  const open = (root: string, options: ControlStoreOptions = {}): ControlPlaneStore => {
    let lease = leases.get(root);
    if (!lease) {
      lease = acquireWriterLease({ stateRoot: root, bootId: `existing-root-test-${++sequence}` });
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
    close() {
      for (const lease of leases.values()) lease.release();
      leases.clear();
    },
  };
}

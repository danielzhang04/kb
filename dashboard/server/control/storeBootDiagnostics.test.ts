import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ControlStoreLimitError,
  ControlStoreStartupHydrationError,
  createFileControlPlaneStore,
  emptyStoreDocumentForTest,
  isControlStoreStartupHydrationError,
} from './store.ts';
import { acquireWriterLease } from './writerLease.ts';
import { createNodePersistenceDeps } from './persistence.ts';

const ROOT = join(process.cwd(), '..', '_private');

function withStateRoot(test: (root: string) => void): void {
  mkdirSync(ROOT, { recursive: true });
  const root = mkdtempSync(join(ROOT, 'store-boot-diagnostics-'));
  try {
    test(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeControlDocument(root: string, source: string): void {
  const path = join(root, 'control', 'control-plane.json');
  mkdirSync(join(root, 'control'), { recursive: true });
  writeFileSync(path, source, 'utf8');
}

function withLease(root: string, test: (lease: ReturnType<typeof acquireWriterLease>) => void): void {
  const lease = acquireWriterLease({ stateRoot: root, bootId: 'store-boot-diagnostics' });
  try {
    test(lease);
  } finally {
    lease.release();
  }
}

describe('file control-store startup hydration classification', () => {
  it('types malformed startup JSON while preserving the direct parser message', () => withStateRoot((root) => {
    writeControlDocument(root, '{bad-json');
    withLease(root, (lease) => {
      expect(() => createFileControlPlaneStore(root, { mode: 'already-locked', lease }))
        .toThrow(ControlStoreStartupHydrationError);
      expect(() => createFileControlPlaneStore(root, { mode: 'already-locked', lease }))
        .toThrow(/JSON|Unexpected/i);
    });
  }));

  it('preserves the existing startup size-limit class while marking it diagnostic-safe', () => withStateRoot((root) => {
    writeControlDocument(root, '{"version":4}\n');
    withLease(root, (lease) => {
      let thrown: unknown;
      try {
        createFileControlPlaneStore(root, { mode: 'already-locked', lease }, { maxDocumentBytes: 1 });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ControlStoreLimitError);
      expect(isControlStoreStartupHydrationError(thrown)).toBe(true);
    });
  }));

  it('types a migration/validation failure before normalization or persistence', () => withStateRoot((root) => {
    writeControlDocument(root, '{"version":4}');
    withLease(root, (lease) => {
      const invalid = { ...emptyStoreDocumentForTest(), runs: 'not-an-array' };
      expect(() => createFileControlPlaneStore(root, { mode: 'already-locked', lease }, {
        loadAndMigrateForTest: (() => ({ document: invalid, applied: [] })) as never,
      })).toThrow(ControlStoreStartupHydrationError);
    });
  }));

  it('does not type a post-hydration migration backup persistence failure', () => withStateRoot((root) => {
    writeControlDocument(root, '{"version":4}');
    withLease(root, (lease) => {
      const real = createNodePersistenceDeps();
      expect(() => createFileControlPlaneStore(root, { mode: 'already-locked', lease }, {
        loadAndMigrateForTest: (() => ({ document: emptyStoreDocumentForTest(), applied: [4] })) as never,
        persistenceDepsForTest: { ...real, openTemp: () => { throw new Error('backup-save-failed'); } },
      })).toThrow(/backup-save-failed/);
      expect(() => createFileControlPlaneStore(root, { mode: 'already-locked', lease }, {
        loadAndMigrateForTest: (() => ({ document: emptyStoreDocumentForTest(), applied: [4] })) as never,
        persistenceDepsForTest: { ...real, openTemp: () => { throw new Error('backup-save-failed'); } },
      })).not.toThrow(ControlStoreStartupHydrationError);
    });
  }));
});

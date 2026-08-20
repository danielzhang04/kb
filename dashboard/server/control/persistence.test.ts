import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  createNodePersistenceDeps,
  fakePersistenceDeps,
  persistControlDocumentSync,
  spyPersistenceDeps,
} from './persistence.ts';
import {
  createDeploymentFixture,
  createExistingRootFileStoreHarnessForTest,
  createLeasedFileStoreForTest,
} from './test-fixtures/controlStore.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(
  new URL(`../../../tests/fixtures/control-plane/${name}`, import.meta.url)), 'utf8'));

const readDocument = (path: string): Record<string, any> => JSON.parse(readFileSync(path, 'utf8'));

it('pads only test documents to an exact persisted byte target', () => {
  const opened = createLeasedFileStoreForTest({ persistenceTargetBytesForTest: 8192 });
  try {
    opened.store.createDeployment('operator', createDeploymentFixture());
    expect(statSync(opened.path).size).toBe(8192);
  } finally {
    opened.close();
  }
});

it('orders both Linux barriers for deploy-critical persistence', () => {
  const calls: string[] = [];
  persistControlDocumentSync('/state/control/control-plane.json', '{}\n',
    'deploy-critical', fakePersistenceDeps(calls, 'linux'));
  expect(calls).toEqual([
    'open-temp', 'write', 'fsync-temp', 'close-temp', 'rename',
    'open-dir', 'fsync-dir', 'close-dir',
  ]);
});

it('closes descriptors and removes the exact temp when a directory barrier throws', () => {
  const calls: string[] = [];
  const base = fakePersistenceDeps(calls, 'linux');
  const deps = {
    ...base,
    fsync: (fd: number) => {
      base.fsync(fd);
      if (fd === 2) throw new Error('directory fsync failed');
    },
  };
  expect(() => persistControlDocumentSync(
    '/state/control/control-plane.json', '{}\n', 'deploy-critical', deps,
  )).toThrow(/directory fsync failed/);
  expect(calls).toEqual([
    'open-temp', 'write', 'fsync-temp', 'close-temp', 'rename',
    'open-dir', 'fsync-dir', 'close-dir', 'remove-temp',
  ]);
});

it('closes the temp descriptor and cleans up when writing throws', () => {
  const calls: string[] = [];
  const base = fakePersistenceDeps(calls, 'linux');
  const deps = {
    ...base,
    write: (fd: number, encoded: string) => {
      base.write(fd, encoded);
      throw new Error('write failed');
    },
  };
  expect(() => persistControlDocumentSync(
    '/state/control/control-plane.json', '{}\n', 'ordinary', deps,
  )).toThrow(/write failed/);
  expect(calls).toEqual(['open-temp', 'write', 'close-temp', 'remove-temp']);
});

it('does not turn a post-fsync directory close error into a failed Linux save', () => {
  const calls: string[] = [];
  const base = fakePersistenceDeps(calls, 'linux');
  const deps = {
    ...base,
    close: (fd: number) => {
      base.close(fd);
      if (fd === 2) throw new Error('directory close failed');
    },
  };
  expect(() => persistControlDocumentSync(
    '/state/control/control-plane.json', '{}\n', 'deploy-critical', deps,
  )).not.toThrow();
  expect(calls.filter((call) => call === 'close-dir')).toHaveLength(1);
  expect(calls).not.toContain('remove-temp');
});

it('does not double-close a non-Linux directory descriptor when best-effort close throws', () => {
  const calls: string[] = [];
  const base = fakePersistenceDeps(calls, 'win32');
  const deps = {
    ...base,
    close: (fd: number) => {
      base.close(fd);
      if (fd === 2) throw new Error('directory close failed');
    },
  };
  expect(() => persistControlDocumentSync(
    'C:\\state\\control\\control-plane.json', '{}\n', 'ordinary', deps,
  )).not.toThrow();
  expect(calls.filter((call) => call === 'close-dir')).toHaveLength(1);
});

it('injects a real spy and coalesces migration plus crash normalization into one byte-real save', () => {
  const root = mkdtempSync(join(tmpdir(), 'control-persistence-spy-'));
  const fileStores = createExistingRootFileStoreHarnessForTest();
  try {
    const control = join(root, 'control');
    const path = join(control, 'control-plane.json');
    mkdirSync(control, { recursive: true });
    writeFileSync(path, `${JSON.stringify({
      version: 1,
      nextEventCursor: 1,
      proposals: [],
      runs: [{
        subject: 'alice', runRef: 'run-live', state: 'running', version: 1,
        createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
      }],
      stages: [], attempts: [], sessions: [], humanRequests: [], events: [],
      stageGenerations: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [],
      generationSupersessions: [], quarantine: [],
    })}\n`, 'utf8');
    const calls: string[] = [];
    fileStores.open(root, {
      now: () => new Date('2026-08-20T01:00:00.000Z'),
      bootId: 'boot-spy',
      persistenceDepsForTest: spyPersistenceDeps(calls, createNodePersistenceDeps()),
    });
    expect(calls.filter((call) => call === 'rename')).toHaveLength(1);
    expect(calls.slice(0, 5)).toEqual(['open-temp', 'write', 'fsync-temp', 'close-temp', 'rename']);
    expect(calls.filter((call) => call === 'write')).toHaveLength(1);
    const encoded = readFileSync(path, 'utf8');
    expect(encoded.endsWith('\n')).toBe(true);
    const persisted = JSON.parse(encoded) as Record<string, any>;
    expect(persisted).toMatchObject({ version: 2, documentRevision: 1, nextEventCursor: 2 });
    expect(persisted.runs[0].lifecycle).toEqual({ kind: 'interrupted', deployPause: null });
    expect(persisted.runs[0]).not.toHaveProperty('state');
    expect(persisted.events).toHaveLength(1);
  } finally {
    fileStores.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('coalesces each deploy-critical mutation into one persisted transaction', () => {
  const calls: string[] = [];
  const deps = spyPersistenceDeps(calls, createNodePersistenceDeps());
  const opened = createLeasedFileStoreForTest(
    { persistenceDepsForTest: deps }, fixture('v1-supported.json'),
  );
  try {
    expect(calls.filter((call) => call === 'rename')).toHaveLength(1); // migration
    const migrated = readDocument(opened.path);
    calls.length = 0;
    const made = opened.store.createDeployment('operator', createDeploymentFixture());
    expect(made.ok).toBe(true);
    expect(calls.filter((call) => call === 'rename')).toHaveLength(1);
    const afterCreate = readDocument(opened.path);
    expect(afterCreate.documentRevision).toBe(migrated.documentRevision + 1);
    expect(afterCreate.deployments[0].revision).toBe(1);
    expect(afterCreate.deployments[0].operationReceipts).toHaveLength(1);
    calls.length = 0;
    if (!made.ok) throw new Error(made.detail);
    const input = {
      expectedRevision: made.value.revision,
      expectedState: made.value.state,
      nextState: 'aborted',
      idempotencyKey: 'abort-1',
      patch: {
        terminalOutcome: {
          kind: 'aborted',
          at: '2026-08-20T01:00:00.000Z',
          by: 'operator',
        },
      },
    } as const;
    const first = opened.store.transitionDeployment('operator', made.value.deploymentRef, input);
    expect(first.ok).toBe(true);
    expect(calls.filter((call) => call === 'rename')).toHaveLength(1);
    const afterTransition = readDocument(opened.path);
    expect(afterTransition.documentRevision).toBe(afterCreate.documentRevision + 1);
    expect(afterTransition.deployments[0].revision).toBe(2);
    expect(afterTransition.deployments[0].operationReceipts).toHaveLength(2);
    const transitionBytes = readFileSync(opened.path);
    calls.length = 0;
    expect(opened.store.transitionDeployment('operator', made.value.deploymentRef, input))
      .toMatchObject({ ok: true, replayed: true });
    expect(calls.filter((call) => call === 'rename')).toHaveLength(0);
    expect(readFileSync(opened.path)).toEqual(transitionBytes);
    expect(opened.store.transitionDeployment('operator', made.value.deploymentRef,
      {
        ...input,
        nextState: 'failed',
        patch: {
          terminalOutcome: {
            kind: 'failed',
            at: '2026-08-20T01:00:00.000Z',
            by: 'operator',
          },
        },
      })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    expect(calls.filter((call) => call === 'rename')).toHaveLength(0);
    expect(readFileSync(opened.path)).toEqual(transitionBytes);
  } finally {
    opened.close();
  }
});

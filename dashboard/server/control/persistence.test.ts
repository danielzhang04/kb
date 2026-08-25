import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  createNodePersistenceDeps,
  fakePersistenceDeps,
  persistControlDocumentSync,
  restoreControlPlaneMigrationBackupSync,
  writeControlPlaneMigrationBackupSync,
  spyPersistenceDeps,
} from './persistence.ts';
import {
  createDeploymentFixture,
  createExistingRootFileStoreHarnessForTest,
  createLeasedFileStoreForTest,
} from './test-fixtures/controlStore.ts';
import { acquireWriterLease } from './writerLease.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(
  new URL(`../../../tests/fixtures/control-plane/${name}`, import.meta.url)), 'utf8'));

const readDocument = (path: string): Record<string, any> => JSON.parse(readFileSync(path, 'utf8'));

it('writes a SHA-keyed v2 backup and restores only checksum-matching bytes atomically', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-p2-backup-'));
  try {
    const livePath = join(root, 'control', 'control-plane.json');
    mkdirSync(join(root, 'control'), { recursive: true });
    const source = Buffer.from('{"version":2}\n', 'utf8');
    writeFileSync(livePath, source);
    const backup = writeControlPlaneMigrationBackupSync(root, source, 2, 3);
    expect(existsSync(backup.path)).toBe(true);
    expect(readFileSync(backup.path)).toEqual(source);
    writeFileSync(livePath, '{"version":3}\n', 'utf8');
    expect(() => restoreControlPlaneMigrationBackupSync(root, backup.path, undefined as never)).toThrow(/writer lease/i);
    const lease = acquireWriterLease({ stateRoot: root, bootId: 'restore-test' });
    restoreControlPlaneMigrationBackupSync(root, backup.path, lease);
    expect(readFileSync(livePath)).toEqual(source);
    writeFileSync(backup.sidecarPath, `${'0'.repeat(64)}\n`, 'utf8');
    expect(() => restoreControlPlaneMigrationBackupSync(root, backup.path, lease)).toThrow(/checksum/);
    expect(readFileSync(livePath)).toEqual(source);
    lease.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('writes and restores a generalised v3->v4 preimage backup under a writer lease [P6-C32]', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-v4-backup-'));
  try {
    const livePath = join(root, 'control', 'control-plane.json');
    mkdirSync(join(root, 'control'), { recursive: true });
    const source = Buffer.from('{"version":3,"marker":"pre-p6"}\n', 'utf8');
    writeFileSync(livePath, source);
    const backup = writeControlPlaneMigrationBackupSync(root, source, 3, 4);
    // The filename records the generalised from/to versions, not the hardcoded v2->v3.
    expect(backup.path.endsWith(`control-plane-v3-to-v4-${backup.sha256}.json`)).toBe(true);
    expect(readFileSync(backup.path)).toEqual(source);
    // A restore without a writer lease is refused; with one it republishes the exact preimage bytes.
    expect(() => restoreControlPlaneMigrationBackupSync(root, backup.path, undefined as never)).toThrow(/writer lease/i);
    writeFileSync(livePath, '{"version":4,"placementLeases":[]}\n', 'utf8');
    const lease = acquireWriterLease({ stateRoot: root, bootId: 'v4-restore' });
    restoreControlPlaneMigrationBackupSync(root, backup.path, lease);
    expect(readFileSync(livePath)).toEqual(source);
    // A tampered sidecar fails the checksum recheck and leaves the restored bytes intact.
    writeFileSync(backup.sidecarPath, `${'0'.repeat(64)}\n`, 'utf8');
    expect(() => restoreControlPlaneMigrationBackupSync(root, backup.path, lease)).toThrow(/checksum/);
    expect(readFileSync(livePath)).toEqual(source);
    lease.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
        subject: 'alice', runRef: 'run-live', predecessorRunRef: null, title: 'Live run',
        proposalRef: 'proposal-live', proposalRevision: 1, proposalHash: 'a'.repeat(64),
        publicationState: 'published', state: 'running', version: 1,
        managerSessionRef: 'manager-live', managerGeneration: 1, managerAssignment: null,
        agentWorkspaceLaunch: {
          composerRef: 'composer-grader', agentId: 'grader', declarationPath: 'agents/grader.md', declarationHash: 'a'.repeat(64),
        },
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
      p2MigrationContext: {
        agentDeclarations: [{ id: 'grader', sourcePath: 'agents/grader.md', declarationHash: 'a'.repeat(64) }],
        workflowDefinitions: [], workflowLaunchAudits: [], auditRows: [],
      },
    });
    // P6 [P6-C32]: any applied migration now also writes the preimage backup + its sidecar, so a v1 ->
    // v4 startup coalesces the crash-normalised document save (1) plus the backup pair (2) = 3 renames.
    expect(calls.filter((call) => call === 'rename')).toHaveLength(3);
    expect(calls.slice(0, 5)).toEqual(['open-temp', 'write', 'fsync-temp', 'close-temp', 'rename']);
    expect(calls.filter((call) => call === 'write')).toHaveLength(3);
    const encoded = readFileSync(path, 'utf8');
    expect(encoded.endsWith('\n')).toBe(true);
    const persisted = JSON.parse(encoded) as Record<string, any>;
    expect(persisted).toMatchObject({ version: 4, documentRevision: 1, nextEventCursor: 2 });
    expect(persisted.runs[0]).toMatchObject({
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: process.platform === 'win32' ? 'desktop' : 'vm',
      terminalOutcome: null, completedAt: null, archivedFrom: null,
    });
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
    // migration (1) + preimage backup pair (2) now coalesce into 3 renames [P6-C32].
    expect(calls.filter((call) => call === 'rename')).toHaveLength(3); // migration + backup pair
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

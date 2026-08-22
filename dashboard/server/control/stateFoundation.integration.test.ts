import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  createDeploymentFixture,
  createExistingRootFileStoreHarnessForTest,
  createLeasedFileStoreForTest,
} from './test-fixtures/controlStore.ts';

const RUN_REF = 'run-paused';
const PENDING_ACTIVATION_FIXTURE = {
  idempotencyKey: 'activate:run-paused:1',
  fingerprint: 'b'.repeat(64),
  phase: 'claimed',
  claimedAt: '2026-08-20T00:10:00.000Z',
  updatedAt: '2026-08-20T00:10:00.000Z',
} as const;

const fixture = (name: string): Record<string, any> => JSON.parse(readFileSync(fileURLToPath(
  new URL(`../../../tests/fixtures/control-plane/${name}`, import.meta.url)), 'utf8'));

const readDocument = (path: string): Record<string, any> => JSON.parse(readFileSync(path, 'utf8'));

function pausedV2Fixture({ resumeClaimBootId }: { resumeClaimBootId: string }): Record<string, any> {
  const document = fixture('v2-empty.json');
  document.runs = [{
    subject: 'operator',
    runRef: RUN_REF,
    predecessorRunRef: null,
    title: 'Paused state-foundation fixture',
    proposalRef: 'proposal-paused',
    proposalRevision: 1,
    proposalHash: 'c'.repeat(64),
    owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
    executionHost: 'desktop',
    publicationState: 'published',
    lifecycle: {
      kind: 'paused-for-deploy',
      deployPause: {
        deploymentRef: 'deploy-paused',
        pausedAt: '2026-08-20T00:05:00.000Z',
        priorKind: 'running',
        resumeStreak: 0,
        lastResumeAttemptCursor: null,
        resumeClaim: {
          deploymentRef: 'deploy-paused',
          bootId: resumeClaimBootId,
          claimantRef: 'rehydrator-1',
        },
      },
    },
    version: 3,
    managerSessionRef: 'session-manager',
    managerGeneration: 1,
    managerAssignment: null,
    agentWorkspaceLaunch: null,
    activationReceipts: [structuredClone(PENDING_ACTIVATION_FIXTURE)],
    authorizedFailedRunReconciliation: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:05:00.000Z',
  }];
  return document;
}

function readPaused(path: string): Record<string, any> {
  const run = readDocument(path).runs.find((item: Record<string, unknown>) => item.runRef === RUN_REF);
  if (!run) throw new Error('paused fixture run is absent');
  return {
    ...run,
    pendingActivation: run.activationReceipts.find(
      (receipt: Record<string, unknown>) => receipt.phase === 'claimed' || receipt.phase === 'roots-activated',
    ),
  };
}

it('backs up and migrates v2 once, commits CAS once, and reopens byte-identically', () => {
  let validationCalls = 0;
  const opened = createLeasedFileStoreForTest({
    generatedPythonRoundTripForTest: (document) => {
      validationCalls += 1;
      expect(document.version).toBe(3);
    },
  }, fixture('v2-empty.json'));
  let bytes: Buffer;
  let document: Record<string, any>;
  try {
    expect(readDocument(opened.path)).toMatchObject({
      version: 3, documentRevision: 1, scheduleCollectionRevision: 0, deployments: [], schedules: [],
    });
    expect(validationCalls).toBe(1);
    const backups = join(dirname(opened.path), 'backups');
    expect(existsSync(backups)).toBe(true);
    expect(readdirSync(backups)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^control-plane-v2-to-v3-[a-f0-9]{64}\.json$/),
      expect.stringMatching(/^control-plane-v2-to-v3-[a-f0-9]{64}\.json\.sha256$/),
    ]));
    const input = createDeploymentFixture();
    const made = opened.store.createDeployment('operator', input);
    expect(made.ok).toBe(true);
    expect(readDocument(opened.path)).toMatchObject({ documentRevision: 2, attempts: [], sessions: [] });
    bytes = readFileSync(opened.path);
    expect(opened.store.createDeployment('operator', input)).toMatchObject({ ok: true, replayed: true });
    expect(readFileSync(opened.path)).toEqual(bytes);
    document = readDocument(opened.path);
  } finally {
    opened.close();
  }

  const reopened = createLeasedFileStoreForTest({}, document!);
  try {
    expect(readFileSync(reopened.path)).toEqual(bytes!);
  } finally {
    reopened.close();
  }
});

it('aborts generated-Python prepublication validation before backup or store publication', () => {
  const root = mkdtempSync(join(tmpdir(), 'control-python-prepublish-'));
  const harness = createExistingRootFileStoreHarnessForTest();
  const path = join(root, 'control', 'control-plane.json');
  try {
    mkdirSync(dirname(path), { recursive: true });
    const source = Buffer.from(`${JSON.stringify(fixture('v2-empty.json'))}\n`, 'utf8');
    writeFileSync(path, source);
    expect(() => harness.open(root, {
      generatedPythonRoundTripForTest: () => { throw new Error('generated Python rejected clone'); },
    })).toThrow(/generated Python rejected clone/);
    expect(readFileSync(path)).toEqual(source);
    expect(existsSync(join(dirname(path), 'backups'))).toBe(false);
  } finally {
    harness.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('normalizes a stale resume claim only at construction', () => {
  const opened = createLeasedFileStoreForTest(
    {}, pausedV2Fixture({ resumeClaimBootId: 'boot-old' }), 'boot-new',
  );
  try {
    expect(readPaused(opened.path).lifecycle.deployPause.resumeClaim).toBeNull();
    expect(readPaused(opened.path).pendingActivation).toEqual(PENDING_ACTIVATION_FIXTURE);
    expect(opened.store.appendEvent('operator', RUN_REF,
      { kind: 'message', source: 'manager', summary: 'ordinary mutation' })).toMatchObject({ ok: true });
    expect(readPaused(opened.path).lifecycle.kind).toBe('paused-for-deploy');
    expect(readPaused(opened.path).pendingActivation).toEqual(PENDING_ACTIVATION_FIXTURE);
  } finally {
    opened.close();
  }
});

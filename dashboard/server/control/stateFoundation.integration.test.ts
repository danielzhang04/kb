import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  createDeploymentFixture,
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

it('migrates once, commits CAS once, and reopens byte-identically', () => {
  const opened = createLeasedFileStoreForTest({}, fixture('v1-supported.json'));
  let bytes: Buffer;
  let document: Record<string, any>;
  try {
    expect(readDocument(opened.path)).toMatchObject({ version: 2, documentRevision: 1, deployments: [] });
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

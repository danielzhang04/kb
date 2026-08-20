import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyMigrationEdgeForTest, assertMigrationEnvelope, migrateControlDocument,
} from './migrations.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(
  new URL(`../../../tests/fixtures/control-plane/${name}`, import.meta.url)), 'utf8'));

describe('control document migrations', () => {
  it('migrates v1 to v2 once and is repeat-safe', () => {
    const first = migrateControlDocument(fixture('v1-supported.json'), 2, {
      stamp: '2026-08-20T00:00:00.000Z',
    });
    expect(first.applied).toEqual([{ from: 1, to: 2, breaking: true, down: 'present' }]);
    expect(first.document).toMatchObject({ version: 2, documentRevision: 0, deployments: [] });
    const second = migrateControlDocument(first.document, 2, { stamp: '2026-08-20T00:00:00.000Z' });
    expect(second.applied).toEqual([]);
    expect(second.document).toEqual(first.document);
  });

  it('rejects future versions before mutation', () => {
    const future = fixture('future-v3.json');
    const before = structuredClone(future);
    expect(() => assertMigrationEnvelope(future)).toThrow(/unsupported control-plane version 3/);
    expect(future).toEqual(before);
  });

  it('creates missing generic collections while migrating sparse v1 data', () => {
    const migrated = migrateControlDocument(fixture('v1-sparse-legacy.json'), 2, {
      stamp: '2026-08-20T00:00:00.000Z',
    }).document as unknown as Record<string, unknown>;
    for (const field of [
      'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions',
    ]) expect(migrated[field]).toEqual([]);
  });

  it('migrates legacy attempt provenance and fails closed on a mismatched generation', () => {
    const source = fixture('v1-attempt-provenance.json') as Record<string, any>;
    const migrated = migrateControlDocument(source, 2, {
      stamp: '2026-08-20T00:00:00.000Z',
    }).document as Record<string, any>;
    expect(migrated.attempts[0]).toMatchObject({
      logicalGeneration: null, baseGenerationRef: null, baseCommit: null,
    });
    expect(migrated.attempts[0]).not.toHaveProperty('reviewSubjectGenerationRef');
    expect(migrated.attempts[0]).not.toHaveProperty('reviewSubjectResultHash');
    expect(migrated.attempts[0]).not.toHaveProperty('reviewSubjectCanonicalCommit');

    const mismatch = fixture('v1-attempt-provenance.json') as Record<string, any>;
    mismatch.stageGenerations[0].resultHash = 'e'.repeat(64);
    expect(() => migrateControlDocument(mismatch, 2, {
      stamp: '2026-08-20T00:00:00.000Z',
    })).toThrow(/checker attempt generation provenance/);
  });

  it('materializes iteration loops from legacy review stages', () => {
    const migrated = migrateControlDocument(fixture('v1-review-loops.json'), 2, {
      stamp: '2026-08-20T00:00:00.000Z',
    }).document as Record<string, any>;
    expect(migrated.iterationLoops).toHaveLength(1);
    expect(migrated.attempts[0]).toMatchObject({ state: 'interrupted', version: 2 });
    expect(migrated.stages[1]).toMatchObject({ currentAttemptRef: null, version: 2 });
  });

  it('decodes legacy review rows into iteration requests and receipts', () => {
    const migrated = migrateControlDocument(fixture('v1-review-rows.json'), 2, {
      stamp: '2026-08-20T00:00:00.000Z',
    }).document as Record<string, any>;
    expect(migrated).not.toHaveProperty('reviewLoops');
    expect(migrated).not.toHaveProperty('reviewReceipts');
    expect(migrated.iterationLoops).toHaveLength(1);
    expect(migrated.iterationRequests).toHaveLength(1);
    expect(migrated.iterationReceipts).toHaveLength(1);
    expect(migrated.generationSupersessions[0]).toHaveProperty('triggerReceiptRef', 'review-receipt-one');
    expect(migrated.generationSupersessions[0]).not.toHaveProperty('failedReviewReceiptRef');
  });

  it('migrates legacy review rows inside quarantine', () => {
    const migrated = migrateControlDocument(fixture('v1-quarantined-legacy.json'), 2, {
      stamp: '2026-08-20T00:00:00.000Z',
    }).document as Record<string, any>;
    const bundle = migrated.quarantine[0];
    expect(bundle).not.toHaveProperty('reviewLoops');
    expect(bundle).not.toHaveProperty('reviewReceipts');
    expect(bundle.iterationLoops).toHaveLength(1);
    expect(bundle.iterationRequests).toHaveLength(1);
    expect(bundle.iterationReceipts).toHaveLength(1);
  });

  it('rejects tampered legacy review outcomes instead of re-blessing them', () => {
    const tampered = fixture('v1-review-rows.json') as Record<string, any>;
    tampered.reviewReceipts[0].outcome.summary = 'Tampered after persistence.';
    expect(() => migrateControlDocument(tampered, 2, {
      stamp: '2026-08-20T00:00:00.000Z',
    })).toThrow(/invalid control-plane review receipt/);
  });

  it('measures the larger migrated representation independently of transformation assertions', () => {
    const source = fixture('v1-review-rows.json');
    const migrated = migrateControlDocument(source, 2, {
      stamp: '2026-08-20T00:00:00.000Z',
    }).document;
    expect(Buffer.byteLength(JSON.stringify(migrated), 'utf8'))
      .toBeGreaterThan(Buffer.byteLength(JSON.stringify(source), 'utf8'));
  });

  it('round-trips a terminal deployment through the present v2 down edge', () => {
    const source = fixture('v2-empty.json') as Record<string, any>;
    source.documentRevision = 7;
    source.nextEventCursor = 3;
    source.runs = [{
      subject: 'alice',
      runRef: 'run-interrupted',
      predecessorRunRef: null,
      title: 'Interrupted migration run',
      proposalRef: 'proposal-one',
      proposalRevision: 1,
      proposalHash: 'a'.repeat(64),
      publicationState: 'published',
      lifecycle: { kind: 'interrupted', deployPause: null },
      version: 4,
      managerSessionRef: 'session-manager',
      managerGeneration: 1,
      managerAssignment: null,
      agentWorkspaceLaunch: null,
      activationReceipts: [],
      authorizedFailedRunReconciliation: null,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:02:00.000Z',
    }];
    source.events = [1, 2].map((cursor) => ({
      subject: 'alice', cursor, runRef: 'run-interrupted', kind: 'lifecycle', source: 'system',
      stageRef: null, attemptRef: null, sessionRef: null,
      status: cursor === 1 ? 'running' : 'interrupted',
      summary: cursor === 1 ? 'run started' : 'run interrupted',
      command: null, toolName: null, path: null, diff: null, checkpoint: null,
      createdAt: `2026-08-20T00:0${cursor}:00.000Z`,
    }));
    source.deployments = [{
      deploymentRef: 'deploy-terminal', revision: 3, state: 'succeeded', operationReceipts: [],
    }];
    const down = applyMigrationEdgeForTest(source, 1, {
      stamp: '2026-08-20T00:00:00.000Z',
    }) as Record<string, any>;
    expect(down.runs[0].state).toBe('interrupted');
    expect(down.runs[0]).not.toHaveProperty('lifecycle');
    expect(down.events.map((event: Record<string, unknown>) => event.cursor)).toEqual([1, 2, 3]);
    expect(down.events.at(-1).runRef).toBe('__control-plane-migration__');
    const restored = applyMigrationEdgeForTest(down, 2, { stamp: '2026-08-20T00:00:00.000Z' });
    expect(restored).toEqual(source);
  });

  it('refuses the v2 down edge for nonterminal deployments and paused runs', () => {
    const nonterminal = fixture('v2-empty.json') as Record<string, any>;
    nonterminal.deployments = [{
      deploymentRef: 'deploy-live', revision: 1, state: 'requested', operationReceipts: [],
    }];
    expect(() => applyMigrationEdgeForTest(nonterminal, 1, {
      stamp: '2026-08-20T00:00:00.000Z',
    })).toThrow(/nonterminal deployment/);

    const paused = fixture('v2-empty.json') as Record<string, any>;
    paused.runs = [{
      lifecycle: {
        kind: 'paused-for-deploy',
        deployPause: {
          deploymentRef: 'deploy-live', pausedAt: '2026-08-20T00:00:00.000Z', priorKind: 'running',
          resumeStreak: 0, lastResumeAttemptCursor: null, resumeClaim: null,
        },
      },
    }];
    expect(() => applyMigrationEdgeForTest(paused, 1, {
      stamp: '2026-08-20T00:00:00.000Z',
    })).toThrow(/paused run/);
  });
});

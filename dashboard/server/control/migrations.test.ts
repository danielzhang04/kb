import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  applyMigrationEdgeForTest, assertDocumentInvariant, assertMigrationEnvelope, migrateControlDocument,
  P2RunMigrationError, runP2ScheduleStartupMigrations,
} from './migrations.ts';
import { CONTROL_PLANE_SCHEMA_VERSION, emptyControlPlaneDocument } from './generated/controlPlaneSchema.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(
  new URL(`../../../tests/fixtures/control-plane/${name}`, import.meta.url)), 'utf8'));

describe('control document migrations', () => {
  it('runs schedule startup only after Run identity/outcome and collection creation, then seeds before pause conversion', async () => {
    const phases: string[] = [];
    const marker = { version: 1 as const, releaseSha: null, seedDigest: 'a'.repeat(64), importedAt: '2026-08-22T00:00:00.000Z' };
    const openSource = vi.fn(async () => ({ available: false as const, reason: 'release-unavailable' as const }));
    const importSeeds = vi.fn(async () => { phases.push('seed-import'); return { ok: true as const, replayed: true as const, marker }; });
    const convertPauseMarkers = vi.fn(async () => { phases.push('pause-marker-conversion'); return []; });

    const report = await runP2ScheduleStartupMigrations({
      currentReleasePath: '/missing-release', existingMarker: marker,
      commitSeeds: async () => { throw new Error('replayed seed import must not commit'); },
      convertPauseMarkers,
    }, { openSource, importSeeds });

    expect(openSource).toHaveBeenCalledWith({ currentPath: '/missing-release' });
    expect(phases).toEqual(['seed-import', 'pause-marker-conversion']);
    expect(report.phases).toEqual(['identity', 'outcome', 'schedule-collections', 'seed-import', 'pause-marker-conversion']);
    expect(report.source).toEqual({ available: false, reason: 'release-unavailable' });
  });

  const p2Run = (overrides: Record<string, unknown> = {}) => ({
    subject: 'operator', runRef: 'run-p2', predecessorRunRef: null, title: 'P2 fixture',
    proposalRef: 'proposal-p2', proposalRevision: 1, proposalHash: 'a'.repeat(64),
    publicationState: 'published', lifecycle: { kind: 'running', deployPause: null }, version: 1,
    managerSessionRef: 'session-manager', managerGeneration: 1, managerAssignment: null,
    agentWorkspaceLaunch: null, activationReceipts: [], authorizedFailedRunReconciliation: null,
    createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  });

  it('exposes exact owner/outcome abort codes for host contradictions and partial P2 outcomes', () => {
    const host = fixture('v2-empty.json') as Record<string, any>;
    host.runs = [p2Run({
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, executionHost: 'desktop',
      terminalOutcome: null, completedAt: null, archivedFrom: null,
    })];
    try {
      migrateControlDocument(host, 3, {
        stamp: '2026-08-21T00:00:00.000Z', executionHost: 'vm',
        agentDeclarations: [], workflowDefinitions: [], workflowLaunchAudits: [], auditRows: [],
      });
      throw new Error('expected host contradiction');
    } catch (error) {
      expect(error).toBeInstanceOf(P2RunMigrationError);
      expect((error as P2RunMigrationError).code).toBe('run-owner-migration-required');
    }

    const partial = fixture('v2-empty.json') as Record<string, any>;
    partial.runs = [p2Run({
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, executionHost: 'desktop',
      terminalOutcome: 'ok',
    })];
    try {
      migrateControlDocument(partial, 3, {
        stamp: '2026-08-21T00:00:00.000Z', executionHost: 'desktop',
        agentDeclarations: [], workflowDefinitions: [], workflowLaunchAudits: [], auditRows: [],
      });
      throw new Error('expected partial outcome refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(P2RunMigrationError);
      expect((error as P2RunMigrationError).code).toBe('run-outcome-migration-required');
    }
    expect(() => migrateControlDocument(partial, 3, {
      stamp: '2026-08-21T00:00:00.000Z', executionHost: 'desktop', sourceSha256: 'f'.repeat(64),
      agentDeclarations: [], workflowDefinitions: [], workflowLaunchAudits: [], auditRows: [],
      explicitMapping: { storeSha256: 'f'.repeat(64), runs: {
        'run-p2': {
          owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, executionHost: 'desktop',
          terminalOutcome: 'ok', completedAt: '2026-08-21T00:00:00.000Z', archivedFrom: null,
        },
      } },
    })).toThrow(/run-outcome-migration-required/);
  });

  it('passes non-activation run mutation receipts into terminal-order inference', () => {
    const source = fixture('v2-empty.json') as Record<string, any>;
    source.runs = [p2Run({
      lifecycle: { kind: 'succeeded', deployPause: null },
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, executionHost: 'desktop',
    })];
    source.sessions = [{
      subject: 'operator', runRef: 'run-p2', brokerReceipts: [{ createdAt: '2026-08-21T00:01:00.000Z' }],
    }];
    expect(() => migrateControlDocument(source, 3, {
      stamp: '2026-08-21T00:00:00.000Z', executionHost: 'desktop',
      agentDeclarations: [], workflowDefinitions: [], workflowLaunchAudits: [], auditRows: [],
    })).toThrow(/run-outcome-migration-required/);
  });

  it('migrates v2 to v3 and round-trips every P2 addition through the checksummed down carrier', () => {
    const source = fixture('v2-empty.json') as Record<string, any>;
    const migrated = migrateControlDocument(source, 3, {
      stamp: '2026-08-21T00:00:00.000Z',
    }).document as unknown as Record<string, any>;
    expect(migrated).toMatchObject({ version: 3, scheduleCollectionRevision: 0 });
    expect(migrated.schedules).toEqual([]);
    expect(migrated.scheduleTombstones).toEqual([]);
    expect(migrated.scheduleOccurrenceClaims).toEqual([]);
    expect(migrated.scheduleSeedImports).toEqual([]);

    const identity = {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop', terminalOutcome: 'interrupted',
      completedAt: '2026-08-21T00:00:00.000Z', archivedFrom: 'interrupted',
    };
    migrated.runs.push({ runRef: 'run-active', ...identity });
    migrated.quarantine.push({ run: { runRef: 'run-quarantined', ...identity } });
    migrated.scheduleCollectionRevision = 4;
    migrated.schedules.push({ id: 'schedule-one', privateSeedBytes: 'exact-bytes' });
    const down = applyMigrationEdgeForTest(migrated, 2, {
      stamp: '2026-08-21T00:00:00.000Z',
    }) as Record<string, any>;
    expect(down.version).toBe(2);
    expect(down).not.toHaveProperty('schedules');
    expect(down.events.at(-1).summary).toMatch(/^kb\.control-plane-v3-down-carrier\/v1:/);
    expect(applyMigrationEdgeForTest(down, 3, { stamp: '2026-08-21T00:00:00.000Z' }))
      .toEqual(migrated);
  });

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
    const future = fixture('future-v3.json') as Record<string, unknown>;
    future.version = 5;
    const before = structuredClone(future);
    expect(() => assertMigrationEnvelope(future)).toThrow(/unsupported control-plane version 5/);
    expect(future).toEqual(before);
  });

  // ---- P6 W1: the additive v3 -> v4 placement migration, its byte-identical rollback, and the
  // ---- chained ladder that reaches v4 from v1 and v2 [P6-C23, P6-C32, P6-C37, P6-C48]. -------------
  const ctx = { stamp: '2026-08-24T00:00:00.000Z' };
  const emptyV3 = (): Record<string, any> =>
    applyMigrationEdgeForTest(emptyControlPlaneDocument(), 3, ctx) as Record<string, any>;

  it('migrates a pre-P6 v3 document to v4 with three empty placement collections, advancing once', () => {
    const v3 = emptyV3();
    expect(v3.version).toBe(3);
    expect(v3).not.toHaveProperty('hostAdvertisements');
    const result = migrateControlDocument(v3, 4, ctx);
    expect(result.document.version).toBe(4);
    expect(result.document.hostAdvertisements).toEqual([]);
    expect(result.document.placementLeases).toEqual([]);
    expect(result.document.v1Idempotency).toEqual([]);
    expect(result.applied).toEqual([{ from: 3, to: 4, breaking: true, down: 'present' }]);
    assertDocumentInvariant(result.document);
  });

  it('rolls a v4 document back to a BYTE-IDENTICAL v3 through the paired down edge', () => {
    const v3 = emptyV3();
    const before = JSON.stringify(v3);
    const v4 = applyMigrationEdgeForTest(structuredClone(v3), 4, ctx);
    expect((v4 as Record<string, any>).version).toBe(4);
    const back = applyMigrationEdgeForTest(v4, 3, ctx);
    expect(JSON.stringify(back)).toBe(before);
  });

  it('exposes the single-step 3->4 and 4->3 migration edges', () => {
    const up = applyMigrationEdgeForTest(emptyV3(), 4, ctx) as Record<string, any>;
    expect(up.version).toBe(4);
    expect(Object.keys(up).slice(-3)).toEqual(['hostAdvertisements', 'placementLeases', 'v1Idempotency']);
    const down = applyMigrationEdgeForTest(up, 3, ctx) as Record<string, any>;
    expect(down.version).toBe(3);
    expect(down).not.toHaveProperty('placementLeases');
  });

  it('chains v1 -> v4 in one call (fails today with no control-plane migration path)', () => {
    const result = migrateControlDocument(fixture('v1-sparse-legacy.json'), 4, ctx);
    expect(result.document.version).toBe(4);
    expect(result.applied.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['1->2', '2->3', '3->4']);
    expect(result.document.hostAdvertisements).toEqual([]);
    expect(result.document.placementLeases).toEqual([]);
    expect(result.document.v1Idempotency).toEqual([]);
  });

  it('chains v2 -> v4 in one call (fails today with no control-plane migration path)', () => {
    const result = migrateControlDocument(fixture('v2-empty.json'), 4, ctx);
    expect(result.document.version).toBe(4);
    expect(result.applied.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['2->3', '3->4']);
    expect(result.document.v1Idempotency).toEqual([]);
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

describe('P5 asset-pull intents are additive with no version bump [P5-C34]', () => {
  const AT = '2026-08-20T00:00:00.000Z';
  const intent = {
    intentRef: `assetpull-${'0'.repeat(32)}`, runRef: 'run-1', manifestDigest: 'a'.repeat(64),
    state: 'pending', requestedAt: AT, attempts: 0, result: null,
  };

  it('reads a pre-P5 document that lacks the collection, at the unchanged version', () => {
    const preP5 = emptyControlPlaneDocument();
    expect(Object.hasOwn(preP5, 'assetPullIntents')).toBe(false);
    expect(() => assertDocumentInvariant(preP5)).not.toThrow();
    expect(preP5.version).toBe(CONTROL_PLANE_SCHEMA_VERSION); // 3 — no schema bump, no migration.
  });

  it('validates a present asset-pull collection on the same versioned document', () => {
    const withIntents = { ...emptyControlPlaneDocument(), assetPullIntents: [intent] };
    expect(() => assertDocumentInvariant(withIntents)).not.toThrow();
    expect(withIntents.version).toBe(CONTROL_PLANE_SCHEMA_VERSION);
  });

  it('rejects a malformed asset-pull collection without changing the version wall', () => {
    const bad = { ...emptyControlPlaneDocument(), assetPullIntents: [{ ...intent, extra: 1 }] };
    expect(() => assertDocumentInvariant(bad)).toThrow(/asset-pull/);
    const dup = { ...emptyControlPlaneDocument(), assetPullIntents: [intent, { ...intent }] };
    expect(() => assertDocumentInvariant(dup)).toThrow(/asset-pull/);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  CONTROL_PLANE_ACCEPTED_SIZE_FILENAME,
  ControlStoreLimitError,
  AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT,
  AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF,
  AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF,
  AUTHORIZED_20260731_EXECUTION_LOCK_TITLE,
  AUTHORIZED_20260801_FAILED_RUN_STAGES,
  AUTHORIZED_20260801_FAILED_RUN_FINGERPRINT,
  AUTHORIZED_20260801_FAILED_RUN_INPUT,
  AUTHORIZED_20260801_FAILED_RUN_REF,
  createFileControlPlaneStore,
  createInMemoryControlPlaneStore,
  emptyStoreDocumentForTest,
  exactAuthorized20260801ProposalRevision,
  proposalSnapshotHash,
} from './store.ts';
import { CONTROL_PLANE_COLLECTIONS } from './generated/controlPlaneSchema.ts';
import { applyMigrationEdgeForTest, loadAndMigrate } from './migrations.ts';
import { createNodePersistenceDeps } from './persistence.ts';
import type { CanonicalStageProjectionInput, ControlPlaneStore } from './store.ts';
import type { JsonObject, ProposalRevision, Run } from './types.ts';

const roots: string[] = [];
const SOURCE = { sourceComposerRef: 'composer-1', sourceTurnId: 'turn-1' } as const;

function persistedV1(value: unknown): any {
  return applyMigrationEdgeForTest(value, 1, { stamp: '2026-08-20T00:00:00.000Z' });
}

function largeV1MigrationSource(stamp = '2026-08-20T00:00:00.000Z') {
  return {
    version: 1,
    nextEventCursor: 1,
    proposals: [],
    runs: Array.from({ length: 64 }, (_, index) => ({
      subject: 'alice', runRef: `run-large-${index}`, predecessorRunRef: null,
      title: `Large run ${index}`, proposalRef: `proposal-${index}`, proposalRevision: 1,
      proposalHash: `${index.toString(16).padStart(2, '0')}${'a'.repeat(62)}`,
      publicationState: 'published', state: 'succeeded', version: 1,
      managerSessionRef: `manager-${index}`, managerGeneration: 1,
      createdAt: stamp, updatedAt: stamp,
    })),
    stages: [], attempts: [], sessions: [], humanRequests: [], events: [],
    stageGenerations: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [],
    generationSupersessions: [], quarantine: [],
  };
}

it('binds store collection keys to the generated control-plane manifest', () => {
  const listKeys = Object.entries(emptyStoreDocumentForTest())
    .filter(([, value]) => Array.isArray(value))
    .map(([key]) => key)
    .sort();
  expect(listKeys).toEqual([...CONTROL_PLANE_COLLECTIONS].sort());
});

describe('authorized 2026-08-01 proposal provenance', () => {
  const snapshot = JSON.parse(readFileSync(join(
    process.cwd(), 'server', 'control', 'test-fixtures', 'authorized-20260801-fyt-proposal.json',
  ), 'utf8')) as JsonObject;
  // Ownerless shape: the frozen historical comparison pins source/title/timestamp/approval fields only,
  // and never looks at which subject owns the revision.
  const exact: Omit<ProposalRevision, 'ownerSubject'> = {
    proposalRef: 'proposal-3725fb98-e20e-4619-b6e7-c9055138a50d', sourceComposerRef: 'workflow-registry',
    sourceTurnId: 'thin-slice-run', revision: 1,
    hash: '396480363d02620c25730160e00fd7adf51e1eff43f8427c80b2062a18dc80d9', previousHash: null,
    title: 'Validate one all-Codex faceless-video opening slice', createdAt: '2026-08-01T02:04:02.673Z', snapshot,
    approval: {
      revision: 1, decision: 'approved', decidedBy: 'operator',
      idempotencyKey: 'agent-workspace-launch:4c9aa9e0-92fe-4f66-a0e3-dd36f29d7960:thin-slice-run:f481bfb5-584d-4200-b0f1-8b1fc0556209:decision',
      decidedAt: '2026-08-01T02:04:03.315Z', note: null,
    },
  };

  it('pins every historical source, title, timestamp, and approval field', () => {
    expect(exactAuthorized20260801ProposalRevision(exact)).toBe(true);
    for (const drifted of [
      { ...exact, sourceComposerRef: 'other-registry' },
      { ...exact, sourceTurnId: 'other-turn' },
      { ...exact, title: `${exact.title} drift` },
      { ...exact, createdAt: '2026-08-01T02:04:02.674Z' },
      { ...exact, approval: { ...exact.approval!, decidedAt: '2026-08-01T02:04:03.316Z' } },
      { ...exact, approval: { ...exact.approval!, note: 'unexpected' } },
      { ...exact, approval: { ...exact.approval!, extra: true } as unknown as ProposalRevision['approval'] },
    ]) expect(exactAuthorized20260801ProposalRevision(drifted)).toBe(false);
  });

  /**
   * THE SEAM THIS SUITE WAS MISSING, and the reason a live settlement refused: the fixture snapshot
   * OMITS the optional stage keys (`workflowProfile`/`review`/`completionGate`), while the load-time
   * normalizer fills them with null on the stored stage and persists that. A raw compare therefore
   * read `null !== undefined` on all 13 stages and reported the untouched historical run as drifted.
   * The document below is written WITHOUT those keys and then loaded through the real file store, so
   * it is checked in exactly the shape a restarted daemon holds.
   */
  const RUN_REF = 'run-0aa72053-b9d7-41fa-a034-19871b66d214';
  const REQUEST_REF = 'request-86d0fc5f-797b-483c-a706-96a45e6f4d6e';
  const MANAGER_SESSION_REF = 'session-54ef91fa-6607-4f0e-a2f6-f9edd87873bb';
  const CREATED_AT = '2026-08-01T02:04:03.640Z';
  const EVENT_ROWS = [
    { cursor: 1, kind: 'governance', source: 'system', status: 'waiting', summary: 'canonical run published; runtime activation remains gated', stageRef: null, attemptRef: null, sessionRef: null, createdAt: '2026-08-01T02:04:04.767Z' },
    { cursor: 2, kind: 'governance', source: 'human', status: 'success', summary: 'authorized 2026-07-31 execution-lock boundary reclassified to intervention', stageRef: null, attemptRef: null, sessionRef: null, createdAt: '2026-08-01T03:31:39.866Z' },
    { cursor: 3, kind: 'governance', source: 'human', status: 'success', summary: 'Human Request responded at revision 2', stageRef: null, attemptRef: null, sessionRef: null, createdAt: '2026-08-01T03:32:43.924Z' },
    { cursor: 4, kind: 'lifecycle', source: 'worker', status: 'failure', summary: 'Codex workspace contains an unsupported changed path', stageRef: 'stage-ea9da6f4-2b54-4664-a4ae-f2a47885e51b', attemptRef: 'attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7', sessionRef: 'session-8445469e-a733-4a66-908f-b6a58f513323', createdAt: '2026-08-01T03:32:49.322Z' },
    { cursor: 5, kind: 'lifecycle', source: 'system', status: 'interrupted', summary: 'dashboard restarted; active control-plane records were normalized to interrupted', stageRef: null, attemptRef: null, sessionRef: null, createdAt: '2026-08-01T08:18:11.696Z' },
  ];

  /** The historical document as a restarted daemon persists it, minus the normalizer-filled keys. */
  function historicalDocument(): Record<string, any> {
    const snapshotStages = (snapshot as unknown as { stages: Array<Record<string, any>> }).stages;
    const stages = AUTHORIZED_20260801_FAILED_RUN_STAGES.map((expected) => {
      const source = snapshotStages.find((candidate) => candidate.id === expected.stageId);
      if (!source) throw new Error(`fixture snapshot is missing stage ${expected.stageId}`);
      const idea = expected.stageId === 'idea';
      return {
        stage: {
          subject: 'operator', stageRef: expected.stageRef, runRef: RUN_REF, stageId: expected.stageId,
          title: source.title, dependsOn: [...source.dependsOn], canonicalCardRef: expected.cardRef,
          state: idea ? 'failed' : 'blocked', version: idea ? 5 : 3,
          currentAttemptRef: expected.attemptRef, assignment: structuredClone(source.assignment),
          // workflowProfile / review / completionGate deliberately ABSENT: the snapshot omits them and
          // so did the persisted document until the load-time normalizer filled them with null.
          currentGeneration: 1, currentGenerationRef: null, acceptedGenerationRef: null,
          createdAt: CREATED_AT, updatedAt: '2026-08-01T03:32:49.635Z',
        },
        attempt: {
          subject: 'operator', attemptRef: expected.attemptRef, runRef: RUN_REF, stageRef: expected.stageRef,
          generation: 1, predecessorAttemptRef: null, runtime: expected.runtime, model: expected.model,
          state: idea ? 'failed' : 'queued', version: idea ? 5 : 2, managedSessionRef: expected.sessionRef,
          reviewSubjectGenerationRef: null, reviewSubjectResultHash: null, reviewSubjectCanonicalCommit: null,
          logicalGeneration: null, baseGenerationRef: null, baseCommit: null,
          createdAt: CREATED_AT, updatedAt: '2026-08-01T03:32:49.635Z',
        },
        session: {
          subject: 'operator', operationKey: null, operationFingerprint: null, sessionRef: expected.sessionRef,
          runRef: RUN_REF, stageRef: expected.stageRef, attemptRef: expected.attemptRef, role: 'worker',
          generation: 1, predecessorSessionRef: null, runtime: expected.runtime, model: expected.model,
          state: idea ? 'failed' : 'pending', version: idea ? 4 : 1,
          createdAt: CREATED_AT, updatedAt: '2026-08-01T03:32:49.635Z',
        },
      };
    });
    return {
      version: 1,
      nextEventCursor: 6,
      proposals: [{ subject: 'operator', ...structuredClone(exact) }],
      runs: [{
        subject: 'operator',
        launchOperationKey: 'agent-workspace-launch:4c9aa9e0-92fe-4f66-a0e3-dd36f29d7960:thin-slice-run:f481bfb5-584d-4200-b0f1-8b1fc0556209',
        launchOperationFingerprint: '664ccc0a8734e5d5bdcaebb834aa656c609be49107ccfa44d784a309ff886600',
        activationReceipts: [{
          idempotencyKey: `activate:${RUN_REF}:4:${exact.hash}:1`,
          fingerprint: '9e81be057acedd88e8fd4a5d9cf7c3aa0420db0ee9e274c63fd1a3e322acf205',
          phase: 'dispatched', claimedAt: '2026-08-01T03:32:45.859Z', updatedAt: '2026-08-01T03:32:47.623Z',
        }],
        runRef: RUN_REF, predecessorRunRef: null, title: exact.title,
        proposalRef: exact.proposalRef, proposalRevision: 1, proposalHash: exact.hash,
        publicationState: 'published', state: 'failed', version: 7,
        managerSessionRef: MANAGER_SESSION_REF, managerGeneration: 1,
        managerAssignment: {
          agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md',
          declarationHash: 'ba119796897f72495ba8dadcb8ca78a4be352e88e6f7ef42c74823fe1b048fc0',
          profileId: 'manager:codex:gpt-5.6-sol', runtime: 'codex', model: 'gpt-5.6-sol',
        },
        agentWorkspaceLaunch: {
          composerRef: '4c9aa9e0-92fe-4f66-a0e3-dd36f29d7960', agentId: 'fyt-runner',
          declarationPath: 'agents/fyt-runner.md',
          declarationHash: 'ba119796897f72495ba8dadcb8ca78a4be352e88e6f7ef42c74823fe1b048fc0',
        },
        createdAt: CREATED_AT, updatedAt: '2026-08-01T03:32:49.635Z',
      }],
      stages: stages.map((row) => row.stage),
      attempts: stages.map((row) => row.attempt),
      sessions: [
        {
          subject: 'operator', operationKey: null, operationFingerprint: null, sessionRef: MANAGER_SESSION_REF,
          runRef: RUN_REF, stageRef: null, attemptRef: null, role: 'manager', generation: 1,
          predecessorSessionRef: null, runtime: 'codex', model: 'gpt-5.6-sol', state: 'interrupted', version: 4,
          createdAt: CREATED_AT, updatedAt: '2026-08-01T08:18:11.696Z',
        },
        ...stages.map((row) => row.session),
      ],
      humanRequests: [{
        subject: 'operator', requestRef: REQUEST_REF, runRef: RUN_REF, stageRef: null, kind: 'intervention',
        revision: 2, state: 'resolved', title: AUTHORIZED_20260731_EXECUTION_LOCK_TITLE,
        prompt: AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT,
        response: {
          requestRevision: 2, decision: 'responded', respondedBy: 'operator',
          idempotencyKey: `human:${REQUEST_REF}:2:responded`, response: null,
          respondedAt: '2026-08-01T03:32:43.921Z',
        },
        operationKey: null, operationFingerprint: null, resolutionOperationFingerprint: null,
        legacyRecoveryOperationKey: `legacy-execution-lock-recovery:${RUN_REF}:${REQUEST_REF}:r1`,
        legacyRecoveryOperationFingerprint: '67abeff66b673f7eb834236a928790c0ac4b8f73f2f9472cbeda523989cdc3c3',
        legacyRecoveryEventCursor: 2,
        createdAt: '2026-08-01T02:04:04.762Z', updatedAt: '2026-08-01T03:32:43.921Z',
      }],
      events: EVENT_ROWS.map((event) => ({
        subject: 'operator', runRef: RUN_REF, command: null, toolName: null, path: null,
        diff: null, checkpoint: null, ...event,
      })),
      stageGenerations: [], reviewLoops: [], reviewReceipts: [], generationSupersessions: [], quarantine: [],
    };
  }

  it('classifies the historical run as claimable after the real normalizer has filled its stage keys', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-settlement-normalized-'));
    roots.push(root);
    const path = join(root, 'control', 'control-plane.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(historicalDocument())}\n`, 'utf8');

    const store = createFileControlPlaneStore(root);
    const normalized = JSON.parse(readFileSync(path, 'utf8')) as { stages: Array<Record<string, unknown>> };
    // The normalizer really did fill and PERSIST the keys the snapshot omits — the exact asymmetry
    // that made classify report conflict.
    expect(normalized.stages).toHaveLength(13);
    for (const stage of normalized.stages) {
      expect(stage).toMatchObject({ workflowProfile: null, review: null, completionGate: null });
    }

    expect(store.preflightAuthorized20260801FailedRunReconciliation('operator', AUTHORIZED_20260801_FAILED_RUN_INPUT))
      .toMatchObject({ ok: true, value: { disposition: 'eligible', receipt: null, result: null } });

    // Re-opening changes nothing: the same document stays claimable across restarts.
    expect(createFileControlPlaneStore(root)
      .preflightAuthorized20260801FailedRunReconciliation('operator', AUTHORIZED_20260801_FAILED_RUN_INPUT))
      .toMatchObject({ ok: true, value: { disposition: 'eligible' } });
  });

  it('still refuses when a stage carries a checker contract the approved snapshot never had', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-settlement-drift-'));
    roots.push(root);
    const path = join(root, 'control', 'control-plane.json');
    mkdirSync(dirname(path), { recursive: true });
    const drifted = historicalDocument();
    drifted.stages[6].workflowProfile = 'checker-readonly';
    writeFileSync(path, `${JSON.stringify(drifted)}\n`, 'utf8');

    expect(createFileControlPlaneStore(root)
      .preflightAuthorized20260801FailedRunReconciliation('operator', AUTHORIZED_20260801_FAILED_RUN_INPUT))
      .toMatchObject({ ok: false, reason: 'conflict' });
  });
});
const MANAGER_ASSIGNMENT = {
  agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'a'.repeat(64),
  profileId: 'claude:manager', runtime: 'claude' as const, model: 'claude-sonnet-5',
};
const BUILD_ASSIGNMENT = {
  agentId: 'fyt-builder', declarationPath: 'agents/fyt-builder.md', declarationHash: 'b'.repeat(64),
  profileId: 'codex:worker', runtime: 'codex' as const, model: 'gpt-5.6-sol',
};
const VERIFY_ASSIGNMENT = {
  agentId: 'fyt-verifier', declarationPath: 'agents/fyt-verifier.md', declarationHash: 'c'.repeat(64),
  profileId: 'claude:worker', runtime: 'claude' as const, model: 'claude-sonnet-5',
};
const CHECKER_REVIEW = {
  subjectStageId: 'build', maxCreatorReworks: 1,
  criteria: [{ id: 'grounded', description: 'Citations are grounded in the source material.' }],
};
const CHECKER_COMPLETION_GATE = {
  id: 'approve-check', kind: 'approval' as const, prompt: 'Approve the checker result.', requiresReview: 'pass' as const,
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('authorized 2026-07-31 execution-lock recovery', () => {
  const recoveryInput = {
    expectedRunVersion: 4,
    expectedManagerGeneration: 1,
    expectedRequestRevision: 1,
    idempotencyKey: 'authorized-legacy-execution-lock-recovery',
  };

  it('atomically reclassifies only the exact never-started request and survives restart replay', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-legacy-recovery-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, authorizedLegacyOptions());
    seedAuthorizedLegacyExecutionLock(store);
    const legacyPath = join(root, 'control', 'control-plane.json');
    writeFileSync(legacyPath, `${JSON.stringify(persistedV1(JSON.parse(readFileSync(legacyPath, 'utf8'))))}\n`, 'utf8');
    const normalized = createFileControlPlaneStore(root);
    const normalizedDocument = JSON.parse(readFileSync(join(root, 'control', 'control-plane.json'), 'utf8')) as {
      humanRequests: Array<Record<string, unknown>>;
    };
    expect(normalizedDocument.humanRequests.find((request) =>
      request.requestRef === AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF)).toMatchObject({
      legacyRecoveryOperationKey: null,
      legacyRecoveryOperationFingerprint: null,
      legacyRecoveryEventCursor: null,
    });
    expect(normalized.preflightAuthorized20260731ExecutionLock('operator', recoveryInput)).toMatchObject({
      ok: true, value: { disposition: 'eligible', result: null },
    });
    const recovered = normalized.recoverAuthorized20260731ExecutionLock('operator', recoveryInput);
    expect(recovered).toMatchObject({
      ok: true,
      value: {
        request: {
          requestRef: AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF,
          runRef: AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF,
          kind: 'intervention', revision: 2, state: 'open', response: null,
          prompt: AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT,
        },
        event: { kind: 'governance', source: 'human', status: 'success' },
      },
    });
    expect(JSON.stringify(recovered)).not.toContain('legacyRecoveryOperation');
    const restarted = createFileControlPlaneStore(root);
    expect(restarted.preflightAuthorized20260731ExecutionLock('operator', recoveryInput)).toMatchObject({
      ok: true, value: { disposition: 'replay', result: { request: { state: 'open' } } },
    });
    expect(restarted.reviseHumanRequest(
      'operator', AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF, 2,
      'Changed', 'Changed',
    )).toMatchObject({ ok: false, reason: 'invalid' });
    const responded = restarted.respondHumanRequest('operator', AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF, {
      expectedRevision: 2, decision: 'responded', idempotencyKey: 'respond-after-recovery',
    });
    expect(responded).toMatchObject({ ok: true, value: { state: 'resolved', response: { decision: 'responded' } } });
    expect(restarted.recoverAuthorized20260731ExecutionLock('operator', recoveryInput)).toMatchObject({
      ok: true, replayed: true, value: {
        request: { revision: 2, kind: 'intervention', state: 'resolved', response: { decision: 'responded' } },
      },
    });
    expect(restarted.listEvents('operator', AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF)).toMatchObject({
      ok: true, value: [
        expect.objectContaining({ summary: 'canonical run published; runtime activation remains gated' }),
        expect.objectContaining({ summary: 'authorized 2026-07-31 execution-lock boundary reclassified to intervention' }),
      ],
    });
  });

  it('refuses marker drift and a progressed attempt without changing the request', () => {
    const markerStore = createInMemoryControlPlaneStore(authorizedLegacyOptions());
    const marker = seedAuthorizedLegacyExecutionLock(markerStore);
    const revised = markerStore.reviseHumanRequest(
      'operator', marker.request.requestRef, marker.request.revision,
      marker.request.title, `${marker.request.prompt} drift`,
    );
    if (!revised.ok) throw new Error(revised.detail);
    expect(markerStore.preflightAuthorized20260731ExecutionLock('operator', recoveryInput)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(markerStore.recoverAuthorized20260731ExecutionLock('operator', recoveryInput)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(markerStore.getHumanRequest('operator', marker.request.requestRef)).toMatchObject({
      ok: true, value: { kind: 'governance-refusal', revision: 2, state: 'open' },
    });

    const progressedStore = createInMemoryControlPlaneStore(authorizedLegacyOptions());
    const progressed = seedAuthorizedLegacyExecutionLock(progressedStore);
    const firstAttempt = progressed.detail.attempts[0];
    if (!firstAttempt) throw new Error('expected attempt');
    const starting = progressedStore.transitionAttempt('operator', firstAttempt.attemptRef, firstAttempt.version, 'starting');
    if (!starting.ok) throw new Error(starting.detail);
    expect(progressedStore.preflightAuthorized20260731ExecutionLock('operator', recoveryInput)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(progressedStore.recoverAuthorized20260731ExecutionLock('operator', recoveryInput)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(progressedStore.getHumanRequest('operator', progressed.request.requestRef)).toMatchObject({
      ok: true, value: { kind: 'governance-refusal', revision: 1, state: 'open' },
    });
  });

  it('rejects incoherent private recovery receipts in active and quarantined documents', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-legacy-recovery-validation-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, authorizedLegacyOptions());
    seedAuthorizedLegacyExecutionLock(store);
    const recovered = store.recoverAuthorized20260731ExecutionLock('operator', recoveryInput);
    if (!recovered.ok) throw new Error(recovered.detail);
    const path = join(root, 'control', 'control-plane.json');
    const original = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;

    const partial = structuredClone(original);
    partial.humanRequests[0].legacyRecoveryOperationFingerprint = null;
    writeFileSync(path, `${JSON.stringify(partial)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/authorized legacy recovery receipt/);

    const wrongCursor = structuredClone(original);
    wrongCursor.humanRequests[0].legacyRecoveryEventCursor = 999;
    writeFileSync(path, `${JSON.stringify(wrongCursor)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/authorized legacy recovery event/);

    const quarantined = structuredClone(original);
    const run = quarantined.runs[0];
    const runRef = run.runRef;
    quarantined.quarantine = [{
      subject: 'operator', quarantinedAt: '2026-08-01T03:00:00.000Z', run,
      stages: quarantined.stages.filter((item: Record<string, unknown>) => item.runRef === runRef),
      attempts: quarantined.attempts.filter((item: Record<string, unknown>) => item.runRef === runRef),
      sessions: quarantined.sessions.filter((item: Record<string, unknown>) => item.runRef === runRef),
      humanRequests: quarantined.humanRequests.filter((item: Record<string, unknown>) => item.runRef === runRef),
      events: quarantined.events.filter((item: Record<string, unknown>) => item.runRef === runRef),
      stageGenerations: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [], generationSupersessions: [],
    }];
    for (const field of ['runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions']) {
      quarantined[field] = (quarantined[field] as Array<Record<string, unknown>>).filter((item) => item.runRef !== runRef);
    }
    writeFileSync(path, `${JSON.stringify(quarantined)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).not.toThrow();
    quarantined.quarantine[0].humanRequests[0].legacyRecoveryEventCursor = null;
    writeFileSync(path, `${JSON.stringify(quarantined)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/authorized legacy recovery receipt/);
  });
});

function deterministicOptions() {
  let id = 0;
  let second = 0;
  return {
    newId: () => String(++id),
    now: () => new Date(Date.UTC(2026, 6, 18, 12, 0, second++)),
  };
}

const LEGACY_STAGE_IDS = [
  'idea', 'story', 'judge-gate', 'packaging', 'visual-plan', 'shots-merge', 'slice-contract',
  'images', 'image-review', 'audio', 'audio-plan-merge', 'render', 'verify',
] as const;
const LEGACY_SOL_STAGES = new Set(['judge-gate', 'shots-merge', 'slice-contract', 'image-review', 'audio-plan-merge', 'verify']);

function authorizedLegacyOptions() {
  let id = 0;
  return {
    newId: () => {
      id += 1;
      if (id === 2) return AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF.slice('run-'.length);
      if (id === 43) return AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF.slice('request-'.length);
      return `legacy-${id}`;
    },
    now: () => new Date(Date.UTC(2026, 7, 1, 2, 4, id)),
  };
}

function seedAuthorizedLegacyExecutionLock(store: ControlPlaneStore) {
  const stageSpecs = LEGACY_STAGE_IDS.map((stageId, index) => ({
    id: stageId,
    title: stageId,
    dependsOn: index === 0 ? [] : [LEGACY_STAGE_IDS[index - 1]],
  }));
  const proposal = createApprovedProposal(store, 'operator', {
    schema: 'kb.plan-proposal/v1', title: 'Validate one all-Codex faceless-video opening slice', manager: {}, stages: stageSpecs,
  });
  const created = store.createRun('operator', {
    title: 'Validate one all-Codex faceless-video opening slice', proposalRef: proposal.proposalRef,
    proposalRevision: proposal.revision, expectedProposalHash: proposal.hash,
    managerRuntime: 'codex', managerModel: 'gpt-5.6-sol', idempotencyKey: 'legacy-launch',
    stages: stageSpecs.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
  });
  if (!created.ok) throw new Error(created.detail);
  expect(created.value.run.runRef).toBe(AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF);
  const publishing = store.transitionPublication('operator', created.value.run.runRef, created.value.run.version, 'publishing');
  if (!publishing.ok) throw new Error(publishing.detail);
  const published = store.transitionPublication('operator', created.value.run.runRef, publishing.value.version, 'published');
  if (!published.ok) throw new Error(published.detail);
  const waiting = store.transitionRun('operator', created.value.run.runRef, published.value.version, 'waiting-human');
  if (!waiting.ok) throw new Error(waiting.detail);
  let detail = store.getRun('operator', created.value.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  for (const stage of detail.value.stages) {
    const linked = store.linkStageCard('operator', stage.stageRef, stage.version, `wf-${stage.stageId}`);
    if (!linked.ok) throw new Error(linked.detail);
    const attempt = store.createAttempt('operator', stage.stageRef, {
      expectedStageVersion: linked.value.version,
      runtime: 'codex',
      model: LEGACY_SOL_STAGES.has(stage.stageId) ? 'gpt-5.6-sol' : 'gpt-5.6-terra',
    });
    if (!attempt.ok) throw new Error(attempt.detail);
    const session = store.createWorkerSession('operator', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
    if (!session.ok) throw new Error(session.detail);
  }
  const request = store.createHumanRequest('operator', created.value.run.runRef, {
    kind: 'governance-refusal', stageRef: null, title: 'Automatic execution activation is gated',
    prompt: 'Canonical cards are published, but the daemon Broker/execution adapters are not activated. Complete the separate runtime approval before release.',
  });
  if (!request.ok) throw new Error(request.detail);
  expect(request.value.requestRef).toBe(AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF);
  const event = store.appendEvent('operator', created.value.run.runRef, {
    kind: 'governance', source: 'system', status: 'waiting', summary: 'canonical run published; runtime activation remains gated',
  });
  if (!event.ok) throw new Error(event.detail);
  detail = store.getRun('operator', created.value.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  return { detail: detail.value, request: request.value };
}

function createApprovedProposal(
  store: ControlPlaneStore,
  subject = 'alice',
  snapshot: JsonObject = {
    schema: 'kb.plan-proposal/v1', title: 'Synthetic workflow', manager: {}, stages: [
      { id: 'build', title: 'Build', dependsOn: [] }, { id: 'verify', title: 'Verify', dependsOn: ['build'] },
    ],
  },
) {
  const created = store.createProposalRevision(subject, {
    ...SOURCE,
    title: 'Synthetic workflow',
    snapshot,
  });
  if (!created.ok) throw new Error(created.detail);
  const approved = store.decideProposal(subject, created.value.proposalRef, created.value.revision, {
    expectedHash: created.value.hash,
    expectedApprovalRevision: 0,
    decision: 'approved',
    idempotencyKey: 'approval-1',
  });
  if (!approved.ok) throw new Error(approved.detail);
  return approved.value;
}

function createRun(store: ControlPlaneStore, subject = 'alice', agentWorkspaceLaunch?: { composerRef: string; agentId: string; declarationPath: string; declarationHash: string }) {
  const proposal = createApprovedProposal(store, subject);
  const created = store.createRun(subject, {
    title: 'Synthetic run',
    proposalRef: proposal.proposalRef,
    proposalRevision: proposal.revision,
    expectedProposalHash: proposal.hash,
    managerRuntime: 'claude',
    managerModel: 'claude-sonnet-5',
    idempotencyKey: 'launch-synthetic',
    agentWorkspaceLaunch,
    stages: [
      { stageId: 'build', title: 'Build', dependsOn: [] },
      { stageId: 'verify', title: 'Verify', dependsOn: ['build'] },
    ],
  });
  if (!created.ok) throw new Error(created.detail);
  return created.value;
}

function prepareActivatableRun(store: ControlPlaneStore, withAcceptedRequest = true) {
  const created = createRun(store);
  const publishing = store.transitionPublication('alice', created.run.runRef, created.run.version, 'publishing');
  if (!publishing.ok) throw new Error(publishing.detail);
  const published = store.transitionPublication('alice', created.run.runRef, publishing.value.version, 'published');
  if (!published.ok) throw new Error(published.detail);
  const waiting = store.transitionRun('alice', created.run.runRef, published.value.version, 'waiting-human');
  if (!waiting.ok) throw new Error(waiting.detail);
  if (withAcceptedRequest) {
    const request = store.createHumanRequest('alice', created.run.runRef, {
      kind: 'intervention',
      title: 'Execution report',
      prompt: 'Acknowledge the report before resuming.',
    });
    if (!request.ok) throw new Error(request.detail);
    const responded = store.respondHumanRequest('alice', request.value.requestRef, {
      expectedRevision: request.value.revision,
      decision: 'responded',
      idempotencyKey: 'accept-execution-report',
    });
    if (!responded.ok) throw new Error(responded.detail);
  }
  const detail = store.getRun('alice', created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  return detail.value;
}

function acknowledgeActivationManager(store: ControlPlaneStore, runRef: string): void {
  const detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const running = store.transitionRun('alice', runRef, detail.value.run.version, 'running');
  if (!running.ok) throw new Error(running.detail);
}

function createAssignedRun(
  store: ControlPlaneStore,
  subject = 'alice',
  assignments = {
    manager: structuredClone(MANAGER_ASSIGNMENT), build: structuredClone(BUILD_ASSIGNMENT), verify: structuredClone(VERIFY_ASSIGNMENT),
  },
) {
  const proposal = createApprovedProposal(store, subject, {
    schema: 'kb.plan-proposal/v1',
    manager: { assignment: assignments.manager },
    stages: [
      { id: 'build', title: 'Build', dependsOn: [], assignment: assignments.build },
      { id: 'verify', title: 'Verify', dependsOn: ['build'], assignment: assignments.verify },
    ],
  });
  const created = store.createRun(subject, {
    title: 'Assigned synthetic run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
    expectedProposalHash: proposal.hash, managerRuntime: assignments.manager.runtime, managerModel: assignments.manager.model,
    managerAssignment: assignments.manager, idempotencyKey: 'launch-assigned',
    stages: [
      { stageId: 'build', title: 'Build', dependsOn: [], assignment: assignments.build },
      { stageId: 'verify', title: 'Verify', dependsOn: ['build'], assignment: assignments.verify },
    ],
  });
  if (!created.ok) throw new Error(created.detail);
  return created.value;
}

function checkerSnapshot(maxCreatorReworks = CHECKER_REVIEW.maxCreatorReworks): JsonObject {
  const review = { ...CHECKER_REVIEW, maxCreatorReworks };
  return {
    schema: 'kb.plan-proposal/v1', manager: {}, stages: [
      { id: 'build', title: 'Build', dependsOn: [] },
      {
        id: 'check', title: 'Check', dependsOn: ['build'], action: 'review:source-grounding', assignment: VERIFY_ASSIGNMENT,
        workflowProfile: 'checker-readonly', review: structuredClone(review), completionGate: structuredClone(CHECKER_COMPLETION_GATE),
      },
    ],
  };
}

function checkerStages(maxCreatorReworks = CHECKER_REVIEW.maxCreatorReworks) {
  const review = { ...CHECKER_REVIEW, maxCreatorReworks };
  return [
    { stageId: 'build', title: 'Build', dependsOn: [] },
    {
      stageId: 'check', title: 'Check', dependsOn: ['build'], assignment: structuredClone(VERIFY_ASSIGNMENT),
      workflowProfile: 'checker-readonly', review: structuredClone(review), completionGate: structuredClone(CHECKER_COMPLETION_GATE),
    },
  ];
}

function createCheckerRun(store: ControlPlaneStore, subject = 'alice', maxCreatorReworks = CHECKER_REVIEW.maxCreatorReworks) {
  const proposal = createApprovedProposal(store, subject, checkerSnapshot(maxCreatorReworks));
  const created = store.createRun(subject, {
    title: 'Checker synthetic run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
    expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
    idempotencyKey: `launch-checker-${maxCreatorReworks}`, stages: checkerStages(maxCreatorReworks),
  });
  if (!created.ok) throw new Error(created.detail);
  return created.value;
}

function completeWorkerSession(store: ControlPlaneStore, sessionRef: string, version: number) {
  const starting = store.transitionSession('alice', sessionRef, version, 'starting');
  if (!starting.ok) throw new Error(starting.detail);
  const running = store.transitionSession('alice', sessionRef, starting.value.version, 'running');
  if (!running.ok) throw new Error(running.detail);
  const completed = store.transitionSession('alice', sessionRef, running.value.version, 'completed');
  if (!completed.ok) throw new Error(completed.detail);
  return completed.value;
}

function commitCheckerSubject(store: ControlPlaneStore, created = createCheckerRun(store), withCompletedWorkerSession = false) {
  let detail = store.getRun('alice', created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  let subject = detail.value.stages.find((stage) => stage.stageId === 'build');
  if (!subject) throw new Error('checker subject missing');
  if (subject.canonicalCardRef === null) {
    const linked = store.linkStageCard('alice', subject.stageRef, subject.version, 'card-build');
    if (!linked.ok) throw new Error(linked.detail);
    subject = linked.value;
  }
  const attempt = store.createAttempt('alice', subject.stageRef, {
    expectedStageVersion: subject.version, runtime: 'codex', model: 'fixed',
  });
  if (!attempt.ok) throw new Error(attempt.detail);
  let currentAttempt = attempt.value;
  if (withCompletedWorkerSession) {
    const session = store.createWorkerSession('alice', currentAttempt.attemptRef, { expectedAttemptVersion: currentAttempt.version });
    if (!session.ok) throw new Error(session.detail);
    completeWorkerSession(store, session.value.sessionRef, session.value.version);
    const refreshed = store.getRun('alice', created.run.runRef);
    if (!refreshed.ok) throw new Error(refreshed.detail);
    currentAttempt = refreshed.value.attempts.find((candidate) => candidate.attemptRef === currentAttempt.attemptRef)!;
  }
  for (const state of ['starting', 'running', 'succeeded'] as const) {
    const transitioned = store.transitionAttempt('alice', currentAttempt.attemptRef, currentAttempt.version, state);
    if (!transitioned.ok) throw new Error(transitioned.detail);
    currentAttempt = transitioned.value;
  }
  detail = store.getRun('alice', created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  subject = detail.value.stages.find((stage) => stage.stageId === 'build');
  if (!subject?.canonicalCardRef) throw new Error('checker subject card missing');
  const input = {
    expectedStageVersion: subject.version, expectedAttemptVersion: currentAttempt.version, expectedGeneration: 1,
    operationKey: `result:${created.run.runRef}:build`, resultHash: 'd'.repeat(64), resultCardRef: subject.canonicalCardRef,
    baseCommit: 'b'.repeat(40), canonicalCommit: 'a'.repeat(40),
  };
  const generation = store.recordStageGeneration('alice', subject.stageRef, input);
  if (!generation.ok) throw new Error(generation.detail);
  detail = store.getRun('alice', created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  subject = detail.value.stages.find((stage) => stage.stageId === 'build');
  if (!subject) throw new Error('checker subject disappeared');
  const runningStage = store.transitionStage('alice', subject.stageRef, subject.version, 'running');
  if (!runningStage.ok) throw new Error(runningStage.detail);
  const succeededStage = store.transitionStage('alice', subject.stageRef, runningStage.value.version, 'succeeded');
  if (!succeededStage.ok) throw new Error(succeededStage.detail);
  detail = store.getRun('alice', created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const loop = detail.value.iterationLoops[0];
  if (!loop) throw new Error('checker iteration loop missing');
  const activated = store.activateIterationLoop('alice', loop.iterationLoopRef, {
    expectedLoopVersion: loop.version, seedGenerationRefs: [generation.value.generationRef],
    artifactGenerationRefs: Object.fromEntries(loop.activation.seedArtifactIds.map((artifactId) => [artifactId, generation.value.generationRef])),
    operationKey: `iteration-activate:${created.run.runRef}:${loop.iterationGroupId}:c1`,
  });
  if (!activated.ok) throw new Error(activated.detail);
  return { created, subject: succeededStage.value, attempt: currentAttempt, generation: generation.value, input };
}

function failCheckerIteration(store: ControlPlaneStore, committed: ReturnType<typeof commitCheckerSubject>) {
  let detail = store.getRun('alice', committed.created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const loop = detail.value.iterationLoops[0]!;
  const reviewRoute = loop.routes.find((route) => route.requestKinds.includes('review'))!;
  const judge = loop.participants.find((participant) => participant.participantId === reviewRoute.recipientParticipantId)!;
  const request = store.recordIterationRequest('alice', loop.iterationLoopRef, {
    expectedLoopVersion: loop.version, routeId: reviewRoute.routeId, kind: 'review',
    inputGenerationRefs: [committed.generation.generationRef], baseCommit: committed.generation.canonicalCommit!,
    artifactHashes: Object.fromEntries(loop.artifacts.map((artifactId) => [artifactId, committed.generation.resultHash!])),
    unresolvedFindingRefs: [], preservedInvariants: [],
    nextAcceptanceCheck: 'Apply grounded.', instructions: 'Judge the subject.',
    operationKey: `iteration-request:${committed.created.run.runRef}:check:c1`,
  });
  if (!request.ok) throw new Error(request.detail);
  detail = store.getRun('alice', committed.created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const judgeStage = detail.value.stages.find((stage) => stage.stageId === judge.stageRef)!;
  const judgeAttempt = store.createAttempt('alice', judgeStage.stageRef, {
    expectedStageVersion: judgeStage.version, runtime: VERIFY_ASSIGNMENT.runtime, model: VERIFY_ASSIGNMENT.model,
  });
  if (!judgeAttempt.ok) throw new Error(judgeAttempt.detail);
  let currentJudgeAttempt = judgeAttempt.value;
  for (const state of ['starting', 'running', 'succeeded'] as const) {
    const transitioned = store.transitionAttempt('alice', currentJudgeAttempt.attemptRef, currentJudgeAttempt.version, state);
    if (!transitioned.ok) throw new Error(transitioned.detail);
    currentJudgeAttempt = transitioned.value;
  }
  detail = store.getRun('alice', committed.created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const currentJudgeStage = detail.value.stages.find((stage) => stage.stageRef === judgeStage.stageRef)!;
  const runningJudgeStage = store.transitionStage('alice', currentJudgeStage.stageRef, currentJudgeStage.version, 'running');
  if (!runningJudgeStage.ok) throw new Error(runningJudgeStage.detail);
  const succeededJudgeStage = store.transitionStage('alice', currentJudgeStage.stageRef, runningJudgeStage.value.version, 'succeeded');
  if (!succeededJudgeStage.ok) throw new Error(succeededJudgeStage.detail);
  detail = store.getRun('alice', committed.created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const currentLoop = detail.value.iterationLoops[0]!;
  const receipt = store.recordIterationReceipt('alice', currentLoop.iterationLoopRef, {
    expectedLoopVersion: currentLoop.version, requestRef: request.value.requestRef,
    outcome: {
      schema: 'kb.iteration-outcome/v1', requestRef: request.value.requestRef,
      iterationLoopRef: currentLoop.iterationLoopRef, participantId: judge.participantId, cycle: request.value.cycle,
      verdict: 'fail', inputGenerationRefs: [...request.value.inputGenerationRefs],
      criteria: [{ criterionId: 'grounded', verdict: 'fail', findingIds: ['missing-source'] }],
      findings: [{ findingId: 'missing-source', criterionId: 'grounded', severity: 'blocking', summary: 'Source is missing.', evidencePaths: [] }],
      positions: [], recordedDissent: [], summary: 'Grounding failed.',
    },
    outputGenerationRefs: [], baseCommit: committed.generation.baseCommit!,
    canonicalCommit: committed.generation.canonicalCommit!, participantAttemptRef: currentJudgeAttempt.attemptRef,
    operationKey: `iteration-receipt:${committed.created.run.runRef}:check:c1:fail`,
  });
  if (!receipt.ok) throw new Error(receipt.detail);
  return receipt.value;
}

function queueCreatorRework(store: ControlPlaneStore, committed: ReturnType<typeof commitCheckerSubject>) {
  const receipt = failCheckerIteration(store, committed);
  const detail = store.getRun('alice', committed.created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const loop = detail.value.iterationLoops[0]!;
  const nextStep = loop.schedule.find((step) => step.after?.verdict === 'fail')!;
  const queued = store.advanceIterationTurn('alice', loop.iterationLoopRef, {
    expectedLoopVersion: loop.version, expectedReceiptRef: receipt.receiptRef,
    expectedActiveGenerationRefs: [...loop.activeGenerationRefs], nextStepId: nextStep.stepId,
    operationKey: `iteration-advance:${committed.created.run.runRef}:creator`,
  });
  if (!queued.ok) throw new Error(queued.detail);
  const current = store.getRun('alice', committed.created.run.runRef);
  if (!current.ok) throw new Error(current.detail);
  const currentLoop = current.value.iterationLoops[0]!;
  const route = currentLoop.routes.find((candidate) =>
    candidate.routeId === currentLoop.schedule.find((step) => step.stepId === currentLoop.currentStepId)?.routeId)!;
  const predecessor = current.value.stageGenerations.find((generation) =>
    generation.generationRef === currentLoop.activeGenerationRefs[0])!;
  const request = store.recordIterationRequest('alice', currentLoop.iterationLoopRef, {
    expectedLoopVersion: currentLoop.version, routeId: route.routeId, kind: 'rework',
    inputGenerationRefs: [...currentLoop.activeGenerationRefs], baseCommit: predecessor.canonicalCommit!,
    artifactHashes: Object.fromEntries(currentLoop.artifacts.map((artifactId) => [artifactId, predecessor.resultHash!])),
    unresolvedFindingRefs: receipt.findings.map((finding) => finding.findingId),
    preservedInvariants: [], nextAcceptanceCheck: 'Resolve the blocking findings.', instructions: 'Rework the subject.',
    operationKey: `iteration-request:${committed.created.run.runRef}:creator:c2`,
  });
  if (!request.ok) throw new Error(request.detail);
  return request.value;
}
type PersistedRow = Record<string, unknown>;
interface PersistedReviewBundle {
  subject?: string;
  run?: PersistedRow;
  stages: PersistedRow[];
  attempts: PersistedRow[];
  sessions: PersistedRow[];
  humanRequests: PersistedRow[];
  events: PersistedRow[];
  stageGenerations: PersistedRow[];
  iterationLoops: PersistedRow[];
  iterationRequests: PersistedRow[];
  iterationReceipts: PersistedRow[];
  reviewLoops: PersistedRow[];
  reviewReceipts: PersistedRow[];
  generationSupersessions: PersistedRow[];
}
interface PersistedReviewDocument extends PersistedReviewBundle {
  runs: PersistedRow[];
  quarantine: Array<PersistedReviewBundle & { quarantinedAt: string }>;
}

function canonicalJsonForTest(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForTest).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonForTest(record[key])}`).join(',')}}`;
}

function iterationRequestFingerprintForTest(request: PersistedRow): string {
  const { subject: _subject, runRef: _runRef, operationKey: _operationKey,
    operationFingerprint: _operationFingerprint, ...body } = request;
  return createHash('sha256').update(canonicalJsonForTest(body)).digest('hex');
}

function persistedReviewBundle(document: PersistedReviewDocument, location: 'active' | 'quarantine'): PersistedReviewBundle {
  const addLegacyMigrationInputs = (bundle: PersistedReviewBundle): PersistedReviewBundle => {
    const state = new Map([
      ['awaiting-seed', 'awaiting-subject'], ['awaiting-turn', 'checking'], ['running-turn', 'checking'],
      ['rework-queued', 'rework-queued'], ['failed', 'failed'], ['exhausted', 'parked'], ['parked', 'parked'],
      ['awaiting-completion-gate', 'awaiting-gate'], ['awaiting-park-gate', 'parked'], ['passed', 'passed'], ['declined', 'parked'],
    ]);
    bundle.reviewLoops = bundle.iterationLoops.map((loop) => {
      const participants = loop.participants as PersistedRow[];
      const routes = loop.routes as PersistedRow[];
      const judge = participants.find((participant) => participant.role === 'judge') as PersistedRow;
      const route = routes.find((candidate) => candidate.recipientParticipantId === judge.participantId && (candidate.requestKinds as string[]).includes('review')) as PersistedRow;
      const producer = participants.find((participant) => participant.participantId === route.senderParticipantId) as PersistedRow;
      const subjectStage = bundle.stages.find((stage) => stage.stageId === producer.stageRef) as PersistedRow;
      const reviewStage = bundle.stages.find((stage) => stage.stageId === judge.stageRef) as PersistedRow;
      return {
        subject: loop.subject, reviewLoopRef: loop.iterationLoopRef, runRef: loop.runRef,
        reviewStageRef: reviewStage.stageRef, subjectStageRef: subjectStage.stageRef,
        maxCreatorReworks: Number(loop.maxCycles) - 1,
        reviewDefinitionHash: createHash('sha256').update(canonicalJsonForTest({
          workflowProfile: reviewStage.workflowProfile, assignment: reviewStage.assignment,
          review: reviewStage.review, completionGate: reviewStage.completionGate,
        })).digest('hex'),
        reworksUsed: Math.max(0, Number(loop.cyclesUsed) - ((loop.activeGenerationRefs as string[]).length ? 1 : 0)),
        state: state.get(String(loop.state)), activeGenerationRef: (loop.activeGenerationRefs as string[])[0] ?? null,
        acceptedGenerationRef: (loop.acceptedGenerationRefs as string[] | undefined)?.[0] ?? null,
        activeReceiptRef: loop.lastReceiptRef ?? null, interventionRequestRef: loop.interventionRef ?? null,
        version: Number(loop.version) + 1, createdAt: loop.createdAt, updatedAt: loop.updatedAt,
      };
    });
    bundle.reviewReceipts = bundle.iterationReceipts.map((receipt) => {
      const loop = bundle.iterationLoops.find((candidate) => candidate.iterationLoopRef === receipt.iterationLoopRef) as PersistedRow;
      const legacyLoop = bundle.reviewLoops.find((candidate) => candidate.reviewLoopRef === loop.iterationLoopRef) as PersistedRow;
      const subjectGeneration = bundle.stageGenerations.find((candidate) =>
        candidate.generationRef === (receipt.inputGenerationRefs as string[])[0]) as PersistedRow;
      const outcome = {
        schema: 'kb.review-outcome/v1', decision: receipt.verdict, summary: receipt.summary,
        criteria: receipt.criteria,
        findings: (receipt.findings as PersistedRow[]).map((finding) => ({
          id: finding.findingId, criterionId: finding.criterionId, severity: finding.severity,
          summary: finding.summary, evidencePaths: finding.evidencePaths,
        })),
      };
      const canonical = (value: any): string => value === null || typeof value !== 'object' ? JSON.stringify(value)
        : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
          : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
      return {
        subject: receipt.subject, operationFingerprint: receipt.operationFingerprint,
        reviewReceiptRef: receipt.receiptRef, runRef: receipt.runRef,
        reviewStageRef: legacyLoop.reviewStageRef, subjectStageRef: legacyLoop.subjectStageRef,
        subjectGenerationRef: (receipt.inputGenerationRefs as string[])[0], subjectResultHash: subjectGeneration.resultHash,
        checkerAttemptRef: receipt.participantAttemptRef, outcome,
        outcomeHash: createHash('sha256').update(canonical(outcome)).digest('hex'), operationKey: receipt.operationKey,
        state: receipt.verdict === 'pass' ? (loop.completionGateRef ? 'awaiting-completion-gate' : 'passed')
          : receipt.verdict === 'parked' ? 'parked' : 'failed',
        completionRequestRef: loop.completionGateRef ?? null,
        interventionRequestRef: loop.interventionRef ?? null, version: receipt.version,
        createdAt: receipt.createdAt, finalizedAt: loop.completionGateRef ? null : receipt.createdAt,
      };
    });
    return bundle;
  };
  if (location === 'active') return addLegacyMigrationInputs(document);
  const bundle = {
    subject: String(document.runs[0]?.subject),
    quarantinedAt: '2026-07-18T12:00:00.000Z',
    run: structuredClone(document.runs[0] as PersistedRow),
    stages: structuredClone(document.stages), attempts: structuredClone(document.attempts),
    sessions: structuredClone(document.sessions), humanRequests: structuredClone(document.humanRequests),
    events: structuredClone(document.events), stageGenerations: structuredClone(document.stageGenerations),
    iterationLoops: structuredClone(document.iterationLoops), iterationRequests: structuredClone(document.iterationRequests),
    iterationReceipts: structuredClone(document.iterationReceipts), reviewLoops: [], reviewReceipts: [],
    generationSupersessions: structuredClone(document.generationSupersessions),
  };
  document.quarantine.push(bundle);
  return addLegacyMigrationInputs(bundle);
}

function task2IterationGroup() {
  return {
    iterationGroupId: 'draft-check', goal: 'Accept the draft.',
    participants: [
      { participantId: 'author', stageRef: 'build', role: 'contributor' as const, perspective: 'Create the draft.', mandate: 'Write the declared draft.' },
      { participantId: 'judge', stageRef: 'check', role: 'judge' as const, perspective: 'Check the draft.', mandate: 'Apply every criterion.' },
    ],
    routes: [
      { routeId: 'to-judge', senderParticipantId: 'author', recipientParticipantId: 'judge', requestKinds: ['review' as const], baseResolutionStageIds: ['build'] },
      { routeId: 'to-author', senderParticipantId: 'judge', recipientParticipantId: 'author', requestKinds: ['rework' as const], baseResolutionStageIds: ['check'] },
    ],
    activation: { seedParticipantId: 'author', seedArtifactIds: ['draft'] }, initialStepId: 'review',
    schedule: [
      { stepId: 'review', routeId: 'to-judge', after: { stepId: 'rework', participantId: 'author', verdict: 'fulfilled' as const }, cycle: 'next' as const },
      { stepId: 'rework', routeId: 'to-author', after: { stepId: 'review', participantId: 'judge', verdict: 'fail' as const }, cycle: 'current' as const },
    ],
    artifacts: ['draft'], criteria: [{ id: 'grounded', description: 'The draft is grounded.' }],
    maxCycles: 3, cycleUnit: 'One author generation and one judge verdict.',
    terminalAuthorities: [{ participantId: 'judge', verdict: 'pass' as const }],
    completionGate: { id: 'publish', kind: 'approval' as const, prompt: 'Approve the accepted draft.', requiresReview: 'pass' as const },
  };
}

function createTask2IterationRun(store: ControlPlaneStore, group = task2IterationGroup()) {
  const snapshot = {
    schema: 'kb.plan-proposal/v1', manager: {}, iterationGroups: [structuredClone(group)], stages: [
      { id: 'build', title: 'Build', dependsOn: [], artifacts: [{ id: 'draft', path: 'draft.md' }] },
      { id: 'check', title: 'Check', dependsOn: ['build'], artifacts: [] },
    ],
  } as unknown as JsonObject;
  const proposal = createApprovedProposal(store, 'alice', snapshot);
  return store.createRun('alice', {
    title: 'Iteration run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
    expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
    idempotencyKey: `iteration-${group.iterationGroupId}`, iterationGroups: [structuredClone(group)],
    stages: [{ stageId: 'build', title: 'Build', dependsOn: [] }, { stageId: 'check', title: 'Check', dependsOn: ['build'] }],
  });
}

function corruptIterationLoop(runRef: string): PersistedRow {
  const group = task2IterationGroup();
  return {
    subject: 'alice', ...group, iterationLoopRef: 'iteration-loop-corrupt', runRef,
    definitionHash: '0'.repeat(64), cyclesUsed: 0, state: 'awaiting-seed', activeGenerationRefs: [],
    version: 0, createdAt: '2026-08-12T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z',
  };
}


function task4IterationGroup(prefix = 'draft', withCompletionGate = false) {
  const build = `${prefix}-build`;
  const check = `${prefix}-check`;
  const author = `${prefix}-author`;
  const judge = `${prefix}-judge`;
  const artifact = `${prefix}-artifact`;
  return {
    iterationGroupId: `${prefix}-loop`, goal: `Accept ${prefix}.`,
    participants: [
      { participantId: author, stageRef: build, role: 'contributor' as const, perspective: `Create ${prefix}.`, mandate: `Write ${prefix}.` },
      { participantId: judge, stageRef: check, role: 'judge' as const, perspective: `Check ${prefix}.`, mandate: `Judge ${prefix}.` },
    ],
    routes: [
      { routeId: `${prefix}-to-judge`, senderParticipantId: author, recipientParticipantId: judge, requestKinds: ['review' as const], baseResolutionStageIds: [build] },
      { routeId: `${prefix}-to-author`, senderParticipantId: judge, recipientParticipantId: author, requestKinds: ['rework' as const], baseResolutionStageIds: [check] },
    ],
    activation: { seedParticipantId: author, seedArtifactIds: [artifact] }, initialStepId: `${prefix}-review`,
    schedule: [
      { stepId: `${prefix}-review`, routeId: `${prefix}-to-judge`, after: { stepId: `${prefix}-rework`, participantId: author, verdict: 'fulfilled' as const }, cycle: 'next' as const },
      { stepId: `${prefix}-rework`, routeId: `${prefix}-to-author`, after: { stepId: `${prefix}-review`, participantId: judge, verdict: 'fail' as const }, cycle: 'current' as const },
    ],
    artifacts: [artifact], criteria: [{ id: `${prefix}-criterion`, description: `${prefix} is acceptable.` }],
    maxCycles: 2, cycleUnit: `One ${prefix} generation and verdict.`,
    terminalAuthorities: [{ participantId: judge, verdict: 'pass' as const }],
    ...(withCompletionGate ? { completionGate: { id: `${prefix}-approval`, kind: 'approval' as const, prompt: `Approve ${prefix}.`, requiresReview: 'pass' as const } } : {}),
  };
}

function createTask4IterationRun(store: ControlPlaneStore, groups = [task4IterationGroup()]) {
  const stages = groups.flatMap((group) => [
    { stageId: group.participants[0]!.stageRef, title: `${group.iterationGroupId} build`, dependsOn: [] as string[] },
    { stageId: group.participants[1]!.stageRef, title: `${group.iterationGroupId} check`, dependsOn: [group.participants[0]!.stageRef] },
  ]);
  const snapshot = {
    schema: 'kb.plan-proposal/v1', manager: {}, iterationGroups: structuredClone(groups),
    stages: groups.flatMap((group) => [
      { id: group.participants[0]!.stageRef, title: `${group.iterationGroupId} build`, dependsOn: [], artifacts: [{ id: group.artifacts[0], path: `${group.iterationGroupId}.md` }] },
      { id: group.participants[1]!.stageRef, title: `${group.iterationGroupId} check`, dependsOn: [group.participants[0]!.stageRef], artifacts: [] },
    ]),
  } as unknown as JsonObject;
  const proposal = createApprovedProposal(store, 'alice', snapshot);
  const created = store.createRun('alice', {
    title: 'Task 4 iteration run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
    expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
    idempotencyKey: `task4-${groups.map((group) => group.iterationGroupId).join('-')}`,
    iterationGroups: structuredClone(groups), stages,
  });
  if (!created.ok) throw new Error(created.detail);
  return created.value;
}

function commitTask4Seed(store: ControlPlaneStore, runRef: string, prefix = 'draft') {
  const detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const stage = detail.value.stages.find((candidate) => candidate.stageId === `${prefix}-build`);
  if (!stage) throw new Error('seed stage missing');
  const linked = store.linkStageCard('alice', stage.stageRef, stage.version, `card-${prefix}`);
  if (!linked.ok) throw new Error(linked.detail);
  const attempt = store.createAttempt('alice', stage.stageRef, { expectedStageVersion: linked.value.version, runtime: 'codex', model: 'fixed' });
  if (!attempt.ok) throw new Error(attempt.detail);
  const starting = store.transitionAttempt('alice', attempt.value.attemptRef, attempt.value.version, 'starting');
  if (!starting.ok) throw new Error(starting.detail);
  const running = store.transitionAttempt('alice', starting.value.attemptRef, starting.value.version, 'running');
  if (!running.ok) throw new Error(running.detail);
  const succeeded = store.transitionAttempt('alice', running.value.attemptRef, running.value.version, 'succeeded');
  if (!succeeded.ok) throw new Error(succeeded.detail);
  const current = store.getRun('alice', runRef);
  if (!current.ok) throw new Error(current.detail);
  const currentStage = current.value.stages.find((candidate) => candidate.stageRef === stage.stageRef)!;
  const generation = store.recordStageGeneration('alice', stage.stageRef, {
    expectedStageVersion: currentStage.version, expectedAttemptVersion: succeeded.value.version, expectedGeneration: 1,
    operationKey: `result:${runRef}:${stage.stageId}`,
    resultHash: createHash('sha256').update(prefix).digest('hex'), resultCardRef: `card-${prefix}`,
    baseCommit: 'b'.repeat(40), canonicalCommit: createHash('sha1').update(prefix).digest('hex'),
  });
  if (!generation.ok) throw new Error(generation.detail);
  const afterGeneration = store.getRun('alice', runRef);
  if (!afterGeneration.ok) throw new Error(afterGeneration.detail);
  const committedStage = afterGeneration.value.stages.find((candidate) => candidate.stageRef === stage.stageRef)!;
  const runningStage = store.transitionStage('alice', committedStage.stageRef, committedStage.version, 'running');
  if (!runningStage.ok) throw new Error(runningStage.detail);
  const completed = store.transitionStage('alice', runningStage.value.stageRef, runningStage.value.version, 'succeeded');
  if (!completed.ok) throw new Error(completed.detail);
  return generation.value;
}

function activateTask4Loop(store: ControlPlaneStore, runRef: string, prefix = 'draft') {
  const generation = commitTask4Seed(store, runRef, prefix);
  const detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const loop = detail.value.iterationLoops.find((candidate) => candidate.iterationGroupId === `${prefix}-loop`)!;
  const activated = store.activateIterationLoop('alice', loop.iterationLoopRef, {
    expectedLoopVersion: loop.version, seedGenerationRefs: [generation.generationRef],
    artifactGenerationRefs: { [`${prefix}-artifact`]: generation.generationRef },
    operationKey: `iteration-activate:${runRef}:${prefix}-loop:c1`,
  });
  if (!activated.ok) throw new Error(activated.detail);
  return { generation, loop: activated.value };
}

function task4Request(store: ControlPlaneStore, runRef: string, prefix = 'draft') {
  const detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const loop = detail.value.iterationLoops.find((candidate) => candidate.iterationGroupId === `${prefix}-loop`)!;
  const generation = detail.value.stageGenerations.find((candidate) => candidate.generationRef === loop.activeGenerationRefs[0])!;
  return store.recordIterationRequest('alice', loop.iterationLoopRef, {
    expectedLoopVersion: loop.version, routeId: `${prefix}-to-judge`, kind: 'review',
    inputGenerationRefs: [generation.generationRef], baseCommit: generation.canonicalCommit!,
    artifactHashes: { [`${prefix}-artifact`]: generation.resultHash! }, unresolvedFindingRefs: [], preservedInvariants: [],
    nextAcceptanceCheck: `Apply ${prefix}-criterion.`, instructions: `Judge ${prefix}.`, operationKey: `iteration-request:${runRef}:${prefix}:c1`,
  });
}

function task4Receipt(store: ControlPlaneStore, runRef: string, prefix = 'draft', verdict: 'pass' | 'fail' = 'fail') {
  const request = task4Request(store, runRef, prefix);
  if (!request.ok) throw new Error(request.detail);
  const completed = completeTask4JudgeStage(store, runRef, prefix);
  const detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const loop = detail.value.iterationLoops.find((candidate) => candidate.iterationGroupId === `${prefix}-loop`)!;
  const generation = detail.value.stageGenerations.find((candidate) => candidate.generationRef === request.value.inputGenerationRefs[0])!;
  const findingId = `${prefix}-finding`;
  return store.recordIterationReceipt('alice', loop.iterationLoopRef, {
    expectedLoopVersion: loop.version, requestRef: request.value.requestRef,
    outcome: {
      schema: 'kb.iteration-outcome/v1', requestRef: request.value.requestRef, iterationLoopRef: loop.iterationLoopRef,
      participantId: `${prefix}-judge`, cycle: request.value.cycle, verdict, inputGenerationRefs: [...request.value.inputGenerationRefs],
      criteria: [{ criterionId: `${prefix}-criterion`, verdict, findingIds: verdict === 'fail' ? [findingId] : [] }],
      findings: verdict === 'fail' ? [{ findingId, criterionId: `${prefix}-criterion`, severity: 'blocking', summary: `${prefix} failed.`, evidencePaths: [] }] : [],
      positions: [],
      recordedDissent: [], summary: `${prefix} ${verdict}.`,
    },
    outputGenerationRefs: [], baseCommit: generation.baseCommit!, canonicalCommit: generation.canonicalCommit!,
    participantAttemptRef: completed.attempt.attemptRef, operationKey: `iteration-receipt:${runRef}:${prefix}:c1:${verdict}`,
  });
}

function completeTask4JudgeStage(store: ControlPlaneStore, runRef: string, prefix = 'draft') {
  const request = task4Request(store, runRef, prefix);
  if (!request.ok) throw new Error(request.detail);
  let detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  let stage = detail.value.stages.find((candidate) => candidate.stageId === `${prefix}-check`)!;
  const existingAttempt = stage.currentAttemptRef === null ? undefined
    : detail.value.attempts.find((candidate) => candidate.attemptRef === stage.currentAttemptRef);
  if (stage.state === 'succeeded' && existingAttempt?.state === 'succeeded') {
    return { request: request.value, attempt: existingAttempt };
  }
  const attempt = store.createAttempt('alice', stage.stageRef, {
    expectedStageVersion: stage.version, runtime: 'codex', model: 'fixed',
  });
  if (!attempt.ok) throw new Error(attempt.detail);
  let currentAttempt = attempt.value;
  for (const state of ['starting', 'running', 'succeeded'] as const) {
    const transitioned = store.transitionAttempt('alice', currentAttempt.attemptRef, currentAttempt.version, state);
    if (!transitioned.ok) throw new Error(transitioned.detail);
    currentAttempt = transitioned.value;
  }
  detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  stage = detail.value.stages.find((candidate) => candidate.stageRef === stage.stageRef)!;
  const running = store.transitionStage('alice', stage.stageRef, stage.version, 'running');
  if (!running.ok) throw new Error(running.detail);
  const succeeded = store.transitionStage('alice', running.value.stageRef, running.value.version, 'succeeded');
  if (!succeeded.ok) throw new Error(succeeded.detail);
  return { request: request.value, attempt: currentAttempt };
}

function makeTask4RunRunningWithTerminalManager(store: ControlPlaneStore, runRef: string) {
  let detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const manager = detail.value.sessions.find((session) => session.sessionRef === detail.value.run.managerSessionRef)!;
  const stopped = store.transitionSession('alice', manager.sessionRef, manager.version, 'stopped');
  if (!stopped.ok) throw new Error(stopped.detail);
  const refreshed = store.getRun('alice', runRef);
  if (!refreshed.ok) throw new Error(refreshed.detail);
  const running = store.transitionRun('alice', runRef, refreshed.value.run.version, 'running');
  if (!running.ok) throw new Error(running.detail);
  return running.value;
}

function parkTask4NoProgress(store: ControlPlaneStore, runRef: string, operationSuffix: string) {
  const requested = requestTask4ProducerTurn(store, runRef);
  let detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const loop = detail.value.iterationLoops[0]!;
  let attempt = detail.value.attempts.find((candidate) => candidate.logicalGeneration === 2)!;
  const session = store.createWorkerSession('alice', attempt.attemptRef, { expectedAttemptVersion: attempt.version });
  if (!session.ok) throw new Error(session.detail);
  detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  attempt = detail.value.attempts.find((candidate) => candidate.attemptRef === attempt.attemptRef)!;
  for (const state of ['starting', 'running'] as const) {
    const transitioned = store.transitionAttempt('alice', attempt.attemptRef, attempt.version, state);
    if (!transitioned.ok) throw new Error(transitioned.detail);
    attempt = transitioned.value;
  }
  const sessionStarting = store.transitionSession('alice', session.value.sessionRef, session.value.version, 'starting');
  if (!sessionStarting.ok) throw new Error(sessionStarting.detail);
  const sessionRunning = store.transitionSession('alice', session.value.sessionRef, sessionStarting.value.version, 'running');
  if (!sessionRunning.ok) throw new Error(sessionRunning.detail);
  detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const producer = detail.value.stages.find((candidate) => candidate.stageId === 'draft-build')!;
  if (producer.state !== 'running') {
    const running = store.transitionStage('alice', producer.stageRef, producer.version, 'running');
    if (!running.ok) throw new Error(running.detail);
  }
  const outcome = {
    schema: 'kb.iteration-outcome/v1' as const, requestRef: requested.request.requestRef,
    iterationLoopRef: loop.iterationLoopRef, participantId: 'draft-author', cycle: requested.request.cycle,
    verdict: 'fulfilled' as const, inputGenerationRefs: [...requested.request.inputGenerationRefs],
    criteria: [], findings: [], positions: [], recordedDissent: [], summary: 'No changed artifact was produced.',
  };
  return store.parkIterationLoop('alice', loop.iterationLoopRef, {
    expectedLoopVersion: loop.version, expectedActiveGenerationRefs: [...loop.activeGenerationRefs], reason: 'no-progress',
    nextRouteId: requested.request.routeId, attemptedRequestRef: requested.request.requestRef, attemptedOutcome: outcome,
    artifactSnapshots: [{
      path: 'draft-loop.md', regularFile: true, size: 6, sha256: 'a'.repeat(64),
      afterRegularFile: true, afterSize: 6, afterSha256: 'a'.repeat(64), byteIdentical: true,
    }],
    failureReason: 'required artifact is byte-identical to its pinned input',
    operationKey: `park-no-progress-${operationSuffix}`,
  });
}

function queueTask4ProducerTurn(store: ControlPlaneStore, runRef: string, prefix = 'draft') {
  const failed = task4Receipt(store, runRef, prefix, 'fail');
  if (!failed.ok) throw new Error(failed.detail);
  const detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const loop = detail.value.iterationLoops.find((candidate) => candidate.iterationGroupId === `${prefix}-loop`)!;
  const advanced = store.advanceIterationTurn('alice', loop.iterationLoopRef, {
    expectedLoopVersion: loop.version,
    expectedReceiptRef: failed.value.receiptRef,
    expectedActiveGenerationRefs: [...loop.activeGenerationRefs],
    nextStepId: `${prefix}-rework`,
    operationKey: `iteration-advance:${runRef}:${prefix}:producer`,
  });
  if (!advanced.ok) throw new Error(advanced.detail);
  return { failed: failed.value, loop: advanced.value };
}

function requestTask4ProducerTurn(store: ControlPlaneStore, runRef: string, prefix = 'draft') {
  const queued = queueTask4ProducerTurn(store, runRef, prefix);
  const detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const predecessor = detail.value.stageGenerations.find((generation) => generation.state === 'committed')!;
  const requested = store.recordIterationRequest('alice', queued.loop.iterationLoopRef, {
    expectedLoopVersion: queued.loop.version,
    routeId: `${prefix}-to-author`,
    kind: 'rework',
    inputGenerationRefs: [...queued.loop.activeGenerationRefs],
    baseCommit: predecessor.canonicalCommit!,
    artifactHashes: { [`${prefix}-artifact`]: predecessor.resultHash! },
    unresolvedFindingRefs: [`${prefix}-finding`],
    preservedInvariants: [`${prefix}-criterion`],
    nextAcceptanceCheck: `Resolve ${prefix}-finding.`,
    instructions: `Rework ${prefix}.`,
    operationKey: `iteration-request:${runRef}:${prefix}:producer`,
  });
  if (!requested.ok) throw new Error(requested.detail);
  return { ...queued, request: requested.value };
}

function commitTask4ProducerTurn(store: ControlPlaneStore, runRef: string, prefix = 'draft') {
  const requested = requestTask4ProducerTurn(store, runRef, prefix);
  let detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const stage = detail.value.stages.find((candidate) => candidate.stageId === `${prefix}-build`)!;
  const predecessor = stage.currentGenerationRef === null ? undefined : detail.value.stageGenerations.find((candidate) =>
    candidate.generationRef === stage.currentGenerationRef);
  let attempt = detail.value.attempts.find((candidate) => candidate.attemptRef === stage.currentAttemptRef)!;
  if (stage.state !== 'running') {
    const runningStage = store.transitionStage('alice', stage.stageRef, stage.version, 'running');
    if (!runningStage.ok) throw new Error(runningStage.detail);
  }
  for (const state of ['starting', 'running', 'succeeded'] as const) {
    detail = store.getRun('alice', runRef);
    if (!detail.ok) throw new Error(detail.detail);
    attempt = detail.value.attempts.find((candidate) => candidate.attemptRef === attempt.attemptRef)!;
    const transitioned = store.transitionAttempt('alice', attempt.attemptRef, attempt.version, state);
    if (!transitioned.ok) throw new Error(transitioned.detail);
  }
  detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const currentStage = detail.value.stages.find((candidate) => candidate.stageRef === stage.stageRef)!;
  attempt = detail.value.attempts.find((candidate) => candidate.attemptRef === attempt.attemptRef)!;
  const committed = store.recordStageGeneration('alice', stage.stageRef, {
    expectedStageVersion: currentStage.version,
    expectedAttemptVersion: attempt.version,
    expectedGeneration: attempt.logicalGeneration!,
    operationKey: `iteration-result:${runRef}:${stage.stageId}:${requested.request.requestRef}`,
    resultHash: 'e'.repeat(64),
    resultCardRef: null,
    baseCommit: attempt.baseCommit ?? predecessor?.canonicalCommit ?? 'b'.repeat(40),
    canonicalCommit: 'e'.repeat(40),
  });
  if (!committed.ok) throw new Error(committed.detail);
  return { ...requested, generation: committed.value, attempt };
}

describe('Task 4 generic iteration state machine', () => {
  it('records a producer iteration request while a rework successor is queued', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const requested = requestTask4ProducerTurn(store, created.run.runRef);
    expect(requested.loop).toMatchObject({
      state: 'rework-queued', currentStepId: 'draft-rework', turnOwnerParticipantId: 'draft-author', cyclesUsed: 1,
    });
    expect(requested.request).toMatchObject({ kind: 'rework', cycle: 1, inputGenerationRefs: requested.loop.activeGenerationRefs });
    const detail = store.getRun('alice', created.run.runRef);
    expect(detail).toMatchObject({ ok: true, value: {
      iterationLoops: [expect.objectContaining({ state: 'running-turn', cyclesUsed: 1 })],
      stageGenerations: [expect.objectContaining({ generation: 1, state: 'committed' })],
      attempts: expect.arrayContaining([expect.objectContaining({ logicalGeneration: 2, state: 'queued' })]),
    } });
  });

  it('mints a durable fulfilled receipt with output lineage after canonical integration', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task4-producer-commit-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const turn = commitTask4ProducerTurn(store, created.run.runRef);
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    const receipt = store.recordIterationReceipt('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version,
      requestRef: turn.request.requestRef,
      outcome: {
        schema: 'kb.iteration-outcome/v1', requestRef: turn.request.requestRef,
        iterationLoopRef: loop.iterationLoopRef, participantId: 'draft-author', cycle: turn.request.cycle,
        verdict: 'fulfilled', inputGenerationRefs: [...turn.request.inputGenerationRefs], criteria: [], findings: [],
        positions: [], recordedDissent: [], summary: 'Draft successor committed.',
      },
      outputGenerationRefs: [turn.generation.generationRef],
      baseCommit: turn.generation.baseCommit!, canonicalCommit: turn.generation.canonicalCommit!,
      participantAttemptRef: turn.attempt.attemptRef,
      operationKey: `iteration-receipt:${created.run.runRef}:draft:producer`,
    });
    expect(receipt).toMatchObject({ ok: true, value: {
      verdict: 'fulfilled', inputGenerationRefs: turn.request.inputGenerationRefs,
      outputGenerationRefs: [turn.generation.generationRef], baseCommit: turn.generation.baseCommit,
      canonicalCommit: turn.generation.canonicalCommit,
    } });
    expect(store.getRun('alice', created.run.runRef)).toMatchObject({ ok: true, value: {
      iterationLoops: [expect.objectContaining({ state: 'failed', lastReceiptRef: receipt.ok && receipt.value.receiptRef })],
      generationSupersessions: [expect.objectContaining({
        predecessorGenerationRef: turn.request.inputGenerationRefs[0],
        successorGenerationRef: turn.generation.generationRef,
        triggerReceiptRef: turn.failed.receiptRef,
        operationKey: `rework:${created.run.runRef}:draft-build:g2`,
      })],
    } });
  });

  it('rejects output generation refs on every non-fulfilled iteration receipt', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store);
    const activated = activateTask4Loop(store, created.run.runRef);
    const request = task4Request(store, created.run.runRef);
    if (!request.ok) throw new Error(request.detail);
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    const generation = detail.value.stageGenerations.find((candidate) =>
      candidate.generationRef === request.value.inputGenerationRefs[0])!;
    const findingId = 'non-fulfilled-output-finding';
    expect(store.recordIterationReceipt('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version,
      requestRef: request.value.requestRef,
      outcome: {
        schema: 'kb.iteration-outcome/v1', requestRef: request.value.requestRef,
        iterationLoopRef: loop.iterationLoopRef, participantId: 'draft-judge', cycle: request.value.cycle,
        verdict: 'fail', inputGenerationRefs: [...request.value.inputGenerationRefs],
        criteria: [{ criterionId: 'draft-criterion', verdict: 'fail', findingIds: [findingId] }],
        findings: [{ findingId, criterionId: 'draft-criterion', severity: 'blocking', summary: 'Draft failed.', evidencePaths: [] }],
        positions: [], recordedDissent: [], summary: 'Draft failed.',
      },
      outputGenerationRefs: [activated.generation.generationRef],
      baseCommit: generation.baseCommit!, canonicalCommit: generation.canonicalCommit!,
      participantAttemptRef: generation.attemptRef,
      operationKey: `iteration-receipt:${created.run.runRef}:draft:invalid-output`,
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('rejects a fulfilled receipt whose output lineage does not match the committed successor', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task6-fulfilled-lineage-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const turn = commitTask4ProducerTurn(store, created.run.runRef);
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    const input = {
      expectedLoopVersion: loop.version, requestRef: turn.request.requestRef,
      outcome: {
        schema: 'kb.iteration-outcome/v1' as const, requestRef: turn.request.requestRef,
        iterationLoopRef: loop.iterationLoopRef, participantId: 'draft-author', cycle: turn.request.cycle,
        verdict: 'fulfilled' as const, inputGenerationRefs: [...turn.request.inputGenerationRefs], criteria: [], findings: [],
        positions: [], recordedDissent: [], summary: 'Draft successor committed.',
      },
      outputGenerationRefs: [turn.generation.generationRef], baseCommit: turn.generation.baseCommit!,
      canonicalCommit: 'f'.repeat(40), participantAttemptRef: turn.attempt.attemptRef,
      operationKey: `iteration-receipt:${created.run.runRef}:draft:producer`,
    };
    expect(store.recordIterationReceipt('alice', loop.iterationLoopRef, input)).toMatchObject({ ok: false, reason: 'conflict' });

    const accepted = store.recordIterationReceipt('alice', loop.iterationLoopRef, {
      ...input, canonicalCommit: turn.generation.canonicalCommit!, operationKey: `${input.operationKey}:valid`,
    });
    if (!accepted.ok) throw new Error(accepted.detail);
    const path = join(root, 'control', 'control-plane.json');
    const document = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as PersistedReviewDocument;
    document.iterationReceipts[0]!.canonicalCommit = 'f'.repeat(40);
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow(/invalid control-plane iteration receipt/);
  });

  it('records one iteration request and receipt idempotently by operation key', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const request = task4Request(store, created.run.runRef);
    expect(request).toMatchObject({ ok: true });
    expect(task4Request(store, created.run.runRef)).toMatchObject({ ok: true, replayed: true, value: { requestRef: request.ok ? request.value.requestRef : '' } });
    const receipt = task4Receipt(store, created.run.runRef);
    expect(receipt).toMatchObject({ ok: true });
    const replayDetail = store.getRun('alice', created.run.runRef);
    if (!replayDetail.ok) throw new Error(replayDetail.detail);
    const participantAttemptRef = receipt.ok ? receipt.value.participantAttemptRef : undefined;
    if (!participantAttemptRef) throw new Error('iteration receipt attempt missing');
    const replay = store.recordIterationReceipt('alice', receipt.ok ? receipt.value.iterationLoopRef : '', receipt.ok ? {
      expectedLoopVersion: 999, requestRef: receipt.value.requestRef,
      outcome: { schema: 'kb.iteration-outcome/v1', requestRef: receipt.value.requestRef, iterationLoopRef: receipt.value.iterationLoopRef, participantId: 'draft-judge', cycle: 1, verdict: 'fail', inputGenerationRefs: [...receipt.value.inputGenerationRefs], criteria: receipt.value.criteria, findings: receipt.value.findings, positions: receipt.value.positions, recordedDissent: receipt.value.recordedDissent, summary: receipt.value.summary },
      outputGenerationRefs: [], baseCommit: receipt.value.baseCommit, canonicalCommit: receipt.value.canonicalCommit,
      participantAttemptRef,
      operationKey: `iteration-receipt:${created.run.runRef}:draft:c1:fail`,
    } : {} as never);
    expect(replay).toMatchObject({ ok: true, replayed: true, value: { receiptRef: receipt.ok ? receipt.value.receiptRef : '' } });
    const detail = store.getRun('alice', created.run.runRef);
    expect(detail).toMatchObject({ ok: true, value: { iterationRequests: [expect.anything()], iterationReceipts: [expect.anything()] } });
  });

  it('turns a parked verdict into exactly one restart-durable linked gate resolvable approve and decline', () => {
    for (const decision of ['approved', 'declined'] as const) {
      const root = mkdtempSync(join(tmpdir(), `control-store-task4-verdict-park-${decision}-`));
      roots.push(root);
      const store = createFileControlPlaneStore(root, deterministicOptions());
      const created = createTask4IterationRun(store);
      activateTask4Loop(store, created.run.runRef);
      const request = task4Request(store, created.run.runRef);
      if (!request.ok) throw new Error(request.detail);
      const before = store.getRun('alice', created.run.runRef);
      if (!before.ok) throw new Error(before.detail);
      const loop = before.value.iterationLoops[0]!;
      const generation = before.value.stageGenerations.find((item) => item.generationRef === request.value.inputGenerationRefs[0])!;
      const receipt = store.recordIterationReceipt('alice', loop.iterationLoopRef, {
        expectedLoopVersion: loop.version, requestRef: request.value.requestRef,
        outcome: {
          schema: 'kb.iteration-outcome/v1', requestRef: request.value.requestRef, iterationLoopRef: loop.iterationLoopRef,
          participantId: 'draft-judge', cycle: request.value.cycle, verdict: 'parked',
          inputGenerationRefs: [...request.value.inputGenerationRefs],
          criteria: [{ criterionId: 'draft-criterion', verdict: 'unverified', findingIds: [] }],
          findings: [],
          positions: [], recordedDissent: [], summary: 'Participant parked explicitly.',
        },
        outputGenerationRefs: [], baseCommit: generation.baseCommit!, canonicalCommit: generation.canonicalCommit!,
      participantAttemptRef: completeTask4JudgeStage(store, created.run.runRef).attempt.attemptRef,
      operationKey: `iteration-receipt:${created.run.runRef}:parked:${decision}`,
      });
      if (!receipt.ok) throw new Error(receipt.detail);
      let restarted = createFileControlPlaneStore(root, deterministicOptions());
      const parked = restarted.getRun('alice', created.run.runRef);
      if (!parked.ok) throw new Error(parked.detail);
      const parkedLoop = parked.value.iterationLoops[0]!;
      const gates = parked.value.humanRequests.filter((item) => item.gateKind === 'iteration-park');
      expect(parkedLoop).toMatchObject({ state: 'awaiting-park-gate', parkReason: 'parked', interventionRef: gates[0]?.requestRef,
        unresolvedResidue: { requestRefs: [request.value.requestRef], receiptRefs: [receipt.value.receiptRef],
          activeGenerationRefs: loop.activeGenerationRefs, acceptedGenerationRefs: [] } });
      expect(gates).toHaveLength(1);
      const resolved = restarted.resolveIterationGate('alice', gates[0]!.requestRef, {
        expectedRequestRevision: gates[0]!.revision, expectedLoopVersion: parkedLoop.version,
        expectedReceiptVersion: 1, decision, operationKey: `resolve-parked-verdict-${decision}`,
      });
      expect(resolved).toMatchObject({ ok: true, value: { loop: { state: decision === 'approved' ? 'passed' : 'declined' } } });
      restarted = createFileControlPlaneStore(root, deterministicOptions());
      expect(restarted.getRun('alice', created.run.runRef)).toMatchObject({ ok: true, value: {
        humanRequests: [expect.objectContaining({ requestRef: gates[0]!.requestRef, state: 'resolved' })],
        iterationLoops: [expect.objectContaining({ state: decision === 'approved' ? 'passed' : 'declined' })],
      } });
    }
  });

  it('activates an awaiting seed loop atomically and idempotently from its pinned seed generation', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store);
    const { generation, loop } = activateTask4Loop(store, created.run.runRef);
    expect(loop).toMatchObject({ state: 'awaiting-turn', cyclesUsed: 1, currentStepId: 'draft-review', turnOwnerParticipantId: 'draft-judge', activeGenerationRefs: [generation.generationRef] });
    expect(store.activateIterationLoop('alice', loop.iterationLoopRef, {
      expectedLoopVersion: 0, seedGenerationRefs: [generation.generationRef], artifactGenerationRefs: { 'draft-artifact': generation.generationRef },
      operationKey: `iteration-activate:${created.run.runRef}:draft-loop:c1`,
    })).toMatchObject({ ok: true, replayed: true, value: { version: loop.version } });
  });

  it('advances only the declared route with matching loop and generation CAS versions', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const receipt = task4Receipt(store, created.run.runRef);
    if (!receipt.ok) throw new Error(receipt.detail);
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    expect(store.advanceIterationTurn('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
      expectedActiveGenerationRefs: [...loop.activeGenerationRefs], nextStepId: 'draft-review', operationKey: 'advance-wrong-route',
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.advanceIterationTurn('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
      expectedActiveGenerationRefs: [...loop.activeGenerationRefs], nextStepId: 'draft-rework', operationKey: 'advance-declared-route',
    })).toMatchObject({ ok: true, value: { state: 'rework-queued', currentStepId: 'draft-rework', turnOwnerParticipantId: 'draft-author', cyclesUsed: 1 } });
  });

  it('replays a queued generic producer attempt only for the matching operation key and fingerprint', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task4-advance-replay-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const failed = task4Receipt(store, created.run.runRef, 'draft', 'fail');
    if (!failed.ok) throw new Error(failed.detail);
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    const genericInput = {
      expectedLoopVersion: loop.version, expectedReceiptRef: failed.value.receiptRef,
      expectedActiveGenerationRefs: [...loop.activeGenerationRefs], nextStepId: 'draft-rework',
      operationKey: 'advance-generic-replay',
    };
    expect(store.advanceIterationTurn('alice', loop.iterationLoopRef, genericInput)).toMatchObject({
      ok: true, value: { state: 'rework-queued', activeGenerationRefs: loop.activeGenerationRefs },
    });

    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.advanceIterationTurn('alice', loop.iterationLoopRef, genericInput)).toMatchObject({
      ok: true, replayed: true, value: { state: 'rework-queued', activeGenerationRefs: loop.activeGenerationRefs },
    });
    const after = restarted.getRun('alice', created.run.runRef);
    expect(after).toMatchObject({ ok: true, value: {
      stageGenerations: [expect.objectContaining({ generation: 1, state: 'committed' })],
      generationSupersessions: [],
      attempts: expect.arrayContaining([expect.objectContaining({ logicalGeneration: 2, state: 'queued' })]),
    } });
    expect(restarted.advanceIterationTurn('alice', loop.iterationLoopRef, {
      ...genericInput, operationKey: 'advance-generic-different-caller-key',
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('uses the persisted current step when a four-step schedule reuses a route', () => {
    const group = task4IterationGroup();
    group.initialStepId = 'draft-review-b';
    (group as { schedule: Array<{ stepId: string; routeId: string; after: { stepId: string; participantId: string; verdict: 'fulfilled' | 'fail' }; cycle: 'current' | 'next' }> }).schedule = [
      { stepId: 'draft-review-a', routeId: 'draft-to-judge', after: { stepId: 'draft-rework-a', participantId: 'draft-author', verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: 'draft-rework-a', routeId: 'draft-to-author', after: { stepId: 'draft-review-a', participantId: 'draft-judge', verdict: 'fail' }, cycle: 'current' },
      { stepId: 'draft-review-b', routeId: 'draft-to-judge', after: { stepId: 'draft-rework-b', participantId: 'draft-author', verdict: 'fulfilled' }, cycle: 'current' },
      { stepId: 'draft-rework-b', routeId: 'draft-to-author', after: { stepId: 'draft-review-b', participantId: 'draft-judge', verdict: 'fail' }, cycle: 'next' },
    ];
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store, [group]);
    activateTask4Loop(store, created.run.runRef);
    const request = task4Request(store, created.run.runRef);
    if (!request.ok) throw new Error(request.detail);
    expect(request.value.stepId).toBe('draft-review-b');
    const receipt = task4Receipt(store, created.run.runRef);
    if (!receipt.ok) throw new Error(receipt.detail);
    let detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    expect(store.advanceIterationTurn('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
      expectedActiveGenerationRefs: [...loop.activeGenerationRefs], nextStepId: 'draft-rework-a', operationKey: 'reused-route-wrong-successor',
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const advanced = store.advanceIterationTurn('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
      expectedActiveGenerationRefs: [...loop.activeGenerationRefs], nextStepId: 'draft-rework-b', operationKey: 'reused-route-declared-successor',
    });
    expect(advanced).toMatchObject({ ok: true, value: { currentStepId: 'draft-rework-b' } });
    detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const generation = detail.value.stageGenerations[0]!;
    const advancedLoop = detail.value.iterationLoops[0]!;
    expect(store.recordIterationRequest('alice', loop.iterationLoopRef, {
      expectedLoopVersion: advanced.ok ? advanced.value.version : -1, routeId: 'draft-to-author', kind: 'rework',
      inputGenerationRefs: [...advancedLoop.activeGenerationRefs], baseCommit: generation.canonicalCommit!,
      artifactHashes: { 'draft-artifact': generation.resultHash! }, unresolvedFindingRefs: ['draft-finding'], preservedInvariants: [],
      nextAcceptanceCheck: 'Resolve the finding.', instructions: 'Rework the draft.', operationKey: 'reused-route-cycle-two-request',
    })).toMatchObject({ ok: true, value: { stepId: 'draft-rework-b', cycle: 2 } });
  });

  it('rejects exhausted-reason parking before the declared cycle bound is exhausted', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const receipt = task4Receipt(store, created.run.runRef);
    if (!receipt.ok) throw new Error(receipt.detail);
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    expect(store.parkIterationLoop('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
      expectedActiveGenerationRefs: [...loop.activeGenerationRefs], reason: 'exhausted',
      nextRouteId: 'draft-to-author', operationKey: 'park-exhausted-too-early',
    })).toMatchObject({ ok: false, reason: 'ineligible', detail: expect.stringContaining('not exhausted') });
  });

  it('blocks a generic rework on a run-wide non-iteration intervention', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const receipt = task4Receipt(store, created.run.runRef);
    if (!receipt.ok) throw new Error(receipt.detail);
    const intervention = store.createHumanRequest('alice', created.run.runRef, {
      kind: 'intervention', title: 'Launch reconciliation', prompt: 'Reconcile the launch before more work.',
    });
    if (!intervention.ok) throw new Error(intervention.detail);
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    expect(store.advanceIterationTurn('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
      expectedActiveGenerationRefs: [...loop.activeGenerationRefs], nextStepId: 'draft-rework',
      operationKey: 'advance-blocked-by-reconciliation',
    })).toMatchObject({ ok: false, reason: 'ineligible', detail: expect.stringContaining('open gate or intervention') });
  });

  it('rejects a stale turn owner duplicate successor or receipt from the wrong participant', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const request = task4Request(store, created.run.runRef);
    if (!request.ok) throw new Error(request.detail);
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    const generation = detail.value.stageGenerations[0]!;
    expect(store.recordIterationReceipt('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, requestRef: request.value.requestRef,
      outcome: { schema: 'kb.iteration-outcome/v1', requestRef: request.value.requestRef, iterationLoopRef: loop.iterationLoopRef, participantId: 'draft-author', cycle: 1, verdict: 'fail', inputGenerationRefs: [...request.value.inputGenerationRefs], criteria: [{ criterionId: 'draft-criterion', verdict: 'fail', findingIds: ['draft-finding'] }], findings: [{ findingId: 'draft-finding', criterionId: 'draft-criterion', severity: 'blocking', summary: 'failed', evidencePaths: [] }], positions: [], recordedDissent: [], summary: 'failed' },
      outputGenerationRefs: [], baseCommit: generation.baseCommit!, canonicalCommit: generation.canonicalCommit!, participantAttemptRef: generation.attemptRef, operationKey: 'wrong-participant',
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const receipt = task4Receipt(store, created.run.runRef);
    if (!receipt.ok) throw new Error(receipt.detail);
    const after = store.getRun('alice', created.run.runRef);
    if (!after.ok) throw new Error(after.detail);
    expect(store.advanceIterationTurn('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
      expectedActiveGenerationRefs: [...after.value.iterationLoops[0]!.activeGenerationRefs], nextStepId: 'draft-rework', operationKey: 'stale-owner',
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.recordIterationReceipt('alice', loop.iterationLoopRef, {
      expectedLoopVersion: after.value.iterationLoops[0]!.version, requestRef: request.value.requestRef,
      outcome: { schema: 'kb.iteration-outcome/v1', requestRef: request.value.requestRef, iterationLoopRef: loop.iterationLoopRef, participantId: 'draft-judge', cycle: 1, verdict: 'fail', inputGenerationRefs: [...request.value.inputGenerationRefs], criteria: receipt.value.criteria, findings: receipt.value.findings, positions: receipt.value.positions, recordedDissent: [], summary: receipt.value.summary },
      outputGenerationRefs: [], baseCommit: generation.baseCommit!, canonicalCommit: generation.canonicalCommit!, participantAttemptRef: generation.attemptRef, operationKey: 'duplicate-successor-receipt',
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('parks an explicit participant stop atomically with every unresolved finding position artifact and next route', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task4-park-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    const receipt = task4Receipt(store, created.run.runRef);
    if (!receipt.ok) throw new Error(receipt.detail);
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    const parked = store.parkIterationLoop('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
      expectedActiveGenerationRefs: [...loop.activeGenerationRefs], reason: 'parked', nextRouteId: 'draft-to-author', operationKey: 'park-draft-explicit',
    });
    expect(parked).toMatchObject({ ok: true, value: { loop: { state: 'awaiting-park-gate', parkReason: 'parked', unresolvedResidue: {
      unresolvedFindings: [{ findingId: 'draft-finding' }], positions: [],
      activeGenerationRefs: loop.activeGenerationRefs, nextRouteId: 'draft-to-author', cyclesUsed: 1, maxCycles: 2,
    } }, gate: { kind: 'approval', gateKind: 'iteration-park', state: 'open' } } });
    const restarted = createFileControlPlaneStore(root, deterministicOptions()).getRun('alice', created.run.runRef);
    expect(restarted).toMatchObject({ ok: true, value: { iterationLoops: [expect.objectContaining({
      state: 'awaiting-park-gate', parkReason: 'parked', interventionRef: parked.ok ? parked.value.gate.requestRef : '',
    })] } });
  });

  it('scopes an open iteration park gate to its group while a sibling group completes', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store, [task4IterationGroup('left'), task4IterationGroup('right')]);
    activateTask4Loop(store, created.run.runRef, 'left');
    activateTask4Loop(store, created.run.runRef, 'right');
    const leftReceipt = task4Receipt(store, created.run.runRef, 'left');
    if (!leftReceipt.ok) throw new Error(leftReceipt.detail);
    let detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const left = detail.value.iterationLoops.find((loop) => loop.iterationGroupId === 'left-loop')!;
    expect(store.parkIterationLoop('alice', left.iterationLoopRef, {
      expectedLoopVersion: left.version, expectedReceiptRef: leftReceipt.value.receiptRef,
      expectedActiveGenerationRefs: [...left.activeGenerationRefs], reason: 'parked', nextRouteId: 'left-to-author', operationKey: 'park-left',
    })).toMatchObject({ ok: true });
    expect(task4Receipt(store, created.run.runRef, 'right', 'pass')).toMatchObject({ ok: true });
    detail = store.getRun('alice', created.run.runRef);
    expect(detail).toMatchObject({ ok: true, value: { iterationLoops: expect.arrayContaining([
      expect.objectContaining({ iterationGroupId: 'left-loop', state: 'awaiting-park-gate' }),
      expect.objectContaining({ iterationGroupId: 'right-loop', state: 'passed' }),
    ]) } });
  });

  it('scopes an open iteration completion gate to its group while a sibling group takes a turn', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store, [task4IterationGroup('left', true), task4IterationGroup('right')]);
    activateTask4Loop(store, created.run.runRef, 'left');
    activateTask4Loop(store, created.run.runRef, 'right');
    expect(task4Receipt(store, created.run.runRef, 'left', 'pass')).toMatchObject({ ok: true });
    expect(task4Request(store, created.run.runRef, 'right')).toMatchObject({ ok: true });
    expect(store.getRun('alice', created.run.runRef)).toMatchObject({ ok: true, value: { iterationLoops: expect.arrayContaining([
      expect.objectContaining({ iterationGroupId: 'left-loop', state: 'awaiting-completion-gate' }),
      expect.objectContaining({ iterationGroupId: 'right-loop', state: 'running-turn' }),
    ]) } });
  });

  it('approves the exact parked generation set or declines without adding a cycle', () => {
    for (const decision of ['approved', 'declined'] as const) {
      const store = createInMemoryControlPlaneStore(deterministicOptions());
      const created = createTask4IterationRun(store);
      activateTask4Loop(store, created.run.runRef);
      const receipt = task4Receipt(store, created.run.runRef);
      if (!receipt.ok) throw new Error(receipt.detail);
      let detail = store.getRun('alice', created.run.runRef);
      if (!detail.ok) throw new Error(detail.detail);
      const loop = detail.value.iterationLoops[0]!;
      const parked = store.parkIterationLoop('alice', loop.iterationLoopRef, {
        expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
        expectedActiveGenerationRefs: [...loop.activeGenerationRefs], reason: 'parked', nextRouteId: 'draft-to-author', operationKey: `park-${decision}`,
      });
      if (!parked.ok) throw new Error(parked.detail);
      const resolved = store.resolveIterationGate('alice', parked.value.gate.requestRef, {
        expectedRequestRevision: parked.value.gate.revision, expectedLoopVersion: parked.value.loop.version,
        expectedReceiptVersion: parked.value.receiptVersion, decision, operationKey: `resolve-${decision}`,
      });
      expect(resolved).toMatchObject({ ok: true, value: { loop: {
        state: decision === 'approved' ? 'passed' : 'declined', cyclesUsed: 1,
        ...(decision === 'approved' ? { acceptedGenerationRefs: loop.activeGenerationRefs } : {}),
      } } });
      expect(store.resolveIterationGate('alice', parked.value.gate.requestRef, {
        expectedRequestRevision: parked.value.gate.revision, expectedLoopVersion: parked.value.loop.version,
        expectedReceiptVersion: parked.value.receiptVersion, decision, operationKey: `resolve-${decision}`,
      })).toMatchObject({ ok: true, replayed: true, value: { interventionRequest: null } });
      detail = store.getRun('alice', created.run.runRef);
      expect(detail.ok && detail.value.iterationLoops[0]!.cyclesUsed).toBe(1);
    }
  });

  it('keeps post-acceptance completion approval distinct from iteration-park approval', () => {
    const completionStore = createInMemoryControlPlaneStore(deterministicOptions());
    const completionRun = createTask4IterationRun(completionStore, [task4IterationGroup('draft', true)]);
    activateTask4Loop(completionStore, completionRun.run.runRef);
    expect(task4Receipt(completionStore, completionRun.run.runRef, 'draft', 'pass')).toMatchObject({ ok: true });
    const completion = completionStore.getRun('alice', completionRun.run.runRef);
    if (!completion.ok) throw new Error(completion.detail);
    expect(completion.value.iterationLoops[0]).toMatchObject({ state: 'awaiting-completion-gate', completionGateRef: expect.any(String) });
    expect(completion.value.humanRequests).toContainEqual(expect.objectContaining({ requestRef: completion.value.iterationLoops[0]!.completionGateRef, kind: 'approval' }));
    const completionGate = completion.value.humanRequests.find((request) => request.requestRef === completion.value.iterationLoops[0]!.completionGateRef)!;
    expect(completionStore.resolveIterationGate('alice', completionGate.requestRef, {
      expectedRequestRevision: completionGate.revision, expectedLoopVersion: completion.value.iterationLoops[0]!.version,
      expectedReceiptVersion: 1, decision: 'changes-requested', operationKey: 'completion-needs-changes',
    })).toMatchObject({ ok: true, value: { loop: { state: 'parked' }, interventionRequest: { kind: 'intervention' } } });

    const parkStore = createInMemoryControlPlaneStore(deterministicOptions());
    const parkRun = createTask4IterationRun(parkStore);
    activateTask4Loop(parkStore, parkRun.run.runRef);
    const receipt = task4Receipt(parkStore, parkRun.run.runRef);
    if (!receipt.ok) throw new Error(receipt.detail);
    const beforePark = parkStore.getRun('alice', parkRun.run.runRef);
    if (!beforePark.ok) throw new Error(beforePark.detail);
    const loop = beforePark.value.iterationLoops[0]!;
    const parked = parkStore.parkIterationLoop('alice', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, expectedReceiptRef: receipt.value.receiptRef,
      expectedActiveGenerationRefs: [...loop.activeGenerationRefs], reason: 'parked', nextRouteId: 'draft-to-author', operationKey: 'park-explicit-stop',
    });
    if (!parked.ok) throw new Error(parked.detail);
    expect(parked.value.gate).toMatchObject({ kind: 'approval', gateKind: 'iteration-park' });
    expect(parkStore.resolveIterationGate('alice', parked.value.gate.requestRef, {
      expectedRequestRevision: 1, expectedLoopVersion: parked.value.loop.version, expectedReceiptVersion: parked.value.receiptVersion,
      decision: 'changes-requested', operationKey: 'extend-parked-run',
    })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('settles success only when every iteration group is terminal passed', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask4IterationRun(store);
    activateTask4Loop(store, created.run.runRef);
    completeTask4JudgeStage(store, created.run.runRef);
    expect(task4Receipt(store, created.run.runRef, 'draft', 'pass')).toMatchObject({ ok: true });
    const running = makeTask4RunRunningWithTerminalManager(store, created.run.runRef);
    expect(store.transitionRun('alice', created.run.runRef, running.version, 'succeeded'))
      .toMatchObject({ ok: true, value: { lifecycle: { kind: 'succeeded', deployPause: null } } });
  });

  it('keeps a declined completion-gated or iteration-parked group from successful settlement', () => {
    const completionStore = createInMemoryControlPlaneStore(deterministicOptions());
    const completionRun = createTask4IterationRun(completionStore, [task4IterationGroup('draft', true)]);
    activateTask4Loop(completionStore, completionRun.run.runRef);
    completeTask4JudgeStage(completionStore, completionRun.run.runRef);
    const completionReceipt = task4Receipt(completionStore, completionRun.run.runRef, 'draft', 'pass');
    if (!completionReceipt.ok) throw new Error(completionReceipt.detail);
    let completionDetail = completionStore.getRun('alice', completionRun.run.runRef);
    if (!completionDetail.ok) throw new Error(completionDetail.detail);
    const completionLoop = completionDetail.value.iterationLoops[0]!;
    const completionGate = completionDetail.value.humanRequests.find((request) =>
      request.requestRef === completionLoop.completionGateRef)!;
    expect(completionStore.resolveIterationGate('alice', completionGate.requestRef, {
      expectedRequestRevision: completionGate.revision, expectedLoopVersion: completionLoop.version,
      expectedReceiptVersion: 1, decision: 'declined', operationKey: 'decline-completion-task7',
    })).toMatchObject({ ok: true, value: { loop: { state: 'parked' } } });
    const completionRunning = makeTask4RunRunningWithTerminalManager(completionStore, completionRun.run.runRef);
    expect(completionStore.transitionRun('alice', completionRun.run.runRef, completionRunning.version, 'succeeded'))
      .toMatchObject({ ok: false, reason: 'invalid' });

    const parkStore = createInMemoryControlPlaneStore(deterministicOptions());
    const group = task4IterationGroup();
    group.maxCycles = 1;
    group.schedule[1]!.cycle = 'next';
    const parkRun = createTask4IterationRun(parkStore, [group]);
    activateTask4Loop(parkStore, parkRun.run.runRef);
    completeTask4JudgeStage(parkStore, parkRun.run.runRef);
    const failed = task4Receipt(parkStore, parkRun.run.runRef, 'draft', 'fail');
    if (!failed.ok) throw new Error(failed.detail);
    let parkDetail = parkStore.getRun('alice', parkRun.run.runRef);
    if (!parkDetail.ok) throw new Error(parkDetail.detail);
    const failedLoop = parkDetail.value.iterationLoops[0]!;
    const parked = parkStore.parkIterationLoop('alice', failedLoop.iterationLoopRef, {
      expectedLoopVersion: failedLoop.version, expectedReceiptRef: failed.value.receiptRef,
      expectedActiveGenerationRefs: [...failedLoop.activeGenerationRefs], reason: 'exhausted',
      nextRouteId: 'draft-to-author', operationKey: 'park-declined-task7',
    });
    if (!parked.ok) throw new Error(parked.detail);
    expect(parkStore.resolveIterationGate('alice', parked.value.gate.requestRef, {
      expectedRequestRevision: parked.value.gate.revision, expectedLoopVersion: parked.value.loop.version,
      expectedReceiptVersion: parked.value.receiptVersion, decision: 'declined', operationKey: 'decline-park-task7',
    })).toMatchObject({ ok: true, value: { loop: { state: 'declined' } } });
    const parkRunning = makeTask4RunRunningWithTerminalManager(parkStore, parkRun.run.runRef);
    expect(parkStore.transitionRun('alice', parkRun.run.runRef, parkRunning.version, 'succeeded'))
      .toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('resolves exhausted and no-progress iteration-park gates with identical approve or decline semantics', () => {
    for (const decision of ['approved', 'declined'] as const) {
      for (const reason of ['exhausted', 'no-progress'] as const) {
        const store = createInMemoryControlPlaneStore(deterministicOptions());
        const group = task4IterationGroup();
        group.maxCycles = reason === 'exhausted' ? 1 : 2;
        if (reason === 'exhausted') group.schedule[1]!.cycle = 'next';
        const created = createTask4IterationRun(store, [group]);
        activateTask4Loop(store, created.run.runRef);
        let parked;
        if (reason === 'exhausted') {
          const failed = task4Receipt(store, created.run.runRef, 'draft', 'fail');
          if (!failed.ok) throw new Error(failed.detail);
          const detail = store.getRun('alice', created.run.runRef);
          if (!detail.ok) throw new Error(detail.detail);
          const loop = detail.value.iterationLoops[0]!;
          parked = store.parkIterationLoop('alice', loop.iterationLoopRef, {
            expectedLoopVersion: loop.version, expectedReceiptRef: failed.value.receiptRef,
            expectedActiveGenerationRefs: [...loop.activeGenerationRefs], reason,
            nextRouteId: 'draft-to-author', operationKey: `park-${reason}-${decision}-task7`,
          });
        } else {
          parked = parkTask4NoProgress(store, created.run.runRef, `${decision}-task7`);
        }
        if (!parked.ok) throw new Error(parked.detail);
        expect(parked.value.gate).toMatchObject({ kind: 'approval', gateKind: 'iteration-park', state: 'open' });
        const resolved = store.resolveIterationGate('alice', parked.value.gate.requestRef, {
          expectedRequestRevision: parked.value.gate.revision, expectedLoopVersion: parked.value.loop.version,
          expectedReceiptVersion: parked.value.receiptVersion, decision,
          operationKey: `resolve-${reason}-${decision}-task7`,
        });
        expect(resolved).toMatchObject({ ok: true, value: { loop: {
          state: decision === 'approved' ? 'passed' : 'declined',
          cyclesUsed: parked.value.loop.cyclesUsed,
        }, interventionRequest: null } });
      }
    }
  });

  it('rejects corrupted attempted request outcome artifact snapshot or failure reason in no-progress residue', () => {
    const corruptions: Array<(residue: PersistedRow) => void> = [
      (residue) => { residue.attemptedRequestRef = 'iteration-request-outside'; },
      (residue) => { (residue.attemptedOutcome as PersistedRow).summary = ''; },
      (residue) => { ((residue.artifactSnapshots as PersistedRow[])[0]!).afterSha256 = 'invalid'; },
      (residue) => { ((residue.artifactSnapshots as PersistedRow[])[0]!).byteIdentical = false; },
      (residue) => { residue.failureReason = ''; },
    ];
    for (const [index, corrupt] of corruptions.entries()) {
      const root = mkdtempSync(join(tmpdir(), `control-store-task7-residue-${index}-`));
      roots.push(root);
      const store = createFileControlPlaneStore(root, deterministicOptions());
      const created = createTask4IterationRun(store);
      activateTask4Loop(store, created.run.runRef);
      const parked = parkTask4NoProgress(store, created.run.runRef, `durability-${index}`);
      if (!parked.ok) throw new Error(parked.detail);
      expect(createFileControlPlaneStore(root, deterministicOptions()).getRun('alice', created.run.runRef))
        .toMatchObject({ ok: true, value: { iterationLoops: [expect.objectContaining({ parkReason: 'no-progress' })] } });
      const path = join(root, 'control', 'control-plane.json');
      const document = JSON.parse(readFileSync(path, 'utf8')) as PersistedReviewDocument;
      const residue = document.iterationLoops[0]!.unresolvedResidue as PersistedRow;
      corrupt(residue);
      writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
      expect(() => createFileControlPlaneStore(root, deterministicOptions()))
        .toThrow(/invalid control-plane iteration no-progress residue/);
    }
  });

});

describe('Task 2 generic iteration durability', () => {
  it('materializes approved iteration groups with immutable definition hashes and version zero', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask2IterationRun(store);
    if (!created.ok) throw new Error(created.detail);
    expect(created.value.iterationLoops).toEqual([expect.objectContaining({
      iterationGroupId: 'draft-check', definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/), version: 0,
      completionGate: task2IterationGroup().completionGate,
    })]);
  });

  it('materializes cycle zero awaiting seed with no schedule step or turn owner', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createTask2IterationRun(store);
    if (!created.ok) throw new Error(created.detail);
    expect(created.value.iterationLoops[0]).toMatchObject({ cyclesUsed: 0, state: 'awaiting-seed', activeGenerationRefs: [] });
    expect(created.value.iterationLoops[0].currentStepId).toBeUndefined();
    expect(created.value.iterationLoops[0].turnOwnerParticipantId).toBeUndefined();
  });

  it('rejects an iteration group whose participant stage artifact or route is outside the approved run snapshot', () => {
    for (const mutate of [
      (group: ReturnType<typeof task2IterationGroup>) => { group.participants[1]!.stageRef = 'outside'; },
      (group: ReturnType<typeof task2IterationGroup>) => { group.activation.seedArtifactIds = ['outside']; },
      (group: ReturnType<typeof task2IterationGroup>) => { group.routes[0]!.baseResolutionStageIds = ['outside']; },
    ]) {
      const group = task2IterationGroup();
      mutate(group);
      const result = createTask2IterationRun(createInMemoryControlPlaneStore(deterministicOptions()), group);
      expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    }
  });

  it('returns invalid instead of throwing for malformed iteration shapes in the approved stored snapshot', () => {
    for (const group of [
      { ...task2IterationGroup(), activation: null },
      { ...task2IterationGroup(), routes: [{ ...task2IterationGroup().routes[0], baseResolutionStageIds: null }] },
      { ...task2IterationGroup(), participants: null },
    ] as any[]) {
      const store = createInMemoryControlPlaneStore(deterministicOptions());
      expect(() => createTask2IterationRun(store, group)).not.toThrow();
      expect(createTask2IterationRun(createInMemoryControlPlaneStore(deterministicOptions()), group))
        .toMatchObject({ ok: false, reason: 'invalid' });
    }
  });

  it('migrates persisted review loops receipts completion gates and supersessions into generic records on load', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task2-migrate-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    queueCreatorRework(first, committed);
    const path = join(root, 'control', 'control-plane.json');
    const document = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as PersistedReviewDocument;
    const loop = document.iterationLoops[0]!;
    const successorAttempt = document.attempts.find((attempt) => attempt.logicalGeneration === 2)!;
    const successorGenerationRef = 'generation-legacy-migration-successor';
    document.stageGenerations.push({
      subject: 'alice', operationFingerprint: 'e'.repeat(64),
      generationRef: successorGenerationRef, runRef: committed.generation.runRef,
      logicalStageRef: committed.generation.logicalStageRef, logicalStageId: committed.generation.logicalStageId,
      generation: 2, predecessorGenerationRef: committed.generation.generationRef,
      attemptRef: successorAttempt.attemptRef, canonicalResultOperationKey: null,
      resultHash: null, resultCardRef: null, baseCommit: null, canonicalCommit: null, state: 'queued',
      createdAt: successorAttempt.createdAt, updatedAt: successorAttempt.updatedAt,
    });
    loop.state = 'rework-queued';
    document.generationSupersessions.push({
      subject: 'alice', runRef: committed.generation.runRef,
      predecessorGenerationRef: committed.generation.generationRef, successorGenerationRef,
      triggerReceiptRef: loop.lastReceiptRef, operationKey: 'legacy-rework-supersession',
      operationFingerprint: 'f'.repeat(64), createdAt: successorAttempt.createdAt,
    });
    persistedReviewBundle(document, 'active');
    for (const row of document.generationSupersessions) {
      row.failedReviewReceiptRef = row.triggerReceiptRef;
      delete row.triggerReceiptRef;
    }
    delete (document as unknown as { iterationLoops?: unknown }).iterationLoops;
    delete (document as unknown as { iterationRequests?: unknown }).iterationRequests;
    delete (document as unknown as { iterationReceipts?: unknown }).iterationReceipts;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).not.toThrow();
    const migrated = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
    expect(migrated).not.toHaveProperty('reviewLoops');
    expect(migrated).not.toHaveProperty('reviewReceipts');
    expect(migrated.iterationLoops[0]).toMatchObject({ completionGate: CHECKER_COMPLETION_GATE, state: 'rework-queued' });
    expect(migrated.iterationReceipts).toHaveLength(1);
    expect(migrated.iterationRequests).toHaveLength(1);
    expect(migrated.generationSupersessions[0]).toHaveProperty('triggerReceiptRef');
    expect(migrated.generationSupersessions[0]).not.toHaveProperty('failedReviewReceiptRef');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).not.toThrow();

    const failedRoot = mkdtempSync(join(tmpdir(), 'control-store-task2-failed-migrate-'));
    roots.push(failedRoot);
    const failedStore = createFileControlPlaneStore(failedRoot, deterministicOptions());
    const failedCommitted = commitCheckerSubject(failedStore);
    failCheckerIteration(failedStore, failedCommitted);
    const failedPath = join(failedRoot, 'control', 'control-plane.json');
    const failedDocument = persistedV1(JSON.parse(readFileSync(failedPath, 'utf8'))) as PersistedReviewDocument;
    persistedReviewBundle(failedDocument, 'active');
    delete (failedDocument as unknown as { iterationLoops?: unknown }).iterationLoops;
    delete (failedDocument as unknown as { iterationRequests?: unknown }).iterationRequests;
    delete (failedDocument as unknown as { iterationReceipts?: unknown }).iterationReceipts;
    writeFileSync(failedPath, `${JSON.stringify(failedDocument)}\n`, 'utf8');
    createFileControlPlaneStore(failedRoot, deterministicOptions());
    const failedMigrated = JSON.parse(readFileSync(failedPath, 'utf8')) as Record<string, any>;
    expect(failedMigrated.iterationLoops[0]).toMatchObject({ state: 'failed' });
  });

  it('rejects tampered legacy review outcome content instead of re-blessing it during migration', () => {
    const corruptions: Array<[string, (outcome: PersistedRow) => void]> = [
      ['schema', (outcome) => { outcome.schema = 'kb.iteration-outcome/v1'; }],
      ['summary', (outcome) => { outcome.summary = 'Tampered after persistence.'; }],
      ['criteria', (outcome) => { ((outcome.criteria as PersistedRow[])[0]!).verdict = 'pass'; }],
      ['findings', (outcome) => { ((outcome.findings as PersistedRow[])[0]!).summary = 'Tampered finding.'; }],
    ];
    for (const [name, corrupt] of corruptions) {
      const root = mkdtempSync(join(tmpdir(), `control-store-legacy-outcome-${name}-`));
      roots.push(root);
      const store = createFileControlPlaneStore(root, deterministicOptions());
      const committed = commitCheckerSubject(store);
      failCheckerIteration(store, committed);
      const path = join(root, 'control', 'control-plane.json');
      const document = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as PersistedReviewDocument;
      const legacy = persistedReviewBundle(document, 'active');
      delete (document as unknown as { iterationLoops?: unknown }).iterationLoops;
      delete (document as unknown as { iterationRequests?: unknown }).iterationRequests;
      delete (document as unknown as { iterationReceipts?: unknown }).iterationReceipts;
      corrupt(legacy.reviewReceipts[0]!.outcome as PersistedRow);
      writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
      expect(() => createFileControlPlaneStore(root, deterministicOptions()), name)
        .toThrow(/invalid control-plane review receipt/);
    }
  });

  it('rejects a corrupted generic loop request receipt generation gate or supersession fixture on load', () => {
    const cases: Array<[string, (document: any) => void]> = [
      ['definition hash', (document) => { document.iterationLoops[0].definitionHash = '0'.repeat(64); }],
      ['request route', (document) => { document.iterationRequests[0].routeId = 'outside'; }],
      ['receipt outcome', (document) => { document.iterationReceipts[0].outcomeHash = '0'.repeat(64); }],
      ['generation result', (document) => { document.stageGenerations[0].resultHash = '0'.repeat(64); }],
      ['completion gate', (document) => { document.iterationLoops[0].completionGate.prompt = ''; }],
      ['supersession receipt', (document) => { document.generationSupersessions[0].triggerReceiptRef = 'receipt-outside'; }],
      ['loop state', (document) => { document.iterationLoops[0].state = 'awaiting-turn'; }],
    ];
    for (const [name, corrupt] of cases) {
      const root = mkdtempSync(join(tmpdir(), 'control-store-generic-corrupt-'));
      roots.push(root);
      const store = createFileControlPlaneStore(root, deterministicOptions());
      const created = createTask4IterationRun(store, [task4IterationGroup('draft', true)]);
      activateTask4Loop(store, created.run.runRef);
      commitTask4ProducerTurn(store, created.run.runRef);
      const path = join(root, 'control', 'control-plane.json');
      const document = JSON.parse(readFileSync(path, 'utf8'));
      corrupt(document);
      writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
      expect(() => createFileControlPlaneStore(root, deterministicOptions()), name).toThrow(/invalid control-plane/);
    }
  });

  it('rejects corruption at the quarantine and restore boundaries independently of load validation', () => {
    let boundary: 'quarantine' | 'restore' | null = null;
    const store = createInMemoryControlPlaneStore({
      ...deterministicOptions(),
      beforeIterationBoundaryValidationForTest(kind: 'quarantine' | 'restore', target: any) {
        if (kind === boundary) target.iterationLoops.push(corruptIterationLoop(
          kind === 'restore' ? target.run.runRef : target.runs[0].runRef,
        ));
      },
    });
    const active = createTask2IterationRun(store);
    if (!active.ok) throw new Error(active.detail);
    boundary = 'quarantine';
    expect(() => store.quarantineRuns('alice', [active.value.run.runRef], '0'.repeat(64)))
      .toThrow(/invalid control-plane iteration/);

    boundary = null;
    const plain = createRun(store, 'bob');
    const stoppedRun = store.transitionRun('bob', plain.run.runRef, plain.run.version, 'interrupted');
    if (!stoppedRun.ok) throw new Error(stoppedRun.detail);
    for (const stage of plain.stages) {
      const stopped = store.transitionStage('bob', stage.stageRef, stage.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    const stoppedManager = store.transitionSession('bob', plain.sessions[0]!.sessionRef, plain.sessions[0]!.version, 'stopped');
    if (!stoppedManager.ok) throw new Error(stoppedManager.detail);
    const plan = store.dryRunQuarantine('bob', [plain.run.runRef]);
    if (!plan.ok) throw new Error(plan.detail);
    expect(store.quarantineRuns('bob', [plain.run.runRef], plan.value.planHash)).toMatchObject({ ok: true });
    boundary = 'restore';
    expect(() => store.restoreRun('bob', plain.run.runRef)).toThrow(/invalid control-plane iteration/);
  });

  it('returns run detail with iteration collections and no review collections after cutover', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task2-projection-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const created = createCheckerRun(store);
    expect(created.iterationLoops).toHaveLength(1);
    expect(created).not.toHaveProperty('reviewLoops');
    expect(created).not.toHaveProperty('reviewReceipts');
    const document = JSON.parse(readFileSync(join(root, 'control', 'control-plane.json'), 'utf8')) as Record<string, unknown>;
    expect(document).not.toHaveProperty('reviewLoops');
    expect(document).not.toHaveProperty('reviewReceipts');
    expect(document).toHaveProperty('iterationLoops');
  });

  it('rejects cyclesUsed inflation beyond the receipt and generation graph', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task2-cycles-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(store);
    failCheckerIteration(store, committed);
    const path = join(root, 'control', 'control-plane.json');
    const document = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as PersistedReviewDocument;
    document.iterationLoops[0]!.cyclesUsed = document.iterationLoops[0]!.maxCycles;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow(/iteration cycle evidence/);
  });

  it('binds an iteration request fingerprint to the canonical request content', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task2-request-fingerprint-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(store);
    failCheckerIteration(store, committed);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as PersistedReviewDocument;
    document.iterationRequests[0]!.instructions = 'Tampered after persistence.';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow(/iteration request fingerprint/);
  });

  it('rejects dangling finding refs and empty rework instructions or acceptance checks', () => {
    for (const testCase of [
      { rework: false, mutate: (request: PersistedRow) => { request.unresolvedFindingRefs = ['finding-missing']; } },
      { rework: true, mutate: (request: PersistedRow) => { request.instructions = ''; } },
      { rework: true, mutate: (request: PersistedRow) => { request.nextAcceptanceCheck = ''; } },
    ]) {
      const root = mkdtempSync(join(tmpdir(), 'control-store-task2-rework-request-'));
      roots.push(root);
      const store = createFileControlPlaneStore(root, deterministicOptions());
      const committed = commitCheckerSubject(store);
      failCheckerIteration(store, committed);
      const path = join(root, 'control', 'control-plane.json');
      const document = JSON.parse(readFileSync(path, 'utf8')) as PersistedReviewDocument;
      const request = document.iterationRequests[0]!;
      if (testCase.rework) {
        request.routeId = 'check-to-manager';
        request.senderParticipantId = 'check-judge';
        request.recipientParticipantId = 'build-manager';
        request.kind = 'rework';
      }
      testCase.mutate(request);
      request.operationFingerprint = iterationRequestFingerprintForTest(request);
      writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
      expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow(/iteration request/);
    }
  });

  it('reports an oversized legacy migration with measured source and migrated sizes', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task2-oversized-migration-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(store);
    failCheckerIteration(store, committed);
    const path = join(root, 'control', 'control-plane.json');
    const genericBytes = statSync(path).size;
    const document = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as PersistedReviewDocument;
    persistedReviewBundle(document, 'active');
    delete (document as unknown as { iterationLoops?: unknown }).iterationLoops;
    delete (document as unknown as { iterationRequests?: unknown }).iterationRequests;
    delete (document as unknown as { iterationReceipts?: unknown }).iterationReceipts;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    const legacyBytes = statSync(path).size;
    expect(genericBytes).toBeGreaterThan(legacyBytes);
    const maxDocumentBytes = Math.floor((legacyBytes + genericBytes) / 2);
    expect(() => createFileControlPlaneStore(root, { ...deterministicOptions(), maxDocumentBytes }))
      .toThrow(new RegExp(`migration.*${maxDocumentBytes}.*source ${legacyBytes}.*migrated \\d+`, 'i'));
  });

  it('loads and mutates a migration-grown document across every boot', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task2-large-v1-no-legacy-'));
    roots.push(root);
    const path = join(root, 'control', 'control-plane.json');
    mkdirSync(dirname(path), { recursive: true });
    const stamp = '2026-08-20T00:00:00.000Z';
    const source = largeV1MigrationSource(stamp);
    const sourceEncoded = `${JSON.stringify(source)}\n`;
    const projected = applyMigrationEdgeForTest(source, 2, { stamp }) as Record<string, unknown>;
    projected.documentRevision = 1;
    const projectedEncoded = `${JSON.stringify(projected)}\n`;
    const sourceBytes = Buffer.byteLength(sourceEncoded, 'utf8');
    const projectedBytes = Buffer.byteLength(projectedEncoded, 'utf8');
    expect(projectedBytes).toBeGreaterThan(sourceBytes);
    const maxDocumentBytes = Math.floor((sourceBytes + projectedBytes) / 2);
    writeFileSync(path, sourceEncoded, 'utf8');

    const loaded = createFileControlPlaneStore(root, { ...deterministicOptions(), maxDocumentBytes });
    expect(loaded.listRuns('alice')).toHaveLength(64);
    expect(loaded.createProposalRevision('alice', {
      sourceComposerRef: 'large-v1-first-boot', sourceTurnId: 'turn-first', title: 'First boot', snapshot: {},
    }).ok).toBe(true);

    const secondBoot = createFileControlPlaneStore(root, { ...deterministicOptions(), maxDocumentBytes });
    expect(secondBoot.listRuns('alice')).toHaveLength(64);
    expect(secondBoot.createProposalRevision('alice', {
      sourceComposerRef: 'large-v1-second-boot', sourceTurnId: 'turn-second', title: 'Second boot', snapshot: {},
    }).ok).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 2, documentRevision: 3 });
  });

  it.each([
    ['truncated', '{"schema":'],
    ['wrong shape', JSON.stringify({ schema: 'kb.control-plane-accepted-size/v1', maxBytes: 999 })],
  ])('ignores a %s accepted-size sidecar and lets the configured base limit decide', (_name, sidecar) => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-invalid-size-sidecar-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    expect(createApprovedProposal(store).approval?.decision).toBe('approved');
    const control = join(root, 'control');
    const path = join(control, 'control-plane.json');
    writeFileSync(join(control, CONTROL_PLANE_ACCEPTED_SIZE_FILENAME), `${sidecar}\n`, 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const baseLimit = statSync(path).size + 1;
      expect(() => createFileControlPlaneStore(root, { ...deterministicOptions(), maxDocumentBytes: baseLimit }))
        .not.toThrow();
      expect(warn).toHaveBeenCalledWith('[control-store] ignoring invalid control-plane accepted-size sidecar');
      expect(() => createFileControlPlaneStore(root, { ...deterministicOptions(), maxDocumentBytes: 1 }))
        .toThrow(ControlStoreLimitError);
    } finally {
      warn.mockRestore();
    }
  });

  it('boots when a valid older grant is below a newly raised configured limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-raised-base-limit-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    expect(createApprovedProposal(store).approval?.decision).toBe('approved');
    const control = join(root, 'control');
    const path = join(control, 'control-plane.json');
    const raisedLimit = statSync(path).size + 100;
    writeFileSync(join(control, CONTROL_PLANE_ACCEPTED_SIZE_FILENAME), `${JSON.stringify({
      schema: 'kb.control-plane-accepted-size/v1', schemaVersion: 2, maxBytes: 1,
    })}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, {
      ...deterministicOptions(), maxDocumentBytes: raisedLimit,
    })).not.toThrow();
  });

  it('accumulates a future migration grant on top of the existing accepted size', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-future-size-grant-'));
    roots.push(root);
    const control = join(root, 'control');
    const path = join(control, 'control-plane.json');
    const sidecarPath = join(control, CONTROL_PLANE_ACCEPTED_SIZE_FILENAME);
    mkdirSync(control, { recursive: true });
    const stamp = '2026-08-20T00:00:00.000Z';
    const source = largeV1MigrationSource(stamp);
    const sourceEncoded = `${JSON.stringify(source)}\n`;
    const projected = applyMigrationEdgeForTest(source, 2, { stamp }) as Record<string, unknown>;
    projected.documentRevision = 1;
    const projectedEncoded = `${JSON.stringify(projected)}\n`;
    const maxDocumentBytes = Math.floor((Buffer.byteLength(sourceEncoded) + Buffer.byteLength(projectedEncoded)) / 2);
    writeFileSync(path, sourceEncoded, 'utf8');
    createFileControlPlaneStore(root, { ...deterministicOptions(), maxDocumentBytes });
    const firstGrant = JSON.parse(readFileSync(sidecarPath, 'utf8')) as { maxBytes: number; schemaVersion: number };
    expect(statSync(path).size).toBeGreaterThan(maxDocumentBytes);
    expect(firstGrant).toMatchObject({ schemaVersion: 2 });

    expect(() => createFileControlPlaneStore(root, {
      ...deterministicOptions(),
      maxDocumentBytes,
      loadAndMigrateForTest: (encoded, target, context) => {
        const result = loadAndMigrate(encoded, target, context);
        if ((JSON.parse(encoded) as { version: number }).version === 2) {
          for (const run of result.document.runs) run.title = `${run.title}x`;
          return { document: result.document, applied: [{ from: 2, to: 3, breaking: true, down: 'present' }] };
        }
        return result;
      },
    })).not.toThrow();
    const secondGrant = JSON.parse(readFileSync(sidecarPath, 'utf8')) as { maxBytes: number; schemaVersion: number };
    expect(secondGrant.schemaVersion).toBe(2);
    expect(secondGrant.maxBytes).toBeGreaterThan(firstGrant.maxBytes);
  });

  it('does not advance the accepted-size sidecar when the validating migration save fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-size-grant-save-failure-'));
    roots.push(root);
    const control = join(root, 'control');
    const path = join(control, 'control-plane.json');
    const sidecarPath = join(control, CONTROL_PLANE_ACCEPTED_SIZE_FILENAME);
    mkdirSync(control, { recursive: true });
    const stamp = '2026-08-20T00:00:00.000Z';
    const source = largeV1MigrationSource(stamp);
    const sourceEncoded = `${JSON.stringify(source)}\n`;
    const projectedEncoded = `${JSON.stringify(applyMigrationEdgeForTest(source, 2, { stamp }))}\n`;
    const maxDocumentBytes = Math.floor((Buffer.byteLength(sourceEncoded) + Buffer.byteLength(projectedEncoded)) / 2);
    writeFileSync(path, sourceEncoded, 'utf8');
    const delegate = createNodePersistenceDeps();
    const persistenceDepsForTest = {
      ...delegate,
      rename: (temp: string, target: string) => {
        if (target === path) throw new Error('injected validating save refusal');
        delegate.rename(temp, target);
      },
    };
    expect(() => createFileControlPlaneStore(root, {
      ...deterministicOptions(), maxDocumentBytes, persistenceDepsForTest,
    })).toThrow(/injected validating save refusal/);
    expect(existsSync(sidecarPath)).toBe(false);
  });

  it('refuses a corrupted persisted stage generation projection at hydration', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-task2-stage-generation-projection-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    createRun(store);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as PersistedReviewDocument;
    document.stages[0]!.currentGeneration = 0;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions()))
      .toThrow('invalid control-plane stage generation projection');
  });
});

function settleRetryPredecessor(
  store: ControlPlaneStore,
  subject = 'alice',
  factory: (store: ControlPlaneStore, subject: string) => ReturnType<typeof createRun> = createRun,
) {
  const created = factory(store, subject);
  for (const stage of created.stages) {
    const linked = store.linkStageCard(subject, stage.stageRef, stage.version, `card-${stage.stageId}`);
    if (!linked.ok) throw new Error(linked.detail);
    const stopped = store.transitionStage(subject, stage.stageRef, linked.value.version, 'stopped');
    if (!stopped.ok) throw new Error(stopped.detail);
  }
  const manager = created.sessions.find((session) => session.sessionRef === created.run.managerSessionRef);
  if (!manager) throw new Error('manager missing');
  const stoppedManager = store.transitionSession(subject, manager.sessionRef, manager.version, 'stopped');
  if (!stoppedManager.ok) throw new Error(stoppedManager.detail);
  const publishing = store.transitionPublication(subject, created.run.runRef, created.run.version, 'publishing');
  if (!publishing.ok) throw new Error(publishing.detail);
  const published = store.transitionPublication(subject, created.run.runRef, publishing.value.version, 'published');
  if (!published.ok) throw new Error(published.detail);
  const failed = store.transitionRun(subject, created.run.runRef, published.value.version, 'failed');
  if (!failed.ok) throw new Error(failed.detail);
  const detail = store.getRun(subject, created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  return detail.value;
}

describe('proposal revision persistence', () => {
  it('creates subject-bound immutable hash chains and metadata-only listings', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const first = store.createProposalRevision('alice', {
      ...SOURCE,
      title: 'First',
      snapshot: { z: 1, nested: { b: true, a: null }, a: ['x', 2] },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.hash).toBe(proposalSnapshotHash({ a: ['x', 2], nested: { a: null, b: true }, z: 1 }));
    expect(store.getProposalRevision('bob', first.value.proposalRef, 1)).toMatchObject({ ok: false, reason: 'not-found' });

    const stale = store.createProposalRevision('alice', {
      ...SOURCE,
      proposalRef: first.value.proposalRef,
      expectedPreviousHash: '0'.repeat(64),
      title: 'Second',
      snapshot: { version: 2 },
    });
    expect(stale).toMatchObject({ ok: false, reason: 'conflict' });
    const second = store.createProposalRevision('alice', {
      ...SOURCE,
      proposalRef: first.value.proposalRef,
      expectedPreviousHash: first.value.hash,
      title: 'Second',
      snapshot: { version: 2 },
    });
    expect(second.ok && second.value).toMatchObject({ revision: 2, previousHash: first.value.hash, approval: null });

    const listed = store.listProposalRevisions('alice');
    expect(listed.map((item) => item.revision)).toEqual([2, 1]);
    expect(JSON.stringify(listed)).not.toContain('snapshot');
    expect(store.listProposalRevisions('bob')).toEqual([]);
  });

  it('refuses non-JSON, oversized, and recognizable credential-bearing snapshots', () => {
    const store = createInMemoryControlPlaneStore();
    expect(store.createProposalRevision('alice', {
      ...SOURCE,
      title: 'Secret',
      snapshot: { workOrder: 'api_key=sk-abcdefghijklmnopqrstuvwxyz' },
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createProposalRevision('alice', {
      ...SOURCE,
      title: 'Huge',
      snapshot: { text: 'x'.repeat(512 * 1024) },
    })).toMatchObject({ ok: false, reason: 'limit' });
    expect(store.createProposalRevision('alice', {
      ...SOURCE,
      title: 'Bad number',
      snapshot: { value: Number.NaN },
    })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('binds a single idempotent decision to the exact hash and approval revision', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = store.createProposalRevision('alice', { ...SOURCE, title: 'Review me', snapshot: { safe: true } });
    if (!proposal.ok) throw new Error(proposal.detail);
    const request = {
      expectedHash: proposal.value.hash,
      expectedApprovalRevision: 0 as const,
      decision: 'approved' as const,
      idempotencyKey: 'approve-once',
      note: 'Reviewed',
    };
    expect(store.decideProposal('alice', proposal.value.proposalRef, 1, { ...request, expectedHash: '0'.repeat(64) })).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    expect(store.decideProposal('alice', proposal.value.proposalRef, 1, request)).toMatchObject({ ok: true });
    expect(store.decideProposal('alice', proposal.value.proposalRef, 1, request)).toMatchObject({ ok: true, replayed: true });
    expect(store.decideProposal('alice', proposal.value.proposalRef, 1, { ...request, decision: 'rejected' })).toMatchObject({
      ok: false,
      reason: 'idempotency-conflict',
    });
    expect(store.listProposalRevisions('alice')[0]?.approval).not.toHaveProperty('idempotencyKey');
  });

  it('filters provenance by subject and Composer ref, while a fork mints a fresh unapproved proposal', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const approved = createApprovedProposal(store);
    const fork = store.createProposalRevision('alice', {
      sourceComposerRef: 'composer-fork',
      sourceTurnId: 'turn-fork-1',
      title: 'Forked proposal',
      snapshot: approved.snapshot,
    });
    if (!fork.ok) throw new Error(fork.detail);
    expect(fork.value).toMatchObject({
      sourceComposerRef: 'composer-fork',
      sourceTurnId: 'turn-fork-1',
      approval: null,
      revision: 1,
    });
    expect(fork.value.proposalRef).not.toBe(approved.proposalRef);
    expect(store.listProposalRevisionsForComposer('alice', 'composer-fork')).toEqual([
      expect.objectContaining({ proposalRef: fork.value.proposalRef, sourceTurnId: 'turn-fork-1' }),
    ]);
    expect(store.listProposalRevisionsForComposer('alice', SOURCE.sourceComposerRef)).toHaveLength(1);
    expect(store.listProposalRevisionsForComposer('bob', 'composer-fork')).toEqual([]);
  });
});

describe('run graph, attempts, and managed sessions', () => {
  it('replays an identical launch key and refuses key reuse with changed content', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = createApprovedProposal(store, 'alice', { manager: {}, stages: [{ id: 'build', title: 'Build', dependsOn: [] }] });
    const input = {
      title: 'Idempotent run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
      expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'launch-once', stages: [{ stageId: 'build', title: 'Build', dependsOn: [] }],
    };
    const first = store.createRun('alice', input);
    const replay = store.createRun('alice', input);
    expect(first.ok && replay.ok && replay.value.run.runRef).toBe(first.ok ? first.value.run.runRef : '');
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(store.createRun('alice', { ...input, title: 'Changed' })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
  });

  it('copies only the exact approved assignment snapshot into a run and its stages', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const inputAssignments = {
      manager: structuredClone(MANAGER_ASSIGNMENT), build: structuredClone(BUILD_ASSIGNMENT), verify: structuredClone(VERIFY_ASSIGNMENT),
    };
    const created = createAssignedRun(store, 'alice', inputAssignments);
    expect(created.run.managerAssignment).toEqual(MANAGER_ASSIGNMENT);
    expect(created.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stageId: 'build', assignment: BUILD_ASSIGNMENT }),
      expect.objectContaining({ stageId: 'verify', assignment: VERIFY_ASSIGNMENT }),
    ]));
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.run.managerAssignment).toEqual(MANAGER_ASSIGNMENT);
    expect(detail.value.stages.find((stage) => stage.stageId === 'build')?.assignment).toEqual(BUILD_ASSIGNMENT);
    inputAssignments.manager.model = 'mutated-after-create';
    inputAssignments.build.model = 'mutated-after-create';
    const afterMutation = store.getRun('alice', created.run.runRef);
    if (!afterMutation.ok) throw new Error(afterMutation.detail);
    expect(afterMutation.value.run.managerAssignment).toEqual(MANAGER_ASSIGNMENT);
    expect(afterMutation.value.stages.find((stage) => stage.stageId === 'build')?.assignment).toEqual(BUILD_ASSIGNMENT);
  });

  it('round-trips immutable checker contract provenance and binds it into launch replay', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = createApprovedProposal(store, 'alice', checkerSnapshot());
    const input = {
      title: 'Checker run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
      expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'checker-launch-once', stages: checkerStages(),
    };
    const first = store.createRun('alice', input);
    if (!first.ok) throw new Error(first.detail);
    const checker = first.value.stages.find((stage) => stage.stageId === 'check');
    expect(checker).toMatchObject({
      workflowProfile: 'checker-readonly', review: CHECKER_REVIEW, completionGate: CHECKER_COMPLETION_GATE,
    });
    const callerReview = input.stages[1]?.review;
    if (!callerReview) throw new Error('checker review missing');
    callerReview.criteria[0]!.description = 'Mutated caller value.';
    const afterMutation = store.getRun('alice', first.value.run.runRef);
    if (!afterMutation.ok) throw new Error(afterMutation.detail);
    expect(afterMutation.value.stages.find((stage) => stage.stageId === 'check')).toMatchObject({
      review: CHECKER_REVIEW, completionGate: CHECKER_COMPLETION_GATE,
    });
    const exactReplay = store.createRun('alice', {
      ...input,
      stages: checkerStages(),
    });
    expect(exactReplay).toMatchObject({ ok: true, replayed: true });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...checkerStages()[0] }, {
        ...checkerStages()[1], completionGate: { ...CHECKER_COMPLETION_GATE, prompt: 'Different approval prompt.' },
      }],
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
  });

  it('rejects checker contract omission, substitution, injection, and malformed combinations', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = createApprovedProposal(store, 'alice', checkerSnapshot());
    const base = {
      title: 'Checker provenance', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
      expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
    };
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-omitted', stages: [checkerStages()[0], { ...checkerStages()[1], review: null, completionGate: null, workflowProfile: null }],
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-substituted', stages: [checkerStages()[0], {
        ...checkerStages()[1], review: { ...CHECKER_REVIEW, maxCreatorReworks: 2 },
      }],
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-injected', stages: [checkerStages()[0], {
        ...checkerStages()[1], review: { ...CHECKER_REVIEW, extra: true } as never,
      }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-wrong-profile', stages: [checkerStages()[0], {
        ...checkerStages()[1], workflowProfile: 'writer-profile',
      }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-gate-without-review', stages: [checkerStages()[0], {
        ...checkerStages()[1], review: null,
      }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('refuses tampered or malformed assignment provenance before a run is created', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = createApprovedProposal(store, 'alice', {
      manager: { assignment: MANAGER_ASSIGNMENT }, stages: [{ id: 'build', title: 'Build', dependsOn: [], assignment: BUILD_ASSIGNMENT }],
    });
    const input = {
      title: 'Tampered assignment', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
      expectedProposalHash: proposal.hash, managerRuntime: MANAGER_ASSIGNMENT.runtime, managerModel: MANAGER_ASSIGNMENT.model,
      managerAssignment: { ...MANAGER_ASSIGNMENT }, idempotencyKey: 'tampered-assignment',
      stages: [{ stageId: 'build', title: 'Build', dependsOn: [], assignment: { ...BUILD_ASSIGNMENT } }],
    };
    expect(store.createRun('alice', {
      ...input,
      managerAssignment: { ...MANAGER_ASSIGNMENT, declarationHash: 'd'.repeat(64) },
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...input.stages[0], assignment: { ...BUILD_ASSIGNMENT, profileId: 'codex:other' } }],
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.createRun('alice', {
      ...input,
      managerAssignment: { ...MANAGER_ASSIGNMENT, extra: 'nope' } as never,
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...input.stages[0], title: 'Renamed build' }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...input.stages[0], canonicalCardRef: 'card-injected' }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const dependencyProposal = createApprovedProposal(store, 'alice', {
      manager: {}, stages: [
        { id: 'build', title: 'Build', dependsOn: [] }, { id: 'verify', title: 'Verify', dependsOn: ['build'] },
      ],
    });
    expect(store.createRun('alice', {
      title: 'Tampered dependencies', proposalRef: dependencyProposal.proposalRef, proposalRevision: dependencyProposal.revision,
      expectedProposalHash: dependencyProposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'tampered-dependencies',
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [] }, { stageId: 'verify', title: 'Verify', dependsOn: [] },
      ],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const incomplete = createApprovedProposal(store, 'alice', { manager: {}, stages: [{ id: 'build', title: 'Build', dependsOn: [] }] });
    expect(store.createRun('alice', {
      title: 'Missing approved stage', proposalRef: incomplete.proposalRef, proposalRevision: incomplete.revision,
      expectedProposalHash: incomplete.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'missing-approved-stage',
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [] },
        { stageId: 'verify', title: 'Verify', dependsOn: ['build'] },
      ],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const excessive = createApprovedProposal(store, 'alice', {
      manager: {}, stages: [
        { id: 'build', title: 'Build', dependsOn: [] }, { id: 'verify', title: 'Verify', dependsOn: ['build'] },
        { id: 'unexpected', title: 'Unexpected', dependsOn: [] },
      ],
    });
    expect(store.createRun('alice', {
      title: 'Extra approved stage', proposalRef: excessive.proposalRef, proposalRevision: excessive.revision,
      expectedProposalHash: excessive.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'extra-approved-stage',
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [] },
        { stageId: 'verify', title: 'Verify', dependsOn: ['build'] },
      ],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.listRuns('alice')).toEqual([]);
  });

  it('keeps assignment provenance in Retry and binds it into idempotency', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const predecessor = settleRetryPredecessor(store, 'alice', createAssignedRun);
    const input = {
      title: 'Assigned Retry', proposalRef: predecessor.run.proposalRef, proposalRevision: predecessor.run.proposalRevision,
      expectedProposalHash: predecessor.run.proposalHash, managerRuntime: MANAGER_ASSIGNMENT.runtime, managerModel: MANAGER_ASSIGNMENT.model,
      managerAssignment: structuredClone(MANAGER_ASSIGNMENT), idempotencyKey: 'assigned-retry',
      predecessorRunRef: predecessor.run.runRef, expectedPredecessorVersion: predecessor.run.version,
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [], assignment: structuredClone(BUILD_ASSIGNMENT) },
        { stageId: 'verify', title: 'Verify', dependsOn: ['build'], assignment: structuredClone(VERIFY_ASSIGNMENT) },
      ],
    };
    const successor = store.createRun('alice', input);
    expect(successor).toMatchObject({ ok: true, value: { run: { managerAssignment: MANAGER_ASSIGNMENT } } });
    expect(store.createRun('alice', input)).toMatchObject({ ok: true, replayed: true });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...input.stages[0], assignment: { ...BUILD_ASSIGNMENT, declarationHash: 'd'.repeat(64) } }, input.stages[1]],
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
  });

  it('preserves checker contract provenance in Retry successors', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const predecessor = settleRetryPredecessor(store, 'alice', createCheckerRun);
    const input = {
      title: 'Checker Retry', proposalRef: predecessor.run.proposalRef, proposalRevision: predecessor.run.proposalRevision,
      expectedProposalHash: predecessor.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'checker-retry', predecessorRunRef: predecessor.run.runRef, expectedPredecessorVersion: predecessor.run.version,
      stages: checkerStages(),
    };
    const successor = store.createRun('alice', input);
    if (!successor.ok) throw new Error(successor.detail);
    expect(successor.value.stages.find((stage) => stage.stageId === 'check')).toMatchObject({
      workflowProfile: 'checker-readonly', review: CHECKER_REVIEW, completionGate: CHECKER_COMPLETION_GATE,
    });
    expect(store.createRun('alice', input)).toMatchObject({ ok: true, replayed: true });
    expect(store.createRun('alice', {
      ...input,
      stages: [checkerStages()[0], { ...checkerStages()[1], completionGate: { ...CHECKER_COMPLETION_GATE, prompt: 'Changed.' } }],
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
  });



  it('blocks generic stage and checker-attempt bypasses until immutable review lineage exists', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createCheckerRun(store);
    const subject = created.stages.find((stage) => stage.stageId === 'build');
    if (!subject) throw new Error('subject missing');
    const running = store.transitionStage('alice', subject.stageRef, subject.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    expect(store.transitionStage('alice', subject.stageRef, running.value.version, 'succeeded')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('review lineage'),
    });
    const committed = commitCheckerSubject(store, created);
    const afterCommit = store.getRun('alice', committed.created.run.runRef);
    if (!afterCommit.ok) throw new Error(afterCommit.detail);
    const currentSubject = afterCommit.value.stages.find((stage) => stage.stageId === 'build');
    const checker = afterCommit.value.stages.find((stage) => stage.stageId === 'check');
    if (!currentSubject || !checker) throw new Error('checker run stages missing');
    const subjectSucceeded = store.transitionStage('alice', currentSubject.stageRef, currentSubject.version, 'succeeded');
    if (!subjectSucceeded.ok) throw new Error(subjectSucceeded.detail);
    expect(store.createAttempt('alice', checker.stageRef, {
      expectedStageVersion: checker.version, runtime: VERIFY_ASSIGNMENT.runtime, model: VERIFY_ASSIGNMENT.model,
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

















  it('tracks canonical publication phases with run-version CAS', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    expect(created.run.publicationState).toBe('pending');
    const publishing = store.transitionPublication('alice', created.run.runRef, created.run.version, 'publishing');
    expect(publishing.ok && publishing.value).toMatchObject({ publicationState: 'publishing', version: 2 });
    expect(store.transitionPublication('alice', created.run.runRef, created.run.version, 'published')).toMatchObject({
      ok: false, reason: 'conflict',
    });
    if (!publishing.ok) return;
    const published = store.transitionPublication('alice', created.run.runRef, publishing.value.version, 'published');
    expect(published.ok && published.value).toMatchObject({ publicationState: 'published', version: 3 });
    if (!published.ok) return;
    expect(store.transitionPublication('alice', created.run.runRef, published.value.version, 'pending')).toMatchObject({
      ok: false, reason: 'invalid',
    });
  });

  it('creates a Retry successor only from a published, fully quiescent predecessor bundle', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const first = settleRetryPredecessor(store);
    const successor = store.createRun('alice', {
      title: 'Retry run', proposalRef: first.run.proposalRef, proposalRevision: first.run.proposalRevision,
      expectedProposalHash: first.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'retry-run-1', predecessorRunRef: first.run.runRef, expectedPredecessorVersion: first.run.version,
      stages: first.stages.map((stage) => ({ stageId: stage.stageId, title: stage.title, dependsOn: stage.dependsOn })),
    });
    expect(successor.ok && successor.value.run).toMatchObject({ predecessorRunRef: first.run.runRef, lifecycle: { kind: 'planned', deployPause: null } });
    expect(store.createRun('alice', {
      title: 'Bad retry', proposalRef: first.run.proposalRef, proposalRevision: first.run.proposalRevision,
      expectedProposalHash: first.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'retry-run-stale', predecessorRunRef: first.run.runRef, expectedPredecessorVersion: first.run.version - 1,
      stages: first.stages.map((stage) => ({ stageId: stage.stageId, title: stage.title, dependsOn: stage.dependsOn })),
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('treats fully quiescent interrupted descendants as settled for Retry', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    for (const initial of created.stages) {
      const linked = store.linkStageCard('alice', initial.stageRef, initial.version, `card-${initial.stageId}`);
      if (!linked.ok) throw new Error(linked.detail);
      const attempt = store.createAttempt('alice', initial.stageRef, {
        expectedStageVersion: linked.value.version, runtime: 'codex', model: 'fixed',
      });
      if (!attempt.ok) throw new Error(attempt.detail);
      const session = store.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
      if (!session.ok) throw new Error(session.detail);
      const interruptedAttempt = store.transitionAttempt('alice', attempt.value.attemptRef, attempt.value.version + 1, 'interrupted');
      if (!interruptedAttempt.ok) throw new Error(interruptedAttempt.detail);
      const interruptedSession = store.transitionSession('alice', session.value.sessionRef, session.value.version, 'interrupted');
      if (!interruptedSession.ok) throw new Error(interruptedSession.detail);
      const current = store.getRun('alice', created.run.runRef);
      if (!current.ok) throw new Error(current.detail);
      const stage = current.value.stages.find((candidate) => candidate.stageRef === initial.stageRef);
      if (!stage) throw new Error('stage missing');
      const interruptedStage = store.transitionStage('alice', stage.stageRef, stage.version, 'interrupted');
      if (!interruptedStage.ok) throw new Error(interruptedStage.detail);
    }
    const current = store.getRun('alice', created.run.runRef);
    if (!current.ok) throw new Error(current.detail);
    const manager = current.value.sessions.find((session) => session.sessionRef === current.value.run.managerSessionRef);
    if (!manager) throw new Error('manager missing');
    const interruptedManager = store.transitionSession('alice', manager.sessionRef, manager.version, 'interrupted');
    if (!interruptedManager.ok) throw new Error(interruptedManager.detail);
    const publishing = store.transitionPublication('alice', created.run.runRef, current.value.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = store.transitionPublication('alice', created.run.runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const interruptedRun = store.transitionRun('alice', created.run.runRef, published.value.version, 'interrupted');
    if (!interruptedRun.ok) throw new Error(interruptedRun.detail);

    const successor = store.createRun('alice', {
      title: 'Retry interrupted run', proposalRef: created.run.proposalRef, proposalRevision: created.run.proposalRevision,
      expectedProposalHash: created.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'retry-interrupted-run', predecessorRunRef: created.run.runRef,
      expectedPredecessorVersion: interruptedRun.value.version,
      stages: created.stages.map((stage) => ({ stageId: stage.stageId, title: stage.title, dependsOn: stage.dependsOn })),
    });

    expect(successor).toMatchObject({ ok: true, value: { run: { predecessorRunRef: created.run.runRef, lifecycle: { kind: 'planned', deployPause: null } } } });
  });

  it('refuses Retry while publication, canonical work, sessions, or Human Requests remain unresolved', () => {
    const retry = (store: ControlPlaneStore, predecessor: ReturnType<typeof createRun>, idempotencyKey: string) => store.createRun('alice', {
      title: 'Unsafe retry', proposalRef: predecessor.run.proposalRef, proposalRevision: predecessor.run.proposalRevision,
      expectedProposalHash: predecessor.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey, predecessorRunRef: predecessor.run.runRef, expectedPredecessorVersion: predecessor.run.version,
      stages: predecessor.stages.map((stage) => ({ stageId: stage.stageId, title: stage.title, dependsOn: stage.dependsOn })),
    });

    const unpublishedStore = createInMemoryControlPlaneStore(deterministicOptions());
    const unpublished = createRun(unpublishedStore);
    const unpublishedFailed = unpublishedStore.transitionRun('alice', unpublished.run.runRef, unpublished.run.version, 'failed');
    if (!unpublishedFailed.ok) throw new Error(unpublishedFailed.detail);
    expect(retry(unpublishedStore, { ...unpublished, run: unpublishedFailed.value }, 'retry-unpublished')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('publication'),
    });

    const activeStore = createInMemoryControlPlaneStore(deterministicOptions());
    const active = createRun(activeStore);
    const activePublishing = activeStore.transitionPublication('alice', active.run.runRef, active.run.version, 'publishing');
    if (!activePublishing.ok) throw new Error(activePublishing.detail);
    const activePublished = activeStore.transitionPublication('alice', active.run.runRef, activePublishing.value.version, 'published');
    if (!activePublished.ok) throw new Error(activePublished.detail);
    const activeFailed = activeStore.transitionRun('alice', active.run.runRef, activePublished.value.version, 'failed');
    if (!activeFailed.ok) throw new Error(activeFailed.detail);
    expect(retry(activeStore, { ...active, run: activeFailed.value }, 'retry-active')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringMatching(/card|stage|session/),
    });

    const requestedStore = createInMemoryControlPlaneStore(deterministicOptions());
    const requested = settleRetryPredecessor(requestedStore);
    const request = requestedStore.createHumanRequest('alice', requested.run.runRef, {
      kind: 'intervention', title: 'Reconcile first', prompt: 'Canonical work still needs review.',
    });
    if (!request.ok) throw new Error(request.detail);
    const current = requestedStore.getRun('alice', requested.run.runRef);
    if (!current.ok) throw new Error(current.detail);
    expect(retry(requestedStore, current.value, 'retry-requested')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('Human Request'),
    });
  });

  it('commits manager commands with generation CAS and durable idempotency before signaling', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const input = {
      expectedRunVersion: created.run.version,
      expectedManagerGeneration: created.run.managerGeneration,
      idempotencyKey: 'manager-message-1',
      kind: 'message' as const,
      message: 'Continue at the next safe checkpoint.',
    };
    const first = store.recordManagerCommand('alice', created.run.runRef, input);
    expect(first.ok && first.value.event).toMatchObject({ kind: 'message', source: 'human', summary: input.message });
    expect(store.recordManagerCommand('alice', created.run.runRef, input)).toMatchObject({ ok: true, replayed: true });
    expect(store.recordManagerCommand('alice', created.run.runRef, { ...input, message: 'Different' })).toMatchObject({
      ok: false, reason: 'idempotency-conflict',
    });
    expect(store.recordManagerCommand('alice', created.run.runRef, {
      ...input, idempotencyKey: 'manager-stale', expectedManagerGeneration: 2,
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('creates a run only from an exact approved revision and keeps listings metadata-only', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const unapproved = store.createProposalRevision('alice', { ...SOURCE, title: 'Pending', snapshot: { stages: [] } });
    if (!unapproved.ok) throw new Error(unapproved.detail);
    expect(store.createRun('alice', {
      title: 'No', proposalRef: unapproved.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: unapproved.value.hash, managerRuntime: 'claude', managerModel: 'fixed',
      idempotencyKey: 'launch-unapproved',
      stages: [{ stageId: 'one', title: 'One', dependsOn: [] }],
    })).toMatchObject({ ok: false, reason: 'not-approved' });

    const created = createRun(store);
    expect(created.run).toMatchObject({ lifecycle: { kind: 'planned', deployPause: null }, managerGeneration: 1, proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(created.stages.map((stage) => stage.state)).toEqual(['ready', 'blocked']);
    const linked = store.linkStageCard('alice', created.stages[0].stageRef, created.stages[0].version, 'card-build');
    expect(linked.ok && linked.value).toMatchObject({ canonicalCardRef: 'card-build', version: 2 });
    expect(store.linkStageCard('alice', created.stages[0].stageRef, created.stages[0].version, 'card-other')).toMatchObject({
      ok: false, reason: 'conflict',
    });
    expect(created.sessions).toHaveLength(1);
    expect(created.sessions[0]).toMatchObject({ role: 'manager', generation: 1, state: 'pending' });
    expect(store.getRun('bob', created.run.runRef)).toMatchObject({ ok: false, reason: 'not-found' });
    const listed = store.listRuns('alice');
    expect(listed[0]).toMatchObject({ stageCount: 2, sessionCount: 1, eventCount: 0 });
    expect(JSON.stringify(listed)).not.toContain('stages');
  });

  it('uses versions for lifecycle CAS and successor attempts instead of mutating terminal attempts', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const run = createRun(store);
    const stage = run.stages[0];
    expect(store.transitionStage('alice', stage.stageRef, 99, 'running')).toMatchObject({ ok: false, reason: 'conflict' });
    const runningStage = store.transitionStage('alice', stage.stageRef, 1, 'running');
    if (!runningStage.ok) throw new Error(runningStage.detail);
    const first = store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: runningStage.value.version,
      runtime: 'codex',
      model: 'gpt-5.6-sol',
    });
    if (!first.ok) throw new Error(first.detail);
    const worker = store.createWorkerSession('alice', first.value.attemptRef, { expectedAttemptVersion: first.value.version });
    expect(worker.ok && worker.value).toMatchObject({ role: 'worker', runtime: 'codex', model: 'gpt-5.6-sol' });
    const afterWorker = store.getRun('alice', run.run.runRef);
    if (!afterWorker.ok) throw new Error(afterWorker.detail);
    const attached = afterWorker.value.attempts[0];
    const failed = store.transitionAttempt('alice', attached.attemptRef, attached.version, 'failed');
    if (!failed.ok) throw new Error(failed.detail);
    expect(store.transitionAttempt('alice', failed.value.attemptRef, failed.value.version, 'running')).toMatchObject({ ok: false, reason: 'invalid' });
    const latestStage = store.getRun('alice', run.run.runRef);
    if (!latestStage.ok) throw new Error(latestStage.detail);
    const successor = store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: latestStage.value.stages[0].version,
      runtime: 'codex', model: 'gpt-5.6-sol',
    });
    expect(successor.ok && successor.value).toMatchObject({ generation: 2, predecessorAttemptRef: first.value.attemptRef });
  });

  it('creates a worker session only for a queued attempt and rejects every other lifecycle state without mutation', () => {
    const queuedStore = createInMemoryControlPlaneStore(deterministicOptions());
    const queuedRun = createRun(queuedStore);
    const queuedAttempt = queuedStore.createAttempt('alice', queuedRun.stages[0].stageRef, {
      expectedStageVersion: queuedRun.stages[0].version, runtime: 'codex', model: 'gpt-5.6-sol',
    });
    if (!queuedAttempt.ok) throw new Error(queuedAttempt.detail);
    expect(queuedStore.createWorkerSession('alice', queuedAttempt.value.attemptRef, {
      expectedAttemptVersion: queuedAttempt.value.version,
    })).toMatchObject({ ok: true, value: { role: 'worker', state: 'pending' } });

    for (const target of ['starting', 'running', 'succeeded', 'failed', 'stopped', 'interrupted'] as const) {
      const store = createInMemoryControlPlaneStore(deterministicOptions());
      const run = createRun(store);
      const created = store.createAttempt('alice', run.stages[0].stageRef, {
        expectedStageVersion: run.stages[0].version, runtime: 'codex', model: 'gpt-5.6-sol',
      });
      if (!created.ok) throw new Error(created.detail);
      let attempt = created.value;
      if (target === 'starting' || target === 'running' || target === 'succeeded') {
        const starting = store.transitionAttempt('alice', attempt.attemptRef, attempt.version, 'starting');
        if (!starting.ok) throw new Error(starting.detail);
        attempt = starting.value;
      }
      if (target === 'running' || target === 'succeeded') {
        const running = store.transitionAttempt('alice', attempt.attemptRef, attempt.version, 'running');
        if (!running.ok) throw new Error(running.detail);
        attempt = running.value;
      }
      if (target === 'succeeded') {
        const succeeded = store.transitionAttempt('alice', attempt.attemptRef, attempt.version, 'succeeded');
        if (!succeeded.ok) throw new Error(succeeded.detail);
        attempt = succeeded.value;
      }
      if (target === 'failed' || target === 'stopped' || target === 'interrupted') {
        const terminal = store.transitionAttempt('alice', attempt.attemptRef, attempt.version, target);
        if (!terminal.ok) throw new Error(terminal.detail);
        attempt = terminal.value;
      }
      const before = store.getRun('alice', run.run.runRef);
      expect(store.createWorkerSession('alice', attempt.attemptRef, { expectedAttemptVersion: attempt.version })).toMatchObject({
        ok: false, reason: 'invalid', detail: expect.stringContaining('queued'),
      });
      expect(store.getRun('alice', run.run.runRef)).toEqual(before);
    }
  });

  it('atomically reroutes a never-started attempt and settles its superseded lineage', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const stage = created.stages[0];
    const linked = store.linkStageCard('alice', stage.stageRef, stage.version, 'card-build');
    if (!linked.ok) throw new Error(linked.detail);
    const publishing = store.transitionPublication('alice', created.run.runRef, created.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = store.transitionPublication('alice', created.run.runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const original = store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: linked.value.version,
      runtime: 'codex',
      model: 'gpt-5.6-sol',
    });
    if (!original.ok) throw new Error(original.detail);
    const originalSession = store.createWorkerSession('alice', original.value.attemptRef, {
      expectedAttemptVersion: original.value.version,
    });
    if (!originalSession.ok) throw new Error(originalSession.detail);
    const before = store.getRun('alice', created.run.runRef);
    if (!before.ok) throw new Error(before.detail);
    const currentStage = before.value.stages.find((item) => item.stageRef === stage.stageRef);
    const currentAttempt = before.value.attempts.find((item) => item.attemptRef === original.value.attemptRef);
    if (!currentStage || !currentAttempt) throw new Error('reroute source missing');
    const input = {
      expectedStageVersion: currentStage.version,
      expectedAttemptRef: currentAttempt.attemptRef,
      expectedAttemptVersion: currentAttempt.version,
      runtime: 'claude',
      model: 'claude-sonnet-5',
      idempotencyKey: 'reroute-build-1',
    };
    const rerouted = store.rerouteStage('alice', stage.stageRef, input);
    expect(rerouted).toMatchObject({
      ok: true,
      value: {
        stage: { currentAttemptRef: expect.any(String) },
        attempt: {
          generation: 2,
          predecessorAttemptRef: original.value.attemptRef,
          runtime: 'claude',
          model: 'claude-sonnet-5',
          state: 'queued',
        },
        session: {
          predecessorSessionRef: originalSession.value.sessionRef,
          runtime: 'claude',
          model: 'claude-sonnet-5',
          state: 'pending',
        },
      },
    });
    const after = store.getRun('alice', created.run.runRef);
    if (!after.ok) throw new Error(after.detail);
    expect(after.value.attempts.find((item) => item.attemptRef === original.value.attemptRef)).toMatchObject({
      runtime: 'codex', model: 'gpt-5.6-sol', state: 'stopped', version: 3,
    });
    expect(after.value.sessions.find((item) => item.sessionRef === originalSession.value.sessionRef)).toMatchObject({
      runtime: 'codex', model: 'gpt-5.6-sol', state: 'stopped', version: 2,
    });
    expect(store.rerouteStage('alice', stage.stageRef, input)).toMatchObject({ ok: true, replayed: true });
    expect(store.rerouteStage('alice', stage.stageRef, { ...input, model: 'claude-opus-4-8' })).toMatchObject({
      ok: false, reason: 'idempotency-conflict',
    });
  });

  it('refuses to reroute an assigned stage while leaving legacy unassigned stages reroutable', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const assigned = createAssignedRun(store);
    expect(store.rerouteStage('alice', assigned.stages[0].stageRef, {
      expectedStageVersion: assigned.stages[0].version, expectedAttemptRef: 'attempt-expected', expectedAttemptVersion: 1,
      runtime: 'claude', model: 'claude-sonnet-5', idempotencyKey: 'reroute-assigned',
    })).toMatchObject({ ok: false, reason: 'invalid', detail: expect.stringContaining('assignment provenance is immutable') });
  });

  it('creates attempts for an assigned stage only with its resolved routing', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const assigned = createAssignedRun(store);
    const stage = assigned.stages.find((candidate) => candidate.stageId === 'build');
    if (!stage) throw new Error('assigned build stage missing');
    expect(store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: stage.version, runtime: 'claude', model: 'claude-sonnet-5',
    })).toMatchObject({ ok: false, reason: 'invalid', detail: expect.stringContaining('assigned stage provenance') });
    const afterRefusal = store.getRun('alice', assigned.run.runRef);
    if (!afterRefusal.ok) throw new Error(afterRefusal.detail);
    expect(afterRefusal.value.stages.find((candidate) => candidate.stageRef === stage.stageRef)).toMatchObject({
      version: stage.version, currentAttemptRef: null,
    });
    expect(store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: stage.version, runtime: BUILD_ASSIGNMENT.runtime, model: BUILD_ASSIGNMENT.model,
    })).toMatchObject({ ok: true, value: { runtime: BUILD_ASSIGNMENT.runtime, model: BUILD_ASSIGNMENT.model } });
  });

  it('rejects lifecycle edge skips, unmet dependencies, and premature run success', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const root = created.stages.find((stage) => stage.stageId === 'build');
    const dependent = created.stages.find((stage) => stage.stageId === 'verify');
    if (!root || !dependent) throw new Error('stages missing');
    expect(store.transitionPublication('alice', created.run.runRef, created.run.version, 'published')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('pending->published'),
    });
    expect(store.transitionStage('alice', dependent.stageRef, dependent.version, 'running')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('blocked->running'),
    });
    const attempt = store.createAttempt('alice', root.stageRef, { expectedStageVersion: root.version, runtime: 'codex', model: 'fixed' });
    if (!attempt.ok) throw new Error(attempt.detail);
    expect(store.transitionAttempt('alice', attempt.value.attemptRef, attempt.value.version, 'running')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('queued->running'),
    });
    const worker = store.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
    if (!worker.ok) throw new Error(worker.detail);
    expect(store.transitionSession('alice', worker.value.sessionRef, worker.value.version, 'running')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('pending->running'),
    });
    const running = store.transitionRun('alice', created.run.runRef, created.run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    expect(store.transitionRun('alice', created.run.runRef, running.value.version, 'succeeded')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('descendant'),
    });
  });

  it('does not release waiting-human stage or run boundaries until the exact response is accepted', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const stage = created.stages[0];
    const request = store.createHumanRequest('alice', created.run.runRef, {
      stageRef: stage.stageRef, kind: 'approval', title: 'Approve stage', prompt: 'Approve exact stage scope.',
    });
    if (!request.ok) throw new Error(request.detail);
    const stageWaiting = store.transitionStage('alice', stage.stageRef, stage.version, 'waiting-human');
    if (!stageWaiting.ok) throw new Error(stageWaiting.detail);
    const runWaiting = store.transitionRun('alice', created.run.runRef, created.run.version, 'waiting-human');
    if (!runWaiting.ok) throw new Error(runWaiting.detail);
    expect(store.transitionStage('alice', stage.stageRef, stageWaiting.value.version, 'ready')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('unresolved'),
    });
    expect(store.transitionRun('alice', created.run.runRef, runWaiting.value.version, 'running')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('unresolved'),
    });
    const rejected = store.respondHumanRequest('alice', request.value.requestRef, {
      expectedRevision: request.value.revision, decision: 'rejected', idempotencyKey: 'reject-stage',
    });
    if (!rejected.ok) throw new Error(rejected.detail);
    expect(store.transitionStage('alice', stage.stageRef, stageWaiting.value.version, 'ready')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.transitionRun('alice', created.run.runRef, runWaiting.value.version, 'running')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('persists run-wide cancellation intent before signaling and replays it exactly', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const input = {
      expectedRunVersion: created.run.version,
      idempotencyKey: 'cancel-run-1',
      reason: 'Operator requested stop.',
    };
    const requested = store.requestRunCancellation('alice', created.run.runRef, input);
    expect(requested).toMatchObject({
      ok: true,
      value: { run: { lifecycle: { kind: 'stopping', deployPause: null } }, event: { kind: 'lifecycle', source: 'human', status: 'waiting' } },
    });
    if (!requested.ok) throw new Error(requested.detail);
    expect(store.requestRunCancellation('alice', created.run.runRef, {
      ...input, expectedRunVersion: requested.value.run.version,
    })).toMatchObject({ ok: true, replayed: true });
    expect(store.requestRunCancellation('alice', created.run.runRef, {
      ...input, expectedRunVersion: requested.value.run.version, reason: 'Different reason.',
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
  });

  it('applies exact canonical reconciliation atomically without widening general lifecycle edges', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    for (const stage of created.stages) {
      const linked = store.linkStageCard('alice', stage.stageRef, stage.version, `card-${stage.stageId}`);
      if (!linked.ok) throw new Error(linked.detail);
      const attempt = store.createAttempt('alice', stage.stageRef, {
        expectedStageVersion: linked.value.version, runtime: 'codex', model: 'fixed',
      });
      if (!attempt.ok) throw new Error(attempt.detail);
      const session = store.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
      if (!session.ok) throw new Error(session.detail);
    }
    let detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const reconcileRequired = store.transitionPublication('alice', created.run.runRef, detail.value.run.version, 'reconcile-required');
    if (!reconcileRequired.ok) throw new Error(reconcileRequired.detail);
    detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const projections = detail.value.stages.map((stage) => {
      const attempt = detail.ok && detail.value.attempts.find((candidate) => candidate.attemptRef === stage.currentAttemptRef);
      const session = detail.ok && detail.value.sessions.find((candidate) => candidate.sessionRef === attempt?.managedSessionRef);
      if (!attempt || !session || !stage.canonicalCardRef) throw new Error('projection chain missing');
      return {
        stageRef: stage.stageRef,
        expectedStageVersion: stage.version,
        canonicalCardRef: stage.canonicalCardRef,
        state: 'succeeded' as const,
        attemptRef: attempt.attemptRef,
        expectedAttemptVersion: attempt.version,
        attemptState: 'succeeded' as const,
        sessionRef: session.sessionRef,
        expectedSessionVersion: session.version,
        sessionState: 'completed' as const,
      };
    });
    expect(store.reconcileCanonicalProjection('alice', created.run.runRef, {
      expectedRunVersion: reconcileRequired.value.version,
      expectedProposalHash: created.run.proposalHash,
      stages: projections.map((projection, index) => index === 0 ? { ...projection, sessionState: 'running' as const } : projection),
    })).toMatchObject({ ok: false, reason: 'invalid', detail: expect.stringContaining('tuple') });
    const reconciled = store.reconcileCanonicalProjection('alice', created.run.runRef, {
      expectedRunVersion: reconcileRequired.value.version,
      expectedProposalHash: created.run.proposalHash,
      stages: projections,
    });
    expect(reconciled).toMatchObject({
      ok: true,
      value: {
        run: { lifecycle: { kind: 'succeeded', deployPause: null }, publicationState: 'published' },
        stages: [{ state: 'succeeded' }, { state: 'succeeded' }],
        attempts: [{ state: 'succeeded' }, { state: 'succeeded' }],
      },
    });
    if (!reconciled.ok) throw new Error(reconciled.detail);
    expect(reconciled.value.sessions.every((session) => session.state === 'completed' || session.state === 'stopped')).toBe(true);
  });

  it('refuses canonical projection release while a dependency iteration loop has not passed', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const upstream = task4IterationGroup('upstream');
    const consumer = task4IterationGroup('consumer');
    const stages = [
      { stageId: 'upstream-build', title: 'Upstream seed', dependsOn: [] as string[] },
      { stageId: 'upstream-check', title: 'Upstream decision', dependsOn: [] as string[] },
      { stageId: 'consumer-build', title: 'Consumer seed', dependsOn: ['upstream-check'] },
      { stageId: 'consumer-check', title: 'Consumer decision', dependsOn: [] as string[] },
    ];
    const proposal = createApprovedProposal(store, 'alice', {
      schema: 'kb.plan-proposal/v1', manager: {}, iterationGroups: [upstream, consumer],
      stages: [
        { id: 'upstream-build', title: 'Upstream seed', dependsOn: [], artifacts: [{ id: 'upstream-artifact', path: 'upstream.md' }] },
        { id: 'upstream-check', title: 'Upstream decision', dependsOn: [], artifacts: [] },
        { id: 'consumer-build', title: 'Consumer seed', dependsOn: ['upstream-check'], artifacts: [{ id: 'consumer-artifact', path: 'consumer.md' }] },
        { id: 'consumer-check', title: 'Consumer decision', dependsOn: [], artifacts: [] },
      ],
    } as unknown as JsonObject);
    const launched = store.createRun('alice', {
      title: 'Canonical dependency guard', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
      expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'canonical-dependency-guard', iterationGroups: [upstream, consumer], stages,
    });
    if (!launched.ok) throw new Error(launched.detail);
    const runRef = launched.value.run.runRef;

    const createChain = (stageId: string, complete: boolean) => {
      let detail = store.getRun('alice', runRef);
      if (!detail.ok) throw new Error(detail.detail);
      let stage = detail.value.stages.find((candidate) => candidate.stageId === stageId)!;
      const linked = store.linkStageCard('alice', stage.stageRef, stage.version, `card-${stageId}`);
      if (!linked.ok) throw new Error(linked.detail);
      const created = store.createAttempt('alice', stage.stageRef, {
        expectedStageVersion: linked.value.version, runtime: 'codex', model: 'fixed',
      });
      if (!created.ok) throw new Error(created.detail);
      const session = store.createWorkerSession('alice', created.value.attemptRef, {
        expectedAttemptVersion: created.value.version,
      });
      if (!session.ok) throw new Error(session.detail);
      if (complete) {
        detail = store.getRun('alice', runRef);
        if (!detail.ok) throw new Error(detail.detail);
        let attempt = detail.value.attempts.find((candidate) => candidate.attemptRef === created.value.attemptRef)!;
        for (const state of ['starting', 'running', 'succeeded'] as const) {
          const transitioned = store.transitionAttempt('alice', attempt.attemptRef, attempt.version, state);
          if (!transitioned.ok) throw new Error(transitioned.detail);
          attempt = transitioned.value;
        }
        let currentSession = session.value;
        for (const state of ['starting', 'running', 'completed'] as const) {
          const transitioned = store.transitionSession('alice', currentSession.sessionRef, currentSession.version, state);
          if (!transitioned.ok) throw new Error(transitioned.detail);
          currentSession = transitioned.value;
        }
      }
      detail = store.getRun('alice', runRef);
      if (!detail.ok) throw new Error(detail.detail);
      stage = detail.value.stages.find((candidate) => candidate.stageId === stageId)!;
      return {
        stage,
        attempt: detail.value.attempts.find((candidate) => candidate.attemptRef === created.value.attemptRef)!,
        session: detail.value.sessions.find((candidate) => candidate.sessionRef === session.value.sessionRef)!,
      };
    };
    const commitSeed = (stageId: string, prefix: string) => {
      const chain = createChain(stageId, true);
      const generation = store.recordStageGeneration('alice', chain.stage.stageRef, {
        expectedStageVersion: chain.stage.version, expectedAttemptVersion: chain.attempt.version, expectedGeneration: 1,
        operationKey: `result:${runRef}:${stageId}`, resultHash: createHash('sha256').update(prefix).digest('hex'),
        resultCardRef: `card-${stageId}`, baseCommit: 'b'.repeat(40),
        canonicalCommit: createHash('sha1').update(prefix).digest('hex'),
      });
      if (!generation.ok) throw new Error(generation.detail);
      return generation.value;
    };

    const upstreamGeneration = commitSeed('upstream-build', 'upstream');
    let detail = store.getRun('alice', runRef);
    if (!detail.ok) throw new Error(detail.detail);
    let upstreamSeed = detail.value.stages.find((stage) => stage.stageId === 'upstream-build')!;
    const upstreamRunning = store.transitionStage('alice', upstreamSeed.stageRef, upstreamSeed.version, 'running');
    if (!upstreamRunning.ok) throw new Error(upstreamRunning.detail);
    const upstreamSucceeded = store.transitionStage('alice', upstreamSeed.stageRef, upstreamRunning.value.version, 'succeeded');
    if (!upstreamSucceeded.ok) throw new Error(upstreamSucceeded.detail);
    detail = store.getRun('alice', runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const upstreamLoop = detail.value.iterationLoops.find((loop) => loop.iterationGroupId === 'upstream-loop')!;
    const activatedUpstream = store.activateIterationLoop('alice', upstreamLoop.iterationLoopRef, {
      expectedLoopVersion: upstreamLoop.version, seedGenerationRefs: [upstreamGeneration.generationRef],
      artifactGenerationRefs: { 'upstream-artifact': upstreamGeneration.generationRef },
      operationKey: `iteration-activate:${runRef}:upstream-loop:c1`,
    });
    if (!activatedUpstream.ok) throw new Error(activatedUpstream.detail);
    const upstreamRequest = task4Request(store, runRef, 'upstream');
    if (!upstreamRequest.ok) throw new Error(upstreamRequest.detail);
    const upstreamJudge = createChain('upstream-check', true);
    const judgeRunning = store.transitionStage('alice', upstreamJudge.stage.stageRef, upstreamJudge.stage.version, 'running');
    if (!judgeRunning.ok) throw new Error(judgeRunning.detail);
    const judgeSucceeded = store.transitionStage('alice', upstreamJudge.stage.stageRef, judgeRunning.value.version, 'succeeded');
    if (!judgeSucceeded.ok) throw new Error(judgeSucceeded.detail);

    const consumerGeneration = commitSeed('consumer-build', 'consumer');
    detail = store.getRun('alice', runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const consumerLoop = detail.value.iterationLoops.find((loop) => loop.iterationGroupId === 'consumer-loop')!;
    const activatedConsumer = store.activateIterationLoop('alice', consumerLoop.iterationLoopRef, {
      expectedLoopVersion: consumerLoop.version, seedGenerationRefs: [consumerGeneration.generationRef],
      artifactGenerationRefs: { 'consumer-artifact': consumerGeneration.generationRef },
      operationKey: `iteration-activate:${runRef}:consumer-loop:c1`,
    });
    if (!activatedConsumer.ok) throw new Error(activatedConsumer.detail);
    const consumerRequest = task4Request(store, runRef, 'consumer');
    if (!consumerRequest.ok) throw new Error(consumerRequest.detail);
    createChain('consumer-check', false);

    detail = store.getRun('alice', runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const reconcileRequired = store.transitionPublication('alice', runRef, detail.value.run.version, 'reconcile-required');
    if (!reconcileRequired.ok) throw new Error(reconcileRequired.detail);
    detail = store.getRun('alice', runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const targets: ReadonlyMap<string, readonly [
      CanonicalStageProjectionInput['state'],
      CanonicalStageProjectionInput['attemptState'],
      CanonicalStageProjectionInput['sessionState'],
    ]> = new Map([
      ['upstream-build', ['stopped', 'stopped', 'stopped']],
      ['upstream-check', ['succeeded', 'succeeded', 'completed']],
      ['consumer-build', ['ready', 'queued', 'pending']],
      ['consumer-check', ['stopped', 'stopped', 'stopped']],
    ] as const);
    const projections = detail.value.stages.map((stage) => {
      const attempt = detail.ok && detail.value.attempts.find((candidate) => candidate.attemptRef === stage.currentAttemptRef)!;
      const session = detail.ok && detail.value.sessions.find((candidate) => candidate.sessionRef === attempt.managedSessionRef)!;
      const target = targets.get(stage.stageId)!;
      return {
        stageRef: stage.stageRef, expectedStageVersion: stage.version, canonicalCardRef: stage.canonicalCardRef!,
        state: target[0], attemptRef: attempt.attemptRef, expectedAttemptVersion: attempt.version,
        attemptState: target[1], sessionRef: session.sessionRef, expectedSessionVersion: session.version,
        sessionState: target[2],
      };
    });
    expect(store.reconcileCanonicalProjection('alice', runRef, {
      expectedRunVersion: reconcileRequired.value.version, expectedProposalHash: proposal.hash, stages: projections,
    })).toMatchObject({
      ok: false, reason: 'invalid', detail: 'canonical projection bypasses accepted iteration dependencies',
    });
  });

  it('creates an idempotent generation-linked Manager successor only after the current head stops', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const manager = created.sessions[0];
    expect(store.createManagerSuccessor('alice', created.run.runRef, {
      expectedManagerGeneration: 1, runtime: 'claude', model: 'next', idempotencyKey: 'recover-1',
    })).toMatchObject({ ok: false, reason: 'conflict' });
    const interrupted = store.transitionSession('alice', manager.sessionRef, manager.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    const input = { expectedManagerGeneration: 1, runtime: 'claude', model: 'next', idempotencyKey: 'recover-1' };
    const successor = store.createManagerSuccessor('alice', created.run.runRef, input);
    expect(successor.ok && successor.value).toMatchObject({ generation: 2, predecessorSessionRef: manager.sessionRef, state: 'pending' });
    expect(store.createManagerSuccessor('alice', created.run.runRef, input)).toMatchObject({ ok: true, replayed: true });
    expect(store.createManagerSuccessor('alice', created.run.runRef, { ...input, model: 'different' })).toMatchObject({
      ok: false, reason: 'idempotency-conflict',
    });
    expect(store.getRun('alice', created.run.runRef)).toMatchObject({
      ok: true,
      value: { run: { lifecycle: { kind: 'recovering', deployPause: null }, managerGeneration: 2, managerSessionRef: successor.ok ? successor.value.sessionRef : '' } },
    });
  });

  it('allows an assigned Manager successor only on its resolved runtime and model', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createAssignedRun(store);
    const manager = created.sessions.find((session) => session.sessionRef === created.run.managerSessionRef);
    if (!manager) throw new Error('manager missing');
    const interrupted = store.transitionSession('alice', manager.sessionRef, manager.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    expect(store.createManagerSuccessor('alice', created.run.runRef, {
      expectedManagerGeneration: 1, runtime: 'codex', model: 'gpt-5.6-sol', idempotencyKey: 'assigned-manager-wrong',
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const input = {
      expectedManagerGeneration: 1, runtime: MANAGER_ASSIGNMENT.runtime, model: MANAGER_ASSIGNMENT.model,
      idempotencyKey: 'assigned-manager-right',
    };
    expect(store.createManagerSuccessor('alice', created.run.runRef, input)).toMatchObject({
      ok: true, value: { runtime: MANAGER_ASSIGNMENT.runtime, model: MANAGER_ASSIGNMENT.model, generation: 2 },
    });
    expect(store.createManagerSuccessor('alice', created.run.runRef, input)).toMatchObject({ ok: true, replayed: true });
  });
});

describe('Human Requests and operational events', () => {
  it('recovers a pending activation journal after restart and preserves its exact durable identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-activation-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const detail = prepareActivatableRun(store);
    const input = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:${detail.run.proposalHash}:1`,
    };

    expect(store.getRunActivationReceipt('alice', detail.run.runRef, input)).toMatchObject({
      ok: true,
      value: null,
    });
    const claimed = store.claimRunActivation('alice', detail.run.runRef, input);
    expect(claimed).toMatchObject({
      ok: true,
      value: { phase: 'claimed', run: { lifecycle: { kind: 'recovering', deployPause: null }, version: detail.run.version + 1 } },
    });
    expect(store.getRun('alice', detail.run.runRef)).toMatchObject({
      ok: true, value: { run: expect.not.objectContaining({ activationReceipts: expect.anything() }) },
    });
    const reopened = createFileControlPlaneStore(root);
    expect(reopened.getRunActivationReceipt('alice', detail.run.runRef, input)).toMatchObject({
      ok: true,
      replayed: true,
      value: { phase: 'claimed', run: { lifecycle: { kind: 'waiting-human', deployPause: null }, version: detail.run.version + 2 } },
    });
    expect(reopened.claimRunActivation('alice', detail.run.runRef, input)).toMatchObject({
      ok: true,
      replayed: true,
      value: { phase: 'claimed', run: { lifecycle: { kind: 'recovering', deployPause: null }, version: detail.run.version + 3 } },
    });
    expect(reopened.advanceRunActivation('alice', detail.run.runRef, input, 'roots-activated')).toMatchObject({
      ok: true, value: { phase: 'roots-activated' },
    });
    acknowledgeActivationManager(reopened, detail.run.runRef);
    expect(reopened.advanceRunActivation('alice', detail.run.runRef, input, 'dispatched')).toMatchObject({
      ok: true, value: { phase: 'dispatched' },
    });
    expect(reopened.advanceRunActivation('alice', detail.run.runRef, input, 'dispatched')).toMatchObject({
      ok: true, replayed: true, value: { phase: 'dispatched' },
    });
    expect(reopened.claimRunActivation('alice', detail.run.runRef, {
      ...input,
      expectedRunVersion: detail.run.version + 1,
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    expect(reopened.claimRunActivation('alice', detail.run.runRef, {
      ...input,
      idempotencyKey: `${input.idempotencyKey}:different`,
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('keeps historical dispatched receipts replayable across later Human Request boundaries', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const firstDetail = prepareActivatableRun(store);
    const first = {
      expectedRunVersion: firstDetail.run.version,
      expectedManagerGeneration: firstDetail.run.managerGeneration,
      idempotencyKey: `activate:${firstDetail.run.runRef}:${firstDetail.run.version}:first`,
    };
    expect(store.claimRunActivation('alice', firstDetail.run.runRef, first)).toMatchObject({
      ok: true, value: { phase: 'claimed' },
    });
    expect(store.advanceRunActivation('alice', firstDetail.run.runRef, first, 'roots-activated')).toMatchObject({
      ok: true, value: { phase: 'roots-activated' },
    });
    acknowledgeActivationManager(store, firstDetail.run.runRef);
    expect(store.advanceRunActivation('alice', firstDetail.run.runRef, first, 'dispatched')).toMatchObject({
      ok: true, value: { phase: 'dispatched' },
    });
    const recovering = store.getRun('alice', firstDetail.run.runRef);
    if (!recovering.ok) throw new Error(recovering.detail);
    const waiting = store.transitionRun('alice', firstDetail.run.runRef, recovering.value.run.version, 'waiting-human');
    if (!waiting.ok) throw new Error(waiting.detail);
    const request = store.createHumanRequest('alice', firstDetail.run.runRef, {
      kind: 'intervention', title: 'Second boundary', prompt: 'Acknowledge the second boundary.',
    });
    if (!request.ok) throw new Error(request.detail);
    const responded = store.respondHumanRequest('alice', request.value.requestRef, {
      expectedRevision: request.value.revision, decision: 'responded', idempotencyKey: 'accept-second-boundary',
    });
    if (!responded.ok) throw new Error(responded.detail);
    const secondDetail = store.getRun('alice', firstDetail.run.runRef);
    if (!secondDetail.ok) throw new Error(secondDetail.detail);
    const second = {
      expectedRunVersion: secondDetail.value.run.version,
      expectedManagerGeneration: secondDetail.value.run.managerGeneration,
      idempotencyKey: `activate:${firstDetail.run.runRef}:${secondDetail.value.run.version}:second`,
    };
    expect(store.claimRunActivation('alice', firstDetail.run.runRef, second)).toMatchObject({
      ok: true, value: { phase: 'claimed' },
    });
    expect(store.advanceRunActivation('alice', firstDetail.run.runRef, second, 'roots-activated')).toMatchObject({ ok: true });
    acknowledgeActivationManager(store, firstDetail.run.runRef);
    expect(store.advanceRunActivation('alice', firstDetail.run.runRef, second, 'dispatched')).toMatchObject({ ok: true });
    expect(store.getRunActivationReceipt('alice', firstDetail.run.runRef, first)).toMatchObject({
      ok: true, replayed: true, value: { phase: 'dispatched' },
    });
    expect(store.getRunActivationReceipt('alice', firstDetail.run.runRef, second)).toMatchObject({
      ok: true, replayed: true, value: { phase: 'dispatched' },
    });
  });

  it('recovers a roots-activated receipt after restart without losing the dispatcher handoff', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-activation-roots-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const detail = prepareActivatableRun(store);
    const input = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:roots-recovery`,
    };
    expect(store.claimRunActivation('alice', detail.run.runRef, input)).toMatchObject({ ok: true });
    expect(store.advanceRunActivation('alice', detail.run.runRef, input, 'roots-activated')).toMatchObject({
      ok: true, value: { phase: 'roots-activated' },
    });
    // Model a process death in the tiny gap after durable Manager/run startup but before the
    // onManagerStarted callback advances the outbox to dispatched.
    acknowledgeActivationManager(store, detail.run.runRef);
    const reopened = createFileControlPlaneStore(root, deterministicOptions());
    expect(reopened.getRunActivationReceipt('alice', detail.run.runRef, input)).toMatchObject({
      ok: true, value: { phase: 'roots-activated', run: { lifecycle: { kind: 'waiting-human', deployPause: null } } },
    });
    expect(reopened.claimRunActivation('alice', detail.run.runRef, input)).toMatchObject({
      ok: true, replayed: true, value: { phase: 'roots-activated', run: { lifecycle: { kind: 'recovering', deployPause: null } } },
    });
    expect(reopened.advanceRunActivation('alice', detail.run.runRef, input, 'roots-activated')).toMatchObject({
      ok: true, replayed: true, value: { phase: 'roots-activated' },
    });
    acknowledgeActivationManager(reopened, detail.run.runRef);
    expect(reopened.advanceRunActivation('alice', detail.run.runRef, input, 'dispatched')).toMatchObject({
      ok: true, value: { phase: 'dispatched' },
    });
  });

  it('lets a refreshed client supersede a crash-pending receipt with the newly visible run version', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-activation-refresh-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const detail = prepareActivatableRun(store);
    const oldInput = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:before-restart`,
    };
    expect(store.claimRunActivation('alice', detail.run.runRef, oldInput)).toMatchObject({ ok: true });
    const reopened = createFileControlPlaneStore(root, deterministicOptions());
    const visible = reopened.getRun('alice', detail.run.runRef);
    if (!visible.ok) throw new Error(visible.detail);
    expect(visible.value.run.lifecycle.kind).toBe('waiting-human');
    const refreshedInput = {
      expectedRunVersion: visible.value.run.version,
      expectedManagerGeneration: visible.value.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${visible.value.run.version}:after-restart`,
    };
    expect(reopened.claimRunActivation('alice', detail.run.runRef, refreshedInput)).toMatchObject({
      ok: true, value: { phase: 'claimed', run: { lifecycle: { kind: 'recovering', deployPause: null } } },
    });
    expect(reopened.getRunActivationReceipt('alice', detail.run.runRef, oldInput)).toMatchObject({
      ok: true, value: { phase: 'failed' },
    });
    expect(reopened.advanceRunActivation('alice', detail.run.runRef, refreshedInput, 'roots-activated')).toMatchObject({ ok: true });
    acknowledgeActivationManager(reopened, detail.run.runRef);
    expect(reopened.advanceRunActivation('alice', detail.run.runRef, refreshedInput, 'dispatched')).toMatchObject({
      ok: true, value: { phase: 'dispatched' },
    });
  });

  it('refuses to claim a waiting run with no durable Human Request boundary', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const detail = prepareActivatableRun(store, false);
    expect(store.claimRunActivation('alice', detail.run.runRef, {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:${detail.run.proposalHash}:1`,
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.getRun('alice', detail.run.runRef)).toMatchObject({
      ok: true,
      value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null }, version: detail.run.version } },
    });
  });

  it('revises open requests and commits one revision-bound idempotent response', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const run = createRun(store);
    const request = store.createHumanRequest('alice', run.run.runRef, {
      stageRef: run.stages[0].stageRef,
      kind: 'approval',
      title: 'Approve checkpoint',
      prompt: 'Review the diff',
    });
    if (!request.ok) throw new Error(request.detail);
    const revised = store.reviseHumanRequest('alice', request.value.requestRef, 1, 'Approve revised checkpoint', 'Review revision two');
    if (!revised.ok) throw new Error(revised.detail);
    expect(store.respondHumanRequest('alice', request.value.requestRef, {
      expectedRevision: 1, decision: 'approved', idempotencyKey: 'response-1',
    })).toMatchObject({ ok: false, reason: 'conflict' });
    const response = { expectedRevision: 2, decision: 'approved' as const, idempotencyKey: 'response-1', response: 'Looks good' };
    expect(store.respondHumanRequest('alice', request.value.requestRef, response)).toMatchObject({ ok: true, value: { state: 'resolved' } });
    expect(store.respondHumanRequest('alice', request.value.requestRef, response)).toMatchObject({ ok: true, replayed: true });
    expect(store.respondHumanRequest('alice', request.value.requestRef, { ...response, response: 'Different' })).toMatchObject({
      ok: false, reason: 'idempotency-conflict',
    });
    expect(store.reviseHumanRequest('alice', request.value.requestRef, 2, 'Again', 'No')).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('appends sanitized allowlisted events under globally monotonic cursors and replays by cursor', () => {
    const store = createInMemoryControlPlaneStore({ ...deterministicOptions(), maxEventsPerRun: 2 });
    const alice = createRun(store, 'alice');
    const bob = createRun(store, 'bob');
    const first = store.appendEvent('alice', alice.run.runRef, {
      kind: 'command', source: 'worker', stageRef: alice.stages[0].stageRef,
      command: 'deploy --api_key=sk-abcdefghijklmnopqrstuvwxyz', summary: 'started', status: 'running',
    });
    const other = store.appendEvent('bob', bob.run.runRef, { kind: 'lifecycle', source: 'system', summary: 'bob event' });
    const second = store.appendEvent('alice', alice.run.runRef, { kind: 'tool', source: 'manager', toolName: 'Read', status: 'success' });
    expect(first.ok && first.value.cursor).toBe(1);
    expect(other.ok && other.value.cursor).toBe(2);
    expect(second.ok && second.value.cursor).toBe(3);
    expect(first.ok && first.value.command).toContain('[redacted]');
    expect(store.listEvents('alice', alice.run.runRef, 1, 10)).toMatchObject({ ok: true, value: [{ cursor: 3 }] });
    expect(store.listEvents('bob', alice.run.runRef)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(store.appendEvent('alice', alice.run.runRef, { kind: 'message', source: 'manager', summary: 'too many' })).toMatchObject({
      ok: false, reason: 'limit',
    });
  });
});

describe('durability, crash recovery, and retention', () => {
  it('persists agent-workspace launch provenance and migrates missing legacy provenance to null', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const provenance = { composerRef: 'workspace-123', agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'd'.repeat(64) };
    const created = createRun(first, 'alice', provenance);
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.getRun('alice', created.run.runRef)).toMatchObject({ ok: true, value: { run: { agentWorkspaceLaunch: provenance } } });
    const path = join(root, 'control', 'control-plane.json');
    const legacy = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as { runs: Array<Record<string, unknown>> };
    delete legacy.runs[0].agentWorkspaceLaunch;
    writeFileSync(path, `${JSON.stringify(legacy)}\n`, 'utf8');
    expect(createFileControlPlaneStore(root, deterministicOptions()).getRun('alice', created.run.runRef)).toMatchObject({ ok: true, value: { run: { agentWorkspaceLaunch: null } } });
  });


  it('migrates missing checker contract fields in active and quarantined legacy stage rows to null', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    createRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as {
      runs: Array<Record<string, unknown>>;
      stages: Array<Record<string, unknown>>;
      quarantine: Array<Record<string, unknown>>;
    };
    document.quarantine.push({
      subject: 'archived', quarantinedAt: '2026-07-18T12:00:00.000Z', run: structuredClone(document.runs[0]),
      stages: structuredClone(document.stages), attempts: [], sessions: [], humanRequests: [], events: [],
    });
    for (const stage of [...document.stages, ...(document.quarantine[0].stages as Array<Record<string, unknown>>)]) {
      delete stage.workflowProfile;
      delete stage.review;
      delete stage.completionGate;
    }
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');

    createFileControlPlaneStore(root, deterministicOptions());
    const migrated = JSON.parse(readFileSync(path, 'utf8')) as {
      stages: Array<Record<string, unknown>>;
      quarantine: Array<{ stages: Array<Record<string, unknown>>; stageGenerations: unknown[]; reviewLoops: unknown[]; reviewReceipts: unknown[] }>;
    };
    for (const stage of [...migrated.stages, ...migrated.quarantine[0].stages]) {
      expect(stage).toMatchObject({ workflowProfile: null, review: null, completionGate: null });
    }
    expect(migrated.quarantine[0]).toMatchObject({ stageGenerations: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [] });
  });

  it('fails closed for malformed present checker contracts in active and quarantined persisted rows', () => {
    const check = (location: 'active' | 'quarantine') => {
      const root = mkdtempSync(join(tmpdir(), 'control-store-'));
      roots.push(root);
      const first = createFileControlPlaneStore(root, deterministicOptions());
      createRun(first);
      const path = join(root, 'control', 'control-plane.json');
      const document = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as {
        runs: Array<Record<string, unknown>>;
        stages: Array<Record<string, unknown>>;
        quarantine: Array<Record<string, unknown>>;
      };
      if (location === 'quarantine') {
        document.quarantine.push({
          subject: 'archived', quarantinedAt: '2026-07-18T12:00:00.000Z', run: structuredClone(document.runs[0]),
          stages: structuredClone(document.stages), attempts: [], sessions: [], humanRequests: [], events: [],
        });
        (document.quarantine[0].stages as Array<Record<string, unknown>>)[0].review = { subjectStageId: 'build' };
      } else {
        document.stages[0].workflowProfile = { injected: true };
      }
      writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
      expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow(
        location === 'active'
          ? 'invalid control-plane checker contract provenance'
          : 'invalid control-plane legacy review contract',
      );
    };
    check('active');
    check('quarantine');
  });

  it('preserves committed generation and checking loop records across a file-store restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    const detail = restarted.getRun('alice', committed.created.run.runRef);
    expect(detail).toMatchObject({
      ok: true,
      value: {
        stageGenerations: [expect.objectContaining({ generationRef: committed.generation.generationRef, state: 'committed' })],
        iterationLoops: [expect.objectContaining({ state: 'awaiting-turn', activeGenerationRefs: [committed.generation.generationRef] })],
      },
    });
  });





  it('fails closed on a persisted queued-generation result tamper', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    commitCheckerSubject(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { stageGenerations: Array<Record<string, unknown>> };
    document.stageGenerations[0].state = 'queued';
    // A queued generation is an immutable placeholder: it must not carry result output.
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane stage generation');
  });



  it('fails closed when a persisted creator rework attempt has incoherent base lineage', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    queueCreatorRework(first, committed);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { attempts: Array<Record<string, unknown>> };
    const reworkAttempt = document.attempts.find((attempt) => attempt.logicalGeneration === 2);
    if (!reworkAttempt) throw new Error('persisted rework attempt missing');
    reworkAttempt.baseCommit = 'c'.repeat(40);
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane creator attempt generation provenance');
  });

  it('fails closed when a committed generation is missing its durable base commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    commitCheckerSubject(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { stageGenerations: Array<Record<string, unknown>> };
    document.stageGenerations[0].baseCommit = null;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane stage generation');
  });



  it('fails closed when persisted assignment provenance is present but malformed', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    createRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as { runs: Array<Record<string, unknown>>; stages: Array<Record<string, unknown>> };
    document.runs[0].managerAssignment = { agentId: 'fyt-runner' };
    document.stages[0].assignment = 'not-an-assignment';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane assignment provenance');
  });


  it('atomically persists, then normalizes active crash residue once on restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const clock = deterministicOptions();
    const first = createFileControlPlaneStore(root, clock);
    const created = createRun(first);
    const runRunning = first.transitionRun('alice', created.run.runRef, created.run.version, 'running');
    if (!runRunning.ok) throw new Error(runRunning.detail);
    const stageRunning = first.transitionStage('alice', created.stages[0].stageRef, created.stages[0].version, 'running');
    if (!stageRunning.ok) throw new Error(stageRunning.detail);
    const attempt = first.createAttempt('alice', stageRunning.value.stageRef, {
      expectedStageVersion: stageRunning.value.version, runtime: 'codex', model: 'fixed',
    });
    if (!attempt.ok) throw new Error(attempt.detail);
    const worker = first.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
    if (!worker.ok) throw new Error(worker.detail);
    const afterWorker = first.getRun('alice', created.run.runRef);
    if (!afterWorker.ok) throw new Error(afterWorker.detail);
    const currentAttempt = afterWorker.value.attempts.find((candidate) => candidate.attemptRef === attempt.value.attemptRef);
    if (!currentAttempt) throw new Error('attempt disappeared');
    const attemptStarting = first.transitionAttempt('alice', currentAttempt.attemptRef, currentAttempt.version, 'starting');
    if (!attemptStarting.ok) throw new Error(attemptStarting.detail);
    const attemptRunning = first.transitionAttempt('alice', attemptStarting.value.attemptRef, attemptStarting.value.version, 'running');
    if (!attemptRunning.ok) throw new Error(attemptRunning.detail);
    const workerStarting = first.transitionSession('alice', worker.value.sessionRef, worker.value.version, 'starting');
    if (!workerStarting.ok) throw new Error(workerStarting.detail);
    const workerRunning = first.transitionSession('alice', workerStarting.value.sessionRef, workerStarting.value.version, 'running');
    if (!workerRunning.ok) throw new Error(workerRunning.detail);
    const managerStarting = first.transitionSession('alice', created.sessions[0].sessionRef, created.sessions[0].version, 'starting');
    if (!managerStarting.ok) throw new Error(managerStarting.detail);
    const managerRunning = first.transitionSession('alice', managerStarting.value.sessionRef, managerStarting.value.version, 'running');
    if (!managerRunning.ok) throw new Error(managerRunning.detail);

    const path = join(root, 'control', 'control-plane.json');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 2, nextEventCursor: 1 });
    expect(readdirSync(join(root, 'control')).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    const restarted = createFileControlPlaneStore(root, clock);
    const recovered = restarted.getRun('alice', created.run.runRef);
    if (!recovered.ok) throw new Error(recovered.detail);
    expect(recovered.value.run.lifecycle.kind).toBe('interrupted');
    expect(recovered.value.stages[0].state).toBe('interrupted');
    expect(recovered.value.attempts[0].state).toBe('interrupted');
    expect(recovered.value.sessions.map((session) => session.state)).toEqual(['interrupted', 'interrupted']);
    expect(restarted.listEvents('alice', created.run.runRef)).toMatchObject({
      ok: true,
      value: [{ cursor: 1, kind: 'lifecycle', status: 'interrupted' }],
    });
    createFileControlPlaneStore(root, clock);
    expect(restarted.listEvents('alice', created.run.runRef)).toMatchObject({ ok: true, value: [{ cursor: 1 }] });
  });

  it('requires an unchanged dry-run plan, quarantines without purging, and restores all records', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    store.appendEvent('alice', created.run.runRef, { kind: 'checkpoint', source: 'manager', checkpoint: 'safe boundary' });
    const runningPlan = store.dryRunQuarantine('alice', [created.run.runRef]);
    expect(runningPlan.ok && runningPlan.value.items[0].eligible).toBe(false);
    if (!runningPlan.ok) return;
    expect(store.quarantineRuns('alice', [created.run.runRef], runningPlan.value.planHash)).toMatchObject({ ok: false, reason: 'ineligible' });

    const interrupted = store.transitionRun('alice', created.run.runRef, created.run.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    for (const stage of created.stages) {
      const stopped = store.transitionStage('alice', stage.stageRef, stage.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    const managerStopped = store.transitionSession('alice', created.sessions[0].sessionRef, created.sessions[0].version, 'stopped');
    if (!managerStopped.ok) throw new Error(managerStopped.detail);
    const plan = store.dryRunQuarantine('alice', [created.run.runRef]);
    if (!plan.ok) throw new Error(plan.detail);
    expect(plan.value.items[0]).toMatchObject({ eligible: true, eventCount: 1, quarantinedAt: null });
    expect(store.quarantineRuns('alice', [created.run.runRef], runningPlan.value.planHash)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.quarantineRuns('alice', [created.run.runRef], plan.value.planHash)).toMatchObject({ ok: true });
    expect(store.listRuns('alice')).toEqual([]);
    expect(store.inventory('alice')).toMatchObject({ activeRuns: [], quarantinedRuns: [{ runRef: created.run.runRef, eventCount: 1 }] });
    expect(store.getRun('alice', created.run.runRef)).toMatchObject({ ok: false, reason: 'not-found' });

    const restored = store.restoreRun('alice', created.run.runRef);
    expect(restored).toMatchObject({ ok: true, value: { stageCount: 2, sessionCount: 1, eventCount: 2 } });
    expect(store.listEvents('alice', created.run.runRef)).toMatchObject({
      ok: true,
      value: [{ cursor: 1, kind: 'checkpoint' }, { cursor: 2, summary: 'run restored from quarantine' }],
    });
    expect(store.inventory('alice').quarantinedRuns).toEqual([]);
  });

  it('requires every descendant to be settled and every Human Request to be resolved', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const attempt = store.createAttempt('alice', created.stages[0].stageRef, { expectedStageVersion: 1, runtime: 'codex', model: 'fixed' });
    if (!attempt.ok) throw new Error(attempt.detail);
    const worker = store.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
    if (!worker.ok) throw new Error(worker.detail);
    const request = store.createHumanRequest('alice', created.run.runRef, {
      kind: 'review', title: 'Final review', prompt: 'Confirm retention is safe.',
    });
    if (!request.ok) throw new Error(request.detail);
    const stoppedRun = store.transitionRun('alice', created.run.runRef, created.run.version, 'stopped');
    if (!stoppedRun.ok) throw new Error(stoppedRun.detail);
    expect(store.dryRunQuarantine('alice', [created.run.runRef])).toMatchObject({
      ok: true, value: { items: [{ eligible: false }] },
    });

    const current = store.getRun('alice', created.run.runRef);
    if (!current.ok) throw new Error(current.detail);
    for (const stage of current.value.stages) {
      const stopped = store.transitionStage('alice', stage.stageRef, stage.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    for (const candidate of current.value.attempts) {
      const stopped = store.transitionAttempt('alice', candidate.attemptRef, candidate.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    for (const session of current.value.sessions) {
      if (session.sessionRef === worker.value.sessionRef) continue;
      const stopped = store.transitionSession('alice', session.sessionRef, session.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    const workerCurrent = store.getRun('alice', created.run.runRef);
    if (!workerCurrent.ok) throw new Error(workerCurrent.detail);
    const currentWorker = workerCurrent.value.sessions.find((session) => session.sessionRef === worker.value.sessionRef);
    if (!currentWorker) throw new Error('worker disappeared');

    expect(store.dryRunQuarantine('alice', [created.run.runRef])).toMatchObject({
      ok: true, value: { items: [{ eligible: false }] },
    });
    const workerStopped = store.transitionSession('alice', currentWorker.sessionRef, currentWorker.version, 'stopped');
    if (!workerStopped.ok) throw new Error(workerStopped.detail);
    expect(store.dryRunQuarantine('alice', [created.run.runRef])).toMatchObject({
      ok: true, value: { items: [{ eligible: false }] },
    });

    const responded = store.respondHumanRequest('alice', request.value.requestRef, {
      expectedRevision: request.value.revision,
      decision: 'approved',
      idempotencyKey: 'retention-review-approved',
    });
    if (!responded.ok) throw new Error(responded.detail);
    expect(store.dryRunQuarantine('alice', [created.run.runRef])).toMatchObject({
      ok: true, value: { items: [{ eligible: true }] },
    });
  });

  it('invalidates a dry-run when same-size bundle content changes without changing inventory counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-retention-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const created = createRun(store);
    store.appendEvent('alice', created.run.runRef, { kind: 'checkpoint', source: 'manager', checkpoint: 'alpha' });
    for (const stage of created.stages) {
      const stopped = store.transitionStage('alice', stage.stageRef, stage.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    const managerStopped = store.transitionSession('alice', created.sessions[0].sessionRef, created.sessions[0].version, 'stopped');
    if (!managerStopped.ok) throw new Error(managerStopped.detail);
    const runStopped = store.transitionRun('alice', created.run.runRef, created.run.version, 'stopped');
    if (!runStopped.ok) throw new Error(runStopped.detail);
    const plan = store.dryRunQuarantine('alice', [created.run.runRef]);
    if (!plan.ok) throw new Error(plan.detail);
    expect(plan.value.items[0]).toMatchObject({ eligible: true, eventCount: 1 });

    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { events: Array<{ checkpoint: string }> };
    document.events[0].checkpoint = 'bravo';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    const fresh = store.dryRunQuarantine('alice', [created.run.runRef]);
    if (!fresh.ok) throw new Error(fresh.detail);
    expect(fresh.value.items[0]).toMatchObject({ eligible: true, eventCount: 1, estimatedBytes: plan.value.items[0].estimatedBytes });
    expect(fresh.value.planHash).not.toBe(plan.value.planHash);
    expect(store.quarantineRuns('alice', [created.run.runRef], plan.value.planHash)).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('enforces a hard document byte ceiling before replacing durable state', () => {
    const store = createInMemoryControlPlaneStore({ ...deterministicOptions(), maxDocumentBytes: 200 });
    expect(() => createApprovedProposal(store)).toThrow(ControlStoreLimitError);
  });
});

/**
 * The settlement receipt used to pin the WHOLE historical run graph at load time, so every legitimate
 * later mutation — a successor run, a quarantine restore, any unrelated concurrent event — made the
 * document unloadable and the daemon unbootable. Durability is now receipt-scoped and finality is
 * enforced at mutation time; these cases hold both halves of that trade in place.
 */
describe('authorized 2026-08-01 settlement durability', () => {
  const SETTLED_AT = '2026-08-01T09:00:00.000Z';
  const SETTLEMENT_SUMMARY =
    'authorized one-off reconciliation settled the failed 2026-07-31 FYT thin-slice predecessor';

  type MutableDocument = {
    nextEventCursor: number;
    runs: Array<Record<string, any>>;
    events: Array<Record<string, any>>;
    [key: string]: any;
  };

  /** A real store whose one terminal run has been relabelled as the settled historical run. */
  function seedSettledStore(phase: 'claimed' | 'committed' = 'committed') {
    const root = mkdtempSync(join(tmpdir(), 'control-settlement-'));
    roots.push(root);
    const path = join(root, 'control', 'control-plane.json');
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const seeded = settleRetryPredecessor(store, 'alice');
    const document = JSON.parse(readFileSync(path, 'utf8')) as MutableDocument;
    for (const key of ['runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events']) {
      for (const record of document[key] as Array<Record<string, unknown>>) {
        if (record.runRef === seeded.run.runRef) record.runRef = AUTHORIZED_20260801_FAILED_RUN_REF;
      }
    }
    const run = document.runs[0] as Record<string, any>;
    run.authorizedFailedRunReconciliation = {
      idempotencyKey: AUTHORIZED_20260801_FAILED_RUN_INPUT.idempotencyKey,
      fingerprint: AUTHORIZED_20260801_FAILED_RUN_FINGERPRINT,
      phase,
      claimedAt: SETTLED_AT,
      updatedAt: SETTLED_AT,
      canonicalCommit: phase === 'committed' ? 'a'.repeat(40) : null,
      eventCursor: phase === 'committed' ? document.nextEventCursor : null,
    };
    if (phase === 'committed') {
      document.events.push({
        subject: 'alice', cursor: document.nextEventCursor, runRef: AUTHORIZED_20260801_FAILED_RUN_REF,
        kind: 'governance', source: 'human', stageRef: null, attemptRef: null, sessionRef: null,
        status: 'success', summary: SETTLEMENT_SUMMARY,
        command: null, toolName: null, path: null, diff: null, checkpoint: null, createdAt: SETTLED_AT,
      });
      document.nextEventCursor += 1;
    }
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    return { root, path, run: { ...seeded.run, runRef: AUTHORIZED_20260801_FAILED_RUN_REF } };
  }

  function successorInput(run: { proposalRef: string; proposalRevision: number; proposalHash: string; version: number }) {
    return {
      title: 'Successor of the settled run',
      proposalRef: run.proposalRef,
      proposalRevision: run.proposalRevision,
      expectedProposalHash: run.proposalHash,
      managerRuntime: 'claude',
      managerModel: 'claude-sonnet-5',
      idempotencyKey: 'settled-successor',
      predecessorRunRef: AUTHORIZED_20260801_FAILED_RUN_REF,
      expectedPredecessorVersion: run.version,
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [] },
        { stageId: 'verify', title: 'Verify', dependsOn: ['build'] },
      ],
    };
  }

  it('refuses a successor for the settled run and stays loadable afterwards', () => {
    const { root, run } = seedSettledStore();
    const store = createFileControlPlaneStore(root);
    const successor = store.createRun('alice', successorInput(run));
    expect(successor).toMatchObject({ ok: false, reason: 'invalid' });
    expect(successor.ok ? '' : successor.detail).toMatch(/settled failed run/);
    expect(store.listRuns('alice')).toHaveLength(1);
    // The brick: a document that moved on must still load, refusal or not.
    expect(() => createFileControlPlaneStore(root)).not.toThrow();
  });

  it('restores the settled run from quarantine without breaking load or reopening Retry', () => {
    const { root, run } = seedSettledStore();
    const store = createFileControlPlaneStore(root);
    const plan = store.dryRunQuarantine('alice', [AUTHORIZED_20260801_FAILED_RUN_REF]);
    if (!plan.ok) throw new Error(plan.detail);
    expect(store.quarantineRuns('alice', [AUTHORIZED_20260801_FAILED_RUN_REF], plan.value.planHash)).toMatchObject({ ok: true });
    expect(() => createFileControlPlaneStore(root)).not.toThrow();

    const restored = store.restoreRun('alice', AUTHORIZED_20260801_FAILED_RUN_REF);
    expect(restored).toMatchObject({ ok: true });
    expect(() => createFileControlPlaneStore(root)).not.toThrow();
    const reopened = createFileControlPlaneStore(root);
    const detail = reopened.getRun('alice', AUTHORIZED_20260801_FAILED_RUN_REF);
    if (!detail.ok) throw new Error(detail.detail);
    // The receipt travels with the run, so finality survives the quarantine round trip.
    const successor = reopened.createRun('alice', { ...successorInput(run), expectedPredecessorVersion: detail.value.run.version });
    expect(successor).toMatchObject({ ok: false, reason: 'invalid' });
    expect(successor.ok ? '' : successor.detail).toMatch(/settled failed run/);
  });

  it('survives an unrelated concurrent event while the settlement is only claimed', () => {
    const { root } = seedSettledStore('claimed');
    const store = createFileControlPlaneStore(root);
    expect(store.appendEvent('alice', AUTHORIZED_20260801_FAILED_RUN_REF, {
      kind: 'lifecycle', source: 'system', summary: 'unrelated concurrent event',
    })).toMatchObject({ ok: true });
    // nextEventCursor is a GLOBAL counter; a claimed receipt must never depend on its exact value.
    expect(() => createFileControlPlaneStore(root)).not.toThrow();
  });

  it('still rejects a receipt whose own invariants are incoherent', () => {
    const { root, path } = seedSettledStore();
    const original = JSON.parse(readFileSync(path, 'utf8')) as MutableDocument;

    const forgedFingerprint = structuredClone(original);
    forgedFingerprint.runs[0].authorizedFailedRunReconciliation.fingerprint = 'f'.repeat(64);
    writeFileSync(path, `${JSON.stringify(forgedFingerprint)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/authorized failed-run reconciliation receipt/);

    const missingEvent = structuredClone(original);
    missingEvent.events = missingEvent.events.filter((event) => event.summary !== SETTLEMENT_SUMMARY);
    writeFileSync(path, `${JSON.stringify(missingEvent)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root)).toThrow(/authorized failed-run reconciliation event/);
  });
});

/**
 * spec §3b — dismissing a dead run.
 *
 * The two things that make this safe are tested here rather than at the route: `archived` is reachable
 * ONLY from a settled or parked run (never from live work), and the dismissal and the resolution of the
 * run's open asks are ONE commit — a run can never end up dismissed while still holding an open ask.
 */
describe('run archival', () => {
  /** A published run parked at `waiting-human` with one unanswered ask — the shape being dismissed. */
  function parkedRunWithOpenRequest(store: ControlPlaneStore) {
    const detail = prepareActivatableRun(store, false);
    const request = store.createHumanRequest('alice', detail.run.runRef, {
      kind: 'intervention',
      title: 'Traceback: manager boot failed',
      prompt: 'Error: spawn claude ENOENT\n  at ChildProcess.handle',
    });
    if (!request.ok) throw new Error(request.detail);
    const current = store.getRun('alice', detail.run.runRef);
    if (!current.ok) throw new Error(current.detail);
    return { run: current.value.run, requestRef: request.value.requestRef };
  }

  it('moves a parked run to archived and resolves its open requests in the same commit', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const { run, requestRef } = parkedRunWithOpenRequest(store);

    const archived = store.archiveRun('alice', run.runRef, {
      idempotencyKey: `archive:${run.runRef}:1`, reason: 'obsolete thin-slice validation run',
    });
    if (!archived.ok) throw new Error(archived.detail);
    expect(archived.value.run.lifecycle.kind).toBe('archived');
    expect(archived.value.run.version).toBe(run.version + 1);
    expect(archived.value.resolvedRequests.map((item) => item.requestRef)).toEqual([requestRef]);
    expect(archived.value.pinnedRequestRefs).toEqual([]);

    const detail = store.getRun('alice', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    // The run keeps every record it had — archiving hides it, it does not delete anything.
    expect(detail.value.humanRequests).toHaveLength(1);
    expect(detail.value.humanRequests[0]).toMatchObject({
      state: 'resolved',
      response: { decision: 'responded', respondedBy: 'alice', response: 'obsolete thin-slice validation run' },
    });
  });

  it('replays an identical archive and refuses a reused key with a different reason', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const { run } = parkedRunWithOpenRequest(store);
    const input = { idempotencyKey: 'archive-key-1', reason: 'stale validation run' };

    const first = store.archiveRun('alice', run.runRef, input);
    if (!first.ok) throw new Error(first.detail);
    const replay = store.archiveRun('alice', run.runRef, input);
    expect(replay).toMatchObject({ ok: true, replayed: true });
    // A replay never re-archives: the version is the one the first call produced.
    expect(replay.ok && replay.value.run.version).toBe(first.value.run.version);
    expect(replay.ok && replay.value.resolvedRequests).toHaveLength(1);

    expect(store.archiveRun('alice', run.runRef, { ...input, reason: 'different reason' }))
      .toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    expect(store.archiveRun('alice', run.runRef, { idempotencyKey: 'archive-key-2', reason: 'stale validation run' }))
      .toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('archives a settled run and refuses one that is still live', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const settled = settleRetryPredecessor(store);
    expect(store.archiveRun('alice', settled.run.runRef, { idempotencyKey: 'archive-failed-run' }))
      .toMatchObject({ ok: true, value: { run: { lifecycle: { kind: 'archived', deployPause: null } } } });

    const live = createRun(store, 'bob');
    const running = store.transitionRun('bob', live.run.runRef, live.run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const refused = store.archiveRun('bob', live.run.runRef, { idempotencyKey: 'archive-live-run' });
    expect(refused).toMatchObject({ ok: false, reason: 'invalid' });
    expect(refused.ok ? '' : refused.detail).toMatch(/finished, stopped, interrupted, or waiting-human/);
  });

  it('refuses a bare transition into archived, and archived is absorbing', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const { run } = parkedRunWithOpenRequest(store);
    // Only `archiveRun` may write the edge — a bare transition would strand the open asks.
    expect(store.transitionRun('alice', run.runRef, run.version, 'archived'))
      .toMatchObject({ ok: false, reason: 'invalid' });

    const archived = store.archiveRun('alice', run.runRef, { idempotencyKey: 'archive-absorbing' });
    if (!archived.ok) throw new Error(archived.detail);
    for (const state of ['running', 'waiting-human', 'failed', 'stopped'] as const) {
      expect(store.transitionRun('alice', run.runRef, archived.value.run.version, state))
        .toMatchObject({ ok: false, reason: 'invalid' });
    }
  });

  it('survives a reload and keeps the archive private bookkeeping off the public run', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-archive-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const { run } = parkedRunWithOpenRequest(store);
    const archived = store.archiveRun('alice', run.runRef, { idempotencyKey: 'archive-persisted', reason: 'dead' });
    if (!archived.ok) throw new Error(archived.detail);
    expect(Object.keys(archived.value.run)).not.toContain('archiveOperationKey');
    expect(Object.keys(archived.value.run)).not.toContain('archiveOperationFingerprint');

    const reopened = createFileControlPlaneStore(root, deterministicOptions());
    const detail = reopened.getRun('alice', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.run.lifecycle.kind).toBe('archived');
    // The idempotency record survived the restart too, so a retried request still replays.
    expect(reopened.archiveRun('alice', run.runRef, { idempotencyKey: 'archive-persisted', reason: 'dead' }))
      .toMatchObject({ ok: true, replayed: true });
  });
});

/**
 * Engine-side auto-close of orphaned Human Requests (dashboard Inbox revamp).
 *
 * ONE predicate keeps a request from haunting the Inbox forever, and it never fabricates a human answer:
 * the resolution always carries `decision: 'auto-closed'`, never `'responded'` (see
 * `HumanRequestDecision`'s doc comment). `transitionRun` closes inline, in the same commit, the moment a
 * run it is attached to reaches a terminal state; `closeOrphanedHumanRequests` is the boot/interval sweep
 * that ALSO catches a request whose run was already terminal before this shipped.
 *
 * An AGE predicate shipped alongside it and was removed by ruling (2026-08-11): closure is irreversible,
 * so closing a request merely for being old can permanently wedge a run that is legitimately parked on a
 * human gate. The tests below pin the removal, not just the terminal path.
 */
describe('Human Request auto-close', () => {
  function requestOnRun(store: ControlPlaneStore, runRef: string, subject = 'alice') {
    const created = store.createHumanRequest(subject, runRef, {
      kind: 'approval',
      title: 'automatic:policy:draft:spending-language-requires-human-review',
      prompt: 'spending-language-requires-human-review',
    });
    if (!created.ok) throw new Error(created.detail);
    return created.value;
  }

  it('closes an open request in the SAME commit the run reaches a terminal state, never claiming a human answered', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const { run } = createRun(store);
    const running = store.transitionRun('alice', run.runRef, run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const request = requestOnRun(store, run.runRef);

    const failed = store.transitionRun('alice', run.runRef, running.value.version, 'failed');
    expect(failed).toMatchObject({ ok: true, value: { lifecycle: { kind: 'failed', deployPause: null } } });

    const detail = store.getRun('alice', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.humanRequests).toEqual([expect.objectContaining({
      requestRef: request.requestRef,
      state: 'resolved',
      response: expect.objectContaining({ decision: 'auto-closed', respondedBy: 'alice' }),
    })]);
    const reason = detail.value.humanRequests[0]!.response!.response;
    expect(reason).toMatch(/terminal state/);
    expect(reason).toMatch(/'failed'/);
    // Honesty check: never the label a real human response carries.
    expect(detail.value.humanRequests[0]!.response!.decision).not.toBe('responded');
  });

  it('leaves an open request untouched when the run only becomes waiting-human or interrupted (both resumable)', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const { run } = createRun(store);
    const running = store.transitionRun('alice', run.runRef, run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const request = requestOnRun(store, run.runRef);

    const waiting = store.transitionRun('alice', run.runRef, running.value.version, 'waiting-human');
    if (!waiting.ok) throw new Error(waiting.detail);
    const afterWaiting = store.getRun('alice', run.runRef);
    if (!afterWaiting.ok) throw new Error(afterWaiting.detail);
    expect(afterWaiting.value.humanRequests[0]).toMatchObject({ requestRef: request.requestRef, state: 'open' });

    const interrupted = store.transitionRun('alice', run.runRef, waiting.value.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    const detail = store.getRun('alice', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.humanRequests[0]).toMatchObject({ requestRef: request.requestRef, state: 'open' });
  });

  it('never auto-closes a `review` kind request — retention/quarantine requires it stay an explicit human decision', () => {
    // REGRESSION GUARD for 'durability, crash recovery, and retention > requires every descendant to be
    // settled and every Human Request to be resolved': that test relies on a `review` request surviving
    // a bare `transitionRun` to `stopped` unresolved, so quarantine dry-run correctly reports ineligible
    // until a human actually answers it. This kind is exempted from BOTH auto-close predicates on purpose.
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const { run } = createRun(store);
    const running = store.transitionRun('alice', run.runRef, run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const request = store.createHumanRequest('alice', run.runRef, { kind: 'review', title: 'Final review', prompt: 'Confirm retention is safe.' });
    if (!request.ok) throw new Error(request.detail);

    const stopped = store.transitionRun('alice', run.runRef, running.value.version, 'stopped');
    expect(stopped).toMatchObject({ ok: true, value: { lifecycle: { kind: 'stopped', deployPause: null } } });
    const afterStop = store.getRun('alice', run.runRef);
    if (!afterStop.ok) throw new Error(afterStop.detail);
    expect(afterStop.value.humanRequests[0]).toMatchObject({ requestRef: request.value.requestRef, state: 'open' });

    // The sweep's terminal-run predicate must not reach it either, however long it sits there.
    const farFuture = Date.parse(request.value.createdAt) + 365 * 24 * 60 * 60 * 1000;
    expect(store.closeOrphanedHumanRequests(farFuture).closed).toEqual([]);
  });

  it('sweep: NEVER closes an open request for being old while its run is still waiting-human', () => {
    // The removed age predicate (ruling 2026-08-11). This request is 21 days old on a run that is parked
    // exactly where a human gate parks it. Closing is irreversible — nothing reopens a resolved request,
    // `respondHumanRequest`/`reviseHumanRequest` both conflict on one, and `stageBoundary` then refuses
    // the run permanently — so an age heuristic here wedges a run whose only fault is a patient operator.
    let hour = 0;
    const store = createInMemoryControlPlaneStore({
      newId: (() => { let id = 0; return () => String(++id); })(),
      now: () => new Date(Date.UTC(2026, 6, 21, hour++, 0, 0)), // 2026-07-21, one hour per call
    });
    const { run } = createRun(store);
    const running = store.transitionRun('alice', run.runRef, run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const waiting = store.transitionRun('alice', run.runRef, running.value.version, 'waiting-human');
    if (!waiting.ok) throw new Error(waiting.detail);
    const oldRequest = requestOnRun(store, run.runRef);

    const nowMs = Date.UTC(2026, 7, 11); // 2026-08-11 — 21 days after the request was filed
    expect(store.closeOrphanedHumanRequests(nowMs).closed).toEqual([]);
    // A year later it is still the operator's to answer.
    expect(store.closeOrphanedHumanRequests(nowMs + 365 * 24 * 60 * 60 * 1000).closed).toEqual([]);

    const detail = store.getRun('alice', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.humanRequests[0]).toMatchObject({ requestRef: oldRequest.requestRef, state: 'open', response: null });
    // …and it is still answerable, which is the whole point: a closed one would refuse here.
    expect(store.respondHumanRequest('alice', oldRequest.requestRef, {
      expectedRevision: detail.value.humanRequests[0]!.revision,
      decision: 'approved',
      idempotencyKey: 'late-but-valid',
      response: 'answered three weeks later',
    })).toMatchObject({ ok: true, value: { state: 'resolved' } });
  });

  it('writes one governance event onto the run timeline for every request it auto-closes', () => {
    // A resolution recorded only on the request record is invisible where the operator actually reads
    // the run's history. `source: 'system'` because no human was involved; the summary carries the why.
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const { run } = createRun(store);
    const running = store.transitionRun('alice', run.runRef, run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const request = requestOnRun(store, run.runRef);

    const failed = store.transitionRun('alice', run.runRef, running.value.version, 'failed');
    if (!failed.ok) throw new Error(failed.detail);

    const events = store.listEvents('alice', run.runRef);
    if (!events.ok) throw new Error(events.detail);
    const autoClosed = events.value.filter((event) => event.summary?.includes('auto-closed'));
    expect(autoClosed).toEqual([expect.objectContaining({
      kind: 'governance',
      source: 'system',
      status: 'stopped',
      summary: expect.stringContaining("terminal:failed"),
    })]);
    expect(autoClosed[0]!.summary).toContain('terminal state');
    expect(request.requestRef).toBeTruthy();
  });

  it('at the run event cap the request still closes and only the timeline event is dropped', () => {
    // Pins `autoCloseOpenHumanRequestsForRun`'s `if (eventCount >= maxEvents) continue;` branch. The
    // direction matters: the close is the record of truth and the timeline event is the audit copy, so at
    // the budget it is the EVENT that gives way — never the close, and never the transition itself.
    const store = createInMemoryControlPlaneStore({ ...deterministicOptions(), maxEventsPerRun: 1 });
    const { run } = createRun(store);
    const running = store.transitionRun('alice', run.runRef, run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const request = requestOnRun(store, run.runRef);
    // Spend the run's ENTIRE event budget before the terminal transition.
    const filler = store.appendEvent('alice', run.runRef, { kind: 'lifecycle', source: 'system', summary: 'budget filler' });
    if (!filler.ok) throw new Error(filler.detail);

    const failed = store.transitionRun('alice', run.runRef, running.value.version, 'failed');
    expect(failed).toMatchObject({ ok: true }); // the cap never fails the transition

    const detail = store.getRun('alice', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.humanRequests[0]).toMatchObject({
      requestRef: request.requestRef,
      state: 'resolved',
      response: expect.objectContaining({ decision: 'auto-closed' }),
    });

    const events = store.listEvents('alice', run.runRef);
    if (!events.ok) throw new Error(events.detail);
    expect(events.value).toHaveLength(1); // still just the filler: the governance copy was dropped
    expect(events.value.filter((event) => event.summary?.includes('auto-closed'))).toEqual([]);
  });

  it('sweep: also closes an orphan whose run was already terminal before this shipped (file-store, pre-fix shape)', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-orphan-sweep-'));
    roots.push(root);
    const path = join(root, 'control', 'control-plane.json');
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const { run } = createRun(store);
    const running = store.transitionRun('alice', run.runRef, run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const request = requestOnRun(store, run.runRef);

    // Simulate data written before this fix existed: the run reached `failed` WITHOUT going through the
    // (now-patched) `transitionRun`, so its request is still `open` on disk — the shape every pre-existing
    // zombie was actually found in.
    const document = persistedV1(JSON.parse(readFileSync(path, 'utf8'))) as { runs: Array<Record<string, unknown>> };
    const record = document.runs.find((candidate) => candidate.runRef === run.runRef);
    if (!record) throw new Error('seeded run missing from the raw document');
    record.state = 'failed';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');

    const reopened = createFileControlPlaneStore(root, deterministicOptions());
    const swept = reopened.closeOrphanedHumanRequests(Date.now());
    expect(swept.closed).toEqual([expect.objectContaining({ requestRef: request.requestRef, state: 'resolved' })]);
    expect(swept.closed[0]!.response).toMatchObject({ decision: 'auto-closed' });
    expect(swept.closed[0]!.response!.response).toMatch(/terminal state/);
  });
});

/**
 * Cross-subject scope (rulings, 2026-08-11).
 *
 * Runs are subject-scoped, and the daemon's runs are not all created by the same subject: the SPA
 * session is `operator`, everything the queue bridge and the executor launch is `dashboard-engine`. The
 * store's reads therefore take an explicit {@link ReadScope}, and — since Daniel's follow-up ruling —
 * so do the operator-driven mutations. `'own-subject'` is the default everywhere, so a caller that
 * passes nothing (every engine, executor and bridge call) is byte-for-byte unchanged.
 *
 * These tests pin three things: what widening reaches; that a widened mutation moves NO ownership and
 * records the OPERATOR as the actor; and that a mutation called without the widened scope still refuses
 * a foreign run, per mutation.
 */
describe('read scope', () => {
  function engineRunWithHistory(store: ControlPlaneStore) {
    const created = createRun(store, 'dashboard-engine');
    const appended = store.appendEvent('dashboard-engine', created.run.runRef, {
      kind: 'lifecycle', source: 'system', summary: 'engine run started',
    });
    if (!appended.ok) throw new Error(appended.detail);
    return created.run;
  }

  /** Park `run` on `waiting-human` as its owner would — the state a gate is actually answered in. */
  function publishAndPark(store: ControlPlaneStore, subject: string, run: Run): Run {
    const publishing = store.transitionPublication(subject, run.runRef, run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = store.transitionPublication(subject, run.runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const parked = store.transitionRun(subject, run.runRef, published.value.version, 'waiting-human');
    if (!parked.ok) throw new Error(parked.detail);
    return parked.value;
  }

  it('all-subjects lists, opens and streams a run owned by another subject; own-subject cannot see it at all', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const engineRun = engineRunWithHistory(store);
    const ownRun = createRun(store, 'operator').run;

    expect(store.listRuns('operator').map((run) => run.runRef)).toEqual([ownRun.runRef]);
    expect(store.listRuns('operator', 'all-subjects').map((run) => run.runRef).sort())
      .toEqual([engineRun.runRef, ownRun.runRef].sort());

    expect(store.getRun('operator', engineRun.runRef)).toMatchObject({ ok: false, reason: 'not-found' });
    const detail = store.getRun('operator', engineRun.runRef, 'all-subjects');
    if (!detail.ok) throw new Error(detail.detail);
    // Child records are gathered under the RUN's subject, not the caller's — otherwise the run would
    // open with every list empty, which is worse than not opening.
    expect(detail.value.run.runRef).toBe(engineRun.runRef);
    expect(detail.value.stages.map((stage) => stage.stageId)).toEqual(['build', 'verify']);

    expect(store.listEvents('operator', engineRun.runRef)).toMatchObject({ ok: false, reason: 'not-found' });
    const events = store.listEvents('operator', engineRun.runRef, 0, 250, 'all-subjects');
    if (!events.ok) throw new Error(events.detail);
    expect(events.value.map((event) => event.summary)).toContain('engine run started');
  });

  it('all-subjects reaches another subject`s workflow-registry revisions (the Workflows-graph join)', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = store.createProposalRevision('dashboard-engine', {
      sourceComposerRef: 'workflow-registry', sourceTurnId: 'daily-news',
      title: 'Daily news', snapshot: { schema: 'kb.plan-proposal/v1' },
    });
    if (!created.ok) throw new Error(created.detail);

    expect(store.listProposalRevisionsForComposer('operator', 'workflow-registry')).toEqual([]);
    expect(store.listProposalRevisionsForComposer('operator', 'workflow-registry', 'all-subjects'))
      .toEqual([expect.objectContaining({ sourceTurnId: 'daily-news', proposalRef: created.value.proposalRef })]);
  });

  it('every mutation still refuses a foreign run when it is not explicitly widened', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const engineRun = engineRunWithHistory(store);
    const ask = store.createHumanRequest('dashboard-engine', engineRun.runRef, {
      kind: 'approval', title: 'Gate', prompt: 'Approve?',
    });
    if (!ask.ok) throw new Error(ask.detail);

    expect(store.transitionRun('operator', engineRun.runRef, engineRun.version, 'running'))
      .toMatchObject({ ok: false, reason: 'not-found' });
    expect(store.createHumanRequest('operator', engineRun.runRef, { kind: 'input', title: 'x', prompt: 'y' }))
      .toMatchObject({ ok: false, reason: 'not-found' });
    expect(store.appendEvent('operator', engineRun.runRef, { kind: 'lifecycle', source: 'system', summary: 'nope' }))
      .toMatchObject({ ok: false, reason: 'not-found' });
    expect(store.archiveRun('operator', engineRun.runRef, { idempotencyKey: 'k', reason: null }))
      .toMatchObject({ ok: false, reason: 'not-found' });
    expect(store.getHumanRequest('operator', ask.value.requestRef)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(store.respondHumanRequest('operator', ask.value.requestRef, {
      expectedRevision: 1, decision: 'approved', idempotencyKey: 'k', response: null,
    })).toMatchObject({ ok: false, reason: 'not-found' });
    expect(store.recordManagerCommand('operator', engineRun.runRef, {
      expectedRunVersion: engineRun.version, expectedManagerGeneration: engineRun.managerGeneration,
      idempotencyKey: 'k', kind: 'message', message: 'nope',
    })).toMatchObject({ ok: false, reason: 'not-found' });
    expect(store.resolveIterationGate('operator', ask.value.requestRef, {
      expectedRequestRevision: 1, expectedReceiptVersion: 1, expectedLoopVersion: 1,
      decision: 'approved', operationKey: 'k', response: null,
    })).toMatchObject({ ok: false, reason: 'not-found' });

    const owned = store.getRun('dashboard-engine', engineRun.runRef);
    if (!owned.ok) throw new Error(owned.detail);
    expect(owned.value.run.lifecycle.kind).toBe('planned');
    expect(owned.value.humanRequests).toEqual([expect.objectContaining({ state: 'open' })]);
  });


  it('names the owning subject on every run DTO, so one mixed list can be told apart', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const engineRun = engineRunWithHistory(store);
    const ownRun = createRun(store, 'operator').run;

    expect(store.listRuns('operator', 'all-subjects').map((run) => [run.runRef, run.ownerSubject]).sort())
      .toEqual([[engineRun.runRef, 'dashboard-engine'], [ownRun.runRef, 'operator']].sort());
    const detail = store.getRun('operator', engineRun.runRef, 'all-subjects');
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.ownerSubject).toBe('dashboard-engine');
  });

  it('lets the operator answer a gate on a dashboard-engine run: operator recorded, ownership unmoved, run resumable', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const engineRun = engineRunWithHistory(store);
    const published = publishAndPark(store, 'dashboard-engine', engineRun);
    const ask = store.createHumanRequest('dashboard-engine', engineRun.runRef, {
      kind: 'approval', title: 'Publish the cut?', prompt: 'Approve the render.',
    });
    if (!ask.ok) throw new Error(ask.detail);

    // Before the answer the run is genuinely stuck: its boundary is unresolved.
    expect(store.transitionRun('dashboard-engine', engineRun.runRef, published.version, 'running'))
      .toMatchObject({ ok: false, reason: 'invalid' });

    const answered = store.respondHumanRequest('operator', ask.value.requestRef, {
      expectedRevision: 1, decision: 'approved', idempotencyKey: 'operator-answers', response: 'ship it',
    }, 'all-subjects');
    if (!answered.ok) throw new Error(answered.detail);
    // THE ACTOR IS THE OPERATOR — the record of who answered names the human, not the run's owner.
    expect(answered.value.response).toMatchObject({ respondedBy: 'operator', decision: 'approved', response: 'ship it' });

    // OWNERSHIP IS UNMOVED: the request is still the engine's, still on the engine's run, and the
    // operator still owns no runs of their own.
    expect(store.getHumanRequest('dashboard-engine', ask.value.requestRef))
      .toMatchObject({ ok: true, value: { requestRef: ask.value.requestRef, state: 'resolved' } });
    expect(store.listRuns('operator')).toEqual([]);
    const owned = store.getRun('dashboard-engine', engineRun.runRef);
    if (!owned.ok) throw new Error(owned.detail);
    expect(owned.value.ownerSubject).toBe('dashboard-engine');
    expect(owned.value.humanRequests).toHaveLength(1);

    // The boundary is accepted, so the run its owner drives is resumable again — the point of the ruling.
    expect(store.transitionRun('dashboard-engine', engineRun.runRef, owned.value.run.version, 'running'))
      .toMatchObject({ ok: true });
  });

  it('files a widened event and a widened intervention request under the RUN, never under the operator', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const engineRun = engineRunWithHistory(store);

    const appended = store.appendEvent('operator', engineRun.runRef, {
      kind: 'governance', source: 'human', status: 'success', summary: 'Human Request approved at revision 1',
    }, 'all-subjects');
    if (!appended.ok) throw new Error(appended.detail);
    const filed = store.createHumanRequest('operator', engineRun.runRef, {
      kind: 'intervention', title: 'Manager message delivery needs reconciliation', prompt: 'Delivery failed.',
    }, 'all-subjects');
    if (!filed.ok) throw new Error(filed.detail);

    // Both land on the OWNER's partition: the engine reading its own run sees them without any scope.
    const events = store.listEvents('dashboard-engine', engineRun.runRef);
    if (!events.ok) throw new Error(events.detail);
    expect(events.value.map((event) => event.summary)).toContain('Human Request approved at revision 1');
    const owned = store.getRun('dashboard-engine', engineRun.runRef);
    if (!owned.ok) throw new Error(owned.detail);
    expect(owned.value.humanRequests.map((request) => request.requestRef)).toEqual([filed.value.requestRef]);
    // And nothing at all was created under the operator.
    expect(store.listRuns('operator')).toEqual([]);
  });

  it('lets the operator steer and stop a dashboard-engine run, with the command on the run`s own timeline', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const engineRun = engineRunWithHistory(store);

    const steered = store.recordManagerCommand('operator', engineRun.runRef, {
      expectedRunVersion: engineRun.version, expectedManagerGeneration: engineRun.managerGeneration,
      idempotencyKey: 'operator-steers', kind: 'steer', message: 'Inspect the diff first.', checkpoint: 'safe-1',
    }, 'all-subjects');
    if (!steered.ok) throw new Error(steered.detail);
    expect(steered.value.event).toMatchObject({ kind: 'checkpoint', source: 'human', checkpoint: 'safe-1' });

    const stopped = store.recordManagerCommand('operator', engineRun.runRef, {
      expectedRunVersion: steered.value.run.version, expectedManagerGeneration: engineRun.managerGeneration,
      idempotencyKey: 'operator-stops', kind: 'stop',
    }, 'all-subjects');
    if (!stopped.ok) throw new Error(stopped.detail);
    expect(stopped.value.run.lifecycle.kind).toBe('stopping');

    // Both events are on the ENGINE's timeline — an operator-partitioned event would be invisible to
    // the run's own reader, uncounted against its event cap, and orphaned by a quarantine.
    const events = store.listEvents('dashboard-engine', engineRun.runRef);
    if (!events.ok) throw new Error(events.detail);
    expect(events.value.map((event) => event.summary))
      .toEqual(['engine run started', 'Inspect the diff first.', 'operator requested Manager stop']);
    expect(store.getRun('dashboard-engine', engineRun.runRef)).toMatchObject({
      ok: true, value: { ownerSubject: 'dashboard-engine', run: { lifecycle: { kind: 'stopping', deployPause: null } } },
    });
  });

  it('lets the operator archive a dashboard-engine run, resolving its asks in the operator`s name', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const engineRun = engineRunWithHistory(store);
    publishAndPark(store, 'dashboard-engine', engineRun);
    const ask = store.createHumanRequest('dashboard-engine', engineRun.runRef, {
      kind: 'intervention', title: 'Manager boot failed', prompt: 'spawn claude ENOENT',
    });
    if (!ask.ok) throw new Error(ask.detail);

    const archived = store.archiveRun('operator', engineRun.runRef, {
      idempotencyKey: 'operator-archives', reason: 'obsolete validation run',
    }, 'all-subjects');
    if (!archived.ok) throw new Error(archived.detail);
    // Existing archive semantics, unchanged: terminal `archived` run, every answerable ask resolved in
    // the same commit with the operator's reason, and the resolution reported back.
    expect(archived.value.run.lifecycle.kind).toBe('archived');
    expect(archived.value.pinnedRequestRefs).toEqual([]);
    expect(archived.value.resolvedRequests).toEqual([expect.objectContaining({
      requestRef: ask.value.requestRef, state: 'resolved',
    })]);
    expect(archived.value.resolvedRequests[0]!.response)
      .toMatchObject({ respondedBy: 'operator', decision: 'responded', response: 'obsolete validation run' });

    // The run and its request are still the engine's.
    expect(store.getRun('dashboard-engine', engineRun.runRef)).toMatchObject({
      ok: true, value: { ownerSubject: 'dashboard-engine', run: { lifecycle: { kind: 'archived', deployPause: null } } },
    });
    expect(store.listRuns('operator', 'all-subjects').map((run) => run.ownerSubject)).toEqual(['dashboard-engine']);

    // A replay on the same key is still a replay, and a second, different archive still conflicts.
    expect(store.archiveRun('operator', engineRun.runRef, {
      idempotencyKey: 'operator-archives', reason: 'obsolete validation run',
    }, 'all-subjects')).toMatchObject({ ok: true, replayed: true });
    expect(store.archiveRun('operator', engineRun.runRef, {
      idempotencyKey: 'operator-archives-again', reason: 'again',
    }, 'all-subjects')).toMatchObject({ ok: false, reason: 'conflict' });
  });

});

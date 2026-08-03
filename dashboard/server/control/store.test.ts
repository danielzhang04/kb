import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ControlStoreLimitError,
  AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT,
  AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF,
  AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF,
  AUTHORIZED_20260731_EXECUTION_LOCK_TITLE,
  AUTHORIZED_20260801_FAILED_RUN_STAGES,
  AUTHORIZED_20260801_FAILED_RUN_FINGERPRINT,
  AUTHORIZED_20260801_FAILED_RUN_INPUT,
  AUTHORIZED_20260801_FAILED_RUN_REF,
  MAX_HUMAN_REQUESTS_PER_RUN,
  createFileControlPlaneStore,
  createInMemoryControlPlaneStore,
  exactAuthorized20260801ProposalRevision,
  proposalSnapshotHash,
} from './store.ts';
import type { ControlPlaneStore } from './store.ts';
import type { JsonObject, ProposalRevision } from './types.ts';

const roots: string[] = [];
const SOURCE = { sourceComposerRef: 'composer-1', sourceTurnId: 'turn-1' } as const;

describe('authorized 2026-08-01 proposal provenance', () => {
  const snapshot = JSON.parse(readFileSync(join(
    process.cwd(), 'server', 'control', 'test-fixtures', 'authorized-20260801-fyt-proposal.json',
  ), 'utf8')) as JsonObject;
  const exact: ProposalRevision = {
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
    const normalized = createFileControlPlaneStore(root);
    const normalizedDocument = JSON.parse(readFileSync(join(root, 'control', 'control-plane.json'), 'utf8')) as {
      humanRequests: Array<Record<string, unknown>>;
    };
    expect(normalizedDocument.humanRequests[0]).toMatchObject({
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
      stageGenerations: [], reviewLoops: [], reviewReceipts: [], generationSupersessions: [],
    }];
    for (const field of ['runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations', 'reviewLoops', 'reviewReceipts', 'generationSupersessions']) {
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
  const current = store.getRun('alice', created.run.runRef);
  if (!current.ok) throw new Error(current.detail);
  const subject = current.value.stages.find((stage) => stage.stageId === 'build');
  if (!subject) throw new Error('checker subject missing');
  if (subject.canonicalCardRef === null) {
    const linked = store.linkStageCard('alice', subject.stageRef, subject.version, 'card-build');
    if (!linked.ok) throw new Error(linked.detail);
  }
  const afterCard = store.getRun('alice', created.run.runRef);
  if (!afterCard.ok) throw new Error(afterCard.detail);
  const cardedSubject = afterCard.value.stages.find((stage) => stage.stageId === 'build');
  if (!cardedSubject?.canonicalCardRef) throw new Error('checker subject card missing');
  const attempt = store.createAttempt('alice', cardedSubject.stageRef, {
    expectedStageVersion: cardedSubject.version, runtime: 'codex', model: 'fixed',
  });
  if (!attempt.ok) throw new Error(attempt.detail);
  let attemptVersion = attempt.value.version;
  if (withCompletedWorkerSession) {
    const session = store.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attemptVersion });
    if (!session.ok) throw new Error(session.detail);
    completeWorkerSession(store, session.value.sessionRef, session.value.version);
    attemptVersion += 1;
  }
  const starting = store.transitionAttempt('alice', attempt.value.attemptRef, attemptVersion, 'starting');
  if (!starting.ok) throw new Error(starting.detail);
  const running = store.transitionAttempt('alice', starting.value.attemptRef, starting.value.version, 'running');
  if (!running.ok) throw new Error(running.detail);
  const succeeded = store.transitionAttempt('alice', running.value.attemptRef, running.value.version, 'succeeded');
  if (!succeeded.ok) throw new Error(succeeded.detail);
  const detail = store.getRun('alice', created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const currentStage = detail.value.stages.find((stage) => stage.stageRef === cardedSubject.stageRef);
  if (!currentStage) throw new Error('checker subject disappeared');
  const input = {
    expectedStageVersion: currentStage.version, expectedAttemptVersion: succeeded.value.version, expectedGeneration: 1,
    operationKey: `result:${created.run.runRef}:build`, resultHash: 'd'.repeat(64), resultCardRef: cardedSubject.canonicalCardRef, baseCommit: 'b'.repeat(40), canonicalCommit: 'a'.repeat(40),
  };
  const generation = store.recordStageGeneration('alice', currentStage.stageRef, input);
  if (!generation.ok) throw new Error(generation.detail);
  return { created, subject: currentStage, attempt: succeeded.value, generation: generation.value, input };
}

function checkerPassOutcome() {
  return JSON.stringify({
    schema: 'kb.review-outcome/v1', decision: 'pass', summary: 'All criteria passed.',
    criteria: [{ criterionId: 'grounded', verdict: 'pass', findingIds: [] }], findings: [],
  });
}

function checkerFailOutcome() {
  return JSON.stringify({
    schema: 'kb.review-outcome/v1', decision: 'fail', summary: 'Grounding failed.',
    criteria: [{ criterionId: 'grounded', verdict: 'fail', findingIds: ['missing-source'] }],
    findings: [{ id: 'missing-source', criterionId: 'grounded', severity: 'blocking', summary: 'Source is missing.', evidencePaths: [] }],
  });
}

function checkerParkedOutcome() {
  return JSON.stringify({
    schema: 'kb.review-outcome/v1', decision: 'parked', summary: 'Human intervention is required.',
    criteria: [{ criterionId: 'grounded', verdict: 'unverified', findingIds: ['needs-human'] }],
    findings: [{ id: 'needs-human', criterionId: 'grounded', severity: 'blocking', summary: 'Needs a human decision.', evidencePaths: [] }],
  });
}

function prepareCheckerReview(
  store: ControlPlaneStore,
  committed: ReturnType<typeof commitCheckerSubject>,
  checkerSessionTerminalState?: 'completed' | 'failed' | 'stopped',
  outcome = checkerFailOutcome(),
) {
  const before = store.getRun('alice', committed.created.run.runRef);
  if (!before.ok) throw new Error(before.detail);
  const review = before.value.stages.find((stage) => stage.stageId === 'check');
  const initialSubject = before.value.stages.find((stage) => stage.stageId === 'build');
  if (!review || !initialSubject) throw new Error('review graph missing');
  if (initialSubject.state !== 'succeeded') {
    const subjectRunning = store.transitionStage('alice', initialSubject.stageRef, initialSubject.version, 'running');
    if (!subjectRunning.ok) throw new Error(subjectRunning.detail);
    const subjectSucceeded = store.transitionStage('alice', initialSubject.stageRef, subjectRunning.value.version, 'succeeded');
    if (!subjectSucceeded.ok) throw new Error(subjectSucceeded.detail);
  }
  const checkerAttempt = store.createAttempt('alice', review.stageRef, {
    expectedStageVersion: review.version, runtime: VERIFY_ASSIGNMENT.runtime, model: VERIFY_ASSIGNMENT.model,
    reviewSubjectGenerationRef: committed.generation.generationRef,
    reviewSubjectResultHash: committed.generation.resultHash as string,
    reviewSubjectCanonicalCommit: committed.generation.canonicalCommit as string,
  });
  if (!checkerAttempt.ok) throw new Error(checkerAttempt.detail);
  let checkerAttemptVersion = checkerAttempt.value.version;
  if (checkerSessionTerminalState) {
    const session = store.createWorkerSession('alice', checkerAttempt.value.attemptRef, { expectedAttemptVersion: checkerAttemptVersion });
    if (!session.ok) throw new Error(session.detail);
    checkerAttemptVersion += 1;
    if (checkerSessionTerminalState === 'completed') completeWorkerSession(store, session.value.sessionRef, session.value.version);
    else {
      const terminal = store.transitionSession('alice', session.value.sessionRef, session.value.version, checkerSessionTerminalState);
      if (!terminal.ok) throw new Error(terminal.detail);
    }
  }
  const starting = store.transitionAttempt('alice', checkerAttempt.value.attemptRef, checkerAttemptVersion, 'starting');
  if (!starting.ok) throw new Error(starting.detail);
  const running = store.transitionAttempt('alice', starting.value.attemptRef, starting.value.version, 'running');
  if (!running.ok) throw new Error(running.detail);
  const succeeded = store.transitionAttempt('alice', running.value.attemptRef, running.value.version, 'succeeded');
  if (!succeeded.ok) throw new Error(succeeded.detail);
  const reviewReady = store.transitionStage('alice', review.stageRef, review.version + 1, 'ready');
  if (!reviewReady.ok) throw new Error(reviewReady.detail);
  const reviewRunning = store.transitionStage('alice', review.stageRef, reviewReady.value.version, 'running');
  if (!reviewRunning.ok) throw new Error(reviewRunning.detail);
  const reviewSucceeded = store.transitionStage('alice', review.stageRef, reviewRunning.value.version, 'succeeded');
  if (!reviewSucceeded.ok) throw new Error(reviewSucceeded.detail);
  const beforeReceipt = store.getRun('alice', committed.created.run.runRef);
  if (!beforeReceipt.ok) throw new Error(beforeReceipt.detail);
  const receiptReview = beforeReceipt.value.stages.find((stage) => stage.stageId === 'check');
  const receiptLoop = beforeReceipt.value.reviewLoops[0];
  if (!receiptReview || !receiptLoop) throw new Error('receipt review graph missing');
  return {
    reviewStageRef: review.stageRef,
    checkerAttempt: succeeded.value,
    receiptInput: {
    expectedReviewStageVersion: receiptReview.version, expectedCheckerAttemptVersion: succeeded.value.version, expectedLoopVersion: receiptLoop.version,
    subjectGenerationRef: committed.generation.generationRef, subjectResultHash: committed.generation.resultHash as string, checkerAttemptRef: succeeded.value.attemptRef,
    outcome, operationKey: `review-outcome:${committed.created.run.runRef}:check:g${committed.generation.generation}`,
    },
  };
}

function failCheckerReview(
  store: ControlPlaneStore,
  committed: ReturnType<typeof commitCheckerSubject>,
  checkerSessionTerminalState?: 'completed' | 'failed' | 'stopped',
  outcome = checkerFailOutcome(),
) {
  const prepared = prepareCheckerReview(store, committed, checkerSessionTerminalState, outcome);
  const receipt = store.recordReviewReceipt('alice', prepared.reviewStageRef, prepared.receiptInput);
  if (!receipt.ok) throw new Error(receipt.detail);
  const current = store.getRun('alice', committed.created.run.runRef);
  if (!current.ok) throw new Error(current.detail);
  const subject = current.value.stages.find((stage) => stage.stageId === 'build');
  const currentReview = current.value.stages.find((stage) => stage.stageId === 'check');
  const loop = current.value.reviewLoops[0];
  if (!subject || !currentReview || !loop || !subject.currentAttemptRef) throw new Error('failed graph missing');
  return {
    receipt: receipt.value,
    input: {
      expectedSubjectStageVersion: subject.version, expectedReviewStageVersion: currentReview.version, expectedLoopVersion: loop.version,
      expectedSubjectAttemptRef: subject.currentAttemptRef, expectedSubjectAttemptVersion: committed.attempt.version,
      expectedCheckerAttemptRef: prepared.checkerAttempt.attemptRef, expectedCheckerAttemptVersion: prepared.checkerAttempt.version,
      expectedFailedReceiptRef: receipt.value.reviewReceiptRef, expectedGenerationRef: committed.generation.generationRef,
      idempotencyKey: `rework:${committed.created.run.runRef}:build:g2`,
    },
  };
}

function exhaustedReviewInput(
  store: ControlPlaneStore,
  committed: ReturnType<typeof commitCheckerSubject>,
  checkerSessionState?: 'completed' | 'failed' | 'stopped',
) {
  const failed = failCheckerReview(store, committed, checkerSessionState);
  const { receipt } = failed;
  const detail = store.getRun('alice', committed.created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const subjectStage = detail.value.stages.find((stage) => stage.stageId === 'build');
  const reviewStage = detail.value.stages.find((stage) => stage.stageId === 'check');
  const loop = detail.value.reviewLoops[0];
  if (!subjectStage || !reviewStage || !loop) throw new Error('exhausted review graph missing');
  return {
    receipt,
    reworkInput: failed.input,
    input: {
      expectedSubjectStageVersion: subjectStage.version, expectedReviewStageVersion: reviewStage.version,
      expectedLoopVersion: loop.version, expectedReceiptVersion: receipt.version,
      expectedSubjectAttemptRef: subjectStage.currentAttemptRef ?? 'attempt-missing',
      expectedSubjectAttemptVersion: failed.input.expectedSubjectAttemptVersion,
      expectedCheckerAttemptRef: failed.input.expectedCheckerAttemptRef,
      expectedCheckerAttemptVersion: failed.input.expectedCheckerAttemptVersion,
      expectedGenerationRef: committed.generation.generationRef, expectedFailedReceiptRef: receipt.reviewReceiptRef,
      idempotencyKey: `review-exhausted:${committed.created.run.runRef}:check:g1`,
    },
  };
}

function queueCreatorRework(store: ControlPlaneStore, committed: ReturnType<typeof commitCheckerSubject>) {
  const { input } = failCheckerReview(store, committed);
  const queued = store.advanceReviewGeneration('alice', committed.created.run.runRef, input);
  if (!queued.ok) throw new Error(queued.detail);
  return queued.value;
}

function attachCheckerGate(store: ControlPlaneStore) {
  const committed = commitCheckerSubject(store);
  const { receipt } = failCheckerReview(store, committed, undefined, checkerPassOutcome());
  const detail = store.getRun('alice', committed.created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const reviewStage = detail.value.stages.find((stage) => stage.stageId === 'check');
  const subjectStage = detail.value.stages.find((stage) => stage.stageId === 'build');
  const loop = detail.value.reviewLoops[0];
  if (!reviewStage || !subjectStage || !loop) throw new Error('review completion gate graph missing');
  const attachInput = {
    expectedReceiptVersion: receipt.version,
    expectedLoopVersion: loop.version,
    expectedReviewStageVersion: reviewStage.version,
    idempotencyKey: `review-gate:${committed.created.run.runRef}:check:g1`,
  };
  const attached = store.attachReviewCompletionGate('alice', receipt.reviewReceiptRef, attachInput);
  if (!attached.ok) throw new Error(attached.detail);
  return { committed, receipt, attachInput, attached: attached.value };
}

function reviewGateResolutionInput(
  attached: ReturnType<typeof attachCheckerGate>['attached'],
  decision: 'approved' | 'rejected' | 'changes-requested',
) {
  return {
    expectedRequestRevision: attached.request.revision,
    expectedReceiptVersion: attached.receipt.version,
    expectedLoopVersion: attached.loop.version,
    expectedReviewStageVersion: attached.reviewStage.version,
    expectedSubjectStageVersion: attached.subjectStage.version,
    decision,
    idempotencyKey: `resolve-${decision}`,
    response: `human chose ${decision}`,
  };
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
  reviewLoops: PersistedRow[];
  reviewReceipts: PersistedRow[];
  generationSupersessions: PersistedRow[];
}
interface PersistedReviewDocument extends PersistedReviewBundle {
  runs: PersistedRow[];
  quarantine: Array<PersistedReviewBundle & { quarantinedAt: string }>;
}

function persistedReviewBundle(document: PersistedReviewDocument, location: 'active' | 'quarantine'): PersistedReviewBundle {
  if (location === 'active') return document;
  const bundle = {
    subject: String(document.runs[0]?.subject),
    quarantinedAt: '2026-07-18T12:00:00.000Z',
    run: structuredClone(document.runs[0] as PersistedRow),
    stages: structuredClone(document.stages), attempts: structuredClone(document.attempts),
    sessions: structuredClone(document.sessions), humanRequests: structuredClone(document.humanRequests),
    events: structuredClone(document.events), stageGenerations: structuredClone(document.stageGenerations),
    reviewLoops: structuredClone(document.reviewLoops), reviewReceipts: structuredClone(document.reviewReceipts),
    generationSupersessions: structuredClone(document.generationSupersessions),
  };
  document.quarantine.push(bundle);
  return bundle;
}

function requiredPersistedRow(rows: PersistedRow[], label: string): PersistedRow {
  const row = rows[0];
  if (!row) throw new Error(`persisted ${label} missing`);
  return row;
}

function fillHumanRequestCap(store: ControlPlaneStore, runRef: string) {
  const filled = store.createHumanRequests('alice', runRef, {
    idempotencyKey: 'fill-human-request-cap',
    requests: Array.from({ length: MAX_HUMAN_REQUESTS_PER_RUN }, (_, index) => ({
      kind: 'input' as const, title: `Input ${index}`, prompt: 'Supply a bounded input.',
    })),
  });
  if (!filled.ok) throw new Error(filled.detail);
}

function succeedQueuedCreatorAttempt(store: ControlPlaneStore, runRef: string) {
  const detail = store.getRun('alice', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  const subject = detail.value.stages.find((stage) => stage.stageId === 'build');
  if (!subject?.currentAttemptRef) throw new Error('queued creator attempt missing');
  const attempt = detail.value.attempts.find((item) => item.attemptRef === subject.currentAttemptRef);
  if (!attempt) throw new Error('queued creator attempt disappeared');
  const starting = store.transitionAttempt('alice', attempt.attemptRef, attempt.version, 'starting');
  if (!starting.ok) throw new Error(starting.detail);
  const running = store.transitionAttempt('alice', attempt.attemptRef, starting.value.version, 'running');
  if (!running.ok) throw new Error(running.detail);
  const succeeded = store.transitionAttempt('alice', attempt.attemptRef, running.value.version, 'succeeded');
  if (!succeeded.ok) throw new Error(succeeded.detail);
  const current = store.getRun('alice', runRef);
  if (!current.ok) throw new Error(current.detail);
  const currentSubject = current.value.stages.find((stage) => stage.stageId === 'build');
  if (!currentSubject) throw new Error('creator stage disappeared');
  return { attempt: succeeded.value, stage: currentSubject };
}

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

  it('appends committed subject lineage and a replay-safe parsed checker receipt', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store);
    expect(store.recordStageGeneration('alice', committed.subject.stageRef, committed.input)).toMatchObject({ ok: true, replayed: true });
    const afterGeneration = store.getRun('alice', committed.created.run.runRef);
    if (!afterGeneration.ok) throw new Error(afterGeneration.detail);
    expect(afterGeneration.value).toMatchObject({
      stageGenerations: [expect.objectContaining({ generationRef: committed.generation.generationRef, resultHash: 'd'.repeat(64), canonicalCommit: 'a'.repeat(40) })],
      reviewLoops: [expect.objectContaining({ state: 'checking', activeGenerationRef: committed.generation.generationRef })],
    });
    const checker = afterGeneration.value.stages.find((stage) => stage.stageId === 'check');
    if (!checker) throw new Error('checker stage missing');
    const checkerAttempt = store.createAttempt('alice', checker.stageRef, {
      expectedStageVersion: checker.version, runtime: VERIFY_ASSIGNMENT.runtime, model: VERIFY_ASSIGNMENT.model,
      reviewSubjectGenerationRef: committed.generation.generationRef, reviewSubjectResultHash: 'd'.repeat(64), reviewSubjectCanonicalCommit: 'a'.repeat(40),
    });
    if (!checkerAttempt.ok) throw new Error(checkerAttempt.detail);
    const starting = store.transitionAttempt('alice', checkerAttempt.value.attemptRef, checkerAttempt.value.version, 'starting');
    if (!starting.ok) throw new Error(starting.detail);
    const running = store.transitionAttempt('alice', starting.value.attemptRef, starting.value.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const succeeded = store.transitionAttempt('alice', running.value.attemptRef, running.value.version, 'succeeded');
    if (!succeeded.ok) throw new Error(succeeded.detail);
    const beforeReceipt = store.getRun('alice', committed.created.run.runRef);
    if (!beforeReceipt.ok) throw new Error(beforeReceipt.detail);
    const review = beforeReceipt.value.stages.find((stage) => stage.stageId === 'check');
    const loop = beforeReceipt.value.reviewLoops[0];
    if (!review || !loop) throw new Error('review loop missing');
    const receiptInput = {
      expectedReviewStageVersion: review.version, expectedCheckerAttemptVersion: succeeded.value.version, expectedLoopVersion: loop.version,
      subjectGenerationRef: committed.generation.generationRef, subjectResultHash: 'd'.repeat(64), checkerAttemptRef: succeeded.value.attemptRef,
      outcome: checkerPassOutcome(), operationKey: `review-outcome:${committed.created.run.runRef}:check:g1`,
    };
    const receipt = store.recordReviewReceipt('alice', review.stageRef, receiptInput);
    expect(receipt).toMatchObject({ ok: true, value: { state: 'awaiting-completion-gate', subjectGenerationRef: committed.generation.generationRef, finalizedAt: null } });
    expect(store.recordReviewReceipt('alice', review.stageRef, receiptInput)).toMatchObject({ ok: true, replayed: true });
    const accepted = store.getRun('alice', committed.created.run.runRef);
    if (!accepted.ok) throw new Error(accepted.detail);
    expect(accepted.value).toMatchObject({
      reviewLoops: [expect.objectContaining({ state: 'awaiting-gate', acceptedGenerationRef: null })],
      reviewReceipts: [expect.objectContaining({ state: 'awaiting-completion-gate', subjectResultHash: 'd'.repeat(64) })],
    });
    expect(accepted.value.stages.find((stage) => stage.stageId === 'build')).toMatchObject({ acceptedGenerationRef: null });
  });

  it('fails closed for stale or mismatched generation and receipt lineage', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store);
    expect(store.recordStageGeneration('alice', committed.subject.stageRef, { ...committed.input, operationKey: 'result-other', resultHash: 'e'.repeat(64) }))
      .toMatchObject({ ok: false, reason: 'invalid' });
    const detail = store.getRun('alice', committed.created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const review = detail.value.stages.find((stage) => stage.stageId === 'check');
    const loop = detail.value.reviewLoops[0];
    if (!review || !loop) throw new Error('review loop missing');
    expect(store.recordReviewReceipt('alice', review.stageRef, {
      expectedReviewStageVersion: review.version, expectedCheckerAttemptVersion: 1, expectedLoopVersion: loop.version,
      subjectGenerationRef: committed.generation.generationRef, subjectResultHash: 'e'.repeat(64), checkerAttemptRef: 'attempt-missing',
      outcome: checkerPassOutcome(), operationKey: 'review-mismatch',
    })).toMatchObject({ ok: false, reason: 'conflict' });
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

  it('atomically appends a bounded queued creator successor after a failed checker receipt', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store);
    const { input } = failCheckerReview(store, committed);
    expect(store.advanceReviewGeneration('alice', committed.created.run.runRef, {
      ...input, expectedLoopVersion: input.expectedLoopVersion - 1,
    } as never)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.getRun('alice', committed.created.run.runRef)).toMatchObject({
      ok: true, value: { stageGenerations: [expect.anything()], generationSupersessions: [] },
    });
    const advanced = store.advanceReviewGeneration('alice', committed.created.run.runRef, input as never);
    expect(advanced).toMatchObject({ ok: true, value: { generation: 2, state: 'queued', resultHash: null, baseCommit: null, canonicalCommit: null } });
    expect(store.advanceReviewGeneration('alice', committed.created.run.runRef, input as never)).toMatchObject({ ok: true, replayed: true });
    expect(store.advanceReviewGeneration('alice', committed.created.run.runRef, {
      ...input, expectedSubjectAttemptVersion: input.expectedSubjectAttemptVersion + 1,
    } as never)).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    const after = store.getRun('alice', committed.created.run.runRef);
    expect(after).toMatchObject({ ok: true, value: {
      generationSupersessions: [expect.objectContaining({ predecessorGenerationRef: committed.generation.generationRef })],
      reviewLoops: [expect.objectContaining({ state: 'rework-queued', reworksUsed: 1, activeReceiptRef: null })],
    } });
  });

  it('does not mutate failed review state when the creator rework bound is exhausted', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store, createCheckerRun(store, 'alice', 0));
    const { input } = failCheckerReview(store, committed);
    const before = store.getRun('alice', committed.created.run.runRef);
    expect(store.advanceReviewGeneration('alice', committed.created.run.runRef, input)).toMatchObject({
      ok: false, reason: 'ineligible', detail: expect.stringContaining('bound is exhausted'),
    });
    expect(store.getRun('alice', committed.created.run.runRef)).toEqual(before);
  });

  it('parks an exhausted failed review with one server-derived intervention and exact replay', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store, createCheckerRun(store, 'alice', 0));
    const { input, reworkInput } = exhaustedReviewInput(store, committed);
    expect(store.advanceReviewGeneration('alice', committed.created.run.runRef, reworkInput)).toMatchObject({
      ok: false, reason: 'ineligible', detail: expect.stringContaining('bound is exhausted'),
    });
    expect(store.getRun('alice', committed.created.run.runRef)).toMatchObject({
      ok: true, value: { humanRequests: [], reviewLoops: [expect.objectContaining({ state: 'failed' })] },
    });
    const parked = store.parkExhaustedReview('alice', committed.created.run.runRef, input);
    expect(parked).toMatchObject({
      ok: true,
      value: {
        receipt: { state: 'failed', interventionRequestRef: expect.any(String), version: input.expectedReceiptVersion + 1 },
        loop: { state: 'parked', interventionRequestRef: expect.any(String), version: input.expectedLoopVersion + 1 },
        interventionRequest: {
          kind: 'intervention', state: 'open', stageRef: expect.any(String), response: null,
          title: 'Review intervention: Check', prompt: 'Creator rework bound exhausted: Grounding failed.',
        },
      },
    });
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, input)).toMatchObject({ ok: true, replayed: true });
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, {
      ...input, expectedReceiptVersion: input.expectedReceiptVersion + 1,
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, {
      ...input, expectedGenerationRef: 'generation-wrong',
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, {
      ...input, expectedSubjectAttemptRef: 'attempt-wrong',
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, {
      ...input, expectedCheckerAttemptVersion: input.expectedCheckerAttemptVersion + 1,
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    const detail = store.getRun('alice', committed.created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.humanRequests.filter((request) => request.kind === 'intervention')).toHaveLength(1);
  });

  it('requires exact exhausted-review lineage, versions, and bound eligibility', () => {
    const below = createInMemoryControlPlaneStore(deterministicOptions());
    const belowCommitted = commitCheckerSubject(below, createCheckerRun(below, 'alice', 1));
    const belowExhausted = exhaustedReviewInput(below, belowCommitted);
    expect(below.parkExhaustedReview('alice', belowCommitted.created.run.runRef, belowExhausted.input)).toMatchObject({
      ok: false, reason: 'ineligible', detail: expect.stringContaining('not exhausted'),
    });
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store, createCheckerRun(store, 'alice', 0));
    const { input } = exhaustedReviewInput(store, committed);
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, {
      ...input, expectedSubjectStageVersion: input.expectedSubjectStageVersion + 1,
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, {
      ...input, expectedGenerationRef: 'generation-wrong',
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it.each(['failed', 'stopped'] as const)('rejects exhausted parking when the checker worker session is %s', (state) => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store, createCheckerRun(store, 'alice', 0));
    const { input } = exhaustedReviewInput(store, committed, state);
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, input)).toMatchObject({
      ok: false, reason: 'conflict', detail: expect.stringContaining('lineage'),
    });
  });

  it('does not mutate an exhausted review when the Human Request cap is reached or its operation is reserved', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store, createCheckerRun(store, 'alice', 0));
    const { input } = exhaustedReviewInput(store, committed);
    fillHumanRequestCap(store, committed.created.run.runRef);
    const before = store.getRun('alice', committed.created.run.runRef);
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, input)).toMatchObject({ ok: false, reason: 'limit' });
    expect(store.getRun('alice', committed.created.run.runRef)).toEqual(before);
    expect(store.createHumanRequests('alice', committed.created.run.runRef, {
      idempotencyKey: input.idempotencyKey, requests: [{ kind: 'intervention', title: 'No', prompt: 'No.' }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('leaves a capped exhausted-review file byte-identical', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(store, createCheckerRun(store, 'alice', 0));
    const { input } = exhaustedReviewInput(store, committed);
    fillHumanRequestCap(store, committed.created.run.runRef);
    const path = join(root, 'control', 'control-plane.json');
    const before = readFileSync(path, 'utf8');
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, input)).toMatchObject({ ok: false, reason: 'limit' });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('parks when exactly one Human Request slot remains', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store, createCheckerRun(store, 'alice', 0));
    const { input } = exhaustedReviewInput(store, committed);
    const filled = store.createHumanRequests('alice', committed.created.run.runRef, {
      idempotencyKey: 'fill-human-request-cap-minus-one',
      requests: Array.from({ length: MAX_HUMAN_REQUESTS_PER_RUN - 1 }, (_, index) => ({
        kind: 'input' as const, title: `Input ${index}`, prompt: 'Supply a bounded input.',
      })),
    });
    if (!filled.ok) throw new Error(filled.detail);
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, input)).toMatchObject({ ok: true });
  });

  it('parks the exhausted second generation exactly once and survives replay and restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(store, createCheckerRun(store, 'alice', 1));
    const firstFailure = failCheckerReview(store, committed);
    const advanced = store.advanceReviewGeneration('alice', committed.created.run.runRef, firstFailure.input);
    if (!advanced.ok) throw new Error(advanced.detail);
    const successor = succeedQueuedCreatorAttempt(store, committed.created.run.runRef);
    const secondGeneration = store.recordStageGeneration('alice', successor.stage.stageRef, {
      expectedStageVersion: successor.stage.version, expectedAttemptVersion: successor.attempt.version, expectedGeneration: 2,
      operationKey: `result:${committed.created.run.runRef}:build:g2`, resultHash: 'e'.repeat(64), resultCardRef: null,
      baseCommit: committed.generation.canonicalCommit as string, canonicalCommit: 'c'.repeat(40),
    });
    if (!secondGeneration.ok) throw new Error(secondGeneration.detail);
    const second = { ...committed, attempt: successor.attempt, generation: secondGeneration.value };
    const secondFailure = failCheckerReview(store, second);
    const current = store.getRun('alice', committed.created.run.runRef);
    if (!current.ok) throw new Error(current.detail);
    const subjectStage = current.value.stages.find((stage) => stage.stageId === 'build');
    const reviewStage = current.value.stages.find((stage) => stage.stageId === 'check');
    const loop = current.value.reviewLoops[0];
    if (!subjectStage || !reviewStage || !loop) throw new Error('second failed review graph missing');
    const input = {
      expectedSubjectStageVersion: subjectStage.version, expectedReviewStageVersion: reviewStage.version,
      expectedLoopVersion: loop.version, expectedReceiptVersion: secondFailure.receipt.version,
      expectedSubjectAttemptRef: secondFailure.input.expectedSubjectAttemptRef,
      expectedSubjectAttemptVersion: secondFailure.input.expectedSubjectAttemptVersion,
      expectedCheckerAttemptRef: secondFailure.input.expectedCheckerAttemptRef,
      expectedCheckerAttemptVersion: secondFailure.input.expectedCheckerAttemptVersion,
      expectedGenerationRef: secondGeneration.value.generationRef, expectedFailedReceiptRef: secondFailure.receipt.reviewReceiptRef,
      idempotencyKey: `review-exhausted:${committed.created.run.runRef}:check:g2`,
    };
    expect(store.advanceReviewGeneration('alice', committed.created.run.runRef, {
      ...secondFailure.input, idempotencyKey: `rework:${committed.created.run.runRef}:build:g3`,
    })).toMatchObject({
      ok: false, reason: 'ineligible', detail: expect.stringContaining('bound is exhausted'),
    });
    const parked = store.parkExhaustedReview('alice', committed.created.run.runRef, input);
    expect(parked).toMatchObject({ ok: true, value: { receipt: { state: 'failed' }, loop: { state: 'parked' } } });
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, input)).toMatchObject({ ok: true, replayed: true });
    expect(store.parkExhaustedReview('alice', committed.created.run.runRef, {
      ...input, expectedSubjectAttemptVersion: input.expectedSubjectAttemptVersion + 1,
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.parkExhaustedReview('alice', committed.created.run.runRef, input)).toMatchObject({ ok: true, replayed: true });
    const detail = restarted.getRun('alice', committed.created.run.runRef);
    expect(detail).toMatchObject({ ok: true, value: {
      stageGenerations: [expect.anything(), expect.anything()],
      reviewLoops: [expect.objectContaining({ reworksUsed: 1, state: 'parked' })],
    } });
  });

  it('attaches and resolves a review completion gate atomically, blocking generic request mutation', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store);
    const { receipt } = failCheckerReview(store, committed, undefined, checkerPassOutcome());
    const before = store.getRun('alice', committed.created.run.runRef);
    if (!before.ok) throw new Error(before.detail);
    const review = before.value.stages.find((stage) => stage.stageId === 'check');
    const subject = before.value.stages.find((stage) => stage.stageId === 'build');
    const loop = before.value.reviewLoops[0];
    if (!review || !subject || !loop) throw new Error('gate graph missing');
    const key = `review-gate:${committed.created.run.runRef}:check:g1`;
    const attached = store.attachReviewCompletionGate('alice', receipt.reviewReceiptRef, {
      expectedReceiptVersion: receipt.version, expectedLoopVersion: loop.version, expectedReviewStageVersion: review.version, idempotencyKey: key,
    });
    expect(attached).toMatchObject({ ok: true, value: { request: { kind: 'approval', stageRef: review.stageRef }, receipt: { completionRequestRef: expect.any(String) } } });
    if (!attached.ok) throw new Error(attached.detail);
    expect(store.attachReviewCompletionGate('alice', receipt.reviewReceiptRef, {
      expectedReceiptVersion: receipt.version, expectedLoopVersion: loop.version, expectedReviewStageVersion: review.version, idempotencyKey: key,
    })).toMatchObject({ ok: true, replayed: true });
    expect(store.reviseHumanRequest('alice', attached.value.request.requestRef, attached.value.request.revision, 'no', 'no')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.respondHumanRequest('alice', attached.value.request.requestRef, {
      expectedRevision: attached.value.request.revision, decision: 'approved', idempotencyKey: 'generic-blocked', response: null,
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const resolved = store.resolveReviewCompletionGate('alice', attached.value.request.requestRef, {
      expectedRequestRevision: attached.value.request.revision, expectedReceiptVersion: attached.value.receipt.version,
      expectedLoopVersion: attached.value.loop.version, expectedReviewStageVersion: attached.value.reviewStage.version,
      expectedSubjectStageVersion: attached.value.subjectStage.version, decision: 'approved', idempotencyKey: 'review-gate-approved',
    });
    expect(resolved).toMatchObject({ ok: true, value: { receipt: { state: 'passed' }, loop: { state: 'passed' }, subjectStage: { acceptedGenerationRef: committed.generation.generationRef } } });
  });

  it('creates exactly one linked intervention for a parser-parked review outcome', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store);
    const prepared = prepareCheckerReview(store, committed, undefined, checkerParkedOutcome());
    const receipt = store.recordReviewReceipt('alice', prepared.reviewStageRef, prepared.receiptInput);
    if (!receipt.ok) throw new Error(receipt.detail);
    expect(store.recordReviewReceipt('alice', prepared.reviewStageRef, prepared.receiptInput)).toMatchObject({ ok: true, replayed: true });
    const detail = store.getRun('alice', committed.created.run.runRef);
    expect(detail).toMatchObject({ ok: true, value: {
      reviewReceipts: [expect.objectContaining({ reviewReceiptRef: receipt.value.reviewReceiptRef, state: 'parked', completionRequestRef: null, interventionRequestRef: expect.any(String) })],
      reviewLoops: [expect.objectContaining({ state: 'parked', interventionRequestRef: expect.any(String) })],
      humanRequests: [expect.objectContaining({ kind: 'intervention', state: 'open', response: null })],
    } });
  });

  it('fails attach at the Human Request cap without mutating the run graph', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store);
    const { receipt } = failCheckerReview(store, committed, undefined, checkerPassOutcome());
    fillHumanRequestCap(store, committed.created.run.runRef);
    const before = store.getRun('alice', committed.created.run.runRef);
    if (!before.ok) throw new Error(before.detail);
    const reviewStage = before.value.stages.find((stage) => stage.stageId === 'check');
    const loop = before.value.reviewLoops[0];
    if (!reviewStage || !loop) throw new Error('gate graph missing');
    expect(store.attachReviewCompletionGate('alice', receipt.reviewReceiptRef, {
      expectedReceiptVersion: receipt.version, expectedLoopVersion: loop.version,
      expectedReviewStageVersion: reviewStage.version,
      idempotencyKey: `review-gate:${committed.created.run.runRef}:check:g1`,
    })).toMatchObject({ ok: false, reason: 'limit' });
    expect(store.getRun('alice', committed.created.run.runRef)).toEqual(before);
  });

  it('fails parser parking and negative gate resolution at the Human Request cap without partial mutation', () => {
    {
      const store = createInMemoryControlPlaneStore(deterministicOptions());
      const committed = commitCheckerSubject(store);
      const prepared = prepareCheckerReview(store, committed, undefined, checkerParkedOutcome());
      fillHumanRequestCap(store, committed.created.run.runRef);
      const before = store.getRun('alice', committed.created.run.runRef);
      expect(store.recordReviewReceipt('alice', prepared.reviewStageRef, prepared.receiptInput)).toMatchObject({ ok: false, reason: 'limit' });
      expect(store.getRun('alice', committed.created.run.runRef)).toEqual(before);
    }
    {
      const store = createInMemoryControlPlaneStore(deterministicOptions());
      const gate = attachCheckerGate(store);
      const remaining = MAX_HUMAN_REQUESTS_PER_RUN - 1;
      const filled = store.createHumanRequests('alice', gate.committed.created.run.runRef, {
        idempotencyKey: 'fill-negative-resolution-cap',
        requests: Array.from({ length: remaining }, (_, index) => ({
          kind: 'input' as const, title: `Input ${index}`, prompt: 'Supply a bounded input.',
        })),
      });
      if (!filled.ok) throw new Error(filled.detail);
      const before = store.getRun('alice', gate.committed.created.run.runRef);
      expect(store.resolveReviewCompletionGate(
        'alice', gate.attached.request.requestRef, reviewGateResolutionInput(gate.attached, 'rejected'),
      )).toMatchObject({ ok: false, reason: 'limit' });
      expect(store.getRun('alice', gate.committed.created.run.runRef)).toEqual(before);
    }
  });

  it('replays an exact gate resolution and rejects every mutated CAS field as an idempotency conflict', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const gate = attachCheckerGate(store);
    const input = reviewGateResolutionInput(gate.attached, 'approved');
    expect(store.resolveReviewCompletionGate('alice', gate.attached.request.requestRef, input)).toMatchObject({ ok: true });
    expect(store.resolveReviewCompletionGate('alice', gate.attached.request.requestRef, input)).toMatchObject({ ok: true, replayed: true });
    for (const field of [
      'expectedRequestRevision', 'expectedReceiptVersion', 'expectedLoopVersion',
      'expectedReviewStageVersion', 'expectedSubjectStageVersion',
    ] as const) {
      expect(store.resolveReviewCompletionGate('alice', gate.attached.request.requestRef, {
        ...input, [field]: input[field] + 1,
      })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
    }
  });

  it.each(['rejected', 'changes-requested'] as const)('resolves %s with exactly one linked intervention and exact replay', (decision) => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const gate = attachCheckerGate(store);
    const input = reviewGateResolutionInput(gate.attached, decision);
    const resolved = store.resolveReviewCompletionGate('alice', gate.attached.request.requestRef, input);
    expect(resolved).toMatchObject({
      ok: true,
      value: {
        receipt: { state: 'parked', completionRequestRef: gate.attached.request.requestRef, interventionRequestRef: expect.any(String) },
        loop: { state: 'parked', interventionRequestRef: expect.any(String) },
        request: { state: 'resolved', response: { decision } },
        interventionRequest: { kind: 'intervention', state: 'open', response: null },
      },
    });
    expect(store.resolveReviewCompletionGate('alice', gate.attached.request.requestRef, input)).toMatchObject({ ok: true, replayed: true });
    const detail = store.getRun('alice', gate.committed.created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const interventions = detail.value.humanRequests.filter((request) => request.kind === 'intervention');
    expect(interventions).toHaveLength(1);
    expect(detail.value.reviewReceipts[0].interventionRequestRef).toBe(interventions[0]?.requestRef);
    expect(detail.value.reviewLoops[0].interventionRequestRef).toBe(interventions[0]?.requestRef);
  });

  it('rejects review rework when the bound checker worker session is failed or stopped', () => {
    for (const state of ['failed', 'stopped'] as const) {
      const store = createInMemoryControlPlaneStore(deterministicOptions());
      const committed = commitCheckerSubject(store);
      const { input } = failCheckerReview(store, committed, state);
      expect(store.advanceReviewGeneration('alice', committed.created.run.runRef, input)).toMatchObject({
        ok: false, reason: 'conflict', detail: expect.stringContaining('not completed'),
      });
    }
  });

  it('does not permit a loop-managed creator stage to succeed while its active generation is queued', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store);
    queueCreatorRework(store, committed);
    const detail = store.getRun('alice', committed.created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const subject = detail.value.stages.find((stage) => stage.stageId === 'build');
    if (!subject) throw new Error('creator stage missing');
    const running = store.transitionStage('alice', subject.stageRef, subject.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    expect(store.transitionStage('alice', subject.stageRef, running.value.version, 'succeeded')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('review lineage'),
    });
    expect(store.rerouteStage('alice', subject.stageRef, {
      expectedStageVersion: running.value.version, expectedAttemptRef: subject.currentAttemptRef ?? 'attempt-missing', expectedAttemptVersion: 1,
      runtime: 'claude', model: 'claude-sonnet-5', idempotencyKey: 'reject-loop-creator-reroute',
    })).toMatchObject({ ok: false, reason: 'invalid', detail: expect.stringContaining('loop-managed creator') });
  });

  it('does not permit a checker stage to succeed before its bound checker attempt succeeds', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const committed = commitCheckerSubject(store);
    const detail = store.getRun('alice', committed.created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const subject = detail.value.stages.find((stage) => stage.stageId === 'build');
    const review = detail.value.stages.find((stage) => stage.stageId === 'check');
    if (!subject || !review) throw new Error('checker graph missing');
    const subjectRunning = store.transitionStage('alice', subject.stageRef, subject.version, 'running');
    if (!subjectRunning.ok) throw new Error(subjectRunning.detail);
    const subjectSucceeded = store.transitionStage('alice', subject.stageRef, subjectRunning.value.version, 'succeeded');
    if (!subjectSucceeded.ok) throw new Error(subjectSucceeded.detail);
    const reviewReady = store.transitionStage('alice', review.stageRef, review.version, 'ready');
    if (!reviewReady.ok) throw new Error(reviewReady.detail);
    const reviewRunning = store.transitionStage('alice', review.stageRef, reviewReady.value.version, 'running');
    if (!reviewRunning.ok) throw new Error(reviewRunning.detail);
    expect(store.transitionStage('alice', review.stageRef, reviewRunning.value.version, 'succeeded')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('review lineage'),
    });
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
    expect(successor.ok && successor.value.run).toMatchObject({ predecessorRunRef: first.run.runRef, state: 'planned' });
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

    expect(successor).toMatchObject({ ok: true, value: { run: { predecessorRunRef: created.run.runRef, state: 'planned' } } });
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
    expect(created.run).toMatchObject({ state: 'planned', managerGeneration: 1, proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
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
      value: { run: { state: 'stopping' }, event: { kind: 'lifecycle', source: 'human', status: 'waiting' } },
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
        run: { state: 'succeeded', publicationState: 'published' },
        stages: [{ state: 'succeeded' }, { state: 'succeeded' }],
        attempts: [{ state: 'succeeded' }, { state: 'succeeded' }],
      },
    });
    if (!reconciled.ok) throw new Error(reconciled.detail);
    expect(reconciled.value.sessions.every((session) => session.state === 'completed' || session.state === 'stopped')).toBe(true);
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
      value: { run: { state: 'recovering', managerGeneration: 2, managerSessionRef: successor.ok ? successor.value.sessionRef : '' } },
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
      value: { phase: 'claimed', run: { state: 'recovering', version: detail.run.version + 1 } },
    });
    expect(store.getRun('alice', detail.run.runRef)).toMatchObject({
      ok: true, value: { run: expect.not.objectContaining({ activationReceipts: expect.anything() }) },
    });
    const reopened = createFileControlPlaneStore(root);
    expect(reopened.getRunActivationReceipt('alice', detail.run.runRef, input)).toMatchObject({
      ok: true,
      replayed: true,
      value: { phase: 'claimed', run: { state: 'waiting-human', version: detail.run.version + 2 } },
    });
    expect(reopened.claimRunActivation('alice', detail.run.runRef, input)).toMatchObject({
      ok: true,
      replayed: true,
      value: { phase: 'claimed', run: { state: 'recovering', version: detail.run.version + 3 } },
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
      ok: true, value: { phase: 'roots-activated', run: { state: 'waiting-human' } },
    });
    expect(reopened.claimRunActivation('alice', detail.run.runRef, input)).toMatchObject({
      ok: true, replayed: true, value: { phase: 'roots-activated', run: { state: 'recovering' } },
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
    expect(visible.value.run.state).toBe('waiting-human');
    const refreshedInput = {
      expectedRunVersion: visible.value.run.version,
      expectedManagerGeneration: visible.value.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${visible.value.run.version}:after-restart`,
    };
    expect(reopened.claimRunActivation('alice', detail.run.runRef, refreshedInput)).toMatchObject({
      ok: true, value: { phase: 'claimed', run: { state: 'recovering' } },
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
      value: { run: { state: 'waiting-human', version: detail.run.version } },
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
    const legacy = JSON.parse(readFileSync(path, 'utf8')) as { runs: Array<Record<string, unknown>> };
    delete legacy.runs[0].agentWorkspaceLaunch;
    writeFileSync(path, `${JSON.stringify(legacy)}\n`, 'utf8');
    expect(createFileControlPlaneStore(root, deterministicOptions()).getRun('alice', created.run.runRef)).toMatchObject({ ok: true, value: { run: { agentWorkspaceLaunch: null } } });
  });

  it('migrates legacy persisted runs and stages without assignment fields to null', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const created = createRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const legacy = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> & { runs: Array<Record<string, unknown>>; stages: Array<Record<string, unknown>> };
    delete legacy.runs[0].managerAssignment;
    for (const stage of legacy.stages) {
      delete stage.assignment;
      delete stage.currentGeneration;
      delete stage.currentGenerationRef;
      delete stage.acceptedGenerationRef;
    }
    delete legacy.stageGenerations;
    delete legacy.reviewLoops;
    delete legacy.reviewReceipts;
    writeFileSync(path, `${JSON.stringify(legacy)}\n`, 'utf8');

    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    const detail = restarted.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.run.managerAssignment).toBeNull();
    expect(detail.value.stages.every((stage) => stage.assignment === null)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      runs: [{ managerAssignment: null }],
      stages: [{ assignment: null, currentGeneration: 1, currentGenerationRef: null, acceptedGenerationRef: null }, { assignment: null, currentGeneration: 1, currentGenerationRef: null, acceptedGenerationRef: null }],
      stageGenerations: [], reviewLoops: [], reviewReceipts: [],
    });
  });

  it('migrates missing checker contract fields in active and quarantined legacy stage rows to null', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    createRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as {
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
    expect(migrated.quarantine[0]).toMatchObject({ stageGenerations: [], reviewLoops: [], reviewReceipts: [] });
  });

  it('fails closed for malformed present checker contracts in active and quarantined persisted rows', () => {
    const check = (location: 'active' | 'quarantine') => {
      const root = mkdtempSync(join(tmpdir(), 'control-store-'));
      roots.push(root);
      const first = createFileControlPlaneStore(root, deterministicOptions());
      createRun(first);
      const path = join(root, 'control', 'control-plane.json');
      const document = JSON.parse(readFileSync(path, 'utf8')) as {
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
      expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane checker contract provenance');
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
        reviewLoops: [expect.objectContaining({ state: 'checking', activeGenerationRef: committed.generation.generationRef })],
      },
    });
  });

  it('preserves an attached unresolved completion gate across restart with exact attach replay', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const gate = attachCheckerGate(first);
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.getRun('alice', gate.committed.created.run.runRef)).toMatchObject({
      ok: true,
      value: {
        reviewReceipts: [expect.objectContaining({ state: 'awaiting-completion-gate', completionRequestRef: gate.attached.request.requestRef })],
        reviewLoops: [expect.objectContaining({ state: 'awaiting-gate' })],
        humanRequests: [expect.objectContaining({ requestRef: gate.attached.request.requestRef, state: 'open', response: null })],
      },
    });
    expect(restarted.attachReviewCompletionGate('alice', gate.receipt.reviewReceiptRef, gate.attachInput)).toMatchObject({ ok: true, replayed: true });
  });

  it('preserves a parser-parked receipt and its one linked intervention across restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    failCheckerReview(first, committed, undefined, checkerParkedOutcome());
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    const detail = restarted.getRun('alice', committed.created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const interventions = detail.value.humanRequests.filter((request) => request.kind === 'intervention');
    expect(interventions).toHaveLength(1);
    expect(detail.value.reviewReceipts[0]).toMatchObject({ state: 'parked', completionRequestRef: null, interventionRequestRef: interventions[0]?.requestRef });
    expect(detail.value.reviewLoops[0]).toMatchObject({ state: 'parked', interventionRequestRef: interventions[0]?.requestRef });
  });

  it('preserves an exhausted failed receipt and its one linked intervention across restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first, createCheckerRun(first, 'alice', 0));
    const exhausted = exhaustedReviewInput(first, committed);
    const parked = first.parkExhaustedReview('alice', committed.created.run.runRef, exhausted.input);
    if (!parked.ok) throw new Error(parked.detail);
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.parkExhaustedReview('alice', committed.created.run.runRef, exhausted.input)).toMatchObject({
      ok: true, replayed: true,
      value: { receipt: { state: 'failed' }, loop: { state: 'parked' }, interventionRequest: { requestRef: parked.value.interventionRequest.requestRef } },
    });
  });

  it.each(['active', 'quarantine'] as const)('fails closed on %s persisted review-request tampering', (location) => {
    const cases: Array<{
      name: string;
      graph: 'attached' | 'resolved' | 'parked' | 'exhausted' | 'exhausted-sessions';
      mutate: (bundle: PersistedReviewBundle) => void;
    }> = [
      { name: 'missing linked request', graph: 'attached', mutate: (bundle) => { bundle.humanRequests = []; } },
      { name: 'missing request ref', graph: 'attached', mutate: (bundle) => { delete requiredPersistedRow(bundle.humanRequests, 'request').requestRef; } },
      { name: 'missing request operation', graph: 'attached', mutate: (bundle) => { delete requiredPersistedRow(bundle.humanRequests, 'request').operationKey; } },
      { name: 'duplicate request ref', graph: 'attached', mutate: (bundle) => { bundle.humanRequests.push(structuredClone(requiredPersistedRow(bundle.humanRequests, 'request'))); } },
      { name: 'duplicate request operation', graph: 'attached', mutate: (bundle) => {
        const duplicate = structuredClone(requiredPersistedRow(bundle.humanRequests, 'request'));
        duplicate.requestRef = 'request-duplicate';
        bundle.humanRequests.push(duplicate);
      } },
      { name: 'wrong request run', graph: 'attached', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'request').runRef = 'run-wrong'; } },
      { name: 'wrong request stage', graph: 'attached', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'request').stageRef = 'stage-wrong'; } },
      { name: 'wrong request kind', graph: 'attached', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'request').kind = 'input'; } },
      { name: 'wrong unresolved state', graph: 'attached', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'request').state = 'resolved'; } },
      { name: 'open request with response', graph: 'attached', mutate: (bundle) => {
        const request = requiredPersistedRow(bundle.humanRequests, 'request');
        request.response = {
          requestRevision: 1, decision: 'approved', respondedBy: request.subject,
          idempotencyKey: 'forged', response: null, respondedAt: request.updatedAt,
        };
      } },
      { name: 'wrong resolved decision', graph: 'resolved', mutate: (bundle) => {
        const response = requiredPersistedRow(bundle.humanRequests, 'request').response as PersistedRow;
        response.decision = 'rejected';
      } },
      { name: 'wrong resolved response revision', graph: 'resolved', mutate: (bundle) => {
        const response = requiredPersistedRow(bundle.humanRequests, 'request').response as PersistedRow;
        response.requestRevision = 2;
      } },
      { name: 'arbitrary attach fingerprint', graph: 'attached', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'request').operationFingerprint = 'f'.repeat(64); } },
      { name: 'arbitrary resolution fingerprint', graph: 'resolved', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'request').resolutionOperationFingerprint = 'f'.repeat(64); } },
      { name: 'mismatched loop intervention', graph: 'parked', mutate: (bundle) => { requiredPersistedRow(bundle.reviewLoops, 'loop').interventionRequestRef = 'request-wrong'; } },
      { name: 'mismatched receipt intervention', graph: 'parked', mutate: (bundle) => { requiredPersistedRow(bundle.reviewReceipts, 'receipt').interventionRequestRef = 'request-wrong'; } },
      { name: 'resolved intervention request', graph: 'parked', mutate: (bundle) => {
        const intervention = requiredPersistedRow(bundle.humanRequests, 'intervention');
        intervention.state = 'resolved';
        intervention.response = {
          requestRevision: 1, decision: 'responded', respondedBy: intervention.subject,
          idempotencyKey: 'forged', response: null, respondedAt: intervention.updatedAt,
        };
      } },
      { name: 'reserved orphan', graph: 'attached', mutate: (bundle) => {
        const orphan = structuredClone(requiredPersistedRow(bundle.humanRequests, 'request'));
        orphan.requestRef = 'request-orphan';
        orphan.operationKey = 'review-gate:run-orphan:check:g1';
        bundle.humanRequests.push(orphan);
      } },
      { name: 'outcome state mismatch', graph: 'parked', mutate: (bundle) => { requiredPersistedRow(bundle.reviewReceipts, 'receipt').state = 'failed'; } },
      { name: 'exhausted request operation', graph: 'exhausted', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'intervention').operationKey = 'review-exhausted:run-wrong:check:g1'; } },
      { name: 'exhausted request fingerprint', graph: 'exhausted', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'intervention').operationFingerprint = 'f'.repeat(64); } },
      { name: 'exhausted request title', graph: 'exhausted', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'intervention').title = 'Caller prose'; } },
      { name: 'exhausted request prompt', graph: 'exhausted', mutate: (bundle) => { requiredPersistedRow(bundle.humanRequests, 'intervention').prompt = 'Caller prose'; } },
      { name: 'exhausted receipt link', graph: 'exhausted', mutate: (bundle) => { requiredPersistedRow(bundle.reviewReceipts, 'receipt').interventionRequestRef = null; } },
      { name: 'exhausted loop state', graph: 'exhausted', mutate: (bundle) => { requiredPersistedRow(bundle.reviewLoops, 'loop').state = 'failed'; } },
      { name: 'exhausted receipt state', graph: 'exhausted', mutate: (bundle) => { requiredPersistedRow(bundle.reviewReceipts, 'receipt').state = 'parked'; } },
      { name: 'exhausted creator attempt state', graph: 'exhausted-sessions', mutate: (bundle) => { requiredPersistedRow(bundle.attempts, 'creator').state = 'failed'; } },
      { name: 'exhausted checker attempt state', graph: 'exhausted-sessions', mutate: (bundle) => {
        const receipt = requiredPersistedRow(bundle.reviewReceipts, 'receipt');
        const attempt = bundle.attempts.find((item) => item.attemptRef === receipt.checkerAttemptRef);
        if (!attempt) throw new Error('checker attempt missing');
        attempt.state = 'failed';
      } },
      { name: 'exhausted checker attempt provenance', graph: 'exhausted-sessions', mutate: (bundle) => {
        const receipt = requiredPersistedRow(bundle.reviewReceipts, 'receipt');
        const attempt = bundle.attempts.find((item) => item.attemptRef === receipt.checkerAttemptRef);
        if (!attempt) throw new Error('checker attempt missing');
        attempt.reviewSubjectGenerationRef = 'generation-wrong';
      } },
      { name: 'exhausted creator generation provenance', graph: 'exhausted-sessions', mutate: (bundle) => { requiredPersistedRow(bundle.stageGenerations, 'generation').attemptRef = 'attempt-wrong'; } },
      { name: 'exhausted creator stage attempt ref', graph: 'exhausted-sessions', mutate: (bundle) => { requiredPersistedRow(bundle.stages, 'subject').currentAttemptRef = 'attempt-wrong'; } },
      { name: 'exhausted checker receipt ref', graph: 'exhausted-sessions', mutate: (bundle) => { requiredPersistedRow(bundle.reviewReceipts, 'receipt').checkerAttemptRef = 'attempt-wrong'; } },
      { name: 'exhausted worker session missing', graph: 'exhausted-sessions', mutate: (bundle) => {
        const session = bundle.sessions.find((item) => item.role === 'worker' && item.stageRef === requiredPersistedRow(bundle.stages, 'subject').stageRef);
        if (!session) throw new Error('creator worker session missing');
        bundle.sessions = bundle.sessions.filter((item) => item.sessionRef !== session.sessionRef);
      } },
      { name: 'exhausted worker session mismatch', graph: 'exhausted-sessions', mutate: (bundle) => {
        const session = bundle.sessions.find((item) => item.role === 'worker' && item.stageRef === requiredPersistedRow(bundle.stages, 'subject').stageRef);
        if (!session) throw new Error('creator worker session missing');
        session.attemptRef = 'attempt-wrong';
      } },
      { name: 'exhausted worker session not completed', graph: 'exhausted-sessions', mutate: (bundle) => {
        const session = bundle.sessions.find((item) => item.role === 'worker' && item.stageRef === requiredPersistedRow(bundle.stages, 'subject').stageRef);
        if (!session) throw new Error('creator worker session missing');
        session.state = 'failed';
      } },
      { name: 'exhausted checker worker session missing', graph: 'exhausted-sessions', mutate: (bundle) => {
        const receipt = requiredPersistedRow(bundle.reviewReceipts, 'receipt');
        const session = bundle.sessions.find((item) => item.role === 'worker' && item.attemptRef === receipt.checkerAttemptRef);
        if (!session) throw new Error('checker worker session missing');
        bundle.sessions = bundle.sessions.filter((item) => item.sessionRef !== session.sessionRef);
      } },
      { name: 'exhausted checker worker session mismatch', graph: 'exhausted-sessions', mutate: (bundle) => {
        const receipt = requiredPersistedRow(bundle.reviewReceipts, 'receipt');
        const session = bundle.sessions.find((item) => item.role === 'worker' && item.attemptRef === receipt.checkerAttemptRef);
        if (!session) throw new Error('checker worker session missing');
        session.attemptRef = 'attempt-wrong';
      } },
      { name: 'exhausted checker worker session not completed', graph: 'exhausted-sessions', mutate: (bundle) => {
        const receipt = requiredPersistedRow(bundle.reviewReceipts, 'receipt');
        const session = bundle.sessions.find((item) => item.role === 'worker' && item.attemptRef === receipt.checkerAttemptRef);
        if (!session) throw new Error('checker worker session missing');
        session.state = 'failed';
      } },
      { name: 'over-cap request count', graph: 'attached', mutate: (bundle) => {
        const linked = requiredPersistedRow(bundle.humanRequests, 'request');
        for (let index = 0; index < MAX_HUMAN_REQUESTS_PER_RUN; index += 1) {
          bundle.humanRequests.push({
            subject: linked.subject, requestRef: `request-cap-${index}`, runRef: linked.runRef, stageRef: null,
            kind: 'input', revision: 1, state: 'open', title: 'Input', prompt: 'Supply input.', response: null,
            createdAt: linked.createdAt, updatedAt: linked.updatedAt, resolutionOperationFingerprint: null,
          });
        }
      } },
    ];
    for (const testCase of cases) {
      const root = mkdtempSync(join(tmpdir(), `control-store-${testCase.name.replaceAll(' ', '-')}-`));
      roots.push(root);
      const first = createFileControlPlaneStore(root, deterministicOptions());
      if (testCase.graph === 'parked') {
        const committed = commitCheckerSubject(first);
        failCheckerReview(first, committed, undefined, checkerParkedOutcome());
      } else if (testCase.graph === 'exhausted') {
        const committed = commitCheckerSubject(first, createCheckerRun(first, 'alice', 0));
        const exhausted = exhaustedReviewInput(first, committed);
        const parked = first.parkExhaustedReview('alice', committed.created.run.runRef, exhausted.input);
        if (!parked.ok) throw new Error(parked.detail);
      } else if (testCase.graph === 'exhausted-sessions') {
        const committed = commitCheckerSubject(first, createCheckerRun(first, 'alice', 0), true);
        const exhausted = exhaustedReviewInput(first, committed, 'completed');
        const parked = first.parkExhaustedReview('alice', committed.created.run.runRef, exhausted.input);
        if (!parked.ok) throw new Error(parked.detail);
      } else {
        const gate = attachCheckerGate(first);
        if (testCase.graph === 'resolved') {
          const resolved = first.resolveReviewCompletionGate(
            'alice', gate.attached.request.requestRef, reviewGateResolutionInput(gate.attached, 'approved'),
          );
          if (!resolved.ok) throw new Error(resolved.detail);
        }
      }
      const path = join(root, 'control', 'control-plane.json');
      const document = JSON.parse(readFileSync(path, 'utf8')) as PersistedReviewDocument;
      const bundle = persistedReviewBundle(document, location);
      testCase.mutate(bundle);
      writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
      expect(() => createFileControlPlaneStore(root, deterministicOptions()), testCase.name).toThrow(/invalid control-plane/);
    }
    // ~40 tampered graphs, each a real file-backed store in a fresh temp root: the default 5s ceiling
    // is under the real cost of this case whenever the whole suite competes for the same disk/CPU.
  }, 30_000);

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

  it('persists queued rework lineage across restart and rejects supersession tampering', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    const { input } = failCheckerReview(first, committed);
    expect(first.advanceReviewGeneration('alice', committed.created.run.runRef, input)).toMatchObject({ ok: true });
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.getRun('alice', committed.created.run.runRef)).toMatchObject({
      ok: true,
      value: {
        stageGenerations: expect.arrayContaining([expect.objectContaining({ generation: 2, state: 'queued', predecessorGenerationRef: committed.generation.generationRef })]),
        reviewLoops: [expect.objectContaining({ state: 'rework-queued', reworksUsed: 1 })],
        generationSupersessions: [expect.objectContaining({ predecessorGenerationRef: committed.generation.generationRef })],
      },
    });
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { generationSupersessions: Array<Record<string, unknown>> };
    document.generationSupersessions[0].successorGenerationRef = committed.generation.generationRef;
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane generation supersession');
  });

  it('fails closed on queued rework stage-pointer, review-projection, and terminal-subject tampering', () => {
    for (const tamper of ['creator-pointer', 'review-projection', 'subject-terminal'] as const) {
      const root = mkdtempSync(join(tmpdir(), 'control-store-'));
      roots.push(root);
      const first = createFileControlPlaneStore(root, deterministicOptions());
      const committed = commitCheckerSubject(first);
      queueCreatorRework(first, committed);
      const path = join(root, 'control', 'control-plane.json');
      const document = JSON.parse(readFileSync(path, 'utf8')) as { stages: Array<Record<string, unknown>> };
      const subject = document.stages.find((stage) => stage.stageId === 'build');
      const review = document.stages.find((stage) => stage.stageId === 'check');
      if (!subject || !review) throw new Error('persisted queued rework stages missing');
      if (tamper === 'creator-pointer') subject.currentAttemptRef = 'attempt-tampered';
      if (tamper === 'review-projection') review.state = 'ready';
      if (tamper === 'subject-terminal') subject.state = 'succeeded';
      writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
      expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane queued rework stage projection');
    }
  });

  it('normalizes a running queued rework and its active creator attempt to an interrupted crash pair', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    queueCreatorRework(first, committed);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { stages: Array<Record<string, unknown>>; attempts: Array<Record<string, unknown>> };
    const subject = document.stages.find((stage) => stage.stageId === 'build');
    if (!subject || typeof subject.currentAttemptRef !== 'string') throw new Error('persisted queued creator missing');
    const attempt = document.attempts.find((item) => item.attemptRef === subject.currentAttemptRef);
    if (!attempt) throw new Error('persisted queued creator attempt missing');
    subject.state = 'running';
    attempt.state = 'running';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.getRun('alice', committed.created.run.runRef)).toMatchObject({
      ok: true,
      value: {
        stages: expect.arrayContaining([expect.objectContaining({ stageId: 'build', state: 'interrupted' })]),
        attempts: expect.arrayContaining([expect.objectContaining({ attemptRef: subject.currentAttemptRef, state: 'interrupted' })]),
      },
    });
  });

  it('preserves a crash-interrupted stage with a successfully completed queued creator attempt for reconciliation', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    queueCreatorRework(first, committed);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { stages: Array<Record<string, unknown>>; attempts: Array<Record<string, unknown>> };
    const subject = document.stages.find((stage) => stage.stageId === 'build');
    if (!subject || typeof subject.currentAttemptRef !== 'string') throw new Error('persisted queued creator missing');
    const attempt = document.attempts.find((item) => item.attemptRef === subject.currentAttemptRef);
    if (!attempt) throw new Error('persisted queued creator attempt missing');
    subject.state = 'running';
    attempt.state = 'succeeded';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.getRun('alice', committed.created.run.runRef)).toMatchObject({
      ok: true,
      value: {
        stages: expect.arrayContaining([expect.objectContaining({ stageId: 'build', state: 'interrupted' })]),
        attempts: expect.arrayContaining([expect.objectContaining({ attemptRef: subject.currentAttemptRef, state: 'succeeded' })]),
      },
    });
  });

  it('requires the queued creator base commit, then preserves a finalized successor across restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    queueCreatorRework(first, committed);
    const successor = succeedQueuedCreatorAttempt(first, committed.created.run.runRef);
    const correct = {
      expectedStageVersion: successor.stage.version, expectedAttemptVersion: successor.attempt.version, expectedGeneration: 2,
      operationKey: `result:${committed.created.run.runRef}:build:g2`, resultHash: 'e'.repeat(64),
      resultCardRef: null, baseCommit: 'a'.repeat(40), canonicalCommit: 'c'.repeat(40),
    };
    expect(first.recordStageGeneration('alice', successor.stage.stageRef, { ...correct, baseCommit: 'b'.repeat(40) })).toMatchObject({
      ok: false, reason: 'conflict', detail: expect.stringContaining('base lineage'),
    });
    expect(first.recordStageGeneration('alice', successor.stage.stageRef, { ...correct, resultCardRef: 'card-rework-output' })).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('result card'),
    });
    expect(first.recordStageGeneration('alice', successor.stage.stageRef, correct)).toMatchObject({ ok: true, value: { generation: 2, state: 'committed' } });
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.getRun('alice', committed.created.run.runRef)).toMatchObject({
      ok: true,
      value: {
        stageGenerations: expect.arrayContaining([expect.objectContaining({ generation: 2, state: 'committed', baseCommit: 'a'.repeat(40) })]),
        generationSupersessions: [expect.objectContaining({ predecessorGenerationRef: committed.generation.generationRef })],
      },
    });
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

  it('rejects advance when persisted stage projections no longer show the completed review transaction', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    const { input } = failCheckerReview(first, committed);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { stages: Array<Record<string, unknown>> };
    const subject = document.stages.find((stage) => stage.stageId === 'build');
    if (!subject) throw new Error('persisted creator stage missing');
    subject.state = 'ready';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    expect(restarted.advanceReviewGeneration('alice', committed.created.run.runRef, input)).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('fails closed when a persisted successor generation loses its supersession link', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const committed = commitCheckerSubject(first);
    queueCreatorRework(first, committed);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { generationSupersessions: unknown[] };
    document.generationSupersessions = [];
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane generation supersession completeness');
  });

  it('materializes legacy checker loops without inferring subject lineage and interrupts unbound queued checker attempts', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const created = createCheckerRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as {
      attempts: Array<Record<string, unknown>>;
      reviewLoops: unknown[];
      stages: Array<Record<string, unknown>>;
    };
    const checker = document.stages.find((stage) => stage.stageId === 'check');
    if (!checker) throw new Error('persisted checker stage missing');
    document.reviewLoops = [];
    checker.currentAttemptRef = 'attempt-legacy-checker';
    document.attempts.push({
      subject: 'alice', attemptRef: 'attempt-legacy-checker', runRef: created.run.runRef, stageRef: checker.stageRef,
      generation: 1, predecessorAttemptRef: null, runtime: VERIFY_ASSIGNMENT.runtime, model: VERIFY_ASSIGNMENT.model,
      state: 'queued', version: 1, managedSessionRef: null, createdAt: checker.createdAt, updatedAt: checker.updatedAt,
    });
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');

    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    const detail = restarted.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value).toMatchObject({
      reviewLoops: [expect.objectContaining({ state: 'awaiting-subject', activeGenerationRef: null, acceptedGenerationRef: null })],
      attempts: [expect.objectContaining({ attemptRef: 'attempt-legacy-checker', state: 'interrupted', reviewSubjectGenerationRef: null })],
    });
    expect(detail.value.stages.find((stage) => stage.stageId === 'check')).toMatchObject({ currentAttemptRef: null });
    expect(detail.value.stages.find((stage) => stage.stageId === 'build')).toMatchObject({ currentGenerationRef: null, acceptedGenerationRef: null });
  });

  it('fails closed when persisted assignment provenance is present but malformed', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    createRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { runs: Array<Record<string, unknown>>; stages: Array<Record<string, unknown>> };
    document.runs[0].managerAssignment = { agentId: 'fyt-runner' };
    document.stages[0].assignment = 'not-an-assignment';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane assignment provenance');
  });

  it('fails closed when persisted review durability rows or projection refs are malformed', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    createRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> & { stages: Array<Record<string, unknown>> };
    document.stages[0].currentGenerationRef = 'not a safe ref';
    document.reviewLoops = [{ reviewLoopRef: 'bad-loop' }];
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane stage generation projection');
    const secondRoot = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(secondRoot);
    const second = createFileControlPlaneStore(secondRoot, deterministicOptions());
    createRun(second);
    const secondPath = join(secondRoot, 'control', 'control-plane.json');
    const malformed = JSON.parse(readFileSync(secondPath, 'utf8')) as Record<string, unknown>;
    malformed.reviewLoops = [{ reviewLoopRef: 'bad-loop' }];
    writeFileSync(secondPath, `${JSON.stringify(malformed)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(secondRoot, deterministicOptions())).toThrow('invalid control-plane review loop');
    const thirdRoot = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(thirdRoot);
    const third = createFileControlPlaneStore(thirdRoot, deterministicOptions());
    const thirdCreated = createCheckerRun(third);
    const thirdPath = join(thirdRoot, 'control', 'control-plane.json');
    const missingLoop = JSON.parse(readFileSync(thirdPath, 'utf8')) as Record<string, unknown>;
    missingLoop.reviewLoops = [];
    writeFileSync(thirdPath, `${JSON.stringify(missingLoop)}\n`, 'utf8');
    const migrated = createFileControlPlaneStore(thirdRoot, deterministicOptions());
    expect(migrated.getRun('alice', thirdCreated.run.runRef)).toMatchObject({
      ok: true,
      value: { reviewLoops: [expect.objectContaining({ state: 'awaiting-subject' })] },
    });
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
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1, nextEventCursor: 1 });
    expect(readdirSync(join(root, 'control')).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    const restarted = createFileControlPlaneStore(root, clock);
    const recovered = restarted.getRun('alice', created.run.runRef);
    if (!recovered.ok) throw new Error(recovered.detail);
    expect(recovered.value.run.state).toBe('interrupted');
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

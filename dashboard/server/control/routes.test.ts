import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { createInMemoryComposerStore } from '../composer/store.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from './store.ts';
import type { PlanProposal } from './proposal.ts';
import type { TimelineModel } from '../../src/lib/timelineModel.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import { ManagedSessionBroker } from './broker.ts';
import { createSubjectBrokerPersistence } from './brokerStore.ts';

const SESSION: SessionConfig = { secret: Buffer.from('control-route-test-secret-32-bytes!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';

const proposal: PlanProposal = {
  schema: 'kb.plan-proposal/v1', proposalId: 'control-route', project: 'kb-ops', title: 'Control route',
  summary: 'Import and review an immutable proposal.',
  manager: { runtime: 'claude', model: 'claude-opus-4-8', requiredSkills: [] },
  scope: { read: ['dashboard'], write: ['dashboard'] },
  governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
  stages: [{
    id: 'verify', title: 'Verify', action: 'test:control-route', target: 'dashboard/server/control',
    workOrder: 'Run focused control route tests.', riskTier: 'T2', dependsOn: [],
    worker: { runtime: 'codex', model: 'gpt-5.6-sol' }, requiredSkills: [],
    scope: { read: ['dashboard'], write: ['dashboard/server/control'] }, artifacts: [], checkpoints: [], humanGates: [],
  }, {
    id: 'report', title: 'Report', action: 'test:control-report', target: 'dashboard/server/control',
    workOrder: 'Report focused control route results.', riskTier: 'T2', dependsOn: ['verify'],
    worker: { runtime: 'codex', model: 'gpt-5.6-sol' }, requiredSkills: [],
    scope: { read: ['dashboard'], write: ['dashboard/server/control'] }, artifacts: [], checkpoints: [], humanGates: [],
  }],
};

function model(value: PlanProposal = proposal): TimelineModel {
  return { turns: [{
    index: 0, model: 'claude-opus-4-8', timestamp: null, usage: null,
    steps: [{ kind: 'text', text: `Proposal follows.\n\n\`\`\`kb.plan-proposal/v1\n${JSON.stringify(value)}\n\`\`\`` }],
  }] };
}

function headers(token: string) {
  return { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

describe('control proposal routes', () => {
  let app: ReturnType<typeof Fastify>;
  let composerStore: ReturnType<typeof createInMemoryComposerStore>;
  let controlStore: ReturnType<typeof createInMemoryControlPlaneStore>;
  let composerRef: string;
  let turnId: string;
  let token: string;
  let routingWrites: Array<{ cardId: string; runtime: string; model: string }>;

  beforeEach(async () => {
    let id = 0;
    const newId = () => `ref-${++id}`;
    composerStore = createInMemoryComposerStore({
      protector: { seal: (value) => value, open: (value) => value }, newId,
    });
    controlStore = createInMemoryControlPlaneStore({ newId });
    const workspace = composerStore.create('operator', 'Control');
    composerRef = workspace.composerRef;
    const lease = composerStore.acquireWriter('operator', composerRef);
    if (!lease.ok) throw new Error('lease failed');
    const begun = composerStore.beginTurn('operator', composerRef, lease.lease, 'Compile this plan.');
    if (!begun.ok) throw new Error('turn failed');
    turnId = begun.workspace.turnId;
    composerStore.updateTurn('operator', composerRef, lease.lease, turnId, {
      state: 'complete', model: model(), endedAt: new Date().toISOString(),
    });
    composerStore.releaseWriter('operator', composerRef, lease.lease);
    token = mintSession('operator', SESSION).token;
    routingWrites = [];
    let headReads = 0;
    app = Fastify();
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)),
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      credentials: () => [],
      composerStore,
      controlStore,
      appendAudit: (_repoRoot, event) => ({ ts: new Date().toISOString(), ...event }),
      appendAuditLocal: (_repoRoot, event) => ({ ts: new Date().toISOString(), ...event }),
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
      opsGit: (_repoRoot, args) => {
        if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
        if (args.join(' ') === 'rev-parse HEAD') return `${headReads++ === 0 ? 'a'.repeat(40) : 'b'.repeat(40)}\n`;
        return '';
      },
      runPy: (_repoRoot, _code, jsonArg) => {
        const operation = JSON.parse(jsonArg) as { cardId: string; runtime: string; model: string };
        routingWrites.push(operation);
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({ id: operation.cardId, path: `queue/inbox/${operation.cardId}.md`, state: 'inbox' })}\n`,
          stderr: '',
        };
      },
    }));
    await app.ready();
  });

  afterEach(async () => app.close());

  function mockCompletionGate() {
    const request = {
      requestRef: 'request-gate', runRef: 'run-gate', stageRef: 'stage-review', kind: 'approval', revision: 1, state: 'open',
      title: 'Review gate', prompt: 'Approve the review.', response: null, createdAt: '2026-07-18T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z',
    };
    const receipt = {
      reviewReceiptRef: 'receipt-gate', runRef: 'run-gate', reviewStageRef: 'stage-review', subjectStageRef: 'stage-subject',
      subjectGenerationRef: 'generation-1', subjectResultHash: 'a'.repeat(64), checkerAttemptRef: 'attempt-check', outcome: {}, outcomeHash: 'b'.repeat(64), operationKey: 'review-outcome:run-gate:check:g1',
      state: 'awaiting-completion-gate', completionRequestRef: request.requestRef, interventionRequestRef: null, version: 7,
      createdAt: '2026-07-18T12:00:00.000Z', finalizedAt: null,
    };
    const loop = {
      reviewLoopRef: 'loop-gate', runRef: 'run-gate', reviewStageRef: 'stage-review', subjectStageRef: 'stage-subject',
      maxCreatorReworks: 1, reviewDefinitionHash: 'c'.repeat(64), reworksUsed: 0, state: 'awaiting-gate', activeGenerationRef: 'generation-1',
      acceptedGenerationRef: null, activeReceiptRef: receipt.reviewReceiptRef, interventionRequestRef: null, version: 8,
      createdAt: '2026-07-18T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z',
    };
    const reviewStage = { stageRef: 'stage-review', runRef: 'run-gate', stageId: 'check', title: 'Check', version: 9 };
    const subjectStage = { stageRef: 'stage-subject', runRef: 'run-gate', stageId: 'build', title: 'Build', version: 10 };
    const detail = { run: { runRef: 'run-gate' }, stages: [reviewStage, subjectStage], attempts: [], sessions: [], humanRequests: [request], reviewLoops: [loop], reviewReceipts: [receipt] };
    vi.spyOn(controlStore, 'getHumanRequest').mockReturnValue({ ok: true, value: request } as never);
    vi.spyOn(controlStore, 'getRun').mockReturnValue({ ok: true, value: detail } as never);
    const resolve = vi.spyOn(controlStore, 'resolveReviewCompletionGate').mockImplementation((_subject, _requestRef, input) => ({
      ok: true,
      value: {
        request: { ...request, state: 'resolved', response: { decision: input.decision }, revision: 2 }, receipt, loop,
        reviewStage, subjectStage, interventionRequest: input.decision === 'approved' ? null : { requestRef: 'intervention-1' },
      },
    } as never));
    return { request, resolve };
  }

  /** A real store-backed gate, used to lock the HTTP replay fingerprint rather than a mocked resolver. */
  function seedStatefulCompletionGate() {
    const assignment = {
      agentId: 'fyt-verifier', declarationPath: 'agents/fyt-verifier.md', declarationHash: 'c'.repeat(64),
      profileId: 'claude:worker', runtime: 'claude' as const, model: 'claude-sonnet-5',
    };
    const review = { subjectStageId: 'build', maxCreatorReworks: 1, criteria: [{ id: 'grounded', description: 'Grounded.' }] };
    const gate = { id: 'approve-check', kind: 'approval' as const, prompt: 'Approve the checker result.', requiresReview: 'pass' as const };
    const proposal = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'stateful-gate', sourceTurnId: 'stateful-gate-turn', title: 'Stateful completion gate',
      snapshot: {
        schema: 'kb.plan-proposal/v1', manager: {}, stages: [
          { id: 'build', title: 'Build', dependsOn: [] },
          { id: 'check', title: 'Check', action: 'review:source-grounding', dependsOn: ['build'], assignment, workflowProfile: 'checker-readonly', review, completionGate: gate },
        ],
      } as unknown as import('./types.ts').JsonObject,
    });
    if (!proposal.ok) throw new Error(proposal.detail);
    const approved = controlStore.decideProposal('operator', proposal.value.proposalRef, 1, {
      expectedHash: proposal.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-stateful-gate',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun('operator', {
      title: 'Stateful completion gate', proposalRef: proposal.value.proposalRef, proposalRevision: 1, expectedProposalHash: proposal.value.hash,
      managerRuntime: 'claude', managerModel: 'claude-sonnet-5', idempotencyKey: 'launch-stateful-gate',
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [] },
        { stageId: 'check', title: 'Check', dependsOn: ['build'], assignment, workflowProfile: 'checker-readonly', review, completionGate: gate },
      ],
    });
    if (!created.ok) throw new Error(created.detail);
    let detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    let subject = detail.value.stages.find((stage) => stage.stageId === 'build');
    let checker = detail.value.stages.find((stage) => stage.stageId === 'check');
    if (!subject || !checker) throw new Error('stateful review stages missing');
    const linked = controlStore.linkStageCard('operator', subject.stageRef, subject.version, 'card-stateful-build');
    if (!linked.ok) throw new Error(linked.detail);
    const creator = controlStore.createAttempt('operator', subject.stageRef, { expectedStageVersion: linked.value.version, runtime: 'codex', model: 'gpt-5.6-sol' });
    if (!creator.ok) throw new Error(creator.detail);
    const creatorStarting = controlStore.transitionAttempt('operator', creator.value.attemptRef, creator.value.version, 'starting');
    if (!creatorStarting.ok) throw new Error(creatorStarting.detail);
    const creatorRunning = controlStore.transitionAttempt('operator', creator.value.attemptRef, creatorStarting.value.version, 'running');
    if (!creatorRunning.ok) throw new Error(creatorRunning.detail);
    const creatorSucceeded = controlStore.transitionAttempt('operator', creator.value.attemptRef, creatorRunning.value.version, 'succeeded');
    if (!creatorSucceeded.ok) throw new Error(creatorSucceeded.detail);
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    subject = detail.value.stages.find((stage) => stage.stageId === 'build');
    if (!subject) throw new Error('stateful subject disappeared');
    const generation = controlStore.recordStageGeneration('operator', subject.stageRef, {
      expectedStageVersion: subject.version, expectedAttemptVersion: creatorSucceeded.value.version, expectedGeneration: 1,
      operationKey: `result:${created.value.run.runRef}:build`, resultHash: 'd'.repeat(64), resultCardRef: 'card-stateful-build', baseCommit: 'b'.repeat(40), canonicalCommit: 'a'.repeat(40),
    });
    if (!generation.ok) throw new Error(generation.detail);
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    subject = detail.value.stages.find((stage) => stage.stageId === 'build'); checker = detail.value.stages.find((stage) => stage.stageId === 'check');
    if (!subject || !checker) throw new Error('stateful post-generation stages missing');
    const subjectRunning = controlStore.transitionStage('operator', subject.stageRef, subject.version, 'running');
    if (!subjectRunning.ok) throw new Error(subjectRunning.detail);
    const subjectSucceeded = controlStore.transitionStage('operator', subject.stageRef, subjectRunning.value.version, 'succeeded');
    if (!subjectSucceeded.ok) throw new Error(subjectSucceeded.detail);
    const checkerAttempt = controlStore.createAttempt('operator', checker.stageRef, {
      expectedStageVersion: checker.version, runtime: assignment.runtime, model: assignment.model,
      reviewSubjectGenerationRef: generation.value.generationRef, reviewSubjectResultHash: 'd'.repeat(64), reviewSubjectCanonicalCommit: 'a'.repeat(40),
    });
    if (!checkerAttempt.ok) throw new Error(checkerAttempt.detail);
    const checkerStarting = controlStore.transitionAttempt('operator', checkerAttempt.value.attemptRef, checkerAttempt.value.version, 'starting');
    if (!checkerStarting.ok) throw new Error(checkerStarting.detail);
    const checkerRunning = controlStore.transitionAttempt('operator', checkerAttempt.value.attemptRef, checkerStarting.value.version, 'running');
    if (!checkerRunning.ok) throw new Error(checkerRunning.detail);
    const checkerSucceeded = controlStore.transitionAttempt('operator', checkerAttempt.value.attemptRef, checkerRunning.value.version, 'succeeded');
    if (!checkerSucceeded.ok) throw new Error(checkerSucceeded.detail);
    const checkerReady = controlStore.transitionStage('operator', checker.stageRef, checker.version + 1, 'ready');
    if (!checkerReady.ok) throw new Error(checkerReady.detail);
    const checkerActive = controlStore.transitionStage('operator', checker.stageRef, checkerReady.value.version, 'running');
    if (!checkerActive.ok) throw new Error(checkerActive.detail);
    const checkerDone = controlStore.transitionStage('operator', checker.stageRef, checkerActive.value.version, 'succeeded');
    if (!checkerDone.ok) throw new Error(checkerDone.detail);
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    checker = detail.value.stages.find((stage) => stage.stageId === 'check');
    const loop = detail.value.reviewLoops[0];
    if (!checker || !loop) throw new Error('stateful review loop missing');
    const receipt = controlStore.recordReviewReceipt('operator', checker.stageRef, {
      expectedReviewStageVersion: checker.version, expectedCheckerAttemptVersion: checkerSucceeded.value.version, expectedLoopVersion: loop.version,
      subjectGenerationRef: generation.value.generationRef, subjectResultHash: 'd'.repeat(64), checkerAttemptRef: checkerSucceeded.value.attemptRef,
      outcome: JSON.stringify({ schema: 'kb.review-outcome/v1', decision: 'pass', summary: 'Passed.', criteria: [{ criterionId: 'grounded', verdict: 'pass', findingIds: [] }], findings: [] }),
      operationKey: `review-outcome:${created.value.run.runRef}:check:g1`,
    });
    if (!receipt.ok) throw new Error(receipt.detail);
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    checker = detail.value.stages.find((stage) => stage.stageId === 'check');
    const currentLoop = detail.value.reviewLoops[0];
    if (!checker || !currentLoop) throw new Error('stateful gate attachment missing');
    const attached = controlStore.attachReviewCompletionGate('operator', receipt.value.reviewReceiptRef, {
      expectedReceiptVersion: receipt.value.version, expectedLoopVersion: currentLoop.version, expectedReviewStageVersion: checker.version,
      idempotencyKey: `review-gate:${created.value.run.runRef}:check:g1`,
    });
    if (!attached.ok) throw new Error(attached.detail);
    return attached.value.request;
  }

  it('imports only a completed visible assistant proposal and returns a hash-bound diff', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/control/proposals/import', headers: headers(token), payload: { composerRef, turnId },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      ok: true,
      value: { sourceComposerRef: composerRef, sourceTurnId: turnId, revision: 1, approval: null },
      diff: { schema: 'kb.plan-proposal-diff/v1', changed: true },
    });
    expect(response.json().value.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('resolves an approved review completion gate through the dedicated audited route', async () => {
    const { request, resolve } = mockCompletionGate();
    const response = await app.inject({
      method: 'POST', url: `/api/control/review-completion-gates/${request.requestRef}/resolve`, headers: headers(token),
      payload: { expectedRequestRevision: 1, decision: 'approved', idempotencyKey: 'human:request-gate:1:approved', response: 'Approved.' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(resolve).toHaveBeenCalledWith('operator', request.requestRef, expect.objectContaining({
      expectedRequestRevision: 1, expectedReceiptVersion: 7, expectedLoopVersion: 8,
      expectedReviewStageVersion: 9, expectedSubjectStageVersion: 10, decision: 'approved',
    }));
  });

  it.each(['rejected', 'changes-requested'] as const)('parks a %s completion decision through the dedicated route', async (decision) => {
    const { request, resolve } = mockCompletionGate();
    const response = await app.inject({
      method: 'POST', url: `/api/control/review-completion-gates/${request.requestRef}/resolve`, headers: headers(token),
      payload: { expectedRequestRevision: 1, decision, idempotencyKey: `human:request-gate:1:${decision}` },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(resolve).toHaveBeenCalledWith('operator', request.requestRef, expect.objectContaining({ decision }));
  });

  it('rejects a stale completion-gate request revision before audit or resolution', async () => {
    const { request, resolve } = mockCompletionGate();
    const response = await app.inject({
      method: 'POST', url: `/api/control/review-completion-gates/${request.requestRef}/resolve`, headers: headers(token),
      payload: { expectedRequestRevision: 0, decision: 'approved', idempotencyKey: 'human:request-gate:0:approved' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'request-revision-changed' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('never lets a reserved completion request through generic respond', async () => {
    const { request, resolve } = mockCompletionGate();
    const response = await app.inject({
      method: 'POST', url: `/api/control/human-requests/${request.requestRef}/respond`, headers: headers(token),
      payload: { expectedRevision: 1, decision: 'approved', idempotencyKey: 'generic-bypass' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'review-completion-gate-reserved' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(['approved', 'changes-requested'] as const)('replays an identical stateful completion-gate %s POST', async (decision) => {
    const request = seedStatefulCompletionGate();
    const payload = {
      expectedRequestRevision: request.revision, decision,
      idempotencyKey: `http-replay:${request.requestRef}:${decision}`, response: `same ${decision} body`,
    };
    const url = `/api/control/review-completion-gates/${request.requestRef}/resolve`;
    const first = await app.inject({ method: 'POST', url, headers: headers(token), payload });
    expect(first.statusCode, first.body).toBe(200);
    const replay = await app.inject({ method: 'POST', url, headers: headers(token), payload });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ ok: true, replayed: true });
  });

  it('rejects stateful completion-gate replay attempts with a changed key or body', async () => {
    const request = seedStatefulCompletionGate();
    const url = `/api/control/review-completion-gates/${request.requestRef}/resolve`;
    const payload = { expectedRequestRevision: request.revision, decision: 'approved', idempotencyKey: 'http-replay-original', response: 'original body' };
    expect((await app.inject({ method: 'POST', url, headers: headers(token), payload })).statusCode).toBe(200);
    const changedKey = await app.inject({ method: 'POST', url, headers: headers(token), payload: { ...payload, idempotencyKey: 'http-replay-changed-key' } });
    expect(changedKey.statusCode).toBe(409);
    const changedBody = await app.inject({ method: 'POST', url, headers: headers(token), payload: { ...payload, response: 'changed body' } });
    expect(changedBody.statusCode).toBe(409);
    const changedRevision = await app.inject({ method: 'POST', url, headers: headers(token), payload: { ...payload, expectedRequestRevision: 99 } });
    expect(changedRevision.statusCode).toBe(409);
  });

  it('binds approval to the exact stored hash and rejects stale replay', async () => {
    const imported = await app.inject({
      method: 'POST', url: '/api/control/proposals/import', headers: headers(token), payload: { composerRef, turnId },
    });
    const value = imported.json().value as { proposalRef: string; revision: number; hash: string };
    const stale = await app.inject({
      method: 'POST',
      url: `/api/control/proposals/${value.proposalRef}/revisions/${value.revision}/decision`,
      headers: headers(token),
      payload: { expectedHash: '0'.repeat(64), expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approval-1' },
    });
    expect(stale.statusCode).toBe(409);
    const approved = await app.inject({
      method: 'POST',
      url: `/api/control/proposals/${value.proposalRef}/revisions/${value.revision}/decision`,
      headers: headers(token),
      payload: { expectedHash: value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approval-1' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ ok: true, value: { approval: { decision: 'approved' } } });
  });

  it('keeps proposal catalogs subject-bound', async () => {
    await app.inject({ method: 'POST', url: '/api/control/proposals/import', headers: headers(token), payload: { composerRef, turnId } });
    const otherToken = mintSession('other-operator', SESSION).token;
    const response = await app.inject({
      method: 'GET', url: `/api/control/proposals?composerRef=${composerRef}`, headers: headers(otherToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ proposals: [] });
  });

  it('rejects running and malformed proposal turns without persistence', async () => {
    const workspace = composerStore.create('operator', 'Running');
    const lease = composerStore.acquireWriter('operator', workspace.composerRef);
    if (!lease.ok) throw new Error('lease failed');
    const begun = composerStore.beginTurn('operator', workspace.composerRef, lease.lease, 'partial');
    if (!begun.ok) throw new Error('turn failed');
    composerStore.updateTurn('operator', workspace.composerRef, lease.lease, begun.workspace.turnId, { model: model() });
    const response = await app.inject({
      method: 'POST', url: '/api/control/proposals/import', headers: headers(token),
      payload: { composerRef: workspace.composerRef, turnId: begun.workspace.turnId },
    });
    expect(response.statusCode).toBe(400);
    expect(controlStore.listProposalRevisions('operator')).toEqual([]);
  });

  it('publishes a deterministic two-stage canonical DAG once and stops at the inactive runtime gate', async () => {
    const imported = await app.inject({
      method: 'POST', url: '/api/control/proposals/import', headers: headers(token), payload: { composerRef, turnId },
    });
    const revision = imported.json().value as { proposalRef: string; revision: number; hash: string };
    await app.inject({
      method: 'POST',
      url: `/api/control/proposals/${revision.proposalRef}/revisions/${revision.revision}/decision`,
      headers: headers(token),
      payload: { expectedHash: revision.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approval-launch' },
    });
    const opsGit = (_repoRoot: string, args: string[]): string => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args.join(' ') === 'rev-parse HEAD') return 'a'.repeat(40);
      return '';
    };
    const runPy = (_repoRoot: string, _code: string, jsonArg: string) => {
      const payload = JSON.parse(jsonArg) as { runId: string; managed: boolean; stages: Array<{ id: string; dependsOn: string[] }> };
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          runId: payload.runId,
          cards: payload.stages.map((stage) => {
            const cardId = workflowCardId(payload.runId, stage.id);
            const state = payload.managed || stage.dependsOn.length ? 'blocked' : 'inbox';
            return { stageId: stage.id, cardId, state, cardPath: `queue/${state === 'blocked' ? 'inbox' : state}/${cardId}.md` };
          }),
        }),
        stderr: '',
      };
    };
    const launchApp = Fastify();
    registerWriteSurface(launchApp, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)),
      sessionConfig: SESSION, allowedOrigins: [ORIGIN], credentials: () => [], composerStore, controlStore,
      appendAudit: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      appendAuditLocal: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }), opsGit, runPy,
    }));
    await launchApp.ready();
    try {
      const launched = await launchApp.inject({
        method: 'POST',
        url: `/api/control/proposals/${revision.proposalRef}/revisions/${revision.revision}/launch`,
        headers: headers(token), payload: { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` },
      });
      expect(launched.statusCode, launched.body).toBe(202);
      const run = controlStore.getRun('operator', launched.json().runRef as string);
      expect(launched.json(), JSON.stringify(run)).toMatchObject({ ok: true, waitingHuman: true, activationGated: true });
      expect(run.ok && run.value.run).toMatchObject({ publicationState: 'published', state: 'waiting-human' });
      expect(run.ok && run.value.stages.map((stage) => [stage.stageId, stage.canonicalCardRef, stage.state])).toEqual([
        ['verify', workflowCardId(launched.json().runRef as string, 'verify'), 'ready'],
        ['report', workflowCardId(launched.json().runRef as string, 'report'), 'blocked'],
      ]);
      expect(run.ok && run.value.humanRequests).toEqual([
        expect.objectContaining({ kind: 'governance-refusal', title: 'Automatic execution activation is gated' }),
      ]);
    } finally {
      await launchApp.close();
    }
  });

  it('commits a Human Request response before releasing the exact launch into canonical publication', async () => {
    const gatedProposal: PlanProposal = {
      ...proposal,
      proposalId: 'control-route-gated',
      stages: proposal.stages.map((stage, index) => index === 0 ? {
        ...stage,
        humanGates: [{ id: 'review-before-publication', kind: 'approval', prompt: 'Approve the synthetic publication.' }],
      } : stage),
    };
    const workspace = composerStore.create('operator', 'Gated control');
    const lease = composerStore.acquireWriter('operator', workspace.composerRef);
    if (!lease.ok) throw new Error('lease failed');
    const begun = composerStore.beginTurn('operator', workspace.composerRef, lease.lease, 'Compile the gated plan.');
    if (!begun.ok) throw new Error('turn failed');
    composerStore.updateTurn('operator', workspace.composerRef, lease.lease, begun.workspace.turnId, {
      state: 'complete', model: model(gatedProposal), endedAt: new Date().toISOString(),
    });
    composerStore.releaseWriter('operator', workspace.composerRef, lease.lease);
    const imported = await app.inject({
      method: 'POST', url: '/api/control/proposals/import', headers: headers(token),
      payload: { composerRef: workspace.composerRef, turnId: begun.workspace.turnId },
    });
    const revision = imported.json().value as { proposalRef: string; revision: number; hash: string };
    await app.inject({
      method: 'POST', url: `/api/control/proposals/${revision.proposalRef}/revisions/1/decision`, headers: headers(token),
      payload: { expectedHash: revision.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-gated' },
    });
    const opsGit = (_repoRoot: string, args: string[]): string => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args.join(' ') === 'rev-parse HEAD') return 'b'.repeat(40);
      return '';
    };
    const runPy = (_repoRoot: string, _code: string, jsonArg: string) => {
      const payload = JSON.parse(jsonArg) as { runId: string; managed: boolean; stages: Array<{ id: string; dependsOn: string[] }> };
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({
        runId: payload.runId,
        cards: payload.stages.map((stage) => {
          const cardId = workflowCardId(payload.runId, stage.id);
          const state = payload.managed || stage.dependsOn.length ? 'blocked' : 'inbox';
          return { stageId: stage.id, cardId, state, cardPath: `queue/${state === 'blocked' ? 'inbox' : state}/${cardId}.md` };
        }),
      }) };
    };
    const launchApp = Fastify();
    registerWriteSurface(launchApp, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)), sessionConfig: SESSION,
      allowedOrigins: [ORIGIN], credentials: () => [], composerStore, controlStore, opsGit, runPy,
      appendAudit: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      appendAuditLocal: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
    }));
    await launchApp.ready();
    try {
      const url = `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`;
      const payload = { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` };
      const gated = await launchApp.inject({ method: 'POST', url, headers: headers(token), payload });
      expect(gated.statusCode, gated.body).toBe(202);
      let detail = controlStore.getRun('operator', gated.json().runRef as string);
      if (!detail.ok) throw new Error(detail.detail);
      expect(detail.value.run.publicationState).toBe('waiting-human');
      expect(detail.value.stages.every((stage) => stage.canonicalCardRef === null)).toBe(true);
      const request = detail.value.humanRequests[0];
      const responded = await launchApp.inject({
        method: 'POST', url: `/api/control/human-requests/${request.requestRef}/respond`, headers: headers(token),
        payload: { expectedRevision: request.revision, decision: 'approved', idempotencyKey: 'accept-gated' },
      });
      expect(responded.statusCode, responded.body).toBe(200);
      const released = await launchApp.inject({ method: 'POST', url, headers: headers(token), payload });
      expect(released.statusCode, released.body).toBe(202);
      expect(released.json()).toMatchObject({ activationGated: true, waitingHuman: true });
      detail = controlStore.getRun('operator', gated.json().runRef as string);
      expect(detail.ok && detail.value.run).toMatchObject({ publicationState: 'published', state: 'waiting-human' });
      expect(detail.ok && detail.value.humanRequests).toEqual(expect.arrayContaining([
        expect.objectContaining({ state: 'resolved', response: expect.objectContaining({ decision: 'approved' }) }),
        expect.objectContaining({ state: 'open', title: 'Automatic execution activation is gated' }),
      ]));
    } finally { await launchApp.close(); }
  });

  it('commits Manager messages and checkpoint steering before broker delivery, then stops with CAS', async () => {
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'composer-manager', sourceTurnId: 'turn-manager', title: proposal.title,
      snapshot: proposal as unknown as import('./types.ts').JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, 1, {
      expectedHash: stored.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-manager',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun('operator', {
      title: proposal.title, proposalRef: stored.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: stored.value.hash, managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      idempotencyKey: 'launch-manager', stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!created.ok) throw new Error(created.detail);
    const publishing = controlStore.transitionPublication('operator', created.value.run.runRef, created.value.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = controlStore.transitionPublication('operator', created.value.run.runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const running = controlStore.transitionRun('operator', created.value.run.runRef, published.value.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const broker = new ManagedSessionBroker({ start: () => ({ stop() {} }) }, createSubjectBrokerPersistence(controlStore, 'operator'), {
      newId: (() => { let id = 0; return () => `broker-${++id}`; })(),
    });
    expect(broker.start({
      runRef: running.value.runRef, sessionRef: running.value.managerSessionRef, role: 'manager',
      profileId: 'manager:claude:claude-opus-4-8', approvedPrompt: 'approved',
    })).toMatchObject({ ok: true, started: true });
    const managerApp = Fastify();
    registerWriteSurface(managerApp, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)), sessionConfig: SESSION,
      allowedOrigins: [ORIGIN], credentials: () => [], composerStore, controlStore, controlBroker: broker,
      cancelAutomatic: async () => ({ state: 'stopped', stoppedSessionRefs: [running.value.managerSessionRef], interruptedSessionRefs: [], replayed: false }),
      appendAudit: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
    }));
    await managerApp.ready();
    try {
      const current = controlStore.getRun('operator', running.value.runRef);
      if (!current.ok) throw new Error(current.detail);
      const cas = { expectedRunVersion: current.value.run.version, expectedManagerGeneration: 1 };
      const message = await managerApp.inject({
        method: 'POST', url: `/api/control/runs/${running.value.runRef}/manager/messages`, headers: headers(token),
        payload: { ...cas, idempotencyKey: 'message-1', message: 'General message.' },
      });
      expect(message.statusCode, message.body).toBe(200);
      const steer = await managerApp.inject({
        method: 'POST', url: `/api/control/runs/${running.value.runRef}/manager/steer`, headers: headers(token),
        payload: { ...cas, idempotencyKey: 'steer-1', checkpoint: 'safe-1', instruction: 'Inspect the diff.' },
      });
      expect(steer.statusCode, steer.body).toBe(200);
      expect(broker.reachCheckpoint(running.value.managerSessionRef, 'other', 'checkpoint-other')).toEqual(['General message.']);
      expect(broker.reachCheckpoint(running.value.managerSessionRef, 'safe-1', 'checkpoint-safe')).toEqual(['Inspect the diff.']);
      const stop = await managerApp.inject({
        method: 'POST', url: `/api/control/runs/${running.value.runRef}/manager/stop`, headers: headers(token),
        payload: { ...cas, idempotencyKey: 'stop-1' },
      });
      expect(stop.statusCode, stop.body).toBe(200);
      expect(stop.json()).toMatchObject({ ok: true, value: { state: 'stopped' } });
    } finally { await managerApp.close(); }
  });

  it('reroutes only the exact never-started managed stage and creates durable successor lineage', async () => {
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'composer-reroute', sourceTurnId: 'turn-reroute', title: proposal.title,
      snapshot: proposal as unknown as import('./types.ts').JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, 1, {
      expectedHash: stored.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-reroute',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun('operator', {
      title: proposal.title, proposalRef: stored.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: stored.value.hash, managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      idempotencyKey: 'launch-reroute', stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!created.ok) throw new Error(created.detail);
    const sourceStage = created.value.stages[0];
    const cardRef = workflowCardId(created.value.run.runRef, sourceStage.stageId);
    const linked = controlStore.linkStageCard('operator', sourceStage.stageRef, sourceStage.version, cardRef);
    if (!linked.ok) throw new Error(linked.detail);
    const publishing = controlStore.transitionPublication('operator', created.value.run.runRef, created.value.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = controlStore.transitionPublication('operator', created.value.run.runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const original = controlStore.createAttempt('operator', sourceStage.stageRef, {
      expectedStageVersion: linked.value.version, runtime: 'codex', model: 'gpt-5.6-sol',
    });
    if (!original.ok) throw new Error(original.detail);
    const originalSession = controlStore.createWorkerSession('operator', original.value.attemptRef, {
      expectedAttemptVersion: original.value.version,
    });
    if (!originalSession.ok) throw new Error(originalSession.detail);
    const before = controlStore.getRun('operator', created.value.run.runRef);
    if (!before.ok) throw new Error(before.detail);
    const stage = before.value.stages.find((item) => item.stageRef === sourceStage.stageRef);
    const attempt = before.value.attempts.find((item) => item.attemptRef === original.value.attemptRef);
    if (!stage || !attempt) throw new Error('reroute source missing');

    const response = await app.inject({
      method: 'POST', url: `/api/control/runs/${created.value.run.runRef}/stages/${stage.stageRef}/reroute`, headers: headers(token),
      payload: {
        expectedStageVersion: stage.version, expectedAttemptRef: attempt.attemptRef, expectedAttemptVersion: attempt.version,
        runtime: 'claude', model: 'claude-sonnet-5', idempotencyKey: 'reroute-route-1',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      value: {
        attempt: { generation: 2, predecessorAttemptRef: original.value.attemptRef, runtime: 'claude', model: 'claude-sonnet-5', state: 'queued' },
        session: { predecessorSessionRef: originalSession.value.sessionRef, state: 'pending' },
      },
    });
    expect(routingWrites).toEqual([expect.objectContaining({ cardId: cardRef, runtime: 'claude', model: 'claude-sonnet-5' })]);
    const after = controlStore.getRun('operator', created.value.run.runRef);
    expect(after).toMatchObject({
      ok: true,
      value: {
        attempts: expect.arrayContaining([
          expect.objectContaining({ attemptRef: original.value.attemptRef, runtime: 'codex', model: 'gpt-5.6-sol', state: 'stopped' }),
          expect.objectContaining({ generation: 2, runtime: 'claude', model: 'claude-sonnet-5', state: 'queued' }),
        ]),
        sessions: expect.arrayContaining([
          expect.objectContaining({ sessionRef: originalSession.value.sessionRef, state: 'stopped' }),
          expect.objectContaining({ predecessorSessionRef: originalSession.value.sessionRef, state: 'pending' }),
        ]),
      },
    });
    const replay = await app.inject({
      method: 'POST', url: `/api/control/runs/${created.value.run.runRef}/stages/${stage.stageRef}/reroute`, headers: headers(token),
      payload: {
        expectedStageVersion: stage.version, expectedAttemptRef: attempt.attemptRef, expectedAttemptVersion: attempt.version,
        runtime: 'claude', model: 'claude-sonnet-5', idempotencyKey: 'reroute-route-1',
      },
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ ok: true, replayed: true, value: { attempt: { generation: 2 } } });
    expect(routingWrites).toHaveLength(1);
  });

  it('creates an audited Manager successor generation but keeps runtime activation gated', async () => {
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'composer-successor', sourceTurnId: 'turn-successor', title: proposal.title,
      snapshot: proposal as unknown as import('./types.ts').JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, 1, {
      expectedHash: stored.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-successor',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun('operator', {
      title: proposal.title, proposalRef: stored.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: stored.value.hash, managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      idempotencyKey: 'launch-successor', stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!created.ok) throw new Error(created.detail);
    const manager = created.value.sessions[0];
    const interrupted = controlStore.transitionSession('operator', manager.sessionRef, manager.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);

    const response = await app.inject({
      method: 'POST', url: `/api/control/runs/${created.value.run.runRef}/manager/successor`, headers: headers(token),
      payload: {
        expectedManagerGeneration: 1, runtime: proposal.manager.runtime, model: proposal.manager.model,
        idempotencyKey: 'manager-successor-1',
      },
    });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({
      ok: true, activationGated: true,
      value: { generation: 2, predecessorSessionRef: manager.sessionRef, state: 'pending' },
    });
    expect(controlStore.getRun('operator', created.value.run.runRef)).toMatchObject({
      ok: true, value: { run: { managerGeneration: 2, state: 'recovering' } },
    });
  });

  it('does not commit approval or Human Request decisions when canonical audit authorization fails', async () => {
    const imported = await app.inject({
      method: 'POST', url: '/api/control/proposals/import', headers: headers(token), payload: { composerRef, turnId },
    });
    const revision = imported.json().value as { proposalRef: string; revision: number; hash: string };
    const stored = controlStore.getProposalRevision('operator', revision.proposalRef, revision.revision);
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', revision.proposalRef, revision.revision, {
      expectedHash: revision.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'seed-audit-run',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const run = controlStore.createRun('operator', {
      title: proposal.title, proposalRef: revision.proposalRef, proposalRevision: revision.revision,
      expectedProposalHash: revision.hash, managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      idempotencyKey: 'audit-failure-run', stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!run.ok) throw new Error(run.detail);
    const request = controlStore.createHumanRequest('operator', run.value.run.runRef, {
      kind: 'approval', title: 'Audit-bound approval', prompt: 'Approve only after canonical audit.',
    });
    if (!request.ok) throw new Error(request.detail);

    const pending = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'composer-audit-failure', sourceTurnId: 'turn-audit-failure', title: proposal.title,
      snapshot: proposal as unknown as import('./types.ts').JsonObject,
    });
    if (!pending.ok) throw new Error(pending.detail);
    const auditFailApp = Fastify();
    registerWriteSurface(auditFailApp, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)), sessionConfig: SESSION,
      allowedOrigins: [ORIGIN], credentials: () => [], composerStore, controlStore,
      appendAudit: () => { throw new Error('audit unavailable'); },
    }));
    await auditFailApp.ready();
    try {
      const decision = await auditFailApp.inject({
        method: 'POST', url: `/api/control/proposals/${pending.value.proposalRef}/revisions/1/decision`, headers: headers(token),
        payload: { expectedHash: pending.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'audit-must-land' },
      });
      expect(decision.statusCode, decision.body).toBe(500);
      expect(controlStore.getProposalRevision('operator', pending.value.proposalRef, 1)).toMatchObject({
        ok: true, value: { approval: null },
      });
      const response = await auditFailApp.inject({
        method: 'POST', url: `/api/control/human-requests/${request.value.requestRef}/respond`, headers: headers(token),
        payload: { expectedRevision: 1, decision: 'approved', idempotencyKey: 'response-audit-must-land' },
      });
      expect(response.statusCode, response.body).toBe(500);
      expect(controlStore.getHumanRequest('operator', request.value.requestRef)).toMatchObject({
        ok: true, value: { state: 'open', response: null },
      });
    } finally { await auditFailApp.close(); }
  });
});

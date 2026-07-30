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
import type { JsonObject } from './types.ts';
import type { ExecuteRunInput } from './execution.ts';

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
  let auditRows: Array<Record<string, unknown>>;

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
    auditRows = [];
    let headReads = 0;
    app = Fastify();
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)),
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      credentials: () => [],
      composerStore,
      controlStore,
      appendAudit: (_repoRoot, event) => { auditRows.push(event as unknown as Record<string, unknown>); return { ts: new Date().toISOString(), ...event }; },
      appendAuditLocal: (_repoRoot, event) => { auditRows.push(event as unknown as Record<string, unknown>); return { ts: new Date().toISOString(), ...event }; },
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

  function seedActivatableRun(withAcceptedRequest = true, suffix = '') {
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'composer-activation',
      sourceTurnId: 'turn-activation',
      title: proposal.title,
      snapshot: proposal as unknown as JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, stored.value.revision, {
      expectedHash: stored.value.hash,
      expectedApprovalRevision: 0,
      decision: 'approved',
      idempotencyKey: `approve-activation${suffix}`,
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun('operator', {
      title: proposal.title,
      proposalRef: stored.value.proposalRef,
      proposalRevision: stored.value.revision,
      expectedProposalHash: stored.value.hash,
      managerRuntime: proposal.manager.runtime,
      managerModel: proposal.manager.model,
      idempotencyKey: `launch-activation${suffix}`,
      stages: proposal.stages.map((stage) => ({
        stageId: stage.id,
        title: stage.title,
        dependsOn: stage.dependsOn,
      })),
    });
    if (!created.ok) throw new Error(created.detail);
    for (const stage of created.value.stages.filter((candidate) => candidate.dependsOn.length === 0)) {
      const linked = controlStore.linkStageCard('operator', stage.stageRef, stage.version, workflowCardId(created.value.run.runRef, stage.stageId));
      if (!linked.ok) throw new Error(linked.detail);
    }
    const publishing = controlStore.transitionPublication(
      'operator',
      created.value.run.runRef,
      created.value.run.version,
      'publishing',
    );
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = controlStore.transitionPublication(
      'operator',
      created.value.run.runRef,
      publishing.value.version,
      'published',
    );
    if (!published.ok) throw new Error(published.detail);
    const waiting = controlStore.transitionRun(
      'operator',
      created.value.run.runRef,
      published.value.version,
      'waiting-human',
    );
    if (!waiting.ok) throw new Error(waiting.detail);
    if (withAcceptedRequest) {
      const request = controlStore.createHumanRequest('operator', created.value.run.runRef, {
        kind: 'intervention',
        title: 'Execution report',
        prompt: 'Acknowledge the report before resuming.',
      });
      if (!request.ok) throw new Error(request.detail);
      const responded = controlStore.respondHumanRequest('operator', request.value.requestRef, {
        expectedRevision: request.value.revision,
        decision: 'responded',
        idempotencyKey: `accept-activation${suffix}`,
      });
      if (!responded.ok) throw new Error(responded.detail);
    }
    const detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    return detail.value;
  }

  async function activatedApp(
    beforeRootAuthorization?: () => void | Promise<void>,
    overrides: {
      appendAudit?: (root: string, event: unknown) => unknown | Promise<unknown>;
      runAutomatic?: (input: ExecuteRunInput) => Promise<unknown>;
      cancelAutomatic?: () => Promise<unknown>;
      containManagerStart?: () => Promise<void>;
      completedRoot?: boolean;
      verifyCanonicalResult?: boolean;
      managerStartAckTimeoutMs?: number;
    } = {},
  ) {
    const runAutomatic = vi.fn(overrides.runAutomatic ?? (async (input: ExecuteRunInput) => {
      const current = controlStore.getRun(input.subject, input.runRef);
      if (!current.ok) throw new Error(current.detail);
      const running = controlStore.transitionRun(input.subject, input.runRef, current.value.run.version, 'running');
      if (!running.ok) throw new Error(running.detail);
      input.onManagerStarted?.();
      return {
        state: 'succeeded' as const,
        startedStageIds: [],
        completedStageIds: [],
        waitingStageIds: [],
      };
    }));
    const cancelAutomatic = vi.fn(overrides.cancelAutomatic ?? (async () => ({
      state: 'stopped' as const,
      stoppedSessionRefs: [],
      interruptedSessionRefs: [],
      replayed: false,
    })));
    const containManagerStart = vi.fn(overrides.containManagerStart ?? (async () => {}));
    const verifyCanonicalResult = vi.fn(async () => overrides.verifyCanonicalResult ?? true);
    const activateManagedRoots = vi.fn(async (options: { runRef: string; cardRefs: string[]; authorizeAfterPrepare?: () => void | Promise<void>; verifyCompletedRoots?: (input: { runRef: string; cardRefs: string[] }) => Promise<void> }) => {
      await beforeRootAuthorization?.();
      if (overrides.completedRoot) await options.verifyCompletedRoots?.({ runRef: options.runRef, cardRefs: [options.cardRefs[0]] });
      await options.authorizeAfterPrepare?.();
      return {
        replayed: false,
        cardPaths: options.cardRefs.map((cardRef) => `queue/inbox/${cardRef}.md`),
      };
    });
    const activated = Fastify();
    registerWriteSurface(activated, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)),
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      credentials: () => [],
      composerStore,
      controlStore,
      controlBroker: { isRunning: () => false, drain: () => {} } as never,
      runAutomatic: runAutomatic as never,
      cancelAutomatic: cancelAutomatic as never,
      containManagerStart: containManagerStart as never,
      verifyCanonicalResult: verifyCanonicalResult as never,
      managerStartAckTimeoutMs: overrides.managerStartAckTimeoutMs,
      activateManagedRoots: activateManagedRoots as never,
      appendAudit: (overrides.appendAudit ?? ((_root: string, event: Record<string, unknown>) => ({
        ts: new Date().toISOString(), ...event,
      }))) as never,
      appendAuditLocal: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
      opsGit: (_root, args) => args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n' : '',
    }));
    await activated.ready();
    return { activated, runAutomatic, cancelAutomatic, containManagerStart, activateManagedRoots, verifyCanonicalResult };
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

  it('keeps browser-authored proposal revisions strict: compiler-only assignments cannot enter the store', async () => {
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'strict-wire', sourceTurnId: 'strict-wire-turn', title: proposal.title,
      snapshot: proposal as unknown as import('./types.ts').JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const forged = {
      ...proposal,
      manager: {
        ...proposal.manager,
        assignment: {
          agentId: 'forged-manager', declarationPath: 'agents/forged-manager.md', declarationHash: 'a'.repeat(64),
          profileId: 'manager:claude:claude-opus-4-8', runtime: 'claude', model: 'claude-opus-4-8',
        },
      },
    };
    const response = await app.inject({
      method: 'POST', url: `/api/control/proposals/${stored.value.proposalRef}/revisions`, headers: headers(token),
      payload: { expectedPreviousHash: stored.value.hash, proposal: forged },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid-proposal', detail: "manager: unknown field 'assignment'" });
    expect(controlStore.listProposalRevisions('operator', stored.value.proposalRef)).toHaveLength(1);
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

  it('keeps an unassigned stage reroutable in a mixed assigned workflow and creates durable successor lineage', async () => {
    const managerAssignment = {
      agentId: 'assigned-manager', declarationPath: 'agents/assigned-manager.md', declarationHash: 'a'.repeat(64),
      profileId: 'manager:claude:claude-opus-4-8', runtime: 'claude' as const, model: 'claude-opus-4-8',
    };
    const workerAssignment = {
      agentId: 'assigned-worker', declarationPath: 'agents/assigned-worker.md', declarationHash: 'b'.repeat(64),
      profileId: 'worker:codex:gpt-5.6-sol', runtime: 'codex' as const, model: 'gpt-5.6-sol',
    };
    const mixed = {
      ...proposal,
      manager: { ...proposal.manager, assignment: managerAssignment },
      stages: [proposal.stages[0], { ...proposal.stages[1], assignment: workerAssignment }],
    };
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'composer-reroute', sourceTurnId: 'turn-reroute', title: proposal.title,
      snapshot: mixed as unknown as import('./types.ts').JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, 1, {
      expectedHash: stored.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-reroute',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun('operator', {
      title: proposal.title, proposalRef: stored.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: stored.value.hash, managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      managerAssignment, idempotencyKey: 'launch-reroute',
      stages: mixed.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn, assignment: stage.assignment ?? null })),
    });
    if (!created.ok) throw new Error(created.detail);
    const sourceStage = created.value.stages[0];
    const assignedStage = created.value.stages[1];
    const assignedCardRef = workflowCardId(created.value.run.runRef, assignedStage.stageId);
    const assignedLinked = controlStore.linkStageCard('operator', assignedStage.stageRef, assignedStage.version, assignedCardRef);
    if (!assignedLinked.ok) throw new Error(assignedLinked.detail);
    const assignedAttempt = controlStore.createAttempt('operator', assignedStage.stageRef, {
      expectedStageVersion: assignedLinked.value.version, runtime: 'codex', model: 'gpt-5.6-sol',
    });
    if (!assignedAttempt.ok) throw new Error(assignedAttempt.detail);
    const assignedSession = controlStore.createWorkerSession('operator', assignedAttempt.value.attemptRef, {
      expectedAttemptVersion: assignedAttempt.value.version,
    });
    if (!assignedSession.ok) throw new Error(assignedSession.detail);
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

    const assignedBefore = controlStore.getRun('operator', created.value.run.runRef);
    if (!assignedBefore.ok) throw new Error(assignedBefore.detail);
    const immutableStage = assignedBefore.value.stages.find((item) => item.stageRef === assignedStage.stageRef);
    const immutableAttempt = assignedBefore.value.attempts.find((item) => item.attemptRef === assignedAttempt.value.attemptRef);
    if (!immutableStage || !immutableAttempt) throw new Error('assigned reroute source missing');
    const auditsBefore = auditRows.length;
    const assignedRefusal = await app.inject({
      method: 'POST', url: `/api/control/runs/${created.value.run.runRef}/stages/${immutableStage.stageRef}/reroute`, headers: headers(token),
      payload: {
        expectedStageVersion: immutableStage.version, expectedAttemptRef: immutableAttempt.attemptRef, expectedAttemptVersion: immutableAttempt.version,
        runtime: 'claude', model: 'claude-sonnet-5', idempotencyKey: 'assigned-reroute-refused',
      },
    });
    expect(assignedRefusal.statusCode, assignedRefusal.body).toBe(409);
    expect(assignedRefusal.json()).toMatchObject({
      error: 'reroute-refused', disposition: 'immutable',
      detail: 'assigned stage routing is immutable; create a successor run with a new approved assignment',
    });
    expect(routingWrites).toHaveLength(1);
    expect(auditRows).toHaveLength(auditsBefore);
    expect(controlStore.getRun('operator', created.value.run.runRef)).toMatchObject({
      ok: true,
      value: {
        stages: expect.arrayContaining([expect.objectContaining({ stageRef: immutableStage.stageRef, canonicalCardRef: assignedCardRef, version: immutableStage.version })]),
        attempts: expect.arrayContaining([expect.objectContaining({ attemptRef: immutableAttempt.attemptRef, generation: 1, state: 'queued', version: immutableAttempt.version })]),
      },
    });
  });

  it('refuses mismatched assigned Manager successors before audit/store mutation, then permits the exact immutable route', async () => {
    const managerAssignment = {
      agentId: 'assigned-manager', declarationPath: 'agents/assigned-manager.md', declarationHash: 'd'.repeat(64),
      profileId: 'manager:claude:claude-opus-4-8', runtime: 'claude' as const, model: 'claude-opus-4-8',
    };
    const assigned = { ...proposal, manager: { ...proposal.manager, assignment: managerAssignment } };
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'composer-successor', sourceTurnId: 'turn-successor', title: proposal.title,
      snapshot: assigned as unknown as import('./types.ts').JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, 1, {
      expectedHash: stored.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-successor',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun('operator', {
      title: proposal.title, proposalRef: stored.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: stored.value.hash, managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      managerAssignment, idempotencyKey: 'launch-successor', stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!created.ok) throw new Error(created.detail);
    const manager = created.value.sessions[0];
    const interrupted = controlStore.transitionSession('operator', manager.sessionRef, manager.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);

    const auditsBefore = auditRows.length;
    const mismatch = await app.inject({
      method: 'POST', url: `/api/control/runs/${created.value.run.runRef}/manager/successor`, headers: headers(token),
      payload: {
        expectedManagerGeneration: 1, runtime: 'claude', model: 'claude-sonnet-5',
        idempotencyKey: 'manager-successor-mismatch',
      },
    });
    expect(mismatch.statusCode, mismatch.body).toBe(409);
    expect(mismatch.json()).toEqual({
      error: 'manager-successor-routing-immutable',
      detail: 'manager successor routing must match immutable manager assignment provenance',
    });
    expect(auditRows).toHaveLength(auditsBefore);
    expect(controlStore.getRun('operator', created.value.run.runRef)).toMatchObject({
      ok: true, value: { run: { managerGeneration: 1, managerSessionRef: manager.sessionRef, state: 'planned' } },
    });

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
    expect(auditRows.some((event) => event.action === 'control-manager-successor-authorize')).toBe(true);
  });

  it('claims activation once and replays concurrent exact requests without a second engine dispatch', async () => {
    const detail = seedActivatableRun();
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:${detail.run.proposalHash}:${detail.run.managerGeneration}`,
    };
    const { activated, runAutomatic, activateManagedRoots } = await activatedApp();
    try {
      const [first, second] = await Promise.all([
        activated.inject({
          method: 'POST',
          url: `/api/control/runs/${detail.run.runRef}/activate`,
          headers: headers(token),
          payload,
        }),
        activated.inject({
          method: 'POST',
          url: `/api/control/runs/${detail.run.runRef}/activate`,
          headers: headers(token),
          payload,
        }),
      ]);

      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 202]);
      expect([first.json(), second.json()].some((body) => body.replayed === true)).toBe(true);
      expect(runAutomatic).toHaveBeenCalledTimes(1);
      expect(activateManagedRoots).toHaveBeenCalledTimes(1);
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true,
        value: {
          run: { state: 'running', version: detail.run.version + 2 },
          humanRequests: [{ state: 'resolved' }],
        },
      });
      const gatedReplay = await app.inject({
        method: 'POST',
        url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token),
        payload,
      });
      expect(gatedReplay.statusCode).toBe(200);
      expect(gatedReplay.json()).toMatchObject({ ok: true, replayed: true });

      const changedBody = await activated.inject({
        method: 'POST',
        url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token),
        payload: { ...payload, expectedRunVersion: payload.expectedRunVersion + 1 },
      });
      expect(changedBody.statusCode).toBe(409);
      expect(changedBody.json()).toMatchObject({ error: 'idempotency-conflict' });

      const changedKey = await activated.inject({
        method: 'POST',
        url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token),
        payload: { ...payload, idempotencyKey: `${payload.idempotencyKey}:different` },
      });
      expect(changedKey.statusCode).toBe(409);
      expect(changedKey.json()).toMatchObject({ error: 'activation-state-changed' });
      expect(runAutomatic).toHaveBeenCalledTimes(1);
      expect(activateManagedRoots).toHaveBeenCalledTimes(1);
    } finally {
      await activated.close();
    }
  });

  it('proves an already-done root before claim and refuses an unproven result without dispatch', async () => {
    const detail = seedActivatableRun();
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:terminal-root`,
    };
    const accepted = await activatedApp(undefined, { completedRoot: true, verifyCanonicalResult: true });
    try {
      const response = await accepted.activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`, headers: headers(token), payload,
      });
      expect(response.statusCode, response.body).toBe(202);
      expect(accepted.verifyCanonicalResult).toHaveBeenCalledWith({
        subject: 'operator', runRef: detail.run.runRef, stageId: 'verify',
      });
      expect(accepted.runAutomatic).toHaveBeenCalledTimes(1);
    } finally { await accepted.activated.close(); }

    const refusedDetail = seedActivatableRun(true, ':terminal-refused');
    const refusedAudit = vi.fn((_root: string, _event: unknown) => ({
      ts: new Date().toISOString(),
    }));
    const refused = await activatedApp(undefined, {
      completedRoot: true,
      verifyCanonicalResult: false,
      appendAudit: refusedAudit,
    });
    try {
      const response = await refused.activated.inject({
        method: 'POST', url: `/api/control/runs/${refusedDetail.run.runRef}/activate`, headers: headers(token),
        payload: { ...payload, expectedRunVersion: refusedDetail.run.version, idempotencyKey: `${payload.idempotencyKey}:refused` },
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json()).toMatchObject({ error: 'completed-root-provenance-refused' });
      expect(refusedAudit).not.toHaveBeenCalled();
      expect(refused.runAutomatic).not.toHaveBeenCalled();
      expect(controlStore.getRunActivationReceipt('operator', refusedDetail.run.runRef, {
        expectedRunVersion: refusedDetail.run.version,
        expectedManagerGeneration: refusedDetail.run.managerGeneration,
        idempotencyKey: `${payload.idempotencyKey}:refused`,
      })).toMatchObject({ ok: true, value: null });
    } finally { await refused.activated.close(); }
  });

  it('refuses direct activation when a waiting run has no durable Human Request boundary', async () => {
    const detail = seedActivatableRun(false);
    const { activated, runAutomatic, activateManagedRoots } = await activatedApp();
    try {
      const response = await activated.inject({
        method: 'POST',
        url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token),
        payload: {
          expectedRunVersion: detail.run.version,
          expectedManagerGeneration: detail.run.managerGeneration,
          idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:${detail.run.proposalHash}:${detail.run.managerGeneration}`,
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: 'human-boundary-unresolved' });
      expect(runAutomatic).not.toHaveBeenCalled();
      expect(activateManagedRoots).not.toHaveBeenCalled();
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true,
        value: { run: { state: 'waiting-human', version: detail.run.version } },
      });
    } finally {
      await activated.close();
    }
  });

  it('rechecks activation CAS after canonical preparation and before any engine dispatch', async () => {
    const detail = seedActivatableRun();
    const { activated, runAutomatic } = await activatedApp(() => {
      const changed = controlStore.transitionRun(
        'operator',
        detail.run.runRef,
        detail.run.version,
        'stopping',
      );
      if (!changed.ok) throw new Error(changed.detail);
    });
    try {
      const response = await activated.inject({
        method: 'POST',
        url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token),
        payload: {
          expectedRunVersion: detail.run.version,
          expectedManagerGeneration: detail.run.managerGeneration,
          idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:${detail.run.proposalHash}:${detail.run.managerGeneration}`,
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: 'canonical-activation-failed',
        detail: 'run activation state changed before canonical root activation',
      });
      expect(runAutomatic).not.toHaveBeenCalled();
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true,
        value: { run: { state: 'stopping', version: detail.run.version + 1 } },
      });
    } finally {
      await activated.close();
    }
  });

  it('does not claim roots or dispatch when asynchronous activation audit persistence rejects', async () => {
    const detail = seedActivatableRun();
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:audit-failure`,
    };
    const { activated, runAutomatic, activateManagedRoots } = await activatedApp(undefined, {
      appendAudit: async () => { throw new Error('audit unavailable'); },
    });
    try {
      const response = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(response.statusCode, response.body).toBe(500);
      expect(response.json()).toMatchObject({ error: 'activation-audit-reconciliation-required' });
      expect(activateManagedRoots).toHaveBeenCalledTimes(1);
      expect(runAutomatic).not.toHaveBeenCalled();
      expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, payload)).toMatchObject({
        ok: true, value: null,
      });
    } finally {
      await activated.close();
    }
  });

  it('serializes stop behind activation so stale stop CAS cannot cancel the newly resumed run', async () => {
    const detail = seedActivatableRun();
    let releasePreparation!: () => void;
    let preparationEntered!: () => void;
    const entered = new Promise<void>((resolve) => { preparationEntered = resolve; });
    const release = new Promise<void>((resolve) => { releasePreparation = resolve; });
    const { activated, cancelAutomatic } = await activatedApp(async () => {
      preparationEntered();
      await release;
    });
    const activationPayload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:stop-race`,
    };
    try {
      const activationPromise = activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload: activationPayload,
      });
      await entered;
      const stopPromise = activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/manager/stop`,
        headers: headers(token),
        payload: {
          expectedRunVersion: detail.run.version,
          expectedManagerGeneration: detail.run.managerGeneration,
          idempotencyKey: `stop:${detail.run.runRef}:${detail.run.version}`,
        },
      });
      await Promise.resolve();
      expect(cancelAutomatic).not.toHaveBeenCalled();
      releasePreparation();
      const [activation, stop] = await Promise.all([activationPromise, stopPromise]);
      expect(activation.statusCode, activation.body).toBe(202);
      expect(stop.statusCode, stop.body).toBe(409);
      expect(stop.json()).toMatchObject({ error: 'run-state-changed' });
      expect(cancelAutomatic).not.toHaveBeenCalled();
    } finally {
      releasePreparation();
      await activated.close();
    }
  });

  it('makes activation and Manager successor mutually exclusive for the same run', async () => {
    const detail = seedActivatableRun();
    const manager = detail.sessions.find((session) => session.sessionRef === detail.run.managerSessionRef);
    if (!manager) throw new Error('manager session missing');
    const interrupted = controlStore.transitionSession('operator', manager.sessionRef, manager.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    let releasePreparation!: () => void;
    let preparationEntered!: () => void;
    const entered = new Promise<void>((resolve) => { preparationEntered = resolve; });
    const release = new Promise<void>((resolve) => { releasePreparation = resolve; });
    const { activated, runAutomatic } = await activatedApp(async () => {
      preparationEntered();
      await release;
    });
    try {
      const activationPromise = activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token),
        payload: {
          expectedRunVersion: detail.run.version,
          expectedManagerGeneration: detail.run.managerGeneration,
          idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:successor-race`,
        },
      });
      await entered;
      const successorPromise = activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/manager/successor`,
        headers: headers(token),
        payload: {
          expectedManagerGeneration: detail.run.managerGeneration,
          runtime: proposal.manager.runtime,
          model: proposal.manager.model,
          idempotencyKey: `successor:${detail.run.runRef}:${detail.run.managerGeneration}`,
        },
      });
      releasePreparation();
      const [activation, successor] = await Promise.all([activationPromise, successorPromise]);
      expect(activation.statusCode, activation.body).toBe(202);
      expect(successor.statusCode, successor.body).toBe(409);
      expect(successor.json()).toMatchObject({ error: 'activation-resume-required' });
      expect(runAutomatic).toHaveBeenCalledTimes(1);
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true,
        value: {
          run: { managerGeneration: detail.run.managerGeneration },
          humanRequests: [{ state: 'resolved' }],
        },
      });
    } finally {
      releasePreparation();
      await activated.close();
    }
  });

  it('dispatches an exact pending activation receipt after process-style recovery', async () => {
    const detail = seedActivatableRun();
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:pending-recovery`,
    };
    expect(controlStore.claimRunActivation('operator', detail.run.runRef, payload)).toMatchObject({
      ok: true, value: { phase: 'claimed', run: { state: 'recovering' } },
    });
    const waiting = controlStore.transitionRun(
      'operator', detail.run.runRef, detail.run.version + 1, 'waiting-human',
    );
    if (!waiting.ok) throw new Error(waiting.detail);
    const { activated, runAutomatic, activateManagedRoots } = await activatedApp();
    try {
      const response = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(response.statusCode, response.body).toBe(202);
      expect(runAutomatic).toHaveBeenCalledTimes(1);
      expect(activateManagedRoots).toHaveBeenCalledTimes(1);
      expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, payload)).toMatchObject({
        ok: true, value: { phase: 'dispatched' },
      });
    } finally {
      await activated.close();
    }
  });

  it('records durable dispatch before returning 202 and contains later executor rejection once', async () => {
    const detail = seedActivatableRun();
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:late-rejection`,
    };
    const { activated, runAutomatic } = await activatedApp(undefined, {
      runAutomatic: async (input) => {
        const current = controlStore.getRun(input.subject, input.runRef);
        if (!current.ok) throw new Error(current.detail);
        const running = controlStore.transitionRun(input.subject, input.runRef, current.value.run.version, 'running');
        if (!running.ok) throw new Error(running.detail);
        input.onManagerStarted?.();
        throw new Error('worker adapter failed after Manager startup');
      },
    });
    try {
      const response = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(response.statusCode, response.body).toBe(202);
      await Promise.resolve();
      await Promise.resolve();
      expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, payload)).toMatchObject({
        ok: true, value: { phase: 'dispatched' },
      });
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true,
        value: {
          run: { state: 'waiting-human' },
          humanRequests: [
            { state: 'resolved' },
            { state: 'open', kind: 'intervention', prompt: 'worker adapter failed after Manager startup' },
          ],
        },
      });
      const replay = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json()).toMatchObject({ ok: true, replayed: true });
      expect(runAutomatic).toHaveBeenCalledTimes(1);
    } finally {
      await activated.close();
    }
  });

  it('cancels and parks the run when durable dispatch acknowledgement cannot be recorded', async () => {
    const detail = seedActivatableRun();
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:dispatch-store-failure`,
    };
    const advance = controlStore.advanceRunActivation.bind(controlStore);
    controlStore.advanceRunActivation = ((subject, runRef, input, phase) =>
      phase === 'dispatched'
        ? { ok: false, reason: 'conflict', detail: 'injected dispatch receipt failure' }
        : advance(subject, runRef, input, phase)) as typeof controlStore.advanceRunActivation;
    const { activated, containManagerStart } = await activatedApp();
    try {
      const response = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json()).toMatchObject({
        error: 'automatic-dispatch-failed',
        detail: 'injected dispatch receipt failure',
      });
      expect(containManagerStart).toHaveBeenCalledTimes(1);
      expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, payload)).toMatchObject({
        ok: true, value: { phase: 'failed' },
      });
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true,
        value: {
          run: { state: 'waiting-human' },
          humanRequests: [
            { state: 'resolved' },
            {
              state: 'open',
              kind: 'intervention',
              title: 'Activation dispatch needs reconciliation',
              prompt: 'injected dispatch receipt failure',
            },
          ],
        },
      });
    } finally {
      controlStore.advanceRunActivation = advance;
      await activated.close();
    }
  });

  it('times out a hung Manager start, contains it, and releases the run-control lock for stop', async () => {
    const detail = seedActivatableRun();
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:manager-timeout`,
    };
    const { activated, cancelAutomatic, containManagerStart } = await activatedApp(undefined, {
      managerStartAckTimeoutMs: 10,
      runAutomatic: async () => new Promise<never>(() => {}),
    });
    try {
      const response = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json()).toMatchObject({
        error: 'automatic-dispatch-failed',
        detail: 'Manager startup was not durably acknowledged within 10ms',
      });
      expect(containManagerStart).toHaveBeenCalledTimes(1);
      const contained = controlStore.getRun('operator', detail.run.runRef);
      if (!contained.ok) throw new Error(contained.detail);
      expect(contained.value.run.state).toBe('waiting-human');
      const stopped = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/manager/stop`,
        headers: headers(token),
        payload: {
          expectedRunVersion: contained.value.run.version,
          expectedManagerGeneration: contained.value.run.managerGeneration,
          idempotencyKey: `stop:${detail.run.runRef}:${contained.value.run.version}`,
        },
      });
      expect(stopped.statusCode, stopped.body).toBe(200);
      expect(cancelAutomatic).toHaveBeenCalledTimes(1);
    } finally {
      await activated.close();
    }
  });

  it('fails the receipt before awaiting cancellation so a late Manager callback cannot dispatch', async () => {
    const detail = seedActivatableRun();
    let releaseManagerAck!: () => void;
    let cancellationEntered!: () => void;
    let releaseCancellation!: () => void;
    const managerAck = new Promise<void>((resolve) => { releaseManagerAck = resolve; });
    const cancellationStarted = new Promise<void>((resolve) => { cancellationEntered = resolve; });
    const cancellationHeld = new Promise<void>((resolve) => { releaseCancellation = resolve; });
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:late-manager-ack`,
    };
    const { activated } = await activatedApp(undefined, {
      managerStartAckTimeoutMs: 10,
      runAutomatic: async (input) => {
        const current = controlStore.getRun(input.subject, input.runRef);
        if (!current.ok) throw new Error(current.detail);
        const running = controlStore.transitionRun(input.subject, input.runRef, current.value.run.version, 'running');
        if (!running.ok) throw new Error(running.detail);
        await managerAck;
        input.onManagerStarted?.();
        return { state: 'running', startedStageIds: [], completedStageIds: [], waitingStageIds: [] };
      },
      containManagerStart: async () => {
        cancellationEntered();
        await cancellationHeld;
      },
    });
    try {
      const activation = activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      await cancellationStarted;
      expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, payload)).toMatchObject({
        ok: true, value: { phase: 'failed' },
      });
      releaseManagerAck();
      await Promise.resolve();
      releaseCancellation();
      const response = await activation;
      expect(response.statusCode, response.body).toBe(409);
      expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, payload)).toMatchObject({
        ok: true, value: { phase: 'failed' },
      });
      const replay = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(replay.statusCode, replay.body).toBe(409);
      expect(replay.json()).toMatchObject({ error: 'activation-failed' });
    } finally {
      releaseManagerAck();
      releaseCancellation();
      await activated.close();
    }
  });

  it('bounds hung activation cancellation and still releases the run-control lock', async () => {
    const detail = seedActivatableRun();
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:hung-cancellation`,
    };
    const { activated } = await activatedApp(undefined, {
      managerStartAckTimeoutMs: 5,
      runAutomatic: async () => new Promise<never>(() => {}),
      containManagerStart: async () => new Promise<never>(() => {}),
    });
    try {
      const activation = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(activation.statusCode, activation.body).toBe(409);
      const contained = controlStore.getRun('operator', detail.run.runRef);
      if (!contained.ok) throw new Error(contained.detail);
      expect(contained.value.run.state).toBe('waiting-human');
      expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, payload)).toMatchObject({
        ok: true, value: { phase: 'failed' },
      });
      const stop = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/manager/stop`,
        headers: headers(token),
        payload: {
          expectedRunVersion: contained.value.run.version,
          expectedManagerGeneration: contained.value.run.managerGeneration,
          idempotencyKey: `stop:${detail.run.runRef}:${contained.value.run.version}`,
        },
      });
      expect(stop.statusCode, stop.body).toBe(200);
    } finally {
      await activated.close();
    }
  });

  it('accepts stored assigned snapshots through publication reconciliation and activation validation', async () => {
    const managerAssignment = {
      agentId: 'assigned-manager', declarationPath: 'agents/assigned-manager.md', declarationHash: 'e'.repeat(64),
      profileId: 'manager:claude:claude-opus-4-8', runtime: 'claude' as const, model: 'claude-opus-4-8',
    };
    const workerAssignment = {
      agentId: 'assigned-worker', declarationPath: 'agents/assigned-worker.md', declarationHash: 'f'.repeat(64),
      profileId: 'worker:codex:gpt-5.6-sol', runtime: 'codex' as const, model: 'gpt-5.6-sol',
    };
    const assigned = {
      ...proposal,
      manager: { ...proposal.manager, assignment: managerAssignment },
      stages: proposal.stages.map((stage, index) => index === 0 ? { ...stage, assignment: workerAssignment } : stage),
    };
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'assigned-lifecycle', sourceTurnId: 'assigned-lifecycle-turn', title: assigned.title,
      snapshot: assigned as unknown as import('./types.ts').JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, 1, {
      expectedHash: stored.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-assigned-lifecycle',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const create = (idempotencyKey: string) => controlStore.createRun('operator', {
      title: assigned.title, proposalRef: stored.value.proposalRef, proposalRevision: 1, expectedProposalHash: stored.value.hash,
      managerRuntime: assigned.manager.runtime, managerModel: assigned.manager.model, managerAssignment, idempotencyKey,
      stages: assigned.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn, assignment: stage.assignment ?? null })),
    });

    const publishingRun = create('assigned-reconcile');
    if (!publishingRun.ok) throw new Error(publishingRun.detail);
    const publishing = controlStore.transitionPublication('operator', publishingRun.value.run.runRef, publishingRun.value.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const reconciled = await app.inject({
      method: 'POST', url: `/api/control/runs/${publishingRun.value.run.runRef}/reconcile-publication`, headers: headers(token),
      payload: { expectedRunVersion: publishing.value.version },
    });
    // The fixture deliberately has no on-disk canonical cards. Reaching that honest recovery error
    // proves the stored compiler snapshot passed semantic validation first.
    expect(reconciled.statusCode).toBe(409);
    expect(reconciled.json()).toMatchObject({ error: 'missing-card' });
    expect(reconciled.json().error).not.toBe('stored-proposal-invalid');

    const activationRun = create('assigned-activate');
    if (!activationRun.ok) throw new Error(activationRun.detail);
    const pub1 = controlStore.transitionPublication('operator', activationRun.value.run.runRef, activationRun.value.run.version, 'publishing');
    if (!pub1.ok) throw new Error(pub1.detail);
    const pub2 = controlStore.transitionPublication('operator', activationRun.value.run.runRef, pub1.value.version, 'published');
    if (!pub2.ok) throw new Error(pub2.detail);
    const waiting = controlStore.transitionRun('operator', activationRun.value.run.runRef, pub2.value.version, 'waiting-human');
    if (!waiting.ok) throw new Error(waiting.detail);
    const activationRequest = controlStore.createHumanRequest('operator', activationRun.value.run.runRef, {
      kind: 'intervention', title: 'Activation review', prompt: 'Acknowledge before activation.',
    });
    if (!activationRequest.ok) throw new Error(activationRequest.detail);
    const activationResponse = controlStore.respondHumanRequest('operator', activationRequest.value.requestRef, {
      expectedRevision: activationRequest.value.revision,
      decision: 'responded',
      idempotencyKey: 'assigned-activation-response',
    });
    if (!activationResponse.ok) throw new Error(activationResponse.detail);
    const activationApp = Fastify();
    registerWriteSurface(activationApp, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)), sessionConfig: SESSION,
      allowedOrigins: [ORIGIN], credentials: () => [], composerStore, controlStore,
      controlBroker: { isRunning: () => false, drain: () => {} } as never,
      runAutomatic: (async () => ({ ok: true })) as never,
      containManagerStart: async () => {},
      appendAudit: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      appendAuditLocal: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
      opsGit: (_root, args) => args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n' : args.join(' ') === 'rev-parse HEAD' ? 'a'.repeat(40) : '',
    }));
    await activationApp.ready();
    try {
      const activated = await activationApp.inject({
        method: 'POST', url: `/api/control/runs/${activationRun.value.run.runRef}/activate`, headers: headers(token),
        payload: { expectedRunVersion: waiting.value.version, expectedManagerGeneration: 1, idempotencyKey: 'assigned-activate' },
      });
      // No root card is linked in this fixture, but the route must get past its stored assignment
      // validation before reporting that separate lifecycle boundary.
      expect(activated.statusCode).toBe(409);
      expect(activated.json()).toMatchObject({ error: 'managed-root-card-binding-lost' });
      expect(activated.json().error).not.toBe('stored-proposal-invalid');
    } finally { await activationApp.close(); }
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

/**
 * The runtime execution latch routes. The daemon boots LOCKED, so a launch refusal must be distinct
 * enough for the UI to raise an unlock prompt, unlock must require a fresh purpose-bound passkey
 * assertion (a session bearer alone is never enough), and Lock must be reachable with the session only.
 */
describe('control execution latch routes', () => {
  const TEST_WEBAUTHN = () => ({ rpID: 'localhost', rpName: 'test', origin: ORIGIN });

  function fakeLatch(initial: 'locked' | 'unlocked') {
    let state = initial === 'locked'
      ? { state: 'locked' as const, source: null, unlockedAt: null, unlockedBy: null }
      : { state: 'unlocked' as const, source: 'passkey' as const, unlockedAt: '2026-07-30T00:00:00.000Z', unlockedBy: 'operator' };
    const unlock = vi.fn(() => ({ ok: true as const, state }));
    const lock = vi.fn(() => {
      state = { state: 'locked' as const, source: null, unlockedAt: null, unlockedBy: null };
      return state;
    });
    return {
      latch: {
        snapshot: () => state,
        current: () => null,
        unlock,
        lock,
      },
      unlock,
      lock,
    };
  }

  function buildApp(overrides: Record<string, unknown> = {}) {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `latch-${++n}`; })() });
    const audit: Array<Record<string, unknown>> = [];
    const app = Fastify();
    const ctx = makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../../', import.meta.url)),
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      controlStore: store,
      webAuthnConfig: TEST_WEBAUTHN,
      credentials: () => [],
      appendAudit: (_root: string, event: Record<string, unknown>) => {
        audit.push(event);
        return { ts: '2026-07-30T00:00:00.000Z', action: String(event.action) } as never;
      },
      opsGit: () => ({ stdout: '', stderr: '', exitCode: 0 }),
      ...overrides,
    } as never);
    registerWriteSurface(app, ctx);
    return { app, ctx, store, audit, token: mintSession('operator', SESSION).token };
  }

  /** Seed one approved run in the store so a route reaches its execution-posture check. */
  function seedRun(store: ReturnType<typeof createInMemoryControlPlaneStore>, key: string): string {
    const created = store.createProposalRevision('operator', {
      sourceComposerRef: 'composer-1', sourceTurnId: 'video-run', title: `Run ${key}`,
      snapshot: proposal as unknown as JsonObject,
    });
    if (!created.ok) throw new Error(created.detail);
    if (!store.decideProposal('operator', created.value.proposalRef, 1, {
      expectedHash: created.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: `${key}-approve`,
    }).ok) throw new Error('approval failed');
    const run = store.createRun('operator', {
      title: `Run ${key}`, proposalRef: created.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: created.value.hash, managerRuntime: 'claude', managerModel: 'claude-fable-5',
      idempotencyKey: `${key}-launch`,
      stages: proposal.stages.map((item) => ({ stageId: item.id, title: item.title, dependsOn: item.dependsOn })),
    });
    if (!run.ok) throw new Error(run.detail);
    return run.value.run.runRef;
  }

  it('boots LOCKED and reports the posture with the unlock route to call', async () => {
    const { app, token } = buildApp();
    try {
      const posture = await app.inject({ method: 'GET', url: '/api/control/execution', headers: headers(token) });
      expect(posture.statusCode).toBe(200);
      expect(posture.json()).toMatchObject({
        execution: { state: 'locked', source: null, unlockRoute: '/api/control/execution/unlock' },
      });
      // Unauthenticated callers learn nothing about the posture.
      const anonymous = await app.inject({ method: 'GET', url: '/api/control/execution', headers: { origin: ORIGIN, host: 'localhost:5317' } });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('refuses a launch/activate while locked with the distinct unlock-prompt refusal', async () => {
    const { app, token, store } = buildApp();
    try {
      const runRef = seedRun(store, 'locked-activate');
      const activate = await app.inject({
        method: 'POST', url: `/api/control/runs/${runRef}/activate`, headers: headers(token),
        payload: { idempotencyKey: 'k', expectedRunVersion: 1, expectedManagerGeneration: 1 },
      });
      expect(activate.statusCode).toBe(409);
      expect(activate.json()).toMatchObject({
        error: 'execution-locked',
        execution: { state: 'locked', unlockRoute: '/api/control/execution/unlock' },
      });
      const stop = await app.inject({
        method: 'POST', url: `/api/control/runs/${runRef}/manager/stop`, headers: headers(token),
        payload: { idempotencyKey: 'k', expectedRunVersion: 1, expectedManagerGeneration: 1 },
      });
      expect(stop.statusCode).toBe(409);
      expect(stop.json()).toMatchObject({ error: 'execution-locked' });
    } finally {
      await app.close();
    }
  });

  it('issues a PURPOSE-BOUND unlock ceremony and refuses a sign-in ceremony at the unlock route', async () => {
    const { app, token } = buildApp();
    try {
      const options = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock/options', headers: headers(token), payload: {},
      });
      expect(options.statusCode).toBe(200);
      const body = options.json() as { ceremonyId: string; options: { challenge: string; userVerification: string } };
      expect(typeof body.ceremonyId).toBe('string');
      // The authenticator signs over "unlock execution for THIS operator", not a bare login nonce.
      const preimage = Buffer.from(body.options.challenge, 'base64url').toString('utf8');
      expect(preimage.startsWith('kb.execution-unlock:operator:')).toBe(true);
      expect(body.options.userVerification).toBe('required');

      // A LOGIN ceremony cannot be redeemed at the unlock route even though it is fresh and single-use.
      const login = await app.inject({ method: 'POST', url: '/api/auth/assert/options', headers: headers(token), payload: {} });
      const loginCeremony = (login.json() as { ceremonyId: string }).ceremonyId;
      const crossed = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock', headers: headers(token),
        payload: { ceremonyId: loginCeremony, response: { id: 'cred-1' } },
      });
      expect(crossed.statusCode).toBe(400);
      expect(crossed.json()).toMatchObject({ error: 'bad-ceremony' });
    } finally {
      await app.close();
    }
  });

  it('never unlocks without a verified assertion: no credential, unknown ceremony, or replay all fail closed', async () => {
    const { latch, unlock } = fakeLatch('locked');
    const { app, token } = buildApp({ executionLatch: latch });
    try {
      // Unknown ceremony → refused before any credential lookup.
      const unknown = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock', headers: headers(token),
        payload: { ceremonyId: 'never-issued', response: { id: 'cred-1' } },
      });
      expect(unknown.statusCode).toBe(400);

      // Real ceremony, but the credential store is fail-closed empty (the pre-passkey reality).
      const options = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock/options', headers: headers(token), payload: {},
      });
      const ceremonyId = (options.json() as { ceremonyId: string }).ceremonyId;
      const attempt = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock', headers: headers(token),
        payload: { ceremonyId, response: { id: 'cred-1' } },
      });
      expect(attempt.statusCode).toBe(401);
      expect(attempt.json()).toMatchObject({ error: 'unauthenticated' });

      // The same ceremony cannot be replayed (single-use), and the latch was never asked to unlock.
      const replay = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock', headers: headers(token),
        payload: { ceremonyId, response: { id: 'cred-1' } },
      });
      expect(replay.statusCode).toBe(400);
      expect(unlock).not.toHaveBeenCalled();
      expect(latch.snapshot().state).toBe('locked');
    } finally {
      await app.close();
    }
  });

  it('locks on request, audits the transition, and reports the new posture', async () => {
    const { latch, lock } = fakeLatch('unlocked');
    const { app, token, audit } = buildApp({ executionLatch: latch });
    try {
      const before = await app.inject({ method: 'GET', url: '/api/control/execution', headers: headers(token) });
      expect(before.json()).toMatchObject({ execution: { state: 'unlocked', source: 'passkey', unlockedBy: 'operator' } });

      const locked = await app.inject({ method: 'POST', url: '/api/control/execution/lock', headers: headers(token), payload: {} });
      expect(locked.statusCode).toBe(200);
      expect(locked.json()).toMatchObject({ ok: true, execution: { state: 'locked' } });
      expect(lock).toHaveBeenCalledWith({ subject: 'operator' });
      expect(audit.map((row) => row.action)).toContain('control-execution-lock-authorize');

      // Session required, like every other control write.
      const anonymous = await app.inject({
        method: 'POST', url: '/api/control/execution/lock', headers: { origin: ORIGIN, host: 'localhost:5317' }, payload: {},
      });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('serves roster state and the execution posture on the run detail the canvas reads', async () => {
    const roster = [{ agentId: 'fyt-visuals', sessionId: 'pty-roster-2', status: 'blocked', activity: 'blocked: g2 awaiting approval', waitingOn: ['g2-visual-plan'] }];
    const { latch } = fakeLatch('unlocked');
    const { app, token, store } = buildApp({
      executionLatch: latch,
      rosterSessions: { state: () => roster, hasRoster: () => true, ensureRoster: () => ({ runRef: 'r', spawned: [], existing: [] }), deliver: async () => ({}), retire: () => [], retireAll: () => [] },
    });
    try {
      const runRef = seedRun(store, 'roster');

      const detail = await app.inject({
        method: 'GET', url: `/api/control/runs/${runRef}`, headers: headers(token),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        ok: true,
        roster,
        execution: { state: 'unlocked' },
        value: { run: { runRef } },
      });

      // A missing run still 404s (the roster projection never invents a run).
      const missing = await app.inject({ method: 'GET', url: '/api/control/runs/run-absent', headers: headers(token) });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('reports an empty roster while execution is locked', async () => {
    const { app, token, store } = buildApp();
    try {
      const runRef = seedRun(store, 'locked-roster');
      const detail = await app.inject({
        method: 'GET', url: `/api/control/runs/${runRef}`, headers: headers(token),
      });
      expect(detail.json()).toMatchObject({ roster: [], execution: { state: 'locked' } });
    } finally {
      await app.close();
    }
  });
});

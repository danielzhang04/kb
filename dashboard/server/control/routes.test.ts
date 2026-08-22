import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { createInMemoryComposerStore } from '../composer/store.ts';
import { makeSurfaceContext as makeProductionSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from './store.ts';
import type { ControlPlaneStore } from './store.ts';
import { createLeasedFileStoreForTest } from './test-fixtures/controlStore.ts';
import type { PlanProposal } from './proposal.ts';
import type { TimelineModel } from '../../src/lib/timelineModel.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import { ManagedSessionBroker } from './broker.ts';
import { createSubjectBrokerPersistence } from './brokerStore.ts';
import type { JsonObject, Run } from './types.ts';
import type { ExecuteRunInput } from './execution.ts';
import type { SurfaceContext } from '../http/context.ts';
import {
  authorizedFailedRunReconciliationGrant,
  authorizedFailedRunReconciliationRefusal,
  authorizedFailedRunReconciliationWireBody,
} from './routes.ts';
import { AuthorizedFailedRunPublishedUncommittedError } from './authorizedFailedRunReconciliation.ts';
import { createAttemptIoStore } from './attemptIo.ts';
import { createBus } from '../hub/bus.ts';
import { executeApprovedLaunch } from './launch.ts';
import { admit } from './admission.ts';
import * as publication from './publication.ts';
import { normalizedTextSha256 } from './textArtifactHash.ts';

const SESSION: SessionConfig = { secret: Buffer.from('control-route-test-secret-32-bytes!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';

function makeSurfaceContext(
  overrides: Parameters<typeof makeProductionSurfaceContext>[0] = {},
  activation: Parameters<typeof makeProductionSurfaceContext>[1] = {},
) {
  return makeProductionSurfaceContext({ controlStore: createInMemoryControlPlaneStore(), ...overrides }, activation);
}

describe('authorized failed-run route grant', () => {
  function exactContext(liveSession = false): SurfaceContext {
    const controlBroker = { isRunning: () => liveSession };
    const runAutomatic = vi.fn();
    const cancelAutomatic = vi.fn();
    const containManagerStart = vi.fn();
    const verifyCanonicalResult = vi.fn();
    const wiring = {
      controlBroker, runAutomatic, cancelAutomatic, containManagerStart, verifyCanonicalResult,
    };
    const executionLatch = {
      snapshot: () => ({ state: 'unlocked', source: 'passkey', unlockedBy: 'operator', unlockedAt: '2026-08-01T04:00:00.000Z' }),
      current: () => wiring,
    };
    return {
      executionLatch, controlBroker, runAutomatic, cancelAutomatic,
      containManagerStart, verifyCanonicalResult,
    } as unknown as SurfaceContext;
  }

  function withSource(source: 'passkey' | 'tailnet' | 'env-override'): SurfaceContext {
    const ctx = exactContext();
    const wiring = ctx.executionLatch!.current();
    (ctx.executionLatch as unknown as { snapshot: () => unknown }).snapshot = () => ({
      state: 'unlocked', source, unlockedBy: 'operator', unlockedAt: '2026-08-01T04:00:00.000Z',
    });
    void wiring;
    return ctx;
  }

  it('refuses a context whose in-place broker identity differs from the captured wiring', () => {
    const ctx = exactContext();
    ctx.controlBroker = { isRunning: () => false } as unknown as NonNullable<SurfaceContext['controlBroker']>;
    expect(authorizedFailedRunReconciliationGrant(ctx, 'operator')).toBeNull();
  });

  it('RULING 2: accepts the grant under the tailnet operator identity, not only a passkey unlock', () => {
    expect(authorizedFailedRunReconciliationGrant(withSource('tailnet'), 'operator')).not.toBeNull();
    expect(authorizedFailedRunReconciliationGrant(withSource('passkey'), 'operator')).not.toBeNull();
  });

  it('RULING 2: still refuses a headless env-override arm — break-glass is operator-only', () => {
    expect(authorizedFailedRunReconciliationGrant(withSource('env-override'), 'operator')).toBeNull();
  });

  it('refuses an otherwise exact passkey grant while any fixed run session is live', () => {
    expect(authorizedFailedRunReconciliationGrant(exactContext(true), 'operator')).toBeNull();
  });

  it('reports a published-but-unfinalized settlement as its own code, never as a refusal', () => {
    const published = authorizedFailedRunReconciliationRefusal(
      new AuthorizedFailedRunPublishedUncommittedError('a'.repeat(40), new Error('control-plane commit failed')),
    );
    expect(published.error).toBe('authorized-failed-run-reconciliation-published-uncommitted');
    expect(published.detail).toMatch(/published on origin\/ops/);
    expect(published.detail).toMatch(/re-invoke/);
    // Nothing internal leaks, and a genuine refusal keeps its own code.
    expect(published.detail).not.toMatch(/control-plane commit failed/);
    expect(authorizedFailedRunReconciliationRefusal(new Error('a proof did not hold'))).toEqual({
      error: 'authorized-failed-run-reconciliation-refused',
      detail: 'a required reconciliation safety proof did not hold',
    });
  });
});

const proposal: PlanProposal = {
  schema: 'kb.plan-proposal/v1', proposalId: 'control-route', project: 'kb-ops', title: 'Control route',
  summary: 'Import and review an immutable proposal.',
  manager: { runtime: 'claude', model: 'claude-opus-5', requiredSkills: [] },
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
    index: 0, model: 'claude-opus-5', timestamp: null, usage: null,
    steps: [{ kind: 'text', text: `Proposal follows.\n\n\`\`\`kb.plan-proposal/v1\n${JSON.stringify(value)}\n\`\`\`` }],
  }] };
}

function headers(token: string) {
  return { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for (let chunk = 0; chunk < 20; chunk += 1) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timed out waiting for SSE frame')), 1_000);
      }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
    if (predicate(text)) return text;
  }
  throw new Error(`SSE predicate not reached: ${text}`);
}

function expectExactWireRun(
  actual: Record<string, unknown>,
  source: { lifecycle: { kind: string } } & Record<string, unknown>,
  additions: Record<string, unknown> = {},
): void {
  const { lifecycle, ...rest } = source;
  expect(actual).toEqual({ ...rest, state: lifecycle.kind, ...additions });
  expect(typeof actual.state).toBe('string');
  expect(Object.hasOwn(actual, 'lifecycle')).toBe(false);
}

it('pins the failed-run reconciliation success wire shape', () => {
  const run: Run = {
    owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
    executionHost: 'desktop', terminalOutcome: 'failed',
    completedAt: '2026-08-01T01:00:00.000Z', archivedFrom: null,
    runRef: 'run-reconciled', predecessorRunRef: null, title: 'Reconciled run',
    proposalRef: 'proposal-reconciled', proposalRevision: 1, proposalHash: 'a'.repeat(64),
    publicationState: 'published', lifecycle: { kind: 'failed', deployPause: null }, version: 8,
    managerSessionRef: 'manager-reconciled', managerGeneration: 1, managerAssignment: null,
    agentWorkspaceLaunch: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T01:00:00.000Z',
  };
  const body = authorizedFailedRunReconciliationWireBody({
    result: { run, event: { cursor: 6 }, receipt: { phase: 'committed' } },
    replayed: false,
    canonicalCommit: 'c'.repeat(40),
  } as never);
  const { lifecycle: _lifecycle, ...wireRun } = run;
  expect(body).toEqual({
    ok: true,
    value: { run: { ...wireRun, state: 'failed' }, event: { cursor: 6 }, receipt: { phase: 'committed' } },
    replayed: false,
    canonicalCommit: 'c'.repeat(40),
  });
  expectExactWireRun(body.value.run, run as unknown as { lifecycle: { kind: string } } & Record<string, unknown>);
});

describe('control proposal routes', () => {
  let app: ReturnType<typeof Fastify>;
  let composerStore: ReturnType<typeof createInMemoryComposerStore>;
  let controlStore: ReturnType<typeof createInMemoryControlPlaneStore>;
  let composerRef: string;
  let turnId: string;
  let token: string;
  let routingWrites: Array<{ cardId: string; runtime: string; model: string }>;
  let auditRows: Array<Record<string, unknown>>;
  let stateRoot: string;

  beforeEach(async () => {
    let id = 0;
    const newId = () => `ref-${++id}`;
    composerStore = createInMemoryComposerStore({
      protector: { seal: (value) => value, open: (value) => value }, newId,
    });
    controlStore = createInMemoryControlPlaneStore({ newId });
    const workspace = composerStore.create('operator', 'Control', {
      id: 'grader', path: 'agents/grader.md',
      sourceHash: normalizedTextSha256(readFileSync(fileURLToPath(new URL('../../../agents/grader.md', import.meta.url)))),
      projects: ['kb'], instructionMarkdown: 'Grade the assigned work.',
    });
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
    stateRoot = mkdtempSync(join(tmpdir(), 'control-routes-state-'));
    let headReads = 0;
    app = Fastify();
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)),
      stateRoot,
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

  afterEach(async () => { await app.close(); rmSync(stateRoot, { recursive: true, force: true }); });

  it('launch passes the exact compiler-owned iteration group snapshot to createRun', async () => {
    const iterationGroups: NonNullable<PlanProposal['iterationGroups']> = [{
      iterationGroupId: 'verify-report', goal: 'Accept the verification result.',
      participants: [
        { participantId: 'verifier', stageRef: 'verify', role: 'contributor', perspective: 'Produce evidence.', mandate: 'Run focused tests.' },
        { participantId: 'reporter', stageRef: 'report', role: 'judge', perspective: 'Assess evidence.', mandate: 'Check the report.' },
      ],
      routes: [
        { routeId: 'to-report', senderParticipantId: 'verifier', recipientParticipantId: 'reporter', requestKinds: ['review'], baseResolutionStageIds: ['verify'] },
        { routeId: 'to-verify', senderParticipantId: 'reporter', recipientParticipantId: 'verifier', requestKinds: ['rework'], baseResolutionStageIds: ['report'] },
      ],
      activation: { seedParticipantId: 'verifier', seedArtifactIds: ['verification'] }, initialStepId: 'review',
      schedule: [
        { stepId: 'review', routeId: 'to-report', after: { stepId: 'rework', participantId: 'verifier', verdict: 'fulfilled' }, cycle: 'next' },
        { stepId: 'rework', routeId: 'to-verify', after: { stepId: 'review', participantId: 'reporter', verdict: 'fail' }, cycle: 'current' },
      ],
      artifacts: ['verification'], criteria: [{ id: 'green', description: 'Focused tests are green.' }],
      maxCycles: 2, cycleUnit: 'One verification and report verdict.', terminalAuthorities: [{ participantId: 'reporter', verdict: 'pass' }],
    }];
    const snapshot: PlanProposal = {
      ...structuredClone(proposal), iterationGroups: structuredClone(iterationGroups),
      stages: proposal.stages.map((stage) => stage.id === 'verify'
        ? { ...structuredClone(stage), artifacts: [{ id: 'verification', path: 'dashboard/server/control/verification.txt', description: 'Verification evidence.' }] }
        : structuredClone(stage)),
    };
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: composerRef, sourceTurnId: 'iteration-launch-turn', title: snapshot.title,
      snapshot: snapshot as unknown as JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, 1, {
      expectedHash: stored.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-iteration-launch',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const createRun = vi.spyOn(controlStore, 'createRun');
    const launched = await app.inject({
      method: 'POST', url: `/api/control/proposals/${stored.value.proposalRef}/revisions/1/launch`, headers: headers(token),
      payload: { expectedHash: stored.value.hash, idempotencyKey: 'launch-iteration-snapshot' },
    });
    // This surface's narrow subprocess stub intentionally does not emulate the workflow-card batch
    // publisher; the assertion is on the launch/store boundary immediately before that later seam.
    expect(launched.statusCode, launched.body).toBe(500);
    expect(createRun).toHaveBeenCalledOnce();
    expect(createRun.mock.calls[0]?.[1].iterationGroups).toEqual(iterationGroups);
  });

  it('refuses every non-exact historical reconciliation body before any audit, proposal, or filesystem runner', async () => {
    const base = {
      expectedRunVersion: 7, expectedManagerGeneration: 1, expectedRequestRevision: 2, expectedNextEventCursor: 6,
      expectedProposalHash: '396480363d02620c25730160e00fd7adf51e1eff43f8427c80b2062a18dc80d9',
      idempotencyKey: 'reconcile:2026-08-01:run-0aa72053-b9d7-41fa-a034-19871b66d214:failed-launch:v7',
    };
    for (const body of [
      { ...base, unexpected: true },
      { ...base, expectedRunVersion: 8 },
      { ...base, expectedManagerGeneration: 2 },
      { ...base, expectedRequestRevision: 3 },
      { ...base, expectedNextEventCursor: 7 },
      { ...base, expectedProposalHash: 'f'.repeat(64) },
      { ...base, idempotencyKey: 'different-key' },
    ]) {
      const response = await app.inject({
        method: 'POST', url: '/api/control/recovery/2026-08-01/failed-run-reconciliation', headers: headers(token), payload: body,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: 'authorized-failed-run-reconciliation-cas-mismatch' });
    }
    expect(auditRows).toEqual([]);
    expect(routingWrites).toEqual([]);
  });


  function iterationGateFixture(reason: 'exhausted' | 'no-progress' | 'parked', suffix = reason) {
    const requestRef = `request-iteration-${suffix}`;
    const loopRef = `loop-iteration-${suffix}`;
    const iterationRequest = {
      schema: 'kb.iteration-request/v1', requestRef: `turn-${suffix}`, iterationLoopRef: loopRef,
      stepId: 'review-step', routeId: 'author-to-judge', senderParticipantId: 'author', recipientParticipantId: 'judge',
      kind: 'review', cycle: 2, inputGenerationRefs: [`generation-${suffix}`], baseCommit: 'a'.repeat(40),
      artifactHashes: { draft: 'b'.repeat(64) }, criteria: [{ id: 'grounded', description: 'Grounded.' }],
      unresolvedFindingRefs: ['finding-open'], preservedInvariants: ['Keep citations.'],
      nextAcceptanceCheck: 'Recheck grounding.', instructions: 'Review the draft.',
    };
    const attemptedOutcome = {
      schema: 'kb.iteration-outcome/v1', requestRef: iterationRequest.requestRef, iterationLoopRef: loopRef,
      participantId: 'judge', cycle: 2, verdict: 'fail', inputGenerationRefs: [...iterationRequest.inputGenerationRefs],
      criteria: [{ criterionId: 'grounded', verdict: 'fail', findingIds: ['finding-open'] }],
      findings: [{ findingId: 'finding-open', criterionId: 'grounded', severity: 'blocking', summary: 'Citation missing.', evidencePaths: ['draft.md'] }],
      positions: [{ positionId: 'judge-position', participantId: 'judge', summary: 'Not grounded.', generationRefs: [...iterationRequest.inputGenerationRefs] }],
      recordedDissent: [{ dissentId: 'author-dissent', participantId: 'author', positionId: 'judge-position', summary: 'Source is sufficient.' }],
      summary: 'The draft still needs a citation.',
    };
    const receipt = reason === 'no-progress' ? null : {
      ...attemptedOutcome, schema: 'kb.iteration-receipt/v1', receiptRef: `receipt-${suffix}`,
      outcomeHash: 'c'.repeat(64), outputGenerationRefs: [], baseCommit: 'a'.repeat(40), canonicalCommit: 'd'.repeat(40),
      createdAt: '2026-08-13T12:00:00.000Z', completionRequestRef: null, interventionRequestRef: requestRef,
      // Deliberately unrelated to the park reason: the route must read this CAS value, never infer it.
      version: 17,
    };
    const request = {
      requestRef, runRef: 'run-iteration', stageRef: 'stage-judge', kind: 'approval', gateKind: 'iteration-park',
      revision: 3, state: 'open', title: 'Iteration parked', prompt: 'Approve exact parked artifacts or decline. Separate relaunch is the only continuation.',
      response: null, createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z',
    };
    const loop = {
      iterationLoopRef: loopRef, runRef: 'run-iteration', definitionHash: 'e'.repeat(64), iterationGroupId: 'draft-loop',
      goal: 'Publish a grounded draft.', participants: [
        { participantId: 'author', stageRef: 'author', role: 'contributor', perspective: 'Clarity.', mandate: 'Write the draft.' },
        { participantId: 'judge', stageRef: 'judge', role: 'judge', perspective: 'Evidence.', mandate: 'Verify grounding.' },
      ], routes: [
        { routeId: 'author-to-judge', senderParticipantId: 'author', recipientParticipantId: 'judge', requestKinds: ['review'], baseResolutionStageIds: ['author'] },
        { routeId: 'judge-to-author', senderParticipantId: 'judge', recipientParticipantId: 'author', requestKinds: ['rework'], baseResolutionStageIds: ['judge'] },
      ], activation: { seedParticipantId: 'author', seedArtifactIds: ['draft'] }, initialStepId: 'review-step',
      schedule: [{ stepId: 'review-step', routeId: 'author-to-judge', cycle: 'next' }], artifacts: ['draft'],
      criteria: [{ id: 'grounded', description: 'Grounded.' }], maxCycles: 2, cycleUnit: 'One author and judge round.',
      terminalAuthorities: [{ participantId: 'judge', verdict: 'pass' }], cyclesUsed: 1, state: 'awaiting-park-gate',
      activeGenerationRefs: [`generation-${suffix}`], acceptedGenerationRefs: ['generation-accepted'], lastReceiptRef: receipt?.receiptRef,
      interventionRef: requestRef, parkReason: reason, unresolvedResidue: {
        unresolvedFindings: attemptedOutcome.findings, positions: attemptedOutcome.positions, recordedDissent: attemptedOutcome.recordedDissent,
        requestRefs: [iterationRequest.requestRef], receiptRefs: receipt ? [receipt.receiptRef] : [],
        activeGenerationRefs: [`generation-${suffix}`], acceptedGenerationRefs: ['generation-accepted'], nextRouteId: 'judge-to-author',
        cycleUnit: 'One author and judge round.', cyclesUsed: 1, maxCycles: 2,
        ...(reason === 'no-progress' ? {
          attemptedRequestRef: iterationRequest.requestRef, attemptedOutcome,
          artifactSnapshots: [{ path: 'draft.md', regularFile: true, size: 12, sha256: 'f'.repeat(64), afterRegularFile: true, afterSize: 12, afterSha256: 'f'.repeat(64), byteIdentical: true }],
          failureReason: 'required output draft.md was byte-identical',
        } : {}),
      }, version: 6, createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z',
    };
    return { request, loop, iterationRequest, receipt };
  }

  function mockIterationGate(reason: 'exhausted' | 'no-progress' | 'parked') {
    const fixture = iterationGateFixture(reason);
    const detail = {
      ownerSubject: 'operator',
      run: { runRef: 'run-iteration', predecessorRunRef: null, title: 'Iteration run', proposalRef: 'proposal-iteration', proposalRevision: 1,
        proposalHash: '9'.repeat(64), publicationState: 'published', lifecycle: { kind: 'waiting-human', deployPause: null }, version: 11, managerSessionRef: null,
        managerGeneration: 1, managerAssignment: null, createdAt: '', updatedAt: '' },
      stages: [], attempts: [], sessions: [], humanRequests: [fixture.request], stageGenerations: [], generationSupersessions: [],
      iterationLoops: [fixture.loop], iterationRequests: [fixture.iterationRequest], iterationReceipts: fixture.receipt ? [fixture.receipt] : [],
    };
    const getHumanRequest = vi.spyOn(controlStore, 'getHumanRequest').mockReturnValue({ ok: true, value: fixture.request } as never);
    const getRun = vi.spyOn(controlStore, 'getRun').mockReturnValue({ ok: true, value: detail } as never);
    const resolve = vi.spyOn(controlStore, 'resolveIterationGate').mockImplementation((_subject, _requestRef, input) => ({
      ok: true, value: {
        loop: { ...fixture.loop, state: input.decision === 'approved' ? 'passed' : 'declined', acceptedGenerationRefs: input.decision === 'approved' ? [...fixture.loop.activeGenerationRefs] : [] },
        receipt: fixture.receipt, receiptVersion: fixture.receipt?.version ?? null,
        gate: { ...fixture.request, state: 'resolved', response: { decision: input.decision === 'approved' ? 'approved' : 'rejected' } }, interventionRequest: null,
      },
    } as never));
    const failRun = vi.spyOn(controlStore, 'transitionRun').mockReturnValue({
      ok: true,
      value: { ...detail.run, lifecycle: { kind: 'failed', deployPause: null }, version: 12 },
    } as never);
    return { ...fixture, detail, getHumanRequest, getRun, resolve, failRun };
  }

  /** `owner` is whose run it is: 'operator' for an SPA launch, 'dashboard-engine' for a bridge launch. */
  function seedActivatableRun(withAcceptedRequest = true, suffix = '', owner = 'operator') {
    const stored = controlStore.createProposalRevision(owner, {
      sourceComposerRef: 'composer-activation',
      sourceTurnId: 'turn-activation',
      title: proposal.title,
      snapshot: proposal as unknown as JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal(owner, stored.value.proposalRef, stored.value.revision, {
      expectedHash: stored.value.hash,
      expectedApprovalRevision: 0,
      decision: 'approved',
      idempotencyKey: `approve-activation${suffix}`,
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun(owner, {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
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
      const linked = controlStore.linkStageCard(owner, stage.stageRef, stage.version, workflowCardId(created.value.run.runRef, stage.stageId));
      if (!linked.ok) throw new Error(linked.detail);
    }
    const publishing = controlStore.transitionPublication(
      owner,
      created.value.run.runRef,
      created.value.run.version,
      'publishing',
    );
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = controlStore.transitionPublication(
      owner,
      created.value.run.runRef,
      publishing.value.version,
      'published',
    );
    if (!published.ok) throw new Error(published.detail);
    const waiting = controlStore.transitionRun(
      owner,
      created.value.run.runRef,
      published.value.version,
      'waiting-human',
    );
    if (!waiting.ok) throw new Error(waiting.detail);
    if (withAcceptedRequest) {
      const request = controlStore.createHumanRequest(owner, created.value.run.runRef, {
        kind: 'intervention',
        title: 'Execution report',
        prompt: 'Acknowledge the report before resuming.',
      });
      if (!request.ok) throw new Error(request.detail);
      const responded = controlStore.respondHumanRequest(owner, request.value.requestRef, {
        expectedRevision: request.value.revision,
        decision: 'responded',
        idempotencyKey: `accept-activation${suffix}`,
      });
      if (!responded.ok) throw new Error(responded.detail);
    }
    const detail = controlStore.getRun(owner, created.value.run.runRef);
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
      /** Override the ops runner — a throwing one is the cheapest deterministic pre-claim refusal. */
      opsGit?: (root: string, args: string[]) => string;
      /**
       * How many lost push races the activation seam should simulate. The real
       * `activateManagedRootCards` calls `authorizeAfterPrepare` ONCE after its opening pull, then
       * `reassertAfterReconcile` once per reconciling `pull --rebase` a rejected push forces. Modelling
       * that here is what pins which half of the route's authorization is safe to repeat.
       */
      reconcileRaces?: number;
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
    const activateManagedRoots = vi.fn(async (options: { runRef: string; cardRefs: string[]; authorizeAfterPrepare?: () => void | Promise<void>; reassertAfterReconcile?: () => void | Promise<void>; verifyCompletedRoots?: (input: { runRef: string; cardRefs: string[] }) => Promise<void> }) => {
      await beforeRootAuthorization?.();
      if (overrides.completedRoot) await options.verifyCompletedRoots?.({ runRef: options.runRef, cardRefs: [options.cardRefs[0]] });
      await options.authorizeAfterPrepare?.();
      // Each lost push race reconciles onto a newer canonical head and re-proves against it. Only the
      // PURE half may run here; the real function passes exactly this callback.
      for (let race = 0; race < (overrides.reconcileRaces ?? 0); race += 1) {
        await options.reassertAfterReconcile?.();
      }
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
      opsGit: overrides.opsGit
        ?? ((_root, args) => args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n' : ''),
    }));
    await activated.ready();
    return { activated, runAutomatic, cancelAutomatic, containManagerStart, activateManagedRoots, verifyCanonicalResult };
  }

  /** A real store-backed gate, used to lock the HTTP replay fingerprint rather than a mocked resolver. */

  /** A generic-only completion gate: its participant stage has no legacy `review` contract to project. */
  function seedGenericCompletionGate() {
    const group: NonNullable<PlanProposal['iterationGroups']>[number] = {
      iterationGroupId: 'generic-completion-loop', goal: 'Accept the generic draft.',
      participants: [
        { participantId: 'generic-author', stageRef: 'generic-build', role: 'contributor', perspective: 'Draft.', mandate: 'Write the draft.' },
        { participantId: 'generic-critic', stageRef: 'generic-check', role: 'judge', perspective: 'Quality.', mandate: 'Check the draft.' },
      ],
      routes: [
        { routeId: 'generic-to-critic', senderParticipantId: 'generic-author', recipientParticipantId: 'generic-critic', requestKinds: ['review'], baseResolutionStageIds: ['generic-build'] },
        { routeId: 'generic-to-author', senderParticipantId: 'generic-critic', recipientParticipantId: 'generic-author', requestKinds: ['rework'], baseResolutionStageIds: ['generic-check'] },
      ],
      activation: { seedParticipantId: 'generic-author', seedArtifactIds: ['generic-artifact'] },
      initialStepId: 'generic-review',
      schedule: [
        { stepId: 'generic-review', routeId: 'generic-to-critic', after: { stepId: 'generic-rework', participantId: 'generic-author', verdict: 'fulfilled' }, cycle: 'next' },
        { stepId: 'generic-rework', routeId: 'generic-to-author', after: { stepId: 'generic-review', participantId: 'generic-critic', verdict: 'fail' }, cycle: 'current' },
      ],
      artifacts: ['generic-artifact'], criteria: [{ id: 'generic-ready', description: 'The draft is ready.' }],
      maxCycles: 2, cycleUnit: 'One generic draft and critique.',
      terminalAuthorities: [{ participantId: 'generic-critic', verdict: 'pass' }],
      completionGate: { id: 'generic-approval', kind: 'approval', prompt: 'Approve the generic result.', requiresReview: 'pass' },
    };
    const proposal = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'generic-completion', sourceTurnId: 'generic-completion-turn', title: 'Generic completion gate',
      snapshot: {
        schema: 'kb.plan-proposal/v1', manager: {}, iterationGroups: [structuredClone(group)], stages: [
          { id: 'generic-build', title: 'Generic build', dependsOn: [], artifacts: [{ id: 'generic-artifact', path: 'generic.md' }] },
          { id: 'generic-check', title: 'Generic check', dependsOn: ['generic-build'], artifacts: [] },
        ],
      } as unknown as JsonObject,
    });
    if (!proposal.ok) throw new Error(proposal.detail);
    const approved = controlStore.decideProposal('operator', proposal.value.proposalRef, proposal.value.revision, {
      expectedHash: proposal.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-generic-completion',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun('operator', {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
      title: 'Generic completion gate', proposalRef: proposal.value.proposalRef, proposalRevision: proposal.value.revision,
      expectedProposalHash: proposal.value.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'launch-generic-completion', iterationGroups: [structuredClone(group)], stages: [
        { stageId: 'generic-build', title: 'Generic build', dependsOn: [] },
        { stageId: 'generic-check', title: 'Generic check', dependsOn: ['generic-build'] },
      ],
    });
    if (!created.ok) throw new Error(created.detail);
    let detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    let build = detail.value.stages.find((stage) => stage.stageId === 'generic-build');
    if (!build) throw new Error('generic build stage missing');
    const linked = controlStore.linkStageCard('operator', build.stageRef, build.version, 'card-generic-build');
    if (!linked.ok) throw new Error(linked.detail);
    const attempt = controlStore.createAttempt('operator', build.stageRef, { expectedStageVersion: linked.value.version, runtime: 'codex', model: 'fixed' });
    if (!attempt.ok) throw new Error(attempt.detail);
    let currentAttempt = attempt.value;
    for (const state of ['starting', 'running', 'succeeded'] as const) {
      const transitioned = controlStore.transitionAttempt('operator', currentAttempt.attemptRef, currentAttempt.version, state);
      if (!transitioned.ok) throw new Error(transitioned.detail);
      currentAttempt = transitioned.value;
    }
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    build = detail.value.stages.find((stage) => stage.stageRef === build!.stageRef);
    if (!build) throw new Error('generic build stage disappeared');
    const generation = controlStore.recordStageGeneration('operator', build.stageRef, {
      expectedStageVersion: build.version, expectedAttemptVersion: currentAttempt.version, expectedGeneration: 1,
      operationKey: `result:${created.value.run.runRef}:generic-build`, resultHash: 'd'.repeat(64), resultCardRef: 'card-generic-build',
      baseCommit: 'b'.repeat(40), canonicalCommit: 'a'.repeat(40),
    });
    if (!generation.ok) throw new Error(generation.detail);
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    build = detail.value.stages.find((stage) => stage.stageRef === build!.stageRef);
    if (!build) throw new Error('generic committed build stage missing');
    const running = controlStore.transitionStage('operator', build.stageRef, build.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    const succeeded = controlStore.transitionStage('operator', running.value.stageRef, running.value.version, 'succeeded');
    if (!succeeded.ok) throw new Error(succeeded.detail);
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    let loop = detail.value.iterationLoops[0];
    if (!loop) throw new Error('generic iteration loop missing');
    const activated = controlStore.activateIterationLoop('operator', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, seedGenerationRefs: [generation.value.generationRef],
      artifactGenerationRefs: { 'generic-artifact': generation.value.generationRef },
      operationKey: `iteration-activate:${created.value.run.runRef}:generic-completion-loop:c1`,
    });
    if (!activated.ok) throw new Error(activated.detail);
    const turn = controlStore.recordIterationRequest('operator', loop.iterationLoopRef, {
      expectedLoopVersion: activated.value.version, routeId: 'generic-to-critic', kind: 'review',
      inputGenerationRefs: [generation.value.generationRef], baseCommit: generation.value.canonicalCommit!,
      artifactHashes: { 'generic-artifact': generation.value.resultHash! }, unresolvedFindingRefs: [], preservedInvariants: [],
      nextAcceptanceCheck: 'Apply generic-ready.', instructions: 'Check the generic draft.',
      operationKey: `iteration-request:${created.value.run.runRef}:generic:c1`,
    });
    if (!turn.ok) throw new Error(turn.detail);
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    let critic = detail.value.stages.find((stage) => stage.stageId === 'generic-check')!;
    const criticAttempt = controlStore.createAttempt('operator', critic.stageRef, {
      expectedStageVersion: critic.version, runtime: 'codex', model: 'fixed',
    });
    if (!criticAttempt.ok) throw new Error(criticAttempt.detail);
    let currentCriticAttempt = criticAttempt.value;
    for (const state of ['starting', 'running', 'succeeded'] as const) {
      const transitioned = controlStore.transitionAttempt('operator', currentCriticAttempt.attemptRef, currentCriticAttempt.version, state);
      if (!transitioned.ok) throw new Error(transitioned.detail);
      currentCriticAttempt = transitioned.value;
    }
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    critic = detail.value.stages.find((stage) => stage.stageRef === critic.stageRef)!;
    const criticRunning = controlStore.transitionStage('operator', critic.stageRef, critic.version, 'running');
    if (!criticRunning.ok) throw new Error(criticRunning.detail);
    const criticSucceeded = controlStore.transitionStage('operator', critic.stageRef, criticRunning.value.version, 'succeeded');
    if (!criticSucceeded.ok) throw new Error(criticSucceeded.detail);
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    loop = detail.value.iterationLoops[0]!;
    const receipt = controlStore.recordIterationReceipt('operator', loop.iterationLoopRef, {
      expectedLoopVersion: loop.version, requestRef: turn.value.requestRef,
      outcome: {
        schema: 'kb.iteration-outcome/v1', requestRef: turn.value.requestRef, iterationLoopRef: loop.iterationLoopRef,
        participantId: 'generic-critic', cycle: turn.value.cycle, verdict: 'pass', inputGenerationRefs: [...turn.value.inputGenerationRefs],
        criteria: [{ criterionId: 'generic-ready', verdict: 'pass', findingIds: [] }], findings: [], positions: [], recordedDissent: [],
        summary: 'The generic draft passed.',
      },
      outputGenerationRefs: [], baseCommit: generation.value.baseCommit!, canonicalCommit: generation.value.canonicalCommit!,
      participantAttemptRef: currentCriticAttempt.attemptRef, operationKey: `iteration-receipt:${created.value.run.runRef}:generic:c1:pass`,
    });
    if (!receipt.ok) throw new Error(receipt.detail);
    detail = controlStore.getRun('operator', created.value.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    loop = detail.value.iterationLoops[0]!;
    const gate = detail.value.humanRequests.find((request) => request.requestRef === loop.completionGateRef);
    if (!gate) throw new Error('generic completion gate missing');
    expect(detail.value).not.toHaveProperty('reviewReceipts');
    return { runRef: created.value.run.runRef, gate, loop, receipt: detail.value.iterationReceipts[0]! };
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

  it('returns not found for the removed review completion gate endpoint', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/control/review-completion-gates/request-removed/resolve', headers: headers(token),
      payload: { expectedRequestRevision: 1, decision: 'approved', idempotencyKey: 'human:request-gate:1:approved', response: 'Approved.' },
    });
    expect(response.statusCode, response.body).toBe(404);
  });



  it('never lets a reserved completion request through generic respond', async () => {
    const { gate: request } = seedGenericCompletionGate();
    const response = await app.inject({
      method: 'POST', url: `/api/control/human-requests/${request.requestRef}/respond`, headers: headers(token),
      payload: { expectedRevision: 1, decision: 'approved', idempotencyKey: 'generic-bypass' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'iteration-gate-reserved' });
  });



  it('returns participants routes cycles turn owner verdict lineage and full residue in run detail', async () => {
    const seeded = seedActivatableRun(false, '-iteration-dto');
    const fixture = mockIterationGate('no-progress');
    fixture.detail.run = seeded.run as unknown as typeof fixture.detail.run;
    fixture.detail.stages = seeded.stages as typeof fixture.detail.stages;
    fixture.request.runRef = seeded.run.runRef;
    fixture.loop.runRef = seeded.run.runRef;
    const { request, loop, iterationRequest, receipt } = fixture;
    const response = await app.inject({
      method: 'GET', url: `/api/control/runs/${request.runRef}`, headers: headers(token),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, value: {
      iterationLoops: [{
        iterationLoopRef: loop.iterationLoopRef, participants: loop.participants, routes: loop.routes,
        cyclesUsed: 1, maxCycles: 2, cycleUnit: loop.cycleUnit, state: 'awaiting-park-gate', parkReason: 'no-progress',
        activeGenerationRefs: loop.activeGenerationRefs, acceptedGenerationRefs: loop.acceptedGenerationRefs,
        unresolvedResidue: {
          unresolvedFindings: loop.unresolvedResidue.unresolvedFindings, positions: loop.unresolvedResidue.positions,
          recordedDissent: loop.unresolvedResidue.recordedDissent, requestRefs: [iterationRequest.requestRef], receiptRefs: [],
          attemptedRequestRef: iterationRequest.requestRef, attemptedRequestCycle: 2,
          attemptedOutcome: loop.unresolvedResidue.attemptedOutcome, artifactSnapshots: loop.unresolvedResidue.artifactSnapshots,
          failureReason: loop.unresolvedResidue.failureReason, cyclesUsed: 1, maxCycles: 2,
        },
      }],
      iterationRequests: [expect.objectContaining({ requestRef: iterationRequest.requestRef, cycle: 2, inputGenerationRefs: iterationRequest.inputGenerationRefs })],
      iterationReceipts: receipt ? [expect.objectContaining({ receiptRef: receipt.receiptRef, baseCommit: receipt.baseCommit, canonicalCommit: receipt.canonicalCommit })] : [],
      humanRequests: [expect.objectContaining({ requestRef: request.requestRef, gateKind: 'iteration-park', state: 'open' })],
    } });
  });

  it('approves only the exact iteration-park artifact set with matching gate reason and loop versions', async () => {
    const { request, loop, receipt, resolve } = mockIterationGate('no-progress');
    loop.activeGenerationRefs = ['generation-no-progress-a', 'generation-no-progress-b'];
    const exact = {
      expectedGateRef: request.requestRef, expectedGateKind: 'iteration-park', expectedParkReason: 'no-progress',
      expectedRequestRevision: request.revision, expectedLoopVersion: loop.version,
      expectedReceiptVersion: receipt?.version ?? null, expectedGenerationRefs: [...loop.activeGenerationRefs],
      decision: 'approved', idempotencyKey: 'approve-exact-no-progress', response: 'Approve this displayed set.',
    };
    for (const stale of [
      { ...exact, expectedGateKind: 'completion' },
      { ...exact, expectedParkReason: 'exhausted' },
      { ...exact, expectedLoopVersion: loop.version - 1 },
      { ...exact, expectedGenerationRefs: ['generation-changed'] },
      { ...exact, expectedGenerationRefs: [...exact.expectedGenerationRefs].reverse() },
      { ...exact, expectedGenerationRefs: [exact.expectedGenerationRefs[0], exact.expectedGenerationRefs[0]] },
      { ...exact, expectedGenerationRefs: [...exact.expectedGenerationRefs, 'generation-superset'] },
      { ...exact, expectedGenerationRefs: exact.expectedGenerationRefs.slice(0, 1) },
    ]) {
      const response = await app.inject({
        method: 'POST', url: `/api/control/iteration-gates/${request.requestRef}/resolve`, headers: headers(token), payload: stale,
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json()).toMatchObject({ error: 'iteration-gate-cas-mismatch' });
    }
    const approved = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${request.requestRef}/resolve`, headers: headers(token), payload: exact,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ ok: true, value: { loop: { state: 'passed', acceptedGenerationRefs: loop.activeGenerationRefs } },
      continuation: { kind: 'separate-relaunch' } });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('operator', request.requestRef, {
      expectedRequestRevision: request.revision, expectedLoopVersion: loop.version, expectedReceiptVersion: null,
      decision: 'approved', operationKey: exact.idempotencyKey, response: exact.response,
    }, 'all-subjects');
  });

  it('declines an exhausted or no-progress iteration-park gate and makes the run unable to succeed', async () => {
    const { request, loop, receipt, resolve, failRun } = mockIterationGate('exhausted');
    const response = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${request.requestRef}/resolve`, headers: headers(token),
      payload: {
        expectedGateRef: request.requestRef, expectedGateKind: 'iteration-park', expectedParkReason: 'exhausted',
        expectedRequestRevision: request.revision, expectedLoopVersion: loop.version, expectedReceiptVersion: receipt?.version ?? null,
        expectedGenerationRefs: [...loop.activeGenerationRefs], decision: 'declined', idempotencyKey: 'decline-exhausted',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, value: { loop: { state: 'declined' }, run: { state: 'failed' } },
      continuation: { kind: 'separate-relaunch' } });
    expect(resolve).toHaveBeenCalledWith('operator', request.requestRef, expect.objectContaining({ decision: 'declined' }), 'all-subjects');
    expect(failRun).toHaveBeenCalledWith('operator', request.runRef, 11, 'failed');
  });

  it('rejects changes-requested and stale approval for an iteration-park gate', async () => {
    const { request, loop } = mockIterationGate('no-progress');
    const base = {
      expectedGateRef: request.requestRef, expectedGateKind: 'iteration-park', expectedParkReason: 'no-progress',
      expectedRequestRevision: request.revision, expectedLoopVersion: loop.version, expectedReceiptVersion: null,
      expectedGenerationRefs: [...loop.activeGenerationRefs], idempotencyKey: 'invalid-park-decision',
    };
    const changes = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${request.requestRef}/resolve`, headers: headers(token),
      payload: { ...base, decision: 'changes-requested' },
    });
    expect(changes.statusCode, changes.body).toBe(400);
    expect(changes.json()).toMatchObject({ error: 'invalid-iteration-park-decision' });
    const stale = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${request.requestRef}/resolve`, headers: headers(token),
      payload: { ...base, expectedRequestRevision: request.revision - 1, decision: 'approved' },
    });
    expect(stale.statusCode, stale.body).toBe(409);
  });

  it('resolves an explicit participant park through the same exact-set gate contract', async () => {
    const { request, loop, receipt, resolve } = mockIterationGate('parked');
    const response = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${request.requestRef}/resolve`, headers: headers(token),
      payload: {
        expectedGateRef: request.requestRef, expectedGateKind: 'iteration-park', expectedParkReason: 'parked',
        expectedRequestRevision: request.revision, expectedLoopVersion: loop.version,
        expectedGenerationRefs: [...loop.activeGenerationRefs], decision: 'approved', idempotencyKey: 'approve-explicit-park',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, value: { loop: { state: 'passed' } },
      continuation: { kind: 'separate-relaunch' } });
    expect(resolve).toHaveBeenCalledWith('operator', request.requestRef, expect.objectContaining({
      expectedReceiptVersion: receipt?.version, decision: 'approved',
    }), 'all-subjects');
  });


  it('preserves the optional post-acceptance completion gate and withholds downstream release', async () => {
    const { runRef, gate: request } = seedGenericCompletionGate();
    const detail = controlStore.getRun('operator', runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops.find((candidate) => candidate.completionGateRef === request.requestRef)!;
    const response = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${request.requestRef}/resolve`, headers: headers(token),
      payload: {
        expectedGateRef: request.requestRef, expectedGateKind: null, expectedParkReason: null,
        expectedRequestRevision: request.revision, expectedLoopVersion: loop.version,
        expectedGenerationRefs: [...loop.activeGenerationRefs], decision: 'changes-requested', idempotencyKey: 'completion-still-intervenes',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, value: { loop: { state: 'parked' }, interventionRequest: { kind: 'intervention', state: 'open' } } });
    const after = controlStore.getRun('operator', runRef);
    expect(after).toMatchObject({ ok: true, value: {
      iterationLoops: [expect.objectContaining({ state: 'parked' })],
      humanRequests: expect.arrayContaining([expect.objectContaining({ kind: 'intervention', state: 'open' })]),
    } });
    expect(after.ok && after.value.iterationLoops[0]?.turnOwnerParticipantId).toBeUndefined();
  });

  it('resolves a non-legacy completion gate through the real generic store transition', async () => {
    const { runRef, gate, loop, receipt } = seedGenericCompletionGate();
    const response = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${gate.requestRef}/resolve`, headers: headers(token),
      payload: {
        expectedGateRef: gate.requestRef, expectedGateKind: null, expectedParkReason: null,
        expectedRequestRevision: gate.revision, expectedLoopVersion: loop.version,
        expectedGenerationRefs: [...loop.activeGenerationRefs], decision: 'approved', idempotencyKey: 'approve-generic-completion-route',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, value: {
      loop: { iterationLoopRef: loop.iterationLoopRef, state: 'passed' },
      receipt: { receiptRef: receipt.receiptRef, version: receipt.version + 1 },
      gate: { requestRef: gate.requestRef, state: 'resolved' },
    } });
    expect(controlStore.getRun('operator', runRef)).toMatchObject({ ok: true, value: {
      iterationLoops: [{ iterationLoopRef: loop.iterationLoopRef, state: 'passed' }],
    } });
  });

  it('rejects a real completion gate then answers its minted intervention through generic respond', async () => {
    const { runRef, gate, loop } = seedGenericCompletionGate();
    const rejected = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${gate.requestRef}/resolve`, headers: headers(token),
      payload: {
        expectedGateRef: gate.requestRef, expectedGateKind: null, expectedParkReason: null,
        expectedRequestRevision: gate.revision, expectedLoopVersion: loop.version,
        expectedGenerationRefs: [...loop.activeGenerationRefs], decision: 'rejected', idempotencyKey: 'reject-generic-completion-route',
      },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    const intervention = rejected.json().value.interventionRequest;
    expect(intervention).toMatchObject({ kind: 'intervention', state: 'open' });
    const answered = await app.inject({
      method: 'POST', url: `/api/control/human-requests/${intervention.requestRef}/respond`, headers: headers(token),
      payload: { expectedRevision: intervention.revision, decision: 'approved', idempotencyKey: 'answer-generic-completion-intervention' },
    });
    expect(answered.statusCode, answered.body).toBe(200);
    expect(answered.json()).toMatchObject({ ok: true, value: { requestRef: intervention.requestRef, state: 'resolved', response: { decision: 'approved' } } });
    const after = controlStore.getRun('operator', runRef);
    expect(after).toMatchObject({ ok: true, value: {
      iterationLoops: [{ state: 'parked', interventionRef: intervention.requestRef }],
      humanRequests: expect.arrayContaining([expect.objectContaining({
        requestRef: intervention.requestRef, state: 'resolved', response: expect.objectContaining({ decision: 'approved' }),
      })]),
    } });
    expect(after.ok && after.value.humanRequests.filter((request) => request.state === 'open')).toEqual([]);
  });

  it('does not let the generic intervention endpoint bypass the iteration gate contract', async () => {
    const { request, resolve } = mockIterationGate('no-progress');
    const response = await app.inject({
      method: 'POST', url: `/api/control/human-requests/${request.requestRef}/respond`, headers: headers(token),
      payload: { expectedRevision: request.revision, decision: 'approved', idempotencyKey: 'generic-iteration-bypass' },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ error: 'iteration-gate-reserved', gateKind: 'iteration-park' });
    expect(resolve).not.toHaveBeenCalled();
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
          profileId: 'manager:claude:claude-opus-5', runtime: 'claude', model: 'claude-opus-5',
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

  it('parks one published DAG at the locked runtime boundary, then resumes that exact run after unlock wiring', async () => {
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
    const publishCalls: Array<{ runId: string; managed: boolean; stages: Array<{ id: string; dependsOn: string[] }> }> = [];
    const runPy = (_repoRoot: string, _code: string, jsonArg: string) => {
      const payload = JSON.parse(jsonArg) as { runId: string; managed: boolean; stages: Array<{ id: string; dependsOn: string[] }> };
      publishCalls.push(payload);
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
    const lockedLatch = {
      snapshot: () => ({ state: 'locked' as const, source: null, unlockedAt: null, unlockedBy: null }),
      current: () => null,
      unlock: vi.fn(),
      lock: vi.fn(),
    };
    const launchApp = Fastify();
    registerWriteSurface(launchApp, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)),
      sessionConfig: SESSION, allowedOrigins: [ORIGIN], credentials: () => [], composerStore, controlStore,
      appendAudit: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      appendAuditLocal: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }), opsGit, runPy,
      executionLatch: lockedLatch as never,
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
      expect(run.ok && run.value.run).toMatchObject({ publicationState: 'published', lifecycle: { kind: 'waiting-human', deployPause: null } });
      expect(run.ok && run.value.stages.map((stage) => [stage.stageId, stage.canonicalCardRef, stage.state])).toEqual([
        ['verify', workflowCardId(launched.json().runRef as string, 'verify'), 'ready'],
        ['report', workflowCardId(launched.json().runRef as string, 'report'), 'blocked'],
      ]);
      expect(run.ok && run.value.humanRequests).toEqual([
        expect.objectContaining({ kind: 'intervention', title: 'Automatic execution activation is gated', state: 'open' }),
      ]);
      expect(publishCalls).toHaveLength(1);

      if (!run.ok) throw new Error(run.detail);
      const boundary = run.value.humanRequests[0];
      const responded = await launchApp.inject({
        method: 'POST', url: `/api/control/human-requests/${boundary.requestRef}/respond`, headers: headers(token),
        payload: {
          expectedRevision: boundary.revision,
          decision: 'responded',
          idempotencyKey: `respond:${boundary.requestRef}:${boundary.revision}`,
          response: 'Execution unlock will be completed separately.',
        },
      });
      expect(responded.statusCode, responded.body).toBe(200);
      expect(responded.json()).toMatchObject({ ok: true, value: { state: 'resolved', response: { decision: 'responded' } } });

      const ready = controlStore.getRun('operator', run.value.run.runRef);
      if (!ready.ok) throw new Error(ready.detail);
      const activationPayload = {
        expectedRunVersion: ready.value.run.version,
        expectedManagerGeneration: ready.value.run.managerGeneration,
        idempotencyKey: `activate:${ready.value.run.runRef}:${ready.value.run.version}:${ready.value.run.proposalHash}:${ready.value.run.managerGeneration}`,
      };
      const stillLocked = await launchApp.inject({
        method: 'POST', url: `/api/control/runs/${ready.value.run.runRef}/activate`, headers: headers(token),
        payload: activationPayload,
      });
      expect(stillLocked.statusCode, stillLocked.body).toBe(409);
      expect(stillLocked.json()).toMatchObject({
        error: 'execution-locked',
        execution: { state: 'locked', source: null, unlockRoute: '/api/control/execution/unlock' },
      });
      expect(controlStore.getRunActivationReceipt('operator', ready.value.run.runRef, activationPayload))
        .toMatchObject({ ok: true, value: null });
      expect(controlStore.getRun('operator', ready.value.run.runRef)).toMatchObject({
        ok: true,
        value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null }, version: ready.value.run.version } },
      });

      // Simulate the post-passkey context wiring without touching a daemon or real latch. Activation must
      // resume this exact published run and these exact cards; it must not call the launch publisher again.
      const wired = await activatedApp();
      try {
        const activated = await wired.activated.inject({
          method: 'POST', url: `/api/control/runs/${ready.value.run.runRef}/activate`, headers: headers(token),
          payload: activationPayload,
        });
        expect(activated.statusCode, activated.body).toBe(202);
        expect(wired.runAutomatic).toHaveBeenCalledTimes(1);
        expect(wired.runAutomatic).toHaveBeenCalledWith(expect.objectContaining({ runRef: ready.value.run.runRef }));
        expect(wired.activateManagedRoots).toHaveBeenCalledTimes(1);
        expect(wired.activateManagedRoots).toHaveBeenCalledWith(expect.objectContaining({
          runRef: ready.value.run.runRef,
          cardRefs: [workflowCardId(ready.value.run.runRef, 'verify')],
        }));
      } finally {
        await wired.activated.close();
      }

      const replayed = await launchApp.inject({
        method: 'POST',
        url: `/api/control/proposals/${revision.proposalRef}/revisions/${revision.revision}/launch`,
        headers: headers(token), payload: { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` },
      });
      expect(replayed.statusCode, replayed.body).toBe(200);
      expect(replayed.json()).toMatchObject({ ok: true, runRef: ready.value.run.runRef, replayed: true });
      expect(publishCalls).toHaveLength(1);
      const resumed = controlStore.getRun('operator', ready.value.run.runRef);
      expect(resumed).toMatchObject({
        ok: true,
        value: {
          run: { runRef: ready.value.run.runRef, lifecycle: { kind: 'running', deployPause: null }, publicationState: 'published' },
          stages: [
            { stageId: 'verify', canonicalCardRef: workflowCardId(ready.value.run.runRef, 'verify') },
            { stageId: 'report', canonicalCardRef: workflowCardId(ready.value.run.runRef, 'report') },
          ],
        },
      });
    } finally {
      await launchApp.close();
    }
  });

  /**
   * ENTRY-GATE LAUNCH FIXTURES.
   *
   * A launch-shaped proposal whose runtime/model pairs exist in the SERVER-OWNED registry this suite
   * really compiles against (`governance/model-routing.yaml`), so the launch compiler resolves live
   * profiles instead of refusing the manager. `uploadGates` decides whether the T3 upload stage declares
   * its own content-bound publication authorization — the one difference between a launchable run and the
   * original fail-closed park.
   */
  function launchProposal(proposalId: string, uploadGates: PlanProposal['stages'][number]['humanGates']): PlanProposal {
    return {
      schema: 'kb.plan-proposal/v1', proposalId, project: 'kb-ops', title: 'Gated control launch',
      summary: 'A gated two-stage run ending in a private upload.',
      manager: { runtime: 'claude', model: 'claude-opus-5', requiredSkills: [] },
      scope: { read: ['dashboard'], write: ['dashboard/server/control'] },
      governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
      stages: [
        {
          id: 'build', title: 'Build', action: 'build:asset', target: 'dashboard/server/control',
          workOrder: 'Build the asset.', riskTier: 'T2', dependsOn: [],
          worker: { runtime: 'codex', model: 'gpt-5.6-sol' }, requiredSkills: [],
          scope: { read: ['dashboard'], write: ['dashboard/server/control'] }, artifacts: [], checkpoints: [],
          humanGates: [{ id: 'g1-plan', kind: 'approval', prompt: 'Approve the plan.' }],
        },
        {
          id: 'upload', title: 'Upload', action: 'publish:private-upload', target: 'dashboard/server/control',
          workOrder: 'Upload the finished asset as private.', riskTier: 'T3', dependsOn: ['build'],
          worker: { runtime: 'codex', model: 'gpt-5.6-sol' }, requiredSkills: [],
          scope: { read: ['dashboard'], write: ['dashboard/server/control'] }, artifacts: [], checkpoints: [],
          humanGates: uploadGates,
        },
      ],
    };
  }

  async function approvedLaunchRevision(snapshot: PlanProposal, idempotencySuffix: string) {
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: composerRef, sourceTurnId: `turn-${idempotencySuffix}`, title: snapshot.title,
      snapshot: snapshot as unknown as import('./types.ts').JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, 1, {
      expectedHash: stored.value.hash, expectedApprovalRevision: 0, decision: 'approved',
      idempotencyKey: `approve-${idempotencySuffix}`,
    });
    if (!approved.ok) throw new Error(approved.detail);
    return stored.value;
  }

  async function launchSurface() {
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
    return launchApp;
  }

  it('launches a gated T3 run without minting one gate boundary, so nothing at launch can authorize it', async () => {
    // The upload declares its OWN publication-authorization gate, so the T3 wait is releasable at that
    // stage's entry boundary and the run is launchable. Every gate — including the one that authorizes the
    // upload — must still be absent from the Inbox until `execution.ts#stageBoundary` reaches its stage.
    const revision = await approvedLaunchRevision(launchProposal('control-route-entry-gate', [
      { id: 'g4-publish', kind: 'approval', prompt: 'Approve the private upload.', publicationAuthorization: true },
    ]), 'entry-gate');
    const launchApp = await launchSurface();
    try {
      const url = `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`;
      const payload = { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` };
      const launched = await launchApp.inject({ method: 'POST', url, headers: headers(token), payload });
      expect(launched.statusCode, launched.body).toBe(202);
      expect(launched.json()).toMatchObject({ ok: true, waitingHuman: true, activationGated: true });
      const detail = controlStore.getRun('operator', launched.json().runRef as string);
      if (!detail.ok) throw new Error(detail.detail);
      // Runnable and published: the T3 stage is in the card DAG, so the roster has something to run.
      expect(detail.value.run.publicationState).toBe('published');
      expect(detail.value.stages.map((stage) => [stage.stageId, stage.canonicalCardRef !== null]))
        .toEqual([['build', true], ['upload', true]]);
      // The ONLY boundary is the post-publication runtime intervention. No gate, no governance refusal
      // for the T3 stage, and — decisively — nothing of kind `approval`: this operational acknowledgement
      // cannot authorize spend or publication; the separate passkey latch still controls activation.
      expect(detail.value.humanRequests.map((request) => [request.kind, request.title])).toEqual([
        ['intervention', 'Automatic execution activation is gated'],
      ]);
      // Neither the bare gate id (what launch used to mint) nor the stage-scoped title the engine matches
      // (`stableHumanTitle('gate', stageId, gateId)` = `automatic:gate:<stageId>:<gateId>`) exists yet.
      for (const title of ['g1-plan', 'g4-publish', 'automatic:gate:build:g1-plan', 'automatic:gate:upload:g4-publish']) {
        expect(detail.value.humanRequests.some((request) => request.title === title)).toBe(false);
      }
    } finally { await launchApp.close(); }
  });

  it('keeps a T3 stage with no publication gate parked at launch, publishing no cards on any replay', async () => {
    // The pre-existing fail-closed guarantee for every other workflow in the repo: nothing names the human
    // decision that would release this upload, so the run parks before a single card is written and no
    // response can release it.
    const revision = await approvedLaunchRevision(launchProposal('control-route-ungated-t3', []), 'ungated-t3');
    const launchApp = await launchSurface();
    try {
      const url = `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`;
      const payload = { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` };
      const parked = await launchApp.inject({ method: 'POST', url, headers: headers(token), payload });
      expect(parked.statusCode, parked.body).toBe(202);
      expect(parked.json()).toMatchObject({ ok: true, waitingHuman: true });
      expect(parked.json().activationGated).toBeUndefined();
      expect(parked.json().cards).toBeUndefined();
      const runRef = parked.json().runRef as string;
      let detail = controlStore.getRun('operator', runRef);
      if (!detail.ok) throw new Error(detail.detail);
      expect(detail.value.run).toMatchObject({ publicationState: 'waiting-human', lifecycle: { kind: 'waiting-human', deployPause: null } });
      expect(detail.value.stages.every((stage) => stage.canonicalCardRef === null)).toBe(true);
      expect(detail.value.humanRequests.map((request) => [request.kind, request.title, request.prompt])).toEqual([
        ['governance-refusal', 'Governance review: upload', 't3-content-bound-approval-required'],
      ]);
      // Responding to a governance refusal never releases canonical publication: a plan amendment does.
      const request = detail.value.humanRequests[0];
      await launchApp.inject({
        method: 'POST', url: `/api/control/human-requests/${request.requestRef}/respond`, headers: headers(token),
        payload: { expectedRevision: request.revision, decision: 'approved', idempotencyKey: 'accept-refusal' },
      });
      const replayed = await launchApp.inject({ method: 'POST', url, headers: headers(token), payload });
      expect(replayed.statusCode, replayed.body).toBe(200);
      expect(replayed.json()).toMatchObject({ ok: true, runRef, replayed: true, waitingHuman: true });
      detail = controlStore.getRun('operator', runRef);
      expect(detail.ok && detail.value.run.publicationState).toBe('waiting-human');
      expect(detail.ok && detail.value.stages.every((stage) => stage.canonicalCardRef === null)).toBe(true);
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
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
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
      profileId: 'manager:claude:claude-opus-5', approvedPrompt: 'approved',
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
      profileId: 'manager:claude:claude-opus-5', runtime: 'claude' as const, model: 'claude-opus-5',
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
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
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
      profileId: 'manager:claude:claude-opus-5', runtime: 'claude' as const, model: 'claude-opus-5',
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
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
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
      ok: true, value: { run: { managerGeneration: 1, managerSessionRef: manager.sessionRef, lifecycle: { kind: 'planned', deployPause: null } } },
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
      ok: true, value: { run: { managerGeneration: 2, lifecycle: { kind: 'recovering', deployPause: null } } },
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
      const activatedDetail = controlStore.getRun('operator', detail.run.runRef);
      if (!activatedDetail.ok) throw new Error(activatedDetail.detail);
      for (const response of [first, second]) {
        expectExactWireRun(response.json().value, activatedDetail.value.run as unknown as Record<string, unknown> & { lifecycle: { kind: string } });
      }
      expect(runAutomatic).toHaveBeenCalledTimes(1);
      expect(activateManagedRoots).toHaveBeenCalledTimes(1);
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true,
        value: {
          run: { lifecycle: { kind: 'running', deployPause: null }, version: detail.run.version + 2 },
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
      expectExactWireRun(
        gatedReplay.json().value,
        activatedDetail.value.run as unknown as Record<string, unknown> & { lifecycle: { kind: string } },
      );

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

  it('projects a dispatched activation receipt discovered only after entering the run lock', async () => {
    const detail = seedActivatableRun();
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:inside-lock-replay`,
    };
    let receiptReads = 0;
    const receipt = vi.spyOn(controlStore, 'getRunActivationReceipt').mockImplementation(() => {
      receiptReads += 1;
      return receiptReads === 1
        ? { ok: true, value: null }
        : { ok: true, value: { run: detail.run, phase: 'dispatched' }, replayed: true };
    });
    const { activated, runAutomatic } = await activatedApp();
    try {
      const response = await activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        value: expect.any(Object),
        replayed: true,
      });
      expectExactWireRun(
        response.json().value,
        detail.run as unknown as Record<string, unknown> & { lifecycle: { kind: string } },
      );
      expect(receiptReads).toBe(2);
      expect(runAutomatic).not.toHaveBeenCalled();
    } finally {
      receipt.mockRestore();
      await activated.close();
    }
  });

  /**
   * A lost push race must NOT re-authorize.
   *
   * `activateManagedRootCards` reconciles and retries a push rejected non-fast-forward, and it re-proves
   * authorization after every reconcile. That re-proof has to be the PURE half of the route's
   * authorization — read state, compare policy, throw — because the other half emits a T3
   * `control-run-activate-authorize` audit row (which carries its OWN nested ops commit+push) and takes
   * the activation claim. Wiring the whole closure to the reconcile hook would bill one authorization as
   * three: three audit rows, three claims, for one operator act.
   */
  it('re-proves purely on every reconciled push race: still exactly one authorize row and one claim', async () => {
    const detail = seedActivatableRun();
    const auditRows: Array<Record<string, unknown>> = [];
    const claim = vi.spyOn(controlStore, 'claimRunActivation');
    const { activated, activateManagedRoots } = await activatedApp(undefined, {
      // Two writers beat this activation to `ops`; both are transient, and neither is a new authorization.
      reconcileRaces: 2,
      appendAudit: (_root: string, event: unknown) => {
        auditRows.push(event as Record<string, unknown>);
        return { ts: new Date().toISOString(), ...(event as Record<string, unknown>) };
      },
    });
    try {
      const activateResponse = await activated.inject({
        method: 'POST',
        url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token),
        payload: {
          expectedRunVersion: detail.run.version,
          expectedManagerGeneration: detail.run.managerGeneration,
          idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:${detail.run.proposalHash}:${detail.run.managerGeneration}`,
        },
      });

      expect(activateResponse.statusCode, activateResponse.body).toBe(202);
      expect(activateManagedRoots).toHaveBeenCalledTimes(1);
      // Both re-proofs ran — the retry path really was exercised, not skipped.
      const wiring = activateManagedRoots.mock.calls[0][0] as { reassertAfterReconcile?: unknown };
      expect(typeof wiring.reassertAfterReconcile).toBe('function');
      // ...and neither of them authorized anything a second time.
      expect(auditRows.filter((row) => row.action === 'control-run-activate-authorize')).toHaveLength(1);
      expect(claim).toHaveBeenCalledTimes(1);
    } finally {
      claim.mockRestore();
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
        value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null }, version: detail.run.version } },
      });
    } finally {
      await activated.close();
    }
  });

  /** The open ask an operator actually answers in the Inbox, on an already parked run. */
  function seedOpenBoundary(
    runRef: string,
    owner = 'operator',
    input: { kind?: 'intervention' | 'approval'; title?: string; stageRef?: string } = {},
  ) {
    const request = controlStore.createHumanRequest(owner, runRef, {
      kind: input.kind ?? 'intervention',
      title: input.title ?? 'Launch reconciliation required',
      prompt: 'Acknowledge this before the run continues.',
      ...(input.stageRef ? { stageRef: input.stageRef } : {}),
    });
    if (!request.ok) throw new Error(request.detail);
    return request.value;
  }

  function respondPayload(request: { requestRef: string; revision: number }, decision: string) {
    return {
      expectedRevision: request.revision,
      decision,
      idempotencyKey: `human:${request.requestRef}:${request.revision}:${decision}`,
      response: null,
    };
  }

  /** The key the server derives for an auto-resume; used to read the receipt it did (or did not) write. */
  function autoResumeInput(run: { runRef: string; version: number; managerGeneration: number; proposalHash: string }) {
    return {
      expectedRunVersion: run.version,
      expectedManagerGeneration: run.managerGeneration,
      idempotencyKey: `auto-resume:${run.runRef}:${run.version}:${run.managerGeneration}:${run.proposalHash}`,
    };
  }

  it('resumes a parked run the moment a human answer clears its last boundary', async () => {
    const detail = seedActivatableRun(false);
    const boundary = seedOpenBoundary(detail.run.runRef);
    const wired = await activatedApp();
    try {
      const responded = await wired.activated.inject({
        method: 'POST', url: `/api/control/human-requests/${boundary.requestRef}/respond`,
        headers: headers(token), payload: respondPayload(boundary, 'responded'),
      });
      expect(responded.statusCode, responded.body).toBe(200);
      // Answering the gate IS the go: no second control, and the answer's own response never waits on
      // Manager startup.
      await vi.waitFor(() => expect(wired.runAutomatic).toHaveBeenCalledTimes(1));
      expect(wired.runAutomatic).toHaveBeenCalledWith(expect.objectContaining({
        subject: 'operator', runRef: detail.run.runRef,
      }));
      await vi.waitFor(() => expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true, value: { run: { lifecycle: { kind: 'running', deployPause: null } } },
      }));
      expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, autoResumeInput(detail.run)))
        .toMatchObject({ ok: true, value: { phase: 'dispatched' } });
      expect(wired.activateManagedRoots).toHaveBeenCalledTimes(1);
    } finally {
      await wired.activated.close();
    }
  });

  it('resumes an engine-owned run AS ITS OWNER when the operator answers its last boundary', async () => {
    const detail = seedActivatableRun(false, ':engine', 'dashboard-engine');
    const boundary = seedOpenBoundary(detail.run.runRef, 'dashboard-engine');
    const wired = await activatedApp(undefined, {
      appendAudit: (_root: string, event: unknown) => {
        auditRows.push(event as Record<string, unknown>);
        return { ts: new Date().toISOString(), ...(event as Record<string, unknown>) };
      },
    });
    try {
      const responded = await wired.activated.inject({
        method: 'POST', url: `/api/control/human-requests/${boundary.requestRef}/respond`,
        headers: headers(token), payload: respondPayload(boundary, 'responded'),
      });
      expect(responded.statusCode, responded.body).toBe(200);
      await vi.waitFor(() => expect(wired.runAutomatic).toHaveBeenCalledTimes(1));
      // The operator authorized it; the engine that OWNS the run is what executes, exactly like the
      // stop route's cancellation. Ownership never moves.
      expect(wired.runAutomatic).toHaveBeenCalledWith(expect.objectContaining({
        subject: 'dashboard-engine', runRef: detail.run.runRef,
      }));
      await vi.waitFor(() => expect(controlStore.getRun('dashboard-engine', detail.run.runRef)).toMatchObject({
        ok: true, value: { run: { lifecycle: { kind: 'running', deployPause: null } } },
      }));
      expect(controlStore.getRunActivationReceipt('dashboard-engine', detail.run.runRef, autoResumeInput(detail.run)))
        .toMatchObject({ ok: true, value: { phase: 'dispatched' } });
      // Both the answer and the activation it triggered name the operator as ACTOR and the engine as
      // the run's owner. Ownership is never laundered by a cross-subject control.
      expect(auditRows).toContainEqual(expect.objectContaining({
        action: 'control-human-response-authorize', owner: 'operator',
        detail: expect.objectContaining({ runOwnerSubject: 'dashboard-engine' }),
      }));
      expect(auditRows).toContainEqual(expect.objectContaining({
        action: 'control-run-activate-authorize', owner: 'operator',
        detail: expect.objectContaining({ runOwnerSubject: 'dashboard-engine' }),
      }));
    } finally {
      await wired.activated.close();
    }
  });

  it('activates an engine-owned run for the operator and stays not-found for every other subject', async () => {
    const detail = seedActivatableRun(true, ':engine-activate', 'dashboard-engine');
    const payload = {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:manual`,
    };
    const wired = await activatedApp(undefined, {
      appendAudit: (_root: string, event: unknown) => {
        auditRows.push(event as Record<string, unknown>);
        return { ts: new Date().toISOString(), ...(event as Record<string, unknown>) };
      },
    });
    try {
      // The live 2026-08-11 refusal: the operator's Resume click on a bridge-launched run died as
      // not-found inside the receipt lookup, leaving activationReceipts empty.
      const stranger = await wired.activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(mintSession('another-agent', SESSION).token), payload,
      });
      expect(stranger.statusCode).toBe(404);
      expect(wired.runAutomatic).not.toHaveBeenCalled();
      expect(controlStore.getRunActivationReceipt('dashboard-engine', detail.run.runRef, payload))
        .toMatchObject({ ok: true, value: null });

      const operator = await wired.activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`,
        headers: headers(token), payload,
      });
      expect(operator.statusCode, operator.body).toBe(202);
      expect(wired.runAutomatic).toHaveBeenCalledWith(expect.objectContaining({ subject: 'dashboard-engine' }));
      expect(controlStore.getRunActivationReceipt('dashboard-engine', detail.run.runRef, payload))
        .toMatchObject({ ok: true, value: { phase: 'dispatched' } });
      // The actor is the operator; the run's owner is recorded beside it, never laundered.
      expect(auditRows).toContainEqual(expect.objectContaining({
        action: 'control-run-activate-authorize',
        owner: 'operator',
        detail: expect.objectContaining({ runOwnerSubject: 'dashboard-engine' }),
      }));
    } finally {
      await wired.activated.close();
    }
  });

  it('starts nothing while another boundary on the same run is still open', async () => {
    const detail = seedActivatableRun(false);
    const first = seedOpenBoundary(detail.run.runRef, 'operator', { title: 'First gate' });
    seedOpenBoundary(detail.run.runRef, 'operator', { title: 'Second gate' });
    const wired = await activatedApp();
    try {
      const responded = await wired.activated.inject({
        method: 'POST', url: `/api/control/human-requests/${first.requestRef}/respond`,
        headers: headers(token), payload: respondPayload(first, 'responded'),
      });
      expect(responded.statusCode, responded.body).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(wired.runAutomatic).not.toHaveBeenCalled();
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true, value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null } } },
      });
    } finally {
      await wired.activated.close();
    }
  });

  it('never resumes on a rejected decision', async () => {
    const detail = seedActivatableRun(false);
    const boundary = seedOpenBoundary(detail.run.runRef, 'operator', { kind: 'intervention', title: 'Publish refusal' });
    const wired = await activatedApp();
    try {
      const responded = await wired.activated.inject({
        method: 'POST', url: `/api/control/human-requests/${boundary.requestRef}/respond`,
        headers: headers(token), payload: respondPayload(boundary, 'rejected'),
      });
      expect(responded.statusCode, responded.body).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(wired.runAutomatic).not.toHaveBeenCalled();
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true, value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null } } },
      });
    } finally {
      await wired.activated.close();
    }
  });

  it('records the answer and leaves the run parked while the daemon is locked', async () => {
    const detail = seedActivatableRun(false);
    const boundary = seedOpenBoundary(detail.run.runRef);
    // `app` is the unarmed daemon: no broker, no executor. A locked daemon must never auto-start work.
    const responded = await app.inject({
      method: 'POST', url: `/api/control/human-requests/${boundary.requestRef}/respond`,
      headers: headers(token), payload: respondPayload(boundary, 'responded'),
    });
    expect(responded.statusCode, responded.body).toBe(200);
    expect(responded.json()).toMatchObject({ ok: true, value: { state: 'resolved' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
      ok: true, value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null }, version: detail.run.version } },
    });
    expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, autoResumeInput(detail.run)))
      .toMatchObject({ ok: true, value: null });
    // The manual Resume stays the fallback, and is what tells the operator the runtime is gated.
    const manual = await app.inject({
      method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`, headers: headers(token),
      payload: {
        expectedRunVersion: detail.run.version,
        expectedManagerGeneration: detail.run.managerGeneration,
        idempotencyKey: `activate:${detail.run.runRef}:manual`,
      },
    });
    expect(manual.statusCode).toBe(409);
    // The locked daemon's own refusal, which is what raises the unlock prompt in the UI.
    expect(manual.json()).toMatchObject({ error: 'execution-locked' });
  });

  /** Every intervention on the run, in mint order, by title — the storm is visible as a length. */
  function interventionTitles(runRef: string, owner = 'operator'): string[] {
    const detail = controlStore.getRun(owner, runRef);
    if (!detail.ok) throw new Error(detail.detail);
    return detail.value.humanRequests.filter((request) => request.kind === 'intervention').map((request) => request.title);
  }

  /**
   * A DETERMINISTIC activation refusal must not become an intervention treadmill.
   *
   * Every refusal reachable before `claimRunActivation` writes no receipt and does not bump the run
   * version, so the auto-resume key is byte-identical on the next try: answering the park re-fired the
   * same failure, which minted the next park, up to MAX_HUMAN_REQUESTS_PER_RUN — then the run was parked
   * forever with nothing left to answer.
   */
  it('parks a deterministically refused resume ONCE and never re-fires it from its own answer', async () => {
    const detail = seedActivatableRun(false);
    const boundary = seedOpenBoundary(detail.run.runRef);
    // Canonical reconciliation fails => `canonical-reconciliation-failed`, before any claim.
    const wired = await activatedApp(undefined, {
      opsGit: () => { throw new Error('ops fetch refused'); },
    });
    try {
      const responded = await wired.activated.inject({
        method: 'POST', url: `/api/control/human-requests/${boundary.requestRef}/respond`,
        headers: headers(token), payload: respondPayload(boundary, 'responded'),
      });
      expect(responded.statusCode, responded.body).toBe(200);
      await vi.waitFor(() => expect(interventionTitles(detail.run.runRef))
        .toEqual(['Launch reconciliation required', 'Automatic resume needs intervention']));
      expect(wired.runAutomatic).not.toHaveBeenCalled();

      // Answering the park itself: the run is still parked and every boundary is accepted, so the
      // predicate that drives the resume is satisfied — only the do-not-re-fire rule stops it.
      const parked = controlStore.getRun('operator', detail.run.runRef);
      if (!parked.ok) throw new Error(parked.detail);
      const parkRequest = parked.value.humanRequests.find((request) => request.title === 'Automatic resume needs intervention');
      if (!parkRequest) throw new Error('park intervention missing');
      const answeredPark = await wired.activated.inject({
        method: 'POST', url: `/api/control/human-requests/${parkRequest.requestRef}/respond`,
        headers: headers(token), payload: respondPayload(parkRequest, 'responded'),
      });
      expect(answeredPark.statusCode, answeredPark.body).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(interventionTitles(detail.run.runRef))
        .toEqual(['Launch reconciliation required', 'Automatic resume needs intervention']);
      // No second activation attempt at all: no receipt, no executor call, run untouched.
      expect(controlStore.getRunActivationReceipt('operator', detail.run.runRef, autoResumeInput(detail.run)))
        .toMatchObject({ ok: true, value: null });
      expect(wired.runAutomatic).not.toHaveBeenCalled();
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true, value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null } } },
      });
    } finally {
      await wired.activated.close();
    }
  });

  it('files ONE intervention for a failed activation dispatch, not one per surface', async () => {
    const detail = seedActivatableRun(false);
    const boundary = seedOpenBoundary(detail.run.runRef);
    // The executor returns without ever acknowledging durable Manager startup: the dispatch path fails,
    // files its own 'Activation dispatch needs reconciliation', and returns the refusal that the
    // auto-resume park would otherwise report a SECOND time for the same event.
    const wired = await activatedApp(undefined, {
      runAutomatic: async () => ({
        state: 'succeeded' as const, startedStageIds: [], completedStageIds: [], waitingStageIds: [],
      }),
    });
    try {
      const responded = await wired.activated.inject({
        method: 'POST', url: `/api/control/human-requests/${boundary.requestRef}/respond`,
        headers: headers(token), payload: respondPayload(boundary, 'responded'),
      });
      expect(responded.statusCode, responded.body).toBe(200);
      await vi.waitFor(() => expect(interventionTitles(detail.run.runRef))
        .toEqual(['Launch reconciliation required', 'Activation dispatch needs reconciliation']));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(interventionTitles(detail.run.runRef))
        .toEqual(['Launch reconciliation required', 'Activation dispatch needs reconciliation']);
    } finally {
      await wired.activated.close();
    }
  });

  it('never kicks a second time on a replayed response', async () => {
    const detail = seedActivatableRun(false);
    const boundary = seedOpenBoundary(detail.run.runRef);
    const payload = respondPayload(boundary, 'responded');
    // Record the decision on the unarmed daemon: durable, no resume.
    const first = await app.inject({
      method: 'POST', url: `/api/control/human-requests/${boundary.requestRef}/respond`,
      headers: headers(token), payload,
    });
    expect(first.statusCode, first.body).toBe(200);
    const wired = await activatedApp();
    try {
      // The identical re-submit now reaches an ARMED daemon with the boundary predicate satisfied. It is
      // still a replay — it records no new decision, so it starts nothing.
      const replayed = await wired.activated.inject({
        method: 'POST', url: `/api/control/human-requests/${boundary.requestRef}/respond`,
        headers: headers(token), payload,
      });
      expect(replayed.statusCode, replayed.body).toBe(200);
      expect(replayed.json()).toMatchObject({ replayed: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(wired.runAutomatic).not.toHaveBeenCalled();
      expect(controlStore.getRun('operator', detail.run.runRef)).toMatchObject({
        ok: true, value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null } } },
      });
    } finally {
      await wired.activated.close();
    }
  });

  /**
   * Review lineage spliced onto a REAL parked run: the gate request, the response and every post-resolve
   * read stay real (which is the whole point — the resume predicate reads post-resolve state), while the
   * receipt/loop pair the route validates is supplied here.
   */



  /**
   * The lock is keyed by the RUN (its owner + ref), not by whoever called. Keyed by the caller, an
   * operator activation ('operator') and any engine-side operation on the same run ('dashboard-engine')
   * would take DIFFERENT locks and interleave — the exclusion would be gone on exactly the headless runs
   * it exists for. This is the cross-subject twin of the own-subject stop-race test above.
   */
  it('serializes cross-subject controls on one run behind its activation', async () => {
    const detail = seedActivatableRun(true, ':engine-lock', 'dashboard-engine');
    let releasePreparation!: () => void;
    let preparationEntered!: () => void;
    const entered = new Promise<void>((resolve) => { preparationEntered = resolve; });
    const release = new Promise<void>((resolve) => { releasePreparation = resolve; });
    const { activated, cancelAutomatic, runAutomatic } = await activatedApp(async () => {
      preparationEntered();
      await release;
    });
    try {
      const activationPromise = activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/activate`, headers: headers(token),
        payload: {
          expectedRunVersion: detail.run.version, expectedManagerGeneration: detail.run.managerGeneration,
          idempotencyKey: `activate:${detail.run.runRef}:${detail.run.version}:engine-lock`,
        },
      });
      await entered;
      let stopSettled = false;
      const stopPromise = activated.inject({
        method: 'POST', url: `/api/control/runs/${detail.run.runRef}/manager/stop`, headers: headers(token),
        payload: {
          expectedRunVersion: detail.run.version, expectedManagerGeneration: detail.run.managerGeneration,
          idempotencyKey: `stop:${detail.run.runRef}:${detail.run.version}`,
        },
      }).then((value) => { stopSettled = true; return value; });
      // Long enough for an UNSERIALIZED stop to run to completion: at this point the activation has not
      // yet claimed, so a stop that reached the store would pass CAS and cancel the run. Keyed by the
      // caller instead of the run, that is exactly what happened here.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(stopSettled).toBe(false);
      expect(cancelAutomatic).not.toHaveBeenCalled();
      releasePreparation();
      const [activation, stop] = await Promise.all([activationPromise, stopPromise]);
      expect(activation.statusCode, activation.body).toBe(202);
      expect(runAutomatic).toHaveBeenCalledWith(expect.objectContaining({ subject: 'dashboard-engine' }));
      expect(stop.statusCode, stop.body).toBe(409);
      expect(stop.json()).toMatchObject({ error: 'run-state-changed' });
      expect(cancelAutomatic).not.toHaveBeenCalled();
    } finally {
      releasePreparation();
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
        value: { run: { lifecycle: { kind: 'stopping', deployPause: null }, version: detail.run.version + 1 } },
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
      ok: true, value: { phase: 'claimed', run: { lifecycle: { kind: 'recovering', deployPause: null } } },
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
          run: { lifecycle: { kind: 'waiting-human', deployPause: null } },
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
          run: { lifecycle: { kind: 'waiting-human', deployPause: null } },
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
      expect(contained.value.run.lifecycle.kind).toBe('waiting-human');
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
      expect(contained.value.run.lifecycle.kind).toBe('waiting-human');
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

  it('projects the reconciled RunDetail through the exact public run wire shape', async () => {
    const stored = controlStore.createProposalRevision('operator', {
      sourceComposerRef: 'reconcile-wire', sourceTurnId: 'reconcile-wire-turn', title: proposal.title,
      snapshot: proposal as unknown as JsonObject,
    });
    if (!stored.ok) throw new Error(stored.detail);
    const approved = controlStore.decideProposal('operator', stored.value.proposalRef, 1, {
      expectedHash: stored.value.hash, expectedApprovalRevision: 0, decision: 'approved',
      idempotencyKey: 'approve-reconcile-wire',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const created = controlStore.createRun('operator', {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
      title: proposal.title, proposalRef: stored.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: stored.value.hash, managerRuntime: proposal.manager.runtime,
      managerModel: proposal.manager.model, idempotencyKey: 'launch-reconcile-wire',
      stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!created.ok) throw new Error(created.detail);
    const publishing = controlStore.transitionPublication(
      'operator', created.value.run.runRef, created.value.run.version, 'publishing',
    );
    if (!publishing.ok) throw new Error(publishing.detail);
    const reconcile = vi.spyOn(publication, 'reconcileCanonicalPublication').mockResolvedValue({
      ok: true,
      cards: created.value.stages.map((stage) => ({
        stageId: stage.stageId,
        cardId: workflowCardId(created.value.run.runRef, stage.stageId),
        cardPath: `queue/inbox/${workflowCardId(created.value.run.runRef, stage.stageId)}.md`,
        cardState: stage.dependsOn.length === 0 ? 'inbox' : 'blocked',
        stageState: stage.dependsOn.length === 0 ? 'ready' : 'blocked',
      })),
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/control/runs/${created.value.run.runRef}/reconcile-publication`,
        headers: headers(token),
        payload: { expectedRunVersion: publishing.value.version },
      });
      expect(response.statusCode, response.body).toBe(200);
      const current = controlStore.getRun('operator', created.value.run.runRef);
      if (!current.ok) throw new Error(current.detail);
      expect(response.json()).toEqual({ ok: true, value: expect.any(Object), replayed: false });
      expectExactWireRun(
        response.json().value.run,
        current.value.run as unknown as Record<string, unknown> & { lifecycle: { kind: string } },
        { displayName: current.value.run.title, shortRef: expect.any(Number), workflowRef: null },
      );
    } finally {
      reconcile.mockRestore();
    }
  });

  it('accepts stored assigned snapshots through publication reconciliation and activation validation', async () => {
    const managerAssignment = {
      agentId: 'assigned-manager', declarationPath: 'agents/assigned-manager.md', declarationHash: 'e'.repeat(64),
      profileId: 'manager:claude:claude-opus-5', runtime: 'claude' as const, model: 'claude-opus-5',
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
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
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
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
      title: proposal.title, proposalRef: revision.proposalRef, proposalRevision: revision.revision,
      expectedProposalHash: revision.hash, managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      idempotencyKey: 'audit-failure-run', stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!run.ok) throw new Error(run.detail);
    const request = controlStore.createHumanRequest('operator', run.value.run.runRef, {
      kind: 'intervention', title: 'Audit-bound response', prompt: 'Respond only after canonical audit.',
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
        payload: { expectedRevision: 1, decision: 'responded', idempotencyKey: 'response-audit-must-land' },
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
 * enough for the UI to raise an unlock prompt, and BOTH transitions are authorized by the operator's
 * WebAuthn-minted session bearer plus an audit row — never by a second, purpose-bound ceremony of their
 * own. That second ceremony was removed: the platform's requirement is ONE dashboard unlock, and it made
 * an already-signed-in operator unlock twice to arm the executor.
 */
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
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
    title: `Run ${key}`, proposalRef: created.value.proposalRef, proposalRevision: 1,
    expectedProposalHash: created.value.hash, managerRuntime: 'claude', managerModel: 'claude-fable-5',
    idempotencyKey: `${key}-launch`,
    stages: proposal.stages.map((item) => ({ stageId: item.id, title: item.title, dependsOn: item.dependsOn })),
  });
  if (!run.ok) throw new Error(run.detail);
  return run.value.run.runRef;
}

describe('control execution latch routes', () => {

  it('requires a session, rejects unknown agents, and returns the activated worker delivery result', async () => {
    const delivery = vi.fn(async () => 'queued' as const);
    const latch = {
      snapshot: () => ({ state: 'unlocked' as const, source: 'passkey' as const, unlockedAt: 'now', unlockedBy: 'operator' }),
      current: () => ({ agentMessages: { deliver: delivery } }),
      unlock: vi.fn(), lock: vi.fn(),
    };
    const { app, token, store, audit } = buildApp({ executionLatch: latch });
    const assignment = {
      agentId: 'fyt-codex', declarationPath: 'agents/fyt-codex.md', declarationHash: 'a'.repeat(64),
      profileId: 'worker:codex:gpt-5.6-sol', runtime: 'codex' as const, model: 'gpt-5.6-sol',
    };
    const assignedProposal = { ...proposal, stages: proposal.stages.map((stage) => ({ ...stage, assignment })) };
    const created = store.createProposalRevision('operator', {
      sourceComposerRef: 'composer-agent-message', sourceTurnId: 'turn-agent-message', title: assignedProposal.title,
      snapshot: assignedProposal as unknown as JsonObject,
    });
    if (!created.ok) throw new Error(created.detail);
    if (!store.decideProposal('operator', created.value.proposalRef, 1, {
      expectedHash: created.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-agent-message',
    }).ok) throw new Error('approval failed');
    const run = store.createRun('operator', {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
      title: assignedProposal.title, proposalRef: created.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: created.value.hash, managerRuntime: assignedProposal.manager.runtime, managerModel: assignedProposal.manager.model,
      idempotencyKey: 'launch-agent-message',
      stages: assignedProposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn, assignment })),
    });
    if (!run.ok) throw new Error(run.detail);
    try {
      const anonymous = await app.inject({
        method: 'POST', url: `/api/control/runs/${run.value.run.runRef}/agents/fyt-codex/messages`,
        headers: { origin: ORIGIN, host: 'localhost:5317' }, payload: { message: 'Queue this.' },
      });
      expect(anonymous.statusCode).toBe(401);
      const unknown = await app.inject({
        method: 'POST', url: `/api/control/runs/${run.value.run.runRef}/agents/unknown/messages`, headers: headers(token), payload: { message: 'Nope.' },
      });
      expect(unknown.statusCode).toBe(404);
      const accepted = await app.inject({
        method: 'POST', url: `/api/control/runs/${run.value.run.runRef}/agents/fyt-codex/messages`, headers: headers(token), payload: { message: ' Queue this. ' },
      });
      expect(accepted.statusCode, accepted.body).toBe(202);
      expect(accepted.json()).toEqual({ delivery: 'queued' });
      expect(delivery).toHaveBeenCalledWith({
        runRef: run.value.run.runRef, agentId: 'fyt-codex', runtime: 'codex', message: 'Queue this.',
      });
      const events = store.listEvents('operator', run.value.run.runRef, 0, 200);
      expect(events).toMatchObject({
        ok: true,
        value: [expect.objectContaining({
          kind: 'message', source: 'human', stageRef: run.value.stages[0].stageRef,
          summary: expect.stringContaining('operator → fyt-codex (queued): Queue this.'),
        })],
      });
      vi.spyOn(store, 'appendEvent').mockReturnValue({ ok: false, reason: 'limit', detail: 'event limit reached' } as never);
      const droppedAudit = await app.inject({
        method: 'POST', url: `/api/control/runs/${run.value.run.runRef}/agents/fyt-codex/messages`, headers: headers(token), payload: { message: 'Still queue this.' },
      });
      expect(droppedAudit.statusCode, droppedAudit.body).toBe(202);
      expect(audit).toContainEqual(expect.objectContaining({
        action: 'control-agent-message-audit-dropped', result: 'dropped:limit', target: run.value.run.runRef,
      }));
      const oversized = await app.inject({
        method: 'POST', url: `/api/control/runs/${run.value.run.runRef}/agents/fyt-codex/messages`, headers: headers(token), payload: { message: 'x'.repeat(64 * 1024 + 1) },
      });
      expect(oversized.statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it('reads an attempt-io window only for attempts belonging to the subject-scoped run, and refuses when unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'attempt-io-route-'));
    const io = createAttemptIoStore({ root, flushMs: 0 });
    const latch = {
      snapshot: () => ({ state: 'unlocked' as const, source: 'passkey' as const, unlockedAt: 'now', unlockedBy: 'operator' }),
      current: () => ({ attemptIo: io }), unlock: vi.fn(), lock: vi.fn(),
    };
    const { app, token, store } = buildApp({ executionLatch: latch });
    try {
      const runRef = seedRun(store, 'attempt-io');
      const detail = store.getRun('operator', runRef);
      if (!detail.ok) throw new Error(detail.detail);
      const attempt = store.createAttempt('operator', detail.value.stages[0].stageRef, {
        expectedStageVersion: detail.value.stages[0].version, runtime: 'codex', model: 'gpt-5.6-sol',
      });
      if (!attempt.ok) throw new Error(attempt.detail);
      io.append(attempt.value.attemptRef, 'out', 'first');
      io.append(attempt.value.attemptRef, 'out', 'second');

      const read = await app.inject({
        method: 'GET', url: `/api/control/runs/${runRef}/attempts/${attempt.value.attemptRef}/io?after=1&limit=500`, headers: headers(token),
      });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json()).toEqual({ entries: [expect.objectContaining({ seq: 2, dir: 'out', line: 'second' })] });

      const otherRun = seedRun(store, 'attempt-io-other');
      const otherDetail = store.getRun('operator', otherRun);
      if (!otherDetail.ok) throw new Error(otherDetail.detail);
      const otherAttempt = store.createAttempt('operator', otherDetail.value.stages[0].stageRef, {
        expectedStageVersion: otherDetail.value.stages[0].version, runtime: 'codex', model: 'gpt-5.6-sol',
      });
      if (!otherAttempt.ok) throw new Error(otherAttempt.detail);
      const foreign = await app.inject({
        method: 'GET', url: `/api/control/runs/${runRef}/attempts/${otherAttempt.value.attemptRef}/io`, headers: headers(token),
      });
      expect(foreign.statusCode).toBe(404);
    } finally {
      io.stop();
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }

    const unavailable = buildApp({
      executionLatch: {
        snapshot: () => ({ state: 'unlocked' as const, source: 'passkey' as const, unlockedAt: 'now', unlockedBy: 'operator' }),
        current: () => null, unlock: vi.fn(), lock: vi.fn(),
      },
    });
    try {
      const runRef = seedRun(unavailable.store, 'attempt-io-unavailable');
      const detail = unavailable.store.getRun('operator', runRef);
      if (!detail.ok) throw new Error(detail.detail);
      const attempt = unavailable.store.createAttempt('operator', detail.value.stages[0].stageRef, {
        expectedStageVersion: detail.value.stages[0].version, runtime: 'codex', model: 'gpt-5.6-sol',
      });
      if (!attempt.ok) throw new Error(attempt.detail);
      const response = await unavailable.app.inject({
        method: 'GET', url: `/api/control/runs/${runRef}/attempts/${attempt.value.attemptRef}/io`, headers: headers(unavailable.token),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: 'attempt-io-unavailable' });
    } finally { await unavailable.app.close(); }
  });

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

  it('unlocks under the ONE dashboard session with no second ceremony, and audits the transition', async () => {
    const { latch, unlock } = fakeLatch('locked');
    const { app, token, audit } = buildApp({ executionLatch: latch });
    try {
      const unlocked = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock', headers: headers(token), payload: {},
      });
      expect(unlocked.statusCode, unlocked.body).toBe(200);
      expect(unlocked.json()).toMatchObject({ ok: true });
      // The bearer's own subject authorizes it — no assertion, no ceremonyId, no second biometric.
      expect(unlock).toHaveBeenCalledWith({ subject: 'operator' });
      const row = audit.find((entry) => entry.action === 'control-execution-unlock-authorize');
      expect(row).toMatchObject({
        owner: 'operator', target: 'execution', riskTier: 'T3',
        result: 'authorized:unlock', detail: { method: 'session-bearer' },
      });
    } finally {
      await app.close();
    }
  });

  it('blocks control launches and unlocks while degraded, but still accepts the execution lock', async () => {
    const { latch, unlock, lock } = fakeLatch('locked');
    const degraded = { pending: 100, oldestAgeMs: 1_000, degraded: true, reasons: ['pending-limit'] };
    const { app, token } = buildApp({ executionLatch: latch, admission: (kind: Parameters<SurfaceContext['admission']>[0]) => admit(kind, degraded) });
    try {
      const launch = await app.inject({
        method: 'POST', url: '/api/control/proposals/missing/revisions/1/launch', headers: headers(token), payload: {},
      });
      expect(launch.statusCode).toBe(503);
      expect(launch.json()).toMatchObject({ error: 'outbox-degraded' });
      const unlockResponse = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock', headers: headers(token), payload: {},
      });
      expect(unlockResponse.statusCode).toBe(503);
      expect(unlock).not.toHaveBeenCalled();
      const lockResponse = await app.inject({
        method: 'POST', url: '/api/control/execution/lock', headers: headers(token), payload: {},
      });
      expect(lockResponse.statusCode).toBe(200);
      expect(lock).toHaveBeenCalledWith({ subject: 'operator' });
    } finally {
      await app.close();
    }
  });

  it('the removed purpose-bound unlock ceremony route is gone entirely', async () => {
    const { app, token } = buildApp();
    try {
      const options = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock/options', headers: headers(token), payload: {},
      });
      expect(options.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('still fails closed without a session, and never unlocks when the latch is absent', async () => {
    const { latch, unlock } = fakeLatch('locked');
    const { app } = buildApp({ executionLatch: latch });
    try {
      // No bearer: the scope's requireSession preHandler refuses before the handler runs.
      const anonymous = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock',
        headers: { origin: ORIGIN, host: 'localhost:5317' }, payload: {},
      });
      expect(anonymous.statusCode).toBe(401);

      // A forged/garbage bearer is refused the same way — the session is verified, never trusted.
      const forged = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock',
        headers: { origin: ORIGIN, host: 'localhost:5317', authorization: 'Bearer not.a.real.token' }, payload: {},
      });
      expect(forged.statusCode).toBe(401);

      expect(unlock).not.toHaveBeenCalled();
      expect(latch.snapshot().state).toBe('locked');
    } finally {
      await app.close();
    }
  });

  it('refuses to unlock when no execution latch is wired', async () => {
    // An injected executor skips latch construction entirely (`activationOverridden` in surface.ts),
    // so there is nothing to unlock and the route says so rather than pretending it armed anything.
    const { app, token } = buildApp({ controlBroker: { drain: () => {} } });
    try {
      const unlocked = await app.inject({
        method: 'POST', url: '/api/control/execution/unlock', headers: headers(token), payload: {},
      });
      expect(unlocked.statusCode).toBe(409);
      expect(unlocked.json()).toMatchObject({ error: 'execution-latch-unavailable' });
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

  it('serves durable run detail and the execution posture the canvas reads', async () => {
    const { latch } = fakeLatch('unlocked');
    const { app, token, store } = buildApp({ executionLatch: latch });
    try {
      const runRef = seedRun(store, 'roster');

      const detail = await app.inject({
        method: 'GET', url: `/api/control/runs/${runRef}`, headers: headers(token),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        ok: true,
        execution: { state: 'unlocked' },
        value: { run: { runRef } },
      });
      expect(detail.json()).not.toHaveProperty('roster');

      // A missing run still 404s.
      const missing = await app.inject({ method: 'GET', url: '/api/control/runs/run-absent', headers: headers(token) });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('audits then invokes only the exact legacy reclassification under same-subject passkey wiring', async () => {
    const order: string[] = [];
    const runAutomatic = vi.fn();
    const cancelAutomatic = vi.fn();
    const containManagerStart = vi.fn();
    const verifyCanonicalResult = vi.fn();
    const broker = { drain: vi.fn() };
    const execution = {
      controlBroker: broker,
      runAutomatic,
      cancelAutomatic,
      containManagerStart,
      verifyCanonicalResult,
    };
    const latch = {
      snapshot: () => ({ state: 'unlocked' as const, source: 'passkey' as const, unlockedAt: '2026-08-01T02:30:00.000Z', unlockedBy: 'operator' }),
      current: () => execution,
      unlock: vi.fn(), lock: vi.fn(),
    };
    const activateManagedRoots = vi.fn();
    const { app, token, store, audit } = buildApp({
      executionLatch: latch, controlBroker: broker,
      runAutomatic, cancelAutomatic, containManagerStart, verifyCanonicalResult, activateManagedRoots,
      appendAudit: (_root: string, event: Record<string, unknown>) => {
        order.push('audit');
        audit.push(event);
        return { ts: '2026-08-01T02:31:00.000Z', action: String(event.action) } as never;
      },
    });
    let recoveredState = false;
    const recoveryResult = {
      request: {
        requestRef: 'request-86d0fc5f-797b-483c-a706-96a45e6f4d6e',
        runRef: 'run-0aa72053-b9d7-41fa-a034-19871b66d214', stageRef: null,
        kind: 'intervention', revision: 2, state: 'open',
        title: 'Automatic execution activation is gated',
        prompt: 'Canonical cards are published. Unlock execution with your passkey, mark this intervention responded, then resume this same run.',
        response: null, createdAt: '2026-08-01T02:04:04.762Z', updatedAt: '2026-08-01T02:31:00.000Z',
      },
      event: { cursor: 2 },
    };
    const preflight = vi.spyOn(store, 'preflightAuthorized20260731ExecutionLock').mockImplementation(() => ({
      ok: true,
      value: recoveredState
        ? { disposition: 'replay', result: recoveryResult }
        : { disposition: 'eligible', result: null },
    } as never));
    const recover = vi.spyOn(store, 'recoverAuthorized20260731ExecutionLock').mockImplementation(() => {
      order.push('store');
      recoveredState = true;
      return { ok: true, value: recoveryResult } as never;
    });
    try {
      const stale = await app.inject({
        method: 'POST', url: '/api/control/recovery/2026-07-31/execution-lock', headers: headers(token),
        payload: { expectedRunVersion: 5, expectedManagerGeneration: 1, expectedRequestRevision: 1, idempotencyKey: 'stale-repair' },
      });
      expect(stale.statusCode).toBe(409);
      expect(order).toEqual([]);
      expect(recover).not.toHaveBeenCalled();
      const response = await app.inject({
        method: 'POST', url: '/api/control/recovery/2026-07-31/execution-lock', headers: headers(token),
        payload: { expectedRunVersion: 4, expectedManagerGeneration: 1, expectedRequestRevision: 1, idempotencyKey: 'authorized-repair' },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(order).toEqual(['audit', 'store']);
      expect(audit.at(-1)).toMatchObject({
        action: 'control-legacy-execution-lock-reclassify-authorize', riskTier: 'T3',
        target: 'request-86d0fc5f-797b-483c-a706-96a45e6f4d6e',
        detail: { runRef: 'run-0aa72053-b9d7-41fa-a034-19871b66d214' },
      });
      expect(recover).toHaveBeenCalledWith('operator', {
        expectedRunVersion: 4, expectedManagerGeneration: 1, expectedRequestRevision: 1, idempotencyKey: 'authorized-repair',
      });
      expect(runAutomatic).not.toHaveBeenCalled();
      expect(cancelAutomatic).not.toHaveBeenCalled();
      expect(activateManagedRoots).not.toHaveBeenCalled();
      const lostResponseReplay = await app.inject({
        method: 'POST', url: '/api/control/recovery/2026-07-31/execution-lock', headers: headers(token),
        payload: { expectedRunVersion: 4, expectedManagerGeneration: 1, expectedRequestRevision: 1, idempotencyKey: 'authorized-repair' },
      });
      expect(lostResponseReplay.statusCode, lostResponseReplay.body).toBe(200);
      expect(lostResponseReplay.json()).toMatchObject({ ok: true, replayed: true });
      expect(audit.filter((row) => row.action === 'control-legacy-execution-lock-reclassify-authorize')).toHaveLength(1);
      expect(recover).toHaveBeenCalledTimes(1);
      expect(preflight).toHaveBeenCalledTimes(3);
    } finally { await app.close(); }
  });

  it('fails closed before store mutation when latch, wiring, or T3 audit is not exact', async () => {
    const body = { expectedRunVersion: 4, expectedManagerGeneration: 1, expectedRequestRevision: 1, idempotencyKey: 'authorized-repair' };
    const locked = buildApp();
    vi.spyOn(locked.store, 'preflightAuthorized20260731ExecutionLock').mockReturnValue({
      ok: true, value: { disposition: 'eligible', result: null },
    } as never);
    const lockedRecover = vi.spyOn(locked.store, 'recoverAuthorized20260731ExecutionLock');
    try {
      const response = await locked.app.inject({
        method: 'POST', url: '/api/control/recovery/2026-07-31/execution-lock', headers: headers(locked.token), payload: body,
      });
      expect(response.statusCode).toBe(409);
      expect(lockedRecover).not.toHaveBeenCalled();
      expect(locked.audit).toHaveLength(0);
    } finally { await locked.app.close(); }

    const broker = { drain: vi.fn() };
    const exactRun = vi.fn();
    const execution = {
      controlBroker: broker, runAutomatic: exactRun,
      cancelAutomatic: vi.fn(), verifyCanonicalResult: vi.fn(),
    };
    const latch = {
      snapshot: () => ({ state: 'unlocked' as const, source: 'passkey' as const, unlockedAt: 'now', unlockedBy: 'operator' }),
      current: () => execution, unlock: vi.fn(), lock: vi.fn(),
    };
    const mismatched = buildApp({
      executionLatch: latch, controlBroker: broker, runAutomatic: vi.fn(),
      cancelAutomatic: execution.cancelAutomatic, verifyCanonicalResult: execution.verifyCanonicalResult,
    });
    vi.spyOn(mismatched.store, 'preflightAuthorized20260731ExecutionLock').mockReturnValue({
      ok: true, value: { disposition: 'eligible', result: null },
    } as never);
    const mismatchRecover = vi.spyOn(mismatched.store, 'recoverAuthorized20260731ExecutionLock');
    try {
      const response = await mismatched.app.inject({
        method: 'POST', url: '/api/control/recovery/2026-07-31/execution-lock', headers: headers(mismatched.token), payload: body,
      });
      expect(response.statusCode).toBe(409);
      expect(mismatchRecover).not.toHaveBeenCalled();
      expect(mismatched.audit).toHaveLength(0);
    } finally { await mismatched.app.close(); }

    const auditFailure = buildApp({
      executionLatch: latch, controlBroker: broker, runAutomatic: exactRun,
      cancelAutomatic: execution.cancelAutomatic, verifyCanonicalResult: execution.verifyCanonicalResult,
      appendAudit: () => { throw new Error('audit unavailable'); },
    });
    vi.spyOn(auditFailure.store, 'preflightAuthorized20260731ExecutionLock').mockReturnValue({
      ok: true, value: { disposition: 'eligible', result: null },
    } as never);
    const auditRecover = vi.spyOn(auditFailure.store, 'recoverAuthorized20260731ExecutionLock');
    try {
      const response = await auditFailure.app.inject({
        method: 'POST', url: '/api/control/recovery/2026-07-31/execution-lock', headers: headers(auditFailure.token), payload: body,
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: 'legacy-recovery-audit-required' });
      expect(auditRecover).not.toHaveBeenCalled();
    } finally { await auditFailure.app.close(); }

    const ineligible = buildApp();
    vi.spyOn(ineligible.store, 'preflightAuthorized20260731ExecutionLock').mockReturnValue({
      ok: false, reason: 'conflict', detail: 'progressed state',
    });
    const ineligibleRecover = vi.spyOn(ineligible.store, 'recoverAuthorized20260731ExecutionLock');
    try {
      const response = await ineligible.app.inject({
        method: 'POST', url: '/api/control/recovery/2026-07-31/execution-lock', headers: headers(ineligible.token), payload: body,
      });
      expect(response.statusCode).toBe(409);
      expect(ineligibleRecover).not.toHaveBeenCalled();
      expect(ineligible.audit.filter((row) => row.action === 'control-legacy-execution-lock-reclassify-authorize')).toHaveLength(0);
    } finally { await ineligible.app.close(); }
  });
});

/**
 * spec §3b — the governed dismissal of a dead run.
 *
 * What has to hold: the write is session-gated, the T3 audit row lands BEFORE the store mutation (and a
 * failed audit refuses), the operator reason reaches that row, the whole thing replays on the same key,
 * and an archived run leaves the default run list while staying readable by ref.
 */
describe('control run archive route', () => {
  /** Publish `runRef` and park it at waiting-human with one open ask — an archivable dead run. */
  function parkRun(store: ReturnType<typeof createInMemoryControlPlaneStore>, runRef: string, key: string): string {
    const run = store.getRun('operator', runRef);
    if (!run.ok) throw new Error(run.detail);
    const publishing = store.transitionPublication('operator', runRef, run.value.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = store.transitionPublication('operator', runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const parked = store.transitionRun('operator', runRef, published.value.version, 'waiting-human');
    if (!parked.ok) throw new Error(parked.detail);
    const request = store.createHumanRequest('operator', runRef, {
      kind: 'intervention', title: `Manager boot failed (${key})`, prompt: 'Error: spawn claude ENOENT',
    });
    if (!request.ok) throw new Error(request.detail);
    return request.value.requestRef;
  }

  it('audits at T3 with the operator reason, archives, resolves the open ask, and replays', async () => {
    const { app, token, store, audit } = buildApp();
    try {
      const runRef = seedRun(store, 'archive');
      const requestRef = parkRun(store, runRef, 'archive');
      const payload = { idempotencyKey: `archive:${runRef}:1`, reason: 'obsolete thin-slice validation run' };

      const archived = await app.inject({
        method: 'POST', url: `/api/control/runs/${runRef}/archive`, headers: headers(token), payload,
      });
      expect(archived.statusCode).toBe(200);
      expect(archived.json()).toMatchObject({ ok: true, value: { run: { runRef, state: 'archived' } } });

      const row = audit.find((event) => event.action === 'control-run-archive-authorize');
      expect(row).toMatchObject({
        owner: 'operator', target: runRef, riskTier: 'T3',
        detail: { runRef, runState: 'waiting-human', openHumanRequestCount: 1, reason: payload.reason },
      });

      // The ask is resolved by the same commit — nothing is left waiting on a dismissed run.
      const detail = store.getRun('operator', runRef);
      if (!detail.ok) throw new Error(detail.detail);
      expect(detail.value.humanRequests.find((item) => item.requestRef === requestRef)).toMatchObject({
        state: 'resolved', response: { decision: 'responded', response: payload.reason },
      });

      // A replay is idempotent AND does not write a second audit row.
      const replay = await app.inject({
        method: 'POST', url: `/api/control/runs/${runRef}/archive`, headers: headers(token), payload,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ replayed: true });
      expect(audit.filter((event) => event.action === 'control-run-archive-authorize')).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('refuses without a session and refuses a body with no idempotency key', async () => {
    const { app, token, store } = buildApp();
    try {
      const runRef = seedRun(store, 'archive-guard');
      parkRun(store, runRef, 'archive-guard');

      const anonymous = await app.inject({
        method: 'POST', url: `/api/control/runs/${runRef}/archive`,
        headers: { origin: ORIGIN, host: 'localhost:5317', 'content-type': 'application/json' },
        payload: { idempotencyKey: 'k' },
      });
      expect(anonymous.statusCode).toBe(401);

      const invalid = await app.inject({
        method: 'POST', url: `/api/control/runs/${runRef}/archive`, headers: headers(token), payload: { reason: 'why' },
      });
      expect(invalid.statusCode).toBe(400);
      expect(store.getRun('operator', runRef)).toMatchObject({ ok: true, value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null } } } });
    } finally {
      await app.close();
    }
  });

  it('does not archive when the T3 audit cannot be written', async () => {
    const { app, token, store } = buildApp({
      appendAudit: () => { throw new Error('audit unavailable'); },
    });
    try {
      const runRef = seedRun(store, 'archive-audit');
      parkRun(store, runRef, 'archive-audit');

      const refused = await app.inject({
        method: 'POST', url: `/api/control/runs/${runRef}/archive`, headers: headers(token),
        payload: { idempotencyKey: 'archive-audit-1', reason: 'dead' },
      });
      expect(refused.statusCode).toBe(500);
      expect(refused.json()).toEqual({ error: 'run-archive-audit-required' });
      expect(store.getRun('operator', runRef)).toMatchObject({ ok: true, value: { run: { lifecycle: { kind: 'waiting-human', deployPause: null } } } });
    } finally {
      await app.close();
    }
  });

  it('refuses to archive a live run', async () => {
    const { app, token, store } = buildApp();
    try {
      const runRef = seedRun(store, 'archive-live');
      const run = store.getRun('operator', runRef);
      if (!run.ok) throw new Error(run.detail);
      if (!store.transitionRun('operator', runRef, run.value.run.version, 'running').ok) throw new Error('transition failed');

      const refused = await app.inject({
        method: 'POST', url: `/api/control/runs/${runRef}/archive`, headers: headers(token),
        payload: { idempotencyKey: 'archive-live-1' },
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error).toBe('invalid');
    } finally {
      await app.close();
    }
  });

  it('drops archived runs from the default list and returns them only with includeArchived=1', async () => {
    const { app, token, store } = buildApp();
    try {
      const archivedRef = seedRun(store, 'archive-list-a');
      const liveRef = seedRun(store, 'archive-list-b');
      parkRun(store, archivedRef, 'archive-list-a');
      const done = await app.inject({
        method: 'POST', url: `/api/control/runs/${archivedRef}/archive`, headers: headers(token),
        payload: { idempotencyKey: 'archive-list-1', reason: 'stale' },
      });
      expect(done.statusCode).toBe(200);

      const listed = await app.inject({ method: 'GET', url: '/api/control/runs', headers: headers(token) });
      expect(listed.json().runs.map((run: { runRef: string }) => run.runRef)).toEqual([liveRef]);

      const all = await app.inject({ method: 'GET', url: '/api/control/runs?includeArchived=1', headers: headers(token) });
      expect(all.json().runs.map((run: { runRef: string }) => run.runRef).sort()).toEqual([archivedRef, liveRef].sort());

      // Archiving hides a run from lists; it never makes it unreadable.
      const detail = await app.inject({ method: 'GET', url: `/api/control/runs/${archivedRef}`, headers: headers(token) });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ value: { run: { state: 'archived' } } });
    } finally {
      await app.close();
    }
  });

  it('gives every human request a plain-language ask and demotes the raw text to technicalDetail', async () => {
    const { app, token, store } = buildApp();
    try {
      const runRef = seedRun(store, 'archive-ask');
      parkRun(store, runRef, 'archive-ask');

      const detail = await app.inject({ method: 'GET', url: `/api/control/runs/${runRef}`, headers: headers(token) });
      const request = detail.json().value.humanRequests[0];
      expect(request.ask).toMatch(/never got started/i);
      // The ask names the run the operator recognizes, and no traceback reaches it.
      expect(request.ask).toContain(detail.json().value.run.displayName);
      expect(request.ask).not.toMatch(/ENOENT/);
      expect(request.technicalDetail).toMatch(/ENOENT/);
    } finally {
      await app.close();
    }
  });
});

/**
 * Operator cross-subject authority (rulings, 2026-08-11).
 *
 * Runs are owned by the subject that created them. The SPA session is `operator`; everything the queue
 * bridge and the executor launch is owned by `dashboard-engine`. Before the first ruling, the operator's
 * own session could not see those runs AT ALL — not in the list, not in the Workflows graph, not by ref,
 * not their events — which is what made every def-card run look like it had never happened.
 *
 * That ruling widened READS only, and the consequence was worse than the symptom it fixed: the Inbox
 * then LISTED human gates on engine-owned runs, rendered them answerable, and 404'd on submit; operator
 * message / steer / stop / archive were unreachable on exactly the headless runs those controls exist
 * for. Daniel's follow-up ruling: the verified operator session carries FULL MUTATION AUTHORITY across
 * every subject's runs.
 *
 * Every other subject keeps exact own-subject scoping on reads AND mutations, a widened mutation never
 * moves ownership, and the audit row names the operator as the actor beside the run's owner.
 */
describe('operator cross-subject authority', () => {
  /** One approved+launched run owned by `subject`, imported the way the workflow registry imports one. */
  function seedRunFor(
    store: ReturnType<typeof createInMemoryControlPlaneStore>,
    subject: string,
    key: string,
    workflowDefId: string,
  ): string {
    const created = store.createProposalRevision(subject, {
      sourceComposerRef: 'workflow-registry', sourceTurnId: workflowDefId, title: `Run ${key}`,
      snapshot: proposal as unknown as JsonObject,
    });
    if (!created.ok) throw new Error(created.detail);
    if (!store.decideProposal(subject, created.value.proposalRef, 1, {
      expectedHash: created.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: `${key}-approve`,
    }).ok) throw new Error('approval failed');
    const run = store.createRun(subject, {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
      title: `Run ${key}`, proposalRef: created.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: created.value.hash, managerRuntime: 'claude', managerModel: 'claude-fable-5',
      idempotencyKey: `${key}-launch`,
      stages: proposal.stages.map((item) => ({ stageId: item.id, title: item.title, dependsOn: item.dependsOn })),
    });
    if (!run.ok) throw new Error(run.detail);
    const event = store.appendEvent(subject, run.value.run.runRef, {
      kind: 'lifecycle', source: 'system', summary: `${key} started`,
    });
    if (!event.ok) throw new Error(event.detail);
    return run.value.run.runRef;
  }

  it('lists, opens and streams a dashboard-engine run, and files it under its workflow definition', async () => {
    const { app, store, token } = buildApp();
    try {
      const engineRun = seedRunFor(store, 'dashboard-engine', 'engine', 'daily-news');

      const list = await app.inject({ method: 'GET', url: '/api/control/runs', headers: headers(token) });
      expect(list.statusCode).toBe(200);
      const listed = (list.json() as { runs: Array<{ runRef: string; workflowRef: string | null }> }).runs;
      // The run is reachable AND labelled: `workflowRefIndex` is built at the same scope as the list, so
      // the def-card run lands under its definition's row instead of falling out of the graph.
      expect(listed).toEqual([expect.objectContaining({ runRef: engineRun, workflowRef: 'daily-news' })]);

      const detail = await app.inject({ method: 'GET', url: `/api/control/runs/${engineRun}`, headers: headers(token) });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ ok: true, value: { run: { runRef: engineRun, workflowRef: 'daily-news' } } });
      // Child records come back under the RUN's subject, not the reader's — an empty stage list here
      // would be a run that "opens" and shows nothing.
      expect((detail.json() as { value: { stages: unknown[] } }).value.stages).toHaveLength(proposal.stages.length);

      const events = await app.inject({ method: 'GET', url: `/api/control/runs/${engineRun}/events`, headers: headers(token) });
      expect(events.statusCode).toBe(200);
      expect((events.json() as { items: Array<{ summary: string }> }).items.map((event) => event.summary))
        .toContain('engine started');
    } finally { await app.close(); }
  });

  it('gives a non-operator subject its OWN runs only — the widening is the operator identity, not the session', async () => {
    const { app, store } = buildApp();
    try {
      const engineRun = seedRunFor(store, 'dashboard-engine', 'engine', 'daily-news');
      seedRunFor(store, 'other-agent', 'other', 'other-workflow');
      const otherToken = mintSession('other-agent', SESSION).token;

      const list = await app.inject({ method: 'GET', url: '/api/control/runs', headers: headers(otherToken) });
      expect((list.json() as { runs: Array<{ runRef: string }> }).runs.map((run) => run.runRef)).not.toContain(engineRun);

      expect((await app.inject({
        method: 'GET', url: `/api/control/runs/${engineRun}`, headers: headers(otherToken),
      })).statusCode).toBe(404);
      expect((await app.inject({
        method: 'GET', url: `/api/control/runs/${engineRun}/events`, headers: headers(otherToken),
      })).statusCode).toBe(404);
    } finally { await app.close(); }
  });

  /** Park an engine-owned run on `waiting-human` with one open gate — the state the Inbox lists it in. */
  function parkEngineRunWithGate(
    store: ReturnType<typeof createInMemoryControlPlaneStore>,
    runRef: string,
  ): { requestRef: string; version: number } {
    const run = store.getRun('dashboard-engine', runRef);
    if (!run.ok) throw new Error(run.detail);
    const publishing = store.transitionPublication('dashboard-engine', runRef, run.value.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = store.transitionPublication('dashboard-engine', runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const parked = store.transitionRun('dashboard-engine', runRef, published.value.version, 'waiting-human');
    if (!parked.ok) throw new Error(parked.detail);
    const request = store.createHumanRequest('dashboard-engine', runRef, {
      kind: 'input', title: 'Publish the cut?', prompt: 'Confirm the render before it goes out.',
    });
    if (!request.ok) throw new Error(request.detail);
    return { requestRef: request.value.requestRef, version: parked.value.version };
  }

  it('names the owning subject on every listed run and on run detail', async () => {
    const { app, store, token } = buildApp();
    try {
      const engineRun = seedRunFor(store, 'dashboard-engine', 'engine', 'daily-news');
      const ownRun = seedRunFor(store, 'operator', 'own', 'daily-news');

      const list = await app.inject({ method: 'GET', url: '/api/control/runs', headers: headers(token) });
      const listed = (list.json() as { runs: Array<{ runRef: string; ownerSubject: string }> }).runs;
      expect(listed.map((run) => [run.runRef, run.ownerSubject]).sort())
        .toEqual([[engineRun, 'dashboard-engine'], [ownRun, 'operator']].sort());

      const detail = await app.inject({ method: 'GET', url: `/api/control/runs/${engineRun}`, headers: headers(token) });
      expect(detail.json()).toMatchObject({ ok: true, value: { ownerSubject: 'dashboard-engine' } });
    } finally { await app.close(); }
  });

  it('answers a human gate on a dashboard-engine run end to end: operator audited and recorded, run resumable', async () => {
    const { app, store, audit, token } = buildApp();
    try {
      const engineRun = seedRunFor(store, 'dashboard-engine', 'engine', 'daily-news');
      const { requestRef, version } = parkEngineRunWithGate(store, engineRun);

      // The exact P0 symptom: the Inbox lists this gate (via the widened read) and the SPA submits here.
      const answered = await app.inject({
        method: 'POST', url: `/api/control/human-requests/${requestRef}/respond`, headers: headers(token),
        payload: { expectedRevision: 1, decision: 'responded', idempotencyKey: `respond:${requestRef}`, response: 'ship it' },
      });
      expect(answered.statusCode, answered.body).toBe(200);

      // ATTRIBUTION: the T3 row names the operator as the ACTOR and the engine as the run's owner, so a
      // cross-subject answer is attributable from the ledger alone.
      expect(audit.find((row) => row.action === 'control-human-response-authorize')).toMatchObject({
        owner: 'operator', target: requestRef, riskTier: 'T2', result: 'authorized:responded',
        detail: { requestRef, runRef: engineRun, runOwnerSubject: 'dashboard-engine' },
      });

      // The RESPONSE names the operator; the RUN is still the engine's, with its whole record tree.
      const owned = store.getRun('dashboard-engine', engineRun);
      if (!owned.ok) throw new Error(owned.detail);
      expect(owned.value.ownerSubject).toBe('dashboard-engine');
      expect(owned.value.humanRequests).toEqual([expect.objectContaining({
        requestRef, state: 'resolved', response: expect.objectContaining({ respondedBy: 'operator', decision: 'responded' }),
      })]);
      expect(store.listRuns('operator')).toEqual([]);
      // The governance event landed on the run's OWN timeline, not on an operator partition.
      const events = store.listEvents('dashboard-engine', engineRun);
      if (!events.ok) throw new Error(events.detail);
      expect(events.value.map((event) => event.summary)).toContain('Human Request responded at revision 1');

      // Boundary accepted, so the owner can move the run on — it is genuinely unblocked, not just green.
      // Answering a gate resolves the REQUEST; it does not itself bump the run — the owner's own
      // transition below is what moves the run, and it is now allowed to.
      expect(owned.value.run.version).toBe(version);
      expect(store.transitionRun('dashboard-engine', engineRun, owned.value.run.version, 'running'))
        .toMatchObject({ ok: true });
    } finally { await app.close(); }
  });

  it('rejects a stale response revision before audit, event, or resume', async () => {
    const { app, store, audit, token } = buildApp();
    try {
      const engineRun = seedRunFor(store, 'dashboard-engine', 'stale-response', 'daily-news');
      const { requestRef, version } = parkEngineRunWithGate(store, engineRun);
      const response = await app.inject({
        method: 'POST', url: `/api/control/human-requests/${requestRef}/respond`, headers: headers(token),
        payload: { expectedRevision: 2, decision: 'responded', idempotencyKey: `stale:${requestRef}`, response: 'ship it' },
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json()).toEqual({ error: 'request-revision-changed' });
      expect(audit.some((row) => row.action === 'control-human-response-authorize')).toBe(false);
      expect(store.getHumanRequest('dashboard-engine', requestRef)).toMatchObject({
        ok: true, value: { state: 'open', revision: 1, response: null },
      });
      const run = store.getRun('dashboard-engine', engineRun);
      if (!run.ok) throw new Error(run.detail);
      expect(run.value.run).toMatchObject({ lifecycle: { kind: 'waiting-human' }, version });
      const events = store.listEvents('dashboard-engine', engineRun);
      if (!events.ok) throw new Error(events.detail);
      expect(events.value.some((event) => event.summary?.includes('responded') === true)).toBe(false);
    } finally { await app.close(); }
  });

  it('messages, steers and stops a dashboard-engine run — the executor still acts as the run`s owner', async () => {
    const queued: Array<[string, string]> = [];
    const cancelAutomatic = vi.fn(async () => ({
      state: 'stopped' as const, stoppedSessionRefs: [], interruptedSessionRefs: [], replayed: false,
    }));
    const controlBroker = {
      isRunning: () => true,
      drain: () => {},
      queueInstruction: (_session: string, message: string) => { queued.push(['message', message]); return true; },
      queueInstructionAtCheckpoint: (_s: string, checkpoint: string, instruction: string) => {
        queued.push([checkpoint, instruction]); return true;
      },
    };
    const { app, store, token } = buildApp({ controlBroker, cancelAutomatic });
    try {
      const engineRun = seedRunFor(store, 'dashboard-engine', 'engine', 'daily-news');
      const current = store.getRun('dashboard-engine', engineRun);
      if (!current.ok) throw new Error(current.detail);
      const cas = { expectedRunVersion: current.value.run.version, expectedManagerGeneration: current.value.run.managerGeneration };

      const message = await app.inject({
        method: 'POST', url: `/api/control/runs/${engineRun}/manager/messages`, headers: headers(token),
        payload: { ...cas, idempotencyKey: 'operator-message', message: 'Start with the failing test.' },
      });
      expect(message.statusCode, message.body).toBe(200);

      const steer = await app.inject({
        method: 'POST', url: `/api/control/runs/${engineRun}/manager/steer`, headers: headers(token),
        payload: { ...cas, idempotencyKey: 'operator-steer', checkpoint: 'safe-1', instruction: 'Inspect the diff.' },
      });
      expect(steer.statusCode, steer.body).toBe(200);
      expect(queued).toEqual([['message', 'Start with the failing test.'], ['safe-1', 'Inspect the diff.']]);

      const stop = await app.inject({
        method: 'POST', url: `/api/control/runs/${engineRun}/manager/stop`, headers: headers(token),
        payload: { ...cas, idempotencyKey: 'operator-stop' },
      });
      expect(stop.statusCode, stop.body).toBe(200);
      // The executor is handed the RUN'S OWNER, not the caller: it walks the run's whole record tree
      // with one subject and every one of those store writes is own-subject by design. Nothing about
      // the engine widened — the operator's authority was spent at the session gate and the scoped read.
      expect(cancelAutomatic).toHaveBeenCalledWith(expect.objectContaining({
        subject: 'dashboard-engine', runRef: engineRun, reason: 'operator requested stop',
      }));

      // Both manager commands are on the ENGINE's own timeline.
      const events = store.listEvents('dashboard-engine', engineRun);
      if (!events.ok) throw new Error(events.detail);
      expect(events.value.map((event) => event.summary))
        .toEqual(['engine started', 'Start with the failing test.', 'Inspect the diff.']);
      expect(store.listRuns('operator')).toEqual([]);
    } finally { await app.close(); }
  });

  it('archives a dashboard-engine run with unchanged semantics, audited to the operator', async () => {
    const { app, store, audit, token } = buildApp();
    try {
      const engineRun = seedRunFor(store, 'dashboard-engine', 'engine', 'daily-news');
      const { requestRef } = parkEngineRunWithGate(store, engineRun);
      const payload = { idempotencyKey: `archive:${engineRun}:1`, reason: 'obsolete validation run' };

      const archived = await app.inject({
        method: 'POST', url: `/api/control/runs/${engineRun}/archive`, headers: headers(token), payload,
      });
      expect(archived.statusCode, archived.body).toBe(200);
      expect(archived.json()).toMatchObject({ ok: true, value: { run: { runRef: engineRun, state: 'archived' } } });
      expect(audit.find((row) => row.action === 'control-run-archive-authorize')).toMatchObject({
        owner: 'operator', target: engineRun, riskTier: 'T3',
        detail: { runRef: engineRun, runOwnerSubject: 'dashboard-engine', openHumanRequestCount: 1, reason: payload.reason },
      });

      // Same archive semantics as an own-subject archive: the open ask is resolved in the same commit,
      // in the operator's name, and the run is gone from the default list but readable by ref.
      const owned = store.getRun('dashboard-engine', engineRun);
      if (!owned.ok) throw new Error(owned.detail);
      expect(owned.value.humanRequests).toEqual([expect.objectContaining({
        requestRef, state: 'resolved',
        response: expect.objectContaining({ respondedBy: 'operator', decision: 'responded', response: payload.reason }),
      })]);
      const list = await app.inject({ method: 'GET', url: '/api/control/runs', headers: headers(token) });
      expect((list.json() as { runs: unknown[] }).runs).toEqual([]);

      // A replay is still a replay and writes no second audit row.
      const replay = await app.inject({
        method: 'POST', url: `/api/control/runs/${engineRun}/archive`, headers: headers(token), payload,
      });
      expect(replay.json()).toMatchObject({ replayed: true });
      expect(audit.filter((row) => row.action === 'control-run-archive-authorize')).toHaveLength(1);
    } finally { await app.close(); }
  });

  it('refuses every one of those mutations to a NON-operator session on a foreign run', async () => {
    const cancelAutomatic = vi.fn();
    const controlBroker = {
      isRunning: () => true, drain: () => {}, queueInstruction: () => true, queueInstructionAtCheckpoint: () => true,
    };
    const { app, store, audit } = buildApp({ controlBroker, cancelAutomatic });
    try {
      const engineRun = seedRunFor(store, 'dashboard-engine', 'engine', 'daily-news');
      const { requestRef, version } = parkEngineRunWithGate(store, engineRun);
      seedRunFor(store, 'other-agent', 'other', 'other-workflow');
      // A real verified session — just not the operator's. The widening is the operator IDENTITY, never
      // the session, and there is no header, query param or body field that can select it.
      const otherToken = mintSession('other-agent', SESSION).token;
      const cas = { expectedRunVersion: version, expectedManagerGeneration: 1 };

      for (const [url, payload] of [
        [`/api/control/human-requests/${requestRef}/respond`,
          { expectedRevision: 1, decision: 'approved', idempotencyKey: 'k', response: null }],
        [`/api/control/runs/${engineRun}/manager/messages`, { ...cas, idempotencyKey: 'k', message: 'hi' }],
        [`/api/control/runs/${engineRun}/manager/steer`, { ...cas, idempotencyKey: 'k', checkpoint: 'c', instruction: 'i' }],
        [`/api/control/runs/${engineRun}/manager/stop`, { ...cas, idempotencyKey: 'k' }],
        [`/api/control/runs/${engineRun}/archive`, { idempotencyKey: 'k', reason: 'not mine' }],
      ] as Array<[string, Record<string, unknown>]>) {
        const response = await app.inject({ method: 'POST', url, headers: headers(otherToken), payload });
        expect(response.statusCode, `${url}: ${response.body}`).toBe(404);
        expect(response.json()).toMatchObject({ error: 'not-found' });
      }

      // Refused before any audit row, any executor call, and any change to the run.
      expect(audit).toEqual([]);
      expect(cancelAutomatic).not.toHaveBeenCalled();
      const owned = store.getRun('dashboard-engine', engineRun);
      if (!owned.ok) throw new Error(owned.detail);
      expect(owned.value.run.lifecycle.kind).toBe('waiting-human');
      expect(owned.value.humanRequests).toEqual([expect.objectContaining({ requestRef, state: 'open' })]);
    } finally { await app.close(); }
  });
});

describe('Dashboard v3 run and gate routes', () => {
  function seededSurface() {
    let id = 0;
    const store = createInMemoryControlPlaneStore({ newId: () => `dv3-${++id}` });
    const created = store.createProposalRevision('dashboard-engine', {
      sourceComposerRef: 'workflow-registry', sourceTurnId: 'daily-news', title: proposal.title,
      snapshot: proposal as unknown as JsonObject,
    });
    if (!created.ok) throw new Error(created.detail);
    const approved = store.decideProposal('dashboard-engine', created.value.proposalRef, 1, {
      expectedHash: created.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'dv3-approve',
    });
    if (!approved.ok) throw new Error(approved.detail);
    const run = store.createRun('dashboard-engine', {
      owner: { type: 'workflow', id: 'daily-news', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/daily-news.md' },
      executionHost: 'desktop', title: proposal.title, proposalRef: created.value.proposalRef,
      proposalRevision: 1, expectedProposalHash: created.value.hash,
      managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      idempotencyKey: 'dv3-launch',
      stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!run.ok) throw new Error(run.detail);
    for (const summary of ['first', 'second']) {
      const appended = store.appendEvent('dashboard-engine', run.value.run.runRef, {
        kind: 'message', source: 'worker', stageRef: run.value.stages[0]?.stageRef ?? null, summary,
      });
      if (!appended.ok) throw new Error(appended.detail);
    }
    const request = store.createHumanRequest('dashboard-engine', run.value.run.runRef, {
      kind: 'approval', title: 'Approve result', prompt: 'Approve the result.',
    });
    if (!request.ok) throw new Error(request.detail);
    const providerAttempt = store.createAttempt('dashboard-engine', run.value.stages[0].stageRef, {
      expectedStageVersion: run.value.stages[0].version, runtime: 'codex', model: 'gpt-5.6-sol',
    });
    if (!providerAttempt.ok) throw new Error(providerAttempt.detail);

    const ownProposal = store.createProposalRevision('other-agent', {
      sourceComposerRef: 'workflow-registry', sourceTurnId: 'own-workflow', title: 'Own run',
      snapshot: proposal as unknown as JsonObject,
    });
    if (!ownProposal.ok) throw new Error(ownProposal.detail);
    const ownApproval = store.decideProposal('other-agent', ownProposal.value.proposalRef, 1, {
      expectedHash: ownProposal.value.hash, expectedApprovalRevision: 0,
      decision: 'approved', idempotencyKey: 'own-approve',
    });
    if (!ownApproval.ok) throw new Error(ownApproval.detail);
    const ownRun = store.createRun('other-agent', {
      owner: { type: 'workflow', id: 'own-workflow', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/own-workflow.md' },
      executionHost: 'desktop', title: 'Own run', proposalRef: ownProposal.value.proposalRef,
      proposalRevision: 1, expectedProposalHash: ownProposal.value.hash,
      managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      idempotencyKey: 'own-launch',
      stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!ownRun.ok) throw new Error(ownRun.detail);

    const hubBus = createBus();
    const ioRoot = mkdtempSync(join(tmpdir(), 'dv3-run-events-'));
    const attemptIo = createAttemptIoStore({ root: ioRoot, flushMs: 0 });
    const app = Fastify();
    app.addHook('onClose', async () => {
      attemptIo.stop();
      rmSync(ioRoot, { recursive: true, force: true });
    });
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)), sessionConfig: SESSION,
      allowedOrigins: [ORIGIN], credentials: () => [], controlStore: store,
      hubBus,
      executionLatch: {
        snapshot: () => ({ state: 'unlocked', source: 'passkey', unlockedAt: 'now', unlockedBy: 'operator' }),
        current: () => ({ attemptIo }), unlock: vi.fn(), lock: vi.fn(),
      } as never,
      appendAudit: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      appendAuditLocal: (_root, event) => ({ ts: new Date().toISOString(), ...event }),
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
    }));
    return {
      app, store, hubBus, attemptIo, providerAttemptRef: providerAttempt.value.attemptRef,
      runRef: run.value.run.runRef, ownRunRef: ownRun.value.run.runRef, request: request.value,
      operatorToken: mintSession('operator', SESSION).token,
      unauthorizedToken: mintSession('other-agent', SESSION).token,
    };
  }

  it('serves one revision-stable closed replay page and returns 304 across pages', async () => {
    const fixture = seededSurface();
    try {
      const first = await fixture.app.inject({
        method: 'GET', url: `/api/control/runs/${fixture.runRef}/events?after=0&limit=1`,
        headers: headers(fixture.operatorToken),
      });
      expect(first.statusCode, first.body).toBe(200);
      const page = first.json() as { revision: string; items: Array<{ summary: string }>; nextCursor: number | null };
      expect(page.items.map((item) => item.summary)).toEqual(['first']);
      expect(page.nextCursor).not.toBeNull();
      expect(first.headers.etag).toBe(`"${page.revision}"`);

      const next = await fixture.app.inject({
        method: 'GET', url: `/api/control/runs/${fixture.runRef}/events?after=${page.nextCursor}&limit=1`,
        headers: { ...headers(fixture.operatorToken), 'if-none-match': first.headers.etag! },
      });
      expect(next.statusCode).toBe(304);
      expect(next.body).toBe('');
    } finally { await fixture.app.close(); }
  });

  it('authorizes every stream by scoped getRun before headers, including a non-operator own run', async () => {
    const fixture = seededSurface();
    try {
      const foreign = await fixture.app.inject({
        method: 'GET', url: `/api/control/runs/${fixture.runRef}/events/stream`,
        headers: headers(fixture.unauthorizedToken),
      });
      expect(foreign.statusCode).toBe(404);
      expect(foreign.body).toBe('');
      expect(String(foreign.headers['content-type'] ?? '')).not.toContain('text/event-stream');

      const missing = await fixture.app.inject({
        method: 'GET', url: '/api/control/runs/missing-run/events/stream',
        headers: headers(fixture.operatorToken),
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.body).toBe('');
      expect(String(missing.headers['content-type'] ?? '')).not.toContain('text/event-stream');

      const unauthenticated = await fixture.app.inject({
        method: 'GET', url: `/api/control/runs/${fixture.ownRunRef}/events/stream`,
        headers: { origin: ORIGIN, host: 'localhost:5317' },
      });
      expect(unauthenticated.statusCode).toBe(401);
      expect(String(unauthenticated.headers['content-type'] ?? '')).not.toContain('text/event-stream');
      expect(unauthenticated.body).not.toContain('event: run-event');

      await fixture.app.listen({ host: 'localhost', port: 5317 });
      const controller = new AbortController();
      const own = await fetch(`${ORIGIN}/api/control/runs/${fixture.ownRunRef}/events/stream`, {
        headers: headers(fixture.unauthorizedToken), signal: controller.signal,
      });
      expect(own.status).toBe(200);
      expect(own.headers.get('content-type')).toContain('text/event-stream');
      controller.abort();
    } finally { await fixture.app.close(); }
  });

  it.each(['-1', '1.5', '1e3', '9007199254740992', 'wat'])(
    'rejects unsafe SSE after/Last-Event-ID cursors before writing stream headers: %s',
    async (cursor) => {
      const fixture = seededSurface();
      try {
        for (const request of [
          { url: `/api/control/runs/${fixture.runRef}/events/stream?after=${cursor}`, headers: headers(fixture.operatorToken) },
          { url: `/api/control/runs/${fixture.runRef}/events/stream`, headers: { ...headers(fixture.operatorToken), 'last-event-id': cursor } },
        ]) {
          const response = await fixture.app.inject({ method: 'GET', ...request });
          expect(response.statusCode).toBe(400);
          expect(response.headers['content-type']).not.toContain('text/event-stream');
        }
      } finally { await fixture.app.close(); }
    },
  );

  it('replays from Last-Event-ID, delivers an append after connect, and releases the subscription on abort', async () => {
    const fixture = seededSurface();
    try {
      await fixture.app.listen({ host: 'localhost', port: 5317 });
      const controller = new AbortController();
      const response = await fetch(`${ORIGIN}/api/control/runs/${fixture.runRef}/events/stream?after=0`, {
        headers: { ...headers(fixture.operatorToken), 'last-event-id': '1000' }, signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const replay = await readSseUntil(reader, (text) => text.includes('"summary":"second"'));
      expect(replay).not.toContain('id: 1000\n');
      expect(replay).toContain('id: 2000\n');
      await vi.waitFor(() => expect(fixture.hubBus.subscriberCount()).toBe(1));

      const appended = fixture.store.appendEvent('dashboard-engine', fixture.runRef, {
        kind: 'message', source: 'worker', stageRef: null, summary: 'arrived after connect',
      });
      if (!appended.ok) throw new Error(appended.detail);
      fixture.hubBus.publish({ channel: 'control', kind: 'store-change' });
      const live = await readSseUntil(reader, (text) => text.includes('arrived after connect'));
      expect(live).toContain('event: run-event');

      controller.abort();
      await vi.waitFor(() => expect(fixture.hubBus.subscriberCount()).toBe(0));
    } finally { await fixture.app.close(); }
  });

  it('projects real Codex golden output through the shared REST route service', async () => {
    const fixture = seededSurface();
    try {
      const transcript = readFileSync(fileURLToPath(new URL('./__fixtures__/dv3/transcripts/codex-real-sanitized.jsonl', import.meta.url)), 'utf8');
      for (const line of transcript.trim().split(/\r?\n/)) fixture.attemptIo.append(fixture.providerAttemptRef, 'out', line);
      const response = await fixture.app.inject({
        method: 'GET', url: `/api/control/runs/${fixture.runRef}/events?after=0&limit=250`,
        headers: headers(fixture.operatorToken),
      });
      expect(response.statusCode, response.body).toBe(200);
      const items = (response.json() as { items: Array<{ kind: string; toolName: string | null; summary: string | null }> }).items;
      expect(items).toContainEqual(expect.objectContaining({ kind: 'message', summary: expect.stringContaining('REWRITE') }));
      expect(items).toContainEqual(expect.objectContaining({ kind: 'lifecycle', summary: 'succeeded' }));
    } finally { await fixture.app.close(); }
  });

  it('projects distinct-run attention with a revision ETag', async () => {
    const fixture = seededSurface();
    try {
      const extra = fixture.store.createHumanRequest('dashboard-engine', fixture.runRef, {
        kind: 'input', title: 'Second request', prompt: 'One more answer.',
      });
      if (!extra.ok) throw new Error(extra.detail);
      const response = await fixture.app.inject({ method: 'GET', url: '/api/attention', headers: headers(fixture.operatorToken) });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        pairs: [{ runRef: fixture.runRef }], workflows: { 'workflow:kb-ops:daily-news': 1 },
      });
      const cached = await fixture.app.inject({
        method: 'GET', url: '/api/attention', headers: { ...headers(fixture.operatorToken), 'if-none-match': response.headers.etag! },
      });
      expect(cached.statusCode).toBe(304);
    } finally { await fixture.app.close(); }
  });

  it('registers challenge-bound T3 response and fails closed when the ceremony is unavailable', async () => {
    const fixture = seededSurface();
    try {
      const challenge = await fixture.app.inject({
        method: 'POST', url: `/api/control/human-requests/${fixture.request.requestRef}/respond/challenge`,
        headers: headers(fixture.operatorToken), payload: {
          expectedRevision: fixture.request.revision, decision: 'approved', response: null,
        },
      });
      expect(challenge.statusCode).toBe(403);
      expect(challenge.json()).toEqual({ error: 'ceremony-unavailable' });

      const response = await fixture.app.inject({
        method: 'POST', url: `/api/control/human-requests/${fixture.request.requestRef}/respond`,
        headers: headers(fixture.operatorToken), payload: {
          expectedRevision: fixture.request.revision, decision: 'approved', idempotencyKey: 'approve-result', response: null,
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'ceremony-unavailable' });
      expect(fixture.store.getHumanRequest('dashboard-engine', fixture.request.requestRef)).toMatchObject({
        ok: true, value: { state: 'open', response: null },
      });
    } finally { await fixture.app.close(); }
  });
});

/**
 * Operator cross-subject authority, round 3 — the four remaining dead ends a route-surface audit found
 * after the mutation widening landed (2026-08-12).
 *
 * Same ruling, same idiom as the block above: the target is resolved from the VERIFIED SESSION's read
 * scope, the work then executes AS THE TARGET'S OWNER, ownership never moves, and the audit row names
 * the operator as the actor beside `runOwnerSubject`. What these four add is that they are the surfaces
 * where the SPA offers a button and the server answered `not-found`:
 *
 *   - launch/retry     RunDetail's "Run it again" and the pre-publication resume, both 404 on an
 *                      engine-owned revision before anything was written;
 *   - reroute          the per-stage runtime/model controls;
 *   - retention        "Stored data" -> "Review archiving";
 *   - the single       run detail's steering CHECKPOINT pick-list, which failed SILENTLY and degraded
 *     revision GET     to a free-text box.
 */
describe('operator cross-subject authority — launch, reroute, retention, revision read', () => {
  const ENGINE = 'dashboard-engine';

  function surface(
    store: ControlPlaneStore,
    /** An audit sink that REJECTS — the durable-row precondition every mutation here is gated on. */
    appendAudit?: (repoRoot: string, event: Record<string, unknown>) => unknown,
    /** A git seam that RACES — the concurrent-ops-writer shape the launch push must survive. */
    opsGitOverride?: (repoRoot: string, args: string[]) => string,
  ) {
    const audit: Array<Record<string, unknown>> = [];
    const routingWrites: Array<Record<string, unknown>> = [];
    const capture = (_repoRoot: string, event: Record<string, unknown>) => {
      audit.push(event);
      return { ts: '2026-08-12T00:00:00.000Z', ...event };
    };
    let composerId = 0;
    const app = Fastify();
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)),
      sessionConfig: SESSION, allowedOrigins: [ORIGIN], credentials: () => [], controlStore: store,
      composerStore: createInMemoryComposerStore({
        protector: { seal: (value: string) => value, open: (value: string) => value },
        newId: () => `composer-${++composerId}`,
      }),
      appendAudit: appendAudit ?? capture, appendAuditLocal: capture,
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
      opsGit: opsGitOverride ?? ((_repoRoot: string, args: string[]) => {
        if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
        if (args.join(' ') === 'rev-parse HEAD') return `${'a'.repeat(40)}\n`;
        return '';
      }),
      // One runner for both shapes this suite drives: a card-routing operation (reroute) carries
      // `cardId`; a workflow publication carries `runId` + `stages`.
      runPy: (_repoRoot: string, _code: string, jsonArg: string) => {
        const payload = JSON.parse(jsonArg) as {
          cardId?: string; runId?: string; managed?: boolean; stages?: Array<{ id: string; dependsOn: string[] }>;
        };
        if (typeof payload.cardId === 'string') {
          routingWrites.push(payload as Record<string, unknown>);
          return {
            exitCode: 0, stderr: '',
            stdout: `${JSON.stringify({ id: payload.cardId, path: `queue/inbox/${payload.cardId}.md`, state: 'inbox' })}\n`,
          };
        }
        return {
          exitCode: 0, stderr: '', stdout: JSON.stringify({
            runId: payload.runId,
            cards: (payload.stages ?? []).map((stage) => {
              const cardId = workflowCardId(String(payload.runId), stage.id);
              const state = payload.managed || stage.dependsOn.length ? 'blocked' : 'inbox';
              return { stageId: stage.id, cardId, state, cardPath: `queue/${state === 'blocked' ? 'inbox' : state}/${cardId}.md` };
            }),
          }),
        };
      },
    } as never));
    return { app, audit, routingWrites, token: mintSession('operator', SESSION).token };
  }

  /** One APPROVED revision owned by `owner` — the shape the queue bridge imports from a card. */
  function approvedRevisionFor(
    store: ControlPlaneStore,
    owner: string,
    key: string,
    snapshot: PlanProposal = proposal,
  ): { proposalRef: string; hash: string } {
    const created = store.createProposalRevision(owner, {
      sourceComposerRef: 'workflow-registry', sourceTurnId: 'self-lint-report', title: snapshot.title,
      snapshot: snapshot as unknown as JsonObject,
    });
    if (!created.ok) throw new Error(created.detail);
    const approved = store.decideProposal(owner, created.value.proposalRef, 1, {
      expectedHash: created.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: `${key}-approve`,
    });
    if (!approved.ok) throw new Error(approved.detail);
    return { proposalRef: created.value.proposalRef, hash: created.value.hash };
  }

  /** The run the queue bridge itself creates from that revision, under its own launch operation key. */
  function bridgeRunFor(
    store: ControlPlaneStore,
    revision: { proposalRef: string; hash: string },
    idempotencyKey: string,
    executionHost: Run['executionHost'] = 'desktop',
  ) {
    const run = store.createRun(ENGINE, {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost,
      title: proposal.title, proposalRef: revision.proposalRef, proposalRevision: 1,
      expectedProposalHash: revision.hash, managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
      idempotencyKey,
      stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
    });
    if (!run.ok) throw new Error(run.detail);
    return run.value;
  }

  // ── GAP-3: launch / retry ────────────────────────────────────────────────────────────────────────

  it('launches an engine-owned revision AS the engine, with the operator audited as the actor', async () => {
    const opened = createLeasedFileStoreForTest({ newId: (() => { let n = 0; return () => `x-${++n}`; })() });
    const store = opened.store;
    const revision = approvedRevisionFor(store, ENGINE, 'engine-launch');
    const { app, audit, token } = surface(store);
    try {
      const launched = await app.inject({
        method: 'POST', url: `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`, headers: headers(token),
        payload: { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` },
      });
      // The P0 symptom was a 404 here, from the very first revision lookup.
      expect(launched.statusCode, launched.body).toBe(202);
      const runRef = launched.json().runRef as string;

      // OWNERSHIP NEVER MOVES: the run, its stages and their canonical cards are all the engine's, and
      // the operator's own partition stays empty.
      const owned = store.getRun(ENGINE, runRef);
      if (!owned.ok) throw new Error(owned.detail);
      expect(owned.value.ownerSubject).toBe(ENGINE);
      expect(owned.value.run.publicationState).toBe('published');
      expect(owned.value.stages.map((stage) => stage.canonicalCardRef))
        .toEqual(proposal.stages.map((stage) => workflowCardId(runRef, stage.id)));
      expect(store.listRuns('operator')).toEqual([]);
      expect(store.getRun('operator', runRef)).toMatchObject({ ok: false, reason: 'not-found' });
      const firstPersisted = JSON.parse(readFileSync(opened.path, 'utf8')) as { runs: Run[] };
      expect(firstPersisted.runs.find((run) => run.runRef === runRef)).toMatchObject({
        owner: { type: 'workflow', id: 'self-lint-report', project: 'kb-ops',
          sourcePath: 'orgs/kb-ops/workflows/self-lint-report.md' },
        executionHost: process.platform === 'win32' ? 'desktop' : 'vm',
      });

      // ATTRIBUTION: `owner` is the operator (the actor), `runOwnerSubject` is whose run it is.
      expect(audit.find((row) => row.action === 'control-run-launch')).toMatchObject({
        owner: 'operator', result: `launched:${runRef}:${revision.hash}`,
        detail: expect.objectContaining({ runOwnerSubject: ENGINE, proposalHash: revision.hash }),
      });
    } finally { await app.close(); opened.close(); }
  });

  it('copies the Retry predecessor owner and host instead of the caller daemon identity', async () => {
    const opened = createLeasedFileStoreForTest({ newId: (() => { let n = 0; return () => `y-${++n}`; })() });
    const store = opened.store;
    const revision = approvedRevisionFor(store, ENGINE, 'engine-retry');
    const predecessorHost = process.platform === 'win32' ? 'vm' : 'desktop';
    const predecessor = bridgeRunFor(store, revision, 'queue-bridge:card-retry', predecessorHost);
    const interrupted = store.transitionRun(ENGINE, predecessor.run.runRef, predecessor.run.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    const { app, token } = surface(store);
    try {
      const retried = await app.inject({
        method: 'POST', url: `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`, headers: headers(token),
        payload: {
          expectedHash: revision.hash, idempotencyKey: `retry:${predecessor.run.runRef}:${interrupted.value.version}`,
          predecessorRunRef: predecessor.run.runRef, expectedPredecessorVersion: interrupted.value.version,
        },
      });
      // The mechanism under test is WHICH SUBJECT the predecessor is read as. Read as the caller it was
      // `not-found`; read as the owner it is found, its version matches, and the launch proceeds to the
      // canonical quiescence check — which this in-memory surface has no committed cards to satisfy.
      expect(retried.statusCode, retried.body).toBe(409);
      expect(retried.json()).not.toMatchObject({ error: 'runnable-owner-conflict' });
      expect(retried.json()).toMatchObject({ error: 'retry-predecessor-not-quiescent' });
      const firstPersisted = JSON.parse(readFileSync(opened.path, 'utf8')) as { runs: Run[] };
      expect(firstPersisted.runs.find((run) => run.runRef === predecessor.run.runRef)).toMatchObject({
        owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, executionHost: predecessorHost,
      });
    } finally { await app.close(); opened.close(); }
  });

  /**
   * BRIDGE IDEMPOTENCY SAFETY, both directions.
   *
   * `createRun` keys replay on `(subject, launchOperationKey)`. A cross-subject launch writes into the
   * OWNER's key space, so a client-supplied key could name an operation the operator never performed —
   * and the bridge's keys are derived from card ids, which a browser can read off the run. The operator's
   * key is therefore namespaced inside `executeApprovedLaunch`.
   */
  it('namespaces the operator launch key so it can neither replay nor poison the bridge record', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `z-${++n}`; })() });
    const revision = approvedRevisionFor(store, ENGINE, 'engine-idem');
    const bridgeKey = 'queue-bridge:card-collide';
    const bridgeRun = bridgeRunFor(store, revision, bridgeKey);
    // SETTLED first: a LIVE run for this revision is refused outright now (see the one-run-per-revision
    // test below), so the namespace property is exercised where a second launch is legitimate.
    const settled = store.transitionRun(ENGINE, bridgeRun.run.runRef, bridgeRun.run.version, 'stopped');
    if (!settled.ok) throw new Error(settled.detail);
    const { app, token } = surface(store);
    try {
      // DIRECTION 1 — operator -> bridge. The operator presents the BRIDGE's exact key. Without the
      // namespace this replays the bridge's own run (same fingerprint) and answers for a launch the
      // operator never made; with it, the operator gets a launch of its own and the bridge's record is
      // not consulted at all.
      const collided = await app.inject({
        method: 'POST', url: `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`, headers: headers(token),
        payload: { expectedHash: revision.hash, idempotencyKey: bridgeKey },
      });
      expect(collided.statusCode, collided.body).toBe(202);
      const operatorRunRef = collided.json().runRef as string;
      expect(operatorRunRef).not.toBe(bridgeRun.run.runRef);

      // The bridge's run is untouched — same version as the settle left it, still unpublished.
      const untouched = store.getRun(ENGINE, bridgeRun.run.runRef);
      if (!untouched.ok) throw new Error(untouched.detail);
      expect(untouched.value.run).toMatchObject({
        version: settled.value.version, publicationState: 'pending', lifecycle: { kind: 'stopped', deployPause: null },
      });

      // DIRECTION 2 — bridge -> operator. The bridge re-ticks the SAME card and still replays ITS OWN
      // run, because nothing the operator wrote can occupy `queue-bridge:<cardId>`.
      const replay = store.createRun(ENGINE, {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
        title: proposal.title, proposalRef: revision.proposalRef, proposalRevision: 1,
        expectedProposalHash: revision.hash, managerRuntime: proposal.manager.runtime, managerModel: proposal.manager.model,
        idempotencyKey: bridgeKey,
        stages: proposal.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
      });
      expect(replay).toMatchObject({ ok: true, replayed: true });
      expect(replay.ok && replay.value.run.runRef).toBe(bridgeRun.run.runRef);

      // And the operator's own key stays idempotent among the operator's own launches.
      const again = await app.inject({
        method: 'POST', url: `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`, headers: headers(token),
        payload: { expectedHash: revision.hash, idempotencyKey: bridgeKey },
      });
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ runRef: operatorRunRef, replayed: true });
    } finally { await app.close(); }
  });

  /**
   * ONE RUN PER REVISION, ACROSS SUBJECTS.
   *
   * The namespace above means an operator key can never equal the owner's, so `createRun` cannot replay
   * the owner's in-flight run: the SPA's pre-publication resume (RunDetail -> `launch:<proposalHash>`)
   * used to mint a SECOND engine-owned run for the same revision and strand the bridge's original.
   */
  it('refuses a cross-subject launch while a live run already exists for that revision', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `u-${++n}`; })() });
    const revision = approvedRevisionFor(store, ENGINE, 'engine-duplicate');
    const bridgeRun = bridgeRunFor(store, revision, 'queue-bridge:card-live');
    // Parked pre-publication — the exact state the SPA offers its resume button on.
    const parked = store.transitionRun(ENGINE, bridgeRun.run.runRef, bridgeRun.run.version, 'waiting-human');
    if (!parked.ok) throw new Error(parked.detail);
    const { app, audit, token } = surface(store);
    const resume = { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` };
    const url = `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`;
    try {
      const refused = await app.inject({ method: 'POST', url, headers: headers(token), payload: resume });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({
        error: 'run-already-exists-for-revision', runRef: bridgeRun.run.runRef, runOwnerSubject: ENGINE,
      });

      // ZERO SIDE EFFECTS: no second run anywhere, the live run untouched, nothing audited.
      expect(store.listRuns(ENGINE).map((run) => run.runRef)).toEqual([bridgeRun.run.runRef]);
      expect(store.listRuns('operator')).toEqual([]);
      const untouched = store.getRun(ENGINE, bridgeRun.run.runRef);
      if (!untouched.ok) throw new Error(untouched.detail);
      expect(untouched.value.run).toMatchObject({
        version: parked.value.version, publicationState: 'pending', lifecycle: { kind: 'waiting-human', deployPause: null },
      });
      expect(untouched.value.humanRequests).toEqual([]);
      expect(audit).toEqual([]);

      // RETRY IS EXEMPT: it carries a predecessor and is gated by the quiescence check instead.
      const retried = await app.inject({
        method: 'POST', url, headers: headers(token),
        payload: {
          expectedHash: revision.hash, idempotencyKey: `retry:${bridgeRun.run.runRef}`,
          predecessorRunRef: bridgeRun.run.runRef, expectedPredecessorVersion: parked.value.version,
        },
      });
      expect(retried.json().error).not.toBe('run-already-exists-for-revision');

      // A TERMINAL prior run does not block a fresh launch of the same revision.
      const settled = store.transitionRun(ENGINE, bridgeRun.run.runRef, parked.value.version, 'stopped');
      if (!settled.ok) throw new Error(settled.detail);
      const launched = await app.inject({ method: 'POST', url, headers: headers(token), payload: resume });
      expect(launched.statusCode, launched.body).toBe(202);
      expect(launched.json().runRef).not.toBe(bridgeRun.run.runRef);
      // ...and that new run is itself live now, so the same request stops duplicating it — it replays
      // its OWN launch record instead (the operator's namespaced key), never a fresh run.
      const replayed = await app.inject({ method: 'POST', url, headers: headers(token), payload: resume });
      expect(replayed.statusCode, replayed.body).toBe(200);
      expect(replayed.json()).toMatchObject({ runRef: launched.json().runRef, replayed: true });
    } finally { await app.close(); }
  });

  /**
   * REGRESSION, live defect (both real queue-bridge launches, 2026-08-11 and -12).
   *
   * `ops` has many concurrent writers. One of them pushing inside a launch's compile window rejected the
   * launch's coordination push non-fast-forward, and the route answered 500 `launch-reconciliation-required`
   * and parked the run on a human intervention — for a lost race the repository constitution says to
   * reconcile and retry. The launch now re-reads state and re-pushes, bounded, and only parks on a failure
   * that a human really does own.
   */
  it('survives a concurrent ops writer: a non-fast-forward launch push reconciles and retries, never parking', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `w-${++n}`; })() });
    const revision = approvedRevisionFor(store, 'operator', 'raced-launch');
    const gitCalls: string[][] = [];
    let pushes = 0;
    const { app, token } = surface(store, undefined, (_repoRoot: string, args: string[]) => {
      gitCalls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args.join(' ') === 'rev-parse HEAD') return `${'a'.repeat(40)}\n`;
      if (args[0] === 'push' && pushes++ === 0) {
        const stderr = ' ! [rejected]        ops -> ops (non-fast-forward)\n'
          + 'hint: Updates were rejected because the tip of your current branch is behind';
        throw Object.assign(new Error(`git push exited with code 1: ${stderr}`), { status: 1, stdout: '', stderr });
      }
      return '';
    });
    try {
      const launched = await app.inject({
        method: 'POST', url: `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`, headers: headers(token),
        payload: { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` },
      });

      // Published, not parked: no `launch-reconciliation-required`, no intervention, no failed run.
      expect(launched.statusCode, launched.body).toBe(202);
      const runRef = launched.json().runRef as string;
      const detail = store.getRun('operator', runRef);
      if (!detail.ok) throw new Error(detail.detail);
      expect(detail.value.run.publicationState).toBe('published');
      expect(detail.value.humanRequests.map((request) => request.title))
        .not.toContain('Launch reconciliation required');

      // Exactly one reconciling pull between the rejected push and the accepted one.
      const verbs = gitCalls.map((args) => args.join(' '));
      const first = verbs.indexOf('push origin ops');
      expect(verbs.slice(first)).toEqual([
        'push origin ops', 'rev-parse --abbrev-ref HEAD', 'pull --rebase origin ops', 'push origin ops',
      ]);
    } finally { await app.close(); }
  });

  it('refuses to namespace a launch key for any actor but the one operator subject', async () => {
    // `operator:<actor>:<key>` is injectively parseable ONLY while the actor is the single literal
    // operator subject: actor 'a' + key 'b:c' and actor 'a:b' + key 'c' produce the same string, so two
    // different operations would share one launch identity. No route reaches this today (`readScope`
    // widens for `operator` alone) — the guard is what keeps the invariant true if one ever does, and it
    // refuses before touching the store, the ops tree, or the run.
    const outcome = await executeApprovedLaunch({} as never, ENGINE, {
      proposalRef: 'proposal-collide', revision: 1, storedHash: 'a'.repeat(64), snapshot: {},
      sessionToken: undefined, actorSubject: 'a:b', idempotencyKey: 'c',
      predecessorRunRef: null, expectedPredecessorVersion: -1,
      identity: { owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, executionHost: 'desktop' },
    });
    expect(outcome).toMatchObject({ status: 403, body: { error: 'cross-subject-launch-actor-refused' } });
  });

  it('keeps an own-subject launch key un-namespaced, byte for byte', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `w-${++n}`; })() });
    const revision = approvedRevisionFor(store, 'operator', 'own-launch');
    const { app, audit, token } = surface(store);
    try {
      const launched = await app.inject({
        method: 'POST', url: `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`, headers: headers(token),
        payload: { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` },
      });
      expect(launched.statusCode, launched.body).toBe(202);
      const runRef = launched.json().runRef as string;
      // The un-namespaced client key still identifies this launch: an SPA re-entry with the SAME key
      // replays the same run (the pre-publication resume depends on exactly this).
      const resumed = await app.inject({
        method: 'POST', url: `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`, headers: headers(token),
        payload: { expectedHash: revision.hash, idempotencyKey: `launch:${revision.hash}` },
      });
      expect(resumed.json()).toMatchObject({ runRef, replayed: true });
      // Actor and owner are the same subject here, and the row says so rather than going quiet.
      expect(audit.find((row) => row.action === 'control-run-launch')).toMatchObject({
        owner: 'operator', detail: expect.objectContaining({ runOwnerSubject: 'operator' }),
      });
    } finally { await app.close(); }
  });

  it('refuses a third subject the launch of a foreign revision, with zero side effects', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `v-${++n}`; })() });
    const revision = approvedRevisionFor(store, ENGINE, 'engine-foreign');
    const { app, audit } = surface(store);
    const otherToken = mintSession('other-agent', SESSION).token;
    try {
      const refused = await app.inject({
        method: 'POST', url: `/api/control/proposals/${revision.proposalRef}/revisions/1/launch`, headers: headers(otherToken),
        payload: { expectedHash: revision.hash, idempotencyKey: 'foreign-launch' },
      });
      expect(refused.statusCode, refused.body).toBe(404);
      expect(refused.json()).toMatchObject({ error: 'not-found' });
      expect(audit).toEqual([]);
      expect(store.listRuns(ENGINE)).toEqual([]);
      expect(store.listRuns('other-agent')).toEqual([]);
    } finally { await app.close(); }
  });

  // ── GAP-4: per-stage reroute ─────────────────────────────────────────────────────────────────────

  /** A published engine-owned run whose first stage is a legal reroute source (ready / queued / pending). */
  function reroutableEngineRun(store: ReturnType<typeof createInMemoryControlPlaneStore>) {
    const revision = approvedRevisionFor(store, ENGINE, 'engine-reroute');
    const created = bridgeRunFor(store, revision, 'queue-bridge:card-reroute');
    const runRef = created.run.runRef;
    const stage = created.stages[0];
    const cardRef = workflowCardId(runRef, stage.stageId);
    const linked = store.linkStageCard(ENGINE, stage.stageRef, stage.version, cardRef);
    if (!linked.ok) throw new Error(linked.detail);
    const publishing = store.transitionPublication(ENGINE, runRef, created.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = store.transitionPublication(ENGINE, runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const attempt = store.createAttempt(ENGINE, stage.stageRef, {
      expectedStageVersion: linked.value.version, runtime: 'codex', model: 'gpt-5.6-sol',
    });
    if (!attempt.ok) throw new Error(attempt.detail);
    const session = store.createWorkerSession(ENGINE, attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
    if (!session.ok) throw new Error(session.detail);
    const current = store.getRun(ENGINE, runRef);
    if (!current.ok) throw new Error(current.detail);
    // Re-read both: linking the attempt bumps the stage and `createWorkerSession` bumps the attempt.
    const live = current.value.stages.find((item) => item.stageRef === stage.stageRef);
    const liveAttempt = current.value.attempts.find((item) => item.attemptRef === attempt.value.attemptRef);
    if (!live || !liveAttempt) throw new Error('reroute source missing');
    return {
      runRef, cardRef, stageRef: stage.stageRef,
      payload: {
        expectedStageVersion: live.version, expectedAttemptRef: liveAttempt.attemptRef,
        expectedAttemptVersion: liveAttempt.version, runtime: 'claude', model: 'claude-sonnet-5',
        idempotencyKey: `reroute:${runRef}:1`,
      },
    };
  }

  it('reroutes a stage on an engine-owned run: successor attempt under the engine, operator audited', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `r-${++n}`; })() });
    const target = reroutableEngineRun(store);
    const { app, audit, routingWrites, token } = surface(store);
    try {
      const response = await app.inject({
        method: 'POST', url: `/api/control/runs/${target.runRef}/stages/${target.stageRef}/reroute`,
        headers: headers(token), payload: target.payload,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        value: {
          attempt: { generation: 2, runtime: 'claude', model: 'claude-sonnet-5', state: 'queued' },
          session: { state: 'pending' },
        },
      });
      expect(routingWrites).toEqual([expect.objectContaining({ cardId: target.cardRef, runtime: 'claude', model: 'claude-sonnet-5' })]);

      // The successor attempt, its session and the timeline event all landed under the RUN's OWNER.
      const owned = store.getRun(ENGINE, target.runRef);
      if (!owned.ok) throw new Error(owned.detail);
      expect(owned.value.attempts.map((attempt) => [attempt.generation, attempt.runtime, attempt.model]))
        .toEqual([[1, 'codex', 'gpt-5.6-sol'], [2, 'claude', 'claude-sonnet-5']]);
      expect(store.listRuns('operator')).toEqual([]);
      const events = store.listEvents(ENGINE, target.runRef);
      if (!events.ok) throw new Error(events.detail);
      expect(events.value.map((event) => event.summary))
        .toContain('queued successor attempt 2 with claude/claude-sonnet-5');

      // The canonical routing audit names the ACTOR — the verified operator session, not the run owner.
      expect(audit.find((row) => row.action === 'card-routing')).toMatchObject({ owner: 'operator' });
      // ...and it names a CARD, so run-owner attribution is this surface's own row, written before the
      // canonical write like every other cross-subject mutation here.
      expect(audit.find((row) => row.action === 'control-run-reroute-authorize')).toMatchObject({
        owner: 'operator', riskTier: 'T2', result: 'authorized:claude:claude-sonnet-5',
        detail: expect.objectContaining({
          runRef: target.runRef, runOwnerSubject: ENGINE, stageRef: target.stageRef, cardId: target.cardRef,
        }),
      });
      expect(audit.findIndex((row) => row.action === 'control-run-reroute-authorize'))
        .toBeLessThan(audit.findIndex((row) => row.action === 'card-routing'));
    } finally { await app.close(); }
  });

  it('refuses a third subject the reroute of a foreign stage, with zero side effects', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `q-${++n}`; })() });
    const target = reroutableEngineRun(store);
    const { app, audit, routingWrites } = surface(store);
    const otherToken = mintSession('other-agent', SESSION).token;
    try {
      const refused = await app.inject({
        method: 'POST', url: `/api/control/runs/${target.runRef}/stages/${target.stageRef}/reroute`,
        headers: headers(otherToken), payload: target.payload,
      });
      expect(refused.statusCode, refused.body).toBe(404);
      expect(refused.json()).toMatchObject({ error: 'not-found' });
      expect(routingWrites).toEqual([]);
      expect(audit).toEqual([]);
      const owned = store.getRun(ENGINE, target.runRef);
      if (!owned.ok) throw new Error(owned.detail);
      expect(owned.value.attempts).toHaveLength(1);
    } finally { await app.close(); }
  });

  // ── GAP-5: retention ─────────────────────────────────────────────────────────────────────────────

  /** An engine-owned run settled into the one shape quarantine accepts. */
  function quarantinableEngineRun(store: ReturnType<typeof createInMemoryControlPlaneStore>): string {
    const revision = approvedRevisionFor(store, ENGINE, 'engine-retention');
    const created = bridgeRunFor(store, revision, 'queue-bridge:card-retention');
    const runRef = created.run.runRef;
    const interrupted = store.transitionRun(ENGINE, runRef, created.run.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    for (const stage of created.stages) {
      const stopped = store.transitionStage(ENGINE, stage.stageRef, stage.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    for (const session of created.sessions) {
      const stopped = store.transitionSession(ENGINE, session.sessionRef, session.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    return runRef;
  }

  it('plans, quarantines and restores an engine-owned bundle without ever relabelling it', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `s-${++n}`; })() });
    const runRef = quarantinableEngineRun(store);
    const { app, audit, token } = surface(store);
    try {
      const planned = await app.inject({
        method: 'POST', url: '/api/control/retention/dry-run', headers: headers(token), payload: { runRefs: [runRef] },
      });
      expect(planned.statusCode, planned.body).toBe(200);
      const plan = planned.json().value as { planHash: string; items: Array<{ runRef: string; eligible: boolean; ownerSubject: string }> };
      // The plan describes the OWNER's records — read as the caller the bundle would come back empty,
      // reporting a foreign run as costless and trivially eligible.
      expect(plan.items).toEqual([expect.objectContaining({ runRef, eligible: true, ownerSubject: ENGINE })]);

      const quarantined = await app.inject({
        method: 'POST', url: '/api/control/retention/quarantine', headers: headers(token),
        payload: { runRefs: [runRef], expectedPlanHash: plan.planHash },
      });
      expect(quarantined.statusCode, quarantined.body).toBe(200);
      expect(audit.find((row) => row.action === 'control-retention-quarantine-authorize')).toMatchObject({
        owner: 'operator', riskTier: 'T2',
        detail: expect.objectContaining({ runRefs: [runRef], runOwnerSubjects: [ENGINE] }),
      });

      // The bundle is filed under the ENGINE, never adopted into the operator's storage.
      expect(store.inventory(ENGINE).quarantinedRuns).toEqual([expect.objectContaining({ runRef, ownerSubject: ENGINE })]);
      expect(store.inventory('operator')).toMatchObject({ activeRuns: [], quarantinedRuns: [] });
      expect(store.getRun(ENGINE, runRef)).toMatchObject({ ok: false, reason: 'not-found' });

      const restored = await app.inject({
        method: 'POST', url: '/api/control/retention/restore', headers: headers(token), payload: { runRef },
      });
      expect(restored.statusCode, restored.body).toBe(200);
      const restoredMetadata = store.listRuns(ENGINE).find((run) => run.runRef === runRef);
      if (!restoredMetadata) throw new Error('restored run metadata missing');
      expect(restored.json()).toEqual({ ok: true, value: expect.any(Object), replayed: false });
      expectExactWireRun(
        restored.json().value,
        restoredMetadata as unknown as Record<string, unknown> & { lifecycle: { kind: string } },
      );
      expect(audit.find((row) => row.action === 'control-retention-restore-authorize')).toMatchObject({
        owner: 'operator', detail: { runRef, runOwnerSubject: ENGINE },
      });

      // Restored to its OWN subject, with its record tree and a recovery event on its own timeline.
      const back = store.getRun(ENGINE, runRef);
      if (!back.ok) throw new Error(back.detail);
      expect(back.value.ownerSubject).toBe(ENGINE);
      expect(back.value.stages).toHaveLength(proposal.stages.length);
      expect(store.listRuns('operator')).toEqual([]);
      const events = store.listEvents(ENGINE, runRef);
      if (!events.ok) throw new Error(events.detail);
      expect(events.value.map((event) => event.summary)).toContain('run restored from quarantine');
    } finally { await app.close(); }
  });

  /**
   * The retention rows are a PRECONDITION, not a trailer: the row must be durable before the bundle
   * moves. Left unawaited, the rejection escaped as an unhandled rejection and the destructive op ran
   * anyway, so the only record of who moved whose data was the one that failed to write.
   */
  it('moves no bundle when the retention audit row cannot be written', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `n-${++n}`; })() });
    const runRef = quarantinableEngineRun(store);
    const rejecting = async () => { throw new Error('ops audit push refused'); };
    const planning = surface(store);
    const planned = await planning.app.inject({
      method: 'POST', url: '/api/control/retention/dry-run', headers: headers(planning.token), payload: { runRefs: [runRef] },
    });
    const planHash = (planned.json().value as { planHash: string }).planHash;
    await planning.app.close();

    const { app, token } = surface(store, rejecting as never);
    try {
      const quarantined = await app.inject({
        method: 'POST', url: '/api/control/retention/quarantine', headers: headers(token),
        payload: { runRefs: [runRef], expectedPlanHash: planHash },
      });
      expect(quarantined.statusCode, quarantined.body).toBe(500);
      expect(quarantined.json()).toMatchObject({ error: 'quarantine-audit-required' });
      // The run is still live under its owner and nothing is in quarantine.
      expect(store.getRun(ENGINE, runRef)).toMatchObject({ ok: true });
      expect(store.inventory(ENGINE).quarantinedRuns).toEqual([]);

      // Same rule on the way back: quarantine it with a working sink, then fail the restore row.
      const working = surface(store);
      const ok = await working.app.inject({
        method: 'POST', url: '/api/control/retention/quarantine', headers: headers(working.token),
        payload: { runRefs: [runRef], expectedPlanHash: planHash },
      });
      expect(ok.statusCode, ok.body).toBe(200);
      await working.app.close();

      const restored = await app.inject({
        method: 'POST', url: '/api/control/retention/restore', headers: headers(token), payload: { runRef },
      });
      expect(restored.statusCode, restored.body).toBe(500);
      expect(restored.json()).toMatchObject({ error: 'restore-audit-required' });
      expect(store.inventory(ENGINE).quarantinedRuns).toEqual([expect.objectContaining({ runRef })]);
      expect(store.getRun(ENGINE, runRef)).toMatchObject({ ok: false, reason: 'not-found' });
    } finally { await app.close(); }
  });

  it('shows an engine-owned bundle in the operator inventory and hides it from a third subject', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `t-${++n}`; })() });
    const runRef = quarantinableEngineRun(store);
    const { app, token } = surface(store);
    const otherToken = mintSession('other-agent', SESSION).token;
    try {
      const mine = await app.inject({ method: 'GET', url: '/api/control/retention/inventory', headers: headers(token) });
      expect((mine.json() as { inventory: { activeRuns: Array<{ runRef: string; ownerSubject: string }> } }).inventory.activeRuns)
        .toEqual([expect.objectContaining({ runRef, ownerSubject: ENGINE })]);

      const theirs = await app.inject({ method: 'GET', url: '/api/control/retention/inventory', headers: headers(otherToken) });
      expect((theirs.json() as { inventory: Record<string, unknown> }).inventory)
        .toMatchObject({ activeRuns: [], quarantinedRuns: [], proposalRevisionCount: 0 });
    } finally { await app.close(); }
  });

  it('refuses a third subject every retention route on a foreign run, with zero side effects', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `u-${++n}`; })() });
    const runRef = quarantinableEngineRun(store);
    const { app, audit, token } = surface(store);
    const otherToken = mintSession('other-agent', SESSION).token;
    try {
      // A real plan hash, taken by the operator — a third subject must not be able to spend it either.
      const planned = await app.inject({
        method: 'POST', url: '/api/control/retention/dry-run', headers: headers(token), payload: { runRefs: [runRef] },
      });
      const planHash = (planned.json().value as { planHash: string }).planHash;
      audit.length = 0;

      for (const [url, payload] of [
        ['/api/control/retention/dry-run', { runRefs: [runRef] }],
        ['/api/control/retention/quarantine', { runRefs: [runRef], expectedPlanHash: planHash }],
        ['/api/control/retention/restore', { runRef }],
      ] as Array<[string, Record<string, unknown>]>) {
        const response = await app.inject({ method: 'POST', url, headers: headers(otherToken), payload });
        expect(response.statusCode, `${url}: ${response.body}`).toBe(404);
        expect(response.json()).toMatchObject({ error: 'not-found' });
      }
      expect(audit).toEqual([]);
      const owned = store.getRun(ENGINE, runRef);
      if (!owned.ok) throw new Error(owned.detail);
      expect(owned.value.run.lifecycle.kind).toBe('interrupted');
      expect(store.inventory(ENGINE).quarantinedRuns).toEqual([]);
    } finally { await app.close(); }
  });

  // ── GAP-6: the single-revision read ──────────────────────────────────────────────────────────────

  it('serves an engine-owned revision so the steering checkpoint pick-list populates', async () => {
    const store = createInMemoryControlPlaneStore({ newId: (() => { let n = 0; return () => `p-${++n}`; })() });
    const planned: PlanProposal = {
      ...proposal,
      stages: proposal.stages.map((stage) => ({ ...stage, checkpoints: [{ id: `safe-${stage.id}`, label: `After ${stage.title}` }] })),
    };
    const revision = approvedRevisionFor(store, ENGINE, 'engine-checkpoints', planned);
    const { app, token } = surface(store);
    const otherToken = mintSession('other-agent', SESSION).token;
    try {
      const read = await app.inject({
        method: 'GET', url: `/api/control/proposals/${revision.proposalRef}/revisions/1`, headers: headers(token),
      });
      // Before this, run detail's poll threw here and the steering control degraded SILENTLY to a
      // free-text box — the operator had to type a checkpoint id from memory on exactly the headless
      // runs steering exists for.
      expect(read.statusCode, read.body).toBe(200);
      const value = read.json().value as {
        ownerSubject: string; snapshot: { stages: Array<{ checkpoints: Array<{ id: string }> }> };
      };
      expect(value.ownerSubject).toBe(ENGINE);
      expect(value.snapshot.stages.flatMap((stage) => stage.checkpoints.map((point) => point.id)))
        .toEqual(['safe-verify', 'safe-report']);

      // Every other subject keeps exact own-subject scoping on this read too.
      expect((await app.inject({
        method: 'GET', url: `/api/control/proposals/${revision.proposalRef}/revisions/1`, headers: headers(otherToken),
      })).statusCode).toBe(404);

      // BOUNDARY: only the single-revision GET widened. The proposals LIST stays own-subject — bridge
      // adoption safety — so the operator's Composer list is not filled with imported def-card plans.
      const list = await app.inject({ method: 'GET', url: '/api/control/proposals', headers: headers(token) });
      expect((list.json() as { proposals: unknown[] }).proposals).toEqual([]);
    } finally { await app.close(); }
  });
});

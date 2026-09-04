// W51 / W53 — the CROSS-TIER guard for `GET /api/control/runs/:runRef`.
//
// The Run-detail wire graph is projected by the server (`routes.ts#runDetailDto`) and decoded by the
// browser (`src/control/controlClient.ts#decodeRunDetail`) through two hand-maintained key lists. Three
// times now those lists have drifted silently: the server grew stage/attempt columns, then a resolved
// human response grew `respondedBy`/`idempotencyKey`, the decoder kept its old list, `exactDto` refused
// the unknown keys, and the Run view showed nothing on the VM while every existing unit test — each of
// which built its OWN row — stayed green.
//
// This test is the one place both tiers meet on a value NEITHER side hand-wrote: a run built through the
// real store and returned through the real route, decoded by the real browser decoder. It fails if the
// server adds a key the client does not know (`exactDto` rejects the unknown key) AND if the client adds
// a required key the server does not emit (`exactDto` finds it missing). Neither direction can be fixed
// by editing one tier alone.
//
// W53 closes the hole that let the SECOND drift through: the run projected here now exercises EVERY
// decoder list — stageGenerations, generationSupersessions, iterationLoops, iterationRequests,
// iterationReceipts — and carries a RESOLVED human request (answered through `store.respondHumanRequest`,
// the same store write the respond route calls) plus a checker stage whose `review`, `completionGate`
// and `workflowProfile` are non-null. An empty list decodes vacuously; only a populated one is a guard.

import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from './store.ts';
import type { AttemptSessionPublicRow } from './p2Contracts.ts';
import type { ControlPlaneStore } from './storeTypes.ts';
import type { JsonObject } from './types.ts';
import { decodeRunDetail } from '../../src/control/controlClient.ts';

const SESSION: SessionConfig = { secret: Buffer.from('run-detail-wire-contract-secret!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';
const SUBJECT = 'operator';

/** The compiler-owned checker fields the live VM emits on every stage row. */
const STAGE_CHECKER_KEYS = [
  'workflowProfile', 'review', 'completionGate',
  'currentGeneration', 'currentGenerationRef', 'acceptedGenerationRef',
] as const;
/** The generation-lineage fields the live VM emits on every attempt row. */
const ATTEMPT_LINEAGE_KEYS = ['logicalGeneration', 'baseGenerationRef', 'baseCommit'] as const;
/** Every field of the server's `HumanResponse`, as it reaches the browser on a RESOLVED request. */
const HUMAN_RESPONSE_KEYS = [
  'requestRevision', 'decision', 'respondedBy', 'idempotencyKey', 'response', 'respondedAt',
] as const;
/**
 * Required keys on the iteration rows the older guard never produced. `participantAttemptRef` is the
 * drift THIS test found: the server has always stamped it (`types.ts` `IterationReceipt`,
 * `store.ts#recordIterationReceipt`) and the decoder refused it, because no test ever built a receipt.
 */
const ITERATION_REQUIRED_KEYS = [
  ['iterationReceipts', 'participantAttemptRef'],
  ['iterationRequests', 'baseCommit'],
  ['iterationLoops', 'definitionHash'],
  ['stageGenerations', 'logicalStageId'],
  ['generationSupersessions', 'triggerReceiptRef'],
] as const;
/** The row lists `decodeRunDetail` decodes; every one of them must be non-empty for the guard to bite. */
const ROW_LISTS = [
  'stages', 'attempts', 'sessions', 'humanRequests', 'attemptSessions',
  'stageGenerations', 'generationSupersessions', 'iterationLoops', 'iterationRequests', 'iterationReceipts',
] as const;

/** The checker stage's approved assignment provenance; `review` is refused without one (`store.ts`). */
const CHECKER_ASSIGNMENT = {
  agentId: 'kb-checker',
  declarationPath: 'agents/kb-checker.md',
  declarationHash: 'c'.repeat(64),
  profileId: 'worker:claude:claude-sonnet-5',
  runtime: 'claude',
  model: 'claude-sonnet-5',
};

/**
 * A producer/checker proposal shaped like the real `iteration-loop-demo` definition
 * (`origin/ops:orgs/faceless-youtube/workflows/iteration-loop-demo.md`): a `draft:` producer stage that
 * declares an artifact, and a `review:` checker stage carrying `workflowProfile: 'checker-readonly'`,
 * a bounded `review` contract and a `completionGate`. `store.ts#approvedRunAssignments` copies those
 * three onto the stage row, and `createRun` compiles the pair into a real iteration loop
 * (`migrations.ts#legacyGroupForStages`) — which is what makes the five iteration lists reachable.
 */
const proposalSnapshot = {
  schema: 'kb.plan-proposal/v1', proposalId: 'wire-contract', project: 'kb-ops', title: 'Wire contract',
  summary: 'Project a run detail through the real route.',
  manager: { runtime: 'claude', model: 'claude-opus-5', requiredSkills: [] },
  scope: { read: ['dashboard'], write: ['dashboard'] },
  governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
  stages: [{
    id: 'draft', title: 'Draft', action: 'draft:wire-contract', target: 'dashboard/server/control',
    workOrder: 'Write the draft.', riskTier: 'T2', dependsOn: [],
    worker: { runtime: 'claude', model: 'claude-sonnet-5' }, requiredSkills: [],
    scope: { read: ['dashboard'], write: ['dashboard/server/control'] },
    artifacts: [{ id: 'draft-artifact', path: 'draft.md', description: 'The draft under review.' }],
    checkpoints: [], humanGates: [],
  }, {
    id: 'check', title: 'Check', action: 'review:wire-contract', target: 'dashboard/server/control',
    workOrder: 'Review the draft.', riskTier: 'T2', dependsOn: ['draft'],
    worker: { runtime: 'claude', model: 'claude-sonnet-5' }, requiredSkills: [],
    assignment: { ...CHECKER_ASSIGNMENT },
    workflowProfile: 'checker-readonly',
    review: {
      subjectStageId: 'draft', maxCreatorReworks: 1,
      criteria: [{ id: 'grounded', description: 'The draft is grounded in the pinned artifact.' }],
    },
    completionGate: { id: 'publish', kind: 'approval', prompt: 'Approve the accepted draft.', requiresReview: 'pass' },
    scope: { read: ['dashboard'], write: [] }, artifacts: [], checkpoints: [], humanGates: [],
  }],
};

const attemptSessionRow = (attemptRef: string): AttemptSessionPublicRow => ({
  attemptRef, sessionId: 'pty-wire-contract', launcher: 'claude', state: 'exited',
  startedAt: '2026-09-03T19:46:04.254Z', endedAt: '2026-09-03T19:46:19.355Z',
  exit: { exitCode: null, reason: 'closed', observedAt: '2026-09-03T19:46:19.355Z' },
  controllerClaimed: false, liveControl: false,
});

function unwrap<T>(result: { ok: true; value: T } | { ok: false; reason: string; detail?: string }, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${result.reason} ${result.detail ?? ''}`);
  return result.value;
}

function runDetail(store: ControlPlaneStore, runRef: string) {
  return unwrap(store.getRun(SUBJECT, runRef), 'getRun');
}

/** Drive one attempt from `queued` to `succeeded` through the real transitions. */
function succeedAttempt(store: ControlPlaneStore, attemptRef: string, version: number): number {
  let current = version;
  for (const state of ['starting', 'running', 'succeeded'] as const) {
    current = unwrap(store.transitionAttempt(SUBJECT, attemptRef, current, state), `attempt ${state}`).version;
  }
  return current;
}

/**
 * Build ONE run through the REAL store and return it through the REAL route.
 *
 * The chain mirrors the shipped producer/checker turn order exactly (the same sequence
 * `store.test.ts`'s Task-4 suite drives): seed generation -> loop activation -> review request ->
 * failing receipt -> turn advance -> rework request -> rework generation. The rework generation is what
 * mints the `generationSupersessions` row; nothing here hand-writes a wire row.
 */
async function projectRunDetailThroughTheRealRoute(): Promise<Record<string, unknown>> {
  const store = createInMemoryControlPlaneStore();
  const created = unwrap(store.createProposalRevision(SUBJECT, {
    sourceComposerRef: 'composer-wire-contract', sourceTurnId: 'turn-wire-contract',
    title: proposalSnapshot.title, snapshot: proposalSnapshot as unknown as JsonObject,
  }), 'createProposalRevision');
  unwrap(store.decideProposal(SUBJECT, created.proposalRef, created.revision, {
    expectedHash: created.hash, expectedApprovalRevision: 0,
    decision: 'approved', idempotencyKey: 'wire-contract-approve',
  }), 'decideProposal');
  const run = unwrap(store.createRun(SUBJECT, {
    owner: { type: 'workflow', id: 'wire-contract', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/wire-contract.md' },
    executionHost: 'desktop', title: proposalSnapshot.title,
    proposalRef: created.proposalRef, proposalRevision: created.revision,
    expectedProposalHash: created.hash, managerRuntime: 'claude', managerModel: 'claude-opus-5',
    idempotencyKey: 'wire-contract-launch',
    // The launch repeats the approved provenance verbatim; `store.ts` refuses any stage whose
    // assignment or checker contract differs from the snapshot it was approved under.
    stages: proposalSnapshot.stages.map((stage) => ({
      stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn,
      ...('assignment' in stage ? { assignment: stage.assignment } : {}),
      ...('workflowProfile' in stage ? { workflowProfile: stage.workflowProfile } : {}),
      ...('review' in stage ? { review: stage.review } : {}),
      ...('completionGate' in stage ? { completionGate: stage.completionGate } : {}),
    })) as never,
  }), 'createRun');
  const runRef = run.run.runRef;

  // --- Seed generation on the producer stage --------------------------------------------------------
  const producerStageRef = run.stages.find((stage) => stage.stageId === 'draft')!.stageRef;
  const checkerStageRef = run.stages.find((stage) => stage.stageId === 'check')!.stageRef;
  const linked = unwrap(store.linkStageCard(SUBJECT, producerStageRef,
    run.stages.find((stage) => stage.stageId === 'draft')!.version, 'card-wire-contract'), 'linkStageCard');
  const seedAttempt = unwrap(store.createAttempt(SUBJECT, producerStageRef, {
    expectedStageVersion: linked.version, runtime: 'claude', model: 'claude-sonnet-5',
  }), 'createAttempt(seed)');
  // The worker session is a real row on the `sessions` list beside the run's manager session.
  unwrap(store.createWorkerSession(SUBJECT, seedAttempt.attemptRef, {
    expectedAttemptVersion: seedAttempt.version, attemptOperationKey: 'wire-contract-attempt',
  }), 'createWorkerSession');
  let seedVersion = runDetail(store, runRef).attempts
    .find((attempt) => attempt.attemptRef === seedAttempt.attemptRef)!.version;
  seedVersion = succeedAttempt(store, seedAttempt.attemptRef, seedVersion);
  const seedGeneration = unwrap(store.recordStageGeneration(SUBJECT, producerStageRef, {
    expectedStageVersion: runDetail(store, runRef).stages.find((stage) => stage.stageRef === producerStageRef)!.version,
    expectedAttemptVersion: seedVersion, expectedGeneration: 1,
    operationKey: `result:${runRef}:draft`,
    resultHash: createHash('sha256').update('wire-contract-draft').digest('hex'),
    resultCardRef: 'card-wire-contract',
    baseCommit: 'b'.repeat(40), canonicalCommit: createHash('sha1').update('wire-contract-draft').digest('hex'),
  }), 'recordStageGeneration(seed)');
  for (const state of ['running', 'succeeded'] as const) {
    const stage = runDetail(store, runRef).stages.find((candidate) => candidate.stageRef === producerStageRef)!;
    unwrap(store.transitionStage(SUBJECT, producerStageRef, stage.version, state), `producer stage ${state}`);
  }

  // --- Activate the compiled iteration loop and open the review turn ---------------------------------
  const compiled = runDetail(store, runRef).iterationLoops[0]!;
  const loopRef = compiled.iterationLoopRef;
  unwrap(store.activateIterationLoop(SUBJECT, loopRef, {
    expectedLoopVersion: compiled.version, seedGenerationRefs: [seedGeneration.generationRef],
    artifactGenerationRefs: { 'draft-artifact': seedGeneration.generationRef },
    operationKey: `iteration-activate:${runRef}:${compiled.iterationGroupId}:c1`,
  }), 'activateIterationLoop');
  const reviewRequest = unwrap(store.recordIterationRequest(SUBJECT, loopRef, {
    expectedLoopVersion: runDetail(store, runRef).iterationLoops[0]!.version,
    routeId: 'check-to-judge', kind: 'review',
    inputGenerationRefs: [seedGeneration.generationRef], baseCommit: seedGeneration.canonicalCommit!,
    artifactHashes: { 'draft-artifact': seedGeneration.resultHash! },
    unresolvedFindingRefs: [], preservedInvariants: [],
    nextAcceptanceCheck: 'Apply the grounded criterion.', instructions: 'Judge the draft.',
    operationKey: `iteration-request:${runRef}:check:c1`,
  }), 'recordIterationRequest(review)');

  // --- The checker's own attempt, then its FAILING receipt ------------------------------------------
  const checkerStage = runDetail(store, runRef).stages.find((stage) => stage.stageRef === checkerStageRef)!;
  const checkerAttempt = unwrap(store.createAttempt(SUBJECT, checkerStageRef, {
    expectedStageVersion: checkerStage.version, runtime: CHECKER_ASSIGNMENT.runtime, model: CHECKER_ASSIGNMENT.model,
  }), 'createAttempt(checker)');
  succeedAttempt(store, checkerAttempt.attemptRef, checkerAttempt.version);
  for (const state of ['running', 'succeeded'] as const) {
    const stage = runDetail(store, runRef).stages.find((candidate) => candidate.stageRef === checkerStageRef)!;
    unwrap(store.transitionStage(SUBJECT, checkerStageRef, stage.version, state), `checker stage ${state}`);
  }
  const failedReceipt = unwrap(store.recordIterationReceipt(SUBJECT, loopRef, {
    expectedLoopVersion: runDetail(store, runRef).iterationLoops[0]!.version,
    requestRef: reviewRequest.requestRef,
    outcome: {
      schema: 'kb.iteration-outcome/v1', requestRef: reviewRequest.requestRef, iterationLoopRef: loopRef,
      participantId: 'check-judge', cycle: reviewRequest.cycle, verdict: 'fail',
      inputGenerationRefs: [...reviewRequest.inputGenerationRefs],
      criteria: [{ criterionId: 'grounded', verdict: 'fail', findingIds: ['ungrounded'] }],
      findings: [{
        findingId: 'ungrounded', criterionId: 'grounded', severity: 'blocking',
        summary: 'The draft is not grounded in the pinned artifact.', evidencePaths: ['draft.md'],
      }],
      positions: [], recordedDissent: [], summary: 'The draft failed the grounded criterion.',
    },
    outputGenerationRefs: [], baseCommit: seedGeneration.baseCommit!, canonicalCommit: seedGeneration.canonicalCommit!,
    participantAttemptRef: checkerAttempt.attemptRef,
    operationKey: `iteration-receipt:${runRef}:check:c1:fail`,
  }), 'recordIterationReceipt(fail)');

  // --- Advance to the rework turn, request it, and commit the successor generation -------------------
  unwrap(store.advanceIterationTurn(SUBJECT, loopRef, {
    expectedLoopVersion: runDetail(store, runRef).iterationLoops[0]!.version,
    expectedReceiptRef: failedReceipt.receiptRef,
    expectedActiveGenerationRefs: [...runDetail(store, runRef).iterationLoops[0]!.activeGenerationRefs],
    nextStepId: 'check-rework',
    operationKey: `iteration-advance:${runRef}:check:producer`,
  }), 'advanceIterationTurn');
  const queuedLoop = runDetail(store, runRef).iterationLoops[0]!;
  const reworkRequest = unwrap(store.recordIterationRequest(SUBJECT, loopRef, {
    expectedLoopVersion: queuedLoop.version, routeId: 'check-to-manager', kind: 'rework',
    inputGenerationRefs: [...queuedLoop.activeGenerationRefs], baseCommit: seedGeneration.canonicalCommit!,
    artifactHashes: { 'draft-artifact': seedGeneration.resultHash! },
    unresolvedFindingRefs: ['ungrounded'], preservedInvariants: ['grounded'],
    nextAcceptanceCheck: 'Resolve the ungrounded finding.', instructions: 'Rework the draft.',
    operationKey: `iteration-request:${runRef}:check:producer`,
  }), 'recordIterationRequest(rework)');

  const reworkStage = runDetail(store, runRef).stages.find((stage) => stage.stageRef === producerStageRef)!;
  if (reworkStage.state !== 'running') {
    unwrap(store.transitionStage(SUBJECT, producerStageRef, reworkStage.version, 'running'), 'producer stage rerun');
  }
  const reworkAttemptRef = runDetail(store, runRef).stages
    .find((stage) => stage.stageRef === producerStageRef)!.currentAttemptRef!;
  let reworkVersion = runDetail(store, runRef).attempts
    .find((attempt) => attempt.attemptRef === reworkAttemptRef)!.version;
  reworkVersion = succeedAttempt(store, reworkAttemptRef, reworkVersion);
  const reworkAttempt = runDetail(store, runRef).attempts.find((attempt) => attempt.attemptRef === reworkAttemptRef)!;
  unwrap(store.recordStageGeneration(SUBJECT, producerStageRef, {
    expectedStageVersion: runDetail(store, runRef).stages.find((stage) => stage.stageRef === producerStageRef)!.version,
    expectedAttemptVersion: reworkVersion, expectedGeneration: reworkAttempt.logicalGeneration!,
    operationKey: `iteration-result:${runRef}:draft:${reworkRequest.requestRef}`,
    resultHash: createHash('sha256').update('wire-contract-rework').digest('hex'),
    // A successor generation never re-links a canonical card; the stage's card stays the seed's.
    resultCardRef: null,
    baseCommit: reworkAttempt.baseCommit ?? seedGeneration.canonicalCommit!,
    canonicalCommit: createHash('sha1').update('wire-contract-rework').digest('hex'),
  }), 'recordStageGeneration(rework)');

  // --- One OPEN and one RESOLVED human request ------------------------------------------------------
  // The resolution goes through `store.respondHumanRequest` — the exact store write the respond route's
  // service calls (`server/services/runReadService.ts#respondHumanRequestRoute` -> `RespondPort.respond`)
  // — so `respondedBy` and `idempotencyKey` are stamped by the SERVER, never by this test.
  const resolvedRequest = unwrap(store.createHumanRequest(SUBJECT, runRef, {
    stageRef: checkerStageRef, kind: 'approval',
    title: 'Approve the reworked draft', prompt: 'Approve the reworked draft.',
  }), 'createHumanRequest(resolved)');
  unwrap(store.respondHumanRequest(SUBJECT, resolvedRequest.requestRef, {
    expectedRevision: resolvedRequest.revision, decision: 'approved',
    idempotencyKey: `human-response:${resolvedRequest.requestRef}:${resolvedRequest.revision}:approved`,
    response: null,
  }), 'respondHumanRequest');
  unwrap(store.createHumanRequest(SUBJECT, runRef, {
    stageRef: producerStageRef, kind: 'approval',
    title: 'Approve the next draft', prompt: 'Approve the next draft.',
  }), 'createHumanRequest(open)');

  const app = Fastify();
  registerWriteSurface(app, makeSurfaceContext({
    repoRoot: fileURLToPath(new URL('../../../', import.meta.url)),
    sessionConfig: SESSION, allowedOrigins: [ORIGIN], credentials: () => [], controlStore: store,
    // The PTY registry is not under test; the route asks this hook for the attempt-session rows and the
    // browser decodes whatever it returns, so one real-shaped row keeps that list non-empty.
    ptyRunAttemptSessions: () => [attemptSessionRow(seedAttempt.attemptRef)],
    appendAudit: () => ({ ts: '2026-09-03T00:00:00.000Z', action: 'noop' }),
    opsGit: () => ({ stdout: '', stderr: '', exitCode: 0 }),
  } as never));
  await app.ready();
  try {
    const response = await app.inject({
      method: 'GET', url: `/api/control/runs/${runRef}`,
      headers: {
        origin: ORIGIN, host: 'localhost:5317',
        authorization: `Bearer ${mintSession(SUBJECT, SESSION).token}`,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { ok: boolean; value: Record<string, unknown> };
    expect(body.ok).toBe(true);
    return body.value;
  } finally {
    await app.close();
  }
}

/** The `GET /api/control/runs/:runRef` envelope the browser actually decodes, around the served value. */
function envelopeAround(value: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: true, value, replayed: false,
    execution: { state: 'injected', source: null, unlockedAt: null, unlockedBy: null },
  };
}

/** The client's `getRun` reads `body.value` off this envelope and decodes it; mirrored here verbatim. */
function decodeEnvelope(envelope: Record<string, unknown>): unknown {
  const value = envelope.value;
  return envelope.ok === true && value !== null && typeof value === 'object' ? decodeRunDetail(value) : null;
}

/** Rewrite the ONE resolved request's `response` in a projected value, leaving every other row alone. */
function withResolvedResponse(
  value: Record<string, unknown>,
  rewrite: (response: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const requests = value.humanRequests as Array<Record<string, unknown>>;
  return {
    ...value,
    humanRequests: requests.map((request) => request.response === null
      ? request
      : { ...request, response: rewrite(request.response as Record<string, unknown>) }),
  };
}

const resolvedRequestOf = (value: Record<string, unknown>): Record<string, unknown> =>
  (value.humanRequests as Array<Record<string, unknown>>).find((request) => request.response !== null)!;

describe('[W51/W53] the run-detail wire contract holds across both tiers', () => {
  it('decodes a value the real projection produced, with every row list populated', async () => {
    const value = await projectRunDetailThroughTheRealRoute();

    // EVERY list the decoder walks carries at least one row, so no key list can decode vacuously.
    for (const list of ROW_LISTS) {
      expect((value[list] as unknown[]).length, list).toBeGreaterThan(0);
    }

    // The checker stage carries the three compiler-owned contract fields, non-null.
    const stages = value.stages as Array<Record<string, unknown>>;
    const attempts = value.attempts as Array<Record<string, unknown>>;
    const checker = stages.find((stage) => stage.stageId === 'check')!;
    expect(checker.workflowProfile).toBe('checker-readonly');
    expect(checker.review).not.toBeNull();
    expect(checker.completionGate).not.toBeNull();

    // A RESOLVED human request, answered through the real store write — the W53 drift's own shape.
    const resolved = resolvedRequestOf(value);
    const response = resolved.response as Record<string, unknown>;
    expect(resolved.state).toBe('resolved');
    expect(Object.keys(response).sort()).toEqual([...HUMAN_RESPONSE_KEYS].sort());
    expect(response.respondedBy).toBe(SUBJECT);
    expect(typeof response.idempotencyKey).toBe('string');
    expect((value.humanRequests as Array<Record<string, unknown>>).some((request) => request.state === 'open')).toBe(true);

    // THE GUARD. Server-projected value, browser decoder, no hand-written row anywhere between them —
    // decoded both directly and through the full `getRun` envelope the browser actually receives.
    expect(decodeRunDetail(value)).not.toBeNull();
    expect(decodeEnvelope(envelopeAround(value))).not.toBeNull();

    // Named so a REMOVED server field fails with the field's name rather than a bare `toBeNull`.
    for (const stage of stages) for (const key of STAGE_CHECKER_KEYS) expect(stage).toHaveProperty(key);
    for (const attempt of attempts) for (const key of ATTEMPT_LINEAGE_KEYS) expect(attempt).toHaveProperty(key);
    for (const key of HUMAN_RESPONSE_KEYS) expect(response).toHaveProperty(key);
  });

  it('fails in BOTH drift directions, not just when the server grows a key', async () => {
    const value = await projectRunDetailThroughTheRealRoute();
    const stages = value.stages as Array<Record<string, unknown>>;
    const attempts = value.attempts as Array<Record<string, unknown>>;

    // Direction 1 — the server grows a key the client decoder does not admit, on ANY row list. Every
    // list is populated, so this is a real assertion about each one rather than a vacuous pass.
    for (const list of ROW_LISTS) {
      const rows = value[list] as Array<Record<string, unknown>>;
      const grown = { ...value, [list]: [{ ...rows[0], grownServerSide: 'unknown-key' }, ...rows.slice(1)] };
      expect(decodeRunDetail(grown), list).toBeNull();
    }
    expect(decodeRunDetail(withResolvedResponse(value,
      (response) => ({ ...response, respondedFrom: 'grown-server-side' })))).toBeNull();

    // Direction 2 — the client requires a key the server does not emit. Dropping the field from the
    // projected row is exactly what the decoder sees when the client's list runs ahead of the server's.
    for (const key of STAGE_CHECKER_KEYS) {
      const { [key]: _dropped, ...withoutKey } = stages[0] as Record<string, unknown>;
      expect(decodeRunDetail({ ...value, stages: [withoutKey, ...stages.slice(1)] }), key).toBeNull();
    }
    for (const key of ATTEMPT_LINEAGE_KEYS) {
      const { [key]: _dropped, ...withoutKey } = attempts[0] as Record<string, unknown>;
      expect(decodeRunDetail({ ...value, attempts: [withoutKey, ...attempts.slice(1)] }), key).toBeNull();
    }
    for (const key of HUMAN_RESPONSE_KEYS) {
      const dropped = withResolvedResponse(value, (response) => {
        const { [key]: _gone, ...rest } = response;
        return rest;
      });
      expect(decodeRunDetail(dropped), key).toBeNull();
      expect(decodeEnvelope(envelopeAround(dropped)), key).toBeNull();
    }
    for (const [list, key] of ITERATION_REQUIRED_KEYS) {
      const rows = value[list] as Array<Record<string, unknown>>;
      const { [key]: _dropped, ...withoutKey } = rows[0]!;
      expect(decodeRunDetail({ ...value, [list]: [withoutKey, ...rows.slice(1)] }), `${list}.${key}`).toBeNull();
    }
  });
});

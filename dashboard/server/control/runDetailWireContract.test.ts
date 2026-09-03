// W51 — the CROSS-TIER guard for `GET /api/control/runs/:runRef`.
//
// The Run-detail wire graph is projected by the server (`routes.ts#runDetailDto`) and decoded by the
// browser (`src/control/controlClient.ts#decodeRunDetail`) through two hand-maintained key lists. Twice
// now those lists have drifted silently: the server grew stage/attempt columns, the decoder kept its old
// list, `exactDto` refused the unknown keys, and the Run view showed nothing on the VM while every
// existing unit test — each of which built its OWN stage row — stayed green.
//
// This test is the one place both tiers meet on a value NEITHER side hand-wrote: a run built through the
// real store and returned through the real route, decoded by the real browser decoder. It fails if the
// server adds a key the client does not know (`exactDto` rejects the unknown key) AND if the client adds
// a required key the server does not emit (`exactDto` finds it missing). Neither direction can be fixed
// by editing one tier alone.

import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from './store.ts';
import type { AttemptSessionPublicRow } from './p2Contracts.ts';
import type { JsonObject } from './types.ts';
import { decodeRunDetail } from '../../src/control/controlClient.ts';

const SESSION: SessionConfig = { secret: Buffer.from('run-detail-wire-contract-secret!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';

/** The compiler-owned checker fields the live VM emits on every stage row. */
const STAGE_CHECKER_KEYS = [
  'workflowProfile', 'review', 'completionGate',
  'currentGeneration', 'currentGenerationRef', 'acceptedGenerationRef',
] as const;
/** The generation-lineage fields the live VM emits on every attempt row. */
const ATTEMPT_LINEAGE_KEYS = ['logicalGeneration', 'baseGenerationRef', 'baseCommit'] as const;

const proposalSnapshot = {
  schema: 'kb.plan-proposal/v1', proposalId: 'wire-contract', project: 'kb-ops', title: 'Wire contract',
  summary: 'Project a run detail through the real route.',
  manager: { runtime: 'claude', model: 'claude-opus-5', requiredSkills: [] },
  scope: { read: ['dashboard'], write: ['dashboard'] },
  governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
  stages: [{
    id: 'draft', title: 'Draft', action: 'write:draft', target: 'dashboard/server/control',
    workOrder: 'Write the draft.', riskTier: 'T2', dependsOn: [],
    worker: { runtime: 'claude', model: 'claude-sonnet-5' }, requiredSkills: [],
    scope: { read: ['dashboard'], write: ['dashboard/server/control'] }, artifacts: [], checkpoints: [], humanGates: [],
  }, {
    id: 'revise', title: 'Revise', action: 'write:revise', target: 'dashboard/server/control',
    workOrder: 'Revise the draft.', riskTier: 'T2', dependsOn: ['draft'],
    worker: { runtime: 'claude', model: 'claude-sonnet-5' }, requiredSkills: [],
    scope: { read: ['dashboard'], write: ['dashboard/server/control'] }, artifacts: [], checkpoints: [], humanGates: [],
  }],
};

const attemptSessionRow = (attemptRef: string): AttemptSessionPublicRow => ({
  attemptRef, sessionId: 'pty-wire-contract', launcher: 'claude', state: 'exited',
  startedAt: '2026-09-03T19:46:04.254Z', endedAt: '2026-09-03T19:46:19.355Z',
  exit: { exitCode: null, reason: 'closed', observedAt: '2026-09-03T19:46:19.355Z' },
  controllerClaimed: false, liveControl: false,
});

/**
 * Build one run through the REAL store — proposal, approval, launch, attempt, worker session, open
 * human request — and return it through the REAL route. Nothing here hand-writes a wire row.
 */
async function projectRunDetailThroughTheRealRoute(): Promise<Record<string, unknown>> {
  const store = createInMemoryControlPlaneStore();
  const created = store.createProposalRevision('operator', {
    sourceComposerRef: 'composer-wire-contract', sourceTurnId: 'turn-wire-contract',
    title: proposalSnapshot.title, snapshot: proposalSnapshot as unknown as JsonObject,
  });
  if (!created.ok) throw new Error(created.detail);
  const approved = store.decideProposal('operator', created.value.proposalRef, created.value.revision, {
    expectedHash: created.value.hash, expectedApprovalRevision: 0,
    decision: 'approved', idempotencyKey: 'wire-contract-approve',
  });
  if (!approved.ok) throw new Error(approved.detail);
  const run = store.createRun('operator', {
    owner: { type: 'workflow', id: 'wire-contract', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/wire-contract.md' },
    executionHost: 'desktop', title: proposalSnapshot.title,
    proposalRef: created.value.proposalRef, proposalRevision: created.value.revision,
    expectedProposalHash: created.value.hash, managerRuntime: 'claude', managerModel: 'claude-opus-5',
    idempotencyKey: 'wire-contract-launch',
    stages: proposalSnapshot.stages.map((stage) => ({ stageId: stage.id, title: stage.title, dependsOn: stage.dependsOn })),
  });
  if (!run.ok) throw new Error(run.detail);
  const runRef = run.value.run.runRef;

  const rootStage = run.value.stages.find((stage) => stage.dependsOn.length === 0);
  if (!rootStage) throw new Error('the launched run has no root stage');
  const attempt = store.createAttempt('operator', rootStage.stageRef, {
    expectedStageVersion: rootStage.version, runtime: 'claude', model: 'claude-sonnet-5',
  });
  if (!attempt.ok) throw new Error(attempt.detail);
  const session = store.createWorkerSession('operator', attempt.value.attemptRef, {
    expectedAttemptVersion: attempt.value.version, attemptOperationKey: 'wire-contract-attempt',
  });
  if (!session.ok) throw new Error(session.detail);
  const request = store.createHumanRequest('operator', runRef, {
    stageRef: rootStage.stageRef, kind: 'approval',
    title: 'Approve the draft', prompt: 'Approve the drafted result.',
  });
  if (!request.ok) throw new Error(request.detail);

  const app = Fastify();
  registerWriteSurface(app, makeSurfaceContext({
    repoRoot: fileURLToPath(new URL('../../../', import.meta.url)),
    sessionConfig: SESSION, allowedOrigins: [ORIGIN], credentials: () => [], controlStore: store,
    // The PTY registry is not under test; the route asks this hook for the attempt-session rows and the
    // browser decodes whatever it returns, so one real-shaped row keeps that list non-empty.
    ptyRunAttemptSessions: () => [attemptSessionRow(attempt.value.attemptRef)],
    appendAudit: () => ({ ts: '2026-09-03T00:00:00.000Z', action: 'noop' }),
    opsGit: () => ({ stdout: '', stderr: '', exitCode: 0 }),
  } as never));
  await app.ready();
  try {
    const response = await app.inject({
      method: 'GET', url: `/api/control/runs/${runRef}`,
      headers: {
        origin: ORIGIN, host: 'localhost:5317',
        authorization: `Bearer ${mintSession('operator', SESSION).token}`,
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

describe('[W51] the run-detail wire contract holds across both tiers', () => {
  it('decodes a value the real projection produced, with every row list populated', async () => {
    const value = await projectRunDetailThroughTheRealRoute();

    // The rows that carry the drifting key lists are all present, so an empty-list detail cannot pass.
    const stages = value.stages as Array<Record<string, unknown>>;
    const attempts = value.attempts as Array<Record<string, unknown>>;
    expect(stages.length).toBeGreaterThan(0);
    expect(attempts.length).toBeGreaterThan(0);
    expect((value.sessions as unknown[]).length).toBeGreaterThan(0);
    expect((value.humanRequests as unknown[]).length).toBeGreaterThan(0);
    expect((value.attemptSessions as unknown[]).length).toBeGreaterThan(0);

    // THE GUARD. Server-projected value, browser decoder, no hand-written row anywhere between them.
    expect(decodeRunDetail(value)).not.toBeNull();

    // Named so a REMOVED server field fails with the field's name rather than a bare `toBeNull`.
    for (const stage of stages) for (const key of STAGE_CHECKER_KEYS) expect(stage).toHaveProperty(key);
    for (const attempt of attempts) for (const key of ATTEMPT_LINEAGE_KEYS) expect(attempt).toHaveProperty(key);
  });

  it('fails in BOTH drift directions, not just when the server grows a key', async () => {
    const value = await projectRunDetailThroughTheRealRoute();
    const stages = value.stages as Array<Record<string, unknown>>;
    const attempts = value.attempts as Array<Record<string, unknown>>;

    // Direction 1 — the server grows a stage/attempt key the client decoder does not admit.
    expect(decodeRunDetail({
      ...value, stages: [{ ...stages[0], resumeToken: 'grown-server-side' }, ...stages.slice(1)],
    })).toBeNull();
    expect(decodeRunDetail({
      ...value, attempts: [{ ...attempts[0], baseBranch: 'grown-server-side' }, ...attempts.slice(1)],
    })).toBeNull();

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
  });
});

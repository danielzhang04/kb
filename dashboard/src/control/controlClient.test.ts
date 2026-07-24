import { describe, expect, it, vi } from 'vitest';
import {
  activateRun,
  createProposalRevision,
  createManagerSuccessor,
  decideProposalRevision,
  dryRunQuarantine,
  launchProposalRevision,
  listRunEvents,
  quarantineRuns,
  rerouteManagedStage,
  resolveReviewCompletionGate,
  respondToHumanRequest,
  resumeRunAfterHumanResponse,
  steerManagerAtCheckpoint,
  type FetchLike,
  type PlanProposalDto,
} from './controlClient';

const proposal: PlanProposalDto = {
  schema: 'kb.plan-proposal/v1',
  proposalId: 'proposal-1',
  project: 'kb-ops',
  title: 'Synthetic run',
  summary: 'Safely verify the control plane.',
  manager: { runtime: 'claude', model: 'claude-sonnet-5', requiredSkills: [] },
  scope: { read: ['dashboard'], write: ['dashboard/src/control'] },
  governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'orgs/kb-ops/contract.md'],
  stages: [],
};

function response(body: unknown = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function recordedFetch(body: unknown = {}) {
  return vi.fn(async () => response(body)) as unknown as FetchLike;
}

function requestBody(fetchImpl: ReturnType<typeof vi.fn>): unknown {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe('control client proposal CAS', () => {
  it('creates a proposal revision against the exact previous content hash', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: {}, diff: {} });
    await createProposalRevision('proposal/ref', { expectedPreviousHash: 'a'.repeat(64), proposal }, 'bearer', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/control/proposals/proposal%2Fref/revisions');
    expect(requestBody(fetchImpl as unknown as ReturnType<typeof vi.fn>)).toEqual({
      expectedPreviousHash: 'a'.repeat(64),
      proposal,
    });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer bearer');
  });

  it('binds approval and launch to one immutable revision hash and idempotency key', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: {} });
    await decideProposalRevision('proposal-1', 3, {
      expectedHash: 'b'.repeat(64),
      expectedApprovalRevision: 0,
      decision: 'approved',
      idempotencyKey: 'decision-1',
    }, 'bearer', fetchImpl);
    expect(requestBody(fetchImpl as unknown as ReturnType<typeof vi.fn>)).toMatchObject({
      expectedHash: 'b'.repeat(64), expectedApprovalRevision: 0, idempotencyKey: 'decision-1',
    });

    const launchFetch = recordedFetch({ runRef: 'run-1' });
    await launchProposalRevision('proposal-1', 3, {
      expectedHash: 'b'.repeat(64), idempotencyKey: 'launch-1',
    }, 'bearer', launchFetch);
    expect(launchFetch).toHaveBeenCalledWith(
      '/api/control/proposals/proposal-1/revisions/3/launch',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(requestBody(launchFetch as unknown as ReturnType<typeof vi.fn>)).toEqual({
      expectedHash: 'b'.repeat(64), idempotencyKey: 'launch-1',
    });
  });
});

describe('control client run and retention writes', () => {
  it('resolves a review completion gate through its dedicated endpoint with no internal lineage refs', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: { request: { requestRef: 'request-1' } } });
    await resolveReviewCompletionGate('request/1', {
      expectedRequestRevision: 3, decision: 'changes-requested', idempotencyKey: 'human:request-1:3:changes-requested', response: 'Rework sources.',
    }, 'bearer', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/control/review-completion-gates/request%2F1/resolve', expect.objectContaining({ method: 'POST' }),
    );
    expect(requestBody(fetchImpl as unknown as ReturnType<typeof vi.fn>)).toEqual({
      expectedRequestRevision: 3, decision: 'changes-requested', idempotencyKey: 'human:request-1:3:changes-requested', response: 'Rework sources.',
    });
  });

  it('requests cursor replay without spawning a session', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: [] });
    await listRunEvents('run/ref', 41, 50, 'bearer', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/control/runs/run%2Fref/events?after=41&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('carries run version and manager generation when checkpoint steering', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: {} });
    await steerManagerAtCheckpoint('run-1', {
      expectedRunVersion: 7,
      expectedManagerGeneration: 2,
      idempotencyKey: 'steer-1',
      checkpoint: 'after-tests',
      instruction: 'Inspect the diff before continuing.',
    }, 'bearer', fetchImpl);
    expect(requestBody(fetchImpl as unknown as ReturnType<typeof vi.fn>)).toEqual({
      expectedRunVersion: 7,
      expectedManagerGeneration: 2,
      idempotencyKey: 'steer-1',
      checkpoint: 'after-tests',
      instruction: 'Inspect the diff before continuing.',
    });
  });

  it('creates a Manager recovery generation through a server-owned runtime profile', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: {} });
    await createManagerSuccessor('run-1', {
      expectedManagerGeneration: 2,
      runtime: 'claude',
      model: 'claude-opus-4-8',
      idempotencyKey: 'manager-successor-2',
    }, 'bearer', fetchImpl);
    expect(requestBody(fetchImpl as unknown as ReturnType<typeof vi.fn>)).toEqual({
      expectedManagerGeneration: 2,
      runtime: 'claude',
      model: 'claude-opus-4-8',
      idempotencyKey: 'manager-successor-2',
    });
  });

  it('binds a stage reroute to the exact stage and queued attempt versions', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: {} });
    await rerouteManagedStage('run/ref', 'stage/ref', {
      expectedStageVersion: 4,
      expectedAttemptRef: 'attempt/ref',
      expectedAttemptVersion: 2,
      runtime: 'claude',
      model: 'claude-sonnet-5',
      idempotencyKey: 'reroute-stage-4',
    }, 'bearer', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/control/runs/run%2Fref/stages/stage%2Fref/reroute',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(requestBody(fetchImpl as unknown as ReturnType<typeof vi.fn>)).toEqual({
      expectedStageVersion: 4,
      expectedAttemptRef: 'attempt/ref',
      expectedAttemptVersion: 2,
      runtime: 'claude',
      model: 'claude-sonnet-5',
      idempotencyKey: 'reroute-stage-4',
    });
  });

  it('binds a Human Request response to its current revision', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: {} });
    await respondToHumanRequest('request-1', {
      expectedRevision: 4,
      decision: 'changes-requested',
      idempotencyKey: 'response-1',
      response: 'Narrow the write scope.',
    }, 'bearer', fetchImpl);
    expect(requestBody(fetchImpl as unknown as ReturnType<typeof vi.fn>)).toMatchObject({
      expectedRevision: 4, decision: 'changes-requested', idempotencyKey: 'response-1',
    });
  });

  it('keeps an accepted Human Request successful when automatic runtime activation is intentionally gated', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, value: {
        run: {
          runRef: 'run-1', proposalRef: 'proposal-1', proposalRevision: 1, proposalHash: 'a'.repeat(64),
          publicationState: 'published', state: 'waiting-human', version: 5, managerGeneration: 1,
        },
        humanRequests: [{ kind: 'approval', state: 'resolved', response: { decision: 'approved' } }],
      } }))
      .mockResolvedValueOnce(response({ error: 'automatic-runtime-not-activated' }, 409)) as unknown as FetchLike;

    await expect(resumeRunAfterHumanResponse('run-1', 'bearer', fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/control/runs/run-1/activate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1]?.body))).toEqual({
      expectedRunVersion: 5,
      expectedManagerGeneration: 1,
      idempotencyKey: `activate:run-1:5:${'a'.repeat(64)}:1`,
    });
  });

  it('strictly activates one existing run and surfaces an inactive runtime', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ error: 'automatic-runtime-not-activated' }, 409)) as unknown as FetchLike;

    await expect(activateRun({
      runRef: 'run/ref',
      version: 5,
      managerGeneration: 1,
      proposalHash: 'proof',
    }, 'bearer', fetchImpl)).rejects.toMatchObject({
      reason: 'automatic-runtime-not-activated',
      status: 409,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/control/runs/run%2Fref/activate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          expectedRunVersion: 5,
          expectedManagerGeneration: 1,
          idempotencyKey: 'activate:run/ref:5:proof:1',
        }),
      }),
    );
  });

  it('does not swallow non-gate activation failures after a Human Request response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, value: {
        run: {
          runRef: 'run-1', proposalRef: 'proposal-1', proposalRevision: 1, proposalHash: 'a'.repeat(64),
          publicationState: 'published', state: 'waiting-human', version: 5, managerGeneration: 1,
        },
        humanRequests: [{ kind: 'intervention', state: 'resolved', response: { decision: 'responded' } }],
      } }))
      .mockResolvedValueOnce(response({ error: 'activation-state-changed' }, 409)) as unknown as FetchLike;

    await expect(resumeRunAfterHumanResponse('run-1', 'bearer', fetchImpl)).rejects.toMatchObject({
      reason: 'activation-state-changed',
      status: 409,
    });
  });

  it('separates dry-run inventory from exact-plan quarantine', async () => {
    const dryFetch = recordedFetch({ ok: true, value: {} });
    await dryRunQuarantine(['run-1'], 'bearer', dryFetch);
    expect(requestBody(dryFetch as unknown as ReturnType<typeof vi.fn>)).toEqual({ runRefs: ['run-1'] });

    const quarantineFetch = recordedFetch({ ok: true, value: [] });
    await quarantineRuns(['run-1'], 'c'.repeat(64), 'bearer', quarantineFetch);
    expect(requestBody(quarantineFetch as unknown as ReturnType<typeof vi.fn>)).toEqual({
      runRefs: ['run-1'], expectedPlanHash: 'c'.repeat(64),
    });
  });
});

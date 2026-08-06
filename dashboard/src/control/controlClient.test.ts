import { describe, expect, it, vi } from 'vitest';
import {
  activateRun,
  archiveRun,
  createProposalRevision,
  createManagerSuccessor,
  decideProposalRevision,
  dryRunQuarantine,
  getExecutionPosture,
  launchProposalRevision,
  listRunEvents,
  parseExecutionPosture,
  quarantineRuns,
  recoverAuthorized20260731ExecutionLock,
  reconcileAuthorizedFailedRun,
  AUTHORIZED_FAILED_RUN_PUBLISHED_UNCOMMITTED_CODE,
  isAuthorizedFailedRunPublishedUncommitted,
  rerouteManagedStage,
  resolveReviewCompletionGate,
  respondToHumanRequest,
  resumeRunAfterHumanResponse,
  steerManagerAtCheckpoint,
  unlockExecution,
  type FetchLike,
  type PlanProposalDto,
} from './controlClient';
import { SESSION_STORAGE_KEY } from '../lib/authClient';

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

const LOCKED_EXECUTION = {
  state: 'locked' as const,
  source: null,
  unlockedAt: null,
  unlockedBy: null,
  unlockRoute: '/api/control/execution/unlock',
};
const PASSKEY_EXECUTION = {
  state: 'unlocked' as const,
  source: 'passkey' as const,
  unlockedAt: '2026-07-31T21:00:00.000Z',
  unlockedBy: 'operator',
};

describe('control client execution unlock ceremony', () => {
  it('reads the authenticated execution posture with the bearer', async () => {
    const fetchImpl = recordedFetch({ execution: LOCKED_EXECUTION });
    await expect(getExecutionPosture('bearer', fetchImpl)).resolves.toEqual(LOCKED_EXECUTION);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/control/execution');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer bearer');
  });

  it('accepts a successful response without cloning it', async () => {
    const successful = response({ execution: LOCKED_EXECUTION });
    const clone = vi.spyOn(successful, 'clone').mockImplementation(() => {
      throw new Error('successful responses must not be cloned');
    });
    const fetchImpl = vi.fn(async () => successful) as unknown as FetchLike;

    await expect(getExecutionPosture('bearer', fetchImpl)).resolves.toEqual(LOCKED_EXECUTION);
    expect(clone).not.toHaveBeenCalled();
  });

  it('preserves the endpoint 401 when cloning that refusal throws', async () => {
    const denied = response({ error: 'unauthenticated', reason: 'expired' }, 401);
    const clone = vi.spyOn(denied, 'clone').mockImplementation(() => {
      throw new Error('broken response clone');
    });
    const fetchImpl = vi.fn(async () => denied) as unknown as FetchLike;

    await expect(getExecutionPosture('expired-bearer', fetchImpl)).rejects.toThrow(
      'control request refused: 401 (expired)',
    );
    expect(clone).toHaveBeenCalledTimes(1);
  });

  it('arms execution with the ONE session bearer: a single POST, no options fetch, no browser ceremony', async () => {
    const fetchImpl = vi.fn(async () => response({ ok: true, execution: PASSKEY_EXECUTION })) as unknown as FetchLike;

    await expect(unlockExecution('bearer', fetchImpl)).resolves.toEqual(PASSKEY_EXECUTION);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((call) => String(call[0]))).toEqual(['/api/control/execution/unlock']);
    // The mandate: ONE passkey ceremony for the platform. No purpose-bound options round trip, and no
    // re-authentication of any kind — the sign-in bearer is the whole authorization.
    expect(calls.some((call) => String(call[0]).includes('/unlock/options'))).toBe(false);
    expect(calls.some((call) => String(call[0]).includes('/api/auth/assert'))).toBe(false);
    expect(calls.some((call) => String(call[0]).includes('/launch'))).toBe(false);
    const init = calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({});
    expect(new Headers(init.headers as HeadersInit).get('authorization')).toBe('Bearer bearer');
  });

  it('rejects a 200 response unless the source is passkey', async () => {
    const fetchImpl = vi.fn(async () => response({
      ok: true, execution: { ...PASSKEY_EXECUTION, source: 'env-override' },
    })) as unknown as FetchLike;
    await expect(unlockExecution('bearer', fetchImpl)).rejects.toThrow(/not passkey-authorized/i);
  });

  it('rejects a 200 response that never confirmed the unlock', async () => {
    const fetchImpl = vi.fn(async () => response({ execution: PASSKEY_EXECUTION })) as unknown as FetchLike;
    await expect(unlockExecution('bearer', fetchImpl)).rejects.toThrow(/not passkey-authorized/i);
  });

  it.each([
    { ...LOCKED_EXECUTION, source: 'passkey' },
    { ...LOCKED_EXECUTION, unlockRoute: '/wrong-route' },
    { ...PASSKEY_EXECUTION, source: null },
    { ...PASSKEY_EXECUTION, unlockedAt: '1' },
    { ...PASSKEY_EXECUTION, unlockedBy: '   ' },
    { ...PASSKEY_EXECUTION, unlockRoute: '/api/control/execution/unlock' },
    { state: 'injected', source: 'env-override', unlockedAt: null, unlockedBy: null },
    { state: 'injected', source: null, unlockedAt: null, unlockedBy: null, unlockRoute: '/api/control/execution/unlock' },
  ])('rejects an impossible or non-canonical execution posture %#', (posture) => {
    expect(parseExecutionPosture(posture)).toBeNull();
  });

  it('accepts each exact server posture combination', () => {
    expect(parseExecutionPosture(LOCKED_EXECUTION)).toEqual(LOCKED_EXECUTION);
    expect(parseExecutionPosture(PASSKEY_EXECUTION)).toEqual(PASSKEY_EXECUTION);
    expect(parseExecutionPosture({
      ...PASSKEY_EXECUTION,
      source: 'env-override',
      unlockedBy: 'dashboard-engine',
    })).toMatchObject({ state: 'unlocked', source: 'env-override' });
    expect(parseExecutionPosture({
      state: 'injected', source: null, unlockedAt: null, unlockedBy: null,
    })).toEqual({ state: 'injected', source: null, unlockedAt: null, unlockedBy: null });
  });

  it.each([429, 503, 500])('NEVER erases the dashboard session on a non-401 refusal (%i)', async (status) => {
    // Defect 2: after the live 429 storm the operator had to sign in again. Throttling must never be
    // able to log anyone out — only a genuine 401 unauthenticated response may invalidate the session.
    const removeItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
      sessionStorage: { getItem: vi.fn(() => 'saved'), setItem: vi.fn(), removeItem },
      dispatchEvent,
    });
    const fetchImpl = vi.fn(async () => response({ error: 'locked-out', retryAfterMs: 60_000 }, status)) as unknown as FetchLike;
    await expect(unlockExecution('bearer', fetchImpl)).rejects.toThrow(String(status));
    expect(removeItem).not.toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    expect(dispatchEvent).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('a throttled GET poll leaves the session intact too', async () => {
    const removeItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
      sessionStorage: { getItem: vi.fn(() => 'saved'), setItem: vi.fn(), removeItem },
      dispatchEvent,
    });
    const fetchImpl = vi.fn(async () => response({ error: 'throttled', retryAfterMs: 1_000 }, 429)) as unknown as FetchLike;
    await expect(getExecutionPosture('bearer', fetchImpl)).rejects.toThrow('429');
    expect(removeItem).not.toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    expect(dispatchEvent).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('erases the dashboard session when the unlock POST reports an expired bearer', async () => {
    const removeItem = vi.fn();
    vi.stubGlobal('window', {
      sessionStorage: { getItem: vi.fn(() => 'saved'), setItem: vi.fn(), removeItem },
      dispatchEvent: vi.fn(),
    });
    const fetchImpl = vi.fn(async () => response({ error: 'unauthenticated', reason: 'expired' }, 401)) as unknown as FetchLike;
    await expect(unlockExecution('expired-bearer', fetchImpl)).rejects.toThrow(/401/);
    expect(removeItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    vi.unstubAllGlobals();
  });
});

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

  it('posts the exact authorized legacy execution-lock recovery CAS to its non-generic route', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: { request: {} } });
    await recoverAuthorized20260731ExecutionLock({
      expectedRunVersion: 4,
      expectedManagerGeneration: 1,
      expectedRequestRevision: 1,
      idempotencyKey: 'authorized-repair',
    }, 'bearer', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/control/recovery/2026-07-31/execution-lock',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(requestBody(fetchImpl as unknown as ReturnType<typeof vi.fn>)).toEqual({
      expectedRunVersion: 4,
      expectedManagerGeneration: 1,
      expectedRequestRevision: 1,
      idempotencyKey: 'authorized-repair',
    });
  });

  it('posts only the fixed historical reconciliation CAS to its dedicated route', async () => {
    const fetchImpl = recordedFetch({ ok: true, value: { run: { runRef: 'run-0aa72053-b9d7-41fa-a034-19871b66d214' } } });
    await reconcileAuthorizedFailedRun('bearer', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/control/recovery/2026-08-01/failed-run-reconciliation', expect.objectContaining({ method: 'POST' }),
    );
    expect(requestBody(fetchImpl as unknown as ReturnType<typeof vi.fn>)).toEqual({
      expectedRunVersion: 7,
      expectedManagerGeneration: 1,
      expectedRequestRevision: 2,
      expectedNextEventCursor: 6,
      expectedProposalHash: '396480363d02620c25730160e00fd7adf51e1eff43f8427c80b2062a18dc80d9',
      idempotencyKey: 'reconcile:2026-08-01:run-0aa72053-b9d7-41fa-a034-19871b66d214:failed-launch:v7',
    });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]))).not.toContain(
      '/api/control/proposals/proposal-3725fb98-e20e-4619-b6e7-c9055138a50d/revisions/1/launch',
    );
  });

  it('keeps the historical action on the normal session boundary when its bearer is no longer valid', async () => {
    const removeItem = vi.fn();
    vi.stubGlobal('window', {
      sessionStorage: { getItem: vi.fn(() => 'saved'), setItem: vi.fn(), removeItem },
      dispatchEvent: vi.fn(),
    });
    await expect(reconcileAuthorizedFailedRun(
      'expired-bearer',
      vi.fn(async () => response({ error: 'unauthenticated', reason: 'expired' }, 401)) as unknown as FetchLike,
    )).rejects.toThrow('control request refused: 401 (expired)');
    expect(removeItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    vi.unstubAllGlobals();
  });

  // A settlement that reached origin/ops but not the control-plane record is recoverable by
  // re-invoking. Collapsing it into "refused" would tell the operator the opposite of the truth.
  it('separates a published-but-unfinalized settlement from a genuine refusal', async () => {
    const published = await reconcileAuthorizedFailedRun('bearer', vi.fn(async () => response({
      error: AUTHORIZED_FAILED_RUN_PUBLISHED_UNCOMMITTED_CODE,
      detail: 'the settlement is published on origin/ops but its control-plane record is not final; re-invoke to finalize it',
    }, 409)) as unknown as FetchLike).catch((cause: unknown) => cause);
    expect(isAuthorizedFailedRunPublishedUncommitted(published)).toBe(true);

    const refused = await reconcileAuthorizedFailedRun('bearer', vi.fn(async () => response({
      error: 'authorized-failed-run-reconciliation-refused',
      detail: 'a required reconciliation safety proof did not hold',
    }, 409)) as unknown as FetchLike).catch((cause: unknown) => cause);
    expect(isAuthorizedFailedRunPublishedUncommitted(refused)).toBe(false);
    expect(isAuthorizedFailedRunPublishedUncommitted(new Error('unrelated'))).toBe(false);
  });

  it('keeps a durable Human Request response successful when the exact execution latch remains locked', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, value: {
        run: {
          runRef: 'run-1', proposalRef: 'proposal-1', proposalRevision: 1, proposalHash: 'a'.repeat(64),
          publicationState: 'published', state: 'waiting-human', version: 5, managerGeneration: 1,
        },
        humanRequests: [{ kind: 'intervention', state: 'resolved', response: { decision: 'responded' } }],
      } }))
      .mockResolvedValueOnce(response({
        error: 'execution-locked',
        detail: 'execution is locked; unlock it with your passkey before launching a run',
      }, 409)) as unknown as FetchLike;

    await expect(resumeRunAfterHumanResponse('run-1', 'bearer', fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
      code: 'automatic-runtime-not-activated',
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

describe('archiveRun', () => {
  it('POSTs to the run archive route with an identity-bound idempotency key and the reason', async () => {
    const fetchImpl = vi.fn(async () => response({
      ok: true, value: { run: { runRef: 'run-1', state: 'archived' }, resolvedRequests: [], pinnedRequestRefs: [] },
    })) as unknown as FetchLike;

    const result = await archiveRun({ runRef: 'run-1', version: 7 }, 'obsolete validation run', 'tok', fetchImpl);

    expect(result.run.state).toBe('archived');
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/control/runs/run-1/archive');
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('authorization')).toBe('Bearer tok');
    // Keyed on the run's identity AND version: a double-click replays instead of archiving twice.
    expect(JSON.parse(String(init.body))).toEqual({
      idempotencyKey: 'archive:run-1:7', reason: 'obsolete validation run',
    });
  });

  it('sends a null reason rather than an empty string when the operator typed nothing', async () => {
    const fetchImpl = vi.fn(async () => response({
      ok: true, value: { run: { runRef: 'run-1', state: 'archived' }, resolvedRequests: [], pinnedRequestRefs: [] },
    })) as unknown as FetchLike;
    await archiveRun({ runRef: 'run-1', version: 1 }, null, 'tok', fetchImpl);
    expect(JSON.parse(String((vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit])[1].body)).reason).toBeNull();
  });
});

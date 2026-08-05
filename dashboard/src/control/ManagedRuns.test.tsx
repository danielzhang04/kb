// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedRuns } from './ManagedRuns';
import {
  AUTHORIZED_FAILED_RUN_RECONCILIATION_EVENT_SIGNATURES,
  AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES,
  AUTHORIZED_FAILED_RUN_RECONCILIATION_SUMMARY,
  type RunMetadataDto,
} from './controlClient';
import { backStack, pushStack, rootStack, setSectionOnStack, type NavEntry } from '../nav/stack';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

/** The app's ONE unlock, driven from a test: a stored fresh bearer read by the provider on mount. */
function unlocked(ui: React.ReactElement, token = 'token-1'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

afterEach(() => {
  clearStoredSession();
  cleanup();
  vi.unstubAllGlobals();
});

const LONG_TITLE =
  'Rebuild the faceless video pipeline end to end and republish the audio stage against the reviewed proposal';

const runs: RunMetadataDto[] = [
  {
    runRef: 'run-1', predecessorRunRef: null, title: LONG_TITLE,
    displayName: LONG_TITLE, shortRef: 1, proposalRef: 'proposal-1',
    proposalRevision: 2, proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running',
    version: 4, managerSessionRef: 'session-manager', managerGeneration: 1, managerAssignment: null,
    createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T11:56:00.000Z',
    stageCount: 6, attemptCount: 11, sessionCount: 3, openHumanRequestCount: 0, eventCount: 340,
  },
  {
    runRef: 'run-2', predecessorRunRef: null, title: 'A second run',
    displayName: 'A second run', shortRef: 2, proposalRef: 'proposal-2',
    proposalRevision: 1, proposalHash: 'b'.repeat(64), publicationState: 'published', state: 'succeeded',
    version: 2, managerSessionRef: 'session-manager-2', managerGeneration: 1, managerAssignment: null,
    createdAt: '2026-07-18T09:00:00.000Z', updatedAt: '2026-07-18T09:30:00.000Z',
    stageCount: 2, attemptCount: 2, sessionCount: 1, openHumanRequestCount: 0, eventCount: 12,
  },
];

const detailFor = (runRef: string) => ({
  ok: true,
  value: {
    run: runs.find((item) => item.runRef === runRef),
    stages: [{
      stageRef: 'stage-1', runRef, stageId: 'compile', title: 'Compile proposal', dependsOn: [],
      canonicalCardRef: 'card-1', state: 'running', version: 2, currentAttemptRef: 'attempt-1',
      assignment: null,
      createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
    }],
    attempts: [{
      attemptRef: 'attempt-1', runRef, stageRef: 'stage-1', generation: 1, predecessorAttemptRef: null,
      runtime: 'codex', model: 'gpt-5.6-sol', state: 'running', version: 2,
      managedSessionRef: 'session-worker', createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:01:00.000Z',
    }],
    sessions: [],
    humanRequests: [],
  },
});

const HISTORICAL_RUN: RunMetadataDto = {
  runRef: 'run-0aa72053-b9d7-41fa-a034-19871b66d214', predecessorRunRef: null,
  title: 'Validate one all-Codex faceless-video opening slice',
  displayName: 'Validate one all-Codex faceless-video opening slice', shortRef: 3,
  proposalRef: 'proposal-3725fb98-e20e-4619-b6e7-c9055138a50d', proposalRevision: 1,
  proposalHash: '396480363d02620c25730160e00fd7adf51e1eff43f8427c80b2062a18dc80d9',
  publicationState: 'published', state: 'failed', version: 7,
  managerSessionRef: 'session-54ef91fa-6607-4f0e-a2f6-f9edd87873bb', managerGeneration: 1,
  managerAssignment: null, createdAt: '2026-08-01T02:04:03.640Z', updatedAt: '2026-08-01T03:32:49.635Z',
  stageCount: 13, attemptCount: 13, sessionCount: 14, openHumanRequestCount: 0, eventCount: 5,
};

function historicalDetail(settled = false) {
  const run = { ...HISTORICAL_RUN, version: settled ? 8 : 7, eventCount: settled ? 6 : 5 };
  const stages = AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES.map((expected, index) => ({
    stageRef: expected[1], runRef: run.runRef, stageId: expected[0],
    title: `Historical ${index}`, dependsOn: [...expected[7]],
    state: index === 0 ? 'failed' as const : 'blocked' as const, version: index === 0 ? 5 : 3,
    canonicalCardRef: expected[2], currentAttemptRef: expected[3], assignment: null,
    createdAt: run.createdAt, updatedAt: run.updatedAt,
  }));
  const attempts = stages.map((stage, index) => ({
    attemptRef: AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index]![3], runRef: run.runRef, stageRef: stage.stageRef, generation: 1,
    predecessorAttemptRef: null, runtime: AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index]![5], model: AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index]![6],
    state: index === 0 ? 'failed' as const : 'queued' as const, version: index === 0 ? 5 : 2,
    managedSessionRef: AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index]![4], createdAt: run.createdAt, updatedAt: run.updatedAt,
  }));
  const sessions = [
    {
      sessionRef: run.managerSessionRef, runRef: run.runRef, stageRef: null, attemptRef: null,
      role: 'manager' as const, generation: 1, predecessorSessionRef: null, runtime: 'codex', model: 'gpt-5.6-sol',
      state: 'interrupted' as const, version: 4, createdAt: run.createdAt, updatedAt: run.updatedAt,
    },
    ...stages.map((stage, index) => ({
      sessionRef: AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index]![4], runRef: run.runRef, stageRef: stage.stageRef,
      attemptRef: AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index]![3], role: 'worker' as const, generation: 1,
      predecessorSessionRef: null, runtime: AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index]![5], model: AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index]![6],
      state: index === 0 ? 'failed' as const : 'pending' as const, version: index === 0 ? 4 : 1,
      createdAt: run.createdAt, updatedAt: run.updatedAt,
    })),
  ];
  return {
    run, stages, attempts, sessions,
    humanRequests: [{
      requestRef: 'request-86d0fc5f-797b-483c-a706-96a45e6f4d6e', runRef: run.runRef, stageRef: null,
      kind: 'intervention' as const, revision: 2, state: 'resolved' as const,
      title: 'Automatic execution activation is gated', prompt: 'Canonical cards are published. Unlock execution with your passkey, mark this intervention responded, then resume this same run.',
      response: { requestRevision: 2, decision: 'responded' as const, response: null, respondedAt: '2026-08-01T03:32:43.921Z' },
      createdAt: '2026-08-01T02:04:04.762Z', updatedAt: '2026-08-01T03:32:43.921Z',
    }],
    reviewLoops: [], reviewReceipts: [],
  };
}

/** What the store appends when the settlement commits; its presence is the browser-side settled proof. */
const settlementEvent = {
  cursor: 6, runRef: HISTORICAL_RUN.runRef, kind: 'governance', source: 'human',
  stageRef: null, attemptRef: null, sessionRef: null, status: 'success',
  summary: AUTHORIZED_FAILED_RUN_RECONCILIATION_SUMMARY,
  command: null, toolName: null, path: null, diff: null, checkpoint: null,
  createdAt: '2026-08-01T09:00:00.000Z',
};

const historicalEvents = AUTHORIZED_FAILED_RUN_RECONCILIATION_EVENT_SIGNATURES.map((expected, index) => ({
  cursor: index + 1, runRef: HISTORICAL_RUN.runRef, kind: expected[0], source: expected[1],
  stageRef: expected[4], attemptRef: expected[5], sessionRef: expected[6], status: expected[2], summary: expected[3],
  command: null, toolName: null, path: null, diff: null, checkpoint: null,
  createdAt: expected[7],
}));

/** Route the control-plane reads this surface performs. */
function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = url.includes('/events')
      ? { ok: true, value: [] }
      : url.includes('/revisions/')
        ? { ok: true, value: { proposalRef: 'proposal-1', revision: 2, hash: 'a'.repeat(64), previousHash: null, title: 't', createdAt: '2026-07-18T10:00:00.000Z', approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [{ checkpoints: [{ id: 'after-tests', label: 'After tests' }] }] } } }
        : url.includes('/api/control/runs/')
          ? detailFor(url.split('/api/control/runs/')[1].split('?')[0])
          : { runs };
    return { ok: true, status: 200, json: async () => json } as Response;
  }));
}

/**
 * A harness mirroring exactly what App does with the nav stack, so back-navigation is exercised
 * through the real stack helpers rather than a stand-in.
 */
function Harness(): React.JSX.Element {
  const [stack, setStack] = useState<NavEntry[]>(() => rootStack('pipeline'));
  const entry = stack[stack.length - 1];
  return (
    <ManagedRuns
      runs={runs}
      focusRunRef={entry.focus?.kind === 'run' ? entry.focus.id : null}
      onOpenRun={(runRef) => setStack((s) => pushStack(s, { view: 'pipeline', focus: { kind: 'run', id: runRef } }))}
      onBackToRuns={() => setStack((s) => backStack(s))}
      activeSectionId={entry.section}
      onSectionChange={(id) => setStack((s) => setSectionOnStack(s, id))}
      now={Date.parse('2026-07-18T12:00:00.000Z')}
    />
  );
}

describe('ManagedRuns', () => {
  it('routes a focused reserved completion request to the dedicated resolver, never generic respond', async () => {
    const gate = {
      requestRef: 'gate-1', runRef: 'run-1', stageRef: 'stage-1', kind: 'approval', revision: 1, state: 'open',
      title: 'Review gate', prompt: 'Approve the checker result.', response: null,
      createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:00:00.000Z',
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.includes('/events')) return { ok: true, status: 200, json: async () => ({ ok: true, value: [] }) } as Response;
      if (url.includes('/revisions/')) return { ok: true, status: 200, json: async () => ({ ok: true, value: { proposalRef: 'proposal-1', revision: 2, hash: 'a'.repeat(64), previousHash: null, title: 't', createdAt: '2026-07-18T10:00:00.000Z', approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] } } }) } as Response;
      if (url === '/api/control/review-completion-gates/gate-1/resolve') return { ok: true, status: 200, json: async () => ({ ok: true, value: { request: { ...gate, state: 'resolved' } } }) } as Response;
      if (url.includes('/api/control/runs/run-1')) return { ok: true, status: 200, json: async () => ({ ok: true, value: {
        ...detailFor('run-1').value, humanRequests: [gate], reviewLoops: [],
        reviewReceipts: [{ reviewReceiptRef: 'receipt-1', runRef: 'run-1', reviewStageRef: 'stage-1', subjectStageRef: 'subject-1', state: 'awaiting-completion-gate', completionRequestRef: 'gate-1', interventionRequestRef: null, version: 2 }],
      } }) } as Response;
      return { ok: true, status: 200, json: async () => ({ runs }) } as Response;
    }));
    render(unlocked(<ManagedRuns runs={runs} focusRunRef="run-1" onOpenRun={vi.fn()} />));
    await screen.findByTestId('entity-detail-run');
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    await waitFor(() => expect(calls).toContain('/api/control/review-completion-gates/gate-1/resolve'));
    expect(calls).not.toContain('/api/control/human-requests/gate-1/respond');
  });

  it('surfaces the inactive gate, then resumes the same run without creating successors', async () => {
    const waitingRun = {
      ...runs[0],
      state: 'waiting-human' as const,
      version: 5,
      managerGeneration: 1,
    };
    const acceptedRequest = {
      requestRef: 'request-accepted',
      runRef: 'run-1',
      stageRef: 'stage-1',
      kind: 'intervention' as const,
      revision: 1,
      state: 'resolved' as const,
      title: 'Execution report',
      prompt: 'Review the execution report.',
      response: {
        decision: 'responded' as const,
        response: 'Accepted.',
        responder: 'operator',
        respondedAt: '2026-07-24T03:58:56.782Z',
      },
      createdAt: '2026-07-24T03:00:00.000Z',
      updatedAt: '2026-07-24T03:58:56.782Z',
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let activationAllowed = false;
    let resumed = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/events')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, value: [] }) } as Response;
      }
      if (url.includes('/revisions/')) {
        return { ok: true, status: 200, json: async () => ({
          ok: true,
          value: {
            proposalRef: 'proposal-1', revision: 2, hash: 'a'.repeat(64), previousHash: null,
            title: 't', createdAt: '2026-07-18T10:00:00.000Z', approval: null,
            sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] },
          },
        }) } as Response;
      }
      if (url === '/api/control/runs/run-1/activate') {
        if (!activationAllowed) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'automatic-runtime-not-activated' }),
          } as Response;
        }
        resumed = true;
        return { ok: true, status: 202, json: async () => ({ ok: true, value: waitingRun, starting: true }) } as Response;
      }
      if (url === '/api/control/runs/run-1') {
        return { ok: true, status: 200, json: async () => ({
          ok: true,
          value: {
            ...detailFor('run-1').value,
            run: resumed ? { ...waitingRun, state: 'recovering', version: 6 } : waitingRun,
            sessions: [{
              sessionRef: 'session-manager', runRef: 'run-1', stageRef: null, attemptRef: null,
              role: 'manager', generation: 1, predecessorSessionRef: null, runtime: 'claude',
              model: 'claude-opus-4-8', state: 'interrupted', version: 2,
              createdAt: '2026-07-24T03:00:00.000Z', updatedAt: '2026-07-24T03:30:00.000Z',
            }],
            humanRequests: [acceptedRequest],
          },
        }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ runs: [waitingRun, runs[1]] }) } as Response;
    }));

    render(unlocked(<ManagedRuns runs={[waitingRun, runs[1]]} focusRunRef="run-1" onOpenRun={vi.fn()} />));
    await screen.findByRole('button', { name: 'Resume run' });
    expect(screen.queryByRole('button', { name: 'Start successor Manager' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume run' }));

    expect((await screen.findByRole('alert')).textContent).toContain('automatic-runtime-not-activated');
    expect(screen.getByTestId('entity-detail-title').textContent).toBe(LONG_TITLE);
    activationAllowed = true;
    fireEvent.click(screen.getByRole('button', { name: 'Resume run' }));

    await waitFor(() => expect(calls.filter((call) => call.url === '/api/control/runs/run-1/activate')).toHaveLength(2));
    const activation = calls.filter((call) => call.url === '/api/control/runs/run-1/activate').at(-1)!;
    expect(JSON.parse(String(activation.init?.body))).toEqual({
      expectedRunVersion: 5,
      expectedManagerGeneration: 1,
      idempotencyKey: `activate:run-1:5:${'a'.repeat(64)}:1`,
    });
    expect(calls.some((call) => call.url.includes('/launch'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/successor'))).toBe(false);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume run' })).toBeNull());
  });

  it('offers the fixed historical reconciliation only for the exact pre-v8 run, refreshes it, and never chains Retry or activate', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let settled = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes('/events')) return { ok: true, status: 200, json: async () => ({
        ok: true, value: settled ? [...historicalEvents, settlementEvent] : historicalEvents,
      }) } as Response;
      if (url.includes('/revisions/')) return { ok: true, status: 200, json: async () => ({ ok: true, value: {
        proposalRef: HISTORICAL_RUN.proposalRef, revision: 1, hash: HISTORICAL_RUN.proposalHash, previousHash: null,
        title: 'historical', createdAt: HISTORICAL_RUN.createdAt, approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] },
      } }) } as Response;
      if (url === '/api/control/recovery/2026-08-01/failed-run-reconciliation') {
        settled = true;
        return { ok: true, status: 200, json: async () => ({ ok: true, value: { run: historicalDetail(true).run }, replayed: false }) } as Response;
      }
      if (url === `/api/control/runs/${HISTORICAL_RUN.runRef}`) return { ok: true, status: 200, json: async () => ({ ok: true, value: historicalDetail(settled) }) } as Response;
      if (url === '/api/control/runs') return { ok: true, status: 200, json: async () => ({ runs: [historicalDetail(settled).run] }) } as Response;
      return { ok: false, status: 500, json: async () => ({ error: 'unexpected' }) } as Response;
    }));

    render(unlocked(<ManagedRuns runs={[HISTORICAL_RUN]} focusRunRef={HISTORICAL_RUN.runRef} onOpenRun={vi.fn()} />));
    const action = await screen.findByRole('button', { name: 'Reconcile historical failed run' });
    expect(screen.getByRole('button', { name: 'Retry as successor' })).toHaveProperty('disabled', true);
    fireEvent.click(action);

    await waitFor(() => expect(calls.filter((call) => call.url === '/api/control/recovery/2026-08-01/failed-run-reconciliation')).toHaveLength(1));
    const reconciliation = calls.find((call) => call.url === '/api/control/recovery/2026-08-01/failed-run-reconciliation')!;
    expect(JSON.parse(String(reconciliation.init?.body))).toEqual({
      expectedRunVersion: 7, expectedManagerGeneration: 1, expectedRequestRevision: 2, expectedNextEventCursor: 6,
      expectedProposalHash: HISTORICAL_RUN.proposalHash,
      idempotencyKey: 'reconcile:2026-08-01:run-0aa72053-b9d7-41fa-a034-19871b66d214:failed-launch:v7',
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reconcile historical failed run' })).toBeNull());
    // The settled run is exactly the profile Retry accepts (terminal, everything stopped), and the
    // store refuses a successor for it — so the cockpit must state the refusal, not offer the click.
    await waitFor(() => expect(screen.getByTestId('run-retry-refusal').textContent).toContain('can never have a successor'));
    expect(screen.getByRole('button', { name: 'Retry as successor' })).toHaveProperty('disabled', true);
    expect(calls.some((call) => call.url.includes('/launch'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/activate'))).toBe(false);
  });

  it('reports a published-but-unfinalized settlement truthfully instead of as a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events')) return { ok: true, status: 200, json: async () => ({ ok: true, value: historicalEvents }) } as Response;
      if (url.includes('/revisions/')) return { ok: true, status: 200, json: async () => ({ ok: true, value: { proposalRef: HISTORICAL_RUN.proposalRef, revision: 1, hash: HISTORICAL_RUN.proposalHash, previousHash: null, title: 'historical', createdAt: HISTORICAL_RUN.createdAt, approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] } } }) } as Response;
      if (url === '/api/control/recovery/2026-08-01/failed-run-reconciliation') {
        return {
          ok: false, status: 409,
          json: async () => ({
            error: 'authorized-failed-run-reconciliation-published-uncommitted',
            detail: 'the settlement is published on origin/ops but its control-plane record is not final; re-invoke to finalize it',
          }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, value: historicalDetail() }) } as Response;
    }));

    render(unlocked(<ManagedRuns runs={[HISTORICAL_RUN]} focusRunRef={HISTORICAL_RUN.runRef} onOpenRun={vi.fn()} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Reconcile historical failed run' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('published on ops');
    expect(alert.textContent).not.toContain('refused');
  });

  it('does not expose the historical reconciliation for a near-match that is not exactly pre-v8', async () => {
    const almost = { ...HISTORICAL_RUN, version: 6 };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events')) return { ok: true, status: 200, json: async () => ({ ok: true, value: historicalEvents }) } as Response;
      if (url.includes('/revisions/')) return { ok: true, status: 200, json: async () => ({ ok: true, value: { proposalRef: almost.proposalRef, revision: 1, hash: almost.proposalHash, previousHash: null, title: 'historical', createdAt: almost.createdAt, approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] } } }) } as Response;
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { ...historicalDetail(), run: almost } }) } as Response;
    }));
    render(unlocked(<ManagedRuns runs={[almost]} focusRunRef={almost.runRef} onOpenRun={vi.fn()} />));
    await screen.findByTestId('entity-detail-run');
    expect(screen.queryByRole('button', { name: 'Reconcile historical failed run' })).toBeNull();
  });

  it('fails closed in the UI when an otherwise matching historical card or event signature drifts', async () => {
    const drifted = historicalDetail();
    drifted.stages[4] = { ...drifted.stages[4]!, canonicalCardRef: 'wrong-card' as never };
    const driftedEvents = historicalEvents.map((event) => ({ ...event }));
    driftedEvents[3] = { ...driftedEvents[3]!, summary: 'different failure' as never };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events')) return { ok: true, status: 200, json: async () => ({ ok: true, value: driftedEvents }) } as Response;
      if (url.includes('/revisions/')) return { ok: true, status: 200, json: async () => ({ ok: true, value: { proposalRef: HISTORICAL_RUN.proposalRef, revision: 1, hash: HISTORICAL_RUN.proposalHash, previousHash: null, title: 'historical', createdAt: HISTORICAL_RUN.createdAt, approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] } } }) } as Response;
      return { ok: true, status: 200, json: async () => ({ ok: true, value: drifted }) } as Response;
    }));
    render(unlocked(<ManagedRuns runs={[HISTORICAL_RUN]} focusRunRef={HISTORICAL_RUN.runRef} onOpenRun={vi.fn()} />));
    await screen.findByTestId('entity-detail-run');
    expect(screen.queryByRole('button', { name: 'Reconcile historical failed run' })).toBeNull();
  });

  it('hides reconciliation and restores normal Retry when the historical dependency graph drifts', async () => {
    const drifted = historicalDetail();
    drifted.stages[7] = { ...drifted.stages[7]!, dependsOn: ['slice-contract', 'shots-merge'] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events')) return { ok: true, status: 200, json: async () => ({ ok: true, value: historicalEvents }) } as Response;
      if (url.includes('/revisions/')) return { ok: true, status: 200, json: async () => ({ ok: true, value: { proposalRef: HISTORICAL_RUN.proposalRef, revision: 1, hash: HISTORICAL_RUN.proposalHash, previousHash: null, title: 'historical', createdAt: HISTORICAL_RUN.createdAt, approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] } } }) } as Response;
      return { ok: true, status: 200, json: async () => ({ ok: true, value: drifted }) } as Response;
    }));
    render(unlocked(<ManagedRuns runs={[HISTORICAL_RUN]} focusRunRef={HISTORICAL_RUN.runRef} onOpenRun={vi.fn()} />));
    await screen.findByTestId('entity-detail-run');
    expect(screen.queryByRole('button', { name: 'Reconcile historical failed run' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry as successor' })).toBeTruthy();
  });

  it('lands on the grid and shows every run title in full', () => {
    stubFetch();
    render(unlocked(<Harness />));

    expect(screen.getByTestId('run-grid')).toBeTruthy();
    // Titles render through EntityName (name + #ordinal), so `toContain` — the runRef is not text.
    expect(screen.getByTestId('run-card-run-1-title').textContent).toContain(LONG_TITLE);
    expect(screen.getByTestId('run-card-run-1-title').textContent).not.toContain('run-1');
    expect(screen.getByTestId('run-card-run-2-title').textContent).toContain('A second run');
    // The landing state is the list — no run detail is auto-opened.
    expect(screen.queryByTestId('entity-detail-run')).toBeNull();
  });

  it('opens a run detail on click and BACK RETURNS TO THE LIST', async () => {
    stubFetch();
    render(unlocked(<Harness />));

    fireEvent.click(screen.getByTestId('run-card-run-1'));

    const detail = await screen.findByTestId('entity-detail-run');
    expect(detail).toBeTruthy();
    expect(screen.getByTestId('entity-detail-title').textContent).toBe(LONG_TITLE);
    // Opening a run REPLACES the grid rather than appending a panel below it.
    expect(screen.queryByTestId('run-grid')).toBeNull();

    fireEvent.click(screen.getByTestId('entity-detail-back'));

    await waitFor(() => expect(screen.getByTestId('run-grid')).toBeTruthy());
    expect(screen.queryByTestId('entity-detail-run')).toBeNull();
    // Both runs are listed again, so back restored the list rather than a filtered remnant.
    expect(screen.getByTestId('run-card-run-1')).toBeTruthy();
    expect(screen.getByTestId('run-card-run-2')).toBeTruthy();
  });

  it('records the active section into the nav stack rather than component-local state', async () => {
    // The tab lives on the stack entry, which is what lets a deeper push and pop return the operator
    // to the tab they left (proven directly over the stack helpers in src/nav/stack.test.ts). Here the
    // point is that the SELECTION IS DRIVEN BY THE STACK: the harness feeds `activeSectionId` back in,
    // so if the write path were broken the tab would snap back to Overview.
    stubFetch();
    render(unlocked(<Harness />));

    fireEvent.click(screen.getByTestId('run-card-run-1'));
    await screen.findByTestId('entity-detail-run');

    fireEvent.click(screen.getByTestId('entity-tab-changes'));
    await waitFor(() =>
      expect(screen.getByTestId('entity-tab-changes').getAttribute('aria-selected')).toBe('true'),
    );
    expect(screen.getByTestId('entity-tab-overview').getAttribute('aria-selected')).toBe('false');

    // Re-entering a run after back is a FRESH push, so it correctly lands on the default tab again.
    fireEvent.click(screen.getByTestId('entity-detail-back'));
    await waitFor(() => expect(screen.getByTestId('run-grid')).toBeTruthy());

    fireEvent.click(screen.getByTestId('run-card-run-1'));
    await screen.findByTestId('entity-detail-run');
    expect(screen.getByTestId('entity-tab-overview').getAttribute('aria-selected')).toBe('true');
  });

  it('marks the open run in the grid after returning to it', async () => {
    stubFetch();
    render(unlocked(<Harness />));

    fireEvent.click(screen.getByTestId('run-card-run-2'));
    await screen.findByTestId('entity-detail-run');
    expect(screen.getByTestId('entity-detail-title').textContent).toBe('A second run');

    fireEvent.click(screen.getByTestId('entity-detail-back'));
    await waitFor(() => expect(screen.getByTestId('run-grid')).toBeTruthy());
  });

  it('has no unlock wall when locked — Refresh runs the one ceremony at point of action', async () => {
    stubFetch();
    const signIn = vi.fn(async () => ({ token: 'minted', expiresAt: Date.now() + 60_000 }));
    render(<SessionProvider deps={{ signIn }}><ManagedRuns /></SessionProvider>);

    expect(screen.queryByRole('button', { name: /unlock/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
  });
});

/* ============================================================================
 * THE INVARIANT
 *
 *   No governed action button may EVER be rendered against a run other than the one the nav stack is
 *   focused on.
 *
 * The bug this locks down: `detail` was never cleared when the focused run changed, and `loadRun` only
 * assigned it on success. So following a link to a run that no longer exists (retention prunes runs, and
 * the "Retried from run" link on a successor reaches a pruned predecessor) set an error banner and left
 * the PREVIOUS run's detail mounted — its title, its stages, and live `Stop run` / `Retry as successor`
 * buttons closing over the OLD `runRef`. The nav stack believed it was on run-ghost, the screen showed
 * run-1, and a Retry click would have launched a successor of the wrong run.
 * ========================================================================= */

/** Every governed mutation `RunCockpit` puts in its header. None may exist without a focused run. */
const GOVERNED_ACTIONS = ['Stop run', 'Resume run', 'Retry as successor'];

function expectNoGovernedActions(): void {
  for (const name of GOVERNED_ACTIONS) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
}

/** The non-ghost half of the fetch surface, shared by the stubs below. */
function okJsonFor(url: string): unknown {
  if (url.includes('/events')) return { ok: true, value: [] };
  if (url.includes('/revisions/')) {
    return { ok: true, value: { proposalRef: 'proposal-1', revision: 2, hash: 'a'.repeat(64), previousHash: null, title: 't', createdAt: '2026-07-18T10:00:00.000Z', approval: null, sourceComposerRef: 'c', sourceTurnId: 't', snapshot: { stages: [] } } };
  }
  if (url.includes('/api/control/runs/')) return detailFor(url.split('/api/control/runs/')[1].split('?')[0]);
  return { runs };
}

/** Starts focused on run-1 and offers a link to a run that no longer exists — the reviewer's scenario. */
function DeadLinkHarness(): React.JSX.Element {
  const [stack, setStack] = useState<NavEntry[]>(() =>
    pushStack(rootStack('pipeline'), { view: 'pipeline', focus: { kind: 'run', id: 'run-1' } }));
  const entry = stack[stack.length - 1];
  return (
    <>
      <button
        type="button"
        data-testid="follow-dead-link"
        onClick={() => setStack((s) => pushStack(s, { view: 'pipeline', focus: { kind: 'run', id: 'run-ghost' } }))}
      >
        follow dead link
      </button>
      <ManagedRuns
        runs={runs}
        focusRunRef={entry.focus?.kind === 'run' ? entry.focus.id : null}
        onOpenRun={(runRef) => setStack((s) => pushStack(s, { view: 'pipeline', focus: { kind: 'run', id: runRef } }))}
        onBackToRuns={() => setStack((s) => backStack(s))}
        now={Date.parse('2026-07-18T12:00:00.000Z')}
      />
    </>
  );
}

describe('ManagedRuns — a focused run that does not exist', () => {
  /** Like `stubFetch`, but `run-ghost` 404s the way a pruned run really does. */
  function stubFetchWithGhost(): void {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('run-ghost')) {
        return { ok: false, status: 404, json: async () => ({ ok: false, reason: 'run was not found' }) } as Response;
      }
      return { ok: true, status: 200, json: async () => okJsonFor(url) } as Response;
    }));
  }

  it('NEVER renders another run’s detail or governed actions when the focused run 404s', async () => {
    stubFetchWithGhost();
    render(unlocked(<DeadLinkHarness />));

    // Establish the precondition the bug needed: run-1 IS loaded, with a governed action live.
    await screen.findByTestId('entity-detail-run');
    expect(screen.getByTestId('entity-detail-title').textContent).toBe(LONG_TITLE);
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('follow-dead-link'));

    // THE INVARIANT: the stack is on run-ghost, so nothing belonging to run-1 may survive.
    await waitFor(() => expect(screen.getByTestId('run-not-found')).toBeTruthy());
    expect(screen.queryByTestId('entity-detail-run')).toBeNull();
    expect(screen.queryByText(LONG_TITLE)).toBeNull();
    expectNoGovernedActions();
  });

  it('names the missing run rather than showing a blank panel or the grid', async () => {
    stubFetchWithGhost();
    render(unlocked(<DeadLinkHarness />));
    await screen.findByTestId('entity-detail-run');
    fireEvent.click(screen.getByTestId('follow-dead-link'));

    await waitFor(() => expect(screen.getByTestId('run-not-found')).toBeTruthy());
    // The operator is told WHICH run is gone...
    expect(screen.getByTestId('run-not-found-ref').textContent).toBe('run-ghost');
    // ...is not silently dumped back on the grid, which would hide that the link was dead...
    expect(screen.queryByTestId('run-grid')).toBeNull();
    // ...but does get a way out.
    expect(screen.getByTestId('run-not-found-back')).toBeTruthy();
  });

  it('drops the previous detail the instant focus moves, before the next load resolves', async () => {
    // The 404 path is not the only way to strand the operator: ANY in-flight load leaves a window in
    // which a stale detail could still be mounted under the new run's nav entry. It must not be.
    const neverResolves = new Promise<never>(() => { /* deliberately pending forever */ });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('run-ghost')) return neverResolves;
      return { ok: true, status: 200, json: async () => okJsonFor(url) } as Response;
    }));

    render(unlocked(<DeadLinkHarness />));
    await screen.findByTestId('entity-detail-run');
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('follow-dead-link'));

    await waitFor(() => expect(screen.queryByTestId('entity-detail-run')).toBeNull());
    expectNoGovernedActions();
  });
});

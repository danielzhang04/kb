// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HumanRequestsPanel } from './HumanRequestsPanel';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

/** The app's ONE unlock, driven from a test: a stored fresh bearer read by the provider on mount. */
function unlocked(ui: React.ReactElement, token = 'token'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

afterEach(() => {
  cleanup();
  clearStoredSession();
});

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('HumanRequestsPanel', () => {
  it('loads one durable request through its run and commits a revision-bound response', async () => {
    let resolved = false;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const request = {
      requestRef: 'request-1', runRef: 'run-1', stageRef: null, kind: 'review', revision: 3, state: 'open',
      title: 'Review scope', prompt: 'Is this within scope?', response: null,
      createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:00:00.000Z',
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/control/runs') return response({ runs: resolved ? [] : [{ runRef: 'run-1', openHumanRequestCount: 1 }] });
      if (url === '/api/control/runs/run-1') return response({ ok: true, value: { run: {}, stages: [], attempts: [], sessions: [], humanRequests: [request] } });
      if (url === '/api/control/human-requests/request-1/respond') {
        resolved = true;
        return response({ ok: true, value: { ...request, state: 'resolved' } });
      }
      throw new Error(`unexpected ${url}`);
    });

    render(unlocked(<HumanRequestsPanel fetchImpl={fetchImpl as unknown as typeof fetch} />));
    expect(await screen.findByRole('heading', { name: 'Review scope' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'Narrow the write path.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));

    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/respond'))).toBe(true));
    const body = JSON.parse(calls.find((call) => call.url.endsWith('/respond'))!.init?.body as string);
    expect(body).toEqual({
      expectedRevision: 3,
      decision: 'changes-requested',
      idempotencyKey: 'human:request-1:3:changes-requested',
      response: 'Narrow the write path.',
    });
  });

  it('routes a reserved review completion gate only to its dedicated resolver', async () => {
    let resolved = false;
    const calls: string[] = [];
    const request = {
      requestRef: 'gate-1', runRef: 'run-gate', stageRef: 'check-1', kind: 'approval', revision: 1, state: 'open',
      title: 'Review gate', prompt: 'Approve the reviewed artifact?', response: null,
      createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:00:00.000Z',
    };
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/control/runs') return response({ runs: resolved ? [] : [{ runRef: 'run-gate', openHumanRequestCount: 1 }] });
      if (url === '/api/control/runs/run-gate') return response({ ok: true, value: {
        run: {}, stages: [], attempts: [], sessions: [], humanRequests: [request], reviewLoops: [],
        reviewReceipts: [{ reviewReceiptRef: 'receipt-1', runRef: 'run-gate', reviewStageRef: 'check-1', subjectStageRef: 'build-1', state: 'awaiting-completion-gate', completionRequestRef: 'gate-1', interventionRequestRef: null, version: 2 }],
      } });
      if (url === '/api/control/review-completion-gates/gate-1/resolve') {
        resolved = true;
        return response({ ok: true, value: { request: { ...request, state: 'resolved' } } });
      }
      throw new Error(`unexpected ${url}`);
    });
    render(unlocked(<HumanRequestsPanel fetchImpl={fetchImpl as unknown as typeof fetch} />));
    expect(await screen.findByRole('heading', { name: /Review completion gate/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    await waitFor(() => expect(calls).toContain('/api/control/review-completion-gates/gate-1/resolve'));
    expect(calls).not.toContain('/api/control/human-requests/gate-1/respond');
  });

  it('refreshes a durable responded intervention when automatic activation finds execution locked', async () => {
    let resolved = false;
    const calls: string[] = [];
    const run = {
      runRef: 'run-locked', proposalRef: 'proposal-1', proposalRevision: 1,
      proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'waiting-human',
      version: 5, managerGeneration: 1, title: 'Locked recovery',
    };
    const openRequest = {
      requestRef: 'request-locked', runRef: run.runRef, stageRef: null, kind: 'intervention',
      revision: 1, state: 'open', title: 'Automatic execution activation is gated',
      prompt: 'Unlock execution, then respond.', response: null,
      createdAt: '2026-07-31T10:00:00.000Z', updatedAt: '2026-07-31T10:00:00.000Z',
    };
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/control/runs') {
        return response({ runs: [{ ...run, openHumanRequestCount: resolved ? 0 : 1 }] });
      }
      if (url === `/api/control/runs/${run.runRef}`) {
        return response({ ok: true, value: {
          run, stages: [], attempts: [], sessions: [], reviewReceipts: [],
          humanRequests: [resolved ? {
            ...openRequest,
            state: 'resolved',
            response: { decision: 'responded', response: null, respondedAt: '2026-07-31T10:01:00.000Z' },
          } : openRequest],
        } });
      }
      if (url === `/api/control/human-requests/${openRequest.requestRef}/respond`) {
        resolved = true;
        return response({ ok: true, value: { ...openRequest, state: 'resolved', response: { decision: 'responded' } } });
      }
      if (url === `/api/control/runs/${run.runRef}/activate`) {
        return response({
          error: 'execution-locked',
          detail: 'execution is locked; unlock it with your passkey before launching a run',
        }, 409);
      }
      throw new Error(`unexpected ${url}`);
    });

    render(unlocked(<HumanRequestsPanel fetchImpl={fetchImpl as unknown as typeof fetch} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Responded' }));

    expect(await screen.findByRole('button', { name: 'Resume run' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls.filter((url) => url.endsWith('/activate'))).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: openRequest.title })).toBeNull();
  });

  it('surfaces a waiting-human run with NO open request as a distinct, non-actionable inspect row', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/control/runs') {
        return response({ runs: [{ runRef: 'run-parked', state: 'waiting-human', openHumanRequestCount: 0, title: 'Parked render' }] });
      }
      if (url === '/api/control/runs/run-parked') {
        return response({ ok: true, value: { run: {}, stages: [], attempts: [], sessions: [], humanRequests: [] } });
      }
      throw new Error(`unexpected ${url}`);
    });

    render(unlocked(<HumanRequestsPanel fetchImpl={fetchImpl as unknown as typeof fetch} />));

    const row = await screen.findByTestId('waiting-no-request-run-parked');
    expect(row.textContent).toMatch(/NO open request/i);
    expect(screen.getByTestId('inspect-run-run-parked').textContent).toMatch(/run-parked/);
    // Non-actionable: no approve/respond buttons for a request-less parked run.
    expect(screen.queryByRole('button', { name: /Approve|Respond|Request changes/i })).toBeNull();
    // The "nothing needs attention" empty note must NOT show when a stranded run is present.
    expect(screen.queryByText(/No managed run requests need attention/i)).toBeNull();
  });

  it('surfaces the inactive gate, then resumes a stranded run through the same exact action', async () => {
    const run = {
      runRef: 'run-resumable',
      proposalRef: 'proposal-1',
      proposalRevision: 1,
      proposalHash: 'a'.repeat(64),
      publicationState: 'published',
      state: 'waiting-human',
      version: 5,
      managerGeneration: 1,
      openHumanRequestCount: 0,
      title: 'Accepted execution report',
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let activationAllowed = false;
    let resumed = false;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/control/runs') {
        return response({ runs: [resumed ? { ...run, state: 'recovering' } : run] });
      }
      if (url === '/api/control/runs/run-resumable') {
        return response({ ok: true, value: {
          run,
          stages: [],
          attempts: [],
          sessions: [],
          humanRequests: [{
            requestRef: 'request-accepted',
            runRef: 'run-resumable',
            stageRef: null,
            kind: 'intervention',
            revision: 1,
            state: 'resolved',
            title: 'Execution report',
            prompt: 'Review the execution report.',
            response: {
              decision: 'responded',
              response: 'Accepted.',
              responder: 'operator',
              respondedAt: '2026-07-24T03:58:56.782Z',
            },
            createdAt: '2026-07-24T03:00:00.000Z',
            updatedAt: '2026-07-24T03:58:56.782Z',
          }],
        } });
      }
      if (url === '/api/control/runs/run-resumable/activate') {
        if (!activationAllowed) return response({ error: 'automatic-runtime-not-activated' }, 409);
        resumed = true;
        return response({ ok: true, value: run, starting: true }, 202);
      }
      throw new Error(`unexpected ${url}`);
    });

    render(unlocked(<HumanRequestsPanel fetchImpl={fetchImpl as unknown as typeof fetch} />));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume run' }));

    expect((await screen.findByRole('alert')).textContent).toContain('automatic-runtime-not-activated');
    activationAllowed = true;
    fireEvent.click(screen.getByRole('button', { name: 'Resume run' }));

    await waitFor(() => expect(calls.filter((call) => call.url.endsWith('/activate'))).toHaveLength(2));
    const activation = calls.filter((call) => call.url.endsWith('/activate')).at(-1)!;
    expect(JSON.parse(String(activation.init?.body))).toEqual({
      expectedRunVersion: 5,
      expectedManagerGeneration: 1,
      idempotencyKey: `activate:run-resumable:5:${'a'.repeat(64)}:1`,
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume run' })).toBeNull());
  });

  it('does not surface a waiting-human run that HAS an open request as a stranded row (it renders as a request)', async () => {
    const request = {
      requestRef: 'req-x', runRef: 'run-y', stageRef: null, kind: 'review', revision: 1, state: 'open',
      title: 'Approve me', prompt: 'ok?', response: null,
      createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:00:00.000Z',
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/control/runs') return response({ runs: [{ runRef: 'run-y', state: 'waiting-human', openHumanRequestCount: 1, title: 'Has request' }] });
      if (url === '/api/control/runs/run-y') return response({ ok: true, value: { run: {}, stages: [], attempts: [], sessions: [], humanRequests: [request] } });
      throw new Error(`unexpected ${url}`);
    });

    render(unlocked(<HumanRequestsPanel fetchImpl={fetchImpl as unknown as typeof fetch} />));
    expect(await screen.findByRole('heading', { name: 'Approve me' })).toBeTruthy();
    expect(screen.queryByTestId('waiting-no-request-run-y')).toBeNull();
  });

  it('shows the one exact legacy repair and only reclassifies then refreshes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let recovered = false;
    const run = {
      runRef: 'run-0aa72053-b9d7-41fa-a034-19871b66d214', proposalHash: 'a'.repeat(64),
      publicationState: 'published', state: 'waiting-human', version: 4, managerGeneration: 1,
      openHumanRequestCount: 1, title: 'Validate one all-Codex faceless-video opening slice',
    };
    const request = {
      requestRef: 'request-86d0fc5f-797b-483c-a706-96a45e6f4d6e', runRef: run.runRef, stageRef: null,
      kind: 'governance-refusal', revision: 1, state: 'open', title: 'Automatic execution activation is gated',
      prompt: 'Canonical cards are published, but the daemon Broker/execution adapters are not activated. Complete the separate runtime approval before release.',
      response: null, createdAt: '2026-08-01T02:04:04.762Z', updatedAt: '2026-08-01T02:04:04.762Z',
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/control/runs') return response({ runs: [run] });
      if (url === `/api/control/runs/${run.runRef}`) return response({ ok: true, value: {
        run, stages: [], attempts: [], sessions: [], reviewReceipts: [],
        humanRequests: [recovered ? {
          ...request, kind: 'intervention', revision: 2,
          prompt: 'Canonical cards are published. Unlock execution with your passkey, mark this intervention responded, then resume this same run.',
        } : request],
      } });
      if (url === '/api/control/recovery/2026-07-31/execution-lock') {
        recovered = true;
        return response({ ok: true, value: { request: { ...request, kind: 'intervention', revision: 2 } } });
      }
      throw new Error(`unexpected ${url}`);
    });
    render(unlocked(<HumanRequestsPanel fetchImpl={fetchImpl as unknown as typeof fetch} />));
    expect(screen.queryByLabelText('Response')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Repair execution-lock boundary' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Responded' })).toBeTruthy());
    const mutation = calls.find((call) => call.url === '/api/control/recovery/2026-07-31/execution-lock');
    expect(JSON.parse(String(mutation?.init?.body))).toEqual({
      expectedRunVersion: 4,
      expectedManagerGeneration: 1,
      expectedRequestRevision: 1,
      idempotencyKey: `legacy-execution-lock-recovery:${run.runRef}:${request.requestRef}:r1`,
    });
    expect(calls.some((call) => call.url.includes('/respond'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/activate'))).toBe(false);
  });

  it('does not expose the legacy repair when the exact run or manager generation CAS has drifted', async () => {
    for (const drift of [{ version: 5, managerGeneration: 1 }, { version: 4, managerGeneration: 2 }]) {
      const run = {
        runRef: 'run-0aa72053-b9d7-41fa-a034-19871b66d214', publicationState: 'published', state: 'waiting-human',
        ...drift, openHumanRequestCount: 1, title: 'Drifted legacy run',
      };
      const request = {
        requestRef: 'request-86d0fc5f-797b-483c-a706-96a45e6f4d6e', runRef: run.runRef, stageRef: null,
        kind: 'governance-refusal', revision: 1, state: 'open', title: 'Automatic execution activation is gated',
        prompt: 'Canonical cards are published, but the daemon Broker/execution adapters are not activated. Complete the separate runtime approval before release.',
        response: null, createdAt: '2026-08-01T02:04:04.762Z', updatedAt: '2026-08-01T02:04:04.762Z',
      };
      const fetchImpl = vi.fn(async (url: string) => {
        if (url === '/api/control/runs') return response({ runs: [run] });
        if (url === `/api/control/runs/${run.runRef}`) return response({ ok: true, value: {
          run, stages: [], attempts: [], sessions: [], reviewReceipts: [], humanRequests: [request],
        } });
        throw new Error(`unexpected ${url}`);
      });
      render(unlocked(<HumanRequestsPanel fetchImpl={fetchImpl as unknown as typeof fetch} />));
      await screen.findByRole('heading', { name: request.title });
      expect(screen.queryByRole('button', { name: 'Repair execution-lock boundary' })).toBeNull();
      cleanup();
    }
  });
});

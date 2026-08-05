// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Workflows } from './Workflows';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
/** The app's ONE unlock, driven from a test: a stored fresh bearer read by the provider on mount. */
function unlocked(ui: React.ReactElement, token = 'tok'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

afterEach(() => { cleanup(); clearStoredSession(); vi.unstubAllGlobals(); });

const definition = (over: Partial<{
  ref: string; project: string; path: string; sourceHash: string | null; valid: boolean; title: string | null; profile: string | null;
  parameters: string[];
  stageCount: number; riskTier: string | null; stages: Array<{ id: string; action: string; target: string; riskTier: string; governedBy?: string | null }>;
  governedBy: string | null;
  detail: string | null;
  pendingAmendment: { workflowPath: string; baseSourceHash: string; proposedSourceHash: string; branch: string; pr: { url?: string }; phase: string } | null;
}> = {}) => ({
  ref: 'research-brief', project: 'kb-ops', path: 'orgs/kb-ops/workflows/research-brief.md', valid: true,
  sourceHash: 'a'.repeat(64),
  title: 'Research brief (cited)', profile: 'research', parameters: [], stageCount: 1, riskTier: 'T2',
  stages: [{ id: 'brief', action: 'research:web-brief', target: 'orgs/kb-ops/output', riskTier: 'T2' }], detail: null,
  ...over,
});

describe('Workflows view', () => {
  it('renders an honest canonical empty state when no org definitions exist', () => {
    render(<SessionProvider><Workflows definitions={{ items: [] }} /></SessionProvider>);

    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    const empty = screen.getByTestId('workflows-empty');
    expect(within(empty).getByText('No org workflow definitions found')).toBeTruthy();
    expect(within(empty).getByText(/reusable staged DAG/i)).toBeTruthy();
    expect(within(empty).getByText(/compiles a valid definition into a governed run/i)).toBeTruthy();
    expect(screen.queryByText(/workflow-v1|No workflows registered yet/i)).toBeNull();
  });

  it('uses only the canonical org-definition list and exposes compact governor, per-agent, and unassigned counts', () => {
    render(<SessionProvider><Workflows definitions={{ items: [definition()] }} /></SessionProvider>);

    const section = screen.getByTestId('workflow-defs');
    expect(within(section).getByText('Research brief (cited)')).toBeTruthy();
    expect(within(section).getByText('research')).toBeTruthy();
    const summary = screen.getByTestId('workflow-governance-summary-research-brief');
    expect(summary.textContent).toContain('no workflow governor');
    expect(summary.textContent).toContain('unassigned: 1');
    expect(within(section).getByText('valid')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Launch' })).toBeTruthy();
    expect(screen.queryByText('Run now')).toBeNull();
  });

  it('uses one stable launch intent while pending and reports the honest activation-gated status', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<Workflows definitions={{ items: [definition()] }} />));

    const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    fireEvent.click(launch);
    fireEvent.click(launch);
    expect(launch.disabled).toBe(true);
    // The bearer is resolved through the shared session context, so the POST lands a microtask later.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    resolveResponse?.({
      ok: true, status: 202,
      json: async () => ({ ok: true, runRef: 'run-ref-9', activationGated: true, waitingHuman: true }),
    } as Response);
    expect(await screen.findByText(/Run created run-ref-9; execution awaits activation/)).toBeTruthy();
    await waitFor(() => expect(launch.disabled).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/workflows/research-brief/launch', expect.objectContaining({ method: 'POST' }));
    const launchCalls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const launchInit = launchCalls.find(([url]) => url === '/api/workflows/research-brief/launch')?.[1];
    expect(launchInit).toBeTruthy();
    const idempotencyKey = JSON.parse(launchInit!.body as string).idempotencyKey as string;
    expect(idempotencyKey).toMatch(/^workflow-launch:research-brief:/);
    expect(idempotencyKey.length).toBeLessThanOrEqual(512);
    expect(JSON.parse(launchInit!.body as string)).toMatchObject({ expectedSourceHash: 'a'.repeat(64), parameters: {} });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/write/workflow-runs', expect.anything());
  });

  it('collects declared video-run parameters and sends the exact closed source-addressed launch body', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ runRef: 'video-1', activationGated: true }) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<Workflows activeSectionId="overview" definitions={{ items: [definition({ ref: 'video-run', title: 'Video run', parameters: ['channel', 'slug'] })] }} />));
    fireEvent.click(screen.getByRole('button', { name: /open video run detail/i }));
    const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Workflow parameter channel'), { target: { value: 'the-second-take' } });
    fireEvent.change(screen.getByLabelText('Workflow parameter slug'), { target: { value: '2026-07-19-wells-fargo' } });
    expect(launch.disabled).toBe(false);
    fireEvent.click(launch);
    await screen.findByText(/Run created video-1/);
    const launchCall = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).find(([url]) => url === '/api/workflows/video-run/launch');
    expect(JSON.parse(launchCall![1].body as string)).toMatchObject({
      expectedSourceHash: 'a'.repeat(64), parameters: { channel: 'the-second-take', slug: '2026-07-19-wells-fargo' },
    });
  });

  it('keeps an assignment amendment visibly pending and blocks launch until a changed active source is supplied', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/workflows/research-brief') return { ok: true, status: 200, json: async () => ({ assignmentOptions: { manager: { options: [{ agentId: 'bound-manager', profileId: 'manager:claude:claude-opus-4-8' }], unavailable: null }, stages: { brief: { options: [], unavailable: 'Human binding required' } } } }) } as Response;
      if (url.endsWith('/assignment-amendments')) return { ok: true, status: 202, json: async () => ({ ok: true, status: 'pending-human-merge', baseSourceHash: 'a'.repeat(64), proposedSourceHash: 'b'.repeat(64), branch: 'codex/workflow-amendment', pr: { url: 'https://example.test/pull/7' } }) } as Response;
      throw new Error(`unexpected ${url} ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<Workflows activeSectionId="overview" definitions={{ items: [definition()] }} />));
    fireEvent.click(screen.getByRole('button', { name: /open research brief/i }));
    const assignment = await screen.findByRole('combobox', { name: 'Manager assignment' });
    fireEvent.change(assignment, { target: { value: '["bound-manager","manager:claude:claude-opus-4-8"]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Amend' }));
    expect((await screen.findByTestId('workflow-amendment-status')).textContent).toMatch(/Pending human merge/);
    expect(screen.getByRole('link', { name: 'Open pull request' }).getAttribute('href')).toBe('https://example.test/pull/7');
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(true);
    const amendmentCall = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).find(([url]) => url.endsWith('/assignment-amendments'));
    expect(JSON.parse(amendmentCall![1].body as string)).toEqual({ expectedSourceHash: 'a'.repeat(64), target: { kind: 'manager' }, assignment: { agentId: 'bound-manager', profileId: 'manager:claude:claude-opus-4-8' } });
  });

  it('renders persisted amendment phases truthfully rather than calling every state pending human merge', () => {
    render(<SessionProvider><Workflows activeSectionId="overview" definitions={{ items: [
      definition({ pendingAmendment: { workflowPath: 'orgs/kb-ops/workflows/research-brief.md', baseSourceHash: 'a'.repeat(64), proposedSourceHash: 'b'.repeat(64), branch: 'claude/m1-dashboard', pr: {}, phase: 'audit-pending' } }),
      definition({ ref: 'prepared', title: 'Prepared', path: 'orgs/kb-ops/workflows/prepared.md', pendingAmendment: { workflowPath: 'orgs/kb-ops/workflows/prepared.md', baseSourceHash: 'a'.repeat(64), proposedSourceHash: 'c'.repeat(64), branch: 'claude/m1-dashboard', pr: {}, phase: 'prepared' } }),
    ] }} /></SessionProvider>);
    expect(screen.getByTestId('workflow-def-research-brief').textContent).toMatch(/audit is still pending/i);
    expect(screen.getByTestId('workflow-def-prepared').textContent).toMatch(/recovery is required/i);
    fireEvent.click(screen.getByRole('button', { name: /open research brief/i }));
    expect(screen.getByTestId('workflow-amendment-status').textContent).toMatch(/audit is still pending/i);
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('re-enables after a failed intent and gives a retry a fresh idempotency key', async () => {
    const responses = [
      { ok: false, status: 409, json: async () => ({ error: 'definition-invalid', detail: 'definition changed' }) },
      { ok: true, status: 202, json: async () => ({ runRef: 'run-ref-10', activationGated: true }) },
    ] as Response[];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<Workflows definitions={{ items: [definition()] }} />));

    const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    fireEvent.click(launch);
    expect(await screen.findByText('Refused: definition changed')).toBeTruthy();
    await waitFor(() => expect(launch.disabled).toBe(false));

    fireEvent.click(launch);
    expect(await screen.findByText(/Run created run-ref-10; execution awaits activation/)).toBeTruthy();
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const keys = calls.map(([, init]) => JSON.parse(init.body as string).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^workflow-launch:research-brief:/);
    expect(keys[1]).toMatch(/^workflow-launch:research-brief:/);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('keeps ownership drops local, submits one batch, locks launch in flight, and reports a stale refusal', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    let resolveGovernance: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/workflows/research-brief') return Promise.resolve({ ok: true, status: 200, json: async () => ({
        governanceOptions: [{ id: 'writer', role: 'worker', description: null }],
        assignmentOptions: {
          manager: { options: [{ agentId: 'manager', profileId: 'manager:claude:test' }], unavailable: null },
          stages: { brief: { options: [{ agentId: 'writer', profileId: 'worker:claude:test' }], unavailable: null } },
        },
      }) } as Response);
      if (url.endsWith('/governance-amendments')) return new Promise<Response>((resolve) => { resolveGovernance = resolve; });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<Workflows definitions={{ items: [definition({ stages: [{ id: 'brief', action: 'research:web-brief', target: 'orgs/kb-ops/output', riskTier: 'T2' }] })] }} />));
    fireEvent.click(screen.getByRole('button', { name: /open research brief/i }));
    const governor = await screen.findByLabelText('Workflow governor');
    fireEvent.change(governor, { target: { value: 'writer' } });
    const submit = screen.getByRole('button', { name: 'Submit ownership plan' }) as HTMLButtonElement;
    fireEvent.click(submit);
    // The bearer is resolved through the shared session context, so the POST lands a microtask later.
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/governance-amendments'))).toHaveLength(1));
    expect(submit.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/assignment-amendments'))).toBe(false);
    fireEvent.click(screen.getByTestId('entity-tab-overview'));
    expect((screen.getByRole('combobox', { name: 'Manager assignment' }) as HTMLSelectElement).disabled).toBe(true);
    resolveGovernance?.({ ok: false, status: 409, json: async () => ({ status: 'stale-source', detail: 'definition source changed' }) } as Response);
    fireEvent.click(screen.getByTestId('entity-tab-agents'));
    expect((await screen.findByTestId('workflow-governance-status')).textContent).toContain('Refused: definition source changed');
  });
});

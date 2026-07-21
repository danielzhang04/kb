// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Workflows } from './Workflows';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const definition = (over: Partial<{
  ref: string; project: string; path: string; valid: boolean; title: string | null; profile: string | null;
  stageCount: number; riskTier: string | null; stages: Array<{ id: string; action: string; target: string; riskTier: string }>;
  detail: string | null;
}> = {}) => ({
  ref: 'research-brief', project: 'kb-ops', path: 'orgs/kb-ops/workflows/research-brief.md', valid: true,
  title: 'Research brief (cited)', profile: 'research', stageCount: 1, riskTier: 'T2',
  stages: [{ id: 'brief', action: 'research:web-brief', target: 'orgs/kb-ops/output', riskTier: 'T2' }], detail: null,
  ...over,
});

describe('Workflows view', () => {
  it('renders an honest canonical empty state when no org definitions exist', () => {
    render(<Workflows definitions={{ items: [] }} />);

    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    const empty = screen.getByTestId('workflows-empty');
    expect(within(empty).getByText('No org workflow definitions found')).toBeTruthy();
    expect(within(empty).getByText(/reusable staged DAG/i)).toBeTruthy();
    expect(within(empty).getByText(/compiles a valid definition into a governed run/i)).toBeTruthy();
    expect(screen.queryByText(/workflow-v1|No workflows registered yet/i)).toBeNull();
  });

  it('uses only the canonical org-definition list and exposes its stage preview', () => {
    render(<Workflows definitions={{ items: [definition()] }} />);

    const section = screen.getByTestId('workflow-defs');
    expect(within(section).getByText('Research brief (cited)')).toBeTruthy();
    expect(within(section).getByText('research')).toBeTruthy();
    expect(within(section).getByText(/research:web-brief → orgs\/kb-ops\/output/)).toBeTruthy();
    expect(within(section).getByText('valid')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Launch' })).toBeTruthy();
    expect(screen.queryByText('Run now')).toBeNull();
  });

  it('uses one stable launch intent while pending and reports the honest activation-gated status', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Workflows sessionToken="tok" definitions={{ items: [definition()] }} />);

    const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    fireEvent.click(launch);
    fireEvent.click(launch);
    expect(launch.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

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
    expect(fetchMock).not.toHaveBeenCalledWith('/api/write/workflow-runs', expect.anything());
  });

  it('re-enables after a failed intent and gives a retry a fresh idempotency key', async () => {
    const responses = [
      { ok: false, status: 409, json: async () => ({ error: 'definition-invalid', detail: 'definition changed' }) },
      { ok: true, status: 202, json: async () => ({ runRef: 'run-ref-10', activationGated: true }) },
    ] as Response[];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal('fetch', fetchMock);
    render(<Workflows sessionToken="tok" definitions={{ items: [definition()] }} />);

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
});

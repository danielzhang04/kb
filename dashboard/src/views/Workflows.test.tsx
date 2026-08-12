// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Workflows, isLiveRun, launchBlockReason } from './Workflows';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
import type { RunMetadataDto } from '../control/controlClient';

/** The app's ONE unlock, driven from a test: a stored fresh bearer read by the provider on mount. */
function unlocked(ui: React.ReactElement, token = 'tok'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); clearStoredSession(); vi.unstubAllGlobals(); });

const definition = (over: Partial<{
  ref: string; project: string; path: string; sourceHash: string | null; valid: boolean; title: string | null;
  profile: string | null; parameters: string[]; stageCount: number; riskTier: string | null;
  stages: Array<{ id: string; action: string; target: string; riskTier: string; declaredAssignment?: { agentId: string; profileId: string } | null }>;
  launchable: boolean; compileDetail: string | null;
  detail: string | null;
  pendingAmendment: { workflowPath: string; baseSourceHash: string; proposedSourceHash: string; branch: string; pr: { url?: string }; phase: string } | null;
}> = {}) => ({
  ref: 'research-brief', project: 'kb-ops', path: 'orgs/kb-ops/workflows/research-brief.md', valid: true,
  sourceHash: 'a'.repeat(64),
  // The server embeds the display identity; `displayName` is the workflow's title.
  displayName: over.title ?? 'Research brief (cited)', shortRef: 1,
  title: 'Research brief (cited)', profile: 'research', parameters: [], stageCount: 1, riskTier: 'T2',
  stages: [{ id: 'brief', action: 'research:web-brief', target: 'orgs/kb-ops/output', riskTier: 'T2' }], detail: null,
  ...over,
});

const run = (over: Partial<RunMetadataDto> & { runRef: string }): RunMetadataDto => ({
  ownerSubject: 'operator',
  predecessorRunRef: null,
  title: 'Research brief run',
  displayName: 'Research brief run',
  shortRef: 1,
  workflowRef: 'research-brief',
  proposalRef: 'wf-aaa',
  proposalRevision: 1,
  proposalHash: 'hash-a',
  publicationState: 'published',
  state: 'succeeded',
  version: 1,
  managerSessionRef: 'sess-m',
  managerGeneration: 0,
  managerAssignment: null,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: '2026-08-04T10:00:00.000Z',
  stageCount: 1,
  attemptCount: 1,
  sessionCount: 1,
  openHumanRequestCount: 0,
  eventCount: 4,
  ...over,
});

const NOW = Date.parse('2026-08-04T10:05:00.000Z');

describe('the workflows roster', () => {
  it('renders a calm empty state when no workflow is declared', () => {
    render(<SessionProvider><Workflows definitions={{ items: [] }} /></SessionProvider>);

    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    const empty = screen.getByTestId('workflows-empty');
    expect(within(empty).getByText('No workflows yet')).toBeTruthy();
    expect(within(empty).getByText(/declared under/i)).toBeTruthy();
  });

  it('keys a row on the workflow name and what its runs are doing, never a path or a governance dump', () => {
    render(<SessionProvider><Workflows
      definitions={{ items: [definition()] }}
      now={NOW}
      runs={[
        run({ runRef: 'run-1', state: 'succeeded', createdAt: '2026-08-04T08:00:00.000Z', updatedAt: '2026-08-04T09:00:00.000Z' }),
        run({ runRef: 'run-2', state: 'running', createdAt: '2026-08-04T10:02:00.000Z', updatedAt: '2026-08-04T10:03:00.000Z' }),
        run({ runRef: 'run-3', state: 'waiting-human', openHumanRequestCount: 2, createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T10:01:00.000Z' }),
      ]}
    /></SessionProvider>);

    const row = screen.getByTestId('workflow-def-research-brief');
    expect(within(row).getByText('Research brief (cited)')).toBeTruthy();
    expect(within(row).getByText('kb-ops')).toBeTruthy();
    // Latest run: state in plain words plus a relative time, keyed off `updatedAt`.
    const latest = screen.getByTestId('workflow-latest-research-brief');
    expect(latest.textContent).toContain('running');
    expect(latest.textContent).toContain('2m ago');
    const counts = screen.getByTestId('workflow-counts-research-brief');
    expect(counts.textContent).toContain('3');
    expect(counts.textContent).toContain('1 live');
    expect(counts.textContent).toContain('2 need you');

    // What the roster deliberately no longer carries.
    expect(row.textContent).not.toContain('orgs/kb-ops/workflows/research-brief.md');
    expect(row.textContent).not.toMatch(/governor|unassigned:/i);
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull();
    // The path survives only as a tooltip on the row.
    expect(screen.getByTestId('workflow-open-research-brief').getAttribute('title'))
      .toBe('orgs/kb-ops/workflows/research-brief.md');
  });

  it('says "not loaded" rather than "never run" while the tab is locked', () => {
    render(<SessionProvider><Workflows definitions={{ items: [definition()] }} /></SessionProvider>);
    expect(screen.getByTestId('workflow-latest-research-brief').textContent).toContain('not loaded');
  });

  it('says "never run" once the runs are loaded and there are none', () => {
    render(<SessionProvider><Workflows definitions={{ items: [definition()] }} runs={[]} /></SessionProvider>);
    expect(screen.getByTestId('workflow-latest-research-brief').textContent).toContain('never run');
  });

  it('flags a workflow that cannot run without hiding it', () => {
    render(<SessionProvider><Workflows definitions={{ items: [
      definition({ ref: 'broken', title: 'Broken', valid: false }),
    ] }} runs={[]} /></SessionProvider>);
    expect(screen.getByTestId('workflow-flag-broken').textContent).toContain('needs a fix');
  });

  it('collects runs no workflow owns under one Ad-hoc group', () => {
    const onOpenRun = vi.fn();
    render(<SessionProvider><Workflows
      definitions={{ items: [definition()] }}
      onOpenRun={onOpenRun}
      now={NOW}
      runs={[
        run({ runRef: 'run-1' }),
        run({ runRef: 'adhoc-1', workflowRef: null, displayName: 'Composer plan run' }),
        // A run whose workflow was deleted from `workflows/` is ad-hoc too — never unreachable.
        run({ runRef: 'orphan-1', workflowRef: 'deleted-workflow', displayName: 'Orphaned run' }),
      ]}
    /></SessionProvider>);

    const adhoc = screen.getByTestId('workflows-adhoc');
    expect(within(adhoc).getByText('Composer plan run')).toBeTruthy();
    expect(within(adhoc).getByText('Orphaned run')).toBeTruthy();
    expect(within(adhoc).queryByTestId('workflow-run-run-1')).toBeNull();

    fireEvent.click(screen.getByTestId('workflow-run-adhoc-1'));
    expect(onOpenRun).toHaveBeenCalledWith('adhoc-1');
  });

  it('classifies a run as live only while something is still moving it', () => {
    expect(isLiveRun(run({ runRef: 'r', state: 'running' }))).toBe(true);
    expect(isLiveRun(run({ runRef: 'r', state: 'recovering' }))).toBe(true);
    expect(isLiveRun(run({ runRef: 'r', state: 'succeeded' }))).toBe(false);
    // Waiting on a human is not "live work" — it is the operator's queue, counted separately.
    expect(isLiveRun(run({ runRef: 'r', state: 'waiting-human' }))).toBe(false);
  });
});

describe('launching from the workflow detail', () => {
  it('uses one stable launch intent while pending and reports the activation-gated outcome honestly', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/launch')) return new Promise<Response>((resolve) => { resolveResponse = resolve; });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<Workflows definitions={{ items: [definition()] }} focusWorkflowId="research-brief" onOpenWorkflow={vi.fn()} runs={[]} />));

    const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    fireEvent.click(launch);
    fireEvent.click(launch);
    // The bearer is resolved through the shared session context, so the POST lands a microtask later.
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/launch'))).toHaveLength(1));

    resolveResponse?.({
      ok: true, status: 202,
      json: async () => ({ ok: true, runRef: 'run-ref-9', activationGated: true }),
    } as Response);
    expect(await screen.findByText(/Run created run-ref-9; it starts once execution is unlocked/)).toBeTruthy();

    const launchInit = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)
      .find(([url]) => String(url).endsWith('/launch'))?.[1];
    const body = JSON.parse(launchInit!.body as string) as { idempotencyKey: string };
    expect(body.idempotencyKey).toMatch(/^workflow-launch:research-brief:/);
    expect(body.idempotencyKey.length).toBeLessThanOrEqual(512);
    expect(body).toMatchObject({ expectedSourceHash: 'a'.repeat(64), parameters: {} });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/write/workflow-runs', expect.anything());
  });

  it('collects declared parameters and sends the exact closed source-addressed body', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('/launch')
      ? { ok: true, status: 202, json: async () => ({ runRef: 'video-1' }) }
      : { ok: true, status: 200, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<Workflows definitions={{ items: [definition({ ref: 'video-run', title: 'Video run', parameters: ['channel', 'slug'] })] }} runs={[]} />));
    fireEvent.click(screen.getByRole('button', { name: /open video run/i }));

    const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Workflow parameter channel'), { target: { value: 'the-second-take' } });
    fireEvent.change(screen.getByLabelText('Workflow parameter slug'), { target: { value: '2026-07-19-wells-fargo' } });
    expect((screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));

    await screen.findByText(/Run created video-1/);
    const launchCall = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).find(([url]) => String(url).endsWith('/launch'));
    expect(JSON.parse(launchCall![1].body as string)).toMatchObject({
      expectedSourceHash: 'a'.repeat(64), parameters: { channel: 'the-second-take', slug: '2026-07-19-wells-fargo' },
    });
  });

  it('re-enables after a failed intent and gives a retry a fresh idempotency key', async () => {
    const responses = [
      { ok: false, status: 409, json: async () => ({ error: 'definition-invalid', detail: 'definition changed' }) },
      { ok: true, status: 202, json: async () => ({ runRef: 'run-ref-10' }) },
    ] as Response[];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('/launch')
      ? responses.shift()!
      : { ok: true, status: 200, json: async () => ({}) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<Workflows definitions={{ items: [definition()] }} focusWorkflowId="research-brief" onOpenWorkflow={vi.fn()} runs={[]} />));

    const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement;
    fireEvent.click(launch);
    expect(await screen.findByText('Refused: definition changed')).toBeTruthy();
    await waitFor(() => expect(launch.disabled).toBe(false));

    fireEvent.click(launch);
    expect(await screen.findByText(/Run created run-ref-10/)).toBeTruthy();

    const keys = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)
      .filter(([url]) => String(url).endsWith('/launch'))
      .map(([, init]) => (JSON.parse(init.body as string) as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe('editing who runs a step', () => {
  it('posts ONE governed assignment write per picker and says the workflow has not moved', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/workflows/research-brief') {
        return { ok: true, status: 200, json: async () => ({
          assignmentOptions: {
            manager: { options: [{ agentId: 'bound-manager', profileId: 'manager:claude:claude-opus-4-8' }], unavailable: null },
            stages: { brief: { options: [{ agentId: 'writer', profileId: 'worker:claude:test' }], unavailable: null } },
          },
        }) } as Response;
      }
      if (url.endsWith('/assignment-amendments')) {
        return { ok: true, status: 202, json: async () => ({
          ok: true, status: 'pending-human-merge', baseSourceHash: 'a'.repeat(64), proposedSourceHash: 'b'.repeat(64),
          branch: 'codex/workflow-amendment', pr: { url: 'https://example.test/pull/7' },
        }) } as Response;
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<Workflows
      definitions={{ items: [definition({ stages: [{ id: 'brief', action: 'research:web-brief', target: 'orgs/kb-ops/output', riskTier: 'T2' }] })] }}
      focusWorkflowId="research-brief"
      onOpenWorkflow={vi.fn()}
      runs={[]}
    />));

    // The eligible choices are a separate governed-adjacent read; the picker exists before they land.
    const picker = await screen.findByLabelText('Who runs research:web-brief');
    await waitFor(() => expect((picker as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(picker, { target: { value: JSON.stringify(['writer', 'worker:claude:test']) } });

    const status = await screen.findByTestId('workflow-assign-status');
    await waitFor(() => expect(status.textContent).toMatch(/Sent for review/));
    expect(status.textContent).toMatch(/still runs exactly as shown/);
    // No governor plan, no batch submit, no second write path.
    expect(screen.queryByRole('button', { name: /submit ownership plan/i })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/governance-amendments'))).toHaveLength(0);

    const call = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).find(([url]) => String(url).endsWith('/assignment-amendments'));
    expect(JSON.parse(call![1].body as string)).toEqual({
      expectedSourceHash: 'a'.repeat(64),
      target: { kind: 'stage', stageId: 'brief' },
      assignment: { agentId: 'writer', profileId: 'worker:claude:test' },
    });
  });
});

describe('launchBlockReason', () => {
  it('is null when nothing blocks the workflow', () => {
    expect(launchBlockReason(definition())).toBeNull();
  });

  it('names each pending phase truthfully, without the machinery own vocabulary', () => {
    const phase = (value: string) => launchBlockReason(definition({
      pendingAmendment: { workflowPath: 'p', baseSourceHash: 'a', proposedSourceHash: 'b', branch: 'br', pr: {}, phase: value },
    })) ?? '';
    expect(phase('pending-human-merge')).toMatch(/waiting for a human to review it/);
    expect(phase('audit-pending')).toMatch(/safety check is still running/);
    expect(phase('audit-failed')).toMatch(/failed its safety check/);
    expect(phase('prepared')).toMatch(/stopped part-way/);
    expect(phase('committed')).toMatch(/stopped part-way/);
    for (const value of ['pending-human-merge', 'audit-pending', 'audit-failed', 'prepared']) {
      expect(phase(value)).not.toMatch(/amendment|canonical|proposal revision/i);
    }
    expect(launchBlockReason(definition({ pendingAmendmentError: 'broken' } as never)) ?? '')
      .toMatch(/unreadable state/);
  });
});

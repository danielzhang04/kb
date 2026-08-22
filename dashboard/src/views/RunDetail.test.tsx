// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputRef } from '../../server/control/p2Contracts.ts';
import type { OperationalEventDto, RunDetailDto } from '../control/controlClient.ts';
import { SessionProvider } from '../lib/sessionContext.tsx';
import { clearStoredSession, persistSession } from '../lib/authClient.ts';
import { RunDetail } from './RunDetail.tsx';

vi.mock('../console/ConsolePane.tsx', () => ({
  ConsolePane: ({ target }: { target: { mode: string; sessionId?: string } }) => <section
    aria-label="Run terminal"
    data-testid="run-terminal"
    data-session-id={target.sessionId}
  />,
}));

afterEach(() => {
  cleanup();
  clearStoredSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function unlocked(ui: React.ReactElement): React.ReactElement {
  persistSession({ token: 'run-token', expiresAt: Date.now() + 60_000 });
  return <SessionProvider deps={{ fetchAuthContext: async () => ({ mode: 'win32-desktop' }) }}>{ui}</SessionProvider>;
}

function detail(overrides: Partial<RunDetailDto> = {}): RunDetailDto {
  return {
    ownerSubject: 'operator',
    run: {
      owner: { type: 'workflow', id: 'release', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/release.md' },
      executionHost: 'desktop', terminalOutcome: null, completedAt: null, archivedFrom: null,
      runRef: 'run-1', predecessorRunRef: null, title: 'Release dashboard', displayName: 'Release dashboard',
      shortRef: 1, workflowRef: 'release', proposalRef: 'proposal-1', proposalRevision: 1,
      proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running', version: 4,
      managerSessionRef: 'manager-1', managerGeneration: 1, managerAssignment: null,
      createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:01:00.000Z',
    },
    stages: [
      { stageRef: 'stage-research', runRef: 'run-1', stageId: 'research', title: 'Research', dependsOn: [], canonicalCardRef: 'card-research', state: 'succeeded', version: 2, currentAttemptRef: null, assignment: null, createdAt: '', updatedAt: '' },
      { stageRef: 'stage-write', runRef: 'run-1', stageId: 'write', title: 'Write', dependsOn: ['research'], canonicalCardRef: 'card-write', state: 'running', version: 2, currentAttemptRef: null, assignment: null, createdAt: '', updatedAt: '' },
    ],
    attempts: [], sessions: [], humanRequests: [], stageGenerations: [], generationSupersessions: [],
    iterationLoops: [], iterationRequests: [], iterationReceipts: [], ...overrides,
  };
}

function event(cursor: number, summary: string, stageRef: string | null): OperationalEventDto {
  return {
    cursor, runRef: 'run-1', kind: 'message', source: 'worker', stageRef,
    attemptRef: null, sessionRef: null, status: null, summary, command: null, toolName: null,
    path: null, diff: null, checkpoint: null, createdAt: `2026-08-21T00:00:0${cursor}.000Z`,
  };
}

const events = [event(1, 'research complete', 'stage-research'), event(2, 'drafting now', 'stage-write')];
const outputs: OutputRef[] = [
  { kind: 'repository-file', label: 'Report', path: 'reports/release.md' },
  { kind: 'external-pr', label: 'Pull request', owner: 'openai', repository: 'kb', number: 42 },
];

describe('Dashboard v3 Run view', () => {
  it('is one full-width stream plus one inspector and filters that same source by step', () => {
    render(unlocked(<RunDetail runRef="run-1" detail={detail()} events={events} outputs={outputs} />));
    expect(screen.getAllByTestId('run-stream')).toHaveLength(1);
    expect(screen.getAllByRole('complementary', { name: 'Run inspector' })).toHaveLength(1);
    expect(screen.queryByTestId('reactflow-mock')).toBeNull();
    expect(document.querySelector('.run-v3__body')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(1);
    expect(screen.getByText('research complete')).toBeTruthy();
    expect(screen.getByText('drafting now')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Write' }));
    expect(screen.queryByText('research complete')).toBeNull();
    expect(screen.getByText('drafting now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All steps' }));
    expect(screen.getByText('research complete')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse inspector' }));
    expect(screen.queryByRole('complementary', { name: 'Run inspector' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand inspector' }));
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('pages through nextCursor until more than 250 transcript events are fully replayed', async () => {
    const all = Array.from({ length: 301 }, (_, index) => event(index + 1, `event ${index + 1}`, null));
    const streamUrls: string[] = [];
    vi.stubGlobal('EventSource', class {
      constructor(url: string) { streamUrls.push(url); }
      addEventListener(): void { /* no-op */ }
      close(): void { /* no-op */ }
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://dashboard.test');
      const after = Number(url.searchParams.get('after'));
      const items = all.filter((item) => item.cursor > after).slice(0, 250);
      return new Response(JSON.stringify({
        revision: 'a'.repeat(64), items, nextCursor: after + items.length < all.length ? items.at(-1)!.cursor : null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    render(unlocked(<RunDetail runRef="run-1" detail={detail()} fetchImpl={fetchImpl} />));
    expect(await screen.findByText('event 301')).toBeTruthy();
    expect(fetchImpl.mock.calls.map(([input]) => new URL(String(input), 'https://dashboard.test').searchParams.get('after')))
      .toEqual(['0', '250']);
    await waitFor(() => expect(streamUrls).toEqual(['/api/control/runs/run-1/events/stream?after=301']));
  });

  it('renders a PTY session in the terminal pane and excludes the transcript stream', () => {
    const sources: unknown[] = [];
    vi.stubGlobal('EventSource', class {
      constructor() { sources.push(this); }
      addEventListener(): void { /* no-op */ }
      close(): void { /* no-op */ }
    });
    render(unlocked(<RunDetail
      runRef="run-1"
      detail={detail({ streamKind: 'pty', sessionId: 'pty-123' } as Partial<RunDetailDto>)}
      events={events}
    />));
    expect(screen.getByTestId('run-terminal').getAttribute('data-session-id')).toBe('pty-123');
    expect(screen.queryByTestId('run-stream')).toBeNull();
    expect(sources).toEqual([]);
  });

  it('keeps an ended run in the same layout with replay connection and no live actions', () => {
    const sources: unknown[] = [];
    vi.stubGlobal('EventSource', class {
      constructor() { sources.push(this); }
      addEventListener(): void { /* no-op */ }
      close(): void { /* no-op */ }
    });
    render(unlocked(<RunDetail
      runRef="run-1"
      detail={detail({ run: { ...detail().run, state: 'succeeded', terminalOutcome: 'ok' } })}
      events={events}
      connection="live"
    />));
    expect(screen.getByText('Replay')).toBeTruthy();
    expect(document.querySelector('.run-v3__body')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(sources).toEqual([]);
  });

  it('labels a non-advancing cursor replay as incomplete', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      revision: 'a'.repeat(64), items: [event(1, 'first only', null)], nextCursor: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(unlocked(<RunDetail runRef="run-1" detail={detail()} fetchImpl={fetchImpl} />));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Replay incomplete'));
  });

  it('detaches without stopping, reattaches, and preserves replayed rows while reconnecting', () => {
    const onDetach = vi.fn();
    const onReattach = vi.fn();
    render(unlocked(<RunDetail
      runRef="run-1" detail={detail()} events={events} connection="reconnecting"
      onDetach={onDetach} onReattach={onReattach}
    />));
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
    expect(screen.getByText('drafting now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Detach' }));
    expect(onDetach).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Reattach' })).toBeTruthy();
    expect(screen.getByText('drafting now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reattach' }));
    expect(onReattach).toHaveBeenCalledOnce();
  });

  it('offers copy only for a server-projected safe output link', async () => {
    const copyText = vi.fn(async () => undefined);
    render(unlocked(<RunDetail runRef="run-1" detail={detail()} events={events} outputs={outputs} copyText={copyText} />));
    expect(screen.queryByRole('button', { name: 'Copy Report link' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Pull request link' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('https://github.com/openai/kb/pull/42'));
  });

  it('refetches after a stop CAS conflict and retries with fresh version, generation, and key', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const fresh = detail({ run: { ...detail().run, version: 7, managerGeneration: 3 } });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/manager/stop')) {
        payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (payloads.length === 1) return new Response(JSON.stringify({ error: 'run-version-mismatch' }), {
          status: 409, headers: { 'content-type': 'application/json' },
        });
        return new Response(JSON.stringify({ ok: true, value: {
          state: 'stopping', stoppedSessionRefs: [], interruptedSessionRefs: [], replayed: false,
        } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/api/control/runs/run-1')) return new Response(JSON.stringify({ ok: true, value: fresh }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
      throw new Error(`unexpected request: ${url}`);
    });
    render(unlocked(<RunDetail runRef="run-1" detail={detail()} events={events} fetchImpl={fetchImpl} />));
    const details = screen.getByRole('button', { name: 'Details' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('button', { name: 'Stopping…' }).hasAttribute('disabled')).toBe(true);
    expect(details.hasAttribute('disabled')).toBe(false);
    await screen.findByText(/Stop failed:/);
    await waitFor(() => expect(fetchImpl.mock.calls.some(([input]) => String(input).endsWith('/api/control/runs/run-1'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Retry Stop' }));
    await waitFor(() => expect(payloads).toHaveLength(2));
    await screen.findByText('Stop confirmed');
    expect(payloads).toEqual([
      { expectedRunVersion: 4, expectedManagerGeneration: 1, idempotencyKey: 'manager-stop:run-1:4:1' },
      { expectedRunVersion: 7, expectedManagerGeneration: 3, idempotencyKey: 'manager-stop:run-1:7:3' },
    ]);
  });

  it('states request-less waiting as repair instead of fabricating a gate', () => {
    render(unlocked(<RunDetail
      runRef="run-1" detail={detail({ run: { ...detail().run, state: 'waiting-human' } })} events={events}
    />));
    expect(screen.getByText('Run is waiting without an open request. Repair required.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Respond' })).toBeNull();
  });
});

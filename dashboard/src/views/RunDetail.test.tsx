// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputRef } from '../../server/control/p2Contracts.ts';
import type { OperationalEventDto, RunDetailDto } from '../control/controlClient.ts';
import { SessionProvider } from '../lib/sessionContext.tsx';
import { clearStoredSession, persistSession } from '../lib/authClient.ts';
import { RunDetail } from './RunDetail.tsx';

// The pane itself is exercised by `ConsolePane.test.tsx`; here the mock records WHICH mount the Run
// view chose - live attach vs read-only replay, and whether a replay was handed a REST source.
vi.mock('../console/ConsolePane.tsx', () => ({
  ConsolePane: ({ target, replaySource }: { target: { mode: string; sessionId?: string }; replaySource?: unknown }) => <section
    aria-label="Run terminal"
    data-testid="run-terminal"
    data-session-id={target.sessionId}
    data-mode={target.mode}
    data-replay-source={replaySource ? 'rest' : 'none'}
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
  return <SessionProvider deps={{ fetchAuthContext: async () => ({ mode: 'win32-desktop' as const, ceremonyAvailable: true }) }}>{ui}</SessionProvider>;
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
      { stageRef: 'stage-research', runRef: 'run-1', stageId: 'research', title: 'Research', dependsOn: [], canonicalCardRef: 'card-research', state: 'succeeded', version: 2, currentAttemptRef: null, assignment: null, workflowProfile: null, review: null, completionGate: null, currentGeneration: 1, currentGenerationRef: null, acceptedGenerationRef: null, createdAt: '', updatedAt: '' },
      { stageRef: 'stage-write', runRef: 'run-1', stageId: 'write', title: 'Write', dependsOn: ['research'], canonicalCardRef: 'card-write', state: 'running', version: 2, currentAttemptRef: null, assignment: null, workflowProfile: null, review: null, completionGate: null, currentGeneration: 1, currentGenerationRef: null, acceptedGenerationRef: null, createdAt: '', updatedAt: '' },
    ],
    attempts: [], sessions: [], humanRequests: [], stageGenerations: [], generationSupersessions: [],
    iterationLoops: [], iterationRequests: [], iterationReceipts: [],
    // [C-M4] the Run console contract is REQUIRED on every detail: a transcript run carries no
    // selected session and an empty attempt list, and says so rather than omitting the keys.
    streamKind: 'transcript', sessionId: null, attemptSessions: [], ...overrides,
  };
}

function event(cursor: number, summary: string, stageRef: string | null): OperationalEventDto {
  return {
    cursor, runRef: 'run-1', kind: 'message', source: 'worker', stageRef,
    attemptRef: null, sessionRef: null, status: null, summary, command: null, toolName: null,
    path: null, diff: null, checkpoint: null, createdAt: `2026-08-21T00:00:0${cursor}.000Z`,
  };
}

function humanRequest(
  requestRef: string,
  kind: 'input' | 'approval',
  title: string,
): RunDetailDto['humanRequests'][number] {
  return {
    requestRef,
    runRef: 'run-1',
    displayName: 'Release dashboard',
    shortRef: 1,
    stageRef: 'stage-write',
    kind,
    state: 'open',
    title,
    prompt: `${title} prompt`,
    ask: `${title} ask`,
    technicalDetail: null,
    revision: 1,
    response: null,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  } as RunDetailDto['humanRequests'][number];
}

const events = [event(1, 'research complete', 'stage-research'), event(2, 'drafting now', 'stage-write')];
const outputs: OutputRef[] = [
  { kind: 'repository-file', label: 'Report', path: 'reports/release.md' },
  { kind: 'artifact', label: 'Fixture value', path: 'artifacts/ghp_fixture_secret_123' },
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

  // W47: the T3 Approve control follows the SERVER's `ceremonyAvailable` (from /api/auth/context), not
  // the auth mode. RED ON REVERT: put back `ceremonyAvailable={session.mode === 'win32-desktop'}` in
  // RunDetail.tsx and the tailnet+available case below fails - Approve stays disabled and the
  // "Passkey ceremony unavailable" notice stays rendered, which is exactly what parked the first VM
  // acceptance run at an approval gate nobody could clear.
  it.each([
    { mode: 'tailnet' as const, ceremonyAvailable: true, enabled: true },
    { mode: 'tailnet' as const, ceremonyAvailable: false, enabled: false },
    { mode: 'win32-desktop' as const, ceremonyAvailable: true, enabled: true },
    { mode: 'win32-desktop' as const, ceremonyAvailable: false, enabled: false },
  ])('W47: the T3 Approve control follows server ceremonyAvailable ($mode/$ceremonyAvailable)', async (probe) => {
    const t3 = humanRequest('request-t3', 'approval', 'Deployment approval');
    vi.stubGlobal('EventSource', class {
      addEventListener(): void { /* no-op */ }
      close(): void { /* no-op */ }
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/events?')) return new Response(JSON.stringify({
        revision: 'a'.repeat(64), items: events, nextCursor: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true, value: detail({ humanRequests: [t3] }) }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });

    persistSession({ token: 'run-token', expiresAt: Date.now() + 60_000 });
    render(<SessionProvider deps={{ fetchAuthContext: async () => ({ mode: probe.mode, ceremonyAvailable: probe.ceremonyAvailable }) }}>
      <RunDetail runRef="run-1" fetchImpl={fetchImpl} />
    </SessionProvider>);
    expect(await screen.findByText('Deployment approval')).toBeTruthy();
    await waitFor(() => {
      const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
      expect(approve.disabled).toBe(!probe.enabled);
    });
    expect(Boolean(screen.queryByText('Passkey ceremony unavailable'))).toBe(!probe.enabled);
  });

  it('lists two open gates in server order and leaves one run attention after resolving the ordinary gate', async () => {
    const t3 = humanRequest('request-t3', 'approval', 'Deployment approval');
    const ordinary = humanRequest('request-ordinary', 'input', 'Operator input');
    const initial = detail({ humanRequests: [t3, ordinary] });
    const resolved = detail({
      humanRequests: [t3, { ...ordinary, state: 'resolved', revision: 2 }],
    });
    let currentDetail = initial;
    vi.stubGlobal('EventSource', class {
      addEventListener(): void { /* no-op */ }
      close(): void { /* no-op */ }
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/events?')) return new Response(JSON.stringify({
        revision: 'a'.repeat(64), items: events, nextCursor: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/request-ordinary/respond') && init?.method === 'POST') {
        currentDetail = resolved;
        return new Response(JSON.stringify({ value: ordinary, replayed: false }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, value: currentDetail }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });

    persistSession({ token: 'run-token', expiresAt: Date.now() + 60_000 });
    render(<SessionProvider deps={{ fetchAuthContext: async () => ({ mode: 'tailnet' as const, ceremonyAvailable: false }) }}>
      <RunDetail runRef="run-1" fetchImpl={fetchImpl} />
    </SessionProvider>);
    expect(await screen.findByText('Deployment approval')).toBeTruthy();
    expect(screen.getByText('Operator input')).toBeTruthy();
    const controls = screen.getAllByRole('textbox', { name: 'Response' });
    expect(controls).toHaveLength(2);
    expect((controls[0] as HTMLTextAreaElement).disabled).toBe(true);
    expect((controls[1] as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByText('Passkey ceremony unavailable')).toBeTruthy();
    expect(Number(controls.length > 0)).toBe(1);

    fireEvent.change(controls[1], { target: { value: 'Continue.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Respond' }));

    await waitFor(() => expect(screen.queryByText('Operator input')).toBeNull());
    expect(screen.getByText('Deployment approval')).toBeTruthy();
    expect(screen.getAllByRole('textbox', { name: 'Response' })).toHaveLength(1);
    expect(Number(screen.queryAllByRole('textbox', { name: 'Response' }).length > 0)).toBe(1);
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

  it('shows the unavailable copy for a PTY run with no attempt row, and excludes the transcript stream', () => {
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
    // The server's managed-session fallback names a session with NO attempt binding: a live attach is
    // refused by the principal check and a replay has no row to read, so the pane says so instead of
    // opening a socket that will error. The transcript stream stays excluded either way.
    expect(screen.queryByTestId('run-terminal')).toBeNull();
    expect(screen.getByRole('status').textContent)
      .toContain('terminal output is no longer available');
    expect(screen.queryByTestId('run-stream')).toBeNull();
    expect(sources).toEqual([]);
  });

  it('mounts the running attempt live and an earlier attempt as REST-fed replay, naming neither raw id', () => {
    const attemptSessions: RunDetailDto['attemptSessions'] = [
      { attemptRef: 'attempt-1', sessionId: 'pty-old', launcher: 'codex', state: 'exited', startedAt: '2026-08-21T00:00:00.000Z',
        endedAt: '2026-08-21T00:05:00.000Z', exit: { exitCode: 2, reason: 'exited', observedAt: '2026-08-21T00:05:00.000Z' },
        controllerClaimed: false, liveControl: false },
      { attemptRef: 'attempt-2', sessionId: 'pty-live', launcher: 'claude', state: 'live', startedAt: '2026-08-21T00:06:00.000Z',
        endedAt: null, exit: null, controllerClaimed: false, liveControl: true },
    ];
    render(unlocked(<RunDetail
      runRef="run-1"
      detail={detail({ streamKind: 'pty', sessionId: 'pty-live', attemptSessions })}
      events={events}
    />));
    const live = screen.getByTestId('run-terminal');
    expect(live.getAttribute('data-mode')).toBe('attach');
    expect(live.getAttribute('data-session-id')).toBe('pty-live');
    expect(live.getAttribute('data-replay-source')).toBe('none');

    // Attempt rows are the server's order, labelled by position/launcher/outcome - never by a raw id.
    const attemptButtons = screen.getAllByRole('button', { pressed: false })
      .filter((button) => button.textContent?.startsWith('Attempt'));
    expect(attemptButtons.map((button) => button.textContent))
      .toEqual(['Attempt 1 \u00b7 Codex \u00b7 exit 2']);
    fireEvent.click(attemptButtons[0]!);
    const replay = screen.getByTestId('run-terminal');
    expect(replay.getAttribute('data-mode')).toBe('replay');
    expect(replay.getAttribute('data-session-id')).toBe('pty-old');
    expect(replay.getAttribute('data-replay-source')).toBe('rest');

    const rendered = screen.getByRole('main').textContent ?? '';
    for (const raw of ['attempt-1', 'attempt-2', 'pty-live', 'pty-old']) expect(rendered).not.toContain(raw);
    // A PTY attempt has one stream. No copy may offer a separate stderr or error log.
    expect(rendered.toLowerCase()).not.toContain('stderr');
    expect(rendered.toLowerCase()).not.toContain('error log');
  });

  it('says the run has no terminal session, with the Health next step, instead of mounting an empty console', () => {
    render(unlocked(<RunDetail
      runRef="run-1"
      detail={detail({ streamKind: 'pty', sessionId: null, attemptSessions: [] })}
      events={events}
    />));
    expect(screen.queryByTestId('run-terminal')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'This run has no terminal session. Terminal availability for this host is reported in Health.',
    );
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

  it('detaches locally without a request or run-version change, then reattaches', () => {
    const onDetach = vi.fn();
    const onReattach = vi.fn();
    const fetchImpl = vi.fn();
    const runDetail = detail();
    render(unlocked(<RunDetail
      runRef="run-1" detail={runDetail} events={events} connection="reconnecting"
      onDetach={onDetach} onReattach={onReattach} fetchImpl={fetchImpl}
    />));
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
    expect(screen.getByText('drafting now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Detach' }));
    expect(onDetach).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(runDetail.run.version).toBe(4);
    expect(screen.getByRole('button', { name: 'Reattach' })).toBeTruthy();
    expect(screen.getByText('drafting now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reattach' }));
    expect(onReattach).toHaveBeenCalledOnce();
  });

  it('offers copy only for a server-projected safe output link', async () => {
    const copyText = vi.fn(async () => undefined);
    render(unlocked(<RunDetail runRef="run-1" detail={detail()} events={events} outputs={outputs} copyText={copyText} />));
    expect(screen.queryByRole('button', { name: 'Copy Report link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy Fixture value link' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Pull request link' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('https://github.com/openai/kb/pull/42'));
    expect(copyText.mock.calls.flat().join('\n')).not.toContain('ghp_fixture_secret_123');
  });

  it('falls back to detail outputs without copying a secret-looking output', async () => {
    const copyText = vi.fn(async () => undefined);
    render(unlocked(<RunDetail runRef="run-1" detail={detail({ outputs })} events={events} copyText={copyText} />));

    expect(screen.getByRole('heading', { name: 'Output links' })).toBeTruthy();
    expect(screen.getByText('Pull request')).toBeTruthy();
    expect(screen.getByText('Fixture value')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy Fixture value link' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Pull request link' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('https://github.com/openai/kb/pull/42'));
    expect(copyText.mock.calls.flat().join('\n')).not.toContain('ghp_fixture_secret_123');
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

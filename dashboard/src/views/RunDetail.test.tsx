// @vitest-environment jsdom
/**
 * The run detail — the one surface for one execution.
 *
 * It absorbed the run canvas (stream tiles + two-way messaging), the cockpit (steps, attempts, the
 * activity trace, diffs, the governed mutations) and the whole-queue pipeline canvas (now a graph of
 * only THIS run's cards). Those suites' intents live here; nothing was dropped except the behaviour
 * that died with the surfaces themselves.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import {
  AgentStreams,
  AgentTile,
  RunDetail,
  RUN_POLL_MS,
  deriveAgentGraph,
  deriveAgentLanes,
  eventBelongsToAgent,
  runCardIds,
  scopeDagToRun,
  tileBadge,
  type AgentGraphEdge,
} from './RunDetail';
import type { Dag } from '../../server/dag/graph';
import type { OperationalEventDto, RunDetailDto } from '../control/controlClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

vi.mock('reactflow', async () => {
  const React = await import('react');
  type MockNode = { id: string; type: string; data: unknown };
  return {
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    ReactFlow: ({ nodes, edges, nodeTypes }: {
      nodes: MockNode[];
      edges: Array<{ id: string }>;
      nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
    }) => <div data-testid="reactflow-mock">
      {nodes.map((node) => {
        const Component = nodeTypes[node.type]!;
        return <div key={node.id}><Component data={node.data} /></div>;
      })}
      {edges.map((edge) => <div key={edge.id} data-testid={`reactflow-edge-${edge.id}`} />)}
    </div>,
  };
});

/** The app's ONE unlock, driven from a test: a stored fresh bearer read by the provider on mount. */
function unlocked(ui: React.ReactElement, token = 'tok'): React.ReactElement {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  clearStoredSession();
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function makeStage(stageId: string, agentId: string | null, over: Partial<RunDetailDto['stages'][number]> = {}) {
  return {
    stageRef: `ref-${stageId}`, runRef: 'run-1', stageId, title: stageId, dependsOn: [], canonicalCardRef: null,
    state: 'ready' as const, version: 1, currentAttemptRef: null,
    assignment: agentId
      ? { agentId, declarationPath: `agents/${agentId}.md`, declarationHash: 'h'.repeat(64), profileId: 'p', runtime: 'claude', model: 'fable-5' }
      : null,
    createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
    ...over,
  };
}

function makeDetail(over: Partial<RunDetailDto> = {}): RunDetailDto {
  return {
    run: {
      runRef: 'run-1', predecessorRunRef: null, title: 'headless run',
      displayName: 'headless run', shortRef: 1, workflowRef: 'kb~video.md', proposalRef: 'p-1', proposalRevision: 1,
      proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running', version: 1,
      managerSessionRef: 'session-mgr', managerGeneration: 1,
      managerAssignment: { agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'h'.repeat(64), profileId: 'p', runtime: 'claude', model: 'fable-5' },
      createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
      ...(over.run ?? {}),
    },
    stages: over.stages ?? [makeStage('idea', 'fyt-story'), makeStage('visual-plan', 'fyt-visuals', { dependsOn: ['idea'] })],
    attempts: over.attempts ?? [], sessions: over.sessions ?? [], humanRequests: over.humanRequests ?? [],
    reviewLoops: [], reviewReceipts: over.reviewReceipts ?? [],
  };
}

function event(overrides: Partial<OperationalEventDto> = {}): OperationalEventDto {
  return {
    cursor: 1, runRef: 'run-1', kind: 'message', source: 'worker', stageRef: 'ref-idea', attemptRef: 'attempt-1',
    sessionRef: 'session-1', status: 'running', summary: 'Story worker started', command: null, toolName: null,
    path: null, diff: null, checkpoint: null, createdAt: '2026-08-04T00:00:00.000Z', ...overrides,
  };
}

describe('agent graph', () => {
  it('keeps the manager first and derives cross-agent flow lanes', () => {
    const stage = (id: string, agentId: string, dependsOn: string[] = []) => ({ stageId: id, dependsOn, assignment: { agentId } });
    const { agentIds, edges } = deriveAgentGraph({
      run: { managerAssignment: { agentId: 'fyt-runner' } },
      stages: [
        stage('idea', 'fyt-story'),
        stage('story', 'fyt-story', ['idea']),
        stage('visual-plan', 'fyt-visuals', ['story']),
        stage('images', 'fyt-visuals', ['visual-plan']),
        stage('audio-render', 'fyt-audio-render', ['images']),
      ],
    });
    expect(agentIds).toEqual(['fyt-runner', 'fyt-story', 'fyt-visuals', 'fyt-audio-render']);
    expect(edges).toEqual([
      { from: 'fyt-story', to: 'fyt-visuals' },
      { from: 'fyt-visuals', to: 'fyt-audio-render' },
    ]);
    expect(deriveAgentLanes(agentIds, edges)).toEqual([
      ['fyt-runner', 'fyt-story'], ['fyt-visuals'], ['fyt-audio-render'],
    ]);
  });

  it('does not loop when handed a malformed cyclic graph', () => {
    const edges: AgentGraphEdge[] = [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }];
    expect(deriveAgentLanes(['x', 'y'], edges).flat().sort()).toEqual(['x', 'y']);
  });
});

describe('event ownership', () => {
  it('maps step events to their assigned tile and manager events to the manager tile', () => {
    const detail = makeDetail();
    expect(eventBelongsToAgent(event(), detail, 'fyt-story')).toBe(true);
    expect(eventBelongsToAgent(event(), detail, 'fyt-visuals')).toBe(false);
    expect(eventBelongsToAgent(event({ source: 'manager', stageRef: null, sessionRef: 'session-mgr' }), detail, 'fyt-runner')).toBe(true);
  });

  it('states what an agent is doing in plain words', () => {
    expect(tileBadge([event({ status: 'running', summary: 'drafting' })])).toEqual({ kind: 'active', text: 'working: drafting' });
    expect(tileBadge([event({ status: 'failure', summary: 'G1 refused' })])).toEqual({ kind: 'blocked', text: 'stuck: G1 refused' });
    expect(tileBadge([]).kind).toBe('idle');
  });
});

describe('AgentTile', () => {
  it('renders only the redacted events supplied for its agent', () => {
    render(unlocked(<AgentTile agentId="fyt-story" runRef="run-1" events={[event({ summary: 'Story-only public event' })]} />));
    expect(screen.getByTestId('run-tile-fyt-story-transcript').textContent).toContain('Story-only public event');
    expect(screen.queryByText('Visual-only public event')).toBeNull();
  });

  it('links a stuck tile to the Inbox', () => {
    const onNavigate = vi.fn();
    render(unlocked(<AgentTile agentId="fyt-story" runRef="run-1" events={[event({ status: 'failure', summary: 'G1 refused' })]} onNavigate={onNavigate} />));
    fireEvent.click(screen.getByTestId('run-tile-fyt-story-inbox-link'));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'approvals' });
  });

  it('posts an operator message and says when delivery is queued', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ delivery: 'queued' }), { status: 202 }));
    render(unlocked(<AgentTile agentId="fyt-story" runRef="run-1" events={[]} fetchImpl={fetchImpl as typeof fetch} />));
    fireEvent.change(screen.getByLabelText('Message fyt-story'), { target: { value: 'Please verify the draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('run-tile-fyt-story-delivery').textContent).toMatch(/queued for its next turn/i));
    expect(fetchImpl).toHaveBeenCalledWith('/api/control/runs/run-1/agents/fyt-story/messages', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ message: 'Please verify the draft.' }),
    }));
  });

  it('states the offline refusal instead of silently dropping a message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'agent-message-delivery-unavailable' }), { status: 409 }));
    render(unlocked(<AgentTile agentId="fyt-story" runRef="run-1" events={[]} fetchImpl={fetchImpl as typeof fetch} />));
    fireEvent.change(screen.getByLabelText('Message fyt-story'), { target: { value: 'Please verify the draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('run-tile-fyt-story-delivery').textContent).toMatch(/offline/i));
  });
});

describe('AgentStreams', () => {
  it('projects each public event into only its owning agent transcript', () => {
    render(unlocked(<AgentStreams detail={makeDetail()} events={[
      event({ summary: 'Story-only public event' }),
      event({ cursor: 2, stageRef: 'ref-visual-plan', summary: 'Visual-only public event' }),
    ]} />));
    expect(screen.getByTestId('run-tile-fyt-story-transcript').textContent).toContain('Story-only public event');
    expect(screen.getByTestId('run-tile-fyt-story-transcript').textContent).not.toContain('Visual-only public event');
    expect(screen.getByTestId('run-tile-fyt-visuals-transcript').textContent).toContain('Visual-only public event');
  });
});

describe('the run own card graph', () => {
  const dag: Dag = {
    nodes: [
      { id: 'card-a', type: 'card', position: { x: 0, y: 0 }, data: { id: 'card-a', displayName: 'Write it', shortRef: 1, state: 'working', blocked: false, summary: 'writing', dependsOn: [], owner: null, model: null, runtime: null, variantGroup: null, workflow: 'run-1' } },
      { id: 'card-b', type: 'card', position: { x: 0, y: 0 }, data: { id: 'card-b', displayName: 'Render it', shortRef: 2, state: 'blocked', blocked: true, summary: 'waiting', dependsOn: ['card-a'], owner: null, model: null, runtime: null, variantGroup: null, workflow: 'run-1' } },
      { id: 'card-z', type: 'card', position: { x: 0, y: 0 }, data: { id: 'card-z', displayName: 'Someone else work', shortRef: 3, state: 'done', blocked: false, summary: 'unrelated', dependsOn: [], owner: null, model: null, runtime: null, variantGroup: null, workflow: 'other-run' } },
    ] as unknown as Dag['nodes'],
    edges: [
      { id: 'card-a->card-b', source: 'card-a', target: 'card-b' },
      { id: 'card-z->card-b', source: 'card-z', target: 'card-b' },
    ] as unknown as Dag['edges'],
  };
  const detail = makeDetail({
    stages: [
      makeStage('write', 'fyt-story', { canonicalCardRef: 'card-a' }),
      makeStage('render', 'fyt-visuals', { canonicalCardRef: 'card-b' }),
      makeStage('pending', 'fyt-visuals'),
    ],
  });

  it('takes its card ids from the steps own canonical cards', () => {
    expect([...runCardIds(detail)].sort()).toEqual(['card-a', 'card-b']);
  });

  it('drops every card and edge that is not this run', () => {
    const scoped = scopeDagToRun(dag, runCardIds(detail));
    expect(scoped.nodes.map((node) => node.id)).toEqual(['card-a', 'card-b']);
    // An edge whose other end left the projection would render as a dangling arrow.
    expect(scoped.edges.map((edge) => edge.id)).toEqual(['card-a->card-b']);
  });

  it('renders the scoped graph inline and opens a card in Tasks', () => {
    const onNavigate = vi.fn();
    render(unlocked(<RunDetail runRef="run-1" detail={detail} events={[]} dag={dag} onNavigate={onNavigate} />));
    expect(screen.getByTestId('run-card-node-card-a')).toBeTruthy();
    expect(screen.queryByTestId('run-card-node-card-z')).toBeNull();
    fireEvent.click(screen.getByLabelText('Open Write it'));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'tasks', focus: { kind: 'card', id: 'card-a' } });
  });
});

describe('the run surface', () => {
  it('leads with steps, gates and agents, and keeps the engine record in one fold', () => {
    const detail = makeDetail({
      humanRequests: [{
        requestRef: 'req-1', runRef: 'run-1', stageRef: 'ref-idea', kind: 'approval', revision: 1, state: 'open',
        title: 'Approve the script', prompt: 'Read the draft and approve it.', response: null,
        ask: 'headless run needs your sign-off before it can go any further.',
        technicalDetail: 'Approve the script\n\nRead the draft and approve it.',
        displayName: 'headless run', shortRef: 1,
        createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
      }] as unknown as RunDetailDto['humanRequests'],
    });
    render(unlocked(<RunDetail runRef="run-1" detail={detail} events={[]} dag={{ nodes: [], edges: [] }} />));

    // ONE body — the four-tab cockpit is gone.
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByTestId('run-strip').textContent).toContain('idea');
    // spec §3b — the gate leads with the plain ask; the machine's own words are one fold below it.
    const gate = screen.getByTestId('run-gate-req-1');
    expect(gate.textContent).toContain('needs your sign-off');
    expect(gate.querySelector('h4')?.textContent).not.toContain('Read the draft and approve it.');
    expect(screen.getByTestId('run-gate-technical-req-1').textContent).toContain('Read the draft and approve it.');
    expect(screen.getByTestId('run-tile-fyt-story-transcript')).toBeTruthy();
    // Ids and hashes are real and reachable, just not what the surface leads with.
    expect(screen.getByTestId('run-technical').textContent).toContain('a'.repeat(64));
    expect(screen.getByTestId('entity-detail-status').textContent).toContain('running');
  });

  it('links back to the workflow that produced it, off the server grouping key', () => {
    const onNavigate = vi.fn();
    render(unlocked(<RunDetail runRef="run-1" detail={makeDetail()} events={[]} dag={{ nodes: [], edges: [] }} onNavigate={onNavigate} />));
    fireEvent.click(screen.getByTestId('entity-link-kb~video.md'));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'workflows', focus: { kind: 'workflow', id: 'kb~video.md' } });
  });

  it('renders the whole attempt chain per step, not just the current attempt', () => {
    const detail = makeDetail({
      stages: [makeStage('idea', 'fyt-story', { currentAttemptRef: 'att-2' })],
      attempts: [
        { attemptRef: 'att-1', runRef: 'run-1', stageRef: 'ref-idea', generation: 1, predecessorAttemptRef: null, runtime: 'claude', model: 'fable-5', state: 'failed', version: 1, managedSessionRef: null, createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:01:00.000Z' },
        { attemptRef: 'att-2', runRef: 'run-1', stageRef: 'ref-idea', generation: 2, predecessorAttemptRef: 'att-1', runtime: 'claude', model: 'fable-5', state: 'running', version: 1, managedSessionRef: null, createdAt: '2026-08-04T00:02:00.000Z', updatedAt: '2026-08-04T00:03:00.000Z' },
      ],
    });
    render(unlocked(<RunDetail runRef="run-1" detail={detail} events={[]} dag={{ nodes: [], edges: [] }} />));
    // Retries are the interesting part; only `currentAttemptRef` used to be read.
    expect(screen.getByTestId('run-attempt-att-1')).toBeTruthy();
    expect(screen.getByTestId('run-attempt-att-2').textContent).toContain('current');
  });

  it('renders a diff and marks the ones the 64KB cap cut short', () => {
    const events = [
      event({ cursor: 5, kind: 'file', path: 'src/a.ts', diff: '--- a\n+++ b\n' }),
      event({ cursor: 6, kind: 'file', path: 'src/b.ts', diff: 'x'.repeat(64 * 1024) }),
    ];
    render(unlocked(<RunDetail runRef="run-1" detail={makeDetail()} events={events} dag={{ nodes: [], edges: [] }} />));
    expect(screen.getByTestId('run-change-5-diff').textContent).toContain('+++ b');
    expect(screen.getByTestId('run-change-6-truncated')).toBeTruthy();
  });

  it('says out loud when the visible trace is not the newest part of the run', () => {
    render(unlocked(<RunDetail
      runRef="run-1"
      detail={makeDetail()}
      events={[event()]}
      eventWindow={{ events: [event()], seen: 51_000, complete: false }}
      dag={{ nodes: [], edges: [] }}
    />));
    // An interior slice presented as "most recent" would be a lie; it is stated instead.
    expect(screen.getByTestId('run-activity-window-note').textContent).toMatch(/from the middle/i);
  });

  it('states a standing retry refusal in the row rather than hiding the action', () => {
    const settledDetail = makeDetail({
      run: { runRef: 'run-2618359c-3a5c-4b47-9d2a-73a67a1f8f2f', state: 'failed' } as RunDetailDto['run'],
    });
    render(unlocked(<RunDetail runRef="run-1" detail={settledDetail} events={[]} dag={{ nodes: [], edges: [] }} />));
    // Rendered-disabled, never conditionally rendered.
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it('names a run the control plane has never heard of instead of showing a blank surface', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'not-found' }), { status: 404 }));
    render(unlocked(<RunDetail runRef="run-gone" fetchImpl={fetchImpl as typeof fetch} />));
    expect((await screen.findByTestId('run-not-found-ref')).textContent).toBe('run-gone');
  });

  it('says what it needs rather than parking a sign-in wall when the tab is locked', () => {
    render(<SessionProvider><RunDetail runRef="run-1" /></SessionProvider>);
    expect(screen.getByTestId('run-loading').textContent).toMatch(/unlock the dashboard/i);
  });
});

describe('the live poller', () => {
  it('serves every tile from ONE event request and keeps per-agent filtering', async () => {
    vi.useFakeTimers();
    const detail = makeDetail({
      run: { ...makeDetail().run, managerAssignment: null },
      stages: ['agent-a', 'agent-b', 'agent-c', 'agent-d', 'agent-e'].map((agentId, index) => makeStage(`stage-${index}`, agentId)),
    });
    const events = detail.stages.map((stage, index) => event({
      cursor: index + 1, stageRef: stage.stageRef, summary: `${stage.assignment?.agentId} public event`,
    }));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/events?')) return new Response(JSON.stringify({ ok: true, value: events }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, value: detail }), { status: 200 });
    });
    const eventRequests = (): number => fetchImpl.mock.calls.filter(([url]) => typeof url === 'string' && url.includes('/events?')).length;

    render(unlocked(<RunDetail runRef="run-1" dag={{ nodes: [], edges: [] }} fetchImpl={fetchImpl as typeof fetch} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(eventRequests()).toBe(1);
    for (const agentId of ['agent-a', 'agent-b', 'agent-c', 'agent-d', 'agent-e']) {
      expect(screen.getByTestId(`run-tile-${agentId}-transcript`).textContent).toContain(`${agentId} public event`);
    }
    expect(screen.getByTestId('run-tile-agent-a-transcript').textContent).not.toContain('agent-b public event');

    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_POLL_MS); });
    expect(eventRequests()).toBe(2);
  });

  it('backs off after a 429 and restores the five-second cadence on recovery', async () => {
    vi.useFakeTimers();
    const detail = makeDetail();
    let eventRequests = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/events?')) {
        eventRequests += 1;
        // The first request is the initial load; the 429 lands on the first POLL.
        if (eventRequests === 2) return new Response(JSON.stringify({ error: 'locked-out' }), { status: 429 });
        return new Response(JSON.stringify({ ok: true, value: [event({ summary: 'Recovered event poll' })] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, value: detail }), { status: 200 });
    });

    render(unlocked(<RunDetail runRef="run-1" dag={{ nodes: [], edges: [] }} fetchImpl={fetchImpl as typeof fetch} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(eventRequests).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_POLL_MS); });
    expect(eventRequests).toBe(2);
    expect(screen.getByTestId('run-rate-limit').textContent).toMatch(/backing off.*10s/i);

    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_POLL_MS); });
    expect(eventRequests).toBe(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_POLL_MS); });
    expect(eventRequests).toBe(3);
    expect(screen.queryByTestId('run-rate-limit')).toBeNull();
  });
});

describe('headless-only import boundary', () => {
  it('has no terminal or WebSocket import in the run-detail module', () => {
    const source = readFileSync('src/views/RunDetail.tsx', 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/Terminal['"]/);
    expect(source).not.toMatch(/@xterm/);
  });
});

/**
 * spec §3b — dismissing a dead run from its own surface.
 *
 * The action is offered only once the run is over or parked (a live run is stopped on its own path
 * first), it carries the operator's reason into the governed write, and it is idempotent by
 * construction: the key is built from the run's identity + version, so a double-click cannot archive
 * twice or diverge.
 */
describe('the archive action', () => {
  /**
   * Route-aware, like every other fetch mock in this suite.
   *
   * `govern` RELOADS the run after any governed write, so a mock that answered every URL with the
   * archive body would feed the archive result back in as the run detail — a shape with no
   * stages/sessions/humanRequests. The component is right to assume those arrays (the server always
   * sends them); the mock has to answer each route with what that route actually returns.
   */
  function archiveFetch(detail: RunDetailDto) {
    const archived: RunDetailDto = { ...detail, run: { ...detail.run, state: 'archived' } };
    return vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).endsWith('/archive')) {
        return new Response(
          JSON.stringify({ ok: true, value: { run: archived.run, resolvedRequests: [], pinnedRequestRefs: [] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (String(url).includes('/events?')) {
        return new Response(JSON.stringify({ ok: true, value: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, value: archived }), { status: 200 });
    });
  }

  it('archives a parked run with the typed reason and an identity-bound idempotency key', async () => {
    const detail = makeDetail({ run: { state: 'waiting-human', version: 4 } as RunDetailDto['run'] });
    const fetchImpl = archiveFetch(detail);
    render(unlocked(
      <RunDetail runRef="run-1" detail={detail} events={[]} dag={{ nodes: [], edges: [] }} fetchImpl={fetchImpl as unknown as typeof fetch} />,
    ));

    fireEvent.change(screen.getByTestId('run-archive-reason'), { target: { value: '  obsolete validation run  ' } });
    fireEvent.click(screen.getByTestId('run-archive'));

    await waitFor(() => {
      const call = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/archive'));
      expect(call).toBeTruthy();
      expect(String(call![0])).toBe('/api/control/runs/run-1/archive');
      expect(JSON.parse(String(call![1]!.body))).toEqual({
        idempotencyKey: 'archive:run-1:4', reason: 'obsolete validation run',
      });
    });
  });

  it('archives with no reason at all — one click, nothing to fill in first', async () => {
    const detail = makeDetail({ run: { state: 'failed', version: 9 } as RunDetailDto['run'] });
    const fetchImpl = archiveFetch(detail);
    render(unlocked(
      <RunDetail runRef="run-1" detail={detail} events={[]} dag={{ nodes: [], edges: [] }} fetchImpl={fetchImpl as unknown as typeof fetch} />,
    ));

    fireEvent.click(screen.getByTestId('run-archive'));
    await waitFor(() => {
      const call = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/archive'));
      expect(JSON.parse(String(call![1]!.body)).reason).toBeNull();
    });
  });

  it('is offered for every settled or parked state and refused, in words, for a live run', () => {
    for (const state of ['waiting-human', 'failed', 'interrupted', 'succeeded', 'stopped'] as const) {
      const detail = makeDetail({ run: { state } as RunDetailDto['run'] });
      const view = render(unlocked(<RunDetail runRef="run-1" detail={detail} events={[]} dag={{ nodes: [], edges: [] }} />));
      expect((screen.getByTestId('run-archive') as HTMLButtonElement).disabled).toBe(false);
      view.unmount();
    }

    // Rendered-disabled, never hidden: the standing refusal is stated rather than discovered.
    render(unlocked(<RunDetail runRef="run-1" detail={makeDetail()} events={[]} dag={{ nodes: [], edges: [] }} />));
    const button = screen.getByTestId('run-archive') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/Stop this run before archiving it/i);
    expect(screen.queryByTestId('run-archive-reason')).toBeNull();
  });

  it('says an already-archived run is archived instead of offering the action again', () => {
    const detail = makeDetail({ run: { state: 'archived' } as RunDetailDto['run'] });
    render(unlocked(<RunDetail runRef="run-1" detail={detail} events={[]} dag={{ nodes: [], edges: [] }} />));
    const button = screen.getByTestId('run-archive') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Already archived.');
    expect(screen.getByTestId('entity-detail-status').textContent).toContain('archived');
  });

  it('does not send the archive from a locked tab', async () => {
    clearStoredSession();
    const detail = makeDetail({ run: { state: 'failed' } as RunDetailDto['run'] });
    const fetchImpl = archiveFetch(detail);
    render(
      <SessionProvider deps={{ signIn: async () => { throw new Error('refused'); } }}>
        <RunDetail runRef="run-1" detail={detail} events={[]} dag={{ nodes: [], edges: [] }} fetchImpl={fetchImpl as unknown as typeof fetch} />
      </SessionProvider>,
    );

    fireEvent.click(screen.getByTestId('run-archive'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/archive'))).toBe(false);
  });
});

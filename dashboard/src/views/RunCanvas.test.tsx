// @vitest-environment jsdom
/**
 * Headless roster — Run Canvas stream tiles.
 *
 * The canvas is a projection of the redacted public event stream. It deliberately has no terminal
 * attachment: the nearby Terminal view remains the only owner of the manual PTY surface.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import {
  AgentTile,
  RunCanvas,
  RunCanvasBoard,
  RUN_CANVAS_POLL_MS,
  deriveAgentGraph,
  deriveAgentLanes,
  eventBelongsToAgent,
  runCanvasBadge,
  type AgentGraphEdge,
} from './RunCanvas';
import type { OperationalEventDto, RunDetailDto, RunMetadataDto } from '../control/controlClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

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

function fixtureStages() {
  const stage = (id: string, agentId: string, dependsOn: string[] = []) => ({
    stageId: id, dependsOn, assignment: { agentId },
  });
  return [
    stage('idea', 'fyt-story'),
    stage('story', 'fyt-story', ['idea']),
    stage('visual-plan', 'fyt-visuals', ['story']),
    stage('images', 'fyt-visuals', ['visual-plan']),
    stage('audio-render', 'fyt-audio-render', ['images']),
  ];
}

describe('agent graph', () => {
  it('keeps the manager first and derives cross-agent flow lanes', () => {
    const { agentIds, edges } = deriveAgentGraph({
      run: { managerAssignment: { agentId: 'fyt-runner' } }, stages: fixtureStages(),
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

describe('runCanvasBadge', () => {
  it('maps the latest public event to the compact status vocabulary', () => {
    expect(runCanvasBadge([event({ status: 'running', summary: 'writing' })])).toEqual({ kind: 'active', text: 'active: writing' });
    expect(runCanvasBadge([event({ status: 'waiting', summary: 'waiting on fyt-story' })])).toEqual({ kind: 'waiting', text: 'waiting on fyt-story' });
    expect(runCanvasBadge([event({ status: 'failure', summary: 'G1 refused' })])).toEqual({ kind: 'blocked', text: 'blocked: G1 refused' });
    expect(runCanvasBadge([])).toEqual({ kind: 'idle', text: 'idle' });
  });
});

function makeStage(stageId: string, agentId: string, dependsOn: string[] = []) {
  return {
    stageRef: `ref-${stageId}`, runRef: 'run-1', stageId, title: stageId, dependsOn, canonicalCardRef: null,
    state: 'ready' as const, version: 1, currentAttemptRef: null,
    assignment: { agentId, declarationPath: `agents/${agentId}.md`, declarationHash: 'h'.repeat(64), profileId: 'p', runtime: 'claude', model: 'fable-5' },
    createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
  };
}

function makeDetail(): RunDetailDto {
  return {
    run: {
      runRef: 'run-1', predecessorRunRef: null, title: 'headless run', proposalRef: 'p-1', proposalRevision: 1,
      proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running', version: 1,
      managerSessionRef: 'session-mgr', managerGeneration: 1,
      managerAssignment: { agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'h'.repeat(64), profileId: 'p', runtime: 'claude', model: 'fable-5' },
      createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
    },
    stages: [makeStage('idea', 'fyt-story'), makeStage('visual-plan', 'fyt-visuals', ['idea'])],
    attempts: [], sessions: [], humanRequests: [], reviewLoops: [], reviewReceipts: [],
  };
}

function event(overrides: Partial<OperationalEventDto> = {}): OperationalEventDto {
  return {
    cursor: 1, runRef: 'run-1', kind: 'message', source: 'worker', stageRef: 'ref-idea', attemptRef: 'attempt-1',
    sessionRef: 'session-1', status: 'running', summary: 'Story worker started', command: null, toolName: null,
    path: null, diff: null, checkpoint: null, createdAt: '2026-08-04T00:00:00.000Z', ...overrides,
  };
}

describe('event ownership', () => {
  it('maps stage events to their assigned tile and manager events to the manager tile', () => {
    const detail = makeDetail();
    expect(eventBelongsToAgent(event(), detail, 'fyt-story')).toBe(true);
    expect(eventBelongsToAgent(event(), detail, 'fyt-visuals')).toBe(false);
    expect(eventBelongsToAgent(event({ source: 'manager', stageRef: null, sessionRef: 'session-mgr' }), detail, 'fyt-runner')).toBe(true);
  });
});

describe('AgentTile', () => {
  it('renders only the redacted events supplied for its agent', () => {
    render(unlocked(
      <AgentTile agentId="fyt-story" runRef="run-1"
        events={[event({ summary: 'Story-only public event' })]} />,
    ));
    expect(screen.getByTestId('run-canvas-tile-fyt-story-transcript').textContent).toContain('Story-only public event');
    expect(screen.queryByText('Visual-only public event')).toBeNull();
  });

  it('links a blocked tile to the Inbox', () => {
    const onNavigate = vi.fn();
    render(unlocked(
      <AgentTile agentId="fyt-story" runRef="run-1"
        events={[event({ status: 'failure', summary: 'G1 refused' })]} onNavigate={onNavigate} />,
    ));
    fireEvent.click(screen.getByTestId('run-canvas-tile-fyt-story-inbox-link'));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'approvals' });
  });

  it('posts an operator message and states that a codex delivery is queued', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ delivery: 'queued' }), { status: 202 }));
    render(unlocked(<AgentTile agentId="fyt-story" runRef="run-1" events={[]} fetchImpl={fetchImpl as typeof fetch} />));
    fireEvent.change(screen.getByLabelText('Message fyt-story'), { target: { value: 'Please verify the draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('run-canvas-tile-fyt-story-delivery').textContent).toMatch(/queued for next turn/i));
    expect(fetchImpl).toHaveBeenCalledWith('/api/control/runs/run-1/agents/fyt-story/messages', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ message: 'Please verify the draft.' }),
    }));
  });

  it('renders the delivery-offline refusal instead of silently dropping a message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'agent-message-delivery-unavailable' }), { status: 409 }));
    render(unlocked(<AgentTile agentId="fyt-story" runRef="run-1" events={[]} fetchImpl={fetchImpl as typeof fetch} />));
    fireEvent.change(screen.getByLabelText('Message fyt-story'), { target: { value: 'Please verify the draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('run-canvas-tile-fyt-story-delivery').textContent).toMatch(/worker delivery offline/i));
  });
});

describe('RunCanvasBoard', () => {
  it('projects each public event into only its owning agent transcript', () => {
    const detail = makeDetail();
    render(unlocked(<RunCanvasBoard detail={detail} events={[
      event({ summary: 'Story-only public event' }), event({ cursor: 2, stageRef: 'ref-visual-plan', summary: 'Visual-only public event' }),
    ]} />));
    expect(screen.getByTestId('run-canvas-tile-fyt-story-transcript').textContent).toContain('Story-only public event');
    expect(screen.getByTestId('run-canvas-tile-fyt-story-transcript').textContent).not.toContain('Visual-only public event');
    expect(screen.getByTestId('run-canvas-tile-fyt-visuals-transcript').textContent).toContain('Visual-only public event');
  });
});

describe('RunCanvas', () => {
  it('asks for the session on mount and, when refused, leaves one calm line that retries', async () => {
    const fetchImpl = vi.fn();
    const signIn = vi.fn(async () => { throw new Error('assert/verify refused: 401'); });
    render(<SessionProvider deps={{ signIn }}><RunCanvas fetchImpl={fetchImpl as typeof fetch} /></SessionProvider>);

    // Governed view: it prompts itself rather than parking a sign-in wall in front of the operator.
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    const locked = await screen.findByTestId('run-canvas-locked');
    expect(locked.textContent).toBe('Locked — unlock to view live streams');
    expect(fetchImpl).not.toHaveBeenCalled();

    // The line is the retry: it never re-prompts on its own after a refusal.
    fireEvent.click(locked);
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
  });

  it('loads public events beside the selected run detail', async () => {
    const runs: RunMetadataDto[] = [{
      runRef: 'run-1', predecessorRunRef: null, title: 'headless run', proposalRef: 'p-1', proposalRevision: 1,
      proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running', version: 1,
      managerSessionRef: 'session-mgr', managerGeneration: 1, managerAssignment: null,
      createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
      stageCount: 2, attemptCount: 0, sessionCount: 0, openHumanRequestCount: 0, eventCount: 1,
    }];
    const detail = makeDetail();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/control/runs') return new Response(JSON.stringify({ runs }), { status: 200 });
      if (url.includes('/events?')) return new Response(JSON.stringify({ ok: true, value: [event({ summary: 'Fetched public event' })] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, value: detail }), { status: 200 });
    });
    render(unlocked(<RunCanvas fetchImpl={fetchImpl as typeof fetch} />));
    await waitFor(() => expect(screen.getByTestId('run-card-run-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('run-card-run-1'));
    await waitFor(() => expect(screen.getByTestId('run-canvas-tile-fyt-story-transcript').textContent).toContain('Fetched public event'));
  });

  it('uses one shared event poller for five tiles while preserving per-agent event filtering', async () => {
    vi.useFakeTimers();
    const detail = makeDetail();
    detail.run.managerAssignment = null;
    detail.stages = ['agent-a', 'agent-b', 'agent-c', 'agent-d', 'agent-e'].map((agentId, index) =>
      makeStage(`stage-${index}`, agentId),
    );
    const events = detail.stages.map((stage, index) => event({
      cursor: index + 1,
      stageRef: stage.stageRef,
      summary: `${stage.assignment?.agentId} public event`,
    }));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/control/runs') return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      if (url.includes('/events?')) return new Response(JSON.stringify({ ok: true, value: events }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, value: detail }), { status: 200 });
    });
    const eventRequestCount = (): number => fetchImpl.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/events?'),
    ).length;

    render(unlocked(<RunCanvas focusRunRef="run-1" fetchImpl={fetchImpl as typeof fetch} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(eventRequestCount()).toBe(1);
    for (const agentId of ['agent-a', 'agent-b', 'agent-c', 'agent-d', 'agent-e']) {
      expect(screen.getByTestId(`run-canvas-tile-${agentId}-transcript`).textContent).toContain(`${agentId} public event`);
    }
    expect(screen.getByTestId('run-canvas-tile-agent-a-transcript').textContent).not.toContain('agent-b public event');

    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_CANVAS_POLL_MS); });
    expect(eventRequestCount()).toBe(2);
  });

  it('backs off event polling after a 429 and restores the five-second cadence on recovery', async () => {
    vi.useFakeTimers();
    const detail = makeDetail();
    let eventRequests = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/control/runs') return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      if (url.includes('/events?')) {
        eventRequests += 1;
        if (eventRequests === 1) return new Response(JSON.stringify({ error: 'locked-out' }), { status: 429 });
        return new Response(JSON.stringify({ ok: true, value: [event({ summary: 'Recovered event poll' })] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, value: detail }), { status: 200 });
    });

    render(unlocked(<RunCanvas focusRunRef="run-1" fetchImpl={fetchImpl as typeof fetch} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(eventRequests).toBe(1);
    expect(screen.getByTestId('run-canvas-rate-limit').textContent).toMatch(/rate-limited, backing off.*10s/i);
    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_CANVAS_POLL_MS); });
    expect(eventRequests).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_CANVAS_POLL_MS); });
    expect(eventRequests).toBe(2);
    expect(screen.queryByTestId('run-canvas-rate-limit')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_CANVAS_POLL_MS); });
    expect(eventRequests).toBe(3);
  });
});

describe('headless-only import boundary', () => {
  it('has no terminal or WebSocket import in the canvas module', () => {
    const source = readFileSync('src/views/RunCanvas.tsx', 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/Terminal['"]/);
    expect(source).not.toMatch(/@xterm/);
  });
});

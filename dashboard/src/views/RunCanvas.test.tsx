// @vitest-environment jsdom
/**
 * FYT gated-pipeline — Task 5 tests for the run canvas (`RunCanvas.tsx`).
 *
 * Covers: badge-text mapping for all four roster statuses, the expand/collapse state machine (one tile
 * at a time, the underlying pty session preserved across expand→shrink), agent-graph/lane derivation
 * from a fixture stage graph, read-only-while-mini (no write path reachable from a mini tile), and the
 * blocked badge's link to the Inbox destination.
 *
 * xterm + its fit addon are mocked exactly like `Terminal.test.tsx` (same fake shapes, same reasoning:
 * these tests never open a real WebSocket or mount a real canvas-backed terminal), so `TileTerminal`'s
 * lazy `import('@xterm/xterm')` resolves to a controllable fake whose `onData` call count is the direct
 * proof of the read-only property — a mini attach must never call it at all.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (typeof window !== 'undefined' && typeof window.ResizeObserver !== 'function') {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const xtermReg = vi.hoisted(() => {
  const instances: Array<{
    writes: string[];
    dataCb: ((d: string) => void) | null;
    onDataCallCount: number;
    disposed: boolean;
  }> = [];
  return { instances };
});

vi.mock('@xterm/xterm', () => {
  class FakeXTerm {
    cols = 80;
    rows = 24;
    writes: string[] = [];
    dataCb: ((d: string) => void) | null = null;
    onDataCallCount = 0;
    disposed = false;
    constructor() {
      xtermReg.instances.push(this);
    }
    loadAddon() {}
    open() {}
    write(d: string) {
      this.writes.push(d);
    }
    onData(cb: (d: string) => void) {
      this.onDataCallCount += 1;
      this.dataCb = cb;
    }
    dispose() {
      this.disposed = true;
    }
  }
  return { Terminal: FakeXTerm };
});
vi.mock('@xterm/addon-fit', () => {
  class FakeFitAddon {
    fit() {}
  }
  return { FitAddon: FakeFitAddon };
});
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import {
  AgentTile,
  RunCanvas,
  RunCanvasBoard,
  canvasExpandReducer,
  deriveAgentGraph,
  deriveAgentLanes,
  runCanvasBadge,
  type AgentGraphEdge,
} from './RunCanvas';
import type { RosterAgentStateDto, RunDetailWithRosterDto, RunMetadataDto } from '../control/controlClient';

afterEach(() => {
  cleanup();
  xtermReg.instances.length = 0;
  vi.clearAllMocks();
});

/** A fake browser WebSocket, same shape as Terminal.test.tsx's. */
class FakeWS {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  attachSessionId: string | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.closed = true;
  }
}

function makeFactory() {
  const sockets: FakeWS[] = [];
  const factory = vi.fn((_token: string, attachSessionId?: string) => {
    const ws = new FakeWS();
    ws.attachSessionId = attachSessionId;
    sockets.push(ws);
    return ws as unknown as WebSocket;
  });
  return { factory, sockets };
}

/* ============================================================================
 * Pure functions.
 * ========================================================================= */

/** A realistic fixture stage graph, mirroring `orgs/faceless-youtube/workflows/video-run.md`'s shape:
 *  fyt-runner manages; fyt-story owns idea/story/shorts+metadata; fyt-visuals owns the visual plan and
 *  images; fyt-audio-render owns audio+render; fyt-checker verifies; fyt-publish ships. */
function fixtureStages() {
  const stage = (id: string, agentId: string, dependsOn: string[] = []) => ({
    stageId: id,
    dependsOn,
    assignment: { agentId },
  });
  return [
    stage('idea', 'fyt-story'),
    stage('story', 'fyt-story', ['idea']),
    stage('shorts-metadata', 'fyt-story', ['story']), // same-agent dependency — must NOT produce an edge
    stage('visual-plan', 'fyt-visuals', ['story']),
    stage('images', 'fyt-visuals', ['visual-plan']),
    stage('audio-render', 'fyt-audio-render', ['images']),
    stage('verify', 'fyt-checker', ['audio-render']),
    stage('publish', 'fyt-publish', ['verify']),
  ];
}

describe('deriveAgentGraph', () => {
  it('lists agents in first-seen order (manager first) and derives cross-agent edges only', () => {
    const { agentIds, edges } = deriveAgentGraph({
      run: { managerAssignment: { agentId: 'fyt-runner' } },
      stages: fixtureStages(),
    });
    expect(agentIds).toEqual(['fyt-runner', 'fyt-story', 'fyt-visuals', 'fyt-audio-render', 'fyt-checker', 'fyt-publish']);
    // The same-agent 'shorts-metadata' -> 'story' dependency produced NO edge (fyt-story -> fyt-story).
    expect(edges).toEqual([
      { from: 'fyt-story', to: 'fyt-visuals' },
      { from: 'fyt-visuals', to: 'fyt-audio-render' },
      { from: 'fyt-audio-render', to: 'fyt-checker' },
      { from: 'fyt-checker', to: 'fyt-publish' },
    ]);
  });

  it('never duplicates an edge implied by more than one dependsOn pair', () => {
    const stages = [
      { stageId: 'a1', dependsOn: [], assignment: { agentId: 'agent-a' } },
      { stageId: 'a2', dependsOn: [], assignment: { agentId: 'agent-a' } },
      { stageId: 'b1', dependsOn: ['a1', 'a2'], assignment: { agentId: 'agent-b' } },
    ];
    const { edges } = deriveAgentGraph({ run: { managerAssignment: null }, stages });
    expect(edges).toEqual([{ from: 'agent-a', to: 'agent-b' }]);
  });
});

describe('deriveAgentLanes', () => {
  it('layers agents into ordered rows by longest-path depth from a source', () => {
    const { agentIds, edges } = deriveAgentGraph({
      run: { managerAssignment: { agentId: 'fyt-runner' } },
      stages: fixtureStages(),
    });
    const lanes = deriveAgentLanes(agentIds, edges);
    expect(lanes).toEqual([
      ['fyt-runner', 'fyt-story'],
      ['fyt-visuals'],
      ['fyt-audio-render'],
      ['fyt-checker'],
      ['fyt-publish'],
    ]);
  });

  it('degrades a cyclic edge set to lane 0 rather than looping forever', () => {
    const edges: AgentGraphEdge[] = [
      { from: 'x', to: 'y' },
      { from: 'y', to: 'x' },
    ];
    const lanes = deriveAgentLanes(['x', 'y'], edges);
    expect(lanes.flat().sort()).toEqual(['x', 'y']);
    expect(lanes.length).toBeGreaterThan(0);
  });

  it('lays out a single unconnected agent into one lane', () => {
    expect(deriveAgentLanes(['solo'], [])).toEqual([['solo']]);
  });
});

describe('runCanvasBadge', () => {
  it('maps active -> "active: <activity>"', () => {
    expect(runCanvasBadge({ status: 'active', activity: 'image-gen batch 2/4', waitingOn: [] })).toEqual({
      kind: 'active',
      text: 'active: image-gen batch 2/4',
    });
  });

  it('maps waiting -> "waiting on <x>"', () => {
    expect(runCanvasBadge({ status: 'waiting', activity: '', waitingOn: ['fyt-visuals'] })).toEqual({
      kind: 'waiting',
      text: 'waiting on fyt-visuals',
    });
  });

  it('maps blocked -> "blocked: <gate> — in your Inbox"', () => {
    expect(runCanvasBadge({ status: 'blocked', activity: '', waitingOn: ['G1'] })).toEqual({
      kind: 'blocked',
      text: 'blocked: G1 — in your Inbox',
    });
  });

  it('maps idle -> "idle"', () => {
    expect(runCanvasBadge({ status: 'idle', activity: '', waitingOn: [] })).toEqual({ kind: 'idle', text: 'idle' });
  });
});

describe('canvasExpandReducer', () => {
  it('expands exactly one tile, replacing any previously expanded one', () => {
    let state: string | null = null;
    state = canvasExpandReducer(state, { type: 'expand', agentId: 'fyt-story' });
    expect(state).toBe('fyt-story');
    state = canvasExpandReducer(state, { type: 'expand', agentId: 'fyt-visuals' });
    expect(state).toBe('fyt-visuals'); // never both — one slot, replaced not added
  });

  it('shrink clears the expanded slot', () => {
    expect(canvasExpandReducer('fyt-story', { type: 'shrink' })).toBeNull();
  });
});

/* ============================================================================
 * AgentTile — badge rendering + blocked-badge Inbox link.
 * ========================================================================= */

function rosterEntry(overrides: Partial<RosterAgentStateDto> = {}): RosterAgentStateDto {
  return { agentId: 'fyt-story', sessionId: 'pty-story', status: 'idle', activity: '', waitingOn: [], ...overrides };
}

describe('AgentTile', () => {
  it('renders the active badge with the live activity line', () => {
    render(
      <AgentTile
        agentId="fyt-visuals"
        roster={rosterEntry({ agentId: 'fyt-visuals', status: 'active', activity: 'image-gen batch 2/4' })}
        sessionToken="tok"
        socketFactory={makeFactory().factory}
        expanded={false}
        onExpand={vi.fn()}
      />,
    );
    expect(screen.getByTestId('run-canvas-tile-fyt-visuals-badge').textContent).toBe('active: image-gen batch 2/4');
  });

  it('renders the blocked badge with a clickable link to the Inbox destination', () => {
    const onNavigate = vi.fn();
    render(
      <AgentTile
        agentId="fyt-story"
        roster={rosterEntry({ status: 'blocked', waitingOn: ['G1'] })}
        sessionToken="tok"
        socketFactory={makeFactory().factory}
        expanded={false}
        onExpand={vi.fn()}
        onNavigate={onNavigate}
      />,
    );
    const link = screen.getByTestId('run-canvas-tile-fyt-story-inbox-link');
    expect(link.textContent).toBe('in your Inbox');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith({ view: 'approvals' });
  });

  it('shows "not yet spawned" when the roster has no live session yet', () => {
    render(
      <AgentTile
        agentId="fyt-publish"
        roster={rosterEntry({ agentId: 'fyt-publish', sessionId: null, status: 'waiting', waitingOn: ['fyt-audio-render'] })}
        sessionToken="tok"
        socketFactory={makeFactory().factory}
        expanded={false}
        onExpand={vi.fn()}
      />,
    );
    expect(screen.getByTestId('run-canvas-tile-fyt-publish-badge').textContent).toBe('waiting on fyt-audio-render');
    expect(screen.queryByTestId('run-canvas-tile-fyt-publish-open')).toBeNull();
    expect(screen.getByText('not yet spawned')).toBeTruthy();
  });
});

/* ============================================================================
 * RunCanvasBoard — expand/collapse, session preservation, read-only-while-mini.
 * ========================================================================= */

function makeStage(stageId: string, agentId: string, dependsOn: string[] = []) {
  return {
    stageRef: `ref-${stageId}`,
    runRef: 'run-1',
    stageId,
    title: stageId,
    dependsOn,
    canonicalCardRef: null,
    state: 'ready' as const,
    version: 1,
    currentAttemptRef: null,
    assignment: { agentId, declarationPath: `agents/${agentId}.md`, declarationHash: 'h'.repeat(64), profileId: 'p', runtime: 'claude', model: 'fable-5' },
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
}

function makeDetail(roster: RosterAgentStateDto[]): RunDetailWithRosterDto {
  return {
    run: {
      runRef: 'run-1', predecessorRunRef: null, title: 'the-second-take run', proposalRef: 'p-1',
      proposalRevision: 1, proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running',
      version: 1, managerSessionRef: 'session-mgr', managerGeneration: 1,
      managerAssignment: { agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'h'.repeat(64), profileId: 'p', runtime: 'claude', model: 'fable-5' },
      createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
    },
    stages: [
      makeStage('idea', 'fyt-story'),
      makeStage('story', 'fyt-story', ['idea']),
      makeStage('visual-plan', 'fyt-visuals', ['story']),
    ],
    attempts: [],
    sessions: [],
    humanRequests: [],
    reviewLoops: [],
    reviewReceipts: [],
    roster,
  };
}

describe('RunCanvasBoard', () => {
  it('expands exactly one tile at a time and preserves the same pty session across expand -> shrink -> reopen', async () => {
    const { factory, sockets } = makeFactory();
    const detail = makeDetail([
      rosterEntry({ agentId: 'fyt-story', sessionId: 'pty-story', status: 'active', activity: 'writing' }),
      rosterEntry({ agentId: 'fyt-visuals', sessionId: 'pty-visuals', status: 'idle' }),
      rosterEntry({ agentId: 'fyt-runner', sessionId: 'pty-runner', status: 'idle' }),
    ]);
    render(<RunCanvasBoard detail={detail} sessionToken="tok" socketFactory={factory} />);

    // Mini tiles for every roster agent attach immediately.
    await waitFor(() => expect(sockets.length).toBe(3));
    expect(sockets.map((s) => s.attachSessionId).sort()).toEqual(['pty-runner', 'pty-story', 'pty-visuals']);

    // Expand fyt-story: its mini attach unmounts (closing that socket) and the overlay opens a new one
    // to the SAME session id — the pty session itself is never re-created.
    fireEvent.click(screen.getByTestId('run-canvas-tile-fyt-story-open'));
    await waitFor(() => expect(screen.getByTestId('run-canvas-overlay')).toBeTruthy());
    await waitFor(() => expect(sockets.length).toBe(4));
    expect(sockets[3].attachSessionId).toBe('pty-story');
    expect(screen.queryByTestId('run-canvas-mini-pty-story')).toBeNull(); // replaced by the overlay while expanded

    // Only one tile is ever expanded: opening a second tile would replace, never add, an overlay slot
    // (canvasExpandReducer proves this in isolation above); here we just prove shrink returns cleanly.
    fireEvent.click(screen.getByTestId('run-canvas-overlay-shrink'));
    expect(screen.queryByTestId('run-canvas-overlay')).toBeNull();

    // Shrinking re-mounts fyt-story's mini tile, reattaching to the SAME session id again — "session
    // preserved" means the pty session, not the JS socket object.
    await waitFor(() => expect(sockets.length).toBe(5));
    expect(sockets[4].attachSessionId).toBe('pty-story');
    expect(screen.getByTestId('run-canvas-mini-pty-story')).toBeTruthy();
  });

  it('never wires input on a mini attach: xterm.onData is called on the expanded terminal but not on any mini tile', async () => {
    const { factory } = makeFactory();
    const detail = makeDetail([rosterEntry({ agentId: 'fyt-story', sessionId: 'pty-story', status: 'idle' })]);
    render(<RunCanvasBoard detail={detail} sessionToken="tok" socketFactory={factory} />);

    await waitFor(() => expect(xtermReg.instances.length).toBe(1));
    expect(xtermReg.instances[0].onDataCallCount).toBe(0); // mini: never wired

    fireEvent.click(screen.getByTestId('run-canvas-tile-fyt-story-open'));
    await waitFor(() => expect(xtermReg.instances.length).toBe(2));
    const expandedTerm = xtermReg.instances[1];
    expect(expandedTerm.onDataCallCount).toBe(1); // expanded: wired exactly once

    // Even if something invoked the callback directly, a mini instance's dataCb was NEVER SET, so typed
    // input has no send path to reach at all (the assertion above is the structural proof; this confirms
    // the send-side stays silent regardless).
    expect(xtermReg.instances[0].dataCb).toBeNull();
  });

  it('derives lanes from the run\'s own stage graph (fyt-story before fyt-visuals, laid out as ordered rows)', () => {
    const { factory } = makeFactory();
    const detail = makeDetail([
      rosterEntry({ agentId: 'fyt-story', sessionId: 'pty-story' }),
      rosterEntry({ agentId: 'fyt-visuals', sessionId: 'pty-visuals' }),
      rosterEntry({ agentId: 'fyt-runner', sessionId: 'pty-runner' }),
    ]);
    render(<RunCanvasBoard detail={detail} sessionToken="tok" socketFactory={factory} />);
    const lane0 = screen.getByTestId('run-canvas-lane-0');
    const lane1 = screen.getByTestId('run-canvas-lane-1');
    expect(lane0.querySelector('[data-testid="run-canvas-tile-fyt-story"]')).toBeTruthy();
    expect(lane1.querySelector('[data-testid="run-canvas-tile-fyt-visuals"]')).toBeTruthy();
    expect(screen.getByTestId('run-canvas-flow').textContent).toContain('fyt-story → fyt-visuals');
  });
});

/* ============================================================================
 * RunCanvas — session gating + run selection wiring (self-fetching container).
 * ========================================================================= */

describe('RunCanvas', () => {
  it('without a session renders the passkey prompt and fetches nothing', () => {
    const fetchImpl = vi.fn();
    render(<RunCanvas fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect(screen.getByText(/sign in with your passkey to open the run canvas/i)).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lists runs once signed in and opens the canvas for the selected one', async () => {
    const runs: RunMetadataDto[] = [{
      runRef: 'run-1', predecessorRunRef: null, title: 'the-second-take run', proposalRef: 'p-1',
      proposalRevision: 1, proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running',
      version: 1, managerSessionRef: 'session-mgr', managerGeneration: 1, managerAssignment: null,
      createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
      stageCount: 3, attemptCount: 0, sessionCount: 0, openHumanRequestCount: 0, eventCount: 0,
    }];
    const detail = makeDetail([rosterEntry({ agentId: 'fyt-story', sessionId: 'pty-story' })]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/control/runs') return new Response(JSON.stringify({ runs }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, value: detail, roster: detail.roster }), { status: 200 });
    });

    render(<RunCanvas sessionToken="tok" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId('run-card-run-1')).toBeTruthy());

    fireEvent.click(screen.getByTestId('run-card-run-1'));
    await waitFor(() => expect(screen.getByTestId('run-canvas-board')).toBeTruthy());
    expect(screen.getByTestId('run-canvas-tile-fyt-story')).toBeTruthy();
  });
});

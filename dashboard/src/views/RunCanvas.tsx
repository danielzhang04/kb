/**
 * FYT gated-pipeline — Task 5: the workflow run canvas.
 *
 * The design (`docs/specs/2026-07-30-fyt-gated-pipeline-design.md` §Workflow canvas) wants Daniel to
 * watch a run without opening a terminal: every roster agent renders as a miniaturized LIVE terminal
 * tile — the actual running xterm surface scaled small (CSS `transform: scale`, never a font-size
 * zoom) — laid out along the artifact-flow order the compiled stage graph implies. Clicking a tile
 * expands it to a full interactive terminal (same session, input enabled); shrinking back returns to
 * the board with the run still running and the pty session untouched throughout.
 *
 * DATA SOURCE. `GET /api/control/runs/:runRef` already carries the roster projection
 * (`RosterAgentStateDto[]`, `server/control/rosterSessions.ts#projectRosterState`) alongside the usual
 * `RunDetailDto` — see `controlClient.ts#getRun`'s `RunDetailWithRosterDto` return type. Lanes are
 * derived from `stages[].dependsOn` + `stages[].assignment.agentId`: an edge agentA→agentB exists when
 * some stage agentB owns depends on a stage agentA owns. This is a plain topological LAYERING (longest
 * path from a source), not a graph library — "ordered lanes" per the plan is enough to show flow.
 *
 * ATTACH PATH. Every tile — mini or expanded — attaches to the roster agent's REAL persistent pty
 * session via the SAME protocol `Terminal.tsx` speaks (`defaultPtySocketFactory`, `HOUSE_XTERM_THEME`,
 * `parseControlFrame`, all imported from there rather than forked): `?session=<id>` reattachment, which
 * `server/pty/persistentSessions.ts` serves without spending the daemon's concurrent-terminal budget
 * (that cap gates NEW sessions, not attaches to an already-running one). A mini tile never calls
 * `xterm.onData`, so it is structurally incapable of writing a keystroke into the pty — there is no
 * `ws.send` call site for input to reach, not merely a UI affordance that is disabled. Only the expanded
 * overlay wires `onData`, and only one tile is ever expanded (a single `expandedAgentId` slot).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/views/runCanvas.css';
import type { Session } from '../lib/authClient';
import { SESSION_INVALIDATED_EVENT } from '../lib/authClient';
import {
  getRun,
  listRuns,
  type FetchLike,
  type RosterAgentStateDto,
  type RunDetailWithRosterDto,
  type RunMetadataDto,
} from '../control/controlClient';
import { RunGrid } from '../control/RunGrid';
import type { NavTarget } from '../nav/stack';
import { defaultPtySocketFactory, HOUSE_XTERM_THEME, parseControlFrame } from './Terminal';
import type { PtySocketFactory } from './Terminal';

/** Poll cadence for the run detail (roster state changes as gates approve / agents work). Mirrors the
 *  `HumanRequestsPanel` refresh shape (one async function, effect-driven, errors surfaced rather than
 *  thrown) but ALSO re-polls on an interval: unlike the Inbox — which only needs a refresh on mount/after
 *  a mutation it made itself — the canvas is explicitly a passive "watch a run" surface, so it has no
 *  mutation of its own to hang a refresh off. */
export const RUN_CANVAS_POLL_MS = 4000;

/** The base size the full-size xterm host renders at before a mini tile scales it down. Picking a fixed
 *  size (rather than measuring) keeps the counter-scale math in the CSS simple and deterministic. */
const RUN_CANVAS_BASE_W = 760;
const RUN_CANVAS_BASE_H = 460;
/** How small a mini tile renders the terminal — see `.run-canvas-tile__mini` in runCanvas.css for the
 *  box this must exactly fill (208×130 = 760×0.27368.. / 460×0.28..; close enough that overflow:hidden
 *  on the mini box crops the same sliver every render rather than leaving a visible gap). */
const RUN_CANVAS_MINI_SCALE = 0.27;

/* ============================================================================
 * Pure functions — agent graph, lane layering, badge text, expand/collapse. Exported so they are
 * directly unit-testable against a literal fixture stage graph, with no fetch/DOM involved.
 * ========================================================================= */

export interface AgentGraphEdge {
  from: string;
  to: string;
}

interface GraphStage {
  stageId: string;
  dependsOn: string[];
  assignment: { agentId: string } | null;
}

interface GraphRun {
  managerAssignment: { agentId: string } | null;
}

/**
 * Every agent id owning the manager or at least one stage (first-seen order), plus the directed
 * agent→agent edges `dependsOn` implies: an edge `from→to` exists when some stage `to` owns depends on a
 * stage `from` owns. Self-edges (both stages owned by the same agent) carry no tile-to-tile flow and are
 * dropped, as are duplicate edges.
 */
export function deriveAgentGraph(detail: {
  run: GraphRun;
  stages: readonly GraphStage[];
}): { agentIds: string[]; edges: AgentGraphEdge[] } {
  const agentIds: string[] = [];
  const addAgent = (id: string | null | undefined): void => {
    if (typeof id === 'string' && id !== '' && !agentIds.includes(id)) agentIds.push(id);
  };
  addAgent(detail.run.managerAssignment?.agentId ?? null);
  for (const stage of detail.stages) addAgent(stage.assignment?.agentId ?? null);

  const ownerOf = new Map<string, string>();
  for (const stage of detail.stages) {
    if (stage.assignment?.agentId) ownerOf.set(stage.stageId, stage.assignment.agentId);
  }

  const seenEdges = new Set<string>();
  const edges: AgentGraphEdge[] = [];
  for (const stage of detail.stages) {
    const to = stage.assignment?.agentId;
    if (!to) continue;
    for (const dependencyId of stage.dependsOn) {
      const from = ownerOf.get(dependencyId);
      if (!from || from === to) continue;
      const key = `${from}->${to}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ from, to });
    }
  }
  return { agentIds, edges };
}

/**
 * Layer agent ids into ordered lanes (rows) by longest-path depth from a source: an agent with no
 * incoming edge sits in lane 0, everyone else sits one lane past their deepest predecessor. A cycle
 * (never expected — the engine validates the DAG before this ever runs) degrades that agent to lane 0
 * rather than looping forever, so a malformed graph still renders something instead of hanging the tab.
 */
export function deriveAgentLanes(agentIds: readonly string[], edges: readonly AgentGraphEdge[]): string[][] {
  const incoming = new Map<string, string[]>();
  for (const id of agentIds) incoming.set(id, []);
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard — fail-soft to lane 0
    visiting.add(id);
    const preds = incoming.get(id) ?? [];
    const value = preds.length === 0 ? 0 : 1 + Math.max(...preds.map(depthOf));
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const id of agentIds) depthOf(id);

  const maxDepth = agentIds.reduce((max, id) => Math.max(max, depth.get(id) ?? 0), 0);
  const lanes: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const id of agentIds) lanes[depth.get(id) ?? 0].push(id);
  return lanes;
}

export type CanvasBadgeKind = 'active' | 'waiting' | 'blocked' | 'idle';

export interface CanvasBadge {
  kind: CanvasBadgeKind;
  text: string;
}

/**
 * The four badge shapes the spec names verbatim: `active: <activity>` / `waiting on <x>` /
 * `blocked: <gate> — in your Inbox` / `idle`. `waitingOn` already carries either the upstream agent ids
 * (status `waiting`) or the blocking gate ids (status `blocked`) — see
 * `server/control/rosterSessions.ts#projectRosterState`.
 */
export function runCanvasBadge(agent: Pick<RosterAgentStateDto, 'status' | 'activity' | 'waitingOn'>): CanvasBadge {
  switch (agent.status) {
    case 'active':
      return { kind: 'active', text: `active: ${agent.activity || 'working'}` };
    case 'waiting':
      return { kind: 'waiting', text: `waiting on ${agent.waitingOn[0] ?? 'upstream'}` };
    case 'blocked':
      return { kind: 'blocked', text: `blocked: ${agent.waitingOn[0] ?? 'gate'} — in your Inbox` };
    default:
      return { kind: 'idle', text: 'idle' };
  }
}

/** Maps a badge kind onto the existing `mc-status-dot--*` vocabulary — no new colour introduced. */
const BADGE_DOT: Record<CanvasBadgeKind, string> = {
  active: 'running',
  waiting: 'idle',
  blocked: 'blocked',
  idle: 'idle',
};

export type CanvasExpandAction = { type: 'expand'; agentId: string } | { type: 'shrink' };

/**
 * One tile expanded at a time, BY CONSTRUCTION: there is only ever one slot, so `expand` simply replaces
 * whatever id was there (never adds a second) and `shrink` clears it. This is a UI-only reducer — it
 * never touches the pty session; the same `sessionId` a mini tile was attached to is exactly what the
 * overlay reattaches to, and what a re-mounted mini tile reattaches to again after a shrink.
 */
export function canvasExpandReducer(_state: string | null, action: CanvasExpandAction): string | null {
  return action.type === 'shrink' ? null : action.agentId;
}

/* ============================================================================
 * The terminal attach — mini (read-only) and expanded (interactive) share this one mount.
 * ========================================================================= */

interface XTermLike {
  cols: number;
  rows: number;
  write(data: string): void;
  onData(callback: (data: string) => void): void;
  dispose(): void;
}

interface FitAddonLike {
  fit(): void;
}

export interface TileTerminalProps {
  sessionToken: string;
  sessionId: string;
  socketFactory: PtySocketFactory;
  /** Mini tiles are read-only: `xterm.onData` is never wired, so there is no send path for a keystroke —
   *  not merely a disabled affordance. The expanded overlay passes `false`. */
  readOnly: boolean;
}

/**
 * One xterm instance attached to one roster pty session — the same lazy-import + protocol
 * `Terminal.tsx`'s `TerminalTab` uses, trimmed to what a canvas tile needs (no tabs, no close button, no
 * persistence bookkeeping: the roster session's lifecycle is owned by `rosterSessions.ts`, not this
 * component). Always reattaches via `?session=` — it never creates a new pty.
 */
export function TileTerminal({ sessionToken, sessionId, socketFactory, readOnly }: TileTerminalProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermLike | null>(null);
  const fitRef = useRef<FitAddonLike | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !hostRef.current) return;

      const xterm = new XTerm({
        theme: HOUSE_XTERM_THEME,
        fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, 'Liberation Mono', monospace",
        fontSize: 13,
        cursorBlink: !readOnly,
        cursorStyle: 'block',
        convertEol: true,
        disableStdin: readOnly,
      }) as unknown as XTermLike;
      const fitAddon = new FitAddon() as unknown as FitAddonLike;
      (xterm as unknown as { loadAddon(addon: unknown): void }).loadAddon(fitAddon);
      (xterm as unknown as { open(el: HTMLElement): void }).open(hostRef.current);
      xtermRef.current = xterm;
      fitRef.current = fitAddon;
      try {
        fitAddon.fit();
      } catch {
        /* fit can throw if the element is not yet laid out (e.g. mounted while off-screen) */
      }

      const ws = socketFactory(sessionToken, sessionId);
      socketRef.current = ws;
      ws.onmessage = (event: MessageEvent) => {
        if (disposed) return;
        const raw = typeof event.data === 'string' ? event.data : '';
        if (raw.length === 0) return;
        // Control frames (session bind / server error) carry nothing this tile renders — same parser
        // as Terminal.tsx, imported rather than reimplemented.
        if (parseControlFrame(raw)) return;
        xterm.write(raw);
      };
      // READ-ONLY WHILE MINI: this is the ONLY branch that ever calls `onData`. A mini tile therefore
      // never subscribes to keystrokes at all — there is no `ws.send` call site reachable from typed
      // input, regardless of focus or DOM structure.
      if (!readOnly) {
        xterm.onData((data: string) => {
          if (ws.readyState === ws.OPEN) ws.send(data);
        });
      }
    })();

    return () => {
      disposed = true;
      try {
        // Closing the socket only DETACHES the persistent shell server-side — it keeps running (same
        // contract as Terminal.tsx's tabs). Shrinking a tile never kills the roster session.
        socketRef.current?.close();
      } catch {
        /* socket may not have opened yet */
      }
      xtermRef.current?.dispose();
      socketRef.current = null;
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [sessionToken, sessionId, socketFactory, readOnly]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore — element may be mid-teardown */
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="run-canvas-tile__screen"
      style={{ width: RUN_CANVAS_BASE_W, height: RUN_CANVAS_BASE_H }}
      data-testid={`run-canvas-terminal-${sessionId}`}
    />
  );
}

function MiniTerminalTile({
  sessionToken,
  sessionId,
  socketFactory,
}: {
  sessionToken: string;
  sessionId: string;
  socketFactory: PtySocketFactory;
}): React.JSX.Element {
  return (
    <div className="run-canvas-tile__mini" data-testid={`run-canvas-mini-${sessionId}`}>
      <div
        className="run-canvas-tile__mini-scale"
        style={{
          transform: `scale(${RUN_CANVAS_MINI_SCALE})`,
          width: RUN_CANVAS_BASE_W,
          height: RUN_CANVAS_BASE_H,
        }}
      >
        <TileTerminal sessionToken={sessionToken} sessionId={sessionId} socketFactory={socketFactory} readOnly />
      </div>
    </div>
  );
}

/* ============================================================================
 * One roster tile.
 * ========================================================================= */

const EMPTY_ROSTER_STATE: Pick<RosterAgentStateDto, 'status' | 'activity' | 'waitingOn'> = {
  status: 'idle',
  activity: '',
  waitingOn: [],
};

export interface AgentTileProps {
  agentId: string;
  roster: RosterAgentStateDto | undefined;
  sessionToken: string;
  socketFactory: PtySocketFactory;
  expanded: boolean;
  onExpand: (agentId: string) => void;
  onNavigate?: (target: NavTarget) => void;
}

export function AgentTile({
  agentId,
  roster,
  sessionToken,
  socketFactory,
  expanded,
  onExpand,
  onNavigate,
}: AgentTileProps): React.JSX.Element {
  const badge = runCanvasBadge(roster ?? EMPTY_ROSTER_STATE);
  const sessionId = roster?.sessionId ?? null;

  const openTerminal = (): void => onExpand(agentId);

  return (
    <article
      className={`run-canvas-tile run-canvas-tile--${badge.kind}${expanded ? ' run-canvas-tile--expanded' : ''}`}
      data-testid={`run-canvas-tile-${agentId}`}
    >
      <header className="run-canvas-tile__head">
        <span className="mc-mono run-canvas-tile__agent">{agentId}</span>
        <span
          className={`mc-status-dot mc-status-dot--${BADGE_DOT[badge.kind]}`}
          aria-hidden="true"
          data-testid={`run-canvas-tile-${agentId}-dot`}
        />
      </header>
      <p className="run-canvas-tile__status" data-testid={`run-canvas-tile-${agentId}-badge`}>
        {badge.kind === 'blocked' && onNavigate ? (
          <>
            {badge.text.replace(' — in your Inbox', '')}
            {' — '}
            <button
              type="button"
              className="run-canvas-tile__inbox-link"
              data-testid={`run-canvas-tile-${agentId}-inbox-link`}
              onClick={() => onNavigate({ view: 'approvals' })}
            >
              in your Inbox
            </button>
          </>
        ) : (
          badge.text
        )}
      </p>

      {sessionId && !expanded ? (
        <div
          className="run-canvas-tile__open"
          role="button"
          tabIndex={0}
          aria-label={`Open ${agentId}'s terminal`}
          data-testid={`run-canvas-tile-${agentId}-open`}
          onClick={openTerminal}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openTerminal();
            }
          }}
        >
          <MiniTerminalTile sessionToken={sessionToken} sessionId={sessionId} socketFactory={socketFactory} />
        </div>
      ) : sessionId ? (
        <p className="control-help run-canvas-tile__empty">expanded — shrink to view here</p>
      ) : (
        <p className="control-help run-canvas-tile__empty">not yet spawned</p>
      )}
    </article>
  );
}

/* ============================================================================
 * The board: lanes of tiles + the expanded overlay.
 * ========================================================================= */

export interface RunCanvasBoardProps {
  detail: RunDetailWithRosterDto;
  sessionToken: string;
  socketFactory: PtySocketFactory;
  onNavigate?: (target: NavTarget) => void;
}

export function RunCanvasBoard({ detail, sessionToken, socketFactory, onNavigate }: RunCanvasBoardProps): React.JSX.Element {
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const dispatch = useCallback((action: CanvasExpandAction): void => {
    setExpandedAgentId((current) => canvasExpandReducer(current, action));
  }, []);

  const { agentIds, edges } = useMemo(() => deriveAgentGraph(detail), [detail]);
  const lanes = useMemo(() => deriveAgentLanes(agentIds, edges), [agentIds, edges]);
  const rosterByAgent = useMemo(() => new Map(detail.roster.map((entry) => [entry.agentId, entry])), [detail.roster]);

  const expandedSessionId = expandedAgentId ? rosterByAgent.get(expandedAgentId)?.sessionId ?? null : null;
  // Guard against a stale expansion: if the agent's session went away (roster respawned / run retired),
  // fall back to shrunk rather than pointing the overlay at a dead session id.
  useEffect(() => {
    if (expandedAgentId && !expandedSessionId) setExpandedAgentId(null);
  }, [expandedAgentId, expandedSessionId]);

  return (
    <div className="run-canvas-board" data-testid="run-canvas-board">
      <div className="run-canvas-board__lanes">
        {lanes.map((lane, laneIndex) => (
          <div key={laneIndex} className="run-canvas-board__lane" data-testid={`run-canvas-lane-${laneIndex}`}>
            {lane.map((agentId) => (
              <AgentTile
                key={agentId}
                agentId={agentId}
                roster={rosterByAgent.get(agentId)}
                sessionToken={sessionToken}
                socketFactory={socketFactory}
                expanded={expandedAgentId === agentId}
                onExpand={(id) => dispatch({ type: 'expand', agentId: id })}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </div>

      {/* A lightweight text connector list. The LANE ORDER already encodes artifact flow (spec: "ordered
          lanes is fine"), so this is a bonus legibility aid, never the sole source of the ordering. */}
      {edges.length > 0 ? (
        <p className="run-canvas-board__flow mc-mono" data-testid="run-canvas-flow">
          {edges.map((edge) => `${edge.from} → ${edge.to}`).join('   ')}
        </p>
      ) : null}

      {expandedAgentId && expandedSessionId ? (
        <div
          className="run-canvas-overlay"
          role="dialog"
          aria-label={`${expandedAgentId} terminal`}
          data-testid="run-canvas-overlay"
        >
          <header className="run-canvas-overlay__head">
            <span className="mc-mono">{expandedAgentId}</span>
            <button
              type="button"
              className="mc-btn"
              data-testid="run-canvas-overlay-shrink"
              onClick={() => dispatch({ type: 'shrink' })}
            >
              Shrink
            </button>
          </header>
          <div className="run-canvas-overlay__body">
            <TileTerminal
              key={expandedSessionId}
              sessionToken={sessionToken}
              sessionId={expandedSessionId}
              socketFactory={socketFactory}
              readOnly={false}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================================
 * The self-fetching container: session gating, run picking, polling.
 * ========================================================================= */

export interface RunCanvasProps {
  sessionToken?: string;
  onRequestSession?: () => Promise<Session | null>;
  onNavigate?: (target: NavTarget) => void;
  fetchImpl?: FetchLike;
  socketFactory?: PtySocketFactory;
  /** Preselect a run (nav-stack focus, mirroring Pipeline/Workflows/Agents). */
  focusRunRef?: string | null;
}

export function RunCanvas({
  sessionToken,
  onRequestSession,
  onNavigate,
  fetchImpl,
  socketFactory = defaultPtySocketFactory,
  focusRunRef,
}: RunCanvasProps): React.JSX.Element {
  const [localToken, setLocalToken] = useState(sessionToken);
  useEffect(() => {
    if (sessionToken) setLocalToken(sessionToken);
  }, [sessionToken]);
  useEffect(() => {
    const invalidate = (): void => setLocalToken(undefined);
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidate);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidate);
  }, []);
  const token = sessionToken ?? localToken;

  const [runs, setRuns] = useState<RunMetadataDto[]>([]);
  const [selectedRunRef, setSelectedRunRef] = useState<string | null>(focusRunRef ?? null);
  const [detail, setDetail] = useState<RunDetailWithRosterDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (focusRunRef) setSelectedRunRef(focusRunRef);
  }, [focusRunRef]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    listRuns(token, fetchImpl)
      .then((list) => {
        if (alive) setRuns(list);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'Could not load runs.');
      });
    return () => {
      alive = false;
    };
  }, [token, fetchImpl]);

  // Mirrors HumanRequestsPanel's refresh shape (one async function, error surfaced never thrown) plus a
  // periodic re-poll — see RUN_CANVAS_POLL_MS above for why the canvas needs the interval where the Inbox
  // does not.
  const refreshDetail = useCallback(
    async (activeToken: string, runRef: string): Promise<void> => {
      try {
        const next = await getRun(runRef, activeToken, fetchImpl);
        setDetail(next);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load the run canvas.');
      }
    },
    [fetchImpl],
  );

  useEffect(() => {
    if (!token || !selectedRunRef) {
      setDetail(null);
      return;
    }
    let alive = true;
    void refreshDetail(token, selectedRunRef);
    const interval = setInterval(() => {
      if (alive) void refreshDetail(token, selectedRunRef);
    }, RUN_CANVAS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [refreshDetail, token, selectedRunRef]);

  const unlock = (): void => {
    if (!onRequestSession || signingIn) return;
    setSigningIn(true);
    void onRequestSession()
      .then((session) => {
        if (session) setLocalToken(session.token);
      })
      .finally(() => setSigningIn(false));
  };

  return (
    <section className="v-run-canvas" aria-label="Run canvas">
      <header className="v-run-canvas__head">
        <h2>Run canvas</h2>
        <p className="v-run-canvas__lede">
          Watch a run&rsquo;s live roster without opening a terminal — every tile is the agent&rsquo;s
          real session, shrunk. Click a tile to open it full-size and type; shrink back leaves the run
          running.
        </p>
      </header>

      {!token ? (
        onRequestSession ? (
          <button
            type="button"
            className="mc-btn mc-btn--primary"
            onClick={unlock}
            disabled={signingIn}
            data-testid="run-canvas-signin"
          >
            {signingIn ? 'Signing in…' : 'Sign in with your passkey to open the run canvas'}
          </button>
        ) : (
          <p className="v-run-canvas__session-warning">Sign in with your passkey to open the run canvas.</p>
        )
      ) : (
        <>
          {error ? (
            <p role="alert" className="v-run-canvas__error">
              {error}
            </p>
          ) : null}
          <RunGrid runs={runs} selectedRunRef={selectedRunRef} onSelect={setSelectedRunRef} />
          {selectedRunRef && detail ? (
            <RunCanvasBoard detail={detail} sessionToken={token} socketFactory={socketFactory} onNavigate={onNavigate} />
          ) : selectedRunRef ? (
            <p className="control-help">Loading the run canvas…</p>
          ) : (
            <p className="control-help">Select a run above to open its canvas.</p>
          )}
        </>
      )}
    </section>
  );
}

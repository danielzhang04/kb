/**
 * Headless roster — workflow run canvas.
 *
 * A tile is a bounded view of the broker's redacted public event stream, not a terminal. Manual PTY
 * shells remain exclusively in `Terminal.tsx`; this lets the roster stay headless while retaining an
 * operator-visible two-way stream for each assigned agent.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import '../styles/views/runCanvas.css';
import type { Session } from '../lib/authClient';
import { SESSION_INVALIDATED_EVENT } from '../lib/authClient';
import {
  getRun,
  listRunEvents,
  listRuns,
  ControlApiError,
  type FetchLike,
  type OperationalEventDto,
  type RunDetailDto,
  type RunMetadataDto,
} from '../control/controlClient';
import { loadRunEventWindow } from '../control/runEventWindow';
import { RunGrid } from '../control/RunGrid';
import type { NavTarget } from '../nav/stack';

/** One canvas-owned event poller serves every open tile for the selected run. */
export const RUN_CANVAS_POLL_MS = 5_000;
export const RUN_CANVAS_MAX_POLL_MS = 60_000;

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

/** Derive the assigned-agent graph directly from the compiled stage dependencies. */
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

/** Longest-path lane placement, with a fail-soft cycle guard for malformed historical data. */
export function deriveAgentLanes(agentIds: readonly string[], edges: readonly AgentGraphEdge[]): string[][] {
  const incoming = new Map<string, string[]>();
  for (const id of agentIds) incoming.set(id, []);
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const predecessors = incoming.get(id) ?? [];
    const value = predecessors.length === 0 ? 0 : 1 + Math.max(...predecessors.map(depthOf));
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const id of agentIds) depthOf(id);
  const lanes = Array.from({ length: agentIds.reduce((max, id) => Math.max(max, depth.get(id) ?? 0), 0) + 1 }, () => [] as string[]);
  for (const id of agentIds) lanes[depth.get(id) ?? 0].push(id);
  return lanes;
}

export type CanvasBadgeKind = 'active' | 'waiting' | 'blocked' | 'idle';
export interface CanvasBadge { kind: CanvasBadgeKind; text: string; }

export function runCanvasBadge(events: readonly OperationalEventDto[]): CanvasBadge {
  const latest = events.at(-1);
  switch (latest?.status) {
    case 'running': return { kind: 'active', text: `active: ${latest.summary || 'working'}` };
    case 'waiting': return { kind: 'waiting', text: latest.summary || 'waiting on upstream work' };
    case 'failure': return { kind: 'blocked', text: `blocked: ${latest.summary || 'worker failed'}` };
    case 'stopped': return { kind: 'blocked', text: `blocked: ${latest.summary || 'worker stopped'}` };
    case 'interrupted': return { kind: 'blocked', text: `blocked: ${latest.summary || 'worker interrupted'}` };
    default: return { kind: 'idle', text: latest?.summary || 'idle' };
  }
}

const BADGE_DOT: Record<CanvasBadgeKind, string> = { active: 'running', waiting: 'idle', blocked: 'blocked', idle: 'idle' };

/** Resolve an event to a logical agent from immutable stage/manager assignment, never event prose. */
export function eventBelongsToAgent(event: OperationalEventDto, detail: RunDetailDto, agentId: string): boolean {
  const stage = event.stageRef ? detail.stages.find((candidate) => candidate.stageRef === event.stageRef) : undefined;
  if (stage?.assignment?.agentId === agentId) return true;
  return event.source === 'manager'
    && event.sessionRef === detail.run.managerSessionRef
    && detail.run.managerAssignment?.agentId === agentId;
}

type AgentMessageResult = { delivery: 'live' | 'queued' } | { offline: true };

/** The Task 4 route intentionally accepts only the operator's text; delivery is server-decided. */
async function postAgentMessage(
  runRef: string, agentId: string, message: string, token: string, fetchImpl?: FetchLike,
): Promise<AgentMessageResult> {
  const request = fetchImpl ?? fetch;
  const response = await request(`/api/control/runs/${encodeURIComponent(runRef)}/agents/${encodeURIComponent(agentId)}/messages`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  const body = await response.json().catch(() => ({})) as { delivery?: unknown; error?: unknown };
  if (response.status === 409 && body.error === 'agent-message-delivery-unavailable') return { offline: true };
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Agent message was refused.');
  if (body.delivery === 'live' || body.delivery === 'queued') return { delivery: body.delivery };
  throw new Error('Agent message response did not include a delivery state.');
}

export interface AgentTileProps {
  agentId: string;
  runRef: string;
  sessionToken: string;
  events: OperationalEventDto[];
  fetchImpl?: FetchLike;
  onNavigate?: (target: NavTarget) => void;
}

export function AgentTile({ agentId, runRef, sessionToken, events, fetchImpl, onNavigate }: AgentTileProps): React.JSX.Element {
  const badge = runCanvasBadge(events);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);

  const send = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setDeliveryNotice(null);
    try {
      const result = await postAgentMessage(runRef, agentId, text, sessionToken, fetchImpl);
      if ('offline' in result) {
        setDeliveryNotice('Worker delivery offline — your message was not delivered.');
      } else {
        setMessage('');
        setDeliveryNotice(result.delivery === 'queued' ? 'Queued for next turn.' : 'Delivered live.');
      }
    } catch (cause) {
      setDeliveryNotice(cause instanceof Error ? cause.message : 'Agent message was refused.');
    } finally {
      setSending(false);
    }
  };

  return (
    <article className={`run-canvas-tile run-canvas-tile--${badge.kind}`} data-testid={`run-canvas-tile-${agentId}`}>
      <header className="run-canvas-tile__head">
        <span className="mc-mono run-canvas-tile__agent">{agentId}</span>
        <span className={`mc-status-dot mc-status-dot--${BADGE_DOT[badge.kind]}`} aria-hidden="true" data-testid={`run-canvas-tile-${agentId}-dot`} />
      </header>
      <p className="run-canvas-tile__status" data-testid={`run-canvas-tile-${agentId}-badge`}>
        {badge.kind === 'blocked' && onNavigate ? <>{badge.text} — <button type="button" className="run-canvas-tile__inbox-link"
          data-testid={`run-canvas-tile-${agentId}-inbox-link`} onClick={() => onNavigate({ view: 'approvals' })}>open Inbox</button></> : badge.text}
      </p>
      <ol className="run-canvas-tile__transcript" data-testid={`run-canvas-tile-${agentId}-transcript`} aria-label={`${agentId} public event stream`}>
        {events.length ? events.map((item) => (
          <li key={item.cursor} className="run-canvas-tile__event">
            <span className="run-canvas-tile__event-kind mc-mono">{item.kind}</span>
            <span>{item.summary ?? item.status ?? 'public event'}</span>
          </li>
        )) : <li className="run-canvas-tile__event-empty">No public events for this agent yet.</li>}
      </ol>
      <form className="run-canvas-tile__message" onSubmit={(event) => void send(event)}>
        <label className="sr-only" htmlFor={`run-canvas-message-${agentId}`}>Message {agentId}</label>
        <textarea id={`run-canvas-message-${agentId}`} value={message} onChange={(event) => setMessage(event.target.value)}
          placeholder="Message agent" rows={2} disabled={sending} />
        <button type="submit" className="mc-btn" disabled={sending || message.trim() === ''}>{sending ? 'Sending…' : 'Send'}</button>
      </form>
      {deliveryNotice ? <p className="run-canvas-tile__delivery" role="status" data-testid={`run-canvas-tile-${agentId}-delivery`}>{deliveryNotice}</p> : null}
    </article>
  );
}

export interface RunCanvasBoardProps {
  detail: RunDetailDto;
  sessionToken: string;
  events: OperationalEventDto[];
  fetchImpl?: FetchLike;
  onNavigate?: (target: NavTarget) => void;
}

export function RunCanvasBoard({ detail, sessionToken, events, fetchImpl, onNavigate }: RunCanvasBoardProps): React.JSX.Element {
  const { agentIds, edges } = useMemo(() => deriveAgentGraph(detail), [detail]);
  const lanes = useMemo(() => deriveAgentLanes(agentIds, edges), [agentIds, edges]);
  return (
    <div className="run-canvas-board" data-testid="run-canvas-board">
      <div className="run-canvas-board__lanes">
        {lanes.map((lane, laneIndex) => <div key={laneIndex} className="run-canvas-board__lane" data-testid={`run-canvas-lane-${laneIndex}`}>
          {lane.map((agentId) => <AgentTile key={agentId} agentId={agentId} runRef={detail.run.runRef}
            sessionToken={sessionToken} events={events.filter((event) => eventBelongsToAgent(event, detail, agentId))}
            fetchImpl={fetchImpl} onNavigate={onNavigate} />)}
        </div>)}
      </div>
      {edges.length > 0 ? <p className="run-canvas-board__flow mc-mono" data-testid="run-canvas-flow">{edges.map((edge) => `${edge.from} → ${edge.to}`).join('   ')}</p> : null}
    </div>
  );
}

export interface RunCanvasProps {
  sessionToken?: string;
  onRequestSession?: () => Promise<Session | null>;
  onNavigate?: (target: NavTarget) => void;
  fetchImpl?: FetchLike;
  focusRunRef?: string | null;
}

export function RunCanvas({ sessionToken, onRequestSession, onNavigate, fetchImpl, focusRunRef }: RunCanvasProps): React.JSX.Element {
  const [localToken, setLocalToken] = useState(sessionToken);
  const [runs, setRuns] = useState<RunMetadataDto[]>([]);
  const [selectedRunRef, setSelectedRunRef] = useState<string | null>(focusRunRef ?? null);
  const [detail, setDetail] = useState<RunDetailDto | null>(null);
  const [events, setEvents] = useState<OperationalEventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [rateLimitBackoffMs, setRateLimitBackoffMs] = useState<number | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const token = sessionToken ?? localToken;

  useEffect(() => { if (sessionToken) setLocalToken(sessionToken); }, [sessionToken]);
  useEffect(() => {
    const invalidate = (): void => setLocalToken(undefined);
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidate);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidate);
  }, []);
  useEffect(() => { if (focusRunRef) setSelectedRunRef(focusRunRef); }, [focusRunRef]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    listRuns(token, fetchImpl).then((next) => { if (alive) setRuns(next); })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not load runs.'); });
    return () => { alive = false; };
  }, [token, fetchImpl]);

  const refreshDetail = useCallback(async (activeToken: string, runRef: string): Promise<void> => {
    try {
      const nextDetail = await getRun(runRef, activeToken, fetchImpl);
      setDetail(nextDetail);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the run canvas.');
    }
  }, [fetchImpl]);

  useEffect(() => {
    if (!token || !selectedRunRef) {
      setDetail(null);
      setEvents([]);
      return;
    }
    let alive = true;
    setDetail(null);
    setEvents([]);
    void refreshDetail(token, selectedRunRef);
    return () => { alive = false; };
  }, [refreshDetail, token, selectedRunRef]);

  useEffect(() => {
    if (!token || !selectedRunRef) {
      setPollError(null);
      setRateLimitBackoffMs(null);
      return;
    }
    let alive = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let nextPollMs = RUN_CANVAS_POLL_MS;
    setPollError(null);
    setRateLimitBackoffMs(null);

    const pollEvents = async (): Promise<void> => {
      try {
        const eventWindow = await loadRunEventWindow(
          selectedRunRef,
          token,
          (ref, after, limit, eventToken) => listRunEvents(ref, after, limit, eventToken, fetchImpl),
        );
        if (!alive) return;
        setEvents(eventWindow.events);
        setPollError(null);
        nextPollMs = RUN_CANVAS_POLL_MS;
        setRateLimitBackoffMs(null);
      } catch (cause) {
        if (!alive) return;
        if (cause instanceof ControlApiError && cause.status === 429) {
          nextPollMs = Math.min(nextPollMs * 2, RUN_CANVAS_MAX_POLL_MS);
          setRateLimitBackoffMs(nextPollMs);
        } else {
          setPollError(cause instanceof Error ? cause.message : 'Could not refresh run events.');
        }
      }
      if (alive) timeout = setTimeout(() => { void pollEvents(); }, nextPollMs);
    };

    void pollEvents();
    return () => {
      alive = false;
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [fetchImpl, selectedRunRef, token]);

  const unlock = (): void => {
    if (!onRequestSession || signingIn) return;
    setSigningIn(true);
    void onRequestSession().then((session) => { if (session) setLocalToken(session.token); }).finally(() => setSigningIn(false));
  };

  return <section className="v-run-canvas" aria-label="Run canvas">
    <header className="v-run-canvas__head"><h2>Run canvas</h2><p className="v-run-canvas__lede">Watch each agent&rsquo;s redacted public stream and send an operator message without opening a terminal.</p></header>
    {!token ? (onRequestSession ? <button type="button" className="mc-btn mc-btn--primary" onClick={unlock} disabled={signingIn} data-testid="run-canvas-signin">{signingIn ? 'Signing in…' : 'Sign in with your passkey to open the run canvas'}</button>
      : <p className="v-run-canvas__session-warning">Sign in with your passkey to open the run canvas.</p>) : <>
      {error ? <p role="alert" className="v-run-canvas__error">{error}</p> : null}
      {pollError ? <p role="alert" className="v-run-canvas__error">{pollError}</p> : null}
      {rateLimitBackoffMs ? <p role="status" className="v-run-canvas__rate-limit" data-testid="run-canvas-rate-limit">Rate-limited, backing off. Retrying in {rateLimitBackoffMs / 1_000}s.</p> : null}
      <RunGrid runs={runs} selectedRunRef={selectedRunRef} onSelect={setSelectedRunRef} />
      {selectedRunRef && detail ? <RunCanvasBoard detail={detail} sessionToken={token} events={events} fetchImpl={fetchImpl} onNavigate={onNavigate} />
        : selectedRunRef ? <p className="control-help">Loading the run canvas…</p> : <p className="control-help">Select a run above to open its canvas.</p>}
    </>}
  </section>;
}

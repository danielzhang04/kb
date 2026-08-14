/**
 * The run detail — one surface for one execution, reached from the workflow that produced it.
 *
 * This replaces four things that each showed a different slice of the same run and disagreed about the
 * vocabulary: the run canvas (agent stream tiles), the cockpit (stages/attempts/activity/changes), the
 * managed-runs wrapper (the governed mutations), and the whole-queue pipeline canvas. What an operator
 * needs while a run is live is here, in this order:
 * The frozen agent graph is the head; the step strip remains directly below it for plain-word scanning.
 *
 *   1. where it is        — the step strip, states in plain words;
 *   2. what it needs      — open human gates, answered here with the run in front of you;
 *   3. what it is doing   — one live stream tile per assigned agent, each with a message box back;
 *   4. what it produced   — the run's OWN queue cards, as a graph scoped to this run;
 *   5. everything else    — attempts, routing, the raw activity trace, diffs, storage: one fold.
 *
 * A tile is a bounded view of the broker's redacted public event stream, NOT a terminal: manual PTY
 * shells stay exclusively in `Terminal.tsx`, and calling this a terminal would promise a TTY that has no
 * route behind it. Governed mutations are unchanged from the cockpit — each still carries its exact
 * version/hash and idempotency key, and each mints at point of action through the shared session.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Dag, DagNodeData } from '../../server/dag/graph';
import { useSession } from '../lib/sessionContext';
import { useSse } from '../lib/sseClient';
import {
  activateRun,
  archiveRun,
  createManagerSuccessor,
  dryRunQuarantine,
  getProposalRevision,
  getRun,
  launchProposalRevision,
  listRunEvents,
  listRuns,
  quarantineRuns,
  reconcileAuthorizedFailedRun,
  rerouteManagedStage,
  resolveIterationGate,
  respondToHumanRequest,
  resumeRunAfterHumanResponse,
  sendManagerMessage,
  steerManagerAtCheckpoint,
  stopManager,
  ControlApiError,
  isAuthorizedFailedRunPublishedUncommitted,
  isAuthorizedFailedRunReconciliationCandidate,
  isAuthorizedFailedRunSettled,
  type AttemptDto,
  type FetchLike,
  type HumanRequestDecision,
  type HumanRequestDto,
  type ManagedSessionDto,
  type OperationalEventDto,
  type QuarantinePlanDto,
  type ResolvedAgentAssignmentDto,
  type RunDetailDto,
  type StageDto,
} from '../control/controlClient';
import { canResumePublishedRun } from '../control/humanBoundaries';
import { postAgentMessage } from '../control/agentMessages';
import {
  changeEvents,
  checkpointInfo,
  eventClock,
  eventLabel,
  isDiffTruncated,
  runStateLabel,
  runTone,
  timestampLabel,
} from '../control/runEvents';
import { loadRunEventWindow, type RunEventWindow } from '../control/runEventWindow';
import { entryFromRun, iterationEdgesFromRun, overlaysFromRun } from '../control/runGraph';
import { agentIdsForRun, cardOwnerIndex, agentLink, cardLink, workflowLink } from '../control/entityLinks';
import { EntityName } from '../components/EntityName';
import { AgentWorkPanel } from '../components/AgentWorkPanel';
import { HumanRequestCard } from '../components/HumanRequestCard';
import { entityRowProps } from '../components/entityRow';
import { EntityDetail, type DetailSection, type EntityLink } from '../entity/EntityDetail';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { NavTarget } from '../nav/stack';
import { WorkflowAgentGraph } from './WorkflowAgentGraph';
import '../control/control.css';

/** One poller serves every open tile for this run. */
export const RUN_POLL_MS = 5_000;
export const RUN_SSE_POLL_MS = 30_000;
export const RUN_SSE_FRESH_MS = 60_000;
export const RUN_MAX_POLL_MS = 60_000;

/* ============================================================================
 * Pure projections — each testable with a literal fixture, no fetch mock.
 * ========================================================================= */

export interface AgentGraphEdge { from: string; to: string }

interface GraphStage { stageId: string; dependsOn: string[]; assignment: { agentId: string } | null }
interface GraphRun { managerAssignment: { agentId: string } | null }

/** Derive the assigned-agent graph directly from the compiled step dependencies. */
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

export type TileBadgeKind = 'active' | 'waiting' | 'blocked' | 'idle';
export interface TileBadge { kind: TileBadgeKind; text: string }

export function tileBadge(events: readonly OperationalEventDto[]): TileBadge {
  const latest = events.at(-1);
  switch (latest?.status) {
    case 'running': return { kind: 'active', text: `working: ${latest.summary || 'in progress'}` };
    case 'waiting': return { kind: 'waiting', text: latest.summary || 'waiting on upstream work' };
    case 'failure': return { kind: 'blocked', text: `stuck: ${latest.summary || 'the worker failed'}` };
    case 'stopped': return { kind: 'blocked', text: `stuck: ${latest.summary || 'the worker stopped'}` };
    case 'interrupted': return { kind: 'blocked', text: `stuck: ${latest.summary || 'the worker was interrupted'}` };
    default: return { kind: 'idle', text: latest?.summary || 'idle' };
  }
}

const BADGE_DOT: Record<TileBadgeKind, string> = { active: 'running', waiting: 'idle', blocked: 'blocked', idle: 'idle' };

/** Resolve an event to a logical agent from immutable step/manager assignment, never event prose. */
export function eventBelongsToAgent(event: OperationalEventDto, detail: RunDetailDto, agentId: string): boolean {
  const stage = event.stageRef ? detail.stages.find((candidate) => candidate.stageRef === event.stageRef) : undefined;
  if (stage?.assignment?.agentId === agentId) return true;
  return event.source === 'manager'
    && event.sessionRef === detail.run.managerSessionRef
    && detail.run.managerAssignment?.agentId === agentId;
}

/** The queue cards this run owns, from each step's canonical card. */
export function runCardIds(detail: RunDetailDto): Set<string> {
  return new Set(detail.stages
    .map((stage) => stage.canonicalCardRef)
    .filter((ref): ref is string => typeof ref === 'string' && ref !== ''));
}

/** The whole-queue DAG, cut down to this run's own cards. Edges survive only when both ends do. */
export function scopeDagToRun(dag: Dag, cardIds: Set<string>): Dag {
  const nodes = dag.nodes.filter((node) => cardIds.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: dag.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
}

/** Longest-path rank of each node (0 for roots) — drives the layered left→right layout. */
function layoutDag(dag: Dag): Map<string, { x: number; y: number }> {
  const byId = new Map(dag.nodes.map((node) => [node.id, node]));
  const cache = new Map<string, number>();
  const rank = (id: string, stack: Set<string>): number => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node || stack.has(id)) return 0; // missing dependency or cycle guard
    stack.add(id);
    let value = 0;
    for (const dependency of node.data.dependsOn) {
      if (byId.has(dependency)) value = Math.max(value, rank(dependency, stack) + 1);
    }
    stack.delete(id);
    cache.set(id, value);
    return value;
  };
  const byRank = new Map<number, string[]>();
  for (const node of dag.nodes) {
    const r = rank(node.id, new Set());
    (byRank.get(r) ?? byRank.set(r, []).get(r)!).push(node.id);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [r, ids] of byRank) {
    ids.sort((a, b) => a.localeCompare(b));
    ids.forEach((id, index) => positions.set(id, { x: r * 280, y: index * 130 }));
  }
  return positions;
}

function cardDot(state: string, blocked: boolean): string {
  if (blocked) return 'blocked';
  if (['working', 'approvals', 'stop-requested', 'halting'].includes(state)) return 'running';
  if (['done', 'approved'].includes(state)) return 'done';
  if (['rejected', 'halted'].includes(state)) return 'error';
  return 'idle';
}

function logicalAssignment(assignment: ResolvedAgentAssignmentDto | null): string {
  return assignment ? `${assignment.agentId} · ${assignment.profileId}` : 'unassigned';
}

type RerouteDisposition =
  | { allowed: true; label: 'Can be re-routed before it starts' }
  | { allowed: false; label: 'Fixed by the plan' | 'Needs a fresh attempt' | 'Already finished' | 'Fixed by its assignment' };

function rerouteDisposition(detail: RunDetailDto, stage: StageDto, attempt: AttemptDto | undefined): RerouteDisposition {
  if (stage.assignment !== null) return { allowed: false, label: 'Fixed by its assignment' };
  if (stage.state === 'waiting-human' || detail.humanRequests.some((request) => request.stageRef === stage.stageRef)) {
    return { allowed: false, label: 'Fixed by the plan' };
  }
  if (['succeeded', 'failed', 'stopped'].includes(stage.state) || (attempt && ['succeeded', 'failed', 'stopped'].includes(attempt.state))) {
    return { allowed: false, label: 'Already finished' };
  }
  if (detail.run.publicationState !== 'published' || ['stopping', 'succeeded', 'failed', 'stopped'].includes(detail.run.state)) {
    return { allowed: false, label: 'Already finished' };
  }
  const session = detail.sessions.find((candidate) => candidate.sessionRef === attempt?.managedSessionRef);
  if (!attempt || !['ready', 'blocked'].includes(stage.state) || attempt.state !== 'queued' || session?.state !== 'pending') {
    return { allowed: false, label: 'Needs a fresh attempt' };
  }
  return { allowed: true, label: 'Can be re-routed before it starts' };
}

function operationKey(prefix: string): string {
  return `${prefix}:${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36)}`;
}

function humanIdempotencyKey(request: HumanRequestDto, decision: HumanRequestDecision): string {
  return `human:${request.requestRef}:${request.revision}:${decision}`;
}

/**
 * The headline for a request in the "Already answered" section.
 *
 * `request.ask` (server-derived, `humanRequestAsk.ts`) is written for an OPEN request: it is present
 * tense and ends in an instruction — "…needs your sign-off before it can go any further. Open the run
 * to approve or turn it down." Printing that under a resolved request, and especially under one the
 * platform auto-closed with nobody answering, makes a settled record read as a live demand. So a
 * resolved request gets a past-tense headline naming what it HAD asked for; the decision line below it
 * (decision · reason · timestamp) is untouched and remains the record of how it ended.
 *
 * Kind-keyed, not pattern-keyed: this says only what the request WAS, so it needs none of the ask
 * map's cause-detection. Typed as a total map over the kind union, so a new kind fails to compile here
 * rather than silently falling through to a vaguer sentence.
 */
const RESOLVED_HEADLINE: Record<HumanRequestDto['kind'], (runName: string) => string> = {
  approval: (runName) => `${runName} asked for your sign-off.`,
  review: (runName) => `${runName} asked you to review a finished step.`,
  input: (runName) => `${runName} asked you for an answer before carrying on.`,
  intervention: (runName) => `${runName} stopped and asked for a person to look at it.`,
  'governance-refusal': (runName) => `${runName} was refused on governance grounds and asked what to do next.`,
};

/**
 * {@link RESOLVED_HEADLINE} with a runtime floor. The map stays total over the kind union at COMPILE
 * time — a new kind still fails to build until it is given real words above — but the DTOs reaching this
 * view are unvalidated `as` casts off the wire, so a kind this build has never heard of (an older SPA
 * against a newer server) arrives typed but unmapped. Indexing then yields `undefined`, and calling it
 * throws a TypeError that unmounts the WHOLE run page over one settled record in a secondary section.
 * The fallback says the only thing certainly true of every resolved request, in the same past tense.
 */
function resolvedHeadline(request: HumanRequestDto): string {
  const headline = RESOLVED_HEADLINE[request.kind] as ((runName: string) => string) | undefined;
  return headline ? headline(request.displayName) : `${request.displayName} asked for a person, and this was answered.`;
}

/* ============================================================================
 * Section bodies.
 * ========================================================================= */

export interface AgentTileProps {
  agentId: string;
  runRef: string;
  events: OperationalEventDto[];
  fetchImpl?: FetchLike;
  onNavigate?: (target: NavTarget) => void;
}

/** One agent's live stream, plus the box that talks back to it. */
export function AgentTile({ agentId, runRef, events, fetchImpl, onNavigate }: AgentTileProps): React.JSX.Element {
  const { requireSession } = useSession();
  const badge = tileBadge(events);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setDeliveryNotice(null);
    try {
      // Point-of-action unlock: the operator's send IS the governed act, so it mints if this tab is locked.
      const token = (await requireSession())?.token;
      if (!token) {
        setDeliveryNotice('The dashboard is locked — your message was not delivered.');
        return;
      }
      const result = await postAgentMessage(runRef, agentId, text, token, fetchImpl);
      if ('offline' in result) {
        setDeliveryNotice('This agent is offline — your message was not delivered.');
      } else {
        setMessage('');
        setDeliveryNotice(result.delivery === 'queued' ? 'Queued for its next turn.' : 'Delivered live.');
      }
    } catch (cause) {
      setDeliveryNotice(cause instanceof Error ? cause.message : 'The message was refused.');
    } finally {
      setSending(false);
    }
  };

  return (
    <article className={`run-stream-tile run-stream-tile--${badge.kind}`} data-testid={`run-tile-${agentId}`}>
      <header className="run-stream-tile__head">
        <span className="mc-mono run-stream-tile__agent">{agentId}</span>
        <span className={`mc-status-dot mc-status-dot--${BADGE_DOT[badge.kind]}`} aria-hidden="true" data-testid={`run-tile-${agentId}-dot`} />
      </header>
      <p className="run-stream-tile__status" data-testid={`run-tile-${agentId}-badge`}>
        {badge.kind === 'blocked' && onNavigate ? <>{badge.text} — <button type="button" className="run-stream-tile__inbox-link"
          data-testid={`run-tile-${agentId}-inbox-link`} onClick={() => onNavigate({ view: 'approvals' })}>open Inbox</button></> : badge.text}
      </p>
      <ol className="run-stream-tile__transcript" data-testid={`run-tile-${agentId}-transcript`} aria-label={`${agentId} live stream`}>
        {events.length ? events.map((item) => (
          <li key={item.cursor} className="run-stream-tile__event">
            <span className="run-stream-tile__event-kind mc-mono">{item.kind}</span>
            <span>{item.summary ?? item.status ?? 'public event'}</span>
          </li>
        )) : <li className="run-stream-tile__event-empty">Nothing from this agent yet.</li>}
      </ol>
      <form className="run-stream-tile__message" onSubmit={(event) => void send(event)}>
        <label className="sr-only" htmlFor={`run-message-${agentId}`}>Message {agentId}</label>
        <textarea id={`run-message-${agentId}`} value={message} onChange={(event) => setMessage(event.target.value)}
          placeholder="Message this agent" rows={2} disabled={sending} />
        <button type="submit" className="mc-btn" disabled={sending || message.trim() === ''}>{sending ? 'Sending…' : 'Send'}</button>
      </form>
      {deliveryNotice ? <p className="run-stream-tile__delivery" role="status" data-testid={`run-tile-${agentId}-delivery`}>{deliveryNotice}</p> : null}
    </article>
  );
}

export function AgentStreams({ detail, events, fetchImpl, onNavigate }: {
  detail: RunDetailDto;
  events: OperationalEventDto[];
  fetchImpl?: FetchLike;
  onNavigate?: (target: NavTarget) => void;
}): React.JSX.Element {
  const { agentIds, edges } = useMemo(() => deriveAgentGraph(detail), [detail]);
  const lanes = useMemo(() => deriveAgentLanes(agentIds, edges), [agentIds, edges]);
  if (agentIds.length === 0) {
    return <p className="control-help" data-testid="run-streams-empty">No agent is assigned to this run yet.</p>;
  }
  return (
    <div className="run-streams" data-testid="run-streams">
      {lanes.map((lane, laneIndex) => (
        <div key={laneIndex} className="run-streams__lane" data-testid={`run-streams-lane-${laneIndex}`}>
          {lane.map((agentId) => (
            <AgentTile
              key={agentId}
              agentId={agentId}
              runRef={detail.run.runRef}
              events={events.filter((event) => eventBelongsToAgent(event, detail, agentId))}
              fetchImpl={fetchImpl}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface CardNodeData {
  data: DagNodeData;
  onOpenCard: (cardId: string) => void;
}

function CardNode({ data }: NodeProps<CardNodeData>): React.JSX.Element {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <div className={`run-card-node${data.data.blocked ? ' run-card-node--blocked' : ''}`} data-testid={`run-card-node-${data.data.id}`}>
        <header className="run-card-node__head">
          <span className={`mc-status-dot mc-status-dot--${cardDot(data.data.state, data.data.blocked)}`} aria-hidden="true" />
          <div
            className="run-card-node__name"
            aria-label={`Open ${data.data.displayName}`}
            {...entityRowProps(() => data.onOpenCard(data.data.id))}
          >
            <EntityName kind="card" id={data.data.id} displayName={data.data.displayName} shortRef={data.data.shortRef} />
          </div>
        </header>
        <p className="run-card-node__summary">{data.data.summary}</p>
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  );
}

const CARD_NODE_TYPES: NodeTypes = { runCard: CardNode };

/**
 * The run's own cards. The whole-queue canvas this replaces showed every card in the repo behind a run
 * picker, so the operator had to re-find their run inside a graph of everything.
 */
export function RunCardGraph({ dag, onOpenCard }: { dag: Dag; onOpenCard: (cardId: string) => void }): React.JSX.Element {
  const positions = useMemo(() => layoutDag(dag), [dag]);
  const nodes: Node<CardNodeData>[] = useMemo(() => dag.nodes.map((node) => ({
    id: node.id,
    type: 'runCard',
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: { data: node.data, onOpenCard },
  })), [dag, positions, onOpenCard]);
  const edges: Edge[] = useMemo(
    () => dag.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
    [dag],
  );
  if (dag.nodes.length === 0) {
    return <p className="control-help" data-testid="run-cards-empty">This run has not published any queue cards yet.</p>;
  }
  return (
    <div className="run-card-graph" data-testid="run-card-graph">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={CARD_NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

/** One attempt in a step's chain. */
function AttemptRow({ attempt, session, current }: {
  attempt: AttemptDto;
  session: ManagedSessionDto | undefined;
  current: boolean;
}): React.JSX.Element {
  return (
    <li className={`run-attempt${current ? ' run-attempt--current' : ''}`} data-testid={`run-attempt-${attempt.attemptRef}`}>
      <span className="run-attempt__head">
        <span className="mc-mono">attempt {attempt.generation}</span>
        <span className="run-attempt__state">{attempt.state}</span>
        {current ? <span className="run-attempt__current-tag">current</span> : null}
      </span>
      <span className="mc-mono run-attempt__routing">{attempt.runtime} · {attempt.model}</span>
      {attempt.predecessorAttemptRef ? (
        <span className="mc-mono run-attempt__meta">retry of {attempt.predecessorAttemptRef}</span>
      ) : null}
      {attempt.managedSessionRef ? (
        <span className="mc-mono run-attempt__meta">
          session {attempt.managedSessionRef}{session ? ` · ${session.role} · ${session.state}` : ''}
        </span>
      ) : null}
      <span className="mc-mono run-attempt__meta">
        {timestampLabel(attempt.createdAt)} → {timestampLabel(attempt.updatedAt)}
      </span>
    </li>
  );
}

export interface StepsSectionProps {
  detail: RunDetailDto;
  busy: boolean;
  routingDrafts: Record<string, { runtime: string; model: string }>;
  onDraftChange: (stageRef: string, next: { runtime: string; model: string }) => void;
  onReroute?: (stage: StageDto, attempt: AttemptDto, runtime: string, model: string) => void | Promise<void>;
  onNavigate?: (target: NavTarget) => void;
}

/** The full per-step record: dependencies, canonical card, and the WHOLE attempt chain. */
export function StepsSection({
  detail, busy, routingDrafts, onDraftChange, onReroute, onNavigate,
}: StepsSectionProps): React.JSX.Element {
  return (
    <ol className="run-stages" data-testid="run-steps">
      {detail.stages.map((stage) => {
        const chain = detail.attempts
          .filter((item) => item.stageRef === stage.stageRef)
          .sort((a, b) => a.generation - b.generation);
        const attempt = detail.attempts.find((item) => item.attemptRef === stage.currentAttemptRef);
        const disposition = rerouteDisposition(detail, stage, attempt);
        const draft = routingDrafts[stage.stageRef] ?? { runtime: attempt?.runtime ?? '', model: attempt?.model ?? '' };
        const unchanged = attempt?.runtime === draft.runtime.trim() && attempt?.model === draft.model.trim();
        const updateDraft = (next: Partial<{ runtime: string; model: string }>): void => {
          onDraftChange(stage.stageRef, { ...draft, ...next });
        };
        return (
          <li key={stage.stageRef} className="run-stage" data-testid={`run-step-${stage.stageRef}`}>
            <div className="run-stage__head">
              <strong>{stage.title}</strong>
              <span className="run-stage__state">{stage.state}</span>
            </div>
            <div className="run-stage__facts">
              <span className="mc-mono">{stage.stageId}</span>
              <span className="mc-mono" data-testid={`run-step-${stage.stageRef}-depends`}>
                {stage.dependsOn.length ? `after ${stage.dependsOn.join(', ')}` : 'starts the run'}
              </span>
              {stage.canonicalCardRef ? (
                onNavigate ? (
                  <button
                    type="button"
                    className="run-stage__card-link mc-mono"
                    data-testid={`run-step-${stage.stageRef}-card`}
                    onClick={() => onNavigate(cardLink(stage.canonicalCardRef!))}
                  >
                    {stage.canonicalCardRef}
                  </button>
                ) : (
                  <span className="mc-mono">{stage.canonicalCardRef}</span>
                )
              ) : (
                <span className="mc-mono">card pending</span>
              )}
              <span className="mc-mono">{timestampLabel(stage.createdAt)} → {timestampLabel(stage.updatedAt)}</span>
              <span data-testid={`run-step-${stage.stageRef}-assignment`}>
                Assigned to <span className="mc-mono">{logicalAssignment(stage.assignment)}</span>
              </span>
            </div>

            {chain.length ? (
              <ol className="run-attempts" data-testid={`run-step-${stage.stageRef}-attempts`}>
                {chain.map((item) => (
                  <AttemptRow
                    key={item.attemptRef}
                    attempt={item}
                    session={detail.sessions.find((session) => session.sessionRef === item.managedSessionRef)}
                    current={item.attemptRef === stage.currentAttemptRef}
                  />
                ))}
              </ol>
            ) : (
              <p className="control-help">No attempts recorded for this step yet.</p>
            )}

            <span className="run-stage__disposition">{disposition.label}</span>
            {attempt && disposition.allowed ? (
              <div className="control-form">
                <label htmlFor={`reroute-runtime-${stage.stageRef}`}>Runtime for {stage.title}</label>
                <input id={`reroute-runtime-${stage.stageRef}`} value={draft.runtime} disabled={busy}
                  onChange={(event) => updateDraft({ runtime: event.target.value })} />
                <label htmlFor={`reroute-model-${stage.stageRef}`}>Model for {stage.title}</label>
                <input id={`reroute-model-${stage.stageRef}`} value={draft.model} disabled={busy}
                  onChange={(event) => updateDraft({ model: event.target.value })} />
                <button
                  type="button"
                  className="mc-btn"
                  disabled={busy || !onReroute || unchanged || !draft.runtime.trim() || !draft.model.trim()}
                  onClick={() => void onReroute?.(stage, attempt, draft.runtime.trim(), draft.model.trim())}
                >
                  Re-route {stage.title}
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The activity stream — a dense, single-column operational trace.
 *
 * NOT a terminal, and never labelled as one: the broker yields normalized, redacted events only.
 */
export function ActivityStream({ events }: { events: OperationalEventDto[] }): React.JSX.Element {
  if (!events.length) return <p className="control-help">No activity recorded yet.</p>;
  return (
    <ol className="run-activity" data-testid="run-activity">
      {events.map((event) => {
        const checkpoint = checkpointInfo(event);
        return (
          <li key={event.cursor} className={`run-activity__row run-activity__row--${event.kind}`} data-testid={`run-event-${event.cursor}`}>
            <span className="mc-mono run-activity__time" title={timestampLabel(event.createdAt)}>{eventClock(event.createdAt)}</span>
            <span className="mc-mono run-activity__kind">{event.kind}</span>
            <span className="run-activity__text">
              {checkpoint ? (
                <>
                  {/* Name and state are DISTINCT; the old flattening rendered the state and dropped the name. */}
                  <span className="mc-mono" data-testid={`run-event-${event.cursor}-checkpoint-name`}>{checkpoint.name}</span>
                  {checkpoint.state ? (
                    <span className={`run-activity__checkpoint run-activity__checkpoint--${checkpoint.state}`}
                      data-testid={`run-event-${event.cursor}-checkpoint-state`}>{checkpoint.state}</span>
                  ) : null}
                  {checkpoint.detail ? <span className="run-activity__detail">{checkpoint.detail}</span> : null}
                </>
              ) : eventLabel(event)}
            </span>
            <span className="mc-mono run-activity__attribution">
              {event.stageRef ?? '—'}{event.attemptRef ? ` · ${event.attemptRef}` : ''}
            </span>
            <span className="run-activity__status">{event.status ?? event.source}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** File changes. `event.diff` is on the wire on every load and was, before the cockpit, never rendered. */
export function ChangesSection({ events }: { events: OperationalEventDto[] }): React.JSX.Element {
  const changes = changeEvents(events);
  if (!changes.length) return <p className="control-help">No file changes have been recorded for this run yet.</p>;
  return (
    <>
      {/* A redacted, 64KB-clipped diff rendered raw LOOKS complete, which is the failure mode: an
        * operator reviewing a change has to know what they are not seeing. */}
      <p className="control-help" data-testid="run-changes-note">
        Diffs are redacted server-side and each is capped at 64KB; treat this as a review aid, not the
        authoritative patch. Individually truncated diffs are marked.
      </p>
      <ol className="run-changes" data-testid="run-changes">
        {changes.map((event) => (
          <li key={event.cursor} className="run-change" data-testid={`run-change-${event.cursor}`}>
            <div className="run-change__head">
              <code className="mc-mono run-change__path">{event.path ?? 'unknown path'}</code>
              <span className="mc-mono run-change__meta">
                {eventClock(event.createdAt)}{event.attemptRef ? ` · ${event.attemptRef}` : ''}
              </span>
            </div>
            <pre className="run-change__diff" data-testid={`run-change-${event.cursor}-diff`}>{event.diff}</pre>
            {isDiffTruncated(event) ? (
              <p className="run-change__truncated" data-testid={`run-change-${event.cursor}-truncated`}>
                Truncated at the 64KB cap — the rest of this diff is not on the wire.
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  );
}

/* ============================================================================
 * The composed run surface.
 * ========================================================================= */

export interface RunDetailProps {
  runRef: string;
  onBack?: () => void;
  backLabel?: string;
  onNavigate?: (target: NavTarget) => void;
  /** Injectable clock so ages are deterministic under test. */
  now?: number;
  /** Injected by tests; when present this view does not fetch or poll. */
  detail?: RunDetailDto;
  events?: OperationalEventDto[];
  eventWindow?: RunEventWindow;
  dag?: Dag;
  cardIndex?: PlaneAIndex;
  checkpoints?: Array<{ id: string; label: string }>;
  fetchImpl?: FetchLike;
}

export function RunDetail({
  runRef,
  onBack,
  backLabel = 'Back',
  onNavigate,
  detail: injectedDetail,
  events: injectedEvents,
  eventWindow: injectedWindow,
  dag: injectedDag,
  cardIndex,
  checkpoints: injectedCheckpoints,
  fetchImpl,
}: RunDetailProps): React.JSX.Element {
  const { session, requireSession } = useSession();
  const sse = useSse('/events');
  const token = session?.token;
  const [detail, setDetail] = useState<RunDetailDto | null>(injectedDetail ?? null);
  const [events, setEvents] = useState<OperationalEventDto[]>(injectedEvents ?? []);
  const [eventWindow, setEventWindow] = useState<RunEventWindow | undefined>(injectedWindow);
  const [checkpoints, setCheckpoints] = useState<Array<{ id: string; label: string }>>(injectedCheckpoints ?? []);
  const [dag, setDag] = useState<Dag | null>(injectedDag ?? null);
  const [index, setIndex] = useState<PlaneAIndex | null>(cardIndex ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [backoffMs, setBackoffMs] = useState<number | null>(null);
  const [lastControlFrameAt, setLastControlFrameAt] = useState<number | null>(null);
  /**
   * The runRef the server says does not exist. Distinct from `error` on purpose: a missing run is not a
   * transient failure to retry, it is a permanent answer the operator needs stated.
   */
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState('');
  const [checkpoint, setCheckpoint] = useState('');
  const [instruction, setInstruction] = useState('');
  const [routingDrafts, setRoutingDrafts] = useState<Record<string, { runtime: string; model: string }>>({});
  /** The operator's own words for WHY a dead run is being dismissed; carried into the T3 audit row. */
  const [archiveReason, setArchiveReason] = useState('');
  const [quarantinePlan, setQuarantinePlan] = useState<QuarantinePlanDto | null>(null);
  const [quarantineNotice, setQuarantineNotice] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const live = injectedDetail === undefined;

  /**
   * Load the run, the TAIL of its trace, and the checkpoint names its plan already declares.
   *
   * The checkpoint list turns steering from a field the operator had to type from memory into a pick
   * list. A failure there is non-fatal: steering degrades to free text rather than becoming unavailable.
   */
  const loadRun = useCallback(async (activeToken: string, ref: string): Promise<void> => {
    const [nextDetail, nextWindow] = await Promise.all([
      getRun(ref, activeToken, fetchImpl),
      loadRunEventWindow(ref, activeToken, (target, after, limit, eventToken) => listRunEvents(target, after, limit, eventToken, fetchImpl)),
    ]);
    setDetail(nextDetail);
    setEvents(nextWindow.events);
    setEventWindow(nextWindow);
    try {
      const revision = await getProposalRevision(nextDetail.run.proposalRef, nextDetail.run.proposalRevision, activeToken, fetchImpl);
      const seen = new Map<string, { id: string; label: string }>();
      for (const stage of revision.proposal.stages) {
        for (const point of stage.checkpoints) if (!seen.has(point.id)) seen.set(point.id, point);
      }
      setCheckpoints([...seen.values()]);
    } catch {
      setCheckpoints([]);
    }
  }, [fetchImpl]);

  // First load. A 404 is an ANSWER, not a failure: the run is gone and the operator gets told so.
  useEffect(() => {
    if (!live) return;
    setDetail(null);
    setEvents([]);
    setEventWindow(undefined);
    setMissing(false);
    if (!token) return;
    let alive = true;
    loadRun(token, runRef).catch((cause: unknown) => {
      if (!alive) return;
      if (cause instanceof ControlApiError && cause.status === 404) setMissing(true);
      else setError(cause instanceof Error ? cause.message : 'Could not load this run.');
    });
    return () => { alive = false; };
  }, [live, loadRun, runRef, token]);

  // Control ticks carry no state payload. They only say the operator's run view is stale, so reuse the
  // normal read path immediately and let the existing rate-limit/backoff discipline govern every fetch.
  useEffect(() => {
    if (!live || !token || missing || sse.last?.channel !== 'control' || sse.last.kind !== 'store-change') return;
    let alive = true;
    setLastControlFrameAt(Date.now());
    setBackoffMs(null);
    setPollError(null);
    loadRun(token, runRef).catch((cause: unknown) => {
      if (!alive) return;
      if (cause instanceof ControlApiError && cause.status === 404) setMissing(true);
      else setPollError(cause instanceof Error ? cause.message : 'Could not refresh this run.');
    });
    return () => { alive = false; };
  }, [live, loadRun, missing, runRef, sse.last, token]);

  // The live stream. One poller for every tile, with backoff on a rate limit rather than a tighter loop.
  useEffect(() => {
    if (!live || !token || missing) return;
    let alive = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const basePollMs = (): number => lastControlFrameAt !== null && Date.now() - lastControlFrameAt < RUN_SSE_FRESH_MS
      ? RUN_SSE_POLL_MS
      : RUN_POLL_MS;
    let nextPollMs = basePollMs();
    const poll = async (): Promise<void> => {
      try {
        const window = await loadRunEventWindow(runRef, token,
          (target, after, limit, eventToken) => listRunEvents(target, after, limit, eventToken, fetchImpl));
        if (!alive) return;
        setEvents(window.events);
        setEventWindow(window);
        setPollError(null);
        nextPollMs = basePollMs();
        setBackoffMs(null);
      } catch (cause) {
        if (!alive) return;
        if (cause instanceof ControlApiError && cause.status === 429) {
          nextPollMs = Math.min(nextPollMs * 2, RUN_MAX_POLL_MS);
          setBackoffMs(nextPollMs);
        } else {
          setPollError(cause instanceof Error ? cause.message : 'Could not refresh this run.');
        }
      }
      if (alive) timeout = setTimeout(() => { void poll(); }, nextPollMs);
    };
    timeout = setTimeout(() => { void poll(); }, basePollMs());
    return () => { alive = false; if (timeout !== undefined) clearTimeout(timeout); };
  }, [fetchImpl, lastControlFrameAt, live, missing, runRef, token]);

  /**
   * The card graph and the card owner index are LINK/PROJECTION decoration: both swallow failure, because
   * a run detail that refused to render over a 404'd decoration fetch would be broken, not careful.
   */
  useEffect(() => {
    if (injectedDag || typeof fetch !== 'function') return;
    let alive = true;
    fetch('/api/dag')
      .then((r) => r.json() as Promise<Dag>)
      .then((d) => { if (alive && d?.nodes) setDag(d); })
      .catch(() => { /* the card graph degrades to its empty state */ });
    return () => { alive = false; };
  }, [injectedDag]);

  useEffect(() => {
    if (cardIndex || typeof fetch !== 'function') return;
    let alive = true;
    fetch('/api/index')
      .then((r) => r.json() as Promise<PlaneAIndex>)
      .then((d) => { if (alive) setIndex(d); })
      .catch(() => { /* agent links are simply absent */ });
    return () => { alive = false; };
  }, [cardIndex]);

  /** Every governed mutation goes through here: one unlock, one busy latch, one honest error. */
  const govern = useCallback(async (label: string, action: (token: string) => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const active = (await requireSession())?.token;
      if (!active) {
        setError(`The dashboard is locked — ${label} did not run.`);
        return;
      }
      await action(active);
      await loadRun(active, runRef);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} was refused.`);
    } finally {
      setBusy(false);
    }
  }, [busy, loadRun, requireSession, runRef]);
  const runGraph = useMemo(() => detail
    ? { entry: entryFromRun(detail), overlays: overlaysFromRun(detail), iterationEdges: iterationEdgesFromRun(detail) }
    : null, [detail]);

  useEffect(() => {
    if (selectedAgentId === null) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelectedAgentId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedAgentId]);

  if (missing) {
    return (
      <div className="entity-missing" data-testid="run-not-found">
        {onBack ? (
          <button type="button" className="entity-detail__back" data-testid="run-not-found-back" onClick={onBack}>
            <span aria-hidden="true">←</span> {backLabel}
          </button>
        ) : null}
        <h3>This run no longer exists</h3>
        <p className="mc-mono entity-missing__ref" data-testid="run-not-found-ref">{runRef}</p>
        <p className="control-help">
          Nothing has a record of it — stored runs are pruned, so links and retry lineage can outlive the
          run they point at. Nothing can be started or stopped for it.
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="run-detail-loading" data-testid="run-loading">
        {onBack ? (
          <button type="button" className="entity-detail__back" onClick={onBack}>
            <span aria-hidden="true">←</span> {backLabel}
          </button>
        ) : null}
        <p className="control-help">
          {token ? 'Loading this run…' : 'Unlock the dashboard to watch this run.'}
        </p>
        {error ? <p role="alert" className="control-error">{error}</p> : null}
      </div>
    );
  }

  const openRequests = detail.humanRequests.filter((request) => request.state === 'open');
  const resolvedRequests = detail.humanRequests.filter((request) => request.state !== 'open');
  const completionLoopByRequestRef = new Map((detail.iterationLoops ?? [])
    .filter((loop) => loop.completionGateRef !== undefined)
    .map((loop) => [loop.completionGateRef!, loop]));
  const manager = detail.sessions.find((item) => item.sessionRef === detail.run.managerSessionRef);
  const managerRunning = manager?.state === 'running';
  const resumeAvailable = canResumePublishedRun(detail);
  const reconciliationAvailable = isAuthorizedFailedRunReconciliationCandidate(detail, events);
  // The settlement leaves a terminal run with every step stopped — the exact profile Retry accepts. The
  // store refuses a successor for it, so this states that instead of offering the click.
  const retryRefusal = isAuthorizedFailedRunSettled(detail, events)
    ? 'Settled by the authorized 2026-08-01 reconciliation; this run can never have a successor.'
    : undefined;
  // Archiving is for runs that are already over or parked: a live run is stopped first, on its own path.
  const archivable = ['waiting-human', 'failed', 'interrupted', 'succeeded', 'stopped'].includes(detail.run.state);
  const archiveRefusal = detail.run.state === 'archived'
    ? 'Already archived.'
    : archivable ? undefined : 'Stop this run before archiving it.';
  const cardOwners = index ? cardOwnerIndex(index) : undefined;
  const scopedDag = scopeDagToRun(dag ?? { nodes: [], edges: [] }, runCardIds(detail));

  /**
   * What the operator is actually looking at in the activity trace, said plainly. The third case is the
   * one that must not be papered over: at the paging bound `events` is an interior slice — neither the
   * head nor the tail — and calling it "the most recent" would be a lie.
   */
  const windowNote = ((): string | null => {
    if (!eventWindow) return null;
    if (eventWindow.complete && eventWindow.seen <= events.length) return null;
    if (eventWindow.complete) {
      return `Showing the most recent ${events.length} of ${eventWindow.seen} entries; earlier ones are not loaded.`;
    }
    return `This run has more than ${eventWindow.seen} entries — more than this view will page through, `
      + `so these ${events.length} are from the middle and the newest are NOT shown.`;
  })();

  const respond = (request: HumanRequestDto, decision: HumanRequestDecision, response: string): void => {
    const iterationLoop = completionLoopByRequestRef.get(request.requestRef);
    void govern('your answer', async (active) => {
      if (iterationLoop) {
        await resolveIterationGate(request.requestRef, {
          expectedGateRef: request.requestRef,
          expectedGateKind: null,
          expectedParkReason: null,
          expectedRequestRevision: request.revision,
          expectedLoopVersion: iterationLoop.version,
          expectedGenerationRefs: iterationLoop.activeGenerationRefs,
          decision: decision as Extract<HumanRequestDecision, 'approved' | 'rejected' | 'changes-requested'>,
          idempotencyKey: humanIdempotencyKey(request, decision),
          response: response || null,
        }, active, fetchImpl);
      } else {
        await respondToHumanRequest(request.requestRef, {
          expectedRevision: request.revision, decision,
          idempotencyKey: humanIdempotencyKey(request, decision), response: response || null,
        }, active, fetchImpl);
      }
      if ((!iterationLoop && (decision === 'approved' || decision === 'responded')) || (iterationLoop && decision === 'approved')) {
        await resumeRunAfterHumanResponse(request.runRef, active, fetchImpl);
      }
    });
  };

  const submitManagerMessage = (event: FormEvent): void => {
    event.preventDefault();
    const value = message.trim();
    if (!value) return;
    setMessage('');
    void govern('your message', (active) => sendManagerMessage(detail.run.runRef, {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: operationKey(`manager-message:${detail.run.runRef}`), message: value,
    }, active, fetchImpl).then(() => undefined));
  };

  const submitSteer = (event: FormEvent): void => {
    event.preventDefault();
    const target = checkpoint.trim();
    const value = instruction.trim();
    if (!target || !value) return;
    setInstruction('');
    void govern('your instruction', (active) => steerManagerAtCheckpoint(detail.run.runRef, {
      expectedRunVersion: detail.run.version,
      expectedManagerGeneration: detail.run.managerGeneration,
      idempotencyKey: operationKey(`manager-steer:${detail.run.runRef}`), checkpoint: target, instruction: value,
    }, active, fetchImpl).then(() => undefined));
  };

  const stop = (): void => void govern('stopping this run', (active) => stopManager(detail.run.runRef, {
    expectedRunVersion: detail.run.version,
    expectedManagerGeneration: detail.run.managerGeneration,
    idempotencyKey: `manager-stop:${detail.run.runRef}:${detail.run.managerGeneration}`,
  }, active, fetchImpl).then(() => undefined));

  const resume = (): void => void govern('resuming this run', (active) =>
    activateRun(detail.run, active, fetchImpl).then(() => undefined));

  /**
   * Dismiss this run for good (spec §3b). Only offered once the run is settled or parked — live work is
   * stopped on its own path first — and the point-of-action unlock is `govern`'s, the same one every
   * other governed button here uses. One click: the reason beside it is optional.
   */
  const archive = (): void => void govern('archiving this run', (active) =>
    archiveRun(detail.run, archiveReason.trim() || null, active, fetchImpl).then(() => setArchiveReason('')));

  const retry = (): void => void govern('the retry', async (active) => {
    const successor = await launchProposalRevision(detail.run.proposalRef, detail.run.proposalRevision, {
      expectedHash: detail.run.proposalHash,
      idempotencyKey: `retry:${detail.run.runRef}:${detail.run.version}`,
      predecessorRunRef: detail.run.runRef,
      expectedPredecessorVersion: detail.run.version,
    }, active, fetchImpl);
    // Follow the successor: the operator's attention belongs on the run they just created.
    onNavigate?.({ view: 'workflows', focus: { kind: 'run', id: successor.runRef } });
  });

  const startSuccessorManager = (): void => {
    if (!manager) return;
    void govern('the restart', (active) => createManagerSuccessor(detail.run.runRef, {
      expectedManagerGeneration: detail.run.managerGeneration,
      runtime: manager.runtime, model: manager.model,
      idempotencyKey: `manager-successor:${detail.run.runRef}:${detail.run.managerGeneration + 1}`,
    }, active, fetchImpl).then(() => undefined));
  };

  const reconcile = (): void => void govern('the settlement', async (active) => {
    try {
      await reconcileAuthorizedFailedRun(active, fetchImpl);
    } catch (cause) {
      // Truthful, not merely safe: a durable settlement whose control-plane record is outstanding is NOT
      // a refusal, and saying it was refused would hide a completed ops write.
      throw isAuthorizedFailedRunPublishedUncommitted(cause)
        ? new Error('The settlement is published on ops; only its record is outstanding — run it again to finalize.')
        : cause;
    }
  });

  const reroute = (stage: StageDto, attempt: AttemptDto, runtime: string, model: string): void => {
    void govern('the re-route', (active) => rerouteManagedStage(detail.run.runRef, stage.stageRef, {
      expectedStageVersion: stage.version,
      expectedAttemptRef: attempt.attemptRef,
      expectedAttemptVersion: attempt.version,
      runtime, model,
      idempotencyKey: operationKey(`stage-reroute:${stage.stageRef}:${attempt.attemptRef}`),
    }, active, fetchImpl).then(() => undefined));
  };

  /** Storage clean-up, kept to the one action that is meaningful for a single run. Reversible: the
   *  server re-checks the whole run bundle after review, and there is intentionally no purge. */
  const reviewQuarantine = (): void => void govern('the review', async (active) => {
    setQuarantineNotice(null);
    setQuarantinePlan(await dryRunQuarantine([detail.run.runRef], active, fetchImpl));
  });
  const confirmQuarantine = (): void => {
    if (!quarantinePlan) return;
    void govern('archiving', async (active) => {
      await quarantineRuns(quarantinePlan.items.map((item) => item.runRef), quarantinePlan.planHash, active, fetchImpl);
      setQuarantinePlan(null);
      setQuarantineNotice('Archived. Its stored data is out of the way and can be restored.');
      await listRuns(active, fetchImpl);
    });
  };

  const body = (
    <>
      {error ? <p role="alert" className="control-error">{error}</p> : null}
      {pollError ? <p role="alert" className="control-error">{pollError}</p> : null}
      {backoffMs ? (
        <p role="status" className="control-help" data-testid="run-rate-limit">
          Rate-limited, backing off. Retrying in {backoffMs / 1_000}s.
        </p>
      ) : null}

      <section className="entity-block" aria-label="Run graph">
        <h3 className="entity-block__title">Run graph</h3>
        <WorkflowAgentGraph
          entry={runGraph!.entry}
          readOnly
          runOverlay={{ runRef: detail.run.runRef, overlays: runGraph!.overlays, iterationEdges: runGraph!.iterationEdges, sse, onOpenPanel: setSelectedAgentId }}
        />
        {selectedAgentId !== null ? (
          <AgentWorkPanel runRef={detail.run.runRef} agentId={selectedAgentId} run={detail}
            overlay={runGraph!.overlays[selectedAgentId]} sse={sse} onClose={() => setSelectedAgentId(null)} busy={busy}
            onRespondRequest={(request, decision, response) => respond(request, decision, response)} />
        ) : null}
      </section>

      <section className="entity-block" aria-label="Steps">
        <h3 className="entity-block__title">Steps</h3>
        <ol className="run-strip" data-testid="run-strip">
          {detail.stages.map((stage) => (
            <li key={stage.stageRef} className="run-strip__step" data-testid={`run-strip-${stage.stageRef}`}>
              <span className={`mc-status-dot mc-status-dot--${runDotForStage(stage.state)}`} aria-hidden="true" />
              <span className="run-strip__name">{stage.title}</span>
              <span className="run-strip__state">{stage.state}</span>
            </li>
          ))}
          {detail.stages.length === 0 ? <li className="control-help">This run has no steps.</li> : null}
        </ol>
      </section>

      {openRequests.length ? (
        <section className="entity-block" aria-label="Waiting on you" data-testid="run-gates">
          <h3 className="entity-block__title">Waiting on you</h3>
          {openRequests.map((request) => (
            <HumanRequestCard key={request.requestRef} request={request} busy={busy}
              onRespond={(decision, response) => respond(request, decision, response)}
              showPrompt={completionLoopByRequestRef.has(request.requestRef)} />
          ))}
        </section>
      ) : null}

      <section className="entity-block" aria-label="Agents">
        <h3 className="entity-block__title">Agents</h3>
        <p className="entity-note">
          Each agent&rsquo;s visible work, and a box to talk back to it. Private reasoning and raw tool
          payloads are not part of this feed.
        </p>
        <AgentStreams detail={detail} events={events} fetchImpl={fetchImpl} onNavigate={onNavigate} />
      </section>

      <section className="entity-block" aria-label="Cards">
        <h3 className="entity-block__title">Cards</h3>
        <RunCardGraph dag={scopedDag} onOpenCard={(cardId) => onNavigate?.(cardLink(cardId))} />
      </section>

      <details className="entity-fold" data-testid="run-technical">
        <summary>Technical details</summary>
        <div className="entity-fold__body">
          <dl className="entity-kv">
            <div className="entity-kv__row"><dt>Run</dt><dd className="mc-mono">{detail.run.runRef}</dd></div>
            <div className="entity-kv__row"><dt>Publication</dt><dd className="mc-mono">{detail.run.publicationState}</dd></div>
            <div className="entity-kv__row"><dt>Plan</dt><dd className="mc-mono">{detail.run.proposalRef} · r{detail.run.proposalRevision}</dd></div>
            {/* In FULL. A sliced hash cannot be compared against anything, which is its only use. */}
            <div className="entity-kv__row"><dt>Plan hash</dt><dd className="mc-mono">{detail.run.proposalHash}</dd></div>
            <div className="entity-kv__row"><dt>Run version</dt><dd className="mc-mono">{detail.run.version}</dd></div>
            <div className="entity-kv__row"><dt>Manager</dt><dd className="mc-mono">
              generation {detail.run.managerGeneration} · {manager ? `${manager.runtime} · ${manager.model} · ${manager.state}` : 'recovering'}
            </dd></div>
            <div className="entity-kv__row"><dt>Assigned manager</dt><dd className="mc-mono">{logicalAssignment(detail.run.managerAssignment)}</dd></div>
            <div className="entity-kv__row"><dt>Created</dt><dd className="mc-mono">{timestampLabel(detail.run.createdAt)}</dd></div>
            <div className="entity-kv__row"><dt>Updated</dt><dd className="mc-mono">{timestampLabel(detail.run.updatedAt)}</dd></div>
          </dl>

          <h4 className="entity-block__title">Manager</h4>
          <form className="control-form" onSubmit={submitManagerMessage}>
            <label htmlFor="manager-message">Message the manager</label>
            <textarea id="manager-message" value={message} disabled={busy || !managerRunning}
              onChange={(event) => setMessage(event.target.value)} />
            <button type="submit" className="mc-btn" disabled={busy || !managerRunning || !message.trim()}>Send</button>
          </form>
          <form className="control-form" onSubmit={submitSteer}>
            <label htmlFor="manager-checkpoint">Change course at</label>
            {/* The plan already names every valid checkpoint. Making the operator type one from memory —
             *  and silently fail on a typo — was a defect. Free text remains the fallback ONLY when the
             *  list could not be loaded, so steering is never blocked. */}
            {checkpoints.length ? (
              <select id="manager-checkpoint" value={checkpoint} disabled={busy || !managerRunning}
                onChange={(event) => setCheckpoint(event.target.value)}>
                <option value="">Pick a safe point…</option>
                {checkpoints.map((option) => <option key={option.id} value={option.id}>{option.label || option.id}</option>)}
              </select>
            ) : (
              <input id="manager-checkpoint" value={checkpoint} disabled={busy || !managerRunning}
                onChange={(event) => setCheckpoint(event.target.value)} />
            )}
            <label htmlFor="manager-steer">What to do instead</label>
            <textarea id="manager-steer" value={instruction} disabled={busy || !managerRunning}
              onChange={(event) => setInstruction(event.target.value)} />
            <p className="control-help">This is queued and applies only when the run reaches that point.</p>
            <button type="submit" className="mc-btn" disabled={busy || !managerRunning || !checkpoint.trim() || !instruction.trim()}>
              Queue it
            </button>
          </form>
          {manager && ['interrupted', 'failed', 'stopped', 'completed'].includes(manager.state) && !resumeAvailable ? (
            <button type="button" className="mc-btn" disabled={busy} onClick={startSuccessorManager}>Start a replacement manager</button>
          ) : null}

          <h4 className="entity-block__title">Steps in full</h4>
          <StepsSection
            detail={detail}
            busy={busy}
            routingDrafts={routingDrafts}
            onDraftChange={(stageRef, next) => setRoutingDrafts((current) => ({ ...current, [stageRef]: next }))}
            onReroute={reroute}
            onNavigate={onNavigate}
          />

          <h4 className="entity-block__title">Activity</h4>
          {windowNote ? <p className="control-help" data-testid="run-activity-window-note">{windowNote}</p> : null}
          <ActivityStream events={events} />

          <h4 className="entity-block__title">File changes</h4>
          <ChangesSection events={events} />

          {resolvedRequests.length ? (
            <>
              <h4 className="entity-block__title">Already answered</h4>
              {resolvedRequests.map((request) => (
                <article key={request.requestRef} className="control-request" data-testid={`resolved-request-${request.requestRef}`}>
                  {/* spec §3b, same law as the open card above: plain words, never the machine's raw
                    * `automatic:policy:...` title — but in the PAST tense, because this one is settled
                    * (see resolvedHeadline, which also floors an unrecognized kind rather than throwing). */}
                  <h4>{resolvedHeadline(request)}</h4>
                  {request.response ? (
                    <p className="control-help">
                      <span className="mc-mono">{request.response.decision}</span>
                      {request.response.response ? ` · ${request.response.response}` : ''}
                      {' · '}<span className="mc-mono">{timestampLabel(request.response.respondedAt)}</span>
                    </p>
                  ) : <p className="control-help">Resolved without a recorded answer.</p>}
                </article>
              ))}
            </>
          ) : null}

          <h4 className="entity-block__title">Stored data</h4>
          <p className="control-help">
            Archiving is reversible and there is no purge. The server re-checks the whole run bundle
            between the review and the confirmation.
          </p>
          <div className="control-actions">
            <button type="button" className="mc-btn" disabled={busy} onClick={reviewQuarantine}>Review archiving</button>
            {quarantinePlan ? (
              <button
                type="button"
                className="mc-btn mc-btn--primary"
                disabled={busy || quarantinePlan.items.length === 0 || !quarantinePlan.items.every((item) => item.eligible)}
                onClick={confirmQuarantine}
              >
                Archive this run
              </button>
            ) : null}
          </div>
          {quarantinePlan ? (
            <p className="control-help" data-testid="run-quarantine-plan">
              {quarantinePlan.items.every((item) => item.eligible)
                ? 'Ready to archive.'
                : 'Blocked by live or unresolved records.'}
            </p>
          ) : null}
          {quarantineNotice ? <p className="control-help" role="status">{quarantineNotice}</p> : null}
        </div>
      </details>
    </>
  );

  /**
   * The run's edges out. Every one is derived from data already loaded — no extra fetch, no new route.
   * The agent links say "via queue cards" because that is literally how they are derived: the step's
   * canonical card's owner. Claiming a direct run→agent relationship the DTOs do not carry would be
   * dishonest, and the operator needs to know the join is indirect to read it correctly.
   */
  const links: EntityLink[] = [
    ...(detail.run.workflowRef
      ? [{ label: 'Workflow', target: workflowLink(detail.run.workflowRef), ref: detail.run.workflowRef }]
      : []),
    ...(detail.run.predecessorRunRef
      ? [{ label: 'Retried from', target: { view: 'workflows' as const, focus: { kind: 'run' as const, id: detail.run.predecessorRunRef } }, ref: detail.run.predecessorRunRef }]
      : []),
    ...(cardOwners
      ? agentIdsForRun(detail.stages, cardOwners).map((agentId) => ({
          label: 'Agent · via queue cards', target: agentLink(agentId), ref: agentId,
        }))
      : []),
  ];

  const actions = (
    <>
      {resumeAvailable ? (
        <button type="button" className="mc-btn mc-btn--primary" disabled={busy} onClick={resume}>Resume</button>
      ) : null}
      <button
        type="button"
        className="mc-btn"
        disabled={busy || !['running', 'recovering', 'waiting-human'].includes(detail.run.state)}
        onClick={stop}
      >
        Stop
      </button>
      {/*
        * Rendered-disabled, never conditionally rendered: an action the operator knows exists must not
        * vanish, or its absence reads as a UI bug rather than as "not available here". A standing refusal
        * is stated in the row instead of being discovered by a click.
        */}
      <button
        type="button"
        className="mc-btn"
        disabled={busy || !!retryRefusal || reconciliationAvailable || !['failed', 'stopped', 'interrupted'].includes(detail.run.state)}
        title={retryRefusal}
        onClick={retry}
      >
        Run it again
      </button>
      {retryRefusal ? <span className="control-help" data-testid="run-retry-refusal">{retryRefusal}</span> : null}
      {reconciliationAvailable ? (
        <button type="button" className="mc-btn" disabled={busy} onClick={reconcile}>Settle this historical run</button>
      ) : null}
      {/*
        * Archive — the end of a dead run. Same rendered-disabled rule as Retry above: the action never
        * vanishes, it explains itself. The reason field only appears when the action is actually
        * available, so a live run's header does not carry a box that can do nothing.
        */}
      {archivable ? (
        <input
          className="run-archive__reason"
          data-testid="run-archive-reason"
          value={archiveReason}
          disabled={busy}
          maxLength={500}
          placeholder="why (optional)"
          aria-label="Why this run is being archived"
          onChange={(event) => setArchiveReason(event.target.value)}
        />
      ) : null}
      <button
        type="button"
        className="mc-btn"
        data-testid="run-archive"
        disabled={busy || !archivable}
        title={archiveRefusal}
        onClick={archive}
      >
        Archive
      </button>
    </>
  );

  const sections: DetailSection[] = [{ id: 'run', label: 'Run', attention: openRequests.length > 0, render: () => body }];

  return (
    <EntityDetail
      entity={{ kind: 'run', id: detail.run.runRef }}
      eyebrow={<>Run · <EntityName kind="run" id={detail.run.runRef} displayName={detail.run.displayName} shortRef={detail.run.shortRef} muted /></>}
      title={detail.run.title}
      status={{ label: runStateLabel(detail.run.state), tone: runTone(detail.run.state) }}
      facts={[
        { label: 'Steps', value: detail.stages.length, mono: true },
        { label: 'Waiting on you', value: openRequests.length, mono: true },
        // Who owns this run — `operator` when it was launched by hand here, `dashboard-engine` when
        // the queue bridge or the executor launched it headlessly. Stated on every run, like the other
        // facts, rather than only on foreign ones: the facts row is a uniform strip, and a slot that
        // appears conditionally would read as a warning instead of provenance.
        { label: 'Owner', value: detail.ownerSubject, mono: true },
        { label: 'Started', value: timestampLabel(detail.run.createdAt), mono: true },
        { label: 'Updated', value: timestampLabel(detail.run.updatedAt), mono: true },
      ]}
      links={links}
      sections={sections}
      onNavigate={onNavigate}
      onBack={onBack}
      backLabel={backLabel}
      actions={actions}
    />
  );
}

/** Step states share the run vocabulary but have their own set, so they map here rather than reusing it. */
function runDotForStage(state: string): string {
  if (state === 'running') return 'running';
  if (state === 'succeeded') return 'done';
  if (state === 'failed' || state === 'interrupted') return 'error';
  if (state === 'waiting-human' || state === 'stopped' || state === 'blocked') return 'blocked';
  return 'idle';
}

/**
 * D3.4 — the Runs graph (stable route id: `pipeline`). A React Flow projection of the queue's `depends-on` DAG: every card is a
 * node, every `depends-on` relation an edge, `variant-group` siblings clustered together. The graph
 * itself is a PURE server projection (`GET /api/dag` → server/dag/graph.ts#buildDag); this view only
 * lays it out and renders each card.
 *
 * Each node shows: the card name (a click-through to its timeline/transcript), a semantic status dot
 * (reusing the `mc-status-dot--*` vocabulary), a mono model chip, a one-line summary, and an inline
 * GOVERNED model toggle. That toggle REUSES the existing per-card routing write path
 * ({@link ../lib/routingClient}.postCardRouting → POST /api/write/card-routing → cardRouting.ts) exactly
 * as the Tasks view does — there is no second write path. Only dependency-blocked cards and unowned
 * inbox drafts are safely mutable. Assigned queued, active/stopping, approval-bound, and historical
 * attempts freeze the toggle with a truthful reason. A 409 lifecycle refusal also latches without retry.
 * Routing shown for display comes only from the effective-routing projection
 * (`GET /api/routing`).
 *
 * Graph topology is read-only: the canvas self-fetches `/api/dag` + `/api/routing` once on mount and
 * degrades to a calm empty state on failure. Inline routing controls only update a card's governed
 * routing; this view never creates cards or dependency links. The node BODY ({@link PipelineNodeBody})
 * is factored out of the React Flow node so it is unit-testable without React Flow's DOM measurement.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  EMPTY_ROUTING,
  fetchRouting,
  postCardRouting,
  type EffectiveOrUnroutable,
  type RoutingSnapshot,
  type RuntimeRegistryEntry,
  type WriteResult,
} from '../lib/routingClient';
import { RoutingControl } from './routingControls';
import { useSse } from '../lib/sseClient';
import '../styles/views/pipeline.css';
import { ManagedRuns } from '../control/ManagedRuns';
import type { NavTarget } from '../nav/stack';

type DotKind = 'idle' | 'running' | 'blocked' | 'done' | 'error';

/** Mirror the server lifecycle guard. Current attempts are not live-reroutable. */
export function pipelineRoutingLockReason(state: string, owner: string | null): string | null {
  if (state === 'blocked') return null;
  if (state === 'inbox' && !owner) return null;
  if (state === 'inbox') return 'assigned and queued — the runner may already be active; use a successor attempt';
  if (['working', 'stop-requested', 'halting'].includes(state)) {
    return 'active or stopping — routing is fixed for this attempt';
  }
  if (state === 'approvals' || state === 'approved') {
    return 'under approval — routing is frozen with the reviewed scope';
  }
  if (['done', 'rejected', 'halted'].includes(state)) {
    return 'historical attempt — retry with new routing';
  }
  return `state ${state} is not safely reroutable`;
}

/** Map a card's state (+ blocked flag) to a semantic status dot, reusing the mc-status-dot vocabulary. */
function dotKind(state: string, blocked: boolean): DotKind {
  if (blocked) return 'blocked';
  switch (state) {
    case 'working':
    case 'approvals':
    case 'stop-requested':
    case 'halting':
      return 'running';
    case 'done':
    case 'approved':
      return 'done';
    case 'rejected':
    case 'halted':
      return 'error';
    default:
      return 'idle';
  }
}

/** The props a single pipeline node body renders from. */
export interface PipelineNodeBodyProps {
  data: DagNodeData;
  /** Effective routing for the display chip inside the toggle (or an unroutable marker). */
  effective?: EffectiveOrUnroutable | null;
  registry: Record<string, RuntimeRegistryEntry>;
  onApplyRouting: (cardId: string, runtime: string, model: string) => Promise<WriteResult>;
  onClearRouting: (cardId: string) => Promise<WriteResult>;
  onOpenCard: (cardId: string) => void;
}

/**
 * The visible content of a pipeline node — factored out of the React Flow node so it can be unit-tested
 * without React Flow's store/DOM measurement. Renders the name (click-through), status dot, mono model
 * chip, one-line summary, and the inline governed toggle.
 */
export function PipelineNodeBody({
  data,
  effective,
  registry,
  onApplyRouting,
  onClearRouting,
  onOpenCard,
}: PipelineNodeBodyProps): React.JSX.Element {
  // A dynamic freeze latched from any authoritative 409 lifecycle refusal; combined with the
  // up-front mirror so an obviously immutable card never offers a doomed write.
  const [frozenReason, setFrozenReason] = useState<string | null>(null);
  const lifecycleLocked = pipelineRoutingLockReason(data.state, data.owner);
  const lockedReason = frozenReason ?? lifecycleLocked;
  const routed = Boolean(data.runtime || data.model);

  function latchIfLocked(res: WriteResult): WriteResult {
    // Freeze WITHOUT retrying on a 409 lifecycle refusal — never open a second write path.
    if (!res.ok && res.error === 'routing-state-locked') {
      setFrozenReason(res.reason ?? 'routing is fixed for this attempt');
    }
    return res;
  }

  async function apply(runtime: string, model: string): Promise<WriteResult> {
    return latchIfLocked(await onApplyRouting(data.id, runtime, model));
  }
  async function clear(): Promise<WriteResult> {
    return latchIfLocked(await onClearRouting(data.id));
  }

  return (
    <div
      className={`v-pipe-node${data.blocked ? ' v-pipe-node--blocked' : ''}`}
      data-testid={`pipeline-node-${data.id}`}
    >
      <header className="v-pipe-node__head">
        <span
          className={`mc-status-dot mc-status-dot--${dotKind(data.state, data.blocked)}`}
          data-testid={`pipeline-node-${data.id}-dot`}
          aria-hidden="true"
        />
        <button
          type="button"
          className="v-pipe-node__name mc-mono"
          data-testid={`pipeline-node-${data.id}-open`}
          title={`Open ${data.id} timeline / transcript`}
          onClick={() => onOpenCard(data.id)}
        >
          {data.id}
        </button>
        <span className="v-pipe-node__model mc-mono" data-testid={`pipeline-node-${data.id}-model`}>
          {data.model ?? '—'}
        </span>
      </header>

      <p className="v-pipe-node__summary" data-testid={`pipeline-node-${data.id}-summary`}>
        {data.summary}
      </p>

      <div className="v-pipe-node__routing">
        <RoutingControl
          label={data.id}
          testIdPrefix={`pipeline-${data.id}`}
          registry={registry}
          effective={effective ?? null}
          canClear={routed}
          lockedReason={lockedReason}
          onApply={(runtime, model) => apply(runtime, model)}
          onClear={clear}
        />
      </div>
    </div>
  );
}

/** The React Flow custom node: source/target handles wrapping the presentational body. */
function PipelineNode({ data }: NodeProps<PipelineNodeBodyProps>): React.JSX.Element {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <PipelineNodeBody {...data} />
      <Handle type="source" position={Position.Right} />
    </>
  );
}

const NODE_TYPES: NodeTypes = { pipelineCard: PipelineNode };

/** Longest-path rank of each node (0 for roots) — drives the layered left→right layout. */
function rankNodes(dag: Dag): Map<string, number> {
  const byId = new Map(dag.nodes.map((n) => [n.id, n]));
  const cache = new Map<string, number>();
  const rank = (id: string, stack: Set<string>): number => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node || stack.has(id)) return 0; // missing dep or cycle guard
    stack.add(id);
    let r = 0;
    for (const dep of node.data.dependsOn) {
      if (byId.has(dep)) r = Math.max(r, rank(dep, stack) + 1);
    }
    stack.delete(id);
    cache.set(id, r);
    return r;
  };
  for (const n of dag.nodes) rank(n.id, new Set());
  return cache;
}

const COL_W = 300;
const ROW_H = 150;
const UNSCOPED_RUN = '__unscoped__';

interface RunGroup {
  id: string;
  label: string;
  nodes: number;
  done: number;
  working: number;
  waiting: number;
}

function runGroups(dag: Dag): RunGroup[] {
  const groups = new Map<string, DagNodeData[]>();
  for (const node of dag.nodes) {
    const id = node.data.workflow ?? UNSCOPED_RUN;
    (groups.get(id) ?? groups.set(id, []).get(id)!).push(node.data);
  }
  return [...groups.entries()]
    .map(([id, nodes]) => ({
      id,
      label: id === UNSCOPED_RUN ? 'Unscoped cards' : id,
      nodes: nodes.length,
      done: nodes.filter((n) => n.state === 'done' || n.state === 'approved').length,
      working: nodes.filter((n) => ['working', 'stop-requested', 'halting'].includes(n.state)).length,
      waiting: nodes.filter((n) => ['blocked', 'approvals'].includes(n.state) || n.blocked).length,
    }))
    .sort((a, b) => {
      if (a.id === UNSCOPED_RUN) return 1;
      if (b.id === UNSCOPED_RUN) return -1;
      return b.id.localeCompare(a.id);
    });
}

function graphForRun(dag: Dag, runId: string): Dag {
  const nodes = dag.nodes.filter((n) => (n.data.workflow ?? UNSCOPED_RUN) === runId);
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: dag.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

/** Lay the DAG out into positioned React Flow nodes. Columns are dependency depth; within a column,
 *  nodes are ordered so `variant-group` siblings sit adjacent (the visual grouping). */
function layout(dag: Dag): Map<string, { x: number; y: number }> {
  const ranks = rankNodes(dag);
  const byRank = new Map<number, string[]>();
  for (const n of dag.nodes) {
    const r = ranks.get(n.id) ?? 0;
    (byRank.get(r) ?? byRank.set(r, []).get(r)!).push(n.id);
  }
  const dataById = new Map(dag.nodes.map((n) => [n.id, n.data]));
  const pos = new Map<string, { x: number; y: number }>();
  for (const [r, ids] of byRank) {
    // Cluster variant-group siblings within the column; plain cards keep id order.
    ids.sort((a, b) => {
      const ga = dataById.get(a)?.variantGroup ?? '~';
      const gb = dataById.get(b)?.variantGroup ?? '~';
      return ga === gb ? a.localeCompare(b) : ga.localeCompare(gb);
    });
    ids.forEach((id, i) => pos.set(id, { x: r * COL_W, y: i * ROW_H }));
  }
  return pos;
}

/**
 * Runs view. Accepts a DAG + routing directly (tests) or self-fetches `/api/dag` and `/api/routing`.
 * The inline node toggle writes card frontmatter through the governed, audited card-routing endpoint —
 * the SAME path the Tasks view uses.
 */
export function Pipeline({
  dag,
  routing,
  onOpenCard,
  focusRunRef,
  onOpenRun,
  onBackToRuns,
  activeSectionId,
  onSectionChange,
  onNavigate,
}: {
  dag?: Dag;
  routing?: RoutingSnapshot;
  onOpenCard?: (cardId: string) => void;
  /** arc-3 nav stack: which run's detail is open, and how to push/pop/retab it. */
  focusRunRef?: string | null;
  onOpenRun?: (runRef: string) => void;
  onBackToRuns?: () => void;
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onNavigate?: (target: NavTarget) => void;
} = {}): React.JSX.Element {
  const { requireSession } = useSession();
  const [fetchedDag, setFetchedDag] = useState<Dag | null>(dag ?? null);
  const [routingState, setRoutingState] = useState<RoutingSnapshot | null>(routing ?? null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const { count: planeATick } = useSse('/events');

  useEffect(() => {
    if (dag) return;
    let cancelled = false;
    fetch('/api/dag')
      .then((r) => r.json() as Promise<Dag>)
      .then((d) => {
        if (!cancelled && d.nodes) setFetchedDag(d);
      })
      .catch(() => {
        /* read-only view: keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [dag, planeATick]);

  const refreshRouting = useCallback(async () => {
    try {
      setRoutingState(await fetchRouting());
    } catch {
      /* keep last-known routing */
    }
  }, []);

  useEffect(() => {
    if (routing) return;
    void refreshRouting();
  }, [routing, refreshRouting, planeATick]);

  const allGraph = dag ?? fetchedDag ?? { nodes: [], edges: [] };
  const groups = useMemo(() => runGroups(allGraph), [allGraph]);
  const activeRun = selectedRun && groups.some((g) => g.id === selectedRun) ? selectedRun : groups[0]?.id ?? null;
  const graph = useMemo(() => (activeRun ? graphForRun(allGraph, activeRun) : allGraph), [allGraph, activeRun]);
  const routingSnap = routing ?? routingState ?? EMPTY_ROUTING;
  const openCard = onOpenCard ?? (() => {});

  const applyRouting = useCallback(
    async (cardId: string, runtime: string, model: string): Promise<WriteResult> => {
      // Point-of-action unlock: a routing write on a locked tab runs the ONE ceremony first.
      const token = (await requireSession())?.token;
      if (!token) return { ok: false, reason: 'no session' };
      const res = await postCardRouting({ op: 'set', cardId, runtime, model }, token);
      if (res.ok) await refreshRouting();
      return res;
    },
    [requireSession, refreshRouting],
  );

  const clearRouting = useCallback(
    async (cardId: string): Promise<WriteResult> => {
      const token = (await requireSession())?.token;
      if (!token) return { ok: false, reason: 'no session' };
      const res = await postCardRouting({ op: 'clear', cardId }, token);
      if (res.ok) await refreshRouting();
      return res;
    },
    [requireSession, refreshRouting],
  );

  const positions = useMemo(() => layout(graph), [graph]);

  const rfNodes: Node<PipelineNodeBodyProps>[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'pipelineCard',
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: {
          data: n.data,
          effective: routingSnap.cards[n.id]?.effective ?? null,
          registry: routingSnap.policy.runtimes,
          onApplyRouting: applyRouting,
          onClearRouting: clearRouting,
          onOpenCard: openCard,
        },
      })),
    [graph, positions, routingSnap, applyRouting, clearRouting, openCard],
  );

  const rfEdges: Edge[] = useMemo(
    () => graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    [graph],
  );

  return (
    <section className="v-pipeline" aria-label="Runs view">
      <header className="v-pipeline__head">
        <h2 className="v-pipeline__title">Runs</h2>
        <p className="v-pipeline__lede">
          Live run stages and their <code className="mc-mono">depends-on</code> links. Execution happens in
          background runners; Terminal tabs are separate manual shells.
        </p>
      </header>
      <ManagedRuns
        focusRunRef={focusRunRef}
        onOpenRun={onOpenRun}
        onBackToRuns={onBackToRuns}
        activeSectionId={activeSectionId}
        onSectionChange={onSectionChange}
        onNavigate={onNavigate}
      />
      {/* The legacy queue-card graph is a DIFFERENT data source (queue cards, not managed stages). It
       *  stays reachable but is hidden while a run's detail is open, so the operator is never looking at
       *  two competing models of "the run" at once. The managed-run dependency graph is now rendered
       *  honestly from `Stage.dependsOn` inside the run detail's Stages section. */}
      <details className="v-pipeline__legacy" open={groups.length > 0} hidden={Boolean(focusRunRef)}>
        <summary>Canonical queue-card graph</summary>
      {groups.length > 0 ? (
        <nav className="v-pipeline__runs" aria-label="Run instances" data-testid="run-groups">
          {groups.map((run) => (
            <button
              key={run.id}
              type="button"
              className={`v-pipeline__run${activeRun === run.id ? ' v-pipeline__run--active' : ''}`}
              aria-pressed={activeRun === run.id}
              onClick={() => setSelectedRun(run.id)}
            >
              <span className="v-pipeline__run-id mc-mono">{run.label}</span>
              <span className="v-pipeline__run-state">
                {run.done}/{run.nodes} done{run.working ? ` · ${run.working} running` : ''}
                {run.waiting ? ` · ${run.waiting} waiting` : ''}
              </span>
            </button>
          ))}
        </nav>
      ) : null}
      {allGraph.nodes.length === 0 ? (
        <div className="v-pipeline__empty" data-testid="runs-empty">
          <h3 className="v-pipeline__empty-title">No launched queue cards to graph yet</h3>
          <p className="v-pipeline__empty-body">
            Use Run now from Composer or a runnable workflow. The complete stage graph will appear here as
            soon as it is committed.
          </p>
        </div>
      ) : (
        <ReactFlowProvider>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      )}
      </details>
    </section>
  );
}

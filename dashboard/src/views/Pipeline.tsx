/**
 * D3.4 — the pipeline canvas. A React Flow projection of the queue's `depends-on` DAG: every card is a
 * node, every `depends-on` relation an edge, `variant-group` siblings clustered together. The graph
 * itself is a PURE server projection (`GET /api/dag` → server/dag/graph.ts#buildDag); this view only
 * lays it out and renders each card.
 *
 * Each node shows: the card name (a click-through to its timeline/transcript), a semantic status dot
 * (reusing the `mc-status-dot--*` vocabulary), a mono model chip, a one-line summary, and an inline
 * GOVERNED model toggle. That toggle REUSES the existing per-card routing write path
 * ({@link ../lib/routingClient}.postCardRouting → POST /api/write/card-routing → cardRouting.ts) exactly
 * as the Tasks view does — there is no second write path. On a 409 `approval-locked` refusal (or a card
 * already sitting under an active approval) the toggle freezes: disabled, with the reason shown inline,
 * and NO retry. Routing shown for display comes only from the effective-routing projection
 * (`GET /api/routing`).
 *
 * Read-only otherwise: the canvas self-fetches `/api/dag` + `/api/routing` once on mount and degrades to
 * a calm empty state on failure. The node BODY ({@link PipelineNodeBody}) is factored out of the React
 * Flow node so it is unit-testable without React Flow's DOM measurement.
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
import type { Session } from '../lib/authClient';
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
import '../styles/views/pipeline.css';

type DotKind = 'idle' | 'running' | 'blocked' | 'done' | 'error';

/** Card states under an active human approval — the server refuses a routing swap here (cardRouting.ts),
 *  so the node freezes its toggle up front rather than let the operator attempt a doomed write. */
const APPROVAL_LOCKED_STATES = new Set(['approvals', 'approved']);

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
  canAct: boolean;
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
  canAct,
  onApplyRouting,
  onClearRouting,
  onOpenCard,
}: PipelineNodeBodyProps): React.JSX.Element {
  // A dynamic freeze latched from a 409 `approval-locked` refusal; combined with the up-front freeze
  // for a card that is already under an active approval.
  const [frozenReason, setFrozenReason] = useState<string | null>(null);
  const approvalLocked = APPROVAL_LOCKED_STATES.has(data.state) ? 'under approval — routing frozen' : null;
  const lockedReason = frozenReason ?? approvalLocked;
  const routed = Boolean(data.runtime || data.model);

  function latchIfLocked(res: WriteResult): WriteResult {
    // Freeze WITHOUT retrying on a 409 approval-locked refusal — never open a second write path.
    if (!res.ok && (res.status === 409 || res.error === 'approval-locked')) {
      setFrozenReason(res.reason ?? 'approval-locked — routing frozen');
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
          canAct={canAct}
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
 * Pipeline view. Accepts a DAG + routing directly (tests) or self-fetches `/api/dag` and `/api/routing`.
 * The inline node toggle writes card frontmatter through the governed, audited card-routing endpoint —
 * the SAME path the Tasks view uses.
 */
export function Pipeline({
  dag,
  routing,
  sessionToken,
  onRequestSession,
  onOpenCard,
}: {
  dag?: Dag;
  routing?: RoutingSnapshot;
  sessionToken?: string;
  onRequestSession?: () => Promise<Session | null>;
  onOpenCard?: (cardId: string) => void;
} = {}): React.JSX.Element {
  const [fetchedDag, setFetchedDag] = useState<Dag | null>(dag ?? null);
  const [routingState, setRoutingState] = useState<RoutingSnapshot | null>(routing ?? null);

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
  }, [dag]);

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
  }, [routing, refreshRouting]);

  const graph = dag ?? fetchedDag ?? { nodes: [], edges: [] };
  const routingSnap = routing ?? routingState ?? EMPTY_ROUTING;
  const canAct = Boolean(sessionToken) || Boolean(onRequestSession);
  const openCard = onOpenCard ?? (() => {});

  async function resolveToken(): Promise<string | undefined> {
    if (sessionToken) return sessionToken;
    if (onRequestSession) return (await onRequestSession())?.token ?? undefined;
    return undefined;
  }

  const applyRouting = useCallback(
    async (cardId: string, runtime: string, model: string): Promise<WriteResult> => {
      const token = await resolveToken();
      if (!token) return { ok: false, reason: 'no session' };
      const res = await postCardRouting({ op: 'set', cardId, runtime, model }, token);
      if (res.ok) await refreshRouting();
      return res;
    },
    // resolveToken closes over props; refreshRouting is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionToken, onRequestSession, refreshRouting],
  );

  const clearRouting = useCallback(
    async (cardId: string): Promise<WriteResult> => {
      const token = await resolveToken();
      if (!token) return { ok: false, reason: 'no session' };
      const res = await postCardRouting({ op: 'clear', cardId }, token);
      if (res.ok) await refreshRouting();
      return res;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionToken, onRequestSession, refreshRouting],
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
          canAct,
          onApplyRouting: applyRouting,
          onClearRouting: clearRouting,
          onOpenCard: openCard,
        },
      })),
    [graph, positions, routingSnap, canAct, applyRouting, clearRouting, openCard],
  );

  const rfEdges: Edge[] = useMemo(
    () => graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    [graph],
  );

  return (
    <section className="v-pipeline" aria-label="Pipeline view">
      {graph.nodes.length === 0 ? (
        <p className="v-pipeline__empty">No cards in the queue to graph yet.</p>
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
    </section>
  );
}

/**
 * Fleet graph panel (Agent Platform, Wave-1 U14) — the fleet as a picture: who is in it, and what
 * the data can prove about how they are connected.
 *
 * It reads the two existing read-only projections in parallel — `GET /api/agents` (the roster) and
 * `GET /api/dag` (the card graph) — and hands both to {@link ./FleetGraph}, which owns every rule
 * about what becomes a node and what becomes an edge. This file is only the canvas and the inspect
 * pane; nothing here decides truth.
 *
 * Deliberate restraint, in one place:
 *   - ONE LABEL CONVENTION: every edge label reads source→target ALONG the arrow. The coordination
 *     arrow runs from the dependency's owner to the dependent's owner, so its label is "blocks"
 *     ("X blocks Y" = Y's card depends on X's) — "depends on" would state the inverse of the arrow,
 *     and "dispatched" would invent a relationship the data does not prove.
 *   - Two edge kinds only. Solid = coordination, drawn from the card DAG. Dashed and subordinate =
 *     declared `buildsOn` lineage, which is a claim in a file rather than observed behaviour; it is
 *     drawn agent→predecessor so "builds on" also reads with its arrow.
 *   - `whatItReplaces` is prose, so it is shown as prose in the inspect pane and is never an edge.
 *   - A `buildsOn` predecessor that is not in the roster is listed as TEXT under the canvas. Drawing
 *     it would mean inventing a node for an agent that does not exist.
 *   - Status uses the app's one `.mc-status-dot` vocabulary. No panel ever mints a status colour.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel as FlowPanel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type XYPosition,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { AgentRosterEntry } from '../../../../server/agents/roster';
import type { Dag } from '../../../../server/dag/graph';
import { ModelBadge } from '../../../components/ModelBadge';
import type { AgentPlatformPanel } from '../types';
import {
  FLEET_FIT_VIEW,
  buildsOnEdges,
  coordinationEdges,
  fleetNodeId,
  fleetNodePositions,
  fleetNodes,
  keepDrawableEdges,
  nearestHandles,
  roleColorClass,
  type FleetEdge,
  type FleetNode,
} from './FleetGraph';
import '../../../styles/views/agentPlatformFleetGraph.css';

interface FleetNodeData {
  node: FleetNode;
  selected: boolean;
  highlighted: boolean;
  onOpen: (agentId: string) => void;
}

const COORDINATION_MARKER = { type: MarkerType.ArrowClosed, width: 16, height: 16 };
const BUILDS_ON_MARKER = { type: MarkerType.ArrowClosed, width: 12, height: 12 };

function FleetAgentNode({ data }: NodeProps<FleetNodeData>): React.JSX.Element {
  const { node } = data;
  const handles = [
    ['top', Position.Top],
    ['right', Position.Right],
    ['bottom', Position.Bottom],
    ['left', Position.Left],
  ] as const;
  return (
    <div className="fg-node-shell">
      {handles.flatMap(([id, position]) => [
        <Handle key={`target-${id}`} id={`target-${id}`} type="target" position={position} className="fg-node__handle" />,
        <Handle key={`source-${id}`} id={`source-${id}`} type="source" position={position} className="fg-node__handle" />,
      ])}
      <button
        type="button"
        className={`fg-node nodrag nopan${data.selected ? ' fg-node--selected' : ''}${data.highlighted ? ' fg-node--highlighted' : ''}`}
        data-testid={`fleet-node-${node.agentId}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => data.onOpen(node.agentId)}
      >
        <span className="fg-node__head">
          <span
            className={`mc-status-dot mc-status-dot--${node.working ? 'running' : 'idle'}`}
            data-testid={`fleet-node-dot-${node.agentId}`}
            aria-hidden="true"
          />
          <strong className="fg-node__name">{node.displayName}</strong>
        </span>
        <span className="fg-node__meta">
          <span className={`fg-role ${roleColorClass(node.role)}`}>{node.role ?? 'unknown role'}</span>
          {/* EFFECTIVE model only — `declaredModel` can re-surface a string the resolver refused (U4). */}
          <ModelBadge tier={node.model} />
          {node.declared ? <span className="fg-marker">declared</span> : null}
          {node.runnerBound ? <span className="fg-marker fg-marker--bound">runner-bound</span> : null}
        </span>
      </button>
    </div>
  );
}

const NODE_TYPES: NodeTypes = { fleetAgent: FleetAgentNode };

/** The agent id behind a canvas node id. */
function agentOf(nodeId: string): string {
  return nodeId.slice('agent:'.length);
}

/**
 * One fleet relation as a reactflow edge. Both labels read source→target ALONG the arrow: the
 * coordination arrow runs dependency-owner → dependent-owner, so it says "blocks", not "depends on".
 * Handles are resolved per edge from the LIVE node positions; without them reactflow falls back to the
 * first registered handle and every edge leaves and arrives at the top of its node.
 */
function toFlowEdge(edge: FleetEdge, positions: Map<string, XYPosition>): Edge {
  const coordination = edge.kind === 'coordination';
  const from = agentOf(edge.source);
  const to = agentOf(edge.target);
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    pathOptions: { borderRadius: 12 },
    label: coordination ? 'blocks' : 'builds on',
    ariaLabel: coordination
      ? `${from} blocks ${to} (${to}'s work depends on ${from})`
      : `${from} builds on ${to}`,
    className: coordination ? 'fg-edge fg-edge--coordination' : 'fg-edge fg-edge--builds-on',
    markerEnd: coordination ? COORDINATION_MARKER : BUILDS_ON_MARKER,
    style: coordination ? undefined : { strokeDasharray: '5 4' },
    ...nearestHandles(positions.get(edge.source), positions.get(edge.target)),
    animated: false,
    focusable: false,
  };
}

function rememberNodePositions(changes: NodeChange[], positions: Map<string, XYPosition>): void {
  for (const change of changes) {
    if (change.type === 'position' && change.position) positions.set(change.id, change.position);
  }
}

/** One labelled fact in the inspect pane. Absent values say so rather than rendering an empty row. */
function InspectRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="fg-inspect__row">
      <dt className="fg-inspect__label">{label}</dt>
      <dd className="fg-inspect__value">{value}</dd>
    </div>
  );
}

export function FleetGraphBody(): React.JSX.Element {
  const [roster, setRoster] = useState<AgentRosterEntry[] | null>(null);
  const [dag, setDag] = useState<Pick<Dag, 'nodes' | 'edges'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const positions = useRef(new Map<string, XYPosition>());

  useEffect(() => {
    if (typeof fetch !== 'function') {
      setError('This browser has no fetch — the fleet graph could not load.');
      return;
    }
    let alive = true;
    const read = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return (await response.json()) as T;
    };
    Promise.all([read<AgentRosterEntry[]>('/api/agents'), read<Dag>('/api/dag')])
      .then(([rosterPayload, dagPayload]) => {
        if (!alive) return;
        setRoster(Array.isArray(rosterPayload) ? rosterPayload : []);
        setDag({ nodes: dagPayload?.nodes ?? [], edges: dagPayload?.edges ?? [] });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : 'The fleet graph could not load.');
      });
    return () => { alive = false; };
  }, []);

  const nodes = useMemo(() => fleetNodes(roster), [roster]);
  const lineage = useMemo(() => buildsOnEdges(roster), [roster]);
  const edges = useMemo(
    () => keepDrawableEdges([...coordinationEdges(dag), ...lineage.edges], nodes),
    [dag, lineage.edges, nodes],
  );
  const defaultPositions = useMemo(() => fleetNodePositions(nodes), [nodes]);
  const selected = useMemo(
    () => (selectedId ? (roster ?? []).find((entry) => entry.id === selectedId) ?? null : null),
    [roster, selectedId],
  );

  const openAgent = useCallback((agentId: string) => {
    setSelectedId(agentId);
    setHighlightId(null);
  }, []);

  const projectedNodes = useMemo<Node<FleetNodeData>[]>(() => nodes.map((node) => ({
    id: node.id,
    type: 'fleetAgent',
    position: positions.current.get(node.id) ?? defaultPositions.get(node.id) ?? { x: 0, y: 0 },
    data: {
      node,
      selected: node.agentId === selectedId,
      highlighted: node.agentId === highlightId,
      onOpen: openAgent,
    },
  })), [nodes, defaultPositions, selectedId, highlightId, openAgent]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(projectedNodes);
  const keepPosition = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    rememberNodePositions(changes, positions.current);
    onNodesChange(changes);
  }, [onNodesChange]);
  // Selecting an agent replaces node data; the durable local position map survives the reprojection.
  useEffect(() => setFlowNodes((current) => {
    const unchanged = current.length === projectedNodes.length && current.every((node, index) => {
      const next = projectedNodes[index];
      return next !== undefined
        && node.id === next.id
        && (node.data as FleetNodeData).node === next.data.node
        && (node.data as FleetNodeData).selected === next.data.selected
        && (node.data as FleetNodeData).highlighted === next.data.highlighted
        && node.position.x === next.position.x && node.position.y === next.position.y;
    });
    return unchanged ? current : projectedNodes;
  }), [projectedNodes, setFlowNodes]);

  // Routed off the LIVE positions, so an edge re-picks its sides after a node is dragged.
  const flowEdges = useMemo(() => {
    const livePositions = new Map(flowNodes.map((node) => [node.id, node.position]));
    return edges.map((edge) => toFlowEdge(edge, livePositions));
  }, [edges, flowNodes]);

  if (error) {
    return (
      <p className="fg-state fg-state--error" data-testid="fleet-graph-error" role="status">
        {error}
      </p>
    );
  }
  if (roster === null || dag === null) {
    return (
      <p className="fg-state" data-testid="fleet-graph-loading" role="status">
        Loading the fleet…
      </p>
    );
  }
  if (nodes.length === 0) {
    return (
      <p className="fg-state" data-testid="fleet-graph-empty">
        No agents in the roster yet.
      </p>
    );
  }

  return (
    <div className="fg">
      <div className="fg__stage">
        <div className="fg__canvas" data-testid="fleet-graph-canvas">
          <ReactFlowProvider>
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              onNodesChange={keepPosition}
              fitView
              fitViewOptions={FLEET_FIT_VIEW}
              minZoom={0.2}
              maxZoom={1.75}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} size={1} />
              <Controls showInteractive={false} />
              {/* The legend describes the arrows only when there ARE arrows; see the note below the
               *  canvas for the empty case. Every label reads source→target, along the arrow. */}
              <FlowPanel position="top-left" className="fg__legend">
                {edges.length
                  ? 'Each card is an agent · labels read along the arrow · solid “blocks” = a card dependency between them · dashed “builds on” = declared lineage'
                  : 'Each card is an agent'}
              </FlowPanel>
            </ReactFlow>
          </ReactFlowProvider>
        </div>

        {selected ? (
          <aside className="fg-inspect" data-testid="fleet-inspect" aria-label={`${selected.displayName} detail`}>
            <header className="fg-inspect__head">
              <strong className="fg-inspect__name">{selected.displayName}</strong>
              <ModelBadge tier={selected.effective?.model ?? null} />
              <button type="button" className="fg-inspect__close" onClick={() => { setSelectedId(null); setHighlightId(null); }}>
                Close
              </button>
            </header>
            <dl className="fg-inspect__facts">
              <InspectRow label="id" value={<code className="mc-mono">{selected.id}</code>} />
              <InspectRow label="role" value={selected.role ?? 'unknown'} />
              <InspectRow label="working" value={selected.working ? 'yes' : 'no'} />
              <InspectRow label="declared" value={selected.declared ? 'yes' : 'no'} />
              <InspectRow label="runner-bound" value={selected.runnerBound ? 'yes' : 'no'} />
              {/* Advisory only: the declaration's own ceiling, not an authorization this view grants. */}
              <InspectRow
                label="declared ceiling (advisory)"
                value={<span data-testid="fleet-inspect-tier">{selected.autonomyTier ?? 'not declared'}</span>}
              />
            </dl>
            {selected.whatItReplaces ? (
              <p className="fg-inspect__replaces" data-testid="fleet-inspect-replaces">
                <span className="fg-inspect__label">replaces</span> {selected.whatItReplaces}
              </p>
            ) : null}
            {(() => {
              const resolved = lineage.edges.filter((edge) => edge.source === fleetNodeId(selected.id));
              const unresolved = lineage.unresolved.filter((item) => item.agentId === selected.id);
              if (resolved.length === 0 && unresolved.length === 0) return null;
              return (
                <div className="fg-inspect__lineage">
                  <span className="fg-inspect__label">builds on</span>
                  {resolved.length ? (
                    <ul className="fg-inspect__list">
                      {resolved.map((edge) => {
                        const predecessor = edge.target.replace('agent:', '');
                        return (
                          <li key={edge.id}>
                            <button
                              type="button"
                              className="fg-inspect__jump"
                              onClick={() => setHighlightId(predecessor)}
                            >
                              {predecessor}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {unresolved.length ? (
                    <p className="fg-inspect__unresolved" data-testid="fleet-inspect-unresolved">
                      not in the fleet: {unresolved.map((item) => item.predecessor).join(', ')}
                    </p>
                  ) : null}
                </div>
              );
            })()}
          </aside>
        ) : null}
      </div>

      {/* The honest empty state for the RELATIONS, distinct from an empty roster: agents exist, but
       *  nothing in the queue couples them and nothing declares lineage. Say that, rather than leaving
       *  a legend explaining arrows the canvas does not contain. */}
      {edges.length === 0 ? (
        <p className="fg-state" data-testid="fleet-graph-no-edges">
          No cross-agent dependencies in the current queue, and no builds-on declarations — the agents
          above are drawn without connections because there are none to draw.
        </p>
      ) : null}

      {lineage.unresolved.length ? (
        <section className="fg-unresolved" data-testid="fleet-unresolved-list">
          <h4 className="fg-unresolved__title">builds on (unresolved)</h4>
          <ul className="fg-unresolved__list">
            {lineage.unresolved.map((item) => (
              <li key={`${item.agentId}~${item.predecessor}`} className="fg-unresolved__item">
                {item.agentId} builds on {item.predecessor} — not a fleet agent, so nothing is drawn for it.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'fleet-graph',
  title: 'Fleet Graph',
  description: 'Every agent in the roster, with the card dependencies and declared lineage between them.',
  render: () => <FleetGraphBody />,
};

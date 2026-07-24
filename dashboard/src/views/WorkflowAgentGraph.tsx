import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
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
import type { WorkflowDefEntry } from './WorkflowDetail';

export const UNASSIGNED_GOVERNOR = '__unassigned__';

export interface GovernanceAgentOption { id: string; role: string | null; description: string | null }
export interface GovernanceDraft { workflow: string | null; stages: Record<string, string | null> }
export interface HandoffStagePair { sourceStageId: string; targetStageId: string }
export interface HandoffDirection { source: string; target: string; stagePairs: HandoffStagePair[] }
export interface GovernanceHandoffData { directions: HandoffDirection[] }

interface GovernorNodeData {
  id: string;
  role: string | null;
  stages: WorkflowDefEntry['stages'];
  workflowGovernor: boolean;
  selected: boolean;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onDropStage: (stageId: string, governor: string | null) => void;
}

function GovernorNode({ data }: NodeProps<GovernorNodeData>): React.JSX.Element {
  const unassigned = data.id === UNASSIGNED_GOVERNOR;
  const handles = [
    ['top', Position.Top],
    ['right', Position.Right],
    ['bottom', Position.Bottom],
    ['left', Position.Left],
  ] as const;
  return (
    <article
      className={`v-workflow-agent${data.selected ? ' v-workflow-agent--selected' : ''}${unassigned ? ' v-workflow-agent--unassigned' : ''}`}
      data-testid={`workflow-agent-node-${data.id}`}
      onClick={() => data.onSelect(data.id)}
      onDragOver={(event) => { if (!data.readOnly) event.preventDefault(); }}
      onDrop={(event) => {
        if (data.readOnly) return;
        const stageId = event.dataTransfer.getData('application/x-kb-workflow-stage');
        if (stageId) data.onDropStage(stageId, unassigned ? null : data.id);
      }}
    >
      {handles.flatMap(([id, position]) => [
        <Handle key={`target-${id}`} id={`target-${id}`} type="target" position={position} className="v-workflow-agent__handle" />,
        <Handle key={`source-${id}`} id={`source-${id}`} type="source" position={position} className="v-workflow-agent__handle" />,
      ])}
      <header className="v-workflow-agent__head">
        <strong className="mc-mono">{unassigned ? 'Unassigned' : data.id}</strong>
        {data.workflowGovernor ? <span className="entity-chip">workflow governor</span> : null}
        {data.role ? <span className="entity-chip mc-mono">{data.role}</span> : null}
        <button
          type="button"
          className="v-workflow-agent__inspect nodrag nopan"
          aria-label={`Inspect ${unassigned ? 'unassigned stages' : data.id}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); data.onSelect(data.id); }}
        >
          Inspect
        </button>
      </header>
      <div className="v-workflow-agent__stages">
        {data.stages.map((stage) => (
          <button
            type="button"
            key={stage.id}
            draggable={!data.readOnly}
            className="v-workflow-agent__stage nodrag nopan"
            data-testid={`workflow-stage-chip-${stage.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.setData('application/x-kb-workflow-stage', stage.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onClick={(event) => { event.stopPropagation(); data.onSelect(data.id); }}
          >
            <span>{stage.title ?? stage.action}</span><span className="mc-mono">{stage.id}</span>
          </button>
        ))}
        {data.stages.length === 0 ? <span className="entity-note">Coordinates; no owned stage</span> : null}
      </div>
    </article>
  );
}

const NODE_TYPES: NodeTypes = { governor: GovernorNode };

export function initialGovernance(entry: WorkflowDefEntry): GovernanceDraft {
  return {
    workflow: entry.governedBy ?? null,
    stages: Object.fromEntries(entry.stages.map((stage) => [stage.id, stage.governedBy ?? null])),
  };
}

/** A persisted draft can predate a newly-added stage.  Missing keys mean unassigned, never invisible. */
export function normalizeGovernance(entry: WorkflowDefEntry, draft: GovernanceDraft): GovernanceDraft {
  return {
    workflow: draft.workflow ?? null,
    stages: Object.fromEntries(entry.stages.map((stage) => [stage.id, draft.stages[stage.id] ?? null])),
  };
}

function stageRanks(entry: WorkflowDefEntry): Map<string, number> {
  const stagesById = new Map(entry.stages.map((stage) => [stage.id, stage]));
  const ranks = new Map<string, number>();
  const visiting = new Set<string>();
  const rank = (stageId: string): number => {
    const cached = ranks.get(stageId);
    if (cached !== undefined) return cached;
    // A malformed stage cycle must still render instead of recursing forever.
    if (visiting.has(stageId)) return 0;
    visiting.add(stageId);
    const stage = stagesById.get(stageId);
    const next = stage?.dependsOn?.length
      ? Math.max(...stage.dependsOn.map((dependency) => rank(dependency) + 1))
      : 0;
    visiting.delete(stageId);
    ranks.set(stageId, next);
    return next;
  };
  for (const stage of entry.stages) rank(stage.id);
  return ranks;
}

function ownerLinks(entry: WorkflowDefEntry, draft: GovernanceDraft): Array<[string, string]> {
  const links = new Set<string>();
  const stageIds = new Set(entry.stages.map((stage) => stage.id));
  for (const stage of entry.stages) {
    const target = draft.stages[stage.id] ?? UNASSIGNED_GOVERNOR;
    for (const dependency of stage.dependsOn ?? []) {
      if (!stageIds.has(dependency)) continue;
      const source = draft.stages[dependency] ?? UNASSIGNED_GOVERNOR;
      if (source !== target) links.add(`${source}\u0000${target}`);
    }
  }
  return [...links].map((link) => link.split('\u0000') as [string, string]);
}

function ownerComponents(owners: string[], links: Array<[string, string]>): string[][] {
  const ownerSet = new Set(owners);
  const adjacency = new Map(owners.map((owner) => [owner, [] as string[]]));
  for (const [source, target] of links) {
    if (ownerSet.has(source) && ownerSet.has(target)) adjacency.get(source)?.push(target);
  }
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const connect = (owner: string): void => {
    const ownerIndex = nextIndex++;
    indices.set(owner, ownerIndex);
    lowLinks.set(owner, ownerIndex);
    stack.push(owner);
    onStack.add(owner);
    for (const target of adjacency.get(owner) ?? []) {
      if (!indices.has(target)) {
        connect(target);
        lowLinks.set(owner, Math.min(lowLinks.get(owner) ?? ownerIndex, lowLinks.get(target) ?? ownerIndex));
      } else if (onStack.has(target)) {
        lowLinks.set(owner, Math.min(lowLinks.get(owner) ?? ownerIndex, indices.get(target) ?? ownerIndex));
      }
    }
    if (lowLinks.get(owner) !== indices.get(owner)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member !== undefined) {
        onStack.delete(member);
        component.push(member);
      }
    } while (member !== owner);
    components.push(component);
  };
  for (const owner of owners) {
    if (!indices.has(owner)) connect(owner);
  }
  const order = new Map(owners.map((owner, index) => [owner, index]));
  return components
    .map((component) => component.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)))
    .sort((left, right) => (order.get(left[0] ?? '') ?? 0) - (order.get(right[0] ?? '') ?? 0));
}

/** Stable owner order follows stage progression, not the server's agent declaration order. */
export function governanceOwnerOrder(entry: WorkflowDefEntry, draft: GovernanceDraft, visibleNodeIds: string[]): string[] {
  const ranks = stageRanks(entry);
  const firstStageIndex = new Map<string, number>();
  const firstRank = new Map<string, number>();
  entry.stages.forEach((stage, index) => {
    const owner = draft.stages[stage.id] ?? UNASSIGNED_GOVERNOR;
    firstStageIndex.set(owner, Math.min(firstStageIndex.get(owner) ?? index, index));
    firstRank.set(owner, Math.min(firstRank.get(owner) ?? (ranks.get(stage.id) ?? 0), ranks.get(stage.id) ?? 0));
  });
  return [...visibleNodeIds].sort((left, right) => {
    const leftParticipates = firstStageIndex.has(left);
    const rightParticipates = firstStageIndex.has(right);
    if (leftParticipates !== rightParticipates) return leftParticipates ? -1 : 1;
    return (firstRank.get(left) ?? Number.MAX_SAFE_INTEGER) - (firstRank.get(right) ?? Number.MAX_SAFE_INTEGER)
      || (firstStageIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (firstStageIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
      || left.localeCompare(right);
  });
}

/**
 * Cyclic owner projections use a ring so return paths stay on the perimeter.
 * Acyclic projections use stage-rank lanes. Manual dragging is preserved separately.
 */
export function governanceNodePositions(
  entry: WorkflowDefEntry,
  draft: GovernanceDraft,
  visibleNodeIds: string[],
): Map<string, XYPosition> {
  const order = governanceOwnerOrder(entry, draft, visibleNodeIds);
  const participating = order.filter((owner) => entry.stages.some(
    (stage) => (draft.stages[stage.id] ?? UNASSIGNED_GOVERNOR) === owner,
  ));
  const positions = new Map<string, XYPosition>();
  const links = ownerLinks(entry, draft);
  const components = ownerComponents(participating, links);
  if (components.length === 1 && participating.length >= 3 && participating.length <= 5) {
    participating.forEach((owner, index) => {
      const angle = -3 * Math.PI / 4 + (2 * Math.PI * index) / participating.length;
      positions.set(owner, {
        x: Math.round(450 + 450 * Math.cos(angle)),
        y: Math.round(300 + 260 * Math.sin(angle)),
      });
    });
  } else {
    const componentByOwner = new Map<string, number>();
    components.forEach((component, componentIndex) => {
      for (const owner of component) componentByOwner.set(owner, componentIndex);
    });
    const predecessors = new Map(components.map((_, index) => [index, new Set<number>()]));
    for (const [source, target] of links) {
      const sourceComponent = componentByOwner.get(source);
      const targetComponent = componentByOwner.get(target);
      if (sourceComponent !== undefined && targetComponent !== undefined && sourceComponent !== targetComponent) {
        predecessors.get(targetComponent)?.add(sourceComponent);
      }
    }
    const componentRanks = new Map<number, number>();
    const rankComponent = (componentIndex: number): number => {
      const cached = componentRanks.get(componentIndex);
      if (cached !== undefined) return cached;
      const rank = Math.max(0, ...[...(predecessors.get(componentIndex) ?? [])].map((source) => rankComponent(source) + 1));
      componentRanks.set(componentIndex, rank);
      return rank;
    };
    components.forEach((_, index) => rankComponent(index));
    const rowsByLane = new Map<number, number>();
    components.forEach((component, componentIndex) => {
      const lane = componentRanks.get(componentIndex) ?? 0;
      let row = rowsByLane.get(lane) ?? 0;
      for (const owner of component) {
        positions.set(owner, { x: lane * 430, y: row * 300 });
        row += 1;
      }
      rowsByLane.set(lane, row);
    });
  }
  const idleY = Math.max(300, ...[...positions.values()].map((position) => position.y + 300));
  order.filter((owner) => !positions.has(owner)).forEach((owner, index) => {
    positions.set(owner, { x: (index % 3) * 390, y: idleY + Math.floor(index / 3) * 280 });
  });
  return positions;
}

function handoffSummary(direction: HandoffDirection): string {
  return direction.stagePairs.map(({ sourceStageId, targetStageId }) => `${sourceStageId} → ${targetStageId}`).join(', ');
}

function nearestHandles(source: XYPosition | undefined, target: XYPosition | undefined): {
  sourceHandle: string;
  targetHandle: string;
} {
  if (!source || !target) return { sourceHandle: 'source-right', targetHandle: 'target-left' };
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: 'source-right', targetHandle: 'target-left' }
      : { sourceHandle: 'source-left', targetHandle: 'target-right' };
  }
  return dy >= 0
    ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
    : { sourceHandle: 'source-top', targetHandle: 'target-bottom' };
}

export function governanceEdges(entry: WorkflowDefEntry, draft: GovernanceDraft): Edge<GovernanceHandoffData>[] {
  const owner = (stageId: string): string => draft.stages[stageId] ?? UNASSIGNED_GOVERNOR;
  const stageIds = new Set(entry.stages.map((stage) => stage.id));
  const participatingOwners = [...new Set(entry.stages.map((stage) => owner(stage.id)))];
  const routingPositions = governanceNodePositions(entry, draft, participatingOwners);
  const aggregates = new Map<string, { first: string; second: string; directions: Map<string, HandoffDirection> }>();
  for (const stage of entry.stages) {
    for (const dependency of stage.dependsOn ?? []) {
      if (!stageIds.has(dependency)) continue;
      const source = owner(dependency);
      const target = owner(stage.id);
      if (source === target) continue;
      const [first, second] = source.localeCompare(target) <= 0 ? [source, target] : [target, source];
      const key = `${first}\u0000${second}`;
      const current = aggregates.get(key) ?? { first, second, directions: new Map() };
      const directionKey = `${source}\u0000${target}`;
      const direction = current.directions.get(directionKey) ?? { source, target, stagePairs: [] };
      direction.stagePairs.push({ sourceStageId: dependency, targetStageId: stage.id });
      current.directions.set(directionKey, direction);
      aggregates.set(key, current);
    }
  }
  return [...aggregates.values()].map((handoff) => {
    const directions = [...handoff.directions.values()].sort((left) => left.source === handoff.first ? -1 : 1);
    const forward = directions.find((direction) => direction.source === handoff.first);
    const reverse = directions.find((direction) => direction.source === handoff.second);
    const total = directions.reduce((count, direction) => count + direction.stagePairs.length, 0);
    const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16 };
    const handles = nearestHandles(routingPositions.get(handoff.first), routingPositions.get(handoff.second));
    return {
      id: `handoff-${handoff.first}~${handoff.second}`,
      source: handoff.first,
      target: handoff.second,
      type: 'smoothstep',
      pathOptions: { borderRadius: 12, offset: 28 },
      label: `${total} handoff${total === 1 ? '' : 's'}`,
      labelShowBg: true,
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 4,
      markerStart: reverse ? { ...marker, orient: 'auto-start-reverse' } : undefined,
      markerEnd: forward ? marker : undefined,
      ...handles,
      data: { directions },
      ariaLabel: directions.map((direction) => `${direction.source} to ${direction.target}: ${handoffSummary(direction)}`).join('; '),
      className: 'v-workflow-handoff',
      animated: false,
      focusable: false,
    };
  });
}

function rememberNodePositions(changes: NodeChange[], positions: Map<string, XYPosition>): void {
  for (const change of changes) {
    if (change.type === 'position' && change.position) positions.set(change.id, change.position);
  }
}

export function WorkflowAgentGraph({ entry, agents, draft, onDraftChange, onOpenAgent, readOnly = false }: {
  entry: WorkflowDefEntry;
  agents: GovernanceAgentOption[];
  draft: GovernanceDraft;
  onDraftChange: (next: GovernanceDraft) => void;
  onOpenAgent?: (agentId: string) => void;
  readOnly?: boolean;
}): React.JSX.Element {
  const normalizedDraft = useMemo(() => normalizeGovernance(entry, draft), [entry.stages, draft]);
  const referenced = new Set([normalizedDraft.workflow, ...Object.values(normalizedDraft.stages)].filter((id): id is string => id !== null));
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const nodeIds = [...new Set([...agents.map((agent) => agent.id), ...referenced, UNASSIGNED_GOVERNOR])];
  const visibleNodeIds = nodeIds.filter((id) => id !== UNASSIGNED_GOVERNOR || Object.values(normalizedDraft.stages).some((owner) => owner === null));
  const orderedNodeIds = useMemo(
    () => governanceOwnerOrder(entry, normalizedDraft, visibleNodeIds),
    [entry.stages, normalizedDraft, visibleNodeIds.join('\u0000')],
  );
  const defaultPositions = useMemo(
    () => governanceNodePositions(entry, normalizedDraft, orderedNodeIds),
    [entry.stages, normalizedDraft, orderedNodeIds.join('\u0000')],
  );
  const handoffs = useMemo(() => governanceEdges(entry, normalizedDraft), [entry.stages, normalizedDraft]);
  const [selected, setSelected] = useState(normalizedDraft.workflow ?? orderedNodeIds[0] ?? UNASSIGNED_GOVERNOR);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const onDropStage = useCallback((stageId: string, governor: string | null): void => {
    if (readOnly || !entry.stages.some((stage) => stage.id === stageId)) return;
    onDraftChange({ ...normalizedDraft, stages: { ...normalizedDraft.stages, [stageId]: governor } });
    setSelected(governor ?? UNASSIGNED_GOVERNOR);
  }, [entry.stages, normalizedDraft, onDraftChange, readOnly]);
  // A selection may become invalid after a drop or a server refresh.  Keep the inspector on a real node.
  useEffect(() => {
    if (!orderedNodeIds.includes(selected)) setSelected(orderedNodeIds[0] ?? UNASSIGNED_GOVERNOR);
  }, [selected, orderedNodeIds.join('\u0000')]);
  const projectedNodes = useMemo<Node<GovernorNodeData>[]>(() => orderedNodeIds
    .map((id) => ({
      id,
      type: 'governor',
      position: positions.current.get(id) ?? defaultPositions.get(id) ?? { x: 0, y: 0 },
      data: {
        id,
        role: byId.get(id)?.role ?? null,
        stages: entry.stages.filter((stage) => (normalizedDraft.stages[stage.id] ?? UNASSIGNED_GOVERNOR) === id),
        workflowGovernor: normalizedDraft.workflow === id,
        selected: selected === id,
        readOnly,
        onSelect: setSelected,
        onDropStage,
      },
    })), [agents, normalizedDraft, entry.stages, readOnly, selected, defaultPositions, orderedNodeIds.join('\u0000')]);
  const [nodes, setNodes, onNodesChange] = useNodesState(projectedNodes);
  const routedHandoffs = useMemo(() => {
    const livePositions = new Map(nodes.map((node) => [node.id, node.position]));
    return handoffs.map((edge) => ({
      ...edge,
      ...nearestHandles(livePositions.get(edge.source), livePositions.get(edge.target)),
    }));
  }, [handoffs, nodes]);
  const keepPosition = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    rememberNodePositions(changes, positions.current);
    onNodesChange(changes);
  }, [onNodesChange]);
  // Ownership changes replace node data while the durable local position map survives every projection.
  useEffect(() => setNodes((current) => {
    const unchanged = current.length === projectedNodes.length && current.every((node, index) => {
      const next = projectedNodes[index];
      return next && node.id === next.id
        && (node.data as GovernorNodeData).selected === next.data.selected
        && (node.data as GovernorNodeData).stages === next.data.stages
        && node.position.x === next.position.x && node.position.y === next.position.y;
    });
    return unchanged ? current : projectedNodes;
  }), [projectedNodes, setNodes]);
  const selectedId = selected === UNASSIGNED_GOVERNOR ? null : selected;
  const selectedStages = entry.stages.filter((stage) => (normalizedDraft.stages[stage.id] ?? null) === selectedId);
  const selectedHandoffs = handoffs.flatMap((edge) => edge.data?.directions ?? [])
    .filter((direction) => direction.source === selected || direction.target === selected);

  return (
    <div className="v-workflow-network">
      <div className="v-workflow-network__canvas" data-testid="workflow-agent-network">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={routedHandoffs}
            nodeTypes={NODE_TYPES}
            onNodesChange={keepPosition}
            fitView
            nodesDraggable={!readOnly}
            nodesConnectable={false}
          >
            <Background gap={18} size={1} /><Controls showInteractive={false} />
            <Panel position="top-left" className="v-workflow-network__legend">
              One line per agent pair · arrows show direction · badges count stage handoffs
            </Panel>
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <aside className="v-workflow-network__inspector" data-testid="workflow-agent-inspector">
        <h4>{selectedId ?? 'Unassigned'}</h4>
        {selectedId && !byId.has(selectedId) ? <p className="entity-note">Warning: this governance ID has no current agent declaration.</p> : null}
        {selectedId === draft.workflow ? <p className="entity-note">Governs the whole workflow and coordinates handoffs.</p> : null}
        {selectedId && onOpenAgent ? <button type="button" className="mc-btn mc-btn--quiet" onClick={() => onOpenAgent(selectedId)}>Open agent</button> : null}
        {selectedHandoffs.length ? (
          <section className="v-workflow-network__handoffs">
            <h5>Handoffs</h5>
            {selectedHandoffs.map((direction) => (
              <p key={`${direction.source}-${direction.target}`}>
                <strong>{direction.source === selected ? `To ${direction.target}` : `From ${direction.source}`}</strong>{' '}
                <span className="mc-mono">{handoffSummary(direction)}</span>
              </p>
            ))}
          </section>
        ) : null}
        {selectedStages.length ? selectedStages.map((stage) => (
          <section key={stage.id} className="v-workflow-network__stage-detail">
            <h5>{stage.title ?? stage.action} <span className="mc-mono">{stage.id}</span></h5>
            <p><strong>Input</strong> {stage.dependsOn?.length ? stage.dependsOn.join(', ') : 'workflow start'}</p>
            <p><strong>Output</strong> <span className="mc-mono">{stage.action}</span> to <span className="mc-mono">{stage.target}</span></p>
            {stage.review ? <p><strong>Review</strong> {stage.review.subjectStageId}; max {stage.review.maxCreatorReworks} reworks</p> : null}
            {stage.completionGate ? <p><strong>Gate</strong> {stage.completionGate.id}: approval after review pass</p> : null}
            {!readOnly ? <label>Governed by <select aria-label={`${stage.id} governed by`} value={normalizedDraft.stages[stage.id] ?? ''} onChange={(event) => onDropStage(stage.id, event.target.value || null)}><option value="">Unassigned</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.id}</option>)}</select></label> : null}
          </section>
        )) : <p className="entity-note">No stages in this node.</p>}
      </aside>
    </div>
  );
}

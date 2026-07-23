import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { WorkflowDefEntry } from './WorkflowDetail';

export const UNASSIGNED_GOVERNOR = '__unassigned__';

export interface GovernanceAgentOption { id: string; role: string | null; description: string | null }
export interface GovernanceDraft { workflow: string | null; stages: Record<string, string | null> }

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
      <Handle type="target" position={Position.Left} />
      <header className="v-workflow-agent__head">
        <strong className="mc-mono">{unassigned ? 'Unassigned' : data.id}</strong>
        {data.workflowGovernor ? <span className="entity-chip">workflow governor</span> : null}
        {data.role ? <span className="entity-chip mc-mono">{data.role}</span> : null}
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
      <Handle type="source" position={Position.Right} />
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

export function governanceEdges(entry: WorkflowDefEntry, draft: GovernanceDraft): Edge[] {
  const owner = (stageId: string): string => draft.stages[stageId] ?? UNASSIGNED_GOVERNOR;
  const aggregates = new Map<string, { source: string; target: string; stagePairs: string[] }>();
  for (const stage of entry.stages) {
    for (const dependency of stage.dependsOn ?? []) {
      const source = owner(dependency);
      const target = owner(stage.id);
      if (source === target) continue;
      const key = `${source}\u0000${target}`;
      const current = aggregates.get(key) ?? { source, target, stagePairs: [] };
      current.stagePairs.push(`${dependency} → ${stage.id}`);
      aggregates.set(key, current);
    }
  }
  return [...aggregates.values()].map((handoff) => ({
    id: `handoff-${handoff.source}-${handoff.target}`,
    source: handoff.source,
    target: handoff.target,
    label: `${handoff.stagePairs.length} handoff${handoff.stagePairs.length === 1 ? '' : 's'}`,
    title: handoff.stagePairs.join(', '),
    animated: false,
  }));
}

function nodePosition(index: number): { x: number; y: number } {
  return { x: (index % 2) * 390, y: Math.floor(index / 2) * 280 };
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
  const [selected, setSelected] = useState(normalizedDraft.workflow ?? visibleNodeIds[0] ?? UNASSIGNED_GOVERNOR);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const onDropStage = useCallback((stageId: string, governor: string | null): void => {
    if (readOnly || !entry.stages.some((stage) => stage.id === stageId)) return;
    onDraftChange({ ...normalizedDraft, stages: { ...normalizedDraft.stages, [stageId]: governor } });
    setSelected(governor ?? UNASSIGNED_GOVERNOR);
  }, [entry.stages, normalizedDraft, onDraftChange, readOnly]);
  // A selection may become invalid after a drop or a server refresh.  Keep the inspector on a real node.
  useEffect(() => {
    if (!visibleNodeIds.includes(selected)) setSelected(visibleNodeIds[0] ?? UNASSIGNED_GOVERNOR);
  }, [selected, visibleNodeIds.join('\u0000')]);
  const projectedNodes = useMemo<Node<GovernorNodeData>[]>(() => visibleNodeIds
    .map((id, index) => ({
      id,
      type: 'governor',
      position: positions.current.get(id) ?? nodePosition(index),
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
    })), [agents, normalizedDraft, entry.stages, readOnly, selected, visibleNodeIds.join('\u0000')]);
  const [nodes, setNodes, onNodesChange] = useNodesState(projectedNodes);
  const keepPosition = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) positions.current.set(change.id, change.position);
    }
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

  return (
    <div className="v-workflow-network">
      <div className="v-workflow-network__canvas" data-testid="workflow-agent-network">
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={governanceEdges(entry, normalizedDraft)} nodeTypes={NODE_TYPES} onNodesChange={keepPosition} fitView nodesDraggable>
            <Background gap={18} size={1} /><Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <aside className="v-workflow-network__inspector" data-testid="workflow-agent-inspector">
        <h4>{selectedId ?? 'Unassigned'}</h4>
        {selectedId && !byId.has(selectedId) ? <p className="entity-note">Warning: this governance ID has no current agent declaration.</p> : null}
        {selectedId === draft.workflow ? <p className="entity-note">Governs the whole workflow and coordinates handoffs.</p> : null}
        {selectedId && onOpenAgent ? <button type="button" className="mc-btn mc-btn--quiet" onClick={() => onOpenAgent(selectedId)}>Open agent</button> : null}
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

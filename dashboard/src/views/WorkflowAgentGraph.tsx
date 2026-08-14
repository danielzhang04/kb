/**
 * The workflow graph — the workflow detail's PRIMARY surface.
 *
 * ONE NODE PER AGENT. Each agent governs its own steps, so the picture answers the question an
 * operator actually asks of a workflow: WHO runs this thing, and in what order do they hand off?
 * A fourteen-step video pipeline is four agents, not fourteen boxes — the steps live INSIDE the
 * agent that governs them, as that agent's ordered worklist.
 *
 * Who governs what is resolved by the server (`resolvedAssignment` / `resolvedManager`) out of the
 * definition itself — an explicit assignment, else the step's governing agent, else the workflow's
 * manager — so a workflow nobody hand-assigned still reads as a specific cast. A resolved default is
 * tagged as a default; an explicitly named agent is not tagged at all. When nothing resolves for a
 * step, those steps gather under ONE honest node saying no default agent is resolvable — never an
 * empty canvas, and never a demand to go and assign something.
 *
 * Arrows are INTER-AGENT handoffs: the steps' own `dependsOn` links collapsed to the agent level and
 * deduped, with self-handoffs (an agent's step depending on its own earlier step) dropped, because an
 * agent handing off to itself is not a handoff. The manager reaches the agent that owns the opening
 * step distinctly.
 *
 * The pickers are an OVERRIDE, not the way work gets staffed: choosing a value submits through the
 * SAME governed write the per-step boxes used (`POST /api/workflows/:id/assignment-amendments`, owned
 * by the detail's caller). There is no second write path and no batch "submit". They live in a fold
 * inside the agent node so the node reads as a cast card first and an editor second.
 *
 * This replaced a STEP-keyed projection (one node per step). It was truthful but unreadable: fourteen
 * small boxes spread over four dependency lanes, so `fitView` framed a chain wider than the canvas and
 * most of the workflow sat off-screen. Agent nodes are few and large, so the whole chain frames at
 * roughly 1:1 with text at its declared size.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { AttemptMiniTail } from '../components/AttemptMiniTail';
import type { AgentRunOverlay, IterationGraphEdge, IterationParticipantOverlay } from '../control/runGraph';
import type { UseSseResult } from '../lib/sseClient';
import type { WorkflowDefEntry } from './WorkflowDetail';

/** Which part of the definition an edit addresses. Mirrors the governed route's own body. */
export type AssignTarget = { kind: 'manager' } | { kind: 'stage'; stageId: string };

export interface Assignment { agentId: string; profileId: string }

/**
 * Where the server got the agent it says will run something. `declared` means the definition names it
 * outright; every other value is a DEFAULT the server resolved, which the node tags as such.
 */
export type AssignmentSource =
  | 'declared'
  | 'stage-governed-by'
  | 'governed-by'
  | 'project-manager'
  | 'sole-project-agent'
  | 'manager-default';

/** The server's answer to "who runs this today", declaration or resolved default alike. */
export interface ResolvedAssignment {
  agentId: string;
  profileId: string | null;
  /** Effective model from the roster. May be null when the roster does not pin one. */
  model: string | null;
  source: AssignmentSource;
}

/** Server-derived eligible choices; this view never infers an assignment from a declaration itself. */
export interface AssignmentChoices { options: Assignment[]; unavailable: string | null }

export interface WorkflowAssignmentOptions {
  manager: AssignmentChoices;
  stages: Record<string, AssignmentChoices>;
}

type WorkflowStage = WorkflowDefEntry['stages'][number];

/**
 * The node id of the group that holds the steps nothing resolved for. Namespaced with the agent nodes
 * so a project that literally has an agent called `unresolved` still gets its own node.
 */
export const UNRESOLVED_NODE = 'agent:';

/** An agent's node id. Namespaced so an agent id can never collide with anything else on the canvas. */
export function agentNodeId(agentId: string | null): string {
  return `agent:${agentId ?? ''}`;
}

/** `agentId · profileId` as one select value, so a pair round-trips through a `<select>` intact. */
export function assignmentKey(assignment: Assignment | null | undefined): string {
  return assignment ? JSON.stringify([assignment.agentId, assignment.profileId]) : '';
}

/** What the server says about one step or one workflow. `null` means nothing resolved — say so. */
export interface AgentSlot {
  agentId: string;
  model: string | null;
  source: AssignmentSource;
  /** Anything the server resolved rather than read literally out of the file. */
  isDefault: boolean;
}

function slotFrom(resolved: ResolvedAssignment | null | undefined): AgentSlot | null {
  if (!resolved?.agentId) return null;
  return {
    agentId: resolved.agentId,
    model: resolved.model ?? null,
    source: resolved.source,
    isDefault: resolved.source !== 'declared',
  };
}

/**
 * Who will run this step. The server's resolution wins; the two fallbacks below exist only so an older
 * payload (or a fixture written before the resolution shipped) still shows the definition's real cast
 * instead of collapsing every step into the unresolved node. Nothing beyond what the file itself names
 * is ever invented.
 */
export function stageSlot(stage: WorkflowStage): AgentSlot | null {
  const resolved = slotFrom(stage.resolvedAssignment);
  if (resolved) return resolved;
  if (stage.declaredAssignment?.agentId) {
    return { agentId: stage.declaredAssignment.agentId, model: null, source: 'declared', isDefault: false };
  }
  if (stage.governedBy) {
    return { agentId: stage.governedBy, model: null, source: 'stage-governed-by', isDefault: true };
  }
  return null;
}

/** Who runs the workflow itself, on the same declaration-then-resolution-then-nothing footing. */
export function managerSlot(entry: WorkflowDefEntry): AgentSlot | null {
  const resolved = slotFrom(entry.resolvedManager);
  if (resolved) return resolved;
  if (entry.manager?.agentId) {
    return { agentId: entry.manager.agentId, model: null, source: 'declared', isDefault: false };
  }
  if (entry.governedBy) {
    return { agentId: entry.governedBy, model: null, source: 'governed-by', isDefault: true };
  }
  return null;
}

/** Plain-words provenance for a resolved default, used as the tag's tooltip. */
export function sourceExplanation(source: AssignmentSource): string {
  switch (source) {
    case 'declared': return 'Named in the workflow file.';
    case 'stage-governed-by': return 'The agent that governs these steps.';
    case 'governed-by': return 'The agent that governs this workflow.';
    case 'project-manager': return 'This project’s manager.';
    case 'sole-project-agent': return 'The only agent this project has.';
    case 'manager-default': return 'The agent that runs this workflow.';
    default: return 'Resolved from the workflow file.';
  }
}

/** The name an operator reads for a step. */
export function stageLabel(stage: WorkflowStage): string {
  return stage.title ?? stage.action;
}

/** How far along the chain each step sits. A malformed cycle ranks 0 rather than recursing forever. */
export function stageRanks(entry: WorkflowDefEntry): Map<string, number> {
  const stagesById = new Map(entry.stages.map((stage) => [stage.id, stage]));
  const ranks = new Map<string, number>();
  const visiting = new Set<string>();
  const rank = (stageId: string): number => {
    const cached = ranks.get(stageId);
    if (cached !== undefined) return cached;
    if (visiting.has(stageId)) return 0;
    visiting.add(stageId);
    const stage = stagesById.get(stageId);
    const dependencies = (stage?.dependsOn ?? []).filter((dependency) => stagesById.has(dependency));
    const next = dependencies.length ? Math.max(...dependencies.map((dependency) => rank(dependency) + 1)) : 0;
    visiting.delete(stageId);
    ranks.set(stageId, next);
    return next;
  };
  for (const stage of entry.stages) rank(stage.id);
  return ranks;
}

/** One agent node: the agent, everything it governs here, and whether it also runs the workflow. */
export interface AgentGroup {
  /** The node key: the agent id, or `''` for the steps nothing resolved for. */
  key: string;
  /** `null` when nothing resolved — the node says exactly that rather than naming a guess. */
  agentId: string | null;
  /** Every distinct effective model across this agent's steps here. Usually one; never invented. */
  models: string[];
  /** Provenance of the first resolution in the group, used for the default tag's tooltip. */
  source: AssignmentSource | null;
  /** True only when EVERY resolution in the group is a server default — a mixed group claims nothing. */
  isDefault: boolean;
  /** This agent also runs the workflow. One node wears both roles; there is never a second box. */
  isManager: boolean;
  /** The steps this agent governs, in pipeline order (dependency rank, then declaration order). */
  stages: WorkflowStage[];
  /** Stage-scoped loop rows; values from different stages are never folded into agent-level state. */
  participantStages: IterationParticipantOverlay[];
  /** The rank of this agent's earliest step; the manager sorts ahead of everything regardless. */
  rank: number;
}

/**
 * Steps grouped by the agent that will run them, in pipeline order.
 *
 * The rules, in one place:
 *  1. A step belongs to `stageSlot(step)`'s agent; steps nothing resolved for share ONE group keyed `''`.
 *  2. Within a group, steps keep pipeline order: dependency rank first, declaration order to break ties.
 *  3. The manager joins the group of the agent it is, if that agent governs steps here; otherwise it
 *     gets a group of its own with no steps. Either way there is exactly one manager node.
 *  4. Groups are ordered manager first (it starts the workflow), then by earliest step — rank first,
 *     declaration order to break ties. The unresolved group takes its place by the same rule; it is
 *     not special-cased to the end.
 */
export function agentGroups(
  entry: WorkflowDefEntry,
  participantStages: readonly IterationParticipantOverlay[] = [],
): AgentGroup[] {
  const ranks = stageRanks(entry);
  const order = new Map(entry.stages.map((stage, index) => [stage.id, index]));
  const sortKey = (stage: WorkflowStage): [number, number] => [ranks.get(stage.id) ?? 0, order.get(stage.id) ?? 0];

  const groups = new Map<string, AgentGroup>();
  for (const stage of entry.stages) {
    const slot = stageSlot(stage);
    const key = slot?.agentId ?? '';
    const existing = groups.get(key);
    if (existing) {
      existing.stages.push(stage);
      if (slot?.model && !existing.models.includes(slot.model)) existing.models.push(slot.model);
      existing.isDefault = existing.isDefault && (slot?.isDefault ?? false);
      continue;
    }
    groups.set(key, {
      key,
      agentId: slot?.agentId ?? null,
      models: slot?.model ? [slot.model] : [],
      source: slot?.source ?? null,
      isDefault: slot?.isDefault ?? false,
      isManager: false,
      stages: [stage],
      participantStages: [],
      rank: 0,
    });
  }

  const manager = managerSlot(entry);
  if (manager) {
    const own = groups.get(manager.agentId);
    if (own) {
      own.isManager = true;
      if (manager.model && !own.models.includes(manager.model)) own.models.push(manager.model);
    } else {
      groups.set(manager.agentId, {
        key: manager.agentId,
        agentId: manager.agentId,
        models: manager.model ? [manager.model] : [],
        source: manager.source,
        isDefault: manager.isDefault,
        isManager: true,
        stages: [],
        participantStages: [],
        rank: 0,
      });
    }
  }

  const groupByStageId = new Map<string, AgentGroup>();
  for (const group of groups.values()) {
    for (const stage of group.stages) groupByStageId.set(stage.id, group);
  }
  for (const participant of participantStages) {
    groupByStageId.get(participant.stageId)?.participantStages.push(participant);
  }

  const ordered = [...groups.values()];
  for (const group of ordered) {
    group.stages.sort((a, b) => {
      const [rankA, indexA] = sortKey(a);
      const [rankB, indexB] = sortKey(b);
      return rankA - rankB || indexA - indexB;
    });
    group.rank = group.stages.length ? (ranks.get(group.stages[0]!.id) ?? 0) : 0;
  }
  const earliestIndex = (group: AgentGroup): number =>
    group.stages.length ? (order.get(group.stages[0]!.id) ?? 0) : -1;
  ordered.sort((a, b) => {
    if (a.isManager !== b.isManager) return a.isManager ? -1 : 1;
    return a.rank - b.rank || earliestIndex(a) - earliestIndex(b);
  });
  return ordered;
}

/** The node width, gaps, and per-step row height the layout below reasons in. Pixels, not rems: the
 *  canvas is a transformed plane, so these are the same numbers reactflow measures. */
export const AGENT_NODE_WIDTH = 304;
export const AGENT_NODE_GAP_X = 56;
export const AGENT_NODE_GAP_Y = 48;
/** Header, model line, the override fold, and padding — everything on a node that is not a step row. */
export const AGENT_NODE_BASE_HEIGHT = 136;
export const AGENT_STAGE_ROW_HEIGHT = 21;
/**
 * At most two columns. A single row of four-to-six agent cards is 1300–1900px wide, which `fitView`
 * can only frame by zooming to ~0.5 — the unreadable-text complaint that started this redesign. Two
 * columns keep the chain inside roughly one canvas width, so it frames at about 1:1.
 */
export const AGENT_GRID_COLUMNS = 2;

/** How tall a node will be once rendered. An estimate, used only to space rows apart before measurement. */
export function agentNodeHeight(group: AgentGroup): number {
  return AGENT_NODE_BASE_HEIGHT + group.stages.length * AGENT_STAGE_ROW_HEIGHT;
}

/**
 * Agents laid out in pipeline reading order — left to right, wrapping to a second column-pair row.
 * Each row is spaced by the tallest node in the row above it, so a seven-step card never overlaps.
 */
export function agentNodePositions(entry: WorkflowDefEntry): Map<string, XYPosition> {
  const groups = agentGroups(entry);
  const columns = Math.max(1, Math.min(groups.length, AGENT_GRID_COLUMNS));
  const positions = new Map<string, XYPosition>();
  let y = 0;
  for (let start = 0; start < groups.length; start += columns) {
    const row = groups.slice(start, start + columns);
    row.forEach((group, column) => {
      positions.set(agentNodeId(group.agentId), { x: column * (AGENT_NODE_WIDTH + AGENT_NODE_GAP_X), y });
    });
    y += Math.max(...row.map(agentNodeHeight)) + AGENT_NODE_GAP_Y;
  }
  return positions;
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

/** The name a node shows, and the name an arrow uses when it talks about that node. */
export function agentGroupName(group: AgentGroup): string {
  return group.agentId ?? 'No default agent';
}

/**
 * Who hands off to whom: every `dependsOn` link collapsed to the agent level, deduped, self-handoffs
 * dropped — plus one arrow from the manager into the agent that owns each opening step, since it is the
 * manager that sets those going. Dependencies naming a step this definition does not declare are
 * skipped rather than drawn into nowhere.
 */
export function agentEdges(entry: WorkflowDefEntry): Edge[] {
  const groups = agentGroups(entry);
  const positions = agentNodePositions(entry);
  const names = new Map(groups.map((group) => [group.key, agentGroupName(group)]));
  const groupOf = new Map<string, string>();
  for (const group of groups) for (const stage of group.stages) groupOf.set(stage.id, group.key);
  const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16 };
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const manager = groups.find((group) => group.isManager) ?? null;

  const push = (from: string, to: string, id: string, ariaLabel: string): void => {
    if (from === to || seen.has(`${from}~${to}`)) return;
    seen.add(`${from}~${to}`);
    const source = agentNodeId(from === '' ? null : from);
    const target = agentNodeId(to === '' ? null : to);
    edges.push({
      id,
      source,
      target,
      type: 'smoothstep',
      pathOptions: { borderRadius: 12 },
      markerEnd: marker,
      ...nearestHandles(positions.get(source), positions.get(target)),
      ariaLabel,
      className: 'v-workflow-handoff',
      animated: false,
      focusable: false,
    });
  };

  for (const stage of entry.stages) {
    const to = groupOf.get(stage.id);
    if (to === undefined) continue;
    const dependencies = (stage.dependsOn ?? []).filter((dependency) => groupOf.has(dependency));
    if (manager && dependencies.length === 0) {
      push(manager.key, to, `start-${to}`, `${names.get(to) ?? to} starts the workflow`);
    }
    for (const dependency of dependencies) {
      const from = groupOf.get(dependency)!;
      push(from, to, `handoff-${from}~${to}`, `${names.get(to) ?? to} takes over from ${names.get(from) ?? from}`);
    }
  }
  return edges;
}

interface AgentNodeData {
  group: AgentGroup;
  /** The manager's own picker row, present only on the node that runs the workflow. */
  managerDeclared: Assignment | null;
  managerChoices: AssignmentChoices | undefined;
  stageChoices: Record<string, AssignmentChoices | undefined>;
  readOnly: boolean;
  onAssign?: (target: AssignTarget, assignment: Assignment | null) => void;
  onOpenAgent?: (agentId: string) => void;
  overlay?: AgentRunOverlay;
  runRef?: string;
  sse?: UseSseResult;
  iterationEdges: readonly IterationGraphEdge[];
  onOpenPanel?: (selection: AgentPanelSelection) => void;
}

export interface AgentPanelSelection {
  agentId: string;
  participantStageKey?: string;
}

/** One eligible-choice picker. Selecting a value IS the governed write; there is no separate apply. */
function AssignmentPicker({
  label,
  value,
  choices,
  readOnly,
  onPick,
}: {
  label: string;
  value: Assignment | null | undefined;
  choices: AssignmentChoices | undefined;
  readOnly: boolean;
  onPick: (assignment: Assignment | null) => void;
}): React.JSX.Element {
  if (choices && choices.options.length === 0 && choices.unavailable) {
    return <span className="v-workflow-agent__unavailable">{choices.unavailable}</span>;
  }
  return (
    <select
      className="nodrag nopan"
      aria-label={label}
      value={assignmentKey(value)}
      disabled={readOnly || !choices}
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        const picked = choices?.options.find((option) => assignmentKey(option) === event.target.value) ?? null;
        onPick(picked);
      }}
    >
      {/* Empty is not "nobody": it means the default above stands. */}
      <option value="">Keep the default</option>
      {/* The current pair may no longer be eligible (a declaration changed under it); keep it listed so
       *  the picker shows the truth instead of silently reading as undeclared. */}
      {value && !choices?.options.some((option) => assignmentKey(option) === assignmentKey(value)) ? (
        <option value={assignmentKey(value)}>{value.agentId} · {value.profileId}</option>
      ) : null}
      {(choices?.options ?? []).map((option) => (
        <option key={assignmentKey(option)} value={assignmentKey(option)}>{option.agentId} · {option.profileId}</option>
      ))}
    </select>
  );
}

function AgentNode({ data }: NodeProps<AgentNodeData>): React.JSX.Element {
  const { group } = data;
  const testId = `workflow-agent-node-${group.key || 'unresolved'}`;
  const handles = [
    ['top', Position.Top],
    ['right', Position.Right],
    ['bottom', Position.Bottom],
    ['left', Position.Left],
  ] as const;
  return (
    <article
      className={`v-workflow-agent${group.isManager ? ' v-workflow-agent--manager' : ''}${group.agentId ? '' : ' v-workflow-agent--unresolved'}`}
      data-testid={testId}
    >
      {handles.flatMap(([id, position]) => [
        <Handle key={`target-${id}`} id={`target-${id}`} type="target" position={position} className="v-workflow-agent__handle" />,
        <Handle key={`source-${id}`} id={`source-${id}`} type="source" position={position} className="v-workflow-agent__handle" />,
      ])}

      <header
        className={`v-workflow-agent__head${data.onOpenPanel ? ' v-workflow-agent__head--open nodrag nopan' : ''}`}
        onPointerDown={data.onOpenPanel ? (event) => event.stopPropagation() : undefined}
        onClick={data.onOpenPanel ? () => data.onOpenPanel?.({ agentId: group.agentId ?? '' }) : undefined}
      >
        <strong className="v-workflow-agent__name">{agentGroupName(group)}</strong>
        {group.isManager ? <span className="entity-chip">runs the workflow</span> : null}
        {data.overlay ? <span className={`entity-chip v-agent-state v-agent-state--${data.overlay.state}`}>{data.overlay.state}</span> : null}
        {data.overlay?.openGate ? <span className="entity-chip v-agent-state--gate">gate open</span> : null}
      </header>

      {/* The second line, only when there is something true to put on it: an empty bordered strip
       *  states nothing, and the agent's own name is already in the header. */}
      {group.agentId ? (group.models.length || (group.isDefault && group.source) || data.onOpenAgent ? (
        <div className="v-workflow-agent__meta" data-testid={`${testId}-agent`}>
          {group.models.length ? (
            <span className="mc-mono v-workflow-agent__model">{group.models.join(' · ')}</span>
          ) : null}
          {group.isDefault && group.source ? (
            <span className="v-workflow-agent__default" title={sourceExplanation(group.source)}>default</span>
          ) : null}
          {data.onOpenAgent ? (
            <button
              type="button"
              className="v-workflow-agent__open nodrag nopan"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                data.onOpenAgent?.(group.agentId ?? '');
              }}
            >
              Open agent
            </button>
          ) : null}
        </div>
      ) : null) : (
        <p className="v-workflow-agent__nobody entity-note" data-testid={`${testId}-nobody`}>
          no default agent resolvable
        </p>
      )}

      {group.stages.length ? (
        <ol className="v-workflow-agent__stages" data-testid={`${testId}-stages`}>
          {group.stages.map((stage, index) => (
            <li key={stage.id} className="v-workflow-agent__stage" data-testid={`workflow-agent-stage-${stage.id}`}>
              <span className="v-workflow-agent__stage-index mc-mono">{index + 1}</span>
              <span className="v-workflow-agent__stage-title">{stageLabel(stage)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="v-workflow-agent__stages-empty entity-note">no steps of its own</p>
      )}

      {group.participantStages.length ? (
        <ul className="v-workflow-agent__iterations" aria-label="Iteration participants">
          {group.participantStages.map((participant) => {
            const turn = participant.turnOwner
              ? 'your turn'
              : participant.turnOwnerParticipantId
                ? `turn: ${participant.turnOwnerParticipantId}`
                : 'no turn owner';
            const parkLabel = participant.parked
              ? `parked: ${participant.parkReason ?? 'awaiting approval'}`
              : participant.completionGateRef && participant.gateState === 'open'
                ? 'completion gate open'
                : null;
            const declined = participant.loopState === 'declined';
            const participantKeys = new Set(group.participantStages.map((row) => row.key));
            const selfRoutes = data.iterationEdges.filter((edge) => edge.sourceParticipantStageKey === participant.key
              && participantKeys.has(edge.targetParticipantStageKey));
            const content = (
              <>
                <span className="v-workflow-agent__iteration-heading">
                  <span className="mc-mono">{participant.stageId}</span>
                  <span>{participant.iterationGroupId}</span>
                </span>
                <span className="v-workflow-agent__iteration-meta">
                  <span>{participant.participantId} · {participant.role}</span>
                  <span>cycle {participant.cyclesUsed}/{participant.maxCycles}</span>
                  <span>{turn}</span>
                </span>
                <span className="v-workflow-agent__iteration-state">
                  <span>{participant.loopState}</span>
                  {participant.lastVerdict ? <span>last verdict: {participant.lastVerdict}</span> : null}
                  {declined ? <span className="entity-chip v-iteration-declined-chip">declined</span> : null}
                  {!declined && parkLabel ? <span className="entity-chip v-iteration-park-chip">{parkLabel}</span> : null}
                </span>
                {selfRoutes.map((route) => (
                  <span key={route.id}
                    className={`v-workflow-agent__iteration-self-route${participant.parked ? ' v-workflow-agent__iteration-self-route--parked' : ''}${declined ? ' v-workflow-agent__iteration-self-route--declined' : ''}`}
                    data-testid={`iteration-self-route-${route.id}`}>
                    ↻ {route.routeId} → {route.route.recipientParticipantId}
                    {declined ? ' · declined' : participant.parked ? ` · parked: ${participant.parkReason ?? 'awaiting approval'}` : ''}
                  </span>
                ))}
              </>
            );
            return (
              <li key={participant.key} data-testid={`iteration-participant-${participant.key}`}>
                {data.onOpenPanel && group.agentId ? (
                  <button type="button" className="v-workflow-agent__iteration nodrag nopan"
                    aria-label={`Open ${participant.iterationGroupId} ${participant.participantId} loop detail`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); data.onOpenPanel?.({
                      agentId: group.agentId ?? '', participantStageKey: participant.key,
                    }); }}>
                    {content}
                  </button>
                ) : <div className="v-workflow-agent__iteration">{content}</div>}
              </li>
            );
          })}
        </ul>
      ) : null}

      {data.overlay?.attemptRef && data.runRef && data.sse ? (
        <AttemptMiniTail runRef={data.runRef} attemptRef={data.overlay.attemptRef} sse={data.sse} />
      ) : null}

      {/* The override, folded away: the node is a cast card first and an editor second. Choosing a
       *  value here is the same single governed write the caller has always owned. */}
      {!data.overlay ? <details className="v-workflow-agent__override nodrag nopan" data-testid={`${testId}-override`}>
        <summary onPointerDown={(event) => event.stopPropagation()}>Change who runs these</summary>
        <div className="v-workflow-agent__override-body">
          {group.isManager ? (
            <label className="v-workflow-agent__override-row">
              <span className="v-workflow-agent__override-name">the workflow itself</span>
              <AssignmentPicker
                label="Who runs the workflow"
                value={data.managerDeclared}
                choices={data.managerChoices}
                readOnly={data.readOnly}
                onPick={(assignment) => data.onAssign?.({ kind: 'manager' }, assignment)}
              />
            </label>
          ) : null}
          {group.stages.map((stage) => (
            <label key={stage.id} className="v-workflow-agent__override-row">
              <span className="v-workflow-agent__override-name">{stageLabel(stage)}</span>
              <AssignmentPicker
                label={`Who runs ${stageLabel(stage)}`}
                value={stage.declaredAssignment ?? null}
                choices={data.stageChoices[stage.id]}
                readOnly={data.readOnly}
                onPick={(assignment) => data.onAssign?.({ kind: 'stage', stageId: stage.id }, assignment)}
              />
            </label>
          ))}
        </div>
      </details> : null}
    </article>
  );
}

const NODE_TYPES: NodeTypes = { agent: AgentNode };

function rememberNodePositions(changes: NodeChange[], positions: Map<string, XYPosition>): void {
  for (const change of changes) {
    if (change.type === 'position' && change.position) positions.set(change.id, change.position);
  }
}

/** Frame the WHOLE cast by default. `maxZoom: 1` stops a two-node workflow ballooning; the low floor
 *  exists only so an unusually large cast still fits rather than being clipped by reactflow's 0.5 default. */
const FIT_VIEW_OPTIONS = { padding: 0.08, maxZoom: 1, minZoom: 0.3 };

export function WorkflowAgentGraph({
  entry,
  assignmentOptions,
  onAssign,
  onOpenAgent,
  readOnly = false,
  runOverlay,
}: {
  entry: WorkflowDefEntry;
  assignmentOptions?: WorkflowAssignmentOptions | null;
  onAssign?: (target: AssignTarget, assignment: Assignment | null) => void;
  onOpenAgent?: (agentId: string) => void;
  readOnly?: boolean;
  runOverlay?: {
    runRef: string;
    overlays: Record<string, AgentRunOverlay>;
    /** Separate from DAG handoffs; Task 12 owns rendering these declared route edges. */
    iterationEdges: IterationGraphEdge[];
    sse: UseSseResult;
    onOpenPanel?: (selection: AgentPanelSelection) => void;
  };
}): React.JSX.Element {
  const participantStages = useMemo(() => Object.values(runOverlay?.overlays ?? {})
    .flatMap((overlay) => overlay.participantStages), [runOverlay?.overlays]);
  const groups = useMemo(() => agentGroups(entry, participantStages), [entry, participantStages]);
  const defaultPositions = useMemo(() => agentNodePositions(entry), [entry]);
  const handoffs = useMemo(() => agentEdges(entry), [entry]);
  const positions = useRef(new Map<string, XYPosition>());

  const projectedNodes = useMemo<Node<AgentNodeData>[]>(() => groups.map((group) => {
    const id = agentNodeId(group.agentId);
    const stageChoices: Record<string, AssignmentChoices | undefined> = {};
    for (const stage of group.stages) stageChoices[stage.id] = assignmentOptions?.stages?.[stage.id];
    return {
      id,
      type: 'agent',
      position: positions.current.get(id) ?? defaultPositions.get(id) ?? { x: 0, y: 0 },
      data: {
        group,
        managerDeclared: entry.manager ?? null,
        managerChoices: assignmentOptions?.manager,
        stageChoices,
        readOnly,
        onAssign,
        onOpenAgent,
        overlay: runOverlay?.overlays[group.key],
        runRef: runOverlay?.runRef,
        sse: runOverlay?.sse,
        iterationEdges: runOverlay?.iterationEdges ?? [],
        onOpenPanel: runOverlay?.onOpenPanel,
      },
    };
  }), [entry, groups, assignmentOptions, readOnly, onAssign, onOpenAgent, runOverlay, defaultPositions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(projectedNodes);
  const routedEdges = useMemo(() => {
    const livePositions = new Map(nodes.map((node) => [node.id, node.position]));
    const routedHandoffs = handoffs.map((edge) => ({
      ...edge,
      ...nearestHandles(livePositions.get(edge.source), livePositions.get(edge.target)),
    }));
    const groupByStageId = new Map<string, string>();
    for (const group of groups) for (const stage of group.stages) groupByStageId.set(stage.id, group.key);
    const participantByLoop = new Map<string, IterationParticipantOverlay[]>();
    for (const participant of participantStages) {
      const rows = participantByLoop.get(participant.iterationLoopRef) ?? [];
      rows.push(participant);
      participantByLoop.set(participant.iterationLoopRef, rows);
    }
    const routedIterations: Edge[] = (runOverlay?.iterationEdges ?? []).flatMap((edge) => {
      const sourceGroup = groupByStageId.get(edge.sourceStageId);
      const targetGroup = groupByStageId.get(edge.targetStageId);
      if (sourceGroup === undefined || targetGroup === undefined) return [];
      const source = agentNodeId(sourceGroup === '' ? null : sourceGroup);
      const target = agentNodeId(targetGroup === '' ? null : targetGroup);
      // Same-agent routes would collapse into an invisible self-edge. Their source row renders a
      // visible loop marker instead, preserving the participant-stage endpoints on the card.
      if (source === target) return [];
      const rows = participantByLoop.get(edge.iterationLoopRef) ?? [];
      const parked = rows.find((row) => row.parked);
      const declined = rows.some((row) => row.loopState === 'declined');
      const parkReason = parked?.parkReason ?? (parked ? parked.loopState : null);
      const routeLabel = declined ? 'declined' : parkReason ? `parked · ${parkReason}` : null;
      return [{
        id: edge.id,
        source,
        target,
        type: 'smoothstep',
        pathOptions: { borderRadius: 18 },
        markerEnd: { type: MarkerType.Arrow, width: 19, height: 19 },
        ...nearestHandles(livePositions.get(source), livePositions.get(target)),
        ariaLabel: `${edge.iterationGroupId} iteration route ${edge.routeId}`
          + (declined ? '; declined' : parkReason ? `; parked: ${parkReason}` : ''),
        className: `v-workflow-iteration-route${parked ? ' v-workflow-iteration-route--parked' : ''}${declined ? ' v-workflow-iteration-route--declined' : ''}`,
        ...(routeLabel ? { label: routeLabel } : {}),
        animated: !parked && !declined,
        focusable: false,
      }];
    });
    return [...routedHandoffs, ...routedIterations];
  }, [groups, handoffs, nodes, participantStages, runOverlay?.iterationEdges]);
  const keepPosition = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    rememberNodePositions(changes, positions.current);
    onNodesChange(changes);
  }, [onNodesChange]);
  // An assignment change replaces node data while the durable local position map survives the reprojection.
  useEffect(() => setNodes((current) => {
    const unchanged = current.length === projectedNodes.length && current.every((node, index) => {
      const next = projectedNodes[index];
      return next && node.id === next.id
        && (node.data as AgentNodeData).group === next.data.group
        && (node.data as AgentNodeData).readOnly === next.data.readOnly
        && (node.data as AgentNodeData).managerChoices === next.data.managerChoices
        && (node.data as AgentNodeData).overlay === next.data.overlay
        && (node.data as AgentNodeData).runRef === next.data.runRef
        && (node.data as AgentNodeData).sse === next.data.sse
        && (node.data as AgentNodeData).iterationEdges === next.data.iterationEdges
        && (node.data as AgentNodeData).onOpenPanel === next.data.onOpenPanel
        && node.position.x === next.position.x && node.position.y === next.position.y;
    });
    return unchanged ? current : projectedNodes;
  }), [projectedNodes, setNodes]);

  if (entry.stages.length === 0) {
    return <p className="entity-note" data-testid="workflow-agent-network-empty">This workflow has no steps yet.</p>;
  }

  return (
    <div className="v-workflow-network">
      <div className="v-workflow-network__canvas" data-testid="workflow-agent-network">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={routedEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={keepPosition}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            minZoom={0.2}
            maxZoom={1.75}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} /><Controls showInteractive={false} />
            <Panel position="top-left" className="v-workflow-network__legend">
              Each card is an agent and the steps it governs · arrows show the handoffs between them · dashed arrows show iteration routes
            </Panel>
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}

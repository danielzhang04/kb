import type {
  HumanRequestDto,
  IterationLoopDto,
  IterationReceiptDto,
  IterationRequestDto,
  IterationResidueDto,
  IterationRoleDto,
  IterationRouteDto,
  IterationVerdictDto,
  ResolvedAgentAssignmentDto,
  RunDetailDto,
} from './controlClient';
import type { WorkflowDefEntry } from '../views/WorkflowDetail';
import { projectStepDag, type StepEvent } from '../../server/entities/project.ts';

/** Adapt legacy run-detail stage ids at the boundary, then use the P2 step projection as the sole DAG source. */
export function stepDagFromRun(detail: Pick<RunDetailDto, 'stages'>, events: StepEvent[]) {
  const stageRefById = new Map(detail.stages.map((stage) => [stage.stageId, stage.stageRef]));
  return projectStepDag({
    stages: detail.stages.map((stage) => ({
      stageRef: stage.stageRef,
      label: stage.title,
      dependsOn: stage.dependsOn.flatMap((stageId) => {
        const stageRef = stageRefById.get(stageId);
        return stageRef === undefined ? [] : [stageRef];
      }),
    })),
    events,
  });
}

export type AgentRunState =
  | 'failed'
  | 'waiting-human'
  | 'running'
  | 'ready'
  | 'blocked'
  | 'stopped'
  | 'interrupted'
  | 'succeeded';

export interface AgentRunOverlay {
  state: AgentRunState;
  openGate: boolean;
  attemptRef: string | null;
  /** Loop state stays stage-scoped even when this outer overlay represents one shared agent card. */
  participantStages: IterationParticipantOverlay[];
}

export interface IterationParticipantOverlay {
  key: string;
  stageId: string;
  stageRef: string;
  iterationLoopRef: string;
  iterationGroupId: string;
  participantId: string;
  role: IterationRoleDto;
  perspectiveSummary: string;
  mandate: string;
  goal?: string;
  cyclesUsed: number;
  maxCycles: number;
  cycleUnit: string;
  turnOwner: boolean;
  turnOwnerParticipantId?: string;
  currentStepId?: string;
  lastVerdict?: IterationVerdictDto;
  loopState: IterationLoopDto['state'];
  /** Live UI state only; durable park evidence may remain after this becomes false. */
  parked: boolean;
  parkReason?: IterationLoopDto['parkReason'];
  completionGateRef?: string;
  interventionRef?: string;
  gateKind?: HumanRequestDto['gateKind'];
  gateState?: HumanRequestDto['state'];
  activeGenerationRefs: string[];
  acceptedGenerationRefs?: string[];
  requests: IterationRequestDto[];
  receipts: IterationReceiptDto[];
  unresolvedResidue?: IterationResidueDto;
}

export interface IterationGraphEdge {
  kind: 'iteration-route';
  id: string;
  iterationLoopRef: string;
  iterationGroupId: string;
  routeId: string;
  route: IterationRouteDto;
  sourceStageId: string;
  targetStageId: string;
  sourceParticipantStageKey: string;
  targetParticipantStageKey: string;
}

const graphSegment = (value: string): string => encodeURIComponent(value);

/** Rows may be locally annotated by the UI; never let that mutate the run-detail payload. */
function copyResidue(residue: IterationResidueDto): IterationResidueDto {
  return {
    ...residue,
    unresolvedFindings: residue.unresolvedFindings.map((finding) => ({ ...finding, evidencePaths: [...finding.evidencePaths] })),
    positions: residue.positions.map((position) => ({ ...position, generationRefs: [...position.generationRefs] })),
    recordedDissent: [...residue.recordedDissent],
    requestRefs: [...residue.requestRefs],
    receiptRefs: [...residue.receiptRefs],
    activeGenerationRefs: [...residue.activeGenerationRefs],
    acceptedGenerationRefs: [...residue.acceptedGenerationRefs],
    ...(residue.artifactSnapshots === undefined ? {} : { artifactSnapshots: [...residue.artifactSnapshots] }),
    ...(residue.attemptedOutcome === undefined ? {} : {
      attemptedOutcome: {
        ...residue.attemptedOutcome,
        inputGenerationRefs: [...residue.attemptedOutcome.inputGenerationRefs],
        criteria: residue.attemptedOutcome.criteria.map((criterion) => ({ ...criterion, findingIds: [...criterion.findingIds] })),
        findings: residue.attemptedOutcome.findings.map((finding) => ({ ...finding, evidencePaths: [...finding.evidencePaths] })),
        ...(residue.attemptedOutcome.resolvedFindingRefs === undefined
          ? {} : { resolvedFindingRefs: [...residue.attemptedOutcome.resolvedFindingRefs] }),
        positions: residue.attemptedOutcome.positions.map((position) => ({ ...position, generationRefs: [...position.generationRefs] })),
        recordedDissent: [...residue.attemptedOutcome.recordedDissent],
      },
    }),
  };
}

/** Stable participant-row identity: a stage may participate in several groups or several roles. */
export function participantStageKey(stageId: string, iterationGroupId: string, participantId: string): string {
  return `participant-stage:${graphSegment(stageId)}:${graphSegment(iterationGroupId)}:${graphSegment(participantId)}`;
}

function resolvedAssignment(assignment: ResolvedAgentAssignmentDto) {
  return {
    agentId: assignment.agentId,
    profileId: assignment.profileId,
    model: assignment.model,
    source: 'declared' as const,
  };
}

/** Rebuild the definition-shaped graph input from the immutable assignments captured by a run. */
export function entryFromRun(detail: RunDetailDto): WorkflowDefEntry {
  const manager = detail.run.managerAssignment;
  return {
    ref: detail.run.workflowRef ?? detail.run.runRef,
    displayName: detail.run.displayName,
    shortRef: detail.run.shortRef,
    project: '',
    path: '',
    sourceHash: null,
    valid: true,
    title: detail.run.title,
    profile: null,
    manager: manager ? { agentId: manager.agentId, profileId: manager.profileId } : null,
    resolvedManager: manager ? resolvedAssignment(manager) : null,
    stageCount: detail.stages.length,
    riskTier: null,
    detail: null,
    stages: detail.stages.map((stage) => ({
      id: stage.stageId,
      title: stage.title,
      action: '',
      target: '',
      riskTier: '',
      dependsOn: stage.dependsOn,
      declaredAssignment: stage.assignment
        ? { agentId: stage.assignment.agentId, profileId: stage.assignment.profileId }
        : null,
      resolvedAssignment: stage.assignment ? resolvedAssignment(stage.assignment) : null,
    })),
  };
}

const stateRank: Record<AgentRunState, number> = {
  failed: 0,
  'waiting-human': 1,
  running: 2,
  ready: 3,
  blocked: 4,
  stopped: 5,
  interrupted: 5,
  succeeded: 6,
};

/** Project stage state, gate ownership, and the active attempt into the graph's agent-group keys. */
export function overlaysFromRun(detail: RunDetailDto): Record<string, AgentRunOverlay> {
  const overlays: Record<string, AgentRunOverlay> = {};
  const stageKeys = new Map<string, string>();
  const active = new Map<string, { running: string | null; waiting: string | null }>();

  for (const stage of detail.stages) {
    const key = stage.assignment?.agentId ?? '';
    stageKeys.set(stage.stageRef, key);
    const state = stage.state as AgentRunState;
    const existing = overlays[key];
    if (!existing || stateRank[state] < stateRank[existing.state]) {
      overlays[key] = { state, openGate: false, attemptRef: null, participantStages: [] };
    }
    const current = active.get(key) ?? { running: null, waiting: null };
    if (state === 'running' && current.running === null) current.running = stage.currentAttemptRef;
    if (state === 'waiting-human' && current.waiting === null) current.waiting = stage.currentAttemptRef;
    active.set(key, current);
  }

  for (const [key, candidate] of active) {
    const overlay = overlays[key];
    if (overlay) overlay.attemptRef = candidate.running ?? candidate.waiting;
  }
  for (const request of detail.humanRequests) {
    if (request.state !== 'open' || request.stageRef === null) continue;
    const overlay = overlays[stageKeys.get(request.stageRef) ?? ''];
    if (overlay) overlay.openGate = true;
  }

  const stageById = new Map(detail.stages.map((stage) => [stage.stageId, stage]));
  const requestByRef = new Map(detail.humanRequests.map((request) => [request.requestRef, request]));
  const receiptsByLoop = new Map<string, IterationReceiptDto[]>();
  const requestsByLoop = new Map<string, IterationRequestDto[]>();
  for (const receipt of detail.iterationReceipts ?? []) {
    const receipts = receiptsByLoop.get(receipt.iterationLoopRef) ?? [];
    receipts.push(receipt);
    receiptsByLoop.set(receipt.iterationLoopRef, receipts);
  }
  for (const request of detail.iterationRequests ?? []) {
    const requests = requestsByLoop.get(request.iterationLoopRef) ?? [];
    requests.push(request);
    requestsByLoop.set(request.iterationLoopRef, requests);
  }
  for (const loop of detail.iterationLoops ?? []) {
    const receipts = receiptsByLoop.get(loop.iterationLoopRef) ?? [];
    const requests = requestsByLoop.get(loop.iterationLoopRef) ?? [];
    const lastReceipt = loop.lastReceiptRef === undefined
      ? undefined
      : receipts.find((receipt) => receipt.receiptRef === loop.lastReceiptRef);
    // An intervention blocks the loop, so it takes precedence while a completion gate also exists.
    const gateRef = loop.interventionRef ?? loop.completionGateRef;
    const gate = gateRef === undefined ? undefined : requestByRef.get(gateRef);
    const parked = loop.state === 'awaiting-park-gate'
      && gate?.gateKind === 'iteration-park'
      && gate.state === 'open';
    for (const participant of loop.participants) {
      const stage = stageById.get(participant.stageRef);
      if (!stage) continue;
      const agentKey = stage.assignment?.agentId ?? '';
      const overlay = overlays[agentKey];
      if (!overlay) continue;
      overlay.participantStages.push({
        key: participantStageKey(stage.stageId, loop.iterationGroupId, participant.participantId),
        stageId: stage.stageId,
        stageRef: stage.stageRef,
        iterationLoopRef: loop.iterationLoopRef,
        iterationGroupId: loop.iterationGroupId,
        participantId: participant.participantId,
        role: participant.role,
        perspectiveSummary: participant.perspective,
        mandate: participant.mandate,
        ...(participant.goal === undefined ? {} : { goal: participant.goal }),
        cyclesUsed: loop.cyclesUsed,
        maxCycles: loop.maxCycles,
        cycleUnit: loop.cycleUnit,
        turnOwner: loop.turnOwnerParticipantId === participant.participantId,
        ...(loop.turnOwnerParticipantId === undefined ? {} : { turnOwnerParticipantId: loop.turnOwnerParticipantId }),
        ...(loop.currentStepId === undefined ? {} : { currentStepId: loop.currentStepId }),
        ...(lastReceipt === undefined ? {} : { lastVerdict: lastReceipt.verdict }),
        loopState: loop.state,
        parked,
        ...(loop.parkReason === undefined ? {} : { parkReason: loop.parkReason }),
        ...(loop.completionGateRef === undefined ? {} : { completionGateRef: loop.completionGateRef }),
        ...(loop.interventionRef === undefined ? {} : { interventionRef: loop.interventionRef }),
        ...(gate?.gateKind === undefined ? {} : { gateKind: gate.gateKind }),
        ...(gate === undefined ? {} : { gateState: gate.state }),
        activeGenerationRefs: [...loop.activeGenerationRefs],
        ...(loop.acceptedGenerationRefs === undefined ? {} : { acceptedGenerationRefs: [...loop.acceptedGenerationRefs] }),
        requests: [...requests],
        receipts: [...receipts],
        ...(loop.unresolvedResidue === undefined ? {} : { unresolvedResidue: copyResidue(loop.unresolvedResidue) }),
      });
    }
  }
  return overlays;
}

/** Iteration traffic is declaration-owned and never inferred from requests, receipts, logs, or the DAG. */
export function iterationEdgesFromRun(detail: RunDetailDto): IterationGraphEdge[] {
  const edges: IterationGraphEdge[] = [];
  const stageById = new Map(detail.stages.map((stage) => [stage.stageId, stage]));
  for (const loop of detail.iterationLoops ?? []) {
    const participants = new Map(loop.participants.map((participant) => [participant.participantId, participant]));
    for (const route of loop.routes) {
      const source = participants.get(route.senderParticipantId);
      const target = participants.get(route.recipientParticipantId);
      if (!source || !target || !stageById.has(source.stageRef) || !stageById.has(target.stageRef)) continue;
      edges.push({
        kind: 'iteration-route',
        id: `iteration-route:${graphSegment(loop.iterationLoopRef)}:${graphSegment(route.routeId)}`,
        iterationLoopRef: loop.iterationLoopRef,
        iterationGroupId: loop.iterationGroupId,
        routeId: route.routeId,
        route,
        sourceStageId: source.stageRef,
        targetStageId: target.stageRef,
        sourceParticipantStageKey: participantStageKey(source.stageRef, loop.iterationGroupId, source.participantId),
        targetParticipantStageKey: participantStageKey(target.stageRef, loop.iterationGroupId, target.participantId),
      });
    }
  }
  return edges;
}

/** The panel falls back to the most recently created attempt when the live overlay has no active one. */
export function latestAttemptRefOfAgent(detail: RunDetailDto, agentId: string): string | null {
  const stageRefs = new Set(detail.stages
    .filter((stage) => (stage.assignment?.agentId ?? '') === agentId)
    .map((stage) => stage.stageRef));
  let latest: { attemptRef: string; createdAt: string } | null = null;
  for (const attempt of detail.attempts) {
    if (!stageRefs.has(attempt.stageRef)) continue;
    if (!latest || attempt.createdAt > latest.createdAt) latest = attempt;
  }
  return latest?.attemptRef ?? null;
}

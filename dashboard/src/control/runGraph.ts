import type { ResolvedAgentAssignmentDto, RunDetailDto } from './controlClient';
import type { WorkflowDefEntry } from '../views/WorkflowDetail';

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
      overlays[key] = { state, openGate: false, attemptRef: null };
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
  return overlays;
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

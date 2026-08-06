import { describe, expect, it } from 'vitest';
import type { RunDetailDto } from './controlClient';
import { agentGroups } from '../views/WorkflowAgentGraph';
import type { WorkflowDefEntry } from '../views/WorkflowDetail';
import { entryFromRun, latestAttemptRefOfAgent, overlaysFromRun } from './runGraph';

const assignment = (agentId: string) => ({
  agentId, declarationPath: `agents/${agentId}.md`, declarationHash: 'a'.repeat(64),
  profileId: `worker:${agentId}`, runtime: 'claude', model: 'claude-sonnet-5',
});

function runDetail(states: [string, string, string] = ['succeeded', 'running', 'waiting-human']): RunDetailDto {
  return {
    run: {
      runRef: 'run-1', predecessorRunRef: null, title: 'Run graph', displayName: 'Run graph', shortRef: 1,
      workflowRef: 'workflow-1', proposalRef: 'proposal-1', proposalRevision: 1, proposalHash: 'b'.repeat(64),
      publicationState: 'published', state: 'running', version: 1, managerSessionRef: 'manager-session', managerGeneration: 1,
      managerAssignment: assignment('manager'), createdAt: '2026-08-06T00:00:00.000Z', updatedAt: '2026-08-06T00:00:00.000Z',
    },
    stages: [
      { stageRef: 'stage-1', runRef: 'run-1', stageId: 'research', title: 'Research', dependsOn: [], canonicalCardRef: null, state: states[0] as RunDetailDto['stages'][number]['state'], version: 1, currentAttemptRef: 'attempt-1', assignment: assignment('alpha'), createdAt: '', updatedAt: '' },
      { stageRef: 'stage-2', runRef: 'run-1', stageId: 'draft', title: 'Draft', dependsOn: ['research'], canonicalCardRef: null, state: states[1] as RunDetailDto['stages'][number]['state'], version: 1, currentAttemptRef: 'attempt-2', assignment: assignment('alpha'), createdAt: '', updatedAt: '' },
      { stageRef: 'stage-3', runRef: 'run-1', stageId: 'review', title: 'Review', dependsOn: ['draft'], canonicalCardRef: null, state: states[2] as RunDetailDto['stages'][number]['state'], version: 1, currentAttemptRef: 'attempt-3', assignment: assignment('beta'), createdAt: '', updatedAt: '' },
    ],
    attempts: [], sessions: [],
    humanRequests: [
      { requestRef: 'request-1', runRef: 'run-1', displayName: 'Run graph', shortRef: 1, stageRef: 'stage-3', kind: 'approval', revision: 1, state: 'open', title: 'Approve', prompt: 'Approve', ask: 'Approve this.', technicalDetail: null, response: null, createdAt: '', updatedAt: '' },
    ],
    reviewLoops: [], reviewReceipts: [],
  };
}

const definition = (): WorkflowDefEntry => ({
  ref: 'workflow-1', displayName: 'Run graph', shortRef: 1, project: 'kb-ops', path: 'orgs/kb-ops/workflows/run-graph.md',
  sourceHash: null, valid: true, title: 'Run graph', profile: null, stageCount: 3, riskTier: 'T1', detail: null,
  manager: { agentId: 'manager', profileId: 'worker:manager' },
  resolvedManager: { agentId: 'manager', profileId: 'worker:manager', model: 'claude-sonnet-5', source: 'declared' },
  stages: [
    { id: 'research', title: 'Research', action: '', target: '', riskTier: 'T1', dependsOn: [], resolvedAssignment: { agentId: 'alpha', profileId: 'worker:alpha', model: 'claude-sonnet-5', source: 'declared' } },
    { id: 'draft', title: 'Draft', action: '', target: '', riskTier: 'T1', dependsOn: ['research'], resolvedAssignment: { agentId: 'alpha', profileId: 'worker:alpha', model: 'claude-sonnet-5', source: 'declared' } },
    { id: 'review', title: 'Review', action: '', target: '', riskTier: 'T1', dependsOn: ['draft'], resolvedAssignment: { agentId: 'beta', profileId: 'worker:beta', model: 'claude-sonnet-5', source: 'declared' } },
  ],
});

describe('run graph selectors', () => {
  it('rebuilds graph entries with the same agent-group keys as their definition', () => {
    expect(agentGroups(entryFromRun(runDetail())).map((group) => group.key))
      .toEqual(agentGroups(definition()).map((group) => group.key));
  });

  it('folds stage state worst-first and selects the active attempt', () => {
    expect(overlaysFromRun(runDetail()).alpha).toMatchObject({ state: 'running', attemptRef: 'attempt-2' });
    expect(overlaysFromRun(runDetail(['succeeded', 'waiting-human', 'running'])).alpha)
      .toMatchObject({ state: 'waiting-human', attemptRef: 'attempt-2' });
    expect(overlaysFromRun(runDetail(['failed', 'running', 'succeeded'])).alpha)
      .toMatchObject({ state: 'failed', attemptRef: 'attempt-2' });
  });

  it('marks only agents with an open gate and leaves completed agents without a tail', () => {
    const overlays = overlaysFromRun(runDetail());
    expect(overlays.alpha).toMatchObject({ openGate: false });
    expect(overlays.beta).toMatchObject({ openGate: true });
    expect(overlaysFromRun(runDetail(['succeeded', 'succeeded', 'succeeded'])).alpha.attemptRef).toBeNull();
  });

  it('finds the newest attempt across an agent\'s stages', () => {
    const detail = runDetail();
    detail.attempts = [
      { attemptRef: 'attempt-old', runRef: 'run-1', stageRef: 'stage-1', generation: 1, predecessorAttemptRef: null, runtime: 'claude', model: 'model', state: 'failed', version: 1, managedSessionRef: null, createdAt: '2026-08-06T00:00:00.000Z', updatedAt: '' },
      { attemptRef: 'attempt-new', runRef: 'run-1', stageRef: 'stage-2', generation: 1, predecessorAttemptRef: null, runtime: 'claude', model: 'model', state: 'queued', version: 1, managedSessionRef: null, createdAt: '2026-08-06T00:01:00.000Z', updatedAt: '' },
      { attemptRef: 'attempt-other', runRef: 'run-1', stageRef: 'stage-3', generation: 1, predecessorAttemptRef: null, runtime: 'claude', model: 'model', state: 'queued', version: 1, managedSessionRef: null, createdAt: '2026-08-06T00:02:00.000Z', updatedAt: '' },
    ];
    expect(latestAttemptRefOfAgent(detail, 'alpha')).toBe('attempt-new');
    expect(latestAttemptRefOfAgent(detail, 'missing')).toBeNull();
  });
});

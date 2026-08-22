import { describe, expect, it } from 'vitest';
import type { RunDetailDto } from './controlClient';
import { agentEdges, agentGroups } from '../views/WorkflowAgentGraph';
import type { WorkflowDefEntry } from '../views/WorkflowDetail';
import {
  entryFromRun,
  iterationEdgesFromRun,
  latestAttemptRefOfAgent,
  overlaysFromRun,
  participantStageKey,
} from './runGraph';

const assignment = (agentId: string) => ({
  agentId, declarationPath: `agents/${agentId}.md`, declarationHash: 'a'.repeat(64),
  profileId: `worker:${agentId}`, runtime: 'claude', model: 'claude-sonnet-5',
});

function runDetail(states: [string, string, string] = ['succeeded', 'running', 'waiting-human']): RunDetailDto {
  return {
    ownerSubject: 'operator',
    run: {
      owner: { type: 'agent', id: 'manager', sourcePath: 'agents/manager.md' }, executionHost: 'desktop',
      terminalOutcome: null, completedAt: null, archivedFrom: null,
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
    stageGenerations: [], generationSupersessions: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [],
  };
}

function iterationRunDetail(): RunDetailDto {
  const detail = runDetail();
  detail.humanRequests.push({
    ...detail.humanRequests[0]!, requestRef: 'park-gate', stageRef: 'stage-1', gateKind: 'iteration-park',
    title: 'Iteration parked', prompt: 'Approve or decline.',
  });
  detail.iterationLoops = [
    {
      iterationLoopRef: 'loop-draft', runRef: 'run-1', definitionHash: 'definition-1', iterationGroupId: 'draft-loop', goal: 'Accept draft.',
      participants: [
        { participantId: 'producer', stageRef: 'research', role: 'contributor', perspective: 'Own the source.', mandate: 'Produce the draft.' },
        { participantId: 'judge', stageRef: 'review', role: 'judge', perspective: 'Apply quality.', mandate: 'Judge the draft.' },
      ],
      routes: [
        { routeId: 'review-route', senderParticipantId: 'producer', recipientParticipantId: 'judge', requestKinds: ['review'], baseResolutionStageIds: ['research'] },
        { routeId: 'rework-route', senderParticipantId: 'judge', recipientParticipantId: 'producer', requestKinds: ['rework'], baseResolutionStageIds: ['research'] },
      ],
      activation: { seedParticipantId: 'producer', seedArtifactIds: ['draft'] }, initialStepId: 'review-step',
      schedule: [{ stepId: 'review-step', routeId: 'review-route', cycle: 'current' }], artifacts: ['draft'],
      criteria: [{ id: 'quality', description: 'Complete.' }], maxCycles: 3, cycleUnit: 'judge verdicts',
      terminalAuthorities: [{ participantId: 'judge', verdict: 'pass' }], cyclesUsed: 2,
      state: 'awaiting-park-gate', turnOwnerParticipantId: 'producer', currentStepId: 'rework-step',
      activeGenerationRefs: ['generation-1'], acceptedGenerationRefs: ['generation-accepted'],
      lastReceiptRef: 'receipt-1', interventionRef: 'park-gate', parkReason: 'no-progress',
      unresolvedResidue: {
        unresolvedFindings: [{ findingId: 'finding-1', criterionId: 'quality', severity: 'blocking', summary: 'Missing source.', evidencePaths: ['draft.md'] }],
        positions: [{ positionId: 'position-1', participantId: 'judge', summary: 'Needs evidence.', generationRefs: ['generation-1'] }],
        recordedDissent: [{ dissentId: 'dissent-1', participantId: 'producer', positionId: 'position-1', summary: 'Disagree.' }],
        requestRefs: ['request-1', 'request-attempted'], receiptRefs: ['receipt-1'], activeGenerationRefs: ['generation-1'],
        acceptedGenerationRefs: ['generation-accepted'], nextRouteId: 'rework-route', cycleUnit: 'judge verdicts', cyclesUsed: 2, maxCycles: 3,
        attemptedRequestRef: 'request-attempted', attemptedRequestCycle: 3,
        attemptedOutcome: { schema: 'kb.iteration-outcome/v1', requestRef: 'request-attempted', iterationLoopRef: 'loop-draft', participantId: 'producer', cycle: 3, verdict: 'fulfilled', inputGenerationRefs: ['generation-1'], criteria: [], findings: [], positions: [], recordedDissent: [], summary: 'No progress.' },
        artifactSnapshots: [{ path: 'draft.md', regularFile: true, size: 10, sha256: 'same', afterRegularFile: true, afterSize: 10, afterSha256: 'same', byteIdentical: true }],
        failureReason: 'required output was byte-identical',
      },
      version: 8, createdAt: '', updatedAt: '',
    },
    {
      iterationLoopRef: 'loop-peer', runRef: 'run-1', definitionHash: 'definition-2', iterationGroupId: 'peer-loop',
      participants: [
        { participantId: 'peer', stageRef: 'draft', role: 'peer', perspective: 'Challenge assumptions.', mandate: 'State a position.' },
        { participantId: 'reply', stageRef: 'research', role: 'peer', perspective: 'Offer a counterpoint.', mandate: 'Reply to the position.' },
      ],
      routes: [{ routeId: 'position-route', senderParticipantId: 'peer', recipientParticipantId: 'reply', requestKinds: ['position'], baseResolutionStageIds: ['draft'] }],
      activation: { seedParticipantId: 'peer', seedArtifactIds: [] }, initialStepId: 'position-step',
      schedule: [{ stepId: 'position-step', routeId: 'position-route', cycle: 'current' }], artifacts: [], criteria: [], maxCycles: 5, cycleUnit: 'rounds', terminalAuthorities: [], cyclesUsed: 1,
      state: 'awaiting-turn', activeGenerationRefs: ['generation-1'], version: 2, createdAt: '', updatedAt: '',
    },
  ];
  detail.iterationRequests = [
    { schema: 'kb.iteration-request/v1', requestRef: 'request-1', iterationLoopRef: 'loop-draft', stepId: 'review-step', routeId: 'review-route', senderParticipantId: 'producer', recipientParticipantId: 'judge', kind: 'review', cycle: 2, inputGenerationRefs: ['generation-1'], baseCommit: 'base', artifactHashes: {}, criteria: [], unresolvedFindingRefs: [], preservedInvariants: [], nextAcceptanceCheck: 'quality', instructions: 'Judge.' },
    { schema: 'kb.iteration-request/v1', requestRef: 'request-attempted', iterationLoopRef: 'loop-draft', stepId: 'rework-step', routeId: 'route-not-declared', senderParticipantId: 'judge', recipientParticipantId: 'producer', kind: 'rework', cycle: 3, inputGenerationRefs: ['generation-1'], baseCommit: 'base', artifactHashes: {}, criteria: [], unresolvedFindingRefs: ['finding-1'], preservedInvariants: [], nextAcceptanceCheck: 'quality', instructions: 'Revise.' },
  ];
  detail.iterationReceipts = [{
    schema: 'kb.iteration-receipt/v1', receiptRef: 'receipt-1', requestRef: 'request-1', iterationLoopRef: 'loop-draft', participantId: 'judge', cycle: 2,
    verdict: 'fail', inputGenerationRefs: ['generation-1'], criteria: [], findings: [], positions: [], recordedDissent: [], summary: 'Needs work.',
    outcomeHash: 'outcome', outputGenerationRefs: [], baseCommit: 'base', canonicalCommit: 'head', createdAt: '', version: 4,
  }];
  return detail;
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

  it('adds role cycle turn owner last verdict and park state to each participant overlay', () => {
    const overlays = overlaysFromRun(iterationRunDetail());
    expect(overlays.alpha.participantStages[0]).toMatchObject({
      role: 'contributor', perspectiveSummary: 'Own the source.', cyclesUsed: 2, maxCycles: 3,
      turnOwner: true, lastVerdict: 'fail', loopState: 'awaiting-park-gate', parkReason: 'no-progress',
      gateState: 'open', parked: true,
    });
    expect(overlays.beta.participantStages[0]).toMatchObject({ role: 'judge', turnOwner: false, lastVerdict: 'fail' });
  });

  it('derives live parked state from the open park gate, not retained park evidence', () => {
    const detail = iterationRunDetail();
    const loop = detail.iterationLoops[0]!;
    const gate = detail.humanRequests.find((request) => request.requestRef === loop.interventionRef)!;
    loop.state = 'passed';
    gate.state = 'resolved';
    gate.response = {
      requestRevision: gate.revision, decision: 'approved', response: null, respondedAt: '',
    };

    const resolved = overlaysFromRun(detail).alpha.participantStages[0]!;
    expect(resolved).toMatchObject({
      loopState: 'passed', parked: false, parkReason: 'no-progress', gateState: 'resolved',
      unresolvedResidue: expect.objectContaining({ failureReason: 'required output was byte-identical' }),
    });

    loop.state = 'awaiting-park-gate';
    gate.state = 'open';
    gate.response = null;
    expect(overlaysFromRun(detail).alpha.participantStages[0]!.parked).toBe(true);
  });

  it('keeps two stages using one agent as distinct participant overlays keyed by stage group and participant', () => {
    const rows = overlaysFromRun(iterationRunDetail()).alpha.participantStages;
    expect(rows.map((row) => row.key)).toEqual([
      participantStageKey('research', 'draft-loop', 'producer'),
      participantStageKey('draft', 'peer-loop', 'peer'),
      participantStageKey('research', 'peer-loop', 'reply'),
    ]);
    expect(new Set(rows.map((row) => row.stageId))).toEqual(new Set(['research', 'draft']));
  });

  it('derives iteration edges only from server-declared routes', () => {
    const edges = iterationEdgesFromRun(iterationRunDetail());
    expect(edges.map((edge) => edge.routeId)).toEqual(['review-route', 'rework-route', 'position-route']);
    expect(edges.some((edge) => edge.routeId === 'route-not-declared')).toBe(false);
    expect(edges[0]).toMatchObject({
      sourceParticipantStageKey: participantStageKey('research', 'draft-loop', 'producer'),
      targetParticipantStageKey: participantStageKey('review', 'draft-loop', 'judge'),
    });
  });

  it('drops an unresolved participant stage and every route that names it', () => {
    const detail = iterationRunDetail();
    detail.iterationLoops = [detail.iterationLoops[0]!];
    detail.iterationLoops[0]!.participants[1]!.stageRef = 'stage-not-in-run';
    const overlays = overlaysFromRun(detail);
    expect(overlays.beta.participantStages).toEqual([]);
    expect(iterationEdgesFromRun(detail)).toEqual([]);
  });

  it('gives each participant row independent iteration collection containers', () => {
    const detail = iterationRunDetail();
    const overlays = overlaysFromRun(detail);
    const producer = overlays.alpha.participantStages.find((row) => row.participantId === 'producer')!;
    const judge = overlays.beta.participantStages.find((row) => row.participantId === 'judge')!;
    producer.activeGenerationRefs.push('generation-ui-only');
    producer.requests.push({ ...producer.requests[0]!, requestRef: 'request-ui-only' });
    producer.receipts.push({ ...producer.receipts[0]!, receiptRef: 'receipt-ui-only' });
    producer.unresolvedResidue!.requestRefs.push('request-ui-only');
    expect(detail.iterationLoops[0]!.activeGenerationRefs).toEqual(['generation-1']);
    expect(detail.iterationRequests).toHaveLength(2);
    expect(detail.iterationReceipts).toHaveLength(1);
    expect(detail.iterationLoops[0]!.unresolvedResidue!.requestRefs).not.toContain('request-ui-only');
    expect(judge.activeGenerationRefs).not.toContain('generation-ui-only');
    expect(judge.requests).not.toContainEqual(expect.objectContaining({ requestRef: 'request-ui-only' }));
    expect(judge.receipts).not.toContainEqual(expect.objectContaining({ receiptRef: 'receipt-ui-only' }));
    expect(judge.unresolvedResidue!.requestRefs).not.toContain('request-ui-only');
  });

  it('uses an intervention gate when both iteration gate refs are present', () => {
    const detail = iterationRunDetail();
    detail.iterationLoops[0]!.completionGateRef = 'completion-gate';
    detail.humanRequests.push({ ...detail.humanRequests[0]!, requestRef: 'completion-gate', gateKind: undefined });
    const producer = overlaysFromRun(detail).alpha.participantStages.find((row) => row.participantId === 'producer')!;
    expect(producer.gateKind).toBe('iteration-park');
  });

  it('keeps iteration edges distinct from DAG dependencies with stable ids', () => {
    const detail = iterationRunDetail();
    const first = iterationEdgesFromRun(detail);
    const second = iterationEdgesFromRun(detail);
    const dag = agentEdges(entryFromRun(detail));
    expect(second.map((edge) => edge.id)).toEqual(first.map((edge) => edge.id));
    expect(first.every((edge) => edge.kind === 'iteration-route')).toBe(true);
    expect(first.map((edge) => edge.id).some((id) => dag.some((edge) => edge.id === id))).toBe(false);
  });

  it('shows one accepted generation and full parked residue without inferring either from logs', () => {
    const overlays = overlaysFromRun(iterationRunDetail());
    const parked = overlays.alpha.participantStages[0]!;
    expect(parked.acceptedGenerationRefs).toEqual(['generation-accepted']);
    expect(parked.unresolvedResidue).toMatchObject({
      cyclesUsed: 2, attemptedRequestCycle: 3, attemptedRequestRef: 'request-attempted',
      failureReason: 'required output was byte-identical', artifactSnapshots: [{ byteIdentical: true }],
    });
    const absent = overlays.alpha.participantStages[1]!;
    expect(absent.lastVerdict).toBeUndefined();
    expect(absent.acceptedGenerationRefs).toBeUndefined();
    expect(absent.unresolvedResidue).toBeUndefined();
  });
});

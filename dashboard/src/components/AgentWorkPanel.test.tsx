// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RunDetailDto } from '../control/controlClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
import type { UseSseResult } from '../lib/sseClient';
import { overlaysFromRun } from '../control/runGraph';
import { AgentWorkPanel } from './AgentWorkPanel';

const attemptIo = vi.hoisted(() => ({ lines: [
  { seq: 1, t: '2026-08-06T00:00:00.000Z', dir: 'in' as const, line: 'operator input' },
  { seq: 2, t: '2026-08-06T00:00:01.000Z', dir: 'meta' as const, line: 'checkpoint' },
], live: true }));
vi.mock('../lib/useAttemptIo', () => ({ useAttemptIo: () => attemptIo }));

function unlocked(ui: React.ReactElement): React.JSX.Element {
  persistSession({ token: 'tok', expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

const detail: RunDetailDto = {
  ownerSubject: 'operator',
  run: {
    runRef: 'run-1', predecessorRunRef: null, title: 'Run', displayName: 'Run', shortRef: 1, workflowRef: 'wf',
    proposalRef: 'proposal-1', proposalRevision: 1, proposalHash: 'a'.repeat(64), publicationState: 'published',
    state: 'running', version: 1, managerSessionRef: 'session-manager', managerGeneration: 1, managerAssignment: null,
    createdAt: '', updatedAt: '',
  },
  stages: [
    { stageRef: 'stage-alpha', runRef: 'run-1', stageId: 'alpha-step', title: 'Alpha step', dependsOn: [], canonicalCardRef: null, state: 'running', version: 1, currentAttemptRef: 'attempt-alpha', assignment: { agentId: 'alpha', declarationPath: '', declarationHash: '', profileId: 'worker:alpha', runtime: 'claude', model: 'model' }, createdAt: '', updatedAt: '' },
    { stageRef: 'stage-beta', runRef: 'run-1', stageId: 'beta-step', title: 'Beta step', dependsOn: [], canonicalCardRef: null, state: 'waiting-human', version: 1, currentAttemptRef: 'attempt-beta', assignment: { agentId: 'beta', declarationPath: '', declarationHash: '', profileId: 'worker:beta', runtime: 'claude', model: 'model' }, createdAt: '', updatedAt: '' },
  ],
  attempts: [
    { attemptRef: 'attempt-alpha', runRef: 'run-1', stageRef: 'stage-alpha', generation: 1, predecessorAttemptRef: null, runtime: 'claude', model: 'model', state: 'running', version: 1, managedSessionRef: null, createdAt: '2026-08-06T00:00:00.000Z', updatedAt: '' },
  ],
  sessions: [],
  humanRequests: [
    { requestRef: 'request-alpha', runRef: 'run-1', displayName: 'Run', shortRef: 1, stageRef: 'stage-alpha', kind: 'approval', revision: 1, state: 'open', title: 'Alpha gate', prompt: 'Approve alpha', ask: 'Approve alpha.', technicalDetail: null, response: null, createdAt: '', updatedAt: '' },
    { requestRef: 'request-beta', runRef: 'run-1', displayName: 'Run', shortRef: 1, stageRef: 'stage-beta', kind: 'approval', revision: 1, state: 'open', title: 'Beta gate', prompt: 'Approve beta', ask: 'Approve beta.', technicalDetail: null, response: null, createdAt: '', updatedAt: '' },
  ],
  stageGenerations: [], generationSupersessions: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [],
};

const sse: UseSseResult = { last: null, count: 0 };

describe('AgentWorkPanel', () => {
  afterEach(() => { cleanup(); clearStoredSession(); vi.clearAllMocks(); });

  it('renders the structured stream, sends a message, and scopes gates to the selected agent', async () => {
    const onRespondRequest = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ delivery: 'queued' }), { status: 202 })));
    render(unlocked(<AgentWorkPanel runRef="run-1" agentId="alpha" run={detail}
      overlay={{ state: 'running', openGate: true, attemptRef: 'attempt-alpha', participantStages: [] }} sse={sse} onClose={vi.fn()}
      onRespondRequest={onRespondRequest} />));

    expect(screen.getByTestId('agent-work-panel-stream').textContent).toContain('› operator input');
    expect(screen.getByTestId('agent-work-panel-stream').textContent).toContain('checkpoint');
    expect(screen.getByTestId('run-gate-request-alpha')).toBeTruthy();
    expect(screen.queryByTestId('run-gate-request-beta')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    expect(onRespondRequest).toHaveBeenCalledWith(detail.humanRequests[0], 'approved', '');

    fireEvent.change(screen.getByLabelText('Message alpha'), { target: { value: 'Continue with the next step.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/queued for its next turn/i));
    expect(fetch).toHaveBeenCalledWith('/api/control/runs/run-1/agents/alpha/messages', expect.objectContaining({
      body: JSON.stringify({ message: 'Continue with the next step.' }),
    }));
  });

  it('disables the composer when locked or its overlay is terminal, and hides it for unresolved groups', () => {
    const props = {
      runRef: 'run-1', agentId: 'alpha', run: detail, sse, onClose: vi.fn(), onRespondRequest: vi.fn(),
      overlay: { state: 'succeeded' as const, openGate: false, attemptRef: 'attempt-alpha', participantStages: [] },
    };
    const view = render(unlocked(<AgentWorkPanel {...props} />));
    expect((screen.getByLabelText('Message alpha') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-work-panel-composer-hint').textContent).toMatch(/no longer accepting/i);
    view.unmount();
    clearStoredSession();
    const locked = render(<SessionProvider><AgentWorkPanel {...props} overlay={{ state: 'running', openGate: false, attemptRef: 'attempt-alpha', participantStages: [] }} /></SessionProvider>);
    expect((screen.getByLabelText('Message alpha') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-work-panel-composer-hint').textContent).toMatch(/unlock/i);
    locked.rerender(unlocked(<AgentWorkPanel {...props} agentId="" />));
    expect(screen.queryByTestId('agent-work-panel-composer')).toBeNull();
  });

  it('excludes specialized iteration gates from the generic human response controls', () => {
    const parked = {
      ...detail,
      humanRequests: [
        { ...detail.humanRequests[0], requestRef: 'request-generic' },
        {
          ...detail.humanRequests[0], requestRef: 'request-iteration-completion',
          title: 'Iteration complete', prompt: 'Approve the accepted generation.',
        },
        {
          ...detail.humanRequests[0], requestRef: 'request-iteration-park', gateKind: 'iteration-park',
          title: 'Iteration parked', prompt: 'Approve this exact set or decline and relaunch separately.',
        },
      ],
      iterationLoops: [{
        iterationLoopRef: 'loop-1', iterationGroupId: 'group-1', completionGateRef: 'request-iteration-completion',
        interventionRef: 'request-iteration-park',
      }],
    } as unknown as RunDetailDto;
    render(unlocked(<AgentWorkPanel runRef="run-1" agentId="alpha" run={parked}
      overlay={{ state: 'waiting-human', openGate: true, attemptRef: 'attempt-alpha', participantStages: [] }} sse={sse} onClose={vi.fn()}
      onRespondRequest={vi.fn()} />));
    expect(screen.queryByTestId('run-gate-request-iteration-park')).toBeNull();
    expect(screen.queryByTestId('run-gate-request-iteration-completion')).toBeNull();
    expect(screen.getByTestId('run-gate-request-generic')).toBeTruthy();
  });

  it('shows the selected participant mandate perspective lineage receipts and parked residue', () => {
    const parked = {
      ...detail,
      humanRequests: [{
        ...detail.humanRequests[0], requestRef: 'request-park', gateKind: 'iteration-park',
        title: 'Iteration parked', prompt: 'Approve this exact artifact set.',
      }],
      iterationLoops: [{
        iterationLoopRef: 'loop-1', runRef: 'run-1', definitionHash: 'definition', iterationGroupId: 'draft-loop',
        goal: 'Ship an accurate draft.', participants: [
          { participantId: 'producer', stageRef: 'alpha-step', role: 'contributor', perspective: 'Protect factual accuracy.', mandate: 'Revise only supported claims.' },
          { participantId: 'judge', stageRef: 'alpha-step', role: 'judge', perspective: 'Read as a skeptical editor.', mandate: 'Accept only cited claims.' },
        ], routes: [{ routeId: 'review', senderParticipantId: 'producer', recipientParticipantId: 'judge', requestKinds: ['review'], baseResolutionStageIds: ['alpha-step'] }],
        activation: { seedParticipantId: 'producer', seedArtifactIds: ['draft'] }, initialStepId: 'review-step',
        schedule: [{ stepId: 'review-step', routeId: 'review', cycle: 'current' }], artifacts: ['draft.md'], criteria: [],
        maxCycles: 3, cycleUnit: 'judge verdicts', terminalAuthorities: [{ participantId: 'judge', verdict: 'pass' }], cyclesUsed: 2,
        state: 'awaiting-park-gate', turnOwnerParticipantId: 'producer', currentStepId: 'review-step',
        activeGenerationRefs: ['generation-2'], lastReceiptRef: 'receipt-1', interventionRef: 'request-park', parkReason: 'no-progress',
        unresolvedResidue: {
          unresolvedFindings: [{ findingId: 'finding-1', criterionId: 'accuracy', severity: 'blocking', summary: 'Citation is missing.', evidencePaths: ['draft.md'] }],
          positions: [{ positionId: 'position-1', participantId: 'judge', summary: 'The claim is unsupported.', generationRefs: ['generation-2'] }],
          recordedDissent: [{ dissentId: 'dissent-1', participantId: 'producer', positionId: 'position-1', summary: 'The source is in the appendix.' }],
          requestRefs: ['iteration-request-1'], receiptRefs: ['receipt-1'], activeGenerationRefs: ['generation-2'], acceptedGenerationRefs: [],
          nextRouteId: 'review', cycleUnit: 'judge verdicts', cyclesUsed: 2, maxCycles: 3,
          attemptedRequestRef: 'iteration-request-2', attemptedRequestCycle: 3,
          artifactSnapshots: [{ path: 'draft.md', regularFile: true, size: 120, sha256: 'before', afterRegularFile: true, afterSize: 120, afterSha256: 'before', byteIdentical: true }],
          failureReason: 'The required artifact did not change.',
        },
        version: 7, createdAt: '', updatedAt: '',
      }],
      iterationRequests: [{
        schema: 'kb.iteration-request/v1', requestRef: 'iteration-request-1', iterationLoopRef: 'loop-1', stepId: 'review-step', routeId: 'review',
        senderParticipantId: 'producer', recipientParticipantId: 'judge', kind: 'review', cycle: 2,
        inputGenerationRefs: ['generation-2'], baseCommit: 'base-commit', artifactHashes: { 'draft.md': 'hash-2' }, criteria: [],
        unresolvedFindingRefs: ['finding-1'], preservedInvariants: ['Keep citations'], nextAcceptanceCheck: 'All claims cited', instructions: 'Review the draft.',
      }],
      iterationReceipts: [{
        schema: 'kb.iteration-receipt/v1', receiptRef: 'receipt-1', requestRef: 'iteration-request-1', iterationLoopRef: 'loop-1', participantId: 'judge',
        cycle: 2, verdict: 'fail', inputGenerationRefs: ['generation-2'], criteria: [],
        findings: [{ findingId: 'finding-1', criterionId: 'accuracy', severity: 'blocking', summary: 'Citation is missing.', evidencePaths: ['draft.md'] }],
        positions: [{ positionId: 'position-1', participantId: 'judge', summary: 'The claim is unsupported.', generationRefs: ['generation-2'] }],
        recordedDissent: [{ dissentId: 'dissent-1', participantId: 'producer', positionId: 'position-1', summary: 'The source is in the appendix.' }],
        summary: 'Needs one citation.', outcomeHash: 'outcome-hash', outputGenerationRefs: [], baseCommit: 'base-commit', canonicalCommit: 'canonical-commit',
        createdAt: '', version: 1,
      }],
    } as RunDetailDto;
    const overlay = overlaysFromRun(parked).alpha;
    render(unlocked(<AgentWorkPanel runRef="run-1" agentId="alpha" run={parked} overlay={overlay}
      participantStageKey="participant-stage:alpha-step:draft-loop:producer"
      sse={sse} onClose={vi.fn()} onRespondRequest={vi.fn()} />));

    const participant = screen.getByTestId('agent-work-participant-participant-stage:alpha-step:draft-loop:producer');
    expect(participant.textContent).toContain('Revise only supported claims.');
    expect(participant.textContent).toContain('Protect factual accuracy.');
    expect(participant.textContent).toContain('iteration-request-1');
    expect(participant.textContent).toContain('generation-2');
    expect(participant.textContent).toContain('receipt-1');
    expect(participant.textContent).toContain('base-commit');
    expect(participant.textContent).toContain('canonical-commit');
    expect(participant.textContent).toContain('The claim is unsupported.');
    expect(participant.textContent).toContain('The source is in the appendix.');
    expect(participant.textContent).toContain('The required artifact did not change.');
    expect(participant.textContent).toContain('draft.md');
    expect(within(participant).getByTestId('iteration-approval-artifacts').textContent).toBe('generation-2');
    expect(participant.querySelector('input, textarea, select')).toBeNull();
    expect(screen.queryByTestId('agent-work-participant-participant-stage:alpha-step:draft-loop:judge')).toBeNull();
  });

  it('hides retained unresolved residue after a park gate has resolved', () => {
    const resolvedParticipant = {
      key: 'participant-stage:alpha-step:draft-loop:producer', stageId: 'alpha-step', stageRef: 'stage-alpha',
      iterationLoopRef: 'loop-1', iterationGroupId: 'draft-loop', participantId: 'producer', role: 'contributor',
      perspectiveSummary: 'Protect factual accuracy.', mandate: 'Revise only supported claims.', cyclesUsed: 2, maxCycles: 3,
      cycleUnit: 'judge verdicts', turnOwner: false, loopState: 'passed', parked: false, parkReason: 'exhausted',
      gateKind: 'iteration-park', gateState: 'resolved', activeGenerationRefs: ['generation-2'], requests: [], receipts: [],
      unresolvedResidue: { failureReason: 'Retained durability evidence.' },
    } as unknown as NonNullable<ReturnType<typeof overlaysFromRun>['alpha']>['participantStages'][number];
    render(unlocked(<AgentWorkPanel runRef="run-1" agentId="alpha" run={detail}
      overlay={{ state: 'succeeded', openGate: false, attemptRef: null, participantStages: [resolvedParticipant] }}
      participantStageKey={resolvedParticipant.key} sse={sse} onClose={vi.fn()} onRespondRequest={vi.fn()} />));

    const participant = screen.getByTestId(`agent-work-participant-${resolvedParticipant.key}`);
    expect(participant.textContent).not.toMatch(/parked/i);
    expect(within(participant).queryByRole('region', { name: 'Unresolved parked residue' })).toBeNull();
    expect(participant.textContent).not.toContain('Retained durability evidence.');
  });
});

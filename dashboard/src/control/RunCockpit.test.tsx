// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunCockpit } from './RunCockpit';
import type { OperationalEventDto, RunDetailDto } from './controlClient';

afterEach(cleanup);

const detail: RunDetailDto = {
  run: {
    runRef: 'run-1', predecessorRunRef: null, title: 'Synthetic control run', proposalRef: 'proposal-1', proposalRevision: 2,
    proposalHash: 'a'.repeat(64), publicationState: 'published', state: 'running', version: 4, managerSessionRef: 'session-manager',
    managerGeneration: 1, createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  },
  stages: [{
    stageRef: 'stage-1', runRef: 'run-1', stageId: 'compile', title: 'Compile proposal', dependsOn: [],
    canonicalCardRef: 'card-1', state: 'running', version: 2, currentAttemptRef: 'attempt-1',
    createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  }],
  attempts: [{
    attemptRef: 'attempt-1', runRef: 'run-1', stageRef: 'stage-1', generation: 1,
    predecessorAttemptRef: null, runtime: 'codex', model: 'gpt-5.6-sol', state: 'running', version: 2,
    managedSessionRef: 'session-worker', createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  }],
  sessions: [{
    sessionRef: 'session-manager', runRef: 'run-1', stageRef: null, attemptRef: null, role: 'manager',
    generation: 1, predecessorSessionRef: null, runtime: 'claude', model: 'claude-sonnet-5', state: 'running',
    version: 2, createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  }],
  humanRequests: [{
    requestRef: 'request-1', runRef: 'run-1', stageRef: 'stage-1', kind: 'review', revision: 3,
    state: 'open', title: 'Review the diff', prompt: 'Is this change inside the approved scope?', response: null,
    createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  }],
};

const events: OperationalEventDto[] = [{
  cursor: 7, runRef: 'run-1', kind: 'tool', source: 'worker', stageRef: 'stage-1', attemptRef: 'attempt-1',
  sessionRef: 'session-worker', status: 'success', summary: null, command: null, toolName: 'apply_patch', path: null,
  diff: null, checkpoint: null, createdAt: '2026-07-18T10:01:00.000Z',
}];

describe('RunCockpit', () => {
  it('projects manager, stage, attempt, canonical card, and public events', () => {
    render(<RunCockpit detail={detail} events={events} />);
    expect(screen.getByRole('heading', { name: 'Synthetic control run' })).toBeTruthy();
    expect(screen.getByText('session-manager')).toBeTruthy();
    expect(screen.getByText('card-1')).toBeTruthy();
    expect(screen.getByText(/attempt 1 · codex · gpt-5.6-sol/)).toBeTruthy();
    expect(within(screen.getByLabelText('Run Synthetic control run')).getByText('apply_patch')).toBeTruthy();
    expect(screen.getByText(/private reasoning and raw tool payloads are not part/i)).toBeTruthy();
    expect(screen.getByText('Plan amendment required')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reroute Compile proposal/ })).toBeNull();
  });

  it('offers an exact reroute only for a queued attempt whose stage has not started', () => {
    const onReroute = vi.fn();
    const queued: RunDetailDto = {
      ...detail,
      stages: detail.stages.map((stage) => ({ ...stage, state: 'ready' })),
      attempts: detail.attempts.map((attempt) => ({ ...attempt, state: 'queued' })),
      sessions: [
        ...detail.sessions,
        {
          sessionRef: 'session-worker', runRef: 'run-1', stageRef: 'stage-1', attemptRef: 'attempt-1', role: 'worker',
          generation: 1, predecessorSessionRef: null, runtime: 'codex', model: 'gpt-5.6-sol', state: 'pending',
          version: 1, createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
        },
      ],
      humanRequests: [],
    };
    render(<RunCockpit detail={queued} events={[]} onReroute={onReroute} />);
    expect(screen.getByText('Reroutable before start')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Reroute Compile proposal' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Runtime for Compile proposal'), { target: { value: 'claude' } });
    fireEvent.change(screen.getByLabelText('Model for Compile proposal'), { target: { value: 'claude-sonnet-5' } });
    fireEvent.click(button);
    expect(onReroute).toHaveBeenCalledWith(queued.stages[0], queued.attempts[0], 'claude', 'claude-sonnet-5');
  });

  it('keeps manager conversation separate from checkpoint-bound steering', () => {
    const onManagerMessage = vi.fn();
    const onSteer = vi.fn();
    render(<RunCockpit detail={detail} events={[]} onManagerMessage={onManagerMessage} onSteer={onSteer} />);

    fireEvent.change(screen.getByLabelText('Message manager'), { target: { value: 'Status, please.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onManagerMessage).toHaveBeenCalledWith('Status, please.');

    fireEvent.change(screen.getByLabelText('Safe checkpoint'), { target: { value: 'after-tests' } });
    fireEvent.change(screen.getByLabelText('Steering instruction'), { target: { value: 'Inspect the diff.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue steering' }));
    expect(onSteer).toHaveBeenCalledWith('after-tests', 'Inspect the diff.');
    expect(screen.getByText(/applies only when this checkpoint is reached/i)).toBeTruthy();
  });

  it('returns the durable Human Request object and revision-bound decision intent to integration code', () => {
    const onHumanResponse = vi.fn();
    render(<RunCockpit detail={detail} events={[]} onHumanResponse={onHumanResponse} />);
    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'Please narrow the scope.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(onHumanResponse).toHaveBeenCalledWith(detail.humanRequests[0], 'changes-requested', 'Please narrow the scope.');
  });

  it('does not offer an approval override for a governance refusal', () => {
    const refused: RunDetailDto = {
      ...detail,
      humanRequests: [{ ...detail.humanRequests[0], kind: 'governance-refusal' }],
    };
    render(<RunCockpit detail={refused} events={[]} onHumanResponse={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Approved' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Responded' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeTruthy();
  });

  it('offers Manager recovery only for a terminal or interrupted head', () => {
    const onManagerSuccessor = vi.fn();
    const interrupted: RunDetailDto = {
      ...detail,
      sessions: detail.sessions.map((session) => ({ ...session, state: 'interrupted' })),
    };
    render(<RunCockpit detail={interrupted} events={[]} onManagerSuccessor={onManagerSuccessor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start successor Manager' }));
    expect(onManagerSuccessor).toHaveBeenCalledTimes(1);
  });
});

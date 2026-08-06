// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RunDetailDto } from '../control/controlClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
import type { UseSseResult } from '../lib/sseClient';
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
  reviewLoops: [], reviewReceipts: [],
};

const sse: UseSseResult = { last: null, count: 0 };

describe('AgentWorkPanel', () => {
  afterEach(() => { cleanup(); clearStoredSession(); vi.clearAllMocks(); });

  it('renders the structured stream, sends a message, and scopes gates to the selected agent', async () => {
    const onRespondRequest = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ delivery: 'queued' }), { status: 202 })));
    render(unlocked(<AgentWorkPanel runRef="run-1" agentId="alpha" run={detail}
      overlay={{ state: 'running', openGate: true, attemptRef: 'attempt-alpha' }} sse={sse} onClose={vi.fn()}
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
      overlay: { state: 'succeeded' as const, openGate: false, attemptRef: 'attempt-alpha' },
    };
    const view = render(unlocked(<AgentWorkPanel {...props} />));
    expect((screen.getByLabelText('Message alpha') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-work-panel-composer-hint').textContent).toMatch(/no longer accepting/i);
    view.unmount();
    clearStoredSession();
    const locked = render(<SessionProvider><AgentWorkPanel {...props} overlay={{ state: 'running', openGate: false, attemptRef: 'attempt-alpha' }} /></SessionProvider>);
    expect((screen.getByLabelText('Message alpha') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-work-panel-composer-hint').textContent).toMatch(/unlock/i);
    locked.rerender(unlocked(<AgentWorkPanel {...props} agentId="" />));
    expect(screen.queryByTestId('agent-work-panel-composer')).toBeNull();
  });
});

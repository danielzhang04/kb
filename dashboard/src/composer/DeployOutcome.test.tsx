// @vitest-environment jsdom
/**
 * C5 — the governed deploy-outcome wrapper. It owns the deploy() round-trip and renders the results
 * strip inside the Composer surface (via C3's optional renderOutcome slot). These tests drive the
 * surface with a FAKE deploy (no real network, no real /api/write/*, no real claude) and assert the
 * governed outcome is surfaced legibly for each shape: a filed card id (launch), a branch/PR target
 * (save), a refusal (status + reason, incl. the 409 approval-locked shape), and per-file follow-up
 * saves that fire one governed deploy each, only on click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { DeployOutcome } from './DeployOutcome';
import type { DeployResult } from './deploy';
import type { DeployPlan } from './artifactTypes';

/** The deploy() seam signature, used to type the fakes so `.mock.calls[n][0]` is a DeployPlan. */
type DeployFn = (plan: DeployPlan, sessionToken?: string) => Promise<DeployResult>;

beforeEach(() => {
  // ComposerChat only touches fetch on send; a never-resolving stub keeps the chat pane inert.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Fill the Task draft form to a deploy-ready state (riskTier defaults to a valid T2). */
function fillTask(): void {
  fireEvent.change(screen.getByLabelText('Task project'), { target: { value: 'kb' } });
  fireEvent.change(screen.getByLabelText('Task action'), { target: { value: 'tidy the ledger' } });
  fireEvent.change(screen.getByLabelText('Task target'), { target: { value: 'ledgers/' } });
}

function fillWorkflow(): void {
  fireEvent.change(screen.getByLabelText('Workflow filename'), { target: { value: 'wf_tidy.md' } });
  fireEvent.change(screen.getByLabelText('Workflow project'), { target: { value: 'kb' } });
  fireEvent.change(screen.getByLabelText('Workflow notes'), { target: { value: 'do the thing' } });
  fireEvent.change(screen.getByLabelText('Stage 1 action'), { target: { value: 'tidy' } });
  fireEvent.change(screen.getByLabelText('Stage 1 work order'), { target: { value: 'Tidy the thing' } });
}

describe('DeployOutcome — governed deploy + results strip', () => {
  it('deploy_success_launch_shows_card_id', async () => {
    const deployImpl = vi.fn<DeployFn>(
      async () => ({ ok: true, kind: 'task', cardId: '01J9CARD', cardPath: 'queue/01J9CARD.md' }),
    );
    render(<DeployOutcome sessionToken="tok" initialKind="task" onBack={() => {}} deployImpl={deployImpl} />);

    fillTask();
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));

    const strip = await screen.findByTestId('composer-outcome');
    expect(strip.textContent).toMatch(/01J9CARD/);
    // The dispatcher was handed the validated task plan through the launch endpoint.
    expect(deployImpl).toHaveBeenCalledTimes(1);
    expect(deployImpl.mock.calls[0][0]).toMatchObject({ kind: 'task', endpoint: 'launch' });
  });

  it('disables the primary deploy while pending and prevents a double submit', async () => {
    let resolveDeploy: ((result: DeployResult) => void) | undefined;
    const deployImpl = vi.fn<DeployFn>(
      () =>
        new Promise<DeployResult>((resolve) => {
          resolveDeploy = resolve;
        }),
    );
    render(<DeployOutcome sessionToken="tok" initialKind="task" onBack={() => {}} deployImpl={deployImpl} />);
    fillTask();

    const deploy = screen.getByRole('button', { name: 'Run task' }) as HTMLButtonElement;
    fireEvent.click(deploy);
    fireEvent.click(deploy);

    await waitFor(() => expect(deployImpl).toHaveBeenCalledTimes(1));
    expect(deploy.disabled).toBe(true);
    expect(deploy.textContent).toMatch(/Launching/);

    resolveDeploy?.({ ok: true, kind: 'task', cardId: 'ONE', cardPath: 'queue/ONE.md' });
    await screen.findByText(/ONE/);
    expect((screen.getByRole('button', { name: 'Run task' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('surfaces a rejected primary request as a refusal and re-enables Deploy', async () => {
    const deployImpl = vi.fn<DeployFn>(async () => {
      throw new Error('network vanished');
    });
    render(<DeployOutcome sessionToken="tok" initialKind="task" onBack={() => {}} deployImpl={deployImpl} />);
    fillTask();
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));

    expect((await screen.findByTestId('composer-refusal')).textContent).toMatch(/network vanished/i);
    expect((screen.getByRole('button', { name: 'Run task' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('resolves a passkey session at deploy time and uses the returned token', async () => {
    const onRequestSession = vi.fn(async () => ({ token: 'fresh-token', expiresAt: Date.now() + 60_000 }));
    const deployImpl = vi.fn<DeployFn>(
      async () => ({ ok: true, kind: 'task', cardId: 'AUTH-CARD', cardPath: 'queue/AUTH-CARD.md' }),
    );
    render(
      <DeployOutcome
        initialKind="task"
        onBack={() => {}}
        onRequestSession={onRequestSession}
        deployImpl={deployImpl}
      />,
    );

    fillTask();
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));
    await screen.findByText(/AUTH-CARD/);
    expect(onRequestSession).toHaveBeenCalledTimes(1);
    expect(deployImpl).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task' }), 'fresh-token');
  });

  it('surfaces a passkey refusal and makes no deploy request', async () => {
    const deployImpl = vi.fn<DeployFn>();
    render(
      <DeployOutcome
        initialKind="task"
        onBack={() => {}}
        onRequestSession={async () => null}
        deployImpl={deployImpl}
      />,
    );

    fillTask();
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));
    expect((await screen.findByTestId('composer-refusal')).textContent).toMatch(/sign-in failed/i);
    expect(deployImpl).not.toHaveBeenCalled();
  });

  it('deploy_success_save_shows_target', async () => {
    const deployImpl = vi.fn<DeployFn>(
      async () => ({ ok: true, kind: 'workflow', target: 'claude/composer-wf → PR #42' }),
    );
    render(<DeployOutcome sessionToken="tok" initialKind="workflow" onBack={() => {}} deployImpl={deployImpl} />);

    fillWorkflow();
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));

    const strip = await screen.findByTestId('composer-outcome');
    expect(strip.textContent).toMatch(/PR #42/);
    expect(deployImpl.mock.calls[0][0]).toMatchObject({ kind: 'workflow', endpoint: 'save' });
  });

  it('Run now launches the structured workflow DAG without saving the definition', async () => {
    const deployImpl = vi.fn<DeployFn>();
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ runId: 'run-wf-tidy-1', cards: [{ stageId: 'stage-1', cardId: 'c1', state: 'inbox' }] }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(<DeployOutcome sessionToken="tok" initialKind="workflow" onBack={() => {}} deployImpl={deployImpl} />);

    fillWorkflow();
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));

    expect(await screen.findByText(/run-wf-tidy-1/)).toBeTruthy();
    expect(deployImpl).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/write/workflow-runs');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      name: 'wf_tidy',
      project: 'kb',
      stages: [{ id: 'stage-1', owner: 'codex-worker', riskTier: 'T2' }],
    });
  });

  it('deploy_refusal_shows_reason', async () => {
    const deployImpl = vi.fn<DeployFn>(
      async () => ({
        ok: false,
        status: 409,
        error: 'approval-locked',
        reason: 'this card is awaiting approval',
      }),
    );
    render(<DeployOutcome sessionToken="tok" initialKind="task" onBack={() => {}} deployImpl={deployImpl} />);

    fillTask();
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));

    const refusal = await screen.findByTestId('composer-refusal');
    expect(refusal.textContent).toMatch(/awaiting approval/);
    // The 409 approval-locked shape is surfaced legibly (status + error code).
    expect(refusal.textContent).toMatch(/409/);
    expect(refusal.textContent).toMatch(/approval-locked/);
  });

  it('followups_offered_and_deploy_one_by_click', async () => {
    const deployImpl = vi
      .fn<DeployFn>()
      .mockResolvedValueOnce({
        ok: true,
        kind: 'project',
        target: 'claude/composer-proj → PR #7',
        followUps: [
          { relpath: 'orgs/demo/STATE.md', content: '# STATE' },
          { relpath: 'orgs/demo/contract.md', content: '# contract' },
        ],
      })
      .mockResolvedValue({ ok: true, kind: 'project', target: 'claude/composer-proj → PR #8' });

    render(<DeployOutcome sessionToken="tok" initialKind="project" onBack={() => {}} deployImpl={deployImpl} />);

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'demo' } });
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));

    // Both follow-up files are OFFERED (relpath + a Save button) but nothing fired beyond the primary.
    const list = await screen.findByLabelText('Follow-up saves');
    expect(within(list).getByText('orgs/demo/STATE.md')).toBeTruthy();
    expect(within(list).getByText('orgs/demo/contract.md')).toBeTruthy();
    expect(deployImpl).toHaveBeenCalledTimes(1);

    // Clicking ONE Save fires exactly one more governed deploy — for THAT file, as a durable save.
    fireEvent.click(screen.getByRole('button', { name: 'Save orgs/demo/STATE.md' }));
    await waitFor(() => expect(deployImpl).toHaveBeenCalledTimes(2));
    expect(deployImpl.mock.calls[1][0]).toMatchObject({
      relpath: 'orgs/demo/STATE.md',
      endpoint: 'save',
      branchClass: 'durable',
    });
    // The other file was NOT auto-fired.
    expect(deployImpl.mock.calls[1][0]).not.toMatchObject({ relpath: 'orgs/demo/contract.md' });
    // That file now reads as saved.
    expect(await screen.findByTestId('followup-done:orgs/demo/STATE.md')).toBeTruthy();
  });

  it('surfaces a rejected follow-up request instead of leaving the save pending', async () => {
    const deployImpl = vi
      .fn<DeployFn>()
      .mockResolvedValueOnce({
        ok: true,
        kind: 'project',
        target: 'claude/project-demo',
        followUps: [{ relpath: 'orgs/demo/STATE.md', content: '# STATE' }],
      })
      .mockRejectedValueOnce(new Error('follow-up transport failed'));
    render(<DeployOutcome sessionToken="tok" initialKind="project" onBack={() => {}} deployImpl={deployImpl} />);

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'demo' } });
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));
    await screen.findByLabelText('Follow-up saves');
    fireEvent.click(screen.getByRole('button', { name: 'Save orgs/demo/STATE.md' }));

    expect(await screen.findByText(/follow-up transport failed/i)).toBeTruthy();
    expect(screen.queryByText('Saving…')).toBeNull();
  });

  it('reuses a point-of-action session for follow-up saves', async () => {
    const onRequestSession = vi.fn(async () => ({ token: 'followup-token', expiresAt: Date.now() + 60_000 }));
    const deployImpl = vi
      .fn<DeployFn>()
      .mockResolvedValueOnce({
        ok: true,
        kind: 'project',
        target: 'claude/project-demo',
        followUps: [{ relpath: 'orgs/demo/STATE.md', content: '# STATE' }],
      })
      .mockResolvedValueOnce({ ok: true, kind: 'project', target: 'claude/project-demo' });
    render(
      <DeployOutcome
        initialKind="project"
        onBack={() => {}}
        onRequestSession={onRequestSession}
        deployImpl={deployImpl}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'demo' } });
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));
    await screen.findByLabelText('Follow-up saves');
    fireEvent.click(screen.getByRole('button', { name: 'Save orgs/demo/STATE.md' }));
    await waitFor(() => expect(deployImpl).toHaveBeenCalledTimes(2));
    expect(onRequestSession).toHaveBeenCalledTimes(1);
    expect(deployImpl.mock.calls[0][1]).toBe('followup-token');
    expect(deployImpl.mock.calls[1][1]).toBe('followup-token');
  });

  it('agent_deploy_surfaces_durable_pr_target_and_runner_boundary', async () => {
    const deployImpl = vi.fn<DeployFn>(
      async () => ({ ok: true, kind: 'agent', target: 'claude/agent-research-worker → PR #9' }),
    );
    render(<DeployOutcome sessionToken="tok" initialKind="agent" onBack={() => {}} deployImpl={deployImpl} />);
    fireEvent.change(screen.getByLabelText('Agent id'), { target: { value: 'research-worker' } });
    fireEvent.change(screen.getByLabelText('Agent description'), { target: { value: 'Volume worker.' } });
    fireEvent.click(screen.getByRole('button', { name: /Deploy|Run task|Save definition/ }));

    const strip = await screen.findByTestId('composer-outcome');
    expect(strip.textContent).toMatch(/PR #9/);
    expect(screen.getByTestId('composer-deploy-note').textContent).toMatch(/does not provision or bind/i);
    expect(deployImpl).toHaveBeenCalledTimes(1);
    expect(deployImpl.mock.calls[0][0]).toMatchObject({
      kind: 'agent',
      relpath: 'agents/research-worker.md',
      endpoint: 'save',
      branchClass: 'durable',
    });
    expect((deployImpl.mock.calls[0][0] as DeployPlan).content).toContain('runner-bound: false');
  });

  it('no outcome strip until a deploy has happened', () => {
    render(<DeployOutcome sessionToken="tok" initialKind="task" onBack={() => {}} deployImpl={vi.fn()} />);
    expect(screen.queryByTestId('composer-outcome')).toBeNull();
  });
});

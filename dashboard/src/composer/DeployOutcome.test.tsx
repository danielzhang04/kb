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
import { toDeploy } from './artifactTypes';
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

describe('DeployOutcome — governed deploy + results strip', () => {
  it('deploy_success_launch_shows_card_id', async () => {
    const deployImpl = vi.fn<DeployFn>(
      async () => ({ ok: true, kind: 'task', cardId: '01J9CARD', cardPath: 'queue/01J9CARD.md' }),
    );
    render(<DeployOutcome sessionToken="tok" initialKind="task" onBack={() => {}} deployImpl={deployImpl} />);

    fillTask();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));

    const strip = await screen.findByTestId('composer-outcome');
    expect(strip.textContent).toMatch(/01J9CARD/);
    // The dispatcher was handed the validated task plan through the launch endpoint.
    expect(deployImpl).toHaveBeenCalledTimes(1);
    expect(deployImpl.mock.calls[0][0]).toMatchObject({ kind: 'task', endpoint: 'launch' });
  });

  it('deploy_success_save_shows_target', async () => {
    const deployImpl = vi.fn<DeployFn>(
      async () => ({ ok: true, kind: 'workflow', target: 'claude/composer-wf → PR #42' }),
    );
    render(<DeployOutcome sessionToken="tok" initialKind="workflow" onBack={() => {}} deployImpl={deployImpl} />);

    fireEvent.change(screen.getByLabelText('Workflow filename'), { target: { value: 'wf_tidy.md' } });
    fireEvent.change(screen.getByLabelText('Workflow body'), { target: { value: 'do the thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));

    const strip = await screen.findByTestId('composer-outcome');
    expect(strip.textContent).toMatch(/PR #42/);
    expect(deployImpl.mock.calls[0][0]).toMatchObject({ kind: 'workflow', endpoint: 'save' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));

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

  it('agent_deploy_surfaces_durable_pr_target_and_agent_save', async () => {
    // C7.5 — Composer's agent DRAFT FORM is a later chunk (agent is intentionally not a chip yet, per
    // Composer.test), so we exercise DeployOutcome's governed deploy machinery over a REAL agent DeployPlan
    // via the follow-up save path: the primary returns an agent outcome whose follow-up IS the
    // agents/<slug>.md file, and clicking Save fires that agent plan through the same deploy() the save
    // path uses. This confirms an agent plan flows the durable /api/write/save route and the strip reports
    // the PR target — while deploy.test.ts pins the exact endpoint/body/no-workBranch wiring.
    const agentPlan = toDeploy('agent', {
      id: 'research-worker',
      role: 'work',
      runtime: 'claude',
      description: 'Volume worker.',
      body: '# Agent: research-worker\n',
    });
    const deployImpl = vi
      .fn<DeployFn>()
      .mockResolvedValueOnce({
        ok: true,
        kind: 'agent',
        target: 'claude/agent-research-worker → PR to main',
        followUps: [{ relpath: agentPlan.relpath, content: agentPlan.content }],
      })
      .mockResolvedValue({ ok: true, kind: 'agent', target: 'claude/agent-research-worker → PR #9' });

    // A concrete draft form is needed to press Deploy; project is used purely as the scaffolding trigger.
    render(<DeployOutcome sessionToken="tok" initialKind="project" onBack={() => {}} deployImpl={deployImpl} />);
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));

    // The outcome strip reports the durable / PR target for the agent deploy.
    const strip = await screen.findByTestId('composer-outcome');
    expect(strip.textContent).toMatch(/PR to main/);

    // The agents/<slug>.md follow-up deploys as a durable agents/ save (kind agent, endpoint save).
    fireEvent.click(screen.getByRole('button', { name: `Save ${agentPlan.relpath}` }));
    await waitFor(() => expect(deployImpl).toHaveBeenCalledTimes(2));
    expect(deployImpl.mock.calls[1][0]).toMatchObject({
      kind: 'agent',
      relpath: 'agents/research-worker.md',
      endpoint: 'save',
      branchClass: 'durable',
    });
    expect((deployImpl.mock.calls[1][0] as DeployPlan).content).toContain('runner-bound: false');
    expect(await screen.findByTestId('followup-done:agents/research-worker.md')).toBeTruthy();
  });

  it('no outcome strip until a deploy has happened', () => {
    render(<DeployOutcome sessionToken="tok" initialKind="task" onBack={() => {}} deployImpl={vi.fn()} />);
    expect(screen.queryByTestId('composer-outcome')).toBeNull();
  });
});

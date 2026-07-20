// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProposalCard } from './ProposalCard';
import type { ProposalRevisionDto } from './controlClient';

afterEach(cleanup);

function revision(decision: ProposalRevisionDto['approval'] = null): ProposalRevisionDto {
  const hash = 'a'.repeat(64);
  return {
    proposalRef: 'proposal-1',
    revision: 2,
    contentHash: hash,
    previousContentHash: 'b'.repeat(64),
    createdAt: '2026-07-18T10:00:00.000Z',
    sourceComposerRef: 'composer',
    sourceTurnId: 'turn-1',
    approval: decision,
    proposal: {
      schema: 'kb.plan-proposal/v1',
      proposalId: 'managed-control',
      project: 'kb-ops',
      title: 'Managed control plane',
      summary: 'Compile and run a governed synthetic workflow.',
      manager: { runtime: 'claude', model: 'claude-sonnet-5', requiredSkills: ['tests'] },
      scope: { read: ['dashboard'], write: ['dashboard/src/control'] },
      governanceRefs: ['CLAUDE.md', 'orgs/kb-ops/contract.md'],
      stages: [{
        id: 'compile', title: 'Compile proposal', action: 'implement:proposal', target: 'dashboard/src/control',
        workOrder: 'Build the proposal review.', riskTier: 'T2', dependsOn: [],
        worker: { runtime: 'codex', model: 'gpt-5.6-sol' }, requiredSkills: ['tests'],
        scope: { read: ['dashboard'], write: ['dashboard/src/control'] }, artifacts: [], checkpoints: [],
        humanGates: [{ id: 'review', kind: 'review', prompt: 'Review the exact revision.' }],
      }],
    },
    diff: {
      schema: 'kb.plan-proposal-diff/v1', fromContentHash: 'b'.repeat(64), toContentHash: hash, changed: true,
      changes: [{ path: '/title', before: 'Old title', after: 'Managed control plane' }],
    },
  };
}

describe('ProposalCard', () => {
  it('shows the inspectable plan and diff without an editable workflow form', () => {
    render(<ProposalCard revision={revision()} />);
    expect(screen.getByRole('heading', { name: 'Managed control plane' })).toBeTruthy();
    expect(screen.getByText('Compile proposal')).toBeTruthy();
    expect(screen.getByText('claude · claude-sonnet-5')).toBeTruthy();
    const changes = screen.getByLabelText('Proposal changes');
    expect(within(changes).getByText('/title')).toBeTruthy();
    expect(screen.getByText(/Continue planning in Composer/i)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('offers one exact-revision decision and withholds launch before approval', () => {
    const onDecision = vi.fn();
    const onLaunch = vi.fn();
    render(<ProposalCard revision={revision()} onDecision={onDecision} onLaunch={onLaunch} />);

    const launch = screen.getByRole('button', { name: 'Start governed run' }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Approve exact revision' }));
    expect(onDecision).toHaveBeenCalledWith('approved');
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('enables launch only for the already approved immutable revision', () => {
    const onLaunch = vi.fn();
    render(<ProposalCard revision={revision({ revision: 1, decision: 'approved', decidedAt: '2026-07-18T10:01:00.000Z' })} onLaunch={onLaunch} />);
    expect((screen.getByRole('button', { name: 'Approve exact revision' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start governed run' }));
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });
});

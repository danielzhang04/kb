// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HumanRequest } from '../../server/control/types.ts';
import { RunInspector } from './RunInspector.tsx';

afterEach(cleanup);

function gate(overrides: Partial<HumanRequest> = {}): HumanRequest {
  return {
    requestRef: 'ask-1', runRef: 'run-1', stageRef: null, kind: 'input', revision: 1,
    state: 'open', title: 'Need input', prompt: 'Choose a direction', response: null,
    createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z', ...overrides,
  };
}

const common = {
  plan: 'Ship W3', milestones: ['Tests red', 'Tests green'],
  outputs: [{ kind: 'repository-file' as const, label: 'Result', path: 'dashboard/result.txt' }],
  details: { stepSkeleton: 'step-a → step-b', envelope: 'run-1', linkedCards: ['card-1'], evidence: ['typecheck'], ids: ['run-1'] },
};

describe('RunInspector', () => {
  it('shows plan, milestones, outputs, active gate, and one closed Details disclosure', () => {
    render(<RunInspector {...common} gate={gate()} ceremonyAvailable={false} onRespond={vi.fn()} />);
    expect(screen.getByText('Ship W3')).toBeTruthy();
    expect(screen.getByText('Tests green')).toBeTruthy();
    expect(screen.getByText('Choose a direction')).toBeTruthy();
    const details = screen.getByRole('button', { name: 'Details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('step-a → step-b')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(1);
  });

  it('submits an ordinary gate once and stays disabled after the accepted revision', () => {
    const onRespond = vi.fn();
    const { rerender } = render(<RunInspector {...common} gate={gate()} ceremonyAvailable={false} onRespond={onRespond} />);
    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'continue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Respond' }));
    expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ requestRef: 'ask-1', expectedRevision: 1, decision: 'responded', response: 'continue' }));

    rerender(<RunInspector {...common} gate={gate({ state: 'resolved', revision: 2 })} ceremonyAvailable={false} onRespond={onRespond} />);
    expect(screen.getByRole('button', { name: 'Respond' }).hasAttribute('disabled')).toBe(true);
  });

  it('refuses a T3 gate in the UI when the ceremony is unavailable', () => {
    render(<RunInspector {...common} gate={gate({ kind: 'approval' })} ceremonyAvailable={false} onRespond={vi.fn()} />);
    expect(screen.getByText('Passkey ceremony unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
  });
});

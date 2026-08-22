// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EntityDetail } from '../../server/entities/contracts.ts';
import { AgentDetailBody } from './AgentDetail';

afterEach(cleanup);

const detail = {
  summary: { temporalLabel: 'Never run \u00b7 no schedule', activeRuns: [{ runRef: 'run-1', title: 'Draft', outcome: null, lifecycle: 'running', elapsedMs: 9_000, toolsCalled: 2, lastLine: 'Writing the findings.', gateBadge: '1 pending' }] },
  brief: { purpose: 'Draft careful reports.', doingNow: 'Drafting.', autonomyTier: 'queues-for-me', pendingGates: 1, schedule: null, recentRuns: [], outputs: [] },
} as unknown as EntityDetail;

describe('AgentDetailBody', () => {
  it('links server-projected active Run rows and renders the explicit output empty state', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(<AgentDetailBody detail={detail} onNavigate={onNavigate} />);
    const liveRow = screen.getByRole('button', { name: /^Draft / });
    expect(liveRow.textContent).toBe('Draft \u00b7 running \u00b7 9s \u00b7 2 tools \u00b7 Writing the findings. \u00b7 1 pending');
    fireEvent.click(liveRow);
    expect(onNavigate).toHaveBeenCalledWith({ view: 'workflows', focus: { kind: 'run', id: 'run-1' } });
    rerender(<AgentDetailBody detail={detail} surface="brief" />);
    expect(screen.getByText('Draft careful reports.')).toBeTruthy();
    expect(screen.getByText('Drafting.')).toBeTruthy();
    expect(screen.getByText('queues-for-me. 1 pending gate.')).toBeTruthy();
    expect(screen.getByText('No schedule.')).toBeTruthy();
    expect(screen.getByText('No recent outputs')).toBeTruthy();
  });
});

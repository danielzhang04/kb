// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EntityCard } from './EntityCard';

afterEach(cleanup);

describe('EntityCard', () => {
  it('renders exactly the ordered card facts and opens as one button', () => {
    const onOpen = vi.fn();
    render(<EntityCard summary={{ ref: { type: 'agent', id: 'fyt-checker', sourcePath: 'agents/fyt-checker.md' }, humanName: 'Incorrect name', status: 'needs-you', modelLabel: 'gpt-5.6-sol', temporalLabel: 'ran 2h ago · failed', host: 'desktop', gatedRunCount: 1, activeRuns: [], latestRun: 'failed', nextSchedule: null }} onOpen={onOpen} />);
    const card = screen.getByRole('button', { name: /FYT Checker/ });
    expect(card.textContent).toBe('FYT CheckerNeeds yougpt-5.6-solran 2h ago · failedDesktop1');
    expect(card.textContent).not.toMatch(/Incorrect|purpose|tools|fyt-checker/i);
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('omits zero gate badge and uses the fixed title-case status label', () => {
    render(<EntityCard summary={{ ref: { type: 'workflow', id: 'research-brief', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/research-brief.md' }, humanName: 'Research Brief', status: 'scheduled', modelLabel: 'varies', temporalLabel: 'next 09:00', host: 'vm', gatedRunCount: 0, activeRuns: [], latestRun: null, nextSchedule: null }} onOpen={() => {}} />);
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.queryByTestId('entity-card-gates')).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeResponse } from '../../server/home/contracts.ts';
import { D13Home } from './D13Home.tsx';
import { renderWithTestSession } from '../test/session.tsx';

afterEach(cleanup);

const response: HomeResponse = {
  revision: 'home-1',
  sections: [
    { state: 'ready', data: { section: 'running-now', runs: [{ runRef: 'run-1', title: 'Hygiene', owner: { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' }, lifecycle: 'running', outcome: null, createdAt: '2026-08-21T10:00:00.000Z', completedAt: null }] } },
    { state: 'ready', data: { section: 'attention-counts', agents: 2, workflows: 1, inbox: 3 } },
    { state: 'ready', data: { section: 'next-schedules', occurrences: [{ scheduleId: 'schedule-1', scheduledFor: '2026-08-21T14:00:00.000Z', nextAt: '2026-08-21T14:00:00.000Z' }] } },
    { state: 'ready', data: { section: 'version', label: 'VM', sha: '64fb3d02', activatedAt: '2h ago' } },
    { state: 'ready', data: { section: 'recent-outcomes', outcomes: [{ runRef: 'run-0', title: 'Grader', completedAt: '2026-08-21T09:00:00.000Z', outcome: 'ok' }] } },
  ],
};

describe('D13Home', () => {
  it('renders only D13 sections in order, including the exact version chip', async () => {
    await renderWithTestSession(<D13Home response={response} />);

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
      .toEqual(['Running now', 'Needs you', 'Next schedules', 'Version', 'Recent outcomes']);
    expect(screen.getByText('VM \u00b7 64fb3d02 \u00b7 2h ago')).toBeTruthy();
    expect(screen.queryByText(/Fleet KPIs|Projects|Usage|Recent runs/i)).toBeNull();
  });

  it('uses exact empty strings and offers section-local retry for unavailable data', async () => {
    const retry = vi.fn();
    const empty: HomeResponse = {
      ...response,
      sections: [
        { state: 'ready', data: { section: 'running-now', runs: [] } },
        response.sections[1], { state: 'ready', data: { section: 'next-schedules', occurrences: [] } }, response.sections[3],
        { state: 'ready', data: { section: 'recent-outcomes', outcomes: [] } },
      ],
    };
    await renderWithTestSession(<D13Home response={empty} onRetry={retry} />);
    expect(screen.getByText('Nothing running')).toBeTruthy();
    expect(screen.getByText('No schedules')).toBeTruthy();
    expect(screen.getByText('No runs yet')).toBeTruthy();

    cleanup();
    await renderWithTestSession(<D13Home response={{
      ...response,
      sections: [
        response.sections[0],
        { state: 'unavailable', reason: 'attention-unavailable' },
        response.sections[2], response.sections[3], response.sections[4],
      ],
    }} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Needs you' }));
    expect(retry).toHaveBeenCalledWith('attention-counts');
    expect(screen.queryByText('0 Agents gates')).toBeNull();
  });
});

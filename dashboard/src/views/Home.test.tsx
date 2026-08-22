// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeResponse } from '../../server/home/contracts.ts';
import homeGolden from '../../server/home/__fixtures__/home.json';
import { clearStoredSession, persistSession } from '../lib/authClient.ts';
import { renderWithTestSession } from '../test/session.tsx';
import { Home } from './Home.tsx';

afterEach(() => {
  cleanup();
  clearStoredSession();
});
const homeResponseFixture = homeGolden as unknown as HomeResponse;

function partialResponse(): HomeResponse {
  return {
    ...homeResponseFixture,
    sections: [
      homeResponseFixture.sections[0],
      { state: 'unavailable', reason: 'attention-unavailable' },
      homeResponseFixture.sections[2],
      { state: 'unavailable', reason: 'release-unavailable' },
      homeResponseFixture.sections[4],
    ],
  };
}

describe('Home D13 live view', () => {
  it('renders only the ordered D13 surfaces and the exact activation chip', async () => {
    await renderWithTestSession(<Home response={homeResponseFixture} />);

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
      .toEqual(['Running now', 'Needs you', 'Next schedules', 'Version', 'Recent outcomes']);
    expect(screen.getByText('VM \u00b7 64fb3d02 \u00b7 2h ago')).toBeTruthy();
    expect(screen.queryByText(/Fleet KPIs|Projects|Usage|Recent runs/i)).toBeNull();
  });

  it('keeps partial failures section-local, does not fabricate zeroes, and retries', async () => {
    const retry = vi.fn();
    await renderWithTestSession(<Home response={partialResponse()} onRetry={retry} />);

    expect(screen.getByText('Unavailable: attention-unavailable')).toBeTruthy();
    expect(screen.getByText('Unavailable: release-unavailable')).toBeTruthy();
    expect(screen.queryByText('0 Agents gates')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hygiene' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Needs you' }));
    expect(retry).toHaveBeenCalledWith('attention-counts');
  });

  it('renders the exact empty strings without legacy fallback panels', async () => {
    const empty: HomeResponse = {
      ...homeResponseFixture,
      sections: [
        { state: 'ready', data: { section: 'running-now', runs: [] } },
        { state: 'ready', data: { section: 'attention-counts', agents: 0, workflows: 0, inbox: 0 } },
        { state: 'ready', data: { section: 'next-schedules', occurrences: [] } },
        homeResponseFixture.sections[3],
        { state: 'ready', data: { section: 'recent-outcomes', outcomes: [] } },
      ],
    };
    await renderWithTestSession(<Home response={empty} />);

    expect(screen.getByText('Nothing running')).toBeTruthy();
    expect(screen.getByText('No schedules')).toBeTruthy();
    expect(screen.getByText('No runs yet')).toBeTruthy();
  });

  it('shows an explicit load error and retries the live endpoint', async () => {
    persistSession({ token: 'home-session', expiresAt: Date.now() + 60_000 });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }));
    await renderWithTestSession(<Home fetchImpl={fetchImpl} />);

    expect(await screen.findByText('Home is unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Home' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it('opens every D13 row at its exact filtered, owner, or replay target', async () => {
    const onNavigateTarget = vi.fn();
    await renderWithTestSession(<Home response={homeResponseFixture} onNavigateTarget={onNavigateTarget} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hygiene' }));
    expect(onNavigateTarget).toHaveBeenCalledWith({ view: 'workflows', focus: { kind: 'run', id: 'run-1' } });
    fireEvent.click(screen.getByRole('button', { name: '2 Agents gates' }));
    expect(onNavigateTarget).toHaveBeenCalledWith({ view: 'agents', filter: 'attention' });
    fireEvent.click(screen.getByRole('button', { name: '1 Workflows gates' }));
    expect(onNavigateTarget).toHaveBeenCalledWith({ view: 'workflows', filter: 'attention' });
    fireEvent.click(screen.getByRole('button', { name: '3 Inbox items' }));
    expect(onNavigateTarget).toHaveBeenCalledWith({ view: 'inbox' });
    fireEvent.click(screen.getByRole('button', { name: '2026-08-21T14:00:00.000Z' }));
    expect(onNavigateTarget).toHaveBeenCalledWith({ view: 'agents', focus: { kind: 'agent', id: 'hygiene' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grader \u00b7 ok' }));
    expect(onNavigateTarget).toHaveBeenCalledWith({ view: 'workflows', focus: { kind: 'run', id: 'run-0' } });
    expect(onNavigateTarget).toHaveBeenCalledTimes(6);
  });
});

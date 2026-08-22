// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Schedule } from '../../server/control/p2Contracts.ts';
import { clearStoredSession, persistSession } from '../lib/authClient.ts';
import { SessionProvider } from '../lib/sessionContext.tsx';
import { ScheduleRows } from './ScheduleRows.tsx';

const ROW: Schedule = {
  id: 'a'.repeat(64), owner: { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' },
  cadence: { source: '15 3 * * 0', words: 'Sun \u00b7 3:15 AM' }, nextAt: '2026-08-23T03:15:00-04:00',
  lastOutcome: 'ok', armed: true, origin: 'seed', mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 3,
};

afterEach(() => { cleanup(); clearStoredSession(); vi.unstubAllGlobals(); });

function renderRows(): void {
  render(<SessionProvider deps={{ fetchAuthContext: async () => ({ mode: 'win32-desktop' }) }}><ScheduleRows /></SessionProvider>);
}

describe('ScheduleRows store-backed cutover component', () => {
  it('keeps a load error as a retry row instead of fabricating the empty state', async () => {
    persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'unavailable' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ collectionRevision: 4, schedules: [ROW] }) });
    vi.stubGlobal('fetch', fetchMock);
    renderRows();
    await screen.findByText('Schedules are unavailable.');
    expect(screen.queryByText('No schedules')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry schedules' }));
    await screen.findByText('Hygiene');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('creates, disarms, and deletes through scheduleClient with immediate revisions', async () => {
    persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
    const operator = { ...ROW, id: 'b'.repeat(64), origin: 'operator' as const, armed: false, version: 1 };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules' && init?.method === undefined) return Promise.resolve({ ok: true, status: 200, json: async () => ({ collectionRevision: 4, schedules: [ROW] }) });
      if (url === '/api/schedules' && init?.method === 'POST') return Promise.resolve({ ok: true, status: 201, json: async () => ({ schedule: operator, collectionRevision: 5, replayed: false }) });
      if (url === `/api/schedules/${ROW.id}/disarm`) return Promise.resolve({ ok: true, status: 200, json: async () => ({ schedule: { ...ROW, armed: false, version: 4 }, collectionRevision: 6, replayed: false }) });
      if (url === `/api/schedules/${operator.id}` && init?.method === 'DELETE') return Promise.resolve({ ok: true, status: 200, json: async () => ({ tombstone: { id: operator.id, deletedAt: '2026-08-21T12:00:00.000Z', version: 2 }, collectionRevision: 7, replayed: false }) });
      return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'seed-not-on-protected-main' }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRows();
    await screen.findByText('Hygiene');
    fireEvent.change(screen.getByLabelText('Owner id'), { target: { value: 'hygiene' } });
    fireEvent.change(screen.getByLabelText('Cron'), { target: { value: '0 9 * * *' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/schedules', expect.objectContaining({ method: 'POST' })));
    expect(screen.getAllByText('Hygiene')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Disarm Hygiene' })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/schedules/${ROW.id}/disarm`, expect.anything()));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Hygiene' })[1]);
    await waitFor(() => expect(screen.getAllByText('Hygiene')).toHaveLength(1));
    expect(document.body.textContent).not.toMatch(/proposed|pending|history|PR/i);
  });

  it('renders the exact live-store empty state', async () => {
    persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ collectionRevision: 0, schedules: [] }) })));
    renderRows();
    await screen.findByText('No schedules');
  });
});

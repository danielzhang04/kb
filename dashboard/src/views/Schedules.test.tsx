// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Schedule } from '../../server/control/p2Contracts.ts';
import type { EntityList } from '../../server/entities/contracts.ts';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
import { SchedulesBody } from './Schedules';

const ROW: Schedule = {
  id: 'a'.repeat(64),
  owner: { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' },
  cadence: { source: '15 3 * * 0', words: 'Sun \u00b7 3:15 AM' },
  nextAt: '2026-08-23T07:15:00.000Z',
  lastOutcome: 'ok',
  armed: true,
  origin: 'seed',
  mirroredAt: null,
  mirrorPath: 'HEARTBEAT.md',
  version: 3,
};

function response(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

function entityList(owner: Schedule['owner']): EntityList {
  const summary = {
    ref: owner,
    humanName: owner.id,
    status: 'idle' as const,
    modelLabel: owner.type === 'workflow' ? 'varies' : 'gpt-5',
    temporalLabel: 'Never run',
    host: 'vm' as const,
    gatedRunCount: 0,
    activeRuns: [],
    latestRun: null,
    nextSchedule: null,
  };
  return { revision: `${owner.type}-list-1`, groups: [], items: [summary] };
}

afterEach(() => { cleanup(); clearStoredSession(); vi.unstubAllGlobals(); });

describe('Schedules', () => {
  it('renders only live store rows and applies disarm and Delete receipts immediately', async () => {
    persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules' && !init?.method) return response({ scheduleCollectionRevision: 4, rows: [ROW] });
      if (url === `/api/schedules/${ROW.id}/disarm`) return response({ schedule: { ...ROW, armed: false, version: 4 }, collectionRevision: 5, replayed: false });
      if (url === `/api/schedules/${ROW.id}` && init?.method === 'DELETE') return response({ tombstone: { id: ROW.id, deletedAt: '2026-08-22T12:00:00.000Z', version: 5 }, collectionRevision: 6, replayed: false });
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionProvider><SchedulesBody /></SessionProvider>);

    const row = await screen.findByTestId(`schedules-row-${ROW.id}`);
    expect(within(row).getByText('Hygiene')).toBeTruthy();
    expect(within(row).getByText('Sun \u00b7 3:15 AM')).toBeTruthy();
    expect(screen.queryByText(/proposal|history|pending/i)).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'Disarm Hygiene' }));
    await screen.findByRole('button', { name: 'Arm Hygiene' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Hygiene' }));
    await screen.findByText('No schedules');
    expect(fetchMock).toHaveBeenCalledWith(`/api/schedules/${ROW.id}/disarm`, expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/schedules/${ROW.id}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('keeps a load failure distinct from No schedules and retries in place', async () => {
    persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
    let scheduleCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url !== '/api/schedules') return Promise.reject(new Error(`unexpected fetch ${url}`));
      scheduleCalls += 1;
      return scheduleCalls === 1
        ? response({ error: 'schedule-read-failed' }, 503)
        : response({ scheduleCollectionRevision: 0, rows: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionProvider><SchedulesBody /></SessionProvider>);

    const retry = await screen.findByRole('button', { name: 'Retry schedules' });
    expect(screen.queryByText('No schedules')).toBeNull();
    fireEvent.click(retry);
    await screen.findByText('No schedules');
    expect(scheduleCalls).toBe(2);
  });

  it('reports invalid cron inline before fetch for the prefilled immutable owner', async () => {
    persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules' && !init?.method) return response({ scheduleCollectionRevision: 0, rows: [] });
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionProvider><SchedulesBody scheduleOwner={ROW.owner} /></SessionProvider>);

    await screen.findByText('No schedules');
    expect(screen.getByRole('option', { name: 'Hygiene' })).toHaveProperty('selected', true);
    fireEvent.change(screen.getByLabelText('Cadence format'), { target: { value: 'cron' } });
    fireEvent.change(screen.getByLabelText('Five-field cron'), { target: { value: '60 9 * * *' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    await screen.findByText('Invalid cadence. Check the words, time, or five-field cron.');
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/schedules' && (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it.each([
    ['words', 'Recurrence', 'not-a-recurrence'],
    ['time', 'Time', '25:00'],
  ])('reports invalid %s inline before fetch', async (_field, label, value) => {
    persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => url === '/api/schedules'
      ? response({ scheduleCollectionRevision: 0, rows: [] })
      : Promise.reject(new Error(`unexpected fetch ${url}`)));
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionProvider><SchedulesBody scheduleOwner={ROW.owner} /></SessionProvider>);
    await screen.findByText('No schedules');
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    await screen.findByRole('alert');
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/schedules' && (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('offers every existing Agent and Workflow when the live schedule store is empty', async () => {
    persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
    const workflowOwner = { type: 'workflow' as const, id: 'release-audit', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/release-audit.md' as const };
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/schedules') return response({ scheduleCollectionRevision: 0, rows: [] });
      if (url === '/api/agents') return response(entityList(ROW.owner));
      if (url === '/api/workflows') return response(entityList(workflowOwner));
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionProvider><SchedulesBody /></SessionProvider>);

    await screen.findByText('No schedules');
    expect(screen.getByRole('option', { name: 'Hygiene' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Release Audit' })).toBeTruthy();
  });
});

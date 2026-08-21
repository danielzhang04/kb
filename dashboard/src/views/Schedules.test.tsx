// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';
import { SchedulesBody } from './Schedules';

afterEach(() => { cleanup(); clearStoredSession(); vi.unstubAllGlobals(); });

describe('Schedules', () => {
  it('preserves read and pause without registry imports', async () => {
    persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/panels/schedules') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
        label: 'schedules', pausedCount: 0, files: { 'HEARTBEAT.md': 'cadences:\n  - name: daily\n    schedule: 0 9 * * mon\n' },
        cadences: [{ project: 'system', name: 'daily', schedule: '0 9 * * mon', tier: 'T1', riskTier: 'low', paused: false, file: 'HEARTBEAT.md', lastRun: null, runCount: 0, scheduleHint: null }],
      }) });
      if (url === '/api/schedules/edit') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, pr: {} }) });
      if (url === '/api/write/pause-cadence') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionProvider><SchedulesBody /></SessionProvider>);

    await screen.findByTestId('schedules-row-daily');
    fireEvent.click(screen.getByRole('button', { name: 'Pause cadence daily' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/write/pause-cadence', expect.anything()));
    expect(fetchMock).toHaveBeenCalledWith('/api/panels/schedules');
    expect(readFileSync('src/views/Schedules.tsx', 'utf8')).not.toMatch(/agentPlatform|registry/);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '../../../lib/sessionContext';
import { clearStoredSession, persistSession } from '../../../lib/authClient';
import type { ScheduleRow, SchedulesPanel } from '../../../../server/panels/schedules';
import { panel } from './Schedules.panel';

function cadence(over: Partial<ScheduleRow> & { name: string }): ScheduleRow {
  return {
    project: 'system',
    schedule: '3 7 * * mon',
    tier: 'T1',
    riskTier: 'low',
    paused: false,
    file: 'HEARTBEAT.md',
    lastRun: null,
    runCount: 0,
    scheduleHint: 'cron: 3 7 * * mon',
    ...over,
  };
}

const DATA: SchedulesPanel = {
  label: 'schedules',
  pausedCount: 1,
  files: {
    'HEARTBEAT.md': '# Root heartbeat\n\n```yaml\ncadences:\n  - name: root-daily\n```\n',
    'orgs/atlas-prep/HEARTBEAT.md': '# Atlas heartbeat\n',
    'orgs/kb-ops/HEARTBEAT.md': '# Ops heartbeat\n',
  },
  cadences: [
    cadence({ name: 'root-fast', schedule: '*/5 * * * *', scheduleHint: 'cron: */5 * * * *' }),
    cadence({ name: 'root-list', schedule: '0,30 7 * * mon', scheduleHint: 'cron: 0,30 7 * * mon' }),
    cadence({ name: 'root-range', schedule: '0-59/2 7 * * mon', scheduleHint: 'cron: 0-59/2 7 * * mon' }),
    cadence({ name: 'root-hourly', schedule: '0 * * * *', scheduleHint: 'cron: 0 * * * *' }),
    cadence({ name: 'root-daily', schedule: '3 7 * * mon' }),
    cadence({ name: 'root-weekly', schedule: 'weekly:fri' }),
    cadence({ name: 'root-monthly', schedule: 'monthly' }),
    cadence({ name: 'atlas-daily', project: 'atlas-prep', file: 'orgs/atlas-prep/HEARTBEAT.md' }),
    cadence({
      name: 'ops-paused',
      project: 'kb-ops',
      file: 'orgs/kb-ops/HEARTBEAT.md',
      paused: true,
      lastRun: { date: '2026-08-18', card: 'card-1', narration: 'Needs you: approve the schedule' },
    }),
  ],
};

function unlocked(): React.JSX.Element {
  persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 });
  return <SessionProvider>{panel.render()}</SessionProvider>;
}

function locked(): React.JSX.Element {
  return <SessionProvider>{panel.render()}</SessionProvider>;
}

function stubFetch(options: { unavailable?: boolean; edit?: { status: number; body: object }; pause?: { status: number; body: object } } = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/panels/schedules') {
      if (options.unavailable) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DATA) });
    }
    if (url === '/api/schedules/edit') {
      if (options.edit) return Promise.resolve({ ok: false, status: options.edit.status, json: () => Promise.resolve(options.edit!.body) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, target: 'HEARTBEAT.md', pr: { url: 'https://github.test/kb/pull/42' } }) });
    }
    if (url === '/api/write/pause-cadence') {
      if (options.pause) return Promise.resolve({ ok: false, status: options.pause.status, json: () => Promise.resolve(options.pause!.body) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, path: 'queue/paused/root-daily' }) });
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  clearStoredSession();
  vi.unstubAllGlobals();
});

describe('Schedules panel', () => {
  it('renders every cadence, including an idle active chip, paused instructions, and each declared file', async () => {
    stubFetch();
    render(unlocked());

    expect(await screen.findAllByTestId(/^ap-schedules-row-/)).toHaveLength(9);
    expect(screen.getByTestId('ap-schedules-state-root-daily').innerHTML).toContain('mc-status-dot--idle');
    expect(screen.getByTestId('ap-schedules-state-root-daily').innerHTML).not.toContain('mc-badge--done');
    expect(screen.getByTestId('ap-schedules-state-ops-paused').textContent).toBe('paused');
    expect(screen.getByTestId('ap-schedules-row-ops-paused').textContent).toContain('orgs/kb-ops/HEARTBEAT.md');
    expect(screen.getByTestId('ap-schedules-row-ops-paused').textContent).toContain('Resuming is a manual ops act (delete queue/paused/ops-paused)');
    expect(screen.getByTestId('ap-schedules-row-ops-paused').querySelector('.ap-schedules__narration--needs-you')?.textContent).toContain('Needs you: approve');
  });

  it('never renders an unpause control, including for a paused cadence', async () => {
    stubFetch();
    render(unlocked());
    await screen.findByTestId('ap-schedules-row-ops-paused');

    expect(screen.queryByRole('button', { name: /unpause/i })).toBeNull();
    expect(screen.queryByText(/unpause/i)).toBeNull();
  });

  it('prefills the full source file, posts only a changed file, and locks resubmit after success', async () => {
    const fetchMock = stubFetch();
    render(unlocked());
    await screen.findByTestId('ap-schedules-row-root-daily');

    fireEvent.click(screen.getByRole('button', { name: 'Edit HEARTBEAT.md in PR' }));
    const textarea = screen.getByLabelText('full file contents — replaces HEARTBEAT.md');
    expect((textarea as HTMLTextAreaElement).value).toBe(DATA.files['HEARTBEAT.md']);
    expect((screen.getByRole('button', { name: 'Create edit PR' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: '## Cadences\nchanged' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create edit PR' }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Open pull request' }).getAttribute('href')).toBe('https://github.test/kb/pull/42'));
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/schedules/edit');
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer schedule-token' },
      body: JSON.stringify({ file: 'HEARTBEAT.md', content: '## Cadences\nchanged' }),
    });
    expect(screen.getByTestId('ap-schedules-edit-result').textContent).toMatch(/merges by human only/i);
    expect((screen.getByRole('button', { name: 'Create edit PR' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/schedules/edit')).toHaveLength(1);
  });

  it('pauses an active cadence through the STOP-floor endpoint', async () => {
    const fetchMock = stubFetch();
    render(unlocked());
    await screen.findByTestId('ap-schedules-row-root-daily');

    fireEvent.click(screen.getByRole('button', { name: 'Pause cadence root-daily' }));

    await waitFor(() => expect(screen.getByTestId('ap-schedules-pause-root-daily').textContent).toMatch(/paused/i));
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/write/pause-cadence');
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer schedule-token' },
      body: JSON.stringify({ name: 'root-daily' }),
    });
  });

  it('warns on every cron form that can fire many times a day, but not a fixed daily minute and hour', async () => {
    stubFetch();
    render(unlocked());
    await screen.findByTestId('ap-schedules-row-root-fast');

    for (const name of ['root-fast', 'root-list', 'root-range', 'root-hourly']) {
      expect(screen.getByTestId(`ap-schedules-subhourly-${name}`).textContent).toMatch(/potentially many runs a day, each spending tokens/i);
    }
    expect(screen.queryByTestId('ap-schedules-subhourly-root-daily')).toBeNull();
  });

  it('reads nothing while locked', () => {
    const fetchMock = stubFetch();
    render(locked());

    expect(screen.getByTestId('ap-schedules-locked').textContent).toMatch(/unlock the dashboard/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names an unavailable read and issues no governed mutation request', async () => {
    const fetchMock = stubFetch({ unavailable: true });
    render(unlocked());

    expect((await screen.findByTestId('ap-schedules-unavailable')).textContent).toMatch(/unavailable/i);
    expect(fetchMock.mock.calls.filter(([url]) => url !== '/api/panels/schedules')).toHaveLength(0);
  });

  for (const status of [400, 401, 503]) {
    it(`renders an edit refusal with HTTP ${status}, never a success message`, async () => {
      stubFetch({ edit: { status, body: { reason: 'policy refused edit' } } });
      render(unlocked());
      await screen.findByTestId('ap-schedules-row-root-daily');

      fireEvent.click(screen.getByRole('button', { name: 'Edit HEARTBEAT.md in PR' }));
      fireEvent.change(screen.getByLabelText('full file contents — replaces HEARTBEAT.md'), { target: { value: '# changed\n' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create edit PR' }));

      const result = await screen.findByTestId('ap-schedules-edit-result');
      expect(result.textContent).toContain(`HTTP ${status}`);
      expect(result.textContent).toContain('policy refused edit');
      expect(result.textContent).not.toMatch(/Edit proposed|merges by human only/i);
    });

    it(`renders a pause refusal with HTTP ${status}, never a success message`, async () => {
      stubFetch({ pause: { status, body: { reason: 'policy refused pause' } } });
      render(unlocked());
      await screen.findByTestId('ap-schedules-row-root-daily');

      fireEvent.click(screen.getByRole('button', { name: 'Pause cadence root-daily' }));

      const result = await screen.findByTestId('ap-schedules-pause-root-daily');
      expect(result.textContent).toContain(`HTTP ${status}`);
      expect(result.textContent).toContain('policy refused pause');
      expect(result.textContent).not.toMatch(/^paused/i);
    });
  }
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '../../../lib/sessionContext';
import { clearStoredSession, persistSession } from '../../../lib/authClient';
import type { ScheduleRow, SchedulesPanel } from '../../../../server/panels/schedules';
import { panel, replaceCadenceSchedule } from './Schedules.panel';
import { SchedulesBody as MovedSchedulesBody, replaceCadenceSchedule as movedReplaceCadenceSchedule } from '../../Schedules';

function cadence(over: Partial<ScheduleRow> & { name: string }): ScheduleRow {
  return { project: 'system', schedule: '3 7 * * mon', tier: 'T1', riskTier: 'low', paused: false, file: 'HEARTBEAT.md', lastRun: null, runCount: 0, scheduleHint: 'cron: 3 7 * * mon', ...over };
}
const DATA: SchedulesPanel = { label: 'schedules', pausedCount: 1, files: { 'HEARTBEAT.md': '# Root heartbeat\n\n```yaml\ncadences:\n  - name: root-daily\n    schedule: 3 7 * * mon\n    tier: desktop\n```\n', 'orgs/kb-ops/HEARTBEAT.md': '# Ops heartbeat\n' }, cadences: [
  cadence({ name: 'root-fast', schedule: '*/5 * * * *' }), cadence({ name: 'root-list', schedule: '0,30 7 * * mon' }), cadence({ name: 'root-range', schedule: '0-59/2 7 * * mon' }), cadence({ name: 'root-hourly', schedule: '0 * * * *' }), cadence({ name: 'root-daily', schedule: '3 7 * * mon' }), cadence({ name: 'root-weekly', schedule: 'weekly:fri' }), cadence({ name: 'root-monthly', schedule: 'monthly' }), cadence({ name: 'ops-paused', project: 'kb-ops', file: 'orgs/kb-ops/HEARTBEAT.md', paused: true, lastRun: { date: '2026-08-18', card: 'card-1', narration: 'Needs you: approve the schedule' } }),
] };
function unlocked(): React.JSX.Element { persistSession({ token: 'schedule-token', expiresAt: Date.now() + 3_600_000 }); return <SessionProvider>{panel.render()}</SessionProvider>; }
function locked(): React.JSX.Element { return <SessionProvider>{panel.render()}</SessionProvider>; }
function stubFetch(options: { unavailable?: boolean; data?: SchedulesPanel; edit?: { status: number; body: object }; pause?: { status: number; body: object }; history?: { status: number; body: object } } = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/panels/schedules') return options.unavailable ? Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }) : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(options.data ?? DATA) });
    if (url === '/api/panels/schedules/history?project=system&cadence=root-daily') return options.history ? Promise.resolve({ ok: false, status: options.history!.status, json: () => Promise.resolve(options.history!.body) }) : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cadence: 'root-daily', runs: [{ card: 'card-1', scheduledFor: '2026-08-18T07:03:00', dispatchedAt: '2026-08-18T07:05:00', outcome: 'done', result: 'Completed safely.' }] }) });
    if (url === '/api/schedules/edit') return options.edit ? Promise.resolve({ ok: false, status: options.edit!.status, json: () => Promise.resolve(options.edit!.body) }) : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, target: 'HEARTBEAT.md', pr: { url: 'https://github.test/kb/pull/42' } }) });
    if (url === '/api/write/pause-cadence') return options.pause ? Promise.resolve({ ok: false, status: options.pause!.status, json: () => Promise.resolve(options.pause!.body) }) : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, path: 'queue/paused/root-daily' }) });
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }); vi.stubGlobal('fetch', fetchMock); return fetchMock;
}
afterEach(() => { cleanup(); clearStoredSession(); vi.unstubAllGlobals(); });

describe('Schedules panel', () => {
  it('re-exports the moved body with the unchanged panel contract', () => {
    expect(panel.render().type).toBe(MovedSchedulesBody);
    expect(replaceCadenceSchedule).toBe(movedReplaceCadenceSchedule);
  });
  it('renders each cadence as a card with concise recurrence, next window, quiet paused state, and needs-you chip', async () => {
    stubFetch(); render(unlocked());
    expect(await screen.findAllByTestId(/^ap-schedules-row-/)).toHaveLength(8);
    const paused = screen.getByTestId('ap-schedules-row-ops-paused');
    expect(paused.textContent).toContain('kb-ops'); expect(paused.textContent).toContain('paused'); expect(paused.textContent).toContain('needs you');
    expect(paused.textContent).toContain('Resuming is a manual ops act (delete queue/paused/ops-paused)');
    expect(screen.getByTestId('ap-schedules-row-root-daily').textContent).toContain('Mon · 7:03 AM');
    expect(screen.getByTestId('ap-schedules-row-root-daily').textContent).toContain('next window');
    expect(screen.getByTestId('ap-schedules-row-root-fast').textContent).not.toContain('*/5 * * * *');
    expect(screen.queryByTestId('ap-schedules-state-root-daily')).toBeNull();
  });

  it('never renders an unpause or run control, including for paused cadences', async () => {
    stubFetch(); render(unlocked()); await screen.findByTestId('ap-schedules-row-ops-paused');
    expect(screen.queryByRole('button', { name: /unpause/i })).toBeNull(); expect(screen.queryByText(/unpause/i)).toBeNull(); expect(screen.queryByRole('button', { name: /^run/i })).toBeNull();
  });

  it('shows the VM capability reason and removes only PR edit controls', async () => {
    stubFetch({ data: { ...DATA, edits: { available: false, reason: 'Schedule edits require the desktop GitHub PR route.' } } });
    render(unlocked());
    await screen.findByTestId('ap-schedules-row-root-daily');
    expect(screen.getByTestId('ap-schedules-edit-unavailable').textContent).toMatch(/desktop GitHub PR route/i);
    expect(screen.queryByRole('button', { name: /edit .* in pr/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause cadence root-daily' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'History for cadence root-daily' })).toBeTruthy();
  });

  it('opens a focused PR sheet, changes only the selected schedule line, and locks resubmit after success', async () => {
    const fetchMock = stubFetch(); render(unlocked()); await screen.findByTestId('ap-schedules-row-root-daily');
    fireEvent.click(screen.getByTestId('ap-schedules-row-root-daily').querySelector('button')!);
    expect(screen.getByRole('dialog', { name: 'Edit schedule in pull request' })).toBeTruthy();
    expect((screen.getByLabelText('full file contents — replaces HEARTBEAT.md') as HTMLTextAreaElement).value).toBe(DATA.files['HEARTBEAT.md']);
    expect((screen.getByRole('button', { name: 'Create edit PR' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Recurrence preset'), { target: { value: 'custom-raw' } });
    fireEvent.change(screen.getByLabelText('Time 1'), { target: { value: '07:30' } });
    expect((screen.getByLabelText('full file contents — replaces HEARTBEAT.md') as HTMLTextAreaElement).value).toContain('schedule: 30 7 * * mon');
    fireEvent.click(screen.getByRole('button', { name: 'Create edit PR' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open pull request' }).getAttribute('href')).toBe('https://github.test/kb/pull/42'));
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/schedules/edit');
    expect(call?.[1]).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer schedule-token' } });
    expect(String(call?.[1]?.body)).toContain('schedule: 30 7 * * mon');
    expect((screen.getByRole('button', { name: 'Create edit PR' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables schedule submission when custom selectors become invalid after emitting a replacement', async () => {
    stubFetch(); render(unlocked()); await screen.findByTestId('ap-schedules-row-root-daily');
    fireEvent.click(screen.getByTestId('ap-schedules-row-root-daily').querySelector('button')!);
    fireEvent.change(screen.getByLabelText('Recurrence preset'), { target: { value: 'custom-raw' } });
    fireEvent.change(screen.getByLabelText('Time 1'), { target: { value: '07:30' } });
    expect((screen.getByRole('button', { name: 'Create edit PR' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Mon'));
    expect((screen.getByRole('button', { name: 'Create edit PR' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText('Choose at least one day.')).toBeTruthy();
  });

  it('opens a read-only timeline that shows drift and no execution affordance', async () => {
    const fetchMock = stubFetch(); render(unlocked()); await screen.findByTestId('ap-schedules-row-root-daily');
    fireEvent.click(screen.getByRole('button', { name: 'History for cadence root-daily' }));
    const history = await screen.findByTestId('ap-schedules-history-root-daily');
    expect(history.textContent).toContain('+2m late'); expect(history.textContent).toContain('Completed safely.');
    expect(fetchMock.mock.calls.find(([url]) => url === '/api/panels/schedules/history?project=system&cadence=root-daily')?.[1]).toMatchObject({ headers: { authorization: 'Bearer schedule-token' } });
    expect(screen.queryByRole('button', { name: /^run/i })).toBeNull();
  });

  it('pauses an active cadence through the STOP-floor endpoint', async () => {
    const fetchMock = stubFetch(); render(unlocked()); await screen.findByTestId('ap-schedules-row-root-daily'); fireEvent.click(screen.getByRole('button', { name: 'Pause cadence root-daily' }));
    await waitFor(() => expect(screen.getByTestId('ap-schedules-pause-root-daily').textContent).toMatch(/paused/i));
    expect(fetchMock.mock.calls.find(([url]) => url === '/api/write/pause-cadence')?.[1]).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer schedule-token' }, body: JSON.stringify({ name: 'root-daily' }) });
  });

  it('keeps the existing sub-hourly warning coverage and read-only/replace-source guards', async () => {
    const fetchMock = stubFetch(); render(unlocked()); await screen.findByTestId('ap-schedules-row-root-fast');
    for (const name of ['root-fast', 'root-list', 'root-range', 'root-hourly']) expect(screen.getByTestId(`ap-schedules-subhourly-${name}`).textContent).toMatch(/many times a day, each spending tokens/i);
    expect(screen.queryByTestId('ap-schedules-subhourly-root-daily')).toBeNull();
    expect(replaceCadenceSchedule('cadences:\n  - name: alpha\n    prompt: |\n      schedule: untouched\n    tier: desktop\n', 'alpha', '30 9 * * mon')).toContain('    schedule: 30 9 * * mon\n    prompt: |');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('keeps every non-schedule byte when replacing a selected cadence schedule', () => {
    const source = 'cadences:\n  - name: alpha\n    schedule: 0 9 * * mon\n    prompt: |\n      untouched\n  - name: beta\n    schedule: daily\n';
    expect(replaceCadenceSchedule(source, 'alpha', '30 9 * * mon')).toBe('cadences:\n  - name: alpha\n    schedule: 30 9 * * mon\n    prompt: |\n      untouched\n  - name: beta\n    schedule: daily\n');
  });

  it('inserts a missing direct-child schedule without touching prompt text', () => {
    const source = 'cadences:\n  - name: alpha\n    prompt: |\n      Never replace schedule: text from this prompt.\n    tier: desktop\n  - name: beta\n    schedule: daily\n';
    expect(replaceCadenceSchedule(source, 'alpha', '30 9 * * mon')).toBe('cadences:\n  - name: alpha\n    schedule: 30 9 * * mon\n    prompt: |\n      Never replace schedule: text from this prompt.\n    tier: desktop\n  - name: beta\n    schedule: daily\n');
  });

  it('inserts the schedule field for a cadence that has none', () => {
    expect(replaceCadenceSchedule('cadences:\n  - name: alpha\n    tier: desktop\n', 'alpha', '30 9 * * mon')).toBe('cadences:\n  - name: alpha\n    schedule: 30 9 * * mon\n    tier: desktop\n');
  });

  it('reads nothing while locked and names unavailable schedules without mutation', async () => {
    const lockedFetch = stubFetch(); render(locked()); expect(screen.getByTestId('ap-schedules-locked').textContent).toMatch(/unlock the dashboard/i); expect(lockedFetch).not.toHaveBeenCalled(); cleanup(); clearStoredSession();
    const unavailable = stubFetch({ unavailable: true }); render(unlocked()); expect((await screen.findByTestId('ap-schedules-unavailable')).textContent).toMatch(/unavailable/i); expect(unavailable.mock.calls.filter(([url]) => String(url).startsWith('/api/write/') || url === '/api/schedules/edit')).toHaveLength(0);
  });

  for (const status of [400, 401, 503]) it(`renders an edit refusal with HTTP ${status}, never success`, async () => {
    stubFetch({ edit: { status, body: { reason: 'policy refused edit' } } }); render(unlocked()); await screen.findByTestId('ap-schedules-row-root-daily');
    fireEvent.click(screen.getByTestId('ap-schedules-row-root-daily').querySelector('button')!); fireEvent.change(screen.getByLabelText('full file contents — replaces HEARTBEAT.md'), { target: { value: '# changed\n' } }); fireEvent.click(screen.getByRole('button', { name: 'Create edit PR' }));
    const result = await screen.findByTestId('ap-schedules-edit-result'); expect(result.textContent).toContain(`HTTP ${status}`); expect(result.textContent).toContain('policy refused edit'); expect(result.textContent).not.toMatch(/Edit proposed|merges by human only/i);
  });

  for (const status of [400, 401, 503]) it(`renders a pause refusal with HTTP ${status}, never success`, async () => {
    stubFetch({ pause: { status, body: { reason: 'policy refused pause' } } }); render(unlocked()); await screen.findByTestId('ap-schedules-row-root-daily');
    fireEvent.click(screen.getByRole('button', { name: 'Pause cadence root-daily' }));
    const result = await screen.findByTestId('ap-schedules-pause-root-daily'); expect(result.textContent).toContain(`HTTP ${status}`); expect(result.textContent).toContain('policy refused pause'); expect(result.textContent).not.toMatch(/^paused/i);
  });
});

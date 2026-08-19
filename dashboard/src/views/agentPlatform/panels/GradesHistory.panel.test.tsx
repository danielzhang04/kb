// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SessionProvider } from '../../../lib/sessionContext';
import { clearStoredSession, persistSession } from '../../../lib/authClient';
import { AGENT_PLATFORM_PANELS } from '../registry';
import type { AgentRosterEntry } from '../../../../server/agents/roster';
import type { GradesHistory } from '../../../../server/panels/gradesHistory';
import { panel } from './GradesHistory.panel';

const ROSTER = [
  { id: 'codex-worker', displayName: 'Codex worker' },
  { id: 'other-worker', displayName: 'Other worker' },
] as AgentRosterEntry[];

const HISTORY: GradesHistory = {
  label: 'grades-history', agent: 'codex-worker', skipped: 0, rows: [
    { date: '2026-08-19T10:00:00+00:00', grade: '100', passed: true, source: 'eval', cardId: 'smoke' },
    { date: '2026-08-18T10:00:00+00:00', grade: '92', passed: false, source: 'task', cardId: 'task-c' },
  ],
};

function unlocked(): React.JSX.Element {
  persistSession({ token: 'tok', expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{panel.render()}</SessionProvider>;
}

afterEach(() => {
  cleanup();
  clearStoredSession();
  vi.unstubAllGlobals();
});

describe('Grades History panel', () => {
  it('registers by file drop, marks eval-suite rows as evidence, and filters source', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === '/api/agents') return { ok: true, json: async () => ROSTER };
      return { ok: true, json: async () => HISTORY };
    }));
    render(unlocked());

    expect(await screen.findByTestId('ap-grades-history-rows')).toBeTruthy();
    expect(AGENT_PLATFORM_PANELS.some((entry) => entry.id === 'grades-history')).toBe(true);
    expect(screen.getByTestId('ap-grades-history-evidence').textContent).toMatch(/evidence, never autonomy input/i);
    expect(screen.getByTestId('ap-grades-history-row-eval-0').className).toContain('ap-grades-history__row--eval');
    expect(screen.getByTestId('ap-grades-history-verdict-0').textContent).toBe('pass');
    expect(screen.getByTestId('ap-grades-history-verdict-1').textContent).toBe('fail');
    expect(screen.getByText('smoke')).toBeTruthy();
    expect(screen.getByText('task-c')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('grade source'), { target: { value: 'task' } });
    expect(screen.queryByText('smoke')).toBeNull();
    expect(screen.getByText('task-c')).toBeTruthy();
  });

  it('is read-only on the wire and reads nothing while locked', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return { ok: true, json: async () => String(input) === '/api/agents' ? ROSTER : HISTORY };
    }));
    render(unlocked());
    await screen.findByTestId('ap-grades-history-rows');
    expect(calls.map((call) => call.url)).toEqual(['/api/agents', '/api/panels/grades-history?agent=codex-worker']);
    for (const call of calls) {
      expect((call.init?.method ?? 'GET').toUpperCase()).toBe('GET');
      expect(call.init?.body).toBeUndefined();
    }

    cleanup();
    clearStoredSession();
    calls.length = 0;
    render(<SessionProvider>{panel.render()}</SessionProvider>);
    expect(screen.getByTestId('ap-grades-history-locked')).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

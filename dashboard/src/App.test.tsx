// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { clearStoredSession, persistSession } from './lib/authClient';
import { installTestAuthContext, type InstalledTestAuthContext } from './test/session';
import { SessionProvider } from './lib/sessionContext';
import { Agents } from './views/Agents';
import { AgentTile } from './views/RunDetail';
import { SchedulesBody } from './views/Schedules';
import { Inbox } from './views/Inbox';
import { Home } from './views/Home';
import type { AgentRosterEntry } from '../server/agents/roster';
import type { PlaneAIndex } from '../server/planeA/indexer';

let fetchStub: ReturnType<typeof vi.fn>;
let authContext: InstalledTestAuthContext;

beforeEach(() => {
  window.history.replaceState(null, '', '/?view=home');
  window.localStorage.clear();
  fetchStub = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal('fetch', fetchStub);
  authContext = installTestAuthContext(fetchStub as unknown as typeof fetch);
  persistSession({ token: 'app-session', expiresAt: Date.now() + 60_000 });
});

afterEach(() => {
  cleanup();
  clearStoredSession();
  authContext.restore();
  vi.unstubAllGlobals();
});

async function renderApp(): Promise<void> {
  render(<App />);
  await authContext.ready;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('App P1 shell', () => {
  it('renders the exact ten destinations, two dividers, and no retired destination', async () => {
    await renderApp();
    expect([...document.querySelectorAll('.mc-nav-item__label')].map((node) => node.textContent)).toEqual([
      'Home', 'Inbox', 'Schedules', 'Terminal', 'Agents', 'Workflows', 'Tasks', 'Projects', 'Files', 'Health',
    ]);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('falls malformed or removed URL ingress back to clean Home', async () => {
    window.history.replaceState(null, '', '/?view=atlas&entity=agent%3Aold');
    await renderApp();
    expect(screen.getByLabelText('Home view')).toBeTruthy();
    expect(window.location.search).toBe('?view=home');
  });

  it('keeps Terminal mounted across destinations and enforces the Terminal rail policy', async () => {
    window.history.replaceState(null, '', '/?view=terminal');
    await renderApp();
    const terminal = screen.getByTestId('persistent-terminal-surface') as HTMLDivElement;
    expect(terminal.hidden).toBe(false);
    expect(document.querySelector('.app-shell')?.classList.contains('app-shell--rail')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(window.location.search).toBe('?view=home'));
    expect(screen.getByTestId('persistent-terminal-surface')).toBe(terminal);
    expect(terminal.hidden).toBe(true);
    expect(document.querySelector('.app-shell')?.classList.contains('app-shell--rail')).toBe(false);
  });

  it('persists an explicit theme across destination changes', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('mc-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Health' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('sidebar badges appear only on Inbox Agents Workflows', async () => {
    authContext.restore();
    const inboxResponse = new Response(JSON.stringify({ items: [{
      id: 'a'.repeat(64), createdAt: '2026-08-21T00:00:00.000Z', revision: 'b'.repeat(64), kind: 'escalation',
      subject: { cardId: '68a70000-card' }, related: {}, title: 'wake-me', reason: 'Needs you',
    }] }), { status: 200 });
    fetchStub = vi.fn((input: RequestInfo | URL) => String(input) === '/api/inbox' ? Promise.resolve(inboxResponse.clone()) : new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchStub);
    authContext = installTestAuthContext(fetchStub as unknown as typeof fetch);
    await renderApp();
    await waitFor(() => expect(screen.getByLabelText('1 pending')).toBeTruthy());
    const badged = [...document.querySelectorAll('.mc-nav-item')]
      .filter((item) => item.querySelector('.mc-nav-item__badge'))
      .map((item) => item.querySelector('.mc-nav-item__label')?.textContent);
    expect(badged).toEqual(['Inbox']);
    expect(badged.every((label) => ['Inbox', 'Agents', 'Workflows'].includes(label ?? ''))).toBe(true);
  });

  it('starts one Inbox request when a browser fixture opens the Inbox deep link', async () => {
    window.history.replaceState(null, '', '/?view=inbox');
    authContext.restore();
    const inboxResponse = new Response(JSON.stringify({ items: [{
      id: 'a'.repeat(64), createdAt: '2026-08-21T00:00:00.000Z', revision: 'b'.repeat(64), kind: 'escalation',
      subject: { cardId: '68a70000-card' }, related: {}, title: 'wake-me', reason: 'Needs you',
    }] }), { status: 200 });
    fetchStub = vi.fn((input: RequestInfo | URL) => String(input) === '/api/inbox' ? Promise.resolve(inboxResponse.clone()) : new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchStub);
    authContext = installTestAuthContext(fetchStub as unknown as typeof fetch);
    await renderApp();
    expect(await screen.findByText('Needs you')).toBeTruthy();
    expect(fetchStub.mock.calls.filter(([input]) => String(input) === '/api/inbox')).toHaveLength(1);
  });

  it('bounds a five-frame Inbox burst to one in-flight and one trailing request', async () => {
    window.history.replaceState(null, '', '/?view=schedules');
    authContext.restore();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const inboxResponse = () => new Response(JSON.stringify({ items: [] }), { status: 200 });
    fetchStub = vi.fn((input: RequestInfo | URL) => {
      if (String(input) !== '/api/inbox') return new Promise<Response>(() => undefined);
      const count = fetchStub.mock.calls.filter(([candidate]) => String(candidate) === '/api/inbox').length;
      return count === 1 ? first.promise : second.promise;
    });
    const sources: Array<{ handlers: Array<(event: { data: string }) => void> }> = [];
    vi.stubGlobal('EventSource', class {
      handlers: Array<(event: { data: string }) => void> = [];
      constructor() { sources.push(this); }
      addEventListener(_type: string, handler: (event: { data: string }) => void): void { this.handlers.push(handler); }
      close(): void { /* no-op */ }
    });
    vi.stubGlobal('fetch', fetchStub);
    authContext = installTestAuthContext(fetchStub as unknown as typeof fetch);
    await renderApp();
    await waitFor(() => expect(fetchStub.mock.calls.filter(([input]) => String(input) === '/api/inbox')).toHaveLength(1));

    await act(async () => {
      for (let frame = 0; frame < 5; frame += 1) {
        for (const source of sources) source.handlers[0]?.({ data: JSON.stringify({ channel: 'planeA', kind: 'tick' }) });
      }
    });
    expect(fetchStub.mock.calls.filter(([input]) => String(input) === '/api/inbox')).toHaveLength(1);

    await act(async () => { first.resolve(inboxResponse()); });
    await waitFor(() => expect(fetchStub.mock.calls.filter(([input]) => String(input) === '/api/inbox')).toHaveLength(2));
    await act(async () => { second.resolve(inboxResponse()); });
    expect(fetchStub.mock.calls.filter(([input]) => String(input) === '/api/inbox')).toHaveLength(2);
  });

  it('humanizes roster header run-owner Schedules Inbox and Home labels from raw ids', async () => {
    const rawAgent = 'fyt-api_worker';
    const emptyIndex: PlaneAIndex = {
      cards: {},
      ledgers: {
        dispatch: { count: 0, cards: 0, byProject: {} },
        cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
        grades: { count: 0, rows: [] },
        activity: { count: 0, rows: [] },
      },
      orgStates: [],
    };
    const roster: AgentRosterEntry[] = [{
      id: rawAgent, displayName: rawAgent, shortRef: 1, role: null, working: false, current: null,
      projects: [], cardCount: 0, ledger: { dispatches: 0, steps: 0, days: 0, lastActive: null },
      sources: [], effective: { runtime: 'claude', model: 'claude-opus-4-8', sourceRuntime: 'policy', sourceModel: 'policy' },
      declared: true, runnerBound: false, declaredRuntime: 'claude', declaredModel: 'claude-opus-4-8',
      defaultProfile: null, allowedProfiles: null, description: null,
    }];

    render(<SessionProvider><Agents snapshot={emptyIndex} roster={roster} /></SessionProvider>);
    const rosterRow = screen.getByTestId(`agent-row-${rawAgent}`);
    expect(within(rosterRow).getByText('FYT API Worker')).toBeTruthy();
    expect(within(rosterRow).getByTestId('entity-name').getAttribute('title')).toBe(rawAgent);
    fireEvent.click(screen.getByTestId(`agent-open-${rawAgent}`));
    expect(screen.getByTestId('entity-detail-title').textContent).toBe('FYT API Worker');
    expect(screen.getByTestId('entity-detail-agent').getAttribute('aria-label')).toBe(`agent ${rawAgent}`);
    cleanup();

    render(<SessionProvider><AgentTile agentId={rawAgent} runRef="run-raw" events={[]} fetchImpl={vi.fn()} /></SessionProvider>);
    expect(screen.getByText('FYT API Worker').getAttribute('data-raw-id')).toBe(rawAgent);
    expect(screen.getByTestId(`run-tile-${rawAgent}`)).toBeTruthy();
    cleanup();

    const rawSchedule = 'daily-digest';
    const rawProject = 'kb_ops';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== '/api/panels/schedules') return new Response('', { status: 404 });
      return new Response(JSON.stringify({
        label: 'schedules', pausedCount: 0, files: { 'HEARTBEAT.md': '' },
        cadences: [{ project: rawProject, name: rawSchedule, schedule: '0 9 * * mon', tier: 'T1', riskTier: 'low', paused: false, file: 'HEARTBEAT.md', lastRun: null, runCount: 0, scheduleHint: null }],
      }), { status: 200 });
    }));
    render(<SessionProvider><SchedulesBody /></SessionProvider>);
    const scheduleRow = await screen.findByTestId(`schedules-row-${rawSchedule}`);
    expect(within(scheduleRow).getByText('KB Ops').getAttribute('title')).toBe(rawProject);
    expect(within(scheduleRow).getByText('Daily Digest').getAttribute('title')).toBe(rawSchedule);
    expect(scheduleRow.getAttribute('data-raw-id')).toBe(`${rawProject}:${rawSchedule}`);
    cleanup();

    const rawInbox = 'wake-me_runner-failed';
    const inboxFetch = vi.fn(async () => new Response(JSON.stringify({ items: [{
      id: 'a'.repeat(64), createdAt: '2026-08-21T00:00:00.000Z', revision: 'b'.repeat(64), kind: 'escalation',
      subject: { cardId: '68a70000-card' }, related: {}, title: rawInbox, reason: 'Needs you',
    }] }), { status: 200 }));
    render(<SessionProvider><Inbox fetchImpl={inboxFetch} sseFactory={() => ({ addEventListener: () => undefined, close: () => undefined })} /></SessionProvider>);
    const inboxLabel = await screen.findByText('Wake Me Runner Failed');
    expect(inboxLabel.getAttribute('title')).toBe(rawInbox);
    expect(inboxLabel.closest('li')?.getAttribute('data-raw-id')).toBe(rawInbox);
    cleanup();

    clearStoredSession();
    const rawHome = 'publish_daily-brief';
    const homeSnapshot: PlaneAIndex = {
      ...emptyIndex,
      cards: { working: [{
        meta: { id: rawHome, project: 'kb', action: rawHome, target: '.', 'risk-tier': 'T1', owner: rawAgent, state: 'working' },
        body: '', displayName: rawHome, shortRef: 1,
      }] },
    };
    render(<SessionProvider><Home snapshot={homeSnapshot} inboxSnapshot={{ items: [] }} /></SessionProvider>);
    expect(screen.getByText('Publish Daily Brief')).toBeTruthy();
    expect(screen.getByTitle(rawHome).getAttribute('title')).toBe(rawHome);
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { clearStoredSession, persistSession } from './lib/authClient';
import { installTestAuthContext, renderWithTestSession, type InstalledTestAuthContext } from './test/session';
import { SessionProvider } from './lib/sessionContext';
import { Agents } from './views/Agents';
import { SchedulesBody } from './views/Schedules';
import { Inbox } from './views/Inbox';
import { Home } from './views/Home';
import type { HomeResponse } from '../server/home/contracts.ts';
import { RunDetail } from './views/RunDetail';
import type { RunDetailDto } from './control/controlClient';

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
  it('preserves an attention-filtered roster deep link through the shell', async () => {
    window.history.replaceState(null, '', '/?view=agents&filter=attention');
    await renderApp();
    await waitFor(() => expect(window.location.search).toBe('?view=agents&filter=attention'));
    expect(screen.getByLabelText('Agents')).toBeTruthy();
  });

  it('loads the registered D13 Home projection instead of the retired index rollup', async () => {
    await renderApp();
    await waitFor(() => expect(fetchStub.mock.calls.some(([input]) => String(input) === '/api/home')).toBe(true));
    expect(fetchStub.mock.calls.some(([input]) => String(input) === '/api/index')).toBe(false);
  });

  it('renders the exact ten destinations, two dividers, and no retired destination', async () => {
    await renderApp();
    expect([...document.querySelectorAll('.mc-nav-item__label')].map((node) => node.textContent)).toEqual([
      'Home', 'Inbox', 'Schedules', 'Terminal', 'Agents', 'Workflows', 'Tasks', 'Projects', 'Files', 'Health',
    ]);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('falls malformed or removed URL ingress back to clean Home', async () => {
    for (const ingress of ['/?view=atlas&entity=agent%3Aold', '/?view=%']) {
      window.history.replaceState(null, '', ingress);
      await renderApp();
      await waitFor(() => expect(window.location.search).toBe('?view=home'));
      expect(screen.getByLabelText('Home view')).toBeTruthy();
      cleanup();
      window.history.replaceState(null, '', '/?view=home');
    }
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

  it('sidebar badges use Inbox plus distinct-run Agent and Workflow attention only', async () => {
    authContext.restore();
    const inboxResponse = new Response(JSON.stringify({ items: [{
      id: 'a'.repeat(64), createdAt: '2026-08-21T00:00:00.000Z', revision: 'b'.repeat(64), kind: 'escalation',
      subject: { cardId: '68a70000-card' }, related: {}, title: 'wake-me', reason: 'Needs you',
    }] }), { status: 200 });
    const attentionResponse = new Response(JSON.stringify({
      revision: 'c'.repeat(64),
      pairs: [
        { runRef: 'run-agent', owner: { type: 'agent', id: 'writer', sourcePath: 'agents/writer.md' } },
        { runRef: 'run-agent', owner: { type: 'agent', id: 'writer', sourcePath: 'agents/writer.md' } },
        { runRef: 'run-workflow', owner: { type: 'workflow', id: 'release', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/release.md' } },
      ],
      agents: { 'agent:contradiction': 99 },
      workflows: { 'workflow:contradiction': 88 },
    }), { status: 200 });
    fetchStub = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/inbox') return Promise.resolve(inboxResponse.clone());
      if (String(input) === '/api/attention') return Promise.resolve(attentionResponse.clone());
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal('fetch', fetchStub);
    authContext = installTestAuthContext(fetchStub as unknown as typeof fetch);
    await renderApp();
    await waitFor(() => {
      const agents = screen.getByText('Agents').closest('button')!;
      const workflows = screen.getByText('Workflows').closest('button')!;
      expect(within(agents).getByLabelText('1 pending')).toBeTruthy();
      expect(within(workflows).getByLabelText('1 pending')).toBeTruthy();
    });
    const badged = [...document.querySelectorAll('.mc-nav-item')]
      .filter((item) => item.querySelector('.mc-nav-item__badge'))
      .map((item) => item.querySelector('.mc-nav-item__label')?.textContent);
    expect(badged).toEqual(['Inbox', 'Agents', 'Workflows']);
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
    const summary = { ref: { type: 'agent', id: rawAgent, sourcePath: `agents/${rawAgent}.md` }, humanName: 'FYT API Worker', status: 'idle', modelLabel: 'claude-opus-5', temporalLabel: 'Never run · no schedule', host: 'desktop', gatedRunCount: 0, activeRuns: [], latestRun: null, nextSchedule: null };
    const entityDetail = { revision: 'detail-1', summary, brief: { purpose: 'Checks APIs.', doingNow: 'Idle.', recentRuns: [], outputs: [], pendingGates: 0, schedule: null, autonomyTier: 'queues-for-me' }, details: { sourcePath: `agents/${rawAgent}.md`, sourceRevision: 'a'.repeat(64), tools: [], declaredCeiling: 'queues-for-me', replaces: [], buildsOn: [], knowledgeSources: [], skills: [], schemas: [], lineage: [], grades: [], ids: [rawAgent] } };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith(rawAgent) ? entityDetail : { revision: 'list-1', groups: [{ id: 'kb-ops', label: 'KB Ops', collapsed: false, items: [summary] }], items: [summary] }), { status: 200 })));
    await renderWithTestSession(<Agents />);
    const rosterRow = await screen.findByTestId('entity-card');
    expect(rosterRow.textContent).toContain('FYT API Worker');
    fireEvent.click(rosterRow);
    expect(screen.getByTestId('entity-detail-title').textContent).toBe('FYT API Worker');
    expect(screen.getByTestId('entity-detail-agent').getAttribute('aria-label')).toBe('FYT API Worker detail');
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('FYT API Worker detail');
    expect(screen.getByRole('dialog').getAttribute('aria-label')).not.toContain(rawAgent);
    cleanup();

    const runDetail = {
      ownerSubject: rawAgent,
      run: { owner: summary.ref, executionHost: 'vm', terminalOutcome: null, completedAt: null, archivedFrom: null,
        runRef: 'run-humanized', predecessorRunRef: null, title: 'API verification', displayName: 'API verification', shortRef: 1,
        workflowRef: null, proposalRef: 'proposal-1', proposalRevision: 1, proposalHash: 'a'.repeat(64), publicationState: 'published',
        state: 'running', version: 1, managerSessionRef: 'manager-1', managerGeneration: 1, managerAssignment: null,
        createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:01:00.000Z' },
      stages: [], attempts: [], sessions: [], humanRequests: [], stageGenerations: [], generationSupersessions: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [],
    } as RunDetailDto;
    render(<SessionProvider><RunDetail runRef="run-humanized" detail={runDetail} events={[]} /></SessionProvider>);
    expect(screen.getByText(/FYT API Worker/)).toBeTruthy();
    expect(screen.getByText(/VM/)).toBeTruthy();
    expect(screen.getByRole('main').textContent).not.toContain(rawAgent);
    cleanup();

    const rawSchedule = 'daily-digest';
    const rawProject = 'kb-ops';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== '/api/schedules') return new Response('', { status: 404 });
      return new Response(JSON.stringify({
        scheduleCollectionRevision: 1,
        rows: [{
          id: 'd'.repeat(64), owner: { type: 'workflow', id: rawSchedule, project: rawProject, sourcePath: `orgs/${rawProject}/workflows/${rawSchedule}.md` },
          cadence: { source: '0 9 * * mon', words: 'Mon \u00b7 9:00 AM' }, nextAt: null, lastOutcome: null,
          armed: true, origin: 'operator', mirroredAt: null, mirrorPath: `orgs/${rawProject}/HEARTBEAT.md`, version: 1,
        }],
      }), { status: 200 });
    }));
    render(<SessionProvider><SchedulesBody /></SessionProvider>);
    const scheduleRow = await screen.findByTestId(`schedules-row-${'d'.repeat(64)}`);
    expect(within(scheduleRow).getByText('KB Ops').getAttribute('title')).toBe(rawProject);
    expect(within(scheduleRow).getByText('Daily Digest').getAttribute('title')).toBe(rawSchedule);
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
    const homeResponse: HomeResponse = {
      revision: 'home-humanized',
      sections: [
        { state: 'ready', data: { section: 'running-now', runs: [{
          runRef: 'run-home', title: 'Publish Daily Brief', owner: { type: 'agent', id: rawHome, sourcePath: `agents/${rawHome}.md` },
          lifecycle: 'running', outcome: null, createdAt: '2026-08-22T00:00:00.000Z', completedAt: null, streamKind: 'transcript',
        }] } },
        { state: 'ready', data: { section: 'attention-counts', agents: 0, workflows: 0, inbox: 0 } },
        { state: 'ready', data: { section: 'next-schedules', occurrences: [] } },
        { state: 'unavailable', reason: 'release-unavailable' },
        { state: 'ready', data: { section: 'recent-outcomes', outcomes: [] } },
      ],
    };
    render(<SessionProvider><Home response={homeResponse} /></SessionProvider>);
    expect(screen.getByText('Publish Daily Brief')).toBeTruthy();
    expect(screen.getByLabelText('Home').textContent).not.toContain(rawHome);
  });
});

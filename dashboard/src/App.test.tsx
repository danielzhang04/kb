// @vitest-environment jsdom
/**
 * U2.5 — App shell: desktop-first left-sidebar navigation driven by the entity-first IA in
 * `src/nav/config.ts`. The groups are UNLABELLED (hairline dividers only — no uppercase group headers,
 * no per-section collapse); a [+ New ▾] menu sits above the first divider with truthful outcome hints.
 * a live item swaps the main content; greyed ("soon") items never become active; a sidebar-wide toggle
 * collapses to an icon rail; the Session/Stop floor is present regardless of the active view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { App } from './App';
import { invalidateSessionOnGovernedAuthFailure } from './lib/authClient';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.removeItem('kb-composer-open-refs-v1');
  // Views self-fetch on mount; a never-resolving stub keeps every view on its empty-safe scaffold
  // (and keeps the sidebar approvals-count at 0, so no badge) without real network or state churn.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App shell — entity-first sidebar navigation', () => {
  it('renders the sidebar as unlabelled groups (dividers, no group headers) with every nav item', () => {
    render(<App />);

    expect(screen.getByLabelText('Primary navigation')).toBeTruthy();

    // No verb-group headers survive the entity-first regroup.
    for (const oldGroup of ['Operate', 'Build', 'Knowledge', 'System']) {
      expect(screen.queryByRole('button', { name: oldGroup })).toBeNull();
    }
    // Divider-only separators are present instead (one per group).
    expect(screen.getAllByRole('separator').length).toBe(3);

    for (const label of [
      'Home',
      'Inbox',
      'Activity',
      'Atlas',
      'Terminal',
      'Workflows',
      'Runs',
      'Agents',
      'Tasks',
      'Projects',
      'Files',
      'Connectors',
      'Ledgers',
      'Sentinel',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
  });

  it('does not render any dropped verb-IA destination', () => {
    render(<App />);
    // D3.4 makes `Runs` (stable route id: `pipeline`) and D3.5 makes `Sentinel` real destinations again,
    // so neither is in the
    // dropped set any more.
    for (const dropped of ['Board', 'Editor', 'Vibe', 'Registry']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${dropped}$`) })).toBeNull();
    }
  });

  it('lands on the Home rollup view by default', () => {
    render(<App />);
    expect(screen.getByLabelText('Home view')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
  });

  it('pins the Session/Stop floor in the shell, present regardless of the active view', () => {
    render(<App />);
    expect(screen.getByTestId('stop-floor')).toBeTruthy();
    // U5.1 — the floor carries a passive session indicator, NOT sign-in/out chrome.
    expect(screen.getByTestId('session-state').textContent).toMatch(/dashboard locked/i);
    expect(screen.getByRole('button', { name: 'Unlock dashboard' })).toBeTruthy();
    expect(screen.getByTestId('session-state').textContent).toMatch(/no private key leaves your device/i);
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    expect(screen.getByLabelText('Stop floor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'STOP everything' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(screen.getByLabelText('Stop floor')).toBeTruthy();
  });

  it('restores an unexpired tab session after a refresh-sized remount', () => {
    window.sessionStorage.setItem(
      'kb-dashboard-session-v1',
      JSON.stringify({ token: 'restored-token', expiresAt: Date.now() + 60_000 }),
    );
    render(<App />);

    expect(screen.getByTestId('session-state').textContent).toMatch(/dashboard unlocked/i);
    expect(screen.queryByRole('button', { name: 'Unlock dashboard' })).toBeNull();
  });

  it('drops an in-memory saved session after a governed bad-signature response', async () => {
    window.sessionStorage.setItem(
      'kb-dashboard-session-v1',
      JSON.stringify({ token: 'rotated-secret-token', expiresAt: Date.now() + 60_000 }),
    );
    render(<App />);
    expect(screen.getByTestId('session-state').textContent).toMatch(/dashboard unlocked/i);

    await invalidateSessionOnGovernedAuthFailure(new Response(JSON.stringify({
      error: 'unauthenticated',
      reason: 'bad-signature',
    }), { status: 401, headers: { 'content-type': 'application/json' } }));

    await waitFor(() => expect(screen.getByTestId('session-state').textContent).toMatch(/dashboard locked/i));
    expect(window.sessionStorage.getItem('kb-dashboard-session-v1')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unlock dashboard' })).toBeTruthy();
  });

  it('lays the sidebar out as a full-height column: [+ New] header, scrollable nav, pinned floor last', () => {
    // U5.1 item 7 — the sidebar is a three-zone flex column pinned to the viewport height. jsdom can't
    // compute the 100dvh/zoom layout, so this pins the STRUCTURE the CSS relies on: the middle nav zone
    // exists (it carries overflow-y:auto), and the Session·STOP floor is the LAST child of the sidebar
    // so margin-top:auto pins it to the bottom rather than letting it be pushed off-screen mid-column.
    render(<App />);
    const sidebar = screen.getByLabelText('Primary navigation');
    expect(sidebar.querySelector('.mc-nav')).toBeTruthy();
    expect(sidebar.lastElementChild?.getAttribute('data-testid')).toBe('stop-floor');
    // The [+ New] header zone sits inside the sidebar, above the nav list.
    expect(within(sidebar).getByRole('button', { name: 'New' })).toBeTruthy();
  });

  it('exposes a quiet theme toggle that flips the pinned data-theme and persists the choice', () => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    render(<App />);

    const toggle = screen.getByRole('button', { name: /switch to light theme/i });
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('mc-theme')).toBe('light');

    // Toggling back returns to dark (the app default) and re-persists.
    fireEvent.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('mc-theme')).toBe('dark');
  });

  it('routes each live destination to its mapped view', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(screen.getByRole('button', { name: 'Workflows' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    expect(screen.queryByLabelText('Control view')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));
    expect(screen.getByLabelText('Human Inbox')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByLabelText('Activity view')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
    expect(screen.getByLabelText('Connectors view')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByLabelText('Files view')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByLabelText('Home view')).toBeTruthy();
  });

  it('routes the U3 entity destinations (Agents/Tasks/Projects/Ledgers) to their real views', () => {
    render(<App />);
    for (const label of ['Agents', 'Tasks', 'Projects', 'Ledgers']) {
      const btn = screen.getByRole('button', { name: label }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      expect(btn.getAttribute('aria-current')).toBe('page');
      // The real view is mounted (self-fetch stubbed to never resolve → empty-safe scaffold), not the
      // "built in U3" placeholder.
      const view = screen.getByLabelText(`${label} view`);
      expect(view.textContent ?? '').not.toMatch(/built in U3/i);
    }
  });

  it('routes the Sentinel destination to the layer-panel set with its four sub-tabs (D3.5)', () => {
    render(<App />);
    const btn = screen.getByRole('button', { name: 'Sentinel' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-current')).toBe('page');

    // The layer-panel host mounts with its three sub-tabs; Sentinel (liveness) is the default panel.
    // (Atlas V1 retired the Atlas sub-tab — it is now its own top-level nav destination.)
    const view = screen.getByLabelText('Sentinel view');
    const tablist = within(view).getByRole('tablist', { name: 'Layer panels' });
    for (const label of ['Sentinel', 'Quartermaster', 'Flight Recorder']) {
      expect(within(tablist).getByRole('tab', { name: label })).toBeTruthy();
    }
    expect(within(tablist).queryByRole('tab', { name: 'Atlas' })).toBeNull();
    expect(within(view).getByLabelText('Sentinel panel')).toBeTruthy();

    // Switching sub-tabs swaps the active panel without leaving the destination.
    fireEvent.click(within(tablist).getByRole('tab', { name: 'Quartermaster' }));
    expect(screen.getByLabelText('Quartermaster panel')).toBeTruthy();
    fireEvent.click(within(tablist).getByRole('tab', { name: 'Flight Recorder' }));
    expect(screen.getByLabelText('Flight Recorder panel')).toBeTruthy();
  });

  it('routes the live Atlas destination (Atlas V1 voice-worker mirror) to its real view', () => {
    render(<App />);
    // Atlas went live in Atlas V1 — the greyed "soon" stub was promoted to a full top-level view.
    const btn = screen.getByRole('button', { name: /^Atlas/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-current')).toBe('page');
    // The real Atlas view mounts (self-fetch stubbed to never resolve → empty-safe scaffold), not the
    // "built in U3" placeholder.
    const view = screen.getByLabelText('Atlas view');
    expect(view.textContent ?? '').not.toMatch(/built in U3/i);
  });

  it('routes the live Terminal destination (D3.2 PTY pane) to its real view', () => {
    render(<App />);
    const btn = screen.getByRole('button', { name: /^Terminal/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-current')).toBe('page');
    // The real Terminal view mounts (session-gated: it shows the passkey prompt, not the U3 placeholder).
    const view = screen.getByLabelText('Terminal view');
    expect(view.textContent ?? '').not.toMatch(/built in U3/i);
    expect(view.textContent ?? '').toMatch(/passkey/i);
  });

  it('keeps the Terminal workspace mounted across navigation', () => {
    render(<App />);
    const terminalButton = screen.getByRole('button', { name: /^Terminal/ });
    fireEvent.click(terminalButton);

    const surface = screen.getByTestId('persistent-terminal-surface') as HTMLDivElement;
    const terminal = screen.getByLabelText('Terminal view');
    expect(surface.hidden).toBe(false);

    // Destination navigation hides the same mounted node; returning reveals it rather than remounting it.
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(surface.hidden).toBe(true);
    expect(screen.getByLabelText('Terminal view')).toBe(terminal);
    fireEvent.click(terminalButton);
    expect(surface.hidden).toBe(false);
    expect(screen.getByLabelText('Terminal view')).toBe(terminal);

  });

  it('the sidebar-wide collapse toggle switches the shell into rail mode and back', () => {
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    const expanded = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expanded.getAttribute('aria-pressed')).toBe('true');
    // Nav items stay reachable in rail mode (CSS hides labels, not the DOM/a11y tree).
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();

    fireEvent.click(expanded);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  });
});

function composerSession(composerRef: string, title: string, state: 'open' | 'archived' = 'open') {
  const now = '2026-07-18T12:00:00.000Z';
  return { composerRef, title, state, createdAt: now, updatedAt: now, sourceComposerRef: null, turns: [] };
}

function unlockForWorkspaceTests(): void {
  window.sessionStorage.setItem(
    'kb-dashboard-session-v1',
    JSON.stringify({ token: 'workspace-token', expiresAt: Date.now() + 60_000 }),
  );
}

describe('App shell — Composer workspaces', () => {
  it('New directly creates a persistent Composer workspace without an entity dropdown', async () => {
    unlockForWorkspaceTests();
    const created = composerSession('cw-1', 'Research Atlas');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/composer/sessions' && init?.method === 'POST') {
        return new Response(JSON.stringify({ session: created }), { status: 200 });
      }
      if (url === '/api/composer/sessions') {
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    expect(await screen.findByRole('tab', { name: 'Research Atlas' })).toBeTruthy();
    expect(screen.getByTestId('composer-workspace-cw-1').hidden).toBe(false);
    expect(screen.queryByRole('menu', { name: 'Create new' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/composer/sessions',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('keeps multiple Composer panes mounted while tabs and destinations switch; Close is browser-only', async () => {
    unlockForWorkspaceTests();
    const sessions = [composerSession('cw-1', 'Atlas research'), composerSession('cw-2', 'Build plan')];
    let createIndex = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/composer/sessions' && init?.method === 'POST') {
        return new Response(JSON.stringify({ session: sessions[createIndex++] }), { status: 200 });
      }
      if (String(input) === '/api/composer/sessions') {
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await screen.findByRole('tab', { name: 'Atlas research' });
    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    await screen.findByRole('tab', { name: 'Build plan' });

    const firstPane = screen.getByTestId('composer-workspace-cw-1');
    const secondPane = screen.getByTestId('composer-workspace-cw-2');
    expect(firstPane.hidden).toBe(true);
    expect(secondPane.hidden).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Atlas research' }));
    expect(firstPane.hidden).toBe(false);
    expect(secondPane.hidden).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(screen.getByTestId('composer-workspace-cw-1')).toBe(firstPane);
    expect(screen.getByTestId('composer-workspace-cw-2')).toBe(secondPane);
    expect(firstPane.hidden).toBe(true);
    expect(secondPane.hidden).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'Build plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Build plan' }));
    expect(screen.queryByTestId('composer-workspace-cw-2')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/archive'))).toBe(false);

    fireEvent.click(screen.getByText('Recent (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Build plan' }));
    expect(screen.getByRole('tab', { name: 'Build plan' })).toBeTruthy();
    expect(screen.getByTestId('composer-workspace-cw-2')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/restore'))).toBe(false);
  });

  it('forks, archives, and restores workspaces through explicit actions', async () => {
    unlockForWorkspaceTests();
    const original = composerSession('cw-1', 'Original');
    const forked = { ...composerSession('cw-2', 'Original fork'), sourceComposerRef: 'cw-1' };
    const archived = composerSession('cw-2', 'Original fork', 'archived');
    const restored = composerSession('cw-2', 'Original fork');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/composer/sessions') {
        return new Response(JSON.stringify({ sessions: [original] }), { status: 200 });
      }
      if (url.endsWith('/fork')) return new Response(JSON.stringify({ session: forked }), { status: 200 });
      if (url.endsWith('/archive')) return new Response(JSON.stringify({ session: archived }), { status: 200 });
      if (url.endsWith('/restore')) return new Response(JSON.stringify({ session: restored }), { status: 200 });
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem('kb-composer-open-refs-v1', JSON.stringify(['cw-1']));
    render(<App />);

    await screen.findByRole('tab', { name: 'Original' });
    fireEvent.click(screen.getByRole('tab', { name: 'Original' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    await screen.findByRole('tab', { name: 'Original fork' });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Original fork' })).toBeNull());
    fireEvent.click(screen.getByText('Archived (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Original fork' }));
    expect(await screen.findByRole('tab', { name: 'Original fork' })).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        '/api/composer/sessions/cw-1/fork',
        '/api/composer/sessions/cw-2/archive',
        '/api/composer/sessions/cw-2/restore',
      ]),
    );
  });
});

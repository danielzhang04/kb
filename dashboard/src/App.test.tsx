// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { clearStoredSession, persistSession } from './lib/authClient';
import { installTestAuthContext, type InstalledTestAuthContext } from './test/session';

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

  it('humanizes roster header run-owner Schedules Inbox and Home labels from raw ids', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inbox' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Schedules' })).toBeTruthy();
    expect(screen.queryByText('home')).toBeNull();
    expect(screen.queryByText('inbox')).toBeNull();
  });
});

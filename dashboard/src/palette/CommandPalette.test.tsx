// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { clearStoredSession, persistSession } from '../lib/authClient';
import { installTestAuthContext, type InstalledTestAuthContext } from '../test/session';
import { ALL_COMMANDS } from './paletteModel';

let authContext: InstalledTestAuthContext;

beforeEach(() => {
  window.history.replaceState(null, '', '/?view=home');
  const fetchStub = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal('fetch', fetchStub);
  authContext = installTestAuthContext(fetchStub as unknown as typeof fetch);
  persistSession({ token: 'palette-session', expiresAt: Date.now() + 60_000 });
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

function openPalette(metaKey = false): void {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: !metaKey, metaKey });
}

function input(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Search commands and destinations' });
}

describe('P1 command palette', () => {
  it('opens on Ctrl+K and closes on Escape', async () => {
    await renderApp();
    openPalette();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('opens on Cmd+K', async () => {
    await renderApp();
    openPalette(true);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('renders exactly the ten destination commands', async () => {
    await renderApp();
    openPalette();
    expect(screen.getAllByRole('option').map((option) => option.id)).toEqual(
      ALL_COMMANDS.map((command) => `mc-palette-opt-${command.id}`),
    );
  });

  it('filters destinations and navigates with Enter', async () => {
    await renderApp();
    openPalette();
    fireEvent.change(input(), { target: { value: 'workflows' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    expect(window.location.search).toBe('?view=workflows');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });
});

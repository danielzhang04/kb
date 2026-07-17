// @vitest-environment jsdom
/**
 * U1 — App shell: desktop-first left-sidebar navigation, grouped into collapsible sections
 * (Operate / Build / Knowledge / System per `src/nav/config.ts`) with a pinned-bottom Session/Stop
 * floor. Clicking a live item swaps the main content; greyed ("soon"/"future") items never become
 * active; a section header toggles that section's item list; a sidebar-wide toggle collapses to an
 * icon rail; the stop floor is present regardless of the active view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { App } from './App';

beforeEach(() => {
  // Control/Registry/Approvals/Browser/Timeline self-fetch on mount; a never-resolving stub keeps
  // every view on its empty-safe scaffold without real network or post-mount state churn.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App shell — sidebar navigation', () => {
  it('renders a sidebar grouped into sections, each with its nav items', () => {
    render(<App />);

    expect(screen.getByLabelText('Primary navigation')).toBeTruthy();
    for (const section of ['Operate', 'Build', 'Knowledge', 'System']) {
      expect(screen.getByRole('button', { name: section })).toBeTruthy();
    }
    for (const label of [
      'Board',
      'Approvals',
      'Timeline',
      'Terminal',
      'Editor',
      'Vibe',
      'Pipeline',
      'Registry',
      'Browser',
      'Atlas',
      'Agents',
      'Ledgers',
      'Sentinel',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
  });

  it('lands on the Board (Control) view by default', () => {
    render(<App />);
    expect(screen.getByLabelText('Control view')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Board' }).getAttribute('aria-current')).toBe('page');
  });

  it('pins the Session/Stop floor in the shell, present regardless of the active view', () => {
    render(<App />);
    // WebAuthn session placeholder + the relocated stop controls are always in the shell.
    expect(screen.getByTestId('stop-floor')).toBeTruthy();
    expect(screen.getByTestId('session-state').textContent).toMatch(/signed out/i);
    expect(screen.getByLabelText('Stop floor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'STOP everything' })).toBeTruthy();

    // Switch away from the Board — the floor is still there.
    fireEvent.click(screen.getByRole('button', { name: 'Registry' }));
    expect(screen.getByLabelText('Stop floor')).toBeTruthy();
  });

  it('clicking a live nav item switches the active view', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Registry' }));
    expect(screen.getByRole('button', { name: 'Registry' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByLabelText('Control view')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));
    expect(screen.getByLabelText('Approvals inbox')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByLabelText('Timeline view')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Vibe' }));
    expect(screen.getByLabelText('Vibe-code chat')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Browser' }));
    expect(screen.getByLabelText('KB browser view')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByLabelText('Control view')).toBeTruthy();
  });

  it('greyed "soon"/"future" nav items are unclickable and never become the active view', () => {
    render(<App />);

    for (const label of ['Terminal', 'Pipeline', 'Atlas', 'Agents', 'Ledgers', 'Sentinel']) {
      const btn = screen.getByRole('button', { name: new RegExp(`^${label}`) }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      fireEvent.click(btn);
    }
    // Still on the default Board view — every disabled click was a no-op.
    expect(screen.getByLabelText('Control view')).toBeTruthy();
  });

  it('a section header toggles that section — collapsing Build hides its items but leaves others', () => {
    render(<App />);

    const buildHeader = screen.getByRole('button', { name: 'Build' });
    expect(buildHeader.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Editor' })).toBeTruthy();

    fireEvent.click(buildHeader);
    expect(buildHeader.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Editor' })).toBeNull();
    // Other sections are untouched.
    expect(screen.getByRole('button', { name: 'Board' })).toBeTruthy();

    fireEvent.click(buildHeader);
    expect(buildHeader.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Editor' })).toBeTruthy();
  });

  it('the sidebar-wide collapse toggle switches the shell into rail mode and back', () => {
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    const expanded = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expanded.getAttribute('aria-pressed')).toBe('true');

    // Nav items are still present/reachable in rail mode (CSS hides labels, not the DOM/a11y tree).
    expect(screen.getByRole('button', { name: 'Board' })).toBeTruthy();

    fireEvent.click(expanded);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  });
});

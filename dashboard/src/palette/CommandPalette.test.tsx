// @vitest-environment jsdom
/**
 * U4 — command palette, exercised through the real App shell. It opens on Ctrl/Cmd+K, filters
 * destinations, navigates on Enter, shows greyed soon items as non-actionable, and — critically — is a
 * SHORTCUT NEVER A BYPASS: running an act command issues no governed (write/verify/auth) network call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { App } from '../App';
import { resetFleetData } from '../flyout/useFleetData';
import { ALL_COMMANDS } from './paletteModel';

/** URL fragments of the governed (state-changing / auth) endpoints the palette must never call. */
const GOVERNED = /\/api\/(write|approvals\/verify|auth)/;

function fetchCalls(): unknown[][] {
  return (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

function openPalette(): void {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
}

/** The palette input specifically (other views render their own comboboxes, e.g. launch selects). */
function paletteInput(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Search commands and destinations' });
}

beforeEach(() => {
  resetFleetData();
  // Every view/self-fetch stubbed to never resolve → empty-safe scaffolds; call log still recorded.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('command palette — open/close', () => {
  it('opens on Ctrl+K and closes on Esc', () => {
    render(<App />);
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();

    openPalette();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();

    fireEvent.keyDown(paletteInput(), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('opens on Cmd+K (metaKey) too', () => {
    render(<App />);
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });
});

describe('command palette — navigate', () => {
  it('filters destinations as you type', () => {
    render(<App />);
    openPalette();
    fireEvent.change(paletteInput(), { target: { value: 'workflows' } });

    expect(screen.getAllByRole('option').length).toBeLessThan(ALL_COMMANDS.length);
    expect(screen.getByTestId('palette-cmd-nav:workflows')).toBeTruthy();
    expect(screen.queryByTestId('palette-cmd-nav:home')).toBeNull();
  });

  it('navigates on Enter (view changes, palette closes)', () => {
    render(<App />);
    openPalette();
    fireEvent.change(paletteInput(), { target: { value: 'workflows' } });
    fireEvent.keyDown(paletteInput(), { key: 'Enter' });

    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('navigates to a promoted destination (Atlas went live in Atlas V1)', () => {
    render(<App />);
    openPalette();
    // Atlas was the last greyed "soon" stub; Atlas V1 promoted it to a live top-level view, so its
    // palette command is now actionable (not aria-disabled) and Enter navigates to it.
    fireEvent.change(paletteInput(), { target: { value: 'atlas' } });

    const opt = screen.getByTestId('palette-cmd-nav:atlas');
    expect(opt.getAttribute('aria-disabled')).not.toBe('true');

    fireEvent.keyDown(paletteInput(), { key: 'Enter' });
    // Enter on the live row navigates to the Atlas view and closes the palette.
    expect(screen.getByLabelText('Atlas view')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });
});

describe('command palette — act is a shortcut, never a bypass', () => {
  const runByQuery = (q: string): void => {
    openPalette();
    const input = paletteInput();
    fireEvent.change(input, { target: { value: q } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  it('Launch opens the Workflows surface — which owns the one Launch button — with no governed call', () => {
    render(<App />);
    runByQuery('dispatch'); // unique keyword of the Launch shortcut
    // Home's launch form is gone (spec §5); the shortcut lands where the button actually is.
    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    expect(screen.queryByLabelText('Launch card')).toBeNull();
    expect(fetchCalls().filter((c) => GOVERNED.test(String(c[0])))).toHaveLength(0);
  });

  it('Approve opens the Inbox; Stop opens Sentinel — neither hits a governed endpoint', () => {
    render(<App />);

    runByQuery('corroborate'); // unique keyword of the Approve shortcut
    expect(screen.getByLabelText('Human Inbox')).toBeTruthy();

    runByQuery('nuclear'); // unique keyword of the Emergency-stop shortcut
    // The pinned floor is gone (spec §6): the shortcut NAVIGATES to the view that owns the controls.
    expect(screen.getByLabelText('Sentinel view')).toBeTruthy();
    expect(screen.getByLabelText('Emergency stop')).toBeTruthy();
    expect(screen.queryByTestId('stop-floor')).toBeNull();

    expect(fetchCalls().filter((c) => GOVERNED.test(String(c[0])))).toHaveLength(0);
  });
});

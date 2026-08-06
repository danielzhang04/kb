// @vitest-environment jsdom
/**
 * D2.8 — emergency-stop controls, unit-tested directly against `StopControls`.
 *
 * Two properties are load-bearing here: the nuclear STOP stays disarmed until its confirm checkbox is
 * checked, and every governed submit carries a bearer session token — either a stored one or one
 * minted by the point-of-action passkey ceremony on a locked tab. `panels/Sentinel.test.tsx` proves
 * the same component works from the surface that actually mounts it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { StopControls } from './stopControls';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession, type Session } from '../lib/authClient';

/** The one unlock: a stored fresh bearer (already unlocked) or an injected ceremony for the locked path. */
function withSession(ui: React.ReactElement, opts: { stored?: string; signIn?: () => Promise<Session> } = {}): React.ReactElement {
  if (opts.stored) persistSession({ token: opts.stored, expiresAt: Date.now() + 60_000 });
  return <SessionProvider deps={opts.signIn ? { signIn: opts.signIn } : undefined}>{ui}</SessionProvider>;
}

beforeEach(() => {
  // A never-resolving fetch stub is the default: no test here wants real network, and it keeps any
  // unasserted request pending rather than resolving into post-mount state churn.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  clearStoredSession();
  vi.unstubAllGlobals();
});

// StopControls is the app's ONE stop implementation, moved twice and forked never: out of the Board's
// right column into the shell's pinned floor (U1), and out of that floor onto the Sentinel view
// (spec §6). It is exported from ./Control and exercised directly here; `panels/Sentinel.test.tsx`
// proves it works from the surface that mounts it now.
describe('Emergency-stop controls (D2.8; mounted on Sentinel since spec §6)', () => {
  it('the nuclear STOP button stays disabled until the confirm checkbox is checked, even with a session', () => {
    render(withSession(<StopControls />, { stored: 'fake-session-token' }));

    const nukeButton = screen.getByRole('button', { name: 'STOP everything' }) as HTMLButtonElement;
    expect(nukeButton.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Confirm nuclear STOP'));
    expect(nukeButton.disabled).toBe(false);
  });

  it('POSTs a scoped stop request to /api/write/stop-card with a bearer session token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === '/api/write/stop-card') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'halting' }) } as Response);
        }
        return new Promise(() => {});
      }),
    );

    render(withSession(<StopControls />, { stored: 'fake-session-token' }));
    fireEvent.change(screen.getByLabelText('Card id to stop'), { target: { value: 'card-1' } });
    fireEvent.submit(screen.getByLabelText('Request card stop'));

    await waitFor(() => expect(screen.getByTestId('stop-card-status').textContent).toContain('halting'));

    const call = calls.find((c) => c.url === '/api/write/stop-card');
    expect((call?.init?.headers as Record<string, string>)?.authorization).toBe('Bearer fake-session-token');
    expect(JSON.parse(call?.init?.body as string)).toMatchObject({ cardId: 'card-1' });
  });

  it('POSTs the nuclear STOP request to /api/write/stop only once armed, and surfaces a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/write/stop') {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({ reason: 'unauthenticated' }) } as Response);
        }
        return new Promise(() => {});
      }),
    );

    render(withSession(<StopControls />, { stored: 'fake-session-token' }));
    fireEvent.click(screen.getByLabelText('Confirm nuclear STOP'));
    fireEvent.submit(screen.getByLabelText('Nuclear STOP'));

    await waitFor(() => expect(screen.getByTestId('nuke-status').textContent).toMatch(/refused: unauthenticated/));
  });
});

// Point-of-action passkey mint through the app's ONE session context: the governed controls are
// actionable on a LOCKED tab and a submit runs the shared ceremony inline, then POSTs with the freshly
// minted bearer. There is no per-surface unlock button anywhere below the top-bar chip.
describe('point-of-action session mint', () => {
  it('StopControls: mints on submit from a locked tab and POSTs the minted bearer', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === '/api/write/stop-card') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'halting' }) } as Response);
        }
        return new Promise(() => {});
      }),
    );
    const signIn = vi.fn(async () => ({ token: 'minted-tok', expiresAt: Date.now() + 60_000 }));

    render(withSession(<StopControls />, { signIn }));

    // Locked, but every governed control is actionable — the ceremony runs at point of action.
    expect((screen.getByRole('button', { name: 'Request stop' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Card id to stop'), { target: { value: 'card-9' } });
    fireEvent.submit(screen.getByLabelText('Request card stop'));

    await waitFor(() => expect(screen.getByTestId('stop-card-status').textContent).toContain('halting'));
    expect(signIn).toHaveBeenCalledTimes(1);
    const call = calls.find((c) => c.url === '/api/write/stop-card');
    expect((call?.init?.headers as Record<string, string>)?.authorization).toBe('Bearer minted-tok');
  });

});

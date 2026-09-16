// @vitest-environment jsdom
/**
 * The ONE unlock boundary. T2 removed the browser sign-in ceremony end to end: tailnet supplies an
 * ambient sentinel because the transport authenticates every request, and win32-desktop has no
 * session-minting path left, so `requireSession()` there fails closed to `null` whenever nothing fresh
 * is already stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { SessionProvider, useSession } from './sessionContext';
import {
  clearStoredSession,
  persistSession,
  SESSION_INVALIDATED_EVENT,
  SESSION_STORAGE_KEY,
  type Session,
} from './authClient';

type RequireSession = () => Promise<Session | null>;

/** A consumer that renders the shared lock state and hands its `requireSession` back to the test. */
function Probe({ id, capture }: { id: string; capture?: (require: RequireSession) => void }) {
  const { mode, session, locked, requireSession } = useSession();
  capture?.(requireSession);
  return <span data-testid={id} data-mode={mode ?? 'loading'}>{locked ? 'locked' : `unlocked:${session?.token ?? ''}`}</span>;
}

function freshSession(token = 'stored-token', ttlMs = 60_000): Session {
  return { token, expiresAt: Date.now() + ttlMs };
}

const win32Context = async () => ({ mode: 'win32-desktop' as const });

beforeEach(() => clearStoredSession());
afterEach(() => {
  cleanup();
  clearStoredSession();
  vi.useRealTimers();
});

describe('SessionProvider', () => {
  it('restores a fresh stored session on mount', async () => {
    const stored = freshSession('stored-token');
    persistSession(stored);

    render(
      <SessionProvider deps={{ fetchAuthContext: win32Context }}>
        <Probe id="a" />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('unlocked:stored-token'));
  });

  it('is locked (and drops the stored copy) when nothing fresh is stored', async () => {
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: 'stale', expiresAt: Date.now() - 1 }),
    );

    render(
      <SessionProvider deps={{ fetchAuthContext: win32Context }}>
        <Probe id="a" />
      </SessionProvider>,
    );

    expect(screen.getByTestId('a').textContent).toBe('locked');
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('reuses a fresh session instead of resolving a new one', async () => {
    persistSession(freshSession('stored-token'));
    let require!: RequireSession;

    render(
      <SessionProvider deps={{ fetchAuthContext: win32Context }}>
        <Probe id="a" capture={(r) => { require = r; }} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('unlocked:stored-token'));

    const reused = await act(async () => require());

    expect(reused?.token).toBe('stored-token');
  });

  it('re-locks every consumer on the session-invalidated event', async () => {
    persistSession(freshSession('stored-token'));

    render(
      <SessionProvider deps={{ fetchAuthContext: win32Context }}>
        <Probe id="a" />
        <Probe id="b" />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('unlocked:stored-token'));

    act(() => { window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT)); });

    expect(screen.getByTestId('a').textContent).toBe('locked');
    expect(screen.getByTestId('b').textContent).toBe('locked');
  });

  it('stops listening for invalidation after unmount', async () => {
    persistSession(freshSession('stored-token'));
    const view = render(
      <SessionProvider deps={{ fetchAuthContext: win32Context }}>
        <Probe id="a" />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('unlocked:stored-token'));

    view.unmount();

    expect(() => act(() => { window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT)); })).not.toThrow();
  });

  it('T2: win32-desktop has no sign-in path left — requireSession fails closed to null with nothing stored', async () => {
    let require!: RequireSession;

    render(
      <SessionProvider deps={{ fetchAuthContext: win32Context }}>
        <Probe id="a" capture={(r) => { require = r; }} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('a').getAttribute('data-mode')).toBe('win32-desktop'));

    const result = await act(async () => require());

    expect(result).toBeNull();
    expect(screen.getByTestId('a').textContent).toBe('locked');
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('re-locks when the session reaches its expiry', async () => {
    vi.useFakeTimers();
    persistSession({ token: 'short-lived', expiresAt: Date.now() + 1_000 });

    render(
      <SessionProvider deps={{ fetchAuthContext: win32Context }}>
        <Probe id="a" />
      </SessionProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('a').textContent).toBe('unlocked:short-lived');

    act(() => { vi.advanceTimersByTime(1_001); });

    expect(screen.getByTestId('a').textContent).toBe('locked');
  });

  it('uses an ambient session in tailnet mode — no sign-in path is ever reached', async () => {
    let require!: RequireSession;

    render(
      <SessionProvider deps={{
        fetchAuthContext: async () => ({ mode: 'tailnet' as const }),
      }}>
        <Probe id="a" capture={(next) => { require = next; }} />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('unlocked:tailnet-ambient'));
    await expect(require()).resolves.toMatchObject({ token: 'tailnet-ambient' });

    act(() => { window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT)); });
    expect(screen.getByTestId('a').textContent).toBe('unlocked:tailnet-ambient');
  });

  it('falls back to win32-desktop (locked, nothing stored) when auth-context discovery fails', async () => {
    let require!: RequireSession;

    render(
      <SessionProvider deps={{
        fetchAuthContext: async () => { throw new Error('offline'); },
      }}>
        <Probe id="a" capture={(next) => { require = next; }} />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('a').getAttribute('data-mode')).toBe('win32-desktop'));
    await expect(require()).resolves.toBeNull();
  });
});

describe('useSession', () => {
  it('throws a clear error outside a provider', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe id="a" />)).toThrow(/SessionProvider/);
    errors.mockRestore();
  });
});

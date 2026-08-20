// @vitest-environment jsdom
/**
 * The ONE unlock boundary: every consumer reads the same session and shares a single passkey ceremony.
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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type RequireSession = () => Promise<Session | null>;

/** A consumer that renders the shared lock state and hands its `requireSession` back to the test. */
function Probe({ id, capture }: { id: string; capture?: (require: RequireSession) => void }) {
  const { mode, session, locked, requireSession } = useSession();
  capture?.(requireSession);
  return <span data-testid={id} data-mode={mode ?? 'loading'}>{locked ? 'locked' : `unlocked:${session?.token ?? ''}`}</span>;
}

function freshSession(token = 'ceremony-token', ttlMs = 60_000): Session {
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

  it('runs ONE passkey ceremony for concurrent requireSession calls from different consumers', async () => {
    const pending = deferred<Session>();
    const signIn = vi.fn(() => pending.promise);
    const requires: RequireSession[] = [];

    render(
      <SessionProvider deps={{ signIn, fetchAuthContext: win32Context }}>
        <Probe id="a" capture={(r) => requires.push(r)} />
        <Probe id="b" capture={(r) => requires.push(r)} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('a').getAttribute('data-mode')).toBe('win32-desktop'));
    const [fromA, fromB] = [requires[0]!, requires[requires.length - 1]!];

    let resultA: Session | null = null;
    let resultB: Session | null = null;
    await act(async () => {
      const a = fromA().then((value) => { resultA = value; });
      const b = fromB().then((value) => { resultB = value; });
      pending.resolve(freshSession('shared-token'));
      await Promise.all([a, b]);
    });

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(resultA).toEqual(resultB);
    expect((resultA as Session | null)?.token).toBe('shared-token');
    expect(screen.getByTestId('a').textContent).toBe('unlocked:shared-token');
    expect(screen.getByTestId('b').textContent).toBe('unlocked:shared-token');
  });

  it('reuses a fresh session instead of minting a second one', async () => {
    persistSession(freshSession('stored-token'));
    const signIn = vi.fn(async () => freshSession('never-used'));
    let require!: RequireSession;

    render(
      <SessionProvider deps={{ signIn, fetchAuthContext: win32Context }}>
        <Probe id="a" capture={(r) => { require = r; }} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('unlocked:stored-token'));

    const reused = await act(async () => require());

    expect(signIn).not.toHaveBeenCalled();
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

  it('returns null and stays locked when the ceremony is refused', async () => {
    const signIn = vi.fn(async () => { throw new Error('assert/verify refused: 401'); });
    let require!: RequireSession;

    render(
      <SessionProvider deps={{ signIn, fetchAuthContext: win32Context }}>
        <Probe id="a" capture={(r) => { require = r; }} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('a').getAttribute('data-mode')).toBe('win32-desktop'));

    const result = await act(async () => require());

    expect(result).toBeNull();
    expect(screen.getByTestId('a').textContent).toBe('locked');
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    // A refused ceremony must not wedge the shared slot — the next attempt runs a new ceremony.
    await act(async () => require());
    expect(signIn).toHaveBeenCalledTimes(2);
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

  it('uses an ambient session in tailnet mode without invoking the passkey ceremony', async () => {
    const signIn = vi.fn(async () => freshSession('must-not-be-minted'));
    let require!: RequireSession;

    render(
      <SessionProvider deps={{
        signIn,
        fetchAuthContext: async () => ({ mode: 'tailnet' }),
      }}>
        <Probe id="a" capture={(next) => { require = next; }} />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('unlocked:tailnet-ambient'));
    await expect(require()).resolves.toMatchObject({ token: 'tailnet-ambient' });
    expect(signIn).not.toHaveBeenCalled();

    act(() => { window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT)); });
    expect(screen.getByTestId('a').textContent).toBe('unlocked:tailnet-ambient');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('falls back to the desktop ceremony when auth-context discovery fails', async () => {
    const signIn = vi.fn(async () => freshSession('fallback-token'));
    let require!: RequireSession;

    render(
      <SessionProvider deps={{
        signIn,
        fetchAuthContext: async () => { throw new Error('offline'); },
      }}>
        <Probe id="a" capture={(next) => { require = next; }} />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('a').getAttribute('data-mode')).toBe('win32-desktop'));
    await expect(require()).resolves.toMatchObject({ token: 'fallback-token' });
    expect(signIn).toHaveBeenCalledOnce();
  });
});

describe('useSession', () => {
  it('throws a clear error outside a provider', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe id="a" />)).toThrow(/SessionProvider/);
    errors.mockRestore();
  });
});

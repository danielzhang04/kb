// @vitest-environment jsdom
/**
 * U2 — session-bearer storage and `fetchAuthContext`, the boot discovery call. T2 removed the browser
 * sign-in ceremony (`signIn`) end to end; this file no longer exercises it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  clearStoredSession,
  DESKTOP_SESSION_ROUTE,
  fetchAuthContext,
  mintDesktopSession,
  invalidateSessionOnGovernedAuthFailure,
  persistSession,
  readStoredSession,
  SESSION_INVALIDATED_EVENT,
  SESSION_STORAGE_KEY,
} from './authClient';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('fetchAuthContext', () => {
  it.each(['win32-desktop', 'tailnet'] as const)('accepts the server auth mode %s', async (mode) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ mode }));

    await expect(fetchAuthContext(fetchImpl as unknown as typeof fetch))
      .resolves.toEqual({ mode });
    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/context', { method: 'GET' });
  });

  it.each([
    jsonResponse({ mode: 'unknown' }),
    jsonResponse({}),
    jsonResponse({ error: 'unavailable' }, false, 503),
  ])('throws instead of guessing when the response is unusable', async (response) => {
    await expect(fetchAuthContext(async () => response)).rejects.toThrow();
  });
});

describe('tab-scoped session persistence', () => {
  function memoryStore(): Storage {
    const values = new Map<string, string>();
    return {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, value); },
    };
  }

  it('restores a fresh session and removes it once expired', () => {
    const store = memoryStore();
    const now = Date.now();
    const session = { token: 'tab-token', expiresAt: now + 2_000 };
    persistSession(session, store);
    expect(readStoredSession(store, now + 1_000)).toEqual(session);
    expect(readStoredSession(store, now + 2_000)).toBeNull();
    expect(store.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('drops malformed data and supports an explicit clear', () => {
    const store = memoryStore();
    store.setItem(SESSION_STORAGE_KEY, '{bad-json');
    expect(readStoredSession(store, 0)).toBeNull();
    persistSession({ token: 't', expiresAt: Date.now() + 1_000 }, store);
    clearStoredSession(store);
    expect(store.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe('governed auth failure invalidation', () => {
  it.each(['bad-signature', 'expired', 'unauthenticated'])(
    'clears the saved session and emits a token-free signal for %s',
    async (reason) => {
      const session = { token: 'must-not-leak', expiresAt: Date.now() + 60_000 };
      persistSession(session);
      const events: Event[] = [];
      const listener = (event: Event): void => { events.push(event); };
      window.addEventListener(SESSION_INVALIDATED_EVENT, listener);
      const response = new Response(JSON.stringify({ error: 'unauthenticated', reason }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });

      expect(await invalidateSessionOnGovernedAuthFailure(response)).toBe(true);

      window.removeEventListener(SESSION_INVALIDATED_EVENT, listener);
      expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0]).not.toBeInstanceOf(CustomEvent);
      expect(JSON.stringify(events[0])).not.toContain(session.token);
      await expect(response.json()).resolves.toEqual({ error: 'unauthenticated', reason });
    },
  );

  it('preserves a saved session for an unrelated 401 refusal', async () => {
    const session = { token: 'still-valid', expiresAt: Date.now() + 60_000 };
    persistSession(session);
    const response = new Response(JSON.stringify({ error: 'credential-not-enrolled' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });

    expect(await invalidateSessionOnGovernedAuthFailure(response)).toBe(false);
    expect(readStoredSession()).toEqual(session);
  });
});

/**
 * BLOCKER-2 — the browser half of the `win32-desktop` mint path. The daemon proves the caller from the
 * socket (loopback + the same Windows account), so this client presents no credential at all: it POSTs,
 * and either receives a real bearer or stays locked.
 */
describe('mintDesktopSession', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
  const refused = (status: number) => ({ ok: false, status, json: async () => ({ error: 'unauthenticated' }) }) as unknown as Response;

  it('POSTs same-origin and returns the minted bearer', async () => {
    const expiresAt = Date.now() + 60_000;
    const fetchImpl = vi.fn(async () => ok({ token: 'desktop-token', expiresAt }));

    await expect(mintDesktopSession(fetchImpl as unknown as typeof fetch)).resolves.toEqual({ token: 'desktop-token', expiresAt });
    expect(fetchImpl).toHaveBeenCalledWith(DESKTOP_SESSION_ROUTE, expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
  });

  it('retries EXACTLY once past a refused browser-session ref, then reports the second refusal as itself', async () => {
    const expiresAt = Date.now() + 60_000;
    const healing = vi.fn()
      .mockResolvedValueOnce(refused(401))
      .mockResolvedValueOnce(ok({ token: 'second-try', expiresAt }));
    await expect(mintDesktopSession(healing as unknown as typeof fetch)).resolves.toEqual({ token: 'second-try', expiresAt });
    expect(healing).toHaveBeenCalledTimes(2);

    const stubborn = vi.fn(async () => refused(401));
    await expect(mintDesktopSession(stubborn as unknown as typeof fetch)).resolves.toBeNull();
    expect(stubborn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a refusal that is not about the ref cookie', async () => {
    const fetchImpl = vi.fn(async () => refused(403));
    await expect(mintDesktopSession(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    { token: '', expiresAt: Date.now() + 60_000 },
    { token: 'expired', expiresAt: Date.now() - 1 },
    { token: 'no-expiry' },
    { expiresAt: Date.now() + 60_000 },
    'not-an-object',
  ])('refuses to fabricate a session out of an unusable body', async (body) => {
    await expect(mintDesktopSession((async () => ok(body)) as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('is null — never a throw — when the daemon cannot be reached at all', async () => {
    await expect(mintDesktopSession((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).resolves.toBeNull();
  });
});

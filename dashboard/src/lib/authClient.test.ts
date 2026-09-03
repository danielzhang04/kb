// @vitest-environment jsdom
/**
 * U2 — authClient.signIn: WebAuthn login assertion (via webauthnClient) exchanged for a session bearer.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  clearStoredSession,
  fetchAuthContext,
  invalidateSessionOnGovernedAuthFailure,
  persistSession,
  readStoredSession,
  SESSION_INVALIDATED_EVENT,
  SESSION_STORAGE_KEY,
  signIn,
  unlockErrorMessage,
} from './authClient';
import type { WebAuthnBrowserLike } from './webauthnClient';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const fakeBrowser: WebAuthnBrowserLike = {
  browserSupportsWebAuthn: () => true,
  startRegistration: async () => ({}) as never,
  startAuthentication: async () => ({ id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {}, clientExtensionResults: {} }) as never,
};

describe('fetchAuthContext', () => {
  it.each(['win32-desktop', 'tailnet'] as const)('accepts the server auth mode %s', async (mode) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ mode, ceremonyAvailable: true }));

    await expect(fetchAuthContext(fetchImpl as unknown as typeof fetch))
      .resolves.toEqual({ mode, ceremonyAvailable: true });
    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/context', { method: 'GET' });
  });

  it.each([
    { ceremonyAvailable: false },
    {},
    { ceremonyAvailable: 'yes' },
    { ceremonyAvailable: 1 },
  ])('W47: reads ceremonyAvailable fail-closed from %o', async (extra) => {
    // Only a literal `true` enables the T3 Approve control. An older daemon that omits the field, or a
    // truthy-but-not-boolean value, reads false - the client can only be MORE restrictive than the routes.
    const context = await fetchAuthContext(async () => jsonResponse({ mode: 'tailnet', ...extra }));
    expect(context).toEqual({ mode: 'tailnet', ceremonyAvailable: false });
  });

  it.each([
    jsonResponse({ mode: 'unknown' }),
    jsonResponse({}),
    jsonResponse({ error: 'unavailable' }, false, 503),
  ])('throws instead of guessing when the response is unusable', async (response) => {
    await expect(fetchAuthContext(async () => response)).rejects.toThrow();
  });
});

describe('signIn', () => {
  it('runs the assertion ceremony and returns the minted session', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/auth/assert/options') return jsonResponse({ ceremonyId: 'cer-1', options: { challenge: 'ch' } });
      if (url === '/api/auth/assert/verify') return jsonResponse({ token: 'the-token', expiresAt: 999 });
      throw new Error(`unexpected ${url}`);
    });
    const session = await signIn({ fetchImpl: fetchImpl as unknown as typeof fetch, browser: fakeBrowser });
    expect(session).toEqual({ token: 'the-token', expiresAt: 999 });
    // The verify call echoed the ceremonyId + the browser's assertion response.
    const verifyCall = fetchImpl.mock.calls.find((c) => c[0] === '/api/auth/assert/verify')!;
    const body = JSON.parse((verifyCall[1]!).body as string);
    expect(body.ceremonyId).toBe('cer-1');
    expect(body.response.id).toBe('cred-1');
  });

  it('rejects (fail-closed, no token) when the server refuses the assertion — the pre-passkey reality', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/auth/assert/options') return jsonResponse({ ceremonyId: 'cer-1', options: { challenge: 'ch' } });
      return jsonResponse({ error: 'unauthenticated' }, false, 401);
    });
    await expect(signIn({ fetchImpl: fetchImpl as unknown as typeof fetch, browser: fakeBrowser })).rejects.toThrow(/refused: 401/);
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

describe('unlockErrorMessage', () => {
  it('turns common failures into actionable operator copy', () => {
    expect(unlockErrorMessage(new Error('assert/verify refused: 401'))).toMatch(/not enrolled/i);
    expect(unlockErrorMessage(new Error('NotAllowedError: cancelled'))).toMatch(/cancelled/i);
    expect(unlockErrorMessage(new Error('Failed to fetch'))).toMatch(/localhost:5317/i);
  });
});

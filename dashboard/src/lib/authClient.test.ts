/**
 * U2 — authClient.signIn: WebAuthn login assertion (via webauthnClient) exchanged for a session bearer.
 */
import { describe, expect, it, vi } from 'vitest';
import { signIn } from './authClient';
import type { WebAuthnBrowserLike } from './webauthnClient';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const fakeBrowser: WebAuthnBrowserLike = {
  browserSupportsWebAuthn: () => true,
  startRegistration: async () => ({}) as never,
  startAuthentication: async () => ({ id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {}, clientExtensionResults: {} }) as never,
};

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

/**
 * U2 — the browser sign-in flow: a WebAuthn login assertion (via `webauthnClient.ts#performAssertion`)
 * exchanged for a short-TTL session bearer. This is the ONLY place the client mints a session; every
 * governed write then carries the returned token.
 *
 *   1. POST /api/auth/assert/options  -> server-issued assertion options (+ opaque ceremonyId).
 *   2. performAssertion(options)       -> the browser's signed assertion (biometric/PIN — UV required).
 *   3. POST /api/auth/assert/verify   -> server verifies against the registered credential and, ONLY on
 *                                        a positively-verified assertion, returns { token, expiresAt }.
 *
 * Fail-closed: with no provisioned passkey the server 401s at step 3 and this rejects — no token is ever
 * fabricated client-side. `fetch` and the WebAuthn browser surface are injected (same DI seam as
 * `webauthnClient`/`sseClient`) so this is unit-testable with no real passkey or network.
 */
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { performAssertion, realWebAuthnBrowser } from './webauthnClient';
import type { WebAuthnBrowserLike } from './webauthnClient';

export type FetchLike = typeof fetch;

export interface Session {
  token: string;
  /** Expiry, epoch ms — the caller drops the token past this. */
  expiresAt: number;
}

export interface SignInDeps {
  fetchImpl?: FetchLike;
  browser?: WebAuthnBrowserLike;
}

/**
 * Run the WebAuthn login flow and return the minted session. Rejects (never returns a partial/fake
 * session) when the browser lacks WebAuthn, the ceremony is cancelled, or the server refuses the
 * assertion (e.g. no registered passkey — the fail-closed pre-passkey reality).
 */
export async function signIn(deps: SignInDeps = {}): Promise<Session> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const browser = deps.browser ?? realWebAuthnBrowser;

  const optsRes = await fetchImpl('/api/auth/assert/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!optsRes.ok) throw new Error(`assert/options failed: ${optsRes.status}`);
  const { ceremonyId, options } = (await optsRes.json()) as {
    ceremonyId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  };

  const response = await performAssertion(options, browser);

  const verifyRes = await fetchImpl('/api/auth/assert/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ceremonyId, response }),
  });
  if (!verifyRes.ok) throw new Error(`assert/verify refused: ${verifyRes.status}`);
  const body = (await verifyRes.json()) as { token?: string; expiresAt?: number };
  if (!body.token || typeof body.expiresAt !== 'number') {
    throw new Error('assert/verify returned no session token');
  }
  return { token: body.token, expiresAt: body.expiresAt };
}

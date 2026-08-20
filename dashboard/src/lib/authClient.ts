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
export type AuthMode = 'win32-desktop' | 'tailnet';

export interface AuthContext {
  mode: AuthMode;
}

export interface Session {
  token: string;
  /** Expiry, epoch ms — the caller drops the token past this. */
  expiresAt: number;
}

/**
 * A session bearer belongs to this browser tab. `sessionStorage` deliberately survives a refresh but
 * not a closed tab, keeping the convenience window narrower than a durable `localStorage` login.
 */
export const SESSION_STORAGE_KEY = 'kb-dashboard-session-v1';
/** Token-free browser signal used to keep App memory in sync with tab storage after a governed 401. */
export const SESSION_INVALIDATED_EVENT = 'kb-dashboard-session-invalidated';

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserSessionStore(): SessionStore | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Storage may be disabled by browser policy. Authentication still works in memory for this render.
    return null;
  }
}

export function isSessionFresh(session: Session | null, now = Date.now()): session is Session {
  return Boolean(
    session &&
      typeof session.token === 'string' &&
      session.token.length > 0 &&
      Number.isFinite(session.expiresAt) &&
      session.expiresAt > now,
  );
}

/** Restore only a structurally valid, unexpired session. Bad/expired data is removed, never reused. */
export function readStoredSession(
  store: SessionStore | null = browserSessionStore(),
  now = Date.now(),
): Session | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Session;
    if (!isSessionFresh(candidate, now)) {
      store.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return candidate;
  } catch {
    try {
      store.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Storage can fail on both read and cleanup under restrictive browser policy.
    }
    return null;
  }
}

export function persistSession(
  session: Session,
  store: SessionStore | null = browserSessionStore(),
): void {
  if (!store || !isSessionFresh(session)) return;
  try {
    store.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // An unavailable/full storage area must not turn a valid WebAuthn login into an action failure.
  }
}

export function clearStoredSession(store: SessionStore | null = browserSessionStore()): void {
  try {
    store?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Treat storage cleanup as best-effort; App state is still cleared synchronously.
  }
}

function signalSessionInvalidated(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT));
  } catch {
    // Storage is already cleared. A restricted browser event surface must not preserve the stale bearer.
  }
}

/**
 * Drop a saved bearer when a governed endpoint reports that it is no longer authentic. The response is
 * cloned before inspection so callers can still consume its refusal body. The signal intentionally has
 * no detail payload: session tokens and server response bodies never ride browser events.
 */
export async function invalidateSessionOnGovernedAuthFailure(response: Response): Promise<boolean> {
  if (response.status !== 401 || typeof response.clone !== 'function') return false;
  let body: { error?: unknown; reason?: unknown; detail?: unknown };
  try {
    body = (await response.clone().json()) as { error?: unknown; reason?: unknown; detail?: unknown };
  } catch {
    return false;
  }
  const refusal = [body.error, body.reason, body.detail]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (!/(?:bad-signature|expired|unauthenticated)/.test(refusal)) return false;
  clearStoredSession();
  signalSessionInvalidated();
  return true;
}

/** Calm, actionable operator copy without exposing server internals or implying a private key upload. */
export function unlockErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : '';
  if (/not supported|webauthn.+unavailable/i.test(detail)) {
    return 'This browser cannot use passkeys. Open the dashboard in a WebAuthn-capable browser.';
  }
  if (/cancel|abort|notallowederror/i.test(detail)) {
    return 'Dashboard unlock was cancelled. Try again when you are ready.';
  }
  if (/401|no registered|credential/i.test(detail)) {
    return 'This passkey is not enrolled for the dashboard. Use the enrolled Windows Hello or device passkey.';
  }
  if (/failed to fetch|network|load failed/i.test(detail)) {
    return 'The dashboard could not reach its authentication service. Check that localhost:5317 is running.';
  }
  return 'Dashboard unlock failed. Try again; if it keeps failing, check the dashboard server logs.';
}

export interface SignInDeps {
  fetchImpl?: FetchLike;
  browser?: WebAuthnBrowserLike;
}

async function responseFailure(label: string, response: Response): Promise<Error> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: string; reason?: string; detail?: string };
    detail = body.detail ?? body.reason ?? body.error ?? '';
  } catch {
    // A status code is still enough to fail closed and choose generic operator copy.
  }
  return new Error(`${label}: ${response.status}${detail ? ` (${detail})` : ''}`);
}

/** Discover the server's single authentication mode. Any unreadable or unknown response fails closed. */
export async function fetchAuthContext(fetchImpl: FetchLike = fetch): Promise<AuthContext> {
  const response = await fetchImpl('/api/auth/context', { method: 'GET' });
  if (!response.ok) throw await responseFailure('auth/context failed', response);
  const body = await response.json() as unknown;
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || ((body as Record<string, unknown>).mode !== 'win32-desktop'
      && (body as Record<string, unknown>).mode !== 'tailnet')
  ) {
    throw new Error('auth/context returned an invalid mode');
  }
  return { mode: (body as AuthContext).mode };
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
  if (!optsRes.ok) throw await responseFailure('assert/options failed', optsRes);
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
  if (!verifyRes.ok) throw await responseFailure('assert/verify refused', verifyRes);
  const body = (await verifyRes.json()) as { token?: string; expiresAt?: number };
  if (!body.token || typeof body.expiresAt !== 'number') {
    throw new Error('assert/verify returned no session token');
  }
  return { token: body.token, expiresAt: body.expiresAt };
}

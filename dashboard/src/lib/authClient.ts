/**
 * U2 — session-bearer storage and the boot-time auth-context discovery call.
 *
 * T2 removed the browser sign-in ceremony (`signIn`) end to end: in `tailnet` mode the transport
 * itself is the credential, so there is no sign-in ceremony to run, and `mintSession` is what the
 * session-gated routes use server-side. What remains here is session-bearer storage (a token, once a
 * caller has one) and `fetchAuthContext`, the one boot discovery call every client makes before
 * anything else.
 */
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
    // An unavailable/full storage area must not turn a valid sign-in into an action failure.
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

/**
 * BLOCKER-2 — the ONE route that mints a session in `win32-desktop` mode, and the client for it.
 *
 * It is the same path the browser already called for its controller cookie, because in that mode the two
 * are one act: the daemon proves the caller from the SOCKET (loopback, and a process owned by the same
 * Windows account — `server/auth/win32DesktopPeer.ts`), then hands back both a bearer and the ref cookie.
 * So this client presents NO credential: there is nothing it could hold that would matter, and nothing a
 * page on another origin could do with the answer (the Origin guard refuses it, and the token rides in a
 * body no cross-origin reader can see).
 *
 * The single retry mirrors `browserSessionClient.ts`: a browser holding a ref the daemon has forgotten is
 * refused 401 and cannot drop the HttpOnly cookie itself, so the refusal carries the expiring cookie and
 * the second call presents nothing and mints cleanly. EXACTLY one retry — a second 401 is a real refusal.
 */
export const DESKTOP_SESSION_ROUTE = '/api/auth/browser-session';

/** One POST. A transport failure is `null`, distinct from any status the daemon actually returned. */
async function postDesktopSession(fetchImpl: FetchLike): Promise<Response | null> {
  try {
    return await fetchImpl(DESKTOP_SESSION_ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    });
  } catch {
    return null;
  }
}

/** A minted session, or `null`. NEVER throws, and never fabricates: an unreadable or stale body is a
 *  refusal, so a caller can only ever be handed a bearer the daemon really signed. */
async function readMintedSession(response: Response): Promise<Session | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const candidate = body as { token?: unknown; expiresAt?: unknown };
  const session = { token: candidate.token, expiresAt: candidate.expiresAt } as Session;
  return isSessionFresh(session) ? { token: session.token, expiresAt: session.expiresAt } : null;
}

export async function mintDesktopSession(fetchImpl: FetchLike = fetch): Promise<Session | null> {
  const first = await postDesktopSession(fetchImpl);
  if (first === null) return null;
  if (first.ok) return readMintedSession(first);
  // 401 = the ref this browser presented was refused; the refusal carried the expiring cookie, so the
  // retry presents nothing. Any other status is a decision about the CALLER, which a retry cannot change.
  if (first.status !== 401) return null;
  const second = await postDesktopSession(fetchImpl);
  if (second === null || !second.ok) return null;
  return readMintedSession(second);
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

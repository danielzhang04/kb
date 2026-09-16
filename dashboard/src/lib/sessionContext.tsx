/**
 * The dashboard's ONE authentication boundary. In `tailnet` mode the transport itself authenticates
 * every request, so `requireSession()` returns an ambient sentinel with no network round trip. In
 * `win32-desktop` mode there is no sign-in ceremony left to run — T2 removed it end to end along with
 * the ceremony routes it depended on — so `requireSession()` there fails closed to `null`
 * (locked) until a replacement session-minting path exists. Governed surfaces call
 * `useSession().requireSession()` instead of owning auth flows directly.
 *
 *   - The token lives here (memory) + tab-scoped `sessionStorage` via authClient — nowhere else.
 *   - Fail-closed: a failed/absent session resolves `null` (never throws, never fabricates), the
 *     stored copy is cleared, and every consumer re-locks together — on expiry and on the
 *     `SESSION_INVALIDATED_EVENT` a governed 401 raises.
 *
 * Mode discovery is injected so this is testable with no network.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import {
  clearStoredSession,
  fetchAuthContext as realFetchAuthContext,
  isSessionFresh,
  readStoredSession,
  SESSION_INVALIDATED_EVENT,
  type AuthContext,
  type AuthMode,
  type Session,
} from './authClient';

/** Existing clients attach this harmless sentinel; tailnet server auth ignores bearer contents. */
export const TAILNET_AMBIENT_SESSION: Session = Object.freeze({
  token: 'tailnet-ambient',
  expiresAt: Date.UTC(9999, 11, 31, 23, 59, 59, 999),
});

export interface SessionContextValue {
  /** Server-selected auth mode, or null while the one boot-time discovery request is pending. */
  mode: AuthMode | null;
  /** The live bearer, or null when locked. */
  session: Session | null;
  /** Tailnet is always unlocked; desktop remains bearer-derived; loading is fail-closed. */
  locked: boolean;
  /** Tailnet returns the ambient sentinel; desktop has no sign-in path left and resolves `null`. */
  requireSession(): Promise<Session | null>;
}

export interface SessionProviderDeps {
  /** The one boot-time auth-mode request. Tests inject a fake; production uses `fetchAuthContext`. */
  fetchAuthContext?: () => Promise<AuthContext>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  deps,
}: {
  children: ReactNode;
  deps?: SessionProviderDeps;
}): JSX.Element {
  // Expiry is handled by ONE timer armed at `expiresAt` (deterministic under fake timers, and it
  // re-renders consumers the moment the bearer dies); `locked` is still derived through
  // `isSessionFresh` so a not-yet-fired timer can never render an expired session as unlocked.
  const [storedSession, setStoredSession] = useState<Session | null>(() => readStoredSession());
  const [mode, setMode] = useState<AuthMode | null>(null);
  const sessionRef = useRef<Session | null>(storedSession);
  const modeRef = useRef<AuthMode | null>(null);
  const modeRequest = useRef<Promise<AuthContext> | null>(null);
  const fetchAuthContextImpl = deps?.fetchAuthContext ?? realFetchAuthContext;
  const fetchAuthContextRef = useRef(fetchAuthContextImpl);
  fetchAuthContextRef.current = fetchAuthContextImpl;

  const applySession = useCallback((next: Session | null): void => {
    sessionRef.current = next;
    setStoredSession(next);
  }, []);

  // StrictMode replays effects in development. Keep the request in a ref so one provider mount still
  // performs exactly one discovery call; any failure selects desktop, the fail-closed no-session path.
  useEffect(() => {
    let alive = true;
    const request = modeRequest.current
      ?? Promise.resolve().then(() => fetchAuthContextRef.current());
    modeRequest.current = request;
    void request
      .then((context) => {
        if (!alive) return;
        modeRef.current = context.mode;
        setMode(context.mode);
      })
      .catch(() => {
        if (!alive) return;
        modeRef.current = 'win32-desktop';
        setMode('win32-desktop');
      });
    return () => { alive = false; };
  }, []);

  // A governed 401 clears tab storage and raises this signal; drop the in-memory copy so every
  // consumer re-locks at once and the next action runs a fresh ceremony.
  useEffect(() => {
    const invalidate = (): void => applySession(null);
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidate);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidate);
  }, [applySession]);

  useEffect(() => {
    if (mode !== 'win32-desktop' || !storedSession) return;
    const timer = setTimeout(() => applySession(null), Math.max(0, storedSession.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [mode, storedSession, applySession]);

  // T2 removed the sign-in ceremony this used to run (join) for a locked win32-desktop session. There
  // is no session-minting path left in that mode, so a locked desktop session now fails closed to
  // `null` rather than prompting anything — the same outward result a refused/cancelled ceremony
  // always produced, just reached without a network round trip.
  const requireSession = useCallback(async (): Promise<Session | null> => {
    if (modeRef.current === null) return null;
    if (modeRef.current === 'tailnet') return TAILNET_AMBIENT_SESSION;
    if (isSessionFresh(sessionRef.current)) return sessionRef.current;
    clearStoredSession();
    applySession(null);
    return null;
  }, [applySession]);

  const session = mode === 'tailnet'
    ? TAILNET_AMBIENT_SESSION
    : mode === 'win32-desktop'
      ? storedSession
      : null;
  const locked = mode === null
    ? true
    : mode === 'tailnet'
      ? false
      : !isSessionFresh(storedSession);

  const value = useMemo<SessionContextValue>(
    () => ({ mode, session, locked, requireSession }),
    [mode, session, locked, requireSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a <SessionProvider>');
  return value;
}

/**
 * The same context, but `null` instead of a throw when there is no provider above.
 *
 * For components that are EMBEDDED inside presentational surfaces which are legitimately rendered
 * standalone (an agent detail rendered from a literal fixture, with no app shell around it). Such a
 * component must degrade to its locked state, not crash the surface that contains it. Everything that
 * is only ever mounted inside the app keeps using {@link useSession}, so a genuinely missing provider
 * there still fails loudly.
 */
export function useOptionalSession(): SessionContextValue | null {
  return useContext(SessionContext);
}

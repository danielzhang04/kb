/**
 * The dashboard's ONE unlock: a single React context holding the WebAuthn session bearer minted by
 * `authClient.signIn`. Every surface that needs a governed token calls `useSession().requireSession()`
 * instead of threading `sessionToken`/`onRequestSession` props and owning its own unlock button.
 *
 *   - The token lives here (memory) + tab-scoped `sessionStorage` via authClient — nowhere else. This
 *     module does not touch the network or the WebAuthn API itself; authClient stays the only minter.
 *   - ONE in-flight ceremony: concurrent `requireSession()` calls from different components share a
 *     single `signIn` promise, so six surfaces can never mint six sessions (or stack six prompts).
 *   - Fail-closed: a refused/cancelled/failed ceremony resolves `null` (never throws, never fabricates),
 *     the stored copy is cleared, and every consumer re-locks together — on expiry and on the
 *     `SESSION_INVALIDATED_EVENT` a governed 401 raises.
 *
 * `signIn` is injected (same DI seam as `authClient`/`webauthnClient`) so this is testable with no
 * real passkey.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import {
  clearStoredSession,
  isSessionFresh,
  persistSession,
  readStoredSession,
  SESSION_INVALIDATED_EVENT,
  signIn as realSignIn,
  type Session,
} from './authClient';

export interface SessionContextValue {
  /** The live bearer, or null when locked. */
  session: Session | null;
  /** `!isSessionFresh(session)` — the single source of truth for "show the locked state". */
  locked: boolean;
  /** Fresh session → returned as-is; locked → run (or join) the passkey ceremony. Null on refusal. */
  requireSession(): Promise<Session | null>;
}

export interface SessionProviderDeps {
  /** The passkey ceremony. Tests inject a fake; production uses `authClient.signIn`. */
  signIn?: () => Promise<Session>;
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
  const [session, setSessionState] = useState<Session | null>(() => readStoredSession());
  const sessionRef = useRef<Session | null>(session);
  const inFlight = useRef<Promise<Session | null> | null>(null);
  const signInImpl = deps?.signIn ?? realSignIn;
  const signInRef = useRef(signInImpl);
  signInRef.current = signInImpl;

  const applySession = useCallback((next: Session | null): void => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  // A governed 401 clears tab storage and raises this signal; drop the in-memory copy so every
  // consumer re-locks at once and the next action runs a fresh ceremony.
  useEffect(() => {
    const invalidate = (): void => applySession(null);
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidate);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidate);
  }, [applySession]);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => applySession(null), Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session, applySession]);

  const requireSession = useCallback(async (): Promise<Session | null> => {
    if (isSessionFresh(sessionRef.current)) return sessionRef.current;
    if (inFlight.current) return inFlight.current;

    clearStoredSession();
    applySession(null);
    const attempt = signInRef
      .current()
      .then((next): Session | null => {
        persistSession(next);
        applySession(next);
        return next;
      })
      .catch((): null => {
        clearStoredSession();
        applySession(null);
        return null;
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = attempt;
    return attempt;
  }, [applySession]);

  const value = useMemo<SessionContextValue>(
    () => ({ session, locked: !isSessionFresh(session), requireSession }),
    [session, requireSession],
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

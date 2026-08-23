import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';

export const BROWSER_SESSION_COOKIE_NAME = 'kb_browser_session';
export const BROWSER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const BROWSER_SESSION_RENEWAL_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const BROWSER_SESSION_MINT_ATTEMPTS = 8;

const BROWSER_SESSION_REF_RE = /^[A-Za-z0-9_-]{43}$/;

export type BrowserSessionRefLookup = { expiresAt: string };
/**
 * The only thing a ref store learns about a presented cookie: whether one stored ref equals it.
 * The raw presented token never crosses this seam, so no store can key a map or an index by it.
 */
export type BrowserSessionRefMatcher = (storedRef: string) => boolean;
export type StoredBrowserSessionRef = { ref: string; expiresAt: string };
export type BrowserSessionCookieValue = {
  browserSessionRef: string;
  cookie: string | null;
  expiresAt: string;
  renewed?: boolean;
};
export type BrowserSessionRefResult =
  | { ok: true; value: BrowserSessionCookieValue }
  | { ok: false; status: 401 | 503; code: 'browser-session-ref-invalid'
      | 'browser-session-ref-expired' | 'browser-session-ref-unavailable' };

export interface BrowserSessionRefManagerDeps {
  now?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
  /** Must atomically reserve across live and persisted controller refs. */
  reserve(ref: string, expiresAt: string): Promise<boolean>;
  /**
   * Persistence enumerates its stored refs and applies `matchesPresentedRef` to each. It is handed
   * the comparator only — never the presented token — so a lookup-by-token implementation cannot
   * even be written against this type. `findStoredBrowserSessionRef` is the canonical body.
   */
  verify?: (matchesPresentedRef: BrowserSessionRefMatcher) => Promise<BrowserSessionRefLookup | null>;
  renew?: (ref: string, expiresAt: string) => Promise<boolean>;
}

/** Canonical `verify` body: a constant-time scan of an iterator of stored refs. */
export async function findStoredBrowserSessionRef(
  matchesPresentedRef: BrowserSessionRefMatcher,
  storedRefs: Iterable<StoredBrowserSessionRef> | AsyncIterable<StoredBrowserSessionRef>,
): Promise<BrowserSessionRefLookup | null> {
  let found: BrowserSessionRefLookup | null = null;
  for await (const stored of storedRefs as AsyncIterable<StoredBrowserSessionRef>) {
    if (matchesPresentedRef(stored.ref) && found === null) found = { expiresAt: stored.expiresAt };
  }
  return found;
}

function constantTimeBrowserRefEqual(presentedRef: string, storedRef: string): boolean {
  const presentedDigest = createHash('sha256').update(presentedRef, 'utf8').digest();
  const storedDigest = createHash('sha256').update(storedRef, 'utf8').digest();
  return timingSafeEqual(presentedDigest, storedDigest);
}

function expiresAt(now: Date): string {
  return new Date(now.getTime() + BROWSER_SESSION_MAX_AGE_SECONDS * 1_000).toISOString();
}

function serializeCookie(ref: string): string {
  return `${BROWSER_SESSION_COOKIE_NAME}=${ref}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${BROWSER_SESSION_MAX_AGE_SECONDS}`;
}

export function isBrowserSessionRef(value: unknown): value is string {
  if (typeof value !== 'string' || !BROWSER_SESSION_REF_RE.test(value)) return false;
  try {
    return Buffer.from(value, 'base64url').byteLength === 32
      && Buffer.from(value, 'base64url').toString('base64url') === value;
  } catch {
    return false;
  }
}

/** Parse Cookie request syntax. Duplicate controller cookies fail closed. */
export function parseBrowserSessionCookie(cookieHeader: string | undefined): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return null;
  const matches: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== BROWSER_SESSION_COOKIE_NAME) continue;
    matches.push(part.slice(separator + 1).trim());
  }
  return matches.length === 1 && isBrowserSessionRef(matches[0]) ? matches[0] : null;
}

export const parseBrowserSessionRefCookie = parseBrowserSessionCookie;

export function createBrowserSessionRefManager(deps: BrowserSessionRefManagerDeps) {
  const now = deps.now ?? (() => new Date());
  const randomBytes = deps.randomBytes ?? nodeRandomBytes;

  return {
    async mint(): Promise<BrowserSessionRefResult> {
      const issuedAt = now();
      const expiry = expiresAt(issuedAt);
      for (let attempt = 0; attempt < BROWSER_SESSION_MINT_ATTEMPTS; attempt += 1) {
        const bytes = randomBytes(32);
        if (bytes.byteLength !== 32) {
          return { ok: false, status: 503, code: 'browser-session-ref-unavailable' };
        }
        const ref = Buffer.from(bytes).toString('base64url');
        if (!isBrowserSessionRef(ref)) continue;
        if (await deps.reserve(ref, expiry)) {
          return {
            ok: true,
            value: { browserSessionRef: ref, cookie: serializeCookie(ref), expiresAt: expiry },
          };
        }
      }
      return { ok: false, status: 503, code: 'browser-session-ref-unavailable' };
    },

    async renew(cookieHeader: string | undefined): Promise<BrowserSessionRefResult> {
      // A missing store is a misconfiguration, not a bad credential: it must never log an
      // operator out (D6). Only the presented cookie itself can produce a 401.
      if (deps.verify === undefined) {
        return { ok: false, status: 503, code: 'browser-session-ref-unavailable' };
      }
      const ref = parseBrowserSessionCookie(cookieHeader);
      if (ref === null) return { ok: false, status: 401, code: 'browser-session-ref-invalid' };
      const existing = await deps.verify((storedRef) => constantTimeBrowserRefEqual(ref, storedRef));
      if (existing === null) return { ok: false, status: 401, code: 'browser-session-ref-invalid' };
      const currentTime = now();
      const expiryTime = Date.parse(existing.expiresAt);
      if (!Number.isFinite(expiryTime) || new Date(expiryTime).toISOString() !== existing.expiresAt) {
        return { ok: false, status: 401, code: 'browser-session-ref-invalid' };
      }
      if (expiryTime <= currentTime.getTime()) {
        return { ok: false, status: 401, code: 'browser-session-ref-expired' };
      }
      const remainingSeconds = (expiryTime - currentTime.getTime()) / 1_000;
      if (remainingSeconds >= BROWSER_SESSION_RENEWAL_WINDOW_SECONDS) {
        return {
          ok: true,
          value: { browserSessionRef: ref, cookie: null, expiresAt: existing.expiresAt, renewed: false },
        };
      }
      const expiry = expiresAt(currentTime);
      // The credential is already proven valid here; a refused write is storage, not authn (D6).
      if (deps.renew === undefined || !(await deps.renew(ref, expiry))) {
        return { ok: false, status: 503, code: 'browser-session-ref-unavailable' };
      }
      return {
        ok: true,
        value: { browserSessionRef: ref, cookie: serializeCookie(ref), expiresAt: expiry, renewed: true },
      };
    },
  };
}

export const createBrowserSessionService = createBrowserSessionRefManager;

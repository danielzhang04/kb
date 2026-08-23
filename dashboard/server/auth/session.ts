/**
 * D2.1 — short-TTL session token minted at a successful WebAuthn assertion, never at registration
 * and never speculatively (`mintSessionFromVerifiedAssertion` throws if `verified !== true`).
 *
 * The token is a signed (HMAC-SHA256) bearer: `base64url(JSON(claims)) + '.' + base64url(hmac)`.
 * It is deliberately stateless (no server-side session map) so verification needs only the shared
 * secret + the token itself — consumed by every write endpoint in later D2 tasks without a shared
 * in-memory store across processes. Losing all sessions on a daemon restart (when no
 * `DASHBOARD_SESSION_SECRET` is configured, see `resolveSessionSecret`) is an acceptable trade-off
 * for a short-TTL token: the alternative, a fixed/guessable fallback secret, is not.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OperatorAuth } from './operator.ts';
import {
  createBrowserSessionRefManager,
  findStoredBrowserSessionRef,
} from './browserSessionRef.ts';
import type { StoredBrowserSessionRef } from './browserSessionRef.ts';
import type { BrowserPrincipal } from '../pty/contracts.ts';
import type { SessionPersistence } from '../pty/sessionPersistence.ts';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes — short-TTL per design (design §3.6).

export interface SessionClaims {
  /** Subject — the authenticated user id. */
  sub: string;
  /** Issued-at, epoch ms. */
  iat: number;
  /** Expiry, epoch ms. */
  exp: number;
  /** Random per-token id — defeats token-guessing, gives a stable log-friendly identifier. */
  jti: string;
}

export interface SessionConfig {
  /** HMAC signing secret. Use `resolveSessionSecret()` to source it from the environment. */
  secret: Buffer;
  /** Session lifetime in ms. Defaults to `resolveSessionTtlMs()`'s result (5 min unless configured). */
  ttlMs?: number;
  /** Injectable clock — defaults to `Date.now`. Tests advance this instead of using real timers. */
  now?: () => number;
  /**
   * The deployment auth-mode seam (see `auth/mode.ts`). ABSENT in `win32-desktop` mode, which is the
   * default — `requireSession` then verifies a passkey-minted bearer exactly as it always has.
   *
   * PRESENT in `tailnet` mode, where the request's transport is the credential: `requireSession` asks
   * this authenticator instead, and mints a session for the operator it proves. It lives on this object
   * because `ctx.sessionConfig` is already the one value every `requireSession` call site receives, so
   * the mode reaches all of them without a single route edit. `mintSession`/`verifySession` ignore it.
   */
  operatorAuth?: OperatorAuth;
}

export type SessionCheck =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

/**
 * The `kind` tag of an internal service caller — a descriptive, log-friendly label. It is deliberately NOT
 * the security discriminant: a plain JSON object can trivially carry this string, so identity is proven by
 * an unforgeable runtime brand (the module-private registry below), never by this literal.
 */
export const INTERNAL_SERVICE_CALLER_KIND = 'internal-service-caller';

/**
 * A sanctioned internal service caller — an in-process principal, NOT a bearer token. Where a WebAuthn
 * session token is minted only after a human passkey assertion and is replayable by anyone who holds the
 * string, this is a branded object that never crosses a wire, is never persisted or logged, and cannot be
 * forged by an HTTP client. It authorizes a governed launch as `subject` in lieu of a token. It is ONLY
 * constructed by the authorized activation path (`control/activation.ts#createInternalServiceCaller`,
 * which requires the env override or a fresh latch unlock grant); no HTTP route ever constructs or forwards one.
 */
export interface InternalServiceCaller {
  readonly kind: typeof INTERNAL_SERVICE_CALLER_KIND;
  readonly subject: string;
}

/**
 * Module-private brand registry. Identity is UNFORGEABLE BY CONSTRUCTION: the only way a value becomes an
 * internal service caller is to be minted by `brandInternalServiceCaller` below — the single call
 * `control/activation.ts#createInternalServiceCaller` makes behind its activation gate. Membership in a
 * WeakSet is not expressible in JSON, so a plain object shaped `{ kind, subject }` smuggled through any
 * present OR future HTTP route can never be in this set, and thus can never satisfy `isInternalServiceCaller`.
 * The prior guard rested on a string discriminant plus the convention that no route threads request data
 * into `internalService`; branding removes that reliance entirely — one careless future edit can no longer
 * open a bypass.
 */
const internalServiceCallers = new WeakSet<InternalServiceCaller>();

/**
 * Mint the one and only kind of value that satisfies `isInternalServiceCaller`. This is the brand primitive:
 * call it ONLY from the activation-gated `control/activation.ts#createInternalServiceCaller`, which is the
 * sole sanctioned producer and requires the env override or a fresh latch unlock grant. Throws on an empty
 * subject, so a branded-but-identity-less caller can never exist.
 */
export function brandInternalServiceCaller(subject: string): InternalServiceCaller {
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new Error('an internal service caller requires a non-empty subject');
  }
  const caller: InternalServiceCaller = { kind: INTERNAL_SERVICE_CALLER_KIND, subject };
  internalServiceCallers.add(caller);
  return caller;
}

/**
 * True only for a value minted by `brandInternalServiceCaller` (i.e. by the activation-gated
 * `createInternalServiceCaller`). Used as the auth-gate bypass key: identity is the unforgeable WeakSet
 * brand, never a shape or string match — so no object an HTTP body could carry, however well-formed, can pass.
 */
export function isInternalServiceCaller(value: unknown): value is InternalServiceCaller {
  return typeof value === 'object' && value !== null
    && internalServiceCallers.has(value as InternalServiceCaller);
}

function b64urlEncode(input: Buffer): string {
  return input.toString('base64url');
}

function sign(payload: string, secret: Buffer): string {
  return b64urlEncode(createHmac('sha256', secret).update(payload).digest());
}

/**
 * Resolve the session-signing secret from the environment. Fail-safe-but-not-fail-open: with no
 * `DASHBOARD_SESSION_SECRET` configured, a random secret is generated for this process's lifetime
 * (never a fixed/guessable default) — every session minted before a restart is invalidated by it,
 * which is acceptable for a token whose whole design point is a short TTL.
 */
export function resolveSessionSecret(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  const raw = env.DASHBOARD_SESSION_SECRET?.trim();
  if (raw) return Buffer.from(raw, 'utf-8');
  return randomBytes(32);
}

/** Resolve the session TTL from the environment, defaulting to 5 minutes. */
export function resolveSessionTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DASHBOARD_SESSION_TTL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
}

/** Mint a signed short-TTL session token for `userId`. Prefer `mintSessionFromVerifiedAssertion` at
 *  the call site that follows a WebAuthn assertion — this raw form exists for that wrapper and for
 *  tests. */
export function mintSession(
  userId: string,
  config: SessionConfig,
): { token: string; claims: SessionClaims } {
  const now = config.now ?? Date.now;
  const ttlMs = config.ttlMs ?? resolveSessionTtlMs();
  const issuedAt = now();
  const claims: SessionClaims = {
    sub: userId,
    iat: issuedAt,
    exp: issuedAt + ttlMs,
    jti: b64urlEncode(randomBytes(16)),
  };
  const payload = b64urlEncode(Buffer.from(JSON.stringify(claims), 'utf-8'));
  const token = `${payload}.${sign(payload, config.secret)}`;
  return { token, claims };
}

/** Verify a session token: signature must check out AND `exp` must not have passed. */
export function verifySession(token: string, config: SessionConfig): SessionCheck {
  const now = config.now ?? Date.now;
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  const [payload, sig] = parts;
  const expectedSig = Buffer.from(sign(payload, config.secret), 'utf-8');
  const actualSig = Buffer.from(sig, 'utf-8');
  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as SessionClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof claims.exp !== 'number' || typeof claims.sub !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  if (now() >= claims.exp) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, claims };
}

/** The browser-session-ref seam the auth routes mint/renew through, and W6.4's `/api/pty` upgrade reads. */
export type BrowserSessionRefManager = ReturnType<typeof createBrowserSessionRefManager>;

export interface BrowserSessionRefStoreDeps {
  /** The v2 PTY document, when the daemon has one. Read-only here: a ref already spent as a session
   *  controller can never be re-reserved, which is the "atomically reserve across live AND persisted
   *  controller refs" half of the W3 manager's contract. Absent it, only live refs constrain a mint. */
  persistence?: SessionPersistence;
  now?: () => Date;
  /** Test seam ONLY, passed straight through to the W3 manager so a collision/exhaustion path can be
   *  driven deterministically. Production never supplies it and gets `crypto.randomBytes`. */
  randomBytes?: (size: number) => Uint8Array;
  /** One-line sink for a refusal the HTTP layer flattens to a generic 503. Injected in tests; production
   *  writes to `console.warn`. Lines are bounded, ASCII, and carry no ref, path, or exception text. */
  log?: (line: string) => void;
}

/** Upper bound on the in-process live-ref table. One operator's browsers cannot legitimately approach it;
 *  the cap exists so a mint loop (or a clock that never advances) cannot grow the map without limit. */
export const MAX_LIVE_BROWSER_SESSION_REFS = 1_024;

/**
 * The daemon's browser-session-ref table. Refs live for this process only, exactly like the HMAC secret
 * a session bearer is signed with when `DASHBOARD_SESSION_SECRET` is unset (`resolveSessionSecret`): a
 * restart invalidates them, and the browser is issued a fresh one at its next sign-in. That is the same
 * trade-off, made for the same reason — a durable ref table would be a second credential store to protect,
 * and this ref only ever names the browser that may drive a PTY, never who the operator is.
 *
 * The raw presented cookie never reaches the store: `verify` is handed a comparator (W3's constant-time
 * `findStoredBrowserSessionRef` body), so no lookup-by-token index can exist here.
 */
export function createBrowserSessionRefStore(deps: BrowserSessionRefStoreDeps = {}): BrowserSessionRefManager {
  const live = new Map<string, string>();
  const now = deps.now ?? (() => new Date());
  const write = deps.log ?? ((line: string) => { console.warn(line); });
  const alreadyLogged = new Set<string>();
  /** A refusal the caller only ever sees as a generic 503 is reported here EXACTLY once per reason, so an
   *  unreadable (or still-v1) document that permanently disables PTY principals leaves a signal instead of
   *  vanishing — without turning a hot mint loop into a log flood. */
  const logOnce = (reason: string): void => {
    if (alreadyLogged.has(reason)) return;
    alreadyLogged.add(reason);
    write(`browser-session-ref: ${reason}`);
  };
  /** True when a persisted session record already carries this ref as its controller. */
  const spentAsController = (ref: string): boolean => {
    if (deps.persistence === undefined) return false;
    try {
      return deps.persistence.read().sessions.some((record) => record.controller?.browserSessionRef === ref);
    } catch {
      // An unreadable document cannot prove the ref is free, so the mint attempt is refused, never allowed.
      logOnce('reserve refused: the pty session document could not be read');
      return true;
    }
  };
  /** Drop every ref the stored expiry says is already dead. Unparseable expiries count as dead: a ref the
   *  table cannot date can never be verified either (`renew`/`resolve` refuse it), so keeping it only leaks. */
  const evictExpired = (atMs: number): void => {
    for (const [ref, expiresAt] of live) {
      const expiry = Date.parse(expiresAt);
      if (!Number.isFinite(expiry) || expiry <= atMs) live.delete(ref);
    }
  };
  const stored = (): StoredBrowserSessionRef[] =>
    [...live].map(([ref, expiresAt]) => ({ ref, expiresAt }));
  return createBrowserSessionRefManager({
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.randomBytes ? { randomBytes: deps.randomBytes } : {}),
    reserve: async (ref, expiresAt) => {
      // Expired refs are reclaimed first, so the cap only ever counts refs that are actually alive; a table
      // that is still full of live refs REFUSES rather than evicting one — evicting a live ref would silently
      // revoke a working browser's PTY principal, which is a worse failure than a 503 at sign-in.
      evictExpired(now().getTime());
      if (live.size >= MAX_LIVE_BROWSER_SESSION_REFS) {
        logOnce('reserve refused: the live ref table is at capacity');
        return false;
      }
      if (live.has(ref) || spentAsController(ref)) return false;
      live.set(ref, expiresAt);
      return true;
    },
    verify: (matchesPresentedRef) => findStoredBrowserSessionRef(matchesPresentedRef, stored()),
    renew: async (ref, expiresAt) => {
      if (!live.has(ref)) return false;
      live.set(ref, expiresAt);
      return true;
    },
  });
}

/**
 * The PTY principal for one authenticated request: the operator the 401 gate proved, plus the browser
 * session the `kb_browser_session` cookie names. A request without a well-formed cookie has NO principal
 * (`null`) — the caller refuses the PTY operation. There is deliberately no default, no fallback ref and
 * no operator-only principal: a shared or invented ref would let one browser drive another's shell.
 */
export async function resolveBrowserPrincipal(
  operator: string,
  cookieHeader: string | undefined,
  refs: BrowserSessionRefManager | undefined,
): Promise<BrowserPrincipal | null> {
  if (typeof operator !== 'string' || operator.length === 0) return null;
  // Syntax is NOT authority. A 43-char base64url string is trivially invented, so the ref is resolved
  // through W3's constant-time `verify` seam against the store's own table, with the stored expiry
  // enforced — an unknown, forged, or expired ref yields NO principal, exactly like an absent cookie.
  // Without a ref store there is no table to prove membership against, so there is no principal either.
  if (refs === undefined) return null;
  try {
    const resolved = await refs.resolve(cookieHeader);
    return resolved.ok ? { operator, browserSessionRef: resolved.value.browserSessionRef } : null;
  } catch {
    // A store fault is not a credential: it refuses closed and never propagates into the request path.
    return null;
  }
}

/**
 * Mint a session strictly from a positively-verified WebAuthn assertion result (see
 * `webauthn.ts#verifyAssertion`). Throws — never silently mints — when `verification.verified` is
 * not `true`, so a caller cannot accidentally wire an unchecked/failed assertion into a session.
 */
export function mintSessionFromVerifiedAssertion(
  verification: { verified: boolean },
  userId: string,
  config: SessionConfig,
): { token: string; claims: SessionClaims } {
  if (!verification.verified) {
    throw new Error('refusing to mint a session from an unverified WebAuthn assertion');
  }
  return mintSession(userId, config);
}

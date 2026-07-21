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
 * constructed by the gate-on activation path (`control/activation.ts#createInternalServiceCaller`, which
 * throws unless `DASHBOARD_EXECUTION_ACTIVATED === '1'`); no HTTP route ever constructs or forwards one.
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
 * sole sanctioned producer and throws unless `DASHBOARD_EXECUTION_ACTIVATED === '1'`. Throws on an empty
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

/**
 * U2 — shared HTTP middleware for the governed write surface. Every mutating route composes, IN THIS
 * ORDER, before the module's own gate runs:
 *
 *   1. Origin/Host guard      — `security/origin.ts#originHook` (DNS-rebinding defence, ordering law 4).
 *   2. Rate-limit + lockout   — `security/ratelimit.ts#rateLimitHook` (sliding window + escalation).
 *   3. WebAuthn session gate   — `requireSession` here, verifying the bearer via `auth/session.ts`.
 *   4. The module's own gate   — governedSave/launch/floor/spawnVibe re-verify the session and enforce
 *                                path confinement / preamble / rate-limit themselves; this middleware
 *                                NEVER replaces those — it is an earlier, coarser fail-closed layer.
 *   5. Audit row               — the route appends exactly one `audit/log.ts` row on the consequential path.
 *
 * NOTHING here reimplements a check that a gate module already owns. `requireSession` calls the exact
 * same `verifySession` the write modules call; the rate limiter and origin guard are the exact same
 * hooks the hub already uses. There is NO dev-mode flag, NO bypass, NO test backdoor: tests exercise
 * the real chain and inject only the leaf side-effect runners (git/py/spawn) the gate modules already
 * expose for their own unit tests.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifySession } from '../auth/session.ts';
import type { SessionClaims, SessionConfig } from '../auth/session.ts';
import { rateLimit, lockout, rateLimitHook } from '../security/ratelimit.ts';
import type { LockoutGuard } from '../security/ratelimit.ts';

/** Extract a `Authorization: Bearer <token>` value, or `undefined` if absent/malformed. */
export function bearerToken(req: { headers: { authorization?: string | string[] | undefined } }): string | undefined {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return undefined;
  const [scheme, ...rest] = header.split(' ');
  if (scheme.toLowerCase() !== 'bearer') return undefined;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : undefined;
}

/** Per-request stash of the verified session — set by {@link requireSession}, read by handlers. A
 *  `WeakMap` keeps it off the request object entirely (no Fastify decoration, no `any` casts, and no
 *  chance a handler reads a claim the middleware never verified). */
const verifiedByReq = new WeakMap<FastifyRequest, { token: string; claims: SessionClaims }>();

/** The verified session for `req`, or `undefined` if `requireSession` did not run / did not pass. */
export function verifiedSession(req: FastifyRequest): { token: string; claims: SessionClaims } | undefined {
  return verifiedByReq.get(req);
}

/**
 * A `preHandler` enforcing a valid WebAuthn-minted session bearer. Rejects with a calm 401 JSON error
 * for a missing/malformed/expired/bad-signature token (mirroring `verifySession`'s own reasons), BEFORE
 * any handler or gate runs. On success stashes `{ token, claims }` for the handler to pass down to the
 * gate module (which independently re-verifies — defence in depth, never trusted-by-proxy).
 *
 * Runs as a `preHandler`, so it is always AFTER the scope's `onRequest` origin + rate-limit hooks —
 * preserving the origin -> rate-limit -> session order. It is NOT applied to the auth ceremony routes
 * (which mint the very session this checks — gating them on a session would be circular) nor to the
 * read-only `GET /api/approvals` list (a pre-auth corroboration read; the ordering law shows the card
 * BEFORE any biometric step).
 */
export function requireSession(sessionConfig: SessionConfig) {
  return async function preHandlerRequireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = bearerToken(req);
    if (!token) {
      reply.code(401).send({ error: 'unauthenticated', reason: 'missing session token' });
      return;
    }
    const check = verifySession(token, sessionConfig);
    if (!check.ok) {
      reply.code(401).send({ error: 'unauthenticated', reason: check.reason });
      return;
    }
    verifiedByReq.set(req, { token, claims: check.claims });
  };
}

/**
 * The rate-limit key for a request. Keyed on PEER IDENTITY (the connection remote address) ONLY — never
 * on client-supplied input. This hook runs BEFORE session verification, so the bearer token here is
 * unverified and attacker-chosen: keying on it let a client mint a fresh throttle/lockout bucket per
 * request simply by rotating a garbage token, evading the limiter entirely — including on the
 * unauthenticated /api/auth/* ceremony routes (finding: pre-session rate-limit keyed on unverified
 * bearer). `req.ip` is Fastify's peer address (the raw socket remote address, or the trusted-proxy-
 * derived client address IFF the app configures `trustProxy` — this app does not, so it is the socket).
 * The per-verified-owner limiter inside the vibe module (which correctly keys on the verified owner)
 * is unaffected.
 */
export function rateLimitKey(req: FastifyRequest): string {
  const peer = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  return `ip:${peer}`;
}

/** Default write-surface limiter: 30 mutating requests/min, locking out for 5 min after 5 consecutive
 *  throttles. A coarse anti-runaway layer over (not a replacement for) each module's own limiter. */
export function makeDefaultWriteRateGuard(): LockoutGuard {
  return lockout(rateLimit({ limit: 30, windowMs: 60_000 }), { threshold: 5, lockoutMs: 5 * 60_000 });
}

/**
 * Default READ limiter, sized for a real operator UI rather than for a mutation burst.
 *
 * The governed scope fronts every polled GET the dashboard makes (control runs, execution posture, the
 * human inbox, workflows). Metering those through the 30/min WRITE budget meant ordinary polling on a
 * real state root exhausted the window in seconds, escalated into the 5-minute lockout, and 429'd the
 * whole dashboard — the operator saw "Execution state could not be loaded. Execution remains
 * unavailable." with nothing actually wrong. Reads are idempotent and cheap, so they get their own
 * far larger budget and a short 60s lockout that a transient burst recovers from on its own.
 *
 * This is a budget split, NOT a weakening: reads remain keyed on peer IP, remain behind the origin
 * guard, and remain behind `requireSession` on every route that had it before.
 */
export function makeDefaultReadRateGuard(): LockoutGuard {
  return lockout(rateLimit({ limit: 300, windowMs: 60_000 }), { threshold: 10, lockoutMs: 60_000 });
}

/** The scope-level `onRequest` rate-limit hook, keyed by {@link rateLimitKey}. */
export function writeRateLimitHook(guard: LockoutGuard) {
  return rateLimitHook(guard, rateLimitKey);
}

/** True for the safe, idempotent methods metered against the read budget. */
function isReadMethod(method: string | undefined): boolean {
  const verb = (method ?? '').toUpperCase();
  return verb === 'GET' || verb === 'HEAD';
}

/**
 * The scope-level `onRequest` rate-limit hook, dispatching by METHOD to one of two independent budgets:
 * GET/HEAD consume `readGuard`, every other method consumes `writeGuard`. The buckets are separate
 * objects, so a read storm can never spend the write budget (or trip its lockout) and vice versa —
 * exactly the coupling that took the live dashboard down.
 *
 * Both budgets keep the same peer-IP key ({@link rateLimitKey}) and the same position in the chain, so
 * the origin -> rate-limit -> session order is unchanged.
 */
export function surfaceRateLimitHook(readGuard: LockoutGuard, writeGuard: LockoutGuard) {
  const readHook = rateLimitHook(readGuard, rateLimitKey);
  const writeHook = rateLimitHook(writeGuard, rateLimitKey);
  return async function onRequestSurfaceRateLimitGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await (isReadMethod(req.method) ? readHook : writeHook)(req, reply);
  };
}

/**
 * Origin/Host validation — enforced on EVERY HTTP request and WebSocket upgrade from day one
 * (ordering law 4: network location is never a trust boundary; localhost + Tailscale Serve are
 * attack-surface reductions, not authentication). A DNS-rebinding attacker resolves an attacker
 * hostname to 127.0.0.1 so the browser connects to the local daemon; the browser then sends the
 * attacker's `Host` (and `Origin`). Validating both against a fixed allowlist defeats that: the
 * daemon only ever answers to its configured RP origin (the ts.net host) and, if explicitly
 * enrolled, a localhost dev origin.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** A minimal request shape — just the headers this check reads. */
export interface OriginRequestLike {
  headers: {
    origin?: string | string[] | undefined;
    host?: string | string[] | undefined;
    [k: string]: unknown;
  };
}

export interface OriginCheckResult {
  ok: boolean;
  /** Machine-readable reason when `ok` is false. */
  reason?: 'origin-not-allowed' | 'host-not-allowed' | 'no-allowlist';
}

/** An allowlist source: a fixed array (read live, so post-registration mutation is honored) or a thunk. */
export type AllowedOrigins = string[] | (() => string[]);

/** Resolve an allowlist source to a concrete list at call time. */
export function resolveList(allowed: AllowedOrigins): string[] {
  return typeof allowed === 'function' ? allowed() : allowed;
}

/** Canonicalize an origin string to its URL origin form (e.g. strips a trailing slash / path). */
function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** The host:port authority of an origin string. */
function originHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Validate a request's `Origin` and `Host` against the allowlist.
 *
 * Rules (fail-closed):
 * - An empty allowlist rejects everything.
 * - If an `Origin` header is present, it MUST canonically match an allowed origin.
 * - The `Host` header MUST match an allowed origin's authority (the DNS-rebinding guard); a missing
 *   or mismatched Host is rejected even when no Origin is sent.
 */
export function assertOrigin(req: OriginRequestLike, expectedOrigin: AllowedOrigins): OriginCheckResult {
  const list = resolveList(expectedOrigin);
  if (list.length === 0) return { ok: false, reason: 'no-allowlist' };

  const allowedOrigins = new Set<string>();
  const allowedHosts = new Set<string>();
  for (const entry of list) {
    const o = canonicalOrigin(entry);
    const h = originHost(entry);
    if (o) allowedOrigins.add(o);
    if (h) allowedHosts.add(h);
  }

  const origin = firstHeader(req.headers.origin);
  if (origin !== undefined) {
    const canon = canonicalOrigin(origin);
    if (!canon || !allowedOrigins.has(canon)) return { ok: false, reason: 'origin-not-allowed' };
  }

  const host = firstHeader(req.headers.host);
  if (host === undefined || !allowedHosts.has(host)) return { ok: false, reason: 'host-not-allowed' };

  return { ok: true };
}

/**
 * An `onRequest` hook enforcing {@link assertOrigin}. Applied to the hub scope so every served
 * data route (and the WS upgrade handshake, which runs the same lifecycle) is validated before any
 * handler — and, in later waves, before any write surface — runs.
 */
export function originHook(allowed: AllowedOrigins) {
  return async function onRequestOriginGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = assertOrigin(req, allowed);
    if (!result.ok) {
      // `connection: close` ensures the socket is torn down after the rejection — critical on a
      // refused WS upgrade, where a keep-alive socket would otherwise linger.
      await reply.header('connection', 'close').code(403).send({ error: 'forbidden', reason: result.reason });
    }
  };
}

/**
 * Register the origin guard on a Fastify instance/scope. Call this directly on the scope whose
 * routes must be guarded (NOT via `app.register`, which would encapsulate the hook away from sibling
 * routes). The allowlist is read live on each request.
 */
export function originPlugin(app: FastifyInstance, opts: { allowedOrigins: AllowedOrigins }): void {
  app.addHook('onRequest', originHook(opts.allowedOrigins));
}

/**
 * Resolve the configured allowlist from the environment. Fail-closed: empty unless a ts.net RP
 * origin is configured. The localhost dev origin is added ONLY when explicitly enrolled
 * (`DASHBOARD_DEV_ORIGIN`), per the D0.12 enrollment decision — localhost is never trusted by default.
 */
export function resolveAllowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const list: string[] = [];
  const rp = env.DASHBOARD_RP_ORIGIN?.trim();
  if (rp) list.push(rp);
  const dev = env.DASHBOARD_DEV_ORIGIN?.trim();
  if (dev) list.push(dev);
  return list;
}

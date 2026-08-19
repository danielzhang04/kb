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
import { resolveAuthMode } from '../auth/mode.ts';

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

interface AllowedHost {
  host: string;
  protocol: string;
}

/** Read the normalized authority and scheme of an allowlisted origin. */
function allowedHost(value: string): AllowedHost | null {
  try {
    const url = new URL(value);
    return url.host ? { host: url.host, protocol: url.protocol } : null;
  } catch {
    return null;
  }
}

/**
 * Parse an HTTP Host authority without canonicalizing its hostname. This deliberately accepts only
 * a bare hostname (optionally followed by a numeric port) or a bracketed IPv6 literal.
 */
function parseHost(value: string): { hostname: string; port?: string } | null {
  if (value.length === 0 || /[\s/@?#\\]/.test(value)) return null;

  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) return null;
    const hostname = value.slice(0, close + 1);
    const suffix = value.slice(close + 1);
    if (suffix === '') return { hostname };
    if (!/^:\d+$/.test(suffix)) return null;
    try {
      new URL(`http://${hostname}`);
    } catch {
      return null;
    }
    return { hostname, port: suffix.slice(1) };
  }

  const colon = value.indexOf(':');
  if (colon === -1) return { hostname: value };
  if (value.indexOf(':', colon + 1) !== -1) return null;
  const hostname = value.slice(0, colon);
  const port = value.slice(colon + 1);
  if (hostname === '' || !/^\d+$/.test(port)) return null;
  return { hostname, port };
}

/** Match a request Host exactly, except for an explicit default port for this allowed scheme. */
function matchesAllowedHost(requestHost: string, allowed: AllowedHost): boolean {
  const parsed = parseHost(requestHost);
  if (!parsed) return false;
  if (requestHost === allowed.host) return true;

  const defaultPort = allowed.protocol === 'https:' ? '443' : allowed.protocol === 'http:' ? '80' : undefined;
  return parsed.port === defaultPort && parsed.hostname === allowed.host;
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
  const allowedHosts: AllowedHost[] = [];
  for (const entry of list) {
    const o = canonicalOrigin(entry);
    const h = allowedHost(entry);
    if (o) allowedOrigins.add(o);
    if (h) allowedHosts.push(h);
  }

  const origin = firstHeader(req.headers.origin);
  if (origin !== undefined) {
    const canon = canonicalOrigin(origin);
    if (!canon || !allowedOrigins.has(canon)) return { ok: false, reason: 'origin-not-allowed' };
  }

  const host = firstHeader(req.headers.host);
  if (host === undefined || !allowedHosts.some((allowed) => matchesAllowedHost(host, allowed))) {
    return { ok: false, reason: 'host-not-allowed' };
  }

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
 * Resolve the configured allowlist from the environment. Fail-closed: empty unless this deployment's
 * public origin is configured.
 *
 * Which variable names the origin follows the auth mode (`auth/mode.ts`):
 * - `win32-desktop` uses the WebAuthn RP origin, plus the localhost dev origin ONLY when explicitly
 *   enrolled (`DASHBOARD_DEV_ORIGIN`, D0.12) — localhost is never trusted by default.
 * - `tailnet` derives it from the `tailscale serve` hostname and NOTHING else. It has no relying party
 *   (a stale `DASHBOARD_RP_ORIGIN` must never quietly widen the allowlist), and — critically — no dev
 *   origin: authentication there is AMBIENT (no cookie, no token), so an allowlisted dev origin would
 *   hand full operator authority to any page served from it.
 *
 * This guard is load-bearing in `tailnet` mode in a way it was not before: it is the only thing standing
 * between a hostile page in the operator's browser and the API. See the design spec's trust boundary.
 */
export function resolveAllowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  if (resolveAuthMode(env) === 'tailnet') {
    const host = env.DASHBOARD_TAILNET_HOST?.trim();
    return host ? [`https://${host}`] : [];
  }
  const list: string[] = [];
  const rp = env.DASHBOARD_RP_ORIGIN?.trim();
  if (rp) list.push(rp);
  const dev = env.DASHBOARD_DEV_ORIGIN?.trim();
  if (dev) list.push(dev);
  return list;
}

/** Loopback fallback when no public origin is configured (dev/test). */
const LOOPBACK_ORIGIN_FALLBACK = 'http://127.0.0.1:5317';

/**
 * The daemon's own public origin — the base a spend-grant approval link or any other self-referential
 * URL is built on. MODE-AWARE, and deliberately the SAME derivation as {@link resolveAllowedOrigins}:
 * the serve host in `tailnet` mode, the RP (or enrolled dev) origin in `win32-desktop`. Before this was
 * mode-aware, tailnet mode — where `DASHBOARD_RP_ORIGIN` is banned — fell through to the loopback
 * fallback, so every spend-grant approval link pointed at the wrong host:port and silently disabled a
 * governance gate.
 */
export function resolveDaemonPublicOrigin(env: Record<string, string | undefined> = process.env): string {
  return resolveAllowedOrigins(env)[0] ?? LOOPBACK_ORIGIN_FALLBACK;
}

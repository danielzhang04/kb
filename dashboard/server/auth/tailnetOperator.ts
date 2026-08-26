/**
 * `tailnet` mode's operator authenticator — the whole trust boundary of the always-on deployment.
 *
 * Three independent locks, all fail-closed, evaluated per request:
 *
 *  1. PEER OWNER (`peerUid.ts`). The connection's loopback peer must be owned by the trusted proxy's UID
 *     (root, i.e. `tailscaled`). This is the lock a local forger cannot pick: any process can open
 *     127.0.0.1:4317 and write whatever `Tailscale-User-*` headers it likes, but it cannot change who
 *     owns its own socket. Governed workers run as the dashboard's own unprivileged user and are denied.
 *
 *  2. TAILNET IDENTITY. A well-formed `Tailscale-User-Login` must be present. This is NOT decoration:
 *     `tailscale serve` attaches identity headers to tailnet requests but NOT to Funnel requests, so
 *     without this lock, enabling Funnel would authenticate anonymous internet clients as the operator
 *     (they too would arrive through root-owned tailscaled). Requiring the header makes identity-less
 *     traffic indistinguishable from a rejection.
 *
 *  3. SAME-SITE. Tailnet auth is AMBIENT — it needs no cookie and no token, so `credentials: 'omit'` does
 *     not protect it and any page the operator's browser loads could drive the dashboard. The origin
 *     guard is the primary defence; this adds `Sec-Fetch-Site`, rejecting a present-but-cross-site value.
 *     An ABSENT header is allowed on purpose: WebSocket handshakes and non-browser tailnet clients (curl,
 *     the operator's phone) do not send it and must keep working.
 *
 * Empirically verified against the live VM on 2026-08-18: serve does inject the identity headers, and the
 * peer of a serve-proxied connection is uid 0 while the daemon itself is uid 999.
 */
import { readProcNetTables, resolvePeerUid } from './peerUid.ts';
import { headerFirstValue } from '../shared/decode.ts';
import { OPERATOR_SUBJECT } from './mode.ts';
import type { TailnetConfig } from './mode.ts';
import type { OperatorAuth, OperatorAuthResult, OperatorRequestLike } from './operator.ts';

/** Generous upper bound on a login; longer is malformed, not merely unusual. */
const MAX_LOGIN_LENGTH = 320;
/** `Sec-Fetch-Site` values that are not a cross-site drive-by. Absent is also accepted (see header doc). */
const SAME_SITE = new Set(['same-origin', 'none']);

export interface TailnetOperatorDeps {
  /** Injected in tests; production reads the real `/proc/net/tcp{,6}`. */
  readTables?: () => readonly string[];
}

function header(req: OperatorRequestLike, name: string): string | undefined {
  return headerFirstValue(req.headers[name]);
}

export function createTailnetOperatorAuth(
  config: TailnetConfig,
  deps: TailnetOperatorDeps = {},
): OperatorAuth {
  const readTables = deps.readTables ?? (() => readProcNetTables());
  return {
    authenticate(req: OperatorRequestLike): OperatorAuthResult {
      // Lock 3 first: it is a pure header check and denies the cheapest attack without touching /proc.
      const site = header(req, 'sec-fetch-site');
      if (site !== undefined && !SAME_SITE.has(site)) return { ok: false, reason: 'cross-site' };

      // Lock 1 — the peer's OS owner, proven against the connection's FULL 4-tuple (see peerUid.ts).
      // Any fail-closed peer result (non-loopback, no matching row, ambiguous) maps to `untrusted-peer`.
      const peer = resolvePeerUid(req, readTables);
      if (!peer.ok || peer.uid !== config.proxyUid) return { ok: false, reason: 'untrusted-peer' };

      // Lock 2 — the proxy-injected tailnet identity.
      const login = header(req, 'tailscale-user-login')?.trim() ?? '';
      if (login.length === 0 || login.length > MAX_LOGIN_LENGTH || /\s/.test(login)) {
        return { ok: false, reason: 'no-tailnet-identity' };
      }
      // The operator login is REQUIRED (see mode.ts): the proxy-supplied identity must equal exactly it.
      if (login !== config.operatorLogin) {
        return { ok: false, reason: 'identity-not-allowed' };
      }

      const name = header(req, 'tailscale-user-name')?.trim();
      return {
        ok: true,
        subject: OPERATOR_SUBJECT,
        attribution: { login, ...(name ? { name } : {}) },
      };
    },
  };
}

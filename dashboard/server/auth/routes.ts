/**
 * U2 — the auth routes: boot-mode discovery, and the browser-session-ref mint/renew route. In BOTH
 * deployment modes the transport itself is the credential, so there is no sign-in ceremony to run —
 * only the PROOF differs, and with it where the mint route sits. `tailnet` keeps it inside the session
 * gate (`registerBrowserSessionRoute`), where the ambient operator check has already run;
 * `win32-desktop` registers it outside that gate (`registerDesktopSessionRoute`), because there it is
 * the route that mints the session. Either way it stays behind the scope's Origin/Host guard and
 * rate-limiter.
 */
import type { FastifyInstance } from 'fastify';
import { mintSession } from './session.ts';
import { bindAttribution, resetAttribution, OPERATOR_SUBJECT } from './operator.ts';
import { ACTOR_HEADER, parseActor } from '../authority/actor.ts';
import {
  BROWSER_SESSION_COOKIE_NAME,
  BROWSER_SESSION_EVICTION_COOKIE,
  parseBrowserSessionCookie,
} from './browserSessionRef.ts';
import type { SurfaceContext } from '../http/context.ts';

/** The closed set of things that can happen to a browser-session ref on an authenticated request. */
export type BrowserSessionCookieOutcome =
  | { kind: 'minted'; cookie: string }
  | { kind: 'renewed'; cookie: string }
  /** A live ref outside its 7-day renewal window: the browser correctly keeps the cookie it already has. */
  | { kind: 'unchanged' }
  /** The request PRESENTED a ref and it did not check out (unknown, expired, malformed, duplicated). */
  | { kind: 'refused' }
  /** The ref store could not answer. Never a statement about the credential. */
  | { kind: 'unavailable' };

/** How many `kb_browser_session` cookies the request carries, counted with the SAME parser the value is
 *  read with. Non-zero-but-unparseable (malformed value, or two cookies) is a PRESENTED ref that failed —
 *  never "no cookie", which would mint over it. */
function browserSessionCookieCount(cookieHeader: string | undefined): number {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return 0;
  let count = 0;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === BROWSER_SESSION_COOKIE_NAME) count += 1;
  }
  return count;
}

/**
 * Renew the presented browser-session ref, or mint one for a browser that has none. Called ONLY behind an
 * authenticated gate: an unauthenticated caller can never cause a ref to be minted or renewed.
 *
 * A presented-but-refused ref is REFUSED, never re-minted. Plan L235: "malformed/expired values never mint
 * implicitly". The old fall-through meant a browser presenting a forged 43-char string was handed a real
 * ref, which made the whole ref table decorative on the mint path.
 */
async function resolveBrowserSessionCookie(
  ctx: SurfaceContext,
  cookieHeader: string | undefined,
): Promise<BrowserSessionCookieOutcome> {
  const refs = ctx.browserSessionRefs;
  if (refs === undefined) return { kind: 'unavailable' };
  if (browserSessionCookieCount(cookieHeader) > 0) {
    if (parseBrowserSessionCookie(cookieHeader) === null) return { kind: 'refused' };
    const renewed = await refs.renew(cookieHeader);
    if (renewed.ok) {
      return renewed.value.cookie === null ? { kind: 'unchanged' } : { kind: 'renewed', cookie: renewed.value.cookie };
    }
    return renewed.status === 503 ? { kind: 'unavailable' } : { kind: 'refused' };
  }
  const minted = await refs.mint();
  return minted.ok && minted.value.cookie !== null ? { kind: 'minted', cookie: minted.value.cookie } : { kind: 'unavailable' };
}

/**
 * `POST /api/auth/browser-session` (plan L235 + route matrix). The ONLY way the always-on tailnet
 * deployment ever obtains a controller cookie: tailnet auth is ambient, so there is no sign-in ceremony
 * to run there. Registered INSIDE the session-gated scope, so its authorization chain is: scope
 * Origin/Host guard -> rate limiter -> `requireSession`, which in tailnet mode is the peer-uid +
 * identity-header + same-site operator gate and in win32-desktop mode is the session bearer. Either way
 * an anonymous caller reaches no ref.
 */
export function registerBrowserSessionRoute(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.post('/api/auth/browser-session', async (req, reply) => {
    const outcome = await resolveBrowserSessionCookie(ctx, req.headers.cookie);
    switch (outcome.kind) {
      case 'minted':
      case 'renewed':
        reply.header('Set-Cookie', [outcome.cookie]);
        return reply.code(204).send();
      case 'unchanged':
        return reply.code(204).send();
      case 'refused':
        // Still 401, still no ref: a refused ref is never replaced behind the browser's back. What IS
        // sent is the value-less `Max-Age=0` eviction cookie, which can only DELETE the dead ref this
        // request presented. The client is told to "drop the dead cookie first" and physically cannot —
        // `kb_browser_session` is HttpOnly, so no script may clear it — which left every browser holding
        // a ref the daemon had forgotten (a restart empties the store) permanently stuck: 401 here, 428
        // at `/api/pty`, across reloads, with no user-reachable recovery. Expiring is not minting: this
        // header carries no ref, so the response cannot upgrade a refused ref into a valid one. The
        // browser's NEXT call presents nothing and takes the ordinary mint path — exactly the sequence
        // plan L235 prescribes. A 503 (`default` below) still sends nothing: a store that could not
        // answer has said nothing about the ref, and deleting a possibly-live credential on a storage
        // fault would be the D6 mistake of logging an operator out over a read failure.
        reply.header('Set-Cookie', [BROWSER_SESSION_EVICTION_COOKIE]);
        return reply.code(401).send({ error: 'browser-session-ref-invalid' });
      default:
        return reply.code(503).send({ error: 'browser-session-ref-unavailable' });
    }
  });
}

/**
 * BLOCKER-2 — `POST /api/auth/browser-session` as `win32-desktop` mode registers it: OUTSIDE the session
 * gate, because it is the route that MINTS the session. T2's removal of the browser sign-in ceremony
 * took the only minting path that mode had, leaving `requireSession` to 401 every governed request of
 * Daniel's always-on local daemon (`dashboard/pm2.config.cjs`) — a fail-closed brick, not a hole.
 *
 * Its authorization is the transport, exactly as in tailnet mode — only the proof differs, because the
 * transport differs. Tailnet proves "this connection came through root-owned `tailscaled`" out of
 * `/proc/net/tcp`; the desktop proves "this connection came from a process on this machine owned by the
 * SAME Windows account as this daemon" out of `GetExtendedTcpTable` + the peer's token SID
 * (`win32DesktopPeer.ts`). Both are facts about the socket that no header, cookie or body can forge.
 * The chain is therefore: scope Origin/Host guard -> rate limiter -> peer-owner proof. An ABSENT proof
 * (`ctx.desktopPeer` unset, e.g. off win32) refuses everything: a mode whose proof cannot run has no
 * mint path at all.
 *
 * Deliberately, the SESSION does not depend on the PTY ref table: a ref store that cannot answer still
 * yields a token (with no cookie), because a browser-session ref decides who may drive a terminal, never
 * who the operator is. The one exception is a ref the browser PRESENTED and the daemon refused — that
 * keeps the existing 401 + eviction-cookie answer, so the client's single retry presents nothing, mints
 * a clean ref, and gets its session on the second call.
 */
export function registerDesktopSessionRoute(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.post('/api/auth/browser-session', async (req, reply) => {
    // This route runs OUTSIDE `requireSession`, so it is its own `resolveSession`: clear any attribution
    // a keep-alive-shared async context carries before binding this request's own.
    resetAttribution();
    const actor = parseActor(req.headers[ACTOR_HEADER] as string | string[] | undefined);
    const peer = ctx.desktopPeer?.(req) ?? { ok: false as const, reason: 'peer-lookup-unavailable' as const };
    if (!peer.ok) return reply.code(401).send({ error: 'unauthenticated', reason: peer.reason });
    // `desktopUser` is the OS account the proof resolved — attribution, never an authority input, and
    // never a tailnet identity (there is none on this transport). `actor` stays self-asserted.
    bindAttribution({ actor, tailnetIdentity: null, desktopUser: peer.user });

    const outcome = await resolveBrowserSessionCookie(ctx, req.headers.cookie);
    if (outcome.kind === 'refused') {
      reply.header('Set-Cookie', [BROWSER_SESSION_EVICTION_COOKIE]);
      return reply.code(401).send({ error: 'browser-session-ref-invalid' });
    }
    if (outcome.kind === 'minted' || outcome.kind === 'renewed') reply.header('Set-Cookie', [outcome.cookie]);
    const { token, claims } = mintSession(OPERATOR_SUBJECT, ctx.sessionConfig);
    return reply.code(200).send({ token, expiresAt: claims.exp, browserSession: outcome.kind });
  });
}

/**
 * Register the auth routes on an ALREADY-GUARDED scope (origin + rate-limit hooks applied).
 *
 * `/api/auth/context` is the boot discovery call every client makes before anything else: it reports
 * which auth mode the daemon is running in and exposes no operator or server config. There is no
 * sign-in ceremony to run — in `tailnet` mode the transport itself is the credential.
 */
export function registerAuthRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.get('/api/auth/context', async (_req, reply) => reply.send({ mode: ctx.authMode }));
}

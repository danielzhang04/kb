/**
 * The two Run-scoped PTY routes: claim browser control of ONE attempt session, and read a bounded
 * window of an earlier attempt's raw transcript. Extracted from `control/routes.ts` verbatim (same
 * handlers, same order of checks, same tests) because they are one self-contained vertical and that
 * file is far over the size guideline.
 *
 * Both share the SAME layered authorization order: operator session, then the scoped Run read (whose
 * refusal passes through unchanged so a caller who cannot read the run never learns whether the
 * session exists), then the per-route binding/principal check.
 */
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { resolveBrowserPrincipal } from '../auth/session.ts';
import type { SurfaceContext } from '../http/context.ts';
import {
  integer,
  readScopeForSubject,
  record,
  safeQueryInteger,
  sendResult,
  SESSION_ID_RE,
  subject,
} from './routes.ts';

export function registerRunPtyRoutes(
  scope: FastifyInstance,
  ctx: SurfaceContext,
  preHandler: preHandlerHookHandler,
): void {
  /**
   * Claim browser control of ONE Run attempt's PTY session.
   *
   * Authorization is layered and ordered: the operator session first, then the scoped Run READ (an
   * operator who cannot read the run gets that read's own refusal and never learns whether the
   * session exists), then the `kb_browser_session` half of the principal. The registry then decides
   * on the exact `{operator, browserSessionRef}` pair: the same pair replays its original receipt,
   * a different pair on the same operator - or a different operator entirely - gets `not-found`,
   * never a 403 that would confirm the session is real. Both revisions are compare-and-swap.
   */
  scope.post('/api/control/runs/:runRef/pty-sessions/:sessionId/controller', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const params = req.params as { runRef: string; sessionId: string };
    const detail = ctx.controlStore.getRun(sub, params.runRef, readScopeForSubject(subject(req)));
    if (!detail.ok) return sendResult(reply, detail);
    // Defence in depth: the registry validates too, but a malformed id never needs to reach it, and the
    // answer is byte-identical to the closed `not-found` an unknown session gets.
    if (!SESSION_ID_RE.test(params.sessionId)) {
      return reply.code(404).send({ error: 'not-found', detail: 'no attempt session for this run' });
    }
    const registry = ctx.ptySessionRegistry;
    if (!registry) return reply.code(409).send({ error: 'pty-unavailable' });
    const principal = await resolveBrowserPrincipal(sub, req.headers.cookie, ctx.browserSessionRefs);
    if (!principal) return reply.code(428).send({ error: 'browser-session-required' });
    const body = record(req.body);
    const claimed = await registry.claimRunController(principal, {
      runRef: params.runRef,
      sessionId: params.sessionId,
      expectedRunVersion: integer(body.expectedRunVersion),
      expectedSessionRevision: integer(body.expectedSessionRevision),
    });
    if (!claimed.ok) {
      const status = claimed.refusal === 'not-found' ? 404
        : claimed.refusal === 'binding-conflict' ? 409
          : 400;
      return reply.code(status).send({ error: claimed.refusal, detail: claimed.detail });
    }
    return reply.send({ ok: true, value: claimed.value });
  });

  /**
   * Bounded, read-only raw replay of ONE Run attempt's PTY transcript ([C-R6]).
   *
   * This is the earlier-attempt half of the Run console: the live attempt is served by the PTY
   * WebSocket, every terminal attempt by this route. It is a pure READ — no attach, no controller,
   * no write, no resize, no close — so it needs no browser principal and grants no control.
   *
   * Authorization is the same layered order as the claim route: operator session, then the scoped
   * Run read (its own refusal passes through unchanged, so a caller who cannot read the run never
   * learns whether the session exists), then the binding. The binding check is what keeps one Run's
   * transcript out of another's console: a session whose attempt binding names a DIFFERENT run is
   * `not-found`, exactly as an unbound session id is, so a probe cannot distinguish the two.
   *
   * `fromSequence` is a BYTE OFFSET, and it is the only query key the route accepts: an extra key is
   * a 400 rather than a silently ignored parameter, because a caller who thinks it is paging by
   * `limit` or `maxBytes` must be told the server never read it. Bounds (<= 65,536 bytes and <= 256
   * frames per call) belong to the reader, not to the caller.
   */
  scope.get('/api/control/runs/:runRef/pty-sessions/:sessionId/replay', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const params = req.params as { runRef: string; sessionId: string };
    const detail = ctx.controlStore.getRun(sub, params.runRef, readScopeForSubject(subject(req)));
    if (!detail.ok) return sendResult(reply, detail);
    // Same closed pre-check as the claim route (the replay reader validates as well).
    if (!SESSION_ID_RE.test(params.sessionId)) {
      return reply.code(404).send({ error: 'not-found', detail: 'no attempt session for this run' });
    }
    const registry = ctx.ptySessionRegistry;
    const replay = ctx.ptyRawReplay;
    if (!registry || !replay) return reply.code(409).send({ error: 'pty-unavailable' });
    const query = record(req.query);
    const unexpected = Object.keys(query).filter((key) => key !== 'fromSequence');
    if (unexpected.length > 0) {
      return reply.code(400).send({ error: 'unexpected-query-key', detail: unexpected.join(',') });
    }
    const fromSequence = safeQueryInteger(query.fromSequence, 0);
    if (fromSequence === null) return reply.code(400).send({ error: 'invalid-from-sequence' });
    const binding = registry.bySession(sub, params.sessionId);
    if (!binding || binding.runRef !== params.runRef) {
      return reply.code(404).send({ error: 'not-found', detail: 'no attempt session for this run' });
    }
    const result = await replay(params.sessionId, fromSequence);
    if (!result.ok) {
      // A cursor past the last byte ever written, or a head the retention window dropped, is a
      // CONFLICT the caller resolves by re-reading from `nextSequence` — not a bad request and not a
      // 404, which would wrongly say the attempt is gone. An id the reader rejects outright can only
      // mean the binding and the transcript disagree about the session shape: report it as missing.
      const status = result.refusal.code === 'invalid-session' ? 404 : 409;
      return reply.code(status).send({
        error: result.refusal.code === 'invalid-session' ? 'not-found' : result.refusal.code,
        detail: result.refusal.message,
        nextSequence: result.refusal.nextSequence,
        floorSequence: result.refusal.floorSequence,
      });
    }
    return reply.send({ ok: true, value: result.value });
  });

}

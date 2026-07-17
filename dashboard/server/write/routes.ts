/**
 * U2 — governed write routes. Each composes (via the guarded scope's onRequest hooks + a per-route
 * session preHandler) Origin/Host -> rate-limit -> session, then calls the D2 gate module (which
 * independently re-verifies the session and enforces its own path-confinement / preamble / branch
 * routing), then appends exactly one audit row. NOTHING here reimplements a gate — the modules stay
 * authoritative; the route is composition + audit only.
 *
 *   POST /api/write/save          -> write/governedSave.ts#save
 *   POST /api/write/launch        -> write/launch.ts#launchCard
 *   POST /api/write/rerun         -> write/launch.ts#rerunAsDependsOn
 *   POST /api/write/stop          -> stop/floor.ts#writeStop        (nuclear, fleet-wide STOP sentinel)
 *   POST /api/write/stop-card     -> stop/floor.ts#requestStop      (scoped: working -> stop-requested -> halting)
 *   POST /api/write/pause-cadence -> stop/floor.ts#pauseCadence
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { save } from './governedSave';
import { launchCard, rerunAsDependsOn } from './launch';
import type { LaunchOutcome, RiskTier } from './launch';
import { writeStop, requestStop, pauseCadence } from '../stop/floor';
import { requireSession, verifiedSession } from '../http/middleware';
import type { SurfaceContext } from '../http/context';
import { auditFn } from '../http/context';

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Map a launch/floor refusal reason to an HTTP status. A frozen fleet is a 503 (service-unavailable
 *  by policy), an auth failure a 401, a card-op failure a 500. */
function launchStatus(outcome: Extract<LaunchOutcome, { ok: false }>): number {
  switch (outcome.reason) {
    case 'fleet-frozen':
      return 503;
    case 'unauthenticated':
      return 401;
    case 'card-op-failed':
      return 500;
    default:
      return 500;
  }
}

/** Register the governed write routes on an ALREADY-GUARDED scope. Every route additionally requires a
 *  session via the `requireSession` preHandler. */
export function registerWriteRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  const preHandler = requireSession(ctx.sessionConfig);
  const audit = auditFn(ctx);
  const auditOpts = { runGit: ctx.opsGit, now: ctx.now };

  scope.post('/api/write/save', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const relpath = str(body.relpath);
    const outcome = await save({
      repoRoot: ctx.repoRoot,
      relpath,
      content: str(body.content),
      sessionToken: session?.token,
      sessionConfig: ctx.sessionConfig,
      runGit: ctx.saveGit,
      openPr: ctx.openPr,
      workBranch: typeof body.workBranch === 'string' ? body.workBranch : undefined,
      message: typeof body.message === 'string' ? body.message : undefined,
    });
    audit(ctx.repoRoot, {
      action: 'save',
      owner: session?.claims.sub,
      target: relpath,
      result: outcome.ok ? `saved:${outcome.target}` : `refused:${outcome.reason}`,
    }, auditOpts);
    if (outcome.ok) return reply.code(200).send({ ok: true, target: outcome.target });
    return reply.code(outcome.status).send({ error: 'save-refused', reason: outcome.reason });
  });

  scope.post('/api/write/launch', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const outcome = launchCard(
      {
        project: (body.project as string | string[]) ?? '',
        action: str(body.action),
        target: str(body.target),
        riskTier: str(body.riskTier) as RiskTier,
        body: typeof body.body === 'string' ? body.body : undefined,
        dependsOn: Array.isArray(body.dependsOn) ? (body.dependsOn as string[]) : undefined,
      },
      { token: session?.token, config: ctx.sessionConfig },
      { repoRoot: ctx.repoRoot, runPreamble: ctx.runPreamble, runPy: ctx.runPy },
    );
    audit(ctx.repoRoot, {
      action: 'launch',
      owner: session?.claims.sub,
      target: str(body.target),
      riskTier: str(body.riskTier),
      result: outcome.ok ? `launched:${outcome.cardId}` : `refused:${outcome.reason}`,
    }, auditOpts);
    if (outcome.ok) return reply.code(200).send({ ok: true, cardId: outcome.cardId, cardPath: outcome.cardPath });
    return reply.code(launchStatus(outcome)).send({ error: outcome.reason, detail: 'detail' in outcome ? outcome.detail : outcome.problems });
  });

  scope.post('/api/write/rerun', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const cardId = str(body.cardId);
    const outcome = rerunAsDependsOn(
      cardId,
      str(body.feedback),
      { token: session?.token, config: ctx.sessionConfig },
      { repoRoot: ctx.repoRoot, runPreamble: ctx.runPreamble, runPy: ctx.runPy },
    );
    audit(ctx.repoRoot, {
      action: 'rerun',
      owner: session?.claims.sub,
      cardId,
      result: outcome.ok ? `requeued:${outcome.cardId}` : `refused:${outcome.reason}`,
    }, auditOpts);
    if (outcome.ok) return reply.code(200).send({ ok: true, cardId: outcome.cardId, cardPath: outcome.cardPath });
    return reply.code(launchStatus(outcome)).send({ error: outcome.reason, detail: 'detail' in outcome ? outcome.detail : outcome.problems });
  });

  scope.post('/api/write/stop', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const outcome = writeStop(
      { token: session?.token, config: ctx.sessionConfig },
      { repoRoot: ctx.repoRoot, runPy: ctx.runPy, runGit: ctx.opsGit },
    );
    audit(ctx.repoRoot, {
      action: 'stop',
      owner: session?.claims.sub,
      result: outcome.ok ? 'stop-written' : `refused:${outcome.reason}`,
    }, auditOpts);
    if (outcome.ok) return reply.code(200).send({ ok: true, path: outcome.path });
    return reply.code(401).send({ error: outcome.reason, detail: outcome.detail });
  });

  scope.post('/api/write/stop-card', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const cardId = str(body.cardId);
    const outcome = requestStop(
      cardId,
      { token: session?.token, config: ctx.sessionConfig },
      { repoRoot: ctx.repoRoot, runPy: ctx.runPy, runGit: ctx.opsGit },
    );
    audit(ctx.repoRoot, {
      action: 'stop-card',
      owner: session?.claims.sub,
      cardId,
      result: outcome.ok ? `halting:${outcome.state}` : `refused:${outcome.reason}`,
    }, auditOpts);
    if (outcome.ok) return reply.code(200).send({ ok: true, cardId: outcome.cardId, state: outcome.state });
    if (outcome.reason === 'unauthenticated') return reply.code(401).send({ error: outcome.reason, detail: outcome.detail });
    return reply.code(500).send({ error: outcome.reason, detail: outcome.detail });
  });

  scope.post('/api/write/pause-cadence', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const name = str(body.name);
    const outcome = pauseCadence(
      name,
      { token: session?.token, config: ctx.sessionConfig },
      { repoRoot: ctx.repoRoot, runPy: ctx.runPy, runGit: ctx.opsGit },
    );
    audit(ctx.repoRoot, {
      action: 'pause-cadence',
      owner: session?.claims.sub,
      target: name,
      result: outcome.ok ? 'paused' : `refused:${outcome.reason}`,
    }, auditOpts);
    if (outcome.ok) return reply.code(200).send({ ok: true, path: outcome.path });
    return reply.code(401).send({ error: outcome.reason, detail: outcome.detail });
  });
}

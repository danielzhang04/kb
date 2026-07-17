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
import { save } from './governedSave.ts';
import { isProtectedBranch } from './branch.ts';
import { launchCard, rerunAsDependsOn } from './launch.ts';
import type { LaunchOutcome, RiskTier } from './launch.ts';
import { writeStop, requestStop, pauseCadence } from '../stop/floor.ts';
import { setOverride, clearOverride } from './routingOverride.ts';
import type { OverrideScope } from './routingOverride.ts';
import { setCardRouting, clearCardRouting } from './cardRouting.ts';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import { auditFn } from '../http/context.ts';

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// A card id must be filename-safe: no path separators, no traversal, no glob metacharacters. Anything
// else is rejected 400 BEFORE the id reaches a scripts py `queue_root.glob("(dir-glob)/{cardId}.md")` — a
// glob metachar (star/question/bracket) would otherwise let a session-holder steer an unintended card.
// Mirrors approvals/routes.ts.
const CARD_ID_RE = /^[A-Za-z0-9._-]+$/;

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
    // FINDING 1: the SERVER owns durable work-branch selection; the client never chooses it. A caller
    // that tries to smuggle a protected branch (main/ops) is hard-rejected before any filesystem or git
    // activity — belt-and-suspenders over branch.ts's own denylist. `workBranch` is intentionally NOT
    // forwarded to save(): governedSave/branch.ts derive it server-side (DEFAULT_WORK_BRANCH). No audit
    // row on this pre-gate rejection (nothing consequential happened).
    if (typeof body.workBranch === 'string' && isProtectedBranch(body.workBranch)) {
      return reply.code(403).send({ error: 'forbidden-branch', reason: 'workBranch may not target main or ops; the server selects the durable work branch' });
    }
    const outcome = await save({
      repoRoot: ctx.repoRoot,
      relpath,
      content: str(body.content),
      sessionToken: session?.token,
      sessionConfig: ctx.sessionConfig,
      runGit: ctx.saveGit,
      openPr: ctx.openPr,
      message: typeof body.message === 'string' ? body.message : undefined,
    });
    // FINDING 3: audit ONLY on the success path (a consequential write actually occurred). A refusal
    // writes no ops-committed audit row — refused writes must not amplify into a pull-rebase-push each.
    if (outcome.ok) {
      audit(ctx.repoRoot, {
        action: 'save',
        owner: session?.claims.sub,
        target: relpath,
        result: `saved:${outcome.target}`,
      }, auditOpts);
      return reply.code(200).send({ ok: true, target: outcome.target });
    }
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
    // FINDING 3: audit only when a card was actually filed.
    if (outcome.ok) {
      audit(ctx.repoRoot, {
        action: 'launch',
        owner: session?.claims.sub,
        target: str(body.target),
        riskTier: str(body.riskTier),
        result: `launched:${outcome.cardId}`,
      }, auditOpts);
      return reply.code(200).send({ ok: true, cardId: outcome.cardId, cardPath: outcome.cardPath });
    }
    return reply.code(launchStatus(outcome)).send({ error: outcome.reason, detail: 'detail' in outcome ? outcome.detail : outcome.problems });
  });

  scope.post('/api/write/rerun', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const cardId = str(body.cardId);
    // LOW: reject glob-metachar / traversal card ids before the id reaches launch.ts's queue_root.glob.
    if (!CARD_ID_RE.test(cardId)) {
      return reply.code(400).send({ error: 'bad-card-id', reason: 'cardId must be filename-safe' });
    }
    const outcome = rerunAsDependsOn(
      cardId,
      str(body.feedback),
      { token: session?.token, config: ctx.sessionConfig },
      { repoRoot: ctx.repoRoot, runPreamble: ctx.runPreamble, runPy: ctx.runPy },
    );
    // FINDING 3: audit only on a successful requeue.
    if (outcome.ok) {
      audit(ctx.repoRoot, {
        action: 'rerun',
        owner: session?.claims.sub,
        cardId,
        result: `requeued:${outcome.cardId}`,
      }, auditOpts);
      return reply.code(200).send({ ok: true, cardId: outcome.cardId, cardPath: outcome.cardPath });
    }
    return reply.code(launchStatus(outcome)).send({ error: outcome.reason, detail: 'detail' in outcome ? outcome.detail : outcome.problems });
  });

  scope.post('/api/write/stop', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const outcome = writeStop(
      { token: session?.token, config: ctx.sessionConfig },
      { repoRoot: ctx.repoRoot, runPy: ctx.runPy, runGit: ctx.opsGit },
    );
    // FINDING 3: audit only when the STOP sentinel was actually written.
    if (outcome.ok) {
      audit(ctx.repoRoot, {
        action: 'stop',
        owner: session?.claims.sub,
        result: 'stop-written',
      }, auditOpts);
      return reply.code(200).send({ ok: true, path: outcome.path });
    }
    return reply.code(401).send({ error: outcome.reason, detail: outcome.detail });
  });

  scope.post('/api/write/stop-card', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const cardId = str(body.cardId);
    // LOW (same class as rerun): reject glob-metachar / traversal card ids before the id reaches
    // floor.ts's queue_root.glob(f"**/{cardId}.md").
    if (!CARD_ID_RE.test(cardId)) {
      return reply.code(400).send({ error: 'bad-card-id', reason: 'cardId must be filename-safe' });
    }
    const outcome = requestStop(
      cardId,
      { token: session?.token, config: ctx.sessionConfig },
      { repoRoot: ctx.repoRoot, runPy: ctx.runPy, runGit: ctx.opsGit },
    );
    // FINDING 3: audit only on a successful state transition.
    if (outcome.ok) {
      audit(ctx.repoRoot, {
        action: 'stop-card',
        owner: session?.claims.sub,
        cardId,
        result: `halting:${outcome.state}`,
      }, auditOpts);
      return reply.code(200).send({ ok: true, cardId: outcome.cardId, state: outcome.state });
    }
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
    // FINDING 3: audit only when the cadence was actually paused.
    if (outcome.ok) {
      audit(ctx.repoRoot, {
        action: 'pause-cadence',
        owner: session?.claims.sub,
        target: name,
        result: 'paused',
      }, auditOpts);
      return reply.code(200).send({ ok: true, path: outcome.path });
    }
    return reply.code(401).send({ error: outcome.reason, detail: outcome.detail });
  });

  // R2.2 — per-agent / per-scope routing override write. UNLIKE the routes above, the routing-override
  // and card-routing MODULES own their own D2.9 audit row (they are unit-tested at the module level for
  // it), so these routes do NOT call `audit(...)` — they are a thin outcome->HTTP map over the module.
  scope.post('/api/write/routing-override', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const op = str(body.op);
    // The override module owns a RACE-SAFE, ATOMIC coordination rewrite (audit row committed in the SAME
    // ops commit via ctx.saveGit) — so it takes no separate audit sink / PR opener.
    const routingDeps = {
      runGit: ctx.saveGit,
      now: ctx.now,
    };
    const input = { repoRoot: ctx.repoRoot, sessionToken: session?.token, sessionConfig: ctx.sessionConfig };
    const outcome =
      op === 'clear'
        ? await clearOverride(input, { scope: str(body.scope) as OverrideScope, key: str(body.key) }, routingDeps)
        : await setOverride(
            input,
            {
              scope: str(body.scope) as OverrideScope,
              key: str(body.key),
              runtime: typeof body.runtime === 'string' ? body.runtime : null,
              model: typeof body.model === 'string' ? body.model : null,
              expires: typeof body.expires === 'string' ? body.expires : null,
            },
            routingDeps,
          );
    if (outcome.ok) return reply.code(200).send(outcome);
    return reply.code(outcome.status).send({ error: 'routing-override-refused', reason: outcome.reason });
  });

  // R2.3 — per-card routing write (card frontmatter runtime/model — top precedence). D3.4's inline
  // DAG-node toggle will reuse setCardRouting unchanged.
  scope.post('/api/write/card-routing', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const cardId = str(body.cardId);
    if (!CARD_ID_RE.test(cardId)) {
      return reply.code(400).send({ error: 'bad-card-id', reason: 'cardId must be filename-safe' });
    }
    // The card-routing module commits its audit row in the SAME ops commit as the card change.
    const routingDeps = {
      runPy: ctx.runPy,
      runGit: ctx.saveGit,
      now: ctx.now,
    };
    const input = { repoRoot: ctx.repoRoot, cardId, sessionToken: session?.token, sessionConfig: ctx.sessionConfig };
    const outcome =
      str(body.op) === 'clear'
        ? await clearCardRouting(input, routingDeps)
        : await setCardRouting(input, { runtime: str(body.runtime), model: str(body.model) }, routingDeps);
    if (outcome.ok) return reply.code(200).send(outcome);
    // A card under an active approval refuses with a distinct `approval-locked` (409); every other
    // refusal keeps the generic `card-routing-refused` code. No audit on either — refused writes do not
    // amplify into an ops pull-rebase-push (FINDING 3), and the module already skips its own audit here.
    return reply.code(outcome.status).send({ error: outcome.error ?? 'card-routing-refused', reason: outcome.reason });
  });
}

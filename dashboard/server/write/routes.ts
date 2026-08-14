/**
 * U2 — governed write routes. Each composes (via the guarded scope's onRequest hooks + a per-route
 * session preHandler) Origin/Host -> rate-limit -> session, then calls the D2 gate module (which
 * independently re-verifies the session and enforces its own path-confinement / preamble / branch
 * routing), then appends exactly one audit row. NOTHING here reimplements a gate — the modules stay
 * authoritative; the route is composition + audit only.
 *
 *   POST /api/write/save          -> write/governedSave.ts#save
 *   POST /api/write/launch        -> write/launch.ts#launchCard
 *   POST /api/write/workflow-runs -> retired (canonical definitions launch through /api/workflows/:id/launch)
 *   POST /api/write/rerun         -> write/launch.ts#rerunAsDependsOn
 *   POST /api/write/stop          -> stop/floor.ts#writeStop        (nuclear, fleet-wide STOP sentinel)
 *   POST /api/write/stop-card     -> stop/floor.ts#requestStop      (scoped: working -> stop-requested -> halting)
 *   POST /api/write/pause-cadence -> stop/floor.ts#pauseCadence
 */
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { save } from './governedSave.ts';
import {
  commitPreparedCoordination,
  defaultGitRunner,
  isProtectedBranch,
  prepareCoordination,
} from './branch.ts';
import { withOpsTransaction } from './asyncGit.ts';
import { launchCard, rerunAsDependsOn } from './launch.ts';
import type { LaunchOutcome, RiskTier } from './launch.ts';
import { respondToCard, resolveCardPath } from './cardRespond.ts';
import type { RespondVerb } from './cardRespond.ts';
import { parseValidatedCard } from '../planeA/cards.ts';
import { redactSensitiveText } from '../composer/publicTimeline.ts';
import { writeStop, requestStop, pauseCadence } from '../stop/floor.ts';
import { setOverride, clearOverride } from './routingOverride.ts';
import type { OverrideScope } from './routingOverride.ts';
import { setCardRouting, clearCardRouting } from './cardRouting.ts';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import { auditFn } from '../http/context.ts';
import { appendAuditRowLocal, AUDIT_REL_PATH } from '../audit/log.ts';
import { triggerRunner as defaultTriggerRunner } from '../runner/trigger.ts';
import { ownerLiveness, type OwnerLiveness } from '../runner/liveness.ts';
import { workflowProfileIds } from '../control/environment.ts';
import { parseWorkflowDef } from '../workflows/defs.ts';

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
    case 'owner-not-registered':
      return 400;
    case 'card-op-failed':
      return 500;
    default:
      return 500;
  }
}

const CANONICAL_WORKFLOW_PATH = /^orgs\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/workflows\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\.md$/;

/** Validate only canonical org workflow saves; other governed durable artifacts retain their own schemas. */
function canonicalWorkflowSaveProblem(relpath: string, content: string): string | null {
  const match = CANONICAL_WORKFLOW_PATH.exec(relpath.replace(/\\/g, '/'));
  if (!match) return null;
  const parsed = parseWorkflowDef(content, { knownProfiles: workflowProfileIds() });
  if (!parsed.ok) return parsed.detail;
  if (parsed.value.project !== match[1]) {
    return `definition project '${parsed.value.project}' does not match path project '${match[1]}'`;
  }
  return null;
}

/** Register the governed write routes on an ALREADY-GUARDED scope. Every route additionally requires a
 *  session via the `requireSession` preHandler. */
export function registerWriteRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  const preHandler = requireSession(ctx.sessionConfig);
  const audit = auditFn(ctx);
  const auditOpts = { runGit: ctx.opsGit, now: ctx.now };

  scope.post('/api/write/save', { preHandler }, async (req, reply: FastifyReply) => {
    const admission = ctx.admission('new-work');
    if (!admission.ok) return reply.code(admission.status).send({ error: admission.reason });
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const relpath = str(body.relpath);
    const content = str(body.content);
    // FINDING 1: the SERVER owns durable work-branch selection; the client never chooses it. A caller
    // that tries to smuggle a protected branch (main/ops) is hard-rejected before any filesystem or git
    // activity — belt-and-suspenders over branch.ts's own denylist. `workBranch` is intentionally NOT
    // forwarded to save(): governedSave/branch.ts derive it server-side (DEFAULT_WORK_BRANCH). No audit
    // row on this pre-gate rejection (nothing consequential happened).
    if (typeof body.workBranch === 'string' && isProtectedBranch(body.workBranch)) {
      return reply.code(403).send({ error: 'forbidden-branch', reason: 'workBranch may not target main or ops; the server selects the durable work branch' });
    }
    const workflowProblem = canonicalWorkflowSaveProblem(relpath, content);
    if (workflowProblem) {
      return reply.code(400).send({ error: 'workflow-definition-invalid', reason: workflowProblem });
    }
    const outcome = await save({
      // Durable artifacts must never be written into the canonical ops checkout. Production points
      // this at an isolated worktree on DEFAULT_WORK_BRANCH; tests fall back to repoRoot.
      repoRoot: ctx.durableRepoRoot ?? ctx.repoRoot,
      relpath,
      content,
      sessionToken: session?.token,
      sessionConfig: ctx.sessionConfig,
      runGit: ctx.saveGit,
      openPr: ctx.openPr,
      runPreamble: ctx.runPreamble,
      message: typeof body.message === 'string' ? body.message : undefined,
      publication: ctx.coordinationPublication,
      outboxRoot: ctx.outboxRoot,
    });
    // FINDING 3: audit ONLY on the success path (a consequential write actually occurred). A refusal
    // writes no ops-committed audit row — refused writes must not amplify into a pull-rebase-push each.
    if (outcome.ok) {
      await audit(ctx.repoRoot, {
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
    const admission = ctx.admission('new-work');
    if (!admission.ok) return reply.code(admission.status).send({ error: admission.reason });
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    // C7.7 — an OPTIONAL operator-assigned owner. Absent/empty → today's unowned-card path. When present,
    // reject a non-filename-safe owner (separators/traversal/glob metachars) with the same CARD_ID_RE-class
    // guard used for cardId, BEFORE it reaches launch.ts's closed-set check / cards.claim. launch.ts's
    // filesystem-enumerated closed-set validation remains the authoritative boundary.
    const owner = typeof body.owner === 'string' && body.owner !== '' ? body.owner : undefined;
    if (owner !== undefined && !CARD_ID_RE.test(owner)) {
      return reply.code(400).send({ error: 'bad-owner', reason: 'owner must be filename-safe' });
    }
    // One ops transaction: prepare (inside launchCard's seam), cards.py write, audit append, commit/push.
    // Without the span lock a concurrent writer's pull/stage interleaves and fails one side (live regression).
    return withOpsTransaction(async () => {
    const outcome = await launchCard(
      {
        project: (body.project as string | string[]) ?? '',
        action: str(body.action),
        target: str(body.target),
        riskTier: str(body.riskTier) as RiskTier,
        body: typeof body.body === 'string' ? body.body : undefined,
        dependsOn: Array.isArray(body.dependsOn) ? (body.dependsOn as string[]) : undefined,
        owner,
      },
      { token: session?.token, config: ctx.sessionConfig },
      {
        repoRoot: ctx.repoRoot,
        runPreamble: ctx.runPreamble,
        runPy: ctx.runPy,
        prepareWrite: (repoRoot) => prepareCoordination(repoRoot, ctx.opsGit ?? defaultGitRunner, ctx.coordinationPublication, ctx.outboxRoot),
      },
    );
    // The card and its audit row are one coordination transaction: pull happened inside launchCard's
    // prepareWrite seam BEFORE cards.py wrote; append locally now, then stage both exact paths into one
    // commit/push. Do not call the self-committing `audit(...)` sink here (that would split the commit).
    if (outcome.ok) {
      try {
        const appendLocal = ctx.appendAuditLocal ?? appendAuditRowLocal;
        appendLocal(ctx.repoRoot, {
          action: 'launch',
          owner: session?.claims.sub,
          target: str(body.target),
          riskTier: str(body.riskTier),
          result: `launched:${outcome.cardId}`,
        }, ctx.now);
        await commitPreparedCoordination(ctx.repoRoot, outcome.cardPath, {
          runGit: ctx.opsGit ?? defaultGitRunner,
          alsoStage: [AUDIT_REL_PATH],
          message: `chore(queue): launch card ${outcome.cardId}`,
          publication: ctx.coordinationPublication,
          outboxRoot: ctx.outboxRoot,
        });
        const runner = owner ? (ctx.triggerRunner ?? defaultTriggerRunner)(owner) : {
          status: 'unbound' as const,
          owner: '',
          detail: 'card has no assigned owner',
        };
        return reply.code(200).send({ ok: true, cardId: outcome.cardId, cardPath: outcome.cardPath, runner });
      } catch (err) {
        return reply.code(500).send({
          error: 'launch-commit-failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return reply.code(launchStatus(outcome)).send({ error: outcome.reason, detail: 'detail' in outcome ? outcome.detail : outcome.problems });
    });
  });

  // Retired: client-authored workflow DAGs bypassed canonical definition parsing and project confinement.
  // The endpoint remains explicit (rather than silently 404) so old callers get an actionable migration.
  scope.post('/api/write/workflow-runs', { preHandler }, async (_req, reply: FastifyReply) =>
    reply.code(410).send({
      error: 'workflow-runs-retired',
      detail: 'save a canonical org workflow definition, then launch it via /api/workflows/:id/launch',
    }),
  );

  scope.post('/api/write/rerun', { preHandler }, async (req, reply: FastifyReply) => {
    const admission = ctx.admission('new-work');
    if (!admission.ok) return reply.code(admission.status).send({ error: admission.reason });
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const cardId = str(body.cardId);
    // LOW: reject glob-metachar / traversal card ids before the id reaches launch.ts's queue_root.glob.
    if (!CARD_ID_RE.test(cardId)) {
      return reply.code(400).send({ error: 'bad-card-id', reason: 'cardId must be filename-safe' });
    }
    return withOpsTransaction(async () => {
    const outcome = await rerunAsDependsOn(
      cardId,
      str(body.feedback),
      { token: session?.token, config: ctx.sessionConfig },
      {
        repoRoot: ctx.repoRoot,
        runPreamble: ctx.runPreamble,
        runPy: ctx.runPy,
        prepareWrite: (repoRoot) => prepareCoordination(repoRoot, ctx.opsGit ?? defaultGitRunner, ctx.coordinationPublication, ctx.outboxRoot),
      },
    );
    // Same transaction as launch: pull before cards.py, then append the audit locally and commit the
    // new dependent card + audit row together. The self-committing audit sink must not run here.
    if (outcome.ok) {
      try {
        const appendLocal = ctx.appendAuditLocal ?? appendAuditRowLocal;
        appendLocal(ctx.repoRoot, {
          action: 'rerun',
          owner: session?.claims.sub,
          cardId,
          result: `requeued:${outcome.cardId}`,
        }, ctx.now);
        await commitPreparedCoordination(ctx.repoRoot, outcome.cardPath, {
          runGit: ctx.opsGit ?? defaultGitRunner,
          alsoStage: [AUDIT_REL_PATH],
          message: `chore(queue): rerun card ${cardId} as ${outcome.cardId}`,
          publication: ctx.coordinationPublication,
          outboxRoot: ctx.outboxRoot,
        });
        return reply.code(200).send({ ok: true, cardId: outcome.cardId, cardPath: outcome.cardPath });
      } catch (err) {
        return reply.code(500).send({
          error: 'rerun-commit-failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return reply.code(launchStatus(outcome)).send({ error: outcome.reason, detail: 'detail' in outcome ? outcome.detail : outcome.problems });
    });
  });

  scope.post('/api/write/stop', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const outcome = writeStop(
      { token: session?.token, config: ctx.sessionConfig },
      {
        repoRoot: ctx.repoRoot,
        runPy: ctx.runPy,
        runGit: ctx.opsGit,
        publication: ctx.coordinationPublication,
        outboxRoot: ctx.outboxRoot,
      },
    );
    // FINDING 3: audit only when the STOP sentinel was actually written.
    if (outcome.ok) {
      await audit(ctx.repoRoot, {
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
    const outcome = await requestStop(
      cardId,
      { token: session?.token, config: ctx.sessionConfig },
      {
        repoRoot: ctx.repoRoot,
        runPy: ctx.runPy,
        runGit: ctx.opsGit,
        publication: ctx.coordinationPublication,
        outboxRoot: ctx.outboxRoot,
      },
    );
    // FINDING 3: audit only on a successful state transition.
    if (outcome.ok) {
      await audit(ctx.repoRoot, {
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
    const outcome = await pauseCadence(
      name,
      { token: session?.token, config: ctx.sessionConfig },
      {
        repoRoot: ctx.repoRoot,
        runPy: ctx.runPy,
        runGit: ctx.opsGit,
        publication: ctx.coordinationPublication,
        outboxRoot: ctx.outboxRoot,
      },
    );
    // FINDING 3: audit only when the cadence was actually paused.
    if (outcome.ok) {
      await audit(ctx.repoRoot, {
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
    return reply.code(outcome.status).send({
      error: outcome.error ?? 'card-routing-refused',
      reason: outcome.reason,
      ...(outcome.state ? { state: outcome.state } : {}),
      ...(outcome.disposition ? { disposition: outcome.disposition } : {}),
    });
  });

  // #2 Inbox — governed inline resolution of a card-projection item. `action` is the OPERATOR verb
  // ('reply' | 'resolve'), NOT the card's own `action` field. Authorization (which (state, action, verb)
  // combos are legal, and the resulting cards.py section-append + transitions) lives in cardRespond.ts;
  // this route is composition + audit only, and re-derives the card's live (state, action) from its
  // committed frontmatter rather than trusting the client's projected category.
  scope.post('/api/write/card-respond', { preHandler }, async (req, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const cardId = str(body.cardId);
    const verb = str(body.action);
    if (!CARD_ID_RE.test(cardId)) {
      return reply.code(400).send({ error: 'bad-card-id', reason: 'cardId must be filename-safe' });
    }
    if (verb !== 'reply' && verb !== 'resolve') {
      return reply.code(400).send({ error: 'bad-action', reason: "action must be 'reply' or 'resolve'" });
    }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message.length === 0 || message.length > 16_000) {
      return reply.code(400).send({ error: 'invalid-message', reason: 'message must be a non-empty string of at most 16000 characters' });
    }
    // Same secret-redaction refusal the composer prompt path uses — the operator note is committed to the
    // shared ops branch, so a leaked bearer/key/private-key must never be persisted into a card body.
    const secrets = [ctx.sessionConfig.secret.toString('utf8'), session?.token]
      .filter((value): value is string => typeof value === 'string' && value.length >= 8);
    if (redactSensitiveText(message, secrets) !== message) {
      return reply.code(400).send({ error: 'sensitive-content-refused', field: 'message' });
    }
    // Resolve strictly within queue/ (CARD_ID_RE already blocked separators/traversal/glob metachars).
    const cardPath = resolveCardPath(ctx.repoRoot, cardId);
    if (!cardPath) {
      return reply.code(404).send({ error: 'card-not-found', reason: `no card ${cardId} under queue/` });
    }
    let parsed: ReturnType<typeof parseValidatedCard>;
    try {
      parsed = parseValidatedCard(readFileSync(cardPath, 'utf8'));
    } catch (err) {
      return reply.code(500).send({ error: 'card-parse-failed', detail: err instanceof Error ? err.message : String(err) });
    }

    return withOpsTransaction(async () => {
    const outcome = await respondToCard(
      {
        cardId,
        state: str(parsed.meta.state),
        action: str(parsed.meta.action),
        verb: verb as RespondVerb,
        message,
        iso: (ctx.now ?? (() => new Date()))().toISOString(),
      },
      {
        repoRoot: ctx.repoRoot,
        runPy: ctx.runPy,
        prepareWrite: (repoRoot) => prepareCoordination(repoRoot, ctx.opsGit ?? defaultGitRunner, ctx.coordinationPublication, ctx.outboxRoot),
      },
    );
    if (!outcome.ok) {
      if (outcome.reason === 'not-allowed') {
        return reply.code(409).send({ error: 'card-respond-refused', reason: outcome.detail });
      }
      return reply.code(500).send({ error: outcome.reason, detail: outcome.detail });
    }
    // One coordination transaction: the pull already happened inside respondToCard's prepareWrite seam
    // BEFORE cards.py wrote; append the audit row locally now and commit the card path(s) + audit row in
    // ONE ops commit. A done-transition MOVES the file, so `paths` carries BOTH the deleted origin and the
    // new location — both are staged.
    try {
      const appendLocal = ctx.appendAuditLocal ?? appendAuditRowLocal;
      appendLocal(ctx.repoRoot, {
        action: 'card-respond',
        owner: session?.claims.sub,
        cardId,
        riskTier: 'T2',
        result: `${verb}:${outcome.state}`,
      }, ctx.now);
      const [first, ...rest] = outcome.paths;
      if (!first) throw new Error('card response produced no card paths');
      await commitPreparedCoordination(ctx.repoRoot, first, {
        runGit: ctx.opsGit ?? defaultGitRunner,
        alsoStage: [...rest, AUDIT_REL_PATH],
        message: `chore(queue): ${verb} card ${cardId}`,
        publication: ctx.coordinationPublication,
        outboxRoot: ctx.outboxRoot,
      });
      // G3 reply-liveness: the write is DONE and committed. Now report whether any consumer is online for
      // this card's owner so a hanging reply is VISIBLE, not silent. This is a read-only probe AFTER the
      // commit — it must never turn a committed 200 into a 500, so a fault degrades to `consumer:'none'`.
      let liveness: OwnerLiveness = { consumer: 'none', online: false, detail: '' };
      try {
        liveness = ownerLiveness(str(parsed.meta.owner), parsed, {
          run: ctx.schtasksRun,
          cache: ctx.livenessCache,
          now: ctx.now ? () => ctx.now!().getTime() : undefined,
        });
      } catch {
        liveness = { consumer: 'none', online: false, detail: '' };
      }
      return reply.code(200).send({ ok: true, cardId, state: outcome.state, liveness });
    } catch (err) {
      return reply.code(500).send({
        error: 'card-respond-commit-failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    });
  });
}

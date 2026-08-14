/**
 * FYT paid-action wiring — Unit D2: the non-session paid-action route and its bearer-grant preHandler.
 * This is the PRIMARY F1 fix: every spend-bearing identity is derived SERVER-SIDE, never trusted from the
 * worker's request body.
 *
 * A headless worker has no browser session, so this route does NOT use `requireSession`. Its own preHandler
 * reads `Authorization: Bearer <token>`, resolves it against the durable spend-grant store, and 401s on an
 * absent/expired/forged token. From the resolved grant the handler derives `runRef`, `stageRef`, and the
 * paid `operation`; it derives `attemptRef` from the run's own execution state and `callOrdinal` from the
 * paid-action journal. The request body carries ONLY the operation payload (prompt+seeds or text, plus the
 * expected artifact path) and is validated with exact-key strictness. A body-supplied runRef/stageRef/
 * ordinal/attempt is therefore structurally impossible to honor — those keys are rejected outright.
 *
 * The daemon commits provider bytes server-side (Unit C committer) into the attempt worktree, so the HTTP
 * response returns only committed metadata (artifactPath, mediaType, byteLength, sha256) — never raw bytes.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with `.ts` specifiers.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { bearerToken } from '../http/middleware.ts';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import {
  FYT_PAID_ACTION_DEFINITIONS,
  PaidActionError,
  type PaidActionErrorCode,
  type PaidActionImageSeed,
  type PaidActionRequest,
  type PaidActionResult,
} from './paidActionService.ts';
import type { SpendGrant } from './spendGrant.ts';

/** Image seed payloads plus the operation envelope can be several MB; lift the per-route body limit well
 *  above Fastify's 1 MB default so the service (not the framework) is the one enforcing the size envelope. */
const PAID_ACTION_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

/** Grant TTL is a stage's lifetime; a token that authorizes many draws still expires. Written by D3. */
export const PAID_ACTION_ROUTE_PATH = '/api/control/paid-action';

/** Per-request stash of the grant a request's bearer token resolved to — set by the preHandler, read by the
 *  handler. A WeakMap keeps it off the request object entirely (no decoration, no `any`), mirroring the
 *  session middleware, so a handler can never read a grant the preHandler did not verify. */
const grantByReq = new WeakMap<FastifyRequest, SpendGrant>();

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const RETRYABLE_CODES: ReadonlySet<PaidActionErrorCode> = new Set([
  'artifact-verification-unavailable',
  'journal-unavailable',
  'startup-reconciliation-required',
  'attempt-in-progress',
  'call-out-of-order',
]);

/** Map a service error to a stable HTTP status. Retryable (transient/serialization) → 503 or 409; cap
 *  exhaustion → 409; a caller-shaped problem → 400; anything else → 500. Never leaks internal wording. */
function statusForError(code: PaidActionErrorCode): number {
  if (code === 'artifact-verification-unavailable' || code === 'journal-unavailable'
    || code === 'startup-reconciliation-required') {
    return 503;
  }
  if (code === 'cap-exhausted' || code === 'idempotency-conflict'
    || code === 'attempt-in-progress' || code === 'call-out-of-order') {
    return 409;
  }
  if (code === 'invalid-input') return 400;
  return 500;
}

/** Map a terminal service result to the worker-facing JSON. Succeeded/replayed-succeeded return committed
 *  metadata (never bytes); failed/unknown return a stable status the worker acts on by issuing the next
 *  capped call. */
function replySuccess(reply: FastifyReply, result: PaidActionResult): FastifyReply {
  if (result.status === 'succeeded') {
    return reply.code(200).send({ status: 'succeeded', actionRef: result.actionRef, output: result.output });
  }
  if (result.status === 'failed') {
    return reply.code(200).send({ status: 'failed', actionRef: result.actionRef, reason: result.reason });
  }
  if (result.status === 'unknown') {
    return reply.code(200).send({ status: 'unknown', actionRef: result.actionRef, reason: result.reason });
  }
  // replayed: report the terminal state it replays, tagged so an idempotent re-issue is observable.
  if (result.priorState === 'succeeded') {
    return reply.code(200).send({ status: 'succeeded', actionRef: result.actionRef, output: result.output, replayed: true });
  }
  if (result.priorState === 'failed') {
    return reply.code(200).send({ status: 'failed', actionRef: result.actionRef, reason: result.reason, replayed: true });
  }
  return reply.code(200).send({ status: 'unknown', actionRef: result.actionRef, reason: result.reason, replayed: true });
}

/** Validate the operation payload against the grant's operation and build the fully server-identified paid
 *  action request. Returns a stable error string on any shape/operation problem. Never reads identity from
 *  the body — runRef/stageRef/attemptRef/callOrdinal are passed in, all server-derived. */
function buildPaidActionRequest(
  grant: SpendGrant,
  body: Record<string, unknown>,
  identity: { runRef: string; stageRef: string; attemptRef: string; callOrdinal: number },
): { ok: true; request: PaidActionRequest } | { ok: false; error: string } {
  if (!isNonEmptyString(body.operation) || body.operation !== grant.operation) {
    return { ok: false, error: 'operation-mismatch' };
  }
  const operation = grant.operation;
  const definition = FYT_PAID_ACTION_DEFINITIONS[operation];

  if (operation === 'fyt.gemini-3-pro-image-2k') {
    if (!hasExactKeys(body, ['operation', 'prompt', 'seeds', 'expectedArtifactPath'])) {
      return { ok: false, error: 'invalid-body' };
    }
    if (!isNonEmptyString(body.prompt) || !isNonEmptyString(body.expectedArtifactPath) || !Array.isArray(body.seeds)) {
      return { ok: false, error: 'invalid-body' };
    }
    const seeds: PaidActionImageSeed[] = [];
    for (const raw of body.seeds) {
      const seed = record(raw);
      if (!hasExactKeys(seed, ['pngBase64', 'sha256']) || !isNonEmptyString(seed.pngBase64) || !isNonEmptyString(seed.sha256)) {
        return { ok: false, error: 'invalid-seed' };
      }
      seeds.push({ bytes: Uint8Array.from(Buffer.from(seed.pngBase64, 'base64')), sha256: seed.sha256 });
    }
    return {
      ok: true,
      request: {
        runRef: identity.runRef,
        stageRef: identity.stageRef,
        attemptRef: identity.attemptRef,
        callOrdinal: identity.callOrdinal,
        stageId: 'images',
        operation,
        prompt: body.prompt,
        seeds,
        expectedArtifactPath: body.expectedArtifactPath,
      },
    };
  }

  // fyt.elevenlabs.locked-tts
  if (definition.channelId === null) return { ok: false, error: 'invalid-body' };
  if (!hasExactKeys(body, ['operation', 'text', 'expectedArtifactPath'])) {
    return { ok: false, error: 'invalid-body' };
  }
  if (!isNonEmptyString(body.text) || !isNonEmptyString(body.expectedArtifactPath)) {
    return { ok: false, error: 'invalid-body' };
  }
  return {
    ok: true,
    request: {
      runRef: identity.runRef,
      stageRef: identity.stageRef,
      attemptRef: identity.attemptRef,
      callOrdinal: identity.callOrdinal,
      stageId: 'audio',
      channelId: definition.channelId,
      operation,
      text: body.text,
      expectedArtifactPath: body.expectedArtifactPath,
    },
  };
}

/**
 * Derive the run's current attempt for the grant's stage from execution state — never from the worker. The
 * run is keyed by the grant's subject (the operator whose passkey approved the spend gate, which is the same
 * subject the run is stored under). A missing run/stage/attempt is a retryable 409, not an authorization
 * failure: the attempt worktree is prepared at the same launch that mints the grant, so a well-timed worker
 * always finds one.
 */
function deriveAttemptRef(ctx: SurfaceContext, grant: SpendGrant): { ok: true; attemptRef: string } | { ok: false } {
  const run = ctx.controlStore.getRun(grant.subject, grant.runRef);
  if (!run.ok) return { ok: false };
  const stage = run.value.stages.find((candidate) => candidate.stageRef === grant.stageRef);
  if (!stage || !isNonEmptyString(stage.currentAttemptRef)) return { ok: false };
  return { ok: true, attemptRef: stage.currentAttemptRef };
}

/** Count committed paid actions for this exact (run, stage, attempt, operation) tuple to derive the next
 *  strictly-increasing call ordinal, matching the service's own expected-ordinal rule. Server truth only. */
function deriveCallOrdinal(
  ctx: SurfaceContext,
  grant: SpendGrant,
  attemptRef: string,
): number {
  const prior = ctx.paidActionService!.snapshot().filter((action) =>
    action.runRef === grant.runRef && action.stageRef === grant.stageRef
    && action.attemptRef === attemptRef && action.operation === grant.operation);
  return prior.length + 1;
}

/**
 * Register `POST /api/control/paid-action` on the already-guarded write-surface scope (origin + rate-limit apply
 * as elsewhere). No `requireSession`: the preHandler is the bearer-grant check. Both the service and the
 * grant store are bound onto the context ONLY behind the activation gate, so when execution is locked the
 * route fails closed with a stable 503.
 */
export function registerPaidActionRoute(scope: FastifyInstance, ctx: SurfaceContext): void {
  const preHandler = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!ctx.spendGrantStore || !ctx.paidActionService) {
      reply.code(503).send({ error: 'paid-action-unavailable', detail: 'execution is not activated', retryable: true });
      return;
    }
    const token = bearerToken(req);
    if (!token) {
      reply.code(401).send({ error: 'unauthenticated', reason: 'missing spend grant token' });
      return;
    }
    const grant = ctx.spendGrantStore.resolve(token);
    if (!grant) {
      reply.code(401).send({ error: 'unauthenticated', reason: 'spend grant is absent or expired' });
      return;
    }
    grantByReq.set(req, grant);
  };

  scope.post(PAID_ACTION_ROUTE_PATH, { bodyLimit: PAID_ACTION_BODY_LIMIT_BYTES, preHandler }, async (req, reply) => {
    const grant = grantByReq.get(req);
    if (!grant || !ctx.paidActionService) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    const admission = ctx.admission('paid-continuation');
    if (!admission.ok) {
      return reply.code(admission.status).send({ error: admission.reason });
    }

    const attempt = deriveAttemptRef(ctx, grant);
    if (!attempt.ok) {
      return reply.code(409).send({ error: 'no-active-attempt', detail: 'the run has no active attempt for this stage', retryable: true });
    }
    const callOrdinal = deriveCallOrdinal(ctx, grant, attempt.attemptRef);

    const built = buildPaidActionRequest(grant, record(req.body), {
      runRef: grant.runRef,
      stageRef: grant.stageRef,
      attemptRef: attempt.attemptRef,
      callOrdinal,
    });
    if (!built.ok) {
      return reply.code(400).send({ error: built.error });
    }

    // Audit-before-mutate, per the settlement-route idiom (routes.ts). MANDATORY, never conditional: this is
    // a T3 real-spend action, so it must leave a governance row before any draw-down. `auditFn(ctx)` is the
    // git-committing appender in production and the injected fake in tests — a bare `if (ctx.appendAudit)`
    // guard would skip the row in prod (where `appendAudit` is undefined) and spend silently. A failure to
    // record refuses the spend rather than spending silently.
    try {
      await auditFn(ctx)(ctx.repoRoot, {
        action: 'control-paid-action-execute',
        owner: grant.subject,
        target: grant.runRef,
        riskTier: 'T3',
        result: `authorized:${grant.operation}`,
        detail: {
          runRef: grant.runRef,
          stageRef: grant.stageRef,
          attemptRef: attempt.attemptRef,
          callOrdinal,
          operation: grant.operation,
          grantRef: grant.grantRef,
        },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'paid-action-audit-required' });
    }

    try {
      const result = await ctx.paidActionService.execute(built.request);
      return replySuccess(reply, result);
    } catch (error) {
      if (error instanceof PaidActionError) {
        const status = statusForError(error.code);
        return reply.code(status).send({ error: error.code, retryable: RETRYABLE_CODES.has(error.code) });
      }
      return reply.code(500).send({ error: 'paid-action-failed' });
    }
  });
}

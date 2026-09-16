/**
 * `requireAuthority` — the single preHandler that enforces `policy.ts#ROUTE_AUTHORITY` at request time
 * (spec §4.1 step "the gate"). Installed on every scope that can reach a mutating route; see the
 * install-point comments in `http/surface.ts` and `index.ts` for the exact call sites and why more
 * than one scope needs it — the write surface's authenticated scope is not the only place a mutating
 * route registers.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import { classifyRoute, routeKey } from './policy.ts';
import { verifyApproval } from './approval.ts';
import { defaultSshsigVerifier } from './sshsig.ts';
import { createNonceStore } from './nonceStore.ts';
import { ACTOR_HEADER, parseActor } from './actor.ts';

const PASS_THROUGH_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/**
 * The verified approval's nonce, for the rare signed route (currently only the T6 budget override)
 * that needs to tie its OWN durable record to the approval that authorized it. Keyed by request
 * identity in a module-private `WeakMap` rather than a body key — `body.approval` is deleted below
 * precisely so a signed route's ordinary exact-key body wall never has to carry a T3-only concern, and
 * adding a second key (e.g. `body.approvedNonce`) would reopen exactly that. A route with no reason to
 * know the nonce never calls this and the entry is dropped with the request.
 */
const verifiedApprovalNonces = new WeakMap<FastifyRequest, string>();

/** `null` for an open/none-class request, or a signed one this preHandler has not (yet) verified. */
export function approvedNonceFor(req: FastifyRequest): string | null {
  return verifiedApprovalNonces.get(req) ?? null;
}

/** Appends the refusal audit row BEFORE the reply (spec §4.2: "every refusal appends one audit row"),
 *  swallowing an audit failure so the refusal itself always lands, and never puts `payload`/`signature`
 *  — or anything else off the request body — into the row. */
async function refuse(
  ctx: SurfaceContext,
  req: FastifyRequest,
  reply: FastifyReply,
  status: number,
  error: string,
  route: string,
  entityRef: string | null = null,
): Promise<void> {
  try {
    await auditFn(ctx)(ctx.repoRoot, {
      action: 'authority-approval-refused',
      result: error,
      // T4 [design:4.3]: `actor` is a TOP-LEVEL AuditEvent field, self-asserted and therefore a record,
      // never a capability — the SAME `X-KB-Actor` parse every other governed route's refusal row uses.
      actor: parseActor(req.headers[ACTOR_HEADER]),
      detail: { route, entityRef },
    });
  } catch {
    // The refusal must still land even when the audit row could not be written.
  }
  await reply.code(status).send({ error });
}

/** `requireAuthority(ctx)` — a preHandler closed over the surface context, safe to install on every
 *  scope that can register a mutating route (installing it twice on the SAME request is harmless: an
 *  `open`/`GET` request returns immediately, and a `signed` request re-verifying the same approval is
 *  idempotent up to nonce replay, which is refused by design — so the two install points never need to
 *  coordinate). */
export function requireAuthority(ctx: SurfaceContext): preHandlerHookHandler {
  return async function preHandlerRequireAuthority(req, reply) {
    if (PASS_THROUGH_METHODS.has(req.method.toUpperCase())) return;
    const url = req.routeOptions?.url ?? req.url;
    const entry = classifyRoute(req.method, url);
    if (!entry) { await refuse(ctx, req, reply, 403, 'route-unclassified', url); return; }
    if (entry.cls === 'none') { await refuse(ctx, req, reply, 403, 'route-unavailable', url); return; }
    if (entry.cls === 'open') return;
    const body = record(req.body);
    const entityRef = entry.entityParam
      ? String((req.params as Record<string, unknown>)[entry.entityParam] ?? '')
      : (entry.entityFromBody?.(body) ?? '');
    const result = await verifyApproval({
      approval: body.approval,
      expectedRoute: routeKey(entry),
      expectedEntityRef: entityRef,
      allowedSigners: ctx.humanApproverAllowedSigners ?? '',
      verifier: ctx.sshsigVerifier ?? defaultSshsigVerifier,
      nonces: ctx.approvalNonces ?? createNonceStore(ctx.stateRoot),
      now: () => (ctx.now?.() ?? new Date()).getTime(),
    });
    if (!result.ok) { await refuse(ctx, req, reply, result.status, result.error, url, entityRef); return; }
    // T6: stash the verified nonce BEFORE stripping `approval` below — `verifyApproval` already
    // confirmed `body.approval.payload` parses to a well-shaped nonce (check #4), so this second parse
    // is not re-validating trust, only recovering a value the ok:true result does not otherwise carry.
    // Never reachable as `null` in practice; treated as a refusal rather than trusted blindly, matching
    // "fail closed everywhere" for a malformed value at any point in this path.
    const approvalRecord = body.approval as { payload: string };
    let nonce: string | null = null;
    try {
      const parsedPayload = JSON.parse(approvalRecord.payload) as { nonce?: unknown };
      nonce = typeof parsedPayload.nonce === 'string' ? parsedPayload.nonce : null;
    } catch {
      nonce = null;
    }
    if (nonce === null) { await refuse(ctx, req, reply, 403, 'approval-invalid', url, entityRef); return; }
    verifiedApprovalNonces.set(req, nonce);
    // The route's OWN handler still validates its body against its ordinary, pre-T3 shape (most use
    // exact-key walls, e.g. `services/scheduleService.ts#deleteBody`) — `approval` was never one of their
    // keys and must not become a required or even a tolerated one everywhere a signed route exists. Strip
    // it here, in the ONE place that already parsed and verified it, rather than widening every signed
    // handler's body wall to carry a T3-only concern it has no other reason to know about.
    delete body.approval;
  };
}

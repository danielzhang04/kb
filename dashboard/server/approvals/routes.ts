/**
 * U2 — approvals routes.
 *
 *   GET  /api/approvals        -> ranked pending cards, each with its `assurance.ts#buttonsFor` gating.
 *                                 Session-gated alongside every other repository/state read.
 *   POST /api/approvals/verify -> drives the channel's verifier (`cardVerifier.ts#driveVerify` -> the fleet's
 *                                 `scripts/approvals.py` / D2.3's `scripts/webauthn_verify.py`). Session-
 *                                 gated; the WebAuthn channel additionally performs the load-bearing
 *                                 dispatcher-side assertion re-check inside that subprocess (the actual
 *                                 T3 boundary). One audit row per attempt.
 *
 * The verify route NEVER accepts a client-supplied filesystem path — the client sends only a `cardId`,
 * which is strictly sanitized and resolved to a file WITHIN `queue/` here, so nothing a caller sends can
 * point the Python verifier at an arbitrary path.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { driveVerify } from './cardVerifier.ts';
import type { ApprovalChannel, VerifiedCardView } from './cardVerifier.ts';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import { auditFn } from '../http/context.ts';

const QUEUE_DIRS = ['inbox', 'working', 'approvals', 'done'];
const VALID_CHANNELS: ReadonlySet<string> = new Set(['signed', 'possession', 'webauthn']);
/** A card id must be filename-safe: no path separators, no traversal. Anything else is rejected. */
const CARD_ID_RE = /^[A-Za-z0-9._-]+$/;

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/** Resolve a sanitized card id to its file path under `queue/`, or `null` if absent. The id is already
 *  validated against {@link CARD_ID_RE} (no separators / `..`), so each join stays inside `queue/`. */
function resolveCardPath(repoRoot: string, cardId: string): string | null {
  for (const dir of QUEUE_DIRS) {
    const full = join(repoRoot, 'queue', dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) {
      if (name === `${cardId}.md`) return join(full, name);
    }
  }
  return null;
}

export function registerApprovalsRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  const preHandler = requireSession(ctx.sessionConfig);
  scope.post('/api/approvals/verify', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const cardId = typeof body.cardId === 'string' ? body.cardId : '';
    const channel = typeof body.channel === 'string' ? body.channel : '';

    if (!CARD_ID_RE.test(cardId)) {
      return reply.code(400).send({ error: 'bad-card-id', reason: 'cardId must be filename-safe' });
    }
    if (!VALID_CHANNELS.has(channel)) {
      return reply.code(400).send({ error: 'bad-channel', reason: 'channel must be signed|possession|webauthn' });
    }
    const cardPath = resolveCardPath(ctx.repoRoot, cardId);
    if (!cardPath) {
      return reply.code(404).send({ error: 'card-not-found', reason: `no card ${cardId} under queue/` });
    }

    let pinned: VerifiedCardView | undefined;
    const outcome = driveVerify(cardPath, channel as ApprovalChannel, {
      repoRoot: ctx.repoRoot,
      runPy: ctx.runPy,
      // WebAuthn-only pinned-content execute (D2.3 boundary -> D2.4 execute). Records the verified,
      // pinned card view — never a re-read of the mutable working tree.
      execute: (card) => {
        pinned = card;
      },
    });

    // FINDING 3: only a VERIFIED approval is a consequential action — write the ops-committed audit row
    // on the success path only. A rejected verification writes NO ops audit commit, mirroring
    // auth/routes.ts's deliberate skip-on-failure, so a session-holder cannot amplify failed approval
    // attempts into unbounded pull-rebase-push commits. (Judgment call flagged in the report: rejected
    // approvals are no longer durably audited to ops; use a local log if a failed-attempt trail is wanted.)
    if (outcome.ok) {
      auditFn(ctx)(ctx.repoRoot, {
        action: 'approve',
        owner: session?.claims.sub,
        cardId,
        target: pinned?.target,
        riskTier: pinned?.riskTier,
        result: `verified:${channel}`,
        detail: { reason: outcome.reason },
      }, { runGit: ctx.opsGit, now: ctx.now });
    }

    return reply.code(outcome.ok ? 200 : 403).send({ ok: outcome.ok, reason: outcome.reason, card: outcome.card });
  });
}

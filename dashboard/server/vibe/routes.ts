/**
 * U2 — the vibe-code spawn route (RCE-equivalent live prompt). Composes Origin/Host -> rate-limit ->
 * session (the guarded scope's hooks + a session preHandler) THEN hands off to `vibe/session.ts#spawnVibe`,
 * which is authoritative for the load-bearing gates: it re-runs the preamble gate FIRST, re-verifies the
 * session, applies its OWN per-operator rate-limit/lockout, and writes EXACTLY ONE audit row for every
 * attempt (spawned or refused). This route never reimplements any of that — it only wires the resulting
 * stream (or a calm refusal) onto the HTTP response.
 *
 *   POST /api/vibe  -> streams newline-delimited JSON frames: {type:'delta',model}, {type:'stderr',chunk},
 *                      {type:'exit',code}. A refusal that spawnVibe returns synchronously (fleet-frozen /
 *                      rate-limited / locked-out) is sent as a normal JSON error with a mapped status,
 *                      because no `claude` output can have streamed yet.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { spawnVibe } from './session.ts';
import type { VibeSpawnOutcome } from './session.ts';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function refusalStatus(outcome: Extract<VibeSpawnOutcome, { ok: false }>): number {
  switch (outcome.reason) {
    case 'fleet-frozen':
      return 503;
    case 'unauthenticated':
      return 401;
    case 'rate-limited':
    case 'locked-out':
      return 429;
    default:
      return 500;
  }
}

export function registerVibeRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  const preHandler = requireSession(ctx.sessionConfig);

  scope.post('/api/vibe', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const prompt = typeof asRecord(req.body).prompt === 'string' ? (asRecord(req.body).prompt as string) : '';

    // Buffer any frame that fires before we start streaming. `claude` stdout is asynchronous, so in
    // practice nothing fires before spawnVibe returns synchronously — but buffering makes the ordering
    // race-proof regardless.
    const early: string[] = [];
    let raw: import('node:http').ServerResponse | null = null;
    const emit = (frame: unknown): void => {
      const line = `${JSON.stringify(frame)}\n`;
      if (raw) raw.write(line);
      else early.push(line);
    };

    const outcome = spawnVibe(
      prompt,
      { token: session?.token, config: ctx.sessionConfig },
      {
        onDelta: (model) => emit({ type: 'delta', model }),
        onStderr: (chunk) => emit({ type: 'stderr', chunk }),
        onExit: (code) => {
          emit({ type: 'exit', code });
          raw?.end();
        },
      },
      {
        repoRoot: ctx.repoRoot,
        runPreamble: ctx.runPreamble,
        spawn: ctx.spawn,
        rateLimitGuard: ctx.vibeRateGuard,
        appendAudit: ctx.appendAudit,
        runGit: ctx.opsGit,
        now: ctx.now,
      },
    );

    if (!outcome.ok) {
      // No `claude` output can have streamed (gate refused synchronously) — send a normal JSON error.
      return reply.code(refusalStatus(outcome)).send({
        error: outcome.reason,
        ...('problems' in outcome ? { problems: outcome.problems } : {}),
        ...('detail' in outcome ? { detail: outcome.detail } : {}),
        ...('retryAfterMs' in outcome ? { retryAfterMs: outcome.retryAfterMs } : {}),
      });
    }

    // Past all gates: stream. Hand the raw socket to us; flush any buffered early frames.
    reply.hijack();
    raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache',
      connection: 'close',
    });
    for (const line of early) raw.write(line);
    // Client disconnect kills the child (the stop wiring's client-abort path).
    req.raw.on('close', () => outcome.kill());
  });
}

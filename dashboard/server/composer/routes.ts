/**
 * C1 — the Composer turn route (RCE-equivalent live prompt, same threat model as vibe). Composed exactly
 * like `vibe/routes.ts`: a `requireSession` preHandler on the guarded scope, then hand off to
 * `composer/session.ts#spawnComposerTurn`, which is authoritative for every load-bearing gate — it
 * re-runs the preamble gate FIRST, re-verifies the session, applies the per-operator rate-limit/lockout,
 * and writes EXACTLY ONE audit row per attempt (spawned or refused). This route never reimplements any of
 * that; it only wires the resulting stream (or a calm refusal) onto the HTTP response, plus the one
 * Composer addition: a `session` frame relaying the CLI session id so the client can resume next turn.
 *
 *   POST /api/composer/turn  -> streams newline-delimited JSON frames: {type:'session',sessionId},
 *                               {type:'delta',model}, {type:'stderr',chunk}, {type:'exit',code}. A refusal
 *                               spawnComposerTurn returns synchronously (fleet-frozen / rate-limited /
 *                               locked-out / unauthenticated) is sent as a normal JSON error with a mapped
 *                               status, because no `claude` output can have streamed yet.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { spawnComposerTurn } from './session.ts';
import type { VibeSpawnOutcome } from '../vibe/session.ts';
import { isValidResumeId } from './resumeRegistry.ts';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/** Refusal -> HTTP status. Mirrors `vibe/routes.ts#refusalStatus` verbatim (a pure map, not a gate) so a
 *  Composer refusal reads identically to a vibe refusal. */
function refusalStatus(outcome: Extract<VibeSpawnOutcome, { ok: false }>): number {
  switch (outcome.reason) {
    case 'fleet-frozen':
      return 503;
    case 'unauthenticated':
      return 401;
    case 'rate-limited':
    case 'locked-out':
      return 429;
    case 'resume-denied':
      // review F1 — a well-formed but never-issued (or wrong-subject) resume id: a bad request.
      return 400;
    default:
      return 500;
  }
}

export function registerComposerRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  const preHandler = requireSession(ctx.sessionConfig);

  scope.post('/api/composer/turn', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
    const session = verifiedSession(req);
    const body = asRecord(req.body);
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    // A continuing turn carries the CLI session id captured from the previous turn's `session` frame.
    // review F1 — validate its SHAPE at the boundary BEFORE any spawn: it must be a canonical CLI
    // session UUID. Anything else present (traversal-shaped `../…`, flag-shaped `--foo`, empty) is a
    // 400 and never reaches the spawn path, so a malformed value can never become a `claude` argv token.
    const rawResume = body.resumeId;
    if (rawResume !== undefined && rawResume !== null && !isValidResumeId(rawResume)) {
      return reply.code(400).send({ error: 'invalid-resume-id', detail: 'resumeId must be a canonical CLI session id (UUID)' });
    }
    const resumeId = isValidResumeId(rawResume) ? rawResume : null;

    // Buffer any frame that fires before we start streaming. `claude` stdout is asynchronous, so in
    // practice nothing fires before spawnComposerTurn returns synchronously — but buffering makes the
    // ordering race-proof regardless (same posture as the vibe route).
    const early: string[] = [];
    let raw: import('node:http').ServerResponse | null = null;
    const emit = (frame: unknown): void => {
      const line = `${JSON.stringify(frame)}\n`;
      if (raw) raw.write(line);
      else early.push(line);
    };

    const outcome = spawnComposerTurn(
      prompt,
      resumeId,
      { token: session?.token, config: ctx.sessionConfig },
      {
        onSessionId: (sessionId) => emit({ type: 'session', sessionId }),
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
        // review F1 — the process-lifetime issued-session allowlist that binds `--resume`.
        resumeRegistry: ctx.resumeRegistry,
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

/**
 * The session-run REST surface: list, detail (with transcript), archive.
 *
 * Registered BESIDE `/api/pty` in the same origin-guarded child scope, and deliberately not inside
 * `server/control/`: these are session runs, not governed runs (see `sessionRuns.ts` for the doctrine).
 * Nothing here reads, writes, or imports control-plane state.
 *
 * ── Owner scoping is the whole security model ──
 *
 * Bearer-verified exactly like the existing `/api/pty/sessions` endpoints, and every store call is
 * scoped by that `sub`. A ref belonging to another operator answers 404, never 403 — an existence
 * oracle across operators would leak the shape of someone else's work. Transcripts get the same
 * treatment one step removed: the OWNER-SCOPED record is resolved first, and only its `ptySessionId`
 * (re-validated against the session-id grammar) is turned into a path. A transcript holds the
 * operator's own keystrokes, so no request-supplied string ever reaches the filesystem.
 *
 * ── Archive copies the governed run archive's SHAPE (spec §3b), by hand ──
 *
 * `server/control/routes.ts`'s run-archive endpoint is the house pattern for "dismiss a dead record":
 * session-gated, T3 audit row written BEFORE the mutation (a failed audit refuses the request, so
 * nothing is ever dismissed off the record), idempotency key, optional operator reason carried into the
 * audit detail, and no bulk endpoint — a clean-up stays auditable one record at a time. That shape is
 * COPIED here rather than imported, because the two records are different objects with different
 * lifecycles; the control-plane file is untouched.
 *
 * The one refusal that is new: a `live` session run cannot be archived. A running shell must be killed
 * through the existing close path first (`DELETE /api/pty/sessions/:id`, or the console's End session),
 * which ends the record and makes it archivable. Dismissing a record whose shell is still running would
 * orphan a process nothing surfaces any more.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { appendAudit as defaultAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow } from '../audit/log.ts';
import type { SessionConfig } from '../auth/session.ts';
import { SESSION_ID_RE } from './persistentSessions.ts';
import { SESSION_RUN_REF_RE, SessionRunStoreError } from './sessionRuns.ts';
import type { SessionRunRecord, SessionRunStore } from './sessionRuns.ts';
import type { TranscriptRecorder } from './transcripts.ts';
import { requireBearerOwner } from './route.ts';

/** Bound on transcript text returned by the detail endpoint — the recorder's own retained window. */
export const MAX_TRANSCRIPT_RESPONSE_BYTES = 512_000;

export interface SessionRunRouteContext {
  repoRoot: string;
  sessionConfig: SessionConfig;
  sessionRuns: SessionRunStore;
  transcripts?: TranscriptRecorder;
  appendAudit?: (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow | Promise<AuditRow>;
  auditOptions?: AppendAuditOptions;
  /**
   * Run the boot sweep (`live` → `abandoned`) at registration. Registration happens exactly once per
   * daemon boot and never during mere context construction, which is why the sweep is triggered here
   * rather than in `makeSurfaceContext` (tests build contexts freely and must not rewrite live state).
   */
  sweepOnRegister?: boolean;
  /** One-line sink for a boot-sweep refusal. Injected in tests; production writes to `console.warn`.
   *  Lines are bounded and carry only the store's own closed error code — never a path, ref or stack. */
  log?: (line: string) => void;
}

/** The public projection of a record. Identical to the stored shape today; kept explicit so a future
 *  internal field is not published by accident. */
export interface SessionRunDto {
  sessionRunRef: string;
  kind: 'agent' | 'workflow';
  targetRef: string;
  ptySessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: SessionRunRecord['outcome'];
  exitCode: number | null;
  transcript: { bytes: number; truncated: boolean } | null;
  version: number;
}

/** `owner` and `primingPath` are server-internal: one is the identity already proven by the bearer, the
 *  other is a filesystem path inside the daemon state root. Neither is anyone's business in a browser. */
export function toSessionRunDto(record: SessionRunRecord): SessionRunDto {
  return {
    sessionRunRef: record.sessionRunRef,
    kind: record.kind,
    targetRef: record.targetRef,
    ptySessionId: record.ptySessionId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    outcome: record.outcome,
    exitCode: record.exitCode,
    transcript: record.transcript ? { bytes: record.transcript.bytes, truncated: record.transcript.truncated } : null,
    version: record.version,
  };
}

function bodyRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function registerSessionRunRoutes(
  app: FastifyInstance,
  ctx: SessionRunRouteContext,
): Promise<void> {
  const auditFn = ctx.appendAudit ?? defaultAppendAudit;

  if (ctx.sweepOnRegister !== false) {
    // Nothing survives a daemon restart, so a `live` record that outlived the process is already false.
    // Correct it BEFORE the first request can read it. A sweep failure must not stop the daemon booting.
    try {
      await ctx.sessionRuns.sweepAbandoned();
    } catch (error) {
      // Booting is not negotiable on the sweep — but the refusal must not VANISH. A daemon whose v1 -> v2
      // migration refused used to boot clean, serve an empty session-run list and mint no ref cookies with
      // no signal anywhere. One bounded line here, plus the Health integrity row Health composes from
      // `migrationState()`, is that signal. Only the store's own closed code is printed: the underlying
      // error's message may name a path, and none of it belongs in a log the operator ships around.
      const code = error instanceof SessionRunStoreError ? error.code : 'unknown';
      (ctx.log ?? ((line: string) => { console.warn(line); }))(
        `pty session-run boot sweep refused: ${code}`,
      );
    }
  }

  // READ: my session runs, newest first. Archived records are excluded unless asked for — dismissing is
  // meant to make a list shorter, and a dismissal that changed nothing visible would be a lie.
  app.get('/api/pty/session-runs', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireBearerOwner(req, reply, ctx.sessionConfig);
    if (owner === undefined) return reply;
    const includeArchived = (req.query as { includeArchived?: unknown } | undefined)?.includeArchived === '1';
    try {
      const runs = ctx.sessionRuns.list(owner, { includeArchived });
      return reply.code(200).send({ sessionRuns: runs.map(toSessionRunDto) });
    } catch {
      return reply.code(503).send({ error: 'session-runs-unavailable' });
    }
  });

  // READ: one session run plus its transcript text, bounded.
  app.get('/api/pty/session-runs/:sessionRunRef', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireBearerOwner(req, reply, ctx.sessionConfig);
    if (owner === undefined) return reply;
    const ref = (req.params as { sessionRunRef?: unknown }).sessionRunRef;
    if (typeof ref !== 'string' || !SESSION_RUN_REF_RE.test(ref)) {
      return reply.code(404).send({ error: 'not-found' });
    }
    let record: SessionRunRecord | null;
    try {
      record = ctx.sessionRuns.get(owner, ref);
    } catch {
      return reply.code(503).send({ error: 'session-runs-unavailable' });
    }
    if (!record) return reply.code(404).send({ error: 'not-found' });
    // The path comes from the OWNER-SCOPED record's session id, re-validated against the registry's own
    // grammar — never from anything the caller sent.
    const transcript = ctx.transcripts && record.ptySessionId && SESSION_ID_RE.test(record.ptySessionId)
      ? ctx.transcripts.read(record.ptySessionId, MAX_TRANSCRIPT_RESPONSE_BYTES)
      : null;
    return reply.code(200).send({
      sessionRun: toSessionRunDto(record),
      transcript: transcript
        ? { text: transcript.text, bytes: transcript.bytes, truncated: transcript.truncated }
        : null,
    });
  });

  // WRITE: dismiss a dead session run. Copies the governed archive shape (see module doc).
  app.post('/api/pty/session-runs/:sessionRunRef/archive', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireBearerOwner(req, reply, ctx.sessionConfig);
    if (owner === undefined) return reply;
    const ref = (req.params as { sessionRunRef?: unknown }).sessionRunRef;
    if (typeof ref !== 'string' || !SESSION_RUN_REF_RE.test(ref)) {
      return reply.code(404).send({ error: 'not-found' });
    }
    const body = bodyRecord(req.body);
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
    const reason = body.reason == null ? null : typeof body.reason === 'string' ? body.reason : undefined;
    if (!idempotencyKey || idempotencyKey.length > 512 || reason === undefined) {
      return reply.code(400).send({
        error: 'invalid-archive',
        detail: 'idempotencyKey is required and reason must be text',
      });
    }

    let existing: SessionRunRecord | null;
    try {
      existing = ctx.sessionRuns.get(owner, ref);
    } catch {
      return reply.code(503).send({ error: 'session-runs-unavailable' });
    }
    if (!existing) return reply.code(404).send({ error: 'not-found' });
    if (existing.outcome === 'live') {
      return reply.code(409).send({
        error: 'session-run-live',
        detail: 'End the session first — a running shell cannot be dismissed from a list.',
      });
    }

    // Audit BEFORE the mutation, and refuse if it cannot be written: no record is ever dismissed off the
    // record. An already-archived record re-audits nothing (a replay is not a second decision).
    if (existing.outcome !== 'archived') {
      try {
        await auditFn(ctx.repoRoot, {
          action: 'pty-session-run-archive-authorize',
          owner,
          target: ref,
          riskTier: 'T3',
          result: `authorized:${idempotencyKey}`,
          detail: {
            sessionRunRef: ref,
            sessionRunVersion: existing.version,
            outcome: existing.outcome,
            kind: existing.kind,
            targetRef: existing.targetRef,
            reason,
          },
        }, ctx.auditOptions);
      } catch {
        return reply.code(500).send({ error: 'session-run-archive-audit-required' });
      }
    }

    let archived;
    try {
      archived = await ctx.sessionRuns.archive(owner, ref, { idempotencyKey, reason });
    } catch {
      return reply.code(503).send({ error: 'session-runs-unavailable' });
    }
    if (!archived.ok) {
      if (archived.error === 'not-found') return reply.code(404).send({ error: 'not-found' });
      if (archived.error === 'session-run-live') {
        return reply.code(409).send({
          error: 'session-run-live',
          detail: 'End the session first — a running shell cannot be dismissed from a list.',
        });
      }
      return reply.code(409).send({
        error: 'idempotency-conflict',
        detail: 'This idempotency key was already used for a different dismissal.',
      });
    }
    return reply.code(200).send({
      ok: true,
      sessionRun: toSessionRunDto(archived.value),
      replayed: archived.replayed,
    });
  });
}

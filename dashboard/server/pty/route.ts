/**
 * D3.1 (persistent sessions, 2026-07-19) — the browser↔shell terminal bridge: the governed `/api/pty`
 * WebSocket, now backed by a PERSISTENT session registry so a page reload no longer kills the shell.
 *
 * ARCHITECTURE ("working now, harden later", chosen with Daniel 2026-07-18): the terminal spawns
 * `node-pty` IN-PROCESS in the daemon and pumps bytes over the WebSocket — the standard web-terminal
 * design (VS Code, ttyd, wetty). `createPtyHost` (host.ts) strips every credential/token name from the
 * child, so a terminal here still cannot read the fleet's push token or API keys.
 *
 * PERSISTENCE: the socket no longer OWNS the shell. A `persistentSessions.ts` registry does — buffering
 * all output into a bounded ring and forwarding to at most one attached socket. A socket closing merely
 * DETACHES (shell keeps running, output keeps buffering); revisiting REATTACHES with a scrollback replay.
 * The shell dies only on (a) an explicit `{type:'close'}` from the UI, (b) the shell process exiting, or
 * (c) the daemon-shutdown drain (`ptyHost.stopAll` + `registry.clear`).
 *
 * Two entry shapes on one endpoint, chosen by an optional `?session=<id>` on the upgrade URL (the id is a
 * NON-SECRET reference — ownership is enforced server-side; the bearer token still rides ONLY the
 * subprotocol, never the URL):
 *   OPEN  (no param): origin → preamble → session → cap → create → audit 'opened' → attach (replay covers
 *                     the pre-audit startup window).
 *   ATTACH (param):   origin → preamble → session → audit 'pty-attach' → attach+replay (no cap; an attach
 *                     never consumes a slot). Unknown/exited/not-owned → one 'session-not-found' row + refuse.
 * Either way exactly ONE audit row is written per allowed-origin connection, and a `{type:'session'}`
 * control frame is sent to the browser FIRST so the client can bind its tab id before the replay flush.
 *
 * REST companion (same origin-guarded scope): `GET /api/pty/sessions` lists the caller's live sessions
 * and `DELETE /api/pty/sessions/:id` kills one — both bearer-verified with the SAME `verifySession`, no
 * audit (a read and a not-audited-today close, respectively).
 */
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertOrigin, resolveAllowedOrigins } from '../security/origin.ts';
import type { AllowedOrigins } from '../security/origin.ts';
import { resolveSessionSecret, resolveSessionTtlMs, verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { bearerToken } from '../http/middleware.ts';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import { appendAudit as defaultAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow } from '../audit/log.ts';
import { resolveRepoRoot } from '../http/surface.ts';
import type { PtyHost } from './host.ts';
import { createPersistentSessionRegistry, SESSION_ID_RE } from './persistentSessions.ts';
import type { PersistentSessionRegistry, SessionSink } from './persistentSessions.ts';

/** The negotiated subprotocol that carries `['kb-pty.v1', sessionToken]` from the browser. */
export const PTY_SUBPROTOCOL = 'kb-pty.v1';

/** Max simultaneous LIVE SESSIONS across the whole daemon — a hard backstop, not a per-request limit.
 *  Counted from `registry.liveCount()`; an attach to an existing session never consumes a slot.
 *
 *  Raised from 8 with the run roster (FYT gated-pipeline Task 4): roster agent terminals live in this same
 *  registry, so one active run already holds ~6 slots and the old ceiling left an operator unable to open
 *  a second terminal of their own. Opening a canvas tile is an ATTACH and still costs nothing. */
export const MAX_CONCURRENT_PTY = 16;

/** Initial shell geometry until the browser sends its first `{type:'resize'}` (matches xterm's default). */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** The minimal WebSocket surface the handler uses — lets tests drive it with a fake (record send/close,
 *  emit message/close/error). Matches the `ws` instance `@fastify/websocket` hands the route. */
export interface PtySocketLike {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err?: unknown) => void): void;
}

/** Everything a PTY connection needs, all hermetic-test-injectable. */
export interface PtyRouteContext {
  repoRoot: string;
  sessionConfig: SessionConfig;
  /** The Origin/Host allowlist; enforced by the scope guard AND re-checked defensively in-handler. */
  allowedOrigins?: AllowedOrigins;
  /** The in-process node-pty host (shared; the registry spawns/kills through it). Tests inject a fake. */
  ptyHost: PtyHost;
  /** The persistent session registry (shared by the WS route, the REST endpoints, and the drain). */
  registry: PersistentSessionRegistry;
  /** Fleet preamble runner. It is always invoked before session validation or spawn. */
  runPreamble: PreambleRunner;
  /** Independent audit sink. Tests inject a recorder, so no test writes `ledgers/audit/**`. Widened to
   *  allow a `Promise` — the real `appendAudit` now runs its git commit off the event loop. */
  appendAudit: (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow | Promise<AuditRow>;
  /** Optional git/time seams forwarded to the real audit implementation. */
  auditOptions?: AppendAuditOptions;
  /** The concurrency cap ceiling. Defaults to {@link MAX_CONCURRENT_PTY}. */
  maxConcurrent?: number;
}

/** Build a full {@link PtyRouteContext}, filling every unset field with its real default. The session
 *  secret is resolved ONCE here so the token this route verifies matches the one the write surface mints.
 *
 *  N4 (fail-closed host, 2026-08-03): `ptyHost` has NO default. The daemon's ONE pty host is the
 *  `fleetGatedPtyHost` built in `makeSurfaceContext`; every caller MUST pass it in. If none is supplied we
 *  THROW rather than fabricate a raw `createPtyHost` here — an ungated fallback would silently spawn a shell
 *  that bypasses the fleet gate (STOP/API-key/budget), so the safe failure is no context at all. Tests inject
 *  a fake host, so they are unaffected. */
export function makePtyRouteContext(overrides: Partial<PtyRouteContext> = {}): PtyRouteContext {
  if (overrides.ptyHost === undefined) {
    throw new Error(
      'makePtyRouteContext: ptyHost is required (fail-closed) — pass the fleet-gated host; ' +
        'no ungated fallback is created here',
    );
  }
  return {
    repoRoot: overrides.repoRoot ?? resolveRepoRoot(),
    sessionConfig:
      overrides.sessionConfig ?? { secret: resolveSessionSecret(), ttlMs: resolveSessionTtlMs() },
    allowedOrigins: overrides.allowedOrigins ?? resolveAllowedOrigins(),
    ptyHost: overrides.ptyHost,
    registry: overrides.registry ?? createPersistentSessionRegistry(),
    runPreamble: overrides.runPreamble ?? defaultPreambleRunner,
    appendAudit: overrides.appendAudit ?? defaultAppendAudit,
    auditOptions: overrides.auditOptions,
    maxConcurrent: overrides.maxConcurrent ?? MAX_CONCURRENT_PTY,
  };
}

/** Read the bearer session token from the offered subprotocols — NEVER from the URL. The browser offers
 *  `['kb-pty.v1', sessionToken]`, which arrives comma-joined in `sec-websocket-protocol`. */
export function tokenFromSubprotocol(req: Pick<FastifyRequest, 'headers'>): string | undefined {
  const offered = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((s) => s.trim());
  return offered[0] === PTY_SUBPROTOCOL ? offered[1] || undefined : undefined;
}

/** Parse the optional `session` attach reference off the upgrade URL's query string. The value is a
 *  non-secret sessionId (ownership enforced server-side); the token never appears here. */
export function sessionParamFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const q = url.indexOf('?');
  if (q < 0) return undefined;
  const value = new URLSearchParams(url.slice(q + 1)).get('session');
  return value && value.length > 0 ? value : undefined;
}

/** Parse one inbound client message as a control frame (`resize` or `close`), or null if it is raw stdin.
 *  Keystrokes are never JSON objects (they never start with `{`), so the fast-path reject keeps typing cheap. */
function parseControlFrame(raw: string): { type: 'resize'; cols: number; rows: number } | { type: 'close' } | null {
  if (raw.length === 0 || raw[0] !== '{') return null;
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    if (m && m.type === 'close') return { type: 'close' };
    if (
      m &&
      m.type === 'resize' &&
      typeof m.cols === 'number' &&
      typeof m.rows === 'number' &&
      m.cols > 0 &&
      m.rows > 0
    ) {
      return { type: 'resize', cols: Math.floor(m.cols), rows: Math.floor(m.rows) };
    }
  } catch {
    /* not JSON → raw stdin */
  }
  return null;
}

const isOpen = (socket: PtySocketLike): boolean => socket.readyState === socket.OPEN;

/**
 * Drive one `/api/pty` WebSocket end to end: gate it (origin → preamble → session, plus the cap on the
 * OPEN path), then either create a fresh persistent session or reattach to an existing one, multiplexing
 * bytes both ways through the registry. Exported so the whole path is hermetically testable with a fake
 * socket, preamble, audit sink, `ptyHost`, and registry.
 */
export async function handlePtyConnection(
  socket: PtySocketLike,
  req: Pick<FastifyRequest, 'headers' | 'url'>,
  ctx: PtyRouteContext,
): Promise<void> {
  const maxConcurrent = ctx.maxConcurrent ?? MAX_CONCURRENT_PTY;
  const registry = ctx.registry;
  const requestedSession = sessionParamFromUrl(req.url);
  const auditAction = requestedSession ? 'pty-attach' : 'pty-open';

  // Exactly one row for every connection that clears the Origin/Host boundary. The action distinguishes
  // an open attempt from an attach attempt; a socket close/error only reaps resources (no second row).
  const audit = async (result: string, owner?: string, detail: Record<string, unknown> = {}): Promise<void> => {
    await ctx.appendAudit(ctx.repoRoot, { action: auditAction, owner, result, detail }, ctx.auditOptions);
  };

  // 1. Defensive Origin/Host re-check (the scope guard already 403s a bad upgrade; this only bites if the
  //    route is ever mounted without the guard — mirrors `hub/ws.ts`).
  if (ctx.allowedOrigins !== undefined) {
    const result = assertOrigin(req as { headers: FastifyRequest['headers'] }, ctx.allowedOrigins);
    if (!result.ok) {
      socket.close(1008, result.reason ?? 'forbidden');
      return;
    }
  }

  // 2. Fleet preamble FIRST — STOP/API-key/budget refusal wins even for an invalid session. The check
  //    READS the shared ops checkout (budget/ledger/STOP), so it runs under the ops-transaction lock:
  //    a concurrent transaction's pull --rebase shifts those files mid-read and yields a FALSE
  //    fleet-frozen (observed live on a terminal reattach). Reentrant, so callers already holding
  //    the lock are unaffected.
  const preamble = await withOpsTransaction(async () => assertFleetRunnable(ctx.repoRoot, ctx.runPreamble));
  if (!preamble.ok) {
    await audit('fleet-frozen', undefined, { problems: preamble.problems });
    if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'fleet-frozen' }));
    socket.close(1008, 'fleet-frozen');
    return;
  }

  // 3. Session gate — must be signed in. The token rides the subprotocol, never the URL.
  const token = tokenFromSubprotocol(req);
  const session = token ? verifySession(token, ctx.sessionConfig) : null;
  if (!session || !session.ok) {
    await audit('unauthenticated');
    if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'unauthenticated' }));
    socket.close(1008, 'unauthenticated');
    return;
  }
  const owner = session.claims.sub;

  // A sink over this socket. `send`/`closed` relay bytes; `onExit` closes the socket when the shell dies;
  // `onEvicted` closes it (with an error frame) when a newer socket supersedes this attach.
  const makeSink = (): SessionSink => ({
    send: (chunk) => {
      if (isOpen(socket)) socket.send(chunk);
    },
    closed: () => !isOpen(socket),
    onExit: () => {
      if (isOpen(socket)) socket.close(1000, 'shell exited');
    },
    onEvicted: () => {
      if (isOpen(socket)) {
        socket.send(JSON.stringify({ type: 'error', reason: 'session-superseded' }));
        socket.close(1008, 'superseded');
      }
    },
  });

  // Browser → shell: `{type:'resize'}` resizes, `{type:'close'}` kills the session (explicit operator
  // close — the ONE UI-driven death), everything else is raw stdin. Closes are NOT audited.
  const wireInput = (sessionId: string): void => {
    socket.on('message', (data: unknown) => {
      const raw = typeof data === 'string' ? data : String(data);
      const control = parseControlFrame(raw);
      if (control?.type === 'resize') {
        registry.resize(owner, sessionId, control.cols, control.rows);
        return;
      }
      if (control?.type === 'close') {
        registry.close(owner, sessionId);
        if (isOpen(socket)) socket.close(1000, 'closed by operator');
        return;
      }
      registry.write(owner, sessionId, raw);
    });
  };

  // ── ATTACH PATH ────────────────────────────────────────────────────────────────────────────────────
  if (requestedSession) {
    const check = registry.canAttach(owner, requestedSession);
    if (!check.ok) {
      // Unknown / exited / not-owned all collapse to one browser-facing refusal + one audit row.
      await audit('session-not-found', owner, { sessionId: requestedSession, reason: check.reason });
      if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'session-not-found' }));
      socket.close(1008, 'session-not-found');
      return;
    }
    // Audit BEFORE attach/replay: no shell byte reaches the browser until the attach is durably recorded
    // (fail-closed). If the audit throws, nothing was attached, so there is nothing to detach.
    try {
      await audit('attached', owner, { sessionId: requestedSession });
    } catch {
      if (isOpen(socket)) {
        socket.send(JSON.stringify({ type: 'error', reason: 'audit-failed' }));
        socket.close(1011, 'audit-failed');
      }
      return;
    }
    const sink = makeSink();
    socket.on('close', () => registry.detach(requestedSession, sink));
    socket.on('error', () => registry.detach(requestedSession, sink));
    wireInput(requestedSession);
    // Bind frame first, then the replay flush lands after it.
    if (isOpen(socket)) socket.send(JSON.stringify({ type: 'session', sessionId: requestedSession }));
    const attached = registry.attach(owner, requestedSession, sink);
    if (!attached.ok) {
      // Rare race: the shell exited between canAttach and attach. Refuse without a second audit row.
      if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'session-not-found' }));
      socket.close(1008, 'session-not-found');
    }
    return;
  }

  // ── OPEN PATH ──────────────────────────────────────────────────────────────────────────────────────
  // 4. Concurrency cap — count LIVE SESSIONS, refuse over the ceiling BEFORE spawning anything.
  if (registry.liveCount() >= maxConcurrent) {
    await audit('too-many-terminals', owner, { maxConcurrent });
    if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'too-many-terminals' }));
    socket.close(1013, 'too many terminals');
    return;
  }

  // 5. Create the persistent session. `create` spawns via the host and starts buffering IMMEDIATELY, so
  //    the shell's banner/first prompt emitted during the async audit below is captured, never dropped.
  let created: { sessionId: string; createdAt: number };
  try {
    created = registry.create(owner, ctx.ptyHost, {
      requestId: '',
      cwd: ctx.repoRoot,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });
  } catch (err) {
    await audit('spawn-failed', owner, { error: (err as Error).message });
    if (isOpen(socket)) {
      socket.send(JSON.stringify({ type: 'error', reason: 'spawn-failed' }));
      socket.close(1011, (err as Error).message);
    }
    return;
  }
  const sessionId = created.sessionId;

  // Opening the shell is the consequential action. If its audit cannot be recorded, fail closed: kill the
  // just-created session, close the WS, and contain the exception here.
  try {
    await audit('opened', owner, { sessionId });
  } catch {
    registry.close(owner, sessionId);
    if (isOpen(socket)) {
      socket.send(JSON.stringify({ type: 'error', reason: 'audit-failed' }));
      socket.close(1011, 'audit-failed');
    }
    return;
  }

  const sink = makeSink();
  // Socket close/error DETACHES only — the shell survives a reload and keeps buffering.
  socket.on('close', () => registry.detach(sessionId, sink));
  socket.on('error', () => registry.detach(sessionId, sink));
  wireInput(sessionId);
  // Bind frame first, then attach replays the buffered pre-audit startup output after it.
  if (isOpen(socket)) socket.send(JSON.stringify({ type: 'session', sessionId }));
  registry.attach(owner, sessionId, sink);
}

/** Verify the bearer on a REST request the same way the WS verifies its subprotocol token. Returns the
 *  owner `sub` on success, or replies 401 and returns undefined. */
function requireBearerOwner(
  req: FastifyRequest,
  reply: FastifyReply,
  sessionConfig: SessionConfig,
): string | undefined {
  const token = bearerToken(req);
  const check = token ? verifySession(token, sessionConfig) : { ok: false as const, reason: 'malformed' as const };
  if (!check.ok) {
    void reply.code(401).send({ error: 'unauthenticated', reason: check.reason });
    return undefined;
  }
  return check.claims.sub;
}

/**
 * Register `/api/pty` (WS) plus the `/api/pty/sessions` REST endpoints on `app`. Register the WS plugin
 * FIRST, then the caller wraps this in an origin-guarded child scope (see `server/index.ts`) — the
 * scope's Origin/Host hook covers the REST routes too. One shared registry per registration; a shutdown
 * `onClose` drains it (kill every PTY, forget every entry).
 */
export async function registerPtyRoute(
  app: FastifyInstance,
  ctx: PtyRouteContext = makePtyRouteContext(),
): Promise<void> {
  await app.register(fastifyWebsocket);

  app.get('/api/pty', { websocket: true }, (socket, req) => {
    void handlePtyConnection(socket as unknown as PtySocketLike, req, ctx);
  });

  // REST: list my live sessions (read — no audit). Bearer verified exactly like the WS.
  app.get('/api/pty/sessions', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireBearerOwner(req, reply, ctx.sessionConfig);
    if (owner === undefined) return reply;
    return reply.code(200).send({ sessions: ctx.registry.list(owner) });
  });

  // REST: kill one of my sessions (close is not audited today either). 404 unknown/not-owned/malformed.
  app.delete('/api/pty/sessions/:sessionId', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireBearerOwner(req, reply, ctx.sessionConfig);
    if (owner === undefined) return reply;
    const sessionId = (req.params as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
      return reply.code(404).send({ error: 'not-found' });
    }
    const result = ctx.registry.close(owner, sessionId);
    if (!result.ok) return reply.code(404).send({ error: 'not-found', reason: result.reason });
    return reply.code(200).send({ ok: true });
  });

  // Daemon shutdown drain: kill every live PTY and forget every registry entry so no shell is orphaned.
  app.addHook('onClose', async () => {
    try {
      ctx.ptyHost.stopAll();
    } catch {
      /* best-effort */
    }
    ctx.registry.clear();
  });
}

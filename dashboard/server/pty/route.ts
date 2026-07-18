/**
 * D3.1 (simplified 2026-07-18) — the browser↔shell terminal bridge: the governed `/api/pty` WebSocket.
 *
 * ARCHITECTURE CHANGE ("working now, harden later", chosen with Daniel 2026-07-18): the terminal now spawns
 * `node-pty` IN-PROCESS in the daemon and pumps bytes straight over the WebSocket — the standard web-terminal
 * design (VS Code, ttyd, wetty). The former browser→daemon→named-pipe→cross-user kb-fleet host→node-pty stack
 * (with a per-open host-verified Factor C passkey over a per-connection nonce) was retired: its ASYNC passkey
 * ceremony spliced between two SYNCHRONOUS blocking pipe calls broke the open every time (the `open` frame
 * never reached the host after the touch). The shell now runs as the DAEMON's user with an allowlisted env —
 * `createPtyHost` (host.ts) still strips every credential/token name from the child, so a terminal here still
 * cannot read the fleet's push token or API keys. Remaining gates: the Origin/Host allowlist, the shared
 * fleet preamble (STOP/API-key/budget) BEFORE session validation, a signed-in session (bearer token from
 * the `kb-pty.v1` subprotocol), a hard concurrency cap, and exactly one independent audit row per
 * allowed-origin connection attempt. Each WebSocket is its own independent shell. Re-introducing the
 * isolated-identity host + per-open passkey is a future hardening milestone; until then this route runs
 * the credential-env-filtered child under the dashboard daemon's OS identity.
 */
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertOrigin, resolveAllowedOrigins } from '../security/origin.ts';
import type { AllowedOrigins } from '../security/origin.ts';
import { resolveSessionSecret, resolveSessionTtlMs, verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { appendAudit as defaultAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow } from '../audit/log.ts';
import { resolveRepoRoot } from '../http/surface.ts';
import { createPtyHost } from './host.ts';
import type { PtyHost, PtySession } from './host.ts';

/** The negotiated subprotocol that carries `['kb-pty.v1', sessionToken]` from the browser. */
export const PTY_SUBPROTOCOL = 'kb-pty.v1';

/** Max simultaneous terminals across the whole daemon — a hard backstop, not a per-request rate-limit. */
export const MAX_CONCURRENT_PTY = 8;

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

/** A mutable, per-registration counter of live PTY connections (the concurrency cap's backing state). */
export interface PtyConcurrency {
  active: number;
}

/** Everything a PTY connection needs, all hermetic-test-injectable. */
export interface PtyRouteContext {
  repoRoot: string;
  sessionConfig: SessionConfig;
  /** The Origin/Host allowlist; enforced by the scope guard AND re-checked defensively in-handler. */
  allowedOrigins?: AllowedOrigins;
  /** The in-process node-pty host (shared; tracks every live session). Tests inject a fake. */
  ptyHost: PtyHost;
  /** Fleet preamble runner. It is always invoked before session validation or spawn. */
  runPreamble: PreambleRunner;
  /** Independent audit sink. Tests inject a recorder, so no test writes `ledgers/audit/**`. */
  appendAudit: (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow;
  /** Optional git/time seams forwarded to the real audit implementation. */
  auditOptions?: AppendAuditOptions;
  /** The concurrency cap ceiling. Defaults to {@link MAX_CONCURRENT_PTY}. */
  maxConcurrent?: number;
  /** Shared live-connection counter. Defaults to a fresh `{ active: 0 }` per context. */
  concurrency?: PtyConcurrency;
}

/** Build a full {@link PtyRouteContext}, filling every unset field with its real default. The session
 *  secret is resolved ONCE here so the token this route verifies matches the one the write surface mints. */
export function makePtyRouteContext(overrides: Partial<PtyRouteContext> = {}): PtyRouteContext {
  return {
    repoRoot: overrides.repoRoot ?? resolveRepoRoot(),
    sessionConfig:
      overrides.sessionConfig ?? { secret: resolveSessionSecret(), ttlMs: resolveSessionTtlMs() },
    allowedOrigins: overrides.allowedOrigins ?? resolveAllowedOrigins(),
    ptyHost: overrides.ptyHost ?? createPtyHost({ shell: 'powershell.exe' }),
    runPreamble: overrides.runPreamble ?? defaultPreambleRunner,
    appendAudit: overrides.appendAudit ?? defaultAppendAudit,
    auditOptions: overrides.auditOptions,
    maxConcurrent: overrides.maxConcurrent ?? MAX_CONCURRENT_PTY,
    concurrency: overrides.concurrency ?? { active: 0 },
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

/** Parse one inbound client message as a `resize` control frame, or null if it is raw stdin. Keystrokes
 *  are never JSON objects (they never start with `{`), so the fast-path reject keeps normal typing cheap. */
function parseResize(raw: string): { cols: number; rows: number } | null {
  if (raw.length === 0 || raw[0] !== '{') return null;
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    if (
      m &&
      m.type === 'resize' &&
      typeof m.cols === 'number' &&
      typeof m.rows === 'number' &&
      m.cols > 0 &&
      m.rows > 0
    ) {
      return { cols: Math.floor(m.cols), rows: Math.floor(m.rows) };
    }
  } catch {
    /* not JSON → raw stdin */
  }
  return null;
}

/**
 * Drive one `/api/pty` WebSocket end to end: gate it (origin → preamble → session → concurrency),
 * spawn a shell PTY in-process, and multiplex bytes both ways. Exported so the whole path is hermetically
 * testable with a fake socket, preamble, audit sink, and `ptyHost`.
 */
export async function handlePtyConnection(
  socket: PtySocketLike,
  req: Pick<FastifyRequest, 'headers' | 'url'>,
  ctx: PtyRouteContext,
): Promise<void> {
  const concurrency = ctx.concurrency ?? { active: 0 };
  const maxConcurrent = ctx.maxConcurrent ?? MAX_CONCURRENT_PTY;

  // Exactly one row for every connection that clears the Origin/Host boundary. Every outcome below calls
  // this once; socket close/error only reaps resources and never adds a second row for the open attempt.
  const audit = (result: string, owner?: string, detail: Record<string, unknown> = {}): void => {
    ctx.appendAudit(ctx.repoRoot, { action: 'pty-open', owner, result, detail }, ctx.auditOptions);
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

  // 2. Fleet preamble FIRST — STOP/API-key/budget refusal wins even for an invalid session. Nothing
  //    downstream (session verification, cap reservation, or spawn) runs on failure.
  const preamble = assertFleetRunnable(ctx.repoRoot, ctx.runPreamble);
  if (!preamble.ok) {
    audit('fleet-frozen', undefined, { problems: preamble.problems });
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'error', reason: 'fleet-frozen' }));
    }
    socket.close(1008, 'fleet-frozen');
    return;
  }

  // 3. Session gate — must be signed in. The token rides the subprotocol, never the URL.
  const token = tokenFromSubprotocol(req);
  const session = token ? verifySession(token, ctx.sessionConfig) : null;
  if (!session || !session.ok) {
    audit('unauthenticated');
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'error', reason: 'unauthenticated' }));
    }
    socket.close(1008, 'unauthenticated');
    return;
  }
  const owner = session.claims.sub;

  // 4. Concurrency cap — refuse an upgrade over the ceiling cleanly, BEFORE spawning anything.
  if (concurrency.active >= maxConcurrent) {
    audit('too-many-terminals', owner, { maxConcurrent });
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'error', reason: 'too-many-terminals' }));
    }
    socket.close(1013, 'too many terminals');
    return;
  }
  concurrency.active += 1;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    concurrency.active -= 1;
  };

  // 5. Spawn the shell IN-PROCESS (node-pty). No pipe, no cross-user host, no passkey ceremony. The child
  //    env is credential-stripped by `createPtyHost` (host.ts allowlist + denylist).
  let ptySession: PtySession;
  try {
    ptySession = ctx.ptyHost.open({
      requestId: '',
      cwd: ctx.repoRoot,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });
  } catch (err) {
    audit('spawn-failed', owner, { error: (err as Error).message });
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'error', reason: 'spawn-failed' }));
      socket.close(1011, (err as Error).message);
    }
    release();
    return;
  }

  // Install lifecycle cleanup IMMEDIATELY after spawn, before any post-spawn operation that can throw
  // (notably the independent audit append/commit below). Once a PTY exists, every exit path must own it.
  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
    try {
      ctx.ptyHost.stop(ptySession.sessionId); // kills the shell's whole process group
    } catch {
      /* best-effort reap */
    }
    release();
  };
  socket.on('close', () => teardown());
  socket.on('error', () => teardown());

  // Shell output → browser; a shell exit closes the socket.
  ptySession.handle.onExit(() => {
    if (socket.readyState === socket.OPEN) socket.close(1000, 'shell exited');
    teardown();
  });

  // Opening the shell completes the consequential action. If its audit cannot be recorded, fail closed:
  // reap the already-live PTY, release its reserved slot, close the WS, and contain the exception here.
  try {
    audit('opened', owner, { sessionId: ptySession.sessionId });
  } catch {
    teardown();
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'error', reason: 'audit-failed' }));
      socket.close(1011, 'audit-failed');
    }
    return;
  }

  ptySession.handle.onData((chunk: string) => {
    if (socket.readyState === socket.OPEN) socket.send(chunk);
  });

  // Browser → shell: a `{type:'resize'}` control frame resizes the PTY; every other message is raw stdin.
  socket.on('message', (data: unknown) => {
    if (torn) return;
    const raw = typeof data === 'string' ? data : String(data);
    const resize = parseResize(raw);
    if (resize) {
      try {
        ptySession.handle.resize(resize.cols, resize.rows);
      } catch {
        /* the PTY may have just exited — ignore */
      }
      return;
    }
    try {
      ptySession.handle.write(raw); // raw keystrokes → the shell's stdin
    } catch {
      /* the PTY may have just exited — ignore */
    }
  });
}

/**
 * Register `/api/pty` on `app`. Register the WS plugin FIRST (so a refused upgrade's raw socket is torn
 * down by the plugin's own cleanup), then the caller wraps this in an origin-guarded child scope (see
 * `server/index.ts`). One shared concurrency counter per registration.
 */
export async function registerPtyRoute(
  app: FastifyInstance,
  ctx: PtyRouteContext = makePtyRouteContext(),
): Promise<void> {
  await app.register(fastifyWebsocket);
  const concurrency = ctx.concurrency ?? { active: 0 };
  const boundCtx: PtyRouteContext = { ...ctx, concurrency };

  app.get('/api/pty', { websocket: true }, (socket, req) => {
    void handlePtyConnection(socket as unknown as PtySocketLike, req, boundCtx);
  });
}

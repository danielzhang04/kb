/**
 * P3 W6.4 - the ONE registered browser PTY surface: `WS /api/pty` plus its two REST companions.
 *
 * CLOSED BY CONSTRUCTION. The upgrade URL carries NO query at all: no `session`, no `spawn`, no `agent`,
 * no `workflow`, no `command`, no `host`. Everything a browser may ask for arrives as a typed
 * {@link BrowserClientFrame} AFTER the socket is established, and the first frame must be `create` or
 * `attach`. A create names a launcher enum, a registered safe-root id, a normalized relative cwd and a
 * geometry - never an executable, an argv, an environment blob, a uid, a token, or an address. The
 * browser never chooses a session id; the registry mints it.
 *
 * AUTH HOOK ORDER (strict, pinned by `route.test.ts`):
 *   1. `onRequest`     Origin/Host allowlist -> 403. Fail-closed: an empty allowlist refuses everything.
 *   2. `onRequest`     the surface rate-limit hook -> 429.
 *   3. `preValidation` operator session (`resolveSession`) -> 401.
 *   4. `preValidation` browser principal (`resolveBrowserPrincipal`) -> 428 when the `kb_browser_session`
 *                      cookie is absent, malformed, unknown or expired. There is NO operator-only
 *                      principal: without the cookie half, the PTY operation is refused.
 *   5. `preValidation` any query key at all -> 400, before the upgrade.
 * Every refusal happens before 101, before any frame decode, and before the host or registry is touched.
 *
 * The registry is the W3 `SessionRecordRegistry` behind {@link SessionRegistryPort}; the host is the
 * platform `SessionHost` composed in `http/surface.ts` (Windows `windowsSessionHost`, Linux
 * `linuxBrokerClient`). This module owns no process, no spawn decision and no path: it decodes frames,
 * enforces the principal, and forwards to the port.
 */
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertOrigin, resolveAllowedOrigins } from '../security/origin.ts';
import type { AllowedOrigins } from '../security/origin.ts';
import {
  resolveBrowserPrincipal,
  resolveSessionSecret,
  resolveSessionTtlMs,
} from '../auth/session.ts';
import type { BrowserSessionRefManager, SessionConfig } from '../auth/session.ts';
import { resolveSession } from '../http/middleware.ts';
import type { SessionRequestLike } from '../http/middleware.ts';
import { appendAudit as defaultAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow } from '../audit/log.ts';
import { resolveRepoRoot } from '../http/surface.ts';
import type {
  Attachment,
  BrowserPrincipal,
  ObservedExit,
  SessionDataFrame,
  SessionRegistryPort,
  SessionSink,
} from './contracts.ts';
import { isSafeRelativeCwd } from './brokerProtocol.ts';
import type { SessionPersistence } from './sessionPersistence.ts';
import { PTY_OUTBOUND_HIGH_WATER_BYTES } from '../../shared/ptyProtocol.ts';
import type {
  BrowserClientFrame,
  BrowserServerFrame,
  PublicExit,
  SafeRootId,
  SessionLauncher,
  SessionSummary,
} from '../../shared/ptyProtocol.ts';

/** The negotiated subprotocol that carries `['kb-pty.v1', sessionToken]` from the browser. */
export const PTY_SUBPROTOCOL = 'kb-pty.v1';

/**
 * RAW browser frame ceiling, applied by `ws` itself BEFORE a byte is parsed (`maxPayload`). A frame
 * above this closes the socket at the transport, so an oversized payload can never reach `JSON.parse`,
 * the decoder, or a base64 expansion. This is the BROWSER bound frozen by the contract; the broker's
 * own `maxFrameBytes` (98,304) is a separate constant owned by the broker, because the broker frame
 * wraps a browser payload plus its envelope.
 */
export const PTY_MAX_PAYLOAD_BYTES = 90_112;

/** Largest single decoded stdin chunk one `input` frame may carry (the broker's `maxInputBytes`). */
export const PTY_MAX_INPUT_BYTES = 65_536;

/** How long `DELETE /api/pty/sessions/:sessionId` waits for the host's OBSERVED exit before 409. */
export const PTY_CLOSE_TIMEOUT_MS = 10_000;

/** v2 session ids are minted by the registry; the route only ever validates the shape it is handed. */
export const SESSION_ID_RE = /^pty-[0-9a-f]{32}$/;
const ATTACHMENT_ID_RE = /^att-[0-9a-f]{32}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The minimal WebSocket surface the handler uses - lets tests drive it with a fake. */
export interface PtySocketLike {
  readonly OPEN: number;
  readonly readyState: number;
  /** Bytes queued in the transport but not yet flushed. Absent on a transport that cannot report it. */
  readonly bufferedAmount?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err?: unknown) => void): void;
}

/**
 * Read-only transcript replay for a reattach. Never a control path: it can only return bytes.
 * [C-R6]: every number here is a BYTE OFFSET in the session's output stream. `replayFrom` is where the
 * reader actually started — higher than the requested `fromSequence` when the bytes in between are no
 * longer retained — and `nextSequence` is the offset one past the last byte returned.
 */
export type SessionReplayReader = (
  sessionId: string,
  fromSequence: number,
) => Promise<{ frames: { sequence: number; encoding: 'base64'; data: string }[];
  replayFrom: number; nextSequence: number }>;

/** Everything one registered PTY surface needs, all hermetic-test-injectable. */
export interface PtyRouteContext {
  repoRoot: string;
  sessionConfig: SessionConfig;
  /** The Origin/Host allowlist. Installed as this scope's FIRST `onRequest` hook. */
  allowedOrigins: AllowedOrigins;
  /** Installed as the SECOND `onRequest` hook, so a refused origin is never rate-accounted. */
  rateLimitHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** The one v2 session registry (W3 `createSessionRecordRegistry`) for the process. */
  registry: SessionRegistryPort;
  /** The one v2 document port - read for the exact composite `revision` every reply carries. */
  persistence: SessionPersistence;
  /** The browser-session-ref store; the second half of every principal comes from it. */
  browserSessionRefs?: BrowserSessionRefManager;
  /** Read-only replay used on reattach. Absent = attach without scrollback, never a control fallback. */
  replay?: SessionReplayReader;
  /** DELETE close deadline; defaults to `PTY_CLOSE_TIMEOUT_MS`. Injected only so tests can prove 409. */
  closeTimeoutMs?: number;
  appendAudit: (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow | Promise<AuditRow>;
  auditOptions?: AppendAuditOptions;
}

export function makePtyRouteContext(
  overrides: Partial<PtyRouteContext> & Pick<PtyRouteContext, 'registry' | 'persistence'>,
): PtyRouteContext {
  return {
    repoRoot: overrides.repoRoot ?? resolveRepoRoot(),
    sessionConfig:
      overrides.sessionConfig ?? { secret: resolveSessionSecret(), ttlMs: resolveSessionTtlMs() },
    allowedOrigins: overrides.allowedOrigins ?? resolveAllowedOrigins(),
    registry: overrides.registry,
    persistence: overrides.persistence,
    appendAudit: overrides.appendAudit ?? defaultAppendAudit,
    ...(overrides.rateLimitHook ? { rateLimitHook: overrides.rateLimitHook } : {}),
    ...(overrides.browserSessionRefs ? { browserSessionRefs: overrides.browserSessionRefs } : {}),
    ...(overrides.replay ? { replay: overrides.replay } : {}),
    ...(overrides.auditOptions ? { auditOptions: overrides.auditOptions } : {}),
    ...(overrides.closeTimeoutMs !== undefined ? { closeTimeoutMs: overrides.closeTimeoutMs } : {}),
  };
}

/** Read the bearer session token from the offered subprotocols - NEVER from the URL. */
export function tokenFromSubprotocol(req: Pick<FastifyRequest, 'headers'>): string | undefined {
  const offered = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((s) => s.trim());
  return offered[0] === PTY_SUBPROTOCOL ? offered[1] || undefined : undefined;
}

/**
 * `/api/pty` accepts NO query string. Generic unknown keys and duplicates are refused identically, and
 * every historically meaningful key (`spawn`, `agent`, `workflow`, `session`, `command`, `host`, ...) is
 * refused by the same rule rather than by an allowlist that could grow a hole.
 */
export function hasAnyQuery(url: string | undefined): boolean {
  if (url === undefined) return false;
  const q = url.indexOf('?');
  if (q < 0) return false;
  return url.slice(q + 1).length > 0;
}

const LAUNCHERS: readonly SessionLauncher[] = ['shell', 'claude', 'codex'];
const ROOTS: readonly SafeRootId[] = ['repo', 'worktrees'];

function str(value: unknown): value is string {
  return typeof value === 'string';
}

function geometry(cols: unknown, rows: unknown): boolean {
  return Number.isSafeInteger(cols) && (cols as number) >= 20 && (cols as number) <= 500
    && Number.isSafeInteger(rows) && (rows as number) >= 5 && (rows as number) <= 200;
}

/**
 * Strict decode of ONE inbound browser frame. Unknown types, missing members, extra-typed members with
 * the wrong shape, and out-of-range geometry all yield `null` - there is no coercion and no default. A
 * `null` costs the connection one `error` frame, never a partially-honoured request.
 */
export function decodeBrowserClientFrame(raw: string): BrowserClientFrame | null {
  if (raw.length === 0 || raw.charCodeAt(0) !== 0x7b) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  const requestId = frame.requestId;
  if (!str(requestId) || !REQUEST_ID_RE.test(requestId)) return null;
  switch (frame.type) {
    case 'create': {
      const { launcher, rootId, relativeCwd, cols, rows } = frame;
      if (!str(launcher) || !LAUNCHERS.includes(launcher as SessionLauncher)) return null;
      if (!str(rootId) || !ROOTS.includes(rootId as SafeRootId)) return null;
      if (typeof relativeCwd !== 'string' || Buffer.byteLength(relativeCwd, 'utf8') > 240) return null;
      if (!geometry(cols, rows)) return null;
      return {
        type: 'create',
        requestId,
        launcher: launcher as SessionLauncher,
        rootId: rootId as SafeRootId,
        relativeCwd,
        cols: cols as number,
        rows: rows as number,
      };
    }
    case 'attach': {
      const { sessionId, fromSequence } = frame;
      if (!str(sessionId) || !SESSION_ID_RE.test(sessionId)) return null;
      if (!Number.isSafeInteger(fromSequence) || (fromSequence as number) < 0) return null;
      return { type: 'attach', requestId, sessionId, fromSequence: fromSequence as number };
    }
    case 'input': {
      const { sessionId, attachmentId, encoding, data } = frame;
      if (!str(sessionId) || !SESSION_ID_RE.test(sessionId)) return null;
      if (!str(attachmentId) || !ATTACHMENT_ID_RE.test(attachmentId)) return null;
      if (encoding !== 'base64' || !str(data)) return null;
      if (Buffer.byteLength(data, 'utf8') > PTY_MAX_INPUT_BYTES * 2) return null;
      return { type: 'input', requestId, sessionId, attachmentId, encoding: 'base64', data };
    }
    case 'resize': {
      const { sessionId, attachmentId, cols, rows } = frame;
      if (!str(sessionId) || !SESSION_ID_RE.test(sessionId)) return null;
      if (!str(attachmentId) || !ATTACHMENT_ID_RE.test(attachmentId)) return null;
      if (!geometry(cols, rows)) return null;
      return { type: 'resize', requestId, sessionId, attachmentId, cols: cols as number, rows: rows as number };
    }
    case 'close': {
      const { sessionId } = frame;
      if (!str(sessionId) || !SESSION_ID_RE.test(sessionId)) return null;
      return { type: 'close', requestId, sessionId };
    }
    case 'detach': {
      const { sessionId, attachmentId } = frame;
      if (!str(sessionId) || !SESSION_ID_RE.test(sessionId)) return null;
      if (!str(attachmentId) || !ATTACHMENT_ID_RE.test(attachmentId)) return null;
      return { type: 'detach', requestId, sessionId, attachmentId };
    }
    default:
      return null;
  }
}

export function publicExit(exit: ObservedExit): PublicExit {
  return { exitCode: exit.exitCode, reason: exit.reason, observedAt: exit.observedAt };
}

const isOpen = (socket: PtySocketLike): boolean => socket.readyState === socket.OPEN;

/**
 * The composite document revision every reply carries. An unreadable document is reported as `0` rather
 * than failing the reply: the revision is a cache/ordering hint, never authority.
 */
function compositeRevision(ctx: PtyRouteContext): number {
  try {
    return ctx.persistence.read().revision;
  } catch {
    return 0;
  }
}

/**
 * Drive one `/api/pty` WebSocket end to end. The principal is ALREADY proven by `preValidation`; this
 * function never re-derives one and never accepts an operator-only caller.
 */
export async function handlePtyConnection(
  socket: PtySocketLike,
  principal: BrowserPrincipal,
  ctx: PtyRouteContext,
): Promise<void> {
  const attachments = new Map<string, Attachment>();
  /** Sessions whose exit THIS connection has observed. A settled session is read-only, server-side. */
  const ended = new Set<string>();
  let disposed = false;

  const currentAttachmentId = (sessionId: string): string =>
    attachments.get(sessionId)?.attachmentId ?? '';

  // A socket close DETACHES every attachment it holds; the session itself survives for reattach.
  const teardown = (): void => {
    if (disposed) return;
    disposed = true;
    for (const attachment of attachments.values()) void attachment.detach().catch(() => {});
    attachments.clear();
  };

  /**
   * Outbound backpressure. A PTY can produce faster than a browser drains, and `SessionSink` offers no
   * pause/resume seam (a sink can only answer `closed()`), so a reader that lets the transport buffer
   * cross {@link PTY_OUTBOUND_HIGH_WATER_BYTES} loses its attachments and its socket instead of the
   * daemon losing its memory. The frame in hand IS dropped — but not silently: the close carries code
   * 1013, the browser says output outpaced the connection, and the reattach replays the retained tail
   * from the client's byte cursor, so the operator both hears about it and gets the bytes back.
   */
  const dropForBackpressure = (): void => {
    teardown();
    socket.close(1013, 'backpressure');
  };
  const overHighWater = (): boolean =>
    typeof socket.bufferedAmount === 'number' && socket.bufferedAmount > PTY_OUTBOUND_HIGH_WATER_BYTES;

  const send = (frame: BrowserServerFrame): void => {
    // A connection that has been torn down writes nothing more — not the tail of a replay it was in the
    // middle of, and not the output that shed it. `disposed` is set before the close code goes out.
    if (disposed || !isOpen(socket)) return;
    if (overHighWater()) {
      dropForBackpressure();
      return;
    }
    socket.send(JSON.stringify(frame));
  };
  const fail = (
    requestId: string | null,
    sessionId: string | null,
    code: Extract<BrowserServerFrame, { type: 'error' }>['code'],
    detail: string | null,
  ): void => {
    send({ type: 'error', requestId, sessionId, code, detail });
  };

  const revision = (): number => compositeRevision(ctx);

  /**
   * An attach installs its sink BEFORE the scrollback has been read off disk, so between those two
   * moments the host can produce output that belongs strictly AFTER the replay. A hold buffers exactly
   * that window: while `frames` is an array the sink queues instead of sending, and the attach drains it
   * as soon as the last replayed frame is on the wire. The client therefore sees one possible order —
   * `attached`, replay, buffered live, live — and never has to sort by sequence to recover it.
   *
   * The buffer is bounded by the SAME high-water mark as the socket: a session that produces a megabyte
   * while its scrollback is being read is shedding a reader either way, so it sheds it the same way.
   */
  type OutboundHold = { frames: BrowserServerFrame[] | null; bytes: number };

  const sinkFor = (hold?: OutboundHold): SessionSink => {
    const emit = (frame: BrowserServerFrame, bytes: number): void => {
      if (hold?.frames == null) {
        send(frame);
        return;
      }
      hold.bytes += bytes;
      if (hold.bytes > PTY_OUTBOUND_HIGH_WATER_BYTES) {
        hold.frames = null;
        dropForBackpressure();
        return;
      }
      hold.frames.push(frame);
    };
    return {
      data: (frame: SessionDataFrame) => {
        emit({
          type: 'data',
          requestId: null,
          sessionId: frame.sessionId,
          attachmentId: currentAttachmentId(frame.sessionId),
          sequence: frame.sequence,
          encoding: 'base64',
          data: frame.data,
          replay: frame.replay,
        }, frame.data.length);
      },
      exit: (exit: ObservedExit) => {
        ended.add(exit.sessionId);
        emit({ type: 'exit', requestId: null, sessionId: exit.sessionId, sequence: exit.sequence, exit: publicExit(exit) }, 0);
      },
      closed: () => disposed || !isOpen(socket),
    };
  };

  const onCreate = async (frame: Extract<BrowserClientFrame, { type: 'create' }>): Promise<void> => {
    // Normalize the legacy root spelling before applying the broker's canonical safety rule.
    const relativeCwd = frame.relativeCwd === '.' ? '' : frame.relativeCwd;
    if (!isSafeRelativeCwd(relativeCwd)) {
      fail(frame.requestId, null, 'unsafe-cwd', 'relativeCwd is unsafe');
      return;
    }
    const created = await ctx.registry.create(principal, {
      launcher: frame.launcher,
      rootId: frame.rootId,
      relativeCwd,
      cols: frame.cols,
      rows: frame.rows,
    });
    if (!created.ok) {
      fail(frame.requestId, null, created.refusal, created.detail);
      return;
    }
    const attached = await ctx.registry.attach(principal, created.value.sessionId, sinkFor());
    if (!attached.ok) {
      fail(frame.requestId, created.value.sessionId, attached.refusal, attached.detail);
      return;
    }
    attachments.set(created.value.sessionId, attached.value);
    send({
      type: 'created',
      requestId: frame.requestId,
      revision: revision(),
      session: attached.value.session,
      attachmentId: attached.value.attachmentId,
    });
  };

  const onAttach = async (frame: Extract<BrowserClientFrame, { type: 'attach' }>): Promise<void> => {
    // Held from the instant the sink exists until the scrollback has been flushed. Nothing the host
    // produces in that window may overtake the bytes it comes after.
    const hold: OutboundHold = { frames: [], bytes: 0 };
    const attached = await ctx.registry.attach(principal, frame.sessionId, sinkFor(hold));
    if (!attached.ok) {
      hold.frames = null;
      fail(frame.requestId, frame.sessionId, attached.refusal, attached.detail);
      return;
    }
    attachments.set(frame.sessionId, attached.value);
    const replayed = ctx.replay
      ? await ctx.replay(frame.sessionId, frame.fromSequence)
      : { frames: [], replayFrom: frame.fromSequence, nextSequence: frame.fromSequence };
    send({
      type: 'attached',
      requestId: frame.requestId,
      revision: revision(),
      session: attached.value.session,
      attachmentId: attached.value.attachmentId,
      replayFrom: replayed.replayFrom,
      nextSequence: replayed.nextSequence,
    });
    for (const entry of replayed.frames) {
      send({
        type: 'data',
        requestId: null,
        sessionId: frame.sessionId,
        attachmentId: attached.value.attachmentId,
        sequence: entry.sequence,
        encoding: 'base64',
        data: entry.data,
        replay: true,
      });
    }
    const held = hold.frames;
    hold.frames = null;
    for (const queued of held ?? []) {
      // A frame queued before `attachments.set` could not know its attachment id; it does now.
      send(queued.type === 'data' && queued.attachmentId === ''
        ? { ...queued, attachmentId: attached.value.attachmentId }
        : queued);
    }
  };

  const owns = (sessionId: string, attachmentId: string): boolean =>
    attachments.get(sessionId)?.attachmentId === attachmentId;

  const onFrame = async (frame: BrowserClientFrame): Promise<void> => {
    switch (frame.type) {
      case 'create':
        return onCreate(frame);
      case 'attach':
        return onAttach(frame);
      case 'input': {
        // Server-side read-only. Once an exit has settled, this session accepts no more control traffic —
        // the browser's `replay` mode is defence in depth on top of this, never the enforcement.
        if (ended.has(frame.sessionId)) {
          fail(frame.requestId, frame.sessionId, 'invalid-request', 'session-ended');
          return;
        }
        if (!owns(frame.sessionId, frame.attachmentId)) {
          fail(frame.requestId, frame.sessionId, 'not-found', null);
          return;
        }
        const bytes = Buffer.from(frame.data, 'base64');
        if (bytes.byteLength > PTY_MAX_INPUT_BYTES) {
          fail(frame.requestId, frame.sessionId, 'input-too-large', null);
          return;
        }
        const written = await ctx.registry.write(principal, frame.sessionId, new Uint8Array(bytes));
        if (!written.ok) {
          fail(frame.requestId, frame.sessionId, written.refusal, written.detail);
          return;
        }
        send({
          type: 'ack',
          requestId: frame.requestId,
          action: 'input',
          sessionId: frame.sessionId,
          revision: revision(),
          accepted: written.value.accepted,
        });
        return;
      }
      case 'resize': {
        if (ended.has(frame.sessionId)) {
          fail(frame.requestId, frame.sessionId, 'invalid-request', 'session-ended');
          return;
        }
        if (!owns(frame.sessionId, frame.attachmentId)) {
          fail(frame.requestId, frame.sessionId, 'not-found', null);
          return;
        }
        const resized = await ctx.registry.resize(principal, frame.sessionId, { cols: frame.cols, rows: frame.rows });
        if (!resized.ok) {
          fail(frame.requestId, frame.sessionId, resized.refusal, resized.detail);
          return;
        }
        send({
          type: 'ack',
          requestId: frame.requestId,
          action: 'resize',
          sessionId: frame.sessionId,
          revision: revision(),
          size: { cols: frame.cols, rows: frame.rows },
        });
        return;
      }
      case 'close': {
        const closed = await ctx.registry.close(principal, frame.sessionId);
        if (!closed.ok) {
          fail(frame.requestId, frame.sessionId, closed.refusal, closed.detail);
          return;
        }
        attachments.delete(frame.sessionId);
        ended.add(frame.sessionId);
        send({
          type: 'ack',
          requestId: frame.requestId,
          action: 'close',
          sessionId: frame.sessionId,
          revision: revision(),
          exit: publicExit(closed.value),
        });
        return;
      }
      case 'detach': {
        const attachment = attachments.get(frame.sessionId);
        if (!attachment || attachment.attachmentId !== frame.attachmentId) {
          fail(frame.requestId, frame.sessionId, 'not-found', null);
          return;
        }
        await attachment.detach();
        attachments.delete(frame.sessionId);
        send({
          type: 'ack',
          requestId: frame.requestId,
          action: 'detach',
          sessionId: frame.sessionId,
          revision: revision(),
          attachmentId: frame.attachmentId,
        });
        return;
      }
    }
  };

  // Frames are serialized: one in-flight registry call at a time, so an `input` can never overtake the
  // `create` that mints the session it names.
  let queue: Promise<void> = Promise.resolve();
  socket.on('message', (data: unknown) => {
    const raw = typeof data === 'string' ? data : String(data);
    const frame = decodeBrowserClientFrame(raw);
    if (frame === null) {
      send({ type: 'error', requestId: null, sessionId: null, code: 'invalid-request', detail: null });
      return;
    }
    queue = queue.then(() => onFrame(frame)).catch(() => {
      send({ type: 'error', requestId: frame.requestId, sessionId: null, code: 'internal', detail: null });
    });
  });

  socket.on('close', teardown);
  socket.on('error', teardown);
}

/**
 * Register the PTY surface on `app`, installing this scope's hooks in the exact order the spec pins.
 * The caller passes an ALREADY-ISOLATED child scope; nothing else may be registered on it.
 */
export async function registerPtyRoute(app: FastifyInstance, ctx: PtyRouteContext): Promise<void> {
  // 1. Origin/Host, fail-closed on an empty allowlist.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const result = assertOrigin(req as { headers: FastifyRequest['headers'] }, ctx.allowedOrigins);
    if (!result.ok) {
      await reply.code(403).send({ error: 'forbidden', reason: result.reason ?? 'origin' });
    }
  });
  // 2. Rate limit - never reached by a refused origin. Installed DIRECTLY, so whatever the hook returns
  // (a promise, a refusal) is Fastify's to await, not a wrapper's to swallow.
  if (ctx.rateLimitHook) app.addHook('onRequest', ctx.rateLimitHook);

  await app.register(fastifyWebsocket, { options: { maxPayload: PTY_MAX_PAYLOAD_BYTES } });

  /** 3./4./5. operator -> browser principal -> query. Every refusal precedes 101 and the decoder. */
  const preValidation = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const check = resolveSession(req as unknown as SessionRequestLike, ctx.sessionConfig, tokenFromSubprotocol(req));
    if (!check.ok) {
      await reply.code(check.status).send({ error: check.error, reason: check.reason });
      return;
    }
    const principal = await resolveBrowserPrincipal(
      check.claims.sub,
      req.headers.cookie,
      ctx.browserSessionRefs,
    );
    if (principal === null) {
      await reply.code(428).send({ error: 'browser-session-required' });
      return;
    }
    if (hasAnyQuery(req.url)) {
      await reply.code(400).send({ error: 'bad-request', reason: 'query-not-accepted' });
      return;
    }
    (req as FastifyRequest & { ptyPrincipal?: BrowserPrincipal }).ptyPrincipal = principal;
  };

  app.get('/api/pty', { websocket: true, preValidation }, (socket, req) => {
    const principal = (req as FastifyRequest & { ptyPrincipal?: BrowserPrincipal }).ptyPrincipal;
    if (principal === undefined) {
      (socket as unknown as PtySocketLike).close(1008, 'browser-session-required');
      return;
    }
    void handlePtyConnection(socket as unknown as PtySocketLike, principal, ctx);
  });

  app.get('/api/pty/sessions', { preValidation }, async (req: FastifyRequest, reply: FastifyReply) => {
    const principal = (req as FastifyRequest & { ptyPrincipal?: BrowserPrincipal }).ptyPrincipal as BrowserPrincipal;
    const sessions: SessionSummary[] = await ctx.registry.list(principal);
    return reply.code(200).send({ revision: compositeRevision(ctx), sessions });
  });

  app.delete('/api/pty/sessions/:sessionId', { preValidation }, async (req: FastifyRequest, reply: FastifyReply) => {
    const principal = (req as FastifyRequest & { ptyPrincipal?: BrowserPrincipal }).ptyPrincipal as BrowserPrincipal;
    const sessionId = (req.params as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
      return reply.code(404).send({ error: 'not-found' });
    }
    // 409 belongs to the DEADLINE alone: the close was asked for and no exit was observed in time.
    // A registry fault is a fault, not an unconfirmed exit, so it is 500.
    const timeoutMs = ctx.closeTimeoutMs ?? PTY_CLOSE_TIMEOUT_MS;
    let deadline: NodeJS.Timeout | undefined;
    const timedOut = Symbol('close-deadline');
    const closed = await Promise.race([
      ctx.registry.close(principal, sessionId),
      new Promise<typeof timedOut>((resolve) => { deadline = setTimeout(() => resolve(timedOut), timeoutMs); }),
    ]).finally(() => { if (deadline !== undefined) clearTimeout(deadline); });
    if (closed === timedOut) return reply.code(409).send({ error: 'exit-unconfirmed' });
    if (!closed.ok) {
      // An absent or foreign session is 404 (never leaking another controller's ids).
      if (closed.refusal === 'internal') return reply.code(500).send({ error: 'internal' });
      return reply.code(404).send({ error: 'not-found', reason: closed.refusal });
    }
    return reply.code(200).send({ ok: true, exit: publicExit(closed.value) });
  });
}

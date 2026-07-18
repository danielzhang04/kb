/**
 * D3.1 — the browser↔host PTY bridge's SERVER half: the governed `/api/pty` WebSocket.
 *
 * This is the missing wire between the (already-built, already-LIVE) PTY host stack and the browser
 * terminal. It owns NO security policy of its own beyond transport hygiene — it delegates every gate to
 * the pieces that already exist:
 *
 *   - Origin/Host allowlist  → `originPlugin` on this route's OWN child scope (403, never upgrades), with
 *     a defensive in-handler `assertOrigin` re-check (mirrors `hub/ws.ts`).
 *   - Preamble (STOP/API-key/budget) FIRST, then the WebAuthn session gate, then the single audit row →
 *     ALL owned by `openPty` (`hostClient.ts`). The route pre-verifies NOTHING itself: a route-level
 *     session check would reorder session ahead of the preamble and produce an UNAUDITED rejection. So
 *     the route hands `{ token, config }` straight to `openPty` and maps the outcome. Exactly one audit
 *     row per WS connection — the route writes ZERO.
 *   - Factor C (hardware passkey) → RELAYED, never minted here. The route's `assertionProvider` sends the
 *     host-issued `challenge` (a public nonce) to THIS browser and resolves with the browser's assertion.
 *     The server performs no WebAuthn verification of the PTY assertion — that is the host's job.
 *
 * Framing is PHASE-based (not per-frame tagging): while `openPty` is resolving the assertion the browser
 * WS carries only control envelopes (`challenge`/`assertion`/`error` — reusing `PtyControlMessage`);
 * after `open-ack` it carries raw PTY bytes both ways. Bytes never flow before the ceremony completes
 * (the host spawns nothing until `open-ack`), so one phase flag replaces any per-frame discriminator.
 *
 * The bearer session token rides ONLY the `kb-pty.v1` subprotocol value — NEVER the URL (keeps it out of
 * access logs / history). The browser WS never carries the boot token or the daemon↔host nonce; the route
 * forwards only `data` chunks (via `connection.onData`) toward the browser.
 */
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertOrigin } from '../security/origin.ts';
import type { AllowedOrigins } from '../security/origin.ts';
import { resolveSessionSecret, resolveSessionTtlMs } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { resolveAllowedOrigins } from '../security/origin.ts';
import { resolveRepoRoot } from '../http/surface.ts';
import { openPty as defaultOpenPty } from './hostClient.ts';
import type { HostConnection, OpenPtyDeps, OpenPtyOutcome, PtyAssertionProvider } from './hostClient.ts';
import type { PtyAssertion } from './ptyProtocol.ts';
import { parseControlMessage } from '../../src/lib/ptyAssertionClient.ts';

/** The negotiated subprotocol that carries `['kb-pty.v1', sessionToken]` from the browser. */
export const PTY_SUBPROTOCOL = 'kb-pty.v1';

/**
 * Max simultaneous fleet terminals. `/api/pty` is deliberately NOT behind the per-request write
 * rate-limiter (that hook is shaped for short HTTP requests; a long-lived WS upgrade fits it poorly).
 * Instead abuse is bounded by the session gate + one-touch-per-open + this hard concurrency cap: an
 * upgrade over the cap is refused with a clean close, before `openPty` (so the host is never signalled).
 */
export const MAX_CONCURRENT_PTY = 8;

/** Bound the relayed-assertion wait so a walked-away operator fails closed. The browser ceremony itself
 *  is 60s (`ptyAssertionClient.ts`); allow a little headroom over it. */
export const ASSERTION_RELAY_TIMEOUT_MS = 65_000;

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

/** Everything a PTY connection needs, all hermetic-test-injectable (mirrors `makeSurfaceContext`). */
export interface PtyRouteContext {
  repoRoot: string;
  sessionConfig: SessionConfig;
  /** The Origin/Host allowlist; enforced by the scope guard AND re-checked defensively in-handler. */
  allowedOrigins?: AllowedOrigins;
  /** The open path. Defaults to the real `openPty`; tests inject a fake. */
  openPty?: (
    session: { token: string | undefined; config: SessionConfig },
    deps: OpenPtyDeps,
  ) => Promise<OpenPtyOutcome>;
  /** Extra `openPty` deps (transport / channelAuth / appendAudit) — production passes none, tests inject. */
  openPtyDeps?: Partial<OpenPtyDeps>;
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
    openPty: overrides.openPty ?? defaultOpenPty,
    openPtyDeps: overrides.openPtyDeps,
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

/** A refusal reason from `openPty` (the `ok:false` variants). */
type OpenPtyRefusal = Extract<OpenPtyOutcome, { ok: false }>['reason'];

/** Map an `openPty` refusal to a WS close code. Reason strings are the machine-readable signal; codes are
 *  advisory (1008 policy, 1011 server error). */
function closeCodeFor(reason: OpenPtyRefusal): number {
  return reason === 'host-unreachable' ? 1011 : 1008;
}

/**
 * Drive one `/api/pty` WebSocket end to end. Exported (not just closed over the route) so the whole
 * relay is hermetically testable with a fake socket + fake `openPty`/transport.
 *
 * Phase machine: `awaiting-assertion` (inbound messages parsed as control; the one `assertion` resolves
 * the relay promise; raw keystrokes are DROPPED — nothing is spawned yet) → `streaming` (inbound messages
 * are raw stdin → `connection.write`; `connection.onData` → `socket.send`). Fail-closed everywhere: a
 * socket close/error before the assertion rejects the relay promise so `openPty` fails closed and the host
 * spawns nothing.
 */
export async function handlePtyConnection(
  socket: PtySocketLike,
  req: Pick<FastifyRequest, 'headers' | 'url'>,
  ctx: PtyRouteContext,
): Promise<void> {
  const concurrency = ctx.concurrency ?? { active: 0 };
  const maxConcurrent = ctx.maxConcurrent ?? MAX_CONCURRENT_PTY;

  // Defensive Origin/Host re-check (the scope guard already 403s a bad upgrade; this only bites if the
  // route is ever mounted without the guard — mirrors `hub/ws.ts`).
  if (ctx.allowedOrigins !== undefined) {
    const result = assertOrigin(req as { headers: FastifyRequest['headers'] }, ctx.allowedOrigins);
    if (!result.ok) {
      socket.close(1008, result.reason ?? 'forbidden');
      return;
    }
  }

  // Concurrency cap — refuse an upgrade over the ceiling cleanly, BEFORE signalling `openPty`.
  if (concurrency.active >= maxConcurrent) {
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

  const token = tokenFromSubprotocol(req);

  type Phase = 'awaiting-assertion' | 'streaming' | 'closed';
  // A mutable holder so TS does not narrow `phase` to its initializer literal across the `await openPty`
  // (the phase is flipped inside async socket callbacks the analyzer cannot see).
  const st: { phase: Phase; connection: HostConnection | null } = { phase: 'awaiting-assertion', connection: null };
  let resolveAssertion: ((a: PtyAssertion) => void) | undefined;
  let rejectAssertion: ((err: Error) => void) | undefined;
  let relayTimer: ReturnType<typeof setTimeout> | undefined;

  const clearRelayTimer = (): void => {
    if (relayTimer) {
      clearTimeout(relayTimer);
      relayTimer = undefined;
    }
  };

  // The heart of the bridge: relay the host-issued challenge to THIS browser and await its assertion.
  const assertionProvider: PtyAssertionProvider = (challenge) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'challenge', challenge }));
    }
    return new Promise<PtyAssertion>((resolve, reject) => {
      resolveAssertion = resolve;
      rejectAssertion = reject;
      relayTimer = setTimeout(
        () => reject(new Error('assertion relay timed out (fail-closed)')),
        ASSERTION_RELAY_TIMEOUT_MS,
      );
    });
  };

  // Register socket listeners BEFORE awaiting `openPty` — the browser's assertion arrives as a `message`
  // while `openPty` is blocked inside the relay provider.
  socket.on('message', (data: unknown) => {
    const raw = typeof data === 'string' ? data : String(data);
    if (st.phase === 'awaiting-assertion') {
      // Control-only phase: expect exactly one `{type:'assertion'}`. Raw keystrokes here are DROPPED
      // (nothing is spawned yet, so there is no stdin sink).
      const msg = parseControlMessage(raw);
      if (msg && msg.type === 'assertion') {
        clearRelayTimer();
        resolveAssertion?.(msg.assertion);
      }
      return;
    }
    if (st.phase === 'streaming' && st.connection) {
      st.connection.write(raw); // raw stdin → the host's PTY
    }
  });
  socket.on('close', () => {
    if (st.phase === 'awaiting-assertion') {
      clearRelayTimer();
      rejectAssertion?.(new Error('browser WS closed before assertion (fail-closed)'));
    }
    st.phase = 'closed';
    st.connection?.close(); // the host kills the PTY process group
    release();
  });
  socket.on('error', () => {
    if (st.phase === 'awaiting-assertion') {
      clearRelayTimer();
      rejectAssertion?.(new Error('browser WS errored before assertion (fail-closed)'));
    }
    st.phase = 'closed';
    st.connection?.close();
    release();
  });

  // Delegate the FULL gate chain (preamble FIRST → session → host signal → single audit row) to `openPty`.
  const openPty = ctx.openPty ?? defaultOpenPty;
  let outcome: OpenPtyOutcome;
  try {
    outcome = await openPty(
      { token, config: ctx.sessionConfig },
      { repoRoot: ctx.repoRoot, assertionProvider, ...ctx.openPtyDeps },
    );
  } catch (err) {
    // `openPty` maps its own failures to outcomes; a throw here is unexpected — fail closed.
    clearRelayTimer();
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'error', reason: 'host-unreachable' }));
      socket.close(1011, (err as Error).message);
    }
    st.phase = 'closed';
    release();
    return;
  }

  if (st.phase === 'closed') {
    // The socket already went away while `openPty` was resolving — tear down the (possibly opened) session.
    if (outcome.ok) outcome.connection.close();
    return;
  }

  if (!outcome.ok) {
    clearRelayTimer();
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'error', reason: outcome.reason }));
      socket.close(closeCodeFor(outcome.reason), outcome.reason);
    }
    st.phase = 'closed';
    release();
    return;
  }

  // Ceremony passed and the host spawned the PTY. Wire the byte pump — ONLY now, so no PTY byte can
  // precede a completed assertion. Resize is DEFERRED (no cols/rows-change protocol this pass; the shell
  // opens at `openPty`'s default 80×24 geometry — add a `{type:'resize'}` control frame later if wanted).
  st.connection = outcome.connection;
  st.phase = 'streaming';
  st.connection.onData((chunk: string) => {
    if (socket.readyState === socket.OPEN) socket.send(chunk);
  });
  st.connection.onExit(() => {
    if (socket.readyState === socket.OPEN) socket.close(1000, 'pty exited');
  });
}

/**
 * Register `/api/pty` on `app`. Mirror `registerReadWs`: register the WS plugin FIRST (so a refused
 * upgrade's raw socket is torn down by the plugin's own cleanup), then the caller wraps this in an
 * origin-guarded child scope (see `server/index.ts`). One shared concurrency counter per registration.
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

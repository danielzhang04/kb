/**
 * D3.1 — hermetic tests for the browser↔host PTY bridge's server half (`route.ts`). Every test drives
 * the exported `handlePtyConnection` seam with a FAKE WebSocket (records send/close, emits message/close/
 * error) and the REAL `openPty` behind a FAKE host transport (reusing the seam style of
 * `hostClient.test.ts`) — so the single-audit-row and fail-closed invariants are genuinely exercised
 * without a real pipe, passkey, PTY, or `ledgers/audit/**` write.
 *
 * The load-bearing properties proven here: origin reject → no upgrade path; no session → one
 * `unauthenticated` audit row + no challenge relayed; the host `challenge` is relayed to the browser and
 * the browser `assertion` is relayed back; bytes pump both ways ONLY after a completed assertion (and raw
 * keystrokes during the handshake are dropped); a declined/absent assertion fails closed with exactly one
 * audit row and no byte pump; a frozen preamble refuses before the host is ever contacted.
 */
import { describe, expect, it } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import type { PtyAssertion } from './ptyProtocol.ts';
import type { HostChannelAuth, HostConnection, OpenPtyRequest, PtyAssertionProvider } from './hostClient.ts';
import { handlePtyConnection, tokenFromSubprotocol, makePtyRouteContext, MAX_CONCURRENT_PTY } from './route.ts';
import type { PtyRouteContext, PtySocketLike } from './route.ts';

const SECRET = Buffer.from('pty-route-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };
const ALLOWED = ['http://localhost:4317'];
const GOOD_ASSERTION: PtyAssertion = {
  credentialId: 'cred-1',
  authenticatorData: 'auth-1',
  clientDataJSON: 'cdj-1',
  signature: 'sig-1',
};

function okPreamble(): PreambleRunner {
  return () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
}
function frozenPreamble(problem: string): PreambleRunner {
  return () => ({ exitCode: 2, stdout: `PREAMBLE FAIL: ${problem}\n`, stderr: '' });
}
function validToken(sub = 'operator-1'): string {
  return mintSession(sub, SESSION_CONFIG).token;
}

/** Records every `appendAudit` call so tests assert exactly-one-row-per-connection. */
function recordingAppendAudit(): {
  fn: (repoRoot: string, event: AuditEvent) => AuditRow;
  rows: Array<{ repoRoot: string; event: AuditEvent }>;
} {
  const rows: Array<{ repoRoot: string; event: AuditEvent }> = [];
  const fn = (repoRoot: string, event: AuditEvent): AuditRow => {
    rows.push({ repoRoot, event });
    return { ts: 'fixed-ts', ...event };
  };
  return { fn, rows };
}

/**
 * A fake WS. `send`/`close` are recorded; `emit` drives inbound message/close/error. When `autoAssert` is
 * set, a `{type:'challenge'}` send auto-triggers a cooperative `{type:'assertion'}` reply on the next
 * microtask — modelling a browser that immediately touches the passkey.
 */
function fakeSocket(opts: { autoAssert?: PtyAssertion } = {}) {
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const listeners: { message: Array<(d: unknown) => void>; close: Array<() => void>; error: Array<(e?: unknown) => void> } = {
    message: [],
    close: [],
    error: [],
  };
  let readyState = 1;
  const sock = {
    OPEN: 1,
    get readyState() {
      return readyState;
    },
    send(data: string) {
      sent.push(data);
      if (opts.autoAssert) {
        try {
          const msg = JSON.parse(data) as { type?: string };
          if (msg.type === 'challenge') {
            const assertion = opts.autoAssert;
            queueMicrotask(() => emit('message', JSON.stringify({ type: 'assertion', assertion })));
          }
        } catch {
          /* not JSON — ignore */
        }
      }
    },
    close(code?: number, reason?: string) {
      closes.push({ code, reason });
      readyState = 3;
      for (const cb of [...listeners.close]) cb();
    },
    on(ev: 'message' | 'close' | 'error', cb: (...args: unknown[]) => void) {
      listeners[ev].push(cb as never);
    },
  };
  function emit(ev: 'message' | 'close' | 'error', arg?: unknown): void {
    for (const cb of [...listeners[ev]]) (cb as (a?: unknown) => void)(arg);
  }
  const controls = (): Array<Record<string, unknown>> =>
    sent
      .map((s) => {
        try {
          return JSON.parse(s) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((v): v is Record<string, unknown> => v !== null);
  return { sock: sock as unknown as PtySocketLike, sent, closes, emit, controls };
}

/**
 * A fake host transport whose `requestOpen` runs the real two-phase shape: relay a `challenge` via the
 * provider, await the browser's assertion, then either ack (streaming) or throw (fail-closed). Records the
 * assertion it received and exposes `emitData`/`emitExit` to drive the streaming pump.
 */
function fakeTransport(opts: { challenge?: string; sessionId?: string; failOpen?: boolean } = {}) {
  const connects: HostChannelAuth[] = [];
  const writes: string[] = [];
  const captured: { assertion?: PtyAssertion; challengeSent?: string } = {};
  let closed = false;
  const dataCbs: Array<(chunk: string) => void> = [];
  const exitCbs: Array<(code: number | null) => void> = [];
  let provider: PtyAssertionProvider | undefined;

  const conn: HostConnection = {
    async requestOpen(_req: OpenPtyRequest) {
      const challenge = opts.challenge ?? 'host-challenge-1';
      captured.challengeSent = challenge;
      // Phase 1+2: relay the challenge to the browser and await the assertion (rejects fail-closed).
      captured.assertion = await provider!(challenge);
      if (opts.failOpen) throw new Error('PTY host refused the open (fail-closed)');
      return { sessionId: opts.sessionId ?? 'pty-1' };
    },
    onData(cb) {
      dataCbs.push(cb);
    },
    onExit(cb) {
      exitCbs.push(cb);
    },
    write(d) {
      writes.push(d);
    },
    resize() {},
    close() {
      closed = true;
    },
  };
  const transport = (auth: HostChannelAuth, assertionProvider: PtyAssertionProvider): HostConnection => {
    connects.push(auth);
    provider = assertionProvider;
    return conn;
  };
  return {
    transport,
    connects,
    writes,
    captured,
    isClosed: () => closed,
    emitData: (chunk: string) => dataCbs.forEach((cb) => cb(chunk)),
    emitExit: (code: number | null) => exitCbs.forEach((cb) => cb(code)),
  };
}

/** Build a hermetic route context: real `openPty`, injected preamble/audit/transport, test allowlist. */
function routeCtx(overrides: {
  audit?: ReturnType<typeof recordingAppendAudit>;
  transport?: ReturnType<typeof fakeTransport>['transport'];
  preamble?: PreambleRunner;
  concurrency?: { active: number };
  maxConcurrent?: number;
}): PtyRouteContext {
  const audit = overrides.audit ?? recordingAppendAudit();
  return makePtyRouteContext({
    repoRoot: '/repo',
    sessionConfig: SESSION_CONFIG,
    allowedOrigins: ALLOWED,
    concurrency: overrides.concurrency,
    maxConcurrent: overrides.maxConcurrent,
    openPtyDeps: {
      runPreamble: overrides.preamble ?? okPreamble(),
      appendAudit: audit.fn,
      channelAuth: { pipePath: '\\\\.\\pipe\\kb-pty-host', bootToken: 'boot-xyz' },
      requestId: () => 'req-fixed',
      transport: overrides.transport,
    },
  });
}

function req(headers: Record<string, string | undefined>, url = '/api/pty') {
  return { headers, url } as unknown as Parameters<typeof handlePtyConnection>[1];
}

const GOOD_HEADERS = (token?: string): Record<string, string | undefined> => ({
  host: 'localhost:4317',
  origin: 'http://localhost:4317',
  'sec-websocket-protocol': token ? `kb-pty.v1, ${token}` : 'kb-pty.v1',
});

describe('tokenFromSubprotocol — bearer token from the subprotocol, NEVER the URL', () => {
  it('reads the second offered subprotocol value after kb-pty.v1', () => {
    expect(tokenFromSubprotocol({ headers: { 'sec-websocket-protocol': 'kb-pty.v1, tok-abc' } })).toBe('tok-abc');
  });
  it('ignores a token placed anywhere but the subprotocol (e.g. the URL)', () => {
    // No subprotocol token → undefined, regardless of any `?token=` in the URL (never parsed).
    expect(tokenFromSubprotocol({ headers: { 'sec-websocket-protocol': 'kb-pty.v1' } })).toBeUndefined();
    expect(tokenFromSubprotocol({ headers: {} })).toBeUndefined();
  });
  it('returns undefined when the first offered subprotocol is not kb-pty.v1', () => {
    expect(tokenFromSubprotocol({ headers: { 'sec-websocket-protocol': 'other, tok-abc' } })).toBeUndefined();
  });
});

describe('handlePtyConnection — origin reject (defensive in-handler re-check)', () => {
  it('closes 1008 on a bad Origin/Host and never signals the host', async () => {
    const ft = fakeTransport();
    const audit = recordingAppendAudit();
    const { sock, closes, controls } = fakeSocket();
    await handlePtyConnection(
      sock,
      req({ host: 'evil.example', origin: 'http://evil.example', 'sec-websocket-protocol': `kb-pty.v1, ${validToken()}` }),
      routeCtx({ audit, transport: ft.transport }),
    );
    expect(closes[0]?.code).toBe(1008);
    expect(ft.connects).toHaveLength(0);
    expect(audit.rows).toHaveLength(0);
    expect(controls()).toHaveLength(0); // no challenge/error control frame relayed
  });
});

describe('handlePtyConnection — no session (fail-closed via openPty)', () => {
  it('sends {type:error} + closes; exactly one unauthenticated audit row; no challenge relayed', async () => {
    const ft = fakeTransport();
    const audit = recordingAppendAudit();
    const { sock, closes, controls } = fakeSocket();
    // GOOD origin/host, but NO token in the subprotocol.
    await handlePtyConnection(sock, req(GOOD_HEADERS()), routeCtx({ audit, transport: ft.transport }));

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].event.result).toBe('unauthenticated');
    // The host is never contacted; no challenge is ever relayed.
    expect(ft.connects).toHaveLength(0);
    const frames = controls();
    expect(frames.some((f) => f.type === 'challenge')).toBe(false);
    expect(frames).toContainEqual({ type: 'error', reason: 'unauthenticated' });
    expect(closes[0]?.code).toBe(1008);
  });
});

describe('handlePtyConnection — challenge/assertion relay (the bridge)', () => {
  it('relays the host challenge to the browser and nothing else during the awaiting phase', async () => {
    const ft = fakeTransport({ challenge: 'chal-XYZ' });
    const { sock, controls, emit } = fakeSocket();
    const p = handlePtyConnection(sock, req(GOOD_HEADERS(validToken())), routeCtx({ transport: ft.transport }));
    // Let openPty run its gates and invoke the relay provider.
    await Promise.resolve();
    await Promise.resolve();
    expect(controls()).toEqual([{ type: 'challenge', challenge: 'chal-XYZ' }]);
    // Settle the handler cleanly by delivering the assertion.
    emit('message', JSON.stringify({ type: 'assertion', assertion: GOOD_ASSERTION }));
    await p;
  });

  it('relays the browser assertion back so requestOpen proceeds to open-ack', async () => {
    const ft = fakeTransport({ sessionId: 'pty-77' });
    const { sock } = fakeSocket({ autoAssert: GOOD_ASSERTION });
    await handlePtyConnection(sock, req(GOOD_HEADERS(validToken('operator-7'))), routeCtx({ transport: ft.transport }));
    expect(ft.captured.assertion).toEqual(GOOD_ASSERTION);
    expect(ft.connects).toHaveLength(1);
  });
});

describe('handlePtyConnection — byte pump (streaming phase only)', () => {
  it('pumps host→browser data and browser→host stdin after a completed assertion', async () => {
    const ft = fakeTransport();
    const fs = fakeSocket({ autoAssert: GOOD_ASSERTION });
    await handlePtyConnection(fs.sock, req(GOOD_HEADERS(validToken())), routeCtx({ transport: ft.transport }));

    // host → browser
    ft.emitData('hello from shell');
    expect(fs.sent).toContain('hello from shell');
    // browser → host (raw stdin)
    fs.emit('message', 'ls -la\r');
    expect(ft.writes).toContain('ls -la\r');
  });

  it('DROPS raw keystrokes typed during the awaiting-assertion phase (no stdin sink yet)', async () => {
    const ft = fakeTransport({ challenge: 'chal-1' });
    const fs = fakeSocket();
    const p = handlePtyConnection(fs.sock, req(GOOD_HEADERS(validToken())), routeCtx({ transport: ft.transport }));
    await Promise.resolve();
    await Promise.resolve();
    // A raw keystroke during the handshake window is neither an assertion nor stdin — it is dropped.
    fs.emit('message', 'premature-keystroke');
    expect(ft.writes).toHaveLength(0);
    // Now complete the ceremony and confirm the earlier keystroke was never written.
    fs.emit('message', JSON.stringify({ type: 'assertion', assertion: GOOD_ASSERTION }));
    await p;
    expect(ft.writes).not.toContain('premature-keystroke');
  });
});

describe('handlePtyConnection — assertion decline → fail closed', () => {
  it('a browser that closes before asserting → host-unreachable, one audit row, no byte pump wired', async () => {
    const ft = fakeTransport();
    const audit = recordingAppendAudit();
    const fs = fakeSocket();
    // When the challenge is relayed, the browser bails (closes) instead of asserting.
    const originalSend = fs.sock.send.bind(fs.sock);
    (fs.sock as unknown as { send: (d: string) => void }).send = (d: string) => {
      originalSend(d);
      try {
        if ((JSON.parse(d) as { type?: string }).type === 'challenge') queueMicrotask(() => fs.emit('close'));
      } catch {
        /* ignore */
      }
    };
    await handlePtyConnection(fs.sock, req(GOOD_HEADERS(validToken())), routeCtx({ audit, transport: ft.transport }));

    // The challenge WAS relayed (provider ran) but no assertion was captured → openPty fails closed.
    expect(ft.captured.challengeSent).toBe('host-challenge-1');
    expect(ft.captured.assertion).toBeUndefined();
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].event.result).toBe('host-unreachable');
    // No streaming pump: host data emitted after the failure never reaches the (closed) socket.
    const before = fs.sent.length;
    ft.emitData('should-not-be-sent');
    expect(fs.sent.length).toBe(before);
  });
});

describe('handlePtyConnection — preamble frozen → refuse before the host is contacted', () => {
  it('fleet-frozen: no transport connect, no challenge relayed, WS closed, one audit row', async () => {
    const ft = fakeTransport();
    const audit = recordingAppendAudit();
    const { sock, closes, controls } = fakeSocket();
    await handlePtyConnection(
      sock,
      req(GOOD_HEADERS(validToken())),
      routeCtx({ audit, transport: ft.transport, preamble: frozenPreamble('STOP file present — fleet is frozen') }),
    );
    expect(ft.connects).toHaveLength(0); // host never contacted
    const frames = controls();
    expect(frames.some((f) => f.type === 'challenge')).toBe(false);
    expect(frames).toContainEqual({ type: 'error', reason: 'fleet-frozen' });
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].event.result).toBe('fleet-frozen');
    expect(closes[0]?.code).toBe(1008);
  });
});

describe('handlePtyConnection — max-concurrent cap', () => {
  it('refuses a new upgrade over the cap with a clean close, before openPty', async () => {
    const ft = fakeTransport();
    const audit = recordingAppendAudit();
    const concurrency = { active: MAX_CONCURRENT_PTY }; // already at ceiling
    const { sock, closes, controls } = fakeSocket();
    await handlePtyConnection(
      sock,
      req(GOOD_HEADERS(validToken())),
      routeCtx({ audit, transport: ft.transport, concurrency }),
    );
    expect(closes[0]?.code).toBe(1013);
    expect(ft.connects).toHaveLength(0); // openPty/host never reached
    expect(audit.rows).toHaveLength(0); // no audit row for a capped upgrade
    expect(controls()).toContainEqual({ type: 'error', reason: 'too-many-terminals' });
  });

  it('admits a connection under the cap and releases the slot on close', async () => {
    const ft = fakeTransport();
    const concurrency = { active: 0 };
    const fs = fakeSocket({ autoAssert: GOOD_ASSERTION });
    await handlePtyConnection(fs.sock, req(GOOD_HEADERS(validToken())), routeCtx({ transport: ft.transport, concurrency }));
    expect(concurrency.active).toBe(1); // slot held while streaming
    fs.emit('close');
    expect(concurrency.active).toBe(0); // released on close
  });
});

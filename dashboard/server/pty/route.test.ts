/**
 * Hermetic tests for the persistent-session `/api/pty` WebSocket route + its REST companions. A fake
 * socket, preamble runner, audit sink, and PtyHost exercise the real gate/relay code and the real
 * persistent-session registry without a real ConPTY, audit write, STOP file, or git operation.
 *
 * Load-bearing order: Origin/Host -> fleet preamble -> session -> (open path only) cap -> create/attach.
 * Every allowed-origin attempt writes exactly one audit row. A socket close now DETACHES (the shell keeps
 * running); the shell dies only on an explicit close frame, a shell exit, or the shutdown drain.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import type { HostOpenRequest, PtyHandle, PtyHost, PtySession } from './host.ts';
import { createPersistentSessionRegistry } from './persistentSessions.ts';
import type { PersistentSessionRegistry } from './persistentSessions.ts';
import {
  handlePtyConnection,
  makePtyRouteContext,
  registerPtyRoute,
  sessionParamFromUrl,
  tokenFromSubprotocol,
} from './route.ts';
import type { PtyRouteContext, PtySocketLike } from './route.ts';

const SECRET = Buffer.from('pty-route-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };
const ALLOWED = ['http://localhost:4317'];
const OPEN_REQ: HostOpenRequest = { requestId: '', cwd: '/repo', cols: 80, rows: 24 };

function validToken(sub = 'operator-1'): string {
  return mintSession(sub, SESSION_CONFIG).token;
}

function okPreamble(): PreambleRunner {
  return () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
}

function frozenPreamble(problem: string): PreambleRunner {
  return () => ({ exitCode: 2, stdout: `PREAMBLE FAIL: ${problem}\n`, stderr: '' });
}

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

function fakeSocket() {
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const listeners: {
    message: Array<(data: unknown) => void>;
    close: Array<() => void>;
    error: Array<(err?: unknown) => void>;
  } = { message: [], close: [], error: [] };
  let readyState = 1;

  const sock: PtySocketLike = {
    OPEN: 1,
    get readyState() {
      return readyState;
    },
    send(data) {
      sent.push(data);
    },
    close(code, reason) {
      closes.push({ code, reason });
      readyState = 3;
      for (const cb of [...listeners.close]) cb();
    },
    on(event, cb) {
      if (event === 'message') listeners.message.push(cb as (data: unknown) => void);
      else if (event === 'close') listeners.close.push(cb as () => void);
      else listeners.error.push(cb as (err?: unknown) => void);
    },
  };

  const emit = (event: 'message' | 'close' | 'error', value?: unknown): void => {
    if (event === 'message') for (const cb of [...listeners.message]) cb(value);
    else if (event === 'close') for (const cb of [...listeners.close]) cb();
    else for (const cb of [...listeners.error]) cb(value);
  };

  const controls = (): Array<Record<string, unknown>> =>
    sent.flatMap((raw) => {
      try {
        return [JSON.parse(raw) as Record<string, unknown>];
      } catch {
        return [];
      }
    });

  return { sock, sent, closes, emit, controls };
}

function fakePtyHost(options: { spawnError?: Error; sessionId?: string } = {}) {
  const opens: HostOpenRequest[] = [];
  const stops: string[] = [];
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const dataCallbacks: Array<(chunk: string) => void> = [];
  const exitCallbacks: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  const sessionId = options.sessionId ?? 'pty-test-1';
  let live = false;

  const handle: PtyHandle = {
    pid: 4242,
    onData(cb) {
      dataCallbacks.push(cb);
    },
    onExit(cb) {
      exitCallbacks.push(cb);
    },
    write(data) {
      writes.push(data);
    },
    resize(cols, rows) {
      resizes.push({ cols, rows });
    },
    kill() {
      live = false;
    },
  };

  const host: PtyHost = {
    open(request): PtySession {
      opens.push(request);
      if (options.spawnError) throw options.spawnError;
      live = true;
      return { sessionId, handle };
    },
    stop(id) {
      stops.push(id);
      const existed = live && id === sessionId;
      live = false;
      return existed;
    },
    stopAll() {
      live = false;
    },
    sessions() {
      return live ? [sessionId] : [];
    },
  };

  return {
    host,
    opens,
    stops,
    writes,
    resizes,
    emitData: (chunk: string) => dataCallbacks.forEach((cb) => cb(chunk)),
    emitExit: (exitCode = 0) => exitCallbacks.forEach((cb) => cb({ exitCode })),
  };
}

function harness(options: {
  preamble?: PreambleRunner;
  host?: ReturnType<typeof fakePtyHost>;
  registry?: PersistentSessionRegistry;
  maxConcurrent?: number;
  appendAudit?: PtyRouteContext['appendAudit'];
} = {}): {
  ctx: PtyRouteContext;
  audit: ReturnType<typeof recordingAppendAudit>;
  host: ReturnType<typeof fakePtyHost>;
  registry: PersistentSessionRegistry;
  preambleCalls: () => number;
} {
  const audit = recordingAppendAudit();
  const host = options.host ?? fakePtyHost();
  const registry = options.registry ?? createPersistentSessionRegistry();
  const run = options.preamble ?? okPreamble();
  let calls = 0;
  const runPreamble: PreambleRunner = (repoRoot) => {
    calls += 1;
    return run(repoRoot);
  };
  const ctx = makePtyRouteContext({
    repoRoot: '/repo',
    sessionConfig: SESSION_CONFIG,
    allowedOrigins: ALLOWED,
    ptyHost: host.host,
    registry,
    runPreamble,
    appendAudit: options.appendAudit ?? audit.fn,
    maxConcurrent: options.maxConcurrent,
  });
  return { ctx, audit, host, registry, preambleCalls: () => calls };
}

function req(headers: Record<string, string | undefined>, url = '/api/pty') {
  return { headers, url } as unknown as Parameters<typeof handlePtyConnection>[1];
}

const GOOD_HEADERS = (token?: string): Record<string, string | undefined> => ({
  host: 'localhost:4317',
  origin: 'http://localhost:4317',
  'sec-websocket-protocol': token ? `kb-pty.v1, ${token}` : 'kb-pty.v1',
});

describe('tokenFromSubprotocol / sessionParamFromUrl', () => {
  it('reads only the second offered value after kb-pty.v1', () => {
    expect(tokenFromSubprotocol({ headers: { 'sec-websocket-protocol': 'kb-pty.v1, tok-abc' } })).toBe('tok-abc');
    expect(tokenFromSubprotocol({ headers: { 'sec-websocket-protocol': 'other, tok-abc' } })).toBeUndefined();
    expect(tokenFromSubprotocol({ headers: {} })).toBeUndefined();
  });

  it('reads the optional attach session id off the upgrade URL query', () => {
    expect(sessionParamFromUrl('/api/pty?session=pty-9')).toBe('pty-9');
    expect(sessionParamFromUrl('/api/pty')).toBeUndefined();
    expect(sessionParamFromUrl(undefined)).toBeUndefined();
  });
});

describe('makePtyRouteContext fail-closed host (N4)', () => {
  it('THROWS when no ptyHost is supplied rather than fabricating an ungated host', () => {
    // The daemon builds ONE fleet-gated host and passes it in; a context with no host would otherwise
    // silently fall back to a raw `createPtyHost` that bypasses the fleet gate. Construction must fail closed.
    expect(() => makePtyRouteContext({ sessionConfig: SESSION_CONFIG })).toThrow(/ptyHost is required/);
  });

  it('builds a context when the (gated) host is supplied', () => {
    const host = fakePtyHost();
    const ctx = makePtyRouteContext({
      sessionConfig: SESSION_CONFIG,
      allowedOrigins: ALLOWED,
      ptyHost: host.host,
    });
    expect(ctx.ptyHost).toBe(host.host);
  });
});

describe('handlePtyConnection gate ordering and audit (open path)', () => {
  it('rejects a bad Origin/Host before preamble and does not audit it as an allowed-origin attempt', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req({ host: 'evil.example', origin: 'http://evil.example', 'sec-websocket-protocol': `kb-pty.v1, ${validToken()}` }),
      h.ctx,
    );
    expect(ws.closes[0]?.code).toBe(1008);
    expect(h.preambleCalls()).toBe(0);
    expect(h.host.opens).toHaveLength(0);
    expect(h.audit.rows).toHaveLength(0);
  });

  it('runs the fleet preamble before session validation and audits fleet-frozen exactly once', async () => {
    const h = harness({ preamble: frozenPreamble('STOP file present - fleet is frozen') });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS()), h.ctx);
    expect(h.preambleCalls()).toBe(1);
    expect(h.host.opens).toHaveLength(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'fleet-frozen' });
    expect(ws.closes[0]?.code).toBe(1008);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ action: 'pty-open', result: 'fleet-frozen' });
  });

  it('audits an unauthenticated attempt exactly once and never spawns', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS()), h.ctx);
    expect(h.host.opens).toHaveLength(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'unauthenticated' });
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event.result).toBe('unauthenticated');
  });

  it('caps on LIVE SESSIONS (not sockets): a full registry refuses a new open with one audit row', async () => {
    const registry = createPersistentSessionRegistry();
    // Fill the registry to the ceiling with sessions from throwaway hosts (distinct ids).
    registry.create('filler', fakePtyHost({ sessionId: 'pty-fill-a' }).host, OPEN_REQ);
    registry.create('filler', fakePtyHost({ sessionId: 'pty-fill-b' }).host, OPEN_REQ);
    const h = harness({ registry, maxConcurrent: 2 });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-cap'))), h.ctx);
    expect(h.host.opens).toHaveLength(0); // never spawned
    expect(registry.liveCount()).toBe(2); // attach never consumed a slot
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'too-many-terminals' });
    expect(ws.closes[0]?.code).toBe(1013);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ result: 'too-many-terminals', owner: 'operator-cap' });
  });

  it('audits spawn failure exactly once and consumes no session slot', async () => {
    const host = fakePtyHost({ spawnError: new Error('ConPTY unavailable') });
    const h = harness({ host });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-spawn'))), h.ctx);
    expect(host.opens).toHaveLength(1);
    expect(h.registry.liveCount()).toBe(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'spawn-failed' });
    expect(ws.closes[0]?.code).toBe(1011);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ result: 'spawn-failed', owner: 'operator-spawn' });
  });
});

describe('handlePtyConnection in-process PTY relay (open path)', () => {
  it('kills the created session and releases exactly once when the opened audit throws after spawn', async () => {
    let auditCalls = 0;
    const h = harness({
      appendAudit: () => {
        auditCalls += 1;
        throw new Error('audit git push failed');
      },
    });
    const ws = fakeSocket();

    await expect(
      handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-audit-fail'))), h.ctx),
    ).resolves.toBeUndefined();

    expect(auditCalls).toBe(1);
    expect(h.host.opens).toHaveLength(1); // failure is specifically post-spawn
    expect(h.host.stops).toEqual(['pty-test-1']); // the created session was killed
    expect(h.registry.liveCount()).toBe(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'audit-failed' });
    expect(ws.closes).toContainEqual({ code: 1011, reason: 'audit-failed' });

    // Late duplicate lifecycle events stay idempotent (no second stop / audit row).
    ws.emit('close');
    ws.emit('error', new Error('late duplicate event'));
    h.host.emitExit(1);
    expect(h.host.stops).toEqual(['pty-test-1']);
    expect(h.registry.liveCount()).toBe(0);
    expect(auditCalls).toBe(1);
  });

  it('spawns with the governed defaults, sends the session bind frame, audits opened once, and pumps bytes', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-live'))), h.ctx);

    expect(h.host.opens).toEqual([{ requestId: '', cwd: '/repo', cols: 80, rows: 24 }]);
    expect(ws.controls()).toContainEqual({ type: 'session', sessionId: 'pty-test-1' });
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({
      action: 'pty-open',
      result: 'opened',
      owner: 'operator-live',
      detail: { sessionId: 'pty-test-1' },
    });
    expect(h.registry.liveCount()).toBe(1);

    h.host.emitData('hello from shell');
    expect(ws.sent).toContain('hello from shell');
    ws.emit('message', 'Get-Location\r');
    expect(h.host.writes).toContain('Get-Location\r');
    ws.emit('message', JSON.stringify({ type: 'resize', cols: 121.9, rows: 42.7 }));
    expect(h.host.resizes).toContainEqual({ cols: 121, rows: 42 });
  });

  it('buffers shell output emitted during the async opened-audit and flushes it after the audit commits', async () => {
    const h = harness();
    let releaseAudit!: () => void;
    const auditGate = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    let auditReached = false;
    const slowAudit: PtyRouteContext['appendAudit'] = async (_root, event) => {
      auditReached = true;
      await auditGate;
      return { ts: 'now', ...event };
    };
    const slow = harness({ host: h.host, appendAudit: slowAudit });
    const ws = fakeSocket();
    const connection = handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-early'))), slow.ctx);
    // Deterministically reach the audit await (the handler now also awaits the locked preamble first),
    // then emit startup output while the audit is still pending.
    while (!auditReached) await new Promise((resolve) => setTimeout(resolve, 0));
    h.host.emitData('PS C:\\kb> ');
    expect(ws.sent).not.toContain('PS C:\\kb> ');
    releaseAudit();
    await connection;
    expect(ws.sent).toContain('PS C:\\kb> ');
    // Post-audit output flows directly, after the flushed backlog.
    h.host.emitData('live');
    expect(ws.sent.indexOf('PS C:\\kb> ')).toBeLessThan(ws.sent.indexOf('live'));
  });

  it('a socket close DETACHES only — the persistent shell keeps running (no host stop)', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken())), h.ctx);
    expect(h.registry.liveCount()).toBe(1);

    ws.emit('close'); // a page reload / nav-away
    ws.emit('error', new Error('late duplicate event'));
    expect(h.host.stops).toEqual([]); // never killed
    expect(h.registry.liveCount()).toBe(1); // shell still alive, still buffering
    expect(h.audit.rows).toHaveLength(1);
  });

  it('an explicit {type:close} frame kills the session and closes the socket, with no extra audit row', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken())), h.ctx);

    ws.emit('message', JSON.stringify({ type: 'close' }));
    expect(h.host.stops).toEqual(['pty-test-1']);
    expect(h.registry.liveCount()).toBe(0);
    expect(ws.closes).toContainEqual({ code: 1000, reason: 'closed by operator' });
    expect(h.audit.rows).toHaveLength(1); // closes are not audited
  });

  it('a shell exit closes the WebSocket and removes the session from the registry', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken())), h.ctx);

    h.host.emitExit(0);
    expect(ws.closes).toContainEqual({ code: 1000, reason: 'shell exited' });
    expect(h.registry.liveCount()).toBe(0);
    expect(h.audit.rows).toHaveLength(1);
  });
});

describe('handlePtyConnection attach path', () => {
  it('reattaches to an existing session, auditing pty-attach and replaying scrollback after the bind frame', async () => {
    const h = harness();
    const seeded = h.registry.create('operator-1', h.host.host, OPEN_REQ);
    h.host.emitData('scrollback-line\n'); // buffered while detached

    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken('operator-1')), `/api/pty?session=${seeded.sessionId}`),
      h.ctx,
    );

    expect(h.host.opens).toHaveLength(1); // no NEW spawn — reused the seeded session
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ action: 'pty-attach', result: 'attached', owner: 'operator-1' });
    // Bind frame precedes the replayed scrollback.
    const bindIdx = ws.sent.findIndex((s) => s.includes('"type":"session"'));
    const replayIdx = ws.sent.indexOf('scrollback-line\n');
    expect(bindIdx).toBeGreaterThanOrEqual(0);
    expect(replayIdx).toBeGreaterThan(bindIdx);
  });

  it('holds attach output until the attach audit commits (fail-closed)', async () => {
    const h = harness();
    const seeded = h.registry.create('operator-1', h.host.host, OPEN_REQ);
    let releaseAudit!: () => void;
    const auditGate = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    const slowAudit: PtyRouteContext['appendAudit'] = async (_root, event) => {
      await auditGate;
      return { ts: 'now', ...event };
    };
    const slow = harness({ host: h.host, registry: h.registry, appendAudit: slowAudit });
    const ws = fakeSocket();
    const connection = handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken('operator-1')), `/api/pty?session=${seeded.sessionId}`),
      slow.ctx,
    );
    await Promise.resolve();
    h.host.emitData('secret-before-commit');
    expect(ws.sent).not.toContain('secret-before-commit'); // nothing streams before the audit commits
    releaseAudit();
    await connection;
    expect(ws.sent).toContain('secret-before-commit'); // replayed after commit
  });

  it('refuses an unknown/not-owned session with one pty-attach session-not-found row', async () => {
    const h = harness();
    h.registry.create('someone-else', h.host.host, OPEN_REQ); // owned by another sub

    const ws = fakeSocket();
    await handlePtyConnection(
      ws.sock,
      req(GOOD_HEADERS(validToken('operator-1')), '/api/pty?session=pty-test-1'),
      h.ctx,
    );

    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'session-not-found' });
    expect(ws.closes[0]?.code).toBe(1008);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ action: 'pty-attach', result: 'session-not-found' });
  });
});

describe('registerPtyRoute REST session endpoints', () => {
  async function restApp(registry: PersistentSessionRegistry) {
    const app = Fastify({ logger: false });
    const host = fakePtyHost();
    const ctx = makePtyRouteContext({
      repoRoot: '/repo',
      sessionConfig: SESSION_CONFIG,
      allowedOrigins: ALLOWED,
      ptyHost: host.host,
      registry,
      runPreamble: okPreamble(),
      appendAudit: recordingAppendAudit().fn,
    });
    await registerPtyRoute(app, ctx);
    await app.ready();
    return app;
  }

  it('GET /api/pty/sessions requires a bearer and lists only the caller-owned sessions', async () => {
    const registry = createPersistentSessionRegistry();
    registry.create('owner-1', fakePtyHost({ sessionId: 'pty-a' }).host, OPEN_REQ);
    registry.create('owner-2', fakePtyHost({ sessionId: 'pty-b' }).host, OPEN_REQ);
    const app = await restApp(registry);
    try {
      const noAuth = await app.inject({ method: 'GET', url: '/api/pty/sessions' });
      expect(noAuth.statusCode).toBe(401);

      const res = await app.inject({
        method: 'GET',
        url: '/api/pty/sessions',
        headers: { authorization: `Bearer ${validToken('owner-1')}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { sessions: Array<{ sessionId: string }> };
      expect(body.sessions.map((s) => s.sessionId)).toEqual(['pty-a']); // owner-2's session is not visible
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/pty/sessions/:id kills an owned session, 404s unknown/foreign/malformed ids', async () => {
    const registry = createPersistentSessionRegistry();
    const ownHost = fakePtyHost({ sessionId: 'pty-own' });
    registry.create('owner-1', ownHost.host, OPEN_REQ);
    registry.create('owner-2', fakePtyHost({ sessionId: 'pty-foreign' }).host, OPEN_REQ);
    const app = await restApp(registry);
    try {
      const noAuth = await app.inject({ method: 'DELETE', url: '/api/pty/sessions/pty-own' });
      expect(noAuth.statusCode).toBe(401);

      const foreign = await app.inject({
        method: 'DELETE',
        url: '/api/pty/sessions/pty-foreign',
        headers: { authorization: `Bearer ${validToken('owner-1')}` },
      });
      expect(foreign.statusCode).toBe(404); // owner-1 cannot close owner-2's session
      expect(registry.liveCount()).toBe(2);

      const malformed = await app.inject({
        method: 'DELETE',
        url: '/api/pty/sessions/not-a-valid-id', // fails SESSION_ID_RE (no pty- prefix)
        headers: { authorization: `Bearer ${validToken('owner-1')}` },
      });
      expect(malformed.statusCode).toBe(404);

      const ok = await app.inject({
        method: 'DELETE',
        url: '/api/pty/sessions/pty-own',
        headers: { authorization: `Bearer ${validToken('owner-1')}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ ok: true });
      expect(registry.liveCount()).toBe(1); // owner-2's session survives
    } finally {
      await app.close();
    }
  });
});

/**
 * Hermetic tests for the temporary in-process `/api/pty` WebSocket route. A fake socket, preamble runner,
 * audit sink, and PtyHost exercise the real gate/relay code without a real ConPTY, passkey, audit write,
 * STOP file, or git operation.
 *
 * Load-bearing order: Origin/Host -> fleet preamble -> session -> cap -> spawn. Every allowed-origin
 * attempt writes exactly one audit row for fleet-frozen, unauthenticated, too-many-terminals,
 * spawn-failed, or opened. Socket close/error remains an idempotent process-group teardown.
 */
import { describe, expect, it } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import type { HostOpenRequest, PtyHandle, PtyHost, PtySession } from './host.ts';
import { handlePtyConnection, makePtyRouteContext, MAX_CONCURRENT_PTY, tokenFromSubprotocol } from './route.ts';
import type { PtyRouteContext, PtySocketLike } from './route.ts';

const SECRET = Buffer.from('pty-route-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };
const ALLOWED = ['http://localhost:4317'];

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
  concurrency?: { active: number };
  maxConcurrent?: number;
  appendAudit?: PtyRouteContext['appendAudit'];
} = {}): {
  ctx: PtyRouteContext;
  audit: ReturnType<typeof recordingAppendAudit>;
  host: ReturnType<typeof fakePtyHost>;
  preambleCalls: () => number;
} {
  const audit = recordingAppendAudit();
  const host = options.host ?? fakePtyHost();
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
    runPreamble,
    appendAudit: options.appendAudit ?? audit.fn,
    concurrency: options.concurrency,
    maxConcurrent: options.maxConcurrent,
  });
  return { ctx, audit, host, preambleCalls: () => calls };
}

function req(headers: Record<string, string | undefined>, url = '/api/pty') {
  return { headers, url } as unknown as Parameters<typeof handlePtyConnection>[1];
}

const GOOD_HEADERS = (token?: string): Record<string, string | undefined> => ({
  host: 'localhost:4317',
  origin: 'http://localhost:4317',
  'sec-websocket-protocol': token ? `kb-pty.v1, ${token}` : 'kb-pty.v1',
});

describe('tokenFromSubprotocol', () => {
  it('reads only the second offered value after kb-pty.v1', () => {
    expect(tokenFromSubprotocol({ headers: { 'sec-websocket-protocol': 'kb-pty.v1, tok-abc' } })).toBe('tok-abc');
    expect(tokenFromSubprotocol({ headers: { 'sec-websocket-protocol': 'other, tok-abc' } })).toBeUndefined();
    expect(tokenFromSubprotocol({ headers: {} })).toBeUndefined();
  });
});

describe('handlePtyConnection gate ordering and audit', () => {
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
    // Deliberately no token: fleet-frozen must win over unauthenticated if the order is correct.
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS()), h.ctx);
    expect(h.preambleCalls()).toBe(1);
    expect(h.host.opens).toHaveLength(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'fleet-frozen' });
    expect(ws.closes[0]?.code).toBe(1008);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event.result).toBe('fleet-frozen');
  });

  it('audits an unauthenticated attempt exactly once and never spawns', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS()), h.ctx);
    expect(h.preambleCalls()).toBe(1);
    expect(h.host.opens).toHaveLength(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'unauthenticated' });
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event.result).toBe('unauthenticated');
  });

  it('audits a capped attempt exactly once after preamble/session and does not spawn', async () => {
    const concurrency = { active: MAX_CONCURRENT_PTY };
    const h = harness({ concurrency });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-cap'))), h.ctx);
    expect(h.preambleCalls()).toBe(1);
    expect(h.host.opens).toHaveLength(0);
    expect(concurrency.active).toBe(MAX_CONCURRENT_PTY);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'too-many-terminals' });
    expect(ws.closes[0]?.code).toBe(1013);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ result: 'too-many-terminals', owner: 'operator-cap' });
  });

  it('audits spawn failure exactly once and releases the reserved concurrency slot', async () => {
    const concurrency = { active: 0 };
    const host = fakePtyHost({ spawnError: new Error('ConPTY unavailable') });
    const h = harness({ concurrency, host });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-spawn'))), h.ctx);
    expect(host.opens).toHaveLength(1);
    expect(concurrency.active).toBe(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'spawn-failed' });
    expect(ws.closes[0]?.code).toBe(1011);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({ result: 'spawn-failed', owner: 'operator-spawn' });
  });
});

describe('handlePtyConnection in-process PTY relay', () => {
  it('reaps the PTY and releases exactly once when the opened audit throws after spawn', async () => {
    const concurrency = { active: 0 };
    let auditCalls = 0;
    const h = harness({
      concurrency,
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
    expect(h.host.stops).toEqual(['pty-test-1']);
    expect(concurrency.active).toBe(0);
    expect(ws.controls()).toContainEqual({ type: 'error', reason: 'audit-failed' });
    expect(ws.closes).toContainEqual({ code: 1011, reason: 'audit-failed' });

    // close() above invokes the registered close handler; late duplicate lifecycle events stay idempotent.
    ws.emit('close');
    ws.emit('error', new Error('late duplicate event'));
    h.host.emitExit(1);
    expect(h.host.stops).toEqual(['pty-test-1']);
    expect(concurrency.active).toBe(0);
    expect(auditCalls).toBe(1);
  });

  it('spawns with the governed defaults, audits opened once, and pumps bytes plus resize frames', async () => {
    const h = harness();
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken('operator-live'))), h.ctx);

    expect(h.host.opens).toEqual([{ requestId: '', cwd: '/repo', cols: 80, rows: 24 }]);
    expect(h.audit.rows).toHaveLength(1);
    expect(h.audit.rows[0].event).toMatchObject({
      action: 'pty-open',
      result: 'opened',
      owner: 'operator-live',
      detail: { sessionId: 'pty-test-1' },
    });

    h.host.emitData('hello from shell');
    expect(ws.sent).toContain('hello from shell');
    ws.emit('message', 'Get-Location\r');
    expect(h.host.writes).toContain('Get-Location\r');
    ws.emit('message', JSON.stringify({ type: 'resize', cols: 121.9, rows: 42.7 }));
    expect(h.host.resizes).toContainEqual({ cols: 121, rows: 42 });
  });

  it('explicit socket close kills exactly that PTY, releases its slot, and never adds a second audit row', async () => {
    const concurrency = { active: 0 };
    const h = harness({ concurrency });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken())), h.ctx);
    expect(concurrency.active).toBe(1);

    ws.emit('close');
    ws.emit('error', new Error('late duplicate event'));
    expect(h.host.stops).toEqual(['pty-test-1']);
    expect(concurrency.active).toBe(0);
    expect(h.audit.rows).toHaveLength(1);
  });

  it('shell exit closes the WebSocket and idempotently reaps/releases the session', async () => {
    const concurrency = { active: 0 };
    const h = harness({ concurrency });
    const ws = fakeSocket();
    await handlePtyConnection(ws.sock, req(GOOD_HEADERS(validToken())), h.ctx);

    h.host.emitExit(0);
    expect(ws.closes).toContainEqual({ code: 1000, reason: 'shell exited' });
    expect(h.host.stops).toEqual(['pty-test-1']);
    expect(concurrency.active).toBe(0);
    expect(h.audit.rows).toHaveLength(1);
  });
});

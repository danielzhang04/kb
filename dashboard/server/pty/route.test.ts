/**
 * W6.4 — the registered `/api/pty` surface. These tests pin the ONE thing a later refactor can silently
 * break: the auth hook ORDER, and the fact that every refusal happens before the registry is touched.
 */
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mintSession } from '../auth/session.ts';
import type { BrowserSessionRefManager, SessionConfig } from '../auth/session.ts';
import {
  decodeBrowserClientFrame,
  handlePtyConnection,
  hasAnyQuery,
  makePtyRouteContext,
  registerPtyRoute,
} from './route.ts';
import type { PtyRouteContext, PtySocketLike, SessionReplayReader } from './route.ts';
import type {
  Attachment,
  BrowserPrincipal,
  ObservedExit,
  PortResult,
  SessionDataFrame,
  SessionRegistryPort,
  SessionSink,
} from './contracts.ts';
import { createTranscriptRetention } from './sessionPersistence.ts';
import type { SessionPersistence } from './sessionPersistence.ts';
import { createRawSessionReplayReader } from './replayReader.ts';
import type { PtySessionsDocumentV2 } from './contracts.ts';
import { PTY_OUTBOUND_HIGH_WATER_BYTES } from '../../shared/ptyProtocol.ts';
import type { SessionSummary } from '../../shared/ptyProtocol.ts';

const SESSION_ID = 'pty-0123456789abcdef0123456789abcdef';
const ATTACHMENT_ID = 'att-0123456789abcdef0123456789abcdef';
const REF = 'browser-ref-value';
const sessionConfig: SessionConfig = { secret: Buffer.from('test-secret-value-0123456789'), ttlMs: 60_000 };

function summary(): SessionSummary {
  return {
    sessionId: SESSION_ID,
    name: 'shell 1',
    host: 'desktop',
    launcher: 'shell',
    rootId: 'repo',
    cwd: '',
    state: 'live',
    attachmentCount: 1,
    attachmentState: 'attached',
    startedAt: '2026-08-22T00:00:00.000Z',
    endedAt: null,
    exit: null,
  };
}

function exited(): ObservedExit {
  return {
    sessionId: SESSION_ID,
    sequence: 7,
    exitCode: 0,
    signal: null,
    reason: 'closed',
    observedAt: '2026-08-22T00:01:00.000Z',
  };
}

type Calls = string[];

function fakeRegistry(calls: Calls, overrides: Partial<SessionRegistryPort> = {}): SessionRegistryPort {
  const attachment: Attachment = {
    attachmentId: ATTACHMENT_ID,
    session: summary(),
    detach: async () => { calls.push('detach'); },
  };
  return {
    create: async () => { calls.push('create'); return { ok: true, value: summary() }; },
    attach: async (_p: BrowserPrincipal, _id: string, sink: SessionSink) => {
      calls.push('attach');
      void sink;
      return { ok: true, value: attachment } as PortResult<Attachment>;
    },
    list: async () => { calls.push('list'); return [summary()]; },
    write: async () => { calls.push('write'); return { ok: true, value: { accepted: 3 } }; },
    resize: async () => { calls.push('resize'); return { ok: true, value: summary() }; },
    close: async () => { calls.push('close'); return { ok: true, value: exited() }; },
    claimRunController: async () => ({ ok: false, refusal: 'not-found', detail: null }),
    ...overrides,
  } as SessionRegistryPort;
}

function fakePersistence(revision = 12): SessionPersistence {
  return {
    read: () => ({ revision } as PtySessionsDocumentV2),
    mutate: async () => ({ revision, value: undefined as never }),
  };
}

function refManager(resolves: boolean): BrowserSessionRefManager {
  return {
    resolve: async () => (resolves
      ? { ok: true, value: { browserSessionRef: REF } }
      : { ok: false, reason: 'absent' }),
  } as unknown as BrowserSessionRefManager;
}

async function buildApp(options: {
  calls: Calls;
  order: Calls;
  refs?: BrowserSessionRefManager;
}): Promise<{ app: FastifyInstance; ctx: PtyRouteContext }> {
  const ctx = makePtyRouteContext({
    repoRoot: process.cwd(),
    sessionConfig,
    allowedOrigins: ['https://kb.test'],
    registry: fakeRegistry(options.calls),
    persistence: fakePersistence(),
    rateLimitHook: async () => { options.order.push('rate-limit'); },
    ...(options.refs ? { browserSessionRefs: options.refs } : {}),
    appendAudit: () => ({ ts: '', action: '', owner: '', result: '' } as never),
  });
  const app = Fastify();
  await app.register(async (scope) => {
    scope.addHook('onRequest', async () => { options.order.push('scope-entered'); });
    await registerPtyRoute(scope, ctx);
  });
  await app.ready();
  return { app, ctx };
}

const bearer = (): string => `Bearer ${mintSession('daniel', sessionConfig).token}`;

describe('registerPtyRoute — auth hook order', () => {
  let calls: Calls;
  let order: Calls;
  beforeEach(() => { calls = []; order = []; });

  it('refuses a foreign Origin with 403 before the rate limit, the session, or the registry', async () => {
    const { app } = await buildApp({ calls, order, refs: refManager(true) });
    const res = await app.inject({
      method: 'GET',
      url: '/api/pty/sessions',
      headers: { origin: 'https://evil.test', host: 'kb.test' },
    });
    expect(res.statusCode).toBe(403);
    expect(order).not.toContain('rate-limit');
    expect(calls).toEqual([]);
    await app.close();
  });

  it('runs the rate limit after the origin guard and before the session check', async () => {
    const { app } = await buildApp({ calls, order, refs: refManager(true) });
    const res = await app.inject({
      method: 'GET',
      url: '/api/pty/sessions',
      headers: { origin: 'https://kb.test', host: 'kb.test', authorization: bearer() },
    });
    expect(res.statusCode).toBe(200);
    expect(order).toEqual(['scope-entered', 'rate-limit']);
    await app.close();
  });

  it('refuses an unauthenticated operator with 401 and never reads the registry', async () => {
    const { app } = await buildApp({ calls, order, refs: refManager(true) });
    const res = await app.inject({
      method: 'GET',
      url: '/api/pty/sessions',
      headers: { origin: 'https://kb.test', host: 'kb.test' },
    });
    expect(res.statusCode).toBe(401);
    expect(calls).toEqual([]);
    await app.close();
  });

  it('refuses an operator WITHOUT a browser-session cookie with 428 and no registry call', async () => {
    const { app } = await buildApp({ calls, order, refs: refManager(false) });
    const res = await app.inject({
      method: 'GET',
      url: '/api/pty/sessions',
      headers: { origin: 'https://kb.test', host: 'kb.test', authorization: bearer() },
    });
    expect(res.statusCode).toBe(428);
    expect(res.json()).toEqual({ error: 'browser-session-required' });
    expect(calls).toEqual([]);
    await app.close();
  });

  it('refuses with 428 when no ref store exists at all', async () => {
    const { app } = await buildApp({ calls, order });
    const res = await app.inject({
      method: 'GET',
      url: '/api/pty/sessions',
      headers: { origin: 'https://kb.test', host: 'kb.test', authorization: bearer() },
    });
    expect(res.statusCode).toBe(428);
    await app.close();
  });

  it('refuses ANY query on the upgrade with 400 after the principal and before 101', async () => {
    const { app } = await buildApp({ calls, order, refs: refManager(true) });
    for (const query of ['spawn=claude', 'agent=x', 'workflow=y', 'session=z', 'unknown=1', 'a=1&a=2']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/pty?${query}`,
        headers: { origin: 'https://kb.test', host: 'kb.test', authorization: bearer() },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request', reason: 'query-not-accepted' });
    }
    expect(calls).toEqual([]);
    await app.close();
  });
});

describe('registerPtyRoute — REST', () => {
  it('lists with the exact composite envelope', async () => {
    const calls: Calls = [];
    const { app } = await buildApp({ calls, order: [], refs: refManager(true) });
    const res = await app.inject({
      method: 'GET',
      url: '/api/pty/sessions',
      headers: { origin: 'https://kb.test', host: 'kb.test', authorization: bearer() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ revision: 12, sessions: [summary()] });
    await app.close();
  });

  it('404s a malformed session id without reaching the registry', async () => {
    const calls: Calls = [];
    const { app } = await buildApp({ calls, order: [], refs: refManager(true) });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/pty/sessions/pty-not-a-v2-id',
      headers: { origin: 'https://kb.test', host: 'kb.test', authorization: bearer() },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it('returns the OBSERVED exit on a successful close', async () => {
    const calls: Calls = [];
    const { app } = await buildApp({ calls, order: [], refs: refManager(true) });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/pty/sessions/${SESSION_ID}`,
      headers: { origin: 'https://kb.test', host: 'kb.test', authorization: bearer() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      exit: { exitCode: 0, reason: 'closed', observedAt: '2026-08-22T00:01:00.000Z' },
    });
    expect(calls).toEqual(['close']);
    await app.close();
  });
});

describe('decodeBrowserClientFrame', () => {
  it('accepts the exact create frame', () => {
    expect(decodeBrowserClientFrame(JSON.stringify({
      type: 'create', requestId: 'r1', launcher: 'shell', rootId: 'repo', relativeCwd: '', cols: 80, rows: 24,
    }))).toEqual({
      type: 'create', requestId: 'r1', launcher: 'shell', rootId: 'repo', relativeCwd: '', cols: 80, rows: 24,
    });
  });

  it('refuses every out-of-contract create', () => {
    const bad = [
      { type: 'create', requestId: 'r1', launcher: 'powershell', rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 },
      { type: 'create', requestId: 'r1', launcher: 'shell', rootId: '/etc', relativeCwd: '', cols: 80, rows: 24 },
      { type: 'create', requestId: 'r1', launcher: 'shell', rootId: 'repo', relativeCwd: '', cols: 4, rows: 24 },
      { type: 'create', requestId: 'r1', launcher: 'shell', rootId: 'repo', relativeCwd: '', cols: 80, rows: 5000 },
      { type: 'spawn', requestId: 'r1' },
      { type: 'create', launcher: 'shell', rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 },
    ];
    for (const frame of bad) expect(decodeBrowserClientFrame(JSON.stringify(frame))).toBeNull();
  });

  it('refuses a v1 session id and a non-object payload', () => {
    expect(decodeBrowserClientFrame(JSON.stringify({ type: 'attach', requestId: 'r', sessionId: 'pty-1-2', fromSequence: 0 }))).toBeNull();
    expect(decodeBrowserClientFrame('hello')).toBeNull();
    expect(decodeBrowserClientFrame('[]')).toBeNull();
  });
});

describe('hasAnyQuery', () => {
  it('is true for any query at all and false otherwise', () => {
    expect(hasAnyQuery('/api/pty')).toBe(false);
    expect(hasAnyQuery('/api/pty?')).toBe(false);
    expect(hasAnyQuery('/api/pty?x=1')).toBe(true);
    expect(hasAnyQuery(undefined)).toBe(false);
  });
});

type FakeSocket = PtySocketLike & {
  sent: unknown[];
  /** Controllable send-buffer depth, so the outbound high-water mark is testable. */
  bufferedAmount: number;
  closedWith: { code: number; reason: string } | null;
  emit(data: string): void;
};

function fakeSocket(): FakeSocket {
  const handlers: { message: ((d: unknown) => void)[]; close: (() => void)[]; error: (() => void)[] } =
    { message: [], close: [], error: [] };
  return {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    sent: [] as unknown[],
    closedWith: null,
    send(data: string) { (this as unknown as { sent: unknown[] }).sent.push(JSON.parse(data)); },
    close(code?: number, reason?: string) {
      (this as unknown as FakeSocket).closedWith = { code: code ?? 1000, reason: reason ?? '' };
    },
    on(event: 'message' | 'close' | 'error', cb: never) { handlers[event].push(cb); },
    emit(data: string) { for (const cb of handlers.message) cb(data); },
  } as unknown as FakeSocket;
}

describe('handlePtyConnection', () => {
  const principal: BrowserPrincipal = { operator: 'daniel', browserSessionRef: REF };

  function ctxFor(calls: Calls, overrides: Partial<SessionRegistryPort> = {}): PtyRouteContext {
    return makePtyRouteContext({
      repoRoot: process.cwd(),
      sessionConfig,
      allowedOrigins: ['https://kb.test'],
      registry: fakeRegistry(calls, overrides),
      persistence: fakePersistence(3),
      appendAudit: () => ({ ts: '', action: '', owner: '', result: '' } as never),
    });
  }

  it('creates and attaches on the first create frame, answering with `created`', async () => {
    const calls: Calls = [];
    const forwardedCwds: string[] = [];
    const socket = fakeSocket();
    await handlePtyConnection(socket, principal, ctxFor(calls, {
      create: async (_principal, request) => {
        calls.push('create');
        forwardedCwds.push(request.relativeCwd);
        return { ok: true, value: summary() };
      },
    }));
    socket.emit(JSON.stringify({
      type: 'create', requestId: 'r1', launcher: 'shell', rootId: 'repo', relativeCwd: '.', cols: 80, rows: 24,
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['create', 'attach']);
    expect(forwardedCwds).toEqual(['']);
    expect(socket.sent).toEqual([
      { type: 'created', requestId: 'r1', revision: 3, session: summary(), attachmentId: ATTACHMENT_ID },
    ]);
  });

  it('refuses an unsafe cwd by request id without calling the registry', async () => {
    const calls: Calls = [];
    const socket = fakeSocket();
    await handlePtyConnection(socket, principal, ctxFor(calls));
    socket.emit(JSON.stringify({
      type: 'create', requestId: 'r1', launcher: 'shell', rootId: 'repo', relativeCwd: '../x', cols: 80, rows: 24,
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(socket.sent).toEqual([{
      type: 'error', requestId: 'r1', sessionId: null, code: 'unsafe-cwd', detail: 'relativeCwd is unsafe',
    }]);
    expect(calls).toEqual([]);
  });

  it('refuses input naming an attachment this socket does not hold, without writing', async () => {
    const calls: Calls = [];
    const socket = fakeSocket();
    await handlePtyConnection(socket, principal, ctxFor(calls));
    socket.emit(JSON.stringify({
      type: 'input', requestId: 'r2', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID,
      encoding: 'base64', data: 'aGk=',
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
    expect(socket.sent).toEqual([
      { type: 'error', requestId: 'r2', sessionId: SESSION_ID, code: 'not-found', detail: null },
    ]);
  });

  it('answers an undecodable frame with one invalid-request error and no registry call', async () => {
    const calls: Calls = [];
    const socket = fakeSocket();
    await handlePtyConnection(socket, principal, ctxFor(calls));
    socket.emit('{"type":"exec","requestId":"r3"}');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
    expect(socket.sent).toEqual([
      { type: 'error', requestId: null, sessionId: null, code: 'invalid-request', detail: null },
    ]);
  });
});

/**
 * The principal binding, at the ROUTE. The registry sanitizes a foreign session on its own, but nothing
 * here proved the route hands it the right principal — so this suite drives A's session with B's identity
 * through every verb and demands the same answer B gets for a session that never existed.
 */
describe('registerPtyRoute — cross-principal refusal', () => {
  const OWNER = { operator: 'alice', browserSessionRef: 'ref-a' } as const;
  const OTHER_SESSION_ID = 'pty-fedcba9876543210fedcba9876543210';

  /** Resolves whatever ref the cookie carries, so two injects can hold two different browser identities. */
  function echoRefs(): BrowserSessionRefManager {
    return {
      resolve: async (cookie: string | undefined) => {
        const value = /kb_browser_session=([^;]+)/.exec(cookie ?? '')?.[1];
        return value === undefined
          ? { ok: false, reason: 'absent' }
          : { ok: true, value: { browserSessionRef: value } };
      },
    } as unknown as BrowserSessionRefManager;
  }

  /** Every verb answers for the OWNER only; every other principal gets the not-found a stranger gets. */
  function ownedRegistry(calls: Calls): SessionRegistryPort {
    const owns = (p: BrowserPrincipal, sessionId = SESSION_ID): boolean =>
      p.operator === OWNER.operator && p.browserSessionRef === OWNER.browserSessionRef
      && sessionId === SESSION_ID;
    const denied = { ok: false, refusal: 'not-found', detail: null } as const;
    const attachment: Attachment = {
      attachmentId: ATTACHMENT_ID,
      session: summary(),
      detach: async () => { calls.push('detach'); },
    };
    return {
      create: async () => ({ ok: true, value: summary() }),
      attach: async (p: BrowserPrincipal, id: string) => {
        calls.push(`attach:${p.operator}/${p.browserSessionRef}`);
        return (owns(p, id) ? { ok: true, value: attachment } : denied) as PortResult<Attachment>;
      },
      list: async (p: BrowserPrincipal) => {
        calls.push(`list:${p.operator}`);
        return owns(p) ? [summary()] : [];
      },
      write: async (p: BrowserPrincipal, id: string) => (owns(p, id) ? { ok: true, value: { accepted: 1 } } : denied),
      resize: async (p: BrowserPrincipal, id: string) => (owns(p, id) ? { ok: true, value: summary() } : denied),
      close: async (p: BrowserPrincipal, id: string) => (owns(p, id) ? { ok: true, value: exited() } : denied),
      claimRunController: async () => denied,
    } as unknown as SessionRegistryPort;
  }

  async function appFor(calls: Calls): Promise<FastifyInstance> {
    const ctx = makePtyRouteContext({
      repoRoot: process.cwd(),
      sessionConfig,
      allowedOrigins: ['https://kb.test'],
      registry: ownedRegistry(calls),
      persistence: fakePersistence(),
      browserSessionRefs: echoRefs(),
      appendAudit: () => ({ ts: '', action: '', owner: '', result: '' } as never),
    });
    const app = Fastify();
    await app.register(async (scope) => { await registerPtyRoute(scope, ctx); });
    await app.ready();
    return app;
  }

  const identity = (operator: string, ref: string): Record<string, string> => ({
    origin: 'https://kb.test',
    host: 'kb.test',
    authorization: `Bearer ${mintSession(operator, sessionConfig).token}`,
    cookie: `kb_browser_session=${ref}`,
  });

  it('gives principal B an EMPTY list where A sees the session', async () => {
    const calls: Calls = [];
    const app = await appFor(calls);
    const mine = await app.inject({ method: 'GET', url: '/api/pty/sessions', headers: identity('alice', 'ref-a') });
    expect(mine.json()).toEqual({ revision: 12, sessions: [summary()] });

    const theirs = await app.inject({ method: 'GET', url: '/api/pty/sessions', headers: identity('bob', 'ref-b') });
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json()).toEqual({ revision: 12, sessions: [] });
    // Same operator, different browser session: still not A's list.
    const otherTab = await app.inject({ method: 'GET', url: '/api/pty/sessions', headers: identity('alice', 'ref-b') });
    expect(otherTab.json()).toEqual({ revision: 12, sessions: [] });
    await app.close();
  });

  it('answers B closing A session with the SAME 404 body as a session that never existed', async () => {
    const calls: Calls = [];
    const app = await appFor(calls);
    const foreign = await app.inject({
      method: 'DELETE', url: `/api/pty/sessions/${SESSION_ID}`, headers: identity('bob', 'ref-b'),
    });
    const absent = await app.inject({
      method: 'DELETE', url: `/api/pty/sessions/${OTHER_SESSION_ID}`, headers: identity('bob', 'ref-b'),
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual(absent.json());
    // And A can still close it — the refusal is about the principal, not about the session.
    const owner = await app.inject({
      method: 'DELETE', url: `/api/pty/sessions/${SESSION_ID}`, headers: identity('alice', 'ref-a'),
    });
    expect(owner.statusCode).toBe(200);
    await app.close();
  });

  it('separates a registry fault (500) from the close deadline (409 exit-unconfirmed)', async () => {
    // m3/section 6: 409 means "the kill was asked for and no exit was observed in time". A registry
    // fault is not an unconfirmed exit, and reporting it as one told the operator the process might
    // still be alive when the truth is the daemon failed.
    const faulting = { ...ownedRegistry([]),
      close: async () => ({ ok: false as const, refusal: 'internal' as const, detail: null }) };
    const faultApp = Fastify();
    await faultApp.register(async (scope) => {
      await registerPtyRoute(scope, makePtyRouteContext({
        repoRoot: process.cwd(), sessionConfig, allowedOrigins: ['https://kb.test'],
        registry: faulting as unknown as SessionRegistryPort, persistence: fakePersistence(),
        browserSessionRefs: echoRefs(),
        appendAudit: () => ({ ts: '', action: '', owner: '', result: '' } as never),
      }));
    });
    await faultApp.ready();
    const faulted = await faultApp.inject({
      method: 'DELETE', url: `/api/pty/sessions/${SESSION_ID}`, headers: identity('alice', 'ref-a'),
    });
    expect([faulted.statusCode, faulted.json()]).toEqual([500, { error: 'internal' }]);
    await faultApp.close();

    const hanging = { ...ownedRegistry([]), close: () => new Promise(() => {}) };
    const slowApp = Fastify();
    await slowApp.register(async (scope) => {
      await registerPtyRoute(scope, makePtyRouteContext({
        repoRoot: process.cwd(), sessionConfig, allowedOrigins: ['https://kb.test'],
        registry: hanging as unknown as SessionRegistryPort, persistence: fakePersistence(),
        browserSessionRefs: echoRefs(), closeTimeoutMs: 5,
        appendAudit: () => ({ ts: '', action: '', owner: '', result: '' } as never),
      }));
    });
    await slowApp.ready();
    const unconfirmed = await slowApp.inject({
      method: 'DELETE', url: `/api/pty/sessions/${SESSION_ID}`, headers: identity('alice', 'ref-a'),
    });
    expect([unconfirmed.statusCode, unconfirmed.json()]).toEqual([409, { error: 'exit-unconfirmed' }]);
    await slowApp.close();
  });

  it('refuses B attach/write/resize/close over the socket, and lets A second tab attach', async () => {
    const calls: Calls = [];
    const ctx = (): PtyRouteContext => makePtyRouteContext({
      repoRoot: process.cwd(),
      sessionConfig,
      allowedOrigins: ['https://kb.test'],
      registry: ownedRegistry(calls),
      persistence: fakePersistence(3),
      appendAudit: () => ({ ts: '', action: '', owner: '', result: '' } as never),
    });
    const bob = fakeSocket();
    await handlePtyConnection(bob, { operator: 'bob', browserSessionRef: 'ref-b' }, ctx());
    for (const frame of [
      { type: 'attach', requestId: 'r1', sessionId: SESSION_ID, fromSequence: 0 },
      { type: 'input', requestId: 'r2', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID, encoding: 'base64', data: 'aGk=' },
      { type: 'resize', requestId: 'r3', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID, cols: 80, rows: 24 },
      { type: 'close', requestId: 'r4', sessionId: SESSION_ID },
    ]) bob.emit(JSON.stringify(frame));
    await new Promise((r) => setTimeout(r, 0));
    // Every verb: the same sanitized not-found, with no detail that distinguishes "yours" from "absent".
    expect(bob.sent).toEqual([
      { type: 'error', requestId: 'r1', sessionId: SESSION_ID, code: 'not-found', detail: null },
      { type: 'error', requestId: 'r2', sessionId: SESSION_ID, code: 'not-found', detail: null },
      { type: 'error', requestId: 'r3', sessionId: SESSION_ID, code: 'not-found', detail: null },
      { type: 'error', requestId: 'r4', sessionId: SESSION_ID, code: 'not-found', detail: null },
    ]);

    const secondTab = fakeSocket();
    await handlePtyConnection(secondTab, { ...OWNER }, ctx());
    secondTab.emit(JSON.stringify({ type: 'attach', requestId: 'r5', sessionId: SESSION_ID, fromSequence: 0 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(secondTab.sent).toEqual([{
      type: 'attached', requestId: 'r5', revision: 3, session: summary(),
      attachmentId: ATTACHMENT_ID, replayFrom: 0, nextSequence: 0,
    }]);
  });
});

describe('registerPtyRoute — outbound high-water and settled sessions', () => {
  const principal: BrowserPrincipal = { operator: 'daniel', browserSessionRef: REF };

  function ctxFor(calls: Calls, capture?: (sink: SessionSink) => void): PtyRouteContext {
    const base = fakeRegistry(calls);
    return makePtyRouteContext({
      repoRoot: process.cwd(),
      sessionConfig,
      allowedOrigins: ['https://kb.test'],
      registry: {
        ...base,
        attach: async (p: BrowserPrincipal, id: string, sink: SessionSink) => {
          capture?.(sink);
          return base.attach(p, id, sink);
        },
      },
      persistence: fakePersistence(3),
      appendAudit: () => ({ ts: '', action: '', owner: '', result: '' } as never),
    });
  }

  async function createdSocket(calls: Calls, capture?: (sink: SessionSink) => void) {
    const socket = fakeSocket();
    await handlePtyConnection(socket, principal, ctxFor(calls, capture));
    socket.emit(JSON.stringify({
      type: 'create', requestId: 'r1', launcher: 'shell', rootId: 'repo', relativeCwd: '', cols: 80, rows: 24,
    }));
    await new Promise((r) => setTimeout(r, 0));
    return socket;
  }

  it('high-water: a send buffer above the mark detaches the attachment and closes the socket', async () => {
    const calls: Calls = [];
    const socket = await createdSocket(calls);
    expect(calls).toEqual(['create', 'attach']);
    socket.sent.length = 0;

    // The reader stopped draining: the transport is holding more than the ceiling allows.
    socket.bufferedAmount = PTY_OUTBOUND_HIGH_WATER_BYTES + 1;
    socket.emit(JSON.stringify({
      type: 'input', requestId: 'r2', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID,
      encoding: 'base64', data: 'aGk=',
    }));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toContain('detach');
    expect(socket.closedWith).toEqual({ code: 1013, reason: 'backpressure' });
    // Nothing was queued above the mark.
    expect(socket.sent).toEqual([]);
  });

  it('sends normally while the buffer stays under the mark', async () => {
    const calls: Calls = [];
    const socket = await createdSocket(calls);
    socket.sent.length = 0;
    socket.bufferedAmount = PTY_OUTBOUND_HIGH_WATER_BYTES - 1;
    socket.emit(JSON.stringify({
      type: 'input', requestId: 'r2', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID,
      encoding: 'base64', data: 'aGk=',
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(socket.closedWith).toBeNull();
    expect(socket.sent).toEqual([
      { type: 'ack', requestId: 'r2', action: 'input', sessionId: SESSION_ID, revision: 3, accepted: 3 },
    ]);
  });

  it('refuses input and resize on a session whose exit has settled, server-side', async () => {
    const calls: Calls = [];
    let sink: SessionSink | null = null;
    const socket = await createdSocket(calls, (captured) => { sink = captured; });
    if (sink === null) throw new Error('the registry never received a sink');
    // The host observed the exit: this session is read-only from here, whatever the client believes.
    (sink as SessionSink).exit(exited());
    socket.sent.length = 0;
    calls.length = 0;

    socket.emit(JSON.stringify({
      type: 'input', requestId: 'r2', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID,
      encoding: 'base64', data: 'aGk=',
    }));
    socket.emit(JSON.stringify({
      type: 'resize', requestId: 'r3', sessionId: SESSION_ID, attachmentId: ATTACHMENT_ID, cols: 100, rows: 30,
    }));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toEqual([]);
    expect(socket.sent).toEqual([
      { type: 'error', requestId: 'r2', sessionId: SESSION_ID, code: 'invalid-request', detail: 'session-ended' },
      { type: 'error', requestId: 'r3', sessionId: SESSION_ID, code: 'invalid-request', detail: 'session-ended' },
    ]);
  });
});

describe('handlePtyConnection — reattach replays scrollback before live data', () => {
  const REPLAY_OWNER: BrowserPrincipal = { operator: 'daniel', browserSessionRef: REF };
  let replayStateRoot: string;

  beforeEach(() => {
    replayStateRoot = mkdtempSync(join(tmpdir(), 'kb-route-replay-'));
  });

  afterEach(() => {
    rmSync(replayStateRoot, { recursive: true, force: true });
  });

  /** A REAL W3 transcript on disk, written the way the registry writes one: `sequence` is a byte offset. */
  const seedTranscript = (chunks: Buffer[]): Buffer => {
    const retention = createTranscriptRetention(replayStateRoot, 4_000_000);
    let offset = 0;
    for (const chunk of chunks) {
      retention.append(SESSION_ID, offset, chunk);
      offset += chunk.byteLength;
    }
    return Buffer.concat(chunks);
  };

  const replayContext = (
    capture: (sink: SessionSink) => void,
    replay: SessionReplayReader,
  ) => {
    const attachment: Attachment = {
      attachmentId: ATTACHMENT_ID, session: summary(), detach: async () => {},
    };
    const registry = {
      attach: async (_p: BrowserPrincipal, _id: string, s: SessionSink) => {
        capture(s);
        return { ok: true, value: attachment } as PortResult<Attachment>;
      },
    } as unknown as SessionRegistryPort;
    return makePtyRouteContext({
      repoRoot: process.cwd(),
      sessionConfig,
      allowedOrigins: ['https://kb.test'],
      registry,
      persistence: fakePersistence(5),
      replay,
      appendAudit: () => ({ ts: '', action: '', owner: '', result: '' } as never),
    });
  };

  const liveFrame = (text: string): SessionDataFrame => ({
    sessionId: SESSION_ID, sequence: 9_000, encoding: 'base64',
    data: Buffer.from(text, 'utf8').toString('base64'), replay: false,
  });

  it('buffers output produced DURING the replay read and drains it after the scrollback', async () => {
    // The defect this pins: the sink is installed by `registry.attach`, but the scrollback is still
    // being read off disk. Live output produced in that window must not overtake the bytes it follows.
    // The injection happens INSIDE the replay await — no busy-wait, no timing luck.
    const scrollback = seedTranscript([Buffer.from('scroll-one\r\n', 'utf8'), Buffer.from([0xff, 0xfe, 0x00])]);
    let sink: SessionSink | null = null;
    const reader = createRawSessionReplayReader({ stateRoot: replayStateRoot });
    const ctx = replayContext((captured) => { sink = captured; }, async (sessionId, fromSequence) => {
      (sink as unknown as SessionSink).data(liveFrame('live-during\r\n'));
      return reader(sessionId, fromSequence);
    });

    const socket = fakeSocket();
    await handlePtyConnection(socket, REPLAY_OWNER, ctx);
    socket.emit(JSON.stringify({ type: 'attach', requestId: 'r1', sessionId: SESSION_ID, fromSequence: 0 }));
    await new Promise((r) => setTimeout(r, 50));

    const sent = socket.sent as { type: string; replay?: boolean; data?: string }[];
    // The exact order, positionally: `attached`, then the scrollback, then the live frame it precedes.
    expect(sent.map((frame) => `${frame.type}${frame.type === 'data' ? (frame.replay ? ':replay' : ':live') : ''}`))
      .toEqual(['attached', 'data:replay', 'data:live']);
    expect(sent[0]).toMatchObject({ type: 'attached', requestId: 'r1', replayFrom: 0, nextSequence: scrollback.byteLength });
    expect(Buffer.from(sent[1].data ?? '', 'base64').equals(scrollback)).toBe(true);
    expect(Buffer.from(sent[2].data ?? '', 'base64').toString('utf8')).toBe('live-during\r\n');
  });

  it('reports the replay it could actually honour, not the cursor it was asked for', async () => {
    // 96 KiB of transcript against a 64 KiB window: the reattach gets the TAIL, and `replayFrom` says so.
    const scrollback = seedTranscript([Buffer.alloc(49_152, 0x61), Buffer.alloc(49_152, 0x62)]);
    const ctx = replayContext(() => {}, createRawSessionReplayReader({ stateRoot: replayStateRoot }));
    const socket = fakeSocket();
    await handlePtyConnection(socket, REPLAY_OWNER, ctx);
    socket.emit(JSON.stringify({ type: 'attach', requestId: 'r1', sessionId: SESSION_ID, fromSequence: 0 }));
    await new Promise((r) => setTimeout(r, 50));

    const sent = socket.sent as { type: string; replayFrom?: number; nextSequence?: number; sequence?: number }[];
    expect(sent[0]).toMatchObject({ type: 'attached', replayFrom: 32_768, nextSequence: scrollback.byteLength });
    expect(sent[1]).toMatchObject({ type: 'data', sequence: 32_768 });
  });

  it('sheds a connection that produces past the high-water mark while its replay is buffered', async () => {
    seedTranscript([Buffer.from('scroll\r\n', 'utf8')]);
    let sink: SessionSink | null = null;
    const reader = createRawSessionReplayReader({ stateRoot: replayStateRoot });
    const ctx = replayContext((captured) => { sink = captured; }, async (sessionId, fromSequence) => {
      // A megabyte of output while the scrollback is being read: the buffer is bounded by the SAME
      // high-water mark as the socket, so this reader is shed rather than the daemon paying for it.
      const flood = liveFrame('x'.repeat(200_000));
      for (let index = 0; index < 8; index += 1) (sink as unknown as SessionSink).data(flood);
      return reader(sessionId, fromSequence);
    });

    const socket = fakeSocket();
    await handlePtyConnection(socket, REPLAY_OWNER, ctx);
    socket.emit(JSON.stringify({ type: 'attach', requestId: 'r1', sessionId: SESSION_ID, fromSequence: 0 }));
    await new Promise((r) => setTimeout(r, 50));

    expect(socket.closedWith).toEqual({ code: 1013, reason: 'backpressure' });
    expect(socket.sent).toEqual([]);
  });
});

import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConfig } from './session.ts';
import { registerAuthRoutes, registerBrowserSessionRoute, registerDesktopSessionRoute } from './routes.ts';
import { currentAttribution } from './operator.ts';
import { verifySession } from './session.ts';
import type { DesktopPeerCheck } from './win32DesktopPeer.ts';
import { createBrowserSessionRefStore } from './session.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';

const SESSION: SessionConfig = {
  secret: Buffer.from('auth-route-test-secret-thirty-two-b!'), ttlMs: 60_000, now: () => 1_700_000_000_000,
};
let testStateRoot: string;

beforeEach(() => {
  testStateRoot = mkdtempSync(join(tmpdir(), 'kb-auth-routes-state-'));
});

/** A lightweight ctx for `registerAuthRoutes` alone: real defaults for anything these routes never
 *  touch (control store, pty host, ...) are harmless since nothing here invokes them; git/audit are
 *  recording fakes so no real subprocess or repo write happens. */
function buildApp(overrides: Record<string, unknown> = {}) {
  const audit: Array<Record<string, unknown>> = [];
  const app = Fastify();
  const ctx = makeSurfaceContext({
    controlStore: createInMemoryControlPlaneStore(),
    repoRoot: fileURLToPath(new URL('../../../', import.meta.url)),
    stateRoot: testStateRoot,
    sessionConfig: SESSION,
    appendAudit: (_root: string, event: Record<string, unknown>) => {
      audit.push(event);
      return { ts: '2026-07-30T00:00:00.000Z', action: String(event.action) } as never;
    },
    opsGit: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    ...overrides,
  } as never);
  registerAuthRoutes(app, ctx);
  return { app, audit };
}

describe('auth routes', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    rmSync(testStateRoot, { recursive: true, force: true });
  });

  it.each(['tailnet', 'win32-desktop'] as const)('reports the %s auth mode, and nothing else', async (authMode) => {
    ({ app } = buildApp({ authMode }));

    const res = await app.inject({ method: 'GET', url: '/api/auth/context' });

    expect(res.statusCode).toBe(200);
    // T2 removed the ceremony this route used to also report reachability for
    // (`ceremonyAvailable`); the boot-discovery call now exposes the mode only.
    expect(res.json()).toEqual({ mode: authMode });
  });

  it('leaves /api/auth/context public — it is the boot discovery call', async () => {
    ({ app } = buildApp({
      authMode: 'tailnet',
      sessionConfig: { ...SESSION, operatorAuth: { authenticate: () => ({ ok: false as const, reason: 'identity-not-allowed' as const }) } },
    }));
    const res = await app.inject({ method: 'GET', url: '/api/auth/context' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'tailnet' });
  });

  it('there is no register/assert ceremony route left to reach', async () => {
    ({ app } = buildApp());
    for (const url of [
      '/api/auth/register/options', '/api/auth/register/verify',
      '/api/auth/assert/options', '/api/auth/assert/verify',
    ]) {
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode).toBe(404);
    }
  });
});

/**
 * `POST /api/auth/browser-session` (plan L235 + route matrix). The ONLY way the always-on tailnet
 * deployment ever obtains a controller cookie: tailnet auth is ambient, so no assertion is ever verified
 * there. These cases drive the route directly; that it sits behind the Origin guard AND the operator/
 * session gate is pinned in `http/surface.test.ts`.
 */
describe('POST /api/auth/browser-session', () => {
  let app: ReturnType<typeof Fastify> | undefined;
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
  const REF_COOKIE_RE =
    /^kb_browser_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/;
  /** The value-less `Max-Age=0` eviction header a refusal sends so an HttpOnly dead ref can be dropped.
   *  Its attributes match a real ref cookie exactly — a browser only replaces a cookie when they do. */
  const EVICTION_COOKIE = 'kb_browser_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
  /** Any cookie actually CARRYING a ref. A refusal must never produce one of these. */
  const carriesRef = (cookies: string[]): boolean =>
    cookies.some((value) => /^kb_browser_session=[A-Za-z0-9_-]{43}/.test(value));

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function mount(refs: unknown) {
    const instance = Fastify();
    // The route reads exactly one field of the context; nothing else is in its reach.
    registerBrowserSessionRoute(instance, { browserSessionRefs: refs } as never);
    app = instance;
    return instance;
  }

  const post = (instance: ReturnType<typeof Fastify>, cookie?: string) => instance.inject({
    method: 'POST', url: '/api/auth/browser-session', payload: {},
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });

  const setCookies = (response: Awaited<ReturnType<typeof post>>): string[] => {
    const raw = response.headers['set-cookie'];
    return raw === undefined ? [] : ([] as string[]).concat(raw as string | string[]);
  };

  it('mints the exact six-attribute ref cookie for an operator that presents none (the tailnet path)', async () => {
    const instance = mount(createBrowserSessionRefStore());

    const response = await post(instance);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(setCookies(response)).toHaveLength(1);
    expect(setCookies(response)[0]).toMatch(REF_COOKIE_RE);
  });

  it('leaves a live ref alone outside the 7-day renewal window, and renews the SAME value inside it', async () => {
    let clock = new Date('2026-08-23T00:00:00.000Z');
    const refs = createBrowserSessionRefStore({ now: () => clock });
    const instance = mount(refs);
    const minted = await post(instance);
    const ref = /kb_browser_session=([A-Za-z0-9_-]{43})/.exec(setCookies(minted)[0])?.[1] as string;
    const cookie = `kb_browser_session=${ref}`;

    // 22 days in: 8 days remain, still outside the window — no cookie, the browser keeps what it has.
    clock = new Date(clock.getTime() + 22 * 24 * 60 * 60 * 1_000);
    const untouched = await post(instance, cookie);
    expect(untouched.statusCode).toBe(204);
    expect(untouched.body).toBe('');
    expect(setCookies(untouched)).toEqual([]);

    // 26 days in: 4 days remain — renewed, and the ref VALUE is preserved (plan L235: "same value").
    clock = new Date(clock.getTime() + 4 * 24 * 60 * 60 * 1_000);
    const renewed = await post(instance, cookie);
    expect(renewed.statusCode).toBe(204);
    expect(setCookies(renewed)).toEqual([
      `kb_browser_session=${ref}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
    ]);
  });

  it('401s a forged ref and issues NO ref — a presented ref is never implicitly re-minted over', async () => {
    const instance = mount(createBrowserSessionRefStore());
    const forged = Buffer.alloc(32, 'f').toString('base64url');

    const response = await post(instance, `kb_browser_session=${forged}`);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'browser-session-ref-invalid' });
    // Plan L235 unchanged: the refusal hands back nothing a browser could present as a credential.
    expect(carriesRef(setCookies(response))).toBe(false);
  });

  it('EXPIRES the refused ref, so a browser that cannot clear an HttpOnly cookie can still recover', async () => {
    // The bug this pins: a daemon restart empties the ref store, every browser then holds a ref the
    // daemon has forgotten, `kb_browser_session` is HttpOnly so no script can drop it, and the browser
    // is stuck on 401 here + 428 at `/api/pty` across reloads with no user-reachable recovery.
    const instance = mount(createBrowserSessionRefStore());
    const forgotten = Buffer.alloc(32, 'f').toString('base64url');

    const refused = await post(instance, `kb_browser_session=${forgotten}`);

    expect(refused.statusCode).toBe(401);
    expect(setCookies(refused)).toEqual([EVICTION_COOKIE]);
    // EXPIRING IS NOT MINTING: the header carries no ref at all, so the refusal cannot be an implicit
    // re-mint however the browser treats it.
    expect(carriesRef(setCookies(refused))).toBe(false);

    // Having dropped the dead cookie, the browser's very next call presents nothing and mints cleanly —
    // a separate request on the ordinary mint path, which is exactly what plan L235 prescribes.
    const recovered = await post(instance);
    expect(recovered.statusCode).toBe(204);
    expect(setCookies(recovered)[0]).toMatch(REF_COOKIE_RE);
  });

  it('401s an EXPIRED ref rather than handing back a fresh one', async () => {
    let clock = new Date('2026-08-23T00:00:00.000Z');
    const instance = mount(createBrowserSessionRefStore({ now: () => clock }));
    const minted = await post(instance);
    const ref = /kb_browser_session=([A-Za-z0-9_-]{43})/.exec(setCookies(minted)[0])?.[1] as string;

    clock = new Date(clock.getTime() + THIRTY_DAYS_MS + 1_000);
    const response = await post(instance, `kb_browser_session=${ref}`);

    expect(response.statusCode).toBe(401);
    expect(setCookies(response)).toEqual([EVICTION_COOKIE]);
    expect(carriesRef(setCookies(response))).toBe(false);
  });

  it('401s a request carrying TWO ref cookies (fail-closed on an ambiguous credential)', async () => {
    const refs = createBrowserSessionRefStore();
    const instance = mount(refs);
    const minted = await post(instance);
    const ref = /kb_browser_session=([A-Za-z0-9_-]{43})/.exec(setCookies(minted)[0])?.[1] as string;

    const response = await post(instance, `kb_browser_session=${ref}; kb_browser_session=${ref}`);

    // The second cookie could be attacker-planted on a sibling path; picking either one is a guess.
    expect(response.statusCode).toBe(401);
    expect(setCookies(response)).toEqual([EVICTION_COOKIE]);
    expect(carriesRef(setCookies(response))).toBe(false);
  });

  it('401s a malformed value without minting over it', async () => {
    const instance = mount(createBrowserSessionRefStore());

    const response = await post(instance, 'kb_browser_session=not-a-ref');

    expect(response.statusCode).toBe(401);
    expect(setCookies(response)).toEqual([EVICTION_COOKIE]);
    expect(carriesRef(setCookies(response))).toBe(false);
  });

  it('503s — never 401 — when the ref store is unavailable, and sets no cookie', async () => {
    const instance = mount(undefined);

    const response = await post(instance);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'browser-session-ref-unavailable' });
    // A store that could not ANSWER has said nothing about the ref: a 503 must never delete a
    // possibly-live credential, which would log an operator out over a read failure (D6).
    expect(setCookies(response)).toEqual([]);
  });

  it('503s when a storage fault exhausts the mint, and the operator is not logged out by it', async () => {
    const instance = mount(createBrowserSessionRefStore({
      persistence: { read: () => { throw new Error('unreadable'); } } as never,
    }));

    const response = await post(instance);

    expect(response.statusCode).toBe(503);
    expect(setCookies(response)).toEqual([]);
  });
});

/**
 * BLOCKER-2 — the `win32-desktop` mint path. T2's removal of the browser sign-in ceremony took the ONLY
 * way that mode could ever obtain a session, so the always-on desktop daemon refused every governed
 * request. Its replacement is `POST /api/auth/browser-session` registered OUTSIDE the session gate in that mode and
 * guarded instead by the OS-level peer-owner proof (`win32DesktopPeer.ts`): loopback + the same Windows
 * account as the daemon, or nothing.
 *
 * The peer check is injected here so this matrix drives every arm; the proof itself (a real 4-tuple
 * against `GetExtendedTcpTable`, a real token SID) is tested against a live socket in
 * `win32DesktopPeer.test.ts`, and the route's PLACEMENT in each mode is pinned in `http/surface.test.ts`.
 */
describe('POST /api/auth/browser-session — the win32-desktop session mint path', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function mount(desktopPeer: DesktopPeerCheck, refs: unknown = createBrowserSessionRefStore()) {
    const instance = Fastify();
    const bound: Array<unknown> = [];
    instance.addHook('onSend', async (_req, _reply, payload) => {
      bound.push(currentAttribution());
      return payload;
    });
    registerDesktopSessionRoute(instance, { browserSessionRefs: refs, sessionConfig: SESSION, desktopPeer } as never);
    app = instance;
    return { instance, bound };
  }

  const post = (instance: ReturnType<typeof Fastify>, headers: Record<string, string> = {}) => instance.inject({
    method: 'POST', url: '/api/auth/browser-session', payload: {}, headers,
  });

  it('mints a REAL session for a loopback peer owned by the daemon-s own Windows account', async () => {
    const { instance, bound } = mount(() => ({ ok: true, user: 'danie' }));

    const response = await post(instance, { 'x-kb-actor': 'daniel' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { token: string; expiresAt: number; browserSession: string };
    // Not a sentinel: the token verifies against the very config every governed route re-verifies with.
    expect(verifySession(body.token, SESSION)).toEqual({ ok: true, claims: expect.objectContaining({ sub: 'operator' }) });
    expect(body.expiresAt).toBe(SESSION.now!() + SESSION.ttlMs!);
    expect(body.browserSession).toBe('minted');
    // The controller cookie still rides along, so one call unlocks both the surface and the terminal.
    expect(([] as string[]).concat(response.headers['set-cookie'] as string[])[0]).toMatch(/^kb_browser_session=[A-Za-z0-9_-]{43};/);
    // Attribution: the self-asserted actor, no tailnet identity, and the OS account the proof resolved.
    expect(bound[0]).toEqual({ actor: 'daniel', tailnetIdentity: null, desktopUser: 'danie' });
  });

  it('refuses a loopback peer owned by ANOTHER OS user — 401, no token, no cookie', async () => {
    const { instance } = mount(() => ({ ok: false, reason: 'peer-not-same-user' }));

    const response = await post(instance);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated', reason: 'peer-not-same-user' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a request that did not arrive on loopback', async () => {
    const { instance } = mount(() => ({ ok: false, reason: 'not-loopback' }));

    const response = await post(instance);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated', reason: 'not-loopback' });
  });

  it('refuses when the peer cannot be determined at all (the proof is unavailable)', async () => {
    const { instance } = mount(() => ({ ok: false, reason: 'peer-lookup-unavailable' }));

    expect((await post(instance)).statusCode).toBe(401);
  });

  it('refuses when no peer check is installed at all — an absent proof is never a pass', async () => {
    const instance = Fastify();
    registerDesktopSessionRoute(instance, { browserSessionRefs: createBrowserSessionRefStore(), sessionConfig: SESSION } as never);
    app = instance;

    const response = await post(instance);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated', reason: 'peer-lookup-unavailable' });
  });

  it('never consults the peer proof twice, and never mints two sessions for one request', async () => {
    const peer = vi.fn(() => ({ ok: true as const, user: 'danie' }));
    const { instance } = mount(peer);

    await post(instance);

    expect(peer).toHaveBeenCalledTimes(1);
  });

  it('still refuses a ref this browser presented and the daemon does not know — and mints no session on it', async () => {
    const { instance } = mount(() => ({ ok: true, user: 'danie' }));

    const response = await post(instance, { cookie: `kb_browser_session=${'z'.repeat(43)}` });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'browser-session-ref-invalid' });
    // The eviction header, so the retry presents nothing and takes the clean mint path.
    expect(([] as string[]).concat(response.headers['set-cookie'] as string[])[0]).toBe(
      'kb_browser_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    );
  });

  it('mints the session even when the ref store cannot answer — the surface never depends on the PTY table', async () => {
    const instance = Fastify();
    registerDesktopSessionRoute(instance, { sessionConfig: SESSION, desktopPeer: () => ({ ok: true, user: 'danie' }) } as never);
    app = instance;

    const response = await post(instance);

    expect(response.statusCode).toBe(200);
    const body = response.json() as { token: string; browserSession: string };
    expect(verifySession(body.token, SESSION).ok).toBe(true);
    expect(body.browserSession).toBe('unavailable');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

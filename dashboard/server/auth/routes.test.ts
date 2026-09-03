import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConfig } from './session.ts';
import { rememberChallenge } from './credentialStore.ts';
import { registerAuthRoutes, registerBrowserSessionRoute } from './routes.ts';
import { createBrowserSessionRefStore } from './session.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';

const verifyAssertionMock = vi.hoisted(() => vi.fn());
const verifyRegistrationMock = vi.hoisted(() => vi.fn());
vi.mock('./webauthn.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./webauthn.ts')>(),
  verifyAssertion: verifyAssertionMock,
  verifyRegistration: verifyRegistrationMock,
}));

const SESSION: SessionConfig = {
  secret: Buffer.from('auth-route-test-secret-thirty-two-b!'), ttlMs: 60_000, now: () => 1_700_000_000_000,
};
const TEST_WEBAUTHN = () => ({ rpID: 'localhost', rpName: 'test', origin: 'http://localhost:5317' });
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
    webAuthnConfig: TEST_WEBAUTHN,
    credentials: () => [],
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

describe('auth ceremony routes', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    verifyAssertionMock.mockReset();
    verifyRegistrationMock.mockReset();
    rmSync(testStateRoot, { recursive: true, force: true });
  });

  it.each(['tailnet', 'win32-desktop'] as const)('reports the %s auth mode and a fail-closed ceremonyAvailable', async (authMode) => {
    ({ app } = buildApp({ authMode }));

    const res = await app.inject({ method: 'GET', url: '/api/auth/context' });

    expect(res.statusCode).toBe(200);
    // W47: with no provisioned credential the answer is `false` in BOTH modes - the same predicate the
    // T3 challenge routes enforce, so the client never renders an Approve the routes would refuse.
    expect(res.json()).toEqual({ mode: authMode, ceremonyAvailable: false });
  });

  it.each(['tailnet', 'win32-desktop'] as const)('W47: %s + a provisioned credential reports ceremonyAvailable true', async (authMode) => {
    // RED ON REVERT: drop `ceremonyAvailable` from the route (or re-narrow `ceremonyModeAdmits` to
    // win32-desktop) and the tailnet case fails - which is exactly the client-side half of the defect
    // that parked the first VM acceptance run at an unapprovable T3 gate.
    ({ app } = buildApp({ authMode, credentials: () => [{ id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 }] }));

    const res = await app.inject({ method: 'GET', url: '/api/auth/context' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: authMode, ceremonyAvailable: true });
    // It never leaks the store: no id, no key material, no count.
    expect(res.body).not.toContain('cred-1');
  });

  /**
   * W47 [review item 3]: WHO may run a ceremony.
   *
   * win32-desktop keeps them public - the assertion IS the credential there, so a session gate would
   * be circular. tailnet has no circularity (the transport proves the operator first), and tailnet
   * membership on the VM is root-equivalent, so a public enrolment route would let ANY tailnet
   * principal drive a registration against the VM's RP. RED ON REVERT: drop `ceremonyGate` from the
   * four routes in auth/routes.ts and the refusal case below returns 200/503 instead of 403.
   */
  describe('W47 tailnet ceremony routes sit behind the operator identity gate', () => {
    const CEREMONY_ROUTES = [
      '/api/auth/register/options', '/api/auth/register/verify',
      '/api/auth/assert/options', '/api/auth/assert/verify',
    ] as const;
    const deny = { authenticate: () => ({ ok: false as const, reason: 'identity-not-allowed' as const }) };
    const allow = {
      authenticate: () => ({ ok: true as const, subject: 'operator', attribution: { login: 'daniel@x' } }),
    };

    it.each(CEREMONY_ROUTES)('refuses %s for a non-operator tailnet identity', async (url) => {
      ({ app } = buildApp({ authMode: 'tailnet', sessionConfig: { ...SESSION, operatorAuth: deny } }));
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden', reason: 'identity-not-allowed' });
    });

    it('admits the pinned operator to the register ceremony once an RP origin is set', async () => {
      ({ app } = buildApp({ authMode: 'tailnet', sessionConfig: { ...SESSION, operatorAuth: allow } }));
      const res = await app.inject({ method: 'POST', url: '/api/auth/register/options', payload: {} });
      expect(res.statusCode, res.body).toBe(200);
      expect(typeof res.json().ceremonyId).toBe('string');
    });

    it('leaves /api/auth/context public in tailnet mode - it is the boot discovery call', async () => {
      ({ app } = buildApp({ authMode: 'tailnet', sessionConfig: { ...SESSION, operatorAuth: deny } }));
      const res = await app.inject({ method: 'GET', url: '/api/auth/context' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ mode: 'tailnet', ceremonyAvailable: false });
    });

    it.each(CEREMONY_ROUTES)('leaves %s PUBLIC in win32-desktop mode (unchanged)', async (url) => {
      // No operatorAuth, no bearer: the gate must not exist in this mode, or nobody could sign in.
      ({ app } = buildApp({ authMode: 'win32-desktop' }));
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });
  });

  it('a genuinely unknown ceremonyId is refused as bad-ceremony', async () => {
    ({ app } = buildApp());
    const res = await app.inject({
      method: 'POST', url: '/api/auth/assert/verify',
      payload: { ceremonyId: 'never-issued', response: { id: 'cred-1' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-ceremony' });
  });

  it('mints an assert ceremony whose challenge is plain opaque bytes, never a "kb." preimage', async () => {
    ({ app } = buildApp());
    const options = await app.inject({ method: 'POST', url: '/api/auth/assert/options', payload: {} });
    expect(options.statusCode).toBe(200);
    const body = options.json() as { ceremonyId: string; options: { challenge: string } };
    // A real login challenge never happens to decode to a "kb."-prefixed UTF-8 string (it is fresh
    // random bytes from SimpleWebAuthn, never constructed from a purpose preimage).
    const decoded = Buffer.from(body.options.challenge, 'base64url').toString('utf8');
    expect(decoded.startsWith('kb.')).toBe(false);
  });

  it('LOW (audit follow-up): refuses a purpose-bound (execution-unlock-shaped) ceremony redeemed at sign-in', async () => {
    // Mint a ceremony carrying the SAME preimage shape control/routes.ts's execution-unlock ceremony
    // uses ("kb.<purpose>:<subject>:<random>"), the way that route does, without depending on
    // control/routes.ts at all — this proves the auth routes themselves reject the namespace,
    // regardless of which other route mints it.
    ({ app } = buildApp());
    const challenge = Buffer.from('kb.execution-unlock:operator:not-a-real-signature', 'utf8').toString('base64url');
    const { ceremonyId } = rememberChallenge(challenge);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/assert/verify',
      payload: { ceremonyId, response: { id: 'cred-1' } },
    });
    // Refused at the purpose-check, BEFORE any credential lookup — bad-ceremony, not unauthenticated.
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-ceremony' });
  });

  it('P5 W6.3: refuses a deploy-purpose (kb.deploy-t3) ceremonyId redeemed at the generic sign-in [P5-C20]', async () => {
    // The deploy challenge mints a purpose-bound `kb.deploy-t3` preimage through the SAME pending map; a
    // ceremonyId minted for the deploy purpose must never mint a full sign-in session. Refused at the
    // namespace check, BEFORE any credential lookup — 400 bad-ceremony, not a downgrade.
    ({ app } = buildApp({ credentials: () => [{ id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 }] }));
    const deployChallenge = Buffer.from(
      'kb.deploy-t3.v1.ZGVwbG95LXJlYWR5', 'utf8',
    ).toString('base64url');
    const { ceremonyId } = rememberChallenge(deployChallenge);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/assert/verify',
      payload: { ceremonyId, response: { id: 'cred-1' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-ceremony' });
  });

  it('LOW (audit follow-up): refuses the same purpose-bound ceremony redeemed at registration', async () => {
    ({ app } = buildApp());
    const challenge = Buffer.from('kb.execution-unlock:operator:not-a-real-signature', 'utf8').toString('base64url');
    const { ceremonyId } = rememberChallenge(challenge);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register/verify',
      payload: { ceremonyId, response: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-ceremony' });
  });

  it('returns the verified registration credential transports for provisioning', async () => {
    ({ app } = buildApp());
    verifyRegistrationMock.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 4, transports: ['internal'] },
      },
    });
    const { ceremonyId } = rememberChallenge('registration-challenge');
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register/verify', payload: { ceremonyId, response: {} },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      verified: true,
      credential: { id: 'cred-1', publicKey: 'AQID', counter: 4, transports: ['internal'] },
    });
  });

  it('omits transports when the verified registration credential does not report them', async () => {
    ({ app } = buildApp());
    verifyRegistrationMock.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 },
      },
    });
    const { ceremonyId } = rememberChallenge('registration-challenge');
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register/verify', payload: { ceremonyId, response: {} },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().credential).not.toHaveProperty('transports');
  });

  it('a namespaced challenge is consumed (single-use) even though it is refused, so it cannot be retried', async () => {
    ({ app } = buildApp());
    const challenge = Buffer.from('kb.execution-unlock:operator:x', 'utf8').toString('base64url');
    const { ceremonyId } = rememberChallenge(challenge);
    const first = await app.inject({
      method: 'POST', url: '/api/auth/assert/verify',
      payload: { ceremonyId, response: { id: 'cred-1' } },
    });
    expect(first.statusCode).toBe(400);
    const second = await app.inject({
      method: 'POST', url: '/api/auth/assert/verify',
      payload: { ceremonyId, response: { id: 'cred-1' } },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toMatchObject({ error: 'bad-ceremony', reason: 'unknown or expired assertion ceremony' });
  });

  it('a plain (non-namespaced) ceremony still reaches the normal fail-closed 401 with no credentials registered', async () => {
    ({ app } = buildApp());
    const options = await app.inject({ method: 'POST', url: '/api/auth/assert/options', payload: {} });
    const ceremonyId = (options.json() as { ceremonyId: string }).ceremonyId;
    const res = await app.inject({
      method: 'POST', url: '/api/auth/assert/verify',
      payload: { ceremonyId, response: { id: 'cred-1' } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthenticated' });
  });

  it('webauthn-unconfigured 503s cleanly when DASHBOARD_RP_ORIGIN is unset', async () => {
    ({ app } = buildApp({
      webAuthnConfig: () => { throw new Error('DASHBOARD_RP_ORIGIN is not set'); },
    }));
    const res = await app.inject({ method: 'POST', url: '/api/auth/assert/options', payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'webauthn-unconfigured' });
  });

  it.each([
    ['http://localhost:5317', false],
    ['https://kb.example.test', true],
  ])('sets a hardened session cookie when the RP origin is %s', async (origin, secure) => {
    ({ app } = buildApp({
      webAuthnConfig: () => ({ rpID: new URL(origin).hostname, rpName: 'test', origin }),
      credentials: () => [{ id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 }],
    }));
    verifyAssertionMock.mockResolvedValue({ verified: true });
    const options = await app.inject({ method: 'POST', url: '/api/auth/assert/options', payload: {} });
    const ceremonyId = (options.json() as { ceremonyId: string }).ceremonyId;
    const response = await app.inject({
      method: 'POST', url: '/api/auth/assert/verify', payload: { ceremonyId, response: { id: 'cred-1' } },
    });

    expect(response.statusCode).toBe(200);
    // A verified assertion now sets TWO cookies: the session bearer, and the browser-session ref that is
    // the second half of a PTY principal (W6.3).
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] as string | string[]);
    const cookie = cookies.find((value) => value.startsWith('kb_session=')) as string;
    expect(cookie).toMatch(/^kb_session=/);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=60');
    expect(cookie.includes('; Secure')).toBe(secure);
    // The ref cookie's attributes are fixed by `browserSessionRef.ts`, not by the RP origin's scheme: it
    // is always HttpOnly + Secure + SameSite=Strict, and it carries 256 bits of base64url randomness.
    const browserSession = cookies.find((value) => value.startsWith('kb_browser_session=')) as string;
    expect(browserSession).toMatch(
      /^kb_browser_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/,
    );
  });
});

/**
 * W6.3b — `POST /api/auth/browser-session` (plan L235 + route matrix). The ONLY path by which the
 * always-on tailnet deployment obtains a controller cookie: tailnet auth is ambient, so no assertion is
 * ever verified there and the WebAuthn mint path never runs. These cases drive the route directly; that
 * it sits behind the Origin guard AND the operator/session gate is pinned in `http/surface.test.ts`.
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

describe('assert/verify — a presented ref is never silently re-minted (plan L235)', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('signs the operator in but issues NO ref cookie when the browser presents a forged ref', async () => {
    ({ app } = buildApp({ credentials: () => [{ id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 }] }));
    verifyAssertionMock.mockResolvedValue({ verified: true });
    const options = await app.inject({ method: 'POST', url: '/api/auth/assert/options', payload: {} });
    const ceremonyId = (options.json() as { ceremonyId: string }).ceremonyId;
    const forged = Buffer.alloc(32, 'f').toString('base64url');

    const response = await app.inject({
      method: 'POST', url: '/api/auth/assert/verify',
      payload: { ceremonyId, response: { id: 'cred-1' } },
      headers: { cookie: `kb_browser_session=${forged}` },
    });

    // A storage/credential fault must never log the operator out, so the session bearer is still issued.
    expect(response.statusCode).toBe(200);
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] as string | string[]);
    expect(cookies.some((value) => value.startsWith('kb_session='))).toBe(true);
    // RED on a revert of the 401 fall-through: the old code minted a real ref for this forged cookie.
    // The assertion is on a cookie CARRYING a ref, not on the name: signing in while holding a dead ref
    // also EXPIRES it (value-less, Max-Age=0), so the operator is not left authenticated but permanently
    // without a PTY principal. Deleting is not minting.
    expect(cookies.some((value) => /^kb_browser_session=[A-Za-z0-9_-]{43}/.test(value))).toBe(false);
    expect(cookies).toContain('kb_browser_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  });
});

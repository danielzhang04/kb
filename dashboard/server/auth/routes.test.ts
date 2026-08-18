import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionConfig } from './session.ts';
import { rememberChallenge } from './credentialStore.ts';
import { registerAuthRoutes } from './routes.ts';
import { makeSurfaceContext } from '../http/surface.ts';

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

/** A lightweight ctx for `registerAuthRoutes` alone: real defaults for anything these routes never
 *  touch (control store, pty host, ...) are harmless since nothing here invokes them; git/audit are
 *  recording fakes so no real subprocess or repo write happens. */
function buildApp(overrides: Record<string, unknown> = {}) {
  const audit: Array<Record<string, unknown>> = [];
  const app = Fastify();
  const ctx = makeSurfaceContext({
    repoRoot: fileURLToPath(new URL('../../../', import.meta.url)),
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
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/^kb_session=/);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=60');
    expect(cookie.includes('; Secure')).toBe(secure);
  });
});

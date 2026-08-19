import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { requireSession, resolveSession, sessionToken, verifiedSession } from './middleware.ts';
import { currentAttribution, OPERATOR_SUBJECT } from '../auth/operator.ts';
import type { OperatorAuth } from '../auth/operator.ts';
import { mintSession, verifySession } from '../auth/session.ts';

const SESSION = { secret: Buffer.from('middleware-test-session-secret'), now: () => 1_700_000_000_000 };

describe('sessionToken', () => {
  it('accepts the HttpOnly session cookie but not an unrelated cookie', () => {
    expect(sessionToken({ headers: { cookie: 'other=x; kb_session=signed.token' } } as never)).toBe('signed.token');
    expect(sessionToken({ headers: { cookie: 'other=x' } } as never)).toBeUndefined();
  });

  it('prefers a bearer token over a session cookie and skips an empty cookie value', () => {
    expect(sessionToken({ headers: { authorization: 'Bearer bearer.token', cookie: 'kb_session=cookie.token' } })).toBe('bearer.token');
    expect(sessionToken({ headers: { cookie: 'kb_session=; other=x' } })).toBeUndefined();
  });

  it('rejects a malformed session cookie before the route handler runs', async () => {
    const app = Fastify();
    app.get('/read', { preHandler: requireSession(SESSION) }, async () => ({ ok: true }));
    try {
      const response = await app.inject({ method: 'GET', url: '/read', headers: { cookie: 'kb_session=%E0%A4%A' } });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: 'unauthenticated' });
    } finally {
      await app.close();
    }
  });
});

/**
 * The mode seam. `requireSession` is the ONE function all eight registration sites already call with
 * `ctx.sessionConfig`, so branching here — and nowhere else — is what makes tailnet mode a seam rather
 * than a per-route bolt-on.
 */
describe('requireSession in tailnet operator mode', () => {
  const allow: OperatorAuth = {
    authenticate: () => ({ ok: true, subject: OPERATOR_SUBJECT, attribution: { login: 'op@example.com', name: 'Op' } }),
  };
  const deny: OperatorAuth = { authenticate: () => ({ ok: false, reason: 'untrusted-peer' }) };

  async function probe(operatorAuth: OperatorAuth, headers: Record<string, string> = {}) {
    const app = Fastify();
    const config = { ...SESSION, operatorAuth };
    app.get('/read', { preHandler: requireSession(config) }, async (req) => {
      const session = verifiedSession(req);
      return {
        subject: session?.claims.sub,
        // The stashed token must be a REAL signed session, because every gate module downstream
        // independently re-verifies it rather than trusting the middleware by proxy.
        tokenVerifies: session ? verifySession(session.token, config).ok : false,
        attribution: currentAttribution(),
      };
    });
    try {
      return await app.inject({ method: 'GET', url: '/read', headers });
    } finally {
      await app.close();
    }
  }

  it('admits a proven operator with NO session ceremony and mints a verifiable session', async () => {
    const response = await probe(allow);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ subject: OPERATOR_SUBJECT, tokenVerifies: true });
  });

  it('binds the tailnet attribution for the request so audit rows can stamp it', async () => {
    expect((await probe(allow)).json()).toMatchObject({ attribution: { login: 'op@example.com', name: 'Op' } });
  });

  it('403s a refused request with the authenticator reason and never mints a session', async () => {
    const response = await probe(deny);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden', reason: 'untrusted-peer' });
  });

  it('IGNORES a client-supplied bearer entirely — the transport is the only credential', async () => {
    // A forged/stale bearer must neither grant access when the peer is untrusted...
    expect((await probe(deny, { authorization: 'Bearer forged.token' })).statusCode).toBe(403);
    // ...nor change the subject when the peer is trusted.
    expect((await probe(allow, { authorization: 'Bearer forged.token' })).json())
      .toMatchObject({ subject: OPERATOR_SUBJECT });
  });

  it('resolveSession serves the PTY route too, ignoring its subprotocol bearer in tailnet mode', () => {
    // The PTY WebSocket carries its bearer in the subprotocol rather than the headers, so it calls
    // resolveSession with an explicit token. In tailnet mode that token must be irrelevant in BOTH
    // directions: a bogus one still succeeds behind a proven peer, and a plausible one cannot rescue an
    // unproven peer. Without this the Terminal view would simply be dead in tailnet mode.
    const req = { headers: {}, socket: {} } as unknown as FastifyRequest;
    const admitted = resolveSession(req, { ...SESSION, operatorAuth: allow }, 'bogus.subprotocol.token');
    expect(admitted.ok && admitted.claims.sub).toBe(OPERATOR_SUBJECT);
    expect(resolveSession(req, { ...SESSION, operatorAuth: deny }, 'bogus.subprotocol.token'))
      .toMatchObject({ ok: false, status: 403, reason: 'untrusted-peer' });
  });

  it('resolveSession still honours a presented token in win32-desktop mode', () => {
    const minted = mintSession('operator', SESSION);
    const req = { headers: {} } as unknown as FastifyRequest;
    expect(resolveSession(req, SESSION, minted.token)).toMatchObject({ ok: true, token: minted.token });
    expect(resolveSession(req, SESSION, 'garbage')).toMatchObject({ ok: false, status: 401 });
    expect(resolveSession(req, SESSION)).toMatchObject({ ok: false, status: 401, reason: 'missing session token' });
  });
});

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { requireSession, sessionToken } from './middleware.ts';

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

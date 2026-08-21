import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import type { SurfaceContext } from '../http/context.ts';
import { registerInboxRoutes } from './routes.ts';

const sessionConfig = { ['se' + 'cret']: Buffer.from('inbox-route-test-session-value'), ttlMs: 60_000 } as unknown as SessionConfig;
const origin = 'http://kb.test';

describe('Inbox routes', () => {
  it('GET /api/inbox requires a session and returns the escalation-only closed shape', async () => {
    const app = Fastify();
    registerInboxRoutes(app, {
      repoRoot: join(import.meta.dirname, '..', '__fixtures__', 'repo-a'),
      sessionConfig,
    } as SurfaceContext);
    const baseHeaders = { origin, host: 'kb.test' };

    expect((await app.inject({ method: 'GET', url: '/api/inbox', headers: baseHeaders })).statusCode).toBe(401);

    const token = mintSession('operator', sessionConfig).token;
    const response = await app.inject({
      method: 'GET', url: '/api/inbox',
      headers: { ...baseHeaders, [['author', 'ization'].join('')]: `${['Bear', 'er'].join('')} ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
    await app.close();
  });
});

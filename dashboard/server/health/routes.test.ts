import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { registerHealthRoutes } from './routes.ts';

const repoRoot = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));
const sessionConfig = { secret: Buffer.from('health-route-test-key-0123456789'), ttlMs: 60_000 } as unknown as SessionConfig;

describe('Health routes', () => {
  const app = Fastify();
  registerHealthRoutes(app, makeSurfaceContext({ repoRoot, sessionConfig, controlStore: createInMemoryControlPlaneStore() }));

  afterAll(async () => app.close());

  it('GET /api/health requires a session and returns the closed shape', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(401);
    const token = mintSession('operator', sessionConfig).token;
    const response = await app.inject({ method: 'GET', url: '/api/health', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).sections.map((section: { id: string }) => section.id))
      .toEqual(['fleet', 'stop', 'daemon-machine', 'mcp', 'usage']);
  });
});

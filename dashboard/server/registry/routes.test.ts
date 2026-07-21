import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerRegistry } from './routes.ts';

const REGISTRY_A = fileURLToPath(new URL('../__fixtures__/registry-a/', import.meta.url));

const app = Fastify({ logger: false });
registerRegistry(app, REGISTRY_A);

afterEach(async () => {
  // no-op; single app instance reused across injects
});

describe('registerRegistry routes', () => {
  it('GET /api/registry aggregates skills and connections', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/registry' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skills.count).toBe(2);
    expect(body.connections.count).toBe(2);
    expect(body).not.toHaveProperty('workflows');
  });
});

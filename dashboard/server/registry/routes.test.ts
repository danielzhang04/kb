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
  it('GET /api/registry aggregates skills, connections, and workflows', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/registry' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skills.count).toBe(2);
    expect(body.connections.count).toBe(2);
    // registry-a has no workflows/ dir → render-if-present empty state, never an error
    expect(body.workflows).toEqual({ present: false, items: [] });
  });

  it('GET /api/registry/workflows returns the render-if-present empty state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/registry/workflows' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ present: false, items: [] });
  });
});

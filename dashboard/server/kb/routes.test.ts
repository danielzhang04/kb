import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { kbBrowserRoutes } from './routes';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

async function appWithRoutes() {
  const app = Fastify({ logger: false });
  await app.register(kbBrowserRoutes, { repoRoot: REPO_A });
  await app.ready();
  return app;
}

describe('kbBrowserRoutes (read-only)', () => {
  it('GET /api/kb/tree lists a confined subpath', async () => {
    const app = await appWithRoutes();
    const res = await app.inject({ method: 'GET', url: '/api/kb/tree?path=queue' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries.map((e: { name: string }) => e.name)).toContain('inbox');
    await app.close();
  });

  it('GET /api/kb/file returns file content with the Evidence block intact as inert text', async () => {
    const app = await appWithRoutes();
    const res = await app.inject({ method: 'GET', url: '/api/kb/file?path=queue/inbox/card-inbox.md' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The Evidence block is transported verbatim — the server never interprets it.
    expect(body.content).toContain('IGNORE ALL PRIOR RULES');
    await app.close();
  });

  it('rejects a path-traversal escape with 400 (tree, file, history)', async () => {
    const app = await appWithRoutes();
    for (const url of [
      '/api/kb/tree?path=../../etc',
      '/api/kb/file?path=../../../etc/passwd',
      '/api/kb/history?path=/etc/passwd',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it('exposes NO write endpoint (POST/PUT/DELETE are 404)', async () => {
    const app = await appWithRoutes();
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/kb/file?path=queue/inbox/card-inbox.md' });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerStatic } from './routes.ts';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dashboard-static-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

/** A minimal built SPA: index.html the fallback can be told apart from a real 404. */
async function makeDist(): Promise<string> {
  const dir = await scratch();
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>kb dashboard</title><body>spa-shell</body>');
  return dir;
}

/** Registers a fake /api/ping route (standing in for the real API surface) ahead of the static
 *  module, exactly the order server/index.ts uses — API routes first, static registered last. */
function appWithApiAnd(distDir: string): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/api/ping', async () => ({ pong: true }));
  registerStatic(app, { distDir });
  return app;
}

describe('registerStatic', () => {
  it('GET / returns the built index.html when dist/ exists', async () => {
    const dist = await makeDist();
    const app = appWithApiAnd(dist);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('spa-shell');

    await app.close();
  });

  it('GET /some/spa/route falls back to index.html (client-side routing)', async () => {
    const dist = await makeDist();
    const app = appWithApiAnd(dist);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/composer/abc123' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('spa-shell');

    await app.close();
  });

  it('GET /api/ping still hits the real API handler, not the SPA fallback', async () => {
    const dist = await makeDist();
    const app = appWithApiAnd(dist);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pong: true });

    await app.close();
  });

  it('an unknown /api/* path 404s as JSON, not the SPA shell', async () => {
    const dist = await makeDist();
    const app = appWithApiAnd(dist);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('spa-shell');

    await app.close();
  });

  it('an unknown /assets/* path 404s instead of silently serving the SPA shell', async () => {
    const dist = await makeDist();
    const app = appWithApiAnd(dist);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/assets/index-STALEHASH.js' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('spa-shell');

    await app.close();
  });

  it('a real /assets/* file is still served', async () => {
    const dist = await makeDist();
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'assets', 'index-abc.js'), 'export const ok = true;');
    const app = appWithApiAnd(dist);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/assets/index-abc.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('export const ok');

    await app.close();
  });

  it('with dist/ absent, registers nothing: API still works and / is API-only (404)', async () => {
    const missing = join(await scratch(), 'does-not-exist');
    const app = appWithApiAnd(missing);
    await app.ready();

    const apiRes = await app.inject({ method: 'GET', url: '/api/ping' });
    expect(apiRes.statusCode).toBe(200);
    expect(apiRes.json()).toEqual({ pong: true });

    const rootRes = await app.inject({ method: 'GET', url: '/' });
    expect(rootRes.statusCode).toBe(404);

    await app.close();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerStatic } from './routes.ts';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dashboard-static-'));
  tmpDirs.push(dir);
  return dir;
}
const tmpFiles: string[] = [];
afterEach(async () => {
  while (tmpFiles.length) {
    await rm(tmpFiles.pop()!, { force: true });
  }
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

  it('serves a hashed asset written after boot (a rebuild without a daemon restart)', async () => {
    const dist = await makeDist();
    await mkdir(join(dist, 'assets'));
    const app = appWithApiAnd(dist);
    await app.ready();

    // Simulate `vite build` running again while the daemon is up: a new content hash appears
    // that did not exist when @fastify/static enumerated routes at registration.
    await writeFile(join(dist, 'assets', 'index-NEWHASH.js'), 'export const rebuilt = true;');

    const res = await app.inject({ method: 'GET', url: '/assets/index-NEWHASH.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('export const rebuilt');

    await app.close();
  });

  it('GET /assets/missing.js 404s as JSON', async () => {
    const dist = await makeDist();
    await mkdir(join(dist, 'assets'));
    const app = appWithApiAnd(dist);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });

    await app.close();
  });

  it('rejects an encoded ../ traversal outside dist instead of serving the file', async () => {
    const dist = await makeDist();
    await mkdir(join(dist, 'assets'));
    const app = appWithApiAnd(dist);
    await app.ready();

    const secretPath = join(dirname(dist), `secret-${Date.now()}.txt`);
    tmpFiles.push(secretPath);
    await writeFile(secretPath, 'top-secret');

    const relative = secretPath.slice(dirname(dist).length + 1).replace(/\\/g, '/');
    const res = await app.inject({ method: 'GET', url: `/assets/..%2F${relative}` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('top-secret');

    await app.close();
  });

  it('rejects a plain ../ traversal outside dist instead of serving the file', async () => {
    const dist = await makeDist();
    await mkdir(join(dist, 'assets'));
    const app = appWithApiAnd(dist);
    await app.ready();

    const secretPath = join(dirname(dist), `secret-${Date.now()}.txt`);
    tmpFiles.push(secretPath);
    await writeFile(secretPath, 'top-secret');

    // Fastify's router normalizes unencoded dot-segments before our handler ever sees req.url
    // (verified: '/assets/../x' arrives as '/secret.txt'), so this no longer looks like an
    // /assets/ request at all and lands on the ordinary SPA fallback — still never the secret.
    const relative = secretPath.slice(dirname(dist).length + 1).replace(/\\/g, '/');
    const res = await app.inject({ method: 'GET', url: `/assets/../${relative}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('spa-shell');
    expect(res.body).not.toContain('top-secret');

    await app.close();
  });

  it('GET /assets/% (malformed percent-encoding) never 500s or leaks a file body', async () => {
    const dist = await makeDist();
    await mkdir(join(dist, 'assets'));
    const app = appWithApiAnd(dist);
    await app.ready();

    // decodeURIComponent throws on a bare '%'; the try/catch below routes that straight to our
    // 404 branch. In THIS app, though, Fastify's own router (find-my-way) rejects any malformed
    // %-path with its own 400 before our not-found handler ever runs — true for every app that
    // registers at least one other GET route (find-my-way's decode-and-reject happens once per
    // request in `find()`, independent of which route the path was headed for; verified against
    // find-my-way's source and reproduced with only `/api/ping` registered, no static plugin at
    // all). Fixing that FST_ERR_BAD_URL 400 into a 404 needs `frameworkErrors` on the Fastify(...)
    // constructor in server/index.ts, outside this module's reach — so this test locks in the
    // outcome our own code is responsible for: never 5xx, never the JSON success shape, never a
    // file body, whichever layer answers first.
    const res = await app.inject({ method: 'GET', url: '/assets/%' });
    expect(res.statusCode).toBeLessThan(500);
    expect(res.body).not.toContain('spa-shell');
    expect(res.json()).not.toEqual({ pong: true });

    await app.close();
  });
});

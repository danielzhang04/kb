/**
 * Always-on — serves the built SPA (dist/) from the daemon so the whole dashboard is reachable as
 * ONE process at http://localhost:4317, with no separate `vite` dev server required. Real /api/*
 * routes and the hub's /events + /ws always win: Fastify matches an exact registered route before
 * ever falling through to the not-found handler, so nothing here can shadow or intercept them. The
 * SPA fallback below only ever fires for a GET whose path matched no route at all.
 *
 * If dist/ is absent (dev mode — `vite` serves the UI and proxies /api/* instead, per vite.config.ts),
 * this registers nothing and logs a one-line notice; every /api/* route is completely untouched.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/** dashboard/server/static/routes.ts -> ../../dist is the Vite build output. Overridable (tests,
 *  or an unusual deploy layout) via DASHBOARD_DIST_DIR. */
export function resolveDistDir(): string {
  return process.env.DASHBOARD_DIST_DIR ?? fileURLToPath(new URL('../../dist', import.meta.url));
}

export interface StaticOptions {
  /** Absolute path to the built SPA. Defaults to {@link resolveDistDir}. */
  distDir?: string;
}

/**
 * Register static serving of the built SPA with an SPA-style fallback to index.html for any GET
 * that isn't under /api/* and matched no other route (client-side routes like /composer/abc). A
 * no-op (with a log notice) when dist/ doesn't exist — API-only dev mode is unchanged.
 */
export function registerStatic(app: FastifyInstance, opts: StaticOptions = {}): void {
  const distDir = opts.distDir ?? resolveDistDir();

  if (!existsSync(distDir)) {
    // eslint-disable-next-line no-console
    console.log(`[dashboard] no dist/ at ${distDir} — serving API only (run \`npm run build\` for the always-on SPA)`);
    return;
  }

  // wildcard: false — the SPA fallback is hand-rolled via setNotFoundHandler below (per
  // @fastify/static's documented pattern) so a client-side route falls through to index.html
  // instead of a raw static-file 404; GET '/' index resolution is unaffected by this flag.
  app.register(fastifyStatic, { root: distDir, wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.sendFile('index.html', distDir);
    }
    return reply.code(404).send({ error: 'not found' });
  });
}

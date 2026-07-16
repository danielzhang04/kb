/**
 * Read-only KB browser HTTP surface. GET-only endpoints over the confined browser primitives.
 * There is deliberately NO write route (no POST/PUT/DELETE/PATCH) — the KB checkout is projected
 * read-only (ordering law 1). Origin/Host enforcement is applied globally by the hub's origin
 * plugin (D0.4); these routes inherit it and add nothing that bypasses it.
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileHistory, listTree, readFile, PathEscapeError } from './browser';

export interface KbBrowserOptions extends FastifyPluginOptions {
  /** Absolute path to the KB checkout the daemon projects. Defaults to the repo the daemon lives in. */
  repoRoot?: string;
}

/** The daemon lives at `<repo>/dashboard/server/kb/routes.ts`; the KB checkout is three levels up. */
function defaultRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return process.env.DASHBOARD_KB_ROOT ?? resolve(here, '..', '..', '..');
}

export async function kbBrowserRoutes(app: FastifyInstance, opts: KbBrowserOptions): Promise<void> {
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();

  const queryPath = (req: { query: unknown }): string => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const p = q.path;
    return typeof p === 'string' ? p : '';
  };

  app.get('/api/kb/tree', async (req, reply) => {
    try {
      return listTree(repoRoot, queryPath(req));
    } catch (err) {
      if (err instanceof PathEscapeError) return reply.code(400).send({ error: err.message });
      return reply.code(404).send({ error: 'not found' });
    }
  });

  app.get('/api/kb/file', async (req, reply) => {
    const relpath = queryPath(req);
    try {
      return { path: relpath, content: readFile(repoRoot, relpath) };
    } catch (err) {
      if (err instanceof PathEscapeError) return reply.code(400).send({ error: err.message });
      return reply.code(404).send({ error: 'not found' });
    }
  });

  app.get('/api/kb/history', async (req, reply) => {
    const relpath = queryPath(req);
    try {
      return { path: relpath, commits: fileHistory(repoRoot, relpath) };
    } catch (err) {
      if (err instanceof PathEscapeError) return reply.code(400).send({ error: err.message });
      return reply.code(404).send({ error: 'not found' });
    }
  });
}

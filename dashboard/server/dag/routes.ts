/**
 * D3.4 — the read-only pipeline DAG route: `GET /api/dag`. Like the other Plane-A reads
 * (planeA/routes.ts, routing/routes.ts) it needs no session — it exposes the same coordination truth
 * already served by `/api/index`, reshaped into the `depends-on` graph the pipeline canvas draws. Pure
 * read; NO write surface. The governed node toggle on the canvas writes through the EXISTING
 * card-routing endpoint (write/routes.ts → cardRouting.ts) — this module adds no mutation of any kind.
 */
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { indexRepo } from '../planeA/indexer.ts';
import { buildDag } from './graph.ts';

/** dashboard/server/dag/routes.ts → ../../../ is the repo root. Overridable for tests/config. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/** Register the read-only pipeline DAG route on the Fastify app. */
export function registerDag(app: FastifyInstance, repoRoot: string = resolveRepoRoot()): void {
  app.get('/api/dag', async () => buildDag(indexRepo(repoRoot)));
}

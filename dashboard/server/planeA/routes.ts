/**
 * Plane-A snapshot HTTP route (read-only, D0.9). The Control landing needs the whole in-memory index
 * at once (fleet strip, org STATEs) — the SSE bus only carries lightweight deltas — so `/api/index`
 * serves `indexRepo()` directly. Pure read; no write surface. `repoRoot` defaults to the kb repo this
 * dashboard lives in (dashboard/ is a child of the repo root); tests inject a fixture root.
 */
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { indexRepo } from './indexer.ts';
import { sliceLedgers } from './ledgers.ts';

/** dashboard/server/planeA/routes.ts → ../../../ is the repo root. Overridable for tests/config. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/** Register the read-only Plane-A snapshot route on the Fastify app. */
export function registerPlaneA(app: FastifyInstance, repoRoot: string = resolveRepoRoot()): void {
  app.get('/api/index', async () => indexRepo(repoRoot));
  // Sliced usage rollup (per-day + per-writer) for the Ledgers view. USD stays suppressed.
  app.get('/api/ledgers/slices', async () => sliceLedgers(repoRoot));
}

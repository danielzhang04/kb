/**
 * Agents roster HTTP route (read-only). Exposes `GET /api/agents` — the full fleet roster unioned
 * across queue-card owners, ledger writers, and the `routines/roles/` catalog, each annotated with
 * effective routing (`buildRoster`). Pure read; no write surface, no session (same posture as the
 * other Plane-A / registry reads). `repoRoot` defaults to the kb repo this dashboard lives in;
 * tests inject a fixture root.
 */
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { indexRepo } from '../planeA/indexer.ts';
import { loadPolicy, loadOverride } from '../routing/policy.ts';
import { buildRoster } from './roster.ts';

/** dashboard/server/agents/routes.ts → ../../../ is the repo root. Overridable for tests/config. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/** Register the read-only agents roster route on the Fastify app. */
export function registerAgents(app: FastifyInstance, repoRoot: string = resolveRepoRoot()): void {
  app.get('/api/agents', async () => {
    const policy = loadPolicy(repoRoot);
    const override = loadOverride(repoRoot);
    const index = indexRepo(repoRoot);
    return buildRoster(index, repoRoot, policy, override);
  });
}

/**
 * Registry HTTP routes (read-only, D0.6). Exposes the skills / connections / workflows projections
 * over `/api/registry`. Pure reads — no write surface. `repoRoot` defaults to the kb repo this
 * dashboard lives in (dashboard/ is a child of the repo root); tests inject a fixture root.
 */
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { indexSkills } from './skills.ts';
import { indexConnections } from './connections.ts';
import { indexWorkflows } from './workflows.ts';

/** dashboard/server/registry/routes.ts → ../../../ is the repo root. Overridable for tests/config. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/** Register the read-only registry routes on the Fastify app. */
export function registerRegistry(app: FastifyInstance, repoRoot: string = resolveRepoRoot()): void {
  app.get('/api/registry/skills', async () => indexSkills(repoRoot));
  app.get('/api/registry/connections', async () => indexConnections(repoRoot));
  app.get('/api/registry/workflows', async () => indexWorkflows(repoRoot));
  app.get('/api/registry', async () => ({
    skills: indexSkills(repoRoot),
    connections: indexConnections(repoRoot),
    workflows: indexWorkflows(repoRoot),
  }));
}

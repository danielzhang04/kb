/**
 * D3.5 — read-only layer-panel HTTP routes. Two GET-only data sources for the Sentinel/Quartermaster
 * panels, registered exactly like the other Plane-A / registry / agents reads (pure read; no write
 * surface, no session). `repoRoot` defaults to the kb repo this dashboard lives in; tests inject a
 * fixture root.
 */
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { loadPolicy, loadOverride } from '../routing/policy.ts';
import { buildHealthPanel } from './health.ts';
import { buildUsagePanel } from './usage.ts';

/** dashboard/server/panels/routes.ts → ../../../ is the repo root. Overridable for tests/config. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/** Register the read-only layer-panel routes on the Fastify app. */
export function registerPanels(app: FastifyInstance, repoRoot: string = resolveRepoRoot()): void {
  // Sentinel — agent liveness derived from HEARTBEAT cadences / org STATE / ledger recency.
  app.get('/api/panels/health', async () => {
    const policy = loadPolicy(repoRoot);
    const override = loadOverride(repoRoot);
    return buildHealthPanel(repoRoot, policy, override);
  });
  // Quartermaster — usage rollup (per-model steps, model mix, card/dispatch counts). USD suppressed.
  app.get('/api/panels/usage', async () => buildUsagePanel(repoRoot));
}

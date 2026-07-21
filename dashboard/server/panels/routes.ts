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
import { buildAtlasPanel } from './atlas.ts';
import type { AtlasWorkerOptions } from './atlas.ts';

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
  // Atlas — voice worker mirror: worker /state passthrough (OFFLINE-explicit) + transcript history + cards.
  registerAtlasPanel(app, repoRoot);
}

/**
 * Register the Atlas panel route (`GET /api/panels/atlas`). Split out so the worker fetch is an
 * injectable seam (`options.fetchImpl`) for hermetic tests, mirroring the claudeWorkerAdapter DI
 * precedent — the live daemon calls this with defaults (the global fetch against `ATLAS_STATE_URL`).
 * The last-known worker heartbeat is remembered across requests so a dropped worker degrades to an
 * OFFLINE shape that still carries "last seen", never a blank.
 */
export function registerAtlasPanel(
  app: FastifyInstance,
  repoRoot: string = resolveRepoRoot(),
  options: AtlasWorkerOptions = {},
): void {
  let lastHeartbeat: string | null = options.lastHeartbeat ?? null;
  app.get('/api/panels/atlas', async () => {
    const panel = await buildAtlasPanel(repoRoot, { ...options, lastHeartbeat });
    const heartbeat = (panel.worker as Record<string, unknown>).heartbeat;
    if (typeof heartbeat === 'string') lastHeartbeat = heartbeat;
    return panel;
  });
}

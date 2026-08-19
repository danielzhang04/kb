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
import { buildAutonomyLadderPanel } from './autonomyLadder.ts';
import { buildLoopStatusPanel } from './loopStatus.ts';
import { registerSchedulesPanel } from './schedules.ts';
import type { AtlasWorkerOptions } from './atlas.ts';
import type { SchedulesRouteOptions } from './schedules.ts';

/** dashboard/server/panels/routes.ts → ../../../ is the repo root. Overridable for tests/config. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/**
 * Register the layer-panel routes on the Fastify app.
 *
 * All but one are pure reads. The single exception is the Schedules panel, which — beyond its own GET —
 * carries ONE governed write: `POST /api/schedules/edit`, a HEARTBEAT.md edit routed through
 * `write/governedSave.ts` to a work branch and a PR a human merges. It lives behind
 * {@link SchedulesRouteOptions} and FAILS CLOSED until the composition root wires a session config into
 * it, so this registrar stays safe to call with a bare `(app, repoRoot)` in every test that only wants
 * the read projections.
 *
 * Pausing a cadence is NOT here: `POST /api/write/pause-cadence` (`stop/floor.ts#pauseCadence`) already
 * owns the `queue/paused/<name>` sentinel write, and unpausing has no endpoint anywhere by design.
 */
export function registerPanels(
  app: FastifyInstance,
  repoRoot: string = resolveRepoRoot(),
  schedules: SchedulesRouteOptions = {},
): void {
  // Sentinel — agent liveness derived from HEARTBEAT cadences / org STATE / ledger recency.
  app.get('/api/panels/health', async () => {
    const policy = loadPolicy(repoRoot);
    const override = loadOverride(repoRoot);
    return buildHealthPanel(repoRoot, policy, override);
  });
  // Autonomy ladder — earned autonomy RECOMPUTED from trusted grade rows (never stored), beside the
  // advisory `autonomy-tier` each agent file declares. GET only; the panel has no write surface at all.
  app.get('/api/panels/autonomy-ladder', async () => {
    const policy = loadPolicy(repoRoot);
    const override = loadOverride(repoRoot);
    return buildAutonomyLadderPanel(repoRoot, policy, override);
  });
  // Loop status — the self-improving loops: last run, outcome narration, declared schedule. GET only.
  app.get('/api/panels/loop-status', async () => buildLoopStatusPanel(repoRoot));
  // Schedules — every declared HEARTBEAT cadence with its paused state, last run and next-fire hint,
  // plus the governed edit/pause writes. The dashboard is the EDITOR, never the owner of a schedule:
  // edits go out as a PR a human merges, and there is no unpause route anywhere (spec §5).
  registerSchedulesPanel(app, repoRoot, schedules);
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

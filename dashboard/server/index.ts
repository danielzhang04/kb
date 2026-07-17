import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { kbBrowserRoutes } from './kb/routes.ts';
import { registerRegistry } from './registry/routes.ts';
import { registerPlaneA } from './planeA/routes.ts';
import { registerRoutingRead } from './routing/routes.ts';
import { registerAgents } from './agents/routes.ts';
import { registerPanels } from './panels/routes.ts';
import { registerHub } from './hub/index.ts';
import { registerWriteSurface } from './http/surface.ts';

/** Loopback-only bind. Network location is never a trust boundary (ordering law 4). */
export const HOST = '127.0.0.1';
export const PORT = Number(process.env.DASHBOARD_PORT ?? 4317);

/**
 * Build the Fastify backend. `/healthz` and the read-only hub/registry/planeA routes stay pre-auth;
 * the governed WRITE surface (auth ceremonies, save/launch/stop, vibe, approvals) is registered by
 * `registerWriteSurface` as its own encapsulated, Origin/Host- + rate-limit-guarded child scope, with
 * each mutating route additionally session-gated (U2). It is fail-closed by default: with no
 * `DASHBOARD_RP_ORIGIN` the origin allowlist is empty and every write route 403s; with an RP origin but
 * no provisioned passkey, no session can be minted and every write route 401s.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/healthz', async () => {
    // `node` echoes the running runtime version so an accidental unpinned Node
    // upgrade is caught (pinned to 24.18.0 via .nvmrc + package.json engines).
    return { ok: true, node: process.versions.node };
  });

  app.register(kbBrowserRoutes); // D0.5: read-only KB browser (GET-only /api/kb/*)
  registerRegistry(app); // D0.6: read-only registries (GET-only /api/registry/*)
  registerPlaneA(app); // D0.9: read-only Plane-A snapshot for the Control landing (GET /api/index)
  registerRoutingRead(app); // R2.1/R2.4: read-only effective-routing projection (GET /api/routing)
  registerAgents(app); // read-only fleet roster (GET /api/agents): queue owners ∪ ledger writers ∪ roles
  registerPanels(app); // D3.5: read-only layer panels (GET /api/panels/health | /api/panels/usage)
  registerHub(app, { repoRoot: process.env.DASHBOARD_REPO_ROOT }); // D0.4: SSE/WS hub + Origin/Host guard (/events, /ws)
  registerWriteSurface(app); // U2: governed write surface (origin -> rate-limit -> session -> gate -> audit)

  return app;
}

/** Start the daemon on the loopback interface. */
export async function start(port: number = PORT, host: string = HOST): Promise<FastifyInstance> {
  const app = buildApp();
  await app.listen({ port, host });
  return app;
}

// Run directly: `node server/index.ts` (native TS via Node 24) / `npm run dev:server`.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  start()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`kb dashboard daemon listening on http://${HOST}:${PORT}`);
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}

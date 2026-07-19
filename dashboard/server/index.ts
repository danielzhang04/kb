import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { kbBrowserRoutes } from './kb/routes.ts';
import { registerRegistry } from './registry/routes.ts';
import { registerPlaneA } from './planeA/routes.ts';
import { registerDag } from './dag/routes.ts';
import { registerRoutingRead } from './routing/routes.ts';
import { registerAgents } from './agents/routes.ts';
import { registerPanels } from './panels/routes.ts';
import { registerHub } from './hub/index.ts';
import { registerWriteSurface, makeSurfaceContext } from './http/surface.ts';
import { registerWorkflows } from './workflows/routes.ts';
import { registerStatic } from './static/routes.ts';
import { registerPtyRoute, makePtyRouteContext } from './pty/route.ts';
import { originPlugin } from './security/origin.ts';
import { installShutdownHandlers } from './shutdown.ts';

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
  registerDag(app); // D3.4: read-only pipeline DAG projection over depends-on (GET /api/dag)
  registerRoutingRead(app); // R2.1/R2.4: read-only effective-routing projection (GET /api/routing)
  registerAgents(app); // read-only fleet roster (GET /api/agents): queue owners ∪ ledger writers ∪ roles
  registerPanels(app); // D3.5: read-only layer panels (GET /api/panels/health | /api/panels/usage)
  registerHub(app, { repoRoot: process.env.DASHBOARD_REPO_ROOT }); // D0.4: SSE/WS hub + Origin/Host guard (/events, /ws)
  // ONE surface context per process: its `sessionConfig` (HMAC secret) is resolved exactly once here and
  // SHARED with the PTY route below. Without this, the write surface and the PTY route each called
  // `resolveSessionSecret()` independently; with `DASHBOARD_SESSION_SECRET` unset that yields two DIFFERENT
  // random secrets, so a token minted at login (write-surface secret) can never verify at /api/pty (its own
  // secret) → every PTY open failed `verifySession` with `bad-signature`. One secret keeps mint == verify.
  const surfaceCtx = makeSurfaceContext();
  registerWriteSurface(app, surfaceCtx); // U2: governed write surface (origin -> rate-limit -> session -> gate -> audit)
  // D15: workflow-definition registry (GET /api/workflows[/:id] read-only) + the governed one-step launch
  // (POST /api/workflows/:id/launch) in its OWN origin/rate-limit/session child scope. Shares surfaceCtx
  // so the launch route mints/verifies against the same session secret as the write surface.
  registerWorkflows(app, surfaceCtx);
  // D3.1 temporary in-process PTY bridge (/api/pty), in its OWN origin-guarded child scope (mirrors
  // registerHub). NOT folded into the write surface: its per-request rate-limit hook is HTTP-request shaped
  // and fits a long-lived WS upgrade poorly. The route runs the fleet preamble BEFORE session validation,
  // enforces the max-concurrent cap, and writes exactly one audit row per allowed-origin attempt. Its child
  // env is credential-filtered, but the shell currently runs as the dashboard daemon's OS user; the retired
  // cross-user host/Factor-C path is a future hardening milestone, not an active control.
  {
    const ptyCtx = makePtyRouteContext({ sessionConfig: surfaceCtx.sessionConfig });
    app.register(async (scope) => {
      await registerPtyRoute(scope, ptyCtx);
      originPlugin(scope, { allowedOrigins: ptyCtx.allowedOrigins ?? [] });
    });
  }
  // Always-on: serve the built SPA (dist/) with an SPA fallback, if it exists; API-only otherwise.
  // Registered last — every /api/* route above and the hub's /events + /ws already claim their exact
  // paths, so this can never shadow them (see static/routes.ts for the precedence argument).
  registerStatic(app);

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
    .then((app) => {
      installShutdownHandlers(app);
      // eslint-disable-next-line no-console
      console.log(`kb dashboard daemon listening on http://${HOST}:${PORT}`);
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}

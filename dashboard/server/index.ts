import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { kbBrowserRoutes } from './kb/routes';
import { registerRegistry } from './registry/routes';

/** Loopback-only bind. Network location is never a trust boundary (ordering law 4). */
export const HOST = '127.0.0.1';
export const PORT = Number(process.env.DASHBOARD_PORT ?? 4317);

/**
 * Build the Fastify backend. v0 exposes only `/healthz`. The write/steering surfaces
 * (approvals, launch, PTY, Broker) are added behind their wave gates — not here.
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

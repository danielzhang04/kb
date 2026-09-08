import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

/** The only explicitly registered routes in a control-store startup diagnostic process. */
export const BOOT_DIAGNOSTIC_GET_ROUTES = ['/healthz', '/readyz'] as const;

const FAILURE = { ok: false, code: 'control-store-hydration-failed' } as const;
const NOT_READY = { ok: false, quiescent: false, blockers: ['control-store-unavailable'] } as const;

/**
 * A deliberately dependency-free repair surface. Do not compose this through `buildApp`: that would
 * construct a SurfaceContext and either require an authoritative control store or accidentally mount
 * authenticated execution/read routes while its document is untrusted.
 */
export function createBootDiagnosticsApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/healthz', async (_request, reply) => reply.code(503).send(FAILURE));
  app.get('/readyz', async (_request, reply) => reply.code(503).send(NOT_READY));
  return app;
}

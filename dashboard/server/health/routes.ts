import type { FastifyInstance } from 'fastify';
import { requireSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import { composeHealth } from './service.ts';
import type { ReleaseActivationPort } from './releaseReader.ts';
import { readHealth, type HealthServicePort } from '../services/healthService.ts';

/**
 * P6 W6.2 [P6-C64, P6-C76, P6-C80]: this handler is now a THIN caller of W2's `services/healthService.ts`
 * — no request/response byte change over the existing composition, plus the two new failure-only
 * integrity rows (`node-proxy`, `host-map`) served exactly as W2 composes them. The node-identity hop
 * (W4) and the root-owned host-node map (W4) are not built yet on this branch, so both liveness ports
 * default to healthy (no row) until W4 lands a real probe; this handler wires whatever `ctx` already
 * exposes and never fabricates a status beyond "healthy" absent that wiring.
 */
function healthPort(ctx: SurfaceContext): HealthServicePort {
  return {
    async compose() {
      let scheduleCollectionRevision: number | 'unavailable' = 'unavailable';
      const response = await composeHealth(ctx.repoRoot, undefined, {
        scheduleSnapshot: () => {
          const snapshot = ctx.controlStore.getScheduleSnapshot();
          scheduleCollectionRevision = snapshot.collectionRevision;
          return snapshot;
        },
        // Reports the state the PTY store already reached; it starts no migration and opens no file, so a
        // Health poll stays a pure read. Absent when the daemon composed no PTY stack at all.
        ...(ctx.ptySessionRuns ? { ptyMigrationState: () => ctx.ptySessionRuns!.migrationState() } : {}),
        // Read off the capability the daemon already composed at boot from ITS single host probe — Health
        // never probes. A launcher the pin validator refused is dropped rather than fatal, so this row is
        // the only place the operator learns a launcher tree was tampered with.
        ptyDroppedLaunchers: () => (ctx.runtimeCapabilities.pty ? ctx.runtimeCapabilities.droppedLaunchers ?? [] : []),
        // P5 W6.2 [P5-C30]: the SAME activation port W6.1 built once on `SurfaceContext` — Home and the
        // Inbox deploy-ready gate read the identical instance. Never a second construction, never a
        // checkout read of its own. `SurfaceContext` types this field with Home's narrower subset
        // (`ActivationReaderPort`); `createActivationReader` (`home/routes.ts`) always returns the wider
        // superset `ReleaseActivationPort` needs (`archiveSha256`, `rollbackAvailable`) — the runtime
        // instance is the same object, only the static field type is narrower here.
        ...(ctx.activationReader ? { activation: ctx.activationReader as unknown as ReleaseActivationPort } : {}),
        // Narrow read-only slice of the control-plane store — the deploy reader never sees a write method.
        deployStore: { listDeployments: () => ctx.controlStore.listDeployments() },
      });
      return { response, scheduleCollectionRevision };
    },
    // No node-identity hop is wired into this branch's `SurfaceContext` yet (W4). Reporting reachable
    // keeps the row OMITTED — never a fabricated failure — until a real probe is injected.
    nodeProxyLiveness: () => ({ reachable: true }),
    // No root-owned host-node map reader is wired into this branch's `SurfaceContext` yet (W4). Reporting
    // valid keeps the row OMITTED for the same reason.
    hostMapValidation: () => ({ valid: true, mapPath: 'host-nodes.json' }),
    nowIso: () => (ctx.now?.() ?? new Date()).toISOString(),
  };
}

/** Staged registrar. W5 owns mounting it on the served HTTP surface. */
export function registerHealthRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.get('/api/health', { preHandler: requireSession(ctx.sessionConfig) }, async (request, reply) => {
    const result = await readHealth(healthPort(ctx), request.headers['if-none-match'] as string | undefined);
    if (result.etag) reply.header('etag', result.etag);
    return result.status === 304 ? reply.code(304).send() : reply.code(result.status).send(result.body);
  });
}

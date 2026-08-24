import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import { composeHealth } from './service.ts';

/** Staged registrar. W5 owns mounting it on the served HTTP surface. */
export function registerHealthRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.get('/api/health', { preHandler: requireSession(ctx.sessionConfig) }, async (request, reply) => {
    let scheduleCollectionRevision: number | 'unavailable' = 'unavailable';
    const response = composeHealth(ctx.repoRoot, undefined, {
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
    });
    const stableSections = response.sections.map((section) => ({
      ...section,
      rows: section.rows.map(({ observedAt: _observedAt, ...row }) => row),
    }));
    const revision = createHash('sha256')
      .update(JSON.stringify({ scheduleCollectionRevision, sections: stableSections }))
      .digest('hex');
    const etag = `"health:${revision}"`;
    reply.header('etag', etag);
    return request.headers['if-none-match'] === etag ? reply.code(304).send() : reply.send(response);
  });
}

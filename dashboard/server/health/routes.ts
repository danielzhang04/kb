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

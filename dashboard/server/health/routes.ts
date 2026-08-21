import type { FastifyInstance } from 'fastify';
import { requireSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import { composeHealth } from './service.ts';

/** Staged registrar. W5 owns mounting it on the served HTTP surface. */
export function registerHealthRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.get('/api/health', { preHandler: requireSession(ctx.sessionConfig) }, async () => composeHealth(ctx.repoRoot));
}

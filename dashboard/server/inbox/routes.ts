import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import { indexRepo } from '../planeA/indexer.ts';
import { projectInbox } from './project.ts';

/** Staged only: W5 owns registering this session-gated route on the composed application. */
export function registerInboxRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.get('/api/inbox', { preHandler: requireSession(ctx.sessionConfig) }, async (_request, reply: FastifyReply) => {
    return reply.code(200).send(projectInbox(indexRepo(ctx.repoRoot)));
  });
}

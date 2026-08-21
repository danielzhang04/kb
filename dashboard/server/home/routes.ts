import type { FastifyInstance } from 'fastify';
import type { SessionConfig } from '../auth/session.ts';
import { requireSession } from '../http/middleware.ts';
import { projectHome } from './project.ts';
import type { HomeProjectionPorts } from './project.ts';

export type HomeRoutePorts = HomeProjectionPorts & { sessionConfig: SessionConfig };

/** Unregistered Home route module. W6.5 mounts it on the shared HTTP surface. */
export function registerHomeRoutes(scope: FastifyInstance, ports: HomeRoutePorts): void {
  scope.get('/api/home', { preHandler: requireSession(ports.sessionConfig) }, async () => projectHome(ports));
}

import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { registerHomeRoutes } from './routes.ts';

const sessionConfig = { secret: Buffer.from('home-route-test-key-01234567890'), ttlMs: 60_000 } as unknown as SessionConfig;

describe('Home routes module', () => {
  const app = Fastify();
  registerHomeRoutes(app, {
    sessionConfig,
    runningNow: { read: async () => ({ revision: 'runs', data: [] }) },
    attention: { read: async () => ({ revision: 'attention', data: { revision: 'attention', items: [], agents: {}, workflows: {} } }) },
    inboxCount: { read: async () => ({ revision: 'inbox', data: 0 }) },
    nextSchedules: { read: async () => ({ revision: 'schedules', data: [] }) },
    activation: { readActivation: async () => ({ revision: 'release', label: 'VM', sha: '64fb3d02', activatedAt: '2026-08-21T10:00:00.000Z' }) },
    recentRuns: { read: async () => ({ revision: 'outcomes', data: [] }) },
  });

  afterAll(async () => app.close());

  it('requires a session and delegates the closed D13 projection to injected ports', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/home' })).statusCode).toBe(401);
    const token = mintSession('operator', sessionConfig).token;
    const response = await app.inject({ method: 'GET', url: '/api/home', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).sections.map((section: { data?: { section?: string } }) => section.data?.section))
      .toEqual(['running-now', 'attention-counts', 'next-schedules', 'version', 'recent-outcomes']);
  });
});

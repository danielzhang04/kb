import Fastify from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { SurfaceContext } from '../http/context.ts';
import type { ScheduleService } from '../schedules/service.ts';
import { createActivationReader, createHomeRoutePorts, registerHomeRoutes } from './routes.ts';

const sessionConfig = { secret: Buffer.from('home-route-test-key-01234567890'), ttlMs: 60_000 } as unknown as SessionConfig;

describe('Home routes module', () => {
  const app = Fastify();
  registerHomeRoutes(app, {
    sessionConfig,
    now: () => new Date('2026-08-21T12:00:00.000Z'),
    runningNow: { read: async () => ({ revision: 'runs', data: [] }) },
    attention: { read: async () => ({ revision: 'attention', data: { revision: 'attention', pairs: [], agents: {}, workflows: {} } }) },
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
    expect(JSON.parse(response.body).generatedAt).toBe('2026-08-21T12:00:00.000Z');
    expect(JSON.parse(response.body).sections.map((section: { data?: { section?: string } }) => section.data?.section))
      .toEqual(['running-now', 'attention-counts', 'next-schedules', 'version', 'recent-outcomes']);
    expect(response.headers.etag).toBe('"home:runs:attention:inbox:schedules:release:outcomes"');
    expect((await app.inject({
      method: 'GET', url: '/api/home',
      headers: { authorization: `Bearer ${token}`, 'if-none-match': response.headers.etag! },
    })).statusCode).toBe(304);
  });

  it('adapts the one attested release reader and its installed attestation mtime', async () => {
    const reader = createActivationReader({
      openSource: async () => ({
        available: true,
        releaseRoot: '/installed/release',
        sourceCommit: '64fb3d02' + 'a'.repeat(32),
        archiveSha256: 'b'.repeat(64),
        read: async () => '',
      }),
      activatedAt: async (releaseRoot) => {
        expect(releaseRoot).toBe('/installed/release');
        return '2026-08-21T10:00:00.000Z';
      },
    });

    await expect(reader.readActivation()).resolves.toEqual({
      revision: `release:${'64fb3d02' + 'a'.repeat(32)}:${'b'.repeat(64)}:2026-08-21T10:00:00.000Z`,
      label: 'VM',
      sha: '64fb3d02' + 'a'.repeat(32),
      activatedAt: '2026-08-21T10:00:00.000Z',
    });
  });

  it('projects next fires through the injected owner-validating ScheduleService', async () => {
    const owner = { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' } as const;
    const list = vi.fn(async () => ({
      collectionRevision: 7,
      schedules: [{
        id: 'd'.repeat(64), owner, cadence: { source: '0 9 * * *', words: 'Daily \u00b7 9:00 AM' },
        nextAt: '2026-08-22T13:00:00.000Z', lastOutcome: null, armed: true, origin: 'operator' as const,
        mirroredAt: null, mirrorPath: 'HEARTBEAT.md' as const, version: 1,
      }],
    }));
    const directStoreRead = vi.fn(() => { throw new Error('Home must not bypass ScheduleService'); });
    const ctx = { controlStore: { getScheduleSnapshot: directStoreRead } } as unknown as SurfaceContext;
    const schedules = { list } as unknown as ScheduleService;
    const activation = { readActivation: async () => ({ revision: 'release', label: 'VM', sha: '64fb3d02', activatedAt: '2026-08-21T10:00:00.000Z' }) };

    await expect(createHomeRoutePorts(ctx, schedules, activation).nextSchedules.read()).resolves.toEqual({
      revision: 'schedules:7',
      data: [{
        scheduleId: 'd'.repeat(64), scheduledFor: '2026-08-22T13:00:00.000Z',
        nextAt: '2026-08-22T13:00:00.000Z', owner,
      }],
    });
    expect(list).toHaveBeenCalledOnce();
    expect(directStoreRead).not.toHaveBeenCalled();
  });
});

import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { registerHealthRoutes } from './routes.ts';
import type { Schedule } from '../control/p2Contracts.ts';
import { composeHealth } from './service.ts';

const repoRoot = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));
const sessionConfig = { secret: Buffer.from('health-route-test-key-0123456789'), ttlMs: 60_000 } as unknown as SessionConfig;

describe('Health routes', () => {
  const app = Fastify();
  registerHealthRoutes(app, makeSurfaceContext({ repoRoot, sessionConfig, controlStore: createInMemoryControlPlaneStore() }));

  afterAll(async () => app.close());

  it('GET /api/health requires a session and returns the closed shape', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(401);
    const token = mintSession('operator', sessionConfig).token;
    const response = await app.inject({ method: 'GET', url: '/api/health', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).sections.map((section: { id: string }) => section.id))
      .toEqual(['fleet', 'stop', 'daemon-machine', 'mcp', 'usage']);
    expect(response.headers.etag).toMatch(/^"health:/);
    expect((await app.inject({
      method: 'GET', url: '/api/health',
      headers: { authorization: `Bearer ${token}`, 'if-none-match': response.headers.etag! },
    })).statusCode).toBe(304);
  });

  it('projects a live deleted schedule owner and includes schedule revision in its ETag', async () => {
    const store = createInMemoryControlPlaneStore();
    const schedule: Schedule = {
      id: 'd'.repeat(64), owner: { type: 'agent', id: 'deleted-owner', sourcePath: 'agents/deleted-owner.md' },
      cadence: { source: '0 9 * * *', words: 'Daily \u00b7 9:00 AM' }, nextAt: null, lastOutcome: null,
      armed: true, origin: 'operator', mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 1,
    };
    let revision = 7;
    vi.spyOn(store, 'getScheduleSnapshot').mockImplementation(() => ({ collectionRevision: revision, schedules: [schedule] }));
    const live = Fastify();
    registerHealthRoutes(live, makeSurfaceContext({ repoRoot, sessionConfig, controlStore: store }));
    const token = mintSession('operator', sessionConfig).token;
    const first = await live.inject({ method: 'GET', url: '/api/health', headers: { authorization: `Bearer ${token}` } });

    expect(first.json().sections[0].rows).toContainEqual(expect.objectContaining({
      key: `schedule-owner:${schedule.id}`,
      value: { status: 'error', code: 'schedule-owner-unresolvable', owner: schedule.owner },
    }));
    revision = 8;
    const changed = await live.inject({
      method: 'GET', url: '/api/health',
      headers: { authorization: `Bearer ${token}`, 'if-none-match': first.headers.etag! },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).not.toBe(first.headers.etag);
    await live.close();
  });

  it('isolates a throwing schedule snapshot to Fleet and keeps the other four sections intact', async () => {
    const store = createInMemoryControlPlaneStore();
    vi.spyOn(store, 'getScheduleSnapshot').mockImplementation(() => { throw new Error('schedule store unavailable'); });
    const live = Fastify();
    registerHealthRoutes(live, makeSurfaceContext({ repoRoot, sessionConfig, controlStore: store }));
    const token = mintSession('operator', sessionConfig).token;

    const response = await live.inject({ method: 'GET', url: '/api/health', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.sections[0]).toEqual(expect.objectContaining({
      id: 'fleet',
      rows: [expect.objectContaining({ kind: 'unavailable', key: 'error:fleet', value: { status: 'unavailable', reason: 'Reader unavailable' } })],
    }));
    const withoutTimes = (value: unknown): unknown => JSON.parse(JSON.stringify(value), (key, item) => key === 'observedAt' ? undefined : item);
    expect(withoutTimes(body.sections.slice(1))).toEqual(withoutTimes(composeHealth(repoRoot).sections.slice(1)));
    await live.close();
  });
});

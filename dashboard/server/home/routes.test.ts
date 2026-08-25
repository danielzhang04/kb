import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { SurfaceContext } from '../http/context.ts';
import type { GitRemoteReader } from '../runtime/repoPin.ts';
import type { SubprocessResult } from '../inbox/resolvers.ts';
import { resetInboxSourceCacheForTests } from '../inbox/sourceCache.ts';
import type { ScheduleService } from '../schedules/service.ts';
import { createActivationReader, createHomeRoutePorts, registerHomeRoutes } from './routes.ts';

const sessionConfig = { secret: Buffer.from('home-route-test-key-01234567890'), ttlMs: 60_000 } as unknown as SessionConfig;

/** An absolute coordination root with a real `queue/`, so the composition-time [P4-C39] check passes. */
function coordinationRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'home-coord-'));
  mkdirSync(join(root, 'queue'), { recursive: true });
  return root;
}
/** A pinnable GitHub remote reader, injected so the composition never spawns a real `git`. */
const githubRemote: GitRemoteReader = () => 'https://github.com/danielzhang04/kb.git\n';

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
    const ctx = { controlStore: { getScheduleSnapshot: directStoreRead }, repoRoot: coordinationRoot() } as unknown as SurfaceContext;
    const schedules = { list } as unknown as ScheduleService;
    const activation = { readActivation: async () => ({ revision: 'release', label: 'VM', sha: '64fb3d02', activatedAt: '2026-08-21T10:00:00.000Z' }) };

    await expect(createHomeRoutePorts(ctx, schedules, activation, undefined, githubRemote).nextSchedules.read()).resolves.toEqual({
      revision: 'schedules:7',
      data: [{
        scheduleId: 'd'.repeat(64), scheduledFor: '2026-08-22T13:00:00.000Z',
        nextAt: '2026-08-22T13:00:00.000Z', owner,
      }],
    });
    expect(list).toHaveBeenCalledOnce();
    expect(directStoreRead).not.toHaveBeenCalled();
  });

  it('inboxCount THROWS rather than reporting a false zero when the PR source fails with no last-good', async () => {
    // Dimension D: a failed source and an empty escalation must NOT read as `data: 0`. The real
    // `createHomeRoutePorts` inbox port is driven with a failing `gh` and a bare (empty) coordination
    // root, so both halves are empty and the PR half is failed — the count read must reject.
    resetInboxSourceCacheForTests();
    const failingGh = async (): Promise<SubprocessResult> => ({ ok: false, stdout: '' });
    const ctx = { repoRoot: coordinationRoot(), controlStore: {} } as unknown as SurfaceContext;
    const ports = createHomeRoutePorts(
      ctx, { list: async () => ({ collectionRevision: 0, schedules: [] }) } as unknown as ScheduleService,
      undefined, failingGh, githubRemote,
    );
    await expect(ports.inboxCount.read()).rejects.toThrow(/inbox source unavailable/);
  });

  it('inboxCount returns the retained last-good count instead of a false zero after a source failure', async () => {
    // A good `gh` read seeds one PR item; a later failure keeps that last-good item (stale) so the count
    // stays 1 rather than collapsing to a false 0. The process cache is shared by reference across the
    // two reads because both go through the same `createHomeRoutePorts` composition.
    resetInboxSourceCacheForTests();
    let ok = true;
    const flakyGh = async (): Promise<SubprocessResult> =>
      ok ? { ok: true, stdout: JSON.stringify([{ number: 7, title: 'Widen the durable manifest', createdAt: '2026-08-23T12:00:00Z' }]) } : { ok: false, stdout: '' };
    const ctx = { repoRoot: coordinationRoot(), controlStore: {} } as unknown as SurfaceContext;
    const ports = createHomeRoutePorts(
      ctx, { list: async () => ({ collectionRevision: 0, schedules: [] }) } as unknown as ScheduleService,
      undefined, flakyGh, githubRemote,
    );
    await expect(ports.inboxCount.read()).resolves.toMatchObject({ data: 1 });
    ok = false;
    // The 30s budget still gates the subprocess, so the retained last-good item keeps the count at 1.
    await expect(ports.inboxCount.read()).resolves.toMatchObject({ data: 1 });
  });
});

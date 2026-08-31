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

// W6.2b regression fixture: lets a single test drive `os.loadavg()` to two distinct readings so the
// `daemon-machine` cpu row's live `value` changes between two `/api/health` reads. `freemem`, `uptime`,
// and `statfsSync`'s disk free/total are frozen alongside it — the real row values now feed the ETag hash
// again (that's the P5 fix), and every one of them can drift between two back-to-back reads: freemem by
// tens of KB, the integer-second uptime (`Math.floor(hostUptimeSeconds())`, `health/service.ts`) by
// crossing a whole-second boundary, and disk free space (`statfsSync(process.cwd())`, also
// `health/service.ts`) by whatever any OTHER process on the machine — including sibling test files writing
// their own temp fixtures — happens to write or delete between the two reads. None of these are reliably
// stable running this file alone, but under a large parallel/batch vitest run (this file's own scheduling
// slows down, and disk churn from concurrent suites is real) each has reproduced the flake this test
// guards against: an unwanted 200 where a stable 304 was expected. `totalmem` stays real — it is a fixed
// machine constant that never changes at runtime, so `freemem`'s formula below stays deterministic too.
const cpuFixture = vi.hoisted(() => ({ load1: 1 }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    loadavg: () => [cpuFixture.load1, cpuFixture.load1, cpuFixture.load1],
    freemem: () => actual.totalmem() - 10 * 1024 * 1024 * 1024,
    uptime: () => 123_456,
  };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    // Only the disk-space probe's shape matters to `health/service.ts`'s reader (`blocks * bsize` total,
    // `total - bfree * bsize` used); every other `node:fs` caller (including this file's own fixtures)
    // keeps the real implementation via `...actual`.
    statfsSync: (() => ({
      type: 0, bsize: 4096, blocks: 1_000_000, bfree: 500_000, bavail: 500_000, files: 0, ffree: 0, frsize: 4096,
    })) as unknown as typeof actual.statfsSync,
  };
});

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

  /** W6.2b regression: pre-P5 hashed the full row (minus `observedAt`), so any live cpu/memory/disk/
   *  uptime drift always busted the ETag. A P5 regression stripped `value` from volatile machine rows
   *  before hashing, so a real value change still produced a MATCHING ETag and a stale 304. This proves
   *  the fix — hash the full row again — by changing only the cpu row's live value and asserting the
   *  ETag changes, which means a stale `if-none-match` now gets a fresh 200 body, never a 304. */
  it('busts the ETag when a live machine value (cpu) changes — a stale conditional GET gets 200, not 304', async () => {
    const live = Fastify();
    registerHealthRoutes(live, makeSurfaceContext({ repoRoot, sessionConfig, controlStore: createInMemoryControlPlaneStore() }));
    const token = mintSession('operator', sessionConfig).token;

    cpuFixture.load1 = 1;
    const first = await live.inject({ method: 'GET', url: '/api/health', headers: { authorization: `Bearer ${token}` } });
    expect(first.statusCode).toBe(200);

    cpuFixture.load1 = 9;
    const staleConditional = await live.inject({
      method: 'GET', url: '/api/health',
      headers: { authorization: `Bearer ${token}`, 'if-none-match': first.headers.etag! },
    });

    expect(staleConditional.statusCode).toBe(200);
    expect(staleConditional.headers.etag).not.toBe(first.headers.etag);
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
    // `daemon-machine`'s ready rows now carry live host metrics (cpu/memory/disk/uptime) that can drift
    // by a byte or a second between the two independent `composeHealth` calls this test makes — strip
    // `value` from those rows only (identity — kind/key/label/source — still proves the section shape
    // matches) while `stop`/`mcp`/`usage`, and any daemon-machine row that DID close unavailable, keep a
    // full deep comparison.
    const shape = (sections: Array<{ id: string; rows: Array<Record<string, unknown>> }>) => sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => (
        section.id === 'daemon-machine' && row.kind !== 'unavailable'
          ? { kind: row.kind, key: row.key, label: row.label, source: row.source }
          : row
      )),
    }));
    expect(shape(withoutTimes(body.sections.slice(1)) as never)).toEqual(shape(withoutTimes((await composeHealth(repoRoot)).sections.slice(1)) as never));
    await live.close();
  });

  /** P5 W6.2 [P5-C30]: proves `/api/health` reads the SAME injected activation port Home/Inbox share —
   *  never a checkout read of its own. An arbitrary fake port that touches no filesystem still produces
   *  the exact ReleaseRow, which could only happen if the route consumed the injected instance. */
  it('consumes the injected activation port for the Release row — never a checkout read', async () => {
    const fakeActivation = {
      readActivation: async () => ({
        revision: 'release:fake', label: 'VM', sha: 'e'.repeat(40),
        activatedAt: '2026-08-21T09:00:00.000Z', archiveSha256: 'f'.repeat(64), rollbackAvailable: false,
      }),
    };
    const live = Fastify();
    registerHealthRoutes(live, makeSurfaceContext({
      repoRoot, sessionConfig, controlStore: createInMemoryControlPlaneStore(), activationReader: fakeActivation,
    }));
    const token = mintSession('operator', sessionConfig).token;

    const response = await live.inject({ method: 'GET', url: '/api/health', headers: { authorization: `Bearer ${token}` } });
    const release = response.json().sections[2].rows.find((row: { key: string }) => row.key === 'release');

    expect(release.value).toEqual({ sha: 'e'.repeat(40), archiveSha256: 'f'.repeat(64), activatedAt: '2026-08-21T09:00:00.000Z', rollbackAvailable: false });
    await live.close();
  });

  it('renders the latest Deployment as a display-only row keyed deploy:<ref>, with no control', async () => {
    const store = createInMemoryControlPlaneStore();
    const created = store.createDeployment('operator', {
      deploymentRef: 'deployment:1', initialState: 'requested',
      targetCommit: 'a'.repeat(40), previousCommit: 'b'.repeat(40),
      requestedAt: '2026-08-21T00:00:00.000Z', parkWarnAt: '2026-08-21T00:05:00.000Z',
      idempotencyKey: 'health-route-test-deploy-1',
    });
    expect(created.ok).toBe(true);
    const live = Fastify();
    registerHealthRoutes(live, makeSurfaceContext({ repoRoot, sessionConfig, controlStore: store }));
    const token = mintSession('operator', sessionConfig).token;

    const response = await live.inject({ method: 'GET', url: '/api/health', headers: { authorization: `Bearer ${token}` } });
    const rows = response.json().sections[2].rows as Array<{ key: string; kind: string }>;
    const deploy = rows.find((row) => row.key.startsWith('deploy:'));

    expect(deploy).toBeDefined();
    expect(deploy?.kind).toBe('deploy');
    expect(JSON.stringify(deploy)).not.toMatch(/"verb"|"control"|"action"/);
    await live.close();
  });
});

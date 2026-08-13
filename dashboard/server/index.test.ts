import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SurfaceContext } from './http/context.ts';
import { makeSurfaceContext } from './http/surface.ts';

const serviceCgroupChildCount = vi.hoisted(() => vi.fn(() => 0));
const quiescenceSpy = vi.hoisted(() => vi.fn());

vi.mock('./release/serviceCgroup.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./release/serviceCgroup.ts')>(),
  serviceCgroupChildCount,
}));

vi.mock('./release/quiescence.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./release/quiescence.ts')>();
  quiescenceSpy.mockImplementation(actual.quiescence);
  return { ...actual, quiescence: quiescenceSpy };
});
import {
  buildApp,
  DEFAULT_HUMAN_REQUEST_SWEEP_INTERVAL_MS,
  DEFAULT_STRANDED_ARCHIVE_INTERVAL_MS,
  DEFAULT_STRANDED_ARCHIVE_WINDOW_MS,
  STRANDED_ARCHIVE_LIVE_MOVE_ALLOWED,
  humanRequestSweepLogLine,
  resolveHumanRequestSweepIntervalMs,
  resolveStrandedArchiveIntervalMs,
  resolveStrandedArchiveDryRun,
  resolveStrandedArchiveWindowMs,
} from './index.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  serviceCgroupChildCount.mockReset();
  serviceCgroupChildCount.mockReturnValue(0);
  quiescenceSpy.mockClear();
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('server', () => {
  it('binds localhost only and returns 200 on /healthz', async () => {
    app = buildApp({ validateData: false });
    // ephemeral port, localhost bind
    await app.listen({ port: 0, host: '127.0.0.1' });

    const addr = app.server.address();
    expect(addr).not.toBeNull();
    expect(typeof addr).toBe('object');
    // bound to loopback only
    expect((addr as { address: string }).address).toBe('127.0.0.1');

    const port = (addr as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ ok: true, node: '24.18.0' });
  });

  it('/healthz reports the pinned node major', async () => {
    app = buildApp({ validateData: false });
    await app.listen({ port: 0, host: '127.0.0.1' });

    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = (await res.json()) as { ok: boolean; node: string };

    // guards an accidental unpinned Node upgrade
    expect(process.versions.node.startsWith('24.')).toBe(true);
    expect(body.node.startsWith('24.')).toBe(true);
  });

  it('keeps health and readiness public but readiness payload minimal', async () => {
    const app = buildApp({ validateData: false, readiness: async () => ({ ok: true, quiescent: false, blockers: ['workers-active'] }) });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, quiescent: false, blockers: ['workers-active'] });
    await app.close();
  });

  it('reports no worker blocker from the real readiness closure while the latch is locked', async () => {
    const ctx = makeSurfaceContext({
      executionLatch: {
        snapshot: () => ({ state: 'locked', source: 'test', unlockedAt: null, unlockedBy: null }),
      } as unknown as SurfaceContext['executionLatch'],
    });

    const readiness = await ctx.readiness();
    expect(quiescenceSpy).toHaveBeenLastCalledWith(expect.objectContaining({ activeWorkers: 0 }));
    expect(readiness.blockers).not.toContain('workers-active');
  });

  it('reports a worker blocker from the real readiness closure while the latch is unlocked', async () => {
    const ctx = makeSurfaceContext({
      executionLatch: {
        snapshot: () => ({ state: 'unlocked', source: 'test', unlockedAt: null, unlockedBy: null }),
      } as unknown as SurfaceContext['executionLatch'],
    });

    const readiness = await ctx.readiness();
    expect(quiescenceSpy).toHaveBeenLastCalledWith(expect.objectContaining({ activeWorkers: 1 }));
    expect(readiness.quiescent).toBe(false);
    expect(readiness.blockers).toContain('workers-active');
  });

  it('fails closed through /readyz when the service cgroup probe throws', async () => {
    serviceCgroupChildCount.mockImplementation(() => { throw new Error('cgroup unavailable'); });
    const realReadinessApp = buildApp({ validateData: false });

    const response = await realReadinessApp.inject({ method: 'GET', url: '/readyz' });
    expect(response.json()).toEqual({ ok: true, quiescent: false, blockers: ['service-cgroup-unknown'] });
    await realReadinessApp.close();
  });
});

describe('stranded-archiver wiring — DEFAULT-OFF and DRY-RUN-ONLY', () => {
  it('defaults the interval to 0 (disabled) when the env var is unset/blank', () => {
    expect(DEFAULT_STRANDED_ARCHIVE_INTERVAL_MS).toBe(0);
    expect(resolveStrandedArchiveIntervalMs({})).toBe(0);
    expect(resolveStrandedArchiveIntervalMs({ DASHBOARD_STRANDED_ARCHIVE_INTERVAL_MS: '' })).toBe(0);
    expect(resolveStrandedArchiveIntervalMs({ DASHBOARD_STRANDED_ARCHIVE_INTERVAL_MS: 'nonsense' })).toBe(0);
  });

  it('honors an explicit positive interval (opt-in) but that alone never enables the live MOVE', () => {
    expect(resolveStrandedArchiveIntervalMs({ DASHBOARD_STRANDED_ARCHIVE_INTERVAL_MS: '300000' })).toBe(300_000);
  });

  it('the compile-time live-move flag ships OFF', () => {
    expect(STRANDED_ARCHIVE_LIVE_MOVE_ALLOWED).toBe(false);
  });

  it('dryRun is TRUE regardless of env while the compile-time flag is off (two-lock gate)', () => {
    expect(resolveStrandedArchiveDryRun({})).toBe(true);
    expect(resolveStrandedArchiveDryRun({ DASHBOARD_STRANDED_ARCHIVE_LIVE: '1' })).toBe(true);
    expect(resolveStrandedArchiveDryRun({ DASHBOARD_STRANDED_ARCHIVE_LIVE: '0' })).toBe(true);
  });

  it('defaults the window to 7 days, overridable by a positive env value only', () => {
    expect(DEFAULT_STRANDED_ARCHIVE_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(resolveStrandedArchiveWindowMs({})).toBe(7 * 24 * 60 * 60 * 1000);
    expect(resolveStrandedArchiveWindowMs({ DASHBOARD_STRANDED_ARCHIVE_WINDOW_MS: '259200000' })).toBe(259_200_000);
    expect(resolveStrandedArchiveWindowMs({ DASHBOARD_STRANDED_ARCHIVE_WINDOW_MS: '-5' })).toBe(7 * 24 * 60 * 60 * 1000);
    expect(resolveStrandedArchiveWindowMs({ DASHBOARD_STRANDED_ARCHIVE_WINDOW_MS: 'x' })).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('Human Request orphan-sweep wiring — ON BY DEFAULT (data-only, no filesystem/git risk)', () => {
  it('defaults the interval to 5 minutes, unlike the stranded-archiver which defaults off', () => {
    expect(DEFAULT_HUMAN_REQUEST_SWEEP_INTERVAL_MS).toBe(300_000);
    expect(resolveHumanRequestSweepIntervalMs({})).toBe(300_000);
    expect(resolveHumanRequestSweepIntervalMs({ DASHBOARD_HUMAN_REQUEST_SWEEP_INTERVAL_MS: '' })).toBe(300_000);
  });

  it('honors an explicit interval override, including disabling it with 0', () => {
    expect(resolveHumanRequestSweepIntervalMs({ DASHBOARD_HUMAN_REQUEST_SWEEP_INTERVAL_MS: '60000' })).toBe(60_000);
    expect(resolveHumanRequestSweepIntervalMs({ DASHBOARD_HUMAN_REQUEST_SWEEP_INTERVAL_MS: '0' })).toBe(0);
  });

  it('falls back to the default on a non-numeric override rather than disabling silently', () => {
    expect(resolveHumanRequestSweepIntervalMs({ DASHBOARD_HUMAN_REQUEST_SWEEP_INTERVAL_MS: 'nonsense' })).toBe(300_000);
  });

  // The `onSweep` sink the sweeper documents is wired in `buildApp` to log through this function — the
  // sweep used to declare the callback and nothing ever passed one, so an auto-close left no daemon-log
  // trace at all. What it prints is what makes the log worth having: which requests, on which runs, why.
  it('logs a line naming every closed request, its run and its reason — and stays silent on an empty sweep', () => {
    expect(humanRequestSweepLogLine({ closed: [], auditFailures: [] })).toBeNull();

    const line = humanRequestSweepLogLine({
      closed: [
        { requestRef: 'request-1', runRef: 'run-9', reason: "terminal state ('failed')" },
        { requestRef: 'request-2', runRef: 'run-9', reason: null },
      ],
      auditFailures: [],
    });
    expect(line).toContain('auto-closed 2');
    expect(line).toContain("request-1 (run run-9: terminal state ('failed'))");
    expect(line).toContain('request-2 (run run-9: no reason recorded)');
    expect(line).not.toContain('AUDIT ROW FAILED');
  });

  it('flags an unwritten audit row in the same line, so a short trail is never silent', () => {
    const line = humanRequestSweepLogLine({
      closed: [{ requestRef: 'request-1', runRef: 'run-9', reason: 'terminal:failed' }],
      auditFailures: ['request-1'],
    });
    expect(line).toContain('AUDIT ROW FAILED for request-1');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SurfaceContext } from './http/context.ts';
import { makeSurfaceContext } from './http/surface.ts';
import { mintSession } from './auth/session.ts';
import type { SessionConfig } from './auth/session.ts';
import { runtimeCapabilities } from './runtime/capabilities.ts';
import { fileURLToPath } from 'node:url';

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
const TEST_ORIGIN = 'http://kb.test';
const TRACE_FIXTURES = fileURLToPath(new URL('./trace/__fixtures__/', import.meta.url));
const TEST_SESSION: SessionConfig = { secret: Buffer.from('index-test-session-secret-32-bytes!'), ttlMs: 60_000 };
const matrixHeaders = { origin: TEST_ORIGIN, host: 'kb.test' };
// Mint inside each assertion: this file takes long enough that a module-load token can expire while
// later matrix rows are still running.
const sessionHeaders = () => ({ ...matrixHeaders, authorization: `Bearer ${mintSession('operator', TEST_SESSION).token}` });
const matrixApp = () => buildApp({ validateData: false, allowedOrigins: [TEST_ORIGIN], sessionConfig: TEST_SESSION });

afterEach(async () => {
  vi.unstubAllEnvs();
  serviceCgroupChildCount.mockReset();
  serviceCgroupChildCount.mockReturnValue(0);
  quiescenceSpy.mockClear();
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('server', () => {
  it('omits PTY routes on Linux and reports the governed bridge capability', async () => {
    const createPty = vi.fn(() => { throw new Error('must not construct'); });
    app = buildApp({
      validateData: false, allowedOrigins: [TEST_ORIGIN], sessionConfig: TEST_SESSION,
      runtimeCapabilities: runtimeCapabilities('linux'),
      coordinationPublication: 'outbox',
      traceRoot: null,
      createPtyHost: createPty,
    });
    const capabilities = await app.inject({
      method: 'GET', url: '/api/runtime/capabilities', headers: sessionHeaders(),
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toMatchObject({
      pty: false, runnerTrigger: false, vibe: false, durablePrWrites: false,
      localTranscripts: false, dashboardBridge: true,
    });
    expect((await app.inject({ method: 'GET', url: '/api/pty/sessions', headers: sessionHeaders() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/trace', headers: sessionHeaders() })).statusCode).toBe(404);
    expect(createPty).not.toHaveBeenCalled();
  });

  it('registers trace routes only when a readable transcript root was composed', async () => {
    app = buildApp({
      validateData: false, allowedOrigins: [TEST_ORIGIN], sessionConfig: TEST_SESSION,
      runtimeCapabilities: runtimeCapabilities('linux'), traceRoot: TRACE_FIXTURES,
    });
    const capabilities = await app.inject({
      method: 'GET', url: '/api/runtime/capabilities', headers: sessionHeaders(),
    });
    expect(capabilities.json()).toMatchObject({ localTranscripts: true });
    expect((await app.inject({
      method: 'GET', url: '/api/trace', headers: sessionHeaders(),
    })).statusCode).toBe(200);
  });

  it('refuses outbox schedule edits before governedSave when KB_VM_RUNTIME is absent', async () => {
    vi.stubEnv('KB_COORDINATION_PUBLICATION', 'outbox');
    vi.stubEnv('KB_VM_RUNTIME', undefined);
    const save = vi.fn(async () => ({ ok: false as const, status: 403 as const, reason: 'should-not-run' }));
    const openPr = vi.fn(async () => undefined);
    app = buildApp({
      validateData: false,
      allowedOrigins: [TEST_ORIGIN],
      sessionConfig: TEST_SESSION,
      runtimeCapabilities: runtimeCapabilities('linux'),
      traceRoot: null,
      openPr,
      scheduleSave: save,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/schedules/edit',
      headers: sessionHeaders(),
      payload: { file: 'HEARTBEAT.md', content: '# changed\n' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'capability-unavailable' });
    expect(save).not.toHaveBeenCalled();
    expect(openPr).not.toHaveBeenCalled();
  });

  it('admits direct schedule edits when the composed PR surface is present', async () => {
    vi.stubEnv('KB_COORDINATION_PUBLICATION', 'direct');
    vi.stubEnv('KB_VM_RUNTIME', undefined);
    const save = vi.fn(async () => ({ ok: false as const, status: 403 as const, reason: 'test-stop-after-save-entry' }));
    app = buildApp({
      validateData: false,
      allowedOrigins: [TEST_ORIGIN],
      sessionConfig: TEST_SESSION,
      runtimeCapabilities: runtimeCapabilities('linux'),
      traceRoot: null,
      openPr: async () => undefined,
      scheduleSave: save,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/schedules/edit',
      headers: sessionHeaders(),
      payload: { file: 'HEARTBEAT.md', content: '# changed\n' },
    });

    expect(response.statusCode).toBe(403);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/api/kb/tree', '/api/kb/file?path=docs/x.md', '/api/kb/history?path=docs/x.md',
    '/api/registry', '/api/registry/skills', '/api/registry/connections',
    '/api/index', '/api/ledgers/slices', '/api/dag', '/api/routing',
    '/api/agents', '/api/agents/system-workers', '/api/agents/example',
    '/api/panels/health', '/api/panels/usage', '/api/panels/atlas', '/api/panels/schedules', '/api/panels/grades-history?agent=codex-worker',
    '/api/workflows', '/api/workflows/profiles', '/api/workflows/example',
    '/api/human-inbox', '/api/approvals', '/api/composer/sessions', '/api/composer/sessions/example',
    '/api/control/proposals', '/api/control/execution', '/api/control/runs', '/api/control/runs/example',
    '/api/control/proposals/example/revisions/example', '/api/control/runs/example/attempts/example/io',
    '/api/control/runs/example/events', '/api/control/retention/inventory',
    '/api/pty/sessions', '/api/pty/session-runs', '/api/pty/session-runs/example', '/events',
  ])('rejects unauthenticated read %s', async (url) => {
    app = matrixApp();
    const response = await app.inject({ method: 'GET', url, headers: matrixHeaders });
    expect(response.statusCode).toBe(401);
  });

  // Governed writes composed OUTSIDE the write surface (`registerWriteSurface`) — so `surface.test.ts`'s
  // own "session-less POST is 401, never 404" matrix cannot see them. They are gated by THIS file's
  // scope-level `requireSession`, and must prove the same property: gated, not missing.
  it.each(['/api/schedules/edit'])('rejects unauthenticated write %s (401, never 404)', async (url) => {
    app = matrixApp();
    const response = await app.inject({ method: 'POST', url, headers: matrixHeaders, payload: {} });
    expect(response.statusCode, `${url} should be gated, not missing`).not.toBe(404);
    expect(response.statusCode).toBe(401);
  });

  it.each(['/healthz', '/readyz', '/', '/api/auth/assert/options'])('keeps bootstrap route %s reachable', async (url) => {
    app = matrixApp();
    const method = url.includes('/auth/') ? 'POST' : 'GET';
    expect((await app.inject({ method, url, headers: matrixHeaders })).statusCode).not.toBe(401);
  });

  it.each([
    ['/api/kb/file?path=docs/x.md', 404], ['/api/kb/history?path=docs/x.md', 200],
    ['/api/agents/example', 404], ['/api/workflows/example', 404], ['/api/composer/sessions/example', 404],
    ['/api/control/runs/example', 404], ['/api/control/runs/example/events', 404],
  ])('keeps matched resource %s at its normal %i after authentication', async (url, expected) => {
    app = matrixApp();
    expect((await app.inject({ method: 'GET', url, headers: sessionHeaders() })).statusCode).toBe(expected);
  });

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
    expect(body).toEqual({ ok: true });
  });

  it('/healthz does not disclose the runtime version', async () => {
    app = buildApp({ validateData: false });
    await app.listen({ port: 0, host: '127.0.0.1' });

    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = (await res.json()) as { ok: boolean; node?: string };
    expect(body).toEqual({ ok: true });
    expect(body.node).toBeUndefined();
  });

  it.each([
    'activation health',
    'tier-0 export readiness',
    'reconciliation gate',
    'restore drill',
  ])('serves readiness to the Host-only %s caller on a daemon with no configured origin', async () => {
    // The bytes export_tier0.py / backup_tier0.py (curl) and apply_ops_reconciliation.py /
    // activate_release.py (urllib) actually send. The production unit configures no RP origin.
    const app = buildApp({
      validateData: false,
      allowedOrigins: [],
      readiness: async () => ({ ok: true, quiescent: true, blockers: [] }),
    });
    const response = await app.inject({
      method: 'GET', url: '/readyz', headers: { host: '127.0.0.1:4317' },
    });
    expect(response.statusCode).toBe(200);
    // Byte-for-byte what backup_tier0.wait_for_locked_readiness compares against.
    expect(response.json()).toEqual({ ok: true, quiescent: true, blockers: [] });
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

  it('memoizes the synchronous service-cgroup probe across readiness bursts and expires after one second', async () => {
    let nowMs = Date.parse('2026-08-13T12:00:00.000Z');
    const ctx = makeSurfaceContext({ now: () => new Date(nowMs) });
    await ctx.readiness();
    await ctx.readiness();
    expect(serviceCgroupChildCount).toHaveBeenCalledTimes(1);
    nowMs += 1_001;
    await ctx.readiness();
    expect(serviceCgroupChildCount).toHaveBeenCalledTimes(2);
  });

  it('fails closed through /readyz when the service cgroup probe throws', async () => {
    serviceCgroupChildCount.mockImplementation(() => { throw new Error('cgroup unavailable'); });
    const realReadinessApp = buildApp({ validateData: false, allowedOrigins: [TEST_ORIGIN] });

    const response = await realReadinessApp.inject({ method: 'GET', url: '/readyz', headers: matrixHeaders });
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

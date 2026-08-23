import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SurfaceContext } from './http/context.ts';
import { makeSurfaceContext as makeProductionSurfaceContext } from './http/surface.ts';
import { mintSession } from './auth/session.ts';
import type { SessionConfig } from './auth/session.ts';
import type { SessionHost } from './pty/contracts.ts';
import { runtimeCapabilities } from './runtime/capabilities.ts';
// The browser's own decoder, run against the REAL route body: the cutover rests on this coupling.
import { decodeRuntimeCapabilities } from '../src/lib/runtimeCapabilities.tsx';
import { fileURLToPath } from 'node:url';
import { createInMemoryControlPlaneStore } from './control/store.ts';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

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
  buildApp as buildProductionApp,
  DEFAULT_HUMAN_REQUEST_SWEEP_INTERVAL_MS,
  DEFAULT_STRANDED_ARCHIVE_INTERVAL_MS,
  DEFAULT_STRANDED_ARCHIVE_WINDOW_MS,
  STRANDED_ARCHIVE_LIVE_MOVE_ALLOWED,
  humanRequestSweepLogLine,
  resolveHumanRequestSweepIntervalMs,
  resolveStrandedArchiveIntervalMs,
  resolveStrandedArchiveDryRun,
  resolveStrandedArchiveWindowMs,
  runScheduleBootMigrations,
  start,
} from './index.ts';
import type { WriterLease } from './control/writerLease.ts';
import { createExistingRootFileStoreHarnessForTest } from './control/test-fixtures/controlStore.ts';
import { readDevelopmentScheduleSeedSource } from './schedules/seedImport.ts';
import { publishVerifiedScheduleMarkerRemoval } from './write/branch.ts';

let app: FastifyInstance | undefined;
let testStateRoot: string | undefined;
const originalStateRoot = process.env.DASHBOARD_STATE_ROOT;
const TEST_ORIGIN = 'http://kb.test';
const TRACE_FIXTURES = fileURLToPath(new URL('./trace/__fixtures__/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATION_FIXTURES = fileURLToPath(new URL('./control/__fixtures__/dv3/', import.meta.url));
const PAUSE_MARKER = (readdirSync(MIGRATION_FIXTURES).map((name) => {
  try { return JSON.parse(readFileSync(join(MIGRATION_FIXTURES, name), 'utf8')) as Record<string, unknown>; } catch { return {}; }
}).find((value) => Array.isArray(value.markers))?.markers as Array<{ marker: string }>)[0].marker;
const TEST_SESSION: SessionConfig = { secret: Buffer.from('index-test-session-secret-32-bytes!'), ttlMs: 60_000 };
const matrixHeaders = { origin: TEST_ORIGIN, host: 'kb.test' };
// Mint inside each assertion: this file takes long enough that a module-load token can expire while
// later matrix rows are still running.
const sessionHeaders = () => ({ ...matrixHeaders, authorization: `Bearer ${mintSession('operator', TEST_SESSION).token}` });
const subjectHeaders = (subject: string) => ({ ...matrixHeaders, authorization: `Bearer ${mintSession(subject, TEST_SESSION).token}` });
function buildApp(options: Parameters<typeof buildProductionApp>[0] = {}) {
  return buildProductionApp({ controlStore: createInMemoryControlPlaneStore(), ...options });
}
function makeSurfaceContext(
  overrides: Parameters<typeof makeProductionSurfaceContext>[0] = {},
  activation: Parameters<typeof makeProductionSurfaceContext>[1] = {},
) {
  return makeProductionSurfaceContext({ controlStore: createInMemoryControlPlaneStore(), ...overrides }, activation);
}
/** What a successful composition-time host probe publishes; nothing registers a PTY without it. */
const AVAILABLE_PTY = {
  pty: true as const, host: 'desktop' as const, launchers: ['shell' as const],
  roots: ['repo' as const], checkedAt: '2026-08-22T09:00:00.000Z',
};
const matrixApp = () => buildApp({ validateData: false, allowedOrigins: [TEST_ORIGIN], sessionConfig: TEST_SESSION });
const ptyMatrixApp = () => buildApp({
  validateData: false,
  allowedOrigins: [TEST_ORIGIN],
  sessionConfig: TEST_SESSION,
  runtimeCapabilities: runtimeCapabilities('win32', AVAILABLE_PTY),
  // Every host method throws: an unauthenticated request must be refused before the route reaches the
  // host at all, so any call here is the test failing, not the fixture.
  ptySessionHost: refusingSessionHost(),
});

/** A platform {@link SessionHost} that refuses to be touched. Nothing in an unauthenticated matrix may
 *  reach a real host, so every method is a tripwire rather than a stub. */
function refusingSessionHost(touches?: { count: number }): SessionHost {
  const boom = (): never => {
    if (touches) touches.count += 1;
    throw new Error('unauthenticated PTY matrix must not reach the host');
  };
  return {
    probe: boom, create: boom, attach: boom, write: boom,
    resize: boom, close: boom, listEpoch: boom, drain: boom,
  };
}

beforeEach(() => {
  testStateRoot = mkdtempSync(join(tmpdir(), 'kb-index-test-state-'));
  process.env.DASHBOARD_STATE_ROOT = testStateRoot;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  serviceCgroupChildCount.mockReset();
  serviceCgroupChildCount.mockReturnValue(0);
  quiescenceSpy.mockClear();
  if (app) {
    await app.close();
    app = undefined;
  }
  if (originalStateRoot === undefined) delete process.env.DASHBOARD_STATE_ROOT;
  else process.env.DASHBOARD_STATE_ROOT = originalStateRoot;
  if (testStateRoot) rmSync(testStateRoot, { recursive: true, force: true });
  testStateRoot = undefined;
});

describe('server', () => {
  function countingLease() {
    const release = vi.fn();
    const lease = {
      mode: 'already-locked' as const,
      stateRoot: testStateRoot!,
      bootId: 'boot-test',
      pid: process.pid,
      assertHeld: vi.fn(),
      release,
    } satisfies WriterLease;
    return { lease, release };
  }

  it('releases the entrypoint lease once when application construction fails', async () => {
    const { lease, release } = countingLease();
    await expect(start(0, '127.0.0.1', {
      leaseFactory: () => lease,
      buildApplication: () => { throw new Error('build failed'); },
    })).rejects.toThrow(/build failed/);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('probes the host exactly once at composition and hands buildApp the closed capability', async () => {
    const { lease } = countingLease();
    const probePtyCapability = vi.fn(async () => AVAILABLE_PTY);
    let composed: Parameters<typeof buildProductionApp>[0] | undefined;
    const built = {
      addHook: () => undefined,
      listen: async () => undefined,
      close: async () => undefined,
    } as unknown as ReturnType<typeof buildProductionApp>;
    app = await start(0, '127.0.0.1', {
      leaseFactory: () => lease,
      probePtyCapability,
      buildApplication: (options) => { composed = options; return built; },
    });
    app = undefined;
    expect(probePtyCapability).toHaveBeenCalledOnce();
    expect(composed?.runtimeCapabilities).toMatchObject({
      pty: true, host: 'desktop', launchers: ['shell'], roots: ['repo'],
    });
  });

  it('composes the closed refusal when the one composition probe fails', async () => {
    const { lease } = countingLease();
    let composed: Parameters<typeof buildProductionApp>[0] | undefined;
    const built = {
      addHook: () => undefined,
      listen: async () => undefined,
      close: async () => undefined,
    } as unknown as ReturnType<typeof buildProductionApp>;
    await start(0, '127.0.0.1', {
      leaseFactory: () => lease,
      probePtyCapability: async () => ({
        pty: false as const,
        diagnostic: { reason: 'broker-unavailable' as const, detail: null, checkedAt: '2026-08-22T09:00:00.000Z' },
      }),
      buildApplication: (options) => { composed = options; return built; },
    });
    expect(composed?.runtimeCapabilities).toMatchObject({
      pty: false, diagnostic: { reason: 'broker-unavailable', detail: null },
    });
  });

  it('composes the closed refusal and still boots when the one composition probe throws', async () => {
    const { lease } = countingLease();
    let composed: Parameters<typeof buildProductionApp>[0] | undefined;
    const built = {
      addHook: () => undefined,
      listen: async () => undefined,
      close: async () => undefined,
    } as unknown as ReturnType<typeof buildProductionApp>;
    await start(0, '127.0.0.1', {
      leaseFactory: () => lease,
      probePtyCapability: async () => { throw new Error('host probe exploded'); },
      buildApplication: (options) => { composed = options; return built; },
    });
    expect(composed?.runtimeCapabilities?.pty).toBe(false);
    // Boot continued: the refusal composes into a real app that answers and registers no PTY route.
    app = buildApp({
      validateData: false, allowedOrigins: [TEST_ORIGIN], sessionConfig: TEST_SESSION,
      runtimeCapabilities: composed?.runtimeCapabilities, traceRoot: null,
      ptySessionHost: refusingSessionHost(),
    });
    const answered = await app.inject({
      method: 'GET', url: '/api/runtime/capabilities', headers: sessionHeaders(),
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({ pty: false });
    expect((await app.inject({
      method: 'GET', url: '/api/pty/sessions', headers: sessionHeaders(),
    })).statusCode).toBe(404);
  });

  it('publishes a capability body the browser decoder accepts, on both the available and refused route outcomes', async () => {
    app = ptyMatrixApp();
    const available = decodeRuntimeCapabilities((await app.inject({
      method: 'GET', url: '/api/runtime/capabilities', headers: sessionHeaders(),
    })).json());
    expect(available).not.toBeNull();
    expect(available).toMatchObject({
      pty: true, host: 'desktop', launchers: ['shell'], roots: ['repo'], checkedAt: AVAILABLE_PTY.checkedAt,
    });
    await app.close();
    app = buildApp({
      validateData: false, allowedOrigins: [TEST_ORIGIN], sessionConfig: TEST_SESSION,
      runtimeCapabilities: runtimeCapabilities('linux'), traceRoot: null,
    });
    const refused = decodeRuntimeCapabilities((await app.inject({
      method: 'GET', url: '/api/runtime/capabilities', headers: sessionHeaders(),
    })).json());
    expect(refused).toEqual({
      pty: false,
      diagnostic: { reason: 'broker-unavailable', detail: null, checkedAt: '' },
      localTranscripts: false,
    });
  });

  it('releases the entrypoint lease once when listen fails', async () => {
    const { lease, release } = countingLease();
    let onClose: (() => Promise<void>) | undefined;
    const failingApp = {
      addHook: (_name: string, hook: () => Promise<void>) => { onClose = hook; },
      listen: async () => { throw new Error('listen failed'); },
      close: async () => { await onClose?.(); },
    } as unknown as ReturnType<typeof buildProductionApp>;
    await expect(start(0, '127.0.0.1', {
      leaseFactory: () => lease,
      buildApplication: () => failingApp,
    })).rejects.toThrow(/listen failed/);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('omits PTY routes on Linux and reports the governed bridge capability', async () => {
    // Tripwire: a closed capability must not CONSTRUCT or touch a session host at all.
    const touches = { count: 0 };
    app = buildApp({
      validateData: false, allowedOrigins: [TEST_ORIGIN], sessionConfig: TEST_SESSION,
      runtimeCapabilities: runtimeCapabilities('linux'),
      coordinationPublication: 'outbox',
      traceRoot: null,
      // Injected and still unused: a probe-refused capability drops the host before composition.
      ptySessionHost: refusingSessionHost(touches),
    });
    const capabilities = await app.inject({
      method: 'GET', url: '/api/runtime/capabilities', headers: sessionHeaders(),
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toMatchObject({
      pty: false, runnerTrigger: false, vibe: false, durablePrWrites: false,
      localTranscripts: false, dashboardBridge: true,
      diagnostic: { reason: 'broker-unavailable', detail: null },
    });
    // The refused capability publishes a closed diagnostic and nothing else about the host.
    expect(capabilities.json()).not.toHaveProperty('host');
    expect(capabilities.json()).not.toHaveProperty('epochId');
    expect(capabilities.json()).not.toHaveProperty('launchers');
    expect((await app.inject({ method: 'GET', url: '/api/pty/sessions', headers: sessionHeaders() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/trace', headers: sessionHeaders() })).statusCode).toBe(404);
    // No host method was ever reached on the closed path.
    expect(touches.count).toBe(0);
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

  it('serves the store-backed schedule snapshot and never registers internal schedule TCP routes', async () => {
    app = matrixApp();
    const listed = await app.inject({ method: 'GET', url: '/api/schedules', headers: sessionHeaders() });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ scheduleCollectionRevision: 0, rows: [] });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    for (const url of ['/api/internal/schedules/snapshot', `/api/internal/schedules/${'a'.repeat(64)}/claim`]) {
      const statusCode = await new Promise<number>((resolveRequest, rejectRequest) => {
        const request = httpRequest({ hostname: '127.0.0.1', port, path: url, method: 'POST', headers: {
          ...sessionHeaders(), 'content-type': 'application/json', 'content-length': '2',
        } }, (response) => {
          response.resume();
          response.on('end', () => resolveRequest(response.statusCode ?? 0));
        });
        request.on('error', rejectRequest);
        request.end('{}');
      });
      expect(statusCode, url).toBe(404);
    }
  });

  it('resumes an incomplete pause publication on the second real Schedule boot after unlink', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'schedule-real-boot-repo-'));
    const stateRoot = mkdtempSync(join(tmpdir(), 'schedule-real-boot-state-'));
    const harness = createExistingRootFileStoreHarnessForTest();
    try {
      const source = await readDevelopmentScheduleSeedSource(REPO_ROOT);
      for (const file of [...source.heartbeatFiles, ...source.agentFiles]) {
        const path = join(repoRoot, ...file.path.split('/'));
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, file.bytes, 'utf8');
      }
      const markerPath = join(repoRoot, ...PAUSE_MARKER.split('/'));
      mkdirSync(join(markerPath, '..'), { recursive: true });
      writeFileSync(markerPath, 'legacy pause marker', 'utf8');
      let crashAfterUnlink = true;
      const publish = (marker: string, digest: string) => publishVerifiedScheduleMarkerRemoval(repoRoot, marker, digest, {
        prepare: async () => undefined,
        commit: async () => undefined,
        afterUnlink: async () => {
          if (crashAfterUnlink) {
            crashAfterUnlink = false;
            throw new Error('crash-after-unlink');
          }
        },
      });

      let store = harness.open(stateRoot);
      await expect(runScheduleBootMigrations(repoRoot, store, publish)).rejects.toThrow('crash-after-unlink');
      expect(await store.listIncompleteSchedulePauseMarkerReceipts?.()).toHaveLength(1);
      expect(() => readFileSync(markerPath)).toThrow();

      store = harness.restart(stateRoot);
      await runScheduleBootMigrations(repoRoot, store, publish);
      expect(await store.listIncompleteSchedulePauseMarkerReceipts?.()).toEqual([]);
      expect(store.getScheduleSnapshot().schedules.find((row) => row.owner.id === 'hygiene')).toMatchObject({ armed: false });
    } finally {
      harness.close();
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it('derives operator schedule mirror paths from the server-owned Agent declaration', async () => {
    app = matrixApp();
    const create = async (id: string, expectedCollectionRevision: number) => app!.inject({
      method: 'POST', url: '/api/schedules', headers: sessionHeaders(),
      payload: {
        owner: { type: 'agent', id },
        cadence: { kind: 'cron', minute: '0', hour: '9', dayOfMonth: '*', month: '*', dayOfWeek: '*' },
        expectedCollectionRevision, idempotencyKey: `mirror-${id}`,
      },
    });
    expect((await create('fyt-checker', 0)).json()).toMatchObject({
      schedule: { mirrorPath: 'orgs/faceless-youtube/HEARTBEAT.md' },
    });
    expect((await create('hygiene', 1)).json()).toMatchObject({ schedule: { mirrorPath: 'HEARTBEAT.md' } });
  });

  it.each(['dashboard-engine', 'host:vm'])('keeps schedule GET session-readable but refuses every mutation for %s bearer', async (subject) => {
    app = matrixApp();
    const headers = subjectHeaders(subject);
    expect((await app.inject({ method: 'GET', url: '/api/schedules', headers })).statusCode).toBe(200);
    const id = 'a'.repeat(64);
    const attempts = [
      app.inject({ method: 'POST', url: '/api/schedules', headers, payload: {
        owner: { type: 'agent', id: 'hygiene' }, cadence: { kind: 'words', words: 'daily', time: '09:15' },
        expectedCollectionRevision: 0, idempotencyKey: `${subject}-create`,
      } }),
      app.inject({ method: 'POST', url: `/api/schedules/${id}/arm`, headers, payload: { expectedVersion: 1, idempotencyKey: `${subject}-arm`, armed: true } }),
      app.inject({ method: 'POST', url: `/api/schedules/${id}/disarm`, headers, payload: { expectedVersion: 1, idempotencyKey: `${subject}-disarm`, armed: false } }),
      app.inject({ method: 'DELETE', url: `/api/schedules/${id}`, headers, payload: { expectedVersion: 1, idempotencyKey: `${subject}-delete` } }),
    ];
    expect((await Promise.all(attempts)).map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
  });

  it('allows the operator bearer to create, arm, disarm, and delete schedules', async () => {
    app = matrixApp();
    const headers = sessionHeaders();
    const created = await app.inject({ method: 'POST', url: '/api/schedules', headers, payload: {
      owner: { type: 'agent', id: 'hygiene' }, cadence: { kind: 'words', words: 'daily', time: '09:15' },
      expectedCollectionRevision: 0, idempotencyKey: 'operator-mutation-create',
    } });
    expect(created.statusCode).toBe(201);
    const row = created.json().schedule as { id: string; version: number };
    const armed = await app.inject({ method: 'POST', url: `/api/schedules/${row.id}/arm`, headers, payload: {
      expectedVersion: row.version, idempotencyKey: 'operator-mutation-arm', armed: true,
    } });
    const disarmed = await app.inject({ method: 'POST', url: `/api/schedules/${row.id}/disarm`, headers, payload: {
      expectedVersion: armed.json().schedule.version, idempotencyKey: 'operator-mutation-disarm', armed: false,
    } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/schedules/${row.id}`, headers, payload: {
      expectedVersion: disarmed.json().schedule.version, idempotencyKey: 'operator-mutation-delete',
    } });
    expect([armed.statusCode, disarmed.statusCode, deleted.statusCode]).toEqual([200, 200, 200]);
  });

  it.each([
    '/api/kb/tree', '/api/kb/file?path=docs/x.md', '/api/kb/history?path=docs/x.md',
    '/api/index', '/api/inbox', '/api/home', '/api/health', '/api/routing',
    '/api/agents', '/api/agents/system-workers', '/api/agents/example',
    '/api/schedules',
    '/api/workflows', '/api/workflows/profiles', '/api/workflows/example',
    '/api/control/proposals', '/api/control/execution', '/api/control/runs', '/api/control/runs/example',
    '/api/control/proposals/example/revisions/example', '/api/control/runs/example/attempts/example/io',
    '/api/control/runs/example/events', '/api/control/runs/example/events/stream',
    '/api/control/retention/inventory', '/api/attention', '/events',
  ])('rejects unauthenticated read %s', async (url) => {
    app = matrixApp();
    const response = await app.inject({ method: 'GET', url, headers: matrixHeaders });
    expect(response.statusCode).toBe(401);
  });

  it.each([
    '/api/pty/sessions',
  ])('rejects unauthenticated read %s', async (url) => {
    app = ptyMatrixApp();
    const response = await app.inject({ method: 'GET', url, headers: matrixHeaders });
    expect(response.statusCode).toBe(401);
  });

  // W6.4 removed the v1 session-run REST surface outright (plan section 6). These three paths are not
  // "unauthorized" any more — they do not exist, and a 401 here would mean a v1 route was quietly kept.
  it.each([
    '/api/pty/session-runs', '/api/pty/session-runs/example', '/api/pty/session-runs/example/transcript',
  ])('404s the removed v1 session-run route %s', async (url) => {
    app = ptyMatrixApp();
    const response = await app.inject({ method: 'GET', url, headers: matrixHeaders });
    expect(response.statusCode).toBe(404);
    // Authenticated too: the paths are GONE, not merely guarded.
    const authenticated = await app.inject({ method: 'GET', url, headers: sessionHeaders() });
    expect(authenticated.statusCode).toBe(404);
  });

  // Governed writes composed OUTSIDE the write surface (`registerWriteSurface`) — so `surface.test.ts`'s
  // own "session-less POST is 401, never 404" matrix cannot see them. They are gated by THIS file's
  // scope-level `requireSession`, and must prove the same property: gated, not missing.
  it.each([
    '/api/schedules', '/api/schedules/example/arm', '/api/control/human-requests/example/respond/challenge',
  ])('rejects unauthenticated write %s (401, never 404)', async (url) => {
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
    ['/api/agents/example', 404], ['/api/workflows/example', 404],
    ['/api/control/runs/example', 404], ['/api/control/runs/example/events', 404],
    ['/api/control/runs/example/events/stream', 404], ['/api/attention', 200], ['/api/schedules', 200],
  ])('keeps matched resource %s at its normal %i after authentication', async (url, expected) => {
    app = matrixApp();
    expect((await app.inject({ method: 'GET', url, headers: sessionHeaders() })).statusCode).toBe(expected);
  });

  it('pins P2 removed routes to 404 after the entity and schedule replacements are live', async () => {
    app = matrixApp();
    expect((await app.inject({ method: 'GET', url: '/api/dag' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/dag', headers: sessionHeaders() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/agents/system-workers', headers: sessionHeaders() })).statusCode).toBe(404);
    for (const [method, url] of [
      ['GET', '/api/panels/schedules'],
      ['POST', '/api/schedules/edit'],
      ['POST', '/api/write/pause-cadence'],
    ] as const) {
      expect((await app.inject({ method, url, headers: sessionHeaders(), payload: method === 'POST' ? {} : undefined })).statusCode, url).toBe(404);
    }
    for (const url of [
      '/api/workflows/example/assignment-amendments',
      '/api/workflows/example/governance-amendments',
    ]) {
      expect((await app.inject({ method: 'POST', url, headers: sessionHeaders(), payload: {} })).statusCode).toBe(404);
    }
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

describe('P1 route matrix', () => {
  it('serves Inbox, Home, and Health only behind a session', async () => {
    app = matrixApp();
    for (const url of ['/api/inbox', '/api/home', '/api/health']) {
      expect((await app.inject({ method: 'GET', url, headers: matrixHeaders })).statusCode, url).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: sessionHeaders() })).statusCode, url).toBe(200);
    }
    const home = await app.inject({ method: 'GET', url: '/api/home', headers: sessionHeaders() });
    expect(home.headers.etag).toMatch(/^"home:/);
    expect(home.json().sections.map((section: { state: string; data?: { section: string }; reason?: string }) =>
      section.state === 'ready' ? section.data?.section : section.reason))
      .toEqual(['running-now', 'attention-counts', 'next-schedules', 'release-unavailable', 'recent-outcomes']);
  });

  it('returns authenticated 404 for retired read routes and keeps retained projections', async () => {
    app = matrixApp();
    for (const url of [
      '/api/human-inbox', '/api/approvals', '/api/registry', '/api/registry/skills',
      '/api/registry/connections', '/api/ledgers/slices', '/api/panels/health', '/api/panels/usage',
      '/api/panels/atlas', '/api/panels/loop-status', '/api/panels/schedules',
      '/api/panels/autonomy-ladder', '/api/panels/grades-history?agent=codex-worker',
      '/api/composer/sessions', '/api/composer/sessions/example',
    ]) {
      expect((await app.inject({ method: 'GET', url, headers: sessionHeaders() })).statusCode, url).toBe(404);
    }
    for (const url of ['/api/index', '/api/schedules']) {
      expect((await app.inject({ method: 'GET', url, headers: sessionHeaders() })).statusCode, url).toBe(200);
    }
  });
});

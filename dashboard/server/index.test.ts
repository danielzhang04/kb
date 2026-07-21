import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildApp,
  DEFAULT_STRANDED_ARCHIVE_INTERVAL_MS,
  DEFAULT_STRANDED_ARCHIVE_WINDOW_MS,
  STRANDED_ARCHIVE_LIVE_MOVE_ALLOWED,
  resolveStrandedArchiveIntervalMs,
  resolveStrandedArchiveDryRun,
  resolveStrandedArchiveWindowMs,
} from './index.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('server', () => {
  it('binds localhost only and returns 200 on /healthz', async () => {
    app = buildApp();
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
    app = buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });

    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = (await res.json()) as { ok: boolean; node: string };

    // guards an accidental unpinned Node upgrade
    expect(process.versions.node.startsWith('24.')).toBe(true);
    expect(body.node.startsWith('24.')).toBe(true);
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

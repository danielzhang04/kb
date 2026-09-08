import { describe, expect, it } from 'vitest';
import { BOOT_DIAGNOSTIC_GET_ROUTES, createBootDiagnosticsApp } from './bootDiagnostics.ts';

describe('boot diagnostics surface', () => {
  it('registers only the two explicit GET diagnostics and reports unavailable', async () => {
    const app = createBootDiagnosticsApp();
    try {
      expect(BOOT_DIAGNOSTIC_GET_ROUTES).toEqual(['/healthz', '/readyz']);
      // Inspect Fastify's actual router rather than trusting the exported documentation constant. HEAD is
      // synthesized for each GET by Fastify; no other endpoint or method is present.
      expect(app.printRoutes().replaceAll('\r\n', '\n').trimEnd()).toBe(
        '└── /\n    ├── healthz (GET, HEAD)\n    └── readyz (GET, HEAD)',
      );
      expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(503);
      expect((await app.inject({ method: 'GET', url: '/healthz' })).json())
        .toEqual({ ok: false, code: 'control-store-hydration-failed' });
      expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);
      expect((await app.inject({ method: 'GET', url: '/readyz' })).json())
        .toEqual({ ok: false, quiescent: false, blockers: ['control-store-unavailable'] });

      // Fastify synthesizes HEAD for each GET. That framework behavior is permitted; no additional
      // explicit route is mounted and HEAD carries the same failure status.
      expect((await app.inject({ method: 'HEAD', url: '/healthz' })).statusCode).toBe(503);
      for (const url of [
        '/', '/api/health', '/api/auth/assert/options', '/api/control/runs/x',
        '/api/workflows/x/launch', '/api/schedules', '/api/pty/sessions', '/assets/index.js',
      ]) {
        expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
      }
      for (const method of ['POST', 'PUT', 'DELETE'] as const) {
        for (const url of [
          '/healthz', '/readyz', '/api/auth/assert/options', '/api/control/runs/x',
          '/api/workflows/x/launch', '/api/schedules', '/api/pty/sessions',
        ]) {
          expect((await app.inject({ method, url, payload: {} })).statusCode, `${method} ${url}`).toBe(404);
        }
      }
    } finally {
      await app.close();
    }
  });
});

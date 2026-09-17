/**
 * MEDIUM-1 (adversarial security review, 2026-09-16) — the PTY scope was outside the gate.
 *
 * `requireAuthority` was installed at exactly two places (`http/surface.ts`'s authenticated scope and
 * `index.ts`'s read/write scope). The PTY surface registers on a THIRD, sibling scope of its own, whose
 * hook chain is origin -> rate limit -> session -> browser principal and nothing else. So
 * `DELETE /api/pty/sessions/:sessionId` — which IS in `ROUTE_AUTHORITY`, as `open` — never reached the
 * gate that is supposed to enforce that table.
 *
 * No security loss on that route (it is `open` either way), but two real ones:
 *   1. the table asserted coverage it did not have;
 *   2. the fail-closed property the whole design rests on — a mutating route nobody classified answers
 *      `403 route-unclassified` rather than shipping ungated and silent — was absent in this scope.
 *
 * `authority/policy.test.ts`'s completeness check could not see any of this: its fixture leaves
 * `runtimeCapabilities.pty` false, so the PTY routes are never registered at all.
 *
 * These tests use the REAL, fully-composed `buildApp` with the PTY capability on, an injected platform
 * host, and an injected browser-session ref table (so a request gets past the route's own
 * `preValidation` and actually reaches the `preHandler` the gate installs).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, registeredRoutesOf } from '../index.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { mintSession, type BrowserSessionRefManager, type SessionConfig } from '../auth/session.ts';
import { classifyRoute } from './policy.ts';
import type { SessionHost } from '../pty/contracts.ts';

/**
 * `classifyRoute` is stubbed per-test so one case can ask the question the real table cannot: what
 * happens to a mutating PTY route NOBODY classified? With the gate absent from this scope (the defect)
 * the stub changes nothing and the handler answers; with the gate installed it must be `403
 * route-unclassified`. That difference is the whole proof, and it needs no speculative route.
 */
const stub = vi.hoisted(() => ({ unclassifyPty: false }));
vi.mock('./policy.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./policy.ts')>();
  return {
    ...actual,
    classifyRoute: (method: string, path: string) =>
      (stub.unclassifyPty && path.startsWith('/api/pty') ? null : actual.classifyRoute(method, path)),
  };
});

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));
const SESSION: SessionConfig = { secret: Buffer.from('pty-authority-scope-secret-0001'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost';
const SESSION_ID = 'pty-0123456789abcdef0123456789abcdef';
const AVAILABLE_PTY = {
  pty: true as const, host: 'desktop' as const, launchers: ['shell' as const],
  roots: ['repo' as const], checkedAt: '2026-09-16T09:00:00.000Z',
};

/** A platform host that never has to do anything: nothing below reaches a live session. */
function idleSessionHost(): SessionHost {
  const absent = (): never => { throw new Error('pty authority test must not reach the platform host'); };
  return {
    probe: async () => ({ ok: true, value: AVAILABLE_PTY }), create: absent, attach: absent, write: absent,
    endInput: absent, resize: absent, close: absent, listEpoch: async () => [], drain: async () => {},
  } as unknown as SessionHost;
}

/** Resolves any cookie to one browser principal, so `preValidation` admits the request and the
 *  `preHandler` the gate installs is actually reached. */
function refManager(): BrowserSessionRefManager {
  return { resolve: async () => ({ ok: true, value: { browserSessionRef: 'browser-ref-value' } }) } as unknown as BrowserSessionRefManager;
}

let app: FastifyInstance;
let token: string;
let stateRoot: string;
let priorStateRoot: string | undefined;

beforeEach(async () => {
  stub.unclassifyPty = false;
  priorStateRoot = process.env.DASHBOARD_STATE_ROOT;
  stateRoot = mkdtempSync(join(tmpdir(), 'kb-pty-authority-'));
  process.env.DASHBOARD_STATE_ROOT = stateRoot;
  app = buildApp({
    repoRoot: REPO_A,
    sessionConfig: SESSION,
    allowedOrigins: [ORIGIN],
    validateData: false,
    controlStore: createInMemoryControlPlaneStore(),
    runtimeCapabilities: { ...(await import('../runtime/capabilities.ts')).runtimeCapabilities('win32', AVAILABLE_PTY) },
    ptySessionHost: idleSessionHost(),
    browserSessionRefs: refManager(),
    appendAudit: (_root, event) => ({ ts: '2026-09-16T00:00:00.000Z', ...event } as never),
  });
  await app.ready();
  token = mintSession('operator', SESSION).token;
}, 30_000);

afterEach(async () => {
  await app?.close();
  if (priorStateRoot === undefined) delete process.env.DASHBOARD_STATE_ROOT;
  else process.env.DASHBOARD_STATE_ROOT = priorStateRoot;
  rmSync(stateRoot, { recursive: true, force: true });
});

const ptyDelete = () => app.inject({
  method: 'DELETE',
  url: `/api/pty/sessions/${SESSION_ID}`,
  headers: { origin: ORIGIN, host: 'localhost', authorization: `Bearer ${token}`, cookie: 'kb_browser=ref' },
});

describe('the PTY scope is inside the authority gate', () => {
  it('registers the PTY routes at all, and the table classifies the mutating one', async () => {
    const urls = registeredRoutesOf(app).map((route) => `${route.method} ${route.url}`);
    expect(urls).toContain('DELETE /api/pty/sessions/:sessionId');
    expect(classifyRoute('DELETE', '/api/pty/sessions/:sessionId')?.cls).toBe('open');
  }, 30_000);

  it('lets the classified `open` PTY mutation through to its own handler', async () => {
    const res = await ptyDelete();
    // Whatever the registry decides about a session that does not exist is its own business; the point
    // is that no AUTHORITY refusal was produced.
    expect(res.statusCode).not.toBe(403);
    expect((res.json() as { error?: unknown }).error).not.toBe('route-unclassified');
  }, 30_000);

  it('REFUSES an unclassified PTY mutation — the fail-closed property this scope used to lack', async () => {
    stub.unclassifyPty = true;
    const res = await ptyDelete();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'route-unclassified' });
  }, 30_000);

  it('still authenticates FIRST: an unauthenticated PTY mutation is 401, not a route classification', async () => {
    // The gate is a `preHandler`, so the route's own `preValidation` session check still answers first.
    // An unauthenticated caller must not be able to probe the authority table, or make the daemon append
    // a refusal audit row.
    stub.unclassifyPty = true;
    const res = await app.inject({
      method: 'DELETE', url: `/api/pty/sessions/${SESSION_ID}`, headers: { origin: ORIGIN, host: 'localhost' },
    });
    expect(res.statusCode).toBe(401);
  }, 30_000);

  it('passes GET straight through, so listing sessions is unaffected', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/pty/sessions',
      headers: { origin: ORIGIN, host: 'localhost', authorization: `Bearer ${token}`, cookie: 'kb_browser=ref' },
    });
    expect(res.statusCode).toBe(200);
  }, 30_000);
});

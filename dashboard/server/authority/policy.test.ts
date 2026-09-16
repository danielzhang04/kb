import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  ROUTE_AUTHORITY, classifyRoute, routeKey, FORBIDDEN_ROUTE_PREFIXES, PENDING_DELETION,
} from './policy.ts';
import { buildApp, registeredRoutesOf } from '../index.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';

describe('route authority table', () => {
  it('has no duplicate route keys', () => {
    const keys = ROUTE_AUTHORITY.map(routeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every signed route a way to derive its entityRef', () => {
    for (const entry of ROUTE_AUTHORITY.filter((e) => e.cls === 'signed')) {
      expect(entry.entityParam !== null || typeof entry.entityFromBody === 'function').toBe(true);
    }
  });

  it('escalates only the three respond routes', () => {
    expect(ROUTE_AUTHORITY.filter((e) => e.escalate === 'workflow-tag').map(routeKey).sort()).toEqual([
      'POST /api/control/human-requests/:requestRef/respond',
      'POST /api/control/iteration-gates/:requestRef/resolve',
      'POST /api/v1/runs/:runRef/human-requests/:requestRef/respond',
    ]);
  });

  it('classifies an exact method+path and refuses anything else', () => {
    expect(classifyRoute('POST', '/api/control/runs/:runRef/archive')?.cls).toBe('open');
    expect(classifyRoute('POST', '/api/control/runs/:runRef/reconcile-publication')?.cls).toBe('signed');
    expect(classifyRoute('DELETE', '/api/schedules/:id')?.cls).toBe('signed');
    expect(classifyRoute('POST', '/api/control/runs/:runRef/nope')).toBeNull();
    expect(classifyRoute('post', '/api/control/runs/:runRef/archive')?.cls).toBe('open'); // method case-insensitive
  });

  it('names no table route under a forbidden prefix', () => {
    for (const entry of ROUTE_AUTHORITY) {
      for (const prefix of FORBIDDEN_ROUTE_PREFIXES) {
        expect(entry.path.startsWith(prefix)).toBe(false);
      }
    }
  });

  it('lists exactly the four ceremony routes as pending deletion', () => {
    expect([...PENDING_DELETION].sort()).toEqual([
      'POST /api/auth/assert/options',
      'POST /api/auth/assert/verify',
      'POST /api/auth/register/options',
      'POST /api/auth/register/verify',
    ]);
  });
});

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));
const TEST_SESSION_CONFIG = { secret: Buffer.from('authority-policy-test-secret-01'), ttlMs: 60_000 };
const TEST_ORIGINS = ['http://localhost'];

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

/**
 * The REAL, fully-composed daemon (`server/index.ts#buildApp`) — every route any deployment mode
 * registers, agents/workflows/schedules/inbox/v1 included — not a partial fixture. Using anything smaller
 * would let a route the fixture happens to omit slip past the completeness check unnoticed.
 */
function buildRealApp(): FastifyInstance {
  const app = buildApp({
    repoRoot: REPO_A,
    sessionConfig: TEST_SESSION_CONFIG,
    allowedOrigins: TEST_ORIGINS,
    validateData: false,
    controlStore: createInMemoryControlPlaneStore(),
  });
  openApps.push(app);
  return app;
}

/**
 * ONLY the authenticated write-surface scope (`surface.ts#registerWriteSurface`) — the exact scope the
 * design (spec §4.1) names as `requireAuthority`'s install point, `surface.ts:654-662`, immediately after
 * `requireSession` and before every `register*Routes` call inside it. A route that is registered in the
 * real app but never shows up here is registered on a SIBLING scope: the gate — wherever T3 installs it —
 * cannot see it there no matter what the table classifies it as. This is the risk the third test below
 * exists to catch: a route silently moved off, or added to, the wrong scope must fail loudly, not pass by
 * accident.
 */
function buildGatedScopeApp(): { app: FastifyInstance; keys: Set<string> } {
  const app = Fastify({ logger: false });
  const keys = new Set<string>();
  // `registerWriteSurface` is called directly here, bypassing `buildApp`'s own `onRoute` collector
  // (`registeredRoutesOf` only knows about apps it built), so this fixture needs its own.
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) keys.add(`${String(method)} ${route.url}`);
  });
  const ctx = makeSurfaceContext({
    controlStore: createInMemoryControlPlaneStore(),
    repoRoot: REPO_A,
    sessionConfig: TEST_SESSION_CONFIG,
    allowedOrigins: TEST_ORIGINS,
  });
  registerWriteSurface(app, ctx);
  openApps.push(app);
  return { app, keys };
}

/**
 * Ceremony byproducts spec §4.1 names for deletion alongside the four `PENDING_DELETION` routes
 * ("Deleted with WebAuthn: ... `/api/control/human-requests/:requestRef/respond/challenge`,
 * `/api/inbox/deployment/:ref/challenge`, `/api/control/iteration-gates/:requestRef/challenge`") but that
 * T2 — not T1 — removes. `PENDING_DELETION` itself stays exactly the four auth routes (T2's own deletion
 * step reads it), so these three are excluded here, locally, rather than folded into the exported table:
 * they are not part of the target policy — putting them in `ROUTE_AUTHORITY` would classify routes this
 * design intends to have zero of. Until T2 lands they still exist in a T1-only checkout and would
 * otherwise show up as false "unclassified" failures.
 */
const CEREMONY_CHALLENGE_ROUTES_T2_ALSO_DELETES: readonly string[] = [
  'POST /api/control/human-requests/:requestRef/respond/challenge',
  'POST /api/inbox/deployment/:ref/challenge',
  'POST /api/control/iteration-gates/:requestRef/challenge',
];

describe('the table covers the real app', () => {
  it('classifies every mutating route the real daemon registers', async () => {
    const app = buildRealApp();
    await app.ready();
    const registered = registeredRoutesOf(app).filter((r) => MUTATING.has(r.method));
    const unclassified = registered
      .map((r) => `${r.method} ${r.url}`)
      .filter((key) => !PENDING_DELETION.includes(key))
      .filter((key) => !CEREMONY_CHALLENGE_ROUTES_T2_ALSO_DELETES.includes(key))
      .filter((key) => !key.startsWith('POST /api/v1/hosts/'))         // node scope, spec §2
      .filter((key) => !key.startsWith('POST /api/v1/runs/') || key.includes('human-requests'))
      .filter((key) => !key.startsWith('POST /api/control/paid-action')) // grant class, spec §2
      .filter((key) => classifyRoute(key.split(' ')[0], key.slice(key.indexOf(' ') + 1)) === null);
    expect(unclassified).toEqual([]);
  });

  it('registers no route under a forbidden prefix', async () => {
    const app = buildRealApp();
    await app.ready();
    for (const route of registeredRoutesOf(app)) {
      for (const prefix of FORBIDDEN_ROUTE_PREFIXES) {
        expect(route.url.startsWith(prefix)).toBe(false);
      }
    }
  });

  it('names every classified route a sibling scope registers outside the gate\'s reach, so a route ' +
    'moved off (or newly added away from) the authenticated scope fails this test, not silently at runtime', async () => {
    const real = buildRealApp();
    const { app: gated, keys: gatedKeys } = buildGatedScopeApp();
    await real.ready();
    await gated.ready();
    const realKeys = new Set(registeredRoutesOf(real).map((r) => `${r.method} ${r.url}`));
    const outsideGate = ROUTE_AUTHORITY
      .filter((entry) => realKeys.has(routeKey(entry)))     // only judge routes that actually exist today
      .filter((entry) => !gatedKeys.has(routeKey(entry)))
      .map(routeKey)
      .sort();
    // PINNED, not aspirational: this is today's real gap between the design's stated install point
    // (surface.ts:654-662, the registerWriteSurface authenticated scope) and where these routes actually
    // register — agents/routes.ts, workflows/routes.ts, the schedule routes, and the inbox deployment /
    // asset-pull action routes all register on index.ts's sibling read-scope (lines ~279-308), not inside
    // registerWriteSurface. Until T3/T9 either widen the gate's install point to cover that scope too, or
    // move these registrations into the authenticated scope, `requireAuthority` cannot reach any route in
    // this list — including the SIGNED `DELETE /api/schedules/:id` and the signed inbox deployment routes.
    // A route disappearing from, or appearing in, this list is exactly the drift this test exists to catch.
    expect(outsideGate).toEqual([
      'DELETE /api/schedules/:id',
      'POST /api/agents',
      'POST /api/agents/:id/launch',
      'POST /api/inbox/asset-pull/:intentRef/pull',
      'POST /api/inbox/asset-pull/:intentRef/retry',
      'POST /api/inbox/deployment/:ref/abort',
      'POST /api/inbox/deployment/:ref/acknowledge',
      'POST /api/inbox/deployment/:ref/close-ptys-and-continue',
      'POST /api/inbox/deployment/:ref/confirm',
      'POST /api/inbox/deployment/:ref/deploy',
      'POST /api/schedules',
      'POST /api/schedules/:id/arm',
      'POST /api/schedules/:id/disarm',
      'POST /api/workflows',
      'POST /api/workflows/:id/launch',
      'PUT /api/agents/:id',
      'PUT /api/workflows/:id',
    ]);
  });
});

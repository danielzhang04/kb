import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  ROUTE_AUTHORITY, classifyRoute, routeKey, FORBIDDEN_ROUTE_PREFIXES,
} from './policy.ts';
import { buildApp, registeredRoutesOf } from '../index.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { runtimeCapabilities } from '../runtime/capabilities.ts';

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

  // D1 (adversarial review of claude/c2-cadence-gates, 2026-09-23 boss ruling): the force-archive
  // route joins the escalated set — force-resolving an open human request is the same signed-class
  // action on a fail-closed run whether it happens through the gate/respond routes or through
  // `archive`'s `force: true`.
  it('escalates the three respond routes and the force-archive route', () => {
    expect(ROUTE_AUTHORITY.filter((e) => e.escalate === 'workflow-tag').map(routeKey).sort()).toEqual([
      'POST /api/control/human-requests/:requestRef/respond',
      'POST /api/control/iteration-gates/:requestRef/resolve',
      'POST /api/control/runs/:runRef/archive',
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
});

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
/** What a successful composition-time PTY host probe publishes; nothing registers a PTY without it. */
const AVAILABLE_PTY = {
  pty: true as const, host: 'desktop' as const, launchers: ['shell' as const],
  roots: ['repo' as const], checkedAt: '2026-09-16T09:00:00.000Z',
};
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
 * ONLY the authenticated write-surface scope (`surface.ts#registerWriteSurface`) — the FIRST of
 * `requireAuthority`'s two install points, immediately after `requireSession` and before every
 * `register*Routes` call inside it (spec §4.1, `surface.ts:654-662`). A route that is registered in the
 * real app but never shows up here is registered on a SIBLING scope — `index.ts`'s own read/write scope,
 * which carries the SECOND install point (see that file). This fixture exists so the test just below can
 * still catch a route silently moving off, or onto, `registerWriteSurface`'s own scope; it is not, by
 * itself, proof of what the gate can or cannot reach — the functional describe block after it is.
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
 * The mutating routes the completeness check below is allowed to skip, NAMED ONE BY ONE.
 *
 * MEDIUM-2 (security review 2026-09-16): these used to be PREFIX filters —
 * `!key.startsWith('POST /api/v1/hosts/')` and `!key.startsWith('POST /api/v1/runs/') ||
 * key.includes('human-requests')`. The second exempted EVERY future `POST /api/v1/runs/:runRef/<anything>`
 * from the check, not just the two node routes it meant. A new operator-scope route under that prefix
 * would be unclassified, would `403 route-unclassified` at runtime (fail closed — good), and the test
 * that exists to catch exactly that would have stayed green. Literal keys cannot drift that way: a
 * genuinely new route has to be classified or named here on purpose.
 *
 * MEDIUM-1's other half is the second assertion below: with `runtimeCapabilities.pty` false (this
 * fixture's default) the PTY routes are never registered, so this check could not see them at all.
 */
/** The four node-identity routes (`registerV1NodeRoutes`) — out of scope per spec §2, on a sibling
 *  scope with no gate. */
const NODE_SCOPE_KEYS: readonly string[] = Object.freeze([
  'PUT /api/v1/hosts/:hostId',
  'POST /api/v1/hosts/:hostId/leases/claim',
  'POST /api/v1/runs/:runRef/leases/renew',
  'POST /api/v1/runs/:runRef/reports',
]);
const EXEMPT_FROM_COMPLETENESS: readonly string[] = Object.freeze([
  ...NODE_SCOPE_KEYS,
  // The durable paid-action grant — deliberately outside the gate (spec §2, INFO-3): headless workers
  // have no session, and the route resolves its grant in its own preHandler.
  'POST /api/control/paid-action',
]);

describe('the table covers the real app', () => {
  it('classifies every mutating route the real daemon registers', async () => {
    const app = buildRealApp();
    await app.ready();
    const registered = registeredRoutesOf(app).filter((r) => MUTATING.has(r.method));
    // T2 removed the credential-ceremony auth mechanism end to end, so the ceremony routes
    // `PENDING_DELETION` and `TRANSITIONAL_CEREMONY_ROUTES` used to carve out no longer exist on
    // the real daemon at all — no filter is needed for them any more.
    const unclassified = registered
      .map((r) => `${r.method} ${r.url}`)
      .filter((key) => !EXEMPT_FROM_COMPLETENESS.includes(key))
      .filter((key) => classifyRoute(key.split(' ')[0], key.slice(key.indexOf(' ') + 1)) === null);
    expect(unclassified).toEqual([]);
  });

  it('states exactly which carve-outs are LIVE and which are dead in this fixture', async () => {
    // MEDIUM-1's second half, made visible rather than left implicit. `POST /api/control/paid-action`
    // really is registered here, so its carve-out is load-bearing. The four node routes are NOT:
    // `registerV1NodeRoutes` returns immediately without `ctx.nodeProxyUid` + `ctx.loadHostNodeMap`, and
    // `BuildAppOptions` exposes neither, so no fixture built through `buildApp` can enumerate that
    // scope. Their carve-out is therefore DEAD HERE — pinned as such, so the fact is stated instead of
    // being discovered again by the next reviewer. If a node route ever becomes reachable through
    // `buildApp`, this goes red and the carve-out has to be justified against a scope that now exists.
    const app = buildRealApp();
    await app.ready();
    const registered = new Set(registeredRoutesOf(app).map((r) => `${r.method} ${r.url}`));
    expect(registered.has('POST /api/control/paid-action')).toBe(true);
    expect(EXEMPT_FROM_COMPLETENESS.filter((key) => !registered.has(key))).toEqual([...NODE_SCOPE_KEYS]);
  });

  it('classifies the PTY scope too, which the default fixture never registers (MEDIUM-1)', async () => {
    // Built a SECOND time with the PTY capability on and a platform host injected, so the PTY scope is
    // actually composed. `authority/ptyScope.test.ts` proves the gate reaches it; this proves the TABLE
    // covers it, which the fixture above structurally could not.
    const withPty = buildApp({
      repoRoot: REPO_A,
      sessionConfig: TEST_SESSION_CONFIG,
      allowedOrigins: TEST_ORIGINS,
      validateData: false,
      controlStore: createInMemoryControlPlaneStore(),
      runtimeCapabilities: runtimeCapabilities('win32', AVAILABLE_PTY),
      ptySessionHost: { probe: async () => ({ ok: true, value: AVAILABLE_PTY }), listEpoch: async () => [] } as never,
    });
    openApps.push(withPty);
    await withPty.ready();
    const ptyRoutes = registeredRoutesOf(withPty)
      .map((r) => `${r.method} ${r.url}`)
      .filter((key) => key.includes('/api/pty'));
    expect(ptyRoutes).toContain('DELETE /api/pty/sessions/:sessionId');
    const unclassified = registeredRoutesOf(withPty)
      .filter((r) => MUTATING.has(r.method))
      .map((r) => `${r.method} ${r.url}`)
      .filter((key) => !EXEMPT_FROM_COMPLETENESS.includes(key))
      .filter((key) => classifyRoute(key.split(' ')[0], key.slice(key.indexOf(' ') + 1)) === null);
    expect(unclassified).toEqual([]);
  }, 30_000);

  it('registers no route under a forbidden prefix', async () => {
    const app = buildRealApp();
    await app.ready();
    for (const route of registeredRoutesOf(app)) {
      for (const prefix of FORBIDDEN_ROUTE_PREFIXES) {
        expect(route.url.startsWith(prefix)).toBe(false);
      }
    }
  });

  it('names every classified route registerWriteSurface\'s OWN scope reaches, and lists everything else ' +
    'it does not — the sibling read/write scope index.ts composes directly on `app` (agents, schedules, ' +
    'workflows, inbox deployment/asset-pull actions) is a SEPARATE scope from registerWriteSurface and ' +
    'always will be. T3 installs `requireAuthority` a second time there (see index.ts, right after that ' +
    'scope\'s own requireSession) rather than moving those registrations — the functional test below is ' +
    'what proves BOTH install points actually enforce on the real, fully-composed app; this one exists ' +
    'only to catch a route silently moving off (or onto) registerWriteSurface\'s own scope.', async () => {
    const real = buildRealApp();
    const { app: gated, keys: gatedKeys } = buildGatedScopeApp();
    await real.ready();
    await gated.ready();
    const realKeys = new Set(registeredRoutesOf(real).map((r) => `${r.method} ${r.url}`));
    const outsideWriteSurfaceScope = ROUTE_AUTHORITY
      .filter((entry) => realKeys.has(routeKey(entry)))     // only judge routes that actually exist today
      .filter((entry) => !gatedKeys.has(routeKey(entry)))
      .map(routeKey)
      .sort();
    // PINNED, not aspirational: RED ON REVERT if a route moves scope without a matching update here —
    // this is NOT a live gate-coverage gap (see the functional test below for that proof), only a map of
    // which install point reaches which route. Do not "fix" this list by widening it silently.
    expect(outsideWriteSurfaceScope).toEqual([
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

/**
 * Functional proof, over the SAME real, fully-composed app `buildApp` produces (both scopes, both
 * `requireAuthority` install points), that the gate actually intercepts requests — not just that the
 * table classifies every route (the "covers the real app" describe above) or that one scope's routes are
 * mapped (the test just above). Before T3 installed the SECOND hook in `index.ts`, every route the
 * previous test lists — including this SIGNED `DELETE /api/schedules/:id` — reached its handler with no
 * authority check at all; a request with no `approval` would have hit the real schedule store instead of
 * refusing at the gate. RED ON REVERT: remove either `requireAuthority` install hook (surface.ts or
 * index.ts) and the two 403 assertions below start seeing a different status from the real handler.
 */
describe('requireAuthority actually reaches routes on both scopes of the real app', () => {
  const SESSION: SessionConfig = { secret: Buffer.from('policy-reach-test-secret-32bytes'), ttlMs: 60_000 };
  // `makeSurfaceContext` resolves `humanApproverAllowedSigners` from this env var (surface.ts has no
  // override seam threaded through `BuildAppOptions` — production only ever reads it from the real
  // process env, so the test does the same). Absent, every signed route would 503 approval-unavailable
  // before ever reaching the approval-required check this suite is proving.
  const PRIOR_ALLOWED_SIGNERS = process.env.DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS;
  beforeEach(() => { process.env.DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS = '/etc/kb/test-allowed-signers'; });
  afterAll(() => {
    if (PRIOR_ALLOWED_SIGNERS === undefined) delete process.env.DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS;
    else process.env.DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS = PRIOR_ALLOWED_SIGNERS;
  });

  function buildAuthedRealApp(): { app: FastifyInstance; token: string } {
    const app = buildApp({
      repoRoot: REPO_A,
      sessionConfig: SESSION,
      allowedOrigins: TEST_ORIGINS,
      validateData: false,
      controlStore: createInMemoryControlPlaneStore(),
    });
    openApps.push(app);
    return { app, token: mintSession('operator', SESSION).token };
  }

  it('refuses a signed route on the FORMERLY-ungated sibling scope with no approval — 403 approval-required', async () => {
    const { app, token } = buildAuthedRealApp();
    await app.ready();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/schedules/schedule-does-not-exist',
      headers: { origin: TEST_ORIGINS[0], authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'approval-required' });
  });

  it('refuses a second signed route on that same sibling scope (an inbox deployment action) with no approval', async () => {
    const { app, token } = buildAuthedRealApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbox/deployment/deployment-does-not-exist/deploy',
      headers: { origin: TEST_ORIGINS[0], authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'approval-required' });
  });

  it('lets an OPEN route on that same sibling scope reach its own handler, not an authority refusal', async () => {
    const { app, token } = buildAuthedRealApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/schedules/schedule-does-not-exist/arm',
      headers: { origin: TEST_ORIGINS[0], authorization: `Bearer ${token}` },
      payload: {},
    });
    // Whatever the handler decides about a nonexistent schedule is its own business — the only thing
    // under test is that the AUTHORITY layer never produced this response.
    const body = res.json() as { error?: unknown };
    expect(res.statusCode).not.toBe(503);
    if (res.statusCode === 403) {
      expect(['route-unclassified', 'route-unavailable', 'approval-required', 'approval-invalid']).not.toContain(body.error);
    }
  });
});

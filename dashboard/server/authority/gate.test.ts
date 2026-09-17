import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceContext } from '../http/context.ts';
import type { RouteAuthority } from './policy.ts';
import { canonicalApprovalPayload } from './approval.ts';

const NOW = Date.parse('2026-09-16T19:40:00Z');
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A tiny classification table over the throwaway `/t/*` routes this suite registers, standing in for
 *  the real `policy.ts#ROUTE_AUTHORITY` — the gate must be class-agnostic, so any table shape proves
 *  the same behavior. */
const TABLE: Record<string, RouteAuthority> = {
  'POST /t/open': { method: 'POST', path: '/t/open', cls: 'open', entityParam: null },
  'POST /t/signed/:id': { method: 'POST', path: '/t/signed/:id', cls: 'signed', entityParam: 'id' },
  'POST /t/none': { method: 'POST', path: '/t/none', cls: 'none', entityParam: null },
};

vi.mock('./policy.ts', () => ({
  classifyRoute: (method: string, path: string) => TABLE[`${method.toUpperCase()} ${path}`] ?? null,
  routeKey: (entry: { method: string; path: string }) => `${entry.method} ${entry.path}`,
}));

// vitest hoists `vi.mock` calls above every import in this file, so `gate.ts`'s own
// `import { classifyRoute, routeKey } from './policy.ts'` resolves to the stub table above, not the
// real ~60-row production table.
import { approvedNonceFor, requireAuthority } from './gate.ts';

function goodApproval(route: string, entityRef: string, over: Record<string, unknown> = {}) {
  return {
    payload: canonicalApprovalPayload({
      schema: 'kb.human-approval/v1',
      route,
      entityRef,
      actor: 'daniel',
      issuedAt: iso(NOW),
      expiresAt: iso(NOW + 600_000),
      nonce: 'a'.repeat(32),
      ...over,
    } as never),
    signature: 'sig',
  };
}

interface Harness {
  ctx: SurfaceContext;
  auditRows: Array<Record<string, unknown>>;
}

function makeHarness(overrides: Partial<SurfaceContext> = {}): Harness {
  const auditRows: Array<Record<string, unknown>> = [];
  const ctx = {
    repoRoot: 'C:/repo',
    stateRoot: 'C:/state',
    humanApproverAllowedSigners: '/etc/kb/allowed',
    sshsigVerifier: { verify: async () => true },
    approvalNonces: { claim: () => 'fresh' as const },
    now: () => new Date(NOW),
    appendAudit: (_repoRoot: string, event: Record<string, unknown>) => {
      auditRows.push(event);
      return { ts: 'now', ...event };
    },
    ...overrides,
  } as unknown as SurfaceContext;
  return { ctx, auditRows };
}

describe('requireAuthority', () => {
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); });

  function mount(ctx: SurfaceContext): void {
    app = Fastify();
    app.addHook('preHandler', requireAuthority(ctx));
    app.get('/t/open', async () => ({ ok: true }));
    app.post('/t/open', async () => ({ ok: true }));
    app.post('/t/signed/:id', async (req) => ({ ok: true, nonce: approvedNonceFor(req) }));
    app.post('/t/none', async () => ({ ok: true }));
    app.post('/t/mystery', async () => ({ ok: true })); // not in TABLE at all
  }

  it('passes a GET through with no classification at all', async () => {
    const { ctx } = makeHarness();
    mount(ctx);
    const res = await app.inject({ method: 'GET', url: '/t/open' });
    expect(res.statusCode).toBe(200);
  });

  it('lets an open-class route run the handler', async () => {
    const { ctx, auditRows } = makeHarness();
    mount(ctx);
    const res = await app.inject({ method: 'POST', url: '/t/open', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(auditRows).toEqual([]);
  });

  it('refuses an unclassified route 403 route-unclassified', async () => {
    const { ctx, auditRows } = makeHarness();
    mount(ctx);
    const res = await app.inject({ method: 'POST', url: '/t/mystery', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'route-unclassified' });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ action: 'authority-approval-refused', result: 'route-unclassified' });
  });

  it('refuses a none-class route 403 route-unavailable', async () => {
    const { ctx, auditRows } = makeHarness();
    mount(ctx);
    const res = await app.inject({ method: 'POST', url: '/t/none', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'route-unavailable' });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ action: 'authority-approval-refused', result: 'route-unavailable' });
  });

  it('refuses a signed route with no approval 403 approval-required', async () => {
    const { ctx, auditRows } = makeHarness();
    mount(ctx);
    const res = await app.inject({ method: 'POST', url: '/t/signed/entity-1', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'approval-required' });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'authority-approval-refused',
      result: 'approval-required',
      detail: { route: '/t/signed/:id', entityRef: 'entity-1' },
    });
  });

  it('lets a signed route with a good approval run the handler, and audits nothing', async () => {
    const { ctx, auditRows } = makeHarness();
    mount(ctx);
    const res = await app.inject({
      method: 'POST',
      url: '/t/signed/entity-1',
      payload: { approval: goodApproval('POST /t/signed/:id', 'entity-1') },
    });
    expect(res.statusCode).toBe(200);
    expect(auditRows).toEqual([]);
  });

  it('exposes the verified approval nonce to the route handler via approvedNonceFor, keyed off the request', async () => {
    const { ctx } = makeHarness();
    mount(ctx);
    const res = await app.inject({
      method: 'POST',
      url: '/t/signed/entity-1',
      payload: { approval: goodApproval('POST /t/signed/:id', 'entity-1') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, nonce: 'a'.repeat(32) });
  });

  it('refuses a signed route whose approval names a different route, and never logs payload/signature', async () => {
    const { ctx, auditRows } = makeHarness();
    mount(ctx);
    const res = await app.inject({
      method: 'POST',
      url: '/t/signed/entity-1',
      payload: { approval: goodApproval('POST /t/signed/:id', 'entity-2') },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'approval-invalid' });
    expect(auditRows).toHaveLength(1);
    const serialized = JSON.stringify(auditRows[0]);
    expect(serialized).not.toContain('payload');
    expect(serialized).not.toContain('signature');
    expect(serialized).not.toContain('BEGIN SSH SIGNATURE');
  });

  it('an unconfigured channel refuses a signed route 503 approval-unavailable', async () => {
    const { ctx, auditRows } = makeHarness({ humanApproverAllowedSigners: '' });
    mount(ctx);
    const res = await app.inject({
      method: 'POST',
      url: '/t/signed/entity-1',
      payload: { approval: goodApproval('POST /t/signed/:id', 'entity-1') },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'approval-unavailable' });
    expect(auditRows).toHaveLength(1);
  });

  it('a refusal still lands when the audit append itself throws', async () => {
    const { ctx } = makeHarness({
      appendAudit: () => { throw new Error('audit unavailable'); },
    });
    mount(ctx);
    const res = await app.inject({ method: 'POST', url: '/t/mystery', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'route-unclassified' });
  });
});

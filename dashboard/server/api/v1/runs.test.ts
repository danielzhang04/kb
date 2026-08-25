// P6 W6.1 §6 — GET /api/v1/runs/:runRef (operator read). kind:'run', meta.etag = run:<runRef>:<version>;
// it is also the SAMPLE operator route under the shared /api/v1/runs/** prefix that proves the peer-uid
// split (operator-route-only) in routes.test.ts. This suite pins the read contract + auth.
import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireSession } from '../../http/middleware.ts';
import { mintSession, type SessionConfig } from '../../auth/session.ts';
import { originPlugin } from '../../security/origin.ts';
import type { SurfaceContext } from '../../http/context.ts';
import { registerV1OperatorReadRoutes, type ReadRunResult } from './routes.ts';
import { opCtx, operatorApp, operatorBearer as opBearer } from './_nodeHarness.ts';
import { encodeCursor } from './cursor.ts';
import type { RunReadPort } from '../../services/runReadService.ts';

const HOST = '127.0.0.1:4317';
const ALLOWED = ['http://127.0.0.1:4317'];
const SESSION: SessionConfig = { secret: Buffer.alloc(32, 5), ttlMs: 600_000 };
const bearer = () => `Bearer ${mintSession('operator', SESSION).token}`;

function app(readRun: (subject: string, runRef: string) => ReadRunResult): FastifyInstance {
  const ctx = { allowedOrigins: ALLOWED, sessionConfig: SESSION, nodeProxyUid: undefined, v1: { readRun } } as unknown as SurfaceContext;
  const instance = Fastify({ logger: false });
  instance.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('preHandler', requireSession(ctx.sessionConfig));
    registerV1OperatorReadRoutes(scope, ctx);
  });
  return instance;
}

describe('GET /api/v1/runs/:runRef', () => {
  it('200 kind:run with meta.etag = run:<runRef>:<version> and only etag in meta', async () => {
    const res = await app(() => ({ ok: true, version: 12, data: { runRef: 'run-abc', title: 'Build' } }))
      .inject({ method: 'GET', url: '/api/v1/runs/run-abc', headers: { host: HOST, authorization: bearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.apiVersion).toBe('v1');
    expect(body.kind).toBe('run');
    expect(body.data.title).toBe('Build');
    expect(body.meta).toEqual({ etag: 'run:run-abc:12' });
  });

  it('401 without an operator session', async () => {
    const res = await app(() => ({ ok: true, version: 1, data: {} }))
      .inject({ method: 'GET', url: '/api/v1/runs/run-1', headers: { host: HOST } });
    expect(res.statusCode).toBe(401);
  });

  it('404 when the run is not readable in scope', async () => {
    const res = await app(() => ({ ok: false, status: 404 }))
      .inject({ method: 'GET', url: '/api/v1/runs/run-x', headers: { host: HOST, authorization: bearer() } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('not-found');
  });
});

const SECRET = Buffer.alloc(32, 3);
function listPort(): RunReadPort {
  return {
    listRuns: () => [{ runRef: 'run-1' }],
    getRun: () => ({ ok: true, value: {} }),
    statusOf: () => 404,
    lifecycleKind: () => 'active',
    workflowRefIndex: () => new Map(),
    runDto: (r) => r as never,
    runDisplay: (d) => d,
    runDetailDto: () => ({}),
    executionPosture: () => ({}),
    async replayEvents() { return { revision: 'r' }; },
  };
}

describe('GET /api/v1/runs — list + signed opaque cursor [§3.4:209, P6-C41]', () => {
  const ctx = () => opCtx({ runReadPort: listPort(), runListWatermark: () => 'wm-1', cursorSecret: SECRET });

  it('200 kind:run-list with a watermark and a fresh nextCursor', async () => {
    const res = await operatorApp(ctx(), 'reads').inject({ method: 'GET', url: '/api/v1/runs', headers: { host: HOST, authorization: opBearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('run-list');
    expect(body.meta.watermark).toBe('wm-1');
    expect(typeof body.meta.nextCursor).toBe('string');
  });

  it('409 cursor-stale when the cursor watermark has moved', async () => {
    const staleCursor = encodeCursor({ kind: 'run-list', watermark: 'wm-OLD', filterHash: '', lastKey: '' }, SECRET);
    const res = await operatorApp(ctx(), 'reads').inject({ method: 'GET', url: `/api/v1/runs?cursor=${encodeURIComponent(staleCursor)}`, headers: { host: HOST, authorization: opBearer() } });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('cursor-stale');
  });

  it('400 cursor-malformed on a hand-edited cursor', async () => {
    const res = await operatorApp(ctx(), 'reads').inject({ method: 'GET', url: '/api/v1/runs?cursor=not.a.cursor', headers: { host: HOST, authorization: opBearer() } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('cursor-malformed');
  });

  it('accepts a fresh cursor (round-tripped) and returns 200', async () => {
    const fresh = encodeCursor({ kind: 'run-list', watermark: 'wm-1', filterHash: '', lastKey: 'run-1' }, SECRET);
    const res = await operatorApp(ctx(), 'reads').inject({ method: 'GET', url: `/api/v1/runs?cursor=${encodeURIComponent(fresh)}`, headers: { host: HOST, authorization: opBearer() } });
    expect(res.statusCode).toBe(200);
  });
});

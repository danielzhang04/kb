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

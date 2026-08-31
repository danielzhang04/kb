// P6 W6.1 checkpoint bullet 5 — POST /api/v1/runs calls `services/launchService.ts` and NOTHING else, and
// maps its `{status, body}` outcome matrix into the v1 envelope. Because the old-route launch
// (`POST /api/workflows/:id/launch`) calls the SAME `launchService`, parity is structural: this suite pins
// that the v1 route delegates to it with the right input and maps every outcome branch verbatim.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireSession } from '../../http/middleware.ts';
import { mintSession, type SessionConfig } from '../../auth/session.ts';
import { originPlugin } from '../../security/origin.ts';
import type { SurfaceContext } from '../../http/context.ts';
import type { LaunchServiceInput } from '../../services/launchService.ts';
import type { LaunchOutcome } from '../../control/launch.ts';

// The route calls `launchService(port, input)`; mock it so we can drive each outcome branch and assert the
// route calls it exactly once with the exact input it built from the request.
const launchServiceMock = vi.fn<(port: unknown, input: LaunchServiceInput) => Promise<LaunchOutcome>>();
vi.mock('../../services/launchService.ts', () => ({
  launchService: (port: unknown, input: LaunchServiceInput) => launchServiceMock(port, input),
}));

// Import AFTER the mock is declared.
const { registerV1OperatorMutationRoutes } = await import('./routes.ts');

const HOST = '127.0.0.1:4317';
const ALLOWED = ['http://127.0.0.1:4317'];
const SESSION: SessionConfig = { secret: Buffer.alloc(32, 9), ttlMs: 600_000 };
const bearer = () => `Bearer ${mintSession('operator', SESSION).token}`;

function ctxWith(launchPort: unknown): SurfaceContext {
  return {
    allowedOrigins: ALLOWED,
    sessionConfig: SESSION,
    nodeProxyUid: undefined,
    v1: { launchPort },
  } as unknown as SurfaceContext;
}

function buildApp(ctx: SurfaceContext): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('preHandler', requireSession(ctx.sessionConfig));
    registerV1OperatorMutationRoutes(scope, ctx);
  });
  return app;
}

describe('POST /api/v1/runs — launchService delegation + parity', () => {
  beforeEach(() => launchServiceMock.mockReset());

  it('503 when the launch port is unavailable (fail-closed, never a silent bypass)', async () => {
    const res = await buildApp(ctxWith(undefined)).inject({
      method: 'POST', url: '/api/v1/runs', headers: { host: HOST, authorization: bearer() }, payload: { workflowId: 'wf-1' },
    });
    expect(res.statusCode).toBe(503);
    expect(launchServiceMock).not.toHaveBeenCalled();
  });

  it('400 when no workflowId is present — the wall is hit before launchService is called', async () => {
    const res = await buildApp(ctxWith({})).inject({
      method: 'POST', url: '/api/v1/runs', headers: { host: HOST, authorization: bearer() }, payload: { parameters: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(launchServiceMock).not.toHaveBeenCalled();
  });

  it('calls launchService ONCE with {subject, sessionToken, id, body-minus-workflowId} and maps a success outcome to kind:run', async () => {
    launchServiceMock.mockResolvedValue({ status: 201, body: { runRef: 'run-77', owner: { kind: 'workflow', id: 'wf-1' } } });
    const res = await buildApp(ctxWith({ tag: 'port' })).inject({
      method: 'POST', url: '/api/v1/runs', headers: { host: HOST, authorization: bearer() },
      payload: { workflowId: 'wf-1', idempotencyKey: 'idem-key-abcdef123456', parameters: { a: '1' } },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.apiVersion).toBe('v1');
    expect(body.kind).toBe('run');
    expect(body.data.runRef).toBe('run-77');
    expect(launchServiceMock).toHaveBeenCalledTimes(1);
    const [port, input] = launchServiceMock.mock.calls[0]!;
    expect(port).toEqual({ tag: 'port' }); // the injected launch port, and nothing else
    expect(input.subject).toBe('operator');
    expect(input.id).toBe('wf-1');
    expect(typeof input.sessionToken).toBe('string');
    expect(input.body).toEqual({ idempotencyKey: 'idem-key-abcdef123456', parameters: { a: '1' } }); // workflowId stripped
  });

  it('maps a refusal outcome (409 no-complete-placement) to a v1 error with the same status/code', async () => {
    launchServiceMock.mockResolvedValue({ status: 409, body: { error: 'no-complete-placement' } });
    const res = await buildApp(ctxWith({})).inject({
      method: 'POST', url: '/api/v1/runs', headers: { host: HOST, authorization: bearer() }, payload: { workflowId: 'wf-1' },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.apiVersion).toBe('v1');
    expect(body.error.code).toBe('no-complete-placement');
  });

  it('maps a 412 owner-changed refusal verbatim', async () => {
    launchServiceMock.mockResolvedValue({ status: 412, body: { error: 'owner-changed' } });
    const res = await buildApp(ctxWith({})).inject({
      method: 'POST', url: '/api/v1/runs', headers: { host: HOST, authorization: bearer() }, payload: { workflowId: 'wf-1' },
    });
    expect(res.statusCode).toBe(412);
    expect(JSON.parse(res.body).error.code).toBe('owner-changed');
  });
});

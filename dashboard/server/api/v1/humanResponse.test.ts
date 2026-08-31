// P6 W6.1 §6/§3.6 — POST /api/v1/runs/:runRef/human-requests/:requestRef/respond over
// services/runReadService.ts. The operator human-response route; a node/host peer can NEVER reach it — the
// operator-route-only peer guard is the §3.6 host-response ban in practice (a host cannot respond).
import { describe, expect, it } from 'vitest';
import { opCtx, operatorApp, opHeaders, HOST, operatorBearer, NODE_PROXY_UID } from './_nodeHarness.ts';
import type { RespondPort, RespondResult } from '../../services/runReadService.ts';

function port(result: RespondResult): RespondPort {
  return { async respond() { return result; } };
}

const okBody = { decision: 'approved', expectedRevision: 3, idempotencyKey: 'resp-key-1', response: null };

describe('POST .../human-requests/:requestRef/respond', () => {
  it('200 kind:human-response on an accepted response', async () => {
    const res = await operatorApp(opCtx({ respondPort: port({ ok: true, status: 200, value: { resolved: true } }) }), 'mutations')
      .inject({ method: 'POST', url: '/api/v1/runs/run-1/human-requests/hr-1/respond', headers: opHeaders(), payload: okBody });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).kind).toBe('human-response');
  });

  it('maps a ceremony-unavailable refusal (T3 no-downgrade) verbatim', async () => {
    const res = await operatorApp(opCtx({ respondPort: port({ ok: false, status: 403, error: 'ceremony-unavailable' }) }), 'mutations')
      .inject({ method: 'POST', url: '/api/v1/runs/run-1/human-requests/hr-1/respond', headers: opHeaders(), payload: okBody });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('ceremony-unavailable');
  });

  it('400 on an invalid decision (closed body wall)', async () => {
    const res = await operatorApp(opCtx({ respondPort: port({ ok: true, status: 200 }) }), 'mutations')
      .inject({ method: 'POST', url: '/api/v1/runs/run-1/human-requests/hr-1/respond', headers: opHeaders(), payload: { ...okBody, decision: 'sneak' } });
    expect(res.statusCode).toBe(400);
  });

  it('SECURITY §3.6: the node/host peer cannot respond — 403 operator-route-only', async () => {
    const res = await operatorApp(opCtx({ respondPort: port({ ok: true, status: 200 }) }, NODE_PROXY_UID), 'mutations')
      .inject({ method: 'POST', url: '/api/v1/runs/run-1/human-requests/hr-1/respond', headers: opHeaders(), payload: okBody });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('operator-route-only');
  });

  it('400 idempotency-key-required without the header', async () => {
    const res = await operatorApp(opCtx({ respondPort: port({ ok: true, status: 200 }) }), 'mutations')
      .inject({ method: 'POST', url: '/api/v1/runs/run-1/human-requests/hr-1/respond', headers: { host: HOST, authorization: operatorBearer() }, payload: okBody });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('idempotency-key-required');
  });
});

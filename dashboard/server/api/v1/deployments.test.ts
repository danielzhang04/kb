// P6 W6.1 §6 — /api/v1/deployments. The T3 arm (confirm/deploy/abort/close-ptys) is fail-closed 403
// ceremony-unavailable WITHOUT a passkey ceremony assertion (the shipped ceremonyId+assertion vocabulary,
// no new vocabulary); acknowledge is a non-T3 transition; inspect is a read.
import { describe, expect, it } from 'vitest';
import { opCtx, operatorApp, opHeaders, HOST, operatorBearer } from './_nodeHarness.ts';
import type { DeploymentActionPort } from './routes.ts';

function port(over: Partial<DeploymentActionPort> = {}): DeploymentActionPort {
  return {
    inspect: () => ({ status: 200, etag: '"deployment:d-1:4"', body: { ref: 'd-1', state: 'awaiting-confirm' } }),
    async transition() { return { status: 200, etag: '"deployment:d-1:5"', body: { ok: true } }; },
    ...over,
  };
}

const assertion = { ceremonyId: 'cer-1', assertion: { id: 'x' } };

describe('deployment T3 arm — fail-closed ceremony', () => {
  for (const action of ['confirm', 'deploy', 'abort', 'close-ptys-and-continue']) {
    it(`${action} WITHOUT an assertion -> 403 ceremony-unavailable`, async () => {
      const res = await operatorApp(opCtx({ deploymentPort: port() }), 'mutations').inject({ method: 'POST', url: `/api/v1/deployments/d-1/${action}`, headers: opHeaders(), payload: { note: 'x' } });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('ceremony-unavailable');
    });

    it(`${action} WITH an assertion -> 200 kind:deployment`, async () => {
      const res = await operatorApp(opCtx({ deploymentPort: port() }), 'mutations').inject({ method: 'POST', url: `/api/v1/deployments/d-1/${action}`, headers: opHeaders(), payload: assertion });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).kind).toBe('deployment');
    });
  }
});

describe('deployment acknowledge + inspect', () => {
  it('acknowledge is a non-T3 transition -> 200 without an assertion', async () => {
    const res = await operatorApp(opCtx({ deploymentPort: port() }), 'mutations').inject({ method: 'POST', url: '/api/v1/deployments/d-1/acknowledge', headers: opHeaders(), payload: {} });
    expect(res.statusCode).toBe(200);
  });

  it('inspect (read scope) is read-only kind:deployment', async () => {
    const res = await operatorApp(opCtx({ deploymentPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/deployments/d-1/inspect', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).kind).toBe('deployment');
  });

  it('confirm 400 idempotency-key-required without the header', async () => {
    const res = await operatorApp(opCtx({ deploymentPort: port() }), 'mutations').inject({ method: 'POST', url: '/api/v1/deployments/d-1/confirm', headers: { host: HOST, authorization: operatorBearer() }, payload: assertion });
    expect(res.statusCode).toBe(400);
  });
});

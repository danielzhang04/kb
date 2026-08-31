// P6 W6.1 §6 — /api/v1/asset-pulls. pull/retry transitions (Idempotency-Key required) + read-only inspect.
import { describe, expect, it } from 'vitest';
import { opCtx, operatorApp, opHeaders, HOST, operatorBearer } from './_nodeHarness.ts';
import type { AssetPullActionPort } from './routes.ts';

function port(over: Partial<AssetPullActionPort> = {}): AssetPullActionPort {
  return {
    inspect: () => ({ status: 200, etag: '"asset-pull:i-1:2"', body: { intentRef: 'i-1', state: 'ready' } }),
    async transition() { return { status: 200, etag: '"asset-pull:i-1:3"', body: { ok: true } }; },
    ...over,
  };
}

describe('POST /api/v1/asset-pulls/:intentRef/(pull|retry)', () => {
  for (const action of ['pull', 'retry']) {
    it(`${action} -> 200 kind:asset-pull`, async () => {
      const res = await operatorApp(opCtx({ assetPullPort: port() }), 'mutations').inject({ method: 'POST', url: `/api/v1/asset-pulls/i-1/${action}`, headers: opHeaders(), payload: { manifestDigest: 'a'.repeat(64) } });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).kind).toBe('asset-pull');
    });
  }

  it('maps a 409 digest-mismatch refusal verbatim', async () => {
    const p = port({ async transition() { return { status: 409, body: { error: 'digest-mismatch' } }; } });
    const res = await operatorApp(opCtx({ assetPullPort: p }), 'mutations').inject({ method: 'POST', url: '/api/v1/asset-pulls/i-1/pull', headers: opHeaders(), payload: { manifestDigest: 'b'.repeat(64) } });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('digest-mismatch');
  });

  it('inspect (read scope) is read-only kind:asset-pull', async () => {
    const res = await operatorApp(opCtx({ assetPullPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/asset-pulls/i-1/inspect', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).kind).toBe('asset-pull');
  });

  it('400 idempotency-key-required without the header', async () => {
    const res = await operatorApp(opCtx({ assetPullPort: port() }), 'mutations').inject({ method: 'POST', url: '/api/v1/asset-pulls/i-1/pull', headers: { host: HOST, authorization: operatorBearer() }, payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

// P6 W6.1 §6 — GET /api/v1/inbox over services/inboxService.ts. kind:'inbox'; a run gate in the payload is
// a test failure (the inbox is PR/Deployment/AssetPull/card only). Bad ?refresh= -> 400 bad-refresh.
import { describe, expect, it } from 'vitest';
import { opCtx, operatorApp, HOST, operatorBearer } from './_nodeHarness.ts';
import type { InboxServicePort } from '../../services/inboxService.ts';

function port(over: Partial<InboxServicePort> = {}): InboxServicePort {
  return {
    invalidatePr() { /* record */ },
    invalidateBudget() { /* record */ },
    async readInbox() { return { prs: [], deployments: [], assetPulls: [], cards: [] }; },
    ...over,
  };
}

describe('GET /api/v1/inbox', () => {
  it('200 kind:inbox with the four-source payload and no run gate', async () => {
    const res = await operatorApp(opCtx({ inboxPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/inbox', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('inbox');
    expect(body.data).not.toHaveProperty('runGates');
  });

  it('invalidates only the named source on ?refresh=pr', async () => {
    let prInvalidated = false;
    const res = await operatorApp(opCtx({ inboxPort: port({ invalidatePr() { prInvalidated = true; } }) }), 'reads').inject({ method: 'GET', url: '/api/v1/inbox?refresh=pr', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    expect(prInvalidated).toBe(true);
  });

  it('400 bad-refresh on an unknown refresh value', async () => {
    const res = await operatorApp(opCtx({ inboxPort: port() }), 'reads').inject({ method: 'GET', url: '/api/v1/inbox?refresh=nonsense', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('bad-refresh');
  });
});

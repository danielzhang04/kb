// P6 W6.1 §6 — /api/v1/agents (list/detail reads + builder create/update) over services/entityService.ts.
// Reads carry meta.watermark (list) / meta.etag (detail) + 304; mutations require the Idempotency-Key
// header (§3.4); operator scope refuses the node-proxy peer 403 operator-route-only.
import { describe, expect, it } from 'vitest';
import { opCtx, operatorApp, opHeaders, HOST, operatorBearer, NODE_PROXY_UID } from './_nodeHarness.ts';
import type { AgentDetailPort, EntityListPort, SubmitBuilderPort } from '../../services/entityService.ts';

const listPort: EntityListPort = { list: () => ({ revision: 'rev-1', agents: [{ id: 'a' }] }) };
const detailPort: AgentDetailPort = {
  declaration: (id) => (id === 'a' ? { id } : undefined),
  detail: () => ({ revision: 'src-hash-1', humanName: 'Agent A' }),
  problem: () => undefined,
};
const submit: SubmitBuilderPort = async () => ({ ok: true, status: 'accepted' });

describe('GET /api/v1/agents', () => {
  it('200 kind:agent-list with meta.watermark', async () => {
    const res = await operatorApp(opCtx({ agentListPort: listPort }), 'reads').inject({ method: 'GET', url: '/api/v1/agents', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('agent-list');
    expect(body.meta).toEqual({ watermark: 'rev-1' });
  });

  it('304 when If-None-Match matches', async () => {
    const res = await operatorApp(opCtx({ agentListPort: listPort }), 'reads').inject({ method: 'GET', url: '/api/v1/agents', headers: { host: HOST, authorization: operatorBearer(), 'if-none-match': '"rev-1"' } });
    expect(res.statusCode).toBe(304);
  });

  it('401 without a session', async () => {
    const res = await operatorApp(opCtx({ agentListPort: listPort }), 'reads').inject({ method: 'GET', url: '/api/v1/agents', headers: { host: HOST } });
    expect(res.statusCode).toBe(401);
  });

  it('SECURITY: 403 operator-route-only from the node-proxy peer', async () => {
    const res = await operatorApp(opCtx({ agentListPort: listPort }, NODE_PROXY_UID), 'reads').inject({ method: 'GET', url: '/api/v1/agents', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('operator-route-only');
  });
});

describe('GET /api/v1/agents/:id', () => {
  it('200 kind:agent with meta.etag = source hash', async () => {
    const res = await operatorApp(opCtx({ agentDetailPort: detailPort }), 'reads').inject({ method: 'GET', url: '/api/v1/agents/a', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('agent');
    expect(body.meta).toEqual({ etag: 'src-hash-1' });
  });

  it('404 for an unknown id', async () => {
    const res = await operatorApp(opCtx({ agentDetailPort: detailPort }), 'reads').inject({ method: 'GET', url: '/api/v1/agents/zzz', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST/PUT /api/v1/agents — builder mutations', () => {
  const createBody = { humanName: 'A', purpose: 'p', model: 'm', profile: 'pr', tools: [], skills: [], connectors: [], filesystemRoots: [], selector: { type: 'agent', id: 'a' }, project: 'proj', expectedCollectionRevision: 'rev-1', idempotencyKey: 'k' };

  it('202 on a well-formed create', async () => {
    const res = await operatorApp(opCtx({ submitAgent: submit }), 'mutations').inject({ method: 'POST', url: '/api/v1/agents', headers: opHeaders(), payload: createBody });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).kind).toBe('agent');
  });

  it('400 idempotency-key-required when the Idempotency-Key header is absent', async () => {
    const res = await operatorApp(opCtx({ submitAgent: submit }), 'mutations').inject({ method: 'POST', url: '/api/v1/agents', headers: { host: HOST, authorization: operatorBearer() }, payload: createBody });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('idempotency-key-required');
  });

  it('PUT 404 for an unknown agent', async () => {
    const updateBody = { humanName: 'A', purpose: 'p', model: 'm', profile: 'pr', tools: [], skills: [], connectors: [], filesystemRoots: [], expectedSourceRevision: 'rev-1', idempotencyKey: 'k' };
    const res = await operatorApp(opCtx({ submitAgent: submit, agentDeclarationFor: () => undefined, agentFirstProject: () => 'proj' }), 'mutations').inject({ method: 'PUT', url: '/api/v1/agents/a', headers: opHeaders(), payload: updateBody });
    expect(res.statusCode).toBe(404);
  });
});

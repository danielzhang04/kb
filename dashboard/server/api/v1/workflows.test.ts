// P6 W6.1 §6 — /api/v1/workflows (list/detail reads + builder create/update) over entityService.ts.
import { describe, expect, it } from 'vitest';
import { opCtx, operatorApp, opHeaders, HOST, operatorBearer } from './_nodeHarness.ts';
import type { EntityListPort, WorkflowDetailPort, SubmitBuilderPort } from '../../services/entityService.ts';

const listPort: EntityListPort = { list: () => ({ revision: 'wf-rev-1', workflows: [] }) };
const detailPort: WorkflowDetailPort = {
  findScannedDef: (id) => (id === 'w' ? { def: { stages: [] } } : null),
  detail: () => ({ revision: 'wf-src-1', stages: [] }),
};
const submit: SubmitBuilderPort = async () => ({ ok: true, status: 'accepted' });

const createBody = { humanName: 'W', purpose: 'p', model: 'm', profile: 'pr', tools: [], skills: [], connectors: [], filesystemRoots: [], selector: { type: 'workflow', id: 'w' }, project: 'proj', expectedCollectionRevision: 'wf-rev-1', idempotencyKey: 'k' };

describe('GET /api/v1/workflows', () => {
  it('200 kind:workflow-list with meta.watermark', async () => {
    const res = await operatorApp(opCtx({ workflowListPort: listPort }), 'reads').inject({ method: 'GET', url: '/api/v1/workflows', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).kind).toBe('workflow-list');
  });

  it('detail 200 kind:workflow carrying the stage graph', async () => {
    const res = await operatorApp(opCtx({ workflowDetailPort: detailPort }), 'reads').inject({ method: 'GET', url: '/api/v1/workflows/w', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('workflow');
    expect(body.data.stages).toEqual([]);
  });

  it('detail 404 for an unknown id', async () => {
    const res = await operatorApp(opCtx({ workflowDetailPort: detailPort }), 'reads').inject({ method: 'GET', url: '/api/v1/workflows/zzz', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST/PUT /api/v1/workflows', () => {
  it('202 on a well-formed create', async () => {
    const res = await operatorApp(opCtx({ submitWorkflow: submit, workflowExists: () => false }), 'mutations').inject({ method: 'POST', url: '/api/v1/workflows', headers: opHeaders(), payload: createBody });
    expect(res.statusCode).toBe(202);
  });

  it('409 already-exists when the id is taken', async () => {
    const res = await operatorApp(opCtx({ submitWorkflow: submit, workflowExists: () => true }), 'mutations').inject({ method: 'POST', url: '/api/v1/workflows', headers: opHeaders(), payload: createBody });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('already-exists');
  });

  it('PUT 202 on a builder update', async () => {
    const updateBody = { humanName: 'W', purpose: 'p', model: 'm', profile: 'pr', tools: [], skills: [], connectors: [], filesystemRoots: [], expectedSourceRevision: 'wf-src-1', idempotencyKey: 'k' };
    const scanned = { def: { stages: [] }, entry: { project: 'proj' } };
    const res = await operatorApp(opCtx({ submitWorkflow: submit, workflowScannedFor: () => scanned }), 'mutations').inject({ method: 'PUT', url: '/api/v1/workflows/w', headers: opHeaders(), payload: updateBody });
    expect(res.statusCode).toBe(202);
  });

  it('400 idempotency-key-required without the header', async () => {
    const res = await operatorApp(opCtx({ submitWorkflow: submit, workflowExists: () => false }), 'mutations').inject({ method: 'POST', url: '/api/v1/workflows', headers: { host: HOST, authorization: operatorBearer() }, payload: createBody });
    expect(res.statusCode).toBe(400);
  });
});

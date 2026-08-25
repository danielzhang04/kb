// P6 W2 — characterization of the agent/workflow entity handlers' extracted service: the list/detail
// ETag-304 + 404/422 reads, the closed builder body walls + submit → 202 / builderError mapping, and the
// amend `withOpsTransaction` path (P6-C80) — its pre-guards, the CAS span, and the post-audit branches.

import { describe, expect, it, vi } from 'vitest';
import {
  amendWorkflowDefinition, builderError, createAgent, createWorkflow, readAgentDetail, readEntityList,
  readWorkflowDetail, updateAgent, updateWorkflowBuilder,
  type AmendPort, type AmendPrepared, type AmendScanned, type AmendSpec, type SubmitBuilderPort,
} from './entityService.ts';

const FIELDS = { humanName: 'H', purpose: 'P', model: 'm', profile: 'p', tools: [], skills: [], connectors: [], filesystemRoots: [] };

class BuilderFailure extends Error { constructor(readonly status: number, message: string) { super(message); } }

describe('entityService reads', () => {
  it('returns 200 + ETag then 304 on a list read', () => {
    const port = { list: () => ({ revision: 'r1', kind: 'agent' as const }) };
    expect(readEntityList(port, undefined)).toEqual({ status: 200, etag: '"r1"', body: { revision: 'r1', kind: 'agent' } });
    expect(readEntityList(port, '"r1"')).toEqual({ status: 304, etag: '"r1"' });
  });

  it('agent detail: detail, else 422 problem, else 404', () => {
    const detail = vi.fn(() => ({ revision: 'd1' }));
    const found = readAgentDetail({ declaration: () => ({ id: 'a' }), detail, problem: () => undefined }, 'a', undefined);
    expect(found).toEqual({ status: 200, etag: '"d1"', body: { revision: 'd1' } });
    const invalid = readAgentDetail({ declaration: () => undefined, detail, problem: () => ({ why: 'bad' }) }, 'a', undefined);
    expect(invalid).toEqual({ status: 422, body: { error: 'agent-declaration-invalid', declaration: { why: 'bad' } } });
    const missing = readAgentDetail({ declaration: () => undefined, detail, problem: () => undefined }, 'a', undefined);
    expect(missing).toEqual({ status: 404, body: { error: 'not-found' } });
  });

  it('workflow detail: 404 unknown, 422 unparsed, else detail', () => {
    const detail = vi.fn(() => ({ revision: 'w1' }));
    expect(readWorkflowDetail({ findScannedDef: () => null, detail }, 'w', undefined)).toEqual({ status: 404, body: { error: 'not-found' } });
    expect(readWorkflowDetail({ findScannedDef: () => ({ def: null }), detail }, 'w', undefined)).toEqual({ status: 422, body: { error: 'workflow-definition-invalid' } });
    expect(readWorkflowDetail({ findScannedDef: () => ({ def: {} }), detail }, 'w', undefined).status).toBe(200);
  });
});

describe('entityService builderError mapping', () => {
  it('maps a *BuilderFailure to its own status, idempotency-body-conflict to 409, else 400', () => {
    expect(builderError(new BuilderFailure(409, 'stale-source-revision'))).toEqual({ status: 409, body: { error: 'stale-source-revision' } });
    expect(builderError(new Error('idempotency-body-conflict'))).toEqual({ status: 409, body: { error: 'idempotency-body-conflict' } });
    expect(builderError(new Error('invalid-builder-request'))).toEqual({ status: 400, body: { error: 'invalid-builder-request' } });
  });
});

describe('entityService builder writes', () => {
  const submit: SubmitBuilderPort = vi.fn(async () => ({ ok: true, status: 'pending-human-merge' }));

  it('agent create: closed body, project-required, then 202', async () => {
    expect((await createAgent(submit, { ...FIELDS, selector: { type: 'agent', id: 'a' }, project: 'kb-ops', expectedCollectionRevision: 'r', idempotencyKey: 'k' })).status).toBe(202);
    expect((await createAgent(submit, { ...FIELDS, selector: { type: 'agent', id: 'a' }, project: 'kb-ops', expectedCollectionRevision: 'r', idempotencyKey: 'k', extra: 1 })).body).toEqual({ error: 'invalid-agent-create-body' });
    expect((await createAgent(submit, { ...FIELDS, selector: { type: 'agent', id: 'a' }, project: '', expectedCollectionRevision: 'r', idempotencyKey: 'k' })).body).toEqual({ error: 'project-required' });
  });

  it('agent update: closed body, 404 unknown, then 202', async () => {
    expect((await updateAgent(submit, { id: 'a' }, 'a', { ...FIELDS, expectedSourceRevision: 'h', idempotencyKey: 'k' }, 'kb-ops')).status).toBe(202);
    expect((await updateAgent(submit, undefined, 'a', { ...FIELDS, expectedSourceRevision: 'h', idempotencyKey: 'k' }, 'kb-ops')).body).toEqual({ error: 'not-found' });
    expect((await updateAgent(submit, { id: 'a' }, 'a', { ...FIELDS, expectedSourceRevision: 'h', idempotencyKey: 'k', junk: 1 }, 'kb-ops')).body).toEqual({ error: 'invalid-agent-update-body' });
  });

  it('workflow create: closed body, selector shape, already-exists, then 202', async () => {
    const body = { ...FIELDS, selector: { type: 'workflow', id: 'w' }, project: 'kb-ops', expectedCollectionRevision: 'r', idempotencyKey: 'k' };
    expect((await createWorkflow(submit, body, () => false)).status).toBe(202);
    expect((await createWorkflow(submit, body, () => true)).body).toEqual({ error: 'already-exists' });
    expect((await createWorkflow(submit, { ...body, selector: { type: 'agent', id: 'w' } }, () => false)).body).toEqual({ error: 'invalid-runnable-selector' });
  });

  it('workflow update builder branch: 400 when no def or bad body, else 202', async () => {
    const good = { ...FIELDS, expectedSourceRevision: 'h', idempotencyKey: 'k' };
    expect((await updateWorkflowBuilder(submit, { def: {}, entry: { project: 'kb-ops' } }, 'w', good)).status).toBe(202);
    expect((await updateWorkflowBuilder(submit, { def: null, entry: { project: 'kb-ops' } }, 'w', good)).body).toEqual({ error: 'invalid-workflow-update-body' });
  });

  it('maps a thrown builder failure from submit', async () => {
    const failing: SubmitBuilderPort = async () => { throw new BuilderFailure(409, 'stale-collection-revision'); };
    const out = await createAgent(failing, { ...FIELDS, selector: { type: 'agent', id: 'a' }, project: 'kb-ops', expectedCollectionRevision: 'r', idempotencyKey: 'k' });
    expect(out).toEqual({ status: 409, body: { error: 'stale-collection-revision' } });
  });
});

describe('entityService amendWorkflowDefinition — the withOpsTransaction path', () => {
  const scanned: AmendScanned = { entry: { path: 'orgs/kb-ops/workflows/w.md', sourceHash: 'h', detail: 'd' }, def: {} };
  const spec: AmendSpec = {
    kind: 'assignment', expectedSourceHash: 'h', auditAction: 'workflow-assignment-amendment',
    auditDetail: (old, hash, durable) => ({ oldAssignment: old, proposalHash: hash, branch: durable.branch }),
    successDetail: (_hash, durable) => ({ branch: durable.branch, pr: durable.pr }),
  };
  const preparedOk: AmendPrepared = { proposedSourceHash: 'p', proposalHash: 'ph', old: { a: 1 }, riskTier: 'T2', durable: { branch: 'work', pr: { url: 'u', number: 3 } } };

  function port(over: Partial<AmendPort> = {}): AmendPort {
    return {
      withOpsTransaction: vi.fn(async (fn: () => Promise<AmendPrepared>) => fn()),
      prepareAmendment: async () => preparedOk,
      durableWorktreeReady: true,
      auditAmendment: vi.fn(async () => {}),
      updateAmendmentRecord: vi.fn(),
      ...over,
    };
  }

  it('refuses before the transaction on definition-invalid / stale hash / no durable worktree', async () => {
    const withOpsTransaction = vi.fn();
    expect(await amendWorkflowDefinition(port({ withOpsTransaction }), 'op', { entry: scanned.entry, def: null }, spec)).toEqual({ status: 409, body: { error: 'definition-invalid', detail: 'd' } });
    expect(await amendWorkflowDefinition(port({ withOpsTransaction }), 'op', scanned, { ...spec, expectedSourceHash: 'other' })).toEqual({ status: 409, body: { error: 'stale-source-revision', sourceRevision: 'h' } });
    expect(await amendWorkflowDefinition(port({ withOpsTransaction, durableWorktreeReady: false }), 'op', scanned, spec)).toEqual({ status: 409, body: { error: 'durable-worktree-required' } });
    expect(withOpsTransaction).not.toHaveBeenCalled();
  });

  it('wraps the amendment CAS in withOpsTransaction and returns a short-circuit outcome verbatim', async () => {
    const withOpsTransaction = vi.fn(async (fn: () => Promise<AmendPrepared>) => fn());
    const outcome: AmendPrepared = { outcome: { status: 409, body: { error: 'assignment-no-change' } } };
    const out = await amendWorkflowDefinition(port({ withOpsTransaction, prepareAmendment: async () => outcome }), 'op', scanned, spec);
    expect(out).toEqual({ status: 409, body: { error: 'assignment-no-change' } });
    expect(withOpsTransaction).toHaveBeenCalledOnce();
  });

  it('returns 202 pending-human-merge after a successful prepare + audit + record update', async () => {
    const audit = vi.fn(async () => {});
    const update = vi.fn();
    const out = await amendWorkflowDefinition(port({ auditAmendment: audit, updateAmendmentRecord: update }), 'op', scanned, spec);
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ ok: true, status: 'pending-human-merge', replayed: false, path: scanned.entry.path, baseSourceHash: 'h', proposedSourceHash: 'p', proposalContentHash: 'ph', branch: 'work', pr: { url: 'u', number: 3 } });
    expect(audit).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ phase: 'pending-human-merge' }));
  });

  it('maps a thrown transaction to 500 *-durable-write-failed', async () => {
    const out = await amendWorkflowDefinition(port({ withOpsTransaction: async () => { throw new Error('boom'); } }), 'op', scanned, spec);
    expect(out).toEqual({ status: 500, body: { error: 'assignment-durable-write-failed', detail: 'boom' } });
  });

  it('on an audit failure records audit-failed and returns 500 amendment-audit-required', async () => {
    const update = vi.fn();
    const out = await amendWorkflowDefinition(port({ auditAmendment: async () => { throw new Error('audit down'); }, updateAmendmentRecord: update }), 'op', scanned, spec);
    expect(out.status).toBe(500);
    expect(out.body).toMatchObject({ auditStatus: 'failed', error: 'assignment-amendment-audit-required' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ phase: 'audit-failed' }));
  });
});

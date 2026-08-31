// P6 W2 — characterization of `POST /api/workflows/:id/launch`'s extracted service. Each test drives one
// branch of today's success + refusal matrix from injected ports, in the order the route enforces them,
// so a reordering or a dropped gate in a later cutover is a red test. No real I/O: every port is a fake.

import { describe, expect, it, vi } from 'vitest';
import { launchService, type LaunchServicePort, type LaunchServiceInput } from './launchService.ts';
import type { LaunchOutcome } from '../control/launch.ts';

// LaunchServicePort['runCasTransaction'] is generic (<T>(fn: () => Promise<T>) => Promise<T>); a
// vi.fn() mock closing over one concrete T can't satisfy that generic signature. This passthrough
// keeps the mock's spy behaviour (call recording, toHaveBeenCalled*) while presenting the port's
// real generic type. `onSpan` lets a test observe entry/exit of the transaction span.
function opsTransactionMock(onSpan?: (inside: boolean) => void): LaunchServicePort['runCasTransaction'] {
  return vi.fn(async (fn: () => Promise<unknown>) => {
    onSpan?.(true);
    const result = await fn();
    onSpan?.(false);
    return result;
  }) as LaunchServicePort['runCasTransaction'];
}

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const PATH = 'orgs/kb-ops/workflows/demo.md';

function def(over: Record<string, unknown> = {}) {
  return { schemaVersion: 1, id: 'demo', project: 'kb-ops', title: 'Demo', profile: 'producer', readScope: [], stages: [], ...over } as never;
}

/** A port whose every gate passes; a test overrides only the field it is exercising. */
function happyPort(over: Partial<LaunchServicePort> = {}): LaunchServicePort {
  const launched: LaunchOutcome = { status: 202, body: { ok: true, launched: true } };
  return {
    admission: () => ({ ok: true }),
    findScannedDef: () => ({ entry: { path: PATH, sourceHash: HASH, detail: 'why' }, def: def() }),
    pendingAmendmentFor: () => ({ pending: null, error: null }),
    lookupAmendment: () => ({ ok: true, record: null }),
    readCanonicalDefinition: () => ({ bytes: Buffer.from('src'), path: PATH }),
    sourceHash: () => HASH,
    decodeUtf8: () => 'src',
    parseWorkflowDef: () => ({ ok: true, value: def() }) as never,
    instantiateWorkflowDef: () => ({ ok: true, value: def() }) as never,
    composerGet: () => ({ ok: true, workspace: { composerRef: 'c1', agent: { id: 'a1', path: 'agents/a1.md', sourceHash: 'h', projects: ['kb-ops'] } } }),
    declaredAgent: () => ({ source: 'agents/a1.md', sourceHash: 'h' }),
    runtimeExecutionHost: () => 'vm',
    runCasTransaction: async (fn) => fn(),
    launchDefinition: async () => launched,
    ...over,
  };
}

const base: LaunchServiceInput = { subject: 'operator', sessionToken: 'tok', id: 'demo', body: { idempotencyKey: 'k'.repeat(16), expectedSourceRevision: HASH } };

describe('launchService ordering + refusal matrix', () => {
  it('refuses 401 when no authenticated subject, before any port is touched', async () => {
    const findScannedDef = vi.fn();
    const admission = vi.fn();
    const out = await launchService(happyPort({ findScannedDef, admission }), { ...base, subject: null });
    expect(out).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(admission).not.toHaveBeenCalled();
    expect(findScannedDef).not.toHaveBeenCalled();
  });

  it('refuses admission (503) before body validation', async () => {
    const findScannedDef = vi.fn();
    const out = await launchService(happyPort({ admission: () => ({ ok: false, status: 503, reason: 'outbox-degraded' }), findScannedDef }), { ...base, body: { junk: 1 } });
    expect(out).toEqual({ status: 503, body: { error: 'outbox-degraded' } });
    expect(findScannedDef).not.toHaveBeenCalled();
  });

  it('refuses 400 invalid-launch-body on any unknown key', async () => {
    const out = await launchService(happyPort(), { ...base, body: { idempotencyKey: 'k'.repeat(16), expectedSourceRevision: HASH, surprise: true } });
    expect(out).toEqual({ status: 400, body: { error: 'invalid-launch-body' } });
  });

  it('refuses 400 idempotency-key-required for empty or oversized key', async () => {
    const empty = await launchService(happyPort(), { ...base, body: { idempotencyKey: '  ', expectedSourceRevision: HASH } });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('idempotency-key-required');
    const big = await launchService(happyPort(), { ...base, body: { idempotencyKey: 'x'.repeat(513), expectedSourceRevision: HASH } });
    expect(big.body.error).toBe('idempotency-key-required');
  });

  it('refuses 404 not-found for an unknown workflow, after idempotency passes', async () => {
    const out = await launchService(happyPort({ findScannedDef: () => null }), base);
    expect(out).toEqual({ status: 404, body: { error: 'not-found' } });
  });

  it('refuses 409 definition-invalid when the scanned entry has no parsed def', async () => {
    const out = await launchService(happyPort({ findScannedDef: () => ({ entry: { path: PATH, sourceHash: HASH, detail: 'bad' }, def: null }) }), base);
    expect(out).toEqual({ status: 409, body: { error: 'definition-invalid', detail: 'bad' } });
  });

  it('refuses 400 source-revision-required for a non-64-hex revision', async () => {
    const out = await launchService(happyPort(), { ...base, body: { idempotencyKey: 'k'.repeat(16), expectedSourceRevision: 'short' } });
    expect(out).toEqual({ status: 400, body: { error: 'source-revision-required' } });
  });

  it('refuses 409 stale-source-revision when the presented hash disagrees', async () => {
    const out = await launchService(happyPort(), { ...base, body: { idempotencyKey: 'k'.repeat(16), expectedSourceRevision: OTHER_HASH } });
    expect(out).toEqual({ status: 409, body: { error: 'stale-source-revision', sourceRevision: HASH } });
  });

  it('refuses on a pending-amendment guard, before the transaction opens', async () => {
    const runCasTransaction = vi.fn();
    const invalid = await launchService(happyPort({ pendingAmendmentFor: () => ({ pending: null, error: 'x' }), runCasTransaction }), base);
    expect(invalid).toEqual({ status: 409, body: { error: 'assignment-amendment-state-invalid' } });
    const pending = await launchService(happyPort({ pendingAmendmentFor: () => ({ pending: { id: 'p' }, error: null }), runCasTransaction }), base);
    expect(pending).toEqual({ status: 409, body: { error: 'assignment-amendment-pending', pending: { id: 'p' } } });
    expect(runCasTransaction).not.toHaveBeenCalled();
  });

  it('refuses 400 invalid-launch-parameters when params are required but absent, or non-string', async () => {
    const missing = await launchService(happyPort({ findScannedDef: () => ({ entry: { path: PATH, sourceHash: HASH }, def: def({ parameters: [{ name: 'x' }] }) }) }), base);
    expect(missing).toEqual({ status: 400, body: { error: 'invalid-launch-parameters' } });
    const nonString = await launchService(happyPort(), { ...base, body: { idempotencyKey: 'k'.repeat(16), expectedSourceRevision: HASH, parameters: { a: 3 } } });
    expect(nonString).toEqual({ status: 400, body: { error: 'invalid-launch-parameters' } });
  });

  it('re-reads inside the transaction and refuses stale-source-revision on a mid-flight change', async () => {
    const out = await launchService(happyPort({ readCanonicalDefinition: () => ({ bytes: Buffer.from('x'), path: PATH }), sourceHash: () => OTHER_HASH }), base);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe('stale-source-revision');
    expect(out.body.sourceRevision).toBe(OTHER_HASH);
  });

  it('refuses 409 definition-changed when the re-parse identity drifts', async () => {
    const out = await launchService(happyPort({ parseWorkflowDef: () => ({ ok: true, value: def({ id: 'other' }) }) as never }), base);
    expect(out).toEqual({ status: 409, body: { error: 'definition-changed' } });
  });

  it('refuses 404/409/403 on the composer binding branches', async () => {
    const notFound = await launchService(happyPort({ composerGet: () => ({ ok: false }) }), { ...base, body: { ...base.body as object, composerRef: 'c1' } });
    expect(notFound).toEqual({ status: 404, body: { error: 'agent-workspace-not-found' } });
    const unbound = await launchService(happyPort({ composerGet: () => ({ ok: true, workspace: { composerRef: 'c1', agent: null } }) }), { ...base, body: { ...base.body as object, composerRef: 'c1' } });
    expect(unbound).toEqual({ status: 409, body: { error: 'agent-workspace-unbound' } });
    const wrongProject = await launchService(happyPort({ composerGet: () => ({ ok: true, workspace: { composerRef: 'c1', agent: { id: 'a1', path: 'agents/a1.md', sourceHash: 'h', projects: ['other'] } } }) }), { ...base, body: { ...base.body as object, composerRef: 'c1' } });
    expect(wrongProject).toEqual({ status: 403, body: { error: 'agent-workspace-project-refused' } });
    const ownerDrift = await launchService(happyPort({ declaredAgent: () => ({ source: 'agents/a1.md', sourceHash: 'DIFFERENT' }) }), { ...base, body: { ...base.body as object, composerRef: 'c1' } });
    expect(ownerDrift).toEqual({ status: 409, body: { error: 'runnable-owner-required' } });
  });

  it('reaches launchDefinition with the constructed owner + executionHost, inside the ops transaction', async () => {
    const launchDefinition = vi.fn<LaunchServicePort['launchDefinition']>(
      async () => ({ status: 202, body: { ok: true, runRef: 'r1' } }) as LaunchOutcome,
    );
    let insideTxn = false;
    const runCasTransaction = opsTransactionMock((inside) => { insideTxn = inside; });
    const out = await launchService(happyPort({ launchDefinition, runCasTransaction }), base);
    expect(out).toEqual({ status: 202, body: { ok: true, runRef: 'r1' } });
    expect(runCasTransaction).toHaveBeenCalledOnce();
    const [sub, token, , key, provenance, identity] = launchDefinition.mock.calls[0];
    expect(sub).toBe('operator');
    expect(token).toBe('tok');
    expect(key).toBe('k'.repeat(16));
    expect(provenance).toBeNull();
    expect(identity).toEqual({ owner: { type: 'workflow', id: 'demo', project: 'kb-ops', sourcePath: PATH }, executionHost: 'vm' });
    expect(insideTxn).toBe(false); // resolved after the span closed
  });
});

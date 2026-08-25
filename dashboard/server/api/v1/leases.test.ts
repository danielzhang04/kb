// P6 W6.1 §6 — POST /api/v1/hosts/:hostId/leases/claim (long-poll) and POST /api/v1/runs/:runRef/leases/
// renew. Node auth; claim is server-chosen with an atomic CAS (204 on timeout); renew is CAS'd on
// expectedLeaseRevision with the wrong-host / lease-expired / capability-lost ladder [§3.5, §6].
import { describe, expect, it } from 'vitest';
import { nodeApp, nodeCtx, nodeHeaders, lease } from './_nodeHarness.ts';
import type { LeaseStorePort, ClaimClock } from '../../placement/leaseService.ts';

const NOW = '2026-08-25T00:00:00.000Z';
const clock: ClaimClock = { now: () => Date.parse(NOW), async sleep() { /* no wall clock */ } };

function store(over: Partial<LeaseStorePort> = {}): LeaseStorePort {
  return {
    async releaseExpiredLeases() { return []; },
    async selectCandidate() { return undefined; },
    async createLease(runRef, hostId, capabilityHash) { return lease({ runRef, hostId, capabilityHash }); },
    async getLease() { return lease(); },
    async renewLease(runRef, expected) { return lease({ runRef, revision: expected + 1 }); },
    async currentAdvertisedCapabilityHash() { return undefined; },
    ...over,
  };
}

describe('POST /api/v1/hosts/:hostId/leases/claim', () => {
  it('204 when nothing matches within waitMs', async () => {
    const ctx = nodeCtx({ v1: { leaseStore: store(), claimClock: clock } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/hosts/vm/leases/claim', headers: nodeHeaders(), payload: { waitMs: 0 } });
    expect(res.statusCode).toBe(204);
  });

  it('200 kind:lease with the server-chosen run', async () => {
    const ctx = nodeCtx({ v1: { leaseStore: store({ async selectCandidate() { return { runRef: 'run-9', capabilityHash: 'b'.repeat(64) }; } }), claimClock: clock } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/hosts/vm/leases/claim', headers: nodeHeaders(), payload: { waitMs: 0 } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('lease');
    expect(body.data.runRef).toBe('run-9');
    expect(body.meta.etag).toBe('lease:run-9:1');
  });

  it('400 unknown-key on a claim body with an extra field (the exact-key wall)', async () => {
    const ctx = nodeCtx({ v1: { leaseStore: store(), claimClock: clock } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/hosts/vm/leases/claim', headers: nodeHeaders(), payload: { waitMs: 0, sneaky: 1 } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('unknown-key');
  });
});

describe('POST /api/v1/runs/:runRef/leases/renew', () => {
  it('200 bumps the lease revision', async () => {
    const ctx = nodeCtx({ v1: { leaseStore: store() } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/leases/renew', headers: nodeHeaders(), payload: { expectedLeaseRevision: 1 } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.lease.revision).toBe(2);
  });

  it('403 wrong-host (lease theft) when the lease belongs to another host', async () => {
    const ctx = nodeCtx({ v1: { leaseStore: store({ async getLease() { return lease({ hostId: 'desktop' }); } }) } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/leases/renew', headers: nodeHeaders('nodeVM01'), payload: { expectedLeaseRevision: 1 } });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('wrong-host');
  });

  it('409 lease-expired past expiry', async () => {
    const ctx = nodeCtx({ v1: { leaseStore: store({ async getLease() { return lease({ expiresAt: '2020-01-01T00:00:00.000Z' }); } }) } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/leases/renew', headers: nodeHeaders(), payload: { expectedLeaseRevision: 1 } });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('lease-expired');
  });

  it('409 capability-lost when the advertisement no longer satisfies the lease hash', async () => {
    const ctx = nodeCtx({ v1: { leaseStore: store({
      async getLease() { return lease({ capabilityHash: 'c'.repeat(64) }); },
      async currentAdvertisedCapabilityHash() { return 'd'.repeat(64); },
    }) } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/leases/renew', headers: nodeHeaders(), payload: { expectedLeaseRevision: 1 } });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('capability-lost');
  });

  it('400 unknown-key when expectedLeaseRevision is missing', async () => {
    const ctx = nodeCtx({ v1: { leaseStore: store() } });
    const res = await nodeApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/leases/renew', headers: nodeHeaders(), payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

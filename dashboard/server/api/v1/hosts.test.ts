// P6 W6.1 §6 — PUT /api/v1/hosts/:hostId (advertise). Node auth, CAS on host:<hostId>:<version>, body is
// the HostAdvertisement minus hostId (the host comes ONLY from the map), 413 over any §3.1 bound, no
// Idempotency-Key [P6-C69]. See routes.test.ts for the peer-uid topology; this pins the advertise contract.
import { describe, expect, it } from 'vitest';
import { nodeApp, nodeCtx, nodeHeaders, advertisementBody } from './_nodeHarness.ts';
import type { AdvertiseStorePort } from './routes.ts';
import type { HostKind } from '../../placement/contracts.ts';

function memAdvertiseStore(): AdvertiseStorePort {
  const versions = new Map<HostKind, number>();
  return {
    async currentVersion(hostId) { return versions.get(hostId); },
    async upsert(hostId, _ad, expectedVersion) {
      const current = versions.get(hostId);
      if (current !== expectedVersion) return { ok: false, current: current ?? 0 };
      const next = (current ?? 0) + 1;
      versions.set(hostId, next);
      return { ok: true, version: next };
    },
  };
}

describe('PUT /api/v1/hosts/:hostId', () => {
  it('accepts a first advertisement (If-None-Match:*) and returns kind:host + host:vm:1', async () => {
    const ctx = nodeCtx({ v1: { advertiseStore: memAdvertiseStore() } });
    const res = await nodeApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: { ...nodeHeaders(), 'if-none-match': '*' }, payload: advertisementBody() });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('host');
    expect(body.meta.etag).toBe('host:vm:1');
    expect(body.data.hostId).toBe('vm'); // host id derived from the map, echoed in the body
  });

  it('a subsequent advertisement with the correct If-Match bumps to host:vm:2', async () => {
    const store = memAdvertiseStore();
    const ctx = nodeCtx({ v1: { advertiseStore: store } });
    await nodeApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: { ...nodeHeaders(), 'if-none-match': '*' }, payload: advertisementBody() });
    const res = await nodeApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: { ...nodeHeaders(), 'if-match': 'host:vm:1' }, payload: advertisementBody() });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).meta.etag).toBe('host:vm:2');
  });

  it('412 with the current etag when the presented If-Match is stale', async () => {
    const store = memAdvertiseStore();
    const ctx = nodeCtx({ v1: { advertiseStore: store } });
    await nodeApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: { ...nodeHeaders(), 'if-none-match': '*' }, payload: advertisementBody() });
    const res = await nodeApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: { ...nodeHeaders(), 'if-match': 'host:vm:99' }, payload: advertisementBody() });
    expect(res.statusCode).toBe(412);
    expect(JSON.parse(res.body).meta.currentEtag).toBe('host:vm:1');
  });

  it('413 on an over-bound advertisement', async () => {
    const ctx = nodeCtx({ v1: { advertiseStore: memAdvertiseStore() } });
    const huge = { ...advertisementBody(), skills: Array.from({ length: 999 }, (_, i) => `s-${i}`) };
    const res = await nodeApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: { ...nodeHeaders(), 'if-none-match': '*' }, payload: huge });
    expect(res.statusCode).toBe(413);
  });

  it('403 wrong-host when :hostId disagrees with the map-derived host', async () => {
    const ctx = nodeCtx({ v1: { advertiseStore: memAdvertiseStore() } });
    const res = await nodeApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: { ...nodeHeaders('nodeVM01'), 'if-none-match': '*' }, payload: advertisementBody() });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('wrong-host');
  });
});

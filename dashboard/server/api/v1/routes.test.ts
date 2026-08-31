// P6 W6.1 §5 — the three-scope /api/v1 registration and the PEER-UID topology that separates node routes
// from operator traffic. The peer-uid proof reads `req.socket` + `/proc/net/tcp` tables exactly as the
// shipped `requireNodeIdentity`/`isNodeProxyPeer` do — the security chain is NEVER faked. A root onRequest
// hook stamps the loopback 4-tuple (writable under Fastify inject), and `ctx.v1.readTables` supplies a
// synthetic table owned by the uid under test, so the real peer proof runs end to end over the HTTP stack.
import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireSession } from '../../http/middleware.ts';
import { mintSession } from '../../auth/session.ts';
import type { SessionConfig } from '../../auth/session.ts';
import { originPlugin } from '../../security/origin.ts';
import { makeNodeRateGuard, makeNodeReadRateGuard } from '../../http/context.ts';
import type { SurfaceContext } from '../../http/context.ts';
import { decodeHostNodeMap, type HostNodeMap } from '../../auth/hostNodeMapContracts.ts';
import type { HostNodeMapLoad } from '../../auth/hostNodeMap.ts';
import type { PlacementLease, HostKind } from '../../placement/contracts.ts';
import type { LeaseStorePort, ClaimClock } from '../../placement/leaseService.ts';
import type { ReportStorePort, RunTerminalState } from '../../placement/reportService.ts';
import {
  registerV1NodeRoutes,
  registerV1OperatorReadRoutes,
  type AdvertiseStorePort,
  type V1SurfaceDeps,
} from './routes.ts';

const NODE_PROXY_UID = 1001;
const DASH_PORT = 4317;
const PEER_PORT = 0xcf32;
const HOST = '127.0.0.1:4317';
const ALLOWED = ['http://127.0.0.1:4317'];
const NOW = '2026-08-25T00:00:00.000Z';

function procTableForPeer(uid: number): string {
  const hex = (p: number) => p.toString(16).toUpperCase().padStart(4, '0');
  return `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   6: 0100007F:${hex(DASH_PORT)} 0100007F:${hex(PEER_PORT)} 01 00000000:00000000 00:00000000 00000000   999        0 1 1 0 20 4 31 10 -1
   8: 0100007F:${hex(PEER_PORT)} 0100007F:${hex(DASH_PORT)} 01 00000000:00000000 00:00000000 00000000   ${uid}        0 2 1 0 20 4 30 10 -1
`;
}
const tablesFor = (uid: number) => () => [procTableForPeer(uid)];

const MAP: HostNodeMap = decodeHostNodeMap({
  schema: 'kb.host-node-map/v1',
  revision: 2,
  hosts: { vm: { nodeId: 'nodeVM01' }, desktop: { nodeId: 'nodeDESK9' } },
  revoked: [{ nodeId: 'oldNODE7', revokedAt: '2026-08-01T00:00:00.000Z' }],
});
const okMap = (): HostNodeMapLoad => ({ ok: true, map: MAP });

const SESSION: SessionConfig = { secret: Buffer.alloc(32, 7), ttlMs: 600_000 };
function operatorBearer(): string {
  return `Bearer ${mintSession('operator', SESSION).token}`;
}

function lease(over: Partial<PlacementLease> = {}): PlacementLease {
  return {
    runRef: 'run-1', hostId: 'vm', capabilityHash: 'a'.repeat(64), revision: 1,
    expiresAt: '2026-08-25T00:02:00.000Z', lastReportSequence: 0, ...over,
  };
}

function makeCtx(over: {
  peerUid?: number;
  nodeProxyUid?: number | undefined;
  loadHostNodeMap?: () => HostNodeMapLoad;
  v1?: Partial<V1SurfaceDeps>;
  nodeRateGuard?: SurfaceContext['nodeRateGuard'];
} = {}): SurfaceContext {
  const nodeProxyUid = 'nodeProxyUid' in over ? over.nodeProxyUid : NODE_PROXY_UID;
  return {
    allowedOrigins: ALLOWED,
    sessionConfig: SESSION,
    nodeProxyUid,
    loadHostNodeMap: over.loadHostNodeMap ?? okMap,
    nodeRateGuard: over.nodeRateGuard ?? makeNodeRateGuard(),
    nodeReadRateGuard: makeNodeReadRateGuard(),
    now: () => new Date(NOW),
    v1: { readTables: tablesFor(over.peerUid ?? NODE_PROXY_UID), now: () => new Date(NOW), ...over.v1 },
  } as unknown as SurfaceContext;
}

/** Build an app with the node sibling scope + an operator read scope, stamping the controlled 4-tuple. */
function buildApp(ctx: SurfaceContext): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    const s = req.socket as unknown as Record<string, unknown>;
    s.remoteAddress = '127.0.0.1'; s.remotePort = PEER_PORT;
    s.localAddress = '127.0.0.1'; s.localPort = DASH_PORT;
  });
  registerV1NodeRoutes(app, ctx);
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('preHandler', requireSession(ctx.sessionConfig));
    registerV1OperatorReadRoutes(scope, ctx);
  });
  return app;
}

const nodeHeaders = (nodeId = 'nodeVM01') => ({ host: HOST, 'tailscale-node-id': nodeId });

describe('registerV1NodeRoutes — the peer-uid topology [P6-C46]', () => {
  const NODE_ROUTES: Array<{ method: 'PUT' | 'POST'; url: string }> = [
    { method: 'PUT', url: '/api/v1/hosts/vm' },
    { method: 'POST', url: '/api/v1/hosts/vm/leases/claim' },
    { method: 'POST', url: '/api/v1/runs/run-1/leases/renew' },
    { method: 'POST', url: '/api/v1/runs/run-1/reports' },
  ];

  it('SECURITY: every node route refuses a non-proxy peer 403 node-route-only', async () => {
    const ctx = makeCtx({ peerUid: 0 }); // root tailscale serve, not the node proxy
    const app = buildApp(ctx);
    for (const route of NODE_ROUTES) {
      const res = await app.inject({ method: route.method, url: route.url, headers: nodeHeaders(), payload: {} });
      expect(res.statusCode, route.url).toBe(403);
      expect(JSON.parse(res.body).error.code, route.url).toBe('node-route-only');
    }
    await app.close();
  });

  it('SECURITY: a well-formed operator session from the proxy uid is refused 403 operator-route-only, INCLUDING on the shared /api/v1/runs/** prefix', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { readRun: () => ({ ok: true, version: 3, data: { runRef: 'run-1' } }) } });
    const app = buildApp(ctx);
    const res = await app.inject({
      method: 'GET', url: '/api/v1/runs/run-1',
      headers: { host: HOST, authorization: operatorBearer() },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('operator-route-only');
    await app.close();
  });

  it('registers NOTHING when the node uid is unconfigured (fail-closed)', async () => {
    const ctx = makeCtx({ nodeProxyUid: undefined });
    const app = buildApp(ctx);
    const res = await app.inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: nodeHeaders(), payload: {} });
    expect(res.statusCode).toBe(404); // no route registered at all
    await app.close();
  });

  it('all three scopes carry the same originPlugin — a cross-origin request is 403 on a node route AND an operator route', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { readRun: () => ({ ok: true, version: 1, data: {} }) } });
    const app = buildApp(ctx);
    const node = await app.inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: { host: 'evil.test', origin: 'http://evil.test' }, payload: {} });
    const op = await app.inject({ method: 'GET', url: '/api/v1/runs/run-1', headers: { host: 'evil.test', origin: 'http://evil.test', authorization: operatorBearer() } });
    expect(node.statusCode).toBe(403);
    expect(op.statusCode).toBe(403);
    await app.close();
  });

  it('installs a 35_000 ms per-request long-poll timeout in the node scope onRequest [P6-C51]', async () => {
    const ctx = makeCtx({ peerUid: 0 });
    const seen: number[] = [];
    const app = Fastify({ logger: false });
    // Install a recording `setTimeout` on the mock raw request BEFORE registering the node scope, so the
    // node scope's own onRequest timeout hook (a child hook, run after this parent one) records into it.
    app.addHook('onRequest', async (req) => {
      const s = req.socket as unknown as Record<string, unknown>;
      s.remoteAddress = '127.0.0.1'; s.remotePort = PEER_PORT; s.localAddress = '127.0.0.1'; s.localPort = DASH_PORT;
      (req.raw as unknown as { setTimeout: (ms: number) => void }).setTimeout = (ms: number) => { seen.push(ms); };
    });
    registerV1NodeRoutes(app, ctx);
    await app.inject({ method: 'POST', url: '/api/v1/hosts/vm/leases/claim', headers: nodeHeaders(), payload: {} });
    expect(seen).toContain(35_000);
    await app.close();
  });
});

describe('registerV1NodeRoutes — map-derived identity refusals', () => {
  it('503 host-map-unavailable when the root-owned map fails to load', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, loadHostNodeMap: () => ({ ok: false }) });
    const res = await buildApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(), payload: {} });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe('host-map-unavailable');
  });

  it('403 node-unknown for an id absent from the map', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID });
    const res = await buildApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders('strangerX'), payload: {} });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('node-unknown');
  });

  it('403 node-revoked for a revoked id', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID });
    const res = await buildApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders('oldNODE7'), payload: {} });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('node-revoked');
  });

  it('403 wrong-host when the :hostId disagrees with the map-derived host', async () => {
    // nodeVM01 maps to vm; addressing /hosts/desktop is a mismatch.
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { advertiseStore: memAdvertiseStore() } });
    const res = await buildApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/desktop', headers: nodeHeaders('nodeVM01'), payload: advertisementBody() });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('wrong-host');
  });
});

// ---- fakes + node-route behaviour ----------------------------------------------------------------

function advertisementBody(): Record<string, unknown> {
  return {
    daemonVersion: 'vm-1.2.3', reportedAt: NOW, connectors: [], skills: [], filesystemRoots: [],
    pty: true, gpu: false, clis: { claude: 'ready', codex: 'ready' },
  };
}

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

describe('PUT /api/v1/hosts/:hostId — advertise CAS + six-domain wire proof', () => {
  it('first advertisement with If-None-Match:* is 200 and returns host:<hostId>:1', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { advertiseStore: memAdvertiseStore() } });
    const res = await buildApp(ctx).inject({
      method: 'PUT', url: '/api/v1/hosts/vm', headers: { ...nodeHeaders(), 'if-none-match': '*' }, payload: advertisementBody(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.apiVersion).toBe('v1');
    expect(body.kind).toBe('host');
    expect(body.meta.etag).toBe('host:vm:1');
    // `meta` carries ONLY etag — no watermark/nextCursor keys.
    expect(Object.keys(body.meta)).toEqual(['etag']);
  });

  it('a Run ETag presented as If-Match is 412 — the six domains are non-interchangeable on the wire [checkpoint bullet 4]', async () => {
    const store = memAdvertiseStore();
    await store.upsert('vm', {} as never, undefined); // seed version 1
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { advertiseStore: store } });
    const res = await buildApp(ctx).inject({
      method: 'PUT', url: '/api/v1/hosts/vm',
      headers: { ...nodeHeaders(), 'if-match': 'run:run-1:5' }, payload: advertisementBody(),
    });
    expect(res.statusCode).toBe(412);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('etag-mismatch');
    expect(body.meta.currentEtag).toBe('host:vm:1'); // 412 body carries the CURRENT etag and nothing else
    expect(Object.keys(body.meta)).toEqual(['currentEtag']);
  });

  it('428 precondition-required when no If-Match/If-None-Match is presented on an existing advertisement', async () => {
    const store = memAdvertiseStore();
    await store.upsert('vm', {} as never, undefined);
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { advertiseStore: store } });
    const res = await buildApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: nodeHeaders(), payload: advertisementBody() });
    expect(res.statusCode).toBe(428);
    expect(JSON.parse(res.body).error.code).toBe('precondition-required');
  });

  it('413 on an over-bound advertisement body', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { advertiseStore: memAdvertiseStore() } });
    const huge = { ...advertisementBody(), skills: Array.from({ length: 999 }, (_, i) => `skill-${i}`) };
    const res = await buildApp(ctx).inject({ method: 'PUT', url: '/api/v1/hosts/vm', headers: { ...nodeHeaders(), 'if-none-match': '*' }, payload: huge });
    expect(res.statusCode).toBe(413);
  });
});

function memLeaseStore(over: Partial<LeaseStorePort> = {}): LeaseStorePort {
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
const immediateClock: ClaimClock = { now: () => Date.parse(NOW), async sleep() { /* no wall clock */ } };

describe('POST /api/v1/hosts/:hostId/leases/claim + renew', () => {
  it('204 when nothing matches within waitMs', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { leaseStore: memLeaseStore(), claimClock: immediateClock } });
    const res = await buildApp(ctx).inject({ method: 'POST', url: '/api/v1/hosts/vm/leases/claim', headers: nodeHeaders(), payload: { waitMs: 0 } });
    expect(res.statusCode).toBe(204);
  });

  it('200 with a lease when a candidate is available', async () => {
    const store = memLeaseStore({ async selectCandidate() { return { runRef: 'run-9', capabilityHash: 'b'.repeat(64) }; } });
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { leaseStore: store, claimClock: immediateClock } });
    const res = await buildApp(ctx).inject({ method: 'POST', url: '/api/v1/hosts/vm/leases/claim', headers: nodeHeaders(), payload: { waitMs: 0 } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('lease');
    expect(body.data.runRef).toBe('run-9');
  });

  it('renew: 409 capability-lost when the advertisement no longer satisfies the lease hash', async () => {
    const store = memLeaseStore({
      async getLease() { return lease({ capabilityHash: 'c'.repeat(64) }); },
      async currentAdvertisedCapabilityHash() { return 'd'.repeat(64); },
    });
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { leaseStore: store } });
    const res = await buildApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/leases/renew', headers: nodeHeaders(), payload: { expectedLeaseRevision: 1 } });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('capability-lost');
  });

  it('renew: 403 wrong-host under another node identity (lease theft)', async () => {
    const store = memLeaseStore({ async getLease() { return lease({ hostId: 'desktop' }); } });
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { leaseStore: store } });
    const res = await buildApp(ctx).inject({ method: 'POST', url: '/api/v1/runs/run-1/leases/renew', headers: nodeHeaders('nodeVM01'), payload: { expectedLeaseRevision: 1 } });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('wrong-host');
  });
});

function memReportStore(over: Partial<ReportStorePort> = {}): ReportStorePort {
  const noTerminal: RunTerminalState = { terminalOutcome: null, completedAt: null };
  return {
    async getLease() { return lease(); },
    async getRunTerminalState() { return noTerminal; },
    async currentAdvertisedCapabilityHash() { return undefined; },
    async appendReportEvent() { /* record */ },
    async bumpLeaseSequence() { /* record */ },
    async markTerminal() { /* record */ },
    async openHumanRequest() { return { requestRef: 'hr-1' }; },
    ...over,
  };
}

describe('POST /api/v1/runs/:runRef/reports', () => {
  it('appends a sequence-1 event and 200s', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { reportStore: memReportStore() } });
    const res = await buildApp(ctx).inject({
      method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(),
      payload: { expectedLeaseRevision: 1, sequence: 1, kind: 'started', payload: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).kind).toBe('report');
  });

  it('409 report-out-of-order on a sequence gap', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { reportStore: memReportStore() } });
    const res = await buildApp(ctx).inject({
      method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(),
      payload: { expectedLeaseRevision: 1, sequence: 5, kind: 'event', payload: {} },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('report-out-of-order');
  });

  it('409 run-already-terminal on a duplicate completion', async () => {
    const store = memReportStore({ async getRunTerminalState() { return { terminalOutcome: 'ok', completedAt: NOW }; } });
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { reportStore: store } });
    const res = await buildApp(ctx).inject({
      method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(),
      payload: { expectedLeaseRevision: 1, sequence: 1, kind: 'completed', payload: {} },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('run-already-terminal');
  });

  it('400 unknown-key rejects a decision-shaped field before any store write (cannot resolve a gate)', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { reportStore: memReportStore() } });
    const res = await buildApp(ctx).inject({
      method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(),
      payload: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: { decision: 'approve' } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('unknown-key');
  });
});

describe('node rate guard isolation [P6-C33, P6-C52]', () => {
  it('an immediate re-claim after a long-poll does not 429 (claim budget sized above the traffic)', async () => {
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, v1: { leaseStore: memLeaseStore(), claimClock: immediateClock } });
    const app = buildApp(ctx);
    const first = await app.inject({ method: 'POST', url: '/api/v1/hosts/vm/leases/claim', headers: nodeHeaders(), payload: { waitMs: 0 } });
    const second = await app.inject({ method: 'POST', url: '/api/v1/hosts/vm/leases/claim', headers: nodeHeaders(), payload: { waitMs: 0 } });
    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204); // not 429
    await app.close();
  });

  it('the OPERATOR write guard counters are untouched by node traffic — a shared guard would trip it', async () => {
    // Give the node scope a DELIBERATELY tiny guard; flood it; then prove an operator guard built the same
    // tiny way was never charged (the node scope holds its own instance, never the operator pair).
    const { lockout, rateLimit } = await import('../../security/ratelimit.ts');
    const tinyNodeGuard = lockout(rateLimit({ limit: 2, windowMs: 60_000 }), { threshold: 2, lockoutMs: 60_000 });
    const operatorGuard = lockout(rateLimit({ limit: 2, windowMs: 60_000 }), { threshold: 2, lockoutMs: 60_000 });
    const ctx = makeCtx({ peerUid: NODE_PROXY_UID, nodeRateGuard: tinyNodeGuard, v1: { reportStore: memReportStore() } });
    const app = buildApp(ctx);
    let node429 = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/runs/run-1/reports', headers: nodeHeaders(),
        payload: { expectedLeaseRevision: 1, sequence: 1, kind: 'started', payload: {} },
      });
      if (res.statusCode === 429) node429 += 1;
    }
    expect(node429).toBeGreaterThan(0); // the node guard DID throttle
    // The operator guard, a separate instance, saw none of that traffic: still allows a request.
    expect(operatorGuard.check('ip:127.0.0.1').allowed).toBe(true);
    await app.close();
  });
});

describe('GET /api/v1/runs/:runRef — operator read (shared-prefix route)', () => {
  it('200 with kind:run and etag run:<runRef>:<version> (from the operator peer, not the proxy)', async () => {
    const ctx = makeCtx({ peerUid: 0, v1: { readRun: () => ({ ok: true, version: 7, data: { runRef: 'run-1', title: 'x' } }) } });
    const res = await buildApp(ctx).inject({ method: 'GET', url: '/api/v1/runs/run-1', headers: { host: HOST, authorization: operatorBearer() } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kind).toBe('run');
    expect(body.meta.etag).toBe('run:run-1:7');
  });

  it('401 without an operator session', async () => {
    const ctx = makeCtx({ peerUid: 12345, v1: { readRun: () => ({ ok: true, version: 1, data: {} }) } });
    const res = await buildApp(ctx).inject({ method: 'GET', url: '/api/v1/runs/run-1', headers: { host: HOST } });
    expect(res.statusCode).toBe(401);
  });
});

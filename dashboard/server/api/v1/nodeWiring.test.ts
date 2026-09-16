// Unit 2 of the v1 desktop-execution lane: the boot-time node-identity decision. The three branches
// this file pins are the whole trust boundary of the unit — unconfigured stays OFF and BOOTS, a
// present-but-untrustworthy map REFUSES to boot, and only a valid pair arms the node scope.
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { makeNodeRateGuard, makeNodeReadRateGuard } from '../../http/context.ts';
import type { SurfaceContext } from '../../http/context.ts';
import type { HostNodeMapLoad } from '../../auth/hostNodeMap.ts';
import type { PlacementControlStore } from '../../placement/storeAdapters.ts';
import { NODE_PROXY_UID, nodeApp, nodeCtx, nodeHeaders, okMap } from './_nodeHarness.ts';
import { NODE_PROXY_UID_ENV, resolveNodeExecutionWiring } from './nodeWiring.ts';
import { registerV1NodeRoutes } from './routes.ts';

const MAP_PATH = '/etc/kb-dashboard/host-nodes.json';
const VALID_MAP: HostNodeMapLoad = {
  ok: true,
  map: {
    schema: 'kb.host-node-map/v1',
    revision: 7,
    hosts: { vm: { nodeId: 'nodevm00001' }, desktop: { nodeId: 'nodedesk0001' } },
    revoked: [],
  },
};

/** The adapters are lazy — they touch the store only when a port method is called — so `{}` is enough. */
const store = {} as PlacementControlStore;

function wiring(over: {
  env?: Record<string, string | undefined>;
  mapExists?: boolean;
  load?: (path: string) => HostNodeMapLoad;
} = {}) {
  return resolveNodeExecutionWiring({
    store,
    env: over.env ?? { [NODE_PROXY_UID_ENV]: '4317' },
    mapPath: MAP_PATH,
    mapExists: () => over.mapExists ?? true,
    load: over.load ?? (() => VALID_MAP),
  });
}

/** The minimal context `registerV1NodeRoutes` reads; anything else it never touches. */
function ctxFor(resolved: ReturnType<typeof wiring>): SurfaceContext {
  return {
    allowedOrigins: [],
    nodeRateGuard: makeNodeRateGuard(),
    nodeReadRateGuard: makeNodeReadRateGuard(),
    nodeProxyUid: resolved.nodeProxyUid,
    loadHostNodeMap: resolved.loadHostNodeMap,
    v1: resolved.v1,
  } as unknown as SurfaceContext;
}

async function registeredNodeRoutes(resolved: ReturnType<typeof wiring>): Promise<string[]> {
  const app = Fastify({ logger: false });
  const urls: string[] = [];
  app.addHook('onRoute', (route) => { urls.push(`${String(route.method)} ${route.url}`); });
  registerV1NodeRoutes(app, ctxFor(resolved));
  await app.ready();
  await app.close();
  return urls.filter((url) => url.includes('/api/v1/'));
}

describe('node execution wiring — the OFF branch must still boot', () => {
  it('is OFF, with a boot line, when the node proxy uid is unset', async () => {
    const resolved = wiring({ env: {} });

    expect(resolved.armed).toBe(false);
    expect(resolved.nodeProxyUid).toBeUndefined();
    expect(resolved.loadHostNodeMap).toBeUndefined();
    expect(resolved.v1).toBeUndefined();
    expect(resolved.bootLine).toContain(NODE_PROXY_UID_ENV);
    expect(await registeredNodeRoutes(resolved)).toEqual([]);
  });

  it('is OFF, not a crash, when the host-node map file is absent — today’s production VM', async () => {
    const resolved = wiring({ mapExists: false });

    expect(resolved.armed).toBe(false);
    expect(resolved.nodeProxyUid).toBeUndefined();
    expect(resolved.bootLine).toContain(MAP_PATH);
    expect(await registeredNodeRoutes(resolved)).toEqual([]);
  });
});

describe('node execution wiring — misconfiguration refuses to boot', () => {
  it('throws when the map is present but does not load, naming the path and no contents', () => {
    let call = 0;
    expect(() => wiring({ load: () => { call += 1; return { ok: false }; } }))
      .toThrow(/host-node map at \/etc\/kb-dashboard\/host-nodes\.json is present but unusable/);
    expect(call).toBe(1);
  });

  it.each([
    ['not a number', 'kb-node-proxy'],
    ['negative', '-1'],
    ['fractional', '4317.5'],
    ['root', '0'],
  ])('throws on a %s node proxy uid', (_label, raw) => {
    expect(() => wiring({ env: { [NODE_PROXY_UID_ENV]: raw } })).toThrow(new RegExp(NODE_PROXY_UID_ENV));
  });

  it('never leaks map contents into the refusal message', () => {
    try {
      wiring({ load: () => ({ ok: false }) });
      throw new Error('expected a refusal');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('nodevm00001');
      expect(message).not.toContain('nodedesk0001');
    }
  });
});

/**
 * The claim path's whole store surface, as the real adapters call it: a host that is beating NOW (the
 * ARMED branch supplies the REAL clock, so freshness is measured against wall time), one unplaced run,
 * and a CAS that records what it was asked to write.
 */
function claimableStore(): { store: PlacementControlStore; created: string[] } {
  const created: string[] = [];
  const fake = {
    listHostAdvertisements: () => [{
      // A second in the PAST: `isAdvertisementFresh` refuses a negative age, and the real clock this
      // branch wires can advance past a beat stamped in the same call.
      hostId: 'vm', daemonVersion: '1.0.0', reportedAt: new Date(Date.now() - 1_000).toISOString(),
      connectors: [], skills: [], filesystemRoots: [], pty: true, gpu: false,
      clis: { claude: 'ready', codex: 'ready' }, version: 1,
    }],
    releaseExpiredPlacementLeases: () => [],
    selectPlacementCandidateRunRef: () => 'run-desktop-1',
    createPlacementLease: (runRef: string, hostId: string, hash: string, nowMs: number) => {
      created.push(runRef);
      return {
        runRef, hostId, capabilityHash: hash, revision: 1, lastReportSequence: 0,
        expiresAt: new Date(nowMs + 120_000).toISOString(),
      };
    },
  };
  return { store: fake as unknown as PlacementControlStore, created };
}

describe('node execution wiring — the ARMED branch', () => {
  it('registers the node scope with the attested uid, a live loader, and real v1 ports', async () => {
    const resolved = wiring();

    expect(resolved.armed).toBe(true);
    expect(resolved.nodeProxyUid).toBe(4317);
    expect(resolved.bootLine).toContain('revision 7');
    expect(resolved.v1?.leaseStore).toBeDefined();
    expect(resolved.v1?.reportStore).toBeDefined();
    expect(resolved.v1?.advertiseStore).toBeDefined();

    const urls = await registeredNodeRoutes(resolved);
    expect(urls.some((url) => url.includes('/api/v1/hosts/:hostId/leases/claim'))).toBe(true);
    expect(urls.some((url) => url.includes('/api/v1/runs/:runRef/reports'))).toBe(true);
  });

  it('re-reads the map on every request rather than pinning the boot-time copy', () => {
    let reads = 0;
    const resolved = wiring({ load: () => { reads += 1; return VALID_MAP; } });
    expect(reads).toBe(1); // the boot probe

    resolved.loadHostNodeMap?.();
    resolved.loadHostNodeMap?.();

    expect(reads).toBe(3); // a revoked node stops being attributable without a restart
  });

  // Registering the URL is not the same as being able to answer on it. `routes.ts` refuses the claim
  // route `503 node-attribution-unavailable` whenever `ctx.v1.claimClock` is absent, so an ARMED branch
  // that built `V1SurfaceDeps` without a clock would mount a claim endpoint that 503s every request
  // — map valid, uid valid, store bound, and not one lease ever handed out.
  it('answers a REAL claim on the registered route, reaching the bound store', async () => {
    const { store: claimStore, created } = claimableStore();
    const resolved = resolveNodeExecutionWiring({
      store: claimStore,
      env: { [NODE_PROXY_UID_ENV]: String(NODE_PROXY_UID) },
      mapPath: MAP_PATH,
      mapExists: () => true,
      load: () => okMap(),
    });
    expect(resolved.armed).toBe(true);
    expect(resolved.nodeProxyUid).toBe(NODE_PROXY_UID); // the harness peer proof runs on the WIRED uid

    // The harness stamps the loopback 4-tuple and the synthetic /proc table, so the peer-uid proof and
    // the map lookup both run for real; only the ports come from the wiring under test.
    const app = nodeApp(nodeCtx({ v1: resolved.v1 ?? {}, loadHostNodeMap: resolved.loadHostNodeMap }));
    const res = await app.inject({
      method: 'POST', url: '/api/v1/hosts/vm/leases/claim',
      headers: nodeHeaders('nodeVM01'), payload: { waitMs: 0 },
    });

    expect(res.statusCode).toBe(200); // 503 here means the ARMED branch is mounted but inert
    const body = JSON.parse(res.body) as { kind: string; data: { runRef: string } };
    expect(body.kind).toBe('lease');
    expect(body.data.runRef).toBe('run-desktop-1');
    expect(created).toEqual(['run-desktop-1']); // it reached the STORE, not merely the router
  });

  it('leaves the node scope unregistered when the rate guards are missing, uid or not', async () => {
    const resolved = wiring();
    const app = Fastify({ logger: false });
    const urls: string[] = [];
    app.addHook('onRoute', (route) => { urls.push(route.url); });
    registerV1NodeRoutes(app, {
      ...ctxFor(resolved),
      nodeRateGuard: undefined,
      nodeReadRateGuard: undefined,
    } as unknown as SurfaceContext);
    await app.ready();
    await app.close();

    expect(urls.filter((url) => url.includes('/api/v1/'))).toEqual([]);
  });
});

// Unit 2 of the v1 desktop-execution lane: the boot-time node-identity decision. The three branches
// this file pins are the whole trust boundary of the unit — unconfigured stays OFF and BOOTS, a
// present-but-untrustworthy map REFUSES to boot, and only a valid pair arms the node scope.
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { makeNodeRateGuard, makeNodeReadRateGuard } from '../../http/context.ts';
import type { SurfaceContext } from '../../http/context.ts';
import type { HostNodeMapLoad } from '../../auth/hostNodeMap.ts';
import type { PlacementControlStore } from '../../placement/storeAdapters.ts';
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

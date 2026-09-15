// v1 desktop-execution seam, unit 2 [baseline §8]: the PRODUCTION binding of node identity.
//
// `registerV1NodeRoutes` refuses to register anything unless `nodeProxyUid`, `loadHostNodeMap` and both
// node rate guards are present (`api/v1/routes.ts`). Until this module existed, `makeSurfaceContext`
// passed the first two straight through from overrides with no production source at all, so the node
// scope was unregistered on the real VM and `claim`/`renew`/`report` could not have worked even with a
// store binding. This module is that source, and it is deliberately the ONLY one.
//
// The three-way decision, and why each branch is what it is:
//
//   OFF   — `DASHBOARD_NODE_PROXY_UID` unset, or the root-owned host-node map file is absent. This is
//           today's production VM. Node routes stay unregistered and one boot line says so. It must NOT
//           crash: a daemon that refuses to boot because remote execution is not configured would take
//           the operator surface down with it.
//   BOOT  — the map file EXISTS but does not load: unreadable, malformed, not root-owned, or group/
//   REFUSAL  other-writable (`auth/hostNodeMap.ts` collapses all of those to `{ok:false}`). Somebody
//           configured node execution and got it wrong; booting anyway would leave an operator believing
//           remote execution is armed when every request 503s. Fail closed, loudly, naming the path but
//           never the file's contents.
//   ON    — both present and valid: the attested uid, a LIVE loader (re-read per request, so a
//           revocation or a re-enrollment takes effect without a restart), and the v1 store ports.
//
// What this module must never become: a path that derives a host from `:hostId`, a body, or a header.
// It supplies the uid and the map loader and nothing else; `auth/nodeIdentity.ts` remains the sole
// resolver, and the peer-uid proof remains the sole proof.
import { statSync } from 'node:fs';
import { HOST_NODE_MAP_PATH, loadHostNodeMap, type HostNodeMapLoad } from '../../auth/hostNodeMap.ts';
import {
  createAdvertiseStoreAdapter,
  createLeaseStoreAdapter,
  createReportStoreAdapter,
  type PlacementControlStore,
} from '../../placement/storeAdapters.ts';
import type { V1SurfaceDeps } from './routes.ts';

/** The unprivileged uid `deploy/systemd/kb-node-proxy.service` runs `kb_node_proxy.py` as. */
export const NODE_PROXY_UID_ENV = 'DASHBOARD_NODE_PROXY_UID';

export interface NodeExecutionWiring {
  /** `undefined` in the OFF branch — which is exactly what keeps the node scope unregistered. */
  readonly nodeProxyUid: number | undefined;
  readonly loadHostNodeMap: (() => HostNodeMapLoad) | undefined;
  readonly v1: V1SurfaceDeps | undefined;
  /** Whether the node scope will register. Mirrors "all three above are defined". */
  readonly armed: boolean;
  /** One line for the boot log; always present, in every branch, and never carries map contents. */
  readonly bootLine: string;
}

export interface NodeExecutionWiringDeps {
  /** The daemon's own control store — the ports are bound to THIS instance, never a second one. */
  readonly store: PlacementControlStore;
  readonly env?: Record<string, string | undefined>;
  readonly mapPath?: string;
  /** Existence probe for the map file; injected in tests. Any throw counts as "absent". */
  readonly mapExists?: (path: string) => boolean;
  /** The map loader; injected in tests. Production is `auth/hostNodeMap.ts`'s fail-closed reader. */
  readonly load?: (path: string) => HostNodeMapLoad;
  readonly daemonVersion?: string;
}

/** `DASHBOARD_NODE_PROXY_UID` as a uid, or `undefined` when unset. Throws on anything unusable. */
function resolveNodeProxyUid(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${NODE_PROXY_UID_ENV} must be a non-negative integer uid, got ${JSON.stringify(raw)}`);
  }
  const uid = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(uid)) {
    throw new Error(`${NODE_PROXY_UID_ENV} is not a representable uid: ${JSON.stringify(raw)}`);
  }
  // Root is never the node proxy: the unit runs it as its own unprivileged `kb-node-proxy` user, and
  // accepting 0 here would make EVERY root-owned loopback socket on the box a trusted node peer.
  if (uid === 0) {
    throw new Error(`${NODE_PROXY_UID_ENV} must not be 0: the node proxy runs unprivileged, never as root`);
  }
  return uid;
}

const OFF = (bootLine: string): NodeExecutionWiring => ({
  nodeProxyUid: undefined,
  loadHostNodeMap: undefined,
  v1: undefined,
  armed: false,
  bootLine,
});

/**
 * Resolve the node-execution wiring for this daemon. Throws only on a MISCONFIGURATION (a bad uid, or a
 * map that is present but unusable); "not configured" is a return value, never a throw.
 */
export function resolveNodeExecutionWiring(deps: NodeExecutionWiringDeps): NodeExecutionWiring {
  const env = deps.env ?? process.env;
  const mapPath = deps.mapPath ?? HOST_NODE_MAP_PATH;
  const uid = resolveNodeProxyUid(env[NODE_PROXY_UID_ENV]);
  if (uid === undefined) {
    return OFF(`[node-execution] OFF: ${NODE_PROXY_UID_ENV} is unset; v1 node routes are not registered`);
  }

  const exists = deps.mapExists ?? ((path: string) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
  if (!exists(mapPath)) {
    // The uid alone is not enough: with no map every node request would 503 `host-map-unavailable`, so
    // registering the scope would advertise a capability the daemon does not have.
    return OFF(`[node-execution] OFF: no host-node map at ${mapPath}; v1 node routes are not registered`);
  }

  const load = deps.load ?? ((path: string) => loadHostNodeMap({ path }));
  const probe = load(mapPath);
  if (!probe.ok) {
    // Deliberately names the path and NOT one byte of the file: a boot log is not a place to spill the
    // enrolled node ids, and the operator needs the path, not the contents, to fix it.
    throw new Error(
      `host-node map at ${mapPath} is present but unusable (unreadable, malformed, not root-owned, or writable). `
      + 'Fix or remove it: node execution refuses to boot on a map it cannot trust.',
    );
  }

  return {
    nodeProxyUid: uid,
    // The LIVE loader, not `probe`: authorization must re-read the map on every request so a revoked
    // node stops being attributable immediately, without a daemon restart.
    loadHostNodeMap: () => load(mapPath),
    v1: {
      leaseStore: createLeaseStoreAdapter(deps.store),
      reportStore: createReportStoreAdapter(deps.store),
      advertiseStore: createAdvertiseStoreAdapter(deps.store),
      ...(deps.daemonVersion === undefined ? {} : { daemonVersion: deps.daemonVersion }),
    },
    armed: true,
    bootLine: `[node-execution] ARMED: node proxy uid ${uid}, host-node map ${mapPath} revision ${probe.map.revision}`,
  };
}

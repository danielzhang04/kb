/**
 * P6 W4 §3.3 — daemon (node) identity, the second trust boundary beside the operator authenticator.
 *
 * A node request is authenticated in TWO independent, ordered hooks, never one:
 *
 *  1. PEER-UID PROOF (this module, `resolveNodePeer`). The connection's loopback peer must be owned by
 *     `DASHBOARD_NODE_PROXY_UID` — the attested `kb-node-proxy`, and NOT root `tailscale serve` (whose uid
 *     is the operator proxy's). This is the lock a header cannot pick: the proxy is the only process that
 *     can present that uid on its own socket. It is evaluated FIRST and independently of any subject:
 *       - `requireNodeIdentity` refuses `401 untrusted-peer` when the peer uid is not the node proxy;
 *       - the v1 node SCOPE (W6.1) refuses `403 node-route-only` for the same peer failure on a node path,
 *         and every operator scope refuses `403 operator-route-only` when the peer IS the node proxy —
 *         the two topology codes of [P6-C46], which is why {@link isNodeProxyPeer} is exported for it.
 *
 *  2. MAP RESOLUTION (this module, `requireNodeIdentity`). The proxy-injected `Tailscale-Node-ID` is
 *     resolved THROUGH THE ROOT-OWNED MAP ONLY [design:416] to a `HostKind`. The host id is NEVER taken
 *     from the URL path or the body: a `:hostId` in the route is validated AGAINST the map-derived host
 *     (`403 wrong-host` on disagreement), never used as its source. A malformed map is `503
 *     host-map-unavailable`; an unknown id `403 node-unknown`; a revoked id `403 node-revoked`.
 *
 * No refusal body names any map contents — echoing the enrolled ids to an unauthenticated caller would
 * defeat the whole point of a root-owned map.
 */
import { findPeerUid, readProcNetTables, type PeerUidResult } from './peerUid.ts';
import { NODE_ID, isRevokedNode, resolveHostForNode, type HostNodeMap } from './hostNodeMapContracts.ts';
import type { HostNodeMapLoad } from './hostNodeMap.ts';
import type { HostKind } from '../control/p2Contracts.ts';
import type { OperatorRequestLike } from './operator.ts';

/** The request shape a node authenticator reads: proxy-injected headers plus the raw socket endpoints. */
export type NodeRequestLike = OperatorRequestLike;

/** The one header the attested proxy injects; the ONLY node-identity input the dashboard trusts. */
export const NODE_ID_HEADER = 'tailscale-node-id';

export type NodeIdentityReason =
  | 'untrusted-peer'        // 401 — peer uid is not the node proxy
  | 'host-map-unavailable'  // 503 — the root-owned map failed to load/validate
  | 'node-unknown'          // 403 — the id resolves to no active host
  | 'node-revoked'          // 403 — the id is in `revoked`
  | 'wrong-host';           // 403 — a `:hostId` disagrees with the map-derived host

const REASON_STATUS: Record<NodeIdentityReason, 401 | 403 | 503> = {
  'untrusted-peer': 401,
  'host-map-unavailable': 503,
  'node-unknown': 403,
  'node-revoked': 403,
  'wrong-host': 403,
};

export type NodeIdentityResult =
  | { ok: true; host: HostKind; nodeId: string }
  | { ok: false; status: 401 | 403 | 503; reason: NodeIdentityReason };

function failure(reason: NodeIdentityReason): NodeIdentityResult {
  return { ok: false, status: REASON_STATUS[reason], reason };
}

function header(req: NodeRequestLike, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Exactly loopback, nothing else in 127/8 — the same tight set the operator authenticator uses, for the
 * same reason: `startsWith('127.')` would admit `127.0.0.2`, the source-address spoof `peerUid.ts` guards.
 */
function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export interface NodePeerDeps {
  /** Injected in tests; production reads the real `/proc/net/tcp{,6}`. */
  readTables?: () => readonly string[];
}

/**
 * The owning uid of the connection's loopback peer, proven against the FULL 4-tuple (see `peerUid.ts`), or
 * a fail-closed result. Shared by {@link requireNodeIdentity} and the v1 scope's topology preHandler.
 */
export function resolveNodePeer(req: NodeRequestLike, deps: NodePeerDeps = {}): PeerUidResult {
  const readTables = deps.readTables ?? (() => readProcNetTables());
  const socket = req.socket;
  const remoteAddress = socket?.remoteAddress;
  const localAddress = socket?.localAddress;
  const remotePort = socket?.remotePort;
  const localPort = socket?.localPort;
  if (!isLoopbackAddress(remoteAddress) || !isLoopbackAddress(localAddress)
    || !Number.isInteger(remotePort) || !Number.isInteger(localPort)) {
    return { ok: false, reason: 'peer-socket-not-found' };
  }
  return findPeerUid({
    localAddress: localAddress!, localPort: localPort!,
    remoteAddress: remoteAddress!, remotePort: remotePort!,
    tables: readTables(),
  });
}

/**
 * True iff the connection's loopback peer is owned by the node proxy uid. The v1 node scope's preHandler
 * uses it for `403 node-route-only`, and the operator scopes for `403 operator-route-only` (negated) —
 * the peer-uid topology split of [P6-C46]. Fails closed on any ambiguity.
 */
export function isNodeProxyPeer(req: NodeRequestLike, nodeProxyUid: number, deps: NodePeerDeps = {}): boolean {
  const peer = resolveNodePeer(req, deps);
  return peer.ok && peer.uid === nodeProxyUid;
}

export interface RequireNodeIdentityOptions {
  /** The attested node-proxy uid (`DASHBOARD_NODE_PROXY_UID`) the peer must own. */
  nodeProxyUid: number;
  /** The boot-loaded root-owned map, or the fail-closed sentinel. Resolved once at boot, not per request. */
  loadMap: () => HostNodeMapLoad;
  /** The `:hostId` route param, when the route carries one — validated AGAINST the map, never its source. */
  hostId?: string;
  readTables?: () => readonly string[];
}

/**
 * Authenticate a node request: prove the peer uid, then resolve the injected `Tailscale-Node-ID` through
 * the root-owned map to a `HostKind`. Peer proof is FIRST (`401 untrusted-peer`), then the map load
 * (`503 host-map-unavailable`), then the id resolution (`403 node-revoked` / `403 node-unknown`), then the
 * optional `:hostId` cross-check (`403 wrong-host`). The host id comes ONLY from the map.
 */
export function requireNodeIdentity(req: NodeRequestLike, options: RequireNodeIdentityOptions): NodeIdentityResult {
  // 1. Peer-uid proof — the node proxy, not root tailscale serve, and not a governed worker.
  if (!isNodeProxyPeer(req, options.nodeProxyUid, { readTables: options.readTables })) {
    return failure('untrusted-peer');
  }

  // 2. The root-owned map — every malformation is one fail-closed 503, evaluated after the peer proof.
  const load = options.loadMap();
  if (!load.ok) return failure('host-map-unavailable');
  const map: HostNodeMap = load.map;

  // 3. The proxy-injected node id. Absent or off-charset resolves to no host — never a 401/503.
  const nodeId = header(req, NODE_ID_HEADER)?.trim() ?? '';
  if (!NODE_ID.test(nodeId)) return failure('node-unknown');

  // A revoked id is a DISTINCT refusal from an unknown one (a rotated-out host, not a stranger).
  if (isRevokedNode(map, nodeId)) return failure('node-revoked');
  const host = resolveHostForNode(map, nodeId);
  if (host === null) return failure('node-unknown');

  // 4. `:hostId`, when present, is checked AGAINST the map-derived host — never the source of it.
  if (options.hostId !== undefined && options.hostId !== host) return failure('wrong-host');

  return { ok: true, host, nodeId };
}

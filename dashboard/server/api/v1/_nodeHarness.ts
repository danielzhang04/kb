// P6 W6.1 — shared node-route test harness (NOT a test file). Stamps the controlled loopback 4-tuple that
// the real `requireNodeIdentity`/`isNodeProxyPeer` peer proof reads, and supplies a synthetic
// `/proc/net/tcp` table owned by the uid under test, so the security chain runs end to end over HTTP and is
// never faked. Imported by hosts/leases/reports .test.ts and routes.test.ts's siblings.
import Fastify, { type FastifyInstance } from 'fastify';
import type { SurfaceContext } from '../../http/context.ts';
import { makeNodeRateGuard, makeNodeReadRateGuard } from '../../http/context.ts';
import { requireSession } from '../../http/middleware.ts';
import { mintSession, type SessionConfig } from '../../auth/session.ts';
import { originPlugin } from '../../security/origin.ts';
import { decodeHostNodeMap, type HostNodeMap } from '../../auth/hostNodeMapContracts.ts';
import type { HostNodeMapLoad } from '../../auth/hostNodeMap.ts';
import type { PlacementLease } from '../../placement/contracts.ts';
import {
  registerV1NodeRoutes, registerV1OperatorReadRoutes, registerV1OperatorMutationRoutes,
  type V1SurfaceDeps,
} from './routes.ts';

export const NODE_PROXY_UID = 1001;
export const DASH_PORT = 4317;
export const PEER_PORT = 0xcf32;
export const HOST = '127.0.0.1:4317';
export const ALLOWED = ['http://127.0.0.1:4317'];
export const NOW = '2026-08-25T00:00:00.000Z';

export function procTableForPeer(uid: number): string {
  const hex = (p: number) => p.toString(16).toUpperCase().padStart(4, '0');
  return `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   6: 0100007F:${hex(DASH_PORT)} 0100007F:${hex(PEER_PORT)} 01 00000000:00000000 00:00000000 00000000   999        0 1 1 0 20 4 31 10 -1
   8: 0100007F:${hex(PEER_PORT)} 0100007F:${hex(DASH_PORT)} 01 00000000:00000000 00:00000000 00000000   ${uid}        0 2 1 0 20 4 30 10 -1
`;
}
export const tablesFor = (uid: number) => () => [procTableForPeer(uid)];

export const MAP: HostNodeMap = decodeHostNodeMap({
  schema: 'kb.host-node-map/v1',
  revision: 2,
  hosts: { vm: { nodeId: 'nodeVM01' }, desktop: { nodeId: 'nodeDESK9' } },
  revoked: [{ nodeId: 'oldNODE7', revokedAt: '2026-08-01T00:00:00.000Z' }],
});
export const okMap = (): HostNodeMapLoad => ({ ok: true, map: MAP });

export function nodeHeaders(nodeId = 'nodeVM01'): Record<string, string> {
  return { host: HOST, 'tailscale-node-id': nodeId };
}

export function lease(over: Partial<PlacementLease> = {}): PlacementLease {
  return {
    runRef: 'run-1', hostId: 'vm', capabilityHash: 'a'.repeat(64), revision: 1,
    expiresAt: '2026-08-25T00:02:00.000Z', lastReportSequence: 0, ...over,
  };
}

export function nodeCtx(over: { peerUid?: number; v1?: Partial<V1SurfaceDeps>; loadHostNodeMap?: () => HostNodeMapLoad } = {}): SurfaceContext {
  return {
    allowedOrigins: ALLOWED,
    nodeProxyUid: NODE_PROXY_UID,
    loadHostNodeMap: over.loadHostNodeMap ?? okMap,
    nodeRateGuard: makeNodeRateGuard(),
    nodeReadRateGuard: makeNodeReadRateGuard(),
    now: () => new Date(NOW),
    v1: { readTables: tablesFor(over.peerUid ?? NODE_PROXY_UID), now: () => new Date(NOW), ...over.v1 },
  } as unknown as SurfaceContext;
}

export function nodeApp(ctx: SurfaceContext): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    const s = req.socket as unknown as Record<string, unknown>;
    s.remoteAddress = '127.0.0.1'; s.remotePort = PEER_PORT; s.localAddress = '127.0.0.1'; s.localPort = DASH_PORT;
  });
  registerV1NodeRoutes(app, ctx);
  return app;
}

export function advertisementBody(): Record<string, unknown> {
  return {
    daemonVersion: 'vm-1.2.3', reportedAt: NOW, connectors: [], skills: [], filesystemRoots: [],
    pty: true, gpu: false, clis: { claude: 'ready', codex: 'ready' },
  };
}

// --- operator-scope harness -----------------------------------------------------------------------

export const OP_SESSION: SessionConfig = { secret: Buffer.alloc(32, 5), ttlMs: 600_000 };
export const operatorBearer = (): string => `Bearer ${mintSession('operator', OP_SESSION).token}`;
/** A valid Idempotency-Key header value (§3.4 grammar). */
export const IDEM = 'idem-key-abcdef123456';

/** Build a SurfaceContext for the operator scopes with the injected v1 ports. `nodeProxyUid` is set so the
 *  operator-route-only peer guard is live; pass a non-proxy `peerUid` (default) for normal operator calls. */
export function opCtx(v1: Partial<V1SurfaceDeps> = {}, peerUid = 0): SurfaceContext {
  return {
    allowedOrigins: ALLOWED,
    sessionConfig: OP_SESSION,
    nodeProxyUid: NODE_PROXY_UID,
    now: () => new Date(NOW),
    v1: { readTables: tablesFor(peerUid), now: () => new Date(NOW), ...v1 },
  } as unknown as SurfaceContext;
}

/** An app mounting the operator READ or MUTATION scope exactly as index.ts / surface.ts do: originPlugin +
 *  requireSession, then the registrar. The loopback 4-tuple is stamped so the operator-route-only peer
 *  guard can run against the synthetic table. */
export function operatorApp(ctx: SurfaceContext, which: 'reads' | 'mutations'): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    const s = req.socket as unknown as Record<string, unknown>;
    s.remoteAddress = '127.0.0.1'; s.remotePort = PEER_PORT; s.localAddress = '127.0.0.1'; s.localPort = DASH_PORT;
  });
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('preHandler', requireSession(ctx.sessionConfig));
    if (which === 'reads') registerV1OperatorReadRoutes(scope, ctx);
    else registerV1OperatorMutationRoutes(scope, ctx);
  });
  return app;
}

/** Standard operator request headers (host + bearer + a valid Idempotency-Key for mutations). */
export function opHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { host: HOST, authorization: operatorBearer(), 'idempotency-key': IDEM, ...extra };
}

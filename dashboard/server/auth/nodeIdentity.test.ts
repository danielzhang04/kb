import { describe, expect, it } from 'vitest';
import {
  isNodeProxyPeer,
  requireNodeIdentity,
  NODE_ID_HEADER,
  type NodeRequestLike,
} from './nodeIdentity.ts';
import { decodeHostNodeMap, type HostNodeMap } from './hostNodeMapContracts.ts';
import type { HostNodeMapLoad } from './hostNodeMap.ts';

const NODE_PROXY_UID = 1001;
const DASH_PORT = 4317;
const PEER_PORT = 0xcf32;

/** Build a `/proc/net/tcp` table for a connection the dashboard ACCEPTED (localPort=DASH_PORT) whose
 *  loopback peer socket (local PEER_PORT, rem DASH_PORT) is owned by `uid`. Both endpoints 127.0.0.1. */
function procTableForPeer(uid: number): string {
  const hex = (p: number) => p.toString(16).toUpperCase().padStart(4, '0');
  return `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   6: 0100007F:${hex(DASH_PORT)} 0100007F:${hex(PEER_PORT)} 01 00000000:00000000 00:00000000 00000000   999        0 1 1 0 20 4 31 10 -1
   8: 0100007F:${hex(PEER_PORT)} 0100007F:${hex(DASH_PORT)} 01 00000000:00000000 00:00000000 00000000   ${uid}        0 2 1 0 20 4 30 10 -1
`;
}

const MAP: HostNodeMap = decodeHostNodeMap({
  schema: 'kb.host-node-map/v1',
  revision: 2,
  hosts: { vm: { nodeId: 'nodeVM01' }, desktop: { nodeId: 'nodeDESK9' } },
  revoked: [{ nodeId: 'oldNODE7', revokedAt: '2026-08-01T00:00:00.000Z' }],
});

const okMap = (): HostNodeMapLoad => ({ ok: true, map: MAP });
const deadMap = (): HostNodeMapLoad => ({ ok: false });

function req(over: { nodeId?: string; peerUid?: number; socket?: unknown } = {}): NodeRequestLike {
  const headers: Record<string, string> = {};
  if (over.nodeId !== undefined) headers[NODE_ID_HEADER] = over.nodeId;
  return {
    headers,
    socket: (over.socket as NodeRequestLike['socket']) ?? {
      remoteAddress: '127.0.0.1', remotePort: PEER_PORT, localAddress: '127.0.0.1', localPort: DASH_PORT,
    },
  };
}

function tablesFor(uid: number) {
  return () => [procTableForPeer(uid)];
}

describe('requireNodeIdentity — peer-uid proof is first and independent', () => {
  it('accepts a request from the node proxy and derives the host FROM THE MAP', () => {
    const result = requireNodeIdentity(req({ nodeId: 'nodeVM01' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, readTables: tablesFor(NODE_PROXY_UID),
    });
    expect(result).toEqual({ ok: true, host: 'vm', nodeId: 'nodeVM01' });
  });

  it('resolves the desktop host for the desktop node id', () => {
    const result = requireNodeIdentity(req({ nodeId: 'nodeDESK9' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, readTables: tablesFor(NODE_PROXY_UID),
    });
    expect(result).toEqual({ ok: true, host: 'desktop', nodeId: 'nodeDESK9' });
  });

  it('SECURITY: 401 untrusted-peer when the peer is root tailscale serve (uid 0), not the node proxy', () => {
    const result = requireNodeIdentity(req({ nodeId: 'nodeVM01' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, readTables: tablesFor(0),
    });
    expect(result).toEqual({ ok: false, status: 401, reason: 'untrusted-peer' });
  });

  it('SECURITY: 401 untrusted-peer for a governed worker (dashboard uid 999)', () => {
    const result = requireNodeIdentity(req({ nodeId: 'nodeVM01' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, readTables: tablesFor(999),
    });
    expect(result).toEqual({ ok: false, status: 401, reason: 'untrusted-peer' });
  });

  it('SECURITY: 401 untrusted-peer for a non-loopback socket', () => {
    const result = requireNodeIdentity(req({
      nodeId: 'nodeVM01',
      socket: { remoteAddress: '100.89.73.118', remotePort: PEER_PORT, localAddress: '127.0.0.1', localPort: DASH_PORT },
    }), { nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, readTables: tablesFor(NODE_PROXY_UID) });
    expect(result).toEqual({ ok: false, status: 401, reason: 'untrusted-peer' });
  });

  it('the peer proof precedes the map: a bad peer with a dead map is still 401, not 503', () => {
    const result = requireNodeIdentity(req({ nodeId: 'nodeVM01' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: deadMap, readTables: tablesFor(0),
    });
    expect(result).toEqual({ ok: false, status: 401, reason: 'untrusted-peer' });
  });
});

describe('requireNodeIdentity — map resolution after the peer proof', () => {
  it('503 host-map-unavailable when the map failed to load, even from a trusted peer', () => {
    const result = requireNodeIdentity(req({ nodeId: 'nodeVM01' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: deadMap, readTables: tablesFor(NODE_PROXY_UID),
    });
    expect(result).toEqual({ ok: false, status: 503, reason: 'host-map-unavailable' });
  });

  it('403 node-revoked for a rotated-out id (distinct from node-unknown)', () => {
    const result = requireNodeIdentity(req({ nodeId: 'oldNODE7' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, readTables: tablesFor(NODE_PROXY_UID),
    });
    expect(result).toEqual({ ok: false, status: 403, reason: 'node-revoked' });
  });

  it('403 node-unknown for an id in neither hosts nor revoked', () => {
    const result = requireNodeIdentity(req({ nodeId: 'strangeR1' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, readTables: tablesFor(NODE_PROXY_UID),
    });
    expect(result).toEqual({ ok: false, status: 403, reason: 'node-unknown' });
  });

  it('403 node-unknown for a missing or off-charset Tailscale-Node-ID header', () => {
    for (const nodeId of [undefined, '', 'bad id!', 'abc']) {
      const result = requireNodeIdentity(req(nodeId === undefined ? {} : { nodeId }), {
        nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, readTables: tablesFor(NODE_PROXY_UID),
      });
      expect(result).toEqual({ ok: false, status: 403, reason: 'node-unknown' });
    }
  });
});

describe('requireNodeIdentity — :hostId is validated against the map, never its source', () => {
  it('accepts when :hostId agrees with the map-derived host', () => {
    const result = requireNodeIdentity(req({ nodeId: 'nodeVM01' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, hostId: 'vm', readTables: tablesFor(NODE_PROXY_UID),
    });
    expect(result).toEqual({ ok: true, host: 'vm', nodeId: 'nodeVM01' });
  });

  it('SECURITY: 403 wrong-host when :hostId disagrees with the map-derived host', () => {
    // The desktop node presents :hostId=vm — the map says desktop, so the path claim is refused.
    const result = requireNodeIdentity(req({ nodeId: 'nodeDESK9' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, hostId: 'vm', readTables: tablesFor(NODE_PROXY_UID),
    });
    expect(result).toEqual({ ok: false, status: 403, reason: 'wrong-host' });
  });
});

describe('no refusal body carries map contents', () => {
  it('failure results expose only a status and a fixed reason token — never a node id', () => {
    const result = requireNodeIdentity(req({ nodeId: 'strangeR1' }), {
      nodeProxyUid: NODE_PROXY_UID, loadMap: okMap, readTables: tablesFor(NODE_PROXY_UID),
    });
    expect(result.ok).toBe(false);
    // The whole serialized failure must not contain any enrolled or revoked id from the map.
    const serialized = JSON.stringify(result);
    for (const id of ['nodeVM01', 'nodeDESK9', 'oldNODE7']) expect(serialized).not.toContain(id);
  });
});

describe('isNodeProxyPeer — the topology predicate for the v1 scope (node-route-only / operator-route-only)', () => {
  it('true only when the peer uid equals the node proxy uid', () => {
    expect(isNodeProxyPeer(req(), NODE_PROXY_UID, { readTables: tablesFor(NODE_PROXY_UID) })).toBe(true);
    expect(isNodeProxyPeer(req(), NODE_PROXY_UID, { readTables: tablesFor(0) })).toBe(false);
    expect(isNodeProxyPeer(req(), NODE_PROXY_UID, { readTables: tablesFor(999) })).toBe(false);
  });

  it('false (fail-closed) for a non-loopback peer', () => {
    const r = req({ socket: { remoteAddress: '10.0.0.1', remotePort: PEER_PORT, localAddress: '127.0.0.1', localPort: DASH_PORT } });
    expect(isNodeProxyPeer(r, NODE_PROXY_UID, { readTables: tablesFor(NODE_PROXY_UID) })).toBe(false);
  });
});

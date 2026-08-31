// P6 W0 §3.3: the root-owned host-node map SCHEMA decoder [design:416]. Types and strict decode ONLY —
// W0 owns no loader, no file stat, no route, and no rotation logic. W2's `auth/hostNodeMap.ts` reads
// `/etc/kb-dashboard/host-nodes.json`, applies the Linux 0444/uid-0 stat, and imports this decoder.
import type { HostKind } from '../control/p2Contracts.ts';
import { ContractDecodeError } from '../write/durableManifest.ts';
import { record as asRecord, isoUtc } from '../shared/decode.ts';

export const HOST_NODE_MAP_SCHEMA = 'kb.host-node-map/v1';

/** Node ids are `/^[A-Za-z0-9]{5,32}$/` [§3.3:191]. */
export const NODE_ID = /^[A-Za-z0-9]{5,32}$/;

export interface HostNodeMap {
  readonly schema: typeof HOST_NODE_MAP_SCHEMA;
  readonly revision: number;
  readonly hosts: { readonly vm: { readonly nodeId: string }; readonly desktop: { readonly nodeId: string } };
  readonly revoked: ReadonlyArray<{ readonly nodeId: string; readonly revokedAt: string }>;
}

export const HOST_NODE_MAP_FIELDS: readonly string[] = ['schema', 'revision', 'hosts', 'revoked'];

function exact(field: string, value: Record<string, unknown>, keys: readonly string[]): void {
  for (const k of Object.keys(value)) {
    if (!keys.includes(k)) throw new ContractDecodeError(field, `unknown key ${JSON.stringify(k)}`);
  }
  for (const k of keys) {
    if (!Object.hasOwn(value, k)) throw new ContractDecodeError(field, `missing key ${JSON.stringify(k)}`);
  }
}
function decodeNode(field: string, value: unknown): { nodeId: string } {
  const item = asRecord(value);
  if (!item) throw new ContractDecodeError(field, 'object required');
  exact(field, item, ['nodeId']);
  if (typeof item.nodeId !== 'string' || !NODE_ID.test(item.nodeId)) {
    throw new ContractDecodeError(field, 'nodeId must match /^[A-Za-z0-9]{5,32}$/');
  }
  return { nodeId: item.nodeId };
}

/**
 * Decode and validate the host-node map [§3.3:191]: exact schema literal; positive-integer `revision`;
 * exactly `{schema, revision, hosts, revoked}` with `hosts` exactly `{vm, desktop}`; the two active ids
 * distinct AND absent from `revoked`; `revoked` entries unique with RFC 3339 `revokedAt`. Every failure
 * throws — the caller (W2) maps that to a fail-closed `503 host-map-unavailable`.
 */
export function decodeHostNodeMap(value: unknown): HostNodeMap {
  const item = asRecord(value);
  if (!item) throw new ContractDecodeError('hostNodeMap', 'object required');
  exact('hostNodeMap', item, HOST_NODE_MAP_FIELDS);
  if (item.schema !== HOST_NODE_MAP_SCHEMA) {
    throw new ContractDecodeError('schema', `must equal ${JSON.stringify(HOST_NODE_MAP_SCHEMA)}`);
  }
  if (typeof item.revision !== 'number' || !Number.isInteger(item.revision) || item.revision < 1) {
    throw new ContractDecodeError('revision', 'positive integer required');
  }
  const hosts = asRecord(item.hosts);
  if (!hosts) throw new ContractDecodeError('hosts', 'object required');
  exact('hosts', hosts, ['vm', 'desktop']);
  const vm = decodeNode('hosts.vm', hosts.vm);
  const desktop = decodeNode('hosts.desktop', hosts.desktop);
  if (vm.nodeId === desktop.nodeId) throw new ContractDecodeError('hosts', 'active node ids must be distinct');

  if (!Array.isArray(item.revoked)) throw new ContractDecodeError('revoked', 'array required');
  const seen = new Set<string>();
  const revoked = item.revoked.map((entry) => {
    const r = asRecord(entry);
    if (!r) throw new ContractDecodeError('revoked', 'each entry is an object');
    exact('revoked', r, ['nodeId', 'revokedAt']);
    if (typeof r.nodeId !== 'string' || !NODE_ID.test(r.nodeId)) {
      throw new ContractDecodeError('revoked', 'nodeId must match /^[A-Za-z0-9]{5,32}$/');
    }
    if (!isoUtc(r.revokedAt)) throw new ContractDecodeError('revoked', 'revokedAt must be RFC 3339 UTC');
    if (seen.has(r.nodeId)) throw new ContractDecodeError('revoked', `duplicate revoked ${JSON.stringify(r.nodeId)}`);
    seen.add(r.nodeId);
    return { nodeId: r.nodeId, revokedAt: r.revokedAt };
  });
  if (seen.has(vm.nodeId) || seen.has(desktop.nodeId)) {
    throw new ContractDecodeError('hosts', 'an active node id must not appear in revoked');
  }
  return { schema: HOST_NODE_MAP_SCHEMA, revision: item.revision, hosts: { vm, desktop }, revoked };
}

/** Resolve a presented node id to its `HostKind`, or `null` when unknown/revoked (caller maps to a refusal). */
export function resolveHostForNode(map: HostNodeMap, nodeId: string): HostKind | null {
  if (map.revoked.some((r) => r.nodeId === nodeId)) return null;
  if (map.hosts.vm.nodeId === nodeId) return 'vm';
  if (map.hosts.desktop.nodeId === nodeId) return 'desktop';
  return null;
}

/** True iff the node id is present in `revoked` (a `403 node-revoked`, distinct from `node-unknown`). */
export function isRevokedNode(map: HostNodeMap, nodeId: string): boolean {
  return map.revoked.some((r) => r.nodeId === nodeId);
}

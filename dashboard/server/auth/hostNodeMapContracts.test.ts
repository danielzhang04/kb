import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from '../write/durableManifest.ts';
import {
  HOST_NODE_MAP_FIELDS, HOST_NODE_MAP_SCHEMA, decodeHostNodeMap, isRevokedNode, resolveHostForNode,
} from './hostNodeMapContracts.ts';
import type { HostNodeMap } from './hostNodeMapContracts.ts';

interface VectorCase { readonly name: string; readonly value: unknown }
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p6-contract-vectors.json', import.meta.url), 'utf8',
)) as { readonly hostNodeMaps: { readonly valid: VectorCase[]; readonly invalid: VectorCase[] } };

describe('host-node map schema decoder (§3.3:191, design:416)', () => {
  it('freezes the schema literal and top-level field set', () => {
    expect(HOST_NODE_MAP_SCHEMA).toBe('kb.host-node-map/v1');
    expect([...HOST_NODE_MAP_FIELDS]).toEqual(['schema', 'revision', 'hosts', 'revoked']);
  });
  for (const v of vectors.hostNodeMaps.valid) {
    it(`accepts ${v.name}`, () => {
      expect(decodeHostNodeMap(v.value)).toEqual(v.value);
    });
  }
  for (const v of vectors.hostNodeMaps.invalid) {
    it(`rejects ${v.name}`, () => {
      expect(() => decodeHostNodeMap(v.value)).toThrow(ContractDecodeError);
    });
  }
});

describe('node -> host resolution (authorization derives host from the map, never the path)', () => {
  const map = decodeHostNodeMap(vectors.hostNodeMaps.valid[1]!.value) as HostNodeMap;
  it('resolves an active node to its host and an unknown node to null', () => {
    expect(resolveHostForNode(map, map.hosts.vm.nodeId)).toBe('vm');
    expect(resolveHostForNode(map, map.hosts.desktop.nodeId)).toBe('desktop');
    expect(resolveHostForNode(map, 'nosuchnode')).toBeNull();
  });
  it('treats a revoked node as unresolvable and distinguishes it from unknown', () => {
    const revokedId = map.revoked[0]!.nodeId;
    expect(resolveHostForNode(map, revokedId)).toBeNull();
    expect(isRevokedNode(map, revokedId)).toBe(true);
    expect(isRevokedNode(map, 'nosuchnode')).toBe(false);
  });
});

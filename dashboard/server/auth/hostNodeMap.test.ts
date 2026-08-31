import { describe, expect, it } from 'vitest';
import { HOST_NODE_MAP_PATH, loadHostNodeMap, type HostNodeMapStat } from './hostNodeMap.ts';

const VALID = {
  schema: 'kb.host-node-map/v1',
  revision: 3,
  hosts: { vm: { nodeId: 'nodeVM01' }, desktop: { nodeId: 'nodeDESK9' } },
  revoked: [{ nodeId: 'oldNODE7', revokedAt: '2026-08-01T00:00:00.000Z' }],
};

/** A loader wired to fixed text + a root-owned `0444` stat, so only the map body under test varies. */
function load(body: unknown, over: Partial<{ platform: string; stat: (p: string) => HostNodeMapStat; text: string }> = {}) {
  return loadHostNodeMap({
    path: HOST_NODE_MAP_PATH,
    read: () => over.text ?? JSON.stringify(body),
    stat: over.stat ?? (() => ({ uid: 0, mode: 0o100444 })),
    platform: over.platform ?? 'linux',
  });
}

describe('loadHostNodeMap — the happy path', () => {
  it('loads a well-formed, root-owned 0444 map', () => {
    const result = load(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.map.hosts.vm.nodeId).toBe('nodeVM01');
      expect(result.map.hosts.desktop.nodeId).toBe('nodeDESK9');
      expect(result.map.revision).toBe(3);
    }
  });
});

describe('loadHostNodeMap — every malformation fails closed to { ok: false }', () => {
  const malformations: Array<[string, unknown]> = [
    ['wrong schema literal', { ...VALID, schema: 'kb.host-node-map/v2' }],
    ['non-positive revision', { ...VALID, revision: 0 }],
    ['negative revision', { ...VALID, revision: -1 }],
    ['non-integer revision', { ...VALID, revision: 1.5 }],
    ['extra top-level key', { ...VALID, extra: true }],
    ['missing host', { ...VALID, hosts: { vm: { nodeId: 'nodeVM01' } } }],
    ['extra host', { ...VALID, hosts: { ...VALID.hosts, laptop: { nodeId: 'nodeLAP1' } } }],
    ['bad node-id charset', { ...VALID, hosts: { vm: { nodeId: 'bad id!' }, desktop: { nodeId: 'nodeDESK9' } } }],
    ['too-short node id', { ...VALID, hosts: { vm: { nodeId: 'abcd' }, desktop: { nodeId: 'nodeDESK9' } } }],
    ['duplicate active ids', { ...VALID, hosts: { vm: { nodeId: 'sameID1' }, desktop: { nodeId: 'sameID1' } } }],
    ['active id also revoked', { ...VALID, revoked: [{ nodeId: 'nodeVM01', revokedAt: '2026-08-01T00:00:00.000Z' }] }],
    ['malformed revokedAt', { ...VALID, revoked: [{ nodeId: 'oldNODE7', revokedAt: 'not-a-date' }] }],
    ['duplicate revoked entry', { ...VALID, revoked: [
      { nodeId: 'oldNODE7', revokedAt: '2026-08-01T00:00:00.000Z' },
      { nodeId: 'oldNODE7', revokedAt: '2026-08-02T00:00:00.000Z' },
    ] }],
    ['not an object', 42],
    ['null', null],
  ];
  for (const [name, body] of malformations) {
    it(`refuses: ${name}`, () => {
      expect(load(body).ok).toBe(false);
    });
  }

  it('refuses an unreadable file (read throws)', () => {
    const result = loadHostNodeMap({
      read: () => { throw new Error('ENOENT'); },
      stat: () => ({ uid: 0, mode: 0o100444 }),
      platform: 'linux',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses invalid JSON', () => {
    expect(load(undefined, { text: '{ not json' }).ok).toBe(false);
  });
});

describe('loadHostNodeMap — Linux ownership and permission stat', () => {
  it('refuses a non-uid-0 owner', () => {
    expect(load(VALID, { stat: () => ({ uid: 1000, mode: 0o100444 }) }).ok).toBe(false);
  });

  it('refuses a group-writable map', () => {
    expect(load(VALID, { stat: () => ({ uid: 0, mode: 0o100464 }) }).ok).toBe(false);
  });

  it('refuses an other-writable map', () => {
    expect(load(VALID, { stat: () => ({ uid: 0, mode: 0o100446 }) }).ok).toBe(false);
  });

  it('refuses when the stat itself throws', () => {
    expect(load(VALID, { stat: () => { throw new Error('ELOOP'); } }).ok).toBe(false);
  });

  it('accepts a root-owned 0444 map', () => {
    expect(load(VALID, { stat: () => ({ uid: 0, mode: 0o100444 }) }).ok).toBe(true);
  });

  it('accepts a root-owned 0644 map (owner-write is allowed; only group/other write is refused)', () => {
    expect(load(VALID, { stat: () => ({ uid: 0, mode: 0o100644 }) }).ok).toBe(true);
  });

  it('does NOT apply the ownership stat off Linux (dev/win32) — schema still governs', () => {
    // On win32 the uid/mode are meaningless; a valid schema loads, an invalid one still refuses.
    expect(load(VALID, { platform: 'win32', stat: () => { throw new Error('no stat off linux'); } }).ok).toBe(true);
    expect(load({ ...VALID, schema: 'x' }, { platform: 'win32' }).ok).toBe(false);
  });
});

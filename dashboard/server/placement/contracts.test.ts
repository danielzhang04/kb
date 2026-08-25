import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADVERTISEMENT_FRESHNESS_MS, ADVERTISEMENT_INTERVAL_MS, ContractDecodeError,
  HOST_ADVERTISEMENT_FIELDS, HOST_KINDS, PLACEMENT_LEASE_FIELDS,
  decodeHostAdvertisement, decodePlacementLease, isAdvertisementFresh,
} from './contracts.ts';
import type { HostAdvertisement, PlacementLease } from './contracts.ts';

interface VectorCase { readonly name: string; readonly value: unknown }
interface Vectors {
  readonly constants: Record<string, string>;
  readonly hostAdvertisements: { readonly valid: VectorCase[]; readonly invalid: VectorCase[] };
  readonly placementLeases: { readonly valid: VectorCase[]; readonly invalid: VectorCase[] };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p6-contract-vectors.json', import.meta.url), 'utf8',
)) as Vectors;

describe('freshness/interval constant pair (§3.1, P6-C44)', () => {
  it('the re-advertise interval sits strictly below the freshness window', () => {
    expect(ADVERTISEMENT_INTERVAL_MS).toBeLessThan(ADVERTISEMENT_FRESHNESS_MS);
    // three consecutive misses (30s * 3 == 90s) are exactly the tolerated budget.
    expect(ADVERTISEMENT_INTERVAL_MS * 3).toBe(ADVERTISEMENT_FRESHNESS_MS);
  });
  it('freezes the two hosts', () => {
    expect([...HOST_KINDS]).toEqual(['vm', 'desktop']);
  });
});

describe('HostAdvertisement decoder (design 388-398 verbatim)', () => {
  it('freezes the design-388 field list', () => {
    expect([...HOST_ADVERTISEMENT_FIELDS]).toEqual([
      'hostId', 'daemonVersion', 'reportedAt', 'connectors', 'skills', 'filesystemRoots', 'pty', 'gpu', 'clis',
    ]);
  });
  for (const v of vectors.hostAdvertisements.valid) {
    it(`accepts ${v.name}`, () => {
      const decoded = decodeHostAdvertisement(v.value);
      expect(decoded).toEqual(v.value);
      expect(Object.keys(decoded).sort()).toEqual([...HOST_ADVERTISEMENT_FIELDS].sort());
    });
  }
  for (const v of vectors.hostAdvertisements.invalid) {
    it(`rejects ${v.name}`, () => {
      expect(() => decodeHostAdvertisement(v.value)).toThrow(ContractDecodeError);
    });
  }
});

describe('advertisement freshness (§3.1, computed against the store clock)', () => {
  const at = Date.parse(vectors.constants.iso!);
  it('is fresh within the window and stale past it', () => {
    expect(isAdvertisementFresh(vectors.constants.iso!, at + 1_000)).toBe(true);
    expect(isAdvertisementFresh(vectors.constants.iso!, at + ADVERTISEMENT_FRESHNESS_MS - 1)).toBe(true);
    expect(isAdvertisementFresh(vectors.constants.iso!, at + ADVERTISEMENT_FRESHNESS_MS)).toBe(false);
    expect(isAdvertisementFresh(vectors.constants.iso!, at - 1)).toBe(false); // reporter clock ahead => not fresh
  });
});

describe('PlacementLease decoder (design 400-407 verbatim)', () => {
  it('freezes the design-400 field list', () => {
    expect([...PLACEMENT_LEASE_FIELDS]).toEqual([
      'runRef', 'hostId', 'capabilityHash', 'revision', 'expiresAt', 'lastReportSequence',
    ]);
  });
  for (const v of vectors.placementLeases.valid) {
    it(`accepts ${v.name}`, () => {
      expect(decodePlacementLease(v.value)).toEqual(v.value);
    });
  }
  for (const v of vectors.placementLeases.invalid) {
    it(`rejects ${v.name}`, () => {
      expect(() => decodePlacementLease(v.value)).toThrow(ContractDecodeError);
    });
  }
});

describe('compile negatives (verified by tsc --noEmit)', () => {
  it('an advertisement cannot carry an unknown key at compile time', () => {
    const ad: HostAdvertisement = {
      hostId: 'vm', daemonVersion: '1', reportedAt: 't', connectors: [], skills: [], filesystemRoots: [],
      pty: false, gpu: false, clis: { claude: 'ready', codex: 'ready' },
      // @ts-expect-error - HostAdvertisement is closed; there is no `tier` field (§3.1).
      tier: 'gold',
    };
    expect(ad.hostId).toBe('vm');
  });
  it('a lease revision is a number, not a branded string', () => {
    const lease: PlacementLease = {
      runRef: 'r', hostId: 'desktop', capabilityHash: 'x', revision: 1, expiresAt: 't', lastReportSequence: 0,
    };
    // @ts-expect-error - revision is numeric on the stored lease record.
    lease.revision = 'lease:r:1';
    expect(typeof lease.runRef).toBe('string');
  });
});

import { describe, expect, it } from 'vitest';
import { ADVERTISEMENT_FRESHNESS_MS, ADVERTISEMENT_INTERVAL_MS, ContractDecodeError, isAdvertisementFresh } from './contracts.ts';
import { runtimeCapabilities } from '../runtime/capabilities.ts';
import { buildAdvertisement, isAdvertiseDue } from './advertise.ts';

const CHECKED_AT = '2026-08-25T00:00:00.000Z';

describe('buildAdvertisement (§3.1)', () => {
  it('builds a valid HostAdvertisement from the composed capability, pty read off its own discriminant', () => {
    const capabilities = { ...runtimeCapabilities('win32'), skills: ['docx'], filesystemRoots: ['ops'], gpu: true };
    const advertisement = buildAdvertisement({
      hostId: 'desktop', daemonVersion: '1.2.3', capabilities, now: () => new Date(CHECKED_AT),
    });
    expect(advertisement).toEqual({
      hostId: 'desktop', daemonVersion: '1.2.3', reportedAt: CHECKED_AT,
      connectors: [], skills: ['docx'], filesystemRoots: ['ops'],
      pty: false, gpu: true, clis: { claude: 'missing', codex: 'missing' },
    });
  });

  it('is the pty discriminant, not an OS guess: an advertised terminal flips pty true', () => {
    const capabilities = runtimeCapabilities('win32', {
      pty: true, host: 'desktop', launchers: ['shell'], roots: ['repo'], checkedAt: CHECKED_AT,
    });
    const advertisement = buildAdvertisement({
      hostId: 'desktop', daemonVersion: '1.2.3', capabilities, now: () => new Date(CHECKED_AT),
    });
    expect(advertisement.pty).toBe(true);
  });

  it('rejects a malformed daemonVersion before it reaches the network — one validation pass', () => {
    const capabilities = runtimeCapabilities('linux');
    expect(() => buildAdvertisement({
      hostId: 'vm', daemonVersion: 'BAD VERSION', capabilities, now: () => new Date(CHECKED_AT),
    })).toThrow(ContractDecodeError);
  });
});

describe('advertisement interval/freshness — ONE shared constant pair, not two literals [§3.1, P6-C44]', () => {
  it('the 30-s interval sits strictly below the 90-s freshness window', () => {
    expect(ADVERTISEMENT_INTERVAL_MS).toBe(30_000);
    expect(ADVERTISEMENT_FRESHNESS_MS).toBe(90_000);
    expect(ADVERTISEMENT_INTERVAL_MS).toBeLessThan(ADVERTISEMENT_FRESHNESS_MS);
  });

  it('three consecutive missed 30s beats are tolerated; the freshness window lapsing drops the host, and a fourth missed beat leaves it dropped', () => {
    const t0 = Date.parse('2026-08-25T00:00:00.000Z');
    const reportedAt = new Date(t0).toISOString();
    // 1 miss (30s) and 2 misses (60s): comfortably still fresh.
    expect(isAdvertisementFresh(reportedAt, t0 + 1 * ADVERTISEMENT_INTERVAL_MS)).toBe(true);
    expect(isAdvertisementFresh(reportedAt, t0 + 2 * ADVERTISEMENT_INTERVAL_MS)).toBe(true);
    // Right up to the edge of the third missed beat: still tolerated.
    expect(isAdvertisementFresh(reportedAt, t0 + 3 * ADVERTISEMENT_INTERVAL_MS - 1)).toBe(true);
    // The freshness window (== 3 * interval) has fully lapsed: the host stops being a candidate.
    expect(isAdvertisementFresh(reportedAt, t0 + 3 * ADVERTISEMENT_INTERVAL_MS)).toBe(false);
    // A fourth missed beat never resurrects it.
    expect(isAdvertisementFresh(reportedAt, t0 + 4 * ADVERTISEMENT_INTERVAL_MS)).toBe(false);
  });

  it('isAdvertiseDue fires once a full interval has elapsed since the last successful advertisement', () => {
    expect(isAdvertiseDue(ADVERTISEMENT_INTERVAL_MS - 1)).toBe(false);
    expect(isAdvertiseDue(ADVERTISEMENT_INTERVAL_MS)).toBe(true);
    expect(isAdvertiseDue(ADVERTISEMENT_INTERVAL_MS + 1)).toBe(true);
  });
});

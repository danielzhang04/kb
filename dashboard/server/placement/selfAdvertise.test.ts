// P6 W6.3: the self-advertisement beat. The named failing case this file gates is the one that made every
// VM launch refuse `409 no-complete-placement`: a booted daemon whose `hostAdvertisements` collection is
// empty because nothing ever sent the advertisement `advertise.ts` knows how to build.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { runtimeCapabilities } from '../runtime/capabilities.ts';
import { decodeHostAdvertisement, ADVERTISEMENT_INTERVAL_MS, isAdvertisementFresh } from './contracts.ts';
import { selectPlacementHost } from './select.ts';
import {
  advertiseSelfOnce,
  resolveDaemonVersion,
  selfAdvertiseLogLine,
  startSelfAdvertiseTimer,
  UNKNOWN_DAEMON_VERSION,
  type SelfAdvertiseStorePort,
} from './selfAdvertise.ts';

const EMPTY_REQUIREMENT = {
  connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: [] as Array<'claude' | 'codex'>,
};

/** A store with NO advertisements — a freshly booted daemon, which is where the 409 came from. */
function emptyStore() {
  return createInMemoryControlPlaneStore({ initialHostAdvertisements: [] });
}

const LINUX_VM = runtimeCapabilities('linux');
const WINDOWS_DESKTOP = runtimeCapabilities('win32');

describe('advertiseSelfOnce — one beat writes the daemon\'s OWN host row', () => {
  it('lands a decodable advertisement in a previously empty store, at version 1', () => {
    const store = emptyStore();
    expect(store.listHostAdvertisements()).toEqual([]);

    const beat = advertiseSelfOnce({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' });

    expect(beat).toMatchObject({ outcome: 'advertised', hostId: 'vm', version: 1 });
    const rows = store.listHostAdvertisements();
    expect(rows).toHaveLength(1);
    const { version, ...body } = rows[0]!;
    expect(version).toBe(1);
    // The row survives the W0 decoder untouched — the store persisted a real advertisement, not a shape.
    expect(decodeHostAdvertisement(body)).toEqual(body);
    expect(body).toMatchObject({ hostId: 'vm', daemonVersion: '1.2.3', pty: false, gpu: false });
  });

  it('takes the host from the composed capability, so the Windows desktop daemon advertises `desktop`', () => {
    const store = emptyStore();
    const beat = advertiseSelfOnce({ store, capabilities: WINDOWS_DESKTOP, daemonVersion: '1.2.3' });
    expect(beat).toMatchObject({ outcome: 'advertised', hostId: 'desktop' });
    expect(store.listHostAdvertisements()[0]).toMatchObject({ hostId: 'desktop', pty: false });
  });

  it('reads `pty` off the composed capability\'s own discriminant, never an OS guess', () => {
    const store = emptyStore();
    advertiseSelfOnce({
      store,
      capabilities: runtimeCapabilities('win32', {
        pty: true, host: 'desktop', launchers: ['shell'], roots: ['repo'], checkedAt: '2026-08-25T00:00:00.000Z',
      }),
      daemonVersion: '1.2.3',
    });
    expect(store.listHostAdvertisements()[0]).toMatchObject({ hostId: 'desktop', pty: true });
  });

  it('replaces its own row under CAS rather than appending a second one', () => {
    const store = emptyStore();
    advertiseSelfOnce({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' });
    const second = advertiseSelfOnce({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' });
    expect(second).toMatchObject({ outcome: 'advertised', version: 2 });
    expect(store.listHostAdvertisements()).toHaveLength(1);
  });

  it('reports a lost CAS race as `conflict` — never an overwrite, never a throw', () => {
    const store: SelfAdvertiseStorePort = {
      listHostAdvertisements: () => [],
      upsertHostAdvertisement: () => ({ ok: false, current: 7 }),
    };
    expect(advertiseSelfOnce({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' }))
      .toEqual({ outcome: 'conflict', hostId: 'vm', current: 7 });
  });

  it('returns `failed` instead of throwing when the store write throws', () => {
    const store: SelfAdvertiseStorePort = {
      listHostAdvertisements: () => [],
      upsertHostAdvertisement: () => { throw new Error('control-plane store exceeds limit'); },
    };
    const beat = advertiseSelfOnce({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' });
    expect(beat.outcome).toBe('failed');
    expect(selfAdvertiseLogLine(beat)).toContain('control-plane store exceeds limit');
  });

  it('returns `failed` instead of throwing when the body cannot be built (bad daemonVersion)', () => {
    const store = emptyStore();
    const beat = advertiseSelfOnce({ store, capabilities: LINUX_VM, daemonVersion: 'BAD VERSION' });
    expect(beat.outcome).toBe('failed');
    expect(store.listHostAdvertisements()).toEqual([]);
  });
});

describe('startSelfAdvertiseTimer — immediate beat, then the shared 30-s interval', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires ONCE IMMEDIATELY: the store has a fresh row before the first interval elapses', () => {
    const store = emptyStore();
    // No `onBeat`: a composition that wants no logging must still advertise (the beat is not an argument
    // to an optional call).
    const stop = startSelfAdvertiseTimer({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' });
    try {
      expect(store.listHostAdvertisements()).toHaveLength(1);
      expect(store.listHostAdvertisements()[0]!.version).toBe(1);
    } finally { stop(); }
  });

  it('refreshes the row on every interval, so `reportedAt` never goes stale', () => {
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'));
    const store = emptyStore();
    const stop = startSelfAdvertiseTimer({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' });
    try {
      const first = store.listHostAdvertisements()[0]!;
      vi.advanceTimersByTime(ADVERTISEMENT_INTERVAL_MS);
      const second = store.listHostAdvertisements()[0]!;
      expect(second.version).toBe(2);
      expect(Date.parse(second.reportedAt)).toBeGreaterThan(Date.parse(first.reportedAt));
      vi.advanceTimersByTime(ADVERTISEMENT_INTERVAL_MS * 3);
      const later = store.listHostAdvertisements()[0]!;
      expect(later.version).toBe(5);
      // Still exactly one row for this host after five beats.
      expect(store.listHostAdvertisements()).toHaveLength(1);
      expect(isAdvertisementFresh(later.reportedAt, Date.now())).toBe(true);
    } finally { stop(); }
  });

  it('a failing beat is reported and the timer keeps running — the daemon never crashes', () => {
    let fail = true;
    const beats: string[] = [];
    const rows: Array<{ version: number }> = [];
    const store: SelfAdvertiseStorePort = {
      listHostAdvertisements: () => [],
      upsertHostAdvertisement: () => {
        if (fail) throw new Error('disk full');
        rows.push({ version: 1 });
        return { ok: true, version: 1 };
      },
    };
    const stop = startSelfAdvertiseTimer({
      store, capabilities: LINUX_VM, daemonVersion: '1.2.3',
      onBeat: (outcome) => beats.push(outcome.outcome),
    });
    try {
      expect(beats).toEqual(['failed']);
      fail = false;
      vi.advanceTimersByTime(ADVERTISEMENT_INTERVAL_MS);
      expect(beats).toEqual(['failed', 'advertised']);
      expect(rows).toHaveLength(1);
    } finally { stop(); }
  });

  it('the stop function clears the interval: no beat lands after shutdown, and stopping twice is safe', () => {
    const store = emptyStore();
    const stop = startSelfAdvertiseTimer({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' });
    expect(store.listHostAdvertisements()[0]!.version).toBe(1);
    stop();
    stop();
    vi.advanceTimersByTime(ADVERTISEMENT_INTERVAL_MS * 10);
    expect(store.listHostAdvertisements()[0]!.version).toBe(1);
  });

  it('defaults to the ONE shared interval constant rather than a second 30_000 literal', () => {
    const store = emptyStore();
    const spy = vi.spyOn(globalThis, 'setInterval');
    const stop = startSelfAdvertiseTimer({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' });
    try {
      expect(spy.mock.calls[0]![1]).toBe(ADVERTISEMENT_INTERVAL_MS);
    } finally { stop(); spy.mockRestore(); }
  });
});

describe('the 409 this exists to remove', () => {
  it('an empty store has no complete placement; ONE self beat makes the daemon\'s own host selectable', () => {
    const store = emptyStore();
    const now = Date.now();
    expect(selectPlacementHost(EMPTY_REQUIREMENT, store.listHostAdvertisements(), now))
      .toEqual({ outcome: 'no-complete-placement' });

    advertiseSelfOnce({ store, capabilities: LINUX_VM, daemonVersion: '1.2.3' });

    expect(selectPlacementHost(EMPTY_REQUIREMENT, store.listHostAdvertisements(), Date.now()))
      .toEqual({ outcome: 'placed', hostId: 'vm' });
  });
});

describe('resolveDaemonVersion', () => {
  it('returns a value the advertisement decoder accepts, and a beat carries it', () => {
    const version = resolveDaemonVersion();
    expect(version).toMatch(/^[a-z0-9][a-z0-9.\-]{0,63}$/);
    const store = emptyStore();
    advertiseSelfOnce({ store, capabilities: LINUX_VM, daemonVersion: version });
    expect(store.listHostAdvertisements()[0]!.daemonVersion).toBe(version);
  });

  it('memoizes: the second call is the same string, and the fallback is a legal version', () => {
    expect(resolveDaemonVersion()).toBe(resolveDaemonVersion());
    expect(UNKNOWN_DAEMON_VERSION).toMatch(/^[a-z0-9][a-z0-9.\-]{0,63}$/);
  });
});

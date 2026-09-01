// P6 W6.3: the self-advertisement beat. The named failing case this file gates is the one that made every
// VM launch refuse `409 no-complete-placement`: a booted daemon whose `hostAdvertisements` collection is
// empty because nothing ever sent the advertisement `advertise.ts` knows how to build.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { runtimeCapabilities } from '../runtime/capabilities.ts';
import { probeRepoSkills } from '../runtime/capabilityProbes.ts';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import { computeCapabilityRequirement } from './requirements.ts';
import {
  decodeHostAdvertisement, ADVERTISEMENT_INTERVAL_MS, isAdvertisementFresh, type CliStatus,
} from './contracts.ts';
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

  // F4: `onBeat` is a caller-supplied sink. If it throws, the throw escapes the SYNCHRONOUS first beat
  // straight out of `buildApp` (boot failure) and, from inside `setInterval`, as an `uncaughtException`
  // (process exit). A logging sink must never be able to kill the daemon.
  it('a THROWING onBeat cannot escape — not from the immediate beat, not from an interval beat', () => {
    const store = emptyStore();
    let calls = 0;
    const stop = startSelfAdvertiseTimer({
      store, capabilities: LINUX_VM, daemonVersion: '1.2.3',
      onBeat: () => { calls += 1; throw new Error('log sink exploded'); },
    });
    try {
      // The immediate beat ran, its sink threw, and construction still returned normally.
      expect(calls).toBe(1);
      expect(store.listHostAdvertisements()).toHaveLength(1);
      // The interval beat also survives, and the advertisement keeps refreshing through it.
      expect(() => vi.advanceTimersByTime(ADVERTISEMENT_INTERVAL_MS * 2)).not.toThrow();
      expect(calls).toBe(3);
      expect(store.listHostAdvertisements()[0]!.version).toBe(3);
    } finally { stop(); }
  });

  // F5: a disabled advertiser must write NOTHING. One row and no timer is the worst of both — it goes
  // stale in 90 s and never refreshes, so launches 409 anyway while the table looks populated.
  it('a non-positive interval disables the beat ENTIRELY: no timer AND no immediate row', () => {
    for (const intervalMs of [0, -1, Number.NaN]) {
      const store = emptyStore();
      const stop = startSelfAdvertiseTimer({
        store, capabilities: LINUX_VM, daemonVersion: '1.2.3', intervalMs,
      });
      try {
        expect(store.listHostAdvertisements(), `interval ${intervalMs}`).toEqual([]);
        vi.advanceTimersByTime(ADVERTISEMENT_INTERVAL_MS * 10);
        expect(store.listHostAdvertisements(), `interval ${intervalMs}`).toEqual([]);
      } finally { stop(); }
    }
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

// F1: the launch sites do NOT all use the empty requirement. `workflows/routes.ts:537` computes a real
// one from the assigned agents, and `placement/requirements.ts` turns each agent's declared `runtime`
// into a `clis` requirement. So an advertisement carrying the fail-closed `clis: missing` default keeps
// every agent- and workflow-owned launch at 409 even though a host IS advertising. This runs the REAL
// repo catalog against the three CLI states so the gap cannot silently come back.
describe('what the real agents/ catalog requires of an advertised host [P6 §3.2]', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const declarations = [...readDeclaredAgentDetails(REPO_ROOT).values()];

  const requirementFor = (declaration: (typeof declarations)[number]) => computeCapabilityRequirement({}, [{
    skills: declaration.skills ?? [],
    connectors: declaration.connectors ?? [],
    filesystemRoots: declaration.filesystemRoots ?? [],
    runtime: declaration.runtime,
  }]);

  const advertisementWith = (clis: { claude: CliStatus; codex: CliStatus }) => {
    const store = emptyStore();
    advertiseSelfOnce({
      store,
      capabilities: { ...LINUX_VM, clis, skills: probeRepoSkills(REPO_ROOT) },
      daemonVersion: '1.2.3',
    });
    return store.listHostAdvertisements();
  };

  const placeable = (clis: { claude: CliStatus; codex: CliStatus }): string[] => {
    const advertisements = advertisementWith(clis);
    const now = Date.now();
    return declarations
      .filter((declaration) => selectPlacementHost(requirementFor(declaration), advertisements, now).outcome === 'placed')
      .map((declaration) => declaration.id)
      .sort();
  };

  const idsWithRuntime = (...runtimes: string[]) => declarations
    .filter((declaration) => declaration.runtime !== null && runtimes.includes(declaration.runtime))
    .map((declaration) => declaration.id).sort();

  it('the fixture is not vacuous: the catalog declares both claude- and codex-runtime agents', () => {
    expect(declarations.length).toBeGreaterThan(0);
    expect(idsWithRuntime('claude').length).toBeGreaterThan(0);
    expect(idsWithRuntime('codex').length).toBeGreaterThan(0);
  });

  it('with BOTH CLIs missing — the VM today — NO agent is placeable, however fresh the advertisement', () => {
    expect(placeable({ claude: 'missing', codex: 'missing' })).toEqual([]);
    // login-required fails exactly like missing (`match()` accepts only 'ready').
    expect(placeable({ claude: 'login-required', codex: 'login-required' })).toEqual([]);
  });

  it('installing claude alone makes exactly the claude-runtime agents placeable', () => {
    expect(placeable({ claude: 'ready', codex: 'missing' })).toEqual(idsWithRuntime('claude'));
  });

  it('installing codex alone makes exactly the codex-runtime agents placeable', () => {
    expect(placeable({ claude: 'missing', codex: 'ready' })).toEqual(idsWithRuntime('codex'));
  });

  it('with both installed every declared agent is placeable on the probed linux advertisement', () => {
    expect(placeable({ claude: 'ready', codex: 'ready' }))
      .toEqual(declarations.map((declaration) => declaration.id).sort());
  });

  it('the probed skills list satisfies every skill the catalog declares', () => {
    const advertised = new Set(probeRepoSkills(REPO_ROOT));
    const declared = declarations.flatMap((declaration) => declaration.skills ?? []);
    expect(declared.filter((skill) => !advertised.has(skill))).toEqual([]);
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

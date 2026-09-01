// P6 W6.3 §3.1: the daemon's SELF-advertisement beat. `advertise.ts` builds and validates the body;
// this module is the sender for the one host the daemon can speak for — its OWN. It composes nothing new:
// the host identity is `runtimeExecutionHost(capabilities)` and the advertised capabilities are the
// composition's own `RuntimeCapabilities`, so `pty` is the composed capability's discriminant and never
// an OS guess. The write is the store's `upsertHostAdvertisement` CAS — the same method the node route's
// `AdvertiseStorePort` names — so a self-beat and a remote `PUT /api/v1/hosts/:hostId` share one writer.
//
// Without this timer `hostAdvertisements` stays empty on a freshly booted daemon and EVERY launch refuses
// `409 no-complete-placement` (control/routes.ts:650, workflows/routes.ts:538, control/queueBridge.ts:693).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAdvertisement } from './advertise.ts';
import { ADVERTISEMENT_INTERVAL_MS, type HostAdvertisement, type HostKind, type StoredHostAdvertisement } from './contracts.ts';
import { runtimeExecutionHost, type RuntimeCapabilities } from '../runtime/capabilities.ts';

export { ADVERTISEMENT_INTERVAL_MS };

/**
 * The exact store slice a self-advertisement needs: the existing read seam for the CAS precondition, and
 * the one production write. Declared structurally so `ControlPlaneStore` satisfies it without this module
 * depending on the whole control-plane surface.
 */
export interface SelfAdvertiseStorePort {
  listHostAdvertisements(): StoredHostAdvertisement[];
  upsertHostAdvertisement(
    advertisement: HostAdvertisement,
    expectedVersion: number | undefined,
  ): { readonly ok: true; readonly version: number } | { readonly ok: false; readonly current: number };
}

/** What one beat did. `conflict` is a lost CAS race, not an error: the next beat re-reads and retries. */
export type SelfAdvertiseOutcome =
  | { readonly outcome: 'advertised'; readonly hostId: HostKind; readonly version: number }
  | { readonly outcome: 'conflict'; readonly hostId: HostKind; readonly current: number }
  | { readonly outcome: 'failed'; readonly error: unknown };

export interface SelfAdvertiseOptions {
  store: SelfAdvertiseStorePort;
  /** The composed capability this daemon publishes on `/api/runtime/capabilities` — never a re-probe. */
  capabilities: RuntimeCapabilities;
  daemonVersion: string;
  now?: () => Date;
}

/**
 * Run ONE beat. Never throws: a decode fault, a store write failure, or a lost CAS all resolve to a
 * returned outcome, because freshness expiry (90 s, `isAdvertisementFresh`) is the safety net — a daemon
 * that cannot advertise must go stale and stop attracting launches, not crash the process.
 */
export function advertiseSelfOnce(options: SelfAdvertiseOptions): SelfAdvertiseOutcome {
  try {
    const hostId = runtimeExecutionHost(options.capabilities);
    const advertisement = buildAdvertisement({
      hostId,
      daemonVersion: options.daemonVersion,
      capabilities: options.capabilities,
      now: options.now ?? (() => new Date()),
    });
    // The CAS precondition is the version this daemon can SEE right now, re-read every beat: the row may
    // have been advanced by a `PUT /api/v1/hosts/:hostId` since the last beat, and `undefined` (no row)
    // is the correct expectation on the very first one.
    const expectedVersion = options.store.listHostAdvertisements()
      .find((row) => row.hostId === hostId)?.version;
    const written = options.store.upsertHostAdvertisement(advertisement, expectedVersion);
    return written.ok
      ? { outcome: 'advertised', hostId, version: written.version }
      : { outcome: 'conflict', hostId, current: written.current };
  } catch (error) {
    return { outcome: 'failed', error };
  }
}

export interface SelfAdvertiseTimerOptions extends SelfAdvertiseOptions {
  /** Defaults to the ONE shared `ADVERTISEMENT_INTERVAL_MS`; `<= 0` or non-finite disables the timer. */
  intervalMs?: number;
  /** Called for every beat, so the composition root decides what (if anything) reaches the daemon log. */
  onBeat?: (outcome: SelfAdvertiseOutcome) => void;
}

/**
 * Register the repeating self-advertisement. Fires ONCE IMMEDIATELY and then every `intervalMs`: an empty
 * advertisements table until the first 30-s beat would 409 every launch in the boot window. The immediate
 * beat is synchronous but cannot throw (see `advertiseSelfOnce`), so it never blocks or fails boot. The
 * returned stop function clears the interval and is idempotent.
 */
export function startSelfAdvertiseTimer(options: SelfAdvertiseTimerOptions): () => void {
  const intervalMs = options.intervalMs ?? ADVERTISEMENT_INTERVAL_MS;
  // The beat runs FIRST and unconditionally: `onBeat?.(advertiseSelfOnce(options))` would short-circuit
  // the whole call expression — argument included — whenever no `onBeat` was supplied, so a composition
  // that wants no logging would silently advertise nothing at all.
  const beat = (): void => {
    const outcome = advertiseSelfOnce(options);
    options.onBeat?.(outcome);
  };
  beat();
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
  const timer = setInterval(beat, intervalMs);
  // Never hold the process open for a beat: the daemon's lifetime is the listener's, not this timer's.
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

/**
 * One daemon-log line for a beat worth narrating, or `null` for the overwhelmingly common successful one
 * (a 30-s cadence must never narrate its own no-ops). A conflict and a failure BOTH get a line: either
 * means this host is drifting toward stale, which silently disables every launch on it.
 */
export function selfAdvertiseLogLine(outcome: SelfAdvertiseOutcome): string | null {
  if (outcome.outcome === 'advertised') return null;
  if (outcome.outcome === 'conflict') {
    return `[self-advertise] CAS conflict for host ${outcome.hostId} (current version ${outcome.current}); retrying next beat`;
  }
  return `[self-advertise] beat failed: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`;
}

/** Fallback when `dashboard/package.json` cannot be read or carries no usable version. */
export const UNKNOWN_DAEMON_VERSION = '0.0.0';

let cachedDaemonVersion: string | undefined;

/**
 * The daemon's version identity: `dashboard/package.json`'s `version`, which every platform release ships
 * (`scripts/build_platform_release.py`'s RELEASE_ROOTS). Display/diagnostics only [§3.1] and never an
 * authorization input, so an unreadable package manifest degrades to {@link UNKNOWN_DAEMON_VERSION}
 * rather than failing the beat. Resolved at most once per process.
 */
export function resolveDaemonVersion(): string {
  if (cachedDaemonVersion !== undefined) return cachedDaemonVersion;
  let version = UNKNOWN_DAEMON_VERSION;
  try {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { version?: unknown };
    // The advertisement decoder's own `daemonVersion` domain, checked here so a package rename can never
    // turn a diagnostic field into a beat that throws on every tick.
    if (typeof manifest.version === 'string' && /^[a-z0-9][a-z0-9.\-]{0,63}$/.test(manifest.version)) {
      version = manifest.version;
    }
  } catch {
    // Unreadable manifest: keep the fallback.
  }
  cachedDaemonVersion = version;
  return version;
}

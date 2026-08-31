// P6 W3 §3.1: build the outbound `HostAdvertisement` body from a composed `RuntimeHostCapabilities`,
// and the freshness/interval relationship a re-advertising daemon relies on. Pure function with an
// injected clock (wave rule) — no timer registration, no HTTP call. `PUT /api/v1/hosts/:hostId` is
// W6.1's route; this module only builds and validates the body it will send.
import type { HostAdvertisement, HostKind } from './contracts.ts';
import { ADVERTISEMENT_FRESHNESS_MS, ADVERTISEMENT_INTERVAL_MS, decodeHostAdvertisement } from './contracts.ts';
import type { RuntimeCapabilities } from '../runtime/capabilities.ts';

export { ADVERTISEMENT_FRESHNESS_MS, ADVERTISEMENT_INTERVAL_MS };

export interface AdvertisementSource {
  hostId: HostKind;
  daemonVersion: string;
  /** The full composed capability — `pty` is ITS discriminant [§3.1:140], never an OS guess. */
  capabilities: RuntimeCapabilities;
  now(): Date;
}

/**
 * Build and validate the `HostAdvertisement` body a daemon sends on its 30-s timer [§3.1]. Every
 * field the decoder can reject (over-bound array, non-canonical name, malformed version) is caught
 * HERE, before the body ever reaches the network, by reusing `decodeHostAdvertisement` — never a
 * second validation pass. `pty` is read straight off the composed capability's own discriminant.
 */
export function buildAdvertisement(source: AdvertisementSource): HostAdvertisement {
  return decodeHostAdvertisement({
    hostId: source.hostId,
    daemonVersion: source.daemonVersion,
    reportedAt: source.now().toISOString(),
    connectors: source.capabilities.connectors,
    skills: source.capabilities.skills,
    filesystemRoots: source.capabilities.filesystemRoots,
    pty: source.capabilities.pty,
    gpu: source.capabilities.gpu,
    clis: source.capabilities.clis,
  });
}

/**
 * Whether `elapsedMs` since the last successful advertisement means the NEXT scheduled beat is
 * already due — i.e. the timer should fire now rather than wait a full interval. Never itself decides
 * freshness (`isAdvertisementFresh` in `contracts.ts` owns that); this is scheduling only.
 */
export function isAdvertiseDue(elapsedMs: number): boolean {
  return elapsedMs >= ADVERTISEMENT_INTERVAL_MS;
}

// P6 W3 §3.2: freshness-aware matching. `normalize.ts` (W0, read-only here) owns the pure per-advertisement
// predicate `match()` and the canonicalisation it depends on — this module never reimplements either. It
// adds the ONE rule normalize.ts does not encode: a stale (>90 s) advertisement is never a candidate,
// whatever its capabilities. `login-required` already fails like `missing` inside `match()` itself
// (`clis[cli] !== 'ready'`), so that rule needs no restating here.
import type { CapabilityRequirement, HostAdvertisement } from './contracts.ts';
import { isAdvertisementFresh } from './contracts.ts';
import { match } from './normalize.ts';

export { match } from './normalize.ts';

/**
 * True iff `advertisement` is fresh against the store's clock AND matches `requirement`. A stale
 * advertisement never reaches `match()` at all — freshness is checked first and short-circuits.
 */
export function matchesFreshAdvertisement(
  requirement: CapabilityRequirement,
  advertisement: HostAdvertisement,
  nowMs: number,
): boolean {
  return isAdvertisementFresh(advertisement.reportedAt, nowMs) && match(requirement, advertisement);
}

/** Every advertisement in `advertisements` that is both fresh and a complete match, order preserved. */
export function freshMatches<T extends HostAdvertisement>(
  requirement: CapabilityRequirement,
  advertisements: readonly T[],
  nowMs: number,
): T[] {
  return advertisements.filter((advertisement) => matchesFreshAdvertisement(requirement, advertisement, nowMs));
}

/**
 * MED — the pending-challenge store must be bounded: repeated auth options-ceremony calls
 * (`rememberChallenge` -> `pending.set`) must not grow the map without bound (a memory-DoS, especially
 * now the pre-session limiter keys on peer IP rather than a rotatable bearer), and expired entries must
 * be swept even when they are never consumed by a matching `consumeChallenge`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  rememberChallenge,
  consumeChallenge,
  __resetPendingForTest,
  __pendingSizeForTest,
  __MAX_PENDING_FOR_TEST,
} from './credentialStore';

afterEach(() => __resetPendingForTest());

describe('pending-challenge store — bounded (memory-DoS guard)', () => {
  it('never grows past the hard cap under unbounded options calls', () => {
    __resetPendingForTest();
    // Insert well past the cap, all at the SAME instant so none is expired — eviction must keep size ≤ cap.
    const now = 1_000_000;
    for (let i = 0; i < __MAX_PENDING_FOR_TEST + 500; i += 1) {
      rememberChallenge(`chal-${i}`, 5 * 60 * 1000, now);
    }
    expect(__pendingSizeForTest()).toBeLessThanOrEqual(__MAX_PENDING_FOR_TEST);
  });

  it('sweeps expired entries on insert even when they were never consumed', () => {
    __resetPendingForTest();
    const t0 = 1_000_000;
    // Stash a handful of short-TTL challenges that no one ever consumes.
    for (let i = 0; i < 10; i += 1) rememberChallenge(`stale-${i}`, 1000, t0);
    expect(__pendingSizeForTest()).toBe(10);
    // A later insert, past the TTL, sweeps every expired entry first.
    rememberChallenge('fresh', 1000, t0 + 5000);
    expect(__pendingSizeForTest()).toBe(1);
  });

  it('still consumes a live challenge exactly once (behaviour preserved)', () => {
    __resetPendingForTest();
    const now = 2_000_000;
    const { ceremonyId, challenge } = rememberChallenge('live', 60_000, now);
    expect(consumeChallenge(ceremonyId, now)).toBe(challenge);
    expect(consumeChallenge(ceremonyId, now)).toBeUndefined();
  });
});

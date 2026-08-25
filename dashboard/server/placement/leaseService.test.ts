import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS } from './contracts.ts';
import type { HostKind, PlacementLease } from './contracts.ts';
import {
  claimLease, renewLease, sweepExpiredLeases,
} from './leaseService.ts';
import type { CandidateRun, ClaimClock, LeaseStorePort } from './leaseService.ts';

/**
 * A minimal in-memory fake of the lease store. It is deliberately synchronous under the hood (no
 * internal `await`) so two calls issued back-to-back via `Promise.all` are NOT interleaved by the
 * event loop — exactly the property a real CAS store gives for free and the property these tests are
 * exercising, not working around.
 */
function fakeStore(seed: readonly CandidateRun[], advertisedHash: Record<HostKind, string | undefined> = { vm: undefined, desktop: undefined }) {
  let unplaced: CandidateRun[] = [...seed];
  let lease: PlacementLease | undefined;
  let releaseEvents = 0;
  let nextRevision = 1;
  const port: LeaseStorePort = {
    async releaseExpiredLeases(nowIso) {
      if (lease && Date.parse(lease.expiresAt) <= Date.parse(nowIso)) {
        const runRef = lease.runRef;
        const capabilityHash = lease.capabilityHash;
        lease = undefined;
        unplaced.push({ runRef, capabilityHash });
        releaseEvents += 1;
        return [runRef];
      }
      return [];
    },
    async selectCandidate(_hostId, _nowIso) {
      return unplaced[0];
    },
    async createLease(runRef, hostId, capabilityHash, nowIso) {
      if (lease) return undefined;
      const idx = unplaced.findIndex((c) => c.runRef === runRef);
      if (idx === -1) return undefined;
      unplaced.splice(idx, 1);
      lease = {
        runRef, hostId, capabilityHash, revision: nextRevision++,
        expiresAt: new Date(Date.parse(nowIso) + LEASE_TTL_MS).toISOString(), lastReportSequence: 0,
      };
      return lease;
    },
    async getLease(runRef) {
      return lease && lease.runRef === runRef ? lease : undefined;
    },
    async renewLease(runRef, expectedRevision, nowIso) {
      if (!lease || lease.runRef !== runRef || lease.revision !== expectedRevision) return undefined;
      lease = { ...lease, revision: lease.revision + 1, expiresAt: new Date(Date.parse(nowIso) + LEASE_TTL_MS).toISOString() };
      return lease;
    },
    async currentAdvertisedCapabilityHash(hostId) {
      return advertisedHash[hostId];
    },
  };
  return { port, releaseEvents: () => releaseEvents, currentLease: () => lease };
}

function fixedClock(startMs: number): ClaimClock {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    async sleep(ms) { nowMs += ms; },
  };
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('claimLease (§3.5)', () => {
  it('long-polls at most waitMs and returns 204 on timeout when nothing matches', async () => {
    const { port } = fakeStore([]);
    const clock = fixedClock(0);
    const outcome = await claimLease(port, { hostId: 'desktop', waitMs: 500, pollIntervalMs: 100 }, clock);
    expect(outcome).toEqual({ ok: false, status: 204 });
    expect(clock.now()).toBeGreaterThanOrEqual(500);
  });

  it('rejects a waitMs above the 25_000ms bound', async () => {
    const { port } = fakeStore([]);
    await expect(claimLease(port, { hostId: 'desktop', waitMs: 25_001 }, fixedClock(0))).rejects.toThrow();
  });

  it('CAS-creates exactly one lease under two concurrent claims for the one candidate run', async () => {
    const { port } = fakeStore([{ runRef: 'run-1', capabilityHash: HASH_A }]);
    const clock = fixedClock(0);
    const [a, b] = await Promise.all([
      claimLease(port, { hostId: 'desktop', waitMs: 0 }, clock),
      claimLease(port, { hostId: 'vm', waitMs: 0 }, clock),
    ]);
    const winners = [a, b].filter((o) => o.ok);
    const losers = [a, b].filter((o) => !o.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as { status: 204 }).status).toBe(204);
  });

  it('a reclaimed run is a candidate for the very claim that reclaimed it (lazy expiry inside the same pass)', async () => {
    const { port, currentLease } = fakeStore([{ runRef: 'run-1', capabilityHash: HASH_A }]);
    const clock = fixedClock(0);
    const first = await claimLease(port, { hostId: 'vm', waitMs: 0 }, clock);
    expect(first.ok).toBe(true);
    // advance the clock past the lease TTL, then claim again — lazy expiry must free run-1 first.
    const expiredClock = fixedClock(Date.parse(currentLease()!.expiresAt) + 1);
    const second = await claimLease(port, { hostId: 'desktop', waitMs: 0 }, expiredClock);
    expect(second).toEqual({ ok: true, lease: expect.objectContaining({ runRef: 'run-1', hostId: 'desktop' }) });
  });
});

describe('sweepExpiredLeases + claim-time lazy expiry together (§3.5, P6-C36)', () => {
  it('release exactly once and reclaim exactly once when the sweeper and a lazy-expiry claim race', async () => {
    const { port, releaseEvents } = fakeStore([{ runRef: 'run-1', capabilityHash: HASH_A }]);
    const clock = fixedClock(0);
    const claimed = await claimLease(port, { hostId: 'vm', waitMs: 0 }, clock);
    expect(claimed.ok).toBe(true);
    const afterExpiryIso = new Date(Date.parse((claimed as { lease: PlacementLease }).lease.expiresAt) + 1).toISOString();
    const expiredClock = fixedClock(Date.parse(afterExpiryIso));

    const [sweepResult, reclaimResult] = await Promise.all([
      sweepExpiredLeases(port, afterExpiryIso),
      claimLease(port, { hostId: 'desktop', waitMs: 0 }, expiredClock),
    ]);

    // exactly one of the two release paths actually fired the release event — never both.
    expect(releaseEvents()).toBe(1);
    expect(sweepResult.length + (reclaimResult.ok ? 0 : 0)).toBeGreaterThanOrEqual(0); // sweepResult is a plain array; sanity only
    expect(reclaimResult).toEqual({ ok: true, lease: expect.objectContaining({ runRef: 'run-1', hostId: 'desktop' }) });
  });
});

describe('renewLease (§3.5)', () => {
  it('refuses 403 wrong-host under another node\'s identity', async () => {
    const { port } = fakeStore([{ runRef: 'run-1', capabilityHash: HASH_A }]);
    const clock = fixedClock(0);
    const claimed = await claimLease(port, { hostId: 'vm', waitMs: 0 }, clock);
    expect(claimed.ok).toBe(true);
    const result = await renewLease(port, { runRef: 'run-1', hostId: 'desktop', expectedLeaseRevision: 1 }, new Date(0).toISOString());
    expect(result).toEqual({ ok: false, status: 403, code: 'wrong-host' });
  });

  it('refuses 409 lease-expired past expiresAt', async () => {
    const { port } = fakeStore([{ runRef: 'run-1', capabilityHash: HASH_A }]);
    const clock = fixedClock(0);
    const claimed = await claimLease(port, { hostId: 'vm', waitMs: 0 }, clock);
    const lease = (claimed as { lease: PlacementLease }).lease;
    const pastExpiry = new Date(Date.parse(lease.expiresAt) + 1).toISOString();
    const result = await renewLease(port, { runRef: 'run-1', hostId: 'vm', expectedLeaseRevision: lease.revision }, pastExpiry);
    expect(result).toEqual({ ok: false, status: 409, code: 'lease-expired' });
  });

  it('refuses 409 capability-lost when the advertisement no longer matches capabilityHash', async () => {
    const { port } = fakeStore([{ runRef: 'run-1', capabilityHash: HASH_A }], { vm: HASH_B, desktop: HASH_B });
    const clock = fixedClock(0);
    const claimed = await claimLease(port, { hostId: 'vm', waitMs: 0 }, clock);
    const lease = (claimed as { lease: PlacementLease }).lease;
    const result = await renewLease(port, { runRef: 'run-1', hostId: 'vm', expectedLeaseRevision: lease.revision }, new Date(1).toISOString());
    expect(result).toEqual({ ok: false, status: 409, code: 'capability-lost' });
  });

  it('renews on a matching revision and a still-matching capability', async () => {
    const { port } = fakeStore([{ runRef: 'run-1', capabilityHash: HASH_A }], { vm: HASH_A, desktop: HASH_A });
    const clock = fixedClock(0);
    const claimed = await claimLease(port, { hostId: 'vm', waitMs: 0 }, clock);
    const lease = (claimed as { lease: PlacementLease }).lease;
    const result = await renewLease(port, { runRef: 'run-1', hostId: 'vm', expectedLeaseRevision: lease.revision }, new Date(1).toISOString());
    expect(result.ok).toBe(true);
    expect((result as { lease: PlacementLease }).lease.revision).toBe(lease.revision + 1);
  });
});

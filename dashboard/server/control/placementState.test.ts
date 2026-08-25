import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_TTL_MS,
  assertPlacementCollections,
  claimLease,
  getOrCreateCursorSecret,
  reclaimExpiredLeases,
  renewLease,
  sweepExpiredIdempotency,
  sweepPlacementState,
  type PlacementCollections,
} from './placementState.ts';
import { LEASE_TTL_MS } from '../placement/contracts.ts';

const HASH = 'a'.repeat(64);
const T0 = Date.parse('2026-08-24T00:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

const empty = (): PlacementCollections => ({
  hostAdvertisements: [],
  placementLeases: [],
  v1Idempotency: [],
});

const lease = (runRef: string, expiresAt: string, over: Record<string, unknown> = {}) => ({
  runRef, hostId: 'vm' as const, capabilityHash: HASH, revision: 1, expiresAt, lastReportSequence: 0, ...over,
});

const idempotencyRow = (createdAt: string, over: Record<string, unknown> = {}) => ({
  actorOrNodeId: 'node-vm', method: 'POST' as const, uri: '/api/v1/runs/run-1/reports', key: 'k'.repeat(16),
  bodyHash: HASH, status: 200, responseBody: '{}', createdAt, ...over,
});

describe('placement store state', () => {
  it('claims exactly one lease per runRef; a second claim is refused, never a second row', () => {
    const c = empty();
    const first = claimLease(c, { runRef: 'run-1', hostId: 'vm', capabilityHash: HASH }, T0);
    expect(first.ok).toBe(true);
    const second = claimLease(c, { runRef: 'run-1', hostId: 'desktop', capabilityHash: HASH }, T0);
    expect(second).toMatchObject({ ok: false, reason: 'already-leased' });
    expect(c.placementLeases).toHaveLength(1);
    expect(c.placementLeases[0]).toMatchObject({ runRef: 'run-1', hostId: 'vm', revision: 1 });
  });

  it('two concurrent claims on the same runRef resolve to exactly one lease (split-brain)', () => {
    const c = empty();
    const results = [
      claimLease(c, { runRef: 'run-x', hostId: 'vm', capabilityHash: HASH }, T0),
      claimLease(c, { runRef: 'run-x', hostId: 'desktop', capabilityHash: HASH }, T0),
    ];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(c.placementLeases).toHaveLength(1);
  });

  it('claim-time lazy expiry reclaims an expired lease exactly once and makes the run claimable again', () => {
    const c = empty();
    c.placementLeases = [lease('run-old', iso(T0 - 1))]; // already expired
    // A claim for a DIFFERENT run reclaims the expired lease first, freeing it exactly once.
    const claimOther = claimLease(c, { runRef: 'run-new', hostId: 'vm', capabilityHash: HASH }, T0);
    expect(claimOther.ok && claimOther.reclaimed).toEqual(['run-old']);
    expect(c.placementLeases.map((l) => l.runRef).sort()).toEqual(['run-new']);
    // The reclaimed run is now itself claimable (exactly once — a re-claim of run-old succeeds).
    const reclaim = claimLease(c, { runRef: 'run-old', hostId: 'desktop', capabilityHash: HASH }, T0);
    expect(reclaim.ok).toBe(true);
    expect(reclaim.ok && reclaim.reclaimed).toEqual([]); // nothing left to reclaim the second time
  });

  it('the 60-s sweeper and lazy expiry each reclaim an expired lease exactly once and are idempotent', () => {
    const c = empty();
    c.placementLeases = [lease('run-a', iso(T0 - 1)), lease('run-b', iso(T0 + LEASE_TTL_MS))];
    const firstSweep = sweepPlacementState(c, T0);
    expect(firstSweep.releasedLeases).toEqual(['run-a']);
    // Idempotent: a concurrent/repeat sweep frees nothing further, and the live lease is untouched.
    expect(sweepPlacementState(c, T0).releasedLeases).toEqual([]);
    expect(reclaimExpiredLeases(c, T0)).toEqual([]);
    expect(c.placementLeases.map((l) => l.runRef)).toEqual(['run-b']);
  });

  it('the same sweeper expires 24-h idempotency rows and keeps fresh ones', () => {
    const c = empty();
    c.v1Idempotency = [
      idempotencyRow(iso(T0 - IDEMPOTENCY_TTL_MS)), // exactly at TTL -> expired
      idempotencyRow(iso(T0 - 1000), { key: 'f'.repeat(16) }), // fresh
    ];
    const removed = sweepExpiredIdempotency(c, T0);
    expect(removed).toHaveLength(1);
    expect(c.v1Idempotency).toHaveLength(1);
    expect(c.v1Idempotency[0]!.key).toBe('f'.repeat(16));
    expect(sweepExpiredIdempotency(c, T0)).toHaveLength(0); // idempotent
  });

  it('renew refuses after expiry and enforces the revision + host CAS', () => {
    const c = empty();
    c.placementLeases = [lease('run-1', iso(T0 + LEASE_TTL_MS))];
    expect(renewLease(c, { runRef: 'run-1', hostId: 'desktop', expectedRevision: 1 }, T0))
      .toMatchObject({ ok: false, reason: 'wrong-host' });
    expect(renewLease(c, { runRef: 'run-1', hostId: 'vm', expectedRevision: 9 }, T0))
      .toMatchObject({ ok: false, reason: 'revision-mismatch' });
    const ok = renewLease(c, { runRef: 'run-1', hostId: 'vm', expectedRevision: 1 }, T0);
    expect(ok).toMatchObject({ ok: true });
    expect(c.placementLeases[0]!.revision).toBe(2);
    // After expiry a renew is refused rather than resurrecting the lease.
    c.placementLeases = [lease('run-2', iso(T0 - 1))];
    expect(renewLease(c, { runRef: 'run-2', hostId: 'vm', expectedRevision: 1 }, T0))
      .toMatchObject({ ok: false, reason: 'lease-expired' });
  });

  it('refuses an extra field on any of the three placement records (exact-key wall)', () => {
    const withLease = empty();
    withLease.placementLeases = [lease('run-1', iso(T0 + LEASE_TTL_MS), { extra: true }) as never];
    expect(() => assertPlacementCollections(withLease)).toThrow();

    const withRow = empty();
    withRow.v1Idempotency = [idempotencyRow(iso(T0), { extra: true }) as never];
    expect(() => assertPlacementCollections(withRow)).toThrow();

    const withAd = empty();
    withAd.hostAdvertisements = [{
      hostId: 'vm', daemonVersion: 'abc', reportedAt: iso(T0), connectors: [], skills: [], filesystemRoots: [],
      pty: true, gpu: false, clis: { claude: 'ready', codex: 'ready' }, version: 1, extra: true,
    } as never];
    expect(() => assertPlacementCollections(withAd)).toThrow();
  });

  it('accepts clean placement collections through the exact-key decoders', () => {
    const c = empty();
    c.placementLeases = [lease('run-1', iso(T0 + LEASE_TTL_MS))];
    c.v1Idempotency = [idempotencyRow(iso(T0))];
    c.hostAdvertisements = [{
      hostId: 'vm', daemonVersion: 'abc', reportedAt: iso(T0), connectors: [], skills: [], filesystemRoots: [],
      pty: true, gpu: false, clis: { claude: 'ready', codex: 'ready' }, version: 1,
    }];
    expect(() => assertPlacementCollections(c)).not.toThrow();
  });

  it('mints the cursor secret once and it survives a reopen (JSON round-trip)', () => {
    const c = empty();
    const secret = getOrCreateCursorSecret(c);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(getOrCreateCursorSecret(c)).toBe(secret); // stable within the same document
    const reopened = JSON.parse(JSON.stringify(c)) as PlacementCollections; // simulate persist + reopen
    expect(getOrCreateCursorSecret(reopened)).toBe(secret); // survives the reopen
  });
});

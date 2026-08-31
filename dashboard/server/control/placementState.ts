// P6 W1 [P6-C36, P6-C37, P6-C41, P6-C48, P6-C59]: the store-side placement collection operations — the
// lease claim/renew CAS (one row per runRef, so split brain is impossible by construction), the two
// reclaim paths (claim-time lazy expiry and the 60-s sweeper), the 24 h `v1Idempotency` TTL sweep, and
// the persisted cursor secret. Record shapes and their exact-key decoders are W0 contracts, imported
// here and never re-declared: this module only manages the collections, it does not re-validate a body.
import { randomBytes } from 'node:crypto';
import {
  LEASE_TTL_MS,
  decodeHostAdvertisement,
  decodePlacementLease,
  type HostKind,
  type PlacementLease,
  type StoredHostAdvertisement,
} from '../placement/contracts.ts';
import { decodeV1IdempotencyRecord, type V1IdempotencyRecord } from '../api/v1/idempotency.ts';

/** A `v1Idempotency` row is swept once it is 24 h old [§3.4:205, P6-C37]. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** The subset of the store document this module reads and mutates. */
export interface PlacementCollections {
  hostAdvertisements: StoredHostAdvertisement[];
  placementLeases: PlacementLease[];
  v1Idempotency: V1IdempotencyRecord[];
  /**
   * The per-store HMAC key for opaque v1 cursors [P6-C41]. Additive and optional on the SAME versioned
   * document — absent reads as "not yet minted", is generated once, and then survives every reopen,
   * so a cursor minted on one daemon verifies on the other. Never a placement input.
   */
  cursorSecret?: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Release every lease whose `expiresAt` is at or before `nowMs`, returning the freed `runRef`s in row
 * order. Idempotent: a second call (or a concurrent one on the same document) frees nothing further,
 * because the expired rows are already gone. This is the shared core of BOTH reclaim paths [P6-C36].
 */
export function reclaimExpiredLeases(collections: PlacementCollections, nowMs: number): string[] {
  const released: string[] = [];
  collections.placementLeases = collections.placementLeases.filter((lease) => {
    if (Date.parse(lease.expiresAt) <= nowMs) {
      released.push(lease.runRef);
      return false;
    }
    return true;
  });
  return released;
}

export type ClaimResult =
  | { readonly ok: true; readonly lease: PlacementLease; readonly reclaimed: readonly string[] }
  | { readonly ok: false; readonly reason: 'already-leased'; readonly lease: PlacementLease };

/**
 * Claim a lease for `runRef`. The claim first runs lazy expiry under the SAME transaction, so a run
 * whose lease just expired is claimable by the very claim that reclaimed it [P6-C36]. `runRef` is the
 * primary key: if a live lease already exists the claim is refused rather than creating a second row,
 * which is what makes concurrent claims resolve to exactly one lease [§3.5 split-brain].
 */
export function claimLease(
  collections: PlacementCollections,
  input: { runRef: string; hostId: HostKind; capabilityHash: string },
  nowMs: number,
): ClaimResult {
  const reclaimed = reclaimExpiredLeases(collections, nowMs);
  const held = collections.placementLeases.find((lease) => lease.runRef === input.runRef);
  if (held) return { ok: false, reason: 'already-leased', lease: held };
  const lease = decodePlacementLease({
    runRef: input.runRef,
    hostId: input.hostId,
    capabilityHash: input.capabilityHash,
    revision: 1,
    expiresAt: iso(nowMs + LEASE_TTL_MS),
    lastReportSequence: 0,
  });
  collections.placementLeases.push(lease);
  return { ok: true, lease, reclaimed };
}

export type RenewResult =
  | { readonly ok: true; readonly lease: PlacementLease }
  | { readonly ok: false; readonly reason: 'lease-expired' | 'not-found' | 'revision-mismatch' | 'wrong-host' };

/**
 * Renew an existing lease under a revision CAS. A renew AFTER expiry is refused rather than resurrecting
 * the lease (`expiresAt` from claim/renew is authoritative) [§3.1]; a revision or host mismatch is a
 * refusal, never a silent overwrite.
 */
export function renewLease(
  collections: PlacementCollections,
  input: { runRef: string; hostId: HostKind; expectedRevision: number },
  nowMs: number,
): RenewResult {
  const index = collections.placementLeases.findIndex((lease) => lease.runRef === input.runRef);
  if (index === -1) return { ok: false, reason: 'not-found' };
  const current = collections.placementLeases[index]!;
  if (Date.parse(current.expiresAt) <= nowMs) return { ok: false, reason: 'lease-expired' };
  if (current.hostId !== input.hostId) return { ok: false, reason: 'wrong-host' };
  if (current.revision !== input.expectedRevision) return { ok: false, reason: 'revision-mismatch' };
  const renewed = decodePlacementLease({
    ...current,
    revision: current.revision + 1,
    expiresAt: iso(nowMs + LEASE_TTL_MS),
  });
  collections.placementLeases[index] = renewed;
  return { ok: true, lease: renewed };
}

/**
 * Remove every `v1Idempotency` row that has reached its 24 h TTL, returning the removed rows. Run by the
 * same 60-s sweeper that reclaims expired leases [§3.4, P6-C37]; idempotent for the same reason.
 */
export function sweepExpiredIdempotency(collections: PlacementCollections, nowMs: number): V1IdempotencyRecord[] {
  const removed: V1IdempotencyRecord[] = [];
  collections.v1Idempotency = collections.v1Idempotency.filter((row) => {
    if (nowMs - Date.parse(row.createdAt) >= IDEMPOTENCY_TTL_MS) {
      removed.push(row);
      return false;
    }
    return true;
  });
  return removed;
}

export interface SweepResult {
  readonly releasedLeases: readonly string[];
  readonly expiredIdempotency: readonly V1IdempotencyRecord[];
}

/** The 60-s sweeper body: reclaim expired leases AND expire stale idempotency rows in one pass. */
export function sweepPlacementState(collections: PlacementCollections, nowMs: number): SweepResult {
  return {
    releasedLeases: reclaimExpiredLeases(collections, nowMs),
    expiredIdempotency: sweepExpiredIdempotency(collections, nowMs),
  };
}

/**
 * Decode every placement collection through its W0 exact-key decoder, so an extra field on ANY of the
 * three records is a decode failure rather than silently persisted state. Returns the canonical rows.
 */
export function assertPlacementCollections(collections: PlacementCollections): void {
  for (const advertisement of collections.hostAdvertisements) {
    const { version, ...body } = advertisement;
    decodeHostAdvertisement(body);
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new Error('invalid stored host advertisement version');
    }
  }
  for (const lease of collections.placementLeases) decodePlacementLease(lease);
  for (const row of collections.v1Idempotency) decodeV1IdempotencyRecord(row);
}

/**
 * Return the store's persisted cursor secret, minting it once on first use [P6-C41]. The caller commits
 * the document, so a freshly minted secret is durable and identical on every subsequent reopen.
 */
export function getOrCreateCursorSecret(collections: PlacementCollections): string {
  if (typeof collections.cursorSecret === 'string' && collections.cursorSecret.length >= 32) {
    return collections.cursorSecret;
  }
  collections.cursorSecret = randomBytes(32).toString('hex');
  return collections.cursorSecret;
}

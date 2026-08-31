// P6 W5 §3.5: the lease CAS service. Claim long-polls, releasing expired leases INSIDE the same pass
// before it ever selects a candidate [P6-C36 lazy-expiry half]; renew refuses `wrong-host`,
// `lease-expired`, and `capability-lost`. `sweepExpiredLeases` is the SAME release primitive
// (`port.releaseExpiredLeases`) invoked on a timer by the VM daemon [P6-C36 sweeper half] — this file
// owns both call sites so the two mechanisms are provably the one idempotent operation, never two.
//
// This file NEVER imports `control/store.ts`. It reads/writes lease state ONLY through the injected
// `LeaseStorePort` below — the store-side implementation of that port is W1's [plan §5 W1/W5].
import { MAX_CLAIM_WAIT_MS } from '../api/v1/contracts.ts';
import type { HostKind, PlacementLease } from './contracts.ts';

/** A run this host could be handed next; `capabilityHash` is the requirement it was placed against. */
export interface CandidateRun {
  readonly runRef: string;
  readonly capabilityHash: string;
}

export interface LeaseStorePort {
  /**
   * Release every lease whose `expiresAt <= nowIso`, atomically per lease, and return the released
   * `runRef`s. MUST be idempotent: calling it twice for the same already-released lease returns it
   * in the released list at most once across the two calls combined (i.e. the second call sees
   * nothing left to release) [P6-C36].
   */
  releaseExpiredLeases(nowIso: string): Promise<readonly string[]>;
  /** The oldest unplaced run this host can serve (W3's `select.ts` is the real chooser); `undefined` when none. */
  selectCandidate(hostId: HostKind, nowIso: string): Promise<CandidateRun | undefined>;
  /** CAS-create a lease for `runRef`/`hostId`; `undefined` when a lease already exists (another claim won). */
  createLease(runRef: string, hostId: HostKind, capabilityHash: string, nowIso: string): Promise<PlacementLease | undefined>;
  getLease(runRef: string): Promise<PlacementLease | undefined>;
  /** CAS renew: bumps `revision` and `expiresAt` iff `expectedLeaseRevision` matches; `undefined` on CAS loss. */
  renewLease(runRef: string, expectedLeaseRevision: number, nowIso: string): Promise<PlacementLease | undefined>;
  /** The host's current advertised `capabilityHash`; `undefined` when no fresh advertisement exists at all. */
  currentAdvertisedCapabilityHash(hostId: HostKind): Promise<string | undefined>;
}

export interface ClaimClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface ClaimInput {
  readonly hostId: HostKind;
  readonly waitMs: number;
  readonly pollIntervalMs?: number;
}

export type ClaimOutcome =
  | { readonly ok: true; readonly lease: PlacementLease }
  | { readonly ok: false; readonly status: 204 };

/**
 * Claim: long-poll to `waitMs <= 25_000`. Every iteration first reclaims expired leases under the
 * same pass [P6-C36], so a reclaimed run is a candidate for the very claim that reclaimed it, then
 * CAS-creates a lease. Times out `204` at `waitMs`; never blocks past it.
 */
export async function claimLease(port: LeaseStorePort, input: ClaimInput, clock: ClaimClock): Promise<ClaimOutcome> {
  if (!Number.isInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > MAX_CLAIM_WAIT_MS) {
    throw new RangeError(`claimLease: waitMs must be an integer 0..${MAX_CLAIM_WAIT_MS}`);
  }
  const pollMs = input.pollIntervalMs ?? 50;
  const deadline = clock.now() + input.waitMs;
  for (;;) {
    const nowIso = new Date(clock.now()).toISOString();
    await port.releaseExpiredLeases(nowIso);
    const candidate = await port.selectCandidate(input.hostId, nowIso);
    if (candidate) {
      const lease = await port.createLease(candidate.runRef, input.hostId, candidate.capabilityHash, nowIso);
      if (lease) return { ok: true, lease };
      continue; // lost the CAS race to another claimant; try again immediately
    }
    if (clock.now() >= deadline) return { ok: false, status: 204 };
    await clock.sleep(Math.min(pollMs, Math.max(0, deadline - clock.now())));
  }
}

/**
 * The 60-s sweeper's whole body [P6-C36]: the SAME `releaseExpiredLeases` call `claimLease` makes,
 * invoked on a timer instead of at claim time, so runs nobody is claiming still get reclaimed.
 */
export async function sweepExpiredLeases(port: LeaseStorePort, nowIso: string): Promise<readonly string[]> {
  return port.releaseExpiredLeases(nowIso);
}

export type RenewRefusal =
  | { readonly ok: false; readonly status: 403; readonly code: 'wrong-host' }
  | { readonly ok: false; readonly status: 409; readonly code: 'lease-expired' }
  | { readonly ok: false; readonly status: 409; readonly code: 'capability-lost' };

export type RenewOutcome = { readonly ok: true; readonly lease: PlacementLease } | RenewRefusal;

export interface RenewInput {
  readonly runRef: string;
  readonly hostId: HostKind;
  readonly expectedLeaseRevision: number;
}

/**
 * Renew: `403 wrong-host` under another node's identity (lease theft), `409 lease-expired` past
 * `expiresAt` or on a CAS loss, `409 capability-lost` when the host's live advertisement no longer
 * satisfies the lease's `capabilityHash` [§3.5, §6].
 */
export async function renewLease(port: LeaseStorePort, input: RenewInput, nowIso: string): Promise<RenewOutcome> {
  const existing = await port.getLease(input.runRef);
  if (!existing) return { ok: false, status: 409, code: 'lease-expired' };
  if (existing.hostId !== input.hostId) return { ok: false, status: 403, code: 'wrong-host' };
  if (Date.parse(existing.expiresAt) <= Date.parse(nowIso)) return { ok: false, status: 409, code: 'lease-expired' };
  const currentHash = await port.currentAdvertisedCapabilityHash(input.hostId);
  if (currentHash !== undefined && currentHash !== existing.capabilityHash) {
    return { ok: false, status: 409, code: 'capability-lost' };
  }
  const renewed = await port.renewLease(input.runRef, input.expectedLeaseRevision, nowIso);
  if (!renewed) return { ok: false, status: 409, code: 'lease-expired' };
  return { ok: true, lease: renewed };
}

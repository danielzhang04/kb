/**
 * U2 — the WebAuthn credential store the session-minting assertion path verifies against, plus the
 * short-lived pending-challenge store for the register/assert ceremonies.
 *
 * FAIL-CLOSED BY DESIGN. `resolveCredentials()` returns `[]` unless a human has provisioned a passkey
 * into `DASHBOARD_WEBAUTHN_CREDENTIALS` — mirroring the fail-closed stance of
 * `security/origin.ts#resolveAllowedOrigins` (empty allowlist rejects everything) and
 * `auth/webauthn.ts#resolveWebAuthnConfig` (throws when the RP origin is unset). With no registered
 * credential, `POST /api/auth/assert/verify` has nothing to verify a login assertion against and
 * refuses with 401 — so NO session can be minted, so EVERY mutating route stays 401-locked. This is
 * the "EXPECTED_CRED_STORE_SHA256=None until a human registers a passkey" reality on the TS session
 * leg: the routes exist and reject cleanly, they are never worked around.
 *
 * This module never CREATES, PERSISTS, or MODIFIES a credential store — enrollment (writing a verified
 * public-key credential into the trusted store) is a deliberate out-of-band human step, consistent
 * with CLAUDE.md's hard ceiling on handling credential stores as objects. `verifyRegistration`'s
 * endpoint exists and reports `verified`, but this daemon never auto-trusts its output for minting.
 *
 * The pending-challenge store is in-memory + TTL-bounded (single-process daemon, same rationale as
 * `auth/nonce.ts`): a ceremony's server-issued challenge is stashed under an opaque ceremony id and
 * consumed exactly once at verify time, so a verify cannot be replayed against a stale/forged challenge.
 */
import { randomBytes } from 'node:crypto';
import type { WebAuthnCredential } from '@simplewebauthn/server';

/** The JSON shape one registered credential takes in `DASHBOARD_WEBAUTHN_CREDENTIALS`. `publicKey` is
 *  base64url-encoded COSE bytes; `id` is the base64url credential id SimpleWebAuthn expects. */
interface StoredCredentialJSON {
  id: string;
  publicKey: string;
  counter?: number;
  transports?: WebAuthnCredential['transports'];
}

/**
 * Resolve the registered credentials from the environment. Fail-closed: `[]` when
 * `DASHBOARD_WEBAUTHN_CREDENTIALS` is unset, empty, or unparseable — an unparseable value is treated as
 * "no credentials" (never as "trust everything"), so a malformed provisioning can only ever lock the
 * surface tighter, never open it.
 */
export function resolveCredentials(
  env: Record<string, string | undefined> = process.env,
): WebAuthnCredential[] {
  const raw = env.DASHBOARD_WEBAUTHN_CREDENTIALS?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const creds: WebAuthnCredential[] = [];
  for (const entry of parsed as StoredCredentialJSON[]) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.publicKey !== 'string') continue;
    creds.push({
      id: entry.id,
      publicKey: new Uint8Array(Buffer.from(entry.publicKey, 'base64url')),
      counter: typeof entry.counter === 'number' ? entry.counter : 0,
      transports: entry.transports,
    });
  }
  return creds;
}

/** Look up a stored credential by its base64url id (`resp.id` off a browser assertion). `undefined`
 *  when the store has no such credential — the fail-closed 401 path. */
export function findCredential(credentials: WebAuthnCredential[], id: string): WebAuthnCredential | undefined {
  return credentials.find((c) => c.id === id);
}

interface PendingRecord {
  challenge: string;
  issuedAt: number;
  ttlMs: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough for a biometric round trip.

/** Hard ceiling on concurrently-pending ceremonies. Without it, hammering the auth options ceremonies
 *  (each a `rememberChallenge` -> `pending.set`) grows the map without bound — a memory-DoS, especially now the
 *  pre-session limiter keys on peer IP (an unauthenticated attacker still gets one bucket, but a single
 *  IP could otherwise still balloon the map between sweeps). Entries otherwise evict only on a matching
 *  `consumeChallenge`, so we ALSO sweep expired entries and cap the live size on every insert. */
const MAX_PENDING = 1024;

const pending = new Map<string, PendingRecord>();

/** Drop every expired entry (issuedAt + ttl in the past). O(n) but bounded by {@link MAX_PENDING}. */
function sweepExpired(now: number): void {
  for (const [id, rec] of pending) {
    if (now - rec.issuedAt > rec.ttlMs) pending.delete(id);
  }
}

export interface PendingChallenge {
  /** Opaque id the client echoes back at verify time so the server recovers the exact issued challenge. */
  ceremonyId: string;
  /** The base64url challenge to embed in the browser ceremony options. */
  challenge: string;
}

/** Stash a ceremony's server-issued `challenge` under a fresh opaque id; returns both. */
export function rememberChallenge(challenge: string, ttlMs: number = DEFAULT_TTL_MS, now: number = Date.now()): PendingChallenge {
  // MED: bound the map so repeated options calls can't balloon it. Sweep expired first; if still at the
  // cap with all-live entries, evict the oldest (Map preserves insertion order) so size never exceeds it.
  sweepExpired(now);
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  const ceremonyId = randomBytes(18).toString('base64url');
  pending.set(ceremonyId, { challenge, issuedAt: now, ttlMs });
  return { ceremonyId, challenge };
}

/**
 * Consume a pending challenge exactly once. Returns the stashed challenge string the first time for a
 * live, unexpired ceremony id; `undefined` on every subsequent call, on an unknown id, or on an expired
 * one (which is also evicted). Fail-closed: there is no path that returns a challenge this store did
 * not itself issue and has not already spent.
 */
export function consumeChallenge(ceremonyId: string, now: number = Date.now()): string | undefined {
  const rec = pending.get(ceremonyId);
  if (!rec) return undefined;
  pending.delete(ceremonyId);
  if (now - rec.issuedAt > rec.ttlMs) return undefined;
  return rec.challenge;
}

/** Test-only reset of the in-memory pending store (never called in production). */
export function __resetPendingForTest(): void {
  pending.clear();
}

/** Test-only view of the live pending-store size (never called in production). */
export function __pendingSizeForTest(): number {
  return pending.size;
}

/** Test-only view of the memory-DoS ceiling (never called in production). */
export const __MAX_PENDING_FOR_TEST = MAX_PENDING;

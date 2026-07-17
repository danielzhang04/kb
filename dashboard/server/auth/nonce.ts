/**
 * Single-use nonce store for challenge freshness (D2.2). A nonce is minted per approval attempt and
 * folded into the WebAuthn challenge (see `challenge.ts`); consuming it exactly once at verification
 * time (D2.3) is what defeats a replayed assertion. In-memory, TTL-bounded — this is a same-process
 * dashboard daemon (v0), so no external store is warranted (and none is available without an npm
 * dependency, which this task may not add).
 *
 * Fail-closed: an unknown, already-consumed, or expired nonce all consume as `false`. There is no
 * path that returns `true` for a nonce this store did not itself mint and has not already spent.
 */
import { randomBytes } from 'node:crypto';

interface NonceRecord {
  issuedAt: number;
  consumed: boolean;
  ttlMs: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough for a biometric prompt round trip.

const store = new Map<string, NonceRecord>();

/**
 * Mint a fresh, unguessable nonce and register it as unconsumed. `now`/`ttlMs` are injectable seams
 * for deterministic tests; production call sites take the defaults.
 */
export function issueNonce(ttlMs: number = DEFAULT_TTL_MS, now: number = Date.now()): string {
  const nonce = randomBytes(18).toString('base64url');
  store.set(nonce, { issuedAt: now, consumed: false, ttlMs });
  return nonce;
}

/**
 * Consume a nonce exactly once. Returns `true` the first time for a live, unexpired nonce; `false`
 * on every subsequent call for that nonce, on an unknown nonce, or on one whose TTL has elapsed
 * (which is also evicted, so the store does not grow unbounded with expired entries).
 */
export function consumeNonce(nonce: string, now: number = Date.now()): boolean {
  const rec = store.get(nonce);
  if (!rec) return false;
  if (rec.consumed) return false;
  if (now - rec.issuedAt > rec.ttlMs) {
    store.delete(nonce);
    return false;
  }
  rec.consumed = true;
  return true;
}

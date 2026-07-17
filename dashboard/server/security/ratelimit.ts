/**
 * D2.9 — throttling + lockout, independent of any single write endpoint's own logic.
 *
 * `rateLimit` is a plain sliding-window limiter keyed by an arbitrary string (session id, IP, card
 * id, ...). `lockout` wraps a limiter with escalation: once a key racks up enough *consecutive*
 * throttled decisions, it is locked out entirely for a fixed duration — even once the underlying
 * window would otherwise allow a request again. Every write endpoint's middleware is expected to
 * consult a `lockout`-wrapped limiter before doing any work.
 *
 * Both take an injectable clock (`now`) so tests are deterministic and never sleep on a wall clock.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimitConfig {
  /** Max allowed hits inside the rolling window before throttling begins. */
  limit: number;
  /** Rolling window size, ms. */
  windowMs: number;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: 'throttled'; retryAfterMs: number };

export interface RateLimiter {
  /** Consult (and consume, on success) the limiter for `key`. */
  check(key: string): RateLimitDecision;
}

/** A sliding-window rate limiter: at most `limit` hits per `windowMs`, per key. */
export function rateLimit(config: RateLimitConfig): RateLimiter {
  const now = config.now ?? Date.now;
  const hitsByKey = new Map<string, number[]>();

  return {
    check(key: string): RateLimitDecision {
      const t = now();
      const hits = (hitsByKey.get(key) ?? []).filter((h) => t - h < config.windowMs);

      if (hits.length >= config.limit) {
        hitsByKey.set(key, hits);
        const oldest = hits[0];
        return { allowed: false, reason: 'throttled', retryAfterMs: config.windowMs - (t - oldest) };
      }

      hits.push(t);
      hitsByKey.set(key, hits);
      return { allowed: true, remaining: config.limit - hits.length };
    },
  };
}

export interface LockoutConfig {
  /** Consecutive throttled decisions before a key is locked out entirely. */
  threshold: number;
  /** Lockout duration once imposed, ms. */
  lockoutMs: number;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

export type GuardDecision =
  | { allowed: true; remaining?: number }
  | { allowed: false; reason: 'throttled' | 'locked-out'; retryAfterMs: number };

export interface LockoutGuard {
  check(key: string): GuardDecision;
}

/**
 * Wrap `limiter` with lockout escalation: once a key hits `threshold` *consecutive* throttled
 * decisions, it is locked out for `lockoutMs` regardless of what the underlying window would allow —
 * a burst of retries against a throttle does not reset the clock early. A single allowed hit resets
 * the consecutive-throttle streak. The lockout itself expires (and the streak resets) after
 * `lockoutMs` elapses.
 */
export function lockout(limiter: RateLimiter, config: LockoutConfig): LockoutGuard {
  const now = config.now ?? Date.now;
  const streaks = new Map<string, number>();
  const lockedUntil = new Map<string, number>();

  return {
    check(key: string): GuardDecision {
      const t = now();
      const until = lockedUntil.get(key) ?? 0;

      if (until > t) {
        return { allowed: false, reason: 'locked-out', retryAfterMs: until - t };
      }
      if (until !== 0) {
        // Lockout has expired: clear it and give the key a clean slate.
        lockedUntil.delete(key);
        streaks.delete(key);
      }

      const decision = limiter.check(key);
      if (decision.allowed) {
        streaks.delete(key);
        return decision;
      }

      const streak = (streaks.get(key) ?? 0) + 1;
      streaks.set(key, streak);
      if (streak >= config.threshold) {
        lockedUntil.set(key, t + config.lockoutMs);
        return { allowed: false, reason: 'locked-out', retryAfterMs: config.lockoutMs };
      }
      return decision;
    },
  };
}

/** A minimal request shape — just enough to derive a rate-limit key. */
export interface RateLimitRequestLike {
  headers: { [k: string]: unknown };
  ip?: string;
}

/**
 * A Fastify `onRequest`/`preHandler` hook enforcing a {@link LockoutGuard}. `keyOf` derives the
 * limiter key from the request (e.g. the WebAuthn session id, falling back to the peer IP) — callers
 * on a write-endpoint scope are expected to key by session so throttling survives IP churn.
 */
export function rateLimitHook(guard: LockoutGuard, keyOf: (req: FastifyRequest) => string) {
  return async function onRequestRateLimitGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const decision = guard.check(keyOf(req));
    if (!decision.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      await reply
        .header('retry-after', String(retryAfterSec))
        .code(429)
        .send({ error: decision.reason, retryAfterMs: decision.retryAfterMs });
    }
  };
}

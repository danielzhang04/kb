import { describe, expect, it } from 'vitest';
import { lockout, rateLimit } from './ratelimit.ts';

/** A controllable fake clock: starts at `start` ms and only advances when `advance()` is called. */
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('rateLimit (sliding window)', () => {
  it('allows up to the limit inside the window, then throttles', () => {
    const clock = fakeClock();
    const limiter = rateLimit({ limit: 3, windowMs: 1000, now: clock.now });

    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
    const fourth = limiter.check('k');
    expect(fourth.allowed).toBe(false);
    if (!fourth.allowed) expect(fourth.reason).toBe('throttled');
  });

  it('allows again once the oldest hit falls outside the window', () => {
    const clock = fakeClock();
    const limiter = rateLimit({ limit: 1, windowMs: 100, now: clock.now });

    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(false);
    clock.advance(101);
    expect(limiter.check('k').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const clock = fakeClock();
    const limiter = rateLimit({ limit: 1, windowMs: 1000, now: clock.now });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });
});

describe('lockout (escalation over a rateLimit)', () => {
  it('throttles then locks out after the threshold', () => {
    const clock = fakeClock();
    const limiter = rateLimit({ limit: 1, windowMs: 1000, now: clock.now });
    const guard = lockout(limiter, { threshold: 3, lockoutMs: 60_000, now: clock.now });

    // First hit is allowed by the underlying window.
    expect(guard.check('k')).toEqual({ allowed: true, remaining: 0 });

    // Next hits are throttled (still inside the window) — three consecutive throttles trip the
    // lockout threshold.
    const d1 = guard.check('k');
    expect(d1).toEqual({ allowed: false, reason: 'throttled', retryAfterMs: expect.any(Number) });
    const d2 = guard.check('k');
    expect(d2.allowed).toBe(false);
    if (!d2.allowed) expect(d2.reason).toBe('throttled');
    const d3 = guard.check('k');
    expect(d3.allowed).toBe(false);
    if (!d3.allowed) expect(d3.reason).toBe('locked-out');

    // Even once the underlying window would allow a fresh hit, the lockout still holds.
    clock.advance(1001);
    const stillLocked = guard.check('k');
    expect(stillLocked.allowed).toBe(false);
    if (!stillLocked.allowed) expect(stillLocked.reason).toBe('locked-out');
  });

  it('lockout expires after lockoutMs and the key gets a clean slate', () => {
    const clock = fakeClock();
    const limiter = rateLimit({ limit: 1, windowMs: 100, now: clock.now });
    const guard = lockout(limiter, { threshold: 2, lockoutMs: 5000, now: clock.now });

    guard.check('k'); // allowed
    guard.check('k'); // throttled (streak 1)
    const locked = guard.check('k'); // throttled streak reaches 2 -> locked out
    expect(locked.allowed).toBe(false);
    if (!locked.allowed) expect(locked.reason).toBe('locked-out');

    clock.advance(5001);
    expect(guard.check('k').allowed).toBe(true);
  });

  it('a single allowed hit resets the consecutive-throttle streak', () => {
    const clock = fakeClock();
    const limiter = rateLimit({ limit: 1, windowMs: 100, now: clock.now });
    const guard = lockout(limiter, { threshold: 2, lockoutMs: 5000, now: clock.now });

    guard.check('k'); // allowed
    const throttled = guard.check('k'); // throttled (streak 1)
    expect(throttled.allowed).toBe(false);

    // Window clears; the next hit is allowed and should reset the streak rather than compound it.
    clock.advance(101);
    expect(guard.check('k').allowed).toBe(true);
    const throttledAgain = guard.check('k');
    expect(throttledAgain.allowed).toBe(false);
    if (!throttledAgain.allowed) expect(throttledAgain.reason).toBe('throttled'); // streak restarted, not locked
  });

  it('keys are locked out independently', () => {
    const clock = fakeClock();
    const limiter = rateLimit({ limit: 1, windowMs: 1000, now: clock.now });
    const guard = lockout(limiter, { threshold: 2, lockoutMs: 5000, now: clock.now });

    guard.check('a');
    guard.check('a');
    const aLocked = guard.check('a');
    expect(aLocked.allowed).toBe(false);
    if (!aLocked.allowed) expect(aLocked.reason).toBe('locked-out');

    expect(guard.check('b').allowed).toBe(true);
  });
});

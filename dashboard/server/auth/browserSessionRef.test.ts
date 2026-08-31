import { randomBytes as productionRandomBytes, timingSafeEqual as productionTimingSafeEqual } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes), timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import {
  BROWSER_SESSION_COOKIE_NAME,
  BROWSER_SESSION_MAX_AGE_SECONDS,
  BROWSER_SESSION_RENEWAL_WINDOW_SECONDS,
  createBrowserSessionRefManager,
  findStoredBrowserSessionRef,
  parseBrowserSessionCookie,
} from './browserSessionRef.ts';
import type { BrowserSessionRefMatcher } from './browserSessionRef.ts';

const NOW = new Date('2026-08-23T12:00:00.000Z');
const REF_A = Buffer.alloc(32, 0x11).toString('base64url');
const REF_B = Buffer.alloc(32, 0x22).toString('base64url');

/** A store that can only ever apply the comparator to what it already holds. */
function refStore(rows: readonly { ref: string; expiresAt: string }[]) {
  return (matches: BrowserSessionRefMatcher) => findStoredBrowserSessionRef(matches, rows);
}

describe('browser session references', () => {
  it('uses the production CSPRNG when no entropy seam is injected', async () => {
    const randomBytes = vi.mocked(productionRandomBytes);
    randomBytes.mockClear();
    const manager = createBrowserSessionRefManager({
      now: () => NOW,
      reserve: vi.fn(async () => true),
    });

    await expect(manager.mint()).resolves.toMatchObject({ ok: true });
    expect(randomBytes).toHaveBeenCalledWith(32);
  });

  it('cookie CSPRNG/name/path/lifetime/renewal/collision', async () => {
    const manager = createBrowserSessionRefManager({
      now: () => NOW,
      randomBytes: () => Buffer.alloc(32, 0x11),
      reserve: vi.fn(async () => true),
    });

    await expect(manager.mint()).resolves.toEqual({
      ok: true,
      value: {
        browserSessionRef: REF_A,
        cookie: `${BROWSER_SESSION_COOKIE_NAME}=${REF_A}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${BROWSER_SESSION_MAX_AGE_SECONDS}`,
        expiresAt: '2026-09-22T12:00:00.000Z',
      },
    });
    expect(BROWSER_SESSION_RENEWAL_WINDOW_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('parses only the exact cookie value and never mints malformed input', () => {
    expect(parseBrowserSessionCookie(`${BROWSER_SESSION_COOKIE_NAME}=${REF_A}`)).toBe(REF_A);
    expect(parseBrowserSessionCookie(`${BROWSER_SESSION_COOKIE_NAME}=short`)).toBeNull();
    expect(parseBrowserSessionCookie(`${BROWSER_SESSION_COOKIE_NAME}=${REF_A}; ${BROWSER_SESSION_COOKIE_NAME}=${REF_B}`)).toBeNull();
  });

  it('retries collisions at most eight times and reports the named 503 refusal', async () => {
    const reserve = vi.fn(async () => false);
    const manager = createBrowserSessionRefManager({
      now: () => NOW,
      randomBytes: () => Buffer.alloc(32, 0x11),
      reserve,
    });

    await expect(manager.mint()).resolves.toEqual({
      ok: false,
      status: 503,
      code: 'browser-session-ref-unavailable',
    });
    expect(reserve).toHaveBeenCalledTimes(8);
  });

  it('renews the same ref only inside the seven-day window', async () => {
    const renew = vi.fn(async () => true);
    const manager = createBrowserSessionRefManager({
      now: () => NOW,
      randomBytes: () => Buffer.alloc(32),
      reserve: vi.fn(async () => true),
      verify: refStore([{ ref: REF_A, expiresAt: '2026-08-30T11:59:59.000Z' }]),
      renew,
    });

    const result = await manager.renew(`${BROWSER_SESSION_COOKIE_NAME}=${REF_A}`);
    expect(result).toEqual({
      ok: true,
      value: {
        browserSessionRef: REF_A,
        cookie: `${BROWSER_SESSION_COOKIE_NAME}=${REF_A}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${BROWSER_SESSION_MAX_AGE_SECONDS}`,
        expiresAt: '2026-09-22T12:00:00.000Z',
        renewed: true,
      },
    });
    expect(renew).toHaveBeenCalledWith(REF_A, '2026-09-22T12:00:00.000Z');
  });

  it('preserves a valid ref without a cookie at the exact renewal edge', async () => {
    const renew = vi.fn(async () => true);
    const manager = createBrowserSessionRefManager({
      now: () => NOW,
      randomBytes: () => Buffer.alloc(32),
      reserve: vi.fn(async () => true),
      verify: refStore([{ ref: REF_A, expiresAt: '2026-08-30T12:00:00.000Z' }]),
      renew,
    });

    await expect(manager.renew(`${BROWSER_SESSION_COOKIE_NAME}=${REF_A}`)).resolves.toEqual({
      ok: true,
      value: {
        browserSessionRef: REF_A,
        cookie: null,
        expiresAt: '2026-08-30T12:00:00.000Z',
        renewed: false,
      },
    });
    expect(renew).not.toHaveBeenCalled();
  });

  it('refuses malformed, missing, expired, and lost-renewal cookies without minting', async () => {
    const reserve = vi.fn(async () => true);
    const verify = vi.fn(refStore([{ ref: REF_A, expiresAt: '2026-08-23T11:59:59.000Z' }]));
    const manager = createBrowserSessionRefManager({
      now: () => NOW,
      randomBytes: () => Buffer.alloc(32),
      reserve,
      verify,
      renew: vi.fn(async () => false),
    });

    await expect(manager.renew(undefined)).resolves.toMatchObject({ ok: false });
    await expect(manager.renew(`${BROWSER_SESSION_COOKIE_NAME}=bad`)).resolves.toMatchObject({ ok: false });
    await expect(manager.renew(`${BROWSER_SESSION_COOKIE_NAME}=${REF_A}`)).resolves.toMatchObject({
      ok: false,
      code: 'browser-session-ref-expired',
    });
    await expect(manager.renew(`${BROWSER_SESSION_COOKIE_NAME}=${REF_B}`)).resolves.toMatchObject({ ok: false });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('authenticates through a store that is never handed the presented token', async () => {
    const timingSafeEqual = vi.mocked(productionTimingSafeEqual);
    timingSafeEqual.mockClear();
    // The store keeps every argument it is given. If the raw token ever crossed the seam it would
    // land here, and a `Map.get(presented)` implementation would become expressible again.
    const seen: unknown[] = [];
    const stored = [{ ref: REF_B, expiresAt: '2026-09-01T12:00:00.000Z' },
      { ref: REF_A, expiresAt: '2026-08-30T12:00:00.000Z' }];
    const verify = vi.fn((...args: unknown[]) => {
      seen.push(...args);
      return findStoredBrowserSessionRef(args[0] as BrowserSessionRefMatcher, stored);
    });
    const manager = createBrowserSessionRefManager({
      now: () => NOW,
      randomBytes: () => Buffer.alloc(32),
      reserve: vi.fn(async () => true),
      verify,
    });

    await expect(manager.renew(`${BROWSER_SESSION_COOKIE_NAME}=${REF_A}`)).resolves.toMatchObject({
      ok: true,
      value: { browserSessionRef: REF_A, expiresAt: '2026-08-30T12:00:00.000Z' },
    });
    await expect(manager.renew(`${BROWSER_SESSION_COOKIE_NAME}=short`)).resolves.toMatchObject({
      ok: false,
      code: 'browser-session-ref-invalid',
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen.every((value) => typeof value === 'function')).toBe(true);
    expect(seen).not.toContain(REF_A);
    // One constant-time comparison per stored ref, and never a string equality shortcut.
    expect(timingSafeEqual).toHaveBeenCalledTimes(stored.length);
  });

  it('reports a storage or configuration failure as 503, never as a lost session', async () => {
    const unconfigured = createBrowserSessionRefManager({
      now: () => NOW,
      randomBytes: () => Buffer.alloc(32),
      reserve: vi.fn(async () => true),
    });
    await expect(unconfigured.renew(`${BROWSER_SESSION_COOKIE_NAME}=${REF_A}`)).resolves.toEqual({
      ok: false, status: 503, code: 'browser-session-ref-unavailable',
    });

    const failingWrite = createBrowserSessionRefManager({
      now: () => NOW,
      randomBytes: () => Buffer.alloc(32),
      reserve: vi.fn(async () => true),
      verify: refStore([{ ref: REF_A, expiresAt: '2026-08-30T11:59:59.000Z' }]),
      renew: vi.fn(async () => false),
    });
    await expect(failingWrite.renew(`${BROWSER_SESSION_COOKIE_NAME}=${REF_A}`)).resolves.toEqual({
      ok: false, status: 503, code: 'browser-session-ref-unavailable',
    });
    // A genuinely bad credential is still a 401 — the two failures stay distinguishable.
    await expect(failingWrite.renew(`${BROWSER_SESSION_COOKIE_NAME}=${REF_B}`)).resolves.toEqual({
      ok: false, status: 401, code: 'browser-session-ref-invalid',
    });
  });

  it('serializes concurrent mint collisions through the injected atomic reservation', async () => {
    const refs = [REF_A, REF_A, REF_B];
    const reserved = new Set<string>();
    const manager = createBrowserSessionRefManager({
      now: () => NOW,
      randomBytes: () => Buffer.from(refs.shift() ?? REF_B, 'base64url'),
      reserve: async (ref) => {
        if (reserved.has(ref)) return false;
        reserved.add(ref);
        return true;
      },
    });
    const results = await Promise.all([manager.mint(), manager.mint()]);
    expect(results.map((result) => result.ok && result.value.browserSessionRef).sort()).toEqual([REF_A, REF_B]);
  });
});

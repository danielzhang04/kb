import { beforeEach, describe, expect, it } from 'vitest';
import { PR_REFRESH_BUDGET_MS, type PrSubject, type SourceState } from './contracts.ts';
import {
  InboxSourceCache, InboxSourceCacheConflictError, getInboxSourceCache,
  resetInboxSourceCacheForTests, type PrRead,
} from './sourceCache.ts';

function prItem(number: number): PrSubject {
  return {
    kind: 'pr', id: `id-${number}`, createdAt: '2026-08-20T00:00:00.000Z', revision: `rev-${number}`,
    subject: { owner: 'kb-owner', repo: 'kb', number },
    title: `PR ${number}`, href: `https://github.com/kb-owner/kb/pull/${number}`,
  };
}

const verified: SourceState = { status: 'verified', revision: 'r1', verifiedAt: '2026-08-20T00:00:00.000Z' };
const verifiedStale: SourceState = { ...verified, stale: true };

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let value = start;
  return { now: () => value, advance: (ms) => { value += ms; } };
}

// The budget is module-level, so every test starts from a clean process window.
beforeEach(() => { resetInboxSourceCacheForTests(); });

describe('InboxSourceCache PR subprocess budget', () => {
  it('spawns one subprocess for two concurrent sessions and serves the second from cache', async () => {
    const time = clock();
    const cache = new InboxSourceCache({ now: time.now });
    let spawns = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reader = async (): Promise<PrRead> => {
      spawns += 1;
      await gate;
      return { items: [prItem(7)], state: verified };
    };

    const sessionA = cache.readPr(reader);
    const sessionB = cache.readPr(reader);
    release!();
    const [a, b] = await Promise.all([sessionA, sessionB]);

    expect(spawns).toBe(1);
    expect(a.items).toEqual([prItem(7)]);
    expect(b.items).toEqual([prItem(7)]);
  });

  it('returns the cached projection with stale true and spawns nothing inside the 30 s window', async () => {
    const time = clock();
    const cache = new InboxSourceCache({ now: time.now });
    let spawns = 0;
    const reader = async (): Promise<PrRead> => { spawns += 1; return { items: [prItem(9)], state: verified }; };

    const first = await cache.readPr(reader);
    time.advance(PR_REFRESH_BUDGET_MS - 1);
    const second = await cache.readPr(reader);

    expect(spawns).toBe(1);
    expect(first.stale).toBe(false);
    expect(first.state).toEqual(verified);
    // [M3] the in-window read carries the additive contract marker, not a bare `verified`.
    expect(second).toMatchObject({ stale: true, items: [prItem(9)] });
    expect(second.state).toEqual(verifiedStale);
  });

  it('spawns again once the global window has elapsed, and the 60 s poll draws on the same budget', async () => {
    const time = clock();
    const cache = new InboxSourceCache({ now: time.now });
    let spawns = 0;
    const reader = async (): Promise<PrRead> => { spawns += 1; return { items: [], state: verified }; };

    await cache.readPr(reader);
    time.advance(PR_REFRESH_BUDGET_MS - 1);
    await cache.readPr(reader); // the 60 s poll firing inside the window
    expect(spawns).toBe(1);
    time.advance(1);
    const third = await cache.readPr(reader);
    expect(spawns).toBe(2);
    expect(third.stale).toBe(false);
  });

  it('[M1] two independently constructed caches can never spend two subprocess slots', async () => {
    const time = clock();
    const first = new InboxSourceCache({ now: time.now });
    const second = new InboxSourceCache({ now: time.now });
    let spawns = 0;
    const reader = async (): Promise<PrRead> => { spawns += 1; return { items: [prItem(2)], state: verified }; };

    await first.readPr(reader);
    time.advance(PR_REFRESH_BUDGET_MS - 1);
    const fromSecond = await second.readPr(reader);

    // The budget is module state, so the second instance sees the first instance's spend.
    expect(spawns).toBe(1);
    expect(fromSecond.stale).toBe(true);
    expect(fromSecond.items).toEqual([prItem(2)]);
  });

  it('[M1] the guarded factory hands back one instance and refuses a divergent second construction', () => {
    const time = clock();
    const options = { now: time.now };
    expect(getInboxSourceCache(options)).toBe(getInboxSourceCache(options));
    expect(getInboxSourceCache({ now: time.now })).toBe(getInboxSourceCache(options));
    expect(() => getInboxSourceCache({ now: time.now, budgetMs: 5 })).toThrow(InboxSourceCacheConflictError);
  });

  it('retains last-good items with a stale failed source state when a read fails', async () => {
    const time = clock();
    const cache = new InboxSourceCache({ now: time.now });
    const ok = async (): Promise<PrRead> => ({ items: [prItem(3)], state: verified });
    const failing = async (): Promise<PrRead> => ({
      items: [], state: { status: 'failed', errorCode: 'timeout', stale: false },
    });

    await cache.readPr(ok);
    time.advance(PR_REFRESH_BUDGET_MS);
    const outcome = await cache.readPr(failing);

    expect(outcome.items).toEqual([prItem(3)]);
    expect(outcome.state).toEqual({ status: 'failed', errorCode: 'timeout', stale: true });
    expect(outcome.stale).toBe(true);
  });

  it('reports an explicit failed source rather than a false empty state with no last-good data', async () => {
    const cache = new InboxSourceCache({ now: clock().now });
    const outcome = await cache.readPr(async () => ({
      items: [], state: { status: 'failed', errorCode: 'unavailable', stale: false },
    }));
    expect(outcome.state).toEqual({ status: 'failed', errorCode: 'unavailable', stale: false });
    expect(cache.peekEscalation().state).toEqual({ status: 'failed', errorCode: 'unavailable', stale: false });
  });

  it('[M2] a rejecting reader fails only the PR source: the join never rejects and escalation is untouched', async () => {
    const cache = new InboxSourceCache({ now: clock().now });
    cache.putEscalation({ items: [], state: verified });
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const throwing = async (): Promise<PrRead> => {
      await gate;
      throw new Error('spawn gh ENOENT C:/secret/path');
    };

    const sessionA = cache.readPr(throwing);
    const sessionB = cache.readPr(throwing);
    release!();
    const settled = await Promise.allSettled([sessionA, sessionB]);

    expect(settled.map((entry) => entry.status)).toEqual(['fulfilled', 'fulfilled']);
    for (const entry of settled) {
      const outcome = (entry as PromiseFulfilledResult<Awaited<ReturnType<typeof cache.readPr>>>).value;
      expect(outcome.state).toEqual({ status: 'failed', errorCode: 'unavailable', stale: false });
      expect(JSON.stringify(outcome)).not.toContain('secret');
    }
    expect(cache.peekEscalation().state).toEqual(verified);
  });

  it('marks the cache stale on a publisher receipt without spending a subprocess inside the window', async () => {
    const time = clock();
    const cache = new InboxSourceCache({ now: time.now });
    let spawns = 0;
    const reader = async (): Promise<PrRead> => { spawns += 1; return { items: [prItem(1)], state: verified }; };

    await cache.readPr(reader);
    expect(cache.isPrFresh()).toBe(true);
    cache.invalidatePr();
    expect(cache.isPrFresh()).toBe(false);
    const outcome = await cache.readPr(reader);

    expect(spawns).toBe(1);
    expect(outcome.stale).toBe(true);

    time.advance(PR_REFRESH_BUDGET_MS);
    await cache.readPr(reader);
    expect(spawns).toBe(2);
    expect(cache.isPrFresh()).toBe(true);
  });

  it('keeps the escalation snapshot independent of the PR source', async () => {
    const cache = new InboxSourceCache({ now: clock().now });
    cache.putEscalation({ items: [], state: verified });
    await cache.readPr(async () => ({ items: [], state: { status: 'failed', errorCode: 'invalid', stale: false } }));
    expect(cache.peekEscalation().state).toEqual(verified);
  });
});

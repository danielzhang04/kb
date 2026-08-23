/**
 * D2.1 — short-TTL session token minted at a successful WebAuthn assertion (never at registration,
 * never speculatively). The token is a signed (HMAC-SHA256) bearer — stateless, so no server-side
 * session store is needed and a daemon restart cannot leave a validated-but-forgotten session behind
 * — consumed by every write endpoint in later D2 tasks. The clock is injected (`now`) so expiry is
 * tested deterministically, without real timers.
 */
import { describe, expect, it } from 'vitest';
import {
  brandInternalServiceCaller,
  isInternalServiceCaller,
  mintSession,
  mintSessionFromVerifiedAssertion,
  resolveSessionTtlMs,
  verifySession,
  createBrowserSessionRefStore,
  resolveBrowserPrincipal,
  MAX_LIVE_BROWSER_SESSION_REFS,
} from './session.ts';
import type { SessionConfig } from './session.ts';
import { createInternalServiceCaller } from '../control/activation.ts';

const SECRET = Buffer.from('unit-test-secret-do-not-reuse');

describe('session', () => {
  it('a verified assertion mints a short-TTL session; expiry rejects', () => {
    let clock = 1_700_000_000_000;
    const config: SessionConfig = { secret: SECRET, ttlMs: 1000, now: () => clock };

    const verifiedAssertion = { verified: true as const };
    const { token, claims } = mintSessionFromVerifiedAssertion(verifiedAssertion, 'user-1', config);
    expect(claims.sub).toBe('user-1');
    expect(claims.exp).toBe(claims.iat + 1000);

    const fresh = verifySession(token, config);
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.claims.sub).toBe('user-1');

    // Advance the injected clock past the TTL — the same token must now be rejected as expired.
    clock += 1001;
    const expired = verifySession(token, config);
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe('expired');
  });

  it('refuses to mint a session from an unverified assertion', () => {
    const config: SessionConfig = { secret: SECRET, now: () => 0 };
    expect(() =>
      mintSessionFromVerifiedAssertion({ verified: false }, 'user-1', config),
    ).toThrow();
  });

  it('rejects a tampered (bad-signature) token', () => {
    const config: SessionConfig = { secret: SECRET, now: () => 0 };
    const { token } = mintSession('user-1', config);
    const tampered = `${token.slice(0, -4)}xxxx`;
    const result = verifySession(tampered, config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-signature');
  });

  it('rejects a malformed token', () => {
    const config: SessionConfig = { secret: SECRET, now: () => 0 };
    const result = verifySession('not-a-real-token', config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('a session minted under one secret does not verify under another (no fixed/guessable fallback)', () => {
    const configA: SessionConfig = { secret: SECRET, now: () => 0 };
    const configB: SessionConfig = { secret: Buffer.from('a-different-secret'), now: () => 0 };
    const { token } = mintSession('user-1', configA);
    const result = verifySession(token, configB);
    expect(result.ok).toBe(false);
  });

  it('accepts an operator-configured workday TTL and rejects invalid values', () => {
    expect(resolveSessionTtlMs({ DASHBOARD_SESSION_TTL_MS: '28800000' })).toBe(28_800_000);
    expect(resolveSessionTtlMs({ DASHBOARD_SESSION_TTL_MS: '-1' })).toBe(5 * 60 * 1000);
  });
});

describe('isInternalServiceCaller (unforgeable in-process principal)', () => {
  const GATE = 'DASHBOARD_EXECUTION_ACTIVATED';

  it('REJECTS a correctly-shaped plain JSON lookalike (the exact forgery the review flagged)', () => {
    // Right discriminant, right subject — precisely what a hostile HTTP body could carry. Identity is the
    // WeakSet brand, not the shape, so this must NOT pass.
    expect(isInternalServiceCaller({ kind: 'internal-service-caller', subject: 'dashboard-engine' })).toBe(false);
  });

  it('REJECTS every other hand-built lookalike and every non-object', () => {
    expect(isInternalServiceCaller({ kind: 'internal-service-caller' })).toBe(false);
    expect(isInternalServiceCaller({ subject: 'dashboard-engine' })).toBe(false);
    expect(isInternalServiceCaller({ kind: 'not-the-kind', subject: 'x' })).toBe(false);
    expect(isInternalServiceCaller({ kind: 'internal-service-caller', subject: 'dashboard-engine', extra: true })).toBe(false);
    expect(isInternalServiceCaller(null)).toBe(false);
    expect(isInternalServiceCaller(undefined)).toBe(false);
    expect(isInternalServiceCaller('internal-service-caller')).toBe(false);
    expect(isInternalServiceCaller(42)).toBe(false);
    // A structural clone or spread of a genuine caller is just a plain object — no brand travels through JSON.
    const genuine = brandInternalServiceCaller('dashboard-engine');
    expect(isInternalServiceCaller(JSON.parse(JSON.stringify(genuine)))).toBe(false);
    expect(isInternalServiceCaller({ ...genuine })).toBe(false);
  });

  it('ACCEPTS an object minted by the brand primitive', () => {
    expect(isInternalServiceCaller(brandInternalServiceCaller('dashboard-engine'))).toBe(true);
  });

  it('ACCEPTS an object produced by the activation-gated createInternalServiceCaller (gate on)', () => {
    const saved = process.env[GATE];
    process.env[GATE] = '1';
    try {
      const caller = createInternalServiceCaller('dashboard-engine');
      expect(isInternalServiceCaller(caller)).toBe(true);
      expect(caller.kind).toBe('internal-service-caller');
      expect(caller.subject).toBe('dashboard-engine');
    } finally {
      if (saved === undefined) delete process.env[GATE];
      else process.env[GATE] = saved;
    }
  });

  it('createInternalServiceCaller fails closed with the gate off — no caller is obtainable', () => {
    const saved = process.env[GATE];
    delete process.env[GATE];
    try {
      expect(() => createInternalServiceCaller('dashboard-engine')).toThrow(/activation gate/);
    } finally {
      if (saved === undefined) delete process.env[GATE];
      else process.env[GATE] = saved;
    }
  });

  it('the brand primitive refuses an empty subject (no identity-less caller can exist)', () => {
    expect(() => brandInternalServiceCaller('')).toThrow();
  });
});

/**
 * W6.3b — the browser-session ref table and the principal resolved from it. Before these tests
 * `resolveBrowserPrincipal` parsed the cookie and trusted it: any authenticated caller could invent a
 * 43-character base64url string and receive a principal, and the expiry the table stores was never read.
 */
describe('browser-session ref store and principal resolution', () => {
  const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1_000;
  /** A syntactically PERFECT ref that no store ever reserved — the forgery the old parse-only path let in. */
  const forgedRef = (seed: string) => Buffer.alloc(32, seed).toString('base64url');
  const cookie = (ref: string) => `kb_browser_session=${ref}`;
  const mintedRef = async (refs: ReturnType<typeof createBrowserSessionRefStore>) => {
    const result = await refs.mint();
    if (!result.ok) throw new Error('fixture mint failed');
    return result.value.browserSessionRef;
  };
  /** Deterministic, distinct 32-byte values so a collision/capacity path can be driven exactly. */
  function counterBytes(): () => Uint8Array {
    let n = 0;
    return () => {
      const bytes = Buffer.alloc(32);
      n += 1;
      bytes.writeUInt32BE(n, 0);
      return bytes;
    };
  }

  it('resolves a ref the table actually issued, and refuses a forged one of the same shape', async () => {
    const refs = createBrowserSessionRefStore();
    const ref = await mintedRef(refs);

    await expect(resolveBrowserPrincipal('operator', cookie(ref), refs))
      .resolves.toEqual({ operator: 'operator', browserSessionRef: ref });
    // RED on a revert to parse-only resolution: this string is well-formed and completely invented.
    await expect(resolveBrowserPrincipal('operator', cookie(forgedRef('f')), refs)).resolves.toBeNull();
  });

  it('enforces the stored expiry at use, so a ref outliving its window stops being a principal', async () => {
    let clock = new Date('2026-08-23T00:00:00.000Z');
    const refs = createBrowserSessionRefStore({ now: () => clock });
    const ref = await mintedRef(refs);
    await expect(resolveBrowserPrincipal('operator', cookie(ref), refs)).resolves.not.toBeNull();

    clock = new Date(clock.getTime() + THIRTY_ONE_DAYS_MS);
    await expect(resolveBrowserPrincipal('operator', cookie(ref), refs)).resolves.toBeNull();
  });

  it('refuses a malformed value, duplicate cookies, an empty operator, and an absent store', async () => {
    const refs = createBrowserSessionRefStore();
    const ref = await mintedRef(refs);

    await expect(resolveBrowserPrincipal('operator', 'kb_browser_session=not-a-ref', refs)).resolves.toBeNull();
    await expect(resolveBrowserPrincipal('operator', `${cookie(ref)}; ${cookie(ref)}`, refs)).resolves.toBeNull();
    await expect(resolveBrowserPrincipal('operator', undefined, refs)).resolves.toBeNull();
    await expect(resolveBrowserPrincipal('', cookie(ref), refs)).resolves.toBeNull();
    await expect(resolveBrowserPrincipal('operator', cookie(ref), undefined)).resolves.toBeNull();
  });

  it('never throws: a store that faults yields no principal', async () => {
    const exploding = { resolve: () => { throw new Error('store fault'); } } as never;
    await expect(resolveBrowserPrincipal('operator', cookie(forgedRef('a')), exploding)).resolves.toBeNull();
  });

  it('never renews as a side effect of resolving', async () => {
    let clock = new Date('2026-08-23T00:00:00.000Z');
    const refs = createBrowserSessionRefStore({ now: () => clock });
    const ref = await mintedRef(refs);
    // Deep inside the renewal window, where `renew` WOULD issue a fresh 30-day expiry.
    clock = new Date(clock.getTime() + 29 * 24 * 60 * 60 * 1_000);
    await expect(resolveBrowserPrincipal('operator', cookie(ref), refs)).resolves.not.toBeNull();

    clock = new Date(clock.getTime() + 2 * 24 * 60 * 60 * 1_000);
    // Still expired on the ORIGINAL schedule: resolving did not extend anything.
    await expect(resolveBrowserPrincipal('operator', cookie(ref), refs)).resolves.toBeNull();
  });

  it('refuses to reserve a ref a persisted session already holds as its controller, across all 8 attempts', async () => {
    const collidingRef = Buffer.alloc(32, 'c');
    collidingRef.writeUInt32BE(1, 0);
    let reads = 0;
    const persistence = {
      read: () => {
        reads += 1;
        return { sessions: [{ controller: { browserSessionRef: collidingRef.toString('base64url') } }] };
      },
    } as never;
    const refs = createBrowserSessionRefStore({
      persistence,
      // Every attempt proposes the ref the persisted controller already owns.
      randomBytes: () => collidingRef,
    });

    expect(await refs.mint()).toEqual({ ok: false, status: 503, code: 'browser-session-ref-unavailable' });
    // Eight attempts, eight atomic checks — never a ninth, and never a silent hand-off of a live
    // session's controller ref to a different browser.
    expect(reads).toBe(8);
  });

  it('retries past a taken ref and succeeds on the next attempt', async () => {
    const taken = Buffer.alloc(32, 'c');
    taken.writeUInt32BE(1, 0);
    const free = Buffer.alloc(32, 'c');
    free.writeUInt32BE(2, 0);
    const proposals = [taken, free];
    const refs = createBrowserSessionRefStore({
      persistence: { read: () => ({ sessions: [{ controller: { browserSessionRef: taken.toString('base64url') } }] }) } as never,
      randomBytes: () => proposals.shift() ?? free,
    });

    const minted = await refs.mint();
    expect(minted.ok).toBe(true);
    expect(minted.ok && minted.value.browserSessionRef).toBe(free.toString('base64url'));
  });

  it('refuses (never allows) on an unreadable or still-v1 document, and reports it exactly once', async () => {
    const log: string[] = [];
    const refs = createBrowserSessionRefStore({
      persistence: { read: () => { throw new Error('C:/state/pty/sessions.json is not readable'); } } as never,
      randomBytes: counterBytes(),
      log: (line) => log.push(line),
    });

    expect(await refs.mint()).toEqual({ ok: false, status: 503, code: 'browser-session-ref-unavailable' });
    expect(await refs.mint()).toEqual({ ok: false, status: 503, code: 'browser-session-ref-unavailable' });
    // Sixteen refusals, ONE line — the fault is visible instead of swallowed, without flooding the log.
    expect(log).toEqual(['browser-session-ref: reserve refused: the pty session document could not be read']);
    // And the line carries the store's own words only: no path from the underlying error.
    expect(log[0]).not.toContain('sessions.json');
  });

  it('bounds the live table: expired refs are reclaimed on reserve, a full LIVE table refuses', async () => {
    let clock = new Date('2026-08-23T00:00:00.000Z');
    const log: string[] = [];
    const refs = createBrowserSessionRefStore({ now: () => clock, randomBytes: counterBytes(), log: (line) => log.push(line) });
    for (let i = 0; i < MAX_LIVE_BROWSER_SESSION_REFS; i += 1) {
      expect((await refs.mint()).ok).toBe(true);
    }

    // Every ref is live, so the cap refuses rather than evicting a working browser's principal.
    expect(await refs.mint()).toEqual({ ok: false, status: 503, code: 'browser-session-ref-unavailable' });
    expect(log).toEqual(['browser-session-ref: reserve refused: the live ref table is at capacity']);

    // Past their expiry the whole table is reclaimed on the next reserve and minting works again.
    clock = new Date(clock.getTime() + THIRTY_ONE_DAYS_MS);
    expect((await refs.mint()).ok).toBe(true);
  });
});

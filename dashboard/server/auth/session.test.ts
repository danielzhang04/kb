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

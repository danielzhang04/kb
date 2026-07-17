/**
 * D2.1 — short-TTL session token minted at a successful WebAuthn assertion (never at registration,
 * never speculatively). The token is a signed (HMAC-SHA256) bearer — stateless, so no server-side
 * session store is needed and a daemon restart cannot leave a validated-but-forgotten session behind
 * — consumed by every write endpoint in later D2 tasks. The clock is injected (`now`) so expiry is
 * tested deterministically, without real timers.
 */
import { describe, expect, it } from 'vitest';
import {
  mintSession,
  mintSessionFromVerifiedAssertion,
  verifySession,
} from './session.ts';
import type { SessionConfig } from './session.ts';

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
});

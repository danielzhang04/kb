/**
 * D3.1a — cross-user auth wiring (pure). RED-first.
 *
 * The PTY host reuses the Broker's `authenticateConnection` UNCHANGED, but inverts its meaning: where
 * the Broker passes `expectedOwnerId = <its own SID>` (same-user), the host passes
 * `expectedOwnerId = <DANIEL_SID>` — the authorized PEER, which is NOT the host's own kb-fleet SID.
 * The auth logic itself is never forked; this module is only the thin cross-identity wiring, so these
 * tests prove the inversion holds: Daniel's SID authorizes, the host's own SID does NOT, and the
 * per-boot token remains mandatory on top of the SID (dual-factor, D-6).
 */
import { describe, expect, it } from 'vitest';
import { authenticateCrossUserConnection } from './crossUserAuth.ts';
import type { PeerCredential } from '../../../broker/socket.ts';

/** The host's OWN identity (kb-fleet) — must be REJECTED as a peer (it is not Daniel). */
const KB_FLEET_SID = 'S-1-5-21-732142867-588960626-3228783940-1007';
/** A representative Daniel SID (the authorized peer; captured for real at the human gate). */
const DANIEL_SID = 'S-1-5-21-732142867-588960626-3228783940-1001';
/** An unrelated third account. */
const THIRD_SID = 'S-1-5-21-999999999-888888888-777777777-1500';

const BOOT_TOKEN = 'a'.repeat(64);

function peer(ownerId: string): PeerCredential {
  return { ownerId, pid: 4242 };
}

describe('authenticateCrossUserConnection', () => {
  const ctx = { expectedPeerSid: DANIEL_SID, bootToken: BOOT_TOKEN };

  it('authorizes Daniel (the expected peer SID) when the token also matches', () => {
    const r = authenticateCrossUserConnection({ peerCred: peer(DANIEL_SID), token: BOOT_TOKEN }, ctx);
    expect(r.ok).toBe(true);
  });

  it("rejects the host's OWN kb-fleet SID (must never authorize itself as the peer)", () => {
    const r = authenticateCrossUserConnection({ peerCred: peer(KB_FLEET_SID), token: BOOT_TOKEN }, ctx);
    expect(r).toEqual({ ok: false, reason: 'peer-credential', detail: expect.any(String) });
  });

  it('rejects a third, unrelated SID', () => {
    const r = authenticateCrossUserConnection({ peerCred: peer(THIRD_SID), token: BOOT_TOKEN }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('peer-credential');
  });

  it('rejects the right peer on a token MISMATCH (dual-factor — SID alone is insufficient)', () => {
    const r = authenticateCrossUserConnection({ peerCred: peer(DANIEL_SID), token: 'b'.repeat(64) }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-token');
  });

  it('rejects the right peer when the token is ABSENT', () => {
    const r = authenticateCrossUserConnection({ peerCred: peer(DANIEL_SID), token: null }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-token');
  });

  it('rejects when the peer credential is unresolved (null) even with a valid token', () => {
    const r = authenticateCrossUserConnection({ peerCred: null, token: BOOT_TOKEN }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('peer-credential');
  });

  it('accepts ONLY when BOTH the peer SID AND the token pass (no single-factor path)', () => {
    // Both wrong.
    expect(authenticateCrossUserConnection({ peerCred: peer(THIRD_SID), token: 'x'.repeat(64) }, ctx).ok).toBe(false);
    // Peer ok, token wrong.
    expect(authenticateCrossUserConnection({ peerCred: peer(DANIEL_SID), token: 'x'.repeat(64) }, ctx).ok).toBe(false);
    // Token ok, peer wrong.
    expect(authenticateCrossUserConnection({ peerCred: peer(KB_FLEET_SID), token: BOOT_TOKEN }, ctx).ok).toBe(false);
    // Both ok.
    expect(authenticateCrossUserConnection({ peerCred: peer(DANIEL_SID), token: BOOT_TOKEN }, ctx).ok).toBe(true);
  });
});

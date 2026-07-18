/**
 * D3.1a — cross-user auth wiring (pure).
 *
 * The PTY host's pipe is OWNED by kb-fleet but its sole legitimate client runs as Daniel. So unlike the
 * Broker's same-owner socket (`expectedOwnerId = own SID`), the host must authorize a DIFFERENT SID —
 * Daniel's — as its peer. Rather than fork the auth logic, we reuse the Broker's pure, exhaustively
 * tested `authenticateConnection` VERBATIM and simply feed it `expectedOwnerId = <DANIEL_SID>` (a
 * PARAMETER, never the host's own SID). Dual-factor is preserved unchanged: the per-boot token remains
 * mandatory on top of the peer-SID match (design D-6), and there is no path that accepts on one factor.
 *
 * This module is deliberately thin — the security-load-bearing comparison (constant-time token compare,
 * fail-closed on a null peer credential, no single-factor accept) all lives in the imported Broker core.
 */
import { authenticateConnection } from '../../../broker/socket.ts';
import type { AuthResult, PeerCredential } from '../../../broker/socket.ts';

/** Context for the cross-identity check. `expectedPeerSid` is the AUTHORIZED PEER (Daniel), which is
 *  NOT the host's own kb-fleet SID — that inversion is the whole point of the cross-user model. */
export interface CrossUserAuthContext {
  /** The one SID authorized as the peer (Daniel's), resolved from `peer.sid` at boot (peerConfig.ts). */
  expectedPeerSid: string;
  /** This host-boot's per-boot token (minted via the reused `mintBootToken`). */
  bootToken: string;
}

/** What the connecting client presented: its resolved peer credential and the token it sent. */
export interface CrossUserPresented {
  peerCred: PeerCredential | null;
  token: string | null | undefined;
}

/**
 * Authenticate a cross-identity connection to the PTY host. Delegates to the reused Broker core with
 * `expectedOwnerId` bound to the expected PEER SID. Accepts ONLY when the peer credential resolves to
 * `expectedPeerSid` AND the presented token matches `bootToken` in constant time; either failing rejects.
 */
export function authenticateCrossUserConnection(
  presented: CrossUserPresented,
  ctx: CrossUserAuthContext,
): AuthResult {
  return authenticateConnection(
    { peerCred: presented.peerCred, token: presented.token },
    { expectedOwnerId: ctx.expectedPeerSid, bootToken: ctx.bootToken },
  );
}

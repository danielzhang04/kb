import { describe, it, expect } from 'vitest';
import {
  authenticateConnection,
  mintBootToken,
  defaultPeerReader,
  resolveExpectedOwnerId,
} from './socket.ts';
import type { PeerCredential, SocketAuthContext } from './socket.ts';

const OWNER = 'uid-1000';
const ctx = (bootToken: string): SocketAuthContext => ({ expectedOwnerId: OWNER, bootToken });
const goodPeer: PeerCredential = { ownerId: OWNER, pid: 4321 };

describe('broker/socket authenticateConnection', () => {
  it('rejects a connection failing the peer-credential check (even WITH a valid token)', () => {
    const token = mintBootToken();
    const wrongOwner: PeerCredential = { ownerId: 'uid-31337', pid: 9 };
    const result = authenticateConnection({ peerCred: wrongOwner, token }, ctx(token));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('peer-credential');
  });

  it('rejects a connection whose peer credential could not be resolved (fail-closed)', () => {
    const token = mintBootToken();
    const result = authenticateConnection({ peerCred: null, token }, ctx(token));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('peer-credential');
  });

  it('rejects a connection without the per-boot dispatcher-issued token (even with a valid peer)', () => {
    const token = mintBootToken();
    const noToken = authenticateConnection({ peerCred: goodPeer, token: null }, ctx(token));
    expect(noToken.ok).toBe(false);
    if (!noToken.ok) expect(noToken.reason).toBe('bad-token');

    const wrongToken = authenticateConnection({ peerCred: goodPeer, token: mintBootToken() }, ctx(token));
    expect(wrongToken.ok).toBe(false);
    if (!wrongToken.ok) expect(wrongToken.reason).toBe('bad-token');
  });

  it('accepts ONLY when peer-cred AND token are both correct', () => {
    const token = mintBootToken();
    const result = authenticateConnection({ peerCred: goodPeer, token }, ctx(token));
    expect(result.ok).toBe(true);
  });

  it('mints a fresh, unguessable per-boot token each time (256-bit hex)', () => {
    const a = mintBootToken();
    const b = mintBootToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('defaultPeerReader is fail-closed: returns null until a real platform reader is wired (D3.6)', () => {
    // Passing a dummy connection object; the default must never fabricate a permissive credential.
    expect(defaultPeerReader({} as never)).toBeNull();
  });

  it('resolveExpectedOwnerId yields a stable non-empty owner id for the daemon', () => {
    expect(resolveExpectedOwnerId({ USERNAME: 'daniel' }).length).toBeGreaterThan(0);
  });
});

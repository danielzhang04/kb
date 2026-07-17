import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  authenticateConnection,
  mintBootToken,
  defaultPeerReader,
  resolveExpectedOwnerId,
  createControlSocket,
  createSecureControlSocket,
} from './socket.ts';
import type { Server } from 'node:net';
import type { PeerCredential, PeerCredentialReader, SocketAuthContext } from './socket.ts';
import type { OwnerBoundary } from './peerBoundary.ts';

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

/** Drive one request line through a server's connection handler WITHOUT any real pipe/socket: emit a
 *  fake `net.Socket` (an EventEmitter with a capturing `end`) on the server's 'connection' event, then
 *  feed it the line as a 'data' chunk. Returns whatever the handler wrote via `conn.end`. */
function drive(server: Server, line: string): { ended: string[]; threw: boolean } {
  const ended: string[] = [];
  const conn = new EventEmitter() as EventEmitter & { end: (m?: string) => void };
  conn.end = (m?: string) => {
    if (m !== undefined) ended.push(m);
  };
  let threw = false;
  server.emit('connection', conn);
  try {
    conn.emit('data', Buffer.from(line, 'utf-8'));
  } catch {
    threw = true;
  }
  return { ended, threw };
}

describe('broker/socket createControlSocket call-site (LOW-1)', () => {
  it('treats a THROWING peerReader as an unresolved credential — rejects, never lets the throw escape', () => {
    const token = mintBootToken();
    let dispatched = false;
    const throwingReader: PeerCredentialReader = () => {
      throw new Error('peer read blew up');
    };
    const server = createControlSocket({
      socketPath: '/unused',
      owner: {} as never,
      auth: { expectedOwnerId: OWNER, bootToken: token },
      peerReader: throwingReader,
      dispatch: () => {
        dispatched = true;
        return { ok: true };
      },
    });
    const { ended, threw } = drive(server, JSON.stringify({ token, verb: 'list' }) + '\n');
    expect(threw).toBe(false); // the 'data' handler did not propagate the reader's throw
    expect(dispatched).toBe(false); // verb layer never reached
    expect(ended[0]).toContain('unauthenticated: peer-credential');
  });
});

describe('broker/socket createSecureControlSocket (boundary-derived peer reader)', () => {
  const enforced = (ownerId: string): OwnerBoundary => ({ enforced: true, ownerId, socketPath: '/unused', detail: 'ok' });

  it('accepts and dispatches when the enforced boundary owner matches the daemon AND the token is valid', () => {
    const token = mintBootToken();
    let dispatched = false;
    const server = createSecureControlSocket({
      socketPath: '/unused',
      owner: {} as never,
      auth: { expectedOwnerId: OWNER, bootToken: token },
      dispatch: () => {
        dispatched = true;
        return { ok: true, result: 'listed-sessions' };
      },
      boundary: enforced(OWNER),
    });
    const { ended } = drive(server, JSON.stringify({ token, verb: 'list' }) + '\n');
    expect(dispatched).toBe(true);
    expect(ended[0]).toContain('listed-sessions');
  });

  it('rejects when the boundary is NOT enforced (fail-closed reader), even with a valid token', () => {
    const token = mintBootToken();
    let dispatched = false;
    const server = createSecureControlSocket({
      socketPath: '\\\\.\\pipe\\kb',
      owner: {} as never,
      auth: { expectedOwnerId: OWNER, bootToken: token },
      dispatch: () => {
        dispatched = true;
        return { ok: true };
      },
      boundary: { enforced: false, detail: 'win32 named-pipe ACL not enforceable' },
    });
    const { ended } = drive(server, JSON.stringify({ token, verb: 'list' }) + '\n');
    expect(dispatched).toBe(false);
    expect(ended[0]).toContain('unauthenticated: peer-credential');
  });

  it('rejects when the enforced boundary owner differs from the daemon owner (wrong peer)', () => {
    const token = mintBootToken();
    let dispatched = false;
    const server = createSecureControlSocket({
      socketPath: '/unused',
      owner: {} as never,
      auth: { expectedOwnerId: OWNER, bootToken: token },
      dispatch: () => {
        dispatched = true;
        return { ok: true };
      },
      boundary: enforced('uid-31337'),
    });
    const { ended } = drive(server, JSON.stringify({ token, verb: 'list' }) + '\n');
    expect(dispatched).toBe(false);
    expect(ended[0]).toContain('unauthenticated: peer-credential');
  });
});

import { describe, expect, it } from 'vitest';
import { findPeerUid, readProcNetTables } from './peerUid.ts';

/** Real `/proc/net/tcp` shape, captured on the live VM while a request traversed `tailscale serve`.
 *  Row 6 is the daemon's ACCEPTED socket (uid 999); row 8 is tailscaled's CLIENT socket (uid 0) —
 *  the peer whose owner the trust proof resolves. 0x10DD = 4317, 0xCF32 = 52994. */
const LIVE_TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   1: 0100007F:10DD 00000000:0000 0A 00000000:00000000 00:00000000 00000000   999        0 2529788 1 0000000000000000 100 0 0 10 0
   6: 0100007F:10DD 0100007F:CF32 01 00000000:00000000 00:00000000 00000000   999        0 2746714 1 0000000000000000 20 4 31 10 -1
   8: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 02:000002FE 00000000     0        0 2747946 2 0000000000000000 20 4 30 10 -1
`;

const EMPTY_TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
`;

describe('findPeerUid', () => {
  it('resolves the root-owned tailscaled peer of a serve-proxied connection', () => {
    expect(findPeerUid({ localPort: 4317, remotePort: 0xcf32, tables: [LIVE_TCP, EMPTY_TCP6] }))
      .toEqual({ ok: true, uid: 0 });
  });

  it('resolves a NON-root peer for a direct local connection — the forgery case', () => {
    // A worker running as the dashboard user (uid 999) connecting straight to 127.0.0.1:4317.
    const forged = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   3: 0100007F:10DD 0100007F:A001 01 00000000:00000000 00:00000000 00000000   999        0 111 1 0 20 4 30 10 -1
   4: 0100007F:A001 0100007F:10DD 01 00000000:00000000 00:00000000 00000000   999        0 112 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ localPort: 4317, remotePort: 0xa001, tables: [forged] })).toEqual({ ok: true, uid: 999 });
  });

  it('fails closed when no row matches the connection 4-tuple', () => {
    expect(findPeerUid({ localPort: 4317, remotePort: 1234, tables: [LIVE_TCP] }))
      .toEqual({ ok: false, reason: 'peer-socket-not-found' });
  });

  it('fails closed when the tables are unreadable/absent', () => {
    expect(findPeerUid({ localPort: 4317, remotePort: 0xcf32, tables: [] }))
      .toEqual({ ok: false, reason: 'peer-socket-not-found' });
  });

  it('ignores rows that are not ESTABLISHED', () => {
    const timeWait = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   9: 0100007F:CF32 0100007F:10DD 06 00000000:00000000 00:00000000 00000000     0        0 1 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ localPort: 4317, remotePort: 0xcf32, tables: [timeWait] }))
      .toEqual({ ok: false, reason: 'peer-socket-not-found' });
  });

  it('ignores rows whose endpoints are not loopback', () => {
    // Same ports, but the peer row is a real network socket — must never satisfy the proof.
    const remote = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   2: 764959A0:CF32 764959A0:10DD 01 00000000:00000000 00:00000000 00000000     0        0 1 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ localPort: 4317, remotePort: 0xcf32, tables: [remote] }))
      .toEqual({ ok: false, reason: 'peer-socket-not-found' });
  });

  it('fails closed when two different owners claim the same 4-tuple', () => {
    const ambiguous = `${LIVE_TCP}   9: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 00:00000000 00000000   999        0 3 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ localPort: 4317, remotePort: 0xcf32, tables: [ambiguous] }))
      .toEqual({ ok: false, reason: 'peer-socket-ambiguous' });
  });

  it('matches an IPv4-mapped loopback peer in the tcp6 table', () => {
    const tcp6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0000000000000000FFFF00000100007F:CF32 0000000000000000FFFF00000100007F:10DD 01 00000000:00000000 00:00000000 00000000     0        0 9 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ localPort: 4317, remotePort: 0xcf32, tables: [tcp6] })).toEqual({ ok: true, uid: 0 });
  });

  it('matches a ::1 peer in the tcp6 table', () => {
    const tcp6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:CF32 00000000000000000000000001000000:10DD 01 00000000:00000000 00:00000000 00000000     0        0 9 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ localPort: 4317, remotePort: 0xcf32, tables: [tcp6] })).toEqual({ ok: true, uid: 0 });
  });

  it('fails closed on an unparsable uid column', () => {
    const broken = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   8: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 00:00000000 00000000     x        0 1 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ localPort: 4317, remotePort: 0xcf32, tables: [broken] }))
      .toEqual({ ok: false, reason: 'peer-uid-unparsable' });
  });
});

describe('readProcNetTables', () => {
  it('returns both families when both read', () => {
    expect(readProcNetTables((path) => `table:${path}`)).toEqual(['table:/proc/net/tcp', 'table:/proc/net/tcp6']);
  });

  it('tolerates one family being absent and never throws', () => {
    expect(readProcNetTables((path) => {
      if (path.endsWith('tcp6')) throw new Error('ENOENT');
      return 'v4';
    })).toEqual(['v4']);
  });

  it('returns nothing — so the caller fails closed — when /proc is unreadable', () => {
    expect(readProcNetTables(() => { throw new Error('EACCES'); })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { findPeerUid, ipToProcHex, readProcNetTables } from './peerUid.ts';

/** Real `/proc/net/tcp` shape, captured on the live VM while a request traversed `tailscale serve`.
 *  Row 6 is the daemon's ACCEPTED socket (uid 999); row 8 is tailscaled's CLIENT socket (uid 0) —
 *  the peer whose owner the trust proof resolves. 0x10DD = 4317, 0xCF32 = 52994. Both endpoints
 *  127.0.0.1 (0100007F). */
const LIVE_TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   1: 0100007F:10DD 00000000:0000 0A 00000000:00000000 00:00000000 00000000   999        0 2529788 1 0000000000000000 100 0 0 10 0
   6: 0100007F:10DD 0100007F:CF32 01 00000000:00000000 00:00000000 00000000   999        0 2746714 1 0000000000000000 20 4 31 10 -1
   8: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 02:000002FE 00000000     0        0 2747946 2 0000000000000000 20 4 30 10 -1
`;

const EMPTY_TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
`;

/** The genuine serve-proxied connection, from the daemon's accept() point of view. */
const SERVE_CONN = { localAddress: '127.0.0.1', localPort: 4317, remoteAddress: '127.0.0.1', remotePort: 0xcf32 };

describe('findPeerUid', () => {
  it('resolves the root-owned tailscaled peer of a serve-proxied connection', () => {
    expect(findPeerUid({ ...SERVE_CONN, tables: [LIVE_TCP, EMPTY_TCP6] })).toEqual({ ok: true, uid: 0 });
  });

  it('resolves a NON-root peer for a direct local connection — the forgery case', () => {
    // A worker running as the dashboard user (uid 999) connecting straight to 127.0.0.1:4317.
    const forged = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   3: 0100007F:10DD 0100007F:A001 01 00000000:00000000 00:00000000 00000000   999        0 111 1 0 20 4 30 10 -1
   4: 0100007F:A001 0100007F:10DD 01 00000000:00000000 00:00000000 00000000   999        0 112 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({
      localAddress: '127.0.0.1', localPort: 4317, remoteAddress: '127.0.0.1', remotePort: 0xa001, tables: [forged],
    })).toEqual({ ok: true, uid: 999 });
  });

  it('SECURITY: rejects the source-address spoof — attacker binds 127.0.0.2:<tailscaled port>', () => {
    // Exploit the port-pair-only match once had: the attacker binds 127.0.0.2 on the SAME source port
    // tailscaled is using for a concurrent genuine connection, then connects to 127.0.0.1:4317. Its own
    // accepted connection has remoteAddress 127.0.0.2. Two ESTABLISHED rows now carry that port pair:
    //   - the attacker's own client socket    local 0200007F:CF32  (uid 999)
    //   - tailscaled's genuine client socket   local 0100007F:CF32  (uid 0)
    // Matching only on ports + "any loopback" returned tailscaled's uid 0 → full bypass. Matching the
    // FULL 4-tuple against the attacker's real 127.0.0.2 endpoint selects only the attacker's own row.
    const spoof = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   6: 0100007F:10DD 0200007F:CF32 01 00000000:00000000 00:00000000 00000000   999        0 1 1 0 20 4 31 10 -1
   7: 0200007F:CF32 0100007F:10DD 01 00000000:00000000 00:00000000 00000000   999        0 2 1 0 20 4 30 10 -1
   8: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 02:000002FE 00000000     0        0 3 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({
      localAddress: '127.0.0.1', localPort: 4317, remoteAddress: '127.0.0.2', remotePort: 0xcf32, tables: [spoof],
    })).toEqual({ ok: true, uid: 999 });
  });

  it('fails closed when no row matches the connection 4-tuple', () => {
    expect(findPeerUid({ ...SERVE_CONN, remotePort: 1234, tables: [LIVE_TCP] }))
      .toEqual({ ok: false, reason: 'peer-socket-not-found' });
  });

  it('fails closed when only the ports match but the peer address differs', () => {
    // tailscaled's row survives, but the accepted connection's remote is 127.0.0.2, not 127.0.0.1 —
    // so tailscaled's 0100007F row is NOT this connection's peer.
    expect(findPeerUid({ ...SERVE_CONN, remoteAddress: '127.0.0.2', tables: [LIVE_TCP] }))
      .toEqual({ ok: false, reason: 'peer-socket-not-found' });
  });

  it('fails closed when the tables are unreadable/absent', () => {
    expect(findPeerUid({ ...SERVE_CONN, tables: [] })).toEqual({ ok: false, reason: 'peer-socket-not-found' });
  });

  it('fails closed when the connection address is unparsable', () => {
    expect(findPeerUid({ ...SERVE_CONN, remoteAddress: 'garbage', tables: [LIVE_TCP] }))
      .toEqual({ ok: false, reason: 'peer-address-unparsable' });
  });

  it('ignores rows that are not ESTABLISHED', () => {
    const timeWait = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   9: 0100007F:CF32 0100007F:10DD 06 00000000:00000000 00:00000000 00000000     0        0 1 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ ...SERVE_CONN, tables: [timeWait] })).toEqual({ ok: false, reason: 'peer-socket-not-found' });
  });

  it('fails closed when two different owners claim the same 4-tuple', () => {
    const ambiguous = `${LIVE_TCP}   9: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 00:00000000 00000000   999        0 3 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ ...SERVE_CONN, tables: [ambiguous] })).toEqual({ ok: false, reason: 'peer-socket-ambiguous' });
  });

  it('matches an IPv4-mapped loopback peer in the tcp6 table', () => {
    const tcp6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0000000000000000FFFF00000100007F:CF32 0000000000000000FFFF00000100007F:10DD 01 00000000:00000000 00:00000000 00000000     0        0 9 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({
      localAddress: '::ffff:127.0.0.1', localPort: 4317, remoteAddress: '::ffff:127.0.0.1', remotePort: 0xcf32, tables: [tcp6],
    })).toEqual({ ok: true, uid: 0 });
  });

  it('matches a ::1 peer in the tcp6 table', () => {
    const tcp6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:CF32 00000000000000000000000001000000:10DD 01 00000000:00000000 00:00000000 00000000     0        0 9 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({
      localAddress: '::1', localPort: 4317, remoteAddress: '::1', remotePort: 0xcf32, tables: [tcp6],
    })).toEqual({ ok: true, uid: 0 });
  });

  it('fails closed on an unparsable uid column', () => {
    const broken = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   8: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 00:00000000 00000000     x        0 1 1 0 20 4 30 10 -1
`;
    expect(findPeerUid({ ...SERVE_CONN, tables: [broken] })).toEqual({ ok: false, reason: 'peer-uid-unparsable' });
  });
});

describe('ipToProcHex', () => {
  it('renders IPv4 loopback in the kernel little-endian form', () => {
    expect(ipToProcHex('127.0.0.1')).toBe('0100007F');
    expect(ipToProcHex('127.0.0.2')).toBe('0200007F');
  });

  it('renders IPv6 loopback and the v4-mapped form', () => {
    expect(ipToProcHex('::1')).toBe('00000000000000000000000001000000');
    expect(ipToProcHex('::ffff:127.0.0.1')).toBe('0000000000000000FFFF00000100007F');
  });

  it('returns null for anything it cannot parse', () => {
    for (const bad of ['garbage', '127.0.0', '999.0.0.1', '', '127.0.0.1.5']) {
      expect(ipToProcHex(bad)).toBeNull();
    }
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

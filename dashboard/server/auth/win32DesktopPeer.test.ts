/**
 * The win32-desktop peer-owner proof — the OS-level half of the desktop mint path.
 *
 * Three layers are tested independently:
 *  1. Pure parsers over the exact byte layouts Windows returns (`MIB_TCPTABLE_OWNER_PID`,
 *     `MIB_TCP6TABLE_OWNER_PID`, `TOKEN_USER`). Synthetic buffers, so they run on any platform.
 *  2. The fail-closed decision matrix over injected seams.
 *  3. A LIVE win32 proof over a real accepted loopback socket (skipped off win32), which is the only
 *     thing that can show the koffi/iphlpapi path actually resolves this process as its own peer.
 */
import { createServer, connect } from 'node:net';
import { userInfo } from 'node:os';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopPeerCheck,
  createWin32PeerOwner,
  currentUserSid,
  findPeerOwnerPid,
  formatSid,
  MIB_TCP_STATE_ESTABLISHED,
  parseTcpOwnerTableV4,
  parseTcpOwnerTableV6,
  parseTokenUserSid,
  readTcpOwnerRows,
  type TcpOwnerRow,
} from './win32DesktopPeer.ts';

/** One `MIB_TCPTABLE_OWNER_PID` buffer: `dwNumEntries` then 24-byte rows. */
function v4Table(rows: Array<{ state: number; local: string; localPort: number; remote: string; remotePort: number; pid: number }>): Buffer {
  const buffer = Buffer.alloc(4 + rows.length * 24);
  buffer.writeUInt32LE(rows.length, 0);
  rows.forEach((row, index) => {
    const at = 4 + index * 24;
    buffer.writeUInt32LE(row.state, at);
    for (const [offset, octet] of row.local.split('.').entries()) buffer[at + 4 + offset] = Number(octet);
    buffer.writeUInt16BE(row.localPort, at + 8);
    for (const [offset, octet] of row.remote.split('.').entries()) buffer[at + 12 + offset] = Number(octet);
    buffer.writeUInt16BE(row.remotePort, at + 16);
    buffer.writeUInt32LE(row.pid, at + 20);
  });
  return buffer;
}

/** One `MIB_TCP6TABLE_OWNER_PID` buffer: `dwNumEntries` then 56-byte rows. */
function v6Table(rows: Array<{ state: number; local: Buffer; localPort: number; remote: Buffer; remotePort: number; pid: number }>): Buffer {
  const buffer = Buffer.alloc(4 + rows.length * 56);
  buffer.writeUInt32LE(rows.length, 0);
  rows.forEach((row, index) => {
    const at = 4 + index * 56;
    row.local.copy(buffer, at);
    buffer.writeUInt16BE(row.localPort, at + 20);
    row.remote.copy(buffer, at + 24);
    buffer.writeUInt16BE(row.remotePort, at + 44);
    buffer.writeUInt32LE(row.state, at + 48);
    buffer.writeUInt32LE(row.pid, at + 52);
  });
  return buffer;
}

const LOOPBACK6 = Buffer.concat([Buffer.alloc(15), Buffer.from([1])]);
const sid = (...subAuthorities: number[]): Buffer => {
  const buffer = Buffer.alloc(8 + subAuthorities.length * 4);
  buffer[0] = 1;
  buffer[1] = subAuthorities.length;
  buffer[7] = 5; // NT authority
  subAuthorities.forEach((value, index) => buffer.writeUInt32LE(value, 8 + index * 4));
  return buffer;
};
const DANIEL = sid(21, 111, 222, 333, 1001);
const OTHER = sid(21, 111, 222, 333, 1002);

/** A `TOKEN_USER` buffer as x64 Windows fills it: `{PSID Sid; DWORD Attributes;}` padded to 16, SID appended. */
function tokenUser(value: Buffer, pointerSize = 8): { buffer: Buffer; returnLength: number } {
  const header = pointerSize === 8 ? 16 : 12;
  const buffer = Buffer.alloc(header + value.length + 64);
  buffer.writeUInt32LE(0xdeadbeef, 0); // a pointer value we deliberately never chase
  value.copy(buffer, header);
  return { buffer, returnLength: header + value.length };
}

const socketOf = (over: Partial<{ remoteAddress: string; remotePort: number; localAddress: string; localPort: number }> = {}) => ({
  socket: {
    remoteAddress: '127.0.0.1', remotePort: 51000, localAddress: '127.0.0.1', localPort: 4317, ...over,
  },
});

describe('parseTcpOwnerTableV4', () => {
  it('reads state, both endpoints, and the owning pid out of the kernel layout', () => {
    const rows = parseTcpOwnerTableV4(v4Table([
      { state: MIB_TCP_STATE_ESTABLISHED, local: '127.0.0.1', localPort: 51000, remote: '127.0.0.1', remotePort: 4317, pid: 4242 },
      { state: 2, local: '0.0.0.0', localPort: 4317, remote: '0.0.0.0', remotePort: 0, pid: 7 },
    ]));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ state: MIB_TCP_STATE_ESTABLISHED, localPort: 51000, remotePort: 4317, owningPid: 4242 });
    expect([...rows[0].localAddress]).toEqual([127, 0, 0, 1]);
    expect(rows[1].owningPid).toBe(7);
  });

  it('returns nothing for a truncated table rather than inventing a row', () => {
    const truncated = v4Table([{ state: 5, local: '127.0.0.1', localPort: 1, remote: '127.0.0.1', remotePort: 2, pid: 3 }]).subarray(0, 20);
    expect(parseTcpOwnerTableV4(truncated)).toEqual([]);
    expect(parseTcpOwnerTableV4(Buffer.alloc(0))).toEqual([]);
  });
});

describe('parseTcpOwnerTableV6', () => {
  it('reads the 56-byte IPv6 row layout', () => {
    const rows = parseTcpOwnerTableV6(v6Table([
      { state: MIB_TCP_STATE_ESTABLISHED, local: LOOPBACK6, localPort: 51001, remote: LOOPBACK6, remotePort: 4317, pid: 99 },
    ]));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ family: 'ipv6', state: MIB_TCP_STATE_ESTABLISHED, localPort: 51001, remotePort: 4317, owningPid: 99 });
    expect(rows[0].localAddress.equals(LOOPBACK6)).toBe(true);
  });
});

describe('findPeerOwnerPid', () => {
  const rows = parseTcpOwnerTableV4(v4Table([
    { state: MIB_TCP_STATE_ESTABLISHED, local: '127.0.0.1', localPort: 51000, remote: '127.0.0.1', remotePort: 4317, pid: 4242 },
    { state: MIB_TCP_STATE_ESTABLISHED, local: '127.0.0.1', localPort: 4317, remote: '127.0.0.1', remotePort: 51000, pid: 1 },
  ]));
  const query = { localAddress: '127.0.0.1', localPort: 4317, remoteAddress: '127.0.0.1', remotePort: 51000 };

  it('selects the mirror row — the peer socket, never our own', () => {
    expect(findPeerOwnerPid({ ...query, rows })).toEqual({ ok: true, pid: 4242 });
  });

  it('refuses a row that is not ESTABLISHED', () => {
    const halfOpen = parseTcpOwnerTableV4(v4Table([
      { state: 3, local: '127.0.0.1', localPort: 51000, remote: '127.0.0.1', remotePort: 4317, pid: 4242 },
    ]));
    expect(findPeerOwnerPid({ ...query, rows: halfOpen })).toEqual({ ok: false, reason: 'peer-unknown' });
  });

  it('matches the FULL 4-tuple: the same port pair on another loopback address is not this peer', () => {
    const spoofed = parseTcpOwnerTableV4(v4Table([
      { state: MIB_TCP_STATE_ESTABLISHED, local: '127.0.0.2', localPort: 51000, remote: '127.0.0.1', remotePort: 4317, pid: 4242 },
    ]));
    expect(findPeerOwnerPid({ ...query, rows: spoofed })).toEqual({ ok: false, reason: 'peer-unknown' });
  });

  it('refuses when two different pids claim one 4-tuple', () => {
    const ambiguous: TcpOwnerRow[] = [...rows, { ...rows[0], owningPid: 9999 }];
    expect(findPeerOwnerPid({ ...query, rows: ambiguous })).toEqual({ ok: false, reason: 'peer-ambiguous' });
  });

  it('refuses an address it cannot parse', () => {
    expect(findPeerOwnerPid({ ...query, remoteAddress: 'not-an-address', rows })).toEqual({ ok: false, reason: 'peer-unknown' });
  });

  it('matches an IPv6 peer on the v6 table', () => {
    const v6 = parseTcpOwnerTableV6(v6Table([
      { state: MIB_TCP_STATE_ESTABLISHED, local: LOOPBACK6, localPort: 51001, remote: LOOPBACK6, remotePort: 4317, pid: 777 },
    ]));
    expect(findPeerOwnerPid({ localAddress: '::1', localPort: 4317, remoteAddress: '::1', remotePort: 51001, rows: v6 }))
      .toEqual({ ok: true, pid: 777 });
  });
});

describe('parseTokenUserSid', () => {
  it('reads the SID Windows appends after the TOKEN_USER header', () => {
    const { buffer, returnLength } = tokenUser(DANIEL);
    expect(parseTokenUserSid(buffer, returnLength)?.equals(DANIEL)).toBe(true);
  });

  it('reads the 32-bit header layout too', () => {
    const { buffer, returnLength } = tokenUser(DANIEL, 4);
    expect(parseTokenUserSid(buffer, returnLength)?.equals(DANIEL)).toBe(true);
  });

  it('returns null for a buffer whose SID does not validate', () => {
    const { buffer, returnLength } = tokenUser(DANIEL);
    buffer[16] = 9; // revision must be 1
    expect(parseTokenUserSid(buffer, returnLength)).toBeNull();
    expect(parseTokenUserSid(Buffer.alloc(8), 8)).toBeNull();
  });
});

describe('formatSid', () => {
  it('renders the canonical S-1-5-21-... form', () => {
    expect(formatSid(DANIEL)).toBe('S-1-5-21-111-222-333-1001');
  });

  it('returns null for bytes that are not a SID', () => {
    expect(formatSid(Buffer.from([2, 1, 0, 0, 0, 0, 0, 5]))).toBeNull();
  });
});

describe('createWin32PeerOwner — the fail-closed decision matrix', () => {
  const owner = (over: Parameters<typeof createWin32PeerOwner>[0] = {}) => createWin32PeerOwner({
    readRows: () => parseTcpOwnerTableV4(v4Table([
      { state: MIB_TCP_STATE_ESTABLISHED, local: '127.0.0.1', localPort: 51000, remote: '127.0.0.1', remotePort: 4317, pid: 4242 },
    ])),
    processUserSid: () => DANIEL,
    currentUserSid: () => DANIEL,
    userName: () => 'daniel',
    ...over,
  });

  it('admits a loopback peer owned by the daemon-s own user', () => {
    expect(owner()(socketOf())).toEqual({ ok: true, user: 'daniel' });
  });

  it('refuses a peer owned by another OS user', () => {
    expect(owner({ processUserSid: () => OTHER })(socketOf())).toEqual({ ok: false, reason: 'peer-not-same-user' });
  });

  it('refuses when the peer process cannot be opened at all (another user, typically)', () => {
    expect(owner({ processUserSid: () => null })(socketOf())).toEqual({ ok: false, reason: 'peer-unknown' });
  });

  it('refuses when our OWN user cannot be resolved', () => {
    expect(owner({ currentUserSid: () => null })(socketOf())).toEqual({ ok: false, reason: 'peer-lookup-unavailable' });
  });

  it('refuses a connection that is not loopback on BOTH ends', () => {
    expect(owner()(socketOf({ remoteAddress: '10.1.2.3' }))).toEqual({ ok: false, reason: 'not-loopback' });
    expect(owner()(socketOf({ localAddress: '10.1.2.3' }))).toEqual({ ok: false, reason: 'not-loopback' });
    expect(owner()(socketOf({ remoteAddress: '127.0.0.2' }))).toEqual({ ok: false, reason: 'not-loopback' });
  });

  it('refuses a request with no socket endpoints to prove anything about', () => {
    expect(owner()({})).toEqual({ ok: false, reason: 'not-loopback' });
    expect(owner()(socketOf({ remotePort: undefined as unknown as number }))).toEqual({ ok: false, reason: 'peer-unknown' });
  });

  it('refuses — never admits — when the table read throws', () => {
    const throwing = owner({ readRows: () => { throw new Error('iphlpapi unavailable'); } });
    expect(throwing(socketOf())).toEqual({ ok: false, reason: 'peer-lookup-unavailable' });
  });

  it('never reads the table for a connection it has already refused as non-loopback', () => {
    const readRows = vi.fn(() => []);
    owner({ readRows })(socketOf({ remoteAddress: '10.1.2.3' }));
    expect(readRows).not.toHaveBeenCalled();
  });
});

describe('createDesktopPeerCheck', () => {
  const admit = () => ({ ok: true as const, user: 'daniel' });

  it('delegates to the peer owner on win32', () => {
    expect(createDesktopPeerCheck({ platform: 'win32', peerOwner: admit })(socketOf())).toEqual({ ok: true, user: 'daniel' });
  });

  it('fails closed off win32 without consulting the peer owner', () => {
    const peerOwner = vi.fn(admit);
    expect(createDesktopPeerCheck({ platform: 'linux', peerOwner })(socketOf()))
      .toEqual({ ok: false, reason: 'unsupported-platform' });
    expect(peerOwner).not.toHaveBeenCalled();
  });
});

const onWin32 = process.platform === 'win32' ? describe : describe.skip;

onWin32('LIVE win32 proof — a real accepted loopback socket', () => {
  it('resolves this process as its own peer, and agrees with `whoami /user` on the SID', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const accepted = new Promise<{ remoteAddress?: string; remotePort?: number; localAddress?: string; localPort?: number }>(
      (resolve) => server.once('connection', (socket) => resolve(socket)),
    );
    const client = connect({ port, host: '127.0.0.1' });
    await new Promise<void>((resolve, reject) => { client.once('connect', () => resolve()); client.once('error', reject); });
    const socket = await accepted;

    const result = createWin32PeerOwner()({ socket });

    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(result).toEqual({ ok: true, user: userInfo().username });
  });

  it('reads the real tables and this process-s real SID', () => {
    expect(readTcpOwnerRows().length).toBeGreaterThan(0);
    const mine = currentUserSid();
    expect(mine).not.toBeNull();
    // The ABSOLUTE system path: a POSIX `whoami` earlier on PATH (Git Bash ships one) does not take `/user`.
    const whoami = `${(process.env.SystemRoot ?? 'C:/Windows').split('\\').join('/')}/System32/whoami.exe`;
    const reported = execFileSync(whoami, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf-8' });
    expect(reported).toContain(formatSid(mine as Buffer) as string);
  });
});

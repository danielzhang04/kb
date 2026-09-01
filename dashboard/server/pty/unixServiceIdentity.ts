import type { Socket } from 'node:net';

/**
 * The two facts BOTH ends of the broker socket need about the machine's service accounts, in one
 * place because they must agree exactly. The broker (running as `kb-shell`) uses them to decide which
 * peer may connect at all; the dashboard's capability probe (running as `kb-dashboard`) uses the same
 * numbers in the other direction, to decide whether the process that answered really is the broker.
 * Two copies of this parsing would be two chances to disagree about who `kb-shell` is.
 */

export type UnixPeerIdentity = { pid: number; uid: number; gid: number };

/**
 * One numeric field of one named row of an `/etc/passwd` or `/etc/group` document. A missing row, a
 * non-integer, and a non-positive id are all the same answer — a throw. There is no id 0 here on
 * purpose: nothing in this stack may resolve a service account to root.
 */
export function namedId(document: string, name: 'kb-shell' | 'kb-dashboard', field: number): number {
  const row = document.split(/\r?\n/).find((line) => line.split(':')[0] === name);
  const value = row === undefined ? Number.NaN : Number(row.split(':')[field]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} identity is missing`);
  return value;
}

/**
 * SO_PEERCRED on a connected Unix socket: the kernel's own answer for who is on the other end,
 * recorded at connect time and unforgeable by the peer. Linux-only, because that is the only place
 * this socket exists.
 */
export async function readUnixPeerIdentity(socket: Socket): Promise<UnixPeerIdentity> {
  if (process.platform !== 'linux') throw new Error('Unix peer identity is Linux-only');
  const fd = (socket as Socket & { _handle?: { fd?: number } })._handle?.fd;
  if (!Number.isInteger(fd) || (fd as number) < 0) throw new Error('Unix peer descriptor unavailable');
  const koffi = (await import('koffi')).default;
  const libc = koffi.load(null);
  const getsockopt = libc.func('int getsockopt(int, int, int, _Out_ void *, _Inout_ unsigned int *)');
  const credentials = Buffer.alloc(12);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(credentials.byteLength, 0);
  const result = getsockopt(fd, 1, 17, credentials, length) as number;
  if (result !== 0 || length.readUInt32LE(0) !== 12) throw new Error('SO_PEERCRED failed');
  return { pid: credentials.readInt32LE(0), uid: credentials.readUInt32LE(4), gid: credentials.readUInt32LE(8) };
}

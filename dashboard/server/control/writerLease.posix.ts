import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { NativeWriterLease } from './writerLease.ts';

const nodeRequire = createRequire(import.meta.url);
const O_RDWR = 0x0002;
const O_CREAT = 0x0040;
const O_CLOEXEC = 0x80000;
const LOCK_EX = 0x02;
const LOCK_NB = 0x04;
const F_GETFD = 1;
const FD_CLOEXEC = 1;

type KoffiFn = (...args: unknown[]) => unknown;
interface KoffiLibrary { func(name: string, result: string, args: unknown[]): KoffiFn }
interface Koffi {
  load(name: string): KoffiLibrary;
  errno(): number;
}

interface FileIdentity { major: bigint; minor: bigint; inode: bigint }

function processStatStartTicks(encoded: string): number | null {
  const fields = encoded.slice(encoded.lastIndexOf(')') + 1).trim().split(/\s+/);
  return Number.parseInt(fields[19] ?? '', 10) || null;
}

export function posixProcessStartTicks(pid: number): number | null {
  try { return processStatStartTicks(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return null; }
}

function linuxDeviceTuple(device: bigint): { major: bigint; minor: bigint } {
  return {
    major: ((device >> 8n) & 0xfffn) | ((device >> 32n) & 0xfffff000n),
    minor: (device & 0xffn) | ((device >> 12n) & 0xffffff00n),
  };
}

/** @internal */
export function parseProcLocksForTest(encoded: string, identity: FileIdentity): number | null {
  for (const line of encoded.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 6) continue;
    if (fields[1] !== 'FLOCK') continue;
    const pid = Number.parseInt(fields[4] ?? '', 10);
    const match = /^(?<major>[0-9a-f]+):(?<minor>[0-9a-f]+):(?<inode>\d+)$/i.exec(fields[5] ?? '');
    if (!Number.isInteger(pid) || pid <= 0 || !match?.groups) continue;
    if (BigInt(`0x${match.groups.major}`) === identity.major
      && BigInt(`0x${match.groups.minor}`) === identity.minor
      && BigInt(match.groups.inode) === identity.inode) return pid;
  }
  return null;
}

function loadBindings() {
  if (process.platform !== 'linux') throw new Error('POSIX writer lease currently requires the Linux /proc contract');
  const koffi = nodeRequire('koffi') as Koffi;
  const libc = koffi.load('libc.so.6');
  return {
    errno: () => koffi.errno(),
    open: libc.func('open', 'int', ['str', 'int', 'uint32']),
    flock: libc.func('flock', 'int', ['int', 'int']),
    fcntl: libc.func('fcntl', 'int', ['int', 'int']),
    fstat: libc.func('fstat', 'int', ['int', 'void *']),
    close: libc.func('close', 'int', ['int']),
  };
}

function identityForFd(fstat: KoffiFn, fd: number): FileIdentity {
  // Linux x86_64 glibc struct stat begins with st_dev, st_ino. The oversized buffer leaves the
  // remainder ABI-owned while avoiding a hand-maintained declaration for fields we never inspect.
  const stat = Buffer.alloc(256);
  if ((fstat(fd, stat) as number) !== 0) throw new Error('fstat failed for dashboard writer lease');
  const device = stat.readBigUInt64LE(0);
  const { major, minor } = linuxDeviceTuple(device);
  return { major, minor, inode: stat.readBigUInt64LE(8) };
}

function lockHolder(identity: FileIdentity): number | null {
  try { return parseProcLocksForTest(readFileSync('/proc/locks', 'utf8'), identity); } catch { return null; }
}

export function acquirePosixWriterLease(lockPath: string):
  { lease: NativeWriterLease; holderPid: null } | { lease: null; holderPid: number | null } {
  const bindings = loadBindings();
  const fd = bindings.open(lockPath, O_RDWR | O_CREAT | O_CLOEXEC, 0o600) as number;
  if (fd < 0) {
    const errno = bindings.errno();
    throw new Error(`open failed for dashboard writer lease (errno ${errno})`);
  }
  let closed = false;
  try {
    const flags = bindings.fcntl(fd, F_GETFD) as number;
    if (flags < 0 || (flags & FD_CLOEXEC) === 0) throw new Error('dashboard writer lease fd is inheritable');
    const identity = identityForFd(bindings.fstat, fd);
    if ((bindings.flock(fd, LOCK_EX | LOCK_NB) as number) !== 0) {
      const holderPid = lockHolder(identity);
      bindings.close(fd);
      closed = true;
      return { lease: null, holderPid };
    }
    const assertHeld = (): void => {
      if (closed) throw new Error('writer lease has been released');
      const currentFlags = bindings.fcntl(fd, F_GETFD) as number;
      if (currentFlags < 0) throw new Error('dashboard writer lease fd is invalid');
      if ((currentFlags & FD_CLOEXEC) === 0) throw new Error('dashboard writer lease fd is inheritable');
    };
    const assertOwnedForContentionCleanup = (): void => {
      assertHeld();
      const current = identityForFd(bindings.fstat, fd);
      const holderPid = lockHolder(current);
      if (current.major !== identity.major || current.minor !== identity.minor || current.inode !== identity.inode
        || holderPid !== process.pid) throw new Error('dashboard writer lease ownership check failed');
    };
    return {
      lease: {
        inheritFlagSet: false,
        assertHeld,
        assertOwnedForContentionCleanup,
        release() {
          if (closed) return;
          closed = true;
          bindings.close(fd);
        },
      },
      holderPid: null,
    };
  } catch (error) {
    if (!closed) bindings.close(fd);
    throw error;
  }
}

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import {
  establishOwnerBoundary,
  secureSocketFile,
  ownerBoundedReader,
} from './peerBoundary.ts';
import type { BoundaryFs, OwnerBoundary } from './peerBoundary.ts';

const S_IFDIR = 0o40000;
const S_IFLNK = 0o120000;
const S_IFSOCK = 0o140000;

/** A recording fake fs. `statResult` is what statSync returns; `lstatResult` what lstatSync returns
 *  (defaults to a plain 0700 dir — NOT a symlink); ops are captured for assertions. */
function fakeFs(
  statResult: { uid: number; mode: number } | (() => { uid: number; mode: number }),
  throwOn?: 'mkdir' | 'chmod' | 'stat' | 'lstat',
  lstatResult: { uid: number; mode: number } = { uid: 1000, mode: S_IFDIR | 0o700 },
) {
  const calls = { mkdir: [] as unknown[][], chmod: [] as unknown[][], stat: [] as unknown[][], lstat: [] as unknown[][] };
  const fs: BoundaryFs = {
    mkdirSync: (p, opts) => {
      calls.mkdir.push([p, opts]);
      if (throwOn === 'mkdir') throw new Error('EACCES mkdir');
    },
    chmodSync: (p, mode) => {
      calls.chmod.push([p, mode]);
      if (throwOn === 'chmod') throw new Error('EPERM chmod');
    },
    statSync: (p) => {
      calls.stat.push([p]);
      if (throwOn === 'stat') throw new Error('ENOENT stat');
      return typeof statResult === 'function' ? statResult() : statResult;
    },
    lstatSync: (p) => {
      calls.lstat.push([p]);
      if (throwOn === 'lstat') throw new Error('ENOENT lstat');
      return lstatResult;
    },
  };
  return { fs, calls };
}

const SOCK = '/run/user/1000/kb-broker/control.sock';
const DIR = '/run/user/1000/kb-broker';

describe('establishOwnerBoundary (POSIX unix-domain socket)', () => {
  it('enforces when the parent dir is created 0700 and stat confirms owner + no group/other bits', () => {
    const { fs, calls } = fakeFs({ uid: 1000, mode: 0o40700 });
    const b = establishOwnerBoundary({ socketPath: SOCK, platform: 'linux', getuid: () => 1000, fs, dirname: () => DIR });
    expect(b.enforced).toBe(true);
    if (b.enforced) {
      expect(b.ownerId).toBe('1000');
      expect(b.socketPath).toBe(SOCK);
    }
    // The restriction is actually APPLIED, not merely asserted: mkdir 0700 + explicit chmod 0700 + stat.
    expect(calls.mkdir).toEqual([[DIR, { recursive: true, mode: 0o700 }]]);
    expect(calls.chmod).toEqual([[DIR, 0o700]]);
    expect(calls.stat.length).toBe(1);
    // The symlink guard lstat'd the dir before trusting statSync.
    expect(calls.lstat).toEqual([[DIR]]);
  });

  it('fails closed when the dir is owned by a DIFFERENT uid than the daemon', () => {
    const { fs } = fakeFs({ uid: 0, mode: 0o40700 });
    const b = establishOwnerBoundary({ socketPath: SOCK, platform: 'linux', getuid: () => 1000, fs, dirname: () => DIR });
    expect(b.enforced).toBe(false);
  });

  it('fails closed when the dir grants ANY group/other permission bit', () => {
    const { fs } = fakeFs({ uid: 1000, mode: 0o40755 });
    const b = establishOwnerBoundary({ socketPath: SOCK, platform: 'linux', getuid: () => 1000, fs, dirname: () => DIR });
    expect(b.enforced).toBe(false);
  });

  it('fails closed (never throws) when applying the restriction errors', () => {
    const { fs } = fakeFs({ uid: 1000, mode: 0o40700 }, 'mkdir');
    const b = establishOwnerBoundary({ socketPath: SOCK, platform: 'linux', getuid: () => 1000, fs, dirname: () => DIR });
    expect(b.enforced).toBe(false);
    if (!b.enforced) expect(b.detail).toMatch(/fail-closed/);
  });

  it('fails closed when the parent dir is a SYMLINK (lstat catches what stat would follow) [MED]', () => {
    // stat would resolve the link target (owner 1000, 0700) and pass; lstat sees the link and must reject.
    const { fs } = fakeFs({ uid: 1000, mode: 0o40700 }, undefined, { uid: 1000, mode: S_IFLNK | 0o777 });
    const b = establishOwnerBoundary({ socketPath: SOCK, platform: 'linux', getuid: () => 1000, fs, dirname: () => DIR });
    expect(b.enforced).toBe(false);
    if (!b.enforced) expect(b.detail).toMatch(/symlink/);
  });

  it('fails closed for a non-absolute socket path [LOW]', () => {
    const { fs } = fakeFs({ uid: 1000, mode: 0o40700 });
    const b = establishOwnerBoundary({ socketPath: 'relative/control.sock', platform: 'linux', getuid: () => 1000, fs, dirname: () => 'relative' });
    expect(b.enforced).toBe(false);
    if (!b.enforced) expect(b.detail).toMatch(/absolute/);
  });

  it('fails closed for an abstract-namespace / NUL-bearing socket path [LOW]', () => {
    const { fs } = fakeFs({ uid: 1000, mode: 0o40700 });
    const abstract = '\0kb-broker';
    const b = establishOwnerBoundary({ socketPath: abstract, platform: 'linux', getuid: () => 1000, fs, dirname: () => '' });
    expect(b.enforced).toBe(false);
    const embedded = establishOwnerBoundary({ socketPath: '/run/kb\0/x.sock', platform: 'linux', getuid: () => 1000, fs, dirname: () => '/run/kb\0' });
    expect(embedded.enforced).toBe(false);
  });
});

describe('establishOwnerBoundary (unenforceable platforms fail closed)', () => {
  it('reports un-enforced on win32 (native pipe server handles the SID check instead)', () => {
    const { fs } = fakeFs({ uid: 1000, mode: 0o40700 });
    const b = establishOwnerBoundary({ socketPath: '\\\\.\\pipe\\kb', platform: 'win32', getuid: () => 1000, fs, dirname: () => '\\\\.\\pipe' });
    expect(b.enforced).toBe(false);
    if (!b.enforced) expect(b.detail).toMatch(/win32/);
  });

  it('fails closed on an unknown platform with no getuid()', () => {
    const { fs } = fakeFs({ uid: 1000, mode: 0o40700 });
    const b = establishOwnerBoundary({ socketPath: SOCK, platform: 'freebsd', getuid: undefined, fs, dirname: () => DIR });
    expect(b.enforced).toBe(false);
  });
});

describe('secureSocketFile (post-listen socket-inode + parent-dir hardening)', () => {
  const enforced: OwnerBoundary = { enforced: true, ownerId: '1000', socketPath: SOCK, detail: 'ok' };

  it('chmods the socket inode to 0600 and re-verifies socket + parent owner/mode, preserving the boundary', () => {
    const { fs, calls } = fakeFs({ uid: 1000, mode: S_IFSOCK | 0o600 });
    const b = secureSocketFile(enforced, fs);
    expect(b.enforced).toBe(true);
    expect(calls.chmod).toEqual([[SOCK, 0o600]]);
    // Re-verified BOTH the socket inode and the parent dir (stat x2), plus a parent symlink lstat.
    expect(calls.stat.length).toBe(2);
    expect(calls.lstat).toEqual([[DIR]]);
  });

  it('fails closed when the post-listen socket owner/mode verification does not match', () => {
    const { fs } = fakeFs({ uid: 1000, mode: S_IFSOCK | 0o660 }); // group bit set
    expect(secureSocketFile(enforced, fs).enforced).toBe(false);
  });

  it('fails closed when the parent dir became a SYMLINK before listen [MED/TOCTOU]', () => {
    const { fs } = fakeFs({ uid: 1000, mode: S_IFSOCK | 0o600 }, undefined, { uid: 1000, mode: S_IFLNK | 0o777 });
    expect(secureSocketFile(enforced, fs).enforced).toBe(false);
  });

  it('fails closed when the parent dir owner/mode re-verification fails after listen [MED]', () => {
    // Socket inode is fine (0600) but the dir stat shows a group bit — the parent was relaxed post-establish.
    let call = 0;
    const statFn = () => {
      call += 1;
      return call === 1 ? { uid: 1000, mode: S_IFSOCK | 0o600 } : { uid: 1000, mode: S_IFDIR | 0o770 };
    };
    const { fs } = fakeFs(statFn);
    expect(secureSocketFile(enforced, fs).enforced).toBe(false);
  });

  it('fails closed (never throws) when hardening the socket file errors', () => {
    const { fs } = fakeFs({ uid: 1000, mode: S_IFSOCK | 0o600 }, 'chmod');
    expect(secureSocketFile(enforced, fs).enforced).toBe(false);
  });

  it('passes a not-enforced boundary through unchanged (stays fail-closed)', () => {
    const notEnforced: OwnerBoundary = { enforced: false, detail: 'nope' };
    const { fs, calls } = fakeFs({ uid: 1000, mode: S_IFSOCK | 0o600 });
    expect(secureSocketFile(notEnforced, fs)).toBe(notEnforced);
    expect(calls.chmod.length).toBe(0);
  });
});

describe('ownerBoundedReader', () => {
  it('returns the daemon ownerId for any connection when the boundary is enforced', () => {
    const reader = ownerBoundedReader({ enforced: true, ownerId: '1000', socketPath: SOCK, detail: 'ok' });
    expect(reader({} as never)).toEqual({ ownerId: '1000' });
  });

  it('is fail-closed (returns null) when the boundary is NOT enforced', () => {
    const reader = ownerBoundedReader({ enforced: false, detail: 'nope' });
    expect(reader({} as never)).toBeNull();
  });
});

// Real POSIX integration: a genuine unix socket in a genuine 0700 tmp dir. Skipped on win32 (no getuid,
// no unix-domain owner boundary — win32 is covered by the win32PipeServer integration tests).
describe('establishOwnerBoundary + secureSocketFile (REAL POSIX unix socket)', () => {
  const getuid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  it.skipIf(process.platform === 'win32')('enforces and hardens a real owner-only unix socket', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-broker-it-'));
    const dir = join(root, 'sock');
    mkdirSync(dir, { mode: 0o700 });
    const socketPath = join(dir, 'control.sock');
    try {
      const boundary = establishOwnerBoundary({ socketPath });
      expect(boundary.enforced).toBe(true);
      if (boundary.enforced) expect(boundary.ownerId).toBe(String(getuid!.call(process)));

      const server = createServer(() => {});
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
      });
      try {
        const hardened = secureSocketFile(boundary);
        expect(hardened.enforced).toBe(true);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

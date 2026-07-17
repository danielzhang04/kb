import { describe, it, expect } from 'vitest';
import {
  establishOwnerBoundary,
  secureSocketFile,
  ownerBoundedReader,
} from './peerBoundary.ts';
import type { BoundaryFs, OwnerBoundary } from './peerBoundary.ts';

/** A recording fake fs. `statResult` is what statSync returns; ops are captured for assertions. */
function fakeFs(
  statResult: { uid: number; mode: number } | (() => { uid: number; mode: number }),
  throwOn?: 'mkdir' | 'chmod' | 'stat',
) {
  const calls = { mkdir: [] as unknown[][], chmod: [] as unknown[][], stat: [] as unknown[][] };
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
});

describe('establishOwnerBoundary (unenforceable platforms fail closed)', () => {
  it('fails closed on win32 (named-pipe ACL not settable/verifiable via standard Node API)', () => {
    const { fs } = fakeFs({ uid: 1000, mode: 0o40700 });
    // Even with a getuid present, win32 must not enforce — the pipe DACL cannot be applied/verified.
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

describe('secureSocketFile (post-listen socket-inode hardening)', () => {
  const enforced: OwnerBoundary = { enforced: true, ownerId: '1000', socketPath: SOCK, detail: 'ok' };

  it('chmods the socket inode to 0600 and re-verifies owner + mode, preserving the enforced boundary', () => {
    const { fs, calls } = fakeFs({ uid: 1000, mode: 0o140600 });
    const b = secureSocketFile(enforced, fs);
    expect(b.enforced).toBe(true);
    expect(calls.chmod).toEqual([[SOCK, 0o600]]);
  });

  it('fails closed when the post-listen socket owner/mode verification does not match', () => {
    const { fs } = fakeFs({ uid: 1000, mode: 0o140660 }); // group bit set
    expect(secureSocketFile(enforced, fs).enforced).toBe(false);
  });

  it('fails closed (never throws) when hardening the socket file errors', () => {
    const { fs } = fakeFs({ uid: 1000, mode: 0o140600 }, 'chmod');
    expect(secureSocketFile(enforced, fs).enforced).toBe(false);
  });

  it('passes a not-enforced boundary through unchanged (stays fail-closed)', () => {
    const notEnforced: OwnerBoundary = { enforced: false, detail: 'nope' };
    const { fs, calls } = fakeFs({ uid: 1000, mode: 0o140600 });
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

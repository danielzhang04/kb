import { describe, expect, it } from 'vitest';

import type { WindowsPathPinInspector } from './launcherProfiles.ts';
import { probeWindowsPty, toPublicPtyCapability } from './probe.ts';

const environment = {
  SystemRoot: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\service',
  APPDATA: 'C:\\Users\\service\\AppData\\Roaming',
  ProgramFiles: 'C:\\Program Files',
  TEMP: 'C:\\Temp',
};

function inspector(
  customize: (path: string) => Partial<Awaited<ReturnType<WindowsPathPinInspector['pin']>>> = () => ({}),
): WindowsPathPinInspector {
  return {
    async pin(path) {
      return {
        path,
        fileId: path,
        canonicalPath: path,
        ownerSid: 'S-1-5-18',
        unsafeWriteAce: false,
        async currentFileId() { return path; },
        async close() {},
        ...customize(path),
      };
    },
    async readText() {
      return '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*';
    },
  };
}

describe('Windows PTY probe', () => {
  it('returns the closed available probe and strips the epoch from the public capability', async () => {
    const result = await probeWindowsPty({
      now: () => new Date('2026-08-23T12:00:00.000Z'),
      epochId: `epoch-${'a'.repeat(32)}`,
      loadNodePty: async () => ({ spawn() {} }),
      probeLaunchers: async () => ({ ok: true, launchers: ['shell', 'claude', 'codex'] }),
    });
    expect(result).toEqual({
      available: true,
      host: 'desktop',
      transport: 'local-node-pty',
      launchers: ['shell', 'claude', 'codex'],
      roots: ['repo', 'worktrees'],
      epochId: `epoch-${'a'.repeat(32)}`,
      checkedAt: '2026-08-23T12:00:00.000Z',
    });
    expect(toPublicPtyCapability(result)).toEqual({
      pty: true,
      host: 'desktop',
      launchers: ['shell', 'claude', 'codex'],
      roots: ['repo', 'worktrees'],
      checkedAt: '2026-08-23T12:00:00.000Z',
    });
  });

  it.each([
    ['node-pty-unavailable', async () => null, async () => ({ ok: true as const, launchers: ['shell' as const] })],
    ['shell-unavailable', async () => ({ spawn() {} }), async () => ({ ok: false as const, detail: 'private path' })],
  ])('fails closed as %s with sanitized diagnostics', async (reason, loadNodePty, probeLaunchers) => {
    const result = await probeWindowsPty({
      now: () => new Date('2026-08-23T12:00:00.000Z'),
      epochId: `epoch-${'b'.repeat(32)}`,
      loadNodePty,
      probeLaunchers,
    });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toBe(reason);
    expect(result.detail).toBeNull();
    expect(toPublicPtyCapability(result)).toEqual({
      pty: false,
      diagnostic: { reason, detail: null, checkedAt: '2026-08-23T12:00:00.000Z' },
    });
  });

  it('maps an unsafe ACL beneath an approved root to root-policy-invalid', async () => {
    const result = await probeWindowsPty({
      epochId: `epoch-${'c'.repeat(32)}`,
      environment,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      serviceSid: 'S-1-5-21-service',
      loadNodePty: async () => ({ spawn() {} }),
      accessPath: async (path) => { if (!path.endsWith('cmd.exe')) throw new Error('absent'); },
      pathInspector: inspector((path) => path === 'C:\\repo' ? { unsafeWriteAce: true } : {}),
    });
    expect(result).toMatchObject({ available: false, reason: 'root-policy-invalid', detail: null });
  });

  it('maps a reparse-point approved root to root-policy-invalid', async () => {
    const reparseInspector = inspector();
    reparseInspector.pin = async (path) => {
      if (path === 'C:\\worktrees') throw new Error('reparse point');
      return inspector().pin(path);
    };
    const result = await probeWindowsPty({
      epochId: `epoch-${'d'.repeat(32)}`,
      environment,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      serviceSid: 'S-1-5-21-service',
      loadNodePty: async () => ({ spawn() {} }),
      accessPath: async (path) => { if (!path.endsWith('cmd.exe')) throw new Error('absent'); },
      pathInspector: reparseInspector,
    });
    expect(result).toMatchObject({ available: false, reason: 'root-policy-invalid', detail: null });
  });

  it('maps a bad Codex shim identity to launcher-unavailable', async () => {
    const badShimInspector = inspector();
    badShimInspector.readText = async () => 'node C:\\replacement\\codex.js';
    const result = await probeWindowsPty({
      epochId: `epoch-${'e'.repeat(32)}`,
      environment,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      serviceSid: 'S-1-5-21-service',
      loadNodePty: async () => ({ spawn() {} }),
      accessPath: async (path) => {
        if (path.endsWith('claude.exe')) throw new Error('absent');
      },
      pathInspector: badShimInspector,
    });
    expect(result).toMatchObject({ available: false, reason: 'launcher-unavailable', detail: null });
  });

  it('maps a throwing launcher-policy callback to launcher-unavailable', async () => {
    const result = await probeWindowsPty({
      epochId: `epoch-${'f'.repeat(32)}`,
      loadNodePty: async () => ({ spawn() {} }),
      probeLaunchers: async () => { throw new Error('private path'); },
    });
    expect(result).toMatchObject({ available: false, reason: 'launcher-unavailable', detail: null });
  });
});

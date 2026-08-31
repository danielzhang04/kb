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
      platform: 'win32',
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
      platform: 'win32',
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
      platform: 'win32',
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
      platform: 'win32',
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

  it('drops an optional launcher whose own tree cannot be pinned and advertises the shell it kept', async () => {
    // The real defect this covers: on a machine where `%USERPROFILE%\.local\bin\claude.exe` carries a
    // Modify ACE for another local principal, the whole host used to go dark — an OPTIONAL launcher
    // taking the terminal down with it, while the same launcher merely being ABSENT was tolerated.
    const unsafeClaude = inspector((path) => path.startsWith('C:\\Users\\service\\.local')
      ? { unsafeWriteAce: true }
      : {});
    const result = await probeWindowsPty({
      platform: 'win32',
      epochId: `epoch-${'1'.repeat(32)}`,
      environment,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      serviceSid: 'S-1-5-21-service',
      loadNodePty: async () => ({ spawn() {} }),
      // cmd.exe and claude.exe are both present; only claude's tree fails the pin.
      accessPath: async (path) => { if (path.endsWith('codex.cmd') || path.endsWith('codex.js')) throw new Error('absent'); },
      pathInspector: unsafeClaude,
    });
    expect(result).toMatchObject({ available: true, launchers: ['shell'], roots: ['repo', 'worktrees'] });
    // The drop is RECORDED, not silent: dropping the launcher instead of the host must not turn a
    // tampered Claude tree into "shell only" with no reason anywhere.
    expect(result.available && result.droppedLaunchers)
      .toEqual([{ launcher: 'claude', refusal: 'launcher-unavailable' }]);
    expect(toPublicPtyCapability(result)).toMatchObject({
      pty: true,
      launchers: ['shell'],
      droppedLaunchers: [{ launcher: 'claude', refusal: 'launcher-unavailable' }],
    });
  });

  it('still refuses the whole probe for an unsafe root even when only an optional launcher touches it', async () => {
    // The drop above must never become a way for an unsafe ROOT to be tolerated: `unsafe-root` is a
    // statement about the approved root, true for every launcher, so it fails the host closed.
    const unsafeRoot = inspector((path) => path === 'C:\\worktrees' ? { unsafeWriteAce: true } : {});
    const result = await probeWindowsPty({
      platform: 'win32',
      epochId: `epoch-${'2'.repeat(32)}`,
      environment,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      serviceSid: 'S-1-5-21-service',
      loadNodePty: async () => ({ spawn() {} }),
      accessPath: async () => {},
      pathInspector: unsafeRoot,
    });
    expect(result).toMatchObject({ available: false, reason: 'root-policy-invalid', detail: null });
    // A fatal root refusal is NOT a drop: nothing is advertised, so there is no dropped-launcher
    // record to publish and the closed diagnostic stays exactly three fields.
    expect(Object.keys(toPublicPtyCapability(result))).toEqual(['pty', 'diagnostic']);
  });

  it('refuses when the shell itself cannot be pinned rather than advertising an empty launcher set', async () => {
    const unsafeShell = inspector((path) => path.endsWith('cmd.exe') ? { unsafeWriteAce: true } : {});
    const result = await probeWindowsPty({
      platform: 'win32',
      epochId: `epoch-${'3'.repeat(32)}`,
      environment,
      roots: { repo: 'C:\\repo', worktrees: 'C:\\worktrees' },
      serviceSid: 'S-1-5-21-service',
      loadNodePty: async () => ({ spawn() {} }),
      accessPath: async (path) => { if (!path.endsWith('cmd.exe')) throw new Error('absent'); },
      pathInspector: unsafeShell,
    });
    expect(result).toMatchObject({ available: false, reason: 'launcher-unavailable', detail: null });
    // The shell is never dropped — it fails the host closed — so no drop record exists to leak.
    expect(Object.keys(toPublicPtyCapability(result))).toEqual(['pty', 'diagnostic']);
  });

  it('drops Codex from the advertised set when its shim no longer targets the pinned entry', async () => {
    // A tampered shim is a statement about codex, not about the host: codex is never advertised (and
    // launch re-pins it anyway), while the shell — untouched by that tampering — still stands.
    const badShimInspector = inspector();
    badShimInspector.readText = async () => 'node C:\\replacement\\codex.js';
    const result = await probeWindowsPty({
      platform: 'win32',
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
    expect(result).toMatchObject({ available: true, launchers: ['shell'] });
    // Both halves: codex was dropped, AND the reason it was dropped travels with the probe. A shim
    // rewritten to point at another JS entry is an ALARM, and an alarm nobody can read is not one.
    expect(result.available && result.droppedLaunchers)
      .toEqual([{ launcher: 'codex', refusal: 'launcher-unavailable' }]);
    const published = toPublicPtyCapability(result);
    expect(published).toMatchObject({
      pty: true, droppedLaunchers: [{ launcher: 'codex', refusal: 'launcher-unavailable' }],
    });
    // Closed copy only: no path, no ACL, no SID crosses the publish boundary with the alarm.
    expect(JSON.stringify(published)).not.toMatch(/C:\\|replacement|codex\.js/);
  });

  it('refuses on a non-win32 platform before loading node-pty', async () => {
    let loads = 0;
    const result = await probeWindowsPty({
      platform: 'linux',
      now: () => new Date('2026-08-23T12:00:00.000Z'),
      epochId: `epoch-${'0'.repeat(32)}`,
      loadNodePty: async () => { loads += 1; return { spawn() {} }; },
      probeLaunchers: async () => ({ ok: true, launchers: ['shell'] }),
    });
    expect(result).toEqual({
      available: false,
      host: 'desktop',
      transport: 'local-node-pty',
      reason: 'node-pty-unavailable',
      detail: null,
      checkedAt: '2026-08-23T12:00:00.000Z',
    });
    expect(toPublicPtyCapability(result)).toEqual({
      pty: false,
      diagnostic: { reason: 'node-pty-unavailable', detail: null, checkedAt: '2026-08-23T12:00:00.000Z' },
    });
    expect(loads).toBe(0);
  });

  it('maps a throwing launcher-policy callback to launcher-unavailable', async () => {
    const result = await probeWindowsPty({
      platform: 'win32',
      epochId: `epoch-${'f'.repeat(32)}`,
      loadNodePty: async () => ({ spawn() {} }),
      probeLaunchers: async () => { throw new Error('private path'); },
    });
    expect(result).toMatchObject({ available: false, reason: 'launcher-unavailable', detail: null });
  });
});

describe('toPublicPtyCapability — publish-boundary detail sanitization', () => {
  const CHECKED_AT = '2026-08-22T09:00:00.000Z';
  const closed = (detail: string | null) => toPublicPtyCapability({
    available: false, host: 'desktop', transport: 'local-node-pty',
    reason: 'launcher-unavailable', detail, checkedAt: CHECKED_AT,
  });
  const bytes = (value: string) => new TextEncoder().encode(value).length;

  it('publishes a multi-line 200-byte detail as one line of at most 160 whole-codepoint UTF-8 bytes', () => {
    const raw = `${'a'.repeat(50)}\r\nC:\Users\service\node_modules\node-pty\n${'é'.repeat(100)}`;
    expect(bytes(raw)).toBeGreaterThan(200);
    const published = closed(raw);
    expect(published.pty).toBe(false);
    const detail = published.pty === false ? published.diagnostic.detail : null;
    expect(typeof detail).toBe('string');
    expect(detail).not.toMatch(/[\r\n]/);
    expect(bytes(detail ?? '')).toBeLessThanOrEqual(160);
    // Truncation stopped on a code point: no replacement character, no split two-byte sequence.
    expect(detail).not.toContain('�');
    expect(detail?.startsWith('a'.repeat(50))).toBe(true);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(detail ?? ''))).toBe(detail);
  });

  it('publishes null for a detail that is absent or only whitespace once flattened', () => {
    const nulled = closed(null);
    expect(nulled.pty === false && nulled.diagnostic.detail).toBe(null);
    const blank = closed('\r\n   \n');
    expect(blank.pty === false && blank.diagnostic.detail).toBe(null);
  });

  it('passes a short single-line detail through unchanged and never touches the available payload', () => {
    const short = closed('broker probe refused');
    expect(short.pty === false && short.diagnostic.detail).toBe('broker probe refused');
    const available = toPublicPtyCapability({
      available: true, host: 'desktop', transport: 'local-node-pty',
      launchers: ['shell'], roots: ['repo'], epochId: 'epoch-1', checkedAt: CHECKED_AT,
    });
    expect(available).toEqual({
      pty: true, host: 'desktop', launchers: ['shell'], roots: ['repo'], checkedAt: CHECKED_AT,
    });
  });
});

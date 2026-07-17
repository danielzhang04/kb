import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootBroker, resolveControlPaths, writeTokenFile } from './daemon.ts';
import type { BootDeps } from './daemon.ts';
import type { ControlTransport } from './controlTransport.ts';
import type { PreambleRunner } from './preambleGate.ts';
import { SessionOwner } from './index.ts';
import type { StopWatcher } from './stopWatch.ts';

const okPreamble: PreambleRunner = () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' });
const failPreamble: PreambleRunner = () => ({ exitCode: 1, stdout: 'PREAMBLE FAIL: STOP present', stderr: '' });

function baseDeps(over: Partial<BootDeps> = {}): { deps: BootDeps; calls: Record<string, unknown> } {
  const calls: Record<string, unknown> = { listened: false, closed: false, tokenWritten: null, watchStarted: false };
  const transport: ControlTransport = {
    listen: async () => {
      calls.listened = true;
    },
    close: async () => {
      calls.closed = true;
    },
  };
  const watcher: StopWatcher = { close: () => {} };
  const deps: BootDeps = {
    repoRoot: 'C:/repo',
    platform: 'win32',
    env: { USERNAME: 'daniel', LOCALAPPDATA: 'C:/Users/daniel/AppData/Local' },
    runPreamble: okPreamble,
    makeOwner: () => new SessionOwner({ repoRoot: 'C:/repo' }),
    mintToken: () => 'a'.repeat(64),
    resolveOwnerId: () => 'S-1-5-21-DAEMON',
    createTransport: () => transport,
    writeToken: (tokenPath, token) => {
      calls.tokenWritten = { tokenPath, token };
    },
    startStopWatch: () => {
      calls.watchStarted = true;
      return watcher;
    },
    ...over,
  };
  return { deps, calls };
}

describe('bootBroker', () => {
  it('refuses to boot when the preamble gate fails — opens NO socket, writes NO token', async () => {
    const { deps, calls } = baseDeps({ runPreamble: failPreamble });
    const result = await bootBroker(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('fleet-frozen');
    expect(calls.listened).toBe(false);
    expect(calls.tokenWritten).toBeNull();
    expect(calls.watchStarted).toBe(false);
  });

  it('boots: listens, issues the token file, arms the STOP watcher', async () => {
    const { deps, calls } = baseDeps();
    const result = await bootBroker(deps);
    expect(result.ok).toBe(true);
    expect(calls.listened).toBe(true);
    expect(calls.watchStarted).toBe(true);
    expect(calls.tokenWritten).toEqual({
      tokenPath: join('C:/Users/daniel/AppData/Local', 'kb-broker', 'control.token'),
      token: 'a'.repeat(64),
    });
  });

  it('fails closed (token NOT written) when the transport bind fails', async () => {
    const { deps, calls } = baseDeps({
      createTransport: () => ({
        listen: async () => {
          throw new Error('pipe squatted; fail-closed');
        },
        close: async () => {},
      }),
    });
    await expect(bootBroker(deps)).rejects.toThrow(/fail-closed/);
    expect(calls.tokenWritten).toBeNull();
    expect(calls.watchStarted).toBe(false);
  });

  it('passes the resolved daemon owner id + boot token into the transport auth context', async () => {
    let seenAuth: { expectedOwnerId: string; bootToken: string } | null = null;
    const { deps } = baseDeps({
      createTransport: (d) => {
        seenAuth = d.auth;
        return { listen: async () => {}, close: async () => {} };
      },
    });
    await bootBroker(deps);
    expect(seenAuth).toEqual({ expectedOwnerId: 'S-1-5-21-DAEMON', bootToken: 'a'.repeat(64) });
  });
});

describe('resolveControlPaths', () => {
  it('win32: per-user pipe name + token under LOCALAPPDATA', () => {
    const p = resolveControlPaths('win32', { USERNAME: 'daniel', LOCALAPPDATA: 'C:/Users/daniel/AppData/Local' });
    expect(p.socketPath).toBe('\\\\.\\pipe\\kb-broker-daniel');
    expect(p.tokenPath).toBe(join('C:/Users/daniel/AppData/Local', 'kb-broker', 'control.token'));
  });

  it('posix: socket + token under XDG_RUNTIME_DIR', () => {
    const p = resolveControlPaths('linux', { XDG_RUNTIME_DIR: '/run/user/1000' });
    expect(p.socketPath).toBe(join('/run/user/1000', 'kb-broker', 'control.sock'));
    expect(p.tokenPath).toBe(join('/run/user/1000', 'kb-broker', 'control.token'));
  });
});

describe('writeTokenFile', () => {
  it('writes the token to an owner-only file (0600 on POSIX)', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-token-'));
    const tokenPath = join(root, 'sub', 'control.token');
    try {
      writeTokenFile(tokenPath, 'sekret-token', process.platform);
      expect(readFileSync(tokenPath, 'utf-8')).toBe('sekret-token');
      if (process.platform !== 'win32') {
        expect(statSync(tokenPath).mode & 0o077).toBe(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

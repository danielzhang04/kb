/**
 * D3.1i — schtasks collateral rehearsal. Mirrors the desktop-poll rehearsal ("a dry run under a STOP file
 * must no-op cleanly"): registering the task is a HUMAN gate, but the agent-built launcher + host are
 * rehearsed here. Two proofs:
 *   1. the committed launcher sets the repo-root cwd and runs hostMain.ts (schtasks can't set "Start in");
 *   2. a dry-run boot under a STOP-frozen fleet NO-OPS — the host refuses to listen and touches no native
 *      surface (no pipe, no token file), exactly the fail-closed posture the scheduled task relies on.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootPtyHost } from './hostMain.ts';
import type { PtyHostNativeApi } from './hostMain.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';

const launcherPath = fileURLToPath(new URL('../../../scripts/pty_host_launch.cmd', import.meta.url));

describe('D3.1i — launcher wrapper', () => {
  const cmd = readFileSync(launcherPath, 'utf-8');

  it('cds to the repo root (schtasks cannot set "Start in")', () => {
    expect(cmd).toMatch(/cd \/d C:\\Users\\danie\\kb/);
  });

  it('launches hostMain.ts with the pinned node.exe', () => {
    expect(cmd).toMatch(/node\.exe" dashboard\\server\\pty\\hostMain\.ts/);
  });
});

describe('D3.1i — dry-run under STOP no-ops (rehearsal)', () => {
  it('refuses to listen and touches NO native surface when the fleet is STOP-frozen', async () => {
    const frozen: PreambleRunner = () => ({ exitCode: 2, stdout: 'PREAMBLE FAIL: STOP file present — fleet is frozen\n', stderr: '' });

    // A native API that would THROW if the boot ever reached it — proving the STOP gate short-circuits first.
    const nativeApi: PtyHostNativeApi = {
      currentSidString: vi.fn(() => {
        throw new Error('native surface must NOT be touched under STOP');
      }),
      makeHostTransport: vi.fn(() => {
        throw new Error('native surface must NOT be touched under STOP');
      }),
      writeAndVerify: vi.fn(() => {
        throw new Error('native surface must NOT be touched under STOP');
      }),
    };

    const res = await bootPtyHost({
      repoRoot: 'C:\\Users\\danie\\kb',
      env: {},
      runPreamble: frozen,
      nativeApi,
      peerFs: { readFile: () => 'S-1-5-21-1-2-3-4', dirExists: () => true },
      startStopWatch: () => ({ close: () => {} }),
    });

    expect(res).toMatchObject({ ok: false, reason: 'fleet-frozen' });
    expect(nativeApi.currentSidString).not.toHaveBeenCalled();
    expect(nativeApi.makeHostTransport).not.toHaveBeenCalled();
    expect(nativeApi.writeAndVerify).not.toHaveBeenCalled();
  });
});

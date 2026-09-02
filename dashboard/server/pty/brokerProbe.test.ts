import { describe, expect, it } from 'vitest';

import { probeLinuxBroker } from './brokerProbe.ts';
import type { PtyCapabilityProbe } from './contracts.ts';

const available = {
  available: true as const, host: 'vm' as const, transport: 'unix-broker' as const,
  launchers: ['shell', 'claude', 'codex'] as const, roots: ['repo', 'worktrees'] as const,
  epochId: 'epoch-0123456789abcdef0123456789abcdef', checkedAt: '2026-08-22T00:00:00.000Z',
};

describe('probeLinuxBroker', () => {
  it('accepts only the canonical Unix socket and exact broker peer uid', async () => {
    const probe = await probeLinuxBroker({
      socketPath: '/run/kb-shell/broker.sock', expectedBrokerUid: 1002, expectedBrokerGid: 1002,
      expectedSocketUid: 1001, expectedSocketGid: 1001,
      inspectSocket: async () => ({ kind: 'socket', uid: 1001, gid: 1001, mode: 0o600, realpath: '/run/kb-shell/broker.sock' }),
      connect: async () => ({ peer: { uid: 1002, gid: 1002, pid: 42 }, probe: async () => available, close: () => {} }),
      now: () => '2026-08-22T00:00:00.000Z',
    });
    expect(probe).toEqual(available);
  });

  it('returns bounded path-free diagnostics for socket and peer mismatches', async () => {
    const mismatch = await probeLinuxBroker({
      socketPath: '/run/kb-shell/broker.sock', expectedBrokerUid: 1002, expectedBrokerGid: 1002,
      expectedSocketUid: 1001, expectedSocketGid: 1001,
      inspectSocket: async () => ({ kind: 'socket', uid: 1001, gid: 1001, mode: 0o600, realpath: '/tmp/evil.sock' }),
      connect: async () => { throw new Error('must not connect'); },
      now: () => '2026-08-22T00:00:00.000Z',
    });
    expect(mismatch).toEqual({ available: false, host: 'vm', transport: 'unix-broker',
      reason: 'broker-identity-mismatch', detail: 'broker socket identity mismatch', checkedAt: '2026-08-22T00:00:00.000Z' });

    const peerMismatch = await probeLinuxBroker({
      socketPath: '/run/kb-shell/broker.sock', expectedBrokerUid: 1002, expectedBrokerGid: 1002,
      expectedSocketUid: 1001, expectedSocketGid: 1001,
      inspectSocket: async () => ({ kind: 'socket', uid: 1001, gid: 1001, mode: 0o600, realpath: '/run/kb-shell/broker.sock' }),
      connect: async () => ({ peer: { uid: 0, gid: 0, pid: 1 }, probe: async () => available, close: () => {} }),
      now: () => '2026-08-22T00:00:00.000Z',
    });
    expect(peerMismatch.available).toBe(false);
    if (!peerMismatch.available) expect(peerMismatch.reason).toBe('broker-identity-mismatch');
  });

  it('reads the launcher set as CAPABILITY, so a partial CLI install still gets a terminal', async () => {
    const withLaunchers = async (launchers: readonly string[]): Promise<PtyCapabilityProbe> =>
      probeLinuxBroker({
        socketPath: '/run/kb-shell/broker.sock', expectedBrokerUid: 1002, expectedBrokerGid: 1002,
        expectedSocketUid: 1001, expectedSocketGid: 1001,
        inspectSocket: async () => ({ kind: 'socket', uid: 1001, gid: 1001, mode: 0o600, realpath: '/run/kb-shell/broker.sock' }),
        connect: async () => ({ peer: { uid: 1002, gid: 1002, pid: 42 },
          probe: async () => ({ ...available, launchers: launchers as never }), close: () => {} }),
        now: () => '2026-08-22T00:00:00.000Z',
      });

    // The case that used to be a total blackout: a VM with no `codex` had NO terminal, not even a
    // shell, because the probe demanded the exact set `shell,claude,codex` and called anything else a
    // broker IDENTITY mismatch. `pinBrokerLaunch` is still the enforcement at launch; refusing the
    // whole host here bought nothing and cost the operator their shell.
    expect(await withLaunchers(['shell', 'claude']))
      .toEqual({ ...available, launchers: ['shell', 'claude'] });
    expect(await withLaunchers(['shell'])).toEqual({ ...available, launchers: ['shell'] });
    expect(await withLaunchers(['shell', 'codex']))
      .toEqual({ ...available, launchers: ['shell', 'codex'] });

    // `shell` is the one floor: a broker that cannot open a shell cannot open a terminal. That is a
    // capability refusal (`shell-unavailable`), the same one Windows raises, NOT an identity mismatch.
    for (const shellless of [[], ['claude', 'codex'], ['codex']]) {
      const refused = await withLaunchers(shellless);
      expect(refused.available, JSON.stringify(shellless)).toBe(false);
      if (!refused.available) expect(refused.reason).toBe('shell-unavailable');
    }

    // Junk from an untrusted `connect` port is dropped, not published, and cannot smuggle in a launcher.
    expect(await withLaunchers(['shell', 'bash', 'claude', 'claude']))
      .toEqual({ ...available, launchers: ['shell', 'claude'] });
  });

  it('still collapses the whole capability for anything that is genuinely an IDENTITY failure', async () => {
    const withResult = async (overrides: Record<string, unknown>): Promise<PtyCapabilityProbe> =>
      probeLinuxBroker({
        socketPath: '/run/kb-shell/broker.sock', expectedBrokerUid: 1002, expectedBrokerGid: 1002,
        expectedSocketUid: 1001, expectedSocketGid: 1001,
        inspectSocket: async () => ({ kind: 'socket', uid: 1001, gid: 1001, mode: 0o600, realpath: '/run/kb-shell/broker.sock' }),
        connect: async () => ({ peer: { uid: 1002, gid: 1002, pid: 42 },
          probe: async () => ({ ...available, ...overrides } as never), close: () => {} }),
        now: () => '2026-08-22T00:00:00.000Z',
      });
    // Host, transport, epoch form and the compiled-in root pair are all fixed properties of a correctly
    // deployed broker. Splitting capability out of the identity check did not soften any of them.
    for (const identityFault of [{ host: 'desktop' }, { transport: 'local-node-pty' },
      { epochId: 'epoch-nope' }, { roots: ['repo'] }, { roots: ['worktrees', 'repo'] }]) {
      const refused = await withResult(identityFault);
      expect(refused.available, JSON.stringify(identityFault)).toBe(false);
      if (!refused.available) expect(refused.reason).toBe('broker-identity-mismatch');
    }
  });
});

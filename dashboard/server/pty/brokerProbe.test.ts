import { describe, expect, it } from 'vitest';

import { probeLinuxBroker } from './brokerProbe.ts';

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
});

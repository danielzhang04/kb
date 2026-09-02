import { describe, expect, it, vi } from 'vitest';
import type { PtyCapabilityProbe } from '../pty/contracts.ts';
import type { WindowsPtyProbeOptions } from '../pty/probe.ts';
import {
  composeRuntimeCapabilities,
  NEVER_CHECKED_AT,
  probePublicPtyCapability,
  runtimeCapabilities,
  runtimeExecutionHost,
  runtimeHostCapabilities,
  unavailablePtyCapability,
} from './capabilities.ts';

const CHECKED_AT = '2026-08-22T09:00:00.000Z';
const now = (): Date => new Date(CHECKED_AT);

const CLOSED_ADVERTISEMENT_SLICE = {
  connectors: [], skills: [], filesystemRoots: [], gpu: false,
  clis: { claude: 'missing', codex: 'missing' },
};

describe('runtimeHostCapabilities', () => {
  it('answers the non-PTY host slice without a PTY key of any kind', () => {
    expect(runtimeHostCapabilities('linux')).toEqual({
      platform: 'linux',
      python: { command: 'python3', prefixArgs: [] },
      runnerTrigger: false,
      vibe: false,
      durablePrWrites: false,
      localTranscripts: false,
      dashboardBridge: true,
      ...CLOSED_ADVERTISEMENT_SLICE,
    });
    expect(runtimeHostCapabilities('win32')).toEqual({
      platform: 'win32',
      python: { command: 'py', prefixArgs: ['-3'] },
      runnerTrigger: true,
      vibe: true,
      durablePrWrites: false,
      localTranscripts: false,
      dashboardBridge: true,
      ...CLOSED_ADVERTISEMENT_SLICE,
    });
  });

  it('defaults the five advertisement-bound capabilities CLOSED — a probe that has not run [P6-C15]', () => {
    const capabilities = runtimeHostCapabilities('linux');
    expect(capabilities.connectors).toEqual([]);
    expect(capabilities.skills).toEqual([]);
    expect(capabilities.filesystemRoots).toEqual([]);
    expect(capabilities.gpu).toBe(false);
    expect(capabilities.clis).toEqual({ claude: 'missing', codex: 'missing' });
  });
});

describe('runtimeCapabilities', () => {
  it('is fail-closed when composition supplied no probe result, on either platform', () => {
    const linux = runtimeCapabilities('linux');
    expect(linux.pty).toBe(false);
    expect(linux.pty === false && linux.diagnostic.reason).toBe('broker-unavailable');
    expect(linux.pty === false && linux.diagnostic.detail).toBe(null);
    const windows = runtimeCapabilities('win32');
    expect(windows.pty).toBe(false);
    expect(windows.pty === false && windows.diagnostic.reason).toBe('node-pty-unavailable');
    expect(windows).toMatchObject({ platform: 'win32', runnerTrigger: true, vibe: true });
    // A composition that never probed stamps the never-checked sentinel, not a fabricated check time.
    expect(linux.pty === false && linux.diagnostic.checkedAt).toBe(NEVER_CHECKED_AT);
    expect(windows.pty === false && windows.diagnostic.checkedAt).toBe('');
    expect(unavailablePtyCapability('win32', CHECKED_AT)).toEqual({
      pty: false, diagnostic: { reason: 'node-pty-unavailable', detail: null, checkedAt: CHECKED_AT },
    });
  });

  it('answers one host for the whole composition — the advertised host, else the single platform mapper', () => {
    expect(runtimeExecutionHost(runtimeCapabilities('win32', {
      pty: true, host: 'desktop', launchers: ['shell'], roots: ['repo'], checkedAt: CHECKED_AT,
    }))).toBe('desktop');
    expect(runtimeExecutionHost(runtimeCapabilities('linux', {
      pty: true, host: 'vm', launchers: ['shell'], roots: ['repo'], checkedAt: CHECKED_AT,
    }))).toBe('vm');
    expect(runtimeExecutionHost(runtimeCapabilities('win32'))).toBe('desktop');
    expect(runtimeExecutionHost(runtimeCapabilities('linux'))).toBe('vm');
    expect(runtimeExecutionHost(runtimeCapabilities('darwin'))).toBe('vm');
  });

  it('carries the probed closed capability beside the unchanged non-PTY capabilities', () => {
    expect(runtimeCapabilities('win32', {
      pty: true, host: 'desktop', launchers: ['shell', 'claude'], roots: ['repo', 'worktrees'],
      checkedAt: CHECKED_AT,
    })).toEqual({
      platform: 'win32',
      python: { command: 'py', prefixArgs: ['-3'] },
      runnerTrigger: true,
      vibe: true,
      durablePrWrites: false,
      localTranscripts: false,
      dashboardBridge: true,
      ...CLOSED_ADVERTISEMENT_SLICE,
      pty: true,
      host: 'desktop',
      launchers: ['shell', 'claude'],
      roots: ['repo', 'worktrees'],
      checkedAt: CHECKED_AT,
    });
    expect(runtimeCapabilities('linux', {
      pty: false, diagnostic: { reason: 'root-policy-invalid', detail: 'roots are not usable', checkedAt: CHECKED_AT },
    })).toMatchObject({
      platform: 'linux',
      pty: false,
      diagnostic: { reason: 'root-policy-invalid', detail: 'roots are not usable', checkedAt: CHECKED_AT },
    });
  });

  it('derives deployment capabilities from the real composed surfaces, never KB_VM_RUNTIME', () => {
    const openPr = async () => undefined;
    expect(composeRuntimeCapabilities(runtimeCapabilities('linux'), {
      coordinationPublication: 'outbox', openPr, transcriptRoot: null,
    })).toMatchObject({ durablePrWrites: false, localTranscripts: false });
    expect(composeRuntimeCapabilities(runtimeCapabilities('linux'), {
      coordinationPublication: 'direct', openPr, transcriptRoot: '/readable/traces',
    })).toMatchObject({ durablePrWrites: true, localTranscripts: true });
    expect(composeRuntimeCapabilities(runtimeCapabilities('win32'), {
      coordinationPublication: 'direct', transcriptRoot: null,
    }).durablePrWrites).toBe(false);
  });

  it('preserves the probed PTY slice across deployment composition', () => {
    const composed = composeRuntimeCapabilities(runtimeCapabilities('win32', {
      pty: true, host: 'desktop', launchers: ['shell'], roots: ['repo'], checkedAt: CHECKED_AT,
    }), { coordinationPublication: 'direct', transcriptRoot: '/readable/traces' });
    expect(composed).toMatchObject({
      pty: true, host: 'desktop', launchers: ['shell'], roots: ['repo'], checkedAt: CHECKED_AT,
      localTranscripts: true,
    });
  });
});

describe('probePublicPtyCapability', () => {
  it('runs the real Windows host probe exactly once and publishes only the public slice', async () => {
    const probe = vi.fn(async (_options: WindowsPtyProbeOptions): Promise<PtyCapabilityProbe> => ({
      available: true, host: 'desktop', transport: 'local-node-pty',
      launchers: ['shell', 'claude', 'codex'], roots: ['repo', 'worktrees'],
      epochId: 'epoch-1', checkedAt: CHECKED_AT,
    }));
    const linux = vi.fn(async (): Promise<PtyCapabilityProbe> => { throw new Error('must not probe'); });
    const capability = await probePublicPtyCapability({
      platform: 'win32', epochId: 'epoch-1', now, probeWindowsHost: probe, probeLinuxHost: linux,
    });
    expect(probe).toHaveBeenCalledOnce();
    // The Windows arm is untouched by the Linux wiring: the broker is never reached from a desktop.
    expect(linux).not.toHaveBeenCalled();
    expect(probe.mock.lastCall?.[0]).toMatchObject({ epochId: 'epoch-1' });
    expect(capability).toEqual({
      pty: true, host: 'desktop', launchers: ['shell', 'claude', 'codex'],
      roots: ['repo', 'worktrees'], checkedAt: CHECKED_AT,
    });
    expect(Object.keys(capability)).not.toContain('epochId');
    expect(Object.keys(capability)).not.toContain('transport');
  });

  it('publishes the closed refusal when the Windows host probe fails', async () => {
    const capability = await probePublicPtyCapability({
      platform: 'win32', epochId: 'epoch-1', now,
      probeWindowsHost: async () => ({
        available: false, host: 'desktop', transport: 'local-node-pty',
        reason: 'node-pty-unavailable', detail: null, checkedAt: CHECKED_AT,
      }),
    });
    expect(capability).toEqual({
      pty: false, diagnostic: { reason: 'node-pty-unavailable', detail: null, checkedAt: CHECKED_AT },
    });
  });

  it('refuses closed when the Windows host probe throws instead of letting composition reject', async () => {
    const capability = await probePublicPtyCapability({
      platform: 'win32', epochId: 'epoch-1', now,
      probeWindowsHost: async () => { throw new Error('node-pty load exploded'); },
    });
    expect(capability).toEqual({
      pty: false, diagnostic: { reason: 'node-pty-unavailable', detail: null, checkedAt: CHECKED_AT },
    });
  });

  it('never calls the Windows host probe off Windows, and RUNS the Linux broker probe instead', async () => {
    // This test used to assert the opposite: that Linux unconditionally published
    // `broker-unavailable` without asking anything. That was the stub, and it encoded the bug — the
    // daemon told its operator it had no terminal and no CLIs on a VM where both were installed, so
    // `placement/requirements.ts` refused every agent launch with `409 no-complete-placement`.
    const windows = vi.fn(async (): Promise<PtyCapabilityProbe> => { throw new Error('must not probe'); });
    const linux = vi.fn(async (options: { now: () => string }): Promise<PtyCapabilityProbe> => ({
      available: true, host: 'vm', transport: 'unix-broker',
      launchers: ['shell', 'claude'], roots: ['repo', 'worktrees'],
      epochId: 'epoch-0123456789abcdef0123456789abcdef', checkedAt: options.now(),
    }));
    expect(await probePublicPtyCapability({
      platform: 'linux', epochId: 'epoch-1', now, probeWindowsHost: windows, probeLinuxHost: linux,
    })).toEqual({
      pty: true, host: 'vm', launchers: ['shell', 'claude'], roots: ['repo', 'worktrees'],
      checkedAt: CHECKED_AT,
    });
    expect(linux).toHaveBeenCalledOnce();
    expect(windows).not.toHaveBeenCalled();
    // The composition's own attempt time is what gets stamped — the probe is not free to invent one.
    expect(linux.mock.lastCall?.[0].now()).toBe(CHECKED_AT);
  });

  it('publishes the Linux refusal it was given, and degrades a throwing broker probe to no terminal', async () => {
    expect(await probePublicPtyCapability({
      platform: 'linux', epochId: 'epoch-1', now,
      probeLinuxHost: async () => ({
        available: false, host: 'vm', transport: 'unix-broker',
        reason: 'shell-unavailable', detail: 'broker enumerated no shell', checkedAt: CHECKED_AT,
      }),
    })).toEqual({
      pty: false, diagnostic: { reason: 'shell-unavailable', detail: 'broker enumerated no shell', checkedAt: CHECKED_AT },
    });

    // Boot must survive a broker probe that explodes: no terminal, not a dead daemon.
    expect(await probePublicPtyCapability({
      platform: 'linux', epochId: 'epoch-1', now,
      probeLinuxHost: async () => { throw new Error('koffi failed to load libc'); },
    })).toEqual({
      pty: false, diagnostic: { reason: 'broker-unavailable', detail: null, checkedAt: CHECKED_AT },
    });
  });
});

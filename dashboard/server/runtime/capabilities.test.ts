import { describe, expect, it } from 'vitest';
import { composeRuntimeCapabilities, runtimeCapabilities } from './capabilities.ts';

describe('runtimeCapabilities', () => {
  it('disables PTY and Task Scheduler on Linux while retaining the bridge', () => {
    expect(runtimeCapabilities('linux')).toEqual({
      platform: 'linux',
      python: { command: 'python3', prefixArgs: [] },
      pty: false,
      runnerTrigger: false,
      vibe: false,
      durablePrWrites: false,
      localTranscripts: false,
      dashboardBridge: true,
    });
  });

  it('retains every Windows-only surface on Windows', () => {
    expect(runtimeCapabilities('win32')).toEqual({
      platform: 'win32',
      python: { command: 'py', prefixArgs: ['-3'] },
      pty: true,
      runnerTrigger: true,
      vibe: true,
      durablePrWrites: false,
      localTranscripts: false,
      dashboardBridge: true,
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
});

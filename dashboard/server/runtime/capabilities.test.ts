import { describe, expect, it } from 'vitest';
import { runtimeCapabilities } from './capabilities.ts';

describe('runtimeCapabilities', () => {
  it('disables PTY and Task Scheduler on Linux while retaining the bridge', () => {
    expect(runtimeCapabilities('linux')).toEqual({
      platform: 'linux',
      python: { command: 'python3', prefixArgs: [] },
      pty: false,
      runnerTrigger: false,
      vibe: false,
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
      dashboardBridge: true,
    });
  });
});

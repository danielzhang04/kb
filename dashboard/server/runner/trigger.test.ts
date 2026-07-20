import { describe, expect, it, vi } from 'vitest';
import { taskForOwner, triggerRunner } from './trigger.ts';

describe('runner trigger', () => {
  it('maps only the registered codex worker to a closed scheduled-task name', () => {
    expect(taskForOwner('codex-worker', {})).toBe('kb-codex-runner');
    expect(taskForOwner('codex-worker', { DASHBOARD_CODEX_RUNNER_TASK: 'kb-custom' })).toBe('kb-custom');
    expect(taskForOwner('worker-desktop', {})).toBeNull();
    expect(taskForOwner('../../task', {})).toBeNull();
  });

  it('invokes schtasks with fixed argv and reports the trigger', () => {
    const run = vi.fn();
    expect(triggerRunner('codex-worker', { platform: 'win32', env: {}, run })).toEqual({
      status: 'triggered',
      owner: 'codex-worker',
      task: 'kb-codex-runner',
    });
    expect(run).toHaveBeenCalledWith('schtasks.exe', ['/Run', '/TN', 'kb-codex-runner']);
  });

  it('does not invoke an arbitrary task for an unbound owner', () => {
    const run = vi.fn();
    expect(triggerRunner('worker-desktop', { platform: 'win32', env: {}, run })).toMatchObject({
      status: 'unbound',
      owner: 'worker-desktop',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('reports scheduler failure without pretending execution started', () => {
    const run = vi.fn(() => {
      throw new Error('scheduler denied');
    });
    expect(triggerRunner('codex-worker', { platform: 'win32', env: {}, run })).toMatchObject({
      status: 'failed',
      detail: 'scheduler denied',
    });
  });
});

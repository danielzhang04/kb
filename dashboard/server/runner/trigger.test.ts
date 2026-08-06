import { describe, expect, it, vi } from 'vitest';
import { runnerForOwner, triggerRunner } from './trigger.ts';

describe('runner trigger', () => {
  it('maps only the registered codex worker to a closed POSIX runner', () => {
    expect(runnerForOwner('codex-worker', '/repo')).toMatchObject({ id: 'kb-codex-runner', script: '/repo/scripts/agent_runner.sh' });
    expect(runnerForOwner('worker-desktop')).toBeNull();
    expect(runnerForOwner('../../runner')).toBeNull();
  });

  it('starts the runner detached, records pid/start-time, and unrefs it', () => {
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ pid: 412, unref }));
    const writeState = vi.fn();
    expect(triggerRunner('codex-worker', {
      cwd: '/repo/dashboard', env: { DASHBOARD_REPO_ROOT: '/repo' }, spawn, processStartTime: () => 987, writeState,
    })).toEqual({ status: 'triggered', owner: 'codex-worker', task: 'kb-codex-runner' });
    const call = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: NodeJS.ProcessEnv; detached: boolean; stdio: string }];
    expect(call.slice(0, 2)).toEqual(['/bin/sh', ['/repo/scripts/agent_runner.sh', '--agent', 'codex-worker', '--repo-root', '/repo']]);
    expect(call[2]).toMatchObject({ cwd: '/repo', detached: true, stdio: 'ignore' });
    expect(call[2].env).toMatchObject({ DASHBOARD_REPO_ROOT: '/repo' });
    expect(writeState).toHaveBeenCalledWith('codex-worker', { pid: 412, startTime: 987 });
    expect(unref).toHaveBeenCalledOnce();
  });

  it('does not invoke a program for an unbound owner', () => {
    const spawn = vi.fn();
    expect(triggerRunner('worker-desktop', { cwd: '/repo/dashboard', spawn })).toMatchObject({ status: 'unbound' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports a failed spawn or unreadable start time without claiming success', () => {
    expect(triggerRunner('codex-worker', { cwd: '/repo/dashboard', spawn: () => { throw new Error('spawn denied'); } })).toMatchObject({ status: 'failed', detail: 'spawn denied' });
    expect(triggerRunner('codex-worker', { cwd: '/repo/dashboard', spawn: () => ({ pid: 9, unref: vi.fn() }), processStartTime: () => null })).toMatchObject({ status: 'failed', detail: expect.stringContaining('could not read start time') });
  });
});

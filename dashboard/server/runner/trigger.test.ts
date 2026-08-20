import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { runnerForOwner, taskForOwner, triggerRunner } from './trigger.ts';

describe('runner trigger', () => {
  it('maps only the registered codex worker to a closed scheduled-task name', () => {
    expect(taskForOwner('codex-worker', {})).toBe('kb-codex-runner');
    expect(taskForOwner('codex-worker', { DASHBOARD_CODEX_RUNNER_TASK: 'kb-custom' })).toBe('kb-custom');
    expect(taskForOwner('worker-desktop', {})).toBeNull();
    expect(taskForOwner('../../task', {})).toBeNull();
  });

  it('maps only the registered codex worker to a closed POSIX runner', () => {
    expect(runnerForOwner('codex-worker', '/repo')).toEqual({
      id: 'kb-codex-runner',
      script: join('/repo', 'scripts', 'agent_runner.sh'),
    });
    expect(runnerForOwner('worker-desktop', '/repo')).toBeNull();
    expect(runnerForOwner('../../runner', '/repo')).toBeNull();
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

  it('starts the Linux runner detached, records pid/start-time, and unrefs it', () => {
    const run = vi.fn();
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ pid: 412, unref }));
    const writeState = vi.fn();
    expect(triggerRunner('codex-worker', {
      platform: 'linux',
      cwd: '/repo/dashboard',
      env: { DASHBOARD_REPO_ROOT: '/repo' },
      run,
      spawn,
      processStartTime: () => 987,
      writeState,
    })).toEqual({ status: 'triggered', owner: 'codex-worker', task: 'kb-codex-runner' });
    const call = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv; detached: boolean; stdio: string },
    ];
    expect(call.slice(0, 2)).toEqual([
      '/bin/sh',
      [join('/repo', 'scripts', 'agent_runner.sh'), '--agent', 'codex-worker', '--repo-root', '/repo'],
    ]);
    expect(call[2]).toMatchObject({ cwd: '/repo', detached: true, stdio: 'ignore' });
    expect(call[2].env).toMatchObject({ DASHBOARD_REPO_ROOT: '/repo', KB_PYTHON: 'python3' });
    expect(writeState).toHaveBeenCalledWith('codex-worker', { pid: 412, startTime: 987 });
    expect(unref).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed on unsupported platforms', () => {
    const run = vi.fn();
    const spawn = vi.fn();
    expect(triggerRunner('codex-worker', { platform: 'darwin', env: {}, run, spawn })).toMatchObject({
      status: 'unavailable',
    });
    expect(run).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
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

  it('reports a failed Linux spawn or unreadable start time without claiming success', () => {
    expect(triggerRunner('codex-worker', {
      platform: 'linux',
      cwd: '/repo/dashboard',
      env: { DASHBOARD_REPO_ROOT: '/repo' },
      spawn: () => { throw new Error('spawn denied'); },
    })).toMatchObject({ status: 'failed', detail: 'spawn denied' });
    expect(triggerRunner('codex-worker', {
      platform: 'linux',
      cwd: '/repo/dashboard',
      env: { DASHBOARD_REPO_ROOT: '/repo' },
      spawn: () => ({ pid: 9, unref: vi.fn() }),
      processStartTime: () => null,
    })).toMatchObject({ status: 'failed', detail: expect.stringContaining('could not read start time') });
  });
});

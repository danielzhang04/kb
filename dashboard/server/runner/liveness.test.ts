/**
 * G3 reply-liveness — the owner-consumer probe. All side effects (schtasks read, clock) are injected, so
 * no real Task Scheduler is queried. Proves the three branches, the win32 gate, the offline-degrade, and
 * that a repeat call within the TTL never re-runs schtasks (a slow schtasks can never block the route).
 */
import { describe, expect, it, vi } from 'vitest';
import { ownerLiveness, type LivenessCache, type LivenessDeps } from './liveness.ts';

function card(meta: Record<string, unknown> = {}): { meta: Record<string, unknown> } {
  return { meta };
}

/** A win32 deps base with a fresh cache; individual tests override `run`. */
function win32(run: LivenessDeps['run'], extra: Partial<LivenessDeps> = {}): LivenessDeps {
  return { platform: 'win32', now: () => 1_000_000, cache: new Map() as LivenessCache, run, ...extra };
}

function linux(extra: Partial<LivenessDeps> = {}): LivenessDeps {
  return {
    platform: 'linux',
    now: () => 1_000_000,
    cache: new Map() as LivenessCache,
    readState: () => ({ pid: 42, startTime: 99 }),
    processStartTime: () => 99,
    ...extra,
  };
}

const READY = 'TaskName: \\kb-codex-runner\r\nStatus:                Ready\r\nLogon Mode:            Interactive/Background\r\n';
const RUNNING = 'TaskName: \\kb-codex-runner\r\nStatus:                Running\r\n';
const DISABLED = 'TaskName: \\kb-codex-runner\r\nStatus:                Disabled\r\n';

describe('ownerLiveness', () => {
  it('(a) an execution-controller: dashboard card reports the Wave A bridge, not online yet', () => {
    const result = ownerLiveness('codex-worker', card({ 'execution-controller': 'dashboard' }), win32(() => READY));
    expect(result.consumer).toBe('dashboard-bridge');
    expect(result.online).toBe(false);
    expect(result.detail).toMatch(/wave a/i);
  });

  it('(b) a registered runner reporting Ready is online (scheduled-task)', () => {
    const run = vi.fn(() => READY);
    const result = ownerLiveness('codex-worker', card(), win32(run));
    expect(result).toEqual({ consumer: 'scheduled-task', online: true, detail: 'scheduled task kb-codex-runner is Ready' });
    expect(run).toHaveBeenCalledWith('kb-codex-runner');
  });

  it('(b) Running also counts as online', () => {
    expect(ownerLiveness('codex-worker', card(), win32(() => RUNNING)).online).toBe(true);
  });

  it('(b) a non-Ready/Running status is offline but still a known scheduled task', () => {
    const result = ownerLiveness('codex-worker', card(), win32(() => DISABLED));
    expect(result.consumer).toBe('scheduled-task');
    expect(result.online).toBe(false);
    expect(result.detail).toMatch(/Disabled/);
  });

  it('(b) a schtasks throw degrades to offline with a failure detail — never throws', () => {
    const result = ownerLiveness('codex-worker', card(), win32(() => { throw new Error('task not found'); }));
    expect(result).toEqual({ consumer: 'scheduled-task', online: false, detail: 'schtasks query for kb-codex-runner failed' });
  });

  it('(b) caches by task — a second call within the TTL does NOT re-run schtasks', () => {
    const run = vi.fn(() => READY);
    const deps = win32(run);
    const first = ownerLiveness('codex-worker', card(), deps);
    const second = ownerLiveness('codex-worker', card(), deps);
    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('(b) re-queries once the cached entry expires past the TTL', () => {
    const run = vi.fn(() => READY);
    let clock = 1_000_000;
    const deps = win32(run, { now: () => clock, ttlMs: 30_000 });
    ownerLiveness('codex-worker', card(), deps);
    clock += 30_001;
    ownerLiveness('codex-worker', card(), deps);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('(c) an owner with no registered task reports no known consumer', () => {
    const run = vi.fn(() => READY);
    const result = ownerLiveness('some-other-agent', card(), win32(run));
    expect(result).toEqual({ consumer: 'none', online: false, detail: 'no runner is registered for some-other-agent' });
    expect(run).not.toHaveBeenCalled(); // never probes a task it has no closed-map name for
  });

  it('on Linux requires both a recorded pid and matching process start time', () => {
    expect(ownerLiveness('codex-worker', card(), linux())).toEqual({
      consumer: 'runner-process',
      online: true,
      detail: 'runner kb-codex-runner is running (pid 42)',
    });
    expect(ownerLiveness('codex-worker', card(), linux({ processStartTime: () => 100 }))).toEqual({
      consumer: 'runner-process',
      online: false,
      detail: 'runner kb-codex-runner is not running',
    });
  });

  it('on Linux treats absent state as an offline known runner', () => {
    expect(ownerLiveness('codex-worker', card(), linux({ readState: () => null }))).toEqual({
      consumer: 'runner-process',
      online: false,
      detail: 'runner kb-codex-runner is not running',
    });
  });

  it('on Linux caches the pid/start-time probe within the TTL', () => {
    const readState = vi.fn(() => ({ pid: 42, startTime: 99 }));
    const readStartTime = vi.fn(() => 99);
    const deps = linux({ readState, processStartTime: readStartTime });
    expect(ownerLiveness('codex-worker', card(), deps)).toEqual(ownerLiveness('codex-worker', card(), deps));
    expect(readState).toHaveBeenCalledOnce();
    expect(readStartTime).toHaveBeenCalledOnce();
  });

  it('on Linux does not probe state for an unbound owner', () => {
    const readState = vi.fn();
    expect(ownerLiveness('other', card(), linux({ readState }))).toMatchObject({ consumer: 'none', online: false });
    expect(readState).not.toHaveBeenCalled();
  });

  it('on unsupported platforms never probes schtasks and reports no known consumer', () => {
    const run = vi.fn(() => READY);
    const result = ownerLiveness('codex-worker', card(), { platform: 'darwin', run, cache: new Map() });
    expect(result.consumer).toBe('none');
    expect(result.online).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

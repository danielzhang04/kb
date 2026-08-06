import { describe, expect, it, vi } from 'vitest';
import { ownerLiveness, type LivenessCache, type LivenessDeps } from './liveness.ts';

function card(meta: Record<string, unknown> = {}): { meta: Record<string, unknown> } { return { meta }; }
function deps(extra: Partial<LivenessDeps> = {}): LivenessDeps {
  return { now: () => 1_000_000, cache: new Map() as LivenessCache, readState: () => ({ pid: 42, startTime: 99 }), processStartTime: () => 99, ...extra };
}

describe('ownerLiveness', () => {
  it('reports dashboard-controlled cards as pending activation', () => {
    expect(ownerLiveness('codex-worker', card({ 'execution-controller': 'dashboard' }), deps())).toMatchObject({ consumer: 'dashboard-bridge', online: false });
  });
  it('requires both a recorded pid and matching process start time', () => {
    expect(ownerLiveness('codex-worker', card(), deps())).toEqual({ consumer: 'runner-process', online: true, detail: 'runner kb-codex-runner is running (pid 42)' });
    expect(ownerLiveness('codex-worker', card(), deps({ processStartTime: () => 100 }))).toEqual({ consumer: 'runner-process', online: false, detail: 'runner kb-codex-runner is not running' });
  });
  it('treats absent state as an offline known runner', () => {
    expect(ownerLiveness('codex-worker', card(), deps({ readState: () => null }))).toMatchObject({ consumer: 'runner-process', online: false });
  });
  it('caches the pid/start-time probe within the TTL', () => {
    const readState = vi.fn(() => ({ pid: 42, startTime: 99 }));
    const processStartTime = vi.fn(() => 99);
    const d = deps({ readState, processStartTime });
    expect(ownerLiveness('codex-worker', card(), d)).toEqual(ownerLiveness('codex-worker', card(), d));
    expect(readState).toHaveBeenCalledOnce();
    expect(processStartTime).toHaveBeenCalledOnce();
  });
  it('reports an unbound owner without probing state', () => {
    const readState = vi.fn();
    expect(ownerLiveness('other', card(), deps({ readState }))).toMatchObject({ consumer: 'none', online: false });
    expect(readState).not.toHaveBeenCalled();
  });
});

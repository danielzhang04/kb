import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HUMAN_REQUEST_STALE_WINDOW_MS,
  startHumanRequestSweeper,
  sweepOrphanedHumanRequests,
  type HumanRequestSweepDeps,
} from './humanRequestSweep.ts';
import type { ControlPlaneStore } from './store.ts';

function fakeStore(impl: ControlPlaneStore['closeOrphanedHumanRequests']): ControlPlaneStore {
  return { closeOrphanedHumanRequests: impl } as unknown as ControlPlaneStore;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sweepOrphanedHumanRequests', () => {
  it('calls the store with the resolved clock and window, and reports closed refs to the sink', () => {
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [{ requestRef: 'request-1' }] });
    const onSweep = vi.fn();
    const deps: HumanRequestSweepDeps = {
      store: fakeStore(closeOrphanedHumanRequests),
      now: () => new Date('2026-08-11T00:00:00.000Z'),
      staleWindowMs: 1_000,
      onSweep,
    };
    const result = sweepOrphanedHumanRequests(deps);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledWith(Date.parse('2026-08-11T00:00:00.000Z'), 1_000);
    expect(result).toEqual({ closed: ['request-1'] });
    expect(onSweep).toHaveBeenCalledWith({ closed: ['request-1'] });
  });

  it('defaults the window to the 7-day constant when none is supplied', () => {
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [] });
    sweepOrphanedHumanRequests({ store: fakeStore(closeOrphanedHumanRequests), now: () => new Date(0) });
    expect(closeOrphanedHumanRequests).toHaveBeenCalledWith(0, DEFAULT_HUMAN_REQUEST_STALE_WINDOW_MS);
  });
});

describe('startHumanRequestSweeper', () => {
  it('disables entirely for a non-positive interval — no boot sweep, no timer', () => {
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [] });
    const stop = startHumanRequestSweeper({ store: fakeStore(closeOrphanedHumanRequests) }, 0);
    expect(closeOrphanedHumanRequests).not.toHaveBeenCalled();
    stop();
  });

  it('sweeps once immediately (the boot sweep) and again on every interval tick', () => {
    vi.useFakeTimers();
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [] });
    const stop = startHumanRequestSweeper({ store: fakeStore(closeOrphanedHumanRequests) }, 1_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(1); // boot sweep, before any tick fires
    vi.advanceTimersByTime(1_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(10_000);
    expect(closeOrphanedHumanRequests).toHaveBeenCalledTimes(4); // stopped: no further ticks
  });

  it('never lets a store throw escape a tick, and never overlaps a slow sweep with the next tick', () => {
    vi.useFakeTimers();
    let calls = 0;
    const closeOrphanedHumanRequests = vi.fn(() => {
      calls += 1;
      throw new Error('store fault');
    });
    expect(() => startHumanRequestSweeper({ store: fakeStore(closeOrphanedHumanRequests) }, 1_000)).not.toThrow();
    expect(calls).toBe(1);
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    expect(calls).toBe(2);
  });
});

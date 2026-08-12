import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startHumanRequestSweeper,
  sweepOrphanedHumanRequests,
  type HumanRequestSweepDeps,
} from './humanRequestSweep.ts';
import type { ControlPlaneStore } from './store.ts';

function fakeStore(impl: ControlPlaneStore['closeOrphanedHumanRequests']): ControlPlaneStore {
  return { closeOrphanedHumanRequests: impl } as unknown as ControlPlaneStore;
}

/** One request as the store reports it back from a sweep (only the fields this module reads). */
function closedRequest(requestRef: string, runRef: string, reason: string | null) {
  return { requestRef, runRef, response: { response: reason } };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sweepOrphanedHumanRequests', () => {
  it('calls the store with the resolved clock ONLY — there is no age window to pass any more', () => {
    // The removed age predicate (ruling 2026-08-11): the sweep can no longer ask the store to close a
    // request for being old, so it has nothing to configure and no window constant to carry.
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [] });
    sweepOrphanedHumanRequests({ store: fakeStore(closeOrphanedHumanRequests), now: () => new Date('2026-08-11T00:00:00.000Z') });
    expect(closeOrphanedHumanRequests).toHaveBeenCalledWith(Date.parse('2026-08-11T00:00:00.000Z'));
    expect(closeOrphanedHumanRequests.mock.calls[0]).toHaveLength(1);
  });

  it('reports what closed, on which run and why, to the sink the daemon logs from', () => {
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({
      closed: [closedRequest('request-1', 'run-9', "Automatically closed — the run reached its terminal state ('failed')…")],
    });
    const onSweep = vi.fn();
    const deps: HumanRequestSweepDeps = {
      store: fakeStore(closeOrphanedHumanRequests),
      now: () => new Date('2026-08-11T00:00:00.000Z'),
      onSweep,
    };

    const result = sweepOrphanedHumanRequests(deps);

    expect(result).toEqual({
      closed: [{ requestRef: 'request-1', runRef: 'run-9', reason: expect.stringContaining('terminal state') }],
      auditFailures: [],
    });
    expect(onSweep).toHaveBeenCalledWith(result);
  });

  it('writes one audit-ledger row per closed request, under the repo root, with the reason', () => {
    const appendAuditLocal = vi.fn().mockReturnValue({ ts: '2026-08-11T00:00:00.000Z', action: 'x' });
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({
      closed: [closedRequest('request-1', 'run-9', 'terminal:failed'), closedRequest('request-2', 'run-9', 'terminal:failed')],
    });

    const result = sweepOrphanedHumanRequests({
      store: fakeStore(closeOrphanedHumanRequests),
      repoRoot: '/repo',
      appendAuditLocal,
      now: () => new Date('2026-08-11T00:00:00.000Z'),
    });

    expect(appendAuditLocal).toHaveBeenCalledTimes(2);
    expect(appendAuditLocal.mock.calls[0]![0]).toBe('/repo');
    expect(appendAuditLocal.mock.calls[0]![1]).toMatchObject({
      action: 'control-human-request-auto-close',
      target: 'request-1',
      result: 'auto-closed',
      detail: { requestRef: 'request-1', runRef: 'run-9', reason: 'terminal:failed' },
    });
    expect(result.auditFailures).toEqual([]);
  });

  it('reports — never throws — when the audit row cannot be written: the close is already committed', () => {
    const appendAuditLocal = vi.fn(() => { throw new Error('ledger unwritable'); });
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [closedRequest('request-1', 'run-9', 'terminal:failed')] });
    const onSweep = vi.fn();

    const result = sweepOrphanedHumanRequests({
      store: fakeStore(closeOrphanedHumanRequests), repoRoot: '/repo', appendAuditLocal, onSweep,
    });

    expect(result.closed).toHaveLength(1);
    expect(result.auditFailures).toEqual(['request-1']);
    expect(onSweep).toHaveBeenCalledWith(result);
  });

  it('attempts no audit row at all with no repo root (in-memory/test wiring)', () => {
    const appendAuditLocal = vi.fn();
    const closeOrphanedHumanRequests = vi.fn().mockReturnValue({ closed: [closedRequest('request-1', 'run-9', null)] });
    const result = sweepOrphanedHumanRequests({ store: fakeStore(closeOrphanedHumanRequests), appendAuditLocal });
    expect(appendAuditLocal).not.toHaveBeenCalled();
    expect(result).toEqual({ closed: [{ requestRef: 'request-1', runRef: 'run-9', reason: null }], auditFailures: [] });
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

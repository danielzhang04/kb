import { describe, expect, it, vi } from 'vitest';
import type { OperationalEventDto } from './controlClient';
import {
  loadRunEventWindow,
  RUN_EVENT_MAX_PAGES,
  RUN_EVENT_PAGE,
  RUN_EVENT_WINDOW,
  type ListRunEvents,
} from './runEventWindow';

function event(cursor: number): OperationalEventDto {
  return {
    cursor, runRef: 'run-1', stageRef: null, attemptRef: null, kind: 'lifecycle',
    summary: `event ${cursor}`, command: null, toolName: null, path: null, diff: null,
    checkpoint: null, status: null, source: 'broker', createdAt: '2026-07-18T10:00:00.000Z',
  } as unknown as OperationalEventDto;
}

/**
 * A stand-in for the real route, with the SAME semantics that caused the bug: `cursor > after`, then
 * `slice(0, limit)`. Forward-only — there is no way to ask this endpoint for the tail directly.
 */
function serverWith(total: number): ListRunEvents {
  const all = Array.from({ length: total }, (_, i) => event(i + 1));
  return async (_runRef, after, limit) => all.filter((e) => e.cursor > after).slice(0, limit);
}

describe('loadRunEventWindow', () => {
  it('returns everything, complete, for a run shorter than the window', async () => {
    const result = await loadRunEventWindow('run-1', 'token', serverWith(12));
    expect(result.events).toHaveLength(12);
    expect(result.seen).toBe(12);
    expect(result.complete).toBe(true);
  });

  it('handles a run with no events at all', async () => {
    const result = await loadRunEventWindow('run-1', 'token', serverWith(0));
    expect(result.events).toEqual([]);
    expect(result.seen).toBe(0);
    expect(result.complete).toBe(true);
  });

  /**
   * THE BUG. A single `listRunEvents(runRef, 0, 500)` returns cursors 1-500 — the START of a 5,000-event
   * run — while the grid card prints 5000. The operator watching a run was shown its beginning.
   */
  it('shows the NEWEST events, not the oldest, for a long run', async () => {
    const result = await loadRunEventWindow('run-1', 'token', serverWith(5_000));

    expect(result.events).toHaveLength(RUN_EVENT_WINDOW);
    // The tail: cursors 4501-5000, NOT 1-500.
    expect(result.events[0].cursor).toBe(5_000 - RUN_EVENT_WINDOW + 1);
    expect(result.events[result.events.length - 1].cursor).toBe(5_000);
    // `seen` is the run's TRUE total, which is what makes the tab count agree with the grid card.
    expect(result.seen).toBe(5_000);
    expect(result.complete).toBe(true);
  });

  it('costs one request per server page, not one per event', async () => {
    const fetchPage = vi.fn(serverWith(5_000));
    await loadRunEventWindow('run-1', 'token', fetchPage);
    // 5 full pages then a short 6th proves exhaustion. Never more than ceil(total/PAGE) + 1.
    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(Math.ceil(5_000 / RUN_EVENT_PAGE) + 1);
    expect(fetchPage.mock.calls.every(([, , limit]) => limit === RUN_EVENT_PAGE)).toBe(true);
  });

  it('advances the cursor rather than refetching from zero', async () => {
    const fetchPage = vi.fn(serverWith(2_500));
    await loadRunEventWindow('run-1', 'token', fetchPage);
    const afters = fetchPage.mock.calls.map(([, after]) => after);
    expect(afters[0]).toBe(0);
    // Strictly increasing: a stuck cursor would loop until the page cap and report `complete: false`.
    expect(afters.every((value, i) => i === 0 || value > afters[i - 1])).toBe(true);
  });

  /**
   * The honesty case. Past the page cap the window is an INTERIOR slice — neither the head nor the tail —
   * so `complete: false` must say so and the caller must not label it "most recent".
   */
  it('reports complete: false rather than presenting an interior slice as the tail', async () => {
    const total = RUN_EVENT_MAX_PAGES * RUN_EVENT_PAGE + 1;
    const result = await loadRunEventWindow('run-1', 'token', serverWith(total));

    expect(result.complete).toBe(false);
    expect(result.events).toHaveLength(RUN_EVENT_WINDOW);
    // It really is NOT the tail — the last event of the run is absent.
    expect(result.events[result.events.length - 1].cursor).toBeLessThan(total);
    // And `seen` is a lower bound, which is why the UI words it "more than N".
    expect(result.seen).toBeLessThan(total);
  });

  it('never accumulates more than the window, however long the run', async () => {
    const result = await loadRunEventWindow('run-1', 'token', serverWith(20_000));
    expect(result.events.length).toBe(RUN_EVENT_WINDOW);
  });
});

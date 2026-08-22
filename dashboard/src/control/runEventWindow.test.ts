import { describe, expect, it, vi } from 'vitest';
import type { OperationalEventDto } from './controlClient';
import {
  loadRunEventWindow,
  RUN_EVENT_MAX_PAGES,
  RUN_EVENT_PAGE,
  type ListRunEvents,
} from './runEventWindow';

function event(cursor: number): OperationalEventDto {
  return {
    cursor, runRef: 'run-1', stageRef: null, attemptRef: null, kind: 'lifecycle',
    summary: `event ${cursor}`, command: null, toolName: null, path: null, diff: null,
    checkpoint: null, status: null, source: 'broker', createdAt: '2026-07-18T10:00:00.000Z',
  } as unknown as OperationalEventDto;
}

function serverWith(total: number): ListRunEvents {
  const all = Array.from({ length: total }, (_, index) => event(index + 1));
  return async (_runRef, after, limit) => {
    const items = all.slice(after, after + limit);
    const nextCursor = after + items.length < total ? items.at(-1)!.cursor : null;
    return { revision: 'a'.repeat(64), items, nextCursor };
  };
}

describe('loadRunEventWindow', () => {
  it('returns an empty complete replay', async () => {
    await expect(loadRunEventWindow('run-1', 'token', serverWith(0))).resolves.toEqual({
      events: [], seen: 0, complete: true,
    });
  });

  it('uses nextCursor pages to replay every event beyond the 250-event route ceiling', async () => {
    const fetchPage = vi.fn(serverWith(601));
    const result = await loadRunEventWindow('run-1', 'token', fetchPage);

    expect(result.events.map((item) => item.cursor)).toEqual(Array.from({ length: 601 }, (_, index) => index + 1));
    expect(fetchPage.mock.calls.map(([, after]) => after)).toEqual([0, 250, 500]);
    expect(fetchPage.mock.calls.every(([, , limit]) => limit === 250)).toBe(true);
    expect(result).toMatchObject({ seen: 601, complete: true });
  });

  it('advances by the server nextCursor rather than guessing from the last event', async () => {
    const fetchPage: ListRunEvents = vi.fn()
      .mockResolvedValueOnce({ revision: 'a'.repeat(64), items: [event(1), event(2)], nextCursor: 9 })
      .mockResolvedValueOnce({ revision: 'a'.repeat(64), items: [event(10)], nextCursor: null });
    const result = await loadRunEventWindow('run-1', 'token', fetchPage);

    expect(vi.mocked(fetchPage).mock.calls.map(([, after]) => after)).toEqual([0, 9]);
    expect(result.events.map((item) => item.cursor)).toEqual([1, 2, 10]);
  });

  it('reports incomplete replay at the page cap instead of calling an interior slice complete', async () => {
    const total = RUN_EVENT_MAX_PAGES * RUN_EVENT_PAGE + 1;
    const result = await loadRunEventWindow('run-1', 'token', serverWith(total));

    expect(result.complete).toBe(false);
    expect(result.events).toHaveLength(RUN_EVENT_MAX_PAGES * RUN_EVENT_PAGE);
    expect(result.events.at(-1)?.cursor).toBeLessThan(total);
    expect(result.seen).toBeLessThan(total);
  });

  it('reports incomplete replay when the server returns a non-advancing nextCursor', async () => {
    const fetchPage: ListRunEvents = vi.fn(async () => ({
      revision: 'a'.repeat(64), items: [event(1)], nextCursor: 0,
    }));
    const result = await loadRunEventWindow('run-1', 'token', fetchPage);

    expect(result).toMatchObject({ seen: 1, complete: false });
    expect(fetchPage).toHaveBeenCalledOnce();
  });
});

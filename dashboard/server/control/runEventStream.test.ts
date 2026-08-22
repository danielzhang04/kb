import { describe, expect, it, vi } from 'vitest';
import { createRunEventService, type RunEventService, type RunEventSource } from './runEventService.ts';
import { createRunEventStream } from './runEventStream.ts';
import type { OperationalEvent } from './types.ts';

function event(cursor: number): OperationalEvent {
  return {
    cursor, runRef: 'run-1', kind: cursor % 2 ? 'message' : 'tool', source: 'worker',
    stageRef: null, attemptRef: null, sessionRef: null, status: cursor % 2 ? null : 'success',
    summary: cursor % 2 ? `line ${cursor}` : null, command: null,
    toolName: cursor % 2 ? null : 'Read', path: null, diff: null, checkpoint: null,
    createdAt: `2026-08-21T00:00:0${cursor}.000Z`,
  };
}

function streamFor(sources: readonly RunEventSource[]) {
  const service = createRunEventService({ readRunEventSources: async () => sources });
  return createRunEventStream(service);
}

describe('run event SSE stream', () => {
  it.each(['-1', '1.5', '9007199254740992', 'not-a-cursor'])(
    'rejects an unsafe Last-Event-ID instead of silently replaying from zero: %s',
    async (lastEventId) => {
      await expect(streamFor([{ kind: 'control', event: event(1) }]).replay({
        subject: 'operator', runRef: 'run-1', afterCursor: 0, limit: 10, lastEventId,
      })).rejects.toThrow(/safe non-negative integer/);
    },
  );

  it('Last-Event-ID replay skips accepted rows and duplicate cursor frames', async () => {
    const sources = [event(1), event(2), event(2), event(3)].map((value) => ({ kind: 'control' as const, event: value }));
    const result = await streamFor(sources).replay({
      subject: 'operator', runRef: 'run-1', afterCursor: 0, limit: 10, lastEventId: '1000',
    });

    expect(result.frames.map((frame) => frame.id)).toEqual([2_000, 3_000]);
    expect(result.frames[0].wire).toMatch(/^id: 2000\nevent: run-event\ndata: /);
  });

  it('passes the independently validated reconnect cursor to the service and frames its exact page once', async () => {
    const page = { revision: 'a'.repeat(64), items: [event(3)], nextCursor: null };
    const replay = vi.fn(async () => page);
    const service = {
      replay,
      projectRunRow: vi.fn(),
      openLive: vi.fn(),
    } as unknown as RunEventService;
    const resumed = await createRunEventStream(service).replay({
      subject: 'operator', runRef: 'run-1', afterCursor: 1_000, limit: 250, lastEventId: '2000',
    });

    expect(replay).toHaveBeenCalledOnce();
    expect(replay).toHaveBeenCalledWith(expect.objectContaining({ afterCursor: 2_000 }));
    expect(resumed.frames).toEqual([expect.objectContaining({
      id: 3,
      data: JSON.stringify(page.items[0]),
      wire: `id: 3\nevent: run-event\ndata: ${JSON.stringify(page.items[0])}\n\n`,
    })]);
  });
});

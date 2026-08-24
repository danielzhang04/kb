// @vitest-environment jsdom
/**
 * D0.9 — `useSse` unit. The hook subscribes to the hub's `/events` SSE stream and applies each
 * incoming delta to React state. jsdom has no `EventSource`, so the test injects a controllable fake
 * source factory (the same seam the browser uses with the real `EventSource`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useRunEventStream, useSse } from './sseClient';
import type { SseSource } from './sseClient';

afterEach(cleanup);

/** Minimal EventSource stand-in: records handlers per named channel, replays on `emit`. */
class FakeSource implements SseSource {
  handlers: Record<string, ((ev: { data: string }) => void)[]> = {};
  closed = false;
  url: string;

  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, handler: (ev: { data: string }) => void): void {
    (this.handlers[type] ??= []).push(handler);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    for (const h of this.handlers[type] ?? []) h({ data });
  }
}

describe('useSse', () => {
  it('applies an incoming delta to state', () => {
    const sources: FakeSource[] = [];
    const factory = (url: string): SseSource => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    };

    const { result } = renderHook(() => useSse('/events', factory));
    expect(result.current.last).toBeNull();
    expect(result.current.count).toBe(0);
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('/events');

    const delta = { channel: 'planeA', kind: 'cards', path: 'queue/working/x.md' };
    act(() => {
      sources[0].emit('planeA', JSON.stringify(delta));
    });

    expect(result.current.last).toEqual(delta);
    expect(result.current.count).toBe(1);
  });

  it('closes the source on unmount', () => {
    const sources: FakeSource[] = [];
    const factory = (url: string): SseSource => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    };
    const { unmount } = renderHook(() => useSse('/events', factory));
    expect(sources[0].closed).toBe(false);
    unmount();
    expect(sources[0].closed).toBe(true);
  });

  it('listens for control channel frames', () => {
    const sources: FakeSource[] = [];
    const { result } = renderHook(() => useSse('/events', (url) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    }));

    act(() => {
      sources[0].emit('control', JSON.stringify({ channel: 'control', kind: 'store-change' }));
    });

    expect(result.current.last).toEqual({ channel: 'control', kind: 'store-change' });
  });
});

describe('useRunEventStream', () => {
  const replay = [{
    cursor: 1, runRef: 'run-1', kind: 'message' as const, source: 'worker' as const,
    stageRef: null, attemptRef: null, sessionRef: null, status: null, summary: 'replayed',
    command: null, toolName: null, path: null, diff: null, checkpoint: null,
    createdAt: '2026-08-21T00:00:01.000Z',
  }];

  it('resumes after replay, rejects invalid frames, deduplicates cursors, and closes when detached', () => {
    const sources: FakeSource[] = [];
    const factory = (url: string): SseSource => {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    };
    const { result, rerender } = renderHook(
      ({ attached }) => useRunEventStream('run-1', replay, attached, factory),
      { initialProps: { attached: true } },
    );
    expect(sources[0].url).toBe('/api/control/runs/run-1/events/stream?after=1');
    expect(result.current.events.map((event) => event.summary)).toEqual(['replayed']);

    act(() => sources[0].emit('run-event', JSON.stringify({ ...replay[0], cursor: 2, summary: 'live' })));
    act(() => sources[0].emit('run-event', JSON.stringify({ ...replay[0], cursor: 2, summary: 'live' })));
    act(() => sources[0].emit('run-event', JSON.stringify({ ...replay[0], cursor: 3, runRef: 'foreign', summary: 'foreign' })));
    act(() => sources[0].emit('run-event', '{not-json'));
    expect(result.current.connection).toBe('live');
    expect(result.current.events.map((event) => event.summary)).toEqual(['replayed', 'live']);

    act(() => sources[0].emit('error', ''));
    expect(result.current.connection).toBe('reconnecting');
    expect(result.current.events).toHaveLength(2);

    rerender({ attached: false });
    expect(sources[0].closed).toBe(true);
    expect(result.current.connection).toBe('replay');
    expect(result.current.events.map((event) => event.summary)).toEqual(['replayed', 'live']);
  });
});

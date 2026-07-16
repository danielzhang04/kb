// @vitest-environment jsdom
/**
 * D0.9 — `useSse` unit. The hook subscribes to the hub's `/events` SSE stream and applies each
 * incoming delta to React state. jsdom has no `EventSource`, so the test injects a controllable fake
 * source factory (the same seam the browser uses with the real `EventSource`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSse } from './sseClient';
import type { SseSource } from './sseClient';

afterEach(cleanup);

/** Minimal EventSource stand-in: records handlers per named channel, replays on `emit`. */
class FakeSource implements SseSource {
  handlers: Record<string, ((ev: { data: string }) => void)[]> = {};
  closed = false;
  constructor(public url: string) {}
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
});

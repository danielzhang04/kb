/**
 * SSE client hook (D0.9). Subscribes the SPA to the hub's read-only `/events` stream (D0.4) and
 * applies each incoming delta to React state. The hub emits *named* SSE events per channel
 * (`event: planeA` / `event: planeB`), so we listen on both channels (plus the default `message`).
 *
 * The `EventSource` is injected via a factory so the hook is testable under jsdom (which ships no
 * `EventSource`) and degrades to a no-op when the runtime has none — it never throws at mount.
 */
import { useEffect, useState } from 'react';

/** One delta frame off the hub bus (mirrors `server/hub/bus.ts` `HubEvent`). */
export interface SseDelta {
  channel: string;
  kind: string;
  path?: string;
  data?: unknown;
}

/** The slice of `EventSource` this hook uses — kept minimal so tests can supply a fake. */
export interface SseSource {
  addEventListener(type: string, handler: (ev: { data: string }) => void): void;
  close(): void;
}

export type SseFactory = (url: string) => SseSource;

const NOOP_SOURCE: SseSource = {
  addEventListener() {
    /* no-op */
  },
  close() {
    /* no-op */
  },
};

/** Default factory: real `EventSource` in the browser, a no-op where it is unavailable (SSR/jsdom). */
const defaultFactory: SseFactory = (url) => {
  const Ctor = (globalThis as { EventSource?: new (u: string) => SseSource }).EventSource;
  return Ctor ? new Ctor(url) : NOOP_SOURCE;
};

/** Channels the hub publishes on, plus the unnamed default. */
const CHANNELS = ['planeA', 'planeB', 'control', 'message'] as const;

export interface UseSseResult {
  /** The most recent delta, or `null` before the first frame. */
  last: SseDelta | null;
  /** How many deltas have arrived — a monotonic tick consumers can use to trigger refetches. */
  count: number;
}

/**
 * Subscribe to an SSE `path` and surface the latest delta + an arrival counter. The factory arg is
 * for tests/DI; production omits it and gets the real `EventSource`.
 */
export function useSse(path: string, makeSource: SseFactory = defaultFactory): UseSseResult {
  const [last, setLast] = useState<SseDelta | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const source = makeSource(path);
    const onEvent = (ev: { data: string }): void => {
      try {
        const delta = JSON.parse(ev.data) as SseDelta;
        setLast(delta);
        setCount((c) => c + 1);
      } catch {
        // A malformed / non-JSON frame (e.g. the `: connected` keep-alive comment) is ignored.
      }
    };
    for (const channel of CHANNELS) source.addEventListener(channel, onEvent);
    return () => source.close();
  }, [path, makeSource]);

  return { last, count };
}

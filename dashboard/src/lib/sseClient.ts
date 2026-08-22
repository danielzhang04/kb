/**
 * SSE client hook (D0.9). Subscribes the SPA to the hub's read-only `/events` stream (D0.4) and
 * applies each incoming delta to React state. The hub emits *named* SSE events per channel
 * (`event: planeA` / `event: planeB`), so we listen on both channels (plus the default `message`).
 *
 * The `EventSource` is injected via a factory so the hook is testable under jsdom (which ships no
 * `EventSource`) and degrades to a no-op when the runtime has none — it never throws at mount.
 */
import { useEffect, useState } from 'react';
import { decodeOperationalEvent, type OperationalEventDto } from '../control/controlClient.ts';

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

type RunEvent = OperationalEventDto;

export interface UseRunEventStreamResult {
  events: RunEvent[];
  connection: 'live' | 'reconnecting' | 'replay';
}

function mergeRunEvents(current: readonly RunEvent[], incoming: readonly RunEvent[]): RunEvent[] {
  const byCursor = new Map(current.map((event) => [event.cursor, event]));
  for (const event of incoming) byCursor.set(event.cursor, event);
  return [...byCursor.values()].sort((left, right) => left.cursor - right.cursor);
}

/** Replay and reconnect use the same redacted event records; detaching closes only this read channel. */
export function useRunEventStream(
  runRef: string,
  replay: readonly RunEvent[],
  attached = true,
  makeSource: SseFactory = defaultFactory,
): UseRunEventStreamResult {
  const [events, setEvents] = useState<RunEvent[]>(() => mergeRunEvents([], replay));
  const [connection, setConnection] = useState<UseRunEventStreamResult['connection']>(attached ? 'reconnecting' : 'replay');

  useEffect(() => setEvents((current) => mergeRunEvents(current, replay)), [replay]);

  useEffect(() => {
    if (!attached) {
      setConnection('replay');
      return;
    }
    const after = replay.reduce((cursor, event) => Math.max(cursor, event.cursor), 0);
    const source = makeSource(`/api/control/runs/${encodeURIComponent(runRef)}/events/stream?after=${after}`);
    setConnection('reconnecting');
    source.addEventListener('open', () => setConnection('live'));
    source.addEventListener('error', () => setConnection('reconnecting'));
    source.addEventListener('run-event', (frame) => {
      try {
        const event = decodeOperationalEvent(JSON.parse(frame.data) as unknown);
        if (event === null || event.runRef !== runRef) return;
        setEvents((current) => mergeRunEvents(current, [event]));
        setConnection('live');
      } catch {
        // Closed-shape decoding fails shut: malformed frames never enter the visible record stream.
      }
    });
    return () => source.close();
  }, [attached, makeSource, runRef]);

  return { events, connection };
}

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

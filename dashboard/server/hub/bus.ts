/**
 * In-memory event bus. It bridges Plane-A index updates (D0.2) and Plane-B tail deltas (D0.3) into
 * a single message-granular stream that the SSE and read-WS transports fan out to subscribers. It is
 * disposable and holds no state beyond its subscriber set — git stays the database.
 */
import { watchPlaneA } from '../planeA/indexer.ts';
import type { PlaneADelta } from '../planeA/indexer.ts';
import type { TranscriptRecord } from '../planeB/tailer.ts';
import { join } from 'node:path';
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';

/**
 * One message pushed to subscribers.
 * - `planeA` events carry the changed coordination slice (`kind`) and the changed path.
 * - `planeB` events carry a session `path` plus a `data` summary of the tail delta.
 */
export interface HubEvent {
  channel: 'planeA' | 'planeB' | 'control';
  kind: string;
  path?: string;
  data?: unknown;
}

export type HubListener = (event: HubEvent) => void;

export interface EventBus {
  publish(event: HubEvent): void;
  /** Subscribe; returns an idempotent unsubscribe. */
  subscribe(listener: HubListener): () => void;
  subscriberCount(): number;
}

/** Create a fresh in-memory bus. */
export function createBus(): EventBus {
  const listeners = new Set<HubListener>();
  return {
    publish(event: HubEvent): void {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // One faulty subscriber (e.g. a dropped socket mid-write) must never sink the fan-out
          // to the others, nor propagate out of publish().
        }
      }
    },
    subscribe(listener: HubListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscriberCount(): number {
      return listeners.size;
    },
  };
}

/**
 * Wire the Plane-A file-watch (D0.2) onto the bus: every incremental index delta becomes a
 * message-granular `planeA` event. Returns the underlying chokidar watcher for lifecycle control.
 * The heavy in-memory index is intentionally NOT shipped in the event (message-granular, not
 * snapshot-per-message); subscribers that need the data read it from the index.
 */
export function wirePlaneA(
  bus: EventBus,
  repoRoot: string,
  opts: { debounceMs?: number; onWatcher?: (watcher: FSWatcher) => void } = {},
): Promise<FSWatcher> {
  return watchPlaneA(
    repoRoot,
    (delta: PlaneADelta) => {
      bus.publish({ channel: 'planeA', kind: delta.kind, path: delta.path });
    },
    opts,
  );
}

/**
 * Bridge a Plane-B tail (D0.3) onto the bus as a message-granular `planeB` event. The full record
 * array is summarized to a count + resume offset so the frame stays small; the live timeline (D0.7)
 * re-tails from the offset for detail.
 */
export function publishTailDelta(
  bus: EventBus,
  args: { sessionPath: string; records: TranscriptRecord[]; nextOffset: number },
): void {
  bus.publish({
    channel: 'planeB',
    kind: 'tail',
    path: args.sessionPath,
    data: { count: args.records.length, nextOffset: args.nextOffset },
  });
}

/**
 * Signal that session-gated attempt I/O has advanced. `/events` has no session gate, so transcript
 * content deliberately stays out of this frame; consumers re-read after `seq` through the authed API.
 */
export function publishAttemptIoSignal(bus: EventBus, args: { attemptRef: string; seq: number }): void {
  bus.publish({ channel: 'control', kind: 'attempt-io', data: args });
}

/** Publish a payload-free notification that the control-plane state changed. */
export function publishControlTick(bus: EventBus): void {
  bus.publish({ channel: 'control', kind: 'store-change' });
}

/**
 * Watch the control-plane document for coarse state changes. The store has no subscription seam;
 * this intentionally reads nothing and collapses burst writes into a single trailing-edge tick.
 *
 * KNOWN AND ACCEPTED [P6 W6.3]: this watches the FILE, so the 30-s self-advertisement beat
 * (`placement/selfAdvertise.ts`) ticks every connected browser every 30 s even on a fully idle daemon —
 * a durable freshness protocol has to write. What that beat deliberately does NOT do is bump
 * `documentRevision` (see `upsertHostAdvertisement` in `control/store.ts`), so the refetches these ticks
 * provoke find unchanged entity revisions and answer 304 rather than shipping payloads. The residue is
 * idle network chatter, not idle re-rendering; removing it would need a store subscription seam able to
 * tell a liveness write from a coordinated one.
 */
export function wireControlStoreTick(
  bus: EventBus,
  stateRoot: string,
  opts: { debounceMs?: number } = {},
): Promise<FSWatcher> {
  const watcher = watch(join(stateRoot, 'control', 'control-plane.json'), {
    ignoreInitial: true,
    persistent: true,
  });
  const debounceMs = opts.debounceMs ?? 250;
  let timer: NodeJS.Timeout | undefined;
  const onEvent = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      publishControlTick(bus);
    }, debounceMs);
  };
  watcher.on('add', onEvent);
  watcher.on('change', onEvent);
  return new Promise<FSWatcher>((resolve) => {
    watcher.on('ready', () => resolve(watcher));
  });
}

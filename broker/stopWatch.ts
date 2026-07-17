/**
 * D3.3 — the Broker's ACTIVE STOP-drain: an fs-watch on the repo-root `STOP` sentinel that, the moment
 * STOP appears, drains EVERY live handle down the Q8 escalation ladder `interrupt() → SIGTERM →
 * SIGKILL`.
 *
 * DISTINCT FROM THE PREAMBLE GATE (broker/preambleGate.ts): the preamble gate refuses to START new work
 * under STOP (guarding the spawn door); THIS module tears down work that is ALREADY RUNNING when STOP
 * lands. Both are required (ordering-law 8's parenthetical: "the Broker's active STOP-watch is a
 * separate, additional mechanism that drains live handles; the law is about not starting work").
 *
 * THE LADDER (Q8, plan §D2.8): for each live handle, `interrupt()` immediately (t=0, the graceful "stop
 * this turn"), then — if the handle is STILL live after the grace window — `SIGTERM` at t=graceMs, then
 * — if STILL live after the escalation window — `SIGKILL` at t=graceMs+escalateMs. A handle that goes
 * not-live at any rung (the interrupt/term took) stops escalating: we never SIGKILL a session that
 * already exited cleanly.
 *
 * FULLY INJECTABLE TIMERS/CLOCK: `sleep(ms)` and `now()` are injected so tests advance a fake clock and
 * assert the exact (action, at-ms) sequence with no real timers and no real OS signals. The default
 * `sleep` is a real `setTimeout`; the default `now` is `Date.now`. The default `watch` is `fs.watch`.
 */
import { watch as fsWatch, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionHandle } from './index.ts';

/** The Q8 ladder timings (docs/plans/2026-07-16-dashboard-implementation.md §D2.8: 60s grace,
 *  +30s to SIGKILL). Kept in sync with `dashboard/server/stop/floor.ts`'s `Q8_GRACE_MS`/`Q8_ESCALATE_MS`. */
export const Q8_GRACE_MS = 60_000;
export const Q8_ESCALATE_MS = 30_000;

/** Injectable timer/clock so the drain is deterministic under test — no real timers, ever. */
export interface DrainDeps {
  /** Resolve after `ms` of (possibly fake) time. Default: real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Current time in ms. Default: `Date.now`. Advanced by the fake `sleep` in tests. */
  now?: () => number;
  graceMs?: number;
  escalateMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drain ONE live handle down the ladder. Returns the ordered actions taken (for tests/audit). Stops
 * early at whichever rung the handle goes not-live: an `interrupt()` that lands means no SIGTERM/SIGKILL.
 */
export async function drainHandle(
  handle: SessionHandle,
  deps: DrainDeps = {},
): Promise<Array<{ action: 'interrupt' | 'sigterm' | 'sigkill'; at: number }>> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const graceMs = deps.graceMs ?? Q8_GRACE_MS;
  const escalateMs = deps.escalateMs ?? Q8_ESCALATE_MS;
  const actions: Array<{ action: 'interrupt' | 'sigterm' | 'sigkill'; at: number }> = [];

  if (!handle.live) return actions;

  // Rung 1 — graceful interrupt, immediately.
  handle.interrupt();
  actions.push({ action: 'interrupt', at: now() });

  // Grace window, then rung 2 if still live.
  await sleep(graceMs);
  if (!handle.live) return actions;
  handle.sigterm();
  actions.push({ action: 'sigterm', at: now() });

  // Escalation window, then rung 3 if STILL live.
  await sleep(escalateMs);
  if (!handle.live) return actions;
  handle.sigkill();
  actions.push({ action: 'sigkill', at: now() });

  return actions;
}

/** Drain EVERY live handle concurrently (each on its own independent ladder). */
export async function drainAll(
  handles: SessionHandle[],
  deps: DrainDeps = {},
): Promise<Map<string, Array<{ action: 'interrupt' | 'sigterm' | 'sigkill'; at: number }>>> {
  const results = new Map<string, Array<{ action: 'interrupt' | 'sigterm' | 'sigkill'; at: number }>>();
  await Promise.all(
    handles.map(async (h) => {
      results.set(h.id, await drainHandle(h, deps));
    }),
  );
  return results;
}

/** Something that yields the current set of live handles when STOP fires — the `SessionOwner`. */
export interface LiveHandleSource {
  liveHandles(): SessionHandle[];
}

/** A minimal fs-watcher handle so tests can inject a fake watcher and fire STOP synthetically. */
export interface StopWatcher {
  close(): void;
}

/** Injectable dependencies for `watchStop`. */
export interface StopWatchDeps extends DrainDeps {
  /** Start watching `repoRoot` for the `STOP` sentinel; call `onStop` when it appears. Default: `fs.watch`. */
  startWatch?: (repoRoot: string, onStop: () => void) => StopWatcher;
  /** Test seam / re-entrancy guard: whether STOP already exists (drain immediately if so). Default: `existsSync`. */
  stopPresent?: (repoRoot: string) => boolean;
}

/** Default fs.watch-based STOP watcher: fires `onStop` when a `STOP` entry appears in `repoRoot`. */
function defaultStartWatch(repoRoot: string, onStop: () => void): StopWatcher {
  const watcher = fsWatch(repoRoot, (_event, filename) => {
    if (filename === 'STOP' && existsSync(join(repoRoot, 'STOP'))) onStop();
  });
  return { close: () => watcher.close() };
}

/**
 * Begin the active STOP-drain. The moment STOP appears (or if it is ALREADY present at start), drain
 * every live handle in `source` down the ladder. Idempotent: once a drain has been triggered, further
 * STOP events are ignored (the fleet is already being torn down). Returns the watcher so the daemon can
 * close it on shutdown.
 */
export function watchStop(repoRoot: string, source: LiveHandleSource, deps: StopWatchDeps = {}): StopWatcher {
  const startWatch = deps.startWatch ?? defaultStartWatch;
  const stopPresent = deps.stopPresent ?? ((root: string) => existsSync(join(root, 'STOP')));
  let triggered = false;

  const trigger = (): void => {
    if (triggered) return;
    triggered = true;
    // Fire-and-forget the drain; the ladder itself is awaited internally per handle.
    void drainAll(source.liveHandles(), deps);
  };

  const watcher = startWatch(repoRoot, trigger);
  // If the fleet was ALREADY frozen when the Broker (re)started, drain immediately — do not wait for a
  // future fs event that will never come for an already-present file.
  if (stopPresent(repoRoot)) trigger();
  return watcher;
}

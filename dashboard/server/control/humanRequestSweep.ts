/**
 * Boot + tick wiring for `ControlPlaneStore#closeOrphanedHumanRequests` (store.ts) — the daemon-side
 * cousin of `write/mergeGateReconciler.ts` and `write/strandedArchiver.ts`, but far lower-risk: it only
 * ever mutates the control-plane JSON document it already owns (no filesystem move, no git commit, no
 * external process), so unlike the stranded-card archiver it is ON BY DEFAULT.
 *
 * WHY THIS EXISTS: seven Human Requests sat open in the live store on 2026-08-11, five of them since
 * 2026-07-21–07-27 — every one on a run parked in `waiting-human` with a manager that never came back.
 * `transitionRun`'s inline close (store.ts) only fires on a FUTURE terminal transition; it cannot reach
 * a run that is simply never going to move again. This sweep is the other half: it re-checks the whole
 * document on an interval, so a request that outlives its run (terminal-state predicate) or just outlives
 * a generous age window (stale predicate, independent of run state) gets closed even if nothing else ever
 * touches that run again.
 */
import type { ControlPlaneStore } from './store.ts';

/** 7 days — matches the card-side stranded-archiver's default window (`write/strandedArchiver.ts`).
 *  Verified against the live zombies: the oldest still-legitimate open request was 5 days old, the
 *  newest zombie was 15 days old, so 7 days clears every zombie without touching a current ask. */
export const DEFAULT_HUMAN_REQUEST_STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface HumanRequestSweepDeps {
  store: ControlPlaneStore;
  now?: () => Date;
  staleWindowMs?: number;
  /** Structured sink for what closed this sweep — default no-op; the daemon logs from it. */
  onSweep?: (result: { closed: string[] }) => void;
}

/** One sweep, synchronous (the store's own I/O is synchronous). Never throws — a store fault is caught
 *  by the caller's tick wrapper, not here, so this stays trivially unit-testable. */
export function sweepOrphanedHumanRequests(deps: HumanRequestSweepDeps): { closed: string[] } {
  const clock = deps.now ?? (() => new Date());
  const windowMs = deps.staleWindowMs ?? DEFAULT_HUMAN_REQUEST_STALE_WINDOW_MS;
  const result = deps.store.closeOrphanedHumanRequests(clock().getTime(), windowMs);
  const closed = result.closed.map((request) => request.requestRef);
  deps.onSweep?.({ closed });
  return { closed };
}

/**
 * Start the sweeper. `intervalMs <= 0` disables it entirely (returns a no-op stop fn); otherwise it runs
 * once immediately — the pre-existing zombies must clear on the very first boot after this ships, not
 * wait for the first tick — then on the interval. Each tick is wrapped so a throw can never kill the
 * daemon; overlapping ticks are skipped; the timer is unref'd so it never keeps the process alive; the
 * returned stop fn is registered on shutdown. Fail-safe in the same direction as the merge-gate
 * reconciler: every failure here just leaves requests open, which is the pre-fix status quo.
 */
export function startHumanRequestSweeper(deps: HumanRequestSweepDeps, intervalMs: number): () => void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
  let running = false;
  const tick = (): void => {
    if (running) return; // never overlap a slow sweep with the next tick
    running = true;
    try {
      sweepOrphanedHumanRequests(deps);
    } catch {
      // swallow — a sweep throw must never crash the daemon (fail toward NOT closing)
    } finally {
      running = false;
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

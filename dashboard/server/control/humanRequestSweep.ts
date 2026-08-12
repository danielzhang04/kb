/**
 * Boot + tick wiring for `ControlPlaneStore#closeOrphanedHumanRequests` (store.ts) — the daemon-side
 * cousin of `write/mergeGateReconciler.ts` and `write/strandedArchiver.ts`, but far lower-risk: it only
 * ever mutates the control-plane JSON document it already owns (no filesystem move, no git commit, no
 * external process), so unlike the stranded-card archiver it is ON BY DEFAULT.
 *
 * WHY THIS EXISTS: seven Human Requests sat open in the live store on 2026-08-11, and the ones that were
 * genuinely dead sat on runs that had already gone terminal with a manager that never came back.
 * `transitionRun`'s inline close (store.ts) only fires on a FUTURE terminal transition; it cannot reach a
 * run that already reached one before that code shipped. This sweep is the other half: it re-checks the
 * whole document on an interval, so a request that outlives its run gets closed even if nothing else ever
 * touches that run again.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: close a request for being old. Terminal run state is the only
 * predicate (see `closeOrphanedHumanRequests`' interface doc for the irreversibility argument). A run
 * parked on a human gate for a month is waiting for the human, not orphaned.
 *
 * Every close is recorded twice beyond the request record itself: a governance event on the run's own
 * timeline (written by the store, same commit) and one audit-ledger row per request here — the same
 * `appendAuditLocal` seam the merge-gate reconciler and stranded archiver use, since a background sweep
 * has no HTTP request, no session and no ops transaction to attach a committed audit row to.
 */
import { appendAuditRowLocal } from '../audit/log.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import type { ControlPlaneStore } from './store.ts';

/** One request the sweep resolved: what closed, on which run, and the reason written onto the record. */
export interface SweptHumanRequest {
  requestRef: string;
  runRef: string;
  reason: string | null;
}

export interface HumanRequestSweepResult {
  closed: SweptHumanRequest[];
  /** Refs whose audit row could not be written. The close itself is already durable — this is the
   *  reporting failure, surfaced rather than swallowed so the daemon log can say the trail is short. */
  auditFailures: string[];
}

export interface HumanRequestSweepDeps {
  store: ControlPlaneStore;
  /** Repo root the audit ledger lives under; when absent no audit row is attempted (test/in-memory use). */
  repoRoot?: string;
  now?: () => Date;
  appendAuditLocal?: (repoRoot: string, event: AuditEvent, now?: () => Date) => AuditRow;
  /** Structured sink for what closed this sweep — default no-op; the daemon logs from it. */
  onSweep?: (result: HumanRequestSweepResult) => void;
}

/** One sweep, synchronous (the store's own I/O is synchronous). Never throws — a store fault is caught
 *  by the caller's tick wrapper, not here, so this stays trivially unit-testable. */
export function sweepOrphanedHumanRequests(deps: HumanRequestSweepDeps): HumanRequestSweepResult {
  const clock = deps.now ?? (() => new Date());
  const appendLocal = deps.appendAuditLocal ?? appendAuditRowLocal;
  const swept = deps.store.closeOrphanedHumanRequests(clock().getTime());
  const closed: SweptHumanRequest[] = swept.closed.map((request) => ({
    requestRef: request.requestRef,
    runRef: request.runRef,
    reason: request.response?.response ?? null,
  }));
  const auditFailures: string[] = [];
  for (const request of closed) {
    if (deps.repoRoot === undefined) break;
    try {
      // The store already committed. An audit-ledger fault must therefore be REPORTED, not thrown:
      // refusing here cannot undo the close, it would only also lose the report of it.
      appendLocal(deps.repoRoot, {
        action: 'control-human-request-auto-close',
        target: request.requestRef,
        riskTier: 'T2',
        result: 'auto-closed',
        detail: { requestRef: request.requestRef, runRef: request.runRef, reason: request.reason },
      }, clock);
    } catch {
      auditFailures.push(request.requestRef);
    }
  }
  const result: HumanRequestSweepResult = { closed, auditFailures };
  deps.onSweep?.(result);
  return result;
}

/**
 * Start the sweeper. `intervalMs <= 0` disables it entirely (returns a no-op stop fn); otherwise it runs
 * once immediately — the pre-existing orphans must clear on the very first boot after this ships, not
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

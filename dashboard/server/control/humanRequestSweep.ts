/**
 * Boot + tick wiring for `ControlPlaneStore#closeOrphanedHumanRequests` (store.ts) — a low-risk
 * daemon-side sweeper: it only ever mutates the control-plane JSON document it already owns (no
 * filesystem move, no git commit, no external process), so it is ON BY DEFAULT. (The old
 * `write/mergeGateReconciler.ts`/`write/strandedArchiver.ts` cousins were deleted in P4 W6.2.)
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
 * timeline (written by the store, same commit) and one audit-ledger row per request here.
 *
 * WHY THE AUDIT ROW GOES THROUGH `appendAudit` AND NOT `appendAuditRowLocal` (fix 2026-08-11): a BARE
 * local append leaves `ledgers/audit/dashboard-audit.ndjson` dirty in the shared `dashboard-ops` checkout,
 * and `prepareCoordination` (write/branch.ts) runs a plain `git pull --rebase origin ops` with NO
 * autostash — so one dirty ledger aborts EVERY subsequent coordination write in the daemon (queue-bridge
 * dispatch, stage launch, publication reconcile). The boot sweep fires on the very first boot, by design,
 * so this was not a rare path. A coordination writer that already OWNS an ops transaction may append
 * locally precisely because its commit stages `AUDIT_REL_PATH` alongside its own paths — the local append
 * and the commit sit inside the same lock. This sweep has no card mutation to commit alongside (its only mutation is the control-plane
 * JSON document it owns, which is not repo content), so there is nothing to stage with; it uses the other
 * half of the same seam instead. `appendAudit` is that half: append + `pull --rebase --autostash` + commit
 * + push, all inside ONE `withOpsTransaction` span, which is exactly the pairing audit/log.ts requires.
 * Its two non-clean exits are inherited, not introduced, and are shared with every other audit write in
 * the daemon: a repo root not checked out on `ops` keeps the row local-only behind a loud AUDIT-GIT-GUARD
 * warning, and a git failure mid-commit leaves the row uncommitted. Both are reported here as
 * `auditFailures` where they are observable.
 */
import { appendAudit as defaultAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow } from '../audit/log.ts';
import type { ControlPlaneStore } from './store.ts';

/** One request the sweep resolved: what closed, on which run, and the reason written onto the record. */
export interface SweptHumanRequest {
  requestRef: string;
  runRef: string;
  reason: string | null;
}

export interface HumanRequestSweepResult {
  closed: SweptHumanRequest[];
  /** Refs whose audit row could not be committed. The close itself is already durable — this is the
   *  reporting failure, surfaced rather than swallowed so the daemon log can say the trail is short. */
  auditFailures: string[];
}

export interface HumanRequestSweepDeps {
  store: ControlPlaneStore;
  /** Repo root the audit ledger lives under; when absent no audit row is attempted (test/in-memory use). */
  repoRoot?: string;
  now?: () => Date;
  /**
   * The append+commit-in-one-ops-transaction audit seam (audit/log.ts `appendAudit`). NOT the bare local
   * appender: see this module's header for why an uncommitted local row jams every other coordination
   * write in the shared checkout. Injected as a fake in tests so no test ever runs git.
   */
  appendAudit?: (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow | Promise<AuditRow>;
  /**
   * Extra options merged into every `appendAudit` call (same seam as `pty/route.ts`'s `auditOptions`).
   * Production leaves it undefined; the checkout-stays-clean test injects a git runner here so it can
   * exercise the REAL `appendAudit` — the wired default — without touching a network remote.
   */
  auditOptions?: AppendAuditOptions;
  /** Structured sink for what closed this sweep — default no-op; the daemon logs from it. */
  onSweep?: (result: HumanRequestSweepResult) => void;
}

/**
 * One sweep. The store's own close is synchronous and happens first; the function is async only because
 * each audit row is committed to `ops` (see the header). Never throws — a store fault is caught by the
 * caller's tick wrapper, not here, so this stays trivially unit-testable.
 */
export async function sweepOrphanedHumanRequests(deps: HumanRequestSweepDeps): Promise<HumanRequestSweepResult> {
  const clock = deps.now ?? (() => new Date());
  const append = deps.appendAudit ?? defaultAppendAudit;
  const swept = deps.store.closeOrphanedHumanRequests(clock().getTime());
  const closed: SweptHumanRequest[] = swept.closed.map((request) => ({
    requestRef: request.requestRef,
    runRef: request.runRef,
    reason: request.response?.response ?? null,
  }));
  const auditFailures: string[] = [];
  // Loop-invariant, so it is decided ONCE here rather than re-tested per request: with no repo root there
  // is no ledger to write to at all (in-memory/test wiring), and the closes still stand on their own.
  const repoRoot = deps.repoRoot;
  if (repoRoot !== undefined) {
    for (const request of closed) {
      try {
        // The store already committed. An audit-ledger fault must therefore be REPORTED, not thrown:
        // refusing here cannot undo the close, it would only also lose the report of it. Awaited one at a
        // time — `appendAudit` serializes on the ops lock anyway, and a rejected push must be attributable
        // to the request that caused it.
        await append(repoRoot, {
          action: 'control-human-request-auto-close',
          target: request.requestRef,
          riskTier: 'T2',
          result: 'auto-closed',
          detail: { requestRef: request.requestRef, runRef: request.runRef, reason: request.reason },
        }, {
          now: clock,
          message: `chore(audit): auto-close human request ${request.requestRef}`,
          ...deps.auditOptions,
        });
      } catch {
        auditFailures.push(request.requestRef);
      }
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
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap a slow sweep with the next tick
    running = true;
    try {
      await sweepOrphanedHumanRequests(deps);
    } catch {
      // swallow — a sweep throw must never crash the daemon (fail toward NOT closing)
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

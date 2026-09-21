/**
 * The daemon's OWN schedule tick — review finding B-1's replacement for the withdrawn
 * `kb-dispatch.timer` systemd design.
 *
 * WHY THE SYSTEMD DESIGN WAS WITHDRAWN: `scripts/dispatch.py` writes queue cards (`cards.save`) and
 * ledger rows (`ledger.append`) as bare filesystem writes — no commit step, no awareness of
 * `KB_COORDINATION_PUBLICATION`. On the VM, where the ops checkout's origin is `disabled://`, a bare
 * write leaves an UNTRACKED file that no outbox bundle carries and that
 * `deploy/apply_ops_reconciliation.py`'s dirty-checkout guard refuses to drain past — freezing EVERY
 * later coordination write until a human cleans it up (`control/queueBridge.ts`'s
 * `publishBridgeWakeCard` header documents the identical failure mode for `agent_runner.py#wake_me`,
 * fixed there the same way this module fixes it here). A systemd timer invoking `dispatch.py`
 * unattended every 5 minutes would have hit that on its very first due tick.
 *
 * THE FIX: the daemon ticks ITSELF, inside `withOpsTransaction` (so no other in-process coordination
 * writer can observe the bare-file window), reusing `scripts/dispatch.py` as a subprocess for the
 * cron/claim logic (never reimplemented here) and then committing exactly the paths it wrote through
 * `commitPreparedCoordination` — the SAME governed writer `publishBridgeWakeCard` uses, with the SAME
 * asymmetric failure handling: a failure BEFORE the commit lands must not leave a dirty checkout
 * (clean it, log, let the next tick retry); a failure AFTER the commit lands (a spool/push step) must
 * never delete a now-tracked file, only report loudly.
 *
 * SCOPE GUARD: `dispatch.py` (via `dispatch_stored_schedules` + `release_dependents`) is only ever
 * supposed to write under `queue/` and `ledgers/dispatch/`. This module re-derives the actual changed
 * path set from `git status` after every subprocess run and REFUSES (reverting everything back to a
 * clean checkout) if any other path changed — a defensive check against a `dispatch.py` bug or a
 * concurrent out-of-band write, not an expected case in normal operation.
 *
 * Runs only when `KB_COORDINATION_PUBLICATION === 'outbox'` (the VM); disabled on desktop/dev by
 * construction (see `resolveScheduleTickIntervalMs` in `server/index.ts`, which is where this module's
 * interval-resolution env var lives, matching the sibling resolvers for the merge-poll and human-request
 * sweep timers).
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { AsyncGitError, runTrackedProcess, withOpsTransaction } from '../write/asyncGit.ts';
import { commitPreparedCoordination, defaultGitRunner, type GitRunner } from '../write/branch.ts';
import type { CoordinationPublication } from '../write/outbox.ts';
import { defaultPlatformRoot, resolvePython } from '../runtime/python.ts';

/** One raw `git status --porcelain=v1 -z` entry: its two-letter status code and its path. */
interface StatusEntry {
  code: string;
  path: string;
}

/** The only two path prefixes `scripts/dispatch.py` (`dispatch_stored_schedules` +
 *  `release_dependents`) is allowed to have touched: queue cards and dispatch-ledger rows. */
const EXPECTED_TICK_PREFIXES = ['queue/', 'ledgers/dispatch/'] as const;

function normalizeTickPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function isExpectedTickPath(path: string): boolean {
  const norm = normalizeTickPath(path);
  return EXPECTED_TICK_PREFIXES.some((prefix) => norm.startsWith(prefix));
}

/**
 * Parse a `git status --porcelain=v1 -z` payload. `-z` NUL-delimits records and — critically —
 * leaves paths unquoted, but a rename/copy record (`R`/`C`) emits its ORIGINAL path as a second,
 * bare (no `XY `-prefixed) NUL-terminated field immediately after. `dispatch.py` never renames
 * anything it writes, so this is not an expected shape here; a field that does not parse as an
 * `XY path` record is folded in verbatim as its own entry with an unrecognized "??" code, which
 * `isExpectedTickPath` will almost certainly reject — failing this tick closed rather than silently
 * mis-parsing a rename into something that looks safe.
 */
function parsePorcelainZ(raw: string): StatusEntry[] {
  const fields = raw.split('\0').filter((field) => field.length > 0);
  const entries: StatusEntry[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]!;
    if (/^[ MADRCU?!]{2} /.test(field)) {
      const code = field.slice(0, 2);
      entries.push({ code, path: field.slice(3) });
      // A rename/copy record's original path rides the NEXT NUL-terminated field with no status
      // prefix of its own; fold it in as a foreign-shaped entry so the tick refuses rather than
      // silently dropping it.
      if ((code[0] === 'R' || code[0] === 'C') && i + 1 < fields.length) {
        i += 1;
        entries.push({ code: '??', path: fields[i]! });
      }
    } else {
      entries.push({ code: '??', path: field });
    }
  }
  return entries;
}

/** Revert every entry in `entries` back to a clean checkout: `git checkout --` for a tracked
 *  (non-`?`-status) path, delete for an untracked one. Best-effort per path — one failure must not
 *  stop the rest from being cleaned, and there is nothing safer left to do if a delete itself fails. */
async function revertTickPaths(repoRoot: string, runGit: GitRunner, entries: readonly StatusEntry[]): Promise<void> {
  const tracked = entries.filter((entry) => !entry.code.includes('?')).map((entry) => entry.path);
  const untracked = entries.filter((entry) => entry.code.includes('?')).map((entry) => entry.path);
  if (tracked.length > 0) {
    try { await runGit(repoRoot, ['checkout', '--', ...tracked]); } catch { /* best effort */ }
  }
  for (const path of untracked) {
    try { rmSync(join(repoRoot, path), { force: true }); } catch { /* best effort */ }
  }
}

export interface DispatchSubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ScheduleTickDeps {
  /** The ops checkout `scripts/dispatch.py` writes into and this tick commits from. */
  repoRoot: string;
  runGit?: GitRunner;
  /** Runs `scripts/dispatch.py --tier cloud --agent dispatcher-cloud`. Injected in tests so no test
   *  ever spawns a real interpreter; production default spawns it for real (see {@link defaultRunDispatch}). */
  runDispatch?: (repoRoot: string) => Promise<DispatchSubprocessResult>;
  publication?: CoordinationPublication;
  outboxRoot?: string;
}

export interface ScheduleTickOutcome {
  /** Occurrences `dispatch.py` reported as due-and-processed this tick (parsed from its own
   *  "dispatched N card(s)" stdout line — every entry `dispatch_stored_schedules` returns was both
   *  due and claimed in the same call, so `dispatch.py` has no separate "due" count to report). */
  due: number;
  dispatched: number;
  /** The exact relpaths committed (or attempted) this tick; empty when nothing changed, refused, or
   *  cleanly reverted. */
  paths: string[];
  /** The coordination commit sha, or `null` when nothing was committed this tick. */
  committed: string | null;
  /** True when a path outside `queue/**`/`ledgers/dispatch/**` was found and the whole tick's writes
   *  were reverted rather than committed. */
  refused: boolean;
  error: string | null;
}

/** Resolves `python3 -B <releaseRoot>/scripts/dispatch.py --tier cloud --agent dispatcher-cloud`,
 *  cwd = the ops checkout, and shells it through the shared async/tracked runner (off the event loop,
 *  killable on daemon shutdown, hard timeout) — never `execFileSync`. `releaseRoot` is
 *  `defaultPlatformRoot()`, the SAME `DASHBOARD_PLATFORM_ROOT`-driven resolution every other python
 *  shell-out in this codebase uses (`createPythonScheduleClaimRenderer`, `runPythonSync`); on the VM
 *  unit `DASHBOARD_PLATFORM_ROOT=/opt/kb-releases/current` (`deploy/systemd/kb-dashboard.service`), so
 *  this resolves to exactly the release-pinned path the withdrawn systemd unit hardcoded. */
const defaultRunDispatch: NonNullable<ScheduleTickDeps['runDispatch']> = async (repoRoot) => {
  const python = resolvePython();
  const script = join(defaultPlatformRoot(), 'scripts', 'dispatch.py');
  const argv = [...python.prefixArgs, '-B', script, '--tier', 'cloud', '--agent', 'dispatcher-cloud'];
  try {
    const stdout = await runTrackedProcess(python.command, argv, repoRoot, 'dispatch.py', { timeoutMs: 120_000 });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    if (error instanceof AsyncGitError) return { exitCode: error.status ?? 1, stdout: error.stdout, stderr: error.stderr };
    return { exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
};

const DISPATCHED_COUNT = /^dispatched (\d+) card/m;

/**
 * One schedule tick, in full: run `dispatch.py`, re-derive what it wrote from `git status`, refuse
 * (and revert everything) if anything outside `queue/**`/`ledgers/dispatch/**` changed, and otherwise
 * commit exactly that path set through the same governed writer `publishBridgeWakeCard` uses. Never
 * throws — every failure mode is folded into the returned outcome's `error` field so a caller (the
 * interval wrapper below) can log it without a try/catch of its own.
 */
export async function runScheduleTick(deps: ScheduleTickDeps): Promise<ScheduleTickOutcome> {
  const runGit = deps.runGit ?? defaultGitRunner;
  const runDispatch = deps.runDispatch ?? defaultRunDispatch;
  const publication = deps.publication ?? 'direct';
  return withOpsTransaction(async (): Promise<ScheduleTickOutcome> => {
    const dispatchResult = await runDispatch(deps.repoRoot);
    const countMatch = DISPATCHED_COUNT.exec(dispatchResult.stdout);
    const dispatched = countMatch ? Number(countMatch[1]) : 0;
    const dispatchError = dispatchResult.exitCode !== 0
      ? `dispatch.py exited ${dispatchResult.exitCode}: ${(dispatchResult.stderr.trim() || dispatchResult.stdout.trim()).slice(0, 500)}`
      : null;

    let entries: StatusEntry[];
    try {
      const raw = await runGit(deps.repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
      entries = parsePorcelainZ(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const msg = `schedule tick could not read checkout status: ${detail}`;
      return { due: dispatched, dispatched, paths: [], committed: null, refused: false, error: dispatchError ? `${dispatchError}; ${msg}` : msg };
    }

    if (entries.length === 0) {
      return { due: dispatched, dispatched, paths: [], committed: null, refused: false, error: dispatchError };
    }

    const foreign = entries.filter((entry) => !isExpectedTickPath(entry.path));
    if (foreign.length > 0) {
      await revertTickPaths(deps.repoRoot, runGit, entries);
      const msg = `schedule tick refused: unexpected path(s) changed outside queue/**, ledgers/dispatch/**` +
        ` (reverted): ${foreign.map((entry) => entry.path).join(', ')}`;
      return { due: dispatched, dispatched, paths: [], committed: null, refused: true, error: dispatchError ? `${dispatchError}; ${msg}` : msg };
    }

    const paths = entries.map((entry) => entry.path);
    let beforeHead: string;
    try {
      beforeHead = (await runGit(deps.repoRoot, ['rev-parse', 'HEAD'])).trim();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const msg = `schedule tick could not read HEAD before committing; left uncommitted for the next tick: ${detail}`;
      return { due: dispatched, dispatched, paths: [], committed: null, refused: false, error: dispatchError ? `${dispatchError}; ${msg}` : msg };
    }

    try {
      const message = `chore(dispatch): schedule tick — ${dispatched} card(s), ${paths.length} path(s)`;
      const head = await commitPreparedCoordination(deps.repoRoot, paths[0]!, {
        runGit,
        alsoStage: paths.slice(1),
        message,
        publication,
        outboxRoot: deps.outboxRoot,
      });
      const committed = publication === 'outbox' ? head : (await runGit(deps.repoRoot, ['rev-parse', 'HEAD'])).trim();
      return { due: dispatched, dispatched, paths, committed, refused: false, error: dispatchError };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Re-read HEAD to decide which side of the commit boundary the failure landed on — the SAME
      // asymmetry `publishBridgeWakeCard` applies via its `isStillUntracked` check, generalized here
      // to a multi-path commit: a HEAD that has NOT moved means the commit never landed (safe to
      // clean up); a HEAD that HAS moved means it did (never delete a now-tracked path).
      let afterHead: string | null = null;
      try {
        afterHead = (await runGit(deps.repoRoot, ['rev-parse', 'HEAD'])).trim();
      } catch { afterHead = null; }
      const landed = afterHead !== null && afterHead !== beforeHead;
      if (!landed) {
        try { await runGit(deps.repoRoot, ['reset', 'HEAD', '--']); } catch { /* best effort */ }
        await revertTickPaths(deps.repoRoot, runGit, entries);
        const msg = `schedule tick commit failed and was reverted (nothing left uncommitted): ${detail}`;
        return { due: dispatched, dispatched, paths: [], committed: null, refused: false, error: dispatchError ? `${dispatchError}; ${msg}` : msg };
      }
      const msg = `schedule tick COMMITTED but its publication failed; the commit was left in place: ${detail}`;
      return { due: dispatched, dispatched, paths, committed: afterHead, refused: false, error: dispatchError ? `${dispatchError}; ${msg}` : msg };
    }
  });
}

/** One journal line per tick, in the format the runbook documents:
 *  `schedule-tick: due=<n> dispatched=<n> paths=<n> committed=<sha|none>`. Errors are a second line
 *  (or `null` when the tick was clean) so a `journalctl | grep schedule-tick` operator sees the summary
 *  line even on a tick that also logged a failure. */
export function scheduleTickLogLine(outcome: ScheduleTickOutcome): string {
  return `schedule-tick: due=${outcome.due} dispatched=${outcome.dispatched} paths=${outcome.paths.length}`
    + ` committed=${outcome.committed ?? 'none'}`;
}

/**
 * Start the interval driver. `intervalMs <= 0` disables it entirely (returns a no-op stop fn) — the
 * caller (`server/index.ts`'s `resolveScheduleTickIntervalMs`) is what pins that to "outbox mode only",
 * so this function itself has no publication-mode opinion. Unlike `startHumanRequestSweeper` this does
 * NOT fire immediately on start: schedule occurrences are `dispatch.py`'s own concern and its next
 * natural tick (at most `intervalMs` away) is not urgent the way a boot-time orphan sweep is, and firing
 * immediately on every daemon restart would tick more often than the interval implies on a
 * frequently-restarting daemon. Overlapping ticks are skipped (in-process flag — the ops-transaction
 * lock would also serialize them, but skipping avoids queuing a redundant subprocess spawn behind a
 * slow one); a throwing tick can never crash the daemon; the timer is unref'd so it never keeps the
 * process alive; the returned stop fn is registered on shutdown.
 */
export function startScheduleTick(
  deps: ScheduleTickDeps,
  intervalMs: number,
  onTick?: (outcome: ScheduleTickOutcome) => void,
): () => void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap a slow tick with the next one
    running = true;
    try {
      const outcome = await runScheduleTick(deps);
      onTick?.(outcome);
    } catch (error) {
      onTick?.({
        due: 0, dispatched: 0, paths: [], committed: null, refused: false,
        error: `schedule tick threw: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

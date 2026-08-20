/**
 * D3.3 — the Broker's preamble/STOP gate, run before EVERY `spawnSession`.
 *
 * A byte-for-byte MIRROR of `dashboard/server/write/preambleGate.ts` (D2.6): the same injectable
 * `PreambleRunner` DI shape, the same `PREAMBLE OK` / `PREAMBLE FAIL: <a>; <b>` stdout contract, the
 * same fail-closed parsing. It is duplicated here rather than imported so `broker/` stays a
 * self-contained unit that does not reach across into the dashboard's write-surface module graph for a
 * gate this critical — but the LOGIC is identical, and both mirror the single source of truth,
 * `scripts/preamble.py`, by shelling it (never re-deriving STOP / `ANTHROPIC_API_KEY` / budget checks
 * in TypeScript, which could drift out of sync with `scripts/preamble.py` + `scripts/ledger.py`).
 *
 * ORDERING-LAW 8 (docs/plans/2026-07-16-dashboard-implementation.md): "STOP / preamble before any
 * spawn or launch." This gate enforces *whether the fleet may START new work* — a STOP-frozen fleet,
 * a set `ANTHROPIC_API_KEY` (would silently bill the API; subscription-billing only per CLAUDE.md), or
 * a breached daily budget all refuse identically here. It is DISTINCT from `broker/stopWatch.ts`, which
 * DRAINS already-running handles when STOP appears; this one guards the door against new spawns.
 */
import { execFileSync } from 'node:child_process';
import { resolvePython } from '../dashboard/server/runtime/python.ts';

/** Raw result of one preamble-check subprocess run. */
export interface PreambleRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `scripts/preamble.py` under `repoRoot` and returns its exit code + stdio. Injected for tests. */
export type PreambleRunner = (repoRoot: string) => PreambleRunResult;

/** Default runner: shells the configured Python interpreter (the fleet's single source of truth). */
export const defaultPreambleRunner: PreambleRunner = (repoRoot) => {
  try {
    const python = resolvePython();
    const stdout = execFileSync(python.command, [...python.prefixArgs, 'scripts/preamble.py'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
    };
  }
};

export type FleetRunnableResult =
  | { ok: true; problems: [] }
  | { ok: false; problems: string[] };

const FAIL_PREFIX = 'PREAMBLE FAIL: ';

/**
 * STOP absent + `ANTHROPIC_API_KEY` unset + budget-OK — mirroring `scripts/preamble.py check()`
 * exactly (that IS the check; this just shells it and parses the verdict). `ok: false` on ANY problem.
 * Must be called, and must return `ok: true`, before a single Broker session is spawned.
 *
 * The raw `PREAMBLE FAIL: ...` tail is kept as one opaque message (never split on `"; "`, because one
 * of preamble.py's own problem strings embeds a literal `"; "`, making a naive split unreliable — an
 * upstream ambiguity out of scope to fix here since `scripts/**` is not edited by this task). Only `ok`
 * is load-bearing for gating; `problems` is informational.
 */
export function assertFleetRunnable(
  repoRoot: string,
  runPreamble: PreambleRunner = defaultPreambleRunner,
): FleetRunnableResult {
  const result = runPreamble(repoRoot);
  if (result.exitCode === 0) {
    return { ok: true, problems: [] };
  }
  const failLine = result.stdout.split('\n').find((line) => line.startsWith(FAIL_PREFIX));
  const message = failLine
    ? failLine.slice(FAIL_PREFIX.length)
    : result.stderr.trim() || result.stdout.trim() || `scripts/preamble.py exited ${result.exitCode}`;
  return { ok: false, problems: [message] };
}

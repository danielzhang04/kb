/**
 * D2.6 — the preamble gate every governed dashboard write must clear FIRST, before any
 * WebAuthn-session check: CLAUDE.md's shared preamble ("run before ANY loop or task"), mirrored here
 * so a frozen/ungoverned fleet can never be dispatched INTO by the dashboard.
 *
 * `assertFleetRunnable()` is exported under this exact name because D2.7 (the vibe-code chat box —
 * an RCE-equivalent live-prompt spawn) imports it verbatim as its own first gate.
 *
 * Rather than re-deriving STOP/`ANTHROPIC_API_KEY`/budget checks in TypeScript (a second copy of
 * `scripts/preamble.py`'s logic that could drift out of sync with the single source of truth,
 * including the budget-ledger arithmetic in `scripts/ledger.py`), this shells the real
 * `py -3 scripts/preamble.py` and parses its `PREAMBLE OK` / `PREAMBLE FAIL: <a>; <b>` stdout
 * contract (see scripts/preamble.py's `main()`). The subprocess call is an injectable `PreambleRunner`
 * — same shape/rationale as `OpsGitRunner` elsewhere in this codebase (dashboard/server/audit/log.ts,
 * dashboard/server/trace/commit.ts) — so every test here is hermetic: no real STOP file, env var, or
 * budget ledger state is ever touched by the test suite.
 */
import { execFileSync } from 'node:child_process';

/** Raw result of one preamble-check subprocess run. */
export interface PreambleRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `scripts/preamble.py` under `repoRoot` and returns its exit code + stdio. Injected for tests. */
export type PreambleRunner = (repoRoot: string) => PreambleRunResult;

/** Default runner: shells the real `py -3 scripts/preamble.py` (the fleet's single source of truth). */
export const defaultPreambleRunner: PreambleRunner = (repoRoot) => {
  try {
    const stdout = execFileSync('py', ['-3', 'scripts/preamble.py'], {
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
 * exactly (that IS the check; this just shells it and parses the verdict). `ok: false` on ANY
 * problem — a frozen fleet, a set API key, or a breached budget all refuse identically at this gate.
 * Must be called, and must return `ok: true`, before a single byte of a governed write happens.
 *
 * `problems` deliberately does NOT attempt to split `scripts/preamble.py`'s `"; ".join(problems)`
 * line back into individual entries: one of its own problem strings — "ANTHROPIC_API_KEY is set —
 * would silently bill to API; unset it" — embeds a literal `"; "`, so a naive split on that separator
 * cannot reliably recover the original boundaries when multiple problems are present (this is an
 * upstream ambiguity in `scripts/preamble.py`'s output format, out of scope to fix here — `scripts/**`
 * is not edited by this task). The raw tail is kept as a single opaque message instead, which is
 * always correct; only `ok` is load-bearing for gating, `problems` is informational.
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

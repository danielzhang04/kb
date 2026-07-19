/**
 * #4 Daemon — the ONE shared asynchronous process runner for every coordination git (and `gh pr
 * create`) invocation the governed-write surface makes.
 *
 * The Fastify daemon is a single process. Before this module every coordination write shelled git
 * through `execFileSync` — an UNBOUNDED, synchronous, network-capable call ON THE EVENT LOOP. One
 * governed write chains up to eight of those (pull --rebase / add / commit / push, plus failure-path
 * fetch / merge-base / reset), so a single stalled `push origin ops` froze the entire daemon
 * (observed in production). This runner moves that work off the event loop with `spawn` and adds a
 * hard elapsed-time timeout that KILLS the child, so a hung remote can never wedge the loop again.
 *
 * Behavioural parity with the retired sync runners is deliberate and load-bearing:
 *   - env: inherited from `process.env` verbatim (spawn's default) — NEVER an added credential. The
 *     sync runners passed no `env`, so `execFileSync` inherited the whole environment; this matches.
 *   - `cwd: repoRoot` — mirrors the sync runners' `cwd` exactly (no `-C` rewriting).
 *   - stdout returned as a UTF-8 string (the sync runners used `encoding: 'utf-8'`).
 *   - a non-zero exit REJECTS with an Error that carries `.status` (the exit code), `.stdout`, and
 *     `.stderr`, exactly like the object `execFileSync` throws — `write/cardRouting.ts` branches on
 *     `err.status === 1` (git `merge-base --is-ancestor` "not an ancestor"), so preserving that shape
 *     keeps its publication-verification logic identical.
 *
 * Strip-only floor: no TS parameter properties / enums / namespaces (Node runs this `.ts` directly
 * under `--experimental-strip-types`).
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/**
 * A git invocation runner. `args` is the full argv AFTER `git`. Widened to allow a `Promise` so the
 * async default coexists with the synchronous recording fakes every gate test injects. Unified here so
 * `audit/log.ts`, `stop/floor.ts`, and `trace/commit.ts` share ONE type instead of three identical
 * local copies. (`write/branch.ts` keeps a `GitRunner` alias of the same shape for its PR-opener pairing.)
 */
export type OpsGitRunner = (repoRoot: string, args: string[]) => string | Promise<string>;

/** A PR-open request: reviewed by a human, never auto-merged by the governed-save path itself. */
export interface AsyncPrRequest {
  base: string;
  head: string;
  title: string;
  body?: string;
}

/** Opens a PR (a distinct capability from {@link OpsGitRunner}). Widened to allow a `Promise`. */
export type AsyncPrOpener = (repoRoot: string, req: AsyncPrRequest) => void | Promise<void>;

/** An error from a failed async subprocess, shaped like the object `execFileSync` throws. */
export class AsyncGitError extends Error {
  status: number | null;
  stdout: string;
  stderr: string;
  constructor(message: string, status: number | null, stdout: string, stderr: string) {
    super(message);
    this.name = 'AsyncGitError';
    this.status = status;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export interface AsyncGitOptions {
  /** Hard wall-clock cap; on expiry the child is killed and the call rejects. Default 60_000ms. */
  timeoutMs?: number;
  /** Output byte cap (stdout+stderr); on overflow the child is killed and the call rejects. Default 64 MiB. */
  maxOutputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

// Single-process daemon: track every live child so Fastify/PM2 shutdown can terminate an in-flight
// (possibly network-stalled) git/gh before the process exits — the same drain discipline the vibe
// spawner uses for `claude` children.
const liveChildren = new Set<ChildProcess>();

/** Kill every in-flight async git/gh child during daemon shutdown. Returns the number signalled. */
export function drainAsyncGit(): number {
  const active = [...liveChildren];
  for (const child of active) {
    liveChildren.delete(child);
    try {
      child.kill('SIGKILL');
    } catch {
      /* best-effort drain; shutdown must continue through every child */
    }
  }
  return active.length;
}

/** The first non-option token of an argv, for a legible timeout/failure message (e.g. `push`). */
function subcommandLabel(args: readonly string[]): string {
  for (const arg of args) {
    if (!arg.startsWith('-')) return arg;
  }
  return args[0] ?? '(none)';
}

/**
 * Spawn `bin argv` under `cwd`, register it in the drain set, and resolve its stdout (UTF-8). Rejects
 * on non-zero exit (with the execFileSync-shaped {@link AsyncGitError}), on the output cap being
 * exceeded, on spawn error, or on the hard timeout — in the last three cases the child is killed first.
 * Exported so the timeout/drain behaviour can be exercised deterministically against any binary.
 */
export function runTrackedProcess(
  bin: string,
  argv: readonly string[],
  cwd: string,
  label: string,
  options: AsyncGitOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(bin, [...argv], {
      cwd,
      // Inherit the parent environment verbatim (matches the retired execFileSync runners). No
      // credential is ever added here — the ops push relies on ambient runtime credentials only.
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    liveChildren.add(child);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let total = 0;
    let settled = false;
    let timedOut = false;
    let exceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* the child may already be gone; the reject below still fires on close/error */
      }
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      liveChildren.delete(child);
      fn();
    };

    const collect = (target: Buffer[]) => (chunk: Buffer): void => {
      total += chunk.length;
      if (total > maxOutputBytes) {
        exceeded = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* fall through to the close/error handler */
        }
        return;
      }
      target.push(chunk);
    };

    child.stdout?.on('data', collect(stdout));
    child.stderr?.on('data', collect(stderr));

    child.once('error', (err) => {
      finish(() => reject(new AsyncGitError(
        `${bin} ${label} failed to spawn: ${err.message}`,
        null,
        Buffer.concat(stdout).toString('utf8'),
        Buffer.concat(stderr).toString('utf8'),
      )));
    });

    child.once('close', (code) => {
      finish(() => {
        const outText = Buffer.concat(stdout).toString('utf8');
        const errText = Buffer.concat(stderr).toString('utf8');
        if (timedOut) {
          return reject(new AsyncGitError(
            `${bin} ${label} timed out after ${timeoutMs}ms and was killed`,
            code,
            outText,
            errText,
          ));
        }
        if (exceeded) {
          return reject(new AsyncGitError(`${bin} ${label} output exceeded the ${maxOutputBytes}-byte limit`, code, outText, errText));
        }
        if (code === 0) return resolvePromise(outText);
        return reject(new AsyncGitError(
          `${bin} ${label} exited with code ${code ?? 'null'}: ${errText.slice(0, 512)}`,
          code,
          outText,
          errText,
        ));
      });
    });
  });
}

/**
 * The shared async git runner. Shells `git -c commit.gpgsign=false <args>` under `repoRoot` (gpg
 * signing off; the repo's active pre-commit hook still runs — `--no-verify` is never passed). This is
 * the single default behind every coordination-write module's `defaultOpsGitRunner`/`defaultGitRunner`.
 */
export function createAsyncGitRunner(options: AsyncGitOptions = {}): OpsGitRunner {
  return (repoRoot, args) =>
    runTrackedProcess('git', ['-c', 'commit.gpgsign=false', ...args], repoRoot, subcommandLabel(args), options);
}

/**
 * The shared async PR opener. Shells the `gh` CLI (`gh pr create ...`). Never invoked for coordination
 * writes — durable content reaches `main` only through this reviewed PR.
 */
export function createAsyncPrOpener(options: AsyncGitOptions = {}): AsyncPrOpener {
  return async (repoRoot, req) => {
    const args = ['pr', 'create', '--base', req.base, '--head', req.head, '--title', req.title];
    if (req.body) args.push('--body', req.body);
    await runTrackedProcess('gh', args, repoRoot, 'pr create', options);
  };
}

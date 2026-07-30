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
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The single-writer discipline the synchronous runners provided BY ACCIDENT: `execFileSync` blocked the
 * event loop for a whole pull-rebase → mutate → commit → push transaction, so two governed writes could
 * never interleave on the ops checkout. The async conversion removed that accidental serialization —
 * request A's half-open span (dirty working tree / staged paths) made request B's `pull --rebase` or
 * clean-index guard fail (observed live as a PTY `audit-failed`). Every ops-checkout git TRANSACTION must
 * therefore run under this in-process FIFO lock.
 *
 * REENTRANT by AsyncLocalStorage: control-plane routes legitimately run a nested audit transaction inside
 * an open prepare→commit span; a nested `withOpsTransaction` joins the held lock instead of deadlocking.
 * Cross-PROCESS writers (fleet runners in their own checkouts) are unaffected — their races surface as
 * push rejections, which the existing pull-reconcile-retry loops already handle.
 */
const opsTransactionContext = new AsyncLocalStorage<true>();
let opsTransactionQueue: Promise<void> = Promise.resolve();

export function withOpsTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (opsTransactionContext.getStore()) return fn();
  let release!: () => void;
  const previous = opsTransactionQueue;
  opsTransactionQueue = new Promise<void>((resolve) => { release = resolve; });
  return (async () => {
    await previous;
    try {
      return await opsTransactionContext.run(true, fn);
    } finally {
      release();
    }
  })();
}

/** True while the caller is inside a {@link withOpsTransaction} span. */
export function insideOpsTransaction(): boolean {
  return opsTransactionContext.getStore() === true;
}

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

/** Honest metadata returned by a PR opener when the provider reports it. */
export interface AsyncPrResult {
  url?: string;
  number?: number;
}

/** Opens a PR (a distinct capability from {@link OpsGitRunner}). Widened to allow a `Promise`. */
export type AsyncPrOpener = (repoRoot: string, req: AsyncPrRequest) => AsyncPrResult | void | Promise<AsyncPrResult | void>;

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
  /**
   * STRUCTURAL ENFORCEMENT of the single-writer discipline: when true, the runner throws unless the
   * caller is inside a {@link withOpsTransaction} span. Every write-capable default runner sets this,
   * so future code cannot reintroduce unserialized ops-checkout git — it fails loudly in its OWN tests
   * and on first boot instead of intermittently in production. Read-only runners stay unrestricted.
   */
  requireTransaction?: boolean;
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

/** Cap for {@link resolveCheckedOutBranch} — a local, read-only ref lookup must never sit anywhere
 *  near the 60s default git-network timeout; if it doesn't answer almost immediately, something is
 *  already wrong and the caller should fail closed rather than wait. */
const BRANCH_RESOLVE_TIMEOUT_MS = 5_000;

/**
 * Read-only: resolve the branch currently checked out at `repoRoot`, or `null` if it cannot be
 * determined for ANY reason — detached HEAD, `repoRoot` is not a git repository, `repoRoot` doesn't
 * exist, or the git invocation itself errors or times out. Every failure mode collapses to `null` so
 * callers can fail closed uniformly instead of branching on error shape.
 *
 * Deliberately shells `git symbolic-ref --short HEAD` directly via {@link runTrackedProcess} — NOT
 * through an {@link OpsGitRunner} — so this check never touches the injectable seam a caller uses for
 * its mutating git calls. That separation is load-bearing for tests: a test can assert "the (mutating)
 * git runner was never invoked" for a non-`ops` repo root while this resolution still runs for real
 * against a real repo root the test constructs (per this repo's convention of controlling test state via
 * real fixtures rather than backdoor seams). `symbolic-ref` (unlike `rev-parse --abbrev-ref`, which
 * prints the literal string `HEAD` when detached) simply fails on a detached HEAD, which the catch below
 * turns into `null` — a detached HEAD can never be misread as a branch name.
 */
export async function resolveCheckedOutBranch(repoRoot: string): Promise<string | null> {
  try {
    const out = await runTrackedProcess(
      'git',
      ['symbolic-ref', '--short', 'HEAD'],
      repoRoot,
      'symbolic-ref',
      { timeoutMs: BRANCH_RESOLVE_TIMEOUT_MS },
    );
    const branch = out.trim();
    return branch.length > 0 ? branch : null;
  } catch {
    // Not a git repo, repoRoot doesn't exist, detached HEAD, git missing/erroring, or the timeout above
    // — all of it is "cannot confirm this is ops", so all of it is null. Never let a resolution error
    // propagate to the caller as anything other than "unresolved".
    return null;
  }
}

/**
 * The shared async git runner. Shells `git -c commit.gpgsign=false <args>` under `repoRoot` (gpg
 * signing off; the repo's active pre-commit hook still runs — `--no-verify` is never passed). This is
 * the single default behind every coordination-write module's `defaultOpsGitRunner`/`defaultGitRunner`.
 */
export function createAsyncGitRunner(options: AsyncGitOptions = {}): OpsGitRunner {
  return (repoRoot, args) => {
    if (options.requireTransaction && !insideOpsTransaction()) {
      return Promise.reject(new Error(
        `ops git '${subcommandLabel(args)}' invoked outside withOpsTransaction — wrap the whole prepare/mutate/commit span`,
      ));
    }
    return runTrackedProcess('git', ['-c', 'commit.gpgsign=false', ...args], repoRoot, subcommandLabel(args), options);
  };
}

/**
 * The shared async PR opener. Shells the `gh` CLI (`gh pr create ...`). Never invoked for coordination
 * writes — durable content reaches `main` only through this reviewed PR.
 */
export function createAsyncPrOpener(options: AsyncGitOptions = {}): AsyncPrOpener {
  return async (repoRoot, req) => {
    if (options.requireTransaction && !insideOpsTransaction()) {
      throw new Error('gh pr create invoked outside withOpsTransaction — wrap the whole durable-save span');
    }
    const args = ['pr', 'create', '--base', req.base, '--head', req.head, '--title', req.title];
    if (req.body) args.push('--body', req.body);
    const output = await runTrackedProcess('gh', args, repoRoot, 'pr create', options);
    const url = output.trim().split(/\r?\n/).find((line) => /^https:\/\//.test(line.trim()))?.trim();
    const number = url ? /\/pull\/(\d+)(?:$|[?#])/.exec(url)?.[1] : undefined;
    return { ...(url ? { url } : {}), ...(number ? { number: Number(number) } : {}) };
  };
}

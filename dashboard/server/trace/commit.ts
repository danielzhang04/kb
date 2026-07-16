/**
 * D0.8 — writing & committing distilled trace permalinks.
 *
 * `writeTraceFile` writes the rendered HTML to `traces/<card-id>/index.html` under the repo.
 *
 * `commitTraceToOps` performs the RUNTIME coordination write: per CLAUDE.md branch rules and the
 * plan's branch-discipline paragraph, the `traces/` commit is an **ops-branch** write and MUST follow
 * `git pull --rebase origin ops` → commit → push, and "a rejected push means re-read state, reconcile,
 * retry". The git invocation is an INJECTABLE runner (`OpsGitRunner`) so tests are hermetic — they
 * never touch the real repo or network. Only the trace directory is staged (never `git add .`).
 *
 * In D0 the daemon RENDERS to a local path only; committing is opt-in (`writeTrace({ commit: true })`)
 * and can be deferred to the D2 governed-write era. Default = write-to-local, zero git.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A git invocation runner. `args` is the full argv AFTER `git`. Injected so tests need no real git
 * and never hit the network. Must return stdout as a string; a non-zero git exit throws.
 */
export type OpsGitRunner = (repoRoot: string, args: string[]) => string;

/** Default runner: shells the real `git` binary (gpg signing off; the repo's pre-commit hook runs). */
export const defaultOpsGitRunner: OpsGitRunner = (repoRoot, args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });

/** Relative (POSIX) trace directory for a card. */
function traceDir(cardId: string): string {
  return `traces/${cardId}`;
}

/**
 * Write `html` to `traces/<cardId>/index.html` under `repoRoot`. Returns the absolute file path.
 * Local write only — never touches git.
 */
export function writeTraceFile(repoRoot: string, cardId: string, html: string): string {
  const dir = join(repoRoot, 'traces', cardId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'index.html');
  writeFileSync(file, html, 'utf8');
  return file;
}

export interface CommitOptions {
  /** Commit subject; a sensible default is used when omitted. */
  message?: string;
  /** How many extra push attempts (each preceded by a reconciling `pull --rebase`) after the first. */
  maxRetryPushes?: number;
}

/**
 * Commit the already-written `traces/<cardId>/` to the `ops` branch via pull-rebase-push, retrying a
 * rejected push after re-reading state. Staging is confined to the trace directory.
 */
export function commitTraceToOps(
  repoRoot: string,
  cardId: string,
  runGit: OpsGitRunner = defaultOpsGitRunner,
  options: CommitOptions = {},
): void {
  const relDir = traceDir(cardId);
  const message = options.message ?? `chore(trace): distilled flight-recorder for ${cardId}`;
  const maxRetryPushes = options.maxRetryPushes ?? 3;

  // Reconcile with remote ops before writing history, stage ONLY the trace dir, commit.
  runGit(repoRoot, ['pull', '--rebase', 'origin', 'ops']);
  runGit(repoRoot, ['add', '--', relDir]);
  runGit(repoRoot, ['commit', '-m', message]);

  // Push; a rejected push means re-read state (pull --rebase) and retry, bounded.
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetryPushes; attempt += 1) {
    try {
      runGit(repoRoot, ['push', 'origin', 'ops']);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetryPushes) break;
      runGit(repoRoot, ['pull', '--rebase', 'origin', 'ops']);
    }
  }
  throw lastErr;
}

export interface WriteTraceInput {
  repoRoot: string;
  cardId: string;
  html: string;
  /** When true, also commit the trace to `ops` (runtime coordination write). Default: false (D0). */
  commit?: boolean;
  runGit?: OpsGitRunner;
  message?: string;
}

/**
 * Orchestrate the D0.8 write: always write the distilled HTML to the local trace path; commit to
 * `ops` only when `commit === true`. Returns the absolute path of the written file.
 */
export function writeTrace(input: WriteTraceInput): string {
  const file = writeTraceFile(input.repoRoot, input.cardId, input.html);
  if (input.commit) {
    commitTraceToOps(input.repoRoot, input.cardId, input.runGit ?? defaultOpsGitRunner, {
      message: input.message,
    });
  }
  return file;
}

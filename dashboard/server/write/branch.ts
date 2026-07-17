/**
 * D2.5 — target-classified branch routing for the governed-save path.
 *
 * The dashboard's runtime writes fall into two classes that route differently (plan §"Runtime write
 * classification", binding on this path):
 *   - **Coordination artifacts** — `queue/**`, `ledgers/**`, `traces/**`, the audit log, `queue/paused/**`
 *     markers — go to `ops` via `git pull --rebase origin ops` -> add -> commit -> push, retrying a
 *     rejected push after re-reading state (CLAUDE.md: "a rejected push means: re-read state,
 *     reconcile, retry").
 *   - **Durable content** — `skills/**`, `docs/**`, KB markdown, dashboard code — goes to a work
 *     branch -> PR to `main`. NEVER a direct push to `ops`, NEVER a direct push to `main`.
 *
 * Mislabeling a skill/doc edit as a coordination write (pushing it to `ops`) skips the durable-content
 * review path and fights the `sync_skills` pre-commit hook — so `classifyTarget` is a pure, total
 * function over the relpath with no ambiguous middle ground.
 *
 * Both git and the (separate) PR-open step are shelled through injectable runners so tests are
 * hermetic — they never touch the real repo, a real remote, or the `gh` CLI. The default git runner
 * does NOT disable hooks (unlike the read-only `kb/browser.ts` runner) and never passes `--no-verify`,
 * so a `skills/**` commit still runs the active `.githooks/pre-commit` `sync_skills.py` check — a
 * drifted `.claude/skills` mirror fails the commit (and therefore the save) rather than being bypassed.
 */

import { execFileSync } from 'node:child_process';

export type Target = 'durable' | 'coordination';

/** Runtime write classes that route to `ops` (pull-rebase-push), never a work-branch PR. */
const COORDINATION_PREFIXES = ['queue/', 'ledgers/', 'traces/'];

/** Normalize a relpath to forward-slash, no leading slash, for prefix comparisons. */
function normalize(relpath: string): string {
  return relpath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Classify a relpath as `'durable'` (skills/**, docs/**, KB markdown, dashboard code — work branch ->
 * PR to main) or `'coordination'` (queue/**, ledgers/**, traces/**, the audit log under ledgers/audit/,
 * queue/paused/** markers — ops pull-rebase-push). Total: everything not explicitly coordination is
 * durable content, per the plan's binary classification.
 */
export function classifyTarget(relpath: string): Target {
  const norm = normalize(relpath);
  return COORDINATION_PREFIXES.some((p) => norm.startsWith(p)) ? 'coordination' : 'durable';
}

/** A git invocation runner. `args` is the full argv AFTER `git`. Injected for hermetic tests. */
export type GitRunner = (repoRoot: string, args: string[]) => string;

/** Default runner: shells the real `git` binary. Hooks stay ACTIVE (no `core.hooksPath=` override) and
 *  `--no-verify` is never passed — the `sync_skills` pre-commit hook must be able to run and block. */
export const defaultGitRunner: GitRunner = (repoRoot, args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });

/** A PR-open request: reviewed by Daniel, never auto-merged by the governed-save path itself. */
export interface PrRequest {
  base: string;
  head: string;
  title: string;
  body?: string;
}

/** Opens a PR — a distinct capability from `GitRunner` (no git push targets `main` directly; a PR is
 *  how durable content reaches it). Injected for hermetic tests. */
export type PrOpener = (repoRoot: string, req: PrRequest) => void;

/** Default opener: shells the `gh` CLI. Never invoked for coordination writes. */
export const defaultPrOpener: PrOpener = (repoRoot, req) => {
  const args = ['pr', 'create', '--base', req.base, '--head', req.head, '--title', req.title];
  if (req.body) args.push('--body', req.body);
  execFileSync('gh', args, { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
};

/** The work branch durable-content saves land on absent an explicit override — this worker's branch. */
export const DEFAULT_WORK_BRANCH = 'claude/m1-dashboard';

/** Branches durable content may NEVER be pushed to directly. `main` receives durable content only via a
 *  reviewed PR; `ops` receives ONLY coordination artifacts through the pull-rebase-push path — never a
 *  governedSave durable push. This is the design invariant (design §"write path", CLAUDE.md branch rules). */
const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(['main', 'ops']);

/** Thrown when a durable push would target a protected branch — the defense-in-depth denylist so even a
 *  future caller that reintroduces a client-controlled branch can't push durable content to main/ops. */
export class ProtectedBranchError extends Error {
  constructor(branch: string) {
    super(`refusing to push durable content directly to protected branch '${branch}'`);
    this.name = 'ProtectedBranchError';
  }
}

/**
 * True when `branch` resolves to a protected branch (`main`/`ops`) — case-insensitively and regardless
 * of a `refs/heads/` prefix, backslashes, leading slashes, or surrounding whitespace. The denylist the
 * durable route asserts against, and the route layer's hard-reject predicate for a client-smuggled ref.
 */
export function isProtectedBranch(branch: string): boolean {
  const norm = branch
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^refs\/heads\//i, '')
    .trim()
    .toLowerCase();
  return PROTECTED_BRANCHES.has(norm);
}

export interface RouteOptions {
  runGit?: GitRunner;
  openPr?: PrOpener;
  /** Work branch for durable-content routing. Defaults to {@link DEFAULT_WORK_BRANCH}. */
  workBranch?: string;
  message?: string;
  /** Extra push attempts (each preceded by a reconciling `pull --rebase`) after the first — coordination
   *  route only, per CLAUDE.md's "rejected push -> re-read state, reconcile, retry". */
  maxRetryPushes?: number;
}

function defaultMessage(relpath: string): string {
  return `chore(dashboard): governed save ${relpath}`;
}

/**
 * Durable-content route: stage the exact relpath, commit locally (hooks active), push the current
 * HEAD to the work branch ref on `origin` — NEVER `ops`, NEVER `main` — then open a PR to `main`.
 */
export function routeDurable(repoRoot: string, relpath: string, options: RouteOptions = {}): void {
  const runGit = options.runGit ?? defaultGitRunner;
  const openPr = options.openPr ?? defaultPrOpener;
  const branch = options.workBranch ?? DEFAULT_WORK_BRANCH;
  const message = options.message ?? defaultMessage(relpath);

  // Defense-in-depth denylist: refuse to push durable content to main/ops regardless of caller, BEFORE
  // any local staging/commit — so even a future caller that reintroduces a client-controlled branch
  // cannot direct-push durable content past the PR-review gate.
  if (isProtectedBranch(branch)) {
    throw new ProtectedBranchError(branch);
  }

  runGit(repoRoot, ['add', '--', relpath]);
  runGit(repoRoot, ['commit', '-m', message]);
  // Push local HEAD onto the work-branch ref, regardless of the locally checked-out branch name —
  // never a bare `push origin main`/`push origin ops`.
  runGit(repoRoot, ['push', 'origin', `HEAD:refs/heads/${branch}`]);
  openPr(repoRoot, { base: 'main', head: branch, title: message });
}

/**
 * Coordination route: `git pull --rebase origin ops` -> add exact relpath -> commit -> push, retrying
 * a rejected push after re-reading state (bounded). Mirrors `trace/commit.ts#commitTraceToOps` and
 * `audit/log.ts#commitAuditToOps` — the same rule applied generically to any coordination relpath.
 */
export function routeCoordination(repoRoot: string, relpath: string, options: RouteOptions = {}): void {
  const runGit = options.runGit ?? defaultGitRunner;
  const message = options.message ?? defaultMessage(relpath);
  const maxRetryPushes = options.maxRetryPushes ?? 3;

  runGit(repoRoot, ['pull', '--rebase', 'origin', 'ops']);
  runGit(repoRoot, ['add', '--', relpath]);
  runGit(repoRoot, ['commit', '-m', message]);

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

/**
 * Classify `relpath` and route it via the matching branch rule. Returns the classification so the
 * caller (`governedSave.ts`) can report it. Throws whatever the underlying git/PR call throws — a
 * rejected/blocked commit (e.g. the `sync_skills` hook failing on drift) fails the save; it is never
 * caught-and-retried with `--no-verify`.
 */
export function routeWrite(repoRoot: string, relpath: string, options: RouteOptions = {}): Target {
  const target = classifyTarget(relpath);
  if (target === 'durable') {
    routeDurable(repoRoot, relpath, options);
  } else {
    routeCoordination(repoRoot, relpath, options);
  }
  return target;
}

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

import { createAsyncGitRunner, createAsyncPrOpener, withOpsTransaction } from './asyncGit.ts';
import type { AsyncPrResult } from './asyncGit.ts';
import type { OpsGitRunner } from './asyncGit.ts';

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

/** A git invocation runner. `args` is the full argv AFTER `git`. Injected for hermetic tests. Widened
 *  to allow a `Promise` (the async default) while still accepting synchronous test fakes. Structurally
 *  identical to `asyncGit.ts#OpsGitRunner`. */
export type GitRunner = OpsGitRunner;

/** Default runner: the shared async git runner (spawn, off the event loop, 60s kill-timeout). Hooks
 *  stay ACTIVE (no `core.hooksPath=` override) and `--no-verify` is never passed — the `sync_skills`
 *  pre-commit hook must be able to run and block. */
export const defaultGitRunner: GitRunner = createAsyncGitRunner({ requireTransaction: true });

/** A PR-open request: reviewed by Daniel, never auto-merged by the governed-save path itself. */
export interface PrRequest {
  base: string;
  head: string;
  title: string;
  body?: string;
}

/** Opens a PR — a distinct capability from `GitRunner` (no git push targets `main` directly; a PR is
 *  how durable content reaches it). Injected for hermetic tests. Widened to allow a `Promise`. */
export type PrOpener = (repoRoot: string, req: PrRequest) => AsyncPrResult | void | Promise<AsyncPrResult | void>;

/** Default opener: the shared async `gh pr create` runner (spawn, off the event loop, 60s kill-timeout).
 *  Never invoked for coordination writes. */
export const defaultPrOpener: PrOpener = createAsyncPrOpener({ requireTransaction: true });

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

/** Thrown when a coordination write is attempted from any checkout other than the local `ops` branch.
 *  A later `git push origin ops` pushes the local `ops` ref, not an unrelated checked-out HEAD. */
export class CoordinationCheckoutError extends Error {
  constructor(branch: string) {
    super(`refusing coordination write: checked-out branch is '${branch || '(unknown)'}', expected 'ops'`);
    this.name = 'CoordinationCheckoutError';
  }
}

/** Refuse to absorb a previous failed operation's staged residue into a governed commit. */
export class DirtyIndexError extends Error {
  constructor(paths: string[]) {
    super(`refusing governed commit with pre-existing staged paths: ${paths.join(', ')}`);
    this.name = 'DirtyIndexError';
  }
}

async function assertCleanIndex(repoRoot: string, runGit: GitRunner): Promise<void> {
  const paths = (await runGit(repoRoot, ['diff', '--cached', '--name-only', '-z']))
    .split('\0').map((path) => path.trim()).filter(Boolean);
  if (paths.length > 0) throw new DirtyIndexError(paths);
}

/** Query the real checkout through the injected runner and fail closed unless it is exactly `ops`. */
async function assertCoordinationCheckout(repoRoot: string, runGit: GitRunner): Promise<void> {
  const branch = (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (branch !== 'ops') throw new CoordinationCheckoutError(branch);
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
  /** Extra coordination relpaths staged into the SAME commit as the primary relpath (MED-3: an audit row
   *  committed atomically with the change it records — one commit, one push). Coordination route only. */
  alsoStage?: string[];
  /** Re-run caller-specific authorization after a rejected push pulls a newer canonical ops head. */
  onReconciled?: () => void;
}

/**
 * Prepare an `ops` coordination write by proving that the checkout itself is exactly `ops`, then
 * reconciling it before the first local mutation. Pulling `origin ops` does not switch branches, and
 * pushing `origin ops` does not push an arbitrary checked-out HEAD. Detached HEAD and every work branch
 * therefore fail closed; this function never auto-checks out a branch.
 * Kept separate from {@link commitPreparedCoordination} for writes (such as card launch) whose
 * authoritative schema operation must happen only after the pull, while still committing an exact
 * multi-path set atomically afterwards.
 */
export async function prepareCoordination(repoRoot: string, runGit: GitRunner = defaultGitRunner): Promise<void> {
  // Reentrant: a caller that already holds the ops-transaction span joins it; a careless future caller
  // that forgot the span lock at least serializes this individual step.
  return withOpsTransaction(async () => {
    await assertCoordinationCheckout(repoRoot, runGit);
    await runGit(repoRoot, ['pull', '--rebase', 'origin', 'ops']);
  });
}

function defaultMessage(relpath: string): string {
  return `chore(dashboard): governed save ${relpath}`;
}

/**
 * Durable-content route: stage the exact relpath, commit locally (hooks active), push the current
 * HEAD to the work branch ref on `origin` — NEVER `ops`, NEVER `main` — then open a PR to `main`.
 */
export async function routeDurable(repoRoot: string, relpath: string, options: RouteOptions = {}): Promise<{ branch: string; pr: AsyncPrResult }> {
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

  // Same checkout as the coordination writers — its stage/commit must not interleave with theirs.
  return withOpsTransaction(async () => {
    let staged = false;
    let committed = false;
    let pushed = false;
    try {
      const checkedOut = (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      if (checkedOut !== branch) throw new Error(`refusing durable write: checked-out branch is '${checkedOut || '(detached)'}', expected '${branch}'`);
      await assertCleanIndex(repoRoot, runGit);
      await runGit(repoRoot, ['add', '--', relpath]);
      staged = true;
      await runGit(repoRoot, ['commit', '-m', message, '--only', '--', relpath]);
      committed = true;
    // Push local HEAD onto the work-branch ref, regardless of the locally checked-out branch name —
    // never a bare `push origin main`/`push origin ops`.
    await runGit(repoRoot, ['push', 'origin', `HEAD:refs/heads/${branch}`]);
    pushed = true;
    const pr = await openPr(repoRoot, { base: 'main', head: branch, title: message });
    return { branch, pr: pr ?? {} };
    } catch (error) {
      if (staged && !committed) {
        try { await runGit(repoRoot, ['reset', 'HEAD', '--', relpath]); } catch { /* preserve original failure */ }
      }
      throw new DurableRouteError(error, { committed, pushed });
    }
  });
}

/** Reports whether a durable route crossed its commit or remote-push boundary before failing. */
export class DurableRouteError extends Error {
  readonly committed: boolean;
  readonly pushed: boolean;
  constructor(cause: unknown, state: { committed: boolean; pushed: boolean }) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'DurableRouteError';
    this.committed = state.committed;
    this.pushed = state.pushed;
  }
}

/**
 * Prepared coordination commit: re-prove that the checkout is still `ops`, then add exact relpaths ->
 * commit -> push, retrying a rejected push after re-reading state (bounded). The second check closes the
 * gap between prepare and a caller's local write: an external branch switch fails before staging.
 * `audit/log.ts#commitAuditToOps` — the same rule applied generically to any coordination relpath.
 */
export async function commitPreparedCoordination(repoRoot: string, relpath: string, options: RouteOptions = {}): Promise<void> {
  const runGit = options.runGit ?? defaultGitRunner;
  const message = options.message ?? defaultMessage(relpath);
  const maxRetryPushes = options.maxRetryPushes ?? 3;

  return withOpsTransaction(async () => {
  const stagePaths = [relpath, ...(options.alsoStage ?? [])];
  await assertCoordinationCheckout(repoRoot, runGit);
  await assertCleanIndex(repoRoot, runGit);
  await runGit(repoRoot, ['add', '--', ...stagePaths]);
  await runGit(repoRoot, ['commit', '-m', message, '--only', '--', ...stagePaths]);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetryPushes; attempt += 1) {
    try {
      await runGit(repoRoot, ['push', 'origin', 'ops']);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetryPushes) break;
      await assertCoordinationCheckout(repoRoot, runGit);
      await runGit(repoRoot, ['pull', '--rebase', 'origin', 'ops']);
      options.onReconciled?.();
    }
  }
  throw lastErr;
  });
}

export async function routeCoordination(repoRoot: string, relpath: string, options: RouteOptions = {}): Promise<void> {
  const runGit = options.runGit ?? defaultGitRunner;
  // One span: prepare and commit must not interleave with any other ops transaction.
  return withOpsTransaction(async () => {
    await prepareCoordination(repoRoot, runGit);
    await commitPreparedCoordination(repoRoot, relpath, { ...options, runGit });
  });
}

/**
 * Classify `relpath` and route it via the matching branch rule. Returns the classification so the
 * caller (`governedSave.ts`) can report it. Throws whatever the underlying git/PR call throws — a
 * rejected/blocked commit (e.g. the `sync_skills` hook failing on drift) fails the save; it is never
 * caught-and-retried with `--no-verify`.
 */
export async function routeWrite(repoRoot: string, relpath: string, options: RouteOptions = {}): Promise<Target> {
  const target = classifyTarget(relpath);
  if (target === 'durable') {
    await routeDurable(repoRoot, relpath, options);
  } else {
    await routeCoordination(repoRoot, relpath, options);
  }
  return target;
}

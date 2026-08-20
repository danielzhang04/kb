/**
 * Locate and read an org-owned workflow definition from a LIVE working tree of this repo.
 *
 * WHY THIS EXISTS
 * ---------------
 * `compile.videoRun.test.ts` used to embed the `video-run.md` definition as a TypeScript string
 * literal, with a comment instructing humans to "keep this byte-identical" to the org file. That
 * instruction was unenforceable: the test performed no file read, so the fixture and the org file
 * could diverge without a single test going red. A comment is not a test.
 *
 * WHAT THIS MODULE ACTUALLY GUARANTEES
 * ------------------------------------
 * It removes the second artifact: the test compiles the file itself, so there is no copy left to
 * drift from. What it does NOT guarantee is that the file it read is the one you are looking at.
 * A definition living in a sibling worktree is read from THAT worktree's checkout, which may sit on
 * a different branch than yours. So the honest claim is: drift between a fixture and the definition
 * is impossible (there is no fixture), and drift between branches is DETECTED — `origin` names the
 * exact file that was compiled, and the test asserts on it, so a surprising source is visible rather
 * than silent. An earlier revision of this docstring claimed drift was "structurally impossible";
 * that was false while a git-object tier could serve content from any ref in the repo.
 *
 * THE CROSS-WORKTREE PROBLEM
 * --------------------------
 * The dashboard and the faceless-youtube org currently live in different git WORKTREES of the same
 * repository (`kb-worktrees/fleet-arc` and `kb-worktrees/faceless-import`), on different branches.
 * So `<dashboardRepoRoot>/orgs/faceless-youtube/workflows/video-run.md` does not exist on disk here.
 *
 * A hardcoded absolute path would break on any other machine. A `../../faceless-import/...` relative
 * path would hardcode a sibling directory name that git is free to change. Both are guesses about
 * layout. Instead we ASK GIT where its worktrees are — git is the authority on its own topology.
 *
 * Resolution order, first hit wins:
 *   1. This worktree's own filesystem. Covers the eventual steady state, once the org tree and the
 *      dashboard are merged onto one branch. This path needs no git at all.
 *   2. Any sibling worktree reported by `git worktree list --porcelain`. Covers today's split layout
 *      and reads the LIVE WORKING TREE, so an uncommitted edit to the definition is caught
 *      immediately rather than only after it is committed.
 *   3. Nothing found -> throw. See `OrgDefNotFoundError`: this fails LOUDLY and explains itself
 *      rather than silently falling back to a stale inline copy.
 *
 * NO GIT-OBJECT TIER, DELIBERATELY
 * --------------------------------
 * A third tier used to search the shared object database with `git cat-file` over every ref and take
 * the first hit. `for-each-ref` emits refs in ALPHABETICAL order, so "first hit" meant "whichever ref
 * sorts earliest" — verified live, `_index.md` resolved out of `refs/heads/approval/6a5958cf-f01e6715`,
 * a machine-generated stale approval branch, and a definition DELETED at HEAD still compiled green.
 * That tier did not remove drift, it added one source of drift per ref in the object database.
 *
 * It was not repaired to read HEAD-only because a HEAD-only tier earns nothing: tier 1 already reads
 * this worktree's working tree, which is HEAD plus uncommitted edits. The only case HEAD-only would
 * add is "committed at HEAD but missing from the working tree" — an incoherent checkout that should
 * fail loudly, not be papered over. The remaining motivation ("the org branch is fetched but not
 * checked out anywhere") cannot be served honestly, because nothing here can pick the intended ref
 * out of ~140 candidates. Fixing the checkout is the correct remedy, and the error message says so.
 *
 * PATH CONTAINMENT
 * ----------------
 * `relPath` is caller-supplied and is joined against ~24 worktree roots, so an unvalidated `../`
 * payload would read arbitrary files off the host (verified: `../../../.gitconfig` returned the
 * user's git config). It is therefore validated as a strict repo-relative path AND the resolved
 * result is re-checked for containment after symlinks are followed. Both, because either alone has a
 * hole: the pattern does not see symlinks, and the containment check alone would still accept a
 * traversal that happens to land back inside a root.
 *
 * Line endings are normalized to LF so that a Windows checkout parses identically to a POSIX one.
 * That is the only transformation applied; the bytes are otherwise verbatim.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where a definition was actually found, so tests and failures can name their source. */
export interface OrgDefSource {
  /** File text, verbatim except CRLF -> LF normalization. */
  readonly text: string;
  /** The absolute on-disk path that was read. Always a real file in a live working tree. */
  readonly origin: string;
  /** Resolution step that produced the text — useful for asserting we are not on a stale path. */
  readonly via: 'worktree-local' | 'worktree-sibling';
}

/**
 * Thrown when a definition cannot be located by ANY strategy. Carries the full list of places that
 * were searched, because a silent skip here would re-create exactly the blind spot this module was
 * written to close.
 */
export class OrgDefNotFoundError extends Error {
  constructor(relPath: string, attempted: readonly string[]) {
    super(
      [
        `Workflow definition '${relPath}' could not be located in any live working tree of this repository.`,
        '',
        'This test compiles the REAL org definition, not a copy, so it cannot run without it.',
        'Searched, in order:',
        ...attempted.map((a) => `  - ${a}`),
        '',
        'If the org tree is genuinely unavailable, check out the branch that carries it into a',
        'worktree — do NOT reintroduce an inline fixture, and do NOT resurrect a git-object lookup.',
        'An inline copy is what allowed the definition and its test to drift unnoticed; a git-object',
        'lookup silently served whichever ref sorted first, including refs where the file was stale',
        'or already deleted.',
      ].join('\n'),
    );
    this.name = 'OrgDefNotFoundError';
  }
}

/** Thrown when `relPath` is not a plain repo-relative path. Never reached by the shipped callers. */
export class OrgDefPathError extends Error {
  constructor(relPath: string, reason: string) {
    super(
      `Refusing to load workflow definition by path ${JSON.stringify(relPath)}: ${reason}. `
      + 'Only plain repo-relative paths (e.g. orgs/<project>/workflows/<name>.md) are accepted; '
      + 'this loader joins the path against every git worktree root, so an escaping path would read '
      + 'arbitrary files off the host.',
    );
    this.name = 'OrgDefPathError';
  }
}

/**
 * A single path segment: letters, digits, dot, underscore, dash. Anything else — a separator of any
 * kind, a drive colon, a newline, a wildcard, whitespace — is rejected. Note the class admits `..`
 * as a segment, so traversal is rejected separately below rather than left to regex subtlety.
 */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Throws `OrgDefPathError` unless `relPath` is a plain, forward-slashed, non-escaping repo path. */
export function assertRepoRelativePath(relPath: string): void {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new OrgDefPathError(String(relPath), 'the path is empty');
  }
  if (isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) {
    throw new OrgDefPathError(relPath, 'the path is absolute or drive-qualified');
  }
  const segments = relPath.split('/');
  for (const segment of segments) {
    if (segment === '') throw new OrgDefPathError(relPath, 'the path has an empty segment');
    if (segment === '.' || segment === '..') {
      throw new OrgDefPathError(relPath, `the path contains a '${segment}' segment`);
    }
    if (!SEGMENT.test(segment)) {
      throw new OrgDefPathError(relPath, `segment ${JSON.stringify(segment)} is not [A-Za-z0-9._-]+`);
    }
  }
}

/** True when `candidate` is `root` itself or lies beneath it. Case-insensitive on win32, per `relative`. */
function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === '' || isAbsolute(rel)) return false;
  return rel.split(/[\\/]/)[0] !== '..';
}

/**
 * Resolve `relPath` under `root` and return it only if it stays inside `root` BOTH lexically and
 * after symlink resolution. Returns null when the path escapes or does not exist.
 *
 * Exported for tests: the symlink leg is the half that the `assertRepoRelativePath` pattern cannot
 * see, and it is only reachable through a symlink planted inside a repo root, so it needs a seam.
 */
export function resolveContainedPath(root: string, relPath: string): string | null {
  const candidate = resolve(root, relPath);
  if (!isWithin(root, candidate)) return null;
  if (!existsSync(candidate)) return null;
  try {
    // Belt and braces: a symlink inside the root may still point out of it.
    if (!isWithin(realpathSync(root), realpathSync(candidate))) return null;
  } catch {
    return null;
  }
  return candidate;
}

/** dashboard/server/workflows/orgDefSource.ts -> ../../../ is this worktree's repo root. */
function localRepoRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/** Absolute paths of every worktree git knows about, this one included. */
function gitWorktreePaths(cwd: string): string[] {
  let out: string;
  try {
    out = git(cwd, ['worktree', 'list', '--porcelain']);
  } catch {
    return [];
  }
  return out
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

/**
 * Read a repo-relative org definition (e.g. `orgs/faceless-youtube/workflows/video-run.md`) from a
 * live working tree of this repository. Throws `OrgDefPathError` if the path is not a plain
 * repo-relative path, `OrgDefNotFoundError` if no working tree has it.
 */
export function loadOrgDef(relPath: string): OrgDefSource {
  assertRepoRelativePath(relPath);
  const root = resolve(localRepoRoot());
  const attempted: string[] = [];

  // 1. This worktree.
  attempted.push(`worktree-local: ${resolve(root, relPath)}`);
  const local = resolveContainedPath(root, relPath);
  if (local) {
    return { text: normalize(readFileSync(local, 'utf8')), origin: local, via: 'worktree-local' };
  }

  // 2. Sibling worktrees of the same repo, per git itself. Live working-tree content.
  for (const wt of gitWorktreePaths(root)) {
    const worktreeRoot = resolve(wt);
    if (worktreeRoot === root) continue;
    attempted.push(`worktree-sibling: ${resolve(worktreeRoot, relPath)}`);
    const candidate = resolveContainedPath(worktreeRoot, relPath);
    if (candidate) {
      return {
        text: normalize(readFileSync(candidate, 'utf8')),
        origin: candidate,
        via: 'worktree-sibling',
      };
    }
  }

  // 3. Loud failure. Never a silent fallback, and never a git-object guess.
  throw new OrgDefNotFoundError(relPath, attempted);
}

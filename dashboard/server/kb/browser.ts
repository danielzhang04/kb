/**
 * Read-only KB file browser (Plane-A checkout). Three primitives:
 *   - `listTree`    — directory listing confined to the repo root
 *   - `readFile`    — file read confined to the repo root
 *   - `fileHistory` — per-file git history via `git log --follow`
 *
 * SECURITY INVARIANTS
 *  1. STRICTLY READ-ONLY. There is no write primitive here and no write route (see routes.ts).
 *  2. PATH CONFINEMENT. Every caller-supplied relpath is normalised and confined to `repoRoot`;
 *     `..` escapes and absolute paths (POSIX `/x`, Windows `C:\x` / UNC) are rejected with
 *     `PathEscapeError`. `_index.md`-style relative navigation inside the repo is allowed.
 *  3. INERT CONTENT. File bytes (including any `## Evidence` block) are returned verbatim and never
 *     interpreted. Rendering/escaping happens client-side (see src/lib/markdown.ts).
 *  4. HERMETIC GIT. The git subprocess is injected (`GitRunner`) so it can be mocked; the default
 *     runner shells the real `git` binary. Nothing here spawns a shell (execFile, not exec).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

export class PathEscapeError extends Error {
  constructor(relpath: string) {
    super(`refusing path outside repo root: ${relpath}`);
    this.name = 'PathEscapeError';
  }
}

export interface TreeEntry {
  name: string;
  /** POSIX-style relpath from repoRoot (forward slashes), stable across platforms. */
  path: string;
  type: 'dir' | 'file';
}

export interface TreeListing {
  path: string;
  entries: TreeEntry[];
}

export interface Commit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

/** Directories never surfaced by the browser (VCS internals + build/dependency output). */
const HIDDEN = new Set(['.git', 'node_modules', 'dist']);

/**
 * Resolve `relpath` against `repoRoot` and guarantee the result stays inside the root.
 * Absolute inputs and `..` escapes throw `PathEscapeError`. Returns an absolute path.
 */
export function resolveWithin(repoRoot: string, relpath: string): string {
  if (relpath.includes('\0')) throw new PathEscapeError(relpath);
  // Reject absolute inputs outright (POSIX `/etc`, Windows `C:\`, UNC `\\host`). Checking
  // win32 syntax explicitly keeps this invariant intact when the server itself runs on POSIX.
  if (isAbsolute(relpath) || win32.isAbsolute(relpath)) throw new PathEscapeError(relpath);

  const root = resolve(repoRoot);
  const target = resolve(root, relpath);
  const rel = relative(root, target);
  // `rel === ''` → the root itself (allowed). Anything starting with `..` (or that comes back
  // absolute, e.g. a different Windows drive) has escaped the root.
  if (rel !== '' && (rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('../') || isAbsolute(rel))) {
    throw new PathEscapeError(relpath);
  }
  return target;
}

/** Normalise an absolute path under repoRoot to a POSIX relpath for transport. */
function toPosixRel(repoRoot: string, abs: string): string {
  const rel = relative(resolve(repoRoot), abs);
  return rel.split(sep).join('/');
}

/** List the directory at `subpath` (default: repo root), confined to `repoRoot`. */
export function listTree(repoRoot: string, subpath = ''): TreeListing {
  const dir = resolveWithin(repoRoot, subpath);
  const dirents = readdirSync(dir, { withFileTypes: true });
  const entries: TreeEntry[] = dirents
    .filter((d) => !(d.isDirectory() && HIDDEN.has(d.name)))
    .map((d) => ({
      name: d.name,
      path: toPosixRel(repoRoot, join(dir, d.name)),
      type: d.isDirectory() ? ('dir' as const) : ('file' as const),
    }));
  // Directories first, then files; alphabetical within each group.
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: toPosixRel(repoRoot, dir), entries };
}

/** Read a file's UTF-8 content, confined to `repoRoot`. Read-only. */
export function readFile(repoRoot: string, relpath: string): string {
  const file = resolveWithin(repoRoot, relpath);
  return readFileSync(file, 'utf-8');
}

/**
 * A git invocation runner. Injected so tests need no real git. `args` is the full argv AFTER `git`
 * (e.g. `['log', '--follow', ...]`). Must return stdout as a string.
 */
export type GitRunner = (repoRoot: string, args: string[]) => string;

/** Default runner: shells the real `git` binary with hooks/gpg neutralised, no shell interpolation. */
export const defaultGitRunner: GitRunner = (repoRoot, args) =>
  execFileSync('git', ['-c', 'core.hooksPath=', ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });

// %H hash, %an author name, %ad date, %s subject — tab (%x09) separated, one line per commit.
const LOG_FORMAT = '--format=%H%x09%an%x09%ad%x09%s';

/**
 * Per-file commit history via `git log --follow` (tracks the file across renames), newest first.
 * The relpath is confined to `repoRoot` BEFORE any git call, so a traversal input never reaches git.
 */
export function fileHistory(repoRoot: string, relpath: string, runGit: GitRunner = defaultGitRunner): Commit[] {
  resolveWithin(repoRoot, relpath); // throws PathEscapeError on escape — guards the subprocess.
  const posixRel = relpath.split(sep).join('/');
  const out = runGit(repoRoot, ['log', '--follow', LOG_FORMAT, '--', posixRel]);
  return out
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [hash, author, date, ...rest] = line.split('\t');
      return { hash, author, date, subject: rest.join('\t') };
    });
}

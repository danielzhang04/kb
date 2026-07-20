/**
 * Locate and read an org-owned workflow definition from the REAL repo — never from a copy.
 *
 * WHY THIS EXISTS
 * ---------------
 * `compile.videoRun.test.ts` used to embed the `video-run.md` definition as a TypeScript string
 * literal, with a comment instructing humans to "keep this byte-identical" to the org file. That
 * instruction was unenforceable: the test performed no file read, so the fixture and the org file
 * could diverge without a single test going red. A comment is not a test.
 *
 * This module removes the copy entirely. There is exactly ONE source of truth — the file on disk —
 * and the test compiles that. Drift is not "detected"; it is structurally impossible, because there
 * is no second artifact left to drift from.
 *
 * THE CROSS-WORKTREE PROBLEM
 * --------------------------
 * The dashboard and the faceless-youtube org currently live in different git WORKTREES of the same
 * repository (`kb-worktrees/fleet-arc` and `kb-worktrees/faceless-import`), on different branches.
 * So `<dashboardRepoRoot>/orgs/faceless-youtube/workflows/video-run.md` does not exist on disk here.
 *
 * A hardcoded absolute path would break on any other machine. A `../../faceless-import/...` relative
 * path would hardcode a sibling directory name that git is free to change. Both are guesses about
 * layout. Instead we ASK GIT where its worktrees and refs are — git is the authority on its own
 * topology, and every worktree of this repo shares one object database
 * (`git rev-parse --git-common-dir` resolves to the same `.git` from all of them).
 *
 * Resolution order, first hit wins:
 *   1. This worktree's own filesystem. Covers the eventual steady state, once the org tree and the
 *      dashboard are merged onto one branch. This path needs no git at all.
 *   2. Any sibling worktree reported by `git worktree list --porcelain`. Covers today's split layout
 *      and reads the LIVE WORKING TREE, so an uncommitted edit to the definition is caught
 *      immediately rather than only after it is committed.
 *   3. The shared object database, via `git cat-file` over every ref. Covers the case where the org
 *      branch is fetched but not checked out into any worktree.
 *   4. Nothing found -> throw. See `OrgDefNotFoundError`: this fails LOUDLY and explains itself
 *      rather than silently falling back to a stale inline copy.
 *
 * Line endings are normalized to LF so that a Windows checkout and a git blob (always LF) parse
 * identically. That is the only transformation applied; the bytes are otherwise verbatim.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where a definition was actually found, so tests and failures can name their source. */
export interface OrgDefSource {
  /** File text, verbatim except CRLF -> LF normalization. */
  readonly text: string;
  /** Which resolution step won: the on-disk path, or `git:<ref>`. */
  readonly origin: string;
  /** Resolution step that produced the text — useful for asserting we are not on a stale path. */
  readonly via: 'worktree-local' | 'worktree-sibling' | 'git-ref';
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
        `Workflow definition '${relPath}' could not be located in this repository.`,
        '',
        'This test compiles the REAL org definition, not a copy, so it cannot run without it.',
        'Searched, in order:',
        ...attempted.map((a) => `  - ${a}`),
        '',
        'If the org tree is genuinely unavailable, fix the checkout — do NOT reintroduce an inline',
        'fixture. An inline copy is what allowed the definition and its test to drift unnoticed.',
      ].join('\n'),
    );
    this.name = 'OrgDefNotFoundError';
  }
}

/** dashboard/server/workflows/orgDefSource.ts -> ../../../ is this worktree's repo root. */
function localRepoRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

function git(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync('git', [...args], {
    cwd,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
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
 * Look for `relPath` in the shared object database across every ref, using ONE `cat-file
 * --batch-check` process rather than a spawn per ref (there are ~140 refs here).
 */
function readFromGitRefs(cwd: string, relPath: string): { text: string; ref: string } | null {
  let refsOut: string;
  try {
    refsOut = git(cwd, ['for-each-ref', '--format=%(refname)']);
  } catch {
    return null;
  }
  const refs = refsOut.split(/\r?\n/).filter(Boolean);
  if (refs.length === 0) return null;

  const specs = refs.map((r) => `${r}:${relPath}`);
  let checkOut: string;
  try {
    checkOut = git(cwd, ['cat-file', '--batch-check'], `${specs.join('\n')}\n`);
  } catch {
    return null;
  }

  // One output line per input spec, in order. A present blob reports "<oid> blob <size>";
  // an absent one reports "<spec> missing".
  const lines = checkOut.split(/\r?\n/).filter(Boolean);
  for (let i = 0; i < lines.length && i < refs.length; i += 1) {
    const parts = lines[i].split(' ');
    if (parts.length === 3 && parts[1] === 'blob') {
      try {
        return { text: git(cwd, ['cat-file', 'blob', parts[0]]), ref: refs[i] };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Read a repo-relative org definition (e.g. `orgs/faceless-youtube/workflows/video-run.md`) from
 * wherever it actually lives in this repository. Throws `OrgDefNotFoundError` if nowhere.
 */
export function loadOrgDef(relPath: string): OrgDefSource {
  const root = localRepoRoot();
  const attempted: string[] = [];

  // 1. This worktree.
  const local = join(root, ...relPath.split('/'));
  attempted.push(`worktree-local: ${local}`);
  if (existsSync(local)) {
    return { text: normalize(readFileSync(local, 'utf8')), origin: local, via: 'worktree-local' };
  }

  // 2. Sibling worktrees of the same repo, per git itself. Live working-tree content.
  for (const wt of gitWorktreePaths(root)) {
    const candidate = join(wt, ...relPath.split('/'));
    if (candidate === local) continue;
    attempted.push(`worktree-sibling: ${candidate}`);
    if (existsSync(candidate)) {
      return {
        text: normalize(readFileSync(candidate, 'utf8')),
        origin: candidate,
        via: 'worktree-sibling',
      };
    }
  }

  // 3. The shared object database.
  attempted.push('git-ref: every ref in the shared object database (git cat-file)');
  const fromRef = readFromGitRefs(root, relPath);
  if (fromRef) {
    return { text: normalize(fromRef.text), origin: `git:${fromRef.ref}`, via: 'git-ref' };
  }

  // 4. Loud failure. Never a silent fallback.
  throw new OrgDefNotFoundError(relPath, attempted);
}

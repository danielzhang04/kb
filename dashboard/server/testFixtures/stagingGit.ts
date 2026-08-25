// P4 W6.1 (B1): the ONE shared stateful git fake that faithfully models staging for the durable
// publisher's staged-set proof. `routeDurable` proves the cached path set equals the manifest exactly
// (`branch.ts` `assertStagedSetMatches`, `git diff --cached --name-status -z`) — a security property
// (§3.2). A dumb fake that returns `''` for every subcommand reads as an EMPTY staged set != the
// manifest, so the proof throws and the route 500s. This helper records the paths passed to
// `add -- <paths>`, replays them as `A\0<path>\0…` for `--name-status`, and reports the same set as
// dirty for the pre/post `--name-only` clean checks; `commit`/`reset` clear the modelled index the way
// real git does, so a caller performing two saves in one test does not see the first save's paths.
import type { GitRunner } from '../write/branch.ts';

export interface StagingGitOptions {
  /** The branch `rev-parse --abbrev-ref HEAD` reports. Defaults to a work branch (never `ops`). */
  readonly branch?: string;
  /** Observe every invocation (args or repo root), for tests that assert on the git calls made. */
  readonly onCall?: (repoRoot: string, args: string[]) => void;
}

/**
 * A fresh stateful `GitRunner` fake. Each call gets its own modelled index, so tests must build one
 * per `buildApp`/surface rather than sharing a module-level instance.
 */
export function stagingGit(options: StagingGitOptions = {}): GitRunner {
  const branch = options.branch ?? 'claude/m1-dashboard';
  let staged: string[] = [];
  return (repoRoot: string, args: string[]): string => {
    options.onCall?.(repoRoot, args);
    const joined = args.join(' ');
    if (joined === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`;
    if (args[0] === 'add') {
      const separator = args.indexOf('--');
      const paths = (separator >= 0 ? args.slice(separator + 1) : args.slice(1)).filter((arg) => !arg.startsWith('-'));
      staged.push(...paths);
      return '';
    }
    // The pre-add clean check and any post-add re-check read the modelled index honestly.
    if (joined === 'diff --cached --name-only -z') {
      return staged.length === 0 ? '' : staged.map((path) => `${path}\0`).join('');
    }
    if (args[0] === 'diff' && args.includes('--cached') && args.includes('--name-status')) {
      return staged.length === 0 ? '' : staged.map((path) => `A\0${path}\0`).join('');
    }
    // A commit turns the index into history; a failed route unstages. Either way the index empties.
    if (args[0] === 'commit' || args[0] === 'reset') {
      staged = [];
      return '';
    }
    // `ls-files -s -z` (staged link-mode check), `push`, and everything else are no-ops here.
    return '';
  };
}

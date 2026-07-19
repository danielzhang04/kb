import { describe, expect, it, vi } from 'vitest';
import {
  classifyTarget,
  routeWrite,
  isProtectedBranch,
  ProtectedBranchError,
  CoordinationCheckoutError,
  DirtyIndexError,
  prepareCoordination,
  commitPreparedCoordination,
  DEFAULT_WORK_BRANCH,
  type GitRunner,
  type PrOpener,
  type PrRequest,
} from './branch.ts';

/** A recording git runner; each call is captured as its argv (after `git`). Never throws. */
function recorder(): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (_repoRoot, args) => {
    calls.push(args);
    if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
    return '';
  };
  return { runner, calls };
}

function prRecorder(): { opener: PrOpener; requests: PrRequest[] } {
  const requests: PrRequest[] = [];
  const opener: PrOpener = (_repoRoot, req) => {
    requests.push(req);
  };
  return { opener, requests };
}

describe('classifyTarget', () => {
  it('classifies queue/**, ledgers/**, traces/** as coordination', () => {
    expect(classifyTarget('queue/inbox/card-x.md')).toBe('coordination');
    expect(classifyTarget('queue/paused/dispatcher.md')).toBe('coordination');
    expect(classifyTarget('ledgers/audit/dashboard-audit.ndjson')).toBe('coordination');
    expect(classifyTarget('traces/card-x/index.html')).toBe('coordination');
  });

  it('classifies skills/**, docs/**, and other KB markdown as durable', () => {
    expect(classifyTarget('skills/curated/alpha-skill/SKILL.md')).toBe('durable');
    expect(classifyTarget('docs/plans/2026-07-16-dashboard-implementation.md')).toBe('durable');
    expect(classifyTarget('orgs/demo/_index.md')).toBe('durable');
  });
});

describe('routeWrite — durable content (skills/**, docs/**, KB markdown)', () => {
  it('routes to a work branch -> PR to main; NEVER pushes to ops, NEVER pushes directly to main', () => {
    const { runner, calls } = recorder();
    const { opener, requests } = prRecorder();

    const target = routeWrite('/fake/repo', 'skills/curated/alpha-skill/SKILL.md', {
      runGit: runner,
      openPr: opener,
      message: 'feat(skills): update alpha-skill',
    });

    expect(target).toBe('durable');

    // Staged the exact relpath, committed, pushed the work branch — never `git add .`.
    expect(calls[0]).toEqual(['diff', '--cached', '--name-only', '-z']);
    expect(calls[1]).toEqual(['add', '--', 'skills/curated/alpha-skill/SKILL.md']);
    expect(calls[2][0]).toBe('commit');
    expect(calls[2]).toContain('--only');
    expect(calls[2]).not.toContain('--no-verify');

    const pushCalls = calls.filter((c) => c[0] === 'push');
    expect(pushCalls).toHaveLength(1);
    // The push targets the work branch ref, never `ops`, never a direct push to `main`.
    expect(pushCalls[0].join(' ')).toContain(DEFAULT_WORK_BRANCH);
    expect(pushCalls[0].join(' ')).not.toContain('ops');
    expect(pushCalls[0]).not.toEqual(['push', 'origin', 'main']);
    expect(pushCalls[0].join(' ')).not.toMatch(/refs\/heads\/main\b/);

    // No `pull --rebase origin ops` — this is not a coordination write.
    expect(calls.some((c) => c.join(' ') === 'pull --rebase origin ops')).toBe(false);

    // A PR was opened to main, from the work branch — this is how durable content reaches main.
    expect(requests).toHaveLength(1);
    expect(requests[0].base).toBe('main');
    expect(requests[0].head).toBe(DEFAULT_WORK_BRANCH);
  });

  it('honors an explicit fresh work branch instead of the default', () => {
    const { runner, calls } = recorder();
    const { opener, requests } = prRecorder();

    routeWrite('/fake/repo', 'docs/notes.md', {
      runGit: runner,
      openPr: opener,
      workBranch: 'claude/fresh-branch',
    });

    expect(calls.some((c) => c.join(' ').includes('claude/fresh-branch'))).toBe(true);
    expect(requests[0].head).toBe('claude/fresh-branch');
    expect(requests[0].base).toBe('main');
  });
});

describe('branch denylist — durable content NEVER pushes to main/ops (defense in depth)', () => {
  it('isProtectedBranch matches main/ops case-insensitively, incl. refs/heads/ forms', () => {
    for (const b of ['main', 'ops', 'MAIN', 'Ops', 'refs/heads/main', 'refs/heads/OPS', ' main ', '/main']) {
      expect(isProtectedBranch(b), b).toBe(true);
    }
    for (const b of ['claude/m1-dashboard', 'claude/feature', 'maintenance', 'operations']) {
      expect(isProtectedBranch(b), b).toBe(false);
    }
  });

  it('routeWrite unit-rejects a durable push to main/ops directly — no git command runs at all', () => {
    for (const bad of ['main', 'ops', 'refs/heads/main']) {
      const { runner, calls } = recorder();
      const { opener, requests } = prRecorder();
      expect(() =>
        routeWrite('/fake/repo', 'docs/notes.md', { runGit: runner, openPr: opener, workBranch: bad }),
      ).toThrow(ProtectedBranchError);
      // Fails closed BEFORE any add/commit/push and before any PR is opened.
      expect(calls.filter((c) => c[0] === 'push')).toHaveLength(0);
      expect(calls).toHaveLength(0);
      expect(requests).toHaveLength(0);
    }
  });
});

describe('routeWrite — coordination files (queue/**, ledgers/**, traces/**, audit)', () => {
  it('routes to ops via pull --rebase -> add -> commit -> push, in that order', () => {
    const { runner, calls } = recorder();

    const target = routeWrite('/fake/repo', 'queue/inbox/card-new.md', { runGit: runner });

    expect(target).toBe('coordination');
    const verbs = calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual([
      'rev-parse --abbrev-ref',
      'pull --rebase',
      'rev-parse --abbrev-ref',
      'diff --cached',
      'add --',
      'commit -m',
      'push origin',
    ]);
    expect(calls[0]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[1]).toEqual(['pull', '--rebase', 'origin', 'ops']);
    expect(calls[2]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[3]).toEqual(['diff', '--cached', '--name-only', '-z']);
    expect(calls[4]).toEqual(['add', '--', 'queue/inbox/card-new.md']);
    expect(calls[6]).toEqual(['push', 'origin', 'ops']);
  });

  it('refuses pre-existing staged residue before adding or committing governed paths', () => {
    const calls: string[][] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args.join(' ') === 'diff --cached --name-only -z') return 'queue/inbox/stale.md\0';
      return '';
    };
    expect(() => routeWrite('/fake/repo', 'queue/inbox/new.md', { runGit: runner })).toThrow(DirtyIndexError);
    expect(calls.some((call) => call[0] === 'add' || call[0] === 'commit')).toBe(false);
  });

  it('re-reads (pull --rebase) and retries when the ops push is rejected', () => {
    const calls: string[][] = [];
    let pushes = 0;
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'push') {
        pushes += 1;
        if (pushes === 1) throw new Error('! [rejected] ops -> ops (fetch first)');
      }
      return '';
    };

    routeWrite('/fake/repo', 'ledgers/activity/2026-07-16.tsv', { runGit: runner });

    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    expect(calls[pushIdx[0] + 1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[pushIdx[0] + 2]).toEqual(['pull', '--rebase', 'origin', 'ops']);
  });

  it('never opens a PR for a coordination write', () => {
    const { runner } = recorder();
    const { opener, requests } = prRecorder();
    routeWrite('/fake/repo', 'traces/card-x/index.html', { runGit: runner, openPr: opener });
    expect(requests).toHaveLength(0);
  });

  it('re-runs caller authorization after a rejected push reconciles a newer ops head', () => {
    let pushes = 0;
    const onReconciled = vi.fn();
    const runner: GitRunner = (_repoRoot, args) => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'push' && pushes++ === 0) throw new Error('rejected');
      return '';
    };
    commitPreparedCoordination('/fake/repo', 'queue/inbox/card.md', { runGit: runner, onReconciled });
    expect(onReconciled).toHaveBeenCalledTimes(1);
  });

  it('can refuse a rejected push without rebasing a stale prepared coordination commit', () => {
    const calls: string[][] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'push') throw new Error('non-fast-forward');
      return '';
    };
    expect(() => commitPreparedCoordination('/fake/repo', 'queue/inbox/card.md', {
      runGit: runner,
      maxRetryPushes: 0,
    })).toThrow('non-fast-forward');
    expect(calls.filter((call) => call[0] === 'push')).toHaveLength(1);
    expect(calls.some((call) => call[0] === 'pull')).toBe(false);
  });

  it('fails closed on a non-ops or detached checkout before pull, add, commit, or push', () => {
    for (const branch of ['main', 'codex/dashboard-operational-surfaces', 'HEAD', '']) {
      const calls: string[][] = [];
      const runner: GitRunner = (_repoRoot, args) => {
        calls.push(args);
        return `${branch}\n`;
      };

      expect(() => routeWrite('/fake/repo', 'queue/inbox/card-new.md', { runGit: runner })).toThrow(
        CoordinationCheckoutError,
      );
      expect(calls).toEqual([['rev-parse', '--abbrev-ref', 'HEAD']]);
    }
  });

  it('re-checks ops after prepare and refuses an external branch switch before staging', () => {
    const calls: string[][] = [];
    let query = 0;
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') {
        query += 1;
        return query === 1 ? 'ops\n' : 'main\n';
      }
      return '';
    };

    prepareCoordination('/fake/repo', runner);
    expect(() =>
      commitPreparedCoordination('/fake/repo', 'queue/inbox/card-new.md', { runGit: runner }),
    ).toThrow(CoordinationCheckoutError);
    expect(calls).toEqual([
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      ['pull', '--rebase', 'origin', 'ops'],
      ['rev-parse', '--abbrev-ref', 'HEAD'],
    ]);
  });
});

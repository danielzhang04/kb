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
  createPreparedCoordinationCommit,
  publishPreparedCoordinationCommit,
  PublishedCoordinationCommitError,
  DEFAULT_WORK_BRANCH,
  type GitRunner,
  type PrOpener,
  type PrRequest,
} from './branch.ts';

/** A recording git runner; each call is captured as its argv (after `git`). Never throws. */
function recorder(branch = 'ops'): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (_repoRoot, args) => {
    calls.push(args);
    if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`;
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

describe('classifyTarget', async () => {
  it('classifies queue/**, ledgers/**, traces/** as coordination', async () => {
    expect(classifyTarget('queue/inbox/card-x.md')).toBe('coordination');
    expect(classifyTarget('./queue/inbox/card-x.md')).toBe('coordination');
    expect(classifyTarget('queue/paused/dispatcher.md')).toBe('coordination');
    expect(classifyTarget('ledgers/audit/dashboard-audit.ndjson')).toBe('coordination');
    expect(classifyTarget('traces/card-x/index.html')).toBe('coordination');
  });

  it('classifies skills/**, docs/**, and other KB markdown as durable', async () => {
    expect(classifyTarget('skills/curated/alpha-skill/SKILL.md')).toBe('durable');
    expect(classifyTarget('docs/plans/2026-07-16-dashboard-implementation.md')).toBe('durable');
    expect(classifyTarget('orgs/demo/_index.md')).toBe('durable');
  });

  it('does not classify a nested non-project STATE path as coordination', () => {
    expect(classifyTarget('orgs/kb-ops/archive/STATE.md')).toBe('durable');
  });
});

describe('publishPreparedCoordinationCommit', () => {
  const settlement = 'a'.repeat(40);
  const remote = 'b'.repeat(40);
  const paths = ['ledgers/audit/dashboard-audit.ndjson', 'queue/done/idea.md', 'queue/working/story.md'];

  it('does not return a locally committed settlement until origin/ops proves it reachable', async () => {
    const calls: string[][] = [];
    const markers: string[] = [];
    let candidateReachability = 0;
    const runner: GitRunner = (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'status --porcelain=v1 -z --untracked-files=all' || command === 'diff --cached --name-only -z') return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command.startsWith('diff-tree ')) return `${paths.join('\0')}\0`;
      if (command === 'fetch origin ops') return '';
      if (command === 'rev-parse refs/remotes/origin/ops') return `${remote}\n`;
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
        candidateReachability += 1;
        if (candidateReachability === 1) throw new Error('not published');
        return '';
      }
      if (command === `rev-list --count ${remote}..${settlement}`) return '1\n';
      return '';
    };
    await expect(publishPreparedCoordinationCommit('/fake/repo', settlement, {
      runGit: runner, relpaths: paths,
      assertAuthorized: () => { markers.push('authorized'); },
      validateCommit: () => { markers.push('validated'); },
    })).resolves.toBe(settlement);
    expect(calls.filter((args) => args[0] === 'push')).toEqual([[
      'push', 'origin', `${settlement}:refs/heads/ops`,
      `--force-with-lease=refs/heads/ops:${remote}`,
    ]]);
    expect(calls.filter((args) => args[0] === 'fetch')).toHaveLength(2);
    expect(markers).toEqual(['validated', 'authorized', 'authorized', 'authorized']);
  });

  it('treats a lost push response as a replay only after origin/ops already contains the exact commit', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'status --porcelain=v1 -z --untracked-files=all' || command === 'diff --cached --name-only -z') return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command.startsWith('diff-tree ')) return `${paths.join('\0')}\0`;
      if (command === 'fetch origin ops') return '';
      if (command === 'rev-parse refs/remotes/origin/ops') return `${remote}\n`;
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return '';
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(publishPreparedCoordinationCommit('/fake/repo', settlement, { runGit: runner, relpaths: paths }))
      .resolves.toBe(settlement);
    expect(calls.some((args) => args[0] === 'push')).toBe(false);
    expect(calls.filter((args) => args[0] === 'fetch')).toEqual([['fetch', 'origin', 'ops']]);
  });

  it('does not trim a whitespace-bearing Git filename into an authorized publish path', async () => {
    const runner: GitRunner = (_root, args) => {
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command.startsWith('diff-tree ')) return `${paths[0]} \0${paths.slice(1).join('\0')}\0`;
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(publishPreparedCoordinationCommit('/fake/repo', settlement, { runGit: runner, relpaths: paths }))
      .rejects.toThrow('unexpected path set');
  });

  /*
   * The coordination checkout is SHARED and its other writers publish with a bare `git push origin
   * ops`. A prepared commit left behind by a refused publish would be pushed later by an unrelated
   * save, carrying content no proof ever accepted — so a refusal must leave no unpublished prepared
   * commit behind.
   */
  it('rolls the prepared commit back when the publish is refused', async () => {
    const parent = 'd'.repeat(40);
    const calls: string[][] = [];
    const runner: GitRunner = (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command === `rev-parse ${settlement}^`) return `${parent}\n`;
      if (command.startsWith('diff-tree ')) return `${paths.join('\0')}\0`;
      if (command === 'fetch origin ops') return '';
      if (command === 'rev-parse refs/remotes/origin/ops') return `${remote}\n`;
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor' && args[2] === settlement) throw new Error('not published');
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return '';
      // A pre-existing unpushed ops commit sits under the settlement.
      if (command === `rev-list --count ${remote}..${settlement}`) return '2\n';
      if (command === `reset --hard ${parent}`) return '';
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(publishPreparedCoordinationCommit('/fake/repo', settlement, { runGit: runner, relpaths: paths }))
      .rejects.toThrow('sole unpublished commit');
    expect(calls.some((args) => args[0] === 'push')).toBe(false);
    expect(calls.filter((args) => args[0] === 'reset')).toEqual([['reset', '--hard', parent]]);
  });

  it('rolls back a commit refused by the content proof, before any remote contact', async () => {
    const parent = 'd'.repeat(40);
    const calls: string[][] = [];
    const runner: GitRunner = (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command === `rev-parse ${settlement}^`) return `${parent}\n`;
      if (command.startsWith('diff-tree ')) return `${paths.join('\0')}\0`;
      if (command === 'rev-parse refs/remotes/origin/ops') return `${remote}\n`;
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') throw new Error('not published');
      if (command === `reset --hard ${parent}`) return '';
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(publishPreparedCoordinationCommit('/fake/repo', settlement, {
      runGit: runner, relpaths: paths,
      validateCommit: () => { throw new Error('committed card blob differs'); },
    })).rejects.toThrow('committed card blob differs');
    expect(calls.some((args) => args[0] === 'push' || args[0] === 'fetch')).toBe(false);
    expect(calls.filter((args) => args[0] === 'reset')).toEqual([['reset', '--hard', parent]]);
  });

  it('never rewrites history it does not own: a dirty checkout or a foreign HEAD is left alone', async () => {
    const dirtyCalls: string[][] = [];
    const dirtyRunner: GitRunner = (_root, args) => {
      dirtyCalls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z') return '';
      if (command.startsWith('status ')) return 'queue/inbox/other.md\0';
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(publishPreparedCoordinationCommit('/fake/repo', settlement, { runGit: dirtyRunner, relpaths: paths }))
      .rejects.toThrow('working tree has 1 changed entry');
    expect(dirtyCalls.some((args) => args[0] === 'reset')).toBe(false);

    const foreignCalls: string[][] = [];
    const foreignRunner: GitRunner = (_root, args) => {
      foreignCalls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${remote}\n`;
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(publishPreparedCoordinationCommit('/fake/repo', settlement, { runGit: foreignRunner, relpaths: paths }))
      .rejects.toThrow('local ops HEAD is not the prepared commit');
    expect(foreignCalls.some((args) => args[0] === 'reset')).toBe(false);
  });

  /*
   * THE ONE-WAY DOOR. `refs/remotes/origin/ops` is a CACHED view, so a confirming fetch that flakes
   * right after a successful push leaves it pointing at the pre-push remote — an ancestry probe there
   * "proves" the commit unpublished and would rewind ops while the remote already holds it. Once a
   * push exits 0 nothing is rewound and the failure is raised as durable-or-unknown, never a refusal.
   */
  function postPushRunner(calls: string[][], failAfterPush: () => void): GitRunner {
    let pushes = 0;
    return (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command === `rev-parse ${settlement}^`) return `${'d'.repeat(40)}\n`;
      if (command.startsWith('diff-tree ')) return `${paths.join('\0')}\0`;
      if (command === 'fetch origin ops') {
        if (pushes > 0) failAfterPush();
        return '';
      }
      if (command === 'rev-parse refs/remotes/origin/ops') return `${remote}\n`;
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor' && args[2] === settlement) throw new Error('not published');
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return '';
      if (command === `rev-list --count ${remote}..${settlement}`) return '1\n';
      if (args[0] === 'push') { pushes += 1; return ''; }
      throw new Error(`unexpected git invocation: ${command}`);
    };
  }

  it('never rewinds after a successful push when the confirming fetch fails', async () => {
    const calls: string[][] = [];
    const runner = postPushRunner(calls, () => { throw new Error('fetch: connection reset'); });
    const failure = await publishPreparedCoordinationCommit('/fake/repo', settlement, {
      runGit: runner, relpaths: paths,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PublishedCoordinationCommitError);
    expect((failure as PublishedCoordinationCommitError).commit).toBe(settlement);
    expect((failure as PublishedCoordinationCommitError).published).toBe(true);
    expect(calls.filter((args) => args[0] === 'push')).toHaveLength(1);
    expect(calls.some((args) => args[0] === 'reset')).toBe(false);
  });

  it('never rewinds after a successful push when the authorization re-check throws', async () => {
    const calls: string[][] = [];
    let pushed = false;
    const runner: GitRunner = (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command === `rev-parse ${settlement}^`) return `${'d'.repeat(40)}\n`;
      if (command.startsWith('diff-tree ')) return `${paths.join('\0')}\0`;
      if (command === 'fetch origin ops') return '';
      if (command === 'rev-parse refs/remotes/origin/ops') return `${remote}\n`;
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor' && args[2] === settlement) throw new Error('not published');
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return '';
      if (command === `rev-list --count ${remote}..${settlement}`) return '1\n';
      if (args[0] === 'push') { pushed = true; return ''; }
      throw new Error(`unexpected git invocation: ${command}`);
    };
    const failure = await publishPreparedCoordinationCommit('/fake/repo', settlement, {
      runGit: runner, relpaths: paths,
      assertAuthorized: () => { if (pushed) throw new Error('passkey latch changed'); },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PublishedCoordinationCommitError);
    expect((failure as PublishedCoordinationCommitError).message).toBe('passkey latch changed');
    expect(calls.filter((args) => args[0] === 'push')).toHaveLength(1);
    expect(calls.some((args) => args[0] === 'reset')).toBe(false);
  });

  it('keeps a failed push inside the bounded retry instead of escaping through an auth re-check', async () => {
    const calls: string[][] = [];
    let authorizationChecks = 0;
    const runner: GitRunner = (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command === `rev-parse ${settlement}^`) return `${'d'.repeat(40)}\n`;
      if (command.startsWith('diff-tree ')) return `${paths.join('\0')}\0`;
      if (command === 'fetch origin ops') return '';
      if (command === 'rev-parse refs/remotes/origin/ops') return `${remote}\n`;
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor' && args[2] === settlement) throw new Error('not published');
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return '';
      if (command === `rev-list --count ${remote}..${settlement}`) return '1\n';
      if (args[0] === 'push') throw new Error('push rejected: stale lease');
      if (command === `reset --hard ${'d'.repeat(40)}`) return '';
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(publishPreparedCoordinationCommit('/fake/repo', settlement, {
      runGit: runner, relpaths: paths, maxRetryPushes: 2,
      // A push failure never reports an auth re-check instead of itself; the loop head re-proves
      // authorization before the next attempt touches git again.
      assertAuthorized: () => { authorizationChecks += 1; },
    })).rejects.toThrow('push rejected: stale lease');
    expect(calls.filter((args) => args[0] === 'push')).toHaveLength(3);
    expect(authorizationChecks).toBe(3);
    // Nothing durable was ever accepted, so the strand-prevention rollback still applies.
    expect(calls.filter((args) => args[0] === 'reset')).toEqual([['reset', '--hard', 'd'.repeat(40)]]);
  });
});

describe('createPreparedCoordinationCommit', () => {
  const commit = 'c'.repeat(40);
  const paths = ['ledgers/audit/dashboard-audit.ndjson', 'queue/done/idea.md'];

  it('continues after a crash left exactly the authorized index staged', async () => {
    let staged: string[] = [];
    const runner: GitRunner = (_root, args) => {
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only --no-renames -z') return staged.length ? `${staged.join('\0')}\0` : '';
      if (command === 'diff --cached --name-only -z') return '';
      if (args[0] === 'add') { staged = [...paths].sort(); return ''; }
      if (args[0] === 'commit') { staged = []; return ''; }
      if (command === 'rev-parse HEAD') return `${commit}\n`;
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(createPreparedCoordinationCommit('/fake/repo', paths, {
      runGit: runner, message: 'test settlement', afterStage: () => { throw new Error('crash after add'); },
    })).rejects.toThrow('crash after add');
    await expect(createPreparedCoordinationCommit('/fake/repo', paths, { runGit: runner, message: 'test settlement' }))
      .resolves.toBe(commit);
  });

  it('refuses an index containing any path beyond the authorized set', async () => {
    const runner: GitRunner = (_root, args) => {
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only --no-renames -z') {
        return `${[...paths, 'queue/inbox/unrelated.md'].sort().join('\0')}\0`;
      }
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(createPreparedCoordinationCommit('/fake/repo', paths, { runGit: runner, message: 'test settlement' }))
      .rejects.toThrow(DirtyIndexError);
  });

  it('does not trim a whitespace-bearing staged filename into the authorized set', async () => {
    const runner: GitRunner = (_root, args) => {
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only --no-renames -z') {
        return `${paths[0]} \0${paths[1]}\0`;
      }
      throw new Error(`unexpected git invocation: ${command}`);
    };
    await expect(createPreparedCoordinationCommit('/fake/repo', paths, { runGit: runner, message: 'test settlement' }))
      .rejects.toThrow(DirtyIndexError);
  });
});

describe('routeWrite — durable content (skills/**, docs/**, KB markdown)', async () => {
  it('routes to a work branch -> PR to main; NEVER pushes to ops, NEVER pushes directly to main', async () => {
    const { runner, calls } = recorder(DEFAULT_WORK_BRANCH);
    const { opener, requests } = prRecorder();

    const target = await routeWrite('/fake/repo', 'skills/curated/alpha-skill/SKILL.md', {
      runGit: runner,
      openPr: opener,
      message: 'feat(skills): update alpha-skill',
    });

    expect(target).toBe('durable');

    // Staged the exact relpath, committed, pushed the work branch — never `git add .`.
    expect(calls[0]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[1]).toEqual(['diff', '--cached', '--name-only', '-z']);
    expect(calls[2]).toEqual(['add', '--', 'skills/curated/alpha-skill/SKILL.md']);
    expect(calls[3][0]).toBe('commit');
    expect(calls[3]).not.toContain('--only');
    expect(calls[3]).not.toContain('--no-verify');

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

  it('honors an explicit fresh work branch instead of the default', async () => {
    const { runner, calls } = recorder('claude/fresh-branch');
    const { opener, requests } = prRecorder();

    await routeWrite('/fake/repo', 'docs/notes.md', {
      runGit: runner,
      openPr: opener,
      workBranch: 'claude/fresh-branch',
    });

    expect(calls.some((c) => c.join(' ').includes('claude/fresh-branch'))).toBe(true);
    expect(requests[0].head).toBe('claude/fresh-branch');
    expect(requests[0].base).toBe('main');
  });

  it('unstages the requested path and hook-generated mirrors when commit fails', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return `${DEFAULT_WORK_BRANCH}\n`;
      if (args[0] === 'commit') throw new Error('pre-commit rejected generated mirror drift');
      return '';
    };

    await expect(routeWrite('/fake/repo', 'skills/curated/alpha-skill/SKILL.md', {
      runGit: runner,
      openPr: prRecorder().opener,
    })).rejects.toMatchObject({ committed: false, pushed: false });

    expect(calls.at(-1)).toEqual(['reset', 'HEAD', '--', '.']);
    expect(calls.some((call) => call[0] === 'push')).toBe(false);
  });
});

describe('branch denylist — durable content NEVER pushes to main/ops (defense in depth)', async () => {
  it('isProtectedBranch matches main/ops case-insensitively, incl. refs/heads/ forms', async () => {
    for (const b of ['main', 'ops', 'MAIN', 'Ops', 'refs/heads/main', 'refs/heads/OPS', ' main ', '/main']) {
      expect(isProtectedBranch(b), b).toBe(true);
    }
    for (const b of ['claude/m1-dashboard', 'claude/feature', 'maintenance', 'operations']) {
      expect(isProtectedBranch(b), b).toBe(false);
    }
  });

  it('routeWrite unit-rejects a durable push to main/ops directly — no git command runs at all', async () => {
    for (const bad of ['main', 'ops', 'refs/heads/main']) {
      const { runner, calls } = recorder();
      const { opener, requests } = prRecorder();
      await expect(
        routeWrite('/fake/repo', 'docs/notes.md', { runGit: runner, openPr: opener, workBranch: bad }),
      ).rejects.toThrow(ProtectedBranchError);
      // Fails closed BEFORE any add/commit/push and before any PR is opened.
      expect(calls.filter((c) => c[0] === 'push')).toHaveLength(0);
      expect(calls).toHaveLength(0);
      expect(requests).toHaveLength(0);
    }
  });
});

describe('routeWrite — coordination files (queue/**, ledgers/**, traces/**, audit)', async () => {
  it.each([
    'memory/codex-worker.md',
    'dashboards/executive.md',
    'handoffs/2026-08-11-cutover.md',
    'orgs/kb-ops/STATE.md',
  ])('publishes %s with the ops pull-rebase-push route', async (relpath) => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'ops\n';
      if (args[0] === 'diff' || args[0] === 'status') return '';
      return '';
    };
    const openPr = vi.fn();
    await expect(routeWrite('/repo', relpath, { runGit, openPr })).resolves.toBe('coordination');
    expect(calls).toContainEqual(['pull', '--rebase', 'origin', 'ops']);
    expect(calls).toContainEqual(['push', 'origin', 'ops']);
    expect(openPr).not.toHaveBeenCalled();
  });

  it('routes to ops via pull --rebase -> add -> commit -> push, in that order', async () => {
    const { runner, calls } = recorder();

    const target = await routeWrite('/fake/repo', 'queue/inbox/card-new.md', { runGit: runner });

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

  it('refuses pre-existing staged residue before adding or committing governed paths', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args.join(' ') === 'diff --cached --name-only -z') return 'queue/inbox/stale.md\0';
      return '';
    };
    await expect(routeWrite('/fake/repo', 'queue/inbox/new.md', { runGit: runner })).rejects.toThrow(DirtyIndexError);
    expect(calls.some((call) => call[0] === 'add' || call[0] === 'commit')).toBe(false);
  });

  it('re-reads (pull --rebase) and retries when the ops push is rejected', async () => {
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

    await routeWrite('/fake/repo', 'ledgers/activity/2026-07-16.tsv', { runGit: runner });

    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    expect(calls[pushIdx[0] + 1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[pushIdx[0] + 2]).toEqual(['pull', '--rebase', 'origin', 'ops']);
  });

  it('never opens a PR for a coordination write', async () => {
    const { runner } = recorder();
    const { opener, requests } = prRecorder();
    await routeWrite('/fake/repo', 'traces/card-x/index.html', { runGit: runner, openPr: opener });
    expect(requests).toHaveLength(0);
  });

  it('re-runs caller authorization after a rejected push reconciles a newer ops head', async () => {
    let pushes = 0;
    const onReconciled = vi.fn();
    const runner: GitRunner = (_repoRoot, args) => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'push' && pushes++ === 0) throw new Error('! [rejected] ops -> ops (non-fast-forward)');
      return '';
    };
    await commitPreparedCoordination('/fake/repo', 'queue/inbox/card.md', { runGit: runner, onReconciled });
    expect(onReconciled).toHaveBeenCalledTimes(1);
  });

  it('a SLOW async runner does not corrupt the push retry loop: every step stays strictly ordered', async () => {
    // The whole point of the async conversion is that a network-slow git no longer freezes the loop.
    // A runner whose every call resolves on a later macrotask (real spawn latency) must still produce
    // the exact prepare/stage/commit/push/reconcile/re-push order — the awaits serialize it correctly,
    // and a retry is never interleaved with the next step.
    const calls: string[][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let pushes = 0;
    const slowRunner: GitRunner = (_repoRoot, args) =>
      new Promise<string>((resolvePromise, reject) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          calls.push(args);
          if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return resolvePromise('ops\n');
          if (args[0] === 'push') {
            pushes += 1;
            if (pushes === 1) return reject(new Error('! [rejected] ops -> ops (fetch first)'));
          }
          resolvePromise('');
        }, 5);
      });

    await commitPreparedCoordination('/fake/repo', 'queue/inbox/card.md', { runGit: slowRunner });

    // No two git calls ever overlapped — each awaited the previous to fully settle.
    expect(maxInFlight).toBe(1);
    // Exactly the prepared-commit sequence, with the rejected push driving one reconcile before re-push.
    const verbs = calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual([
      'rev-parse --abbrev-ref', // commitPrepared re-proves the ops checkout
      'diff --cached',          // clean-index guard
      'add --',
      'commit -m',
      'push origin',            // first push — rejected
      'rev-parse --abbrev-ref', // retry re-proves the checkout before pulling
      'pull --rebase',
      'push origin',            // second push — succeeds
    ]);
    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    // The reconciling pull sits strictly between the two pushes — never before the first, never after the second.
    expect(calls[pushIdx[0] + 2]).toEqual(['pull', '--rebase', 'origin', 'ops']);
    expect(pushIdx[1]).toBeGreaterThan(pushIdx[0]);
  });

  it('can refuse a rejected push without rebasing a stale prepared coordination commit', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args[0] === 'push') throw new Error('non-fast-forward');
      return '';
    };
    await expect(commitPreparedCoordination('/fake/repo', 'queue/inbox/card.md', {
      runGit: runner,
      maxRetryPushes: 0,
    })).rejects.toThrow('non-fast-forward');
    expect(calls.filter((call) => call[0] === 'push')).toHaveLength(1);
    expect(calls.some((call) => call[0] === 'pull')).toBe(false);
  });

  it('fails closed on a non-ops or detached checkout before pull, add, commit, or push', async () => {
    for (const branch of ['main', 'codex/dashboard-operational-surfaces', 'HEAD', '']) {
      const calls: string[][] = [];
      const runner: GitRunner = (_repoRoot, args) => {
        calls.push(args);
        return `${branch}\n`;
      };

      await expect(routeWrite('/fake/repo', 'queue/inbox/card-new.md', { runGit: runner })).rejects.toThrow(
        CoordinationCheckoutError,
      );
      expect(calls).toEqual([['rev-parse', '--abbrev-ref', 'HEAD']]);
    }
  });

  it('re-checks ops after prepare and refuses an external branch switch before staging', async () => {
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

    await prepareCoordination('/fake/repo', runner);
    await expect(
      commitPreparedCoordination('/fake/repo', 'queue/inbox/card-new.md', { runGit: runner }),
    ).rejects.toThrow(CoordinationCheckoutError);
    expect(calls).toEqual([
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      ['pull', '--rebase', 'origin', 'ops'],
      ['rev-parse', '--abbrev-ref', 'HEAD'],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyTarget,
  routeWrite,
  DEFAULT_WORK_BRANCH,
  type GitRunner,
  type PrOpener,
  type PrRequest,
} from './branch';

/** A recording git runner; each call is captured as its argv (after `git`). Never throws. */
function recorder(): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (_repoRoot, args) => {
    calls.push(args);
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
    expect(calls[0]).toEqual(['add', '--', 'skills/curated/alpha-skill/SKILL.md']);
    expect(calls[1][0]).toBe('commit');
    expect(calls[1]).not.toContain('--no-verify');

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

describe('routeWrite — coordination files (queue/**, ledgers/**, traces/**, audit)', () => {
  it('routes to ops via pull --rebase -> add -> commit -> push, in that order', () => {
    const { runner, calls } = recorder();

    const target = routeWrite('/fake/repo', 'queue/inbox/card-new.md', { runGit: runner });

    expect(target).toBe('coordination');
    const verbs = calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual(['pull --rebase', 'add --', 'commit -m', 'push origin']);
    expect(calls[0]).toEqual(['pull', '--rebase', 'origin', 'ops']);
    expect(calls[1]).toEqual(['add', '--', 'queue/inbox/card-new.md']);
    expect(calls[3]).toEqual(['push', 'origin', 'ops']);
  });

  it('re-reads (pull --rebase) and retries when the ops push is rejected', () => {
    const calls: string[][] = [];
    let pushes = 0;
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args[0] === 'push') {
        pushes += 1;
        if (pushes === 1) throw new Error('! [rejected] ops -> ops (fetch first)');
      }
      return '';
    };

    routeWrite('/fake/repo', 'ledgers/activity/2026-07-16.tsv', { runGit: runner });

    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    expect(calls[pushIdx[0] + 1]).toEqual(['pull', '--rebase', 'origin', 'ops']);
  });

  it('never opens a PR for a coordination write', () => {
    const { runner } = recorder();
    const { opener, requests } = prRecorder();
    routeWrite('/fake/repo', 'traces/card-x/index.html', { runGit: runner, openPr: opener });
    expect(requests).toHaveLength(0);
  });
});

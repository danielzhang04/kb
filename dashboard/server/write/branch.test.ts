import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  publishVerifiedScheduleMarkerRemoval,
  DEFAULT_WORK_BRANCH,
  routeDurable,
  resolveBaseCommit,
  createPersistentRouteReceipts,
  routeReceiptStorePath,
  DurableRouteError,
  DurableReplayConflictError,
  type RouteOptions,
  type RouteReceiptStore,
  type StoredRouteReceipt,
  type GitRunner,
  type PrOpener,
  type PrRequest,
} from './branch.ts';
import { derivedDurableBranch, scheduleMirrorOperationKey, type DurablePathManifest } from './durableManifest.ts';
import { PUBLISHER_PERMITTED_SUBCOMMANDS } from './asyncGit.ts';

const MIGRATION_FIXTURES = resolve(import.meta.dirname, '../control/__fixtures__/dv3');
const MARKER_GOLDEN = readdirSync(MIGRATION_FIXTURES).map((name) => {
  try { return JSON.parse(readFileSync(resolve(MIGRATION_FIXTURES, name), 'utf8')) as Record<string, unknown>; } catch { return {}; }
}).find((value) => Array.isArray(value.markers))?.markers as Array<{ marker: string }>;

/** The HEAD every recorder reports — P4 manifests pin a real base commit (§3.2). */
const FAKE_HEAD = 'a'.repeat(40);

/**
 * A recording git runner; each call is captured as its argv (after `git`). Never throws.
 *
 * P4 W2 contract change: the publisher now pins a base commit and proves its exact cached set, so the
 * recorder answers `rev-parse HEAD` with a real sha and replays the paths it saw staged when asked for
 * `diff --cached --name-status`. `--name-only` (the clean-index probe, always issued BEFORE staging)
 * still answers empty.
 */
function recorder(branch = 'ops', head = FAKE_HEAD): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const staged: string[] = [];
  const runner: GitRunner = (_repoRoot, args) => {
    calls.push(args);
    const joined = args.join(' ');
    if (joined === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`;
    if (joined === 'rev-parse HEAD') return `${head}\n`;
    if (args[0] === 'add' && args[1] === '--') staged.push(...args.slice(2));
    if (joined === 'diff --cached --name-status -z') {
      return staged.map((path) => `M\0${path}\0`).join('');
    }
    // The post-`add` staged-object reads: every entry a plain blob, records at the batch's state.
    if (args[0] === 'ls-files') return staged.map((path) => `100644 ${'b'.repeat(40)} 0\t${path}\0`).join('');
    if (args[0] === 'show') return IMPLEMENTED_RECORD;
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

describe('verified legacy Schedule marker publication', () => {
  it('refuses removal when the marker digest changed after discovery', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'schedule-marker-digest-'));
    const marker = MARKER_GOLDEN[0].marker;
    const absolute = join(repoRoot, ...marker.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, 'changed bytes', 'utf8');
    try {
      await expect(publishVerifiedScheduleMarkerRemoval(repoRoot, marker, 'a'.repeat(64), {
        prepare: vi.fn(), commit: vi.fn(),
      })).rejects.toThrow('pause-marker-digest-changed');
      expect(existsSync(absolute)).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('resumes publication on the next startup after a crash immediately after unlink', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'schedule-marker-resume-'));
    const marker = MARKER_GOLDEN[0].marker;
    const absolute = join(repoRoot, ...marker.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    const bytes = Buffer.from('legacy marker bytes');
    writeFileSync(absolute, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const prepare = vi.fn(async () => undefined);
    const commit = vi.fn(async () => undefined);
    try {
      await expect(publishVerifiedScheduleMarkerRemoval(repoRoot, marker, digest, {
        prepare, commit, afterUnlink: async () => { throw new Error('crash-after-unlink'); },
      })).rejects.toThrow('crash-after-unlink');
      expect(existsSync(absolute)).toBe(false);
      expect(commit).not.toHaveBeenCalled();

      await publishVerifiedScheduleMarkerRemoval(repoRoot, marker, digest, { prepare, commit });
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(repoRoot, marker);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('publishPreparedCoordinationCommit', () => {
  const settlement = 'a'.repeat(40);
  const remote = 'b'.repeat(40);
  const paths = ['ledgers/audit/dashboard-audit.ndjson', 'queue/done/idea.md', 'queue/working/story.md'];

  it('spools a prepared commit without fetching or pushing in outbox mode', async () => {
    const parent = 'c'.repeat(40);
    const calls: string[][] = [];
    const outboxRoot = mkdtempSync(join(tmpdir(), 'prepared-outbox-'));
    const runner: GitRunner = async (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command === 'rev-parse --verify refs/kb-outbox/spooled') return `${parent}\n`;
      if (command === `rev-list --reverse ${parent}..HEAD`) return `${settlement}\n`;
      if (command === `rev-list --parents -n 1 ${settlement}`) return `${settlement} ${parent}\n`;
      if (args[0] === 'diff-tree') return `${paths.join('\0')}\0`;
      if (args[0] === 'bundle') { writeFileSync(args[2], 'bundle'); return ''; }
      if (args[0] === 'update-ref') return '';
      throw new Error(`unexpected git invocation: ${command}`);
    };

    await expect(publishPreparedCoordinationCommit('/fake/repo', settlement, {
      runGit: runner,
      relpaths: paths,
      publication: 'outbox',
      outboxRoot,
    })).resolves.toBe(settlement);
    expect(calls.some((args) => args[0] === 'fetch' || args[0] === 'pull' || args[0] === 'push')).toBe(false);
    expect(calls).toContainEqual(['update-ref', 'refs/kb-outbox/spooled', settlement, parent]);
  });

  it('reports an outbox recovery failure after the publication boundary as durability unknown', async () => {
    const parent = 'c'.repeat(40);
    const calls: string[][] = [];
    const outboxRoot = mkdtempSync(join(tmpdir(), 'published-outbox-error-'));
    const runner: GitRunner = async (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${settlement}\n`;
      if (command === 'rev-parse --verify refs/kb-outbox/spooled') return `${parent}\n`;
      if (command === `rev-list --reverse ${parent}..HEAD`) return `${settlement}\n`;
      if (command === `rev-list --parents -n 1 ${settlement}`) return `${settlement} ${parent}\n`;
      if (args[0] === 'diff-tree') return `${paths.join('\0')}\0`;
      if (args[0] === 'update-ref') return '';
      if (args[0] === 'bundle') throw new Error('outbox is full');
      throw new Error(`unexpected git invocation: ${command}`);
    };

    const failure = await publishPreparedCoordinationCommit('/fake/repo', settlement, {
      runGit: runner,
      relpaths: paths,
      publication: 'outbox',
      outboxRoot,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PublishedCoordinationCommitError);
    expect((failure as PublishedCoordinationCommitError).commit).toBe(settlement);
    expect(calls.some((args) => args[0] === 'reset')).toBe(false);
  });

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
    // P4 W2: the publisher proves the exact cached set, and that git staged no link, before it creates
    // any history (plan 3.2).
    expect(calls[3]).toEqual(['diff', '--cached', '--name-status', '-z']);
    expect(calls[4]).toEqual(['ls-files', '-s', '-z', '--', 'skills/curated/alpha-skill/SKILL.md']);
    expect(calls[5][0]).toBe('commit');
    expect(calls[5]).not.toContain('--only');
    expect(calls[5]).not.toContain('--no-verify');

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
  it('outbox preparation never fetches, pulls, or pushes', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'ops\n';
      if (args.join(' ') === 'rev-parse --verify refs/kb-outbox/spooled') return `${'a'.repeat(40)}\n`;
      if (args[0] === 'rev-list') return '';
      if (args[0] === 'diff') return '';
      return '';
    };
    await prepareCoordination('/fake/repo', runner, 'outbox', '/spool');
    expect(calls.flat()).not.toEqual(expect.arrayContaining(['fetch', 'pull', 'push']));
  });

  it('recovers before a prepared write, then spools the new commit without remote publication', async () => {
    const parent = 'a'.repeat(40);
    const commit = 'b'.repeat(40);
    const relpath = 'queue/inbox/card.md';
    const outboxRoot = mkdtempSync(join(tmpdir(), 'commit-outbox-'));
    const calls: string[][] = [];
    let committed = false;
    const runner: GitRunner = async (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'rev-parse --verify refs/kb-outbox/spooled') return `${parent}\n`;
      if (command === `rev-list --reverse ${parent}..HEAD`) return committed ? `${commit}\n` : '';
      if (command === 'diff --cached --name-only -z') return '';
      if (args[0] === 'add') return '';
      if (args[0] === 'commit') { committed = true; return ''; }
      if (command === 'rev-parse HEAD') return `${commit}\n`;
      if (command === `rev-list --parents -n 1 ${commit}`) return `${commit} ${parent}\n`;
      if (args[0] === 'diff-tree') return `${relpath}\0`;
      if (args[0] === 'bundle') { writeFileSync(args[2], 'bundle'); return ''; }
      if (args[0] === 'update-ref') return '';
      throw new Error(`unexpected git invocation: ${command}`);
    };

    await commitPreparedCoordination('/fake/repo', relpath, {
      runGit: runner,
      publication: 'outbox',
      outboxRoot,
    });

    expect(calls.some((args) => ['fetch', 'pull', 'push'].includes(args[0]))).toBe(false);
    expect(calls).toContainEqual(['update-ref', 'refs/kb-outbox/spooled', commit, parent]);
  });

  it('refuses a non-coordination path before creating an outbox commit', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      throw new Error(`unexpected git invocation: ${args.join(' ')}`);
    };

    await expect(commitPreparedCoordination('/fake/repo', 'docs/not-coordination.md', {
      runGit: runner,
      publication: 'outbox',
      outboxRoot: '/spool',
    })).rejects.toThrow('outbox refuses a non-coordination path: docs/not-coordination.md');
    expect(calls).toEqual([['rev-parse', '--abbrev-ref', 'HEAD']]);
  });

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

/* -- P4 W2: the one durable publisher over a manifest (plan 3.2, 5 W2 row) -- */

const P4_BASE = 'a'.repeat(40);
const P4_MERGE = 'd'.repeat(40);

function p4Manifest(overrides: Partial<DurablePathManifest> = {}): DurablePathManifest {
  return {
    schema: 'kb.durable-path-manifest/v1',
    operationKey: 'learning-implementation:learn-0123456789abcdef01234567',
    purpose: 'learning-implementation',
    baseCommit: P4_BASE,
    relpaths: ['agents/alpha.md', 'docs/proposals/learnings/2026-08-20-lessons-miner-run_01HXYZ-01.md'],
    ...overrides,
  } as DurablePathManifest;
}

/** A rendered record: the closed frontmatter block first, then the inert body the wall must ignore. */
const IMPLEMENTED_RECORD = [
  '---',
  'schema: kb.learning-proposal/v1',
  'status: implemented',
  'batch-id: learn-0123456789abcdef01234567',
  'implemented-at: 2026-08-20T06:00:00Z',
  '---',
  '',
  '## Evidence',
  '- memory/lessons-miner.md: 2026-08-20 run_01HXYZ',
].join('\n');

const P4_BATCH = {
  batchId: 'learn-0123456789abcdef01234567',
  implementedAt: '2026-08-20T06:00:00Z',
  targetPaths: ['agents/alpha.md'],
  recordPaths: ['docs/proposals/learnings/2026-08-20-lessons-miner-run_01HXYZ-01.md'],
};

const PINNED_PR = { owner: 'kb-owner', repo: 'kb', number: 42, url: 'https://github.com/kb-owner/kb/pull/42' };

function freshReceipts(): RouteReceiptStore {
  const store = new Map<string, StoredRouteReceipt>();
  return { get: (key) => store.get(key), put: (key, value) => { store.set(key, value); } };
}

function p4Options(overrides: Partial<RouteOptions> = {}): RouteOptions {
  return {
    learningBatch: P4_BATCH,
    lstatPath: async () => ({ exists: true, isFile: true, isSymbolicLink: false }),
    readPathBytes: async () => IMPLEMENTED_RECORD,
    openPr: () => PINNED_PR,
    receipts: freshReceipts(),
    repoPin: { owner: 'kb-owner', repo: 'kb' },
    ...overrides,
  };
}

describe('routeDurable - PR mode over a manifest', () => {
  it('derives the head branch from the operation key, stages the exact set, and returns the pinned PR receipt', async () => {
    const manifest = p4Manifest();
    const git = recorder(derivedDurableBranch(manifest)!);
    const receipt = await routeDurable('/fake/repo', manifest, p4Options({ runGit: git.runner }));
    expect(receipt).toEqual({ mode: 'pr', branch: derivedDurableBranch(manifest), pr: PINNED_PR });
    expect(receipt.branch).toMatch(/^dv3-p4\/learning-implementation-[0-9a-f]{16}$/);
    const joined = git.calls.map((call) => call.join(' '));
    expect(joined).toContain(`add -- ${manifest.relpaths.join(' ')}`);
    expect(joined).toContain(`push origin HEAD:refs/heads/${receipt.branch}`);
    // A caller-supplied work branch can never override a derived head.
    const override = recorder(derivedDurableBranch(manifest)!);
    const overridden = await routeDurable('/fake/repo', manifest,
      p4Options({ runGit: override.runner, workBranch: 'claude/attacker' }));
    expect(overridden.branch).toBe(derivedDurableBranch(manifest));
  });

  it('refuses a thirty-third path and an off-purpose path before any git call', async () => {
    const git = recorder();
    const thirtyThree = Array.from({ length: 33 }, (_v, index) => `agents/a${String(index).padStart(2, '0')}.md`);
    await expect(routeDurable('/fake/repo', p4Manifest({ relpaths: thirtyThree }), p4Options({ runGit: git.runner })))
      .rejects.toThrow(/at most 32 paths/);
    await expect(routeDurable('/fake/repo', p4Manifest({ relpaths: ['memory/lessons-miner.md'] }), p4Options({ runGit: git.runner })))
      .rejects.toThrow(/rejects/);
    expect(git.calls).toEqual([]);
  });

  it('refuses when the cached set does not equal the manifest, and creates no commit', async () => {
    const manifest = p4Manifest();
    const branch = derivedDurableBranch(manifest)!;
    const calls: string[][] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`;
      if (joined === 'rev-parse HEAD') return `${P4_BASE}\n`;
      // A hook or a stray editor added one extra path to the index.
      if (joined === 'diff --cached --name-status -z') {
        return [...manifest.relpaths, 'agents/smuggled.md'].map((path) => `M\0${path}\0`).join('');
      }
      return '';
    };
    await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: runner })))
      .rejects.toThrow(DurableRouteError);
    const joined = calls.map((call) => call.join(' '));
    expect(joined.some((call) => call.startsWith('commit'))).toBe(false);
    expect(joined.some((call) => call.startsWith('push'))).toBe(false);
    expect(joined).toContain('reset HEAD -- .');
  });

  it('refuses a symlink/reparse swap at any staged path, and a checkout whose HEAD is not the pinned base', async () => {
    const manifest = p4Manifest();
    const git = recorder(derivedDurableBranch(manifest)!);
    await expect(routeDurable('/fake/repo', manifest, p4Options({
      runGit: git.runner,
      lstatPath: async (absolute) => ({ exists: true, isFile: true, isSymbolicLink: absolute.includes('alpha') }),
    }))).rejects.toThrow(/symlink or reparse point/);
    // The wall now runs INSIDE the transaction, so the branch/base reads precede it — but nothing was
    // ever staged or committed.
    expect(git.calls.map((call) => call[0])).toEqual(['rev-parse', 'rev-parse']);

    const drifted = recorder(derivedDurableBranch(manifest)!, 'e'.repeat(40));
    await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: drifted.runner })))
      .rejects.toThrow(/manifest pins/);
    expect(drifted.calls.map((call) => call.join(' ')).some((call) => call.startsWith('add'))).toBe(false);
  });

  it('records the boundary of a partial failure and never retries a subset', async () => {
    const manifest = p4Manifest();
    const branch = derivedDurableBranch(manifest)!;
    const calls: string[][] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`;
      if (joined === 'rev-parse HEAD') return `${P4_BASE}\n`;
      if (joined === 'diff --cached --name-status -z') return manifest.relpaths.map((path) => `M\0${path}\0`).join('');
      if (args[0] === 'ls-files') return manifest.relpaths.map((path) => `100644 ${'b'.repeat(40)} 0\t${path}\0`).join('');
      if (args[0] === 'show') return IMPLEMENTED_RECORD;
      if (args[0] === 'push') throw new Error('remote hung up');
      return '';
    };
    const error = await routeDurable('/fake/repo', manifest, p4Options({ runGit: runner })).catch((caught) => caught);
    expect(error).toBeInstanceOf(DurableRouteError);
    expect(error).toMatchObject({ committed: true, pushed: false, prKnown: false, branch });
    expect(calls.filter((call) => call[0] === 'add')).toHaveLength(1);
    expect(calls.filter((call) => call[0] === 'push')).toHaveLength(1);
  });

  it('replays an exact operation key and rejects a changed manifest under that key', async () => {
    const manifest = p4Manifest();
    const receipts = freshReceipts();
    const git = recorder(derivedDurableBranch(manifest)!);
    const first = await routeDurable('/fake/repo', manifest, p4Options({ runGit: git.runner, receipts }));
    const before = git.calls.length;
    const replay = await routeDurable('/fake/repo', manifest, p4Options({ runGit: git.runner, receipts }));
    expect(replay).toEqual(first);
    expect(git.calls.length).toBe(before);
    await expect(routeDurable('/fake/repo', p4Manifest({ baseCommit: 'f'.repeat(40) }),
      p4Options({ runGit: git.runner, receipts }))).rejects.toBeInstanceOf(DurableReplayConflictError);
  });

  it('fails a learning-implementation PR whose gh output is not the pinned {owner,repo,number,url}', async () => {
    const manifest = p4Manifest();
    const git = recorder(derivedDurableBranch(manifest)!);
    await expect(routeDurable('/fake/repo', manifest, p4Options({
      runGit: git.runner, openPr: () => ({ url: 'https://example.invalid/pr/1' }),
    }))).rejects.toThrow(/not the pinned/);
  });
});

describe('routeDurable - the learning-implementation staged set [P4-C13]', () => {
  it('stages exactly the validated targets plus the batch records at status: implemented', async () => {
    const manifest = p4Manifest();
    const git = recorder(derivedDurableBranch(manifest)!);
    const read: string[] = [];
    const receipt = await routeDurable('/fake/repo', manifest, p4Options({
      runGit: git.runner,
      readPathBytes: async (absolute) => { read.push(absolute); return IMPLEMENTED_RECORD; },
    }));
    expect(receipt.mode).toBe('pr');
    expect(read).toHaveLength(1);
    expect(read[0]).toMatch(/2026-08-20-lessons-miner-run_01HXYZ-01\.md$/);
  });

  it('rejects every other docs/proposals path, a record outside the batch, and unrendered record bytes', async () => {
    // The derived branch is what the publisher checks out to, so the recorder reports it.
    const git = recorder(derivedDurableBranch(p4Manifest())!);
    await expect(routeDurable('/fake/repo', p4Manifest({
      relpaths: ['agents/alpha.md', 'docs/proposals/decisions/2026-08-20-x.md'],
    }), p4Options({ runGit: git.runner }))).rejects.toThrow(/rejects/);

    await expect(routeDurable('/fake/repo', p4Manifest({
      relpaths: ['agents/alpha.md', 'docs/proposals/learnings/2026-08-20-other-run_01HXYZ-09.md'],
    }), p4Options({ runGit: git.runner }))).rejects.toThrow(/outside this batch/);

    const missingLines = [
      'status: implemented',
      'batch-id: learn-0123456789abcdef01234567',
      'implemented-at: 2026-08-20T06:00:00Z',
    ];
    for (const missing of missingLines) {
      const bytes = IMPLEMENTED_RECORD.split('\n').filter((line) => line !== missing).join('\n');
      await expect(routeDurable('/fake/repo', p4Manifest(), p4Options({
        runGit: git.runner, readPathBytes: async () => bytes,
      }))).rejects.toThrow(/not rendered at this/);
    }
    // Nothing was ever staged: only the in-transaction branch/base reads ran.
    expect(git.calls.every((call) => call[0] === 'rev-parse')).toBe(true);
  });

  it('refuses a record whose FRONTMATTER says proposed even though its Evidence body carries all three literals', async () => {
    // `## Evidence` is miner-derived, attacker-influenced text the constitution treats as inert data.
    // A whole-file line scan would pass this record; a frontmatter parse must not.
    const smuggled = [
      '---',
      'schema: kb.learning-proposal/v1',
      'status: proposed',
      'batch-id: null',
      'implemented-at: null',
      '---',
      '',
      '## Evidence',
      'status: implemented',
      'batch-id: learn-0123456789abcdef01234567',
      'implemented-at: 2026-08-20T06:00:00Z',
    ].join('\n');
    const git = recorder(derivedDurableBranch(p4Manifest())!);
    await expect(routeDurable('/fake/repo', p4Manifest(), p4Options({
      runGit: git.runner, readPathBytes: async () => smuggled,
    }))).rejects.toThrow(/not rendered at this/);
    expect(git.calls.some((call) => call[0] === 'add')).toBe(false);
  });

  it('re-derives the record state from the STAGED bytes after add, refusing a swap in that window', async () => {
    const manifest = p4Manifest();
    const branch = derivedDurableBranch(manifest)!;
    const staged: string[] = [];
    const calls: string[][] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`;
      if (joined === 'rev-parse HEAD') return `${P4_BASE}\n`;
      if (args[0] === 'add' && args[1] === '--') staged.push(...args.slice(2));
      if (joined === 'diff --cached --name-status -z') return staged.map((path) => `M\0${path}\0`).join('');
      if (args[0] === 'ls-files') return staged.map((path) => `100644 ${'b'.repeat(40)} 0\t${path}\0`).join('');
      // The worktree read saw the rendered record; the INDEX holds the pre-batch one.
      if (args[0] === 'show') return IMPLEMENTED_RECORD.replace('status: implemented', 'status: proposed');
      return '';
    };
    await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: runner })))
      .rejects.toThrow(/not rendered at this/);
    const joined = calls.map((call) => call.join(' '));
    expect(joined).toContain(`show :${P4_BATCH.recordPaths[0]}`);
    expect(joined.some((call) => call.startsWith('commit'))).toBe(false);
  });

  it('refuses an entry git staged as a symlink, and a junction on any path COMPONENT', async () => {
    const manifest = p4Manifest();
    const branch = derivedDurableBranch(manifest)!;
    const staged: string[] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`;
      if (joined === 'rev-parse HEAD') return `${P4_BASE}\n`;
      if (args[0] === 'add' && args[1] === '--') staged.push(...args.slice(2));
      if (joined === 'diff --cached --name-status -z') return staged.map((path) => `M\0${path}\0`).join('');
      // git recorded the leaf as mode 120000 — a symlink swapped in after the component walk.
      if (args[0] === 'ls-files') return staged.map((path) => `120000 ${'b'.repeat(40)} 0\t${path}\0`).join('');
      if (args[0] === 'show') return IMPLEMENTED_RECORD;
      return '';
    };
    await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: runner })))
      .rejects.toThrow(/staged entry is a symlink/);

    // A junction on the `docs/proposals/learnings` COMPONENT, with every leaf a plain file.
    const git = recorder(branch);
    await expect(routeDurable('/fake/repo', manifest, p4Options({
      runGit: git.runner,
      lstatPath: async (absolute) => ({
        exists: true, isFile: true, isSymbolicLink: absolute.replace(/\\/g, '/').endsWith('docs/proposals'),
      }),
    }))).rejects.toThrow(/symlink or reparse point at docs\/proposals/);
  });

  it('refuses a rename/copy entry in the cached set, consuming git\'s real three-token grammar', async () => {
    const manifest = p4Manifest();
    const branch = derivedDurableBranch(manifest)!;
    const runner: GitRunner = (_repoRoot, args) => {
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`;
      if (joined === 'rev-parse HEAD') return `${P4_BASE}\n`;
      // Real `-z` name-status: a rename is THREE tokens. Walking in pairs would read
      // `agents/old.md` as a status and let the following entries desync.
      if (joined === 'diff --cached --name-status -z') {
        return `R100\0agents/old.md\0${manifest.relpaths[0]}\0M\0${manifest.relpaths[1]}\0`;
      }
      if (args[0] === 'ls-files') return manifest.relpaths.map((path) => `100644 ${'b'.repeat(40)} 0\t${path}\0`).join('');
      if (args[0] === 'show') return IMPLEMENTED_RECORD;
      return '';
    };
    await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: runner })))
      .rejects.toThrow(/never renames or copies/);
  });

  it('refuses when a path whose content equals HEAD is omitted from the cached set by real git', async () => {
    const manifest = p4Manifest();
    const branch = derivedDurableBranch(manifest)!;
    const runner: GitRunner = (_repoRoot, args) => {
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`;
      if (joined === 'rev-parse HEAD') return `${P4_BASE}\n`;
      // Real git omits a no-op add: the target's bytes already equal HEAD, so only the record shows.
      if (joined === 'diff --cached --name-status -z') return `M\0${manifest.relpaths[1]}\0`;
      if (args[0] === 'show') return IMPLEMENTED_RECORD;
      return '';
    };
    await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: runner })))
      .rejects.toThrow(/does not equal the manifest/);
  });
});

describe('routeDurable - the pinned base, the repository pin, and durable replay', () => {
  it('refuses the unpinned sentinel for every P4 purpose, before any git call', async () => {
    const git = recorder();
    for (const purpose of ['learning-implementation', 'schedule-mirror'] as const) {
      const manifest = purpose === 'schedule-mirror'
        ? p4Manifest({ purpose, operationKey: `schedule-mirror:${P4_BATCH.batchId}`, relpaths: ['HEARTBEAT.md'], baseCommit: '0'.repeat(40) })
        : p4Manifest({ baseCommit: '0'.repeat(40) });
      await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: git.runner })))
        .rejects.toThrow(/requires a real attested base commit/);
    }
    expect(git.calls).toEqual([]);
  });

  it('resolveBaseCommit throws rather than downgrading a degraded checkout to the sentinel', async () => {
    await expect(resolveBaseCommit('/fake/repo', () => '\n')).rejects.toThrow(/cannot resolve a base commit/);
    await expect(resolveBaseCommit('/fake/repo', () => 'not-a-sha\n')).rejects.toThrow(/cannot resolve a base commit/);
    expect(await resolveBaseCommit('/fake/repo', () => `${P4_BASE}\n`)).toBe(P4_BASE);
  });

  it('refuses when HEAD is unreadable, never treating an unresolvable base as a match', async () => {
    const manifest = p4Manifest();
    const branch = derivedDurableBranch(manifest)!;
    const runner: GitRunner = (_repoRoot, args) => (
      args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? `${branch}\n` : ''
    );
    await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: runner })))
      .rejects.toThrow(/HEAD is unreadable/);
  });

  it('passes --repo from the pin and refuses a PR receipt from another repository', async () => {
    const manifest = p4Manifest();
    const git = recorder(derivedDurableBranch(manifest)!);
    const requests: PrRequest[] = [];
    await routeDurable('/fake/repo', manifest, p4Options({
      runGit: git.runner,
      openPr: (_root, request) => { requests.push(request); return PINNED_PR; },
    }));
    expect(requests[0]!.repo).toEqual({ owner: 'kb-owner', repo: 'kb' });

    const forked = recorder(derivedDurableBranch(manifest)!);
    await expect(routeDurable('/fake/repo', manifest, p4Options({
      runGit: forked.runner,
      openPr: () => ({ ...PINNED_PR, owner: 'attacker' }),
    }))).rejects.toThrow(/not the pinned kb-owner\/kb/);
  });

  it('recovers a timed-out open from exactly one OPEN PR targeting main, and from nothing else', async () => {
    const manifest = p4Manifest();
    const open = { ...PINNED_PR, state: 'OPEN', base: 'main' };
    const timeout = () => { throw new Error('gh pr create timed out after 60000ms and was killed'); };

    const recovered = await routeDurable('/fake/repo', manifest, p4Options({
      runGit: recorder(derivedDurableBranch(manifest)!).runner,
      openPr: timeout,
      locatePr: async () => [open],
    }));
    expect(recovered).toEqual({ mode: 'pr', branch: derivedDurableBranch(manifest), pr: PINNED_PR });

    // A closed PR, a PR against another base, and a non-timeout failure are all unrecoverable.
    for (const located of [[{ ...open, state: 'CLOSED' }], [{ ...open, base: 'release' }], []]) {
      await expect(routeDurable('/fake/repo', manifest, p4Options({
        runGit: recorder(derivedDurableBranch(manifest)!).runner,
        openPr: timeout,
        locatePr: async () => located,
      }))).rejects.toThrow(/timed out/);
    }
    await expect(routeDurable('/fake/repo', manifest, p4Options({
      runGit: recorder(derivedDurableBranch(manifest)!).runner,
      openPr: () => { throw new Error('gh: authentication required'); },
      locatePr: async () => [open],
    }))).rejects.toThrow(/authentication required/);
  });

  it('refuses a publisher git subcommand outside the permitted table', async () => {
    const manifest = p4Manifest();
    const branch = derivedDurableBranch(manifest)!;
    const runner: GitRunner = (_repoRoot, args) => (args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? `${branch}\n` : '');
    // The table is what the publisher may issue; `worktree`/`update-ref` are not on it.
    expect(PUBLISHER_PERMITTED_SUBCOMMANDS).toContain('fetch');
    expect(PUBLISHER_PERMITTED_SUBCOMMANDS).toContain('merge-base');
    expect(PUBLISHER_PERMITTED_SUBCOMMANDS).not.toContain('worktree');
    expect(PUBLISHER_PERMITTED_SUBCOMMANDS).not.toContain('update-ref');
    await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: runner })))
      .rejects.toThrow(/HEAD is unreadable/);
  });

  it('persists replay receipts across a restart: the second process republishes nothing', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'kb-receipts-'));
    const manifest = p4Manifest();
    const first = await routeDurable('/fake/repo', manifest, p4Options({
      runGit: recorder(derivedDurableBranch(manifest)!).runner,
      receipts: createPersistentRouteReceipts(stateRoot),
    }));
    expect(existsSync(routeReceiptStorePath(stateRoot))).toBe(true);

    // A FRESH store over the same state root is the restarted daemon.
    const afterRestart = recorder(derivedDurableBranch(manifest)!);
    const replay = await routeDurable('/fake/repo', manifest, p4Options({
      runGit: afterRestart.runner,
      receipts: createPersistentRouteReceipts(stateRoot),
    }));
    expect(replay).toEqual(first);
    expect(afterRestart.calls).toEqual([]);

    // And a changed manifest under that key is still a 409 after the restart.
    await expect(routeDurable('/fake/repo', p4Manifest({ baseCommit: 'f'.repeat(40) }), p4Options({
      runGit: afterRestart.runner,
      receipts: createPersistentRouteReceipts(stateRoot),
    }))).rejects.toBeInstanceOf(DurableReplayConflictError);
  });
});

describe('routeDurable - schedule-mirror purpose contract (§3.2 cross-check)', () => {
  function scheduleMirrorManifest(overrides: Partial<DurablePathManifest> = {}): DurablePathManifest {
    return p4Manifest({
      purpose: 'schedule-mirror',
      operationKey: scheduleMirrorOperationKey(P4_BATCH.batchId),
      relpaths: ['HEARTBEAT.md'],
      ...overrides,
    });
  }

  it('refuses a schedule-mirror publication whose operation key does not name the batch', async () => {
    const manifest = scheduleMirrorManifest({ operationKey: `schedule-mirror:${'x'.repeat(24)}` });
    const git = recorder(derivedDurableBranch(manifest)!);
    await expect(routeDurable('/fake/repo', manifest, p4Options({ runGit: git.runner })))
      .rejects.toThrow(/operation key does not name this batch/);
    // Refused inside assertPurposeContract, before any staging.
    expect(git.calls.some((call) => call[0] === 'add')).toBe(false);
  });

  it('passes a schedule-mirror publication whose operation key names the batch via scheduleMirrorOperationKey', async () => {
    const manifest = scheduleMirrorManifest();
    const git = recorder(derivedDurableBranch(manifest)!);
    const receipt = await routeDurable('/fake/repo', manifest, p4Options({ runGit: git.runner }));
    expect(receipt).toEqual({ mode: 'pr', branch: derivedDurableBranch(manifest), pr: PINNED_PR });
    const joined = git.calls.map((call) => call.join(' '));
    expect(joined).toContain(`add -- ${manifest.relpaths.join(' ')}`);
  });
});

describe('routeDurable - coordination mode on ops [P4-C13, P4-C32]', () => {
  const proposalManifest = p4Manifest({
    purpose: 'learning-proposal',
    operationKey: 'learning-proposal:lessons-miner:run_01HXYZ',
    relpaths: ['docs/proposals/learnings/2026-08-20-lessons-miner-run_01HXYZ-01.md'],
  });

  it('publishes a learning-proposal to ops with no PR and returns {mode, branch: ops, commit}', async () => {
    const git = recorder('ops', P4_BASE);
    const openPr = vi.fn();
    const receipt = await routeDurable('/fake/repo', proposalManifest, p4Options({
      runGit: git.runner, openPr, learningBatch: undefined,
    }));
    expect(receipt).toEqual({ mode: 'coordination', branch: 'ops', commit: P4_BASE, pushed: true });
    expect('pr' in receipt).toBe(false);
    expect(openPr).not.toHaveBeenCalled();
    const joined = git.calls.map((call) => call.join(' '));
    expect(joined).toContain('pull --rebase origin ops');
    expect(joined).toContain('push origin ops');
    expect(joined.some((call) => call.includes('refs/heads/dv3-p4'))).toBe(false);
  });

  it('refuses a learning-record-retire without a proven merge and stages only deletions of the batch records', async () => {
    const retire = p4Manifest({
      purpose: 'learning-record-retire',
      operationKey: `learning-record-retire:${P4_BATCH.batchId}:${P4_MERGE}`,
      relpaths: P4_BATCH.recordPaths,
    });
    const unproven = recorder('ops', P4_BASE);
    await expect(routeDurable('/fake/repo', retire, p4Options({
      runGit: unproven.runner,
      learningBatch: undefined,
      retire: {
        batchId: P4_BATCH.batchId, recordPaths: P4_BATCH.recordPaths, mergeCommit: P4_MERGE,
        merged: false as unknown as true,
      },
    }))).rejects.toThrow(/proven merge/);
    // The refusal happens inside the transaction, before any staging or deletion.
    expect(unproven.calls.some((call) => call[0] === 'add' || call[0] === 'commit')).toBe(false);

    const deleted: string[] = [];
    const calls: string[][] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      calls.push(args);
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (joined === 'rev-parse HEAD') return `${P4_BASE}\n`;
      if (joined === 'diff --cached --name-status -z') return P4_BATCH.recordPaths.map((path) => `D\0${path}\0`).join('');
      return '';
    };
    const receipt = await routeDurable('/fake/repo', retire, p4Options({
      runGit: runner,
      learningBatch: undefined,
      unlinkPath: async (absolute) => { deleted.push(absolute); },
      retire: { batchId: P4_BATCH.batchId, recordPaths: P4_BATCH.recordPaths, mergeCommit: P4_MERGE, merged: true },
    }));
    expect(receipt).toEqual({ mode: 'coordination', branch: 'ops', commit: P4_BASE, pushed: true });
    expect(deleted).toHaveLength(1);
    const joinedCalls = calls.map((call) => call.join(' '));
    expect(joinedCalls).toContain('push origin ops');
    // The publisher proved the merge ITSELF, before touching a single record byte.
    expect(joinedCalls).toContain('fetch origin main');
    expect(joinedCalls).toContain(`merge-base --is-ancestor ${P4_MERGE} origin/main`);
    expect(joinedCalls.indexOf('fetch origin main')).toBeLessThan(joinedCalls.findIndex((call) => call.startsWith('add')));
  });

  it('refuses a retire whose merge commit is not an ancestor of origin/main', async () => {
    const retire = p4Manifest({
      purpose: 'learning-record-retire',
      operationKey: `learning-record-retire:${P4_BATCH.batchId}:${P4_MERGE}`,
      relpaths: P4_BATCH.recordPaths,
    });
    const deleted: string[] = [];
    const runner: GitRunner = (_repoRoot, args) => {
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (joined === 'rev-parse HEAD') return `${P4_BASE}\n`;
      // git exits 1 for "not an ancestor".
      if (args[0] === 'merge-base') throw Object.assign(new Error('merge-base --is-ancestor exited 1'), { status: 1 });
      return '';
    };
    await expect(routeDurable('/fake/repo', retire, p4Options({
      runGit: runner,
      learningBatch: undefined,
      unlinkPath: async (absolute) => { deleted.push(absolute); },
      retire: { batchId: P4_BATCH.batchId, recordPaths: P4_BATCH.recordPaths, mergeCommit: P4_MERGE, merged: true },
    }))).rejects.toThrow(/not proven merged into origin\/main/);
    expect(deleted).toEqual([]);
  });

  it('restores every deleted record byte-for-byte when the staged set does not match', async () => {
    const retire = p4Manifest({
      purpose: 'learning-record-retire',
      operationKey: `learning-record-retire:${P4_BATCH.batchId}:${P4_MERGE}`,
      relpaths: P4_BATCH.recordPaths,
    });
    // A tiny virtual tree so "byte-identical" is checkable.
    const tree = new Map<string, string>([[resolve('/fake/repo', P4_BATCH.recordPaths[0]!), IMPLEMENTED_RECORD]]);
    const before = new Map(tree);
    const runner: GitRunner = (_repoRoot, args) => {
      const joined = args.join(' ');
      if (joined === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (joined === 'rev-parse HEAD') return `${P4_BASE}\n`;
      // A stray path in the index: the exact-set proof refuses AFTER the deletions have happened.
      if (joined === 'diff --cached --name-status -z') return `D\0${P4_BATCH.recordPaths[0]}\0D\0docs/proposals/learnings/2026-08-20-other-run_01HXYZ-09.md\0`;
      return '';
    };
    await expect(routeDurable('/fake/repo', retire, p4Options({
      runGit: runner,
      learningBatch: undefined,
      readPathBytes: async (absolute) => tree.get(absolute)!,
      unlinkPath: async (absolute) => { tree.delete(absolute); },
      writePathBytes: async (absolute, contents) => { tree.set(absolute, contents); },
      retire: { batchId: P4_BATCH.batchId, recordPaths: P4_BATCH.recordPaths, mergeCommit: P4_MERGE, merged: true },
    }))).rejects.toThrow(/does not equal the manifest/);
    expect([...tree.entries()]).toEqual([...before.entries()]);
  });

  it('refuses a retire whose cached set is not all deletions', async () => {
    const retire = p4Manifest({
      purpose: 'learning-record-retire',
      operationKey: `learning-record-retire:${P4_BATCH.batchId}:${P4_MERGE}`,
      relpaths: P4_BATCH.recordPaths,
    });
    const git = recorder('ops', P4_BASE);
    await expect(routeDurable('/fake/repo', retire, p4Options({
      runGit: git.runner,
      learningBatch: undefined,
      unlinkPath: async () => {},
      retire: { batchId: P4_BATCH.batchId, recordPaths: P4_BATCH.recordPaths, mergeCommit: P4_MERGE, merged: true },
    }))).rejects.toThrow(/only deletions/);
  });
});

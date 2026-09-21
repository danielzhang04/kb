import { describe, expect, it, vi } from 'vitest';
import type { GitRunner } from '../write/branch.ts';
import { diffTickStatus, runScheduleTick, scheduleTickLogLine, startScheduleTick } from './tick.ts';
import type { DispatchSubprocessResult, ScheduleTickDeps, StatusEntry } from './tick.ts';

const REPO_ROOT = '/fake/repo';
const PARENT = 'a'.repeat(40);
const CHILD = 'b'.repeat(40);

/** A dispatch.py stub reporting `count` dispatched cards, matching its real stdout shape. */
function dispatchResult(count: number): Promise<DispatchSubprocessResult> {
  const lines = [`dispatched ${count} card(s)`];
  for (let i = 0; i < count; i += 1) lines.push(`  card-${i}`);
  return Promise.resolve({ exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' });
}

/** A `git status` stub that returns `''` (clean) on the FIRST call — the baseline, taken before
 *  `dispatch.py` ever runs — and `afterRaw` on every subsequent status call. Every test below that
 *  wants the tick to actually run `dispatch.py` and act on some changed-path set needs this shape,
 *  since re-review B-1b's fix means a dirty baseline now short-circuits the whole tick before
 *  `dispatch.py` is ever invoked. */
function cleanBeforeStatus(afterRaw: string): (args: string[]) => string | null {
  let statusCalls = 0;
  return (args) => {
    if (args[0] !== 'status') return null;
    statusCalls += 1;
    return statusCalls === 1 ? '' : afterRaw;
  };
}

describe('runScheduleTick', () => {
  it('is a no-op — commits nothing — when dispatch.py changed nothing', async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args[0] === 'status') return '';
      throw new Error(`unexpected git invocation: ${args.join(' ')}`);
    };
    const outcome = await runScheduleTick({
      repoRoot: REPO_ROOT,
      runGit,
      runDispatch: () => dispatchResult(0),
    });
    expect(outcome).toEqual({ due: 0, dispatched: 0, paths: [], committed: null, refused: false, skipped: null, error: null });
    // Two status calls now: the baseline (before dispatch.py) and the after snapshot.
    expect(calls).toEqual([
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    ]);
  });

  it('reports a dispatch.py failure but still checks for (and finds none of) its own writes', async () => {
    const runGit: GitRunner = async (_root, args) => {
      if (args[0] === 'status') return '';
      throw new Error(`unexpected git invocation: ${args.join(' ')}`);
    };
    const outcome = await runScheduleTick({
      repoRoot: REPO_ROOT,
      runGit,
      runDispatch: () => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'boom' }),
    });
    expect(outcome.due).toBe(0);
    expect(outcome.dispatched).toBe(0);
    expect(outcome.committed).toBeNull();
    expect(outcome.refused).toBe(false);
    expect(outcome.error).toContain('dispatch.py exited 1');
    expect(outcome.error).toContain('boom');
  });

  it('commits exactly the queue+ledger paths dispatch.py wrote, through commitPreparedCoordination, and leaves a clean checkout', async () => {
    const calls: string[][] = [];
    let head = PARENT;
    const status = cleanBeforeStatus('?? queue/inbox/card-0.md\0 M ledgers/dispatch/2026-09.tsv\0');
    const runGit: GitRunner = async (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (args[0] === 'status') return status(args)!;
      if (command === 'rev-parse HEAD') return `${head}\n`;
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z') return '';
      if (args[0] === 'add') return '';
      if (args[0] === 'commit') { head = CHILD; return ''; }
      if (args[0] === 'push') return '';
      throw new Error(`unexpected git invocation: ${command}`);
    };

    const outcome = await runScheduleTick({
      repoRoot: REPO_ROOT,
      runGit,
      runDispatch: () => dispatchResult(1),
      publication: 'direct',
    });

    expect(outcome.due).toBe(1);
    expect(outcome.dispatched).toBe(1);
    expect(outcome.refused).toBe(false);
    expect(outcome.error).toBeNull();
    expect(outcome.committed).toBe(CHILD);
    expect(outcome.paths.slice().sort()).toEqual(['ledgers/dispatch/2026-09.tsv', 'queue/inbox/card-0.md']);

    // Exactly the two collected paths were staged (order: the entry chosen as the primary target,
    // plus alsoStage for the rest) — never a third, unexpected path.
    const addCall = calls.find((c) => c[0] === 'add')!;
    expect(addCall.slice(2).sort()).toEqual(['ledgers/dispatch/2026-09.tsv', 'queue/inbox/card-0.md']);
    expect(calls.some((c) => c[0] === 'push')).toBe(true);
    // Never reverted or reset — a successful commit leaves nothing to clean up.
    expect(calls.some((c) => c[0] === 'checkout')).toBe(false);
    expect(calls.some((c) => c[0] === 'reset')).toBe(false);
    // Baseline (clean, before dispatch.py) + after (dirty) — exactly two status calls.
    expect(calls.filter((c) => c[0] === 'status').length).toBe(2);
  });

  it('refuses and reverts ONLY the tick\'s own paths when a path outside queue/**, ledgers/dispatch/** changed (clean-before)', async () => {
    const calls: string[][] = [];
    const status = cleanBeforeStatus('?? queue/inbox/card-0.md\0 M docs/unrelated.md\0');
    const runGit: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args[0] === 'status') return status(args)!;
      if (args[0] === 'checkout') return '';
      throw new Error(`unexpected git invocation: ${args.join(' ')}`);
    };

    const outcome = await runScheduleTick({
      repoRoot: '/fake/repo-does-not-exist-so-rm-is-a-noop',
      runGit,
      runDispatch: () => dispatchResult(1),
    });

    expect(outcome.refused).toBe(true);
    expect(outcome.skipped).toBeNull();
    expect(outcome.committed).toBeNull();
    expect(outcome.paths).toEqual([]);
    expect(outcome.error).toContain('docs/unrelated.md');
    expect(outcome.error).toContain('queue/**');
    // The tracked (non-`?`-status) foreign path is reverted via `git checkout --`.
    const checkoutCall = calls.find((c) => c[0] === 'checkout');
    expect(checkoutCall).toContain('docs/unrelated.md');
    // Never reached the commit step.
    expect(calls.some((c) => c[0] === 'commit')).toBe(false);
    // The baseline was empty, so this is exclusively the tick's own paths that were reverted — both
    // entries (the whole after-set) were new this tick, not a pre-existing foreign path.
    expect(calls.filter((c) => c[0] === 'status').length).toBe(2);
  });

  it('cleans up (reset + revert) and commits nothing when the commit itself fails before landing', async () => {
    const calls: string[][] = [];
    const status = cleanBeforeStatus('?? queue/inbox/card-0.md\0');
    const runGit: GitRunner = async (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (args[0] === 'status') return status(args)!;
      if (command === 'rev-parse HEAD') return `${PARENT}\n`; // HEAD never moves — commit never lands
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z') return '';
      if (args[0] === 'add') return '';
      if (args[0] === 'commit') throw new Error('commit hook refused');
      if (args[0] === 'reset') return '';
      if (args[0] === 'checkout') return '';
      throw new Error(`unexpected git invocation: ${command}`);
    };

    const outcome = await runScheduleTick({
      repoRoot: REPO_ROOT,
      runGit,
      runDispatch: () => dispatchResult(1),
      publication: 'direct',
    });

    expect(outcome.committed).toBeNull();
    expect(outcome.refused).toBe(false);
    expect(outcome.paths).toEqual([]);
    expect(outcome.error).toContain('commit failed and was reverted');
    expect(outcome.error).toContain('commit hook refused');
    expect(calls.some((c) => c[0] === 'reset')).toBe(true);
  });

  it('never deletes an untracked path once HEAD has actually advanced past the commit (post-commit publish failure)', async () => {
    const calls: string[][] = [];
    let head = PARENT;
    const status = cleanBeforeStatus('?? queue/inbox/card-0.md\0');
    const runGit: GitRunner = async (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (args[0] === 'status') return status(args)!;
      if (command === 'rev-parse HEAD') return `${head}\n`;
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z') return '';
      if (args[0] === 'add') return '';
      if (args[0] === 'commit') { head = CHILD; return ''; }
      // Publication step fails AFTER the commit has landed (simulating a push that throws, or an
      // outbox spool failure) — the commit is real; only what happens after it failed.
      if (args[0] === 'push') throw new Error('push transport failure');
      throw new Error(`unexpected git invocation: ${command}`);
    };

    const outcome = await runScheduleTick({
      repoRoot: REPO_ROOT,
      runGit,
      runDispatch: () => dispatchResult(1),
      publication: 'direct',
    });

    expect(outcome.committed).toBe(CHILD);
    expect(outcome.paths).toEqual(['queue/inbox/card-0.md']);
    expect(outcome.error).toContain('COMMITTED but its publication failed');
    // Crucially: no cleanup attempted once the commit landed.
    expect(calls.some((c) => c[0] === 'checkout')).toBe(false);
    expect(calls.some((c) => c[0] === 'reset')).toBe(false);
  });

  // ---- re-review B-1b: the tick must never touch a checkout that was already dirty BEFORE it ran,
  // regardless of whether the pre-existing dirty path came from a tracked (foreign) writer or sits
  // right inside queue/** itself (e.g. a partially-written card from an interrupted prior
  // transaction) — either way it predates this tick and is not this tick's to sweep up.

  it('skips the whole tick — never invokes dispatch.py — when the baseline is dirty with a tracked-modified foreign file', async () => {
    const calls: string[][] = [];
    let dispatchCalls = 0;
    const runGit: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args[0] === 'status') return ' M docs/unrelated.md\0';
      throw new Error(`unexpected git invocation: ${args.join(' ')}`);
    };

    const outcome = await runScheduleTick({
      repoRoot: REPO_ROOT,
      runGit,
      runDispatch: () => { dispatchCalls += 1; return dispatchResult(1); },
    });

    expect(dispatchCalls).toBe(0);
    expect(outcome.skipped).toBe('checkout-dirty-before-tick');
    expect(outcome.refused).toBe(false);
    expect(outcome.committed).toBeNull();
    expect(outcome.due).toBe(0);
    expect(outcome.dispatched).toBe(0);
    expect(outcome.paths).toEqual(['docs/unrelated.md']);
    expect(outcome.error).toBeNull();
    // Nothing reverted, deleted, reset, or committed — only the one baseline status read.
    expect(calls).toEqual([['status', '--porcelain=v1', '-z', '--untracked-files=all']]);
    expect(scheduleTickLogLine(outcome)).toBe('schedule-tick: skipped checkout-dirty-before-tick paths=1 first=docs/unrelated.md');
  });

  it('skips the whole tick — file left present — when the baseline is dirty with an untracked file under queue/', async () => {
    const calls: string[][] = [];
    let dispatchCalls = 0;
    const runGit: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args[0] === 'status') return '?? queue/inbox/stuck-card.md\0';
      throw new Error(`unexpected git invocation: ${args.join(' ')}`);
    };

    const outcome = await runScheduleTick({
      repoRoot: REPO_ROOT,
      runGit,
      runDispatch: () => { dispatchCalls += 1; return dispatchResult(1); },
    });

    expect(dispatchCalls).toBe(0);
    expect(outcome.skipped).toBe('checkout-dirty-before-tick');
    expect(outcome.paths).toEqual(['queue/inbox/stuck-card.md']);
    // No delete/checkout call was ever made — the pre-existing card is left exactly where it was.
    expect(calls.some((c) => c[0] === 'checkout')).toBe(false);
    expect(calls).toEqual([['status', '--porcelain=v1', '-z', '--untracked-files=all']]);
    expect(scheduleTickLogLine(outcome)).toBe('schedule-tick: skipped checkout-dirty-before-tick paths=1 first=queue/inbox/stuck-card.md');
  });
});

describe('diffTickStatus', () => {
  it('excludes a path present in BOTH snapshots — defensive: never reverted, deleted, or committed even if a future change relaxed the skip-when-dirty rule', () => {
    const baseline: StatusEntry[] = [{ code: ' M', path: 'docs/already-dirty.md' }];
    const after: StatusEntry[] = [
      { code: ' M', path: 'docs/already-dirty.md' }, // present in both, unchanged -> excluded
      { code: '??', path: 'queue/inbox/card-0.md' }, // new this tick -> included
    ];
    expect(diffTickStatus(baseline, after)).toEqual([{ code: '??', path: 'queue/inbox/card-0.md' }]);
  });

  it('treats a status-code change on an already-present path as changed (not "already known about")', () => {
    const baseline: StatusEntry[] = [{ code: ' M', path: 'queue/inbox/card-0.md' }];
    const after: StatusEntry[] = [{ code: 'M ', path: 'queue/inbox/card-0.md' }]; // staged differently
    expect(diffTickStatus(baseline, after)).toEqual([{ code: 'M ', path: 'queue/inbox/card-0.md' }]);
  });

  it('returns the whole after-set when the baseline is empty (the normal run-path shape)', () => {
    const after: StatusEntry[] = [{ code: '??', path: 'queue/inbox/card-0.md' }];
    expect(diffTickStatus([], after)).toEqual(after);
  });
});

describe('scheduleTickLogLine', () => {
  it('formats the documented summary line', () => {
    expect(scheduleTickLogLine({ due: 3, dispatched: 3, paths: ['queue/inbox/a.md'], committed: CHILD, refused: false, skipped: null, error: null }))
      .toBe(`schedule-tick: due=3 dispatched=3 paths=1 committed=${CHILD}`);
    expect(scheduleTickLogLine({ due: 0, dispatched: 0, paths: [], committed: null, refused: false, skipped: null, error: null }))
      .toBe('schedule-tick: due=0 dispatched=0 paths=0 committed=none');
  });

  it('formats the skipped-checkout-dirty line, distinct from the normal summary shape', () => {
    expect(scheduleTickLogLine({ due: 0, dispatched: 0, paths: ['docs/unrelated.md'], committed: null, refused: false, skipped: 'checkout-dirty-before-tick', error: null }))
      .toBe('schedule-tick: skipped checkout-dirty-before-tick paths=1 first=docs/unrelated.md');
  });
});

describe('startScheduleTick', () => {
  it('returns a no-op stop function when intervalMs is 0 or negative', () => {
    const stop = startScheduleTick({ repoRoot: REPO_ROOT } as ScheduleTickDeps, 0);
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });

  it('never overlaps a slow tick with the next interval firing', async () => {
    vi.useFakeTimers();
    try {
      let inFlight = 0;
      let maxConcurrent = 0;
      let resolveFirst: (() => void) | undefined;
      const firstStarted = new Promise<void>((resolve) => { resolveFirst = resolve; });
      let calls = 0;
      const runDispatch: ScheduleTickDeps['runDispatch'] = async () => {
        calls += 1;
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        if (calls === 1) resolveFirst?.();
        // First call hangs until released below; later calls resolve immediately.
        if (calls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
        inFlight -= 1;
        return { exitCode: 0, stdout: 'dispatched 0 card(s)\n', stderr: '' };
      };
      let releaseFirst: (() => void) | undefined;
      const runGit: GitRunner = async (_root, args) => (args[0] === 'status' ? '' : '');

      const stop = startScheduleTick({ repoRoot: REPO_ROOT, runGit, runDispatch }, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      await firstStarted;
      // A second interval elapses while the first tick is still in flight — it must be skipped.
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toBe(1);
      releaseFirst?.();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toBe(2);
      expect(maxConcurrent).toBe(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a throwing tick through onTick rather than crashing', async () => {
    vi.useFakeTimers();
    try {
      const onTick = vi.fn();
      const runGit: GitRunner = async () => { throw new Error('git is unavailable'); };
      const stop = startScheduleTick({ repoRoot: REPO_ROOT, runGit, runDispatch: () => dispatchResult(0) }, 1000, onTick);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);
      expect(onTick.mock.calls[0]![0].error).toBeTruthy();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

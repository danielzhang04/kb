import { describe, expect, it, vi } from 'vitest';
import { AsyncGitError } from './asyncGit.ts';
import { isNonFastForwardRejection, pushOpsWithReconcile } from './opsPushRetry.ts';

/**
 * The VERBATIM failure the daemon reported on both live queue-bridge launches (2026-08-11, -12), as the
 * async runner shapes it: the message carries the first 512 bytes of stderr, `.stderr` carries all of it.
 * Every retry test drives this exact object so the fix is proved against the real defect, not a proxy.
 */
function liveRejection(): AsyncGitError {
  const stderr = [
    'To https://github.com/danielzhang04/kb.git',
    ' ! [rejected]        ops -> ops (non-fast-forward)',
    "error: failed to push some refs to 'https://github.com/danielzhang04/kb.git'",
    'hint: Updates were rejected because the tip of your current branch is behind',
    'hint: its remote counterpart. Integrate the remote changes (e.g.',
    "hint: 'git pull ...') before pushing again.",
  ].join('\n');
  return new AsyncGitError(`git push exited with code 1: ${stderr.slice(0, 512)}`, 1, '', stderr);
}

/** A push failure that is NOT a lost race: no amount of rebasing turns it into an accepted push. */
function authFailure(): AsyncGitError {
  const stderr = 'remote: Invalid username or password.\nfatal: Authentication failed for \'https://github.com/danielzhang04/kb.git/\'';
  return new AsyncGitError(`git push exited with code 128: ${stderr}`, 128, '', stderr);
}

/** A recording git fake: pushes fail per `pushErrors`, everything else answers ''. */
function fakeGit(pushErrors: Array<unknown | null>, onPull?: () => void) {
  const calls: string[][] = [];
  let pushes = 0;
  const runGit = (_repoRoot: string, args: string[]): string => {
    calls.push(args);
    if (args[0] === 'push') {
      const failure = pushErrors[pushes++];
      if (failure) throw failure;
    }
    if (args[0] === 'pull') onPull?.();
    return '';
  };
  return { runGit, calls, verbs: () => calls.map((args) => args.join(' ')) };
}

describe('isNonFastForwardRejection — only a lost race is transient', () => {
  it('recognises the live rejection through stderr, stdout, or message alone', () => {
    expect(isNonFastForwardRejection(liveRejection())).toBe(true);
    expect(isNonFastForwardRejection(new Error('! [rejected] ops -> ops (fetch first)'))).toBe(true);
    expect(isNonFastForwardRejection({ stdout: 'Updates were rejected because the tip is behind' })).toBe(true);
    expect(isNonFastForwardRejection(new Error('push rejected (NON-FAST-FORWARD)'))).toBe(true);
  });

  it('refuses every non-race failure, including a bare "rejected" that is a hook refusal', () => {
    expect(isNonFastForwardRejection(authFailure())).toBe(false);
    expect(isNonFastForwardRejection(new Error('! [rejected] ops -> ops (pre-receive hook declined)'))).toBe(false);
    expect(isNonFastForwardRejection(new Error('fatal: unable to access ... Could not resolve host'))).toBe(false);
    expect(isNonFastForwardRejection('non-fast-forward')).toBe(false);
    expect(isNonFastForwardRejection(null)).toBe(false);
  });
});

describe('pushOpsWithReconcile — the constitution\'s "re-read state, reconcile, retry", bounded', () => {
  it('reconciles a non-fast-forward rejection twice, then succeeds, in exact command order', async () => {
    // THE LIVE DEFECT, inverted: two concurrent ops writers beat this push, and the launch still lands.
    const { runGit, verbs } = fakeGit([liveRejection(), liveRejection(), null]);

    await pushOpsWithReconcile({ repoRoot: '/repo', runGit });

    expect(verbs()).toEqual([
      'push origin ops',
      'pull --rebase origin ops',
      'push origin ops',
      'pull --rebase origin ops',
      'push origin ops',
    ]);
  });

  it('rethrows a NON-retryable push failure immediately, attempting no rebase at all', async () => {
    const failure = authFailure();
    const { runGit, verbs } = fakeGit([failure, null]);

    await expect(pushOpsWithReconcile({ repoRoot: '/repo', runGit })).rejects.toBe(failure);
    expect(verbs()).toEqual(['push origin ops']);
  });

  it('aborts a conflicting rebase and rethrows the ORIGINAL push rejection, never leaving a half-open rebase', async () => {
    // The 2026-07-30 jammed-rebase incident class: this checkout is SHARED, so a mid-rebase exit hands
    // the jam to the next writer.
    const rejection = liveRejection();
    const { runGit, verbs } = fakeGit([rejection, null], () => {
      throw new Error('CONFLICT (content): Merge conflict in queue/inbox/wf-abc.md');
    });

    await expect(pushOpsWithReconcile({ repoRoot: '/repo', runGit })).rejects.toBe(rejection);
    expect(verbs()).toEqual(['push origin ops', 'pull --rebase origin ops', 'rebase --abort']);
  });

  it('rethrows the ORIGINAL rejection object once the bounded retries are exhausted', async () => {
    const first = liveRejection();
    const { runGit, verbs } = fakeGit([first, liveRejection(), liveRejection(), liveRejection(), liveRejection()]);

    await expect(pushOpsWithReconcile({ repoRoot: '/repo', runGit })).rejects.toBe(first);
    // Default budget: the first push plus 3 reconciled retries — bounded, then park.
    expect(verbs().filter((verb) => verb === 'push origin ops')).toHaveLength(4);
  });

  it('honours maxRetryPushes: 0 by parking on the first rejection with no reconcile', async () => {
    const rejection = liveRejection();
    const { runGit, verbs } = fakeGit([rejection, null]);

    await expect(pushOpsWithReconcile({ repoRoot: '/repo', runGit, maxRetryPushes: 0 })).rejects.toBe(rejection);
    expect(verbs()).toEqual(['push origin ops']);
  });

  it('re-proves the caller precondition BEFORE the pull and re-authorizes AFTER it, once per retry', async () => {
    const order: string[] = [];
    const { runGit, calls } = fakeGit([liveRejection(), null]);
    const recorded = (repoRoot: string, args: string[]): string => {
      order.push(args.join(' '));
      return runGit(repoRoot, args);
    };
    const beforeReconcile = vi.fn(() => { order.push('beforeReconcile'); });
    const onReconciled = vi.fn(async () => { order.push('onReconciled'); });

    await pushOpsWithReconcile({ repoRoot: '/repo', runGit: recorded, beforeReconcile, onReconciled });

    expect(order).toEqual([
      'push origin ops', 'beforeReconcile', 'pull --rebase origin ops', 'onReconciled', 'push origin ops',
    ]);
    expect(beforeReconcile).toHaveBeenCalledTimes(1);
    expect(onReconciled).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(3);
  });

  it('propagates an onReconciled refusal instead of publishing under the newer head', async () => {
    // The launch path's stale-routing guard: the reconciled head compiles to a DIFFERENT policy, so the
    // already-committed routing must not be pushed onto it.
    const { runGit, verbs } = fakeGit([liveRejection(), null]);
    const refusal = new Error('managed root activation policy changed');

    await expect(pushOpsWithReconcile({
      repoRoot: '/repo', runGit, onReconciled: () => { throw refusal; },
    })).rejects.toBe(refusal);
    expect(verbs()).toEqual(['push origin ops', 'pull --rebase origin ops']);
  });

  it('uses the caller\'s reconcile argv (the audit ledger needs --autostash on a dirty shared checkout)', async () => {
    const { runGit, verbs } = fakeGit([liveRejection(), null]);

    await pushOpsWithReconcile({
      repoRoot: '/repo', runGit, reconcileArgs: ['pull', '--rebase', '--autostash', 'origin', 'ops'],
    });

    expect(verbs()).toEqual([
      'push origin ops', 'pull --rebase --autostash origin ops', 'push origin ops',
    ]);
  });
});

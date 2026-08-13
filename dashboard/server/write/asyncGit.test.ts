/**
 * #4 Daemon — the shared async process runner. These tests exercise the two safety properties the
 * whole conversion exists for: a hung child is killed by the hard timeout (never wedging the event
 * loop), and every live child is terminated on drain (daemon shutdown). A portable long-lived process
 * (`node -e "setTimeout(...)"`) stands in for a network-stalled `git push`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { activeAsyncGitCount, AsyncGitError, createAsyncGitRunner, drainAsyncGit, runTrackedProcess, withOpsTransaction } from './asyncGit.ts';

const NODE = process.execPath;
/** A child that ignores signals is not needed — we only need one that outlives the test's timeout. */
const HANG_ARGS = ['-e', 'setTimeout(() => {}, 60000)'];

afterEach(() => {
  // Never leak a spawned child between tests, whatever a test left running.
  drainAsyncGit();
});

describe('runTrackedProcess — hard timeout', () => {
  it('kills the child and rejects with a message naming the subcommand when it overruns the timeout', async () => {
    const started = Date.now();
    const promise = runTrackedProcess(NODE, HANG_ARGS, tmpdir(), 'push', { timeoutMs: 100 });
    await expect(promise).rejects.toBeInstanceOf(AsyncGitError);
    await expect(promise).rejects.toThrow(/push/);
    await expect(promise).rejects.toThrow(/timed out/);
    // The timeout actually fired (well under the 60s the child would otherwise run).
    expect(Date.now() - started).toBeLessThan(5_000);
    // Nothing is left tracked once it settles.
    expect(drainAsyncGit()).toBe(0);
  });

  it('rejects a non-zero exit with an execFileSync-shaped error carrying .status', async () => {
    // A tiny node program that exits 3 — mirrors git returning a non-zero code.
    const promise = runTrackedProcess(NODE, ['-e', 'process.exit(3)'], tmpdir(), 'commit');
    await expect(promise).rejects.toMatchObject({ status: 3 });
    await expect(promise).rejects.toThrow(/commit/);
  });

  it('resolves stdout on a clean exit', async () => {
    const out = await runTrackedProcess(NODE, ['-e', 'process.stdout.write("ok-line")'], tmpdir(), 'rev-parse');
    expect(out).toBe('ok-line');
  });
});

describe('withOpsTransaction — single-writer ops discipline', () => {
  it('serializes concurrent transactions FIFO (no interleaving)', async () => {
    const events: string[] = [];
    const gate = { release: () => {} };
    const first = withOpsTransaction(async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => { gate.release = resolve; });
      events.push('first:end');
      return 'first';
    });
    const second = withOpsTransaction(async () => {
      events.push('second:start');
      return 'second';
    });
    // Give the second transaction every chance to start early if the lock were broken.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['first:start']);
    gate.release();
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('is reentrant: a nested transaction joins the held lock instead of deadlocking', async () => {
    const result = await withOpsTransaction(async () =>
      withOpsTransaction(async () => withOpsTransaction(async () => 'nested')));
    expect(result).toBe('nested');
  });

  it('releases the lock when a transaction throws', async () => {
    await expect(withOpsTransaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await withOpsTransaction(async () => 'after')).toBe('after');
  });

  it('a requireTransaction runner refuses to run outside a transaction and works inside one', async () => {
    // Structural enforcement: future code cannot call ops git unserialized — it fails in ITS tests.
    const runner = createAsyncGitRunner({ requireTransaction: true });
    await expect(runner(process.cwd(), ['--version'])).rejects.toThrow(/outside withOpsTransaction/);
    const out = await withOpsTransaction(async () => runner(process.cwd(), ['--version']));
    expect(out).toContain('git version');
  });
});

describe('drainAsyncGit — kills live children on shutdown', () => {
  it('terminates an in-flight child and reports how many it signalled', async () => {
    const first = runTrackedProcess(NODE, HANG_ARGS, tmpdir(), 'push', { timeoutMs: 60_000 });
    const second = runTrackedProcess(NODE, HANG_ARGS, tmpdir(), 'pull', { timeoutMs: 60_000 });
    // Attach rejection handlers up front so the kill-induced rejection is never unhandled.
    const firstSettled = first.then(() => 'resolved', () => 'rejected');
    const secondSettled = second.then(() => 'resolved', () => 'rejected');

    // Both are alive and tracked; draining kills both.
    expect(activeAsyncGitCount()).toBe(2);
    expect(drainAsyncGit()).toBe(2);

    // A killed child (SIGKILL, exit code null) surfaces as a rejection, not a silent success.
    expect(await firstSettled).toBe('rejected');
    expect(await secondSettled).toBe('rejected');

    // Draining again finds nothing left.
    expect(activeAsyncGitCount()).toBe(0);
    expect(drainAsyncGit()).toBe(0);
  });
});

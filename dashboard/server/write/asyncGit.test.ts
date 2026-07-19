/**
 * #4 Daemon — the shared async process runner. These tests exercise the two safety properties the
 * whole conversion exists for: a hung child is killed by the hard timeout (never wedging the event
 * loop), and every live child is terminated on drain (daemon shutdown). A portable long-lived process
 * (`node -e "setTimeout(...)"`) stands in for a network-stalled `git push`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { AsyncGitError, drainAsyncGit, runTrackedProcess } from './asyncGit.ts';

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

describe('drainAsyncGit — kills live children on shutdown', () => {
  it('terminates an in-flight child and reports how many it signalled', async () => {
    const first = runTrackedProcess(NODE, HANG_ARGS, tmpdir(), 'push', { timeoutMs: 60_000 });
    const second = runTrackedProcess(NODE, HANG_ARGS, tmpdir(), 'pull', { timeoutMs: 60_000 });
    // Attach rejection handlers up front so the kill-induced rejection is never unhandled.
    const firstSettled = first.then(() => 'resolved', () => 'rejected');
    const secondSettled = second.then(() => 'resolved', () => 'rejected');

    // Both are alive and tracked; draining kills both.
    expect(drainAsyncGit()).toBe(2);

    // A killed child (SIGKILL, exit code null) surfaces as a rejection, not a silent success.
    expect(await firstSettled).toBe('rejected');
    expect(await secondSettled).toBe('rejected');

    // Draining again finds nothing left.
    expect(drainAsyncGit()).toBe(0);
  });
});

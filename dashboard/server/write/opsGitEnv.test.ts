/**
 * Locale pinning for ops git children.
 *
 * The whole coordination layer classifies git failures by matching git's own English words —
 * `opsPushRetry.ts` decides whether a rejected push was a retryable lost race by looking for
 * `non-fast-forward` / `fetch first` / `Updates were rejected because`, and `control/adapters.ts`
 * recognises benign worktree-removal errors the same way. Under a git that speaks another language
 * (LANG/LC_MESSAGES/LC_ALL set to a localized locale, which is normal on a non-English desktop) those
 * markers never match: every lost race would rethrow immediately and park a run, on a machine whose only
 * difference from a working one is an environment variable.
 *
 * `spawn` is mocked in THIS file only, so the real-subprocess behaviour asserted in `asyncGit.test.ts`
 * stays untouched.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnCalls: Array<{ bin: string; argv: string[]; options: { env?: NodeJS.ProcessEnv } }> = [];

vi.mock('node:child_process', () => ({
  spawn: (bin: string, argv: string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawnCalls.push({ bin, argv, options });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter; stderr: EventEmitter; kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit('close', 0));
    return child;
  },
}));

const { createAsyncGitRunner, opsGitEnv, withOpsTransaction } = await import('./asyncGit.ts');

beforeEach(() => { spawnCalls.length = 0; });

describe('opsGitEnv — the parent environment with the locale pinned', () => {
  it('pins LC_ALL=C over any inherited locale, whichever variable set it', () => {
    const pinned = opsGitEnv({ LANG: 'de_DE.UTF-8', LC_MESSAGES: 'fr_FR.UTF-8', LC_ALL: 'tr_TR.UTF-8' });
    // LC_ALL outranks both LANG and LC_MESSAGES in POSIX, so one variable is the whole fix.
    expect(pinned.LC_ALL).toBe('C');
  });

  it('adds ONLY the locale — every other inherited variable survives, and no credential is invented', () => {
    const base = { PATH: '/usr/bin', HOME: '/home/kb', GIT_CONFIG_GLOBAL: '/etc/gitconfig' };
    expect(opsGitEnv(base)).toEqual({ ...base, LC_ALL: 'C' });
    // The mutation-proof that it is a copy: pinning must never write back into the parent environment.
    expect(base).toEqual({ PATH: '/usr/bin', HOME: '/home/kb', GIT_CONFIG_GLOBAL: '/etc/gitconfig' });
  });

  it('defaults to the real process environment', () => {
    expect(opsGitEnv().PATH).toBe(process.env.PATH);
    expect(opsGitEnv().LC_ALL).toBe('C');
  });
});

describe('createAsyncGitRunner — every ops git child is spawned with the pinned locale', () => {
  it('carries LC_ALL=C into the spawned git process, alongside the inherited environment', async () => {
    const runGit = createAsyncGitRunner();

    await withOpsTransaction(async () => { await runGit('/repo', ['push', 'origin', 'ops']); });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].bin).toBe('git');
    expect(spawnCalls[0].argv).toEqual(['-c', 'commit.gpgsign=false', 'push', 'origin', 'ops']);
    expect(spawnCalls[0].options.env?.LC_ALL).toBe('C');
    // Still the inherited environment, not a stripped one: ambient git credentials must keep working.
    expect(spawnCalls[0].options.env?.PATH).toBe(process.env.PATH);
  });

  it('pins the locale for EVERY subcommand, not just push — the classifiers read all of them', async () => {
    const runGit = createAsyncGitRunner();

    await withOpsTransaction(async () => {
      await runGit('/repo', ['pull', '--rebase', 'origin', 'ops']);
      await runGit('/repo', ['rev-parse', '--abbrev-ref', 'HEAD']);
      await runGit('/repo', ['rebase', '--abort']);
    });

    expect(spawnCalls.map((call) => call.options.env?.LC_ALL)).toEqual(['C', 'C', 'C']);
  });

  it('lets an explicit env override win, so the pin is a default and not a lock', async () => {
    const runGit = createAsyncGitRunner({ env: { PATH: '/usr/bin', LC_ALL: 'C.UTF-8' } });

    await withOpsTransaction(async () => { await runGit('/repo', ['status', '--porcelain=v1']); });

    expect(spawnCalls[0].options.env).toEqual({ PATH: '/usr/bin', LC_ALL: 'C.UTF-8' });
  });
});
